// ============================================================================
// Momentum Tracker extension — background service worker
// ============================================================================
// All network calls to the backend happen here (not in the content script,
// which runs in the job site's own origin and would be subject to normal
// CORS rules). Extension pages/background workers with host_permissions
// are exempt from CORS, so this is the right place for every fetch().

// config.js defines self.MOMENTUM_DEFAULT_API_BASE, generated from the
// project's root .env by generate_frontend_env.py (falls back to
// http://localhost:8000 if that file is missing or wasn't regenerated).
try {
  importScripts("config.js");
} catch (e) {
  // config.js not built yet — fall through to the hardcoded default below.
}
const BUILT_IN_DEFAULT = (typeof MOMENTUM_DEFAULT_API_BASE !== "undefined" && MOMENTUM_DEFAULT_API_BASE)
  || "http://localhost:8000";

async function getConfig() {
  const { apiBase, token, user } = await chrome.storage.local.get(["apiBase", "token", "user"]);
  // Fallback chain: whatever the user explicitly set in Settings > the
  // value baked in from .env at build time > plain localhost. This means
  // the extension works immediately against a local backend with zero
  // configuration, and still respects .env / Settings when those are set.
  return { apiBase: (apiBase || BUILT_IN_DEFAULT || "").replace(/\/+$/, ""), token, user };
}

async function apiFetch(path, opts = {}) {
  const { apiBase, token } = await getConfig();
  if (!apiBase) throw new Error("Backend URL isn't set yet — open the extension's Options page and set it.");
  const headers = { "Content-Type": "application/json", ...(opts.headers || {}) };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  let res;
  try {
    res = await fetch(`${apiBase}${path}`, { ...opts, headers });
  } catch (e) {
    const err = new Error(`Couldn't reach ${apiBase} — is the backend running? (${e.message})`);
    err.status = 0;
    throw err;
  }
  let body = null;
  try { body = await res.json(); } catch { /* no body */ }
  if (!res.ok) {
    const detail = body?.detail || res.statusText || "Request failed";
    const err = new Error(
      typeof detail === "string" ? detail : (detail.message || JSON.stringify(detail)));
    err.status = res.status;
    // Keep the object as well as the message. The quota gate returns a
    // structured detail (used, limit, period_resets) that the popup renders,
    // and stringifying it threw all of that away.
    if (detail && typeof detail === "object") err.detail = detail;
    throw err;
  }
  return body;
}

// Content scripts only auto-inject into tabs that (re)load *after* the
// extension is installed/reloaded — a LinkedIn tab that was already open
// won't have content.js running yet, and chrome.tabs.sendMessage to it
// fails with "Receiving end does not exist." Rather than surface that as a
// confusing error, inject it on demand and retry once.
async function scrapeActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("No active tab found.");
  if (!/^https?:/.test(tab.url || "")) {
    throw new Error("Open the job posting's actual page first (this looks like a browser internal page).");
  }
  try {
    return await chrome.tabs.sendMessage(tab.id, { type: "MOMENTUM_SCRAPE_JOB" });
  } catch (e) {
    // Not injected yet — inject now and retry.
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
    return await chrome.tabs.sendMessage(tab.id, { type: "MOMENTUM_SCRAPE_JOB" });
  }
}

// Same on-demand injection story as scrapeActiveTab: a tab that was already
// open when the extension loaded has no autofill.js in it yet.
async function autofillActiveTab(profile) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("No active tab found.");
  if (!/^https?:/.test(tab.url || "")) {
    throw new Error("Open the application form first.");
  }
  const send = () => chrome.tabs.sendMessage(tab.id, { type: "MOMENTUM_AUTOFILL", profile });
  try {
    return await send();
  } catch (e) {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["autofill.js"] });
    return await send();
  }
}

