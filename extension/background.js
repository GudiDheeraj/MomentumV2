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
  (async () => {
    try {
      if (msg.type === "MOMENTUM_AUTOFILL_FORM") {
        // The profile is fetched here rather than in the content script: the
        // token lives in extension storage, and a page-injected script that
        // could read it would be handing every site on the web a way to ask.
        const profile = await apiFetch("/api/job-hunt/profile");
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