// ---------------------------------------------------------------------------
// Sponsor-register answers, cached in the worker
// ---------------------------------------------------------------------------
// A results list asks about the same employers over and over — every scroll,
// every tab, every re-render. The register is republished at most daily, so an
// answer stays true far longer than a browsing session; an hour is a
// conservative floor that still picks up a manual refresh quickly. The map is
// bounded because a service worker is not a place to leak memory (Chrome will
// evict this worker when idle anyway, which empties it for free).
const SPONSOR_TTL_MS = 60 * 60 * 1000;
const SPONSOR_CACHE_MAX = 3000;
const sponsorCache = new Map();      // normalised name -> { at, answer }

const sponsorKey = (name) => String(name).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function readSponsorCache(names) {
  const known = {};
  const missing = [];
  const now = Date.now();
  for (const name of names) {
    const hit = sponsorCache.get(sponsorKey(name));
    if (hit && now - hit.at < SPONSOR_TTL_MS) known[name] = hit.answer;
    else missing.push(name);
  }
  return { known, missing };
}

function writeSponsorCache(results) {
  const now = Date.now();
  for (const [name, answer] of Object.entries(results || {})) {
    sponsorCache.set(sponsorKey(name), { at: now, answer });
  }
  // Oldest-first eviction: Map preserves insertion order, and an entry only
  // moves to the back when it is re-written with a fresh answer.
  while (sponsorCache.size > SPONSOR_CACHE_MAX) {
    sponsorCache.delete(sponsorCache.keys().next().value);
  }
}

// Signing out (or in as someone else) must not leave the previous session's
// answers behind — they were fetched with a different token.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.token) sponsorCache.clear();
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // The AI bridge has its own listener below.
  if (msg && String(msg.type || "").startsWith("MOMENTUM_AI_")) return false;
  (async () => {
    try {
      if (msg.type === "MOMENTUM_AUTOFILL_FORM") {
        // The profile is fetched here rather than in the content script: the
        // token lives in extension storage, and a page-injected script that
        // could read it would be handing every site on the web a way to ask.
        const profile = await apiFetch("/api/application-profile");
        const result = await autofillActiveTab(profile);
        sendResponse({ ok: true, ...result });
        return;
      }

      if (msg.type === "MOMENTUM_LOGIN") {
        const data = await apiFetch("/api/auth/login", {
          method: "POST",
          body: JSON.stringify({ email: msg.email, password: msg.password }),
        });
        await chrome.storage.local.set({ token: data.access_token, user: data.user });
        sendResponse({ ok: true, user: data.user });
        return;
      }

      if (msg.type === "MOMENTUM_LOGOUT") {
        await chrome.storage.local.remove(["token", "user"]);
        sendResponse({ ok: true });
        return;
      }

      if (msg.type === "MOMENTUM_PING") {
        const data = await apiFetch("/api/extension/ping");
        sendResponse({ ok: true, data });
        return;
      }

      if (msg.type === "MOMENTUM_LIST_RESUMES") {
        const data = await apiFetch("/api/resumes");
        sendResponse({ ok: true, data });
        return;
      }

      if (msg.type === "MOMENTUM_SCRAPE_ACTIVE_TAB") {
        const result = await scrapeActiveTab();
        if (!result?.ok) throw new Error(result?.error || "Couldn't read this page.");
        sendResponse({ ok: true, data: result.data });
        return;
      }

      if (msg.type === "MOMENTUM_EXTRACT") {
        // AI-assisted cleanup/mapping of whatever the content script
        // scraped — works on any job site, not just the ones with
        // hardcoded CSS selectors, since the model reads actual page text.
        const data = await apiFetch("/api/extension/extract", {
          method: "POST",
          body: JSON.stringify(msg.payload),
        });
        sendResponse({ ok: true, data });
        return;
      }

      if (msg.type === "MOMENTUM_GENERATE_RESUME") {
        // Creates a tailored copy of an existing Resume-Builder resume for
        // this specific job — this IS "generate a customized resume",
        // exposed as its own action so it doesn't require going through
        // the full Capture flow first.
        const data = await apiFetch("/api/resume-builder/tailor-for-job", {
          method: "POST",
          body: JSON.stringify(msg.payload),
        });
        sendResponse({ ok: true, data });
        return;
      }

      if (msg.type === "MOMENTUM_GENERATE_COVER_LETTER") {
        const data = await apiFetch("/api/cover-letter/generate", {
          method: "POST",
          body: JSON.stringify(msg.payload),
        });
        sendResponse({ ok: true, data });
        return;
      }

      if (msg.type === "MOMENTUM_ATS_CHECK") {
        // The scorer has always existed server-side; this is the extension
        // finally calling it instead of telling you to go and use the app.
        const data = await apiFetch("/api/ats/check", {
          method: "POST",
          body: JSON.stringify(msg.payload),
        });
        sendResponse({ ok: true, data });
        return;
      }

      if (msg.type === "MOMENTUM_SPONSOR_CHECK") {
        // Advisory lookup against the Home Office register of licensed worker
        // sponsors. Failing quietly is the right call: a company that can't be
        // checked should show no badge, not an error over the job posting.
        const q = encodeURIComponent(msg.payload?.company || "");
        const data = await apiFetch(`/api/sponsors/check?company=${q}`);
        sendResponse({ ok: true, data });
        return;
      }

      if (msg.type === "MOMENTUM_SPONSOR_CHECK_BULK") {
        // The in-page tags ask about a whole results list at once. A worker-
        // level cache on top of the content script's own is what makes a
        // second tab on the same board, or a board revisited later, free.
        const asked = (msg.payload?.companies || []).filter(Boolean).slice(0, 60);
        const { known, missing } = readSponsorCache(asked);
        if (missing.length) {
          const data = await apiFetch("/api/sponsors/check-bulk", {
            method: "POST",
            body: JSON.stringify({ companies: missing }),
          });
          const results = data?.results || {};
          writeSponsorCache(results);
          Object.assign(known, results);
        }
        sendResponse({ ok: true, data: { results: known } });
        return;
      }

      if (msg.type === "MOMENTUM_SPONSOR_STATUS") {
        const data = await apiFetch("/api/sponsors/status");
        sendResponse({ ok: true, data });
        return;
      }

      if (msg.type === "MOMENTUM_SPONSOR_REFRESH") {
        const data = await apiFetch("/api/sponsors/refresh", { method: "POST" });
        sponsorCache.clear();      // every cached answer came from the old copy
        sendResponse({ ok: true, data });
        return;
      }

      if (msg.type === "MOMENTUM_QUOTA") {
        const data = await apiFetch("/api/extension/quota");
        sendResponse({ ok: true, data });
        return;
      }

      if (msg.type === "MOMENTUM_BOARDS") {
        const data = await apiFetch("/api/boards");
        sendResponse({ ok: true, data });
        return;
      }

      if (msg.type === "MOMENTUM_CAPTURE") {
        const data = await apiFetch("/api/extension/capture", {
          method: "POST",
          body: JSON.stringify(msg.payload),
        });
        sendResponse({ ok: true, data });
        return;
      }

      sendResponse({ ok: false, error: `Unknown message type: ${msg.type}` });
    } catch (e) {
      sendResponse({ ok: false, error: e.message || String(e), status: e.status, detail: e.detail });
    }
  })();
  return true; // async response
});

// ---------------------------------------------------------------------------
// AI bridge: the person's own ChatGPT, Claude, Grok or Gemini, driven for them
// ---------------------------------------------------------------------------
// The Momentum app can't show those sites inside itself (they refuse to be
// framed) and free accounts have no API. The extension can do what the person
// would: open the site in its own window, type the request, wait, and read the
// reply. The reply goes back to the one Momentum tab that asked, and nowhere
// else.
//
// Jobs are kept in session storage because a service worker can be stopped
// while a long answer is being written; the site's report wakes it back up.

const AI_SITES = {
  chatgpt: { name: "ChatGPT", home: "https://chatgpt.com/", host: /(^|\.)chatgpt\.com$|(^|\.)chat\.openai\.com$/ },
  claude:  { name: "Claude",  home: "https://claude.ai/new", host: /(^|\.)claude\.ai$/ },
  grok:    { name: "Grok",    home: "https://grok.com/", host: /(^|\.)grok\.com$/ },
  gemini:  { name: "Gemini",  home: "https://gemini.google.com/app", host: /(^|\.)gemini\.google\.com$/ },
};

function aiHostOf(url) { try { return new URL(url).hostname; } catch { return ""; } }

async function aiSenderAllowed(sender) {
  const host = aiHostOf(sender?.url || sender?.origin || "");
  if (!host || !sender?.tab?.id) return false;
  if (host === "localhost" || host === "127.0.0.1" || host === "[::1]") return true;
  const { apiBase, appOrigins } = await chrome.storage.local.get(["apiBase", "appOrigins"]);
  if (apiBase && aiHostOf(apiBase) === host) return true;
  if (aiHostOf(BUILT_IN_DEFAULT) === host) return true;
  let origin = "";
  try { origin = new URL(sender.url).origin; } catch {}
  return Array.isArray(appOrigins) && appOrigins.includes(origin);
}

async function aiJobs() { return (await chrome.storage.session.get("aiJobs")).aiJobs || {}; }
async function aiSaveJob(job) {
  const jobs = await aiJobs();
  // Keep the last few only; each carries a CV.
  const ids = Object.keys(jobs);
  if (ids.length > 8) delete jobs[ids[0]];
  jobs[job.id] = job;
  await chrome.storage.session.set({ aiJobs: jobs });
}

async function aiTellApp(job, stage, extra = {}) {
  try {
    await chrome.tabs.sendMessage(job.appTabId, { type: "MOMENTUM_AI_EVENT", id: job.id, stage,
      provider: job.provider, ...extra });
  } catch { /* the Momentum tab was closed */ }
}

// Done when the tab has finished loading a page on the AI's own site. Checking
// the host matters when the window is reused: straight after being pointed at
// Grok, the tab still reports the ChatGPT page it had as "complete".
function aiWaitForLoad(tabId, site, timeoutMs = 45000) {
  return new Promise((resolve) => {
    let done = false;
    const ready = (t) => t && t.status === "complete" && site.host.test(aiHostOf(t.url || ""));
    const finish = (ok) => { if (!done) { done = true; chrome.tabs.onUpdated.removeListener(onUpd); resolve(ok); } };
    const onUpd = (id, _info, tab) => { if (id === tabId && ready(tab)) finish(true); };
    chrome.tabs.onUpdated.addListener(onUpd);
    setTimeout(() => chrome.tabs.get(tabId).then((t) => { if (ready(t)) finish(true); }).catch(() => finish(false)), 700);
    setTimeout(() => finish(false), timeoutMs);
  });
}

// One small window for all four, reused between requests, so the person can
// see what's happening and sign in if they need to, without it taking over
// their browser. Its tab is navigated to a fresh chat each time.
async function aiOpenWindow(site) {
  const { aiWindow } = await chrome.storage.session.get("aiWindow");
  if (aiWindow?.tabId) {
    try {
      const tab = await chrome.tabs.get(aiWindow.tabId);
      await chrome.tabs.update(tab.id, { url: site.home, active: true });
      await chrome.windows.update(tab.windowId, { focused: true, drawAttention: false });
      return tab;
    } catch { /* closed since */ }
  }
  const opts = { url: site.home, type: "popup", width: 540, height: 760, focused: true };
  try {
    // Against the right hand edge of the browser the person is using, so the
    // Momentum tab stays visible beside it.
    const cur = await chrome.windows.getLastFocused();
    if (Number.isFinite(cur.left) && Number.isFinite(cur.width)) {
      opts.left = Math.max(cur.left, cur.left + cur.width - 560);
      opts.top = (cur.top || 0) + 60;
      opts.height = Math.min(760, Math.max(420, (cur.height || 800) - 80));
    }
  } catch {}
  let win;
  try {
    win = await chrome.windows.create(opts);
  } catch {
    // Odd monitor layouts can make those bounds invalid; let Chrome place it.
    delete opts.left; delete opts.top;
    win = await chrome.windows.create(opts);
  }
  const tab = win.tabs && win.tabs[0];
  await chrome.storage.session.set({ aiWindow: { windowId: win.id, tabId: tab.id } });
  return tab;
}

async function aiAsk(msg, sender) {
  const site = AI_SITES[msg.provider];
  if (!site) throw new Error("Unknown AI.");
  if (!msg.text) throw new Error("Nothing to send.");
  const job = { id: msg.id, provider: msg.provider, appTabId: sender.tab.id,
                appWindowId: sender.tab.windowId, aiTabId: null, at: Date.now() };
  await aiSaveJob(job);
  await aiTellApp(job, "opening");
  const tab = await aiOpenWindow(site);
  job.aiTabId = tab.id;
  await aiSaveJob(job);
  await aiWaitForLoad(tab.id, site);
  // Redirects (sign in, a new chat URL) can land on another host.
  const now = await chrome.tabs.get(tab.id);
  const host = aiHostOf(now.url || "");
  if (!site.host.test(host)) {
    await aiTellApp(job, "error", { code: "login",
      error: `${site.name} sent you to a sign in page. Sign in in the AI window, then press Ask again.` });
    return;
  }
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["ai-bridge-site.js"] });
  let started = false;
  for (let i = 0; i < 6 && !started; i++) {
    try {
      await chrome.tabs.sendMessage(tab.id, { type: "MOMENTUM_AI_RUN", id: job.id, provider: job.provider, text: msg.text });
      started = true;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
      try { await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["ai-bridge-site.js"] }); } catch {}
    }
  }
  if (!started) await aiTellApp(job, "error", { error: `Couldn't reach the ${site.name} page. Try Ask again.` });
}

async function aiSiteEvent(msg, sender) {
  const jobs = await aiJobs();
  const job = jobs[msg.id];
  // Only the tab this job opened may answer for it.
  if (!job || !sender?.tab || sender.tab.id !== job.aiTabId) return;
  const site = AI_SITES[job.provider];
  if (!site || !site.host.test(aiHostOf(sender.tab.url || ""))) return;
  await aiTellApp(job, msg.stage, { text: msg.text, error: msg.error, code: msg.code });
  if (msg.stage === "done") {
    // Back to Momentum, where the answer is waiting to be checked.
    try {
      await chrome.windows.update(job.appWindowId, { focused: true });
      await chrome.tabs.update(job.appTabId, { active: true });
    } catch {}
  }
}

async function aiFocus() {
  const { aiWindow } = await chrome.storage.session.get("aiWindow");
  if (!aiWindow?.tabId) throw new Error("The AI window isn't open.");
  const tab = await chrome.tabs.get(aiWindow.tabId);
  await chrome.windows.update(tab.windowId, { focused: true });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !String(msg.type || "").startsWith("MOMENTUM_AI_")) return false;
  (async () => {
    try {
      if (msg.type === "MOMENTUM_AI_SITE_EVENT") {
        await aiSiteEvent(msg, sender);
        sendResponse({ ok: true });
        return;
      }
      if (!(await aiSenderAllowed(sender))) {
        sendResponse({ ok: false, error: "Not allowed from this page." });
        return;
      }
      if (msg.type === "MOMENTUM_AI_ASK") {
        sendResponse({ ok: true });
        try { await aiAsk(msg, sender); }
        catch (e) { await aiTellApp({ id: msg.id, appTabId: sender.tab.id, provider: msg.provider }, "error", { error: e.message || String(e) }); }
        return;
      }
      if (msg.type === "MOMENTUM_AI_HELLO") {
        sendResponse({ ok: true });
        return;
      }
      if (msg.type === "MOMENTUM_AI_FOCUS") {
        await aiFocus();
        sendResponse({ ok: true });
        return;
      }
      sendResponse({ ok: false, error: "Unknown request." });
    } catch (e) {
      sendResponse({ ok: false, error: e.message || String(e) });
    }
  })();
  return true;
});
