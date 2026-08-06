// ============================================================================
// Momentum Tracker — frontend app (vanilla JS, no build step required)
// ============================================================================
const API_BASE = (window.MOMENTUM_API_BASE || (
  ["localhost", "127.0.0.1"].includes(window.location.hostname)
    ? "http://localhost:8000"
    : window.location.origin
)).replace(/\/+$/, ""); // strip any trailing slash — a common copy-paste mistake that
                         // otherwise turns every request into a double-slash URL
const TOKEN_KEY = "momentum_token";
const USER_KEY = "momentum_user";

const auth = {
  getToken: () => localStorage.getItem(TOKEN_KEY),
  getUser: () => { try { return JSON.parse(localStorage.getItem(USER_KEY)); } catch { return null; } },
  set: (token, user) => { localStorage.setItem(TOKEN_KEY, token); localStorage.setItem(USER_KEY, JSON.stringify(user)); },
  clear: () => { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(USER_KEY); },
};

// ---------- tiny fetch helpers ----------
async function api(path, opts = {}) {
  const headers = opts.body instanceof FormData ? {} : { "Content-Type": "application/json" };
  const token = auth.getToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}${path}`, { headers, ...opts });
  if (res.status === 401) {
    auth.clear();
    showAuthScreen();
    throw new Error("Session expired — please log in again.");
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    // Surface the backend's clean message (FastAPI puts it in {"detail": ...})
    // and the status code, so callers can special-case things like a 409
    // duplicate and show a friendly notification instead of a raw dump.
    let detail = text;
    try { detail = JSON.parse(text).detail || text; } catch (_) {}
    const err = new Error(detail || `API ${path} failed: ${res.status}`);
    err.status = res.status;
    err.detail = detail;
    throw err;
  }
  if (res.status === 204) return null;
  return res.json();
}

// ---------- GET cache + in-flight dedup ----------
// The single biggest cause of the "buffering when I switch tabs" lag was
// that every page re-fetched all of its data from the backend on every
// visit, even one you'd just looked at a second ago. This layer fixes that:
//   • Fresh cache hit (< TTL): returns instantly, zero network — so
//     bouncing between pages feels instant after the first load.
//   • Stale-but-present: returns the cached value immediately AND kicks off
//     a background refresh, so you never wait on a spinner for data we
//     already have; the next visit gets the updated copy.
//   • In-flight dedup: if the same GET is already running, callers share
//     the one promise instead of firing duplicate requests (the dashboard
//     alone would otherwise fan out into a dozen parallel calls).
// Any write (POST/PATCH/PUT/DELETE) clears the cache so nothing goes stale
// after you add or edit something.
const _apiCache = new Map();   // path -> { data, ts }
const _apiInflight = new Map(); // path -> Promise
const API_CACHE_TTL = 60000;    // 60s freshness window

function _fetchAndCache(path) {
  if (_apiInflight.has(path)) return _apiInflight.get(path);
  const p = api(path)
    .then(data => { _apiCache.set(path, { data, ts: Date.now() }); _apiInflight.delete(path); return data; })
    .catch(err => { _apiInflight.delete(path); throw err; });
  _apiInflight.set(path, p);
  return p;
}

function get(path, { noCache = false } = {}) {
  if (noCache) { invalidateApiCache(path); return _fetchAndCache(path); }
  const entry = _apiCache.get(path);
  if (entry) {
    const stale = Date.now() - entry.ts > API_CACHE_TTL;
    if (stale && !_apiInflight.has(path)) _fetchAndCache(path).catch(() => {}); // background refresh
    return Promise.resolve(entry.data);
  }
  return _fetchAndCache(path);
}

function invalidateApiCache(prefix) {
  if (!prefix) { _apiCache.clear(); return; }
  for (const key of _apiCache.keys()) if (key.startsWith(prefix)) _apiCache.delete(key);
}

// Writes go straight through and then blow away the read cache so the next
// render sees the change. (Cheap and always-correct; the cache exists to
// speed up navigation, not to be clever about partial invalidation.)
const post = (p, body) => api(p, { method: "POST", body: body instanceof FormData ? body : JSON.stringify(body) }).then(r => (invalidateApiCache(), r));
const patch = (p, body) => api(p, { method: "PATCH", body: JSON.stringify(body) }).then(r => (invalidateApiCache(), r));
const put = (p, body) => api(p, { method: "PUT", body: JSON.stringify(body) }).then(r => (invalidateApiCache(), r));
const del = (p) => api(p, { method: "DELETE" }).then(r => (invalidateApiCache(), r));

// ============================================================================
// UI utilities: toasts, in-app modals (replacing native alert/confirm/prompt),
// and the mobile sidebar drawer
// ============================================================================
function showToast(message, type = "info", icon = null) {
  const container = document.getElementById("toast-container");
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  // The container is aria-live="polite", which is right for a confirmation but
  // too patient for a failure: polite announcements wait for a pause, and a
  // toast that has already disappeared by then was never announced at all.
  // role="alert" on the toast itself is assertive, so problems interrupt.
  if (type === "error" || type === "warning") el.setAttribute("role", "alert");
  // Optional leading icon (e.g. ⚠️ for a duplicate warning) rendered in its
  // own span so it can't be styled away with the text and stays aligned.
  const defaultIcons = { success: "✓", error: "✕", warning: "⚠️" };
  const useIcon = icon !== null ? icon : defaultIcons[type];
  if (useIcon) {
    const ic = document.createElement("span");
    ic.className = "toast-icon";
    ic.textContent = useIcon;
    el.appendChild(ic);
  }
  const txt = document.createElement("span");
  txt.textContent = message;
  el.appendChild(txt);
  container.appendChild(el);
  setTimeout(() => {
    el.style.transition = "opacity .2s ease, transform .2s ease";
    el.style.opacity = "0";
    el.style.transform = "translateY(6px)";
    setTimeout(() => el.remove(), 200);
  }, type === "warning" || type === "error" ? 3200 : 2200);
}

// Briefly shake an input to draw the eye to it — used when a submit is
// rejected (e.g. a duplicate task) so the feedback isn't only the toast.
function shakeInput(el) {
  if (!el) return;
  el.classList.remove("input-shake");
  void el.offsetWidth; // reflow so the animation can retrigger
  el.classList.add("input-shake");
  setTimeout(() => el.classList.remove("input-shake"), 500);
}

// Centralised handling for a write that might come back as a 409 duplicate:
// shows the backend's friendly message as a warning toast (and optionally
// shakes the field), or a generic error toast for anything else. Returns
// true if it handled an error, false if there was none to handle.
function handleWriteError(err, { shakeEl = null, genericMsg = "Something went wrong — please try again." } = {}) {
  if (err && err.status === 409) {
    showToast(err.detail || "That already exists.", "warning");
    if (shakeEl) shakeInput(shakeEl);
  } else {
    showToast((err && err.detail) || genericMsg, "error");
  }
  return true;
}

// ---------------------------------------------------------------------------
// Modal behaviour
// ---------------------------------------------------------------------------
// These modals replaced native alert/confirm/prompt, which gave them the look
// of the app but not the behaviour of a dialog. The browser's own dialogs close
// on Escape, keep the keyboard inside themselves, and hand focus back where it
// came from; these did none of that. A customer who opened "Delete this board?"
// with the keyboard had no way to dismiss it without a mouse, and Tab walked
// straight out of the dialog into the page behind it — which is still there,
// still interactive, and now unreachable visually.
//
// Nothing here changes how any caller uses these functions.
let _modalSeq = 0;
let _modalKeyHandler = null;
let _modalRestoreFocus = null;

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), ' +
                  'select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function _activateModal(root, dismiss) {
  const box = root.querySelector(".modal-box");
  if (!box) return;

  // Announce it as a dialog, and name it from its own heading so screen
  // readers say what the dialog is for rather than just "dialog".
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-modal", "true");
  box.setAttribute("tabindex", "-1");
  const heading = box.querySelector("h3");
  if (heading) {
    if (!heading.id) heading.id = `modal-title-${++_modalSeq}`;
    box.setAttribute("aria-labelledby", heading.id);
  }

  // Remember where focus came from so it can go back there on close. Losing
  // focus to <body> is what makes a keyboard user restart their journey
  // through the page every time they dismiss a confirmation.
  _modalRestoreFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;

  const focusable = () => Array.from(box.querySelectorAll(FOCUSABLE))
    .filter(el => el.offsetWidth || el.offsetHeight || el === document.activeElement);

  (focusable()[0] || box).focus();

  _modalKeyHandler = (e) => {
    if (e.key === "Escape") { e.preventDefault(); dismiss(); return; }
    if (e.key !== "Tab") return;
    const items = focusable();
    if (!items.length) { e.preventDefault(); box.focus(); return; }
    const first = items[0], last = items[items.length - 1];
    // Wrap at both ends, so Tab and Shift+Tab cycle within the dialog instead
    // of stepping out into a page the customer can't see past the backdrop.
    if (e.shiftKey && (document.activeElement === first || document.activeElement === box)) {
      e.preventDefault(); last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault(); first.focus();
    }
  };
  // Capture phase: a field inside the dialog that handles its own keys can't
  // swallow Escape before this sees it.
  document.addEventListener("keydown", _modalKeyHandler, true);
}

function closeModal() {
  const root = document.getElementById("modal-root");
  if (_modalKeyHandler) {
    document.removeEventListener("keydown", _modalKeyHandler, true);
    _modalKeyHandler = null;
  }
  root.classList.add("hidden");
  root.innerHTML = "";
  const restore = _modalRestoreFocus;
  _modalRestoreFocus = null;
  // Only if it's still on the page — the element that opened the dialog may
  // have been the very thing the dialog deleted.
  if (restore && document.contains(restore)) {
    try { restore.focus(); } catch (_) {}
  }
}

function showInfoModal({ title, bodyHTML, actions = [{ label: "Close", onClick: closeModal }] }) {
  const root = document.getElementById("modal-root");
  root.innerHTML = `
    <div class="modal-backdrop" data-modal-backdrop>
      <div class="modal-box p-5">
        <h3 class="font-bold text-base mb-3">${title}</h3>
        <div class="mb-2">${bodyHTML}</div>
        <div class="flex justify-end gap-2 mt-4" data-modal-actions></div>
      </div>
    </div>`;
  root.classList.remove("hidden");
  const actionsWrap = root.querySelector("[data-modal-actions]");
  actions.forEach((a) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `btn ${a.primary ? "btn-accent" : "btn-ghost"}`;
    btn.textContent = a.label;
    btn.addEventListener("click", a.onClick);
    actionsWrap.appendChild(btn);
  });
  root.querySelector("[data-modal-backdrop]").addEventListener("click", (e) => {
    if (e.target === e.currentTarget) closeModal();
  });
  _activateModal(root, closeModal);
}

function showConfirmModal({ title, message, confirmLabel = "Delete", danger = true }) {
  return new Promise((resolve) => {
    const root = document.getElementById("modal-root");
    // title/message are always plain text at every call site (some embed a
    // user-supplied name, e.g. a résumé or company name) — escape both so
    // none of that ever gets parsed as markup.
    root.innerHTML = `
      <div class="modal-backdrop" data-modal-backdrop>
        <div class="modal-box p-5">
          <h3 class="font-bold text-base mb-2">${esc(title)}</h3>
          <p class="text-sm text-gray-500 mb-5">${esc(message)}</p>
          <div class="flex justify-end gap-2">
            <button class="btn btn-ghost" data-modal-cancel>Cancel</button>
            <button class="btn ${danger ? "btn-danger" : "btn-accent"}" data-modal-confirm>${confirmLabel}</button>
          </div>
        </div>
      </div>`;
    root.classList.remove("hidden");
    const finish = (result) => { closeModal(); resolve(result); };
    root.querySelector("[data-modal-backdrop]").addEventListener("click", (e) => { if (e.target.dataset.modalBackdrop !== undefined && e.target === e.currentTarget) finish(false); });
    root.querySelector("[data-modal-cancel]").addEventListener("click", () => finish(false));
    root.querySelector("[data-modal-confirm]").addEventListener("click", () => finish(true));
    // Escape resolves false, matching Cancel and matching the native confirm()
    // this replaced. A destructive dialog must never treat "get me out of here"
    // as consent.
    _activateModal(root, () => finish(false));
  });
}

function showPromptModal({ title, label = "", initialValue = "", placeholder = "", confirmLabel = "Save" }) {
  return new Promise((resolve) => {
    const root = document.getElementById("modal-root");
    root.innerHTML = `
      <div class="modal-backdrop" data-modal-backdrop>
        <div class="modal-box p-5">
          <h3 class="font-bold text-base mb-3">${title}</h3>
          <form data-modal-form>
            ${label ? `<label class="text-xs font-semibold text-gray-500 mb-1 block">${label}</label>` : ""}
            <input type="text" data-modal-input value="${esc(initialValue || "")}" placeholder="${esc(placeholder)}" autofocus />
            <div class="flex justify-end gap-2 mt-4">
              <button type="button" class="btn btn-ghost" data-modal-cancel>Cancel</button>
              <button type="submit" class="btn btn-accent">${confirmLabel}</button>
            </div>
          </form>
        </div>
      </div>`;
    root.classList.remove("hidden");
    const input = root.querySelector("[data-modal-input]");
    const finish = (result) => { closeModal(); resolve(result); };
    _activateModal(root, () => finish(null));
    // After _activateModal, which focuses the first focusable element — for a
    // prompt the useful target is the field itself, with its text selected so
    // typing replaces rather than appends.
    input.focus();
    input.select();
    root.querySelector("[data-modal-backdrop]").addEventListener("click", (e) => { if (e.target === e.currentTarget) finish(null); });
    root.querySelector("[data-modal-cancel]").addEventListener("click", () => finish(null));
    root.querySelector("[data-modal-form]").addEventListener("submit", (e) => {
      e.preventDefault();
      const val = input.value.trim();
      finish(val || null);
    });
  });
}

function openSidebar() {
  document.getElementById("sidebar").classList.add("sidebar-mobile-open");
  document.getElementById("sidebar-backdrop").classList.remove("hidden");
  document.querySelector("#app > main")?.classList.add("sidebar-drawer-locked");
}
function closeSidebar() {
  document.getElementById("sidebar").classList.remove("sidebar-mobile-open");
  document.getElementById("sidebar-backdrop").classList.add("hidden");
  document.querySelector("#app > main")?.classList.remove("sidebar-drawer-locked");
}
document.getElementById("sidebar-open").addEventListener("click", openSidebar);
document.getElementById("sidebar-close").addEventListener("click", closeSidebar);
document.getElementById("sidebar-backdrop").addEventListener("click", closeSidebar);

// ---------- desktop sidebar collapse (icon-only rail) ----------
function setSidebarCollapsed(collapsed) {
  const sidebar = document.getElementById("sidebar");
  const toggle = document.getElementById("sidebar-collapse-toggle");
  sidebar.classList.toggle("collapsed", collapsed);
  localStorage.setItem("momentum_sidebar_collapsed", collapsed ? "1" : "0");
  if (toggle) toggle.title = collapsed ? "Expand sidebar" : "Collapse sidebar";
}
document.getElementById("sidebar-collapse-toggle")?.addEventListener("click", () => {
  setSidebarCollapsed(!document.getElementById("sidebar").classList.contains("collapsed"));
});
// Clicking the Momentum logo re-opens the rail when it's collapsed; when the
// sidebar is already open it acts like a normal home link to the Dashboard.
document.getElementById("sidebar-brand")?.addEventListener("click", () => {
  const sb = document.getElementById("sidebar");
  if (sb.classList.contains("collapsed")) {
    setSidebarCollapsed(false);
  } else {
    navigate("dashboard");
  }
});
setSidebarCollapsed(localStorage.getItem("momentum_sidebar_collapsed") === "1");


const pad = (n) => String(n).padStart(2, "0");
const toISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromISO = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => { const nd = new Date(d); nd.setDate(nd.getDate() + n); return nd; };
const weekStartOf = (d) => { const day = (d.getDay() + 6) % 7; return addDays(d, -day); }; // Monday
const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const DAY_LABELS = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
const fmtNice = (d) => d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
// "16 July 2026" / "16 Jul 2026" — used by the Job Application detail page's
// "At a glance" sidebar and footer meta bar. Locale-aware like fmtNice
// above (undefined locale = the browser's own date ordering).
const fmtLongDate = (d) => d.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });
const fmtShortDate = (d) => d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

// ---------- global state ----------
const state = {
  // Welcome is the landing page on every sign-in. It is also the only page
  // that is safe to open cold: it fetches nothing that can fail and needs no
  // data the account might not have yet.
  page: "welcome",
  // The signed-in person's profile (photo + the lines under their name).
  // Fetched once, refreshed when they change it.
  profile: null,
  day: new Date(),
  weekStart: weekStartOf(new Date()),
  monthYear: new Date().getFullYear(),
  monthMonth: new Date().getMonth() + 1,
  year: new Date().getFullYear(),
  charts: {}, // id -> Chart.js instance, so we can destroy before recreate
  // Week/Month/Year can be scoped to habits only, one-off tasks only, or both.
  // Every statistic on those pages recalculates from the matching numbers the
  // API returns, so the three tabs read as three separate dashboards.
  scope: (() => {
    const saved = localStorage.getItem("momentum_scope");
    return ["all", "habit", "task"].includes(saved) ? saved : "all";
  })(),
  resumesView: "library",   // "library" | "builder" — sub-tab of the Resumes page
  resumesLibTab: "base",    // "base" | "tailored" — library filter
  builderResumeId: null,    // set when the builder is editing an existing resume
};

function destroyChart(id) {
  if (state.charts[id]) { state.charts[id].destroy(); delete state.charts[id]; }
}

// Chart.js instances bake in their colors at creation time, so without this
// they stay light-mode colors even after the page switches to dark mode
// (dark navy bars vanish into a dark background, light grid lines and
// black-ish axis labels become invisible). Charts are re-created (not just
// re-styled) on every render() and on every theme toggle, so reading the
// current theme here keeps them in sync automatically.
function chartTheme() {
  const isDark = document.documentElement.getAttribute("data-theme") === "dark";
  const accent = getComputedStyle(document.documentElement).getPropertyValue("--lp-blue").trim() || "#3D5AFE";
  // donutFill/donutTrack previously fell back to near-black/gray in light
  // mode (#171A1F on #E9EBEE) instead of the app's actual accent color, so
  // every doughnut chart (day/week/month/year progress, dashboard status
  // breakdown) rendered off-brand grayscale instead of matching the blue/
  // violet theme used everywhere else (buttons, active tabs, the day-ring).
  // Pointing both at the accent keeps every circular progress indicator in
  // the same uniform violet-blue family, in both themes.
  return isDark
    ? { bar: accent, barMuted: "rgba(255,255,255,0.18)", grid: "rgba(255,255,255,0.09)", text: "#AEB9C3", donutTrack: "rgba(124,144,255,0.16)", donutFill: accent, donutBorder: "#182838", accent,
        tooltipBg: "#1C2333", tooltipBorder: "rgba(255,255,255,0.08)", cardBg: "#182333" }
    : { bar: "#171A1F", barMuted: "#C9CDD3", grid: "#F0F1F3", text: "#5B6472", donutTrack: "#E9EDFF", donutFill: accent, donutBorder: "#fff", accent,
        tooltipBg: "#171A1F", tooltipBorder: "rgba(255,255,255,0.06)", cardBg: "#FFFFFF" };
}

// Shared, consistent tooltip styling for every Chart.js instance on the
// dashboard — dark rounded card, generous padding, small colored swatches —
// so every chart (bar/line/donut/pie) reads as one polished design system
// instead of each using Chart.js's plain default tooltip.
function chartTooltip(t, extra = {}) {
  return {
    enabled: true,
    backgroundColor: t.tooltipBg,
    borderColor: t.tooltipBorder,
    borderWidth: 1,
    padding: 10,
    cornerRadius: 8,
    titleFont: { size: 10.8, weight: "600" },
    bodyFont: { size: 10.8 },
    boxPadding: 4,
    displayColors: true,
    ...extra,
  };
}

// Wraps long category labels onto a second line (returned as a small array,
// which Chart.js renders as multi-line ticks) instead of letting the axis
// fall back to steeply rotated single-line text — rotated labels are the
// single biggest thing that makes a bar chart look unpolished.
function wrapTickLabel(label, maxLineLen = 10) {
  const str = String(label);
  if (str.length <= maxLineLen || !str.includes(" ")) return str;
  const words = str.split(" ");
  const lines = [];
  let cur = "";
  words.forEach(w => {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length > maxLineLen && cur) { lines.push(cur); cur = w; }
    else { cur = next; }
  });
  if (cur) lines.push(cur);
  return lines;
}

// Draws a total count in the empty center of a doughnut chart — a small
// touch that makes status/job-type breakdowns read as a considered piece of
// dashboard design rather than a bare Chart.js default.
const centerTextPlugin = {
  id: "centerText",
  afterDraw(chart) {
    const cfg = chart.config.options.plugins?.centerText;
    if (!cfg?.enabled) return;
    const { ctx, chartArea } = chart;
    if (!chartArea) return;
    const cx = (chartArea.left + chartArea.right) / 2;
    const cy = (chartArea.top + chartArea.bottom) / 2;
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "700 18px 'Space Grotesk', sans-serif";
    ctx.fillStyle = cfg.color || "#171A1F";
    ctx.fillText(cfg.main, cx, cy - (cfg.sub ? 9 : 0));
    if (cfg.sub) {
      ctx.font = "600 9px 'IBM Plex Sans', sans-serif";
      ctx.fillStyle = cfg.subColor || "#93968E";
      ctx.letterSpacing = "0.04em";
      ctx.fillText(cfg.sub.toUpperCase(), cx, cy + 10);
    }
    ctx.restore();
  },
};
// Chart.js is no longer loaded synchronously in <head>, so this line ran
// against a `window.Chart` that didn't exist yet and quietly did nothing —
// which would have left every donut chart without its centre text, with no
// error to explain why. Registration is deferred to the moment the library is
// actually present, and the flag makes it idempotent however often that
// happens. See ensureChartJs().
let _centerTextRegistered = false;
function registerChartPlugins() {
  if (_centerTextRegistered || !window.Chart) return;
  window.Chart.register(centerTextPlugin);
  _centerTextRegistered = true;
}
registerChartPlugins();   // no-op unless something else already loaded Chart.js

// Single-hue sequential palette derived from the app's own accent color
// (--lp-blue). Every multi-series chart on the dashboard pulls from this
// so the whole page reads as one consistent theme instead of a rainbow of
// unrelated hues, and it already tracks light/dark mode automatically.
const ACCENT_SCALE_LIGHT = ["#3D5AFE", "#2C42C7", "#1E2E94", "#7C90FF", "#16205E", "#B8C4FF"];
const ACCENT_SCALE_DARK  = ["#7C90FF", "#3D5AFE", "#2C42C7", "#B8C4FF", "#1E2E94", "#E9EDFF"];
function accentScale(n) {
  const isDark = document.documentElement.getAttribute("data-theme") === "dark";
  const scale = isDark ? ACCENT_SCALE_DARK : ACCENT_SCALE_LIGHT;
  return Array.from({ length: n }, (_, i) => scale[i % scale.length]);
}

// Vivid multi-hue palette — used on the Dashboard where several distinct
// series/categories benefit from being visually distinguishable at a glance
// (skills, job types, status breakdowns, funnel stages, KPI accents…)
// rather than shades of a single accent color.
const VIVID_SCALE_LIGHT = ["#3D5AFE", "#FF6A3D", "#7C5CFC", "#1FAE6B", "#E0A93E", "#0EA5E9", "#EC4899", "#14B8A6", "#F43F5E", "#84CC16"];
const VIVID_SCALE_DARK  = ["#6B84FF", "#FF9166", "#A78BFA", "#3FC488", "#F5CB74", "#38BDF8", "#F472B6", "#2DD4BF", "#FB7185", "#A3E635"];
function vividScale(n) {
  const isDark = document.documentElement.getAttribute("data-theme") === "dark";
  const scale = isDark ? VIVID_SCALE_DARK : VIVID_SCALE_LIGHT;
  return Array.from({ length: n }, (_, i) => scale[i % scale.length]);
}

// ============================================================================
// Lazy third-party libraries
// ============================================================================
// Chart.js, d3 and topojson used to be four render-blocking <script> tags in
// <head>: roughly 900KB that every page load waited on, on top of the Tailwind
// runtime. d3 and topojson exist for exactly one function in this entire
// application — the applications-by-location map — so almost every visitor was
// paying ~500KB for a map they never opened.
//
// They are fetched on first use instead. The promise is memoised per URL, so
// six charts appearing at once share one download, and a failed load is
// forgotten rather than cached as a permanent failure.
const _scriptOnce = new Map();
function loadScriptOnce(src) {
  if (_scriptOnce.has(src)) return _scriptOnce.get(src);
  const p = new Promise((resolve, reject) => {
    const el = document.createElement("script");
    el.src = src;
    el.async = true;
    el.onload = () => resolve();
    el.onerror = () => { _scriptOnce.delete(src); reject(new Error(`Couldn't load ${src}`)); };
    document.head.appendChild(el);
  });
  _scriptOnce.set(src, p);
  return p;
}

const CDN_CHART    = "https://cdn.jsdelivr.net/npm/chart.js@4.4.3/dist/chart.umd.min.js";
const CDN_D3       = "https://cdn.jsdelivr.net/npm/d3@7";
const CDN_TOPOJSON = "https://cdn.jsdelivr.net/npm/topojson-client@3";

// Plugins are registered here rather than at module scope, because at module
// scope Chart.js does not exist yet. Every path that draws a chart goes
// through this, so there is no way to get a chart without its plugins.
const ensureChartJs = () => (window.Chart ? Promise.resolve() : loadScriptOnce(CDN_CHART))
  .then(registerChartPlugins);
const ensureGeoLibs = () => (window.d3 && window.topojson) ? Promise.resolve()
  : Promise.all([loadScriptOnce(CDN_D3), loadScriptOnce(CDN_TOPOJSON)]);

// The chart helpers below are called synchronously from a dozen render paths.
// Rather than turn all of those async — a change that would touch far more
// code than it fixes — each helper checks for the library and, if it isn't
// there yet, re-invokes itself once the download lands. The chart draws a
// fraction of a second later on the first call of a session and immediately
// after that; every caller stays unchanged.
function chartLibReady(retry) {
  // Also covers the case where Chart.js arrived by some other route than
  // ensureChartJs() — registration has to be true before the first draw, not
  // merely before the first *lazy* draw.
  if (window.Chart) { registerChartPlugins(); return true; }
  ensureChartJs().then(retry).catch(err => console.warn("[Momentum] charts unavailable", err));
  return false;
}

function donutChart(canvasId, percent, label, size = 160) {
  if (!chartLibReady(() => donutChart(canvasId, percent, label, size))) return;
  destroyChart(canvasId);
  const ctx = document.getElementById(canvasId);
  if (!ctx) return;
  const t = chartTheme();
  state.charts[canvasId] = new Chart(ctx, {
    type: "doughnut",
    data: {
      datasets: [{
        data: [percent, 100 - percent],
        backgroundColor: [t.donutFill, t.donutTrack],
        borderWidth: 0,
      }],
    },
    options: {
      cutout: "72%",
      maintainAspectRatio: false,
      elements: { arc: { borderRadius: 30 } },
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
      animation: { duration: 500 },
    },
  });
}

// ----------------------------------------------------------------------
// Day-view progress ring — a hand-drawn SVG ring (rather than Chart.js)
// so it can match the reference design exactly: a thick rounded-cap arc
// in the app's accent blue over a soft blue track, with the percentage,
// a flame icon, and a caption centered inside. Colors are pulled from the
// same --lp-blue tokens as the rest of the app for a uniform theme.
// ----------------------------------------------------------------------
function dayRingSVG(percent, size = 176, stroke = 16) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, percent));
  const offset = c * (1 - clamped / 100);
  const cx = size / 2, cy = size / 2;
  return `<svg width="100%" height="100%" viewBox="0 0 ${size} ${size}" class="day-ring-svg" aria-hidden="true">
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--lp-blue-soft)" stroke-width="${stroke}"/>
    <circle id="day-ring-arc" cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--lp-blue)" stroke-width="${stroke}"
      stroke-linecap="round" stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${offset.toFixed(2)}"
      transform="rotate(-90 ${cx} ${cy})" style="transition: stroke-dashoffset .5s ease;"/>
  </svg>`;
}

function setDayRingPercent(percent, size = 176, stroke = 16) {
  const arc = document.getElementById("day-ring-arc");
  if (!arc) return;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, percent));
  arc.setAttribute("stroke-dashoffset", (c * (1 - clamped / 100)).toFixed(2));
}

// One compact stat row for the Day-view progress card (Completed /
// Remaining / Weekly Avg). All three colors are drawn from the app's
// existing --lp-* tokens so they sit in the same violet-blue family as
// the rest of the dashboard rather than introducing new arbitrary hues.
function dayStatMini(icon, value, label, varName) {
  return `<div class="day-stat-mini">
    <div class="day-stat-mini-icon" style="background:var(${varName}-soft); color:var(${varName});">${icon}</div>
    <div>
      <p class="day-stat-mini-value">${value}</p>
      <p class="day-stat-mini-label">${label}</p>
    </div>
  </div>`;
}

// Update an existing chart's data in place instead of destroying and
// re-creating it. Rebuilding a Chart.js instance is expensive (full canvas
// teardown + 500ms intro animation), which is why a single checkbox click
// used to feel like a page load. These keep the same instance and just
// animate the numbers to their new values.
function updateDonutValue(canvasId, percent) {
  const c = state.charts[canvasId];
  if (!c) return;
  c.data.datasets[0].data = [percent, 100 - percent];
  c.update("none");
}

function updateBarValues(canvasId, data) {
  const c = state.charts[canvasId];
  if (!c) return;
  c.data.datasets[0].data = data;
  const maxVal = Math.max(1, ...data);
  if (c.options?.scales?.y) c.options.scales.y.suggestedMax = Math.ceil(maxVal * 1.2);
  c.update("none");
}

function barChart(canvasId, labels, data, highlightIndex = -1, customColors = null, onBarClick = null) {
  if (!chartLibReady(() => barChart(canvasId, labels, data, highlightIndex, customColors, onBarClick))) return;
  destroyChart(canvasId);
  const ctx = document.getElementById(canvasId);
  if (!ctx) return;
  const t = chartTheme();
  // Violet-blue accent family instead of the old black-highlight / grey-rest
  // scheme: the highlighted bar (e.g. today, current month) is the solid
  // accent, the rest a lighter tint of the same accent. Follows whatever
  // accent theme is active rather than hardcoding a colour.
  const [ar, ag, ab] = accentRgb();
  const accentSolid = `rgb(${ar}, ${ag}, ${ab})`;
  const accentSoft = `rgba(${ar}, ${ag}, ${ab}, 0.42)`;
  const colors = customColors || labels.map((_, i) => (i === highlightIndex ? accentSolid : accentSoft));
  const maxVal = Math.max(1, ...data);
  state.charts[canvasId] = new Chart(ctx, {
    type: "bar",
    data: {
      labels: labels.map(l => wrapTickLabel(l)),
      datasets: [{
        data,
        backgroundColor: colors,
        hoverBackgroundColor: colors,
        borderRadius: { topLeft: 6, topRight: 6, bottomLeft: 0, bottomRight: 0 },
        borderSkipped: false,
        maxBarThickness: 34,
        categoryPercentage: 0.7,
        barPercentage: 0.85,
      }],
    },
    options: {
      maintainAspectRatio: false,
      layout: { padding: { top: 8 } },
      // Bars drill down when the caller supplies a handler (e.g. a month in the
      // year view opens that month), and the cursor advertises it.
      onClick: onBarClick ? (evt, elements) => {
        if (elements.length) onBarClick(elements[0].index);
      } : undefined,
      onHover: onBarClick ? (evt, elements) => {
        evt.native.target.style.cursor = elements.length ? "pointer" : "default";
      } : undefined,
      plugins: {
        legend: { display: false },
        tooltip: chartTooltip(t, { displayColors: false, callbacks: { title: (items) => (Array.isArray(items[0]?.label) ? items[0].label.join(" ") : items[0]?.label) } }),
      },
      scales: {
        y: {
          beginAtZero: true,
          suggestedMax: Math.ceil(maxVal * 1.2),
          grid: { color: t.grid, drawTicks: false },
          border: { display: false },
          ticks: { color: t.text, precision: 0, padding: 6 },
        },
        x: {
          grid: { display: false },
          border: { display: false },
          ticks: { color: t.text, maxRotation: 0, minRotation: 0, autoSkip: false, font: { size: 9.9 } },
        },
      },
      animation: { duration: 500 },
    },
  });
}

// ----------------------------------------------------------------------
// Column-aligned trend chart (hand-drawn SVG).
//
// This is deliberately not a Chart.js chart. The one hard requirement is that
// each day's point shares a vertical line with that day's column in the habit
// table above it, and a charting library always reserves its own internal
// space for axes/padding — which meant the points drifted off the columns.
// Here every x coordinate is read straight off the table's header cells, so
// the alignment is exact by construction rather than corrected after the fact.
// ----------------------------------------------------------------------

// Fritsch-Carlson monotone cubic: a smooth curve that never overshoots the
// data (an 80 -> 80 pair stays flat instead of bulging past 90).
function monotoneCubicPath(xs, ys) {
  const n = xs.length;
  if (n < 2) return "";
  const dx = [], ms = [];
  for (let i = 0; i < n - 1; i++) {
    dx[i] = xs[i + 1] - xs[i];
    ms[i] = (ys[i + 1] - ys[i]) / (dx[i] || 1);
  }
  const m = new Array(n);
  m[0] = ms[0];
  m[n - 1] = ms[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (ms[i - 1] * ms[i] <= 0) { m[i] = 0; continue; }
    const w1 = 2 * dx[i] + dx[i - 1];
    const w2 = dx[i] + 2 * dx[i - 1];
    m[i] = (w1 + w2) / (w1 / ms[i - 1] + w2 / ms[i]);
  }
  let d = `M ${xs[0].toFixed(2)} ${ys[0].toFixed(2)}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3;
    d += ` C ${(xs[i] + h).toFixed(2)} ${(ys[i] + m[i] * h).toFixed(2)},` +
         ` ${(xs[i + 1] - h).toFixed(2)} ${(ys[i + 1] - m[i + 1] * h).toFixed(2)},` +
         ` ${xs[i + 1].toFixed(2)} ${ys[i + 1].toFixed(2)}`;
  }
  return d;
}

// Standalone trend chart. Renders its own y-axis, gridlines, smooth area
// curve, points and hover bands into a container sized by CSS.
function renderTrendChart(container, { labels, values, todayIndex = -1, unit = "%" } = {}) {
  if (!container) return;
  const w = container.clientWidth;
  const h = container.clientHeight;
  if (!w || !h || !values.length) return;

  const padL = 44, padR = 24, padT = 36, padB = 34;
  const left = padL, right = w - padR;
  const top = padT, bottom = h - padB;
  const plotH = bottom - top;
  const plotW = right - left;
  if (plotW < 40 || plotH < 20) return;

  const n = values.length;
  const step = n > 1 ? plotW / (n - 1) : 0;
  const xs = values.map((_, i) => left + step * i);
  const y = v => bottom - (Math.max(0, Math.min(100, v)) / 100) * plotH;
  const ys = values.map(y);

  const line = monotoneCubicPath(xs, ys);
  const area = `${line} L ${right.toFixed(2)} ${bottom} L ${left.toFixed(2)} ${bottom} Z`;

  const ticks = [0, 25, 50, 75, 100];
  const grid = ticks.map(v => `
    <line class="trend-grid" x1="${left}" y1="${y(v).toFixed(2)}" x2="${right}" y2="${y(v).toFixed(2)}" />
    <text class="trend-axis" x="${left - 12}" y="${(y(v) + 3.5).toFixed(2)}" text-anchor="end">${v}${unit}</text>`).join("");

  // One interactive band per day: an invisible hit area that reveals a guide
  // line and swells the point on hover, so the chart responds to the cursor
  // without needing any JS event wiring.
  const cols = xs.map((x, i) => {
    const bandW = n > 1 ? step : plotW;
    const bandX = Math.max(left - 1, x - bandW / 2);
    const isToday = i === todayIndex;
    return `<g class="trend-col ${isToday ? "is-today" : ""}">
      <line class="trend-guide" x1="${x.toFixed(2)}" y1="${top - 20}" x2="${x.toFixed(2)}" y2="${bottom}" />
      <text class="trend-value" x="${x.toFixed(2)}" y="${(ys[i] - 15).toFixed(2)}" text-anchor="middle">${values[i]}${unit}</text>
      <circle class="trend-halo" cx="${x.toFixed(2)}" cy="${ys[i].toFixed(2)}" r="9" />
      <circle class="trend-point" cx="${x.toFixed(2)}" cy="${ys[i].toFixed(2)}" r="${isToday ? 5.5 : 4}" />
      <text class="trend-day" x="${x.toFixed(2)}" y="${(bottom + 22).toFixed(2)}" text-anchor="middle">${labels[i]}</text>
      <rect class="trend-band" x="${bandX.toFixed(2)}" y="${top - 24}" width="${bandW.toFixed(2)}" height="${(bottom - top + 48).toFixed(2)}">
        <title>${labels[i]} — ${values[i]}${unit} of habits completed</title>
      </rect>
    </g>`;
  }).join("");

  const uid = `t${Math.random().toString(36).slice(2, 8)}`;
  container.innerHTML = `
    <svg class="trend-svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img"
         aria-label="Share of habits completed each day this week">
      <defs>
        <linearGradient id="${uid}-area" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stop-color="var(--lp-blue, #3D5AFE)" stop-opacity="0.32"/>
          <stop offset="50%"  stop-color="var(--lp-blue, #3D5AFE)" stop-opacity="0.11"/>
          <stop offset="100%" stop-color="var(--lp-blue, #3D5AFE)" stop-opacity="0"/>
        </linearGradient>
        <linearGradient id="${uid}-line" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%"   stop-color="var(--lp-blue, #3D5AFE)" stop-opacity="0.75"/>
          <stop offset="50%"  stop-color="var(--lp-blue, #3D5AFE)"/>
          <stop offset="100%" stop-color="var(--lp-violet, #7C5CFC)"/>
        </linearGradient>
        <filter id="${uid}-glow" x="-20%" y="-40%" width="140%" height="200%">
          <feDropShadow dx="0" dy="3" stdDeviation="4"
            flood-color="var(--lp-blue, #3D5AFE)" flood-opacity="0.28"/>
        </filter>
      </defs>
      <g class="trend-grid-group">${grid}</g>
      <path class="trend-area" d="${area}" fill="url(#${uid}-area)" />
      <path class="trend-line" d="${line}" stroke="url(#${uid}-line)" filter="url(#${uid}-glow)" />
      <line class="trend-baseline" x1="${left}" y1="${bottom}" x2="${right}" y2="${bottom}" />
      ${cols}
    </svg>`;
}

function hexToRgb(hex) {
  const m = hex.replace("#", "").match(/.{1,2}/g) || ["61", "90", "254"];
  return m.map(h => parseInt(h, 16));
}

// The app's accent (violet-blue by default, but user-switchable) as an [r,g,b]
// array, so charts and progress bars can build tinted variations of it that
// follow whatever accent theme is active instead of hardcoded greys/blacks.
function accentRgb() {
  const hex = getComputedStyle(document.documentElement).getPropertyValue("--lp-blue").trim() || "#3D5AFE";
  return hexToRgb(hex);
}

// A single accent-family colour for a habit progress bar, deeper/more
// saturated as the percentage climbs. Replaces the old blue/black/red
// three-way split so every leaderboard bar reads as one violet-blue scale.
function habitBarColor(percent) {
  const [r, g, b] = accentRgb();
  const p = Math.max(0, Math.min(100, percent || 0));
  const alpha = (0.32 + (p / 100) * 0.68).toFixed(3);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// GitHub-contributions-style activity heatmap: one cell per day over the
// last ~13 weeks, colored by how many applications were logged that day.
function renderApplicationHeatmap(jobs, scrollId = "app-heatmap-scroll") {
  const accent = chartTheme().accent;
  const [r, g, b] = hexToRgb(accent);
  const isDark = document.documentElement.getAttribute("data-theme") === "dark";
  const emptyCellColor = isDark ? "rgba(255,255,255,0.07)" : "rgba(23,26,31,0.06)";
  const WEEKS = 53; // a full year, GitHub-contributions style
  const CELL = 14, GAP = 3;
  const days = WEEKS * 7;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = new Date(today);
  start.setDate(start.getDate() - (days - 1) - today.getDay()); // align to a Sunday

  const countByDate = {};
  jobs.forEach(j => {
    if (!j.date_applied) return;
    countByDate[j.date_applied] = (countByDate[j.date_applied] || 0) + 1;
  });
  const maxCount = Math.max(1, ...Object.values(countByDate), 0);

  const weeks = [];
  for (let w = 0; w < WEEKS; w++) {
    const col = [];
    for (let d = 0; d < 7; d++) {
      const date = new Date(start);
      date.setDate(date.getDate() + w * 7 + d);
      const iso = toISO(date);
      const count = countByDate[iso] || 0;
      const inFuture = date > today;
      const opacity = count === 0 ? 0 : Math.max(0.18, count / maxCount);
      col.push({ iso, count, opacity, inFuture });
    }
    weeks.push(col);
  }

  const monthLabels = [];
  let lastMonth = null;
  weeks.forEach((col, w) => {
    const d = new Date(col[0].iso);
    const m = d.toLocaleDateString(undefined, { month: "short" });
    if (m !== lastMonth) { monthLabels.push({ w, label: m }); lastMonth = m; }
  });

  const totalApplications = Object.values(countByDate).reduce((a, b2) => a + b2, 0);
  const gridWidth = WEEKS * (CELL + GAP);

  return `
    <div id="${scrollId}" style="overflow-x:auto; padding-bottom:2px;">
      <div class="text-xs text-gray-400 mb-2">${totalApplications} application${totalApplications === 1 ? "" : "s"} in the last year</div>
      <div style="display:grid; grid-template-columns:repeat(${WEEKS},${CELL}px); gap:10px ${GAP}px; margin-bottom:4px; font-size:9px; color:var(--lp-ink-faint,#93968E); font-family:var(--lp-mono,monospace); min-width:${gridWidth}px;">
        ${weeks.map((_, w) => {
          const found = monthLabels.find(m => m.w === w);
          return `<div>${found ? found.label : ""}</div>`;
        }).join("")}
      </div>
      <div style="display:grid; grid-template-columns:repeat(${WEEKS},${CELL}px); grid-auto-flow:column; grid-template-rows:repeat(7,${CELL}px); gap:${GAP}px; min-width:${gridWidth}px;">
        ${weeks.flat().map(cell => `
          <div title="${cell.iso}: ${cell.count} application${cell.count === 1 ? "" : "s"}"
               style="width:${CELL}px; height:${CELL}px; border-radius:3px; background:${cell.inFuture ? "transparent" : (cell.count === 0 ? emptyCellColor : `rgba(${r},${g},${b},${cell.opacity})`)};"></div>
        `).join("")}
      </div>
      <div class="flex items-center gap-2 mt-2 text-[9px] text-gray-400">
        <span>Less</span>
        ${[0, 0.25, 0.5, 0.75, 1].map(o => `<div style="width:14px; height:14px; border-radius:3px; background:${o === 0 ? emptyCellColor : `rgba(${r},${g},${b},${o})`};"></div>`).join("")}
        <span>More</span>
      </div>
    </div>
  `;
}

// Scrolls a heatmap wrapper (built by renderApplicationHeatmap) all the way
// to the right so the current/latest month is visible without the user
// needing to manually scroll a 53-week-wide grid.
function scrollHeatmapToLatest(scrollId) {
  requestAnimationFrame(() => {
    const wrap = document.getElementById(scrollId);
    if (wrap) wrap.scrollLeft = wrap.scrollWidth;
  });
}


function pieChart(canvasId, labels, data, colors) {
  if (!chartLibReady(() => pieChart(canvasId, labels, data, colors))) return;
  destroyChart(canvasId);
  const ctx = document.getElementById(canvasId);
  if (!ctx) return;
  const t = chartTheme();
  const total = data.reduce((s, v) => s + v, 0) || 1;
  state.charts[canvasId] = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels,
      datasets: [{
        data, backgroundColor: colors,
        borderWidth: 2, borderColor: t.cardBg,
        hoverBorderColor: t.cardBg, hoverOffset: 6,
        borderRadius: 4, spacing: 2,
      }],
    },
    options: {
      cutout: "62%",
      maintainAspectRatio: false,
      layout: { padding: 8 },
      plugins: {
        // A right-side legend (rather than bottom) uses the card's spare
        // horizontal width instead of stacking under the chart, which lets
        // the doughnut itself grow to the full height of the card instead
        // of shrinking to leave room for a wrapped multi-row legend.
        legend: {
          position: "right", align: "center",
          labels: { usePointStyle: true, pointStyle: "circle", boxWidth: 7, boxHeight: 7, padding: 12, font: { size: 10.35 }, color: t.text },
        },
        tooltip: chartTooltip(t, { callbacks: { label: (ctx2) => ` ${ctx2.label}: ${ctx2.raw} (${Math.round((ctx2.raw / total) * 100)}%)` } }),
        centerText: { enabled: true, main: String(total), sub: "Total", color: t.bar, subColor: t.text },
      },
      animation: { duration: 500 },
    },
  });
}

// Shared settings for the two dashboard donuts ("Applications by Status" and
// "Applications by Job Type") so they render identically: same fixed legend
// band (keeps both the same size and vertically aligned) and the same
// slightly larger legend text.
const DONUT_OPTS = { legendWidthPx: 158, fontSize: 12 };

function multiDonutChart(canvasId, labels, data, colors, opts = {}) {
  if (!chartLibReady(() => multiDonutChart(canvasId, labels, data, colors, opts))) return;
  destroyChart(canvasId);
  const ctx = document.getElementById(canvasId);
  if (!ctx) return;
  const t = chartTheme();
  const total = data.reduce((s, v) => s + v, 0) || 1;
  // A side legend (rather than bottom) avoids an awkward single orphaned
  // item wrapping onto its own row when there are 5–6 categories, and reads
  // as a more deliberate "breakdown list" layout for a status donut.
  // A caller that reserves a fixed legend width always wants the side
  // layout (that's the whole point of the fixed band), so honour it even
  // for short category lists — keeps a paired set of donuts consistent.
  const useSideLegend = labels.length > 4 || !!opts.legendWidthPx;
  // opts (all optional):
  //   cutout        inner-hole size (default "68%")
  //   fontSize      legend text size (default 10.35)
  //   legendWidthPx reserve a FIXED-width band for the side legend. Two
  //                 donuts in the same-width cards then get an identical
  //                 plot area regardless of how long their labels are, so
  //                 Chart.js computes the same outer radius AND centres them
  //                 at the same x — i.e. they match in size and line up
  //                 vertically when stacked. Without this the donut shrinks
  //                 and drifts left whenever the labels happen to be longer.
  const cutout = opts.cutout ?? "68%";
  const fontSize = opts.fontSize ?? 10.35;
  const fixedLegendPlugin = (useSideLegend && opts.legendWidthPx) ? [{
    id: `fixedLegendWidth_${canvasId}`,
    afterInit(chart) {
      if (chart.legend) chart.legend.afterFit = function () { this.width = opts.legendWidthPx; };
    },
  }] : [];
  state.charts[canvasId] = new Chart(ctx, {
    type: "doughnut",
    plugins: fixedLegendPlugin,
    data: {
      labels,
      datasets: [{
        data, backgroundColor: colors,
        borderWidth: 2, borderColor: t.cardBg,
        hoverBorderColor: t.cardBg, hoverOffset: 6,
        borderRadius: 4, spacing: 2,
      }],
    },
    options: {
      cutout,
      maintainAspectRatio: false,
      layout: { padding: 8 },
      plugins: {
        legend: {
          position: useSideLegend ? "right" : "bottom",
          align: useSideLegend ? "center" : "center",
          labels: { usePointStyle: true, pointStyle: "circle", boxWidth: 7, boxHeight: 7, padding: useSideLegend ? 10 : 14, font: { size: fontSize }, color: t.text },
        },
        tooltip: chartTooltip(t, { callbacks: { label: (ctx2) => ` ${ctx2.label}: ${ctx2.raw} (${Math.round((ctx2.raw / total) * 100)}%)` } }),
        centerText: { enabled: true, main: String(total), sub: "Total", color: t.bar, subColor: t.text },
      },
      animation: { duration: 500 },
    },
  });
}

// Multi-series line/area chart — used for "Applications & Interviews over
// time" on the Jobs page. datasets: [{ label, data, color, fill?, dash? }].
// Only fill:true series get a translucent area — stacking multiple filled
// areas of similar hue makes them blend into one indistinguishable blob, so
// callers should fill at most one (usually the primary/largest series) and
// leave the rest as plain (optionally dashed) lines for clear separation.
function multiLineChart(canvasId, labels, datasets) {
  if (!chartLibReady(() => multiLineChart(canvasId, labels, datasets))) return;
  destroyChart(canvasId);
  const ctx = document.getElementById(canvasId);
  if (!ctx) return;
  const t = chartTheme();
  state.charts[canvasId] = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: datasets.map(ds => ({
        label: ds.label,
        data: ds.data,
        borderColor: ds.color,
        backgroundColor: ds.fill ? ds.color + "26" : "transparent", // ~15% alpha fill, only when requested
        fill: !!ds.fill,
        borderDash: ds.dash || undefined,
        tension: 0.4,
        pointRadius: 3,
        pointBackgroundColor: ds.color,
        pointBorderColor: "#fff",
        pointBorderWidth: 1.5,
        borderWidth: 2.5,
      })),
    },
    options: {
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { position: "bottom", labels: { boxWidth: 10, padding: 14, font: { size: 9.9 }, color: t.text } },
      },
      scales: {
        y: { beginAtZero: true, grid: { color: t.grid }, ticks: { color: t.text, precision: 0 } },
        x: { grid: { display: false }, ticks: { color: t.text } },
      },
      animation: { duration: 600 },
    },
  });
}

// Groups a month's day-by-day series (summary.days) into calendar weeks
// (Mon-Sun) so "Which Days You're Strongest On" can show one grouped-bar
// series per week instead of a single month-wide average per weekday.
// Weeks that haven't happened yet come back as a row of all-null values —
// Chart.js still reserves their slot on the x-axis/legend, it just draws
// no bars for them, which is exactly "axis only" for weeks with no data.
// `pctOf`/`totalOf` let the caller pick which slice of a day to plot (habits,
// tasks, or the two combined) without this helper knowing about scopes.
function weeksByWeekday(days, pctOf = d => d.percent, totalOf = d => d.total) {
  const weeks = [];
  let currentStart = null;
  let current = null;
  days.forEach(d => {
    const date = fromISO(d.date);
    const dow = (date.getDay() + 6) % 7; // Monday = 0
    const weekStartIso = toISO(addDays(date, -dow));
    if (weekStartIso !== currentStart) {
      currentStart = weekStartIso;
      current = { weekStart: weekStartIso, values: Array(7).fill(null) };
      weeks.push(current);
    }
    current.values[dow] = (!d.is_future && totalOf(d) > 0) ? pctOf(d) : null;
  });
  return weeks;
}

function groupedBarChart(canvasId, labels, datasets) {
  if (!chartLibReady(() => groupedBarChart(canvasId, labels, datasets))) return;
  destroyChart(canvasId);
  const ctx = document.getElementById(canvasId);
  if (!ctx) return;
  const t = chartTheme();
  state.charts[canvasId] = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: datasets.map(ds => ({
        label: ds.label,
        data: ds.data,
        backgroundColor: ds.color,
        borderRadius: 4,
        maxBarThickness: 22,
      })),
    },
    options: {
      maintainAspectRatio: false,
      plugins: {
        legend: { position: "bottom", labels: { boxWidth: 10, padding: 14, font: { size: 9.9 }, color: t.text } },
      },
      scales: {
        y: { beginAtZero: true, grid: { color: t.grid }, ticks: { color: t.text, precision: 0 } },
        x: { grid: { display: false }, ticks: { color: t.text } },
      },
      animation: { duration: 500 },
    },
  });
}

// Colorful HTML funnel — descending-width gradient bars with conversion %
// labels between stages, e.g. Saved -> Applied -> Interview -> Offer.
function renderJobFunnel(funnel) {
  const funnelColors = [chartTheme().accent, "#7C5CFC", "#E0A93E", "#1FAE6B"];
  const maxCount = Math.max(1, funnel[0]?.count || 0);
  return `
    <div class="job-funnel">
      ${funnel.map((stage, i) => {
        const widthPct = Math.max(8, Math.round((stage.count / maxCount) * 100));
        const prev = funnel[i - 1];
        const convPct = prev && prev.count > 0 ? Math.round((stage.count / prev.count) * 100) : null;
        return `
          <div class="job-funnel-row">
            <div class="job-funnel-label">
              <span class="job-funnel-stage-name">${stage.stage}</span>
              <span class="job-funnel-stage-count">${stage.count}</span>
            </div>
            <div class="job-funnel-track">
              <div class="job-funnel-bar" style="width:${widthPct}%; background:${funnelColors[i % funnelColors.length]};"></div>
            </div>
            ${convPct != null ? `<div class="job-funnel-conv">${convPct}%</div>` : `<div class="job-funnel-conv"></div>`}
          </div>
        `;
      }).join("")}
    </div>
  `;
}

// Small inline sparkline SVG for KPI cards — no axes, just a trend line.
function sparklineSVG(data, color) {
  const clean = (data && data.length >= 2) ? data : [0, 0];
  const w = 64, h = 20;
  const max = Math.max(...clean), min = Math.min(...clean);
  const range = (max - min) || 1;
  const pts = clean.map((v, i) => `${(i / (clean.length - 1) * w).toFixed(1)},${(h - ((v - min) / range) * h).toFixed(1)}`).join(" ");
  return `<svg width="${w}" height="${h}" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.75"/></svg>`;
}

function kpiCardV2(icon, label, value, delta, trend, sparkData, accent) {
  const color = accent || chartTheme().accent;
  const deltaClass = trend === "up" ? "text-emerald-600" : trend === "down" ? "text-red-500" : "text-gray-400";
  const deltaArrow = trend === "up" ? "↑" : trend === "down" ? "↓" : "→";
  return `<div class="card p-4 kpi-card-v2">
    <div class="flex items-center justify-between mb-2">
      <div class="kpi-icon-badge" style="background:${color}1F; color:${color};">${icon}</div>
      ${sparklineSVG(sparkData, color)}
    </div>
    <p class="text-[9.5px] font-semibold text-gray-500 uppercase tracking-wide">${label}</p>
    <p class="text-2xl font-extrabold mt-0.5">${value}</p>
    <p class="text-[10px] mt-1 ${deltaClass}">${deltaArrow} ${delta}</p>
  </div>`;
}

function scatterChart(canvasId, points, xLabel, yLabel) {
  if (!chartLibReady(() => scatterChart(canvasId, points, xLabel, yLabel))) return;
  destroyChart(canvasId);
  const ctx = document.getElementById(canvasId);
  if (!ctx) return;
  const t = chartTheme();
  state.charts[canvasId] = new Chart(ctx, {
    type: "scatter",
    data: { datasets: [{ data: points, backgroundColor: t.accent + "CC", pointRadius: 5, pointHoverRadius: 7 }] },
    options: {
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { title: { display: true, text: xLabel, color: t.text, font: { size: 9.9 } }, ticks: { color: t.text }, grid: { color: t.grid } },
        y: { title: { display: true, text: yLabel, color: t.text, font: { size: 9.9 } }, ticks: { color: t.text }, grid: { color: t.grid } },
      },
      animation: { duration: 500 },
    },
  });
}

// Company "treemap" — proportionally-sized flex boxes, two rows, biggest
// applicants first. Not a pixel-perfect treemap algorithm, but reads the
// same way at a glance and needs no extra charting library.
function renderCompanyTreemap(jobs) {
  const counts = {};
  jobs.forEach(j => { if (j.company_name) counts[j.company_name] = (counts[j.company_name] || 0) + 1; });
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return `<p class="text-sm text-gray-400 text-center py-12">No applications yet</p>`;

  const top = entries.slice(0, 6).map(([name, v]) => ({ name, v }));
  const otherCount = entries.slice(6).reduce((s, [, c]) => s + c, 0);
  if (otherCount > 0) top.push({ name: `Other (${entries.length - 6})`, v: otherCount });

  const palette = [chartTheme().accent, "#7C5CFC", "#FF6A3D", "#1FAE6B", "#E0A93E", "#0EA5E9", "#93968E"];
  const topRow = top.slice(0, 3), botRow = top.slice(3);
  const rowHtml = (row, basis) => `
    <div style="display:flex; gap:4px; flex:${basis};">
      ${row.map(b => `
        <div class="treemap-box" style="flex:${b.v}; background:${palette[top.indexOf(b) % palette.length]};">
          <span style="font-size:10.5px; color:#fff; font-weight:600; line-height:1.3;">${esc(b.name)}<br><span style="font-weight:400; opacity:0.85;">${b.v}</span></span>
        </div>
      `).join("")}
    </div>`;
  return `<div style="display:flex; flex-direction:column; gap:4px; height:150px;">${rowHtml(topRow, 2)}${botRow.length ? rowHtml(botRow, 1) : ""}</div>`;
}

function opacityForPercent(p) {
  if (!p || p <= 0) return 0;
  if (p < 30) return 0.22;
  if (p < 55) return 0.45;
  if (p < 80) return 0.7;
  return 1;
}

// Calendar-style habit heatmap — each column is one whole week (Mon top,
// Sun bottom), each cell filled and tinted by that day's completion percent.
function renderHabitConsistencyGrid(dayList) {
  const real = (dayList || []).filter(d => !d.is_future);
  if (!real.length) return `<p class="text-sm text-gray-400 text-center py-12">No habit data yet — add a habit to start tracking consistency.</p>`;

  const accent = chartTheme().accent;
  const [r, g, b] = hexToRgb(accent);
  const isDark = document.documentElement.getAttribute("data-theme") === "dark";
  const emptyCellColor = isDark ? "rgba(255,255,255,0.07)" : "rgba(23,26,31,0.06)";
  const CELL = 24, GAP = 5;
  const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  // group chronological days into week columns, Monday-first
  const weeks = [];
  let col = null;
  real.forEach(d => {
    const date = new Date(d.date + "T00:00:00");
    const dow = (date.getDay() + 6) % 7; // Mon=0 .. Sun=6
    if (!col || dow === 0) { col = new Array(7).fill(null); weeks.push(col); }
    col[dow] = d;
  });

  const monthLabels = [];
  let lastMonth = null;
  weeks.forEach((wk, i) => {
    const first = wk.find(Boolean);
    if (!first) return;
    const m = new Date(first.date + "T00:00:00").toLocaleDateString(undefined, { month: "short" });
    if (m !== lastMonth) { monthLabels.push({ i, label: m }); lastMonth = m; }
  });

  const gridWidth = weeks.length * (CELL + GAP);
  return `
    <div style="display:flex; gap:8px; overflow-x:auto; padding-bottom:2px;">
      <div style="display:flex; flex-direction:column; gap:${GAP}px; padding-top:18px; font-size:9px; color:var(--lp-ink-faint,#93968E); flex-shrink:0;">
        ${DAY_LABELS.map(l => `<div style="height:${CELL}px; line-height:${CELL}px;">${l}</div>`).join("")}
      </div>
      <div>
        <div style="display:grid; grid-template-columns:repeat(${weeks.length},${CELL}px); gap:0 ${GAP}px; margin-bottom:4px; font-size:9px; color:var(--lp-ink-faint,#93968E); min-width:${gridWidth}px;">
          ${weeks.map((_, i) => { const found = monthLabels.find(m => m.i === i); return `<div>${found ? found.label : ""}</div>`; }).join("")}
        </div>
        <div style="display:grid; grid-template-columns:repeat(${weeks.length},${CELL}px); grid-auto-flow:column; grid-template-rows:repeat(7,${CELL}px); gap:${GAP}px; min-width:${gridWidth}px;">
          ${weeks.flat().map(d => {
            if (!d) return `<div style="width:${CELL}px; height:${CELL}px;"></div>`;
            const o = opacityForPercent(d.percent);
            return `<div title="${d.date}: ${d.percent}%" style="width:${CELL}px; height:${CELL}px; border-radius:4px; background:${o === 0 ? emptyCellColor : `rgba(${r},${g},${b},${o})`};"></div>`;
          }).join("")}
        </div>
      </div>
    </div>
    <div class="flex items-center gap-2 mt-3 text-[9px] text-gray-400">
      <span>Less</span>
      ${[0, 0.22, 0.45, 0.7, 1].map(o => `<div style="width:12px; height:12px; border-radius:3px; background:${o === 0 ? emptyCellColor : `rgba(${r},${g},${b},${o})`};"></div>`).join("")}
      <span>More</span>
    </div>
  `;
}

// ---- job type classification (Data Analyst / Data Engineer / etc.) ----
function classifyJobType(title) {
  const t = (title || "").toLowerCase();
  if (t.includes("data engineer")) return "Data Engineer";
  if (t.includes("data scientist")) return "Data Scientist";
  if (t.includes("data analyst")) return "Data Analyst";
  if (t.includes("data architect")) return "Data Architect";
  if (t.includes("machine learning") || t.includes("ml engineer")) return "ML Engineer";
  if (t.includes("business intelligence") || /\bbi\b/.test(t)) return "BI / Analytics";
  if (t.includes("devops") || t.includes("site reliability") || /\bsre\b/.test(t)) return "DevOps / SRE";
  if (t.includes("full stack") || t.includes("fullstack")) return "Full Stack Engineer";
  if (t.includes("backend") || t.includes("back-end") || t.includes("back end")) return "Backend Engineer";
  if (t.includes("frontend") || t.includes("front-end") || t.includes("front end")) return "Frontend Engineer";
  if (t.includes("product engineer")) return "Product Engineer";
  if (t.includes("software engineer") || t.includes("software developer")) return "Software Engineer";
  if (t.includes("analyst")) return "Analyst (Other)";
  if (t.includes("engineer")) return "Engineer (Other)";
  return "Other";
}

function jobTypeBreakdown(jobs) {
  const counts = {};
  jobs.forEach(j => { const k = classifyJobType(j.role_title); counts[k] = (counts[k] || 0) + 1; });
  return Object.entries(counts).sort((a, b) => b[1] - a[1]);
}

// ---- location -> lat/lng matching for the "Applications by Location" map ----
function aliasMatches(s, alias) {
  if (alias.length <= 3) return new RegExp(`\\b${alias}\\b`).test(s);
  return s.includes(alias);
}
const GEO_LOCATIONS = [
  { m: ["london"], lat: 51.5074, lng: -0.1278, name: "London" },
  { m: ["newcastle", "gateshead", "felling"], lat: 54.9783, lng: -1.6178, name: "Newcastle upon Tyne" },
  { m: ["manchester"], lat: 53.4808, lng: -2.2426, name: "Manchester" },
  { m: ["birmingham"], lat: 52.4862, lng: -1.8904, name: "Birmingham" },
  { m: ["leeds"], lat: 53.8008, lng: -1.5491, name: "Leeds" },
  { m: ["glasgow"], lat: 55.8642, lng: -4.2518, name: "Glasgow" },
  { m: ["edinburgh"], lat: 55.9533, lng: -3.1883, name: "Edinburgh" },
  { m: ["bristol"], lat: 51.4545, lng: -2.5879, name: "Bristol" },
  { m: ["liverpool"], lat: 53.4084, lng: -2.9916, name: "Liverpool" },
  { m: ["sheffield"], lat: 53.3811, lng: -1.4701, name: "Sheffield" },
  { m: ["cardiff"], lat: 51.4816, lng: -3.1791, name: "Cardiff" },
  { m: ["belfast"], lat: 54.5973, lng: -5.9301, name: "Belfast" },
  { m: ["durham"], lat: 54.7761, lng: -1.5733, name: "Durham" },
  { m: ["nottingham"], lat: 52.9548, lng: -1.1581, name: "Nottingham" },
  { m: ["reading"], lat: 51.4543, lng: -0.9781, name: "Reading" },
  { m: ["cambridge"], lat: 52.2053, lng: 0.1218, name: "Cambridge" },
  { m: ["oxford"], lat: 51.7520, lng: -1.2577, name: "Oxford" },
  { m: ["bangalore", "bengaluru"], lat: 12.9716, lng: 77.5946, name: "Bengaluru" },
  { m: ["mumbai"], lat: 19.0760, lng: 72.8777, name: "Mumbai" },
  { m: ["delhi"], lat: 28.6139, lng: 77.2090, name: "Delhi" },
  { m: ["hyderabad"], lat: 17.3850, lng: 78.4867, name: "Hyderabad" },
  { m: ["chennai"], lat: 13.0827, lng: 80.2707, name: "Chennai" },
  { m: ["pune"], lat: 18.5204, lng: 73.8567, name: "Pune" },
  { m: ["kolkata"], lat: 22.5726, lng: 88.3639, name: "Kolkata" },
  { m: ["new york"], lat: 40.7128, lng: -74.0060, name: "New York" },
  { m: ["san francisco"], lat: 37.7749, lng: -122.4194, name: "San Francisco" },
  { m: ["seattle"], lat: 47.6062, lng: -122.3321, name: "Seattle" },
  { m: ["austin"], lat: 30.2672, lng: -97.7431, name: "Austin" },
  { m: ["chicago"], lat: 41.8781, lng: -87.6298, name: "Chicago" },
  { m: ["boston"], lat: 42.3601, lng: -71.0589, name: "Boston" },
  { m: ["dublin"], lat: 53.3498, lng: -6.2603, name: "Dublin" },
  { m: ["berlin"], lat: 52.5200, lng: 13.4050, name: "Berlin" },
  { m: ["amsterdam"], lat: 52.3676, lng: 4.9041, name: "Amsterdam" },
  { m: ["paris"], lat: 48.8566, lng: 2.3522, name: "Paris" },
  { m: ["singapore"], lat: 1.3521, lng: 103.8198, name: "Singapore" },
  { m: ["dubai"], lat: 25.2048, lng: 55.2708, name: "Dubai" },
  { m: ["toronto"], lat: 43.6532, lng: -79.3832, name: "Toronto" },
  { m: ["sydney"], lat: -33.8688, lng: 151.2093, name: "Sydney" },
  { m: ["united kingdom", "uk"], lat: 54.0, lng: -2.5, name: "United Kingdom" },
  { m: ["india"], lat: 22.0, lng: 79.0, name: "India" },
  { m: ["united states", "usa"], lat: 39.8, lng: -98.5, name: "United States" },
  { m: ["germany"], lat: 51.1657, lng: 10.4515, name: "Germany" },
  { m: ["ireland"], lat: 53.1424, lng: -7.6921, name: "Ireland" },
  { m: ["netherlands"], lat: 52.1326, lng: 5.2913, name: "Netherlands" },
  { m: ["canada"], lat: 56.1304, lng: -106.3468, name: "Canada" },
  { m: ["australia"], lat: -25.2744, lng: 133.7751, name: "Australia" },
  { m: ["uae"], lat: 23.4241, lng: 53.8478, name: "United Arab Emirates" },
];
function matchGeoLocation(locStr) {
  if (!locStr) return null;
  const s = locStr.toLowerCase();
  if (s.includes("remote")) return { remote: true };
  for (const entry of GEO_LOCATIONS) {
    if (entry.m.some(alias => aliasMatches(s, alias))) return entry;
  }
  return null;
}
function computeMapData(jobs) {
  const byName = new Map();
  let remoteCount = 0;
  jobs.forEach(j => {
    const match = matchGeoLocation(j.location);
    if (!match) return;
    if (match.remote) { remoteCount++; return; }
    if (!byName.has(match.name)) byName.set(match.name, { ...match, count: 0 });
    byName.get(match.name).count++;
  });
  return { points: Array.from(byName.values()), remoteCount };
}
// Auto-fit bounding box: zooms to the smallest sensible area that contains
// every pinned application location — a single city/country if that's all
// there is, a whole continent if applications span one, or the whole world
// if they're spread globally. Padding scales with the spread of the points
// so a single city still shows enough surrounding country for context
// without zooming in on a single point, and world-spanning data clamps to
// full world bounds instead of exploding past them.
const WORLD_BOUNDS = { lng: [-179, 179], lat: [-58, 83] };
function computeAutoRegion(points) {
  if (!points.length) return { name: "World", ...WORLD_BOUNDS };
  const lngs = points.map(p => p.lng), lats = points.map(p => p.lat);
  let minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
  let minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const lngSpan = maxLng - minLng, latSpan = maxLat - minLat;
  const padLng = Math.max(7, lngSpan * 0.35);
  const padLat = Math.max(6, latSpan * 0.35);
  minLng = Math.max(WORLD_BOUNDS.lng[0], minLng - padLng);
  maxLng = Math.min(WORLD_BOUNDS.lng[1], maxLng + padLng);
  minLat = Math.max(WORLD_BOUNDS.lat[0], minLat - padLat);
  maxLat = Math.min(WORLD_BOUNDS.lat[1], maxLat + padLat);
  const finalLngSpan = maxLng - minLng;
  let name;
  if (finalLngSpan >= (WORLD_BOUNDS.lng[1] - WORLD_BOUNDS.lng[0]) - 4) name = "World";
  else if (finalLngSpan > 90) name = "Multiple continents";
  else if (finalLngSpan > 30) name = "Multiple regions";
  else if (points.length === 1) name = points[0].name;
  else name = "Selected area";
  return { name, lng: [minLng, maxLng], lat: [minLat, maxLat] };
}
let _worldAtlasPromise = null;
function loadWorldAtlas() {
  if (!_worldAtlasPromise) {
    _worldAtlasPromise = fetch("https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json").then(r => r.json());
  }
  return _worldAtlasPromise;
}
// Applications-by-location map: real coastlines via d3 + world-atlas,
// auto-zoomed to the smallest area that contains every pinned location
// (just a city/country if that's everything, a continent if it spans one,
// the whole world if it's spread globally), with manual zoom in/out/reset
// controls. Uses a fixed logical canvas size (scaled to 100% width via the
// SVG viewBox) rather than the container's live clientWidth, so pin/stroke
// sizing can't be thrown off by reading the width before layout settles.
// Real "Quick Insights" for the right-hand dashboard panel — derived from
// actual job stats and application dates, not canned text.
function quickJobInsights(jobStats, allJobs) {
  const out = [];
  // interview rate
  out.push({
    icon: "📈", tone: "blue",
    title: `Interview rate is ${jobStats.interview_rate}%`,
    body: jobStats.interview_rate >= 20 ? "Strong — keep the momentum going." : "Keep applying to improve your chances.",
  });
  // most active weekday by application date
  const dow = [0, 0, 0, 0, 0, 0, 0];
  allJobs.forEach(j => { if (j.date_applied) dow[fromISO(j.date_applied).getDay()]++; });
  const maxDow = Math.max(...dow);
  if (maxDow > 0) {
    const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const bestDay = dayNames[dow.indexOf(maxDow)];
    out.push({ icon: "🏆", tone: "green", title: `You're most active on ${bestDay}s`, body: "Great! Consistency is key." });
  }
  // follow-ups due this week
  const dueCount = jobStats.upcoming_follow_ups.length;
  out.push({
    icon: "⏰", tone: "amber",
    title: dueCount ? `${dueCount} follow-up${dueCount === 1 ? "" : "s"} due this week` : "No follow-ups due this week",
    body: dueCount ? "Stay on top of your opportunities." : "You're all caught up 🎉",
  });
  return out;
}

// Next upcoming study session: the soonest not-yet-completed block from now
// forward (today's later sessions, then future days).
function nextStudySession(allBlocks) {
  const now = new Date();
  const todayISO = toISO(now);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const upcoming = allBlocks
    .filter(b => !b.completed && b.date >= todayISO)
    .filter(b => b.date > todayISO || timeToMinutes(b.end_time) >= nowMin)
    .sort((a, b) => (a.date + a.start_time).localeCompare(b.date + b.start_time));
  return upcoming[0] || null;
}

// Real "AI Insights" for the Habits/Study right panel — all derived from
// actual habit + study data, never canned.
function studyAiInsights(month, allStudyBlocks, weekStudyBlocks) {
  const out = [];
  // consistency / streak
  if (month.current_streak >= 3) {
    out.push({ icon: "📈", tone: "green", title: "Great Consistency!", body: `You've maintained a ${month.current_streak}-day habit streak. Keep it up!` });
  } else if (month.current_streak > 0) {
    out.push({ icon: "📈", tone: "green", title: "Streak building", body: `You're on a ${month.current_streak}-day streak — a few more days locks in the habit.` });
  } else {
    out.push({ icon: "🎯", tone: "green", title: "Start a streak", body: "Complete a habit today to kick off a new streak." });
  }
  // focus opportunity: a weekday this week where actual < planned
  const actualLog = getStudyActualLog();
  const weekStart = weekStartOf(new Date());
  let opp = null;
  for (let i = 0; i < 7; i++) {
    const iso = toISO(addDays(weekStart, i));
    if (iso > toISO(new Date())) continue;
    const dayBlocks = weekStudyBlocks.filter(b => b.date === iso);
    if (!dayBlocks.length) continue;
    const planned = dayBlocks.reduce((s, b) => s + Math.max(0, timeToMinutes(b.end_time) - timeToMinutes(b.start_time)), 0);
    const actual = dayBlocks.reduce((s, b) => s + (actualLog[b.id] || 0), 0);
    if (planned > 0 && actual < planned * 0.8) { opp = { iso, planned, actual }; break; }
  }
  if (opp) {
    out.push({ icon: "⏰", tone: "amber", title: "Focus Opportunity", body: `Your study time on ${fromISO(opp.iso).toLocaleDateString(undefined, { weekday: "long" })} was lower than planned.` });
  }
  // subjects balance
  const subjects = new Map();
  allStudyBlocks.forEach(b => {
    if (!subjects.has(b.subject)) subjects.set(b.subject, { total: 0, done: 0 });
    const s = subjects.get(b.subject); s.total++; if (b.completed) s.done++;
  });
  const totalSessions = allStudyBlocks.length;
  const doneSessions = allStudyBlocks.filter(b => b.completed).length;
  if (subjects.size >= 2) {
    out.push({ icon: "🧩", tone: "purple", title: "Subjects Balance", body: `You've completed ${doneSessions}/${totalSessions} total sessions. Try to balance your subjects.` });
  }
  return out.slice(0, 3);
}

async function renderJobsWorldMap(containerId, jobs, opts = {}) {
  const el = document.getElementById(containerId);
  if (!el) return;
  const { points, remoteCount } = computeMapData(jobs);
  if (!points.length) {
    el.innerHTML = `<p class="text-sm text-gray-400 text-center py-14">No mappable locations yet${remoteCount ? ` (${remoteCount} remote application${remoteCount === 1 ? "" : "s"})` : ""}.</p>`;
    return;
  }
  const region = computeAutoRegion(points);
  let topo;
  // d3 and topojson are fetched here, at the one place in the application that
  // uses them, alongside the atlas they draw. Both downloads overlap.
  try { [topo] = await Promise.all([loadWorldAtlas(), ensureGeoLibs()]); }
  catch (e) { el.innerHTML = `<p class="text-sm text-gray-400 text-center py-14">Map unavailable — check your connection.</p>`; return; }
  if (!document.getElementById(containerId)) return; // navigated away while fetching

  const w = 800, h = 440; // fixed logical size — CSS scales the SVG to the card's actual width
  const isDark = document.documentElement.getAttribute("data-theme") === "dark";
  const countryFill = isDark ? "rgba(255,255,255,0.08)" : "#EDEFF3";
  const countryStroke = isDark ? "rgba(255,255,255,0.14)" : "#DDE1E8";
  const dotColor = "#3D5AFE";

  const countries = topojson.feature(topo, topo.objects.countries);
  const bboxFeature = {
    type: "Feature",
    geometry: { type: "Polygon", coordinates: [[
      [region.lng[0], region.lat[0]], [region.lng[1], region.lat[0]],
      [region.lng[1], region.lat[1]], [region.lng[0], region.lat[1]],
      [region.lng[0], region.lat[0]],
    ]] },
  };
  const projection = d3.geoMercator().fitExtent([[20, 20], [w - 20, h - 20]], bboxFeature);
  const path = d3.geoPath(projection);

  const totalApps = points.reduce((s, p) => s + p.count, 0);
  const countryPaths = countries.features.map(f => `<path d="${path(f)}" fill="${countryFill}" stroke="${countryStroke}" stroke-width="0.6"/>`).join("");
  // Plain small solid dots at each applied location — no size scaling, no glow halo.
  const pins = points.map(p => {
    const xy = projection([p.lng, p.lat]);
    if (!xy) return "";
    const [x, y] = xy;
    return `<circle cx="${x}" cy="${y}" r="4" fill="${dotColor}" stroke="#fff" stroke-width="1.2"><title>${p.name}: ${p.count} application${p.count === 1 ? "" : "s"}</title></circle>`;
  }).join("");

  // optional location list beside the map (Bengaluru 4, Remote 2, …)
  const legendItems = [...points].sort((a, b) => b.count - a.count);
  const legendHTML = opts.showList ? `
    <div class="map-legend">
      ${legendItems.map(p => `
        <div class="map-legend-row">
          <span class="map-legend-dot" style="background:${dotColor}"></span>
          <span class="map-legend-name">${esc(p.name)}</span>
          <span class="map-legend-count">${p.count}</span>
        </div>`).join("")}
      ${remoteCount ? `
        <div class="map-legend-row">
          <span class="map-legend-dot" style="background:#93968E"></span>
          <span class="map-legend-name">Remote</span>
          <span class="map-legend-count">${remoteCount}</span>
        </div>` : ""}
    </div>` : "";

  el.innerHTML = `
    <div class="map-wrap ${opts.showList ? "map-wrap--with-list" : ""}">
      <div style="position:relative; flex:1; min-width:0;">
        <div style="position:absolute; top:0; right:0; display:flex; gap:4px; z-index:2;">
          <button type="button" class="btn btn-ghost" data-zoom="in" style="padding:2px 8px; font-size:11.5px;">+</button>
          <button type="button" class="btn btn-ghost" data-zoom="out" style="padding:2px 8px; font-size:11.5px;">−</button>
          <button type="button" class="btn btn-ghost" data-zoom="reset" style="padding:2px 8px; font-size:10px;">Reset</button>
        </div>
        <svg id="${containerId}-svg" viewBox="0 0 ${w} ${h}" style="width:100%; height:250px; overflow:hidden; display:block; border-radius:8px; background:${isDark ? "rgba(255,255,255,0.03)" : "#FBFAF6"};" aria-hidden="true">
          <g id="${containerId}-g">${countryPaths}${pins}</g>
        </svg>
      </div>
      ${legendHTML}
    </div>
  `;

  let scale = 1;
  const g = document.getElementById(`${containerId}-g`);
  const applyZoom = () => { g.setAttribute("transform", `translate(${w / 2},${h / 2}) scale(${scale}) translate(${-w / 2},${-h / 2})`); };
  el.querySelectorAll("[data-zoom]").forEach(btn => {
    btn.addEventListener("click", () => {
      if (btn.dataset.zoom === "in") scale = Math.min(6, scale * 1.4);
      else if (btn.dataset.zoom === "out") scale = Math.max(1, scale / 1.4);
      else scale = 1;
      applyZoom();
    });
  });
}


function rateBadgeClass(pct, goodAt, midAt) {
  if (pct >= goodAt) return "good";
  if (pct >= midAt) return "mid";
  return "low";
}


// ============================================================================
// WELCOME PAGE
// ----------------------------------------------------------------------------
// The landing page on every sign-in. Three jobs: say what the app is, show
// what to do first, and put the project's real documentation one click away.
//
// It fetches nothing on render. That's deliberate — this is the first screen
// of the session, often the first screen a new account ever sees, and a
// landing page that can show a spinner or an error is a landing page that can
// make a working install look broken. The docs panel and the tour both load
// lazily, only when asked for.
// ============================================================================

const WELCOME_FEATURES = [
  { icon: "✅", tint: "green", title: "Track Everything",
    sub: "Habits, tasks, study goals, and job applications.", page: "tracker" },
  { icon: "📄", tint: "purple", title: "Build Your Resume",
    sub: "Create and manage professional resumes.", page: "resumes" },
  { icon: "🛡️", tint: "green", title: "Beat the ATS",
    sub: "Check your resume's ATS score and improve.", page: "resumes" },
  { icon: "✉️", tint: "ember", title: "Tailored Cover Letters",
    sub: "Generate personalized cover letters in seconds.", page: "jobs" },
  { icon: "🤖", tint: "purple", title: "AI Assistant",
    sub: "Get local AI help anytime, right inside the app.", action: "chat" },
];

const WELCOME_STEPS = [
  { n: 1, icon: "👤", tint: "blue", title: "Complete your profile",
    sub: "Add your details to get better personalized suggestions.", page: "profile" },
  { n: 2, icon: "✓", tint: "green", title: "Add your first habit or task",
    sub: "Start small and build momentum every day.", page: "tracker" },
  { n: 3, icon: "📄", tint: "purple", title: "Build your resume",
    sub: "Create a strong resume that gets you noticed.", page: "resumes" },
  { n: 4, icon: "💼", tint: "ember", title: "Track your job applications",
    sub: "Stay organized and never miss a follow-up.", page: "jobs" },
];

// Each link opens the README in the docs panel, scrolled to a heading. The
// slug is resolved against the headings the backend actually parsed rather
// than hard-coded, so renaming a section in the README downgrades this to
// "opens at the top" instead of silently pointing at nothing.
const WELCOME_DOC_LINKS = [
  { icon: "📖", tint: "blue", title: "Configuration Guide (.env)",
    sub: "Everything about the .env configuration", doc: "readme", match: "configuration" },
  { icon: "▶️", tint: "purple", title: "Running the App",
    sub: "Docker and manual setup instructions", doc: "readme", match: "running" },
  { icon: "🛡️", tint: "ember", title: "Troubleshooting (Backend Connection)",
    sub: "Fix common connection and CORS issues", doc: "readme", match: "deploying" },
  { icon: "🤖", tint: "purple", title: "Local AI Assistant",
    sub: "Optional setup for the on-device model", doc: "ai-setup", match: "" },
];

function welcomeHeroArt() {
  return `<svg class="wel-art" viewBox="0 0 320 220" fill="none" aria-hidden="true">
    <ellipse cx="160" cy="196" rx="120" ry="12" fill="var(--lp-blue-soft)"/>
    <rect x="52" y="34" width="216" height="140" rx="10" fill="var(--lp-surface)" stroke="var(--lp-border-strong)" stroke-width="2"/>
    <rect x="62" y="44" width="94" height="120" rx="6" fill="var(--lp-surface-2)"/>
    <rect x="164" y="44" width="94" height="120" rx="6" fill="var(--lp-surface-2)"/>
    <polyline points="72,140 92,116 110,126 128,88 146,72" stroke="var(--lp-blue)" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="146" cy="72" r="5" fill="var(--lp-blue)"/>
    <rect x="72" y="54" width="42" height="6" rx="3" fill="var(--lp-border-strong)"/>
    ${[0, 1, 2, 3].map(i => `
      <rect x="174" y="${56 + i * 26}" width="13" height="13" rx="3.5" fill="${i < 3 ? "var(--lp-blue)" : "var(--lp-border-strong)"}"/>
      ${i < 3 ? `<path d="M177.5 ${62.5 + i * 26} l2.4 2.6 4.6 -5" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none"/>` : ""}
      <rect x="195" y="${59 + i * 26}" width="${52 - i * 6}" height="7" rx="3.5" fill="var(--lp-border-strong)"/>`).join("")}
    <path d="M40 174 h240 l-14 16 H54 Z" fill="var(--lp-border-strong)"/>
    <rect x="284" y="120" width="26" height="34" rx="4" fill="var(--lp-purple-soft)" stroke="var(--lp-purple)" stroke-width="2"/>
    <path d="M290 120 v-8 M297 120 v-12 M304 120 v-6" stroke="var(--lp-purple)" stroke-width="2" stroke-linecap="round"/>
    <circle cx="26" cy="150" r="16" fill="var(--lp-green-soft)"/>
    <path d="M26 150 c0 -12 8 -18 8 -18 M26 150 c0 -10 -7 -14 -7 -14" stroke="var(--lp-green)" stroke-width="2.5" stroke-linecap="round"/>
    <path d="M16 150 h20 l-2.5 16 h-15 Z" fill="var(--lp-purple)" opacity=".35"/>
  </svg>`;
}

function welcomePathArt() {
  return `<svg class="wel-path-art" viewBox="0 0 200 150" fill="none" aria-hidden="true">
    <path d="M0 138 C34 138 44 108 72 104 C104 99 106 66 136 58 C160 52 168 28 200 24" stroke="var(--lp-blue-ring)" stroke-width="3" stroke-dasharray="7 7" stroke-linecap="round"/>
    <path d="M22 138 L62 62 L102 138 Z" fill="var(--lp-blue-soft)"/>
    <path d="M62 62 L82 100 L42 100 Z" fill="var(--lp-surface)"/>
    <path d="M96 138 L140 46 L184 138 Z" fill="var(--lp-blue-ring)" opacity=".55"/>
    <path d="M140 46 L162 92 L118 92 Z" fill="var(--lp-surface)"/>
    <path d="M140 46 v-30" stroke="var(--lp-ink-mute)" stroke-width="2.5" stroke-linecap="round"/>
    <path d="M141 17 l24 7 -24 8 Z" fill="var(--lp-blue)"/>
  </svg>`;
}

async function renderWelcome(content) {
  const user = auth.getUser();
  const first = user && user.name ? esc(user.name.trim().split(/\s+/)[0]) : "";

  content.innerHTML = `
    <div class="wel">
      <section class="wel-hero">
        <div class="wel-hero-copy">
          <p class="wel-hero-greeting"><span aria-hidden="true">👋</span> Welcome back${first ? `, ${first}` : ""}</p>
          <h1>Let's build your <em>momentum</em> today.</h1>
          <p class="wel-hero-body">Stay consistent with small actions that drive big results.</p>
          <div class="wel-hero-cta">
            <button class="btn btn-primary wel-btn" data-wel-go="dashboard">
              Open Dashboard <span aria-hidden="true">→</span>
            </button>
            <button class="btn wel-btn wel-btn-ghost" id="wel-tour">
              <span aria-hidden="true">▶</span> Quick Tour
            </button>
          </div>
        </div>
        <div class="wel-hero-art">${welcomeHeroArt()}</div>
      </section>

      <section class="wel-card">
        <h2 class="wel-h2">What would you like to do?</h2>
        <div class="wel-features">
          ${WELCOME_FEATURES.map(f => `
            <button class="wel-feature" ${f.page ? `data-wel-go="${f.page}"` : `data-wel-action="${f.action}"`}>
              <span class="wel-ico tint-${f.tint}" aria-hidden="true">${f.icon}</span>
              <span class="wel-feature-t">${esc(f.title)}</span>
              <span class="wel-feature-s">${esc(f.sub)}</span>
              <span class="wel-feature-arrow" aria-hidden="true">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17 17 7M9 7h8v8"/></svg>
              </span>
            </button>`).join("")}
        </div>
      </section>

      <div class="wel-two">
        <section class="wel-card">
          <h2 class="wel-h2">Getting started</h2>
          <ol class="wel-steps">
            ${WELCOME_STEPS.map((s, i) => `
              <li class="wel-step-row">
                <button class="wel-step" data-wel-go="${s.page}">
                  <span class="wel-step-num-col" aria-hidden="true">
                    <span class="wel-step-num">${s.n}</span>
                    ${i < WELCOME_STEPS.length - 1 ? `<span class="wel-step-line"></span>` : ""}
                  </span>
                  <span class="wel-step-body">
                    <span class="wel-step-t">${esc(s.title)}</span>
                    <span class="wel-step-s">${esc(s.sub)}</span>
                  </span>
                  <span class="wel-step-start">Start</span>
                </button>
              </li>`).join("")}
          </ol>
        </section>

        <section class="wel-card">
          <h2 class="wel-h2">Helpful resources</h2>
          <div class="wel-links">
            ${WELCOME_DOC_LINKS.map(l => `
              <button class="wel-link" data-wel-doc="${l.doc}" data-wel-match="${esc(l.match)}">
                <span class="wel-link-ico-sq tint-${l.tint}" aria-hidden="true">${l.icon}</span>
                <span class="wel-link-body">
                  <span class="wel-link-t">${esc(l.title)}</span>
                  <span class="wel-link-s">${esc(l.sub)}</span>
                </span>
                <span class="wel-link-ext" aria-hidden="true">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><path d="M15 3h6v6"/><path d="M10 14 21 3"/></svg>
                </span>
              </button>`).join("")}
          </div>
        </section>
      </div>
    </div>`;

  content.querySelectorAll("[data-wel-go]").forEach(el =>
    el.addEventListener("click", () => navigate(el.dataset.welGo)));
  // Calls openChatPanel() directly rather than synthesising a click on
  // #chat-fab, which is an id nothing in the document has ever had — the
  // optional chaining meant this tile silently did nothing instead of erroring.
  content.querySelectorAll("[data-wel-action='chat']").forEach(el =>
    el.addEventListener("click", () => openChatPanel()));
  content.querySelectorAll("[data-wel-doc]").forEach(el =>
    el.addEventListener("click", () => openDocsPanel(el.dataset.welDoc, el.dataset.welMatch)));
  document.getElementById("wel-tour")?.addEventListener("click", startTour);
}

// ---------------------------------------------------------------------------
// Docs panel — renders the project's own markdown
// ---------------------------------------------------------------------------
// Markdown is rendered here rather than pulling in a library: the input is a
// file from this repository, the subset used is small, and adding a
// dependency to the frontend would mean adding a build step to a project that
// deliberately has none.
//
// Everything is escaped before any markup is generated, so a code sample in
// the README containing a <script> tag renders as text.
function mdToHtml(md, headings) {
  const slugOf = (t) => t.toLowerCase().replace(/[`*_]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const inline = (s) => esc(s)
    .replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>")
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t, href) =>
      /^https?:\/\//i.test(href) ? `<a href="${href}" target="_blank" rel="noopener noreferrer">${t}</a>` : t);

  const out = [];
  const lines = String(md || "").split("\n");
  let i = 0, listOpen = null;
  const closeList = () => { if (listOpen) { out.push(`</${listOpen}>`); listOpen = null; } };

  while (i < lines.length) {
    const line = lines[i];

    if (line.trimStart().startsWith("```")) {
      closeList();
      const lang = line.trim().slice(3).trim();
      const body = [];
      i++;
      while (i < lines.length && !lines[i].trimStart().startsWith("```")) body.push(lines[i++]);
      i++;
      out.push(`<pre class="doc-pre"${lang ? ` data-lang="${esc(lang)}"` : ""}><code>${esc(body.join("\n"))}</code></pre>`);
      continue;
    }

    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      closeList();
      const text = h[2].replace(/#+\s*$/, "").trim();
      out.push(`<h${h[1].length} id="doc-${slugOf(text)}" class="doc-h doc-h${h[1].length}">${inline(text)}</h${h[1].length}>`);
      i++; continue;
    }

    if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const want = ordered ? "ol" : "ul";
      if (listOpen !== want) { closeList(); out.push(`<${want} class="doc-list">`); listOpen = want; }
      out.push(`<li>${inline(line.replace(/^\s*([-*+]|\d+\.)\s+/, ""))}</li>`);
      i++; continue;
    }

    if (/^\s*>\s?/.test(line)) {
      closeList();
      out.push(`<blockquote class="doc-quote">${inline(line.replace(/^\s*>\s?/, ""))}</blockquote>`);
      i++; continue;
    }

    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { closeList(); out.push(`<hr class="doc-hr"/>`); i++; continue; }

    if (!line.trim()) { closeList(); i++; continue; }

    closeList();
    const para = [];
    while (i < lines.length && lines[i].trim()
           && !/^(#{1,4})\s/.test(lines[i])
           && !/^\s*([-*+]|\d+\.)\s+/.test(lines[i])
           && !lines[i].trimStart().startsWith("```")) para.push(lines[i++]);
    out.push(`<p>${inline(para.join(" "))}</p>`);
  }
  closeList();
  void headings;
  return out.join("\n");
}

async function openDocsPanel(key, match) {
  let panel = document.getElementById("docs-panel");
  if (!panel) {
    panel = document.createElement("div");
    panel.id = "docs-panel";
    panel.className = "docs-panel";
    panel.innerHTML = `
      <div class="docs-backdrop" data-docs-close></div>
      <div class="docs-sheet" role="dialog" aria-modal="true" aria-label="Documentation">
        <header class="docs-head">
          <div>
            <h3 id="docs-title">Documentation</h3>
            <p id="docs-path" class="docs-path"></p>
          </div>
          <button class="docs-x" data-docs-close aria-label="Close">✕</button>
        </header>
        <nav class="docs-toc" id="docs-toc"></nav>
        <div class="docs-body" id="docs-body"></div>
      </div>`;
    document.body.appendChild(panel);
    panel.querySelectorAll("[data-docs-close]").forEach(el =>
      el.addEventListener("click", closeDocsPanel));
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && document.getElementById("docs-panel")?.classList.contains("open")) closeDocsPanel();
    });
  }

  const body = panel.querySelector("#docs-body");
  const toc = panel.querySelector("#docs-toc");
  requestAnimationFrame(() => panel.classList.add("open"));
  body.innerHTML = `<div class="docs-loading">Loading documentation…</div>`;
  toc.innerHTML = "";

  try {
    const doc = await get(`/api/docs/${encodeURIComponent(key)}`);
    panel.querySelector("#docs-title").textContent = doc.title;
    panel.querySelector("#docs-path").textContent = doc.path;
    body.innerHTML = mdToHtml(doc.markdown, doc.headings);

    toc.innerHTML = doc.headings
      .filter(h => h.level === 2)
      .map(h => `<button data-toc="doc-${h.slug}">${esc(h.text)}</button>`).join("");
    toc.querySelectorAll("[data-toc]").forEach(b => b.addEventListener("click", () =>
      docsScrollTo(body, b.dataset.toc)));

    // Resolve the requested section against the headings that actually exist.
    // A renamed README section degrades to "opens at the top" rather than
    // scrolling nowhere and looking broken.
    //
    // Scrolling is deliberately outside the try that owns rendering. Landing
    // on the right heading is a convenience; the document is the point. A
    // scroll that throws must not discard a page that rendered perfectly
    // well and replace it with "couldn't load".
    const hit = match && (doc.headings.find(h => h.slug.startsWith(match))
      || doc.headings.find(h => h.slug.includes(match)));
    if (hit) docsScrollTo(body, "doc-" + hit.slug);
    else body.scrollTop = 0;
  } catch (err) {
    body.innerHTML = `<div class="docs-error">
        <strong>Couldn't load that document.</strong>
        <p>${esc(apiErrorMessage(err, "The backend may not be running."))}</p>
      </div>`;
  }
}

// Scroll a heading into view, tolerating anything the environment throws at
// it. Falls back to offsetTop arithmetic, then to giving up quietly — the
// reader still has the whole document and a table of contents.
function docsScrollTo(body, id) {
  const el = body.querySelector("#" + (window.CSS?.escape ? CSS.escape(id) : id));
  if (!el) return;
  try {
    el.scrollIntoView({ behavior: "auto", block: "start" });
  } catch {
    try { body.scrollTop = el.offsetTop - body.offsetTop; } catch { /* nothing left to try */ }
  }
}

function closeDocsPanel() {
  const panel = document.getElementById("docs-panel");
  if (!panel) return;
  panel.classList.remove("open");
  setTimeout(() => panel.remove(), 220);
}

// ---------------------------------------------------------------------------
// Guided tour
// ---------------------------------------------------------------------------
// A spotlight cut out of a full-screen scrim, plus a caption anchored to the
// highlighted element. Steps whose target isn't on the page — an admin-only
// nav item, a control hidden on mobile — are skipped rather than pointing at
// empty space.
const TOUR_STEPS = [
  { sel: '[data-page="dashboard"]', title: "Dashboard",
    body: "Your daily overview — today's habits, tasks, and what needs attention across everything else." },
  { sel: '[data-page="tracker"]', title: "Progress Tracker",
    body: "Habits and tasks by day, week, month and year. Start here to build a streak." },
  { sel: '[data-page="study"]', title: "Study Plan",
    body: "Block out study sessions by subject and tick them off as you go." },
  { sel: '[data-page="jobs"]', title: "Job Applications",
    body: "A kanban board per search. Drag an application between columns as it moves along." },
  { sel: '[data-page="resumes"]', title: "Resumes",
    body: "Build a resume, score it against a job description, and tailor a copy per application." },
  { sel: "#global-search-trigger, .global-search-trigger", title: "Search anything",
    body: "Jump to any habit, task, application or resume from one box." },
  { sel: "#chat-toggle, #chat-widget", title: "AI assistant",
    body: "Ask for help without leaving the page. Runs locally when a model is configured." },
];

let tourState = null;

function startTour() {
  const steps = TOUR_STEPS
    .map(s => ({ ...s, el: document.querySelector(s.sel) }))
    .filter(s => s.el && s.el.getBoundingClientRect().width > 0);
  if (!steps.length) { showToast("Nothing to tour on this screen", "warning"); return; }

  // The sidebar is where most steps live; a collapsed rail would spotlight
  // a 48px icon with no label, which explains nothing.
  const sb = document.getElementById("sidebar");
  const wasCollapsed = sb?.classList.contains("collapsed");
  if (wasCollapsed) setSidebarCollapsed(false);

  const layer = document.createElement("div");
  layer.className = "tour-layer";
  layer.innerHTML = `
    <div class="tour-hole" id="tour-hole"></div>
    <div class="tour-pop" id="tour-pop" role="dialog" aria-live="polite">
      <div class="tour-count" id="tour-count"></div>
      <h4 id="tour-title"></h4>
      <p id="tour-body"></p>
      <div class="tour-actions">
        <button class="tour-skip" id="tour-skip">Skip</button>
        <div class="tour-nav">
          <button class="tour-back" id="tour-back">Back</button>
          <button class="tour-next" id="tour-next">Next</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(layer);
  document.body.classList.add("tour-open");

  tourState = { steps, i: 0, wasCollapsed };
  layer.querySelector("#tour-next").addEventListener("click", () => tourGo(1));
  layer.querySelector("#tour-back").addEventListener("click", () => tourGo(-1));
  layer.querySelector("#tour-skip").addEventListener("click", endTour);
  layer.addEventListener("click", (e) => { if (e.target === layer) endTour(); });
  window.addEventListener("keydown", tourKeys);
  window.addEventListener("resize", tourPaint);
  tourPaint();
}

function tourKeys(e) {
  if (!tourState) return;
  if (e.key === "Escape") { endTour(); return; }
  if (e.key === "ArrowRight" || e.key === "Enter") { e.preventDefault(); tourGo(1); }
  if (e.key === "ArrowLeft") { e.preventDefault(); tourGo(-1); }
}

function tourGo(delta) {
  if (!tourState) return;
  const next = tourState.i + delta;
  if (next < 0) return;
  if (next >= tourState.steps.length) { endTour(true); return; }
  tourState.i = next;
  tourPaint();
}

function tourPaint() {
  if (!tourState) return;
  const step = tourState.steps[tourState.i];
  const r = step.el.getBoundingClientRect();
  const pad = 8;
  const hole = document.getElementById("tour-hole");
  const pop = document.getElementById("tour-pop");
  if (!hole || !pop) return;

  hole.style.cssText = `top:${r.top - pad}px; left:${r.left - pad}px;` +
    `width:${r.width + pad * 2}px; height:${r.height + pad * 2}px;`;

  document.getElementById("tour-count").textContent =
    `${tourState.i + 1} of ${tourState.steps.length}`;
  document.getElementById("tour-title").textContent = step.title;
  document.getElementById("tour-body").textContent = step.body;
  document.getElementById("tour-back").disabled = tourState.i === 0;
  document.getElementById("tour-next").textContent =
    tourState.i === tourState.steps.length - 1 ? "Done" : "Next";

  // Prefer the right of the target, fall back to below, then clamp inside the
  // viewport — otherwise a step near the bottom edge puts its own caption
  // off-screen.
  const pw = 290, ph = pop.offsetHeight || 150, gap = 14;
  let left = r.right + gap, top = r.top - 4;
  if (left + pw > window.innerWidth - 12) {
    left = Math.max(12, r.left);
    top = r.bottom + gap;
  }
  top = Math.min(Math.max(12, top), window.innerHeight - ph - 12);
  left = Math.min(Math.max(12, left), window.innerWidth - pw - 12);
  pop.style.cssText = `top:${top}px; left:${left}px; width:${pw}px;`;
}

function endTour(completed) {
  if (!tourState) return;
  const { wasCollapsed } = tourState;
  tourState = null;
  window.removeEventListener("keydown", tourKeys);
  window.removeEventListener("resize", tourPaint);
  document.querySelector(".tour-layer")?.remove();
  document.body.classList.remove("tour-open");
  if (wasCollapsed) setSidebarCollapsed(true);
  try { localStorage.setItem("momentum_tour_done", "1"); } catch { /* private mode */ }
  if (completed) showToast("That's the tour — everything's in the sidebar", "success");
}

// ---------- nav ----------
const DATE_VIEW_PAGES = ["day", "week", "month", "year"];
const NAV = [
  { id: "welcome", label: "Home", icon: "🏠", group: "Main" },
  { id: "dashboard", label: "Dashboard", icon: "📊", group: "Main" },
  { id: "tracker", label: "Progress Tracker", icon: "📆", group: "Main" },
  { id: "study", label: "Study Plan", icon: "📚", group: "Main" },
  { id: "jobs", label: "Job Applications", icon: "💼", group: "Main" },
  { id: "resumes", label: "Resumes", icon: "📄", group: "Main" },
  { id: "jobhunt", label: "Job Hunt", icon: "🔎", group: "Main" },
  { id: "telegram", label: "Telegram", icon: "✈️", group: "Tools" },
  // The assistant is deliberately NOT here: it's the floating bubble in the
  // bottom-right corner, which is always on screen. Two entry points to one
  // panel is one more than the sidebar has room to justify.
];

function renderNav() {
  const user = auth.getUser();
  renderUpgradeCard(user);
  const items = [...NAV];
  if (user && user.role === "admin") items.splice(6, 0, { id: "admin", label: "Admin Dashboard", icon: "🛡️", group: "Main" });

  const nav = document.getElementById("nav");
  let lastGroup = null;
  nav.innerHTML = items.map((n) => {
    const groupHeader = n.group !== lastGroup
      ? `<div class="nav-group-label">${esc(n.group)}</div>` : "";
    lastGroup = n.group;
    const isActive = n.action ? false : (n.id === "tracker" ? DATE_VIEW_PAGES.includes(state.page) : state.page === n.id);
    const attr = n.action ? `data-action="${n.action}"` : `data-page="${n.id}"`;
    return `${groupHeader}<div class="nav-item ${isActive ? "active" : ""}" ${attr} title="${esc(n.label)}">
      <span class="nav-icon">${n.icon}</span><span class="sidebar-label">${esc(n.label)}</span>
    </div>`;
  }).join("");
  nav.querySelectorAll(".nav-item[data-page]").forEach((el) => {
    el.addEventListener("click", () => navigate(el.dataset.page));
  });
  nav.querySelectorAll(".nav-item[data-action='chat']").forEach((el) => {
    el.addEventListener("click", () => openChatPanel());
  });

  // The chip shows a first name, not the full "Demo User / demo@momentum.app"
  // stack — the email is one click away in the menu, where it belongs.
  const first = user && user.name ? user.name.trim().split(/\s+/)[0] : "";
  document.getElementById("sidebar-user-name").textContent = first;
  const nameEl = document.getElementById("user-menu-name");
  const mailEl = document.getElementById("user-menu-mail");
  if (nameEl) nameEl.textContent = user ? user.name : "";
  if (mailEl) mailEl.textContent = user ? user.email : "";
  paintAvatar(document.getElementById("sidebar-avatar"), user, state.profile);
  paintAvatar(document.getElementById("user-menu-avatar"), user, state.profile);
  wireUserMenu();
  // The photo arrives after the first paint; repaint once it does.
  if (user && state.profile === null) loadProfile().then(() => {
    paintAvatar(document.getElementById("sidebar-avatar"), user, state.profile);
    paintAvatar(document.getElementById("user-menu-avatar"), user, state.profile);
  });
}

// The sidebar upgrade card. Shown only to free accounts — advertising Pro to
// someone already paying for it is the fastest way to make an upsell feel like
// spam. The quota line is filled in once it is known, so the card says how
// close you are rather than just asking.
function renderUpgradeCard(user) {
  const card = document.getElementById("sidebar-upgrade");
  if (!card) return;
  const plan = (user && user.plan) || "free";
  card.classList.toggle("hidden", plan !== "free");
  if (plan !== "free") return;

  const sub = document.getElementById("su-sub");
  get("/api/extension/quota").then(q => {
    if (!sub || !q || q.limit == null) return;
    sub.textContent = q.exhausted
      ? `You have used all ${q.limit} captures this month`
      : `${q.remaining} of ${q.limit} captures left this month`;
  }).catch(() => { /* leave the default line */ });
}

// One avatar renderer for every place a person appears: their photo if they
// have uploaded one, otherwise initials on a colour derived from their name so
// the same account always looks the same.
function paintAvatar(el, user, profile) {
  if (!el) return;
  const url = profile && profile.avatar_url ? apiUrl(profile.avatar_url) : null;
  const name = (user && user.name) || (profile && profile.name) || "";
  el.classList.toggle("has-photo", !!url);
  if (url) {
    el.textContent = "";
    el.style.backgroundImage = `url("${url}")`;
    el.style.backgroundSize = "cover";
    el.style.backgroundPosition = "center";
    return;
  }
  el.style.backgroundImage = "";
  el.textContent = name ? name.trim().split(/\s+/).slice(0, 2).map(w => w[0].toUpperCase()).join("") : "";
  const palette = ["#3D5AFE", "#7C5CFC", "#3C9D7B", "#E4A335", "#E5734A", "#2C9CDB"];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  el.style.background = name ? palette[hash % palette.length] : "#3D5AFE";
}

// ---------------------------------------------------------------------------
// Photo crop
// ---------------------------------------------------------------------------
// Every template draws the photo as a circle, so the crop is the part that
// decides whether a face is centred or sliced — and it was being made for the
// customer by a cover-crop of whatever they happened to upload. This lets them
// place it themselves, and exports exactly the pixels shown in the preview
// rather than re-deriving the framing at save time.
const AVATAR_CROP_VIEW = 300;    // preview circle, CSS px
const AVATAR_CROP_OUT = 512;     // exported square, device px

function showCropModal(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    img.onload = () => {
      const root = document.getElementById("modal-root");
      root.innerHTML = `
        <div class="modal-backdrop" data-modal-backdrop>
          <div class="modal-box p-5 crop-box">
            <h3 class="font-bold text-base mb-1">Position your photo</h3>
            <p class="text-sm text-gray-500 mb-4">Drag to move, use the slider to zoom. The circle is what prints.</p>
            <div class="crop-stage">
              <canvas class="crop-canvas" width="${AVATAR_CROP_VIEW}" height="${AVATAR_CROP_VIEW}"
                      style="width:${AVATAR_CROP_VIEW}px;height:${AVATAR_CROP_VIEW}px"></canvas>
            </div>
            <label class="crop-zoom">
              <span>Zoom</span>
              <input type="range" min="100" max="300" value="100" data-crop-zoom>
            </label>
            <div class="flex justify-end gap-2 mt-4">
              <button type="button" class="btn btn-ghost" data-modal-cancel>Cancel</button>
              <button type="button" class="btn btn-accent" data-crop-save>Use this photo</button>
            </div>
          </div>
        </div>`;
      root.classList.remove("hidden");

      const canvas = root.querySelector(".crop-canvas");
      const ctx = canvas.getContext("2d");
      const V = AVATAR_CROP_VIEW;
      // "Cover" is the smallest scale that still fills the circle — the floor
      // for zoom, so the frame can never contain empty space.
      const baseScale = V / Math.min(img.naturalWidth, img.naturalHeight);
      let zoom = 1;
      let scale = baseScale;
      let x = (V - img.naturalWidth * scale) / 2;
      let y = (V - img.naturalHeight * scale) / 2;

      const clamp = () => {
        const w = img.naturalWidth * scale, h = img.naturalHeight * scale;
        x = Math.min(0, Math.max(V - w, x));
        y = Math.min(0, Math.max(V - h, y));
      };
      // One draw routine for the preview and the export, so what is saved is
      // by construction what was on screen.
      const paint = (c, size) => {
        const k = size / V;
        c.clearRect(0, 0, size, size);
        c.save();
        c.beginPath();
        c.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
        c.clip();
        c.drawImage(img, x * k, y * k, img.naturalWidth * scale * k, img.naturalHeight * scale * k);
        c.restore();
      };
      const redraw = () => { clamp(); paint(ctx, V); };
      redraw();

      root.querySelector("[data-crop-zoom]").addEventListener("input", (e) => {
        const next = Number(e.target.value) / 100;
        // Zoom about the centre of the circle, so the face being framed stays
        // framed instead of drifting off toward a corner.
        const cx = (V / 2 - x) / zoom, cy = (V / 2 - y) / zoom;
        zoom = next;
        scale = baseScale * zoom;
        x = V / 2 - cx * zoom;
        y = V / 2 - cy * zoom;
        redraw();
      });

      let drag = null;
      canvas.addEventListener("pointerdown", (e) => {
        drag = { px: e.clientX, py: e.clientY };
        canvas.setPointerCapture(e.pointerId);
      });
      canvas.addEventListener("pointermove", (e) => {
        if (!drag) return;
        x += e.clientX - drag.px;
        y += e.clientY - drag.py;
        drag = { px: e.clientX, py: e.clientY };
        redraw();
      });
      ["pointerup", "pointercancel"].forEach(ev =>
        canvas.addEventListener(ev, () => { drag = null; }));

      const finish = (blob) => { URL.revokeObjectURL(url); closeModal(); resolve(blob); };
      root.querySelector("[data-modal-cancel]").addEventListener("click", () => finish(null));
      root.querySelector("[data-modal-backdrop]").addEventListener("click", (e) => {
        if (e.target === e.currentTarget) finish(null);
      });
      root.querySelector("[data-crop-save]").addEventListener("click", () => {
        const out = document.createElement("canvas");
        out.width = out.height = AVATAR_CROP_OUT;
        paint(out.getContext("2d"), AVATAR_CROP_OUT);
        // PNG, so the area outside the circle stays transparent rather than
        // being flattened onto a white square the templates would then draw.
        out.toBlob(b => finish(b), "image/png");
      });
    };
    img.src = url;
  });
}

// The one upload path for an avatar, shared by the Profile page and the
// builder's photo card. Both used to inline their own fetch, which is how they
// ended up with subtly different cache handling.
async function uploadAvatar(blob) {
  const fd = new FormData();
  fd.append("file", blob, "avatar.png");
  const res = await fetch(`${API_BASE}/api/profile/photo`, {
    method: "POST",
    headers: { ...(auth.getToken() ? { Authorization: `Bearer ${auth.getToken()}` } : {}) },
    body: fd,
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || "Upload failed");
  invalidateApiCache();   // raw fetch: nothing else clears the GET cache
  return res.json();
}

// ---------------------------------------------------------------------------
// Page scrolling
// ---------------------------------------------------------------------------
// The shell is capped at viewport height and <main> owns the only scrollbar, so
// the sidebar can't scroll away with the content. That moves the scroll
// container off `window`, which would silently break every window.scrollTo in
// this file — these three route to whichever element is actually scrolling.
// The window fallback matters: the landing/auth screen renders before #app
// exists, and there the document really is the scroller.
function pageScroller() {
  return document.querySelector("#app > main");
}
function pageScrollY() {
  const el = pageScroller();
  return el ? el.scrollTop : window.scrollY;
}
function scrollPageTo(y) {
  const el = pageScroller();
  if (el) el.scrollTop = y;
  else window.scrollTo(0, y);
}

function apiUrl(path) {
  return /^https?:/i.test(path) ? path : `${API_BASE}${path}`;
}

// The account menu behind the gear. Everything in it already existed somewhere
// in the app — it just had no single place to be found.
function wireUserMenu() {
  const chip = document.getElementById("user-chip");
  const gear = document.getElementById("user-chip-gear");
  if (!chip || !gear || gear.dataset.wired) return;
  gear.dataset.wired = "1";
  const close = () => { chip.classList.remove("open"); gear.setAttribute("aria-expanded", "false"); };
  gear.addEventListener("click", (e) => {
    e.stopPropagation();
    const open = !chip.classList.contains("open");
    chip.classList.toggle("open", open);
    gear.setAttribute("aria-expanded", String(open));
  });
  document.getElementById("user-chip-main")?.addEventListener("click", () => { close(); navigate("profile"); });
  chip.querySelectorAll("[data-usermenu]").forEach(b => b.addEventListener("click", () => {
    close();
    const what = b.dataset.usermenu;
    if (what === "logout") { auth.clear(); showAuthScreen(); }
    else if (what === "theme") toggleTheme();
    // One export, one file: the dashboards and the full application log together.
    // Two options meant choosing before you could see what was in either.
    else if (what === "export") downloadReport(b, "statistics.pdf", "momentum-report");
    else navigate(what);
  }));
  document.addEventListener("click", (e) => { if (!e.target.closest("#user-chip")) close(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
}


// ============================================================================
// PROFILE
// The account had a name and an email and nowhere to look at them. This page is
// the one place that owns the person rather than their documents: the photo the
// picture-carrying résumé templates draw, and the handful of lines that sit
// under a name. It is deliberately short — a résumé already holds the detail.
// ============================================================================
async function loadProfile(force) {
  if (state.profile && !force) return state.profile;
  // `force` has to reach the GET cache too, not just this memo — otherwise a
  // forced reload still gets served the copy from before the photo changed.
  try { state.profile = await get(`/api/profile`, { noCache: !!force }); } catch { state.profile = null; }
  return state.profile;
}

async function renderProfile(content) {
  const p = await loadProfile(true) || {};
  const f = (k) => esc(p[k] || "");
  content.innerHTML = `
    <div class="prof-wrap">
      <div class="prof-card prof-photo-card">
        <div class="prof-photo" id="prof-photo"></div>
        <div class="prof-photo-side">
          <h3>Your photo</h3>
          <p>Used across the app, and printed on the résumé templates that carry a
             picture — Europass, Lebenslauf, Rirekisho, Gulf CV, Photo Header and
             the rest. Templates without a picture slot ignore it.</p>
          <div class="prof-photo-actions">
            <label class="prof-btn prof-btn-primary">
              <input type="file" id="prof-photo-input" accept="image/png,image/jpeg,image/webp" hidden>
              ${p.avatar_url ? "Replace photo" : "Upload photo"}
            </label>
            ${p.avatar_url ? `<button class="prof-btn" id="prof-photo-remove">Remove</button>` : ""}
          </div>
          <p class="prof-hint">PNG, JPG or WebP · up to 4MB · square crops best</p>
        </div>
      </div>

      <div class="prof-card">
        <h3>About you</h3>
        <div class="prof-grid">
          <label class="prof-field"><span>Full name</span><input id="pf-name" value="${f("name")}" placeholder="Dheeraj Gudi"></label>
          <label class="prof-field"><span>Email</span><input value="${f("email")}" disabled title="Sign-in email — change it from account settings"></label>
          <label class="prof-field prof-field-wide"><span>Headline</span><input id="pf-headline" value="${f("headline")}" placeholder="Data Engineer · Azure, Python, SQL"></label>
          <label class="prof-field"><span>Location</span><input id="pf-location" value="${f("location")}" placeholder="London, UK"></label>
          <label class="prof-field"><span>Phone</span><input id="pf-phone" value="${f("phone")}" placeholder="+44 7700 900123"></label>
          <label class="prof-field"><span>LinkedIn</span><input id="pf-linkedin" value="${f("linkedin")}" placeholder="linkedin.com/in/you"></label>
          <label class="prof-field"><span>Website</span><input id="pf-website" value="${f("website")}" placeholder="yoursite.dev"></label>
        </div>
        <div class="prof-actions">
          <button class="prof-btn prof-btn-primary" id="pf-save">Save changes</button>
          <span class="prof-saved" id="pf-saved"></span>
        </div>
      </div>
    </div>`;

  paintAvatar(document.getElementById("prof-photo"), state.user, p);

  document.getElementById("prof-photo-input").addEventListener("change", async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    e.target.value = "";   // so re-picking the same file still fires `change`
    try {
      const blob = await showCropModal(file);
      if (!blob) return;                       // cancelled — leave the old photo
      state.profile = await uploadAvatar(blob);
      showToast("Photo updated", "success");
      renderNav();
      renderProfile(content);
    } catch (err) { showToast(apiErrorMessage(err, "Couldn't upload that image"), "error"); }
  });

  document.getElementById("prof-photo-remove")?.addEventListener("click", async () => {
    try {
      state.profile = await del(`/api/profile/photo`);
      showToast("Photo removed", "success");
      renderNav();
      renderProfile(content);
    } catch (err) { showToast(apiErrorMessage(err, "Couldn't remove the photo"), "error"); }
  });

  document.getElementById("pf-save").addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      state.profile = await put(`/api/profile`, {
        name: document.getElementById("pf-name").value,
        headline: document.getElementById("pf-headline").value,
        location: document.getElementById("pf-location").value,
        phone: document.getElementById("pf-phone").value,
        linkedin: document.getElementById("pf-linkedin").value,
        website: document.getElementById("pf-website").value,
      });
      if (state.user) state.user.name = state.profile.name;
      renderNav();
      document.getElementById("pf-saved").textContent = "Saved";
      setTimeout(() => { const el = document.getElementById("pf-saved"); if (el) el.textContent = ""; }, 2200);
    } catch (err) { showToast(apiErrorMessage(err, "Couldn't save your profile"), "error"); }
    finally { btn.disabled = false; }
  });
}


// ============================================================================
// DOCUMENTS
// Everything the account has stored, in one grid. The cards are deliberately
// small — a document library is something you scan, not read, so the job of a
// card is to be identifiable at a glance and to get out of the way. Four to
// seven fit per row where the old layout fitted two.
//
// A card carries only what distinguishes one document from another: where it
// came from, its name, when it changed, and whether it can still be edited.
// Everything else lives behind the ⋯ menu.
// ============================================================================
const DOC_FILTERS = [
  { id: "all", label: "All" },
  { id: "builder", label: "Built here" },
  { id: "upload", label: "Uploaded" },
  { id: "tailored", label: "Tailored" },
];

function docKind(r) {
  if (r.tailored_for_job_id) return "tailored";
  return r.has_builder_data ? "builder" : "upload";
}
const DOC_KIND_LABEL = { builder: "Built here", upload: "Uploaded", tailored: "Tailored" };

async function renderDocuments(content) {
  const docs = await get(`/api/resumes`);
  state.docFilter = state.docFilter || "all";
  state.docQuery = state.docQuery || "";
  const counts = { all: docs.length, builder: 0, upload: 0, tailored: 0 };
  docs.forEach(d => counts[docKind(d)]++);

  const q = state.docQuery.trim().toLowerCase();
  const shown = docs
    .filter(d => state.docFilter === "all" || docKind(d) === state.docFilter)
    .filter(d => !q || (d.name || "").toLowerCase().includes(q))
    .sort((a, b) => new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at));

  content.innerHTML = `
    <div class="docs-head">
      <div class="docs-filters">
        ${DOC_FILTERS.map(f => `
          <button class="docs-chip ${state.docFilter === f.id ? "active" : ""}" data-docfilter="${f.id}">
            ${f.label}<span class="docs-chip-n">${counts[f.id]}</span>
          </button>`).join("")}
      </div>
      <div class="docs-tools">
        <input class="docs-search" id="docs-search" type="search" placeholder="Search documents"
               value="${esc(state.docQuery)}" aria-label="Search documents">
        <button class="docs-new" id="docs-new">+ New document</button>
      </div>
    </div>
    ${shown.length ? `<div class="docs-grid" id="docs-grid">${shown.map(docCard).join("")}</div>` : docsEmpty(q)}`;

  content.querySelectorAll("[data-docfilter]").forEach(b => b.addEventListener("click", () => {
    state.docFilter = b.dataset.docfilter; renderDocuments(content);
  }));
  const search = document.getElementById("docs-search");
  search.addEventListener("input", () => {
    state.docQuery = search.value;
    clearTimeout(search._t);
    search._t = setTimeout(() => {
      renderDocuments(content).then(() => {
        const again = document.getElementById("docs-search");
        if (again) { again.focus(); again.setSelectionRange(again.value.length, again.value.length); }
      });
    }, 180);
  });
  document.getElementById("docs-new").addEventListener("click", () => {
    state.builderResumeId = null; state.resumesView = "builder"; navigate("resumes");
  });
  wireDocCards(content, shown);
}

function docCard(r) {
  const kind = docKind(r);
  const editable = !!r.has_builder_data;
  return `
    <div class="doc-card" data-doc="${r.id}" tabindex="0" role="button"
         title="${esc(r.name)}${editable ? " — click to edit" : " — click to open"}">
      <div class="doc-top">
        <span class="doc-kind doc-kind-${kind}">${DOC_KIND_LABEL[kind]}</span>
        <button class="doc-more" data-docmenu="${r.id}" aria-label="More actions">···</button>
      </div>
      <div class="doc-thumb doc-thumb-${kind}">
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6.5 2.6h7L18 7.4v14H6.5z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M13.2 2.8v4.8h4.6" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>
        <span class="doc-ext">PDF</span>
      </div>
      <p class="doc-name">${esc(r.name)}</p>
      <p class="doc-meta">${editable ? "Editable" : "File only"} · ${timeAgo(r.updated_at || r.created_at)}</p>
      <div class="doc-menu" id="doc-menu-${r.id}" role="menu">
        ${editable ? `<button role="menuitem" data-docact="edit:${r.id}">Edit in builder</button>` : ""}
        <button role="menuitem" data-docact="pdf:${r.id}">Download PDF</button>
        <button role="menuitem" data-docact="rename:${r.id}">Rename</button>
        ${editable ? `<button role="menuitem" data-docact="dup:${r.id}">Duplicate</button>` : ""}
        <button role="menuitem" data-docact="del:${r.id}" class="doc-danger">Delete</button>
      </div>
    </div>`;
}

function docsEmpty(q) {
  return `<div class="docs-empty">
    <p class="docs-empty-title">${q ? "Nothing matches that search" : "No documents yet"}</p>
    <p>${q ? "Try a different word, or clear the search."
           : "Résumés you build or upload land here. Start one and it'll be saved to this page."}</p>
  </div>`;
}

function wireDocCards(root, shown) {
  const closeMenus = () => root.querySelectorAll(".doc-card.menu-open").forEach(c => c.classList.remove("menu-open"));
  root.querySelectorAll("[data-docmenu]").forEach(b => b.addEventListener("click", (e) => {
    e.stopPropagation();
    const card = b.closest(".doc-card");
    const open = card.classList.contains("menu-open");
    closeMenus();
    card.classList.toggle("menu-open", !open);
  }));
  document.addEventListener("click", closeMenus, { once: true });

  const openDoc = async (id) => {
    const r = shown.find(x => x.id === id);
    if (r && r.has_builder_data) {
      state.builderResumeId = id; state.resumesView = "builder"; navigate("resumes");
    } else {
      const url = await resumePdfUrl(r && r.filename);
      if (url) window.open(url, "_blank", "noopener");
      else showToast("This document has no file to open", "warning");
    }
  };
  root.querySelectorAll(".doc-card").forEach(card => {
    card.addEventListener("click", (e) => {
      if (e.target.closest(".doc-menu") || e.target.closest("[data-docmenu]")) return;
      openDoc(Number(card.dataset.doc));
    });
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openDoc(Number(card.dataset.doc)); }
    });
  });

  root.querySelectorAll("[data-docact]").forEach(b => b.addEventListener("click", async (e) => {
    e.stopPropagation();
    const [act, rawId] = b.dataset.docact.split(":");
    const id = Number(rawId);
    const r = shown.find(x => x.id === id);
    closeMenus();
    if (act === "edit") { state.builderResumeId = id; state.resumesView = "builder"; return navigate("resumes"); }
    if (act === "pdf") {
      // withBusy() lives inside other renderers rather than at module scope, so
      // this does its own busy state instead of reaching for it.
      const label = b.textContent;
      b.disabled = true; b.textContent = "Downloading…";
      try {
        await downloadFile(`/api/resumes/${id}/download?format=${act}`,
          { fallbackName: `${(r?.name || "resume").replace(/[^\w\-. ]/g, "_")}.${act}` });
      } catch (err) {
        showToast(apiErrorMessage(err, "Couldn't download that file"), "error");
      } finally { b.disabled = false; b.textContent = label; }
      return;
    }
    if (act === "rename") {
      const name = await showPromptModal({ title: "Rename document", initialValue: r?.name || "" });
      if (name && name.trim()) {
        await patch(`/api/resumes/${id}`, { name: name.trim() });
        showToast("Renamed", "success"); return render();
      }
      return;
    }
    if (act === "dup") {
      await post(`/api/resume-builder/${id}/duplicate`);
      showToast("Copy created", "success"); return render();
    }
    if (act === "del") {
      const ok = await showConfirmModal({ title: "Delete document", message: `"${r?.name}" will be removed. This can't be undone.` });
      if (ok) { await del(`/api/resumes/${id}`); showToast("Document deleted", "success"); render(); }
    }
  }));
}


// ============================================================================
// DASHBOARD EXPORT
// Drawn by the server (backend/app/dashboard_pdf.py), not captured from the
// screen. Photographing the live dashboards meant html2canvas had to parse the
// app's CSS, and it throws on colour-mix(), oklch() and color() — every fix
// surfaced another. The server draws real vector charts from the same data, so
// the export can't be broken by a stylesheet, a CDN or a cached asset.
// ============================================================================

function navigate(page) {
  // "Progress Tracker" is one nav item covering four sub-views — resume
  // whichever of Day/Week/Month/Year was last open instead of always
  // resetting to Day.
  state.page = page === "tracker" ? (state.trackerLastPage || "day") : page;
  renderNav();
  closeSidebar();
  scrollPageTo(0); // actual page navigation should start at the top
  render();
}

// ---------- shared Day / Week / Month / Year tab switcher ----------
const DATE_VIEW_TABS = [
  { id: "day", label: "Day" },
  { id: "week", label: "Week" },
  { id: "month", label: "Month" },
  { id: "year", label: "Year" },
];
function renderDateViewTabs(activeId) {
  return `<div class="view-tabs">
    ${DATE_VIEW_TABS.map(t => `<button type="button" class="view-tab ${t.id === activeId ? "active" : ""}" data-view-tab="${t.id}">${t.label}</button>`).join("")}
  </div>`;
}
// ---------- Habits / Tasks / All scope toggle ----------
// Lives in the page header beside the date controls on Week, Month and Year.
const SCOPE_TABS = [
  { id: "all", label: "All", icon: "◎" },
  { id: "habit", label: "Habits", icon: "🎯" },
  { id: "task", label: "Tasks", icon: "✓" },
];
const SCOPE_PAGES = ["week", "month", "year"];

// Reads a scoped field off an API row: "percent" -> "percent" | "habit_percent"
// | "task_percent". The API keeps the combined numbers on the bare key.
function scoped(row, field, scope = state.scope) {
  if (!row) return undefined;
  return scope === "all" ? row[field] : row[`${scope}_${field}`];
}
function scopeAgg(summary, scope = state.scope) {
  return summary?.scopes?.[scope] || summary?.scopes?.all || summary || {};
}
function scopeNoun(plural = true) {
  if (state.scope === "habit") return plural ? "habits" : "habit";
  if (state.scope === "task") return plural ? "tasks" : "task";
  return plural ? "items" : "item";
}

function renderScopeTabs() {
  return `<div class="scope-tabs" role="tablist" aria-label="Show habits or tasks">
    ${SCOPE_TABS.map(t => `
      <button type="button" role="tab" aria-selected="${t.id === state.scope}"
        class="scope-tab ${t.id === state.scope ? "active" : ""}" data-scope-tab="${t.id}">
        <span class="scope-tab-icon">${t.icon}</span>${t.label}
      </button>`).join("")}
  </div>`;
}
function wireScopeTabs(container) {
  container.querySelectorAll("[data-scope-tab]").forEach(el => {
    el.addEventListener("click", () => {
      if (el.dataset.scopeTab === state.scope) return;
      state.scope = el.dataset.scopeTab;
      localStorage.setItem("momentum_scope", state.scope);
      render();
    });
  });
}

function wireDateViewTabs(container) {
  container.querySelectorAll("[data-view-tab]").forEach(el => {
    el.addEventListener("click", () => {
      state.page = el.dataset.viewTab;
      state.trackerLastPage = el.dataset.viewTab;
      renderNav();
      scrollPageTo(0); // switching Day/Week/Month/Year is a navigation action, not an in-place update
      render();
    });
  });
}

// ---------- root render dispatch ----------
// Re-rendering a page (e.g. after toggling a habit, dragging a Kanban card,
// or editing a tag) used to always jump the scroll position back to the
// top, because content.innerHTML was immediately replaced with a spinner
// mid-render, which collapses the page height out from under the browser's
// scroll position — and that spinner also caused a visible blank "buffer"
// flash on every navigation. render() now (a) keeps the outgoing page on
// screen and only shows a spinner if loading exceeds a short threshold
// (cached navigations beat it, so they feel instant), and (b) remembers the
// scroll position and restores it. Actual navigation (sidebar clicks, tab
// switches) explicitly resets scroll to 0 beforehand.
let _renderSeq = 0;
async function render() {
  const mySeq = ++_renderSeq;
  const scrollY = pageScrollY();
  const title = document.getElementById("page-title");
  const tabsSlot = document.getElementById("view-tabs-slot");
  const controls = document.getElementById("header-controls");
  const content = document.getElementById("page-content");
  controls.innerHTML = "";
  // The centre and status zones belong to whichever page claims them, so they
  // are cleared here rather than by each page's teardown. Only the résumé
  // builder fills them today; leaving stale contents behind would put a
  // document's tabs on top of an unrelated page.
  document.getElementById("view-center-slot").innerHTML = "";
  document.getElementById("header-status").innerHTML = "";
  document.querySelector("header.topbar-glass")?.classList.remove("hdr-doc-mode");
  // Leaving the Jobs page with the board dropdown open would otherwise strand
  // the header in its un-clipped state.
  document.querySelector(".hdr-zone-left")?.classList.remove("hdr-zone-left--menu-open");
  // Dashboard uses a wide, full-width layout (its two-column grid needs the
  // room and the capped width was leaving big empty side margins on wide
  // screens); every other page keeps the comfortable centered reading width.
  // The dashboard and the resume editor are both workspaces that should use
  // the full viewport width rather than the centred reading column. (A CSS
  // :has() rule covers this too, but support isn't universal — this class is
  // the reliable path.)
  document.documentElement.classList.toggle("zoom-100", state.page === "jobs" || state.page === "resumes");

  const wantsWide = state.page === "dashboard"
    || (state.page === "resumes" && state.resumesView === "builder");
  content.classList.toggle("page-content--wide", wantsWide);
  content.classList.toggle("page-content--flush", state.page === "resumes" && state.resumesView === "builder");
  content.classList.toggle("page-content--dashboard", state.page === "dashboard");

  // Deferred spinner: only replaces the visible page if the load is slow
  // enough to notice. Fast/cached loads finish first and cancel it, so the
  // outgoing page stays put until the new one is ready — no blank flash.
  const spinnerTimer = setTimeout(() => {
    if (mySeq === _renderSeq) content.innerHTML = `<div class="spinner"></div>`;
  }, 180);

  if (DATE_VIEW_PAGES.includes(state.page)) {
    title.textContent = "";
    // Both toggles answer "what am I looking at", so they sit together on the
    // left; the right side of the header is left for navigating time and the
    // one primary action. Previously the scope tabs were wedged in among the
    // date controls, which made five unrelated controls compete in one row.
    tabsSlot.innerHTML = renderDateViewTabs(state.page)
      + (SCOPE_PAGES.includes(state.page) ? `<span class="header-sep"></span>${renderScopeTabs()}` : "");
    wireDateViewTabs(tabsSlot);
    wireScopeTabs(tabsSlot);
  } else if (state.page === "dashboard") {
    // dashboard's sub-tabs live in the header next to the title (fills the
    // otherwise-empty space beside "Dashboard"); wired up by renderDashboard
    const savedTab = localStorage.getItem("momentum_dashboard_tab") || "habits";
    tabsSlot.innerHTML = `
      <div class="view-tabs dash-tabs" id="dash-subtabs">
        <button type="button" class="view-tab ${savedTab === "habits" ? "active" : ""}" data-dash-tab="habits">🎯 Habits, Tasks &amp; Study</button>
        <button type="button" class="view-tab ${savedTab === "jobs" ? "active" : ""}" data-dash-tab="jobs">💼 Job Applications</button>
      </div>`;
  } else {
    tabsSlot.innerHTML = "";
  }

  try {
    if (state.page === "welcome") { title.textContent = "Welcome"; await renderWelcome(content); }
    else if (state.page === "dashboard") { await renderDashboard(content); }
    else if (state.page === "day") { renderDayControls(controls); await renderDay(content); }
    else if (state.page === "week") { renderWeekControls(controls); await renderWeek(content); }
    else if (state.page === "month") { renderMonthControls(controls); await renderMonth(content); }
    else if (state.page === "year") { renderYearControls(controls); await renderYear(content); }
    else if (state.page === "jobs") { title.textContent = "Job Applications"; await renderJobs(content); }
    else if (state.page === "resumes") { title.textContent = "Resumes"; await renderResumesPage(content); }
    else if (state.page === "study") { title.textContent = "Study Plan"; renderStudyControls(controls); await renderStudy(content); }
    else if (state.page === "documents") { title.textContent = "Documents"; await renderDocuments(content); }
    else if (state.page === "jobhunt") { title.textContent = "Job Hunt"; await renderJobHunt(content); }
    else if (state.page === "telegram") { title.textContent = "Telegram"; await renderTelegram(content); }
    else if (state.page === "profile") { title.textContent = "Profile"; await renderProfile(content); }
    else if (state.page === "admin") { title.textContent = "Admin Dashboard"; await renderAdmin(content); }
  } catch (err) {
    console.error(err);
    // Don't blame the backend for a bug in the page. A TypeError or
    // ReferenceError means the code threw, not that the server is
    // unreachable — reporting "is the backend running?" for those sends
    // people off checking their server while the real fault is right here.
    const isCodeError = err instanceof TypeError || err instanceof ReferenceError
                        || err instanceof SyntaxError || err instanceof RangeError;
    const body = isCodeError
      ? `<p class="font-semibold mb-1">⚠️ Something went wrong rendering this page.</p>
         <p class="text-xs text-gray-500">This is an application error, not a connection problem — the backend is fine.
         Details are in the browser console.</p>
         <p class="text-xs text-gray-400 mt-2"><code>${esc(err.name)}: ${esc(err.message)}</code></p>`
      : `<p class="font-semibold mb-1">⚠️ Couldn't load data.</p>
         <p class="text-xs text-gray-500">Is the backend running at <code>${esc(API_BASE)}</code>?</p>
         <p class="text-xs text-gray-400 mt-2">${esc(err.message)}</p>`;
    if (mySeq === _renderSeq) content.innerHTML = `<div class="card p-6 text-red-600 text-sm">${body}</div>`;
  } finally {
    clearTimeout(spinnerTimer);
  }

  // restore scroll position after the real content (and any charts) have
  // been laid out, rather than leaving it wherever the spinner left it
  requestAnimationFrame(() => scrollPageTo(scrollY));
}

// ============================================================================
// DASHBOARD
// ============================================================================
function parseSalaryK(str) {
  if (!str) return null;
  const matches = str.match(/[\d,]+(?:\.\d+)?/g);
  if (!matches || !matches.length) return null;
  let nums = matches.map(s => parseFloat(s.replace(/,/g, "")));
  let val = nums.length > 1 ? (nums[0] + nums[1]) / 2 : nums[0];
  if (val > 1000) val = val / 1000; // "95000" -> 95 (k)
  if (val <= 0 || val > 2000) return null; // guard against garbage input
  return Math.round(val);
}

// Section divider used to visually split the Dashboard into its two halves.
function dashSectionHead(icon, title, subtitle, tint) {
  return `
    <div class="dash-section-head dash-section-head--${tint}">
      <div class="dash-section-icon">${icon}</div>
      <div>
        <h3>${title}</h3>
        <p>${subtitle}</p>
      </div>
    </div>`;
}

function computeStudyHours(blocks) {
  const toMinutes = (hhmm) => { const [h, m] = (hhmm || "0:0").split(":").map(Number); return h * 60 + m; };
  const mins = blocks.reduce((sum, b) => sum + Math.max(0, toMinutes(b.end_time) - toMinutes(b.start_time)), 0);
  return Math.round((mins / 60) * 10) / 10;
}

async function renderDashboard(content) {
  const now = new Date();
  const weekStartISO = toISO(weekStartOf(now));
  const [today, week, month, year, jobStats, allJobs, boards, studyBlocks, allStudyBlocks] = await Promise.all([
    get(`/api/summary/day/${toISO(now)}`),
    get(`/api/summary/week/${weekStartISO}`),
    get(`/api/summary/month/${now.getFullYear()}/${now.getMonth() + 1}`),
    get(`/api/summary/year/${now.getFullYear()}`),
    get(`/api/jobs/stats/overview`),   // unscoped — whole account, every board
    get(`/api/jobs`),                  // unscoped — for the scatter chart + treemap
    get(`/api/boards`),
    // study sessions for this week (Activity chart) + all-time (ledger + subjects);
    // neither depends on the calls above, so they run in the same parallel batch
    get(`/api/study-blocks?start=${weekStartISO}&end=${toISO(addDays(weekStartOf(now), 6))}`).catch(() => []),
    get(`/api/study-blocks`).catch(() => []),
  ]);

  // per-board stats for the performance table (needs `boards` first; small
  // number of calls — boards are usually few — and all fire in parallel)
  const boardStats = await Promise.all(boards.map(b => get(`/api/jobs/stats/overview?board_id=${b.id}`)));

  // ---- derived data (computed once up front, shared by both sub-tabs so
  // switching between them never re-fetches or re-derives anything — it
  // just swaps which pre-built markup + charts are on screen) ----
  const weeklyApps = jobStats.applications_per_week.map(w => w.count);
  const weeklyInterviews = jobStats.applications_per_week.map(w => w.interviews);
  const weeklyOffers = jobStats.applications_per_week.map(w => w.offers);
  const weeklyConversion = jobStats.applications_per_week.map(w => w.count ? Math.round((w.interviews / w.count) * 100) : 0);
  const habitSpark = month.days.filter(d => !d.is_future).slice(-8).map(d => d.percent);

  const jobTypeEntries = jobTypeBreakdown(allJobs);

  const tasksToday = today.tasks || [];
  const tasksTodayDone = tasksToday.filter(t => t.completed).length;
  const studyDone = studyBlocks.filter(b => b.completed).length;
  const studyHours = computeStudyHours(studyBlocks);

  const statusEntries = Object.entries(STATUS_LABELS).filter(([k]) => (jobStats.status_counts[k] || 0) > 0);
  const skillColors = vividScale(8);
  const jobTypeColors = vividScale(jobTypeEntries.length);

  const periods = {
    week: { labels: week.days.map(d => d.label), data: week.days.map(d => d.completed) },
    month: { labels: month.weeks.map((_, i) => `Wk ${i + 1}`), data: month.weeks.map(w => w.completed) },
    year: { labels: year.months.map(m => m.name), data: year.months.map(m => m.completed) },
  };

  // ---- shell: a single body container both tabs render into. The sub-tab
  // bar itself lives in the header (see render()), so there's no wasted space
  // between the "Dashboard" title and the content. ----
  content.innerHTML = `<div id="dash-tab-body"></div>`;

  function renderHabitsTab() {
    const body = document.getElementById("dash-tab-body");
    const nextSession = nextStudySession(allStudyBlocks);
    const aiInsights = studyAiInsights(month, allStudyBlocks, studyBlocks);
    const sessDate = nextSession ? fromISO(nextSession.date) : null;
    const todayISO = toISO(new Date());
    const sessWhen = nextSession
      ? (nextSession.date === todayISO ? "Today" : nextSession.date === toISO(addDays(new Date(), 1)) ? "Tomorrow" : sessDate.toLocaleDateString(undefined, { weekday: "long" }))
      : null;

    body.innerHTML = `
      <div class="dash-fade-in dash-two-col">
        <div class="dash-main-col">
          <div class="grid grid-cols-2 md:grid-cols-4 gap-3 dash-kpi-row">
            ${kpiCardV2("📅", "Today's Progress", `${today.percent}%`, `${today.completed}/${today.total} done today`, today.percent > 0 ? "up" : "flat", habitSpark, "#3D5AFE")}
            ${kpiCardV2("🔥", "Habit Streak", `${month.current_streak} day${month.current_streak === 1 ? "" : "s"}`, "current streak", month.current_streak > 0 ? "up" : "flat", habitSpark, "#FF6A3D")}
            ${kpiCardV2("✅", "Tasks Today", `${tasksTodayDone}/${tasksToday.length}`, "completed today", tasksToday.length && tasksTodayDone === tasksToday.length ? "up" : "flat", null, "#1FAE6B")}
            ${kpiCardV2("📚", "Study This Week", `${studyDone}/${studyBlocks.length}`, `${studyHours}h scheduled`, "flat", null, "#7C5CFC")}
          </div>

          <div class="grid grid-cols-1 lg:grid-cols-5 gap-4 dash-row items-stretch">
            <div class="card lg:col-span-3">
              <div class="card-header flex items-center justify-between">
                <span>Habit Consistency</span>
                <span class="text-[10px] font-normal opacity-70">${month.current_streak}-day streak</span>
              </div>
              <div class="p-4">${renderHabitConsistencyGrid(month.days)}</div>
            </div>
            <div class="card lg:col-span-2">
              <div class="card-header flex items-center justify-between">
                <span>Activity Completed</span>
                <div class="view-tabs" id="dash-period-tabs">
                  <button type="button" class="view-tab active" data-period="week">Week</button>
                  <button type="button" class="view-tab" data-period="month">Month</button>
                  <button type="button" class="view-tab" data-period="year">Year</button>
                </div>
              </div>
              <div class="p-4 dash-chart-box"><canvas id="dash-period-bar"></canvas></div>
            </div>
          </div>

          ${(() => {
            // Adapt this row to how many subjects the user actually has: with
            // only a few, the ledger stays wide (3/2 split); once there are
            // enough subjects that a single column would run long, the
            // Subjects panel takes the larger share (3/5) and lays its rows
            // out in two columns, and the ledger narrows to suit.
            const subjectCount = new Set(allStudyBlocks.map(b => b.subject)).size;
            const manySubjects = subjectCount > 5;
            const ledgerSpan = manySubjects ? "lg:col-span-2" : "lg:col-span-3";
            const subjectsSpan = manySubjects ? "lg:col-span-3" : "lg:col-span-2";
            return `
          <div class="grid grid-cols-1 lg:grid-cols-5 gap-4 dash-row items-stretch">
            <div class="card ${ledgerSpan}">
              <div class="card-header flex items-center justify-between">
                <span>📖 The Study Ledger</span>
                <span class="text-[10px] font-normal opacity-70">scrolled to latest month</span>
              </div>
              <div class="p-4 flex items-center dash-ledger-box">${renderStudyLedgerHeatmap(allStudyBlocks, "dash-study-ledger-scroll")}</div>
            </div>
            <div class="card ${subjectsSpan}">
              <div class="card-header flex items-center justify-between">
                <span>Subjects</span>
                <span class="text-[10px] font-normal opacity-70">${subjectCount} total</span>
              </div>
              ${renderSubjectsPanel(allStudyBlocks, true, manySubjects)}
            </div>
          </div>`;
          })()}

          <div class="card">
            <div class="card-header flex items-center justify-between">
              <span>⏱️ Planned vs Actual Study Time</span>
              <span class="text-[10px] font-normal opacity-70">this week, from the focus timer</span>
            </div>
            <div class="p-4 dash-chart-box"><canvas id="dash-planned-actual"></canvas></div>
          </div>
        </div>

        <aside class="dash-side-col">
          <div class="card dash-side-card">
            <div class="card-header flex items-center justify-between">
              <span>📅 Upcoming Study Session</span>
            </div>
            <div class="p-4">
              ${nextSession ? `
                <div class="study-sess-when"><span class="study-sess-day">${sessWhen}</span> <span class="study-sess-time">${nextSession.start_time} – ${nextSession.end_time}</span></div>
                <div class="study-sess-subject">${esc(nextSession.subject)}</div>
                ${nextSession.notes ? `<div class="study-sess-notes">${esc(nextSession.notes)}</div>` : ""}
                <button class="btn btn-accent w-full justify-center mt-4" data-goto-study>▶ Open Study Plan</button>
              ` : `
                <p class="text-sm text-gray-400 py-3">No upcoming study sessions scheduled.</p>
                <button class="btn btn-accent w-full justify-center mt-1" data-goto-study>+ Schedule a session</button>
              `}
            </div>
          </div>

          <div class="card dash-side-card">
            <div class="card-header flex items-center gap-2"><span>✨ AI Insights</span></div>
            <div class="p-4 flex flex-col gap-3">
              ${aiInsights.map(i => `
                <div class="ai-insight ${i.tone}">
                  <div class="ai-insight-icon">${i.icon}</div>
                  <div class="min-w-0">
                    <div class="ai-insight-title">${i.title}</div>
                    <div class="ai-insight-body">${i.body}</div>
                  </div>
                </div>
              `).join("")}
              <button class="ai-insight-viewall" data-goto-study>View all insights →</button>
            </div>
          </div>

          <div class="card dash-side-card">
            <div class="card-header">Quick Actions</div>
            <div class="p-2">
              <button class="quick-action" data-action="add-job"><span class="qa-icon">➕</span><span class="qa-label">Add Job Application</span><span class="qa-arrow">›</span></button>
              <button class="quick-action" data-action="schedule-study"><span class="qa-icon">📅</span><span class="qa-label">Schedule Study Session</span><span class="qa-arrow">›</span></button>
              <button class="quick-action" data-action="focus-timer"><span class="qa-icon">⏱️</span><span class="qa-label">Start Focus Timer</span><span class="qa-arrow">›</span></button>
              <button class="quick-action" data-action="upload-doc"><span class="qa-icon">⬆️</span><span class="qa-label">Upload Document</span><span class="qa-arrow">›</span></button>
            </div>
          </div>
        </aside>
      </div>
    `;

    barChart("dash-period-bar", periods.week.labels, periods.week.data, periods.week.labels.findIndex((_, i) => week.days[i]?.date === toISO(now)), vividScale(periods.week.labels.length));
    document.querySelectorAll("#dash-period-tabs [data-period]").forEach(btn => {
      btn.addEventListener("click", () => {
        document.querySelectorAll("#dash-period-tabs [data-period]").forEach(b => b.classList.toggle("active", b === btn));
        const p = periods[btn.dataset.period];
        barChart("dash-period-bar", p.labels, p.data, -1, vividScale(p.labels.length));
      });
    });
    scrollHeatmapToLatest("dash-study-ledger-scroll");

    // Planned vs Actual — planned = scheduled duration of every block that
    // day; actual = minutes logged by the focus-timer stopwatch (only
    // sessions actually run through "Finish & Log" have a real actual value;
    // blocks marked done without the timer simply show no actual bar for
    // that day's remainder, which is an honest reflection of what we know).
    const actualLog = getStudyActualLog();
    const weekDates = Array.from({ length: 7 }, (_, i) => toISO(addDays(weekStartOf(now), i)));
    const plannedByDay = weekDates.map(iso => studyBlocks.filter(b => b.date === iso).reduce((sum, b) => sum + Math.max(0, timeToMinutes(b.end_time) - timeToMinutes(b.start_time)), 0));
    const actualByDay = weekDates.map(iso => studyBlocks.filter(b => b.date === iso).reduce((sum, b) => sum + (actualLog[b.id] || 0), 0));
    groupedBarChart("dash-planned-actual", weekDates.map(iso => fromISO(iso).toLocaleDateString(undefined, { weekday: "short" })), [
      { label: "Planned (min)", data: plannedByDay, color: "#B9C6F5" },
      { label: "Actual (min)", data: actualByDay, color: chartTheme().accent },
    ]);

    // right-panel navigation + quick actions
    body.querySelectorAll("[data-goto-study]").forEach(el => el.addEventListener("click", () => navigate("study")));
    body.querySelectorAll("[data-action]").forEach(el => el.addEventListener("click", () => {
      const a = el.dataset.action;
      if (a === "add-job") { navigate("jobs"); }
      else if (a === "schedule-study" || a === "focus-timer") { navigate("study"); }
      else if (a === "upload-doc") { navigate("resumes"); }
    }));
  }

  function renderJobsTab() {
    const body = document.getElementById("dash-tab-body");
    const followUps = jobStats.upcoming_follow_ups;
    const insights = quickJobInsights(jobStats, allJobs);
    body.innerHTML = `
      <div class="dash-fade-in dash-two-col">
        <div class="dash-main-col">
          <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 dash-kpi-row">
            ${kpiCardV2("📨", "Applications", jobStats.total, `${jobStats.applications_per_week.at(-1)?.count ?? 0} this week`, "flat", weeklyApps, "#3D5AFE")}
            ${kpiCardV2("📞", "Phone Screens", jobStats.status_counts.phone_screen || 0, "in pipeline", "flat", null, "#0EA5E9")}
            ${kpiCardV2("🧑‍💼", "Interviews", (jobStats.status_counts.interview || 0) + (jobStats.status_counts.offer || 0), `${jobStats.interview_rate}% rate`, jobStats.interview_rate > 0 ? "up" : "flat", weeklyInterviews, "#1FAE6B")}
            ${kpiCardV2("🏆", "Offers", jobStats.offers, jobStats.offers > 0 ? "🎉" : "keep going", jobStats.offers > 0 ? "up" : "flat", weeklyOffers, "#FF6A3D")}
            ${kpiCardV2("📈", "Conversion Rate", `${jobStats.interview_rate}%`, "applied → interview", "flat", weeklyConversion, "#7C5CFC")}
          </div>

          <div class="card dash-row">
            <div class="card-header flex items-center justify-between">
              <span>Applications &amp; Interviews Over Time</span>
              <span class="text-[10px] font-normal opacity-70">last 8 weeks, all boards</span>
            </div>
            <div class="p-4 dash-chart-box--lg"><canvas id="dash-overtime-line"></canvas></div>
          </div>

          <div class="grid grid-cols-1 lg:grid-cols-2 gap-4 dash-row items-stretch">
            <div class="card">
              <div class="card-header">Applications by Status</div>
              <div class="p-4 dash-chart-box">
                ${statusEntries.length ? `<canvas id="dash-status-donut"></canvas>` : `<p class="text-sm text-gray-400 text-center py-14">No applications yet</p>`}
              </div>
            </div>
            <div class="card">
              <div class="card-header">Top Skills Required</div>
              <div class="p-4 dash-chart-box"><canvas id="dash-skills-bar"></canvas></div>
            </div>
          </div>

          <div class="grid grid-cols-1 lg:grid-cols-2 gap-4 dash-row items-stretch">
            <div class="card">
              <div class="card-header">Applications by Job Type</div>
              <div class="p-4 dash-chart-box">
                ${jobTypeEntries.length ? `<canvas id="dash-jobtype-pie"></canvas>` : `<p class="text-sm text-gray-400 text-center py-14">No applications yet to break down by job type.</p>`}
              </div>
            </div>
            <div class="card">
              <div class="card-header flex items-center justify-between">
                <span>Application Activity Heatmap</span>
                <span class="text-[10px] font-normal opacity-70">scrolled to latest month</span>
              </div>
              <div class="p-4 flex items-center dash-ledger-box">${renderApplicationHeatmap(allJobs, "dash-heatmap-scroll")}</div>
            </div>
          </div>

          <div class="card overflow-x-auto">
            <div class="card-header">Board Performance</div>
            <div class="p-3">
              <table class="dash-table">
                <thead><tr><th>Board</th><th>Applications</th><th>Interviews</th><th>Interview Rate</th><th>Offer Rate</th></tr></thead>
                <tbody>
                  ${boards.map((b, i) => {
                    const s = boardStats[i];
                    const maxTotal = Math.max(1, ...boardStats.map(x => x.total));
                    const maxInt = Math.max(1, ...boardStats.map(x => (x.status_counts.interview || 0) + (x.status_counts.offer || 0)));
                    const interviews = (s.status_counts.interview || 0) + (s.status_counts.offer || 0);
                    const offerRate = s.total ? Math.round((s.offers / s.total) * 100) : 0;
                    return `
                      <tr>
                        <td class="font-semibold text-navy">${esc(b.name)}</td>
                        <td><div class="flex items-center gap-2"><div class="bar-track"><div class="bar-fill" style="width:${Math.round((s.total / maxTotal) * 100)}%; background:#3D5AFE;"></div></div><span class="text-xs text-gray-500 shrink-0">${esc(s.total)}</span></div></td>
                        <td><div class="flex items-center gap-2"><div class="bar-track"><div class="bar-fill" style="width:${Math.round((interviews / maxInt) * 100)}%; background:#7C5CFC;"></div></div><span class="text-xs text-gray-500 shrink-0">${interviews}</span></div></td>
                        <td><span class="rate-badge ${rateBadgeClass(s.interview_rate, 20, 10)}">${s.interview_rate}%</span></td>
                        <td><span class="rate-badge ${rateBadgeClass(offerRate, 8, 3)}">${offerRate}%</span></td>
                      </tr>`;
                  }).join("")}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <aside class="dash-side-col">
          <div class="card dash-side-card">
            <div class="card-header flex items-center justify-between">
              <span>Upcoming Follow-ups</span>
              <span class="text-base leading-none">🗓️</span>
            </div>
            <div class="p-4">
              <p class="text-xs text-gray-400 mb-3">Applications with a "review by" date in the next 7 days — act or edit the form in the Job Applications page.</p>
              ${followUps.length ? followUps.map(j => `
                <div class="followup-item">
                  ${companyAvatar(j.company_name)}
                  <div class="min-w-0 flex-1">
                    <div class="followup-company">${esc(j.company_name)}</div>
                    <div class="followup-role">${esc(j.role_title)}</div>
                    <span class="followup-badge">Review by ${fmtNice(fromISO(j.next_action_date))}</span>
                  </div>
                </div>
              `).join("") : `<p class="text-sm text-gray-400 py-3">No upcoming follow-ups in the next 7 days 🎉</p>`}
              ${followUps.length ? `<button class="followup-viewall" data-goto-jobs>View all follow-ups →</button>` : ""}
            </div>
          </div>

          <div class="card dash-side-card">
            <div class="card-header">Quick Insights</div>
            <div class="p-4 flex flex-col gap-3">
              ${insights.map(i => `
                <div class="quick-insight">
                  <div class="quick-insight-icon ${i.tone}">${i.icon}</div>
                  <div class="min-w-0">
                    <div class="quick-insight-title">${i.title}</div>
                    <div class="quick-insight-body">${i.body}</div>
                  </div>
                </div>
              `).join("")}
            </div>
          </div>
        </aside>
      </div>
    `;

    multiLineChart(
      "dash-overtime-line",
      jobStats.applications_per_week.map(w => w.week_start.slice(5)),
      [
        { label: "Applications", data: weeklyApps, color: "#3D5AFE", fill: true },
        { label: "Interviews", data: weeklyInterviews, color: "#7C5CFC" },
        { label: "Offers", data: weeklyOffers, color: "#1FAE6B", dash: [6, 4] },
      ]
    );
    if (statusEntries.length) {
      multiDonutChart(
        "dash-status-donut",
        statusEntries.map(([, v]) => v),
        statusEntries.map(([k]) => jobStats.status_counts[k]),
        statusEntries.map(([k]) => KANBAN_ACCENTS[k] || "#93968E"),
        DONUT_OPTS
      );
    }
    const skills = jobStats.top_skills.slice(0, 8);
    barChart("dash-skills-bar", skills.map(s => s.skill), skills.map(s => s.count), -1, skillColors);
    if (jobTypeEntries.length) {
      // Same helper + same opts as the Status donut above, so the two
      // stack up with identical inner/outer radii and line up vertically.
      multiDonutChart("dash-jobtype-pie", jobTypeEntries.map(e => e[0]), jobTypeEntries.map(e => e[1]), jobTypeColors, DONUT_OPTS);
    }
    scrollHeatmapToLatest("dash-heatmap-scroll");

    body.querySelector("[data-goto-jobs]")?.addEventListener("click", () => navigate("jobs"));
  }

  // ---- instant sub-tab switching: the tab buttons live in the header
  // (view-tabs-slot), and both renderers use data already fetched above, so
  // switching never touches the network — it just redraws the body with a
  // quick fade-in. ----
  const CALENDAR_SVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>`;
  const fmtCompact = (d) => d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

  function updateDashHeader(tab) {
    const title = document.getElementById("page-title");
    const controls = document.getElementById("header-controls");
    if (tab === "habits") {
      title.innerHTML = `
        <div class="dash-page-heading">
          <div class="dash-page-icon">🎓</div>
          <div class="dash-page-titles">
            <p class="dash-page-title">Study Dashboard</p>
            <p class="dash-page-sub">Your daily overview and progress</p>
          </div>
        </div>`;
      controls.innerHTML = `<span class="dash-date-badge">${CALENDAR_SVG}${fmtCompact(now)}</span>`;
    } else {
      title.innerHTML = `<p class="dash-page-title dash-page-title--plain">Job Applications Dashboard</p>`;
      const rangeStart = jobStats.applications_per_week[0] ? fromISO(jobStats.applications_per_week[0].week_start) : now;
      controls.innerHTML = `<span class="dash-daterange-badge">${CALENDAR_SVG}${fmtCompact(rangeStart)} – ${fmtCompact(now)}</span>`;
    }
  }

  const RENDERERS = { habits: renderHabitsTab, jobs: renderJobsTab };
  function showDashTab(tab) {
    document.querySelectorAll("#dash-subtabs [data-dash-tab]").forEach(b => b.classList.toggle("active", b.dataset.dashTab === tab));
    localStorage.setItem("momentum_dashboard_tab", tab);
    updateDashHeader(tab);
    RENDERERS[tab]();
  }
  document.querySelectorAll("#dash-subtabs [data-dash-tab]").forEach(btn => {
    btn.addEventListener("click", () => showDashTab(btn.dataset.dashTab));
  });
  const savedTab = localStorage.getItem("momentum_dashboard_tab");
  showDashTab(RENDERERS[savedTab] ? savedTab : "habits");
}

function statCard(label, value, sub) {
  return `<div class="card p-5">
    <p class="text-xs font-semibold text-gray-500 uppercase tracking-wide">${label}</p>
    <p class="text-3xl font-extrabold mt-1">${value}</p>
    <p class="text-xs text-gray-400 mt-1">${sub}</p>
  </div>`;
}

// ============================================================================
// DAY VIEW
// ============================================================================
// ---------- shared date navigator ----------
// Prev / label / next used to be three loose buttons plus a separate accent
// "Today" button, which made the header read as five competing controls. They
// are one segmented pill now: arrows either side of the current period, with
// "Today" tucked in behind a divider so it reads as part of the same control
// rather than a call to action competing with "+ Habit".
const NAV_CHEVRON_LEFT = `<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M10 3.5 5.5 8l4.5 4.5" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const NAV_CHEVRON_RIGHT = `<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M6 3.5 10.5 8 6 12.5" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

function dateNav({ prevId, nextId, todayId, todayLabel, isCurrent, body }) {
  return `<div class="date-nav">
    <button type="button" class="date-nav-btn" id="${prevId}" aria-label="Previous">${NAV_CHEVRON_LEFT}</button>
    <div class="date-nav-body">${body}</div>
    <button type="button" class="date-nav-btn" id="${nextId}" aria-label="Next">${NAV_CHEVRON_RIGHT}</button>
    ${todayId ? `<span class="date-nav-divider"></span>
    <button type="button" class="date-nav-today ${isCurrent ? "is-current" : ""}" id="${todayId}"
      ${isCurrent ? "disabled" : ""}>${todayLabel}</button>` : ""}
  </div>`;
}

// ---------- drill-down navigation ----------
// Clicking a day in the month calendar opens that day; clicking a month in the
// year view opens that month. Both go through here so the nav highlight, the
// remembered tracker sub-page and the scroll reset stay consistent with the
// header tabs' own behaviour.
function goToDay(iso) {
  state.day = fromISO(iso);
  state.page = "day";
  state.trackerLastPage = "day";
  renderNav();
  scrollPageTo(0);
  render();
}
function goToWeek(iso) {
  state.weekStart = weekStartOf(fromISO(iso));
  state.page = "week";
  state.trackerLastPage = "week";
  renderNav();
  scrollPageTo(0);
  render();
}
function goToMonth(year, month) {
  state.monthYear = year;
  state.monthMonth = month;
  state.page = "month";
  state.trackerLastPage = "month";
  renderNav();
  scrollPageTo(0);
  render();
}

function renderDayControls(controls) {
  controls.innerHTML = dateNav({
    prevId: "day-prev", nextId: "day-next", todayId: "day-today", todayLabel: "Today",
    isCurrent: toISO(state.day) === toISO(new Date()),
    body: `<input type="date" id="day-picker" class="date-nav-picker" value="${toISO(state.day)}" />`,
  });
  controls.querySelector("#day-prev").onclick = () => { state.day = addDays(state.day, -1); render(); };
  controls.querySelector("#day-next").onclick = () => { state.day = addDays(state.day, 1); render(); };
  controls.querySelector("#day-today").onclick = () => { state.day = new Date(); render(); };
  controls.querySelector("#day-picker").onchange = (e) => { state.day = fromISO(e.target.value); render(); };
}

function dayTipText(completed, total) {
  const remaining = total - completed;
  if (!total) return "No goals set for this day yet — add a habit or task to get started.";
  if (remaining <= 0) return "🎉 All done! Great job completing today's goals.";
  return `Great progress! You're ${remaining} task${remaining === 1 ? "" : "s"} away from completing today's goals.`;
}

// Tracks the ResizeObserver that keeps the Day view's Habits card height
// pinned to Today's Progress (see renderDay) — disconnected and replaced on
// every render so it never keeps watching a detached element.
let _dayHabitsHeightObserver = null;

async function renderDay(content) {
  const iso = toISO(state.day);
  const [summary, weekSummary] = await Promise.all([
    get(`/api/summary/day/${iso}`),
    get(`/api/summary/week/${toISO(weekStartOf(state.day))}`),
  ]);
  let weeklyAvg = weekSummary.percent;

  // When the habit list gets long it used to run as one tall single column,
  // which stretched the Today's Progress card to match (leaving a big empty
  // gap under the donut) and pinned the chart to a wide 2/3 column. Past a
  // threshold we rebalance to a 50/50 split and flow the habits into two
  // columns, and `items-start` on the row stops the progress card stretching.
  // The habit list stays a single column no matter how many habits there
  // are, at a wider 2/5 share of the row, and the row now stretches both
  // cards to the same height — the list itself scrolls internally past a
  // handful of rows (see .card:has(> #day-habits) in styles.css) instead of
  // the card growing taller or narrower than Today's Progress.
  const dayGridCols = "lg:grid-cols-5";
  const progressSpan = "lg:col-span-3";
  const habitsListClass = "day-habits-list";

  content.innerHTML = `
    <div class="grid grid-cols-1 ${dayGridCols} gap-5">
      <div class="card ${progressSpan}" id="day-progress-card">
        <div class="card-header flex items-center justify-between">
          <span>Today's Progress</span>
          <span class="text-xs font-medium text-gray-400">${fmtNice(state.day)}</span>
        </div>
        <div class="day-progress-row">
          <div class="day-ring-wrap">
            ${dayRingSVG(summary.percent)}
            <div class="day-ring-center">
              <div class="day-ring-flame">🔥</div>
              <div class="day-ring-pct" id="day-donut-label">${summary.percent}%</div>
              <div class="day-ring-caption">Daily Progress</div>
            </div>
          </div>
          <div class="day-stats-col">
            <div id="day-stat-completed">${dayStatMini("✓", summary.completed, "Completed", "--lp-green")}</div>
            <div id="day-stat-remaining">${dayStatMini("●", Math.max(0, summary.total - summary.completed), "Remaining", "--lp-amber")}</div>
            <div id="day-stat-weekly">${dayStatMini("↗", `${weeklyAvg}%`, "Weekly Avg", "--lp-purple")}</div>
          </div>
        </div>
        <p class="text-sm text-gray-500 text-center -mt-1 mb-4" id="day-total-text">${summary.completed} / ${summary.total} completed</p>
        <div class="day-tip-banner mx-5 mb-5" id="day-tip-banner">💡 ${dayTipText(summary.completed, summary.total)}</div>
      </div>
      <div class="card lg:col-span-2" id="day-habits-card">
        <div class="card-header">Habits</div>
        <div id="day-habits" class="${habitsListClass}"></div>
      </div>
    </div>
    <div class="card mt-5">
      <div class="card-header flex items-center justify-between">
        <span>Tasks for the day</span>
      </div>
      <div id="day-tasks"></div>
      <form id="day-add-task" class="day-task-form p-3 border-t border-gray-100">
        <input type="text" id="day-new-task" class="task-name-input" placeholder="Add a task for this day..." required />
        <input type="text" id="day-new-task-tags" class="task-tags-input" placeholder="Tags (optional, comma-separated)" />
        <button class="btn btn-primary" type="submit">Add</button>
      </form>
    </div>
  `;

  // Grid `stretch` alone doesn't reliably cap the Habits card's height to
  // match Today's Progress — an auto-sized grid row still grows to fit a
  // long habit list's full content rather than deferring to its sibling.
  // Cap it explicitly instead: measure the Progress card and apply that as
  // a max-height on the Habits card. With max-height (not a hard height)
  // the card still shrinks to fit a short list — no leftover empty space —
  // and only grows up to that cap, at which point the list itself (flex: 1,
  // overflow-y: auto) scrolls instead of the card growing past it. A
  // ResizeObserver keeps the cap in sync if the Progress card's own height
  // ever changes (e.g. a window resize).
  const progressCardEl = content.querySelector("#day-progress-card");
  const habitsCardEl = content.querySelector("#day-habits-card");
  if (progressCardEl && habitsCardEl) {
    const syncHabitsCardHeight = () => { habitsCardEl.style.maxHeight = `${progressCardEl.offsetHeight}px`; };
    syncHabitsCardHeight();
    if (_dayHabitsHeightObserver) _dayHabitsHeightObserver.disconnect();
    if (window.ResizeObserver) {
      _dayHabitsHeightObserver = new ResizeObserver(syncHabitsCardHeight);
      _dayHabitsHeightObserver.observe(progressCardEl);
    }
  }

  // Same in-place update approach as the Week view: a checkbox click
  // repaints just the ring, stat cards, and counter rather than re-fetching
  // and rebuilding the whole page.
  function syncDayTotals() {
    summary.percent = summary.total ? Math.round(summary.completed / summary.total * 1000) / 10 : 0;
    const label = document.getElementById("day-donut-label");
    const text = document.getElementById("day-total-text");
    const tip = document.getElementById("day-tip-banner");
    if (label) label.textContent = `${summary.percent}%`;
    if (text) text.textContent = `${summary.completed} / ${summary.total} completed`;
    if (tip) tip.innerHTML = `💡 ${dayTipText(summary.completed, summary.total)}`;
    setDayRingPercent(summary.percent);
    const completedEl = document.getElementById("day-stat-completed");
    const remainingEl = document.getElementById("day-stat-remaining");
    if (completedEl) completedEl.innerHTML = dayStatMini("✓", summary.completed, "Completed", "--lp-green");
    if (remainingEl) remainingEl.innerHTML = dayStatMini("●", Math.max(0, summary.total - summary.completed), "Remaining", "--lp-amber");
  }

  const habitsEl = document.getElementById("day-habits");
  habitsEl.innerHTML = summary.habits.length ? summary.habits.map(h => `
    <div class="task-row ${h.completed ? "done" : ""}" data-habit-id="${h.id}">
      <span class="task-title">${esc(h.title)}</span>
      <span class="checkbox ${h.completed ? "checked" : ""}" data-habit-toggle="${h.id}"></span>
    </div>`).join("") : `<p class="text-sm text-gray-400 p-4">No habits yet. Add some in the Week view.</p>`;

  habitsEl.querySelectorAll("[data-habit-toggle]").forEach(el => {
    el.addEventListener("click", async () => {
      const nowChecked = !el.classList.contains("checked");
      el.classList.toggle("checked");
      el.closest(".task-row").classList.toggle("done");
      summary.completed += nowChecked ? 1 : -1;
      syncDayTotals();
      try {
        await post(`/api/habits/${el.dataset.habitToggle}/toggle?for_date=${iso}`);
      } catch (e) {
        console.error(e);
        el.classList.toggle("checked");
        el.closest(".task-row").classList.toggle("done");
        summary.completed += nowChecked ? -1 : 1;
        syncDayTotals();
        showToast("Couldn't save that change", "error");
      }
    });
  });

  renderTaskList(document.getElementById("day-tasks"), summary.tasks, (completed) => {
    summary.completed += completed ? 1 : -1;
    syncDayTotals();
  });

  document.getElementById("day-add-task").addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = document.getElementById("day-new-task");
    const tagsInput = document.getElementById("day-new-task-tags");
    if (!input.value.trim()) return;
    const payload = { date: iso, title: input.value.trim() };
    if (tagsInput.value.trim()) payload.tags = tagsInput.value.trim();
    try {
      await post(`/api/tasks`, payload);
      input.value = "";
      tagsInput.value = "";
      showToast("Task added", "success");
      render();
    } catch (err) {
      handleWriteError(err, { shakeEl: input, genericMsg: "Couldn't add task — please try again." });
    }
  });
}

function renderTaskList(container, tasks, onChange) {
  container.innerHTML = tasks.length ? tasks.map(t => `
    <div class="task-row ${t.completed ? "done" : ""}" data-task-id="${t.id}">
      <span class="task-title">${esc(t.title)}${tagChips(t.tags)}</span>
      <div class="flex items-center gap-3">
        <span class="checkbox ${t.completed ? "checked" : ""}" data-task-toggle="${t.id}"></span>
        <span class="text-gray-300 cursor-pointer text-xs" data-task-delete="${t.id}">✕</span>
      </div>
    </div>`).join("") : `<p class="text-sm text-gray-400 p-4">No tasks yet — add one below.</p>`;

  container.querySelectorAll("[data-task-toggle]").forEach(el => {
    el.addEventListener("click", async () => {
      const id = el.dataset.taskToggle;
      const completed = !el.classList.contains("checked");
      el.classList.toggle("checked");
      el.closest(".task-row").classList.toggle("done");
      try {
        await patch(`/api/tasks/${id}`, { completed });
      } catch (err) {
        // Roll the optimistic flip back if the server rejected it.
        console.error(err);
        el.classList.toggle("checked");
        el.closest(".task-row").classList.toggle("done");
        showToast("Couldn't save that change", "error");
        return;
      }
      onChange && onChange(completed);
    });
  });
  container.querySelectorAll("[data-task-delete]").forEach(el => {
    el.addEventListener("click", async () => {
      await del(`/api/tasks/${el.dataset.taskDelete}`);
      render();
    });
  });
}

// ============================================================================
// WEEK VIEW
// ============================================================================
function renderWeekControls(controls) {
  const isThisWeek = toISO(state.weekStart) === toISO(weekStartOf(new Date()));
  controls.innerHTML = dateNav({
    prevId: "week-prev", nextId: "week-next", todayId: "week-today", todayLabel: "This week",
    isCurrent: isThisWeek,
    body: `<span class="date-nav-label">${fmtNice(state.weekStart)} – ${fmtNice(addDays(state.weekStart, 6))}</span>`,
  }) + `<button class="btn btn-accent shrink-0" id="week-add-habit">+ Habit</button>`;
  controls.querySelector("#week-prev").onclick = () => { state.weekStart = addDays(state.weekStart, -7); render(); };
  controls.querySelector("#week-next").onclick = () => { state.weekStart = addDays(state.weekStart, 7); render(); };
  controls.querySelector("#week-today").onclick = () => { state.weekStart = weekStartOf(new Date()); render(); };
  controls.querySelector("#week-add-habit").onclick = async () => {
    const title = await showPromptModal({ title: "New Habit", label: "Habit name", placeholder: "e.g. Drink water" });
    if (title) {
      try {
        await post(`/api/habits`, { title });
        showToast("Habit added", "success");
        render();
      } catch (err) {
        handleWriteError(err, { genericMsg: "Couldn't add habit — please try again." });
      }
    }
  };
}

async function renderWeek(content) {
  const iso = toISO(state.weekStart);
  const todayIso = toISO(new Date());

  // Paint the shell immediately so opening the Week view is instant. This
  // view needs 8 requests (the week summary + 7 days of tasks); awaiting them
  // all before rendering anything meant render()'s deferred spinner fired on
  // every fresh visit, and only a warm 60s cache made a second click feel
  // instant — which is why re-clicking the Week tab "fixed" the loading. Now
  // the layout shows at once and the data fills in as it arrives.
  content.innerHTML = `
    <div class="grid grid-cols-1 md:grid-cols-3 gap-5 mb-5" id="week-notes-grid">
      ${["Weekly Focus", "Reward", "Affirmation"].map(l => `
        <div class="card p-4"><p class="text-xs font-semibold text-gray-500 uppercase mb-2">${l}</p>
        <div class="week-skel week-skel-line"></div></div>`).join("")}
    </div>
    <div class="card mb-5 habit-trend-card" id="habit-trend">
      <div class="habit-trend-head">
        <div class="habit-trend-heading">
          <span class="habit-trend-spark" aria-hidden="true">
            <svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M2 14.5 6.5 9l3.5 3.5L18 4" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </span>
          <div>
            <p class="habit-trend-title">Consistency Trend</p>
            <p class="habit-trend-sub" id="habit-trend-sub">Share of ${scopeNoun()} completed each day this week</p>
          </div>
        </div>
        <div class="habit-trend-stats">
          <div class="habit-trend-stat"><span id="habit-trend-done">–</span><small>completed</small></div>
          <div class="habit-trend-stat"><span id="habit-trend-best">–</span><small>best day</small></div>
          <div class="habit-trend-stat is-primary"><span id="habit-trend-avg-value">–</span><small>week avg</small></div>
        </div>
      </div>
      <div class="habit-trend-canvas" id="habit-trend-plot"></div>
      <p class="habit-trend-empty hidden" id="habit-trend-empty"></p>
    </div>
    <div class="card mb-5" id="habit-tracker-card">
      <div class="card-header">Habit Tracker</div>
      <div class="overflow-x-auto" id="habit-scroll">
        <table class="w-full text-sm min-w-[640px]" id="habit-table">
          <thead>
            <tr class="text-left text-gray-500 border-b border-gray-100">
              <th class="p-3">Habit</th>
              ${DAY_LABELS.map(d => `<th class="p-3 text-center">${d}</th>`).join("")}
              <th class="p-3 w-40">Progress</th>
            </tr>
          </thead>
          <tbody id="habit-tracker-body"><tr><td colspan="9" class="p-6 text-center text-gray-400 text-sm">Loading this week…</td></tr></tbody>
        </table>
      </div>
    </div>
    <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4" id="week-day-cards"></div>
  `;

  // If a later navigation replaces the page while data is loading, these
  // async fills must not write into the new page — this node is the guard.
  const notesGrid = document.getElementById("week-notes-grid");

  // Load and fill in the background so render() isn't blocked (no spinner).
  (async () => {
    let summary;
    try {
      summary = await get(`/api/summary/week/${iso}`);
    } catch (err) {
      if (document.body.contains(notesGrid)) {
        const tb = document.getElementById("habit-tracker-body");
        if (tb) tb.innerHTML = `<tr><td colspan="9" class="p-4 text-red-500 text-sm">Couldn't load this week — ${esc(apiErrorMessage(err, "please try again."))}</td></tr>`;
      }
      return;
    }
    if (!document.body.contains(notesGrid)) return; // navigated away mid-load

    // weekly notes
    notesGrid.innerHTML =
      miniNoteCard("focus", "Weekly Focus", summary.weekly_note.focus_text) +
      miniNoteCard("reward", "Reward", summary.weekly_note.reward_text) +
      miniNoteCard("affirmation", "Affirmation", summary.weekly_note.affirmation_text);

  // habit tracker table
  const tbody = document.getElementById("habit-tracker-body");
  tbody.innerHTML = summary.habits.map(h => `
    <tr class="border-b border-gray-50" data-habit-row="${h.id}">
      <td class="p-3 font-medium">
        <div class="flex items-center gap-2">
          <span>${esc(h.title)}</span>
          <span class="text-gray-300 hover:text-gray-500 cursor-pointer text-xs" data-habit-edit="${h.id}" data-habit-title="${esc(h.title)}" title="Edit">✎</span>
          <span class="text-gray-300 hover:text-red-500 cursor-pointer text-xs" data-habit-delete="${h.id}" title="Delete">✕</span>
        </div>
      </td>
      ${DAY_LABELS.map((label, i) => {
        const d = addDays(state.weekStart, i);
        const dISO = toISO(d);
        const checked = h.week[label];
        return `<td class="p-3 text-center"><span class="checkbox mx-auto ${checked ? "checked" : ""}" data-toggle-habit="${h.id}" data-toggle-date="${dISO}"></span></td>`;
      }).join("")}
      <td class="p-3">
        <div class="flex items-center gap-2">
          <div class="progress-track flex-1"><div class="progress-fill" data-habit-progress-fill style="width:${h.progress_pct}%"></div></div>
          <span class="text-xs text-gray-500 w-9 text-right" data-habit-progress-text>${h.progress_pct}%</span>
        </div>
      </td>
    </tr>`).join("") || `<tr><td class="p-4 text-gray-400 text-sm" colspan="9">No habits yet — click "+ Habit" above.</td></tr>`;

  const pct = (c, t) => (t ? Math.round(c / t * 1000) / 10 : 0);

  // ---- consistency trend ---------------------------------------------------
  // Share of the selected scope's items completed on each day of the week,
  // drawn as a smooth area curve above the grid so the pattern (strong start,
  // weekend dip, …) reads at a glance instead of scanning 70 checkboxes.
  const trendValues = () => summary.days.map(d => scoped(d, "percent") ?? 0);

  function syncHabitTrend() {
    const trendEl = document.getElementById("habit-trend");
    const box = document.getElementById("habit-trend-plot");
    const emptyEl = document.getElementById("habit-trend-empty");
    const subEl = document.getElementById("habit-trend-sub");
    if (!trendEl || !box) return;
    if (subEl) subEl.textContent = `Share of ${scopeNoun()} completed each day this week`;

    const agg = summary.days.reduce((acc, d) => {
      acc.completed += scoped(d, "completed") || 0;
      acc.total += scoped(d, "total") || 0;
      return acc;
    }, { completed: 0, total: 0 });

    // Nothing tracked in this scope this week — say so rather than drawing a
    // flat zero line, which reads as "you failed" instead of "no data".
    if (!agg.total) {
      box.innerHTML = "";
      box.classList.add("hidden");
      if (emptyEl) {
        emptyEl.classList.remove("hidden");
        emptyEl.textContent = state.scope === "task"
          ? "No one-off tasks scheduled this week."
          : state.scope === "habit"
            ? "No habits tracked yet this week — add one with “+ Habit”."
            : "Nothing tracked yet this week.";
      }
      setTrendStat("habit-trend-done", "–");
      setTrendStat("habit-trend-best", "–");
      setTrendStat("habit-trend-avg-value", "–");
      return;
    }
    box.classList.remove("hidden");
    if (emptyEl) emptyEl.classList.add("hidden");

    const vals = trendValues();
    const bestIdx = vals.reduce((best, v, i) => (v > vals[best] ? i : best), 0);
    setTrendStat("habit-trend-done", `${agg.completed}/${agg.total}`);
    setTrendStat("habit-trend-best", vals[bestIdx] > 0 ? `${DAY_LABELS[bestIdx]} · ${vals[bestIdx]}%` : "–");
    setTrendStat("habit-trend-avg-value", `${pct(agg.completed, agg.total)}%`);

    renderTrendChart(box, {
      labels: DAY_LABELS,
      values: vals,
      todayIndex: summary.days.findIndex(d => d.date === todayIso),
    });
  }
  function setTrendStat(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  // The habit grid is only meaningful when habits are in scope.
  const trackerCard = document.getElementById("habit-tracker-card");
  if (trackerCard) trackerCard.classList.toggle("hidden", state.scope === "task");

  // The chart is sized in CSS and redrawn whenever its box changes, so it
  // stays crisp through window resizes and sidebar collapses without the SVG
  // ever being scaled.
  if (window.__habitTrendRO) { window.__habitTrendRO.disconnect(); window.__habitTrendRO = null; }
  if (window.ResizeObserver) {
    let queued = false;
    const ro = new ResizeObserver(() => {
      const el = document.getElementById("habit-trend-plot");
      if (!el) { ro.disconnect(); return; }
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => { queued = false; syncHabitTrend(); });
    });
    ro.observe(document.getElementById("habit-trend-plot"));
    window.__habitTrendRO = ro;
  }

  syncHabitTrend();
  requestAnimationFrame(syncHabitTrend);
  if (document.fonts?.ready) document.fonts.ready.then(syncHabitTrend);

  // ---- in-place UI updates -------------------------------------------------
  // A checkbox click used to call render(), which re-fetched the week summary
  // plus all 7 days of tasks and rebuilt every chart from scratch — that's why
  // it looked like the page was reloading. Instead we now apply the change to
  // the summary we already have and repaint only the numbers that moved.
  function syncDayCardUI(i) {
    const d = summary.days[i];
    const done = scoped(d, "completed") || 0;
    const total = scoped(d, "total") || 0;
    const pctEl = document.getElementById(`week-daypct-${i}`);
    const doneEl = document.getElementById(`week-daydone-${i}`);
    const leftEl = document.getElementById(`week-dayleft-${i}`);
    if (pctEl) pctEl.textContent = `${pct(done, total)}%`;
    if (doneEl) doneEl.textContent = `Completed: ${done}`;
    if (leftEl) leftEl.textContent = `Left: ${total - done}`;
    updateDonutValue(`week-donut-${i}`, pct(done, total));
  }

  // Called for both habit and task toggles. `kind` keeps the per-scope counts
  // in step with the combined ones, so switching tabs after a few clicks shows
  // numbers that still add up.
  function applyCompletionDelta(dayIndex, delta, kind) {
    const d = summary.days[dayIndex];
    if (!d) return;
    d.completed += delta;
    d.percent = pct(d.completed, d.total);
    if (kind === "habit" || kind === "task") {
      d[`${kind}_completed`] = (d[`${kind}_completed`] || 0) + delta;
      d[`${kind}_percent`] = pct(d[`${kind}_completed`], d[`${kind}_total`] || 0);
    }
    summary.completed += delta;
    summary.percent = pct(summary.completed, summary.total);
    syncDayCardUI(dayIndex);
    syncHabitTrend();
  }

  function applyHabitToggle(habitId, dayIndex, nowChecked) {
    if (dayIndex < 0) return;
    const habit = summary.habits.find(h => String(h.id) === String(habitId));
    if (habit) {
      habit.week[DAY_LABELS[dayIndex]] = nowChecked;
      const doneCount = DAY_LABELS.filter(l => habit.week[l]).length;
      habit.progress_pct = pct(doneCount, 7);
      const row = tbody.querySelector(`[data-habit-row="${habit.id}"]`);
      if (row) {
        const fill = row.querySelector("[data-habit-progress-fill]");
        const text = row.querySelector("[data-habit-progress-text]");
        if (fill) fill.style.width = `${habit.progress_pct}%`;
        if (text) text.textContent = `${habit.progress_pct}%`;
      }
    }
    applyCompletionDelta(dayIndex, nowChecked ? 1 : -1, "habit");
  }

  tbody.querySelectorAll("[data-toggle-habit]").forEach(el => {
    el.addEventListener("click", async () => {
      const nowChecked = !el.classList.contains("checked");
      const dayIndex = summary.days.findIndex(d => d.date === el.dataset.toggleDate);
      // Paint the change instantly, then confirm with the server.
      el.classList.toggle("checked");
      applyHabitToggle(el.dataset.toggleHabit, dayIndex, nowChecked);
      try {
        await post(`/api/habits/${el.dataset.toggleHabit}/toggle?for_date=${el.dataset.toggleDate}`);
      } catch (err) {
        console.error(err);
        el.classList.toggle("checked");
        applyHabitToggle(el.dataset.toggleHabit, dayIndex, !nowChecked);
        showToast("Couldn't save that change", "error");
      }
    });
  });
  tbody.querySelectorAll("[data-habit-edit]").forEach(el => {
    el.addEventListener("click", async () => {
      const newTitle = await showPromptModal({ title: "Edit Habit", label: "Habit name", initialValue: el.dataset.habitTitle });
      if (newTitle && newTitle !== el.dataset.habitTitle) {
        try {
          await patch(`/api/habits/${el.dataset.habitEdit}`, { title: newTitle });
          showToast("Habit updated", "success");
          render();
        } catch (err) {
          handleWriteError(err, { genericMsg: "Couldn't rename habit — please try again." });
        }
      }
    });
  });
  tbody.querySelectorAll("[data-habit-delete]").forEach(el => {
    el.addEventListener("click", async () => {
      const ok = await showConfirmModal({ title: "Delete Habit", message: "This also removes its tracked history. This can't be undone." });
      if (ok) {
        await del(`/api/habits/${el.dataset.habitDelete}`);
        showToast("Habit deleted", "success");
        render();
      }
    });
  });

  // Day cards. These exist to show each day's one-off task list alongside its
  // ring — under the Habits tab there are no tasks to list, and the grid above
  // already says everything the rings would, so the whole row is dropped (and
  // its seven requests skipped with it).
  const dayCardsEl = document.getElementById("week-day-cards");
  if (state.scope === "habit") {
    dayCardsEl.classList.add("hidden");
    return;
  }
  dayCardsEl.classList.remove("hidden");
  dayCardsEl.innerHTML = summary.days.map((d, i) => `<div class="card" id="week-daycard-${i}"></div>`).join("");

  // These 7 requests are independent, so fire them all at once rather than
  // awaiting each in turn — this alone turns 7 sequential round-trips into
  // roughly one.
  const allDayTasks = await Promise.all(summary.days.map(d => get(`/api/tasks?for_date=${d.date}`)));

  // The user may have navigated away while those were in flight, in which
  // case this view's DOM has already been torn down by a newer render().
  if (!document.body.contains(dayCardsEl)) return;

  summary.days.forEach((d, i) => {
    const dateObj = addDays(state.weekStart, i);
    const card = document.getElementById(`week-daycard-${i}`);
    if (!card) return;
    const done = scoped(d, "completed") || 0;
    const total = scoped(d, "total") || 0;
    const dayPct = pct(done, total);
    card.innerHTML = `
      <div class="card-header flex items-center justify-between">
        <span>${dateObj.toLocaleDateString(undefined, { weekday: "long" })}</span>
        <span class="text-white/60 text-xs">${dateObj.toLocaleDateString()}</span>
      </div>
      <div class="p-4 flex flex-col items-center">
        <div class="donut-wrap donut-sm">
          <canvas id="week-donut-${i}"></canvas>
          <div class="absolute inset-0 flex items-center justify-center text-sm font-bold" id="week-daypct-${i}">${dayPct}%</div>
        </div>
      </div>
      <div class="task-list-${i}"></div>
      <div class="text-xs text-gray-500 flex justify-between px-4 py-2 border-t border-gray-100">
        <span id="week-daydone-${i}">Completed: ${done}</span><span id="week-dayleft-${i}">Left: ${total - done}</span>
      </div>
    `;
    donutChart(`week-donut-${i}`, dayPct, "", 90);
    renderTaskList(card.querySelector(`.task-list-${i}`), allDayTasks[i], (completed) => {
      applyCompletionDelta(i, completed ? 1 : -1, "task");
    });
  });
  })();
}

function miniNoteCard(key, label, value) {
  return `<div class="card p-4">
    <p class="text-xs font-semibold text-gray-500 uppercase mb-2">${label}</p>
    <div class="flex gap-2">
      <input type="text" data-note-field="${key}" value="${esc(value || "")}" placeholder="${esc(label)}..." />
      <button class="btn btn-primary" data-note-save="${key}">Save</button>
    </div>
  </div>`;
}

document.addEventListener("click", async (e) => {
  if (e.target.matches("[data-note-save]")) {
    const key = e.target.dataset.noteSave;
    const input = document.querySelector(`[data-note-field="${key}"]`);
    const fieldMap = { focus: "focus_text", reward: "reward_text", affirmation: "affirmation_text" };
    await put(`/api/weekly-notes/${toISO(state.weekStart)}`, { [fieldMap[key]]: input.value });
    e.target.textContent = "Saved ✓";
    setTimeout(() => { e.target.textContent = "Save"; }, 1200);
  }
});

// ============================================================================
// MONTH VIEW
// ============================================================================
function renderMonthControls(controls) {
  const years = Array.from({ length: 8 }, (_, i) => new Date().getFullYear() - 4 + i);
  const now = new Date();
  controls.innerHTML = dateNav({
    prevId: "month-prev", nextId: "month-next", todayId: "month-today", todayLabel: "This month",
    isCurrent: state.monthMonth === now.getMonth() + 1 && state.monthYear === now.getFullYear(),
    body: `
      <select id="month-select" class="date-nav-select">${MONTH_NAMES.map((m, i) => `<option value="${i + 1}" ${i + 1 === state.monthMonth ? "selected" : ""}>${m}</option>`).join("")}</select>
      <select id="month-year-select" class="date-nav-select is-year">${years.map(y => `<option value="${y}" ${y === state.monthYear ? "selected" : ""}>${y}</option>`).join("")}</select>`,
  });
  controls.querySelector("#month-prev").onclick = () => { shiftMonth(-1); render(); };
  controls.querySelector("#month-next").onclick = () => { shiftMonth(1); render(); };
  controls.querySelector("#month-today").onclick = () => {
    state.monthMonth = now.getMonth() + 1; state.monthYear = now.getFullYear(); render();
  };
  controls.querySelector("#month-select").onchange = (e) => { state.monthMonth = Number(e.target.value); render(); };
  controls.querySelector("#month-year-select").onchange = (e) => { state.monthYear = Number(e.target.value); render(); };
}
function shiftMonth(delta) {
  let m = state.monthMonth + delta, y = state.monthYear;
  if (m < 1) { m = 12; y -= 1; } if (m > 12) { m = 1; y += 1; }
  state.monthMonth = m; state.monthYear = y;
}

async function renderMonth(content) {
  const summary = await get(`/api/summary/month/${state.monthYear}/${state.monthMonth}`);
  const firstDay = new Date(state.monthYear, state.monthMonth - 1, 1);
  const leadingBlank = (firstDay.getDay() + 6) % 7; // Monday-start offset
  const todayISO = toISO(new Date());

  // Every figure below comes from the block matching the active Habits/Tasks/
  // All tab, so the three tabs are three genuinely separate dashboards rather
  // than one set of numbers with a filter painted over it.
  const agg = scopeAgg(summary);
  const noun = scopeNoun();
  const dayPct = d => scoped(d, "percent");
  const dayTotal = d => scoped(d, "total") || 0;
  const dayDone = d => scoped(d, "completed") || 0;

  const delta = agg.percent_change_vs_previous_month;
  const deltaText = delta == null ? ""
    : delta >= 0
      ? `<span class="text-emerald-600">▲ ${delta}%</span> vs last month`
      : `<span class="text-red-500">▼ ${Math.abs(delta)}%</span> vs last month`;

  content.innerHTML = `
    <div class="grid grid-cols-1 md:grid-cols-4 gap-5 mb-5">
      ${statCard(`Month Total${state.scope === "all" ? "" : ` · ${noun}`}`, `${agg.percent}%`, deltaText || "no prior data")}
      ${statCard("Current Streak", `${agg.current_streak}d`, `days in a row with ${noun} done`)}
      ${statCard("Best Day", agg.best_day ? `${dayPct(agg.best_day)}%` : "—", agg.best_day ? fmtNice(fromISO(agg.best_day.date)) : "no data yet")}
      ${statCard("Toughest Day", agg.worst_day ? `${dayPct(agg.worst_day)}%` : "—", agg.worst_day ? fmtNice(fromISO(agg.worst_day.date)) : "no data yet")}
    </div>

    <div class="card mb-5">
      <div class="card-header flex items-center justify-between">
        <span>${MONTH_NAMES[state.monthMonth - 1]} ${state.monthYear}</span>
        <span class="flex items-center gap-3 text-[10px] font-normal text-white/60">
          <span class="flex items-center gap-1"><span class="w-2.5 h-2.5 rounded-sm inline-block" style="background:#EEF0F2"></span>no data</span>
          <span class="flex items-center gap-1"><span class="w-2.5 h-2.5 rounded-sm inline-block" style="background:#FBE3E3"></span>0%</span>
          <span class="flex items-center gap-1"><span class="w-2.5 h-2.5 rounded-sm inline-block" style="background:#3D5AFE"></span>100%</span>
        </span>
      </div>
      <div class="p-3 sm:p-5">
        <div class="cal-grid mb-1.5 text-[10px] font-semibold text-gray-400 text-center uppercase tracking-wide">
          ${DAY_LABELS.map(d => `<div class="py-1">${d}</div>`).join("")}
        </div>
        <div class="cal-grid" id="month-calendar"></div>
      </div>
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-3 gap-5 mb-5">
      <div class="card lg:col-span-2">
        <div class="card-header">Weekly Totals</div>
        <div class="p-5 dash-chart-box--lg"><canvas id="month-bar"></canvas></div>
      </div>
      <div class="card">
        <div class="card-header">Month Total</div>
        <div class="p-5 flex flex-col items-center">
          <div class="donut-wrap donut-md">
            <canvas id="month-donut"></canvas>
            <div class="absolute inset-0 flex items-center justify-center text-xl font-extrabold">${agg.percent}%</div>
          </div>
          <p class="text-xs text-gray-500 mt-3">${agg.completed} / ${agg.total} ${noun} completed</p>
        </div>
      </div>
    </div>
    <div class="grid grid-cols-1 ${state.scope === "task" ? "" : "lg:grid-cols-2"} gap-5">
      <div class="card">
        <div class="card-header">Which Days You're Strongest On</div>
        <div class="p-5 dash-chart-box"><canvas id="month-weekday-bar"></canvas></div>
      </div>
      ${state.scope === "task" ? "" : `
      <div class="card">
        <div class="card-header">Habit Leaderboard This Month</div>
        <div id="month-habit-leaderboard"></div>
      </div>`}
    </div>
  `;

  barChart("month-bar", agg.weeks.map((_, i) => `Wk ${i + 1}`), agg.weeks.map(w => w.completed), -1, null,
    (i) => goToWeek(agg.weeks[i].week_start));
  donutChart("month-donut", agg.percent);
  const weekRows = weeksByWeekday(summary.days, dayPct, dayTotal);
  const weekColors = ["#3D5AFE", "#7C9BFF", "#B9C6F5", "#7C5CFC", "#8E9CE8"];
  groupedBarChart("month-weekday-bar", DAY_LABELS, weekRows.map((w, i) => ({
    label: `Week ${i + 1}`,
    data: w.values,
    color: weekColors[i % weekColors.length],
  })));

  const monthLeaderboard = document.getElementById("month-habit-leaderboard");
  if (monthLeaderboard) monthLeaderboard.innerHTML = summary.per_habit.length ? summary.per_habit.map(h => `
    <div class="px-4 py-2.5 border-b border-gray-50 last:border-0">
      <div class="flex justify-between text-sm mb-1"><span class="font-medium">${esc(h.title)}</span><span class="text-gray-500">${h.percent}%</span></div>
      <div class="progress-track"><div class="progress-fill" style="width:${h.percent}%; background:${habitBarColor(h.percent)}"></div></div>
    </div>`).join("") : `<p class="text-sm text-gray-400 p-4">No habits tracked yet this month.</p>`;

  const calendar = document.getElementById("month-calendar");
  let html = "";
  for (let i = 0; i < leadingBlank; i++) html += `<div class="cal-cell cal-cell-empty"></div>`;
  summary.days.forEach((d) => {
    const isToday = d.date === todayISO;
    if (d.is_future) {
      html += `<button type="button" class="cal-cell cal-cell-future ${isToday ? "cal-cell-today" : ""}"
                  data-goto-day="${d.date}" title="Open ${fmtNice(fromISO(d.date))}">
        <span class="cal-daynum">${d.day}</span>
      </button>`;
      return;
    }
    const total = dayTotal(d);
    const done = dayDone(d);
    const percent = dayPct(d) || 0;
    const hasData = total > 0;
    const bg = !hasData ? "#EEF0F2" : percent === 0 ? "#FBE3E3" : `rgba(61,90,254,${0.12 + (percent / 100) * 0.78})`;
    const numColor = hasData && percent >= 55 ? "#0F1216" : "#171A1F";
    html += `<button type="button" class="cal-cell ${isToday ? "cal-cell-today" : ""}" style="background:${bg}"
                data-goto-day="${d.date}"
                title="${fmtNice(fromISO(d.date))}: ${done}/${total} ${noun} completed (${percent}%) — click to open">
      <span class="cal-daynum" style="color:${numColor}">${d.day}</span>
      ${hasData ? `
        <span class="cal-pct">${percent}%</span>
        <div class="cal-mini-track"><div class="cal-mini-fill" style="width:${percent}%"></div></div>
      ` : `<span class="cal-pct cal-pct-muted">—</span>`}
    </button>`;
  });
  calendar.innerHTML = html;
  calendar.querySelectorAll("[data-goto-day]").forEach(el => {
    el.addEventListener("click", () => goToDay(el.dataset.gotoDay));
  });
}

// ============================================================================
// YEAR VIEW
// ============================================================================
function renderYearControls(controls) {
  const thisYear = new Date().getFullYear();
  controls.innerHTML = dateNav({
    prevId: "year-prev", nextId: "year-next", todayId: "year-today", todayLabel: "This year",
    isCurrent: state.year === thisYear,
    body: `<span class="date-nav-label">${state.year}</span>`,
  });
  controls.querySelector("#year-prev").onclick = () => { state.year -= 1; render(); };
  controls.querySelector("#year-next").onclick = () => { state.year += 1; render(); };
  controls.querySelector("#year-today").onclick = () => { state.year = thisYear; render(); };
}

async function renderYear(content) {
  const summary = await get(`/api/summary/year/${state.year}`);
  // Scoped to the active Habits/Tasks/All tab — see scopeAgg/scoped.
  const agg = scopeAgg(summary);
  const noun = scopeNoun();
  const monthPct = m => scoped(m, "percent");
  const monthTotal = m => scoped(m, "total") || 0;
  const worstMonth = agg.worst_month;

  content.innerHTML = `
    <div class="grid grid-cols-1 md:grid-cols-4 gap-5 mb-5">
      ${statCard(`Year Total${state.scope === "all" ? "" : ` · ${noun}`}`, `${agg.percent}%`, `${agg.completed} / ${agg.total} completed`)}
      ${statCard("Longest Streak", `${agg.longest_streak}d`, `current: ${agg.current_streak}d`)}
      ${statCard("Best Month", agg.best_month ? agg.best_month.name : "—", agg.best_month ? `${monthPct(agg.best_month)}%` : "no data yet")}
      ${state.scope === "task"
        ? statCard("Toughest Month", worstMonth ? worstMonth.name : "—", worstMonth ? `${monthPct(worstMonth)}%` : "no data yet")
        : statCard("Best Habit", summary.best_habit ? summary.best_habit.title : "—", summary.best_habit ? `${summary.best_habit.percent}%` : "no habits yet")}
    </div>
    <div class="grid grid-cols-1 lg:grid-cols-3 gap-5 mb-5">
      <div class="card lg:col-span-2">
        <div class="card-header">Monthly Progress — ${state.year}</div>
        <div class="p-5 dash-chart-box--lg"><canvas id="year-bar"></canvas></div>
      </div>
      <div class="card">
        <div class="card-header">Year Total</div>
        <div class="p-5 flex flex-col items-center">
          <div class="donut-wrap donut-md">
            <canvas id="year-donut"></canvas>
            <div class="absolute inset-0 flex items-center justify-center text-xl font-extrabold">${agg.percent}%</div>
          </div>
          <p class="text-xs text-gray-500 mt-3">${agg.completed} / ${agg.total} ${noun} completed</p>
        </div>
      </div>
    </div>
    ${state.scope === "task" ? "" : `
    <div class="card mb-5">
      <div class="card-header">Habit Leaderboard This Year</div>
      <div id="year-habit-leaderboard"></div>
      ${summary.needs_focus_habit ? `<div class="px-4 py-3 border-t border-gray-100 text-xs text-gray-500">
        <span class="font-semibold text-navy">Needs focus:</span> ${esc(summary.needs_focus_habit.title)} (${summary.needs_focus_habit.percent}%)
      </div>` : ""}
    </div>`}
    <div class="card">
      <div class="card-header">Month Breakdown</div>
      <div class="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-3 p-5" id="year-months"></div>
    </div>
  `;
  barChart("year-bar", summary.months.map(m => m.name), summary.months.map(m => monthPct(m) || 0), -1, null,
    (i) => goToMonth(state.year, summary.months[i].month));
  donutChart("year-donut", agg.percent);

  const yearLeaderboard = document.getElementById("year-habit-leaderboard");
  if (yearLeaderboard) yearLeaderboard.innerHTML = summary.per_habit.length ? summary.per_habit.map(h => `
    <div class="px-4 py-2.5 border-b border-gray-50 last:border-0">
      <div class="flex justify-between text-sm mb-1"><span class="font-medium">${esc(h.title)}</span><span class="text-gray-500">${h.percent}%</span></div>
      <div class="progress-track"><div class="progress-fill" style="width:${h.percent}%; background:${habitBarColor(h.percent)}"></div></div>
    </div>`).join("") : `<p class="text-sm text-gray-400 p-4">No habits tracked yet this year.</p>`;

  document.getElementById("year-months").innerHTML = summary.months.map(m => {
    const [mr, mg, mb] = accentRgb();
    const isDark = document.documentElement.getAttribute("data-theme") === "dark";
    // Empty/future cells are still the accent hue, just faint — but on dark the
    // label has to be a *lighter* tint of the accent (a darker one disappears
    // against the panel), and the tint backgrounds need more alpha to read.
    const mix = (t) => `rgb(${Math.round(mr + (255 - mr) * t)},${Math.round(mg + (255 - mg) * t)},${Math.round(mb + (255 - mb) * t)})`;
    const mutedText = isDark ? mix(0.45) : `rgb(${Math.round(mr * 0.45)},${Math.round(mg * 0.45)},${Math.round(mb * 0.5)})`;

    if (m.is_future) {
      const futureBg = isDark ? `rgba(${mr},${mg},${mb},0.14)` : `rgba(${mr},${mg},${mb},0.06)`;
      const futureText = isDark ? mix(0.3) : `rgba(${mr},${mg},${mb},0.45)`;
      return `<button type="button" class="year-month-tile" data-goto-month="${m.month}" title="Open ${m.name} ${state.year}"
        style="background:${futureBg}; color:${futureText}; opacity:${isDark ? 0.75 : 1}"><p class="font-bold text-sm">${m.name}</p><p class="text-xs mt-1">—</p></button>`;
    }

    const total = monthTotal(m);
    const percent = monthPct(m) || 0;
    const bg = total === 0
      ? `rgba(${mr},${mg},${mb},${isDark ? 0.22 : 0.12})`
      : `rgba(${mr},${mg},${mb},${(isDark ? 0.28 : 0.15) + (percent / 100) * (isDark ? 0.72 : 0.75)})`;
    // On dark, once the fill is strong enough the tile reads as solid accent, so
    // white text wins earlier than it does on light.
    const solid = total !== 0 && percent > (isDark ? 30 : 45);
    const textColor = solid ? "#fff" : mutedText;
    return `<button type="button" class="year-month-tile" data-goto-month="${m.month}"
        title="Open ${m.name} ${state.year} — ${total ? `${percent}% of ${noun} completed` : "no data"}"
        style="background:${bg}; color:${textColor}">
      <p class="font-bold text-sm">${m.name}</p><p class="text-xs mt-1">${total ? percent + "%" : "no data"}</p>
    </button>`;
  }).join("");

  document.getElementById("year-months").querySelectorAll("[data-goto-month]").forEach(el => {
    el.addEventListener("click", () => goToMonth(state.year, Number(el.dataset.gotoMonth)));
  });
}

// ============================================================================
// JOB APPLICATIONS
// ============================================================================
const STATUS_LABELS = {
  applied: "Applied", oa_test: "OA / Test", phone_screen: "Phone Screen",
  interview: "Interview", offer: "Offer", rejected: "Rejected",
  ghosted: "Ghosted", withdrawn: "Withdrawn",
};
const STATUS_COLORS = {
  applied: "bg-gray-100 text-gray-700", oa_test: "bg-blue-100 text-blue-700",
  phone_screen: "bg-indigo-100 text-indigo-700", interview: "bg-amber-100 text-amber-700",
  offer: "bg-emerald-100 text-emerald-700", rejected: "bg-red-100 text-red-700",
  ghosted: "bg-gray-200 text-gray-500", withdrawn: "bg-gray-200 text-gray-500",
};
const KANBAN_ACCENTS = {
  applied: "#3D5AFE", oa_test: "#7C5CFC", phone_screen: "#0EA5E9", interview: "#E0A93E",
  offer: "#1FAE6B", rejected: "#E5484D", ghosted: "#93968E", withdrawn: "#93968E",
};

// Deterministic company-initial avatar color, cycling through the same
// palette as the landing page's kanban mockup — so a given company always
// gets the same color, and the board has that same playful multi-color look.
const COMPANY_AVATAR_COLORS = ["#3D5AFE", "#7C5CFC", "#FF6A3D", "#1FAE6B", "#E0A93E"];
function companyAvatar(companyName, size) {
  const name = (companyName || "?").trim();
  const initials = name.split(/\s+/).map(w => w[0]).join("").slice(0, 2).toUpperCase() || "?";
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  const color = COMPANY_AVATAR_COLORS[hash % COMPANY_AVATAR_COLORS.length];
  const cls = size === "lg" ? "company-avatar company-avatar--lg" : "company-avatar";
  return `<div class="${cls}" style="background:${color}">${initials}</div>`;
}
function atsPillClass(score) {
  if (score == null) return "";
  if (score >= 75) return "ats-high";
  if (score >= 50) return "ats-mid";
  return "ats-low";
}

function tagChips(tagsStr, extraClass = "") {
  const tags = (tagsStr || "").split(",").map(t => t.trim()).filter(Boolean);
  if (!tags.length) return "";
  return `<div class="flex flex-wrap gap-1 mt-1">${tags.map(t => `<span class="tag-chip ${extraClass}">${esc(t)}</span>`).join("")}</div>`;
}

function extensionPanelContent() {
  return `
    <p class="text-sm text-gray-600 mb-4">
      Install the Momentum Tracker extension to capture the job posting you're looking at
      with one click. It scrapes the role, company, location, and description straight off
      the page, saves it here, and can auto-generate a tailored resume and cover letter for it.
    </p>
    <a class="btn btn-accent w-full justify-center mb-4" href="downloads/momentum-tracker-extension.zip" download>⬇️ Download Extension (.zip)</a>
    <h3 class="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Installation steps</h3>
    <ol class="text-xs text-gray-500 leading-relaxed space-y-2 list-decimal pl-4">
      <li>Unzip the downloaded file.</li>
      <li>Open <code>chrome://extensions</code> in Chrome, and enable <strong>Developer mode</strong> (top-right toggle).</li>
      <li>Click <strong>Load unpacked</strong> and select the unzipped extension folder.</li>
      <li>Click the extension icon, open <strong>Settings</strong>, and set the backend URL to: <code>${API_BASE}</code></li>
      <li>Log in with your Momentum Tracker account, browse to a job posting, and click <strong>Capture This Job</strong>.</li>
    </ol>
  `;
}

function openExtensionPanel() {
  const panel = document.getElementById("ext-panel");
  const backdrop = document.getElementById("ext-panel-backdrop");
  document.getElementById("ext-panel-body").innerHTML = extensionPanelContent();
  backdrop.classList.remove("hidden");
  panel.classList.add("open");
  panel.setAttribute("aria-hidden", "false");
}
function closeExtensionPanel() {
  const panel = document.getElementById("ext-panel");
  const backdrop = document.getElementById("ext-panel-backdrop");
  panel.classList.remove("open");
  panel.setAttribute("aria-hidden", "true");
  backdrop.classList.add("hidden");
}
document.getElementById("ext-panel-btn")?.addEventListener("click", () => { openExtensionPanel(); closeSidebar(); });
document.getElementById("ext-panel-close")?.addEventListener("click", closeExtensionPanel);
document.getElementById("ext-panel-backdrop")?.addEventListener("click", closeExtensionPanel);

// Make the kanban board fill down to the bottom of the viewport instead of
// stopping short and leaving dead space below (most obvious when columns are
// empty). We measure the board's current top and size each column to reach the
// screen bottom; columns keep their own internal scroll when they overflow.
function stretchKanbanToBottom() {
  const board = document.querySelector(".kanban-board");
  if (!board) return;
  const rect = board.getBoundingClientRect();
  const h = Math.max(Math.round(window.innerHeight - Math.max(rect.top, 0) - 24), 340);
  board.style.minHeight = h + "px";
  board.querySelectorAll(".kanban-column").forEach(c => {
    c.style.height = h + "px";
    c.style.minHeight = h + "px";
    c.style.maxHeight = "none";
  });
}
// Window-level listeners for the kanban card drag. Held out here, at module
// scope, because wireKanbanCardDrag is re-created along with its enclosing
// closure on every board render — hanging the registry off the function
// object would hand each render a fresh, empty one and quietly accumulate a
// full set of listeners per render.
let _kanbanDragListeners = null;

let _kanbanResizeRaf = null;
window.addEventListener("resize", () => {
  if (_kanbanResizeRaf) cancelAnimationFrame(_kanbanResizeRaf);
  _kanbanResizeRaf = requestAnimationFrame(stretchKanbanToBottom);
});

async function renderJobs(content) {
  let boards = await get(`/api/boards`);
  const savedBoardId = Number(localStorage.getItem("momentum_active_board"));
  let activeBoardId = boards.find(b => b.id === savedBoardId)?.id
    || boards.find(b => b.is_default)?.id
    || boards[0]?.id;

  // Board tabs + the List/Kanban toggle live in the page header next to the
  // "Job Applications" title, and the New Board / New Application buttons sit
  // in the header's control area — so the body starts straight at the content
  // instead of three stacked rows of chrome above it.
  const jobsView = { mode: (() => {
    const saved = localStorage.getItem("momentum_jobs_view");
    return (saved === "list" || saved === "kanban") ? saved : "kanban"; // kanban is the default
  })() };
  let currentResumes = [];
  let rerenderCurrentView = () => {};

  document.getElementById("view-tabs-slot").innerHTML = `
    <div class="jobs-header-bar">
      <div class="board-tabs-row" id="board-tabs"></div>
      <span class="jobs-header-sep"></span>
      <div class="view-tabs" id="jobs-view-tabs">
        <button type="button" class="view-tab ${jobsView.mode === "kanban" ? "active" : ""}" data-jobs-view="kanban">▦ Kanban</button>
        <button type="button" class="view-tab ${jobsView.mode === "list" ? "active" : ""}" data-jobs-view="list">☰ List</button>
      </div>
      <span class="jobs-header-sep"></span>
      <div class="jobs-filter-row">
        <input type="text" id="job-filter" class="jobs-filter-input" placeholder="Filter by company, skill, or tag..." />
        <select id="job-tag-filter" class="jobs-filter-select"><option value="">All tags</option></select>
      </div>
    </div>`;

  document.getElementById("header-controls").innerHTML = `
    <button type="button" class="btn btn-board-add shrink-0" id="add-board-btn">+ New Board</button>
    <button type="button" class="btn btn-accent shrink-0" id="open-add-job">+ New Application</button>`;

  document.querySelectorAll("[data-jobs-view]").forEach(el => {
    el.addEventListener("click", () => {
      jobsView.mode = el.dataset.jobsView;
      localStorage.setItem("momentum_jobs_view", jobsView.mode);
      document.querySelectorAll("[data-jobs-view]").forEach(b => b.classList.toggle("active", b.dataset.jobsView === jobsView.mode));
      rerenderCurrentView();
    });
  });

  document.getElementById("open-add-job").addEventListener("click", () => {
    openAddJobPage(currentResumes, activeBoardId, boards, async () => {
      boards = await get(`/api/boards`);
      renderBoardTabs();
      loadBoard();
    });
  });

  content.innerHTML = `<div id="jobs-board-content"><div class="spinner"></div></div>`;

  // Each board gets a stable dot color so it's recognisable at a glance in the
  // dropdown (and on the collapsed trigger).
  const BOARD_DOT_COLORS = ["#3D5AFE", "#7C5CFC", "#0EA5E9", "#1FAE6B", "#E0A93E", "#E5484D", "#14B8A6", "#EC4899"];
  const boardDot = (id) => BOARD_DOT_COLORS[Math.abs(Number(id) || 0) % BOARD_DOT_COLORS.length];

  // The header's left zone clips its overflow so a long page title truncates.
  // The dropdown is absolutely positioned inside that zone, so it has to lift
  // the clipping while it's open or the menu is invisible.
  function setHeaderOverflow(open) {
    document.querySelector(".hdr-zone-left")?.classList.toggle("hdr-zone-left--menu-open", open);
  }

  function closeBoardMenu() {
    const menu = document.getElementById("board-select-menu");
    const trigger = document.getElementById("board-select-trigger");
    setHeaderOverflow(false);
    if (!menu) return;
    menu.classList.remove("open");
    trigger?.setAttribute("aria-expanded", "false");
  }
  // Bound once — clicking anywhere outside the dropdown dismisses it.
  if (!window.__boardMenuOutsideBound) {
    window.__boardMenuOutsideBound = true;
    document.addEventListener("click", (e) => {
      if (!e.target.closest("#board-select")) closeBoardMenu();
    });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeBoardMenu(); });
  }

  function renderBoardTabs() {
    const active = boards.find(b => b.id === activeBoardId) || boards[0];
    const host = document.getElementById("board-tabs");
    if (!host) return;   // called from an async callback after navigating away

    // A single board needs no picker — just show it as a static chip.
    if (boards.length <= 1) {
      host.innerHTML = active ? `
        <div class="board-tab active" style="cursor:default">
          <span class="board-dot" style="background:${boardDot(active.id)}"></span>
          <span>${esc(active.name)}</span>
          <span class="board-tab-count">${active.job_count}</span>
        </div>` : "";
      return;
    }

    host.innerHTML = `
      <div class="board-select" id="board-select">
        <button type="button" class="board-select-trigger" id="board-select-trigger" aria-haspopup="listbox" aria-expanded="false">
          <span class="board-dot" style="background:${boardDot(active.id)}"></span>
          <span class="board-select-name">${esc(active.name)}</span>
          <span class="board-tab-count">${active.job_count}</span>
          <svg class="board-select-caret" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 4.5L6 8l3.5-3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
        <div class="board-select-menu" id="board-select-menu" role="listbox">
          <div class="board-select-head">Job Boards<span class="board-select-head-count">${boards.length}</span></div>
          <div class="board-select-list">
            ${boards.map(b => `
              <div class="board-option ${b.id === activeBoardId ? "selected" : ""}" role="option" aria-selected="${b.id === activeBoardId}" data-board-tab="${b.id}">
                <span class="board-dot" style="background:${boardDot(b.id)}"></span>
                <span class="board-option-name">${esc(b.name)}</span>
                <span class="board-tab-count">${b.job_count}</span>
                <span class="board-option-check">✓</span>
                <span class="board-option-delete" data-board-delete="${b.id}" data-board-name="${esc(b.name || "")}" title="Delete board">✕</span>
              </div>`).join("")}
          </div>
          <button type="button" class="board-select-add" id="board-select-add">
            <span class="board-select-add-icon">+</span> New Board
          </button>
        </div>
      </div>`;

    document.getElementById("board-select-trigger").addEventListener("click", (e) => {
      e.stopPropagation();
      const menu = document.getElementById("board-select-menu");
      const open = menu.classList.toggle("open");
      setHeaderOverflow(open);
      e.currentTarget.setAttribute("aria-expanded", open ? "true" : "false");
    });
    document.getElementById("board-select-add").addEventListener("click", () => {
      closeBoardMenu();
      document.getElementById("add-board-btn")?.click();
    });

    document.querySelectorAll("[data-board-tab]").forEach(el => {
      el.addEventListener("click", (e) => {
        if (e.target.closest("[data-board-delete]")) return;
        activeBoardId = Number(el.dataset.boardTab);
        localStorage.setItem("momentum_active_board", activeBoardId);
        closeBoardMenu();
        renderBoardTabs();
        loadBoard();
      });
    });
    document.querySelectorAll("[data-board-delete]").forEach(el => {
      el.addEventListener("click", async (e) => {
        e.stopPropagation();
        const ok = await showConfirmModal({
          title: "Delete Board",
          message: `Delete "${el.dataset.boardName}"? Its applications move to another board — nothing gets deleted.`,
        });
        if (!ok) return;
        const boardId = Number(el.dataset.boardDelete);
        const res = await del(`/api/boards/${boardId}`);
        boards = await get(`/api/boards`);
        if (activeBoardId === boardId) {
          activeBoardId = boards.find(b => b.is_default)?.id || boards[0]?.id;
          localStorage.setItem("momentum_active_board", activeBoardId);
        }
        showToast(`Board deleted — applications moved to ${res.reassigned_to_name}`, "success");
        renderBoardTabs();
        loadBoard();
      });
    });
  }

  document.getElementById("add-board-btn").addEventListener("click", async () => {
    const name = await showPromptModal({ title: "New Job Board", label: "Board name", placeholder: "e.g. Summer Internships" });
    if (!name) return;
    const board = await post(`/api/boards`, { name });
    boards.push(board);
    activeBoardId = board.id;
    localStorage.setItem("momentum_active_board", activeBoardId);
    renderBoardTabs();
    loadBoard();
    showToast(`Board "${board.name}" created`, "success");
  });

  async function loadBoard() {
    const boardContent = document.getElementById("jobs-board-content");
    if (!boardContent) return;          // page already replaced; nothing to fill
    boardContent.innerHTML = `<div class="spinner"></div>`;
    const [jobs, stats, resumes] = await Promise.all([
      get(`/api/jobs?board_id=${activeBoardId}`),
      get(`/api/jobs/stats/overview?board_id=${activeBoardId}`),
      get(`/api/resumes`),
    ]);
    // Leaving Applications before these resolve used to land here anyway and
    // write into a header that navigation had already torn down — which is
    // where "Cannot set properties of null" came from. The node still being in
    // the document is the test for "this render is still wanted".
    if (!boardContent.isConnected) return;
    currentResumes = resumes; // so the header's "+ New Application" can use them

    boardContent.innerHTML = `<div id="jobs-view-container"></div>`;

    // ============================================================
    // MANAGE VIEW — Add Application form + filters + List/Kanban
    // (Analytics now lives on the main Dashboard page — see renderDashboard.)
    // ============================================================
    function renderManageView() {
      const viewContainer = document.getElementById("jobs-view-container");
      viewContainer.innerHTML = `
        <div class="jobs-stats-row">
          <div class="mini-stat-card">
            <span class="mini-stat-icon" style="background:rgba(61,90,254,0.12);color:#3D5AFE;">📨</span>
            <div><p class="mini-stat-value">${stats.total}</p><p class="mini-stat-label">Total Applications</p></div>
          </div>
          <div class="mini-stat-card">
            <span class="mini-stat-icon" style="background:rgba(60,157,123,0.14);color:#3C9D7B;">↩️</span>
            <div><p class="mini-stat-value">${stats.response_rate}%</p><p class="mini-stat-label">Response Rate</p></div>
          </div>
          <div class="mini-stat-card">
            <span class="mini-stat-icon" style="background:rgba(228,163,53,0.16);color:#B4791F;">🗣️</span>
            <div><p class="mini-stat-value">${stats.interview_rate}%</p><p class="mini-stat-label">Interview Rate</p></div>
          </div>
          <div class="mini-stat-card">
            <span class="mini-stat-icon" style="background:rgba(124,92,252,0.14);color:#7C5CFC;">🎉</span>
            <div><p class="mini-stat-value">${stats.offers}</p><p class="mini-stat-label">Offers</p></div>
          </div>
        </div>
        <div id="jobs-table-container"></div>`;


      // populate tag filter dropdown from whatever tags exist across current jobs
      const allTags = [...new Set(jobs.flatMap(j => (j.tags || "").split(",").map(t => t.trim()).filter(Boolean)))].sort();
      const tagFilter = document.getElementById("job-tag-filter");
      if (tagFilter) {
        tagFilter.innerHTML =
          `<option value="">All tags</option>` + allTags.map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join("");
      }

      function scoreColor(score) {
        if (score >= 75) return "bg-emerald-100 text-emerald-700";
        if (score >= 50) return "bg-amber-100 text-amber-700";
        return "bg-red-100 text-red-700";
      }

      function openDetail(jobId) {
        openJobDetailPage(jobId, resumes, boards, async () => {
          boards = await get(`/api/boards`);
          renderBoardTabs();
          loadBoard();
        });
      }

      function wireCommonCardActions(scopeJobs) {
        document.querySelectorAll("[data-job-delete]").forEach(el => {
          el.addEventListener("click", async (e) => {
            e.stopPropagation();
            const ok = await showConfirmModal({ title: "Delete Application", message: `Remove your application to ${el.dataset.jobCompany}? This can't be undone.` });
            if (ok) { await del(`/api/jobs/${el.dataset.jobDelete}`); showToast("Application deleted", "success"); boards = await get(`/api/boards`); renderBoardTabs(); loadBoard(); }
          });
        });
        document.querySelectorAll("[data-ats-open]").forEach(el => {
          el.addEventListener("click", (e) => {
            e.stopPropagation();
            const job = scopeJobs.find(j => j.id === Number(el.dataset.atsOpen));
            openAtsModal(job, resumes);
          });
        });
        document.querySelectorAll("[data-view-cover]").forEach(el => {
          el.addEventListener("click", (e) => {
            e.stopPropagation();
            const job = scopeJobs.find(j => j.id === Number(el.dataset.viewCover));
            openCoverLetterModal(job, resumes);
          });
        });
        document.querySelectorAll("[data-job-open]").forEach(el => {
          el.addEventListener("click", (e) => {
            e.stopPropagation();
            openDetail(Number(el.dataset.jobOpen));
          });
        });
      }

      function renderListView(filtered) {
        const resumeMap = Object.fromEntries(resumes.map(r => [r.id, r.name]));
        document.getElementById("jobs-table-container").innerHTML = `
          <div class="card overflow-x-auto">
            <table class="w-full text-sm">
              <thead>
                <tr class="text-left text-gray-400 text-xs uppercase tracking-wide border-b border-gray-100">
                  <th class="p-3">Company</th><th class="p-3">Role</th><th class="p-3">Location</th><th class="p-3">Applied</th>
                  <th class="p-3">Status</th><th class="p-3">Tags</th><th class="p-3">Skills</th>
                  <th class="p-3">Resume</th><th class="p-3">ATS Score</th><th class="p-3">Cover Letter</th>
                  <th class="p-3"></th><th class="p-3"></th>
                </tr>
              </thead>
              <tbody class="divide-y divide-gray-50">
                ${filtered.map(j => `
                  <tr class="hover:bg-gray-50/60 cursor-pointer" data-job-open="${j.id}">
                    <td class="p-3 font-semibold text-navy" style="border-left:3px solid ${j.color || "transparent"};">${esc(j.company_name)}</td>
                    <td class="p-3">${esc(j.role_title)}</td>
                    <td class="p-3 text-gray-500">${esc(j.location) || "—"}</td>
                    <td class="p-3 text-gray-500">${j.date_applied}</td>
                    <td class="p-3">
                      <select class="!w-auto badge ${STATUS_COLORS[j.status]}" data-status-select="${j.id}" onclick="event.stopPropagation()">
                        ${Object.entries(STATUS_LABELS).map(([k, v]) => `<option value="${k}" ${k === j.status ? "selected" : ""}>${v}</option>`).join("")}
                      </select>
                    </td>
                    <td class="p-3">${tagChips(j.tags) || `<span class="text-gray-300">—</span>`}</td>
                    <td class="p-3 text-xs text-gray-500 max-w-[180px]">${esc(j.skills_required) || "—"}</td>
                    <td class="p-3 text-xs text-gray-500">${j.resume_id ? esc(resumeMap[j.resume_id] || "—") : "—"}</td>
                    <td class="p-3">
                      <button class="badge ${j.ats_score != null ? scoreColor(j.ats_score) : "bg-gray-100 text-gray-500"} cursor-pointer" data-ats-open="${j.id}" onclick="event.stopPropagation()">
                        ${j.ats_score != null ? j.ats_score + "%" : "Run check"}
                      </button>
                    </td>
                    <td class="p-3"><button class="text-navy underline text-xs" data-view-cover="${j.id}" onclick="event.stopPropagation()">${j.cover_letter ? "View" : "Generate"}</button></td>
                    <td class="p-3"><button class="text-navy hover:text-mint" data-job-open="${j.id}" title="Open">Open →</button></td>
                    <td class="p-3"><span class="text-gray-300 cursor-pointer" data-job-delete="${j.id}" data-job-company="${esc(j.company_name)}" onclick="event.stopPropagation()">✕</span></td>
                  </tr>`).join("") || `<tr><td colspan="12" class="p-6 text-center text-gray-400">No applications yet — click "+ New Application" to add your first one.</td></tr>`}
              </tbody>
            </table>
          </div>
        `;

        document.querySelectorAll("[data-status-select]").forEach(el => {
          el.addEventListener("change", async () => {
            const newStatus = el.value;
            await patch(`/api/jobs/${el.dataset.statusSelect}`, { status: newStatus });
            const job = filtered.find(j => j.id === Number(el.dataset.statusSelect));
            if (job) job.status = newStatus;
            applyFilters(); // redraw just the list/board, not the whole page
          });
        });
        wireCommonCardActions(filtered);
      }

      // ---- Kanban columns: 5 core stages every board has, plus any custom
      // columns the user adds. Custom columns are persisted per-board in
      // localStorage and stored on each card via `pipeline_stage`. Each
      // column maps to an underlying enum `status` (for analytics) — custom
      // columns inherit the status of whichever core group they're added near
      // (default "applied") so the funnel/stats stay coherent.
      const CORE_COLUMNS = [
        { key: "applied", label: "Applied", status: "applied", accent: "#4C6FE7", icon: "📨" },
        { key: "oa_test", label: "OA / Test", status: "oa_test", accent: "#7C5CFC", icon: "📝" },
        { key: "interview", label: "Interview", status: "interview", accent: "#E4A335", icon: "🗣️" },
        { key: "offer", label: "Offer", status: "offer", accent: "#3C9D7B", icon: "🎁" },
        { key: "rejected", label: "Rejected", status: "rejected", accent: "#E2604F", icon: "📁" },
      ];
      const customColsKey = `momentum_kanban_cols_${activeBoardId}`;
      const columnOrderKey = `momentum_kanban_order_${activeBoardId}`;
      function loadCustomColumns() {
        try { return JSON.parse(localStorage.getItem(customColsKey) || "[]"); } catch { return []; }
      }
      function saveCustomColumns(cols) { localStorage.setItem(customColsKey, JSON.stringify(cols)); }
      function loadColumnOrder() {
        try { return JSON.parse(localStorage.getItem(columnOrderKey) || "[]"); } catch { return []; }
      }
      function saveColumnOrder(order) { localStorage.setItem(columnOrderKey, JSON.stringify(order)); }

      function getColumns() {
        // core columns + custom; de-dupe custom keys against core
        const coreKeys = new Set(CORE_COLUMNS.map(c => c.key));
        const custom = loadCustomColumns().filter(c => !coreKeys.has(c.key));
        const all = [...CORE_COLUMNS, ...custom];
        // Apply the user's saved drag-reordering (persisted per board). Any
        // column missing from the saved order — e.g. a column added after the
        // last reorder — keeps its natural position at the end.
        const order = loadColumnOrder();
        if (order.length) {
          all.sort((a, b) => {
            const ia = order.indexOf(a.key), ib = order.indexOf(b.key);
            return (ia === -1 ? 1e9 : ia) - (ib === -1 ? 1e9 : ib);
          });
        }
        return all;
      }

      // Move a column so it lands in front of the one it was dropped on (the
      // accent bar during drag marks that leading edge), then persist and
      // re-render. Target index is recomputed after removal so the insert
      // position is correct whether dragging left or right.
      function reorderColumns(draggedKey, targetKey) {
        if (!draggedKey || !targetKey || draggedKey === targetKey) return;
        const keys = getColumns().map(c => c.key);
        const from = keys.indexOf(draggedKey);
        if (from === -1 || keys.indexOf(targetKey) === -1) return;
        const [moved] = keys.splice(from, 1);
        const insertAt = keys.indexOf(targetKey);
        keys.splice(insertAt, 0, moved);
        saveColumnOrder(keys);
        applyFilters();
      }

      // Which column a job belongs to: its custom pipeline_stage if that
      // column still exists, else its enum status mapped to a core column,
      // else the first core column.
      function columnKeyForJob(j, columns) {
        if (j.pipeline_stage && columns.some(c => c.key === j.pipeline_stage)) return j.pipeline_stage;
        const byStatus = columns.find(c => c.key === j.status) || CORE_COLUMNS.find(c => c.status === j.status);
        return byStatus ? byStatus.key : CORE_COLUMNS[0].key;
      }

      function renderKanbanView(filtered) {
        const columns = getColumns();
        const byCol = Object.fromEntries(columns.map(c => [c.key, []]));
        filtered.forEach(j => {
          const key = columnKeyForJob(j, columns);
          (byCol[key] || (byCol[key] = [])).push(j);
        });

        document.getElementById("jobs-table-container").innerHTML = `
          <div class="kanban-board">
            ${columns.map(col => `
              <div class="kanban-column" data-kanban-dropzone="${col.key}" style="--accent:${col.accent || "#93968E"}">
                <div class="kanban-column-header" draggable="true" data-kanban-colhead="${col.key}" title="Drag to reorder column">
                  <span class="kanban-col-title"><span class="kanban-col-grip" aria-hidden="true">⠿</span><span class="kanban-col-dot"></span>${esc(col.label)}</span>
                  <span class="flex items-center gap-1.5">
                    <span class="kanban-count">${byCol[col.key].length}</span>
                    ${col.custom ? `<span class="kanban-col-del" data-col-delete="${col.key}" title="Delete column">✕</span>` : ""}
                  </span>
                </div>
                <div class="kanban-column-body">
                  ${byCol[col.key].map(j => `
                    <div class="kanban-card" data-kanban-card="${j.id}" data-job-open="${j.id}" style="${j.color ? `border-left:3px solid ${j.color};` : ""}">
                      <div class="flex items-start justify-between gap-2 mb-2.5">
                        ${companyAvatar(j.company_name)}
                        <div class="flex items-center gap-1 shrink-0">
                          <span class="text-gray-300 hover:text-navy cursor-pointer text-sm leading-none" data-job-open="${j.id}" title="Open">⋮</span>
                          <span class="text-gray-300 hover:text-red-500 cursor-pointer text-[10px]" data-job-delete="${j.id}" data-job-company="${esc(j.company_name)}" onclick="event.stopPropagation()" title="Delete">✕</span>
                        </div>
                      </div>
                      <p class="text-sm font-bold text-navy leading-tight" style="font-family:var(--lp-disp,inherit);">${esc(j.role_title)}</p>
                      <p class="text-xs text-gray-500 mt-1">${esc(j.company_name)}</p>
                      ${tagChips(j.tags)}
                      <div class="flex items-center justify-between mt-2.5">
                        <span class="ats-pill ${atsPillClass(j.ats_score) || "bg-gray-100 text-gray-500"} cursor-pointer" data-ats-open="${j.id}" onclick="event.stopPropagation()">
                          ${j.ats_score != null ? "ATS " + j.ats_score : "ATS"}
                        </span>
                        ${j.salary_range ? `<span class="text-[9px] text-gray-400" style="font-family:var(--lp-mono,monospace);">${esc(j.salary_range)}</span>` : ""}
                      </div>
                      <div class="flex items-center justify-between mt-3 pt-2.5" style="border-top:1px solid #F2F3F5;">
                        <span class="text-[10px] text-gray-400 inline-flex items-center gap-1.5">
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 10h18"/></svg>
                          ${j.date_applied}
                        </span>
                        <button class="text-[10px] text-gray-400 hover:text-navy" data-view-cover="${j.id}" title="Cover letter" onclick="event.stopPropagation()">✍️</button>
                      </div>
                    </div>
                  `).join("")}
                  <!-- Always present, hidden by CSS while the body holds a
                       card or a drop placeholder. Rendering it conditionally
                       meant a column emptied by a drag had nothing to show
                       until the next full re-render. -->
                  <div class="kanban-empty">
                    <div class="kanban-empty-icon">${esc(col.icon || "📋")}</div>
                    <div class="kanban-empty-title">No ${esc(col.label.toLowerCase())} yet</div>
                    <div class="kanban-empty-sub">Drag applications here to move them into this stage.</div>
                  </div>
                </div>
                <button type="button" class="kanban-col-add" data-col-add="${col.key}">+ Add Application</button>
              </div>
            `).join("")}
            <div class="kanban-add-column">
              <button class="kanban-add-col-btn" id="kanban-add-col">+ Add column</button>
            </div>
          </div>
        `;

        wireCommonCardActions(filtered);
        wireKanbanDnD(columns, filtered);
        requestAnimationFrame(stretchKanbanToBottom);

        // per-column "+ Add Application" — reuses the same modal as the
        // header's "+ New Application" button
        document.querySelectorAll("[data-col-add]").forEach(btn => {
          btn.addEventListener("click", (e) => {
            e.stopPropagation();
            document.getElementById("open-add-job")?.click();
          });
        });

        // add-column
        document.getElementById("kanban-add-col")?.addEventListener("click", async () => {
          const name = await showPromptModal({ title: "New Column", label: "Column name", placeholder: "e.g. Phone Screen, Take-home, On-site" });
          if (!name) return;
          const key = "custom_" + name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") + "_" + Date.now().toString(36);
          const custom = loadCustomColumns();
          custom.push({ key, label: name.trim(), status: "applied", accent: JOB_COLOR_SWATCHES[custom.length % JOB_COLOR_SWATCHES.length], custom: true });
          saveCustomColumns(custom);
          applyFilters();
        });
        document.querySelectorAll("[data-col-delete]").forEach(el => {
          el.addEventListener("click", async (e) => {
            e.stopPropagation();
            const key = el.dataset.colDelete;
            const ok = await showConfirmModal({ title: "Delete Column", message: "Cards in this column will move back to Applied. Continue?" });
            if (!ok) return;
            // move any cards out of this custom column
            const affected = filtered.filter(j => j.pipeline_stage === key);
            await Promise.all(affected.map(j => patch(`/api/jobs/${j.id}`, { pipeline_stage: null, status: "applied" })));
            saveCustomColumns(loadCustomColumns().filter(c => c.key !== key));
            affected.forEach(j => { j.pipeline_stage = null; j.status = "applied"; });
            showToast("Column removed", "success");
            applyFilters();
          });
        });
      }

      // ---- Drag & drop.
      //
      // Columns are reordered with native HTML5 DnD (a header drag is a
      // coarse, infrequent gesture and the browser's own affordances are
      // fine for it). Cards are not: native DnD hands the browser a frozen
      // bitmap of the element at dragstart and never reports pointer
      // velocity, so tilt-by-direction, a spring settle, and a placeholder
      // that animates into position are all inexpressible with it. Cards
      // therefore run on raw pointer events — see wireKanbanCardDrag.
      function wireKanbanDnD(columns, filtered) {
        let draggedColumnKey = null;

        // ---- Column reordering: grab a column by its header and drop it onto
        // another column to move it there. Kept separate from card dragging
        // (cards live in the body) via the draggedColumnKey flag. ----
        document.querySelectorAll("[data-kanban-colhead]").forEach(header => {
          const column = header.closest(".kanban-column");
          header.addEventListener("dragstart", (e) => {
            draggedColumnKey = header.dataset.kanbanColhead;
            column.classList.add("kanban-col-dragging");
            e.dataTransfer.effectAllowed = "move";
            try { e.dataTransfer.setData("text/plain", "col:" + draggedColumnKey); } catch {}
          });
          header.addEventListener("dragend", () => {
            draggedColumnKey = null;
            document.querySelectorAll(".kanban-column").forEach(c => c.classList.remove("kanban-col-dragging", "kanban-col-drop-target"));
          });
        });

        document.querySelectorAll("[data-kanban-dropzone]").forEach(column => {
          // Column reordering only. Card drops never reach here — cards are
          // not `draggable`, so the browser fires no drag events for them.
          column.addEventListener("dragover", (e) => {
            if (!draggedColumnKey) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            // mark the column we'd drop in front of
            document.querySelectorAll(".kanban-column").forEach(c => c.classList.remove("kanban-col-drop-target"));
            if (column.dataset.kanbanDropzone !== draggedColumnKey) column.classList.add("kanban-col-drop-target");
          });
          column.addEventListener("dragleave", (e) => {
            // only clear when actually leaving the column (not moving onto a child)
            if (!column.contains(e.relatedTarget)) column.classList.remove("kanban-col-drop-target");
          });
          column.addEventListener("drop", (e) => {
            if (!draggedColumnKey) return;
            e.preventDefault();
            const dk = draggedColumnKey;
            draggedColumnKey = null;
            column.classList.remove("kanban-col-drop-target");
            reorderColumns(dk, column.dataset.kanbanDropzone);
          });
        });

        wireKanbanCardDrag(columns, filtered);
      }

      // ---- Card drag: pointer-driven, spring-animated ------------------
      //
      // Three states have to read distinctly: picked up, moving, dropped.
      //   picked up — the card scales to 1.03 and a soft shadow blooms under
      //     it while a placeholder takes over its slot, so the column never
      //     collapses under the cursor.
      //   moving    — the card trails the pointer by a couple of frames and
      //     tilts into that lag; the destination column tints and the
      //     placeholder slides between neighbours, which slide to make room.
      //   dropped   — everything springs back to rest as the card settles
      //     into the slot the placeholder was holding.
      //
      // The tilt is derived from how far the rendered card is *behind* the
      // pointer rather than from raw velocity. That quantity is already
      // proportional to speed, already signed by direction, and already
      // decays to zero the instant the pointer stops — so the card
      // straightens on its own without a separate rule saying it should.
      function wireKanbanCardDrag(columns, filtered) {
        const REDUCED = window.matchMedia
          ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
          : false;

        const TAP_SLOP = 5;      // px of travel before a press becomes a drag
        const TOUCH_HOLD = 190;  // ms of press-and-hold to start a drag by touch
        const TOUCH_SLOP = 12;   // px before that hold is read as a scroll instead
        const MAX_TILT = 3;      // degrees, hard ceiling in both directions
        const DRAG_SCALE = 1.03;
        const LAND_MS = 320;

        let pending = null;  // press that has not yet become a drag
        let drag = null;     // live drag, null when idle

        const clamp = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;

        // --- spring integrator ------------------------------------------
        // Semi-implicit Euler. Damping sits a shade under critical so each
        // value kisses its target rather than creeping up to it.
        const makeSpring = (value, k, c) => ({ value, target: value, v: 0, k, c });
        function stepSpring(s, dt) {
          const h = Math.min(dt, 0.032); // a stalled tab must not explode the spring
          s.v += (s.k * (s.target - s.value) - s.c * s.v) * h;
          s.value += s.v * h;
          return s.value;
        }

        // --- FLIP: let neighbours slide instead of teleporting -----------
        // Measure, mutate, then play the difference backwards. Everything
        // currently sitting in a column body participates, placeholder
        // included, so the slot itself glides between positions too.
        function flip(mutate) {
          if (REDUCED) { mutate(); return; }
          const els = Array.from(document.querySelectorAll(".kanban-column-body > *"));
          const before = new Map();
          els.forEach(el => before.set(el, el.getBoundingClientRect()));
          mutate();
          els.forEach(el => {
            if (!el.isConnected) return;
            const a = before.get(el), b = el.getBoundingClientRect();
            if (!a.height || !b.height) return; // was or became display:none
            const dx = a.left - b.left, dy = a.top - b.top;
            if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
            el.style.transition = "none";
            el.style.transform = `translate(${dx}px, ${dy}px)`;
            void el.offsetWidth; // flush, or the browser coalesces both frames
            el.style.transition = "transform 300ms cubic-bezier(.22,1,.36,1)";
            el.style.transform = "";
          });
        }
        const clearFlip = () => document.querySelectorAll(".kanban-column-body > *")
          .forEach(el => { el.style.transition = ""; el.style.transform = ""; });

        // --- hit testing -------------------------------------------------
        // Rect containment rather than elementFromPoint: the dragged card
        // hovers over the board and, even with pointer-events off, reasoning
        // about a moving overlay is more fragile than reading four numbers.
        function columnAt(x, y) {
          const cols = document.querySelectorAll("[data-kanban-dropzone]");
          for (const c of cols) {
            const r = c.getBoundingClientRect();
            if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return c;
          }
          return null;
        }
        // First card whose midpoint sits below the pointer wins the slot
        // above it; falling off the end means append.
        function slotBefore(body, y) {
          for (const c of body.querySelectorAll(".kanban-card")) {
            const r = c.getBoundingClientRect();
            if (y < r.top + r.height / 2) return c;
          }
          // Append, but stay in front of the empty-state node so the two
          // never swap order and confuse the no-op check in reposition().
          return body.querySelector(".kanban-empty");
        }

        function setColumnOver(column) {
          if (drag.column === column) return;
          drag.column?.classList.remove("kanban-column-over");
          drag.column = column;
          column?.classList.add("kanban-column-over");
        }

        function reposition() {
          const column = columnAt(drag.x, drag.y) || drag.column;
          if (!column) return;
          setColumnOver(column);
          const body = column.querySelector(".kanban-column-body");
          if (!body) return;
          const before = slotBefore(body, drag.y);
          if (drag.ph.parentElement === body && drag.ph.nextElementSibling === before) return;
          flip(() => body.insertBefore(drag.ph, before));
        }

        // --- edge auto-scroll -------------------------------------------
        // Board scrolls sideways, a column body scrolls down; both matter on
        // a full pipeline. Speed ramps with depth into the hot zone so a
        // card parked near the edge drifts rather than bolts.
        function autoScroll(dt) {
          const board = document.querySelector(".kanban-board");
          if (board) {
            const r = board.getBoundingClientRect(), zone = 72;
            let v = 0;
            if (drag.x < r.left + zone) v = -(1 - (drag.x - r.left) / zone);
            else if (drag.x > r.right - zone) v = 1 - (r.right - drag.x) / zone;
            // Scrolling moves the board under a stationary pointer, so the
            // slot under it has to be re-resolved even with no pointermove.
            if (v) { board.scrollLeft += clamp(v, -1, 1) * 900 * dt; drag.dirty = true; }
          }
          const body = drag.column?.querySelector(".kanban-column-body");
          if (body && body.scrollHeight > body.clientHeight) {
            const r = body.getBoundingClientRect(), zone = 56;
            let v = 0;
            if (drag.y < r.top + zone) v = -(1 - (drag.y - r.top) / zone);
            else if (drag.y > r.bottom - zone) v = 1 - (r.bottom - drag.y) / zone;
            if (v) { body.scrollTop += clamp(v, -1, 1) * 700 * dt; drag.dirty = true; }
          }
        }

        // --- the frame loop ---------------------------------------------
        function tick(now) {
          if (!drag) return;
          const dt = Math.min((now - drag.t) / 1000, 0.05) || 0.016;
          drag.t = now;

          const tx = drag.x - drag.grabX;
          const ty = drag.y - drag.grabY;

          // Frame-rate independent chase. Deliberately not 1:1 with the
          // pointer: a couple of frames of give is the whole difference
          // between dragging an object and dragging a cursor decoration.
          const follow = REDUCED ? 1 : 1 - Math.pow(1 - 0.62, dt * 60);
          drag.px += (tx - drag.px) * follow;
          drag.py += (ty - drag.py) * follow;

          const lag = tx - drag.px;                   // signed, speed-proportional
          drag.rot.target = REDUCED ? 0 : clamp(lag * 0.18, -MAX_TILT, MAX_TILT);
          // Shadow and hover height breathe a little with speed, which is
          // what sells "above the board" rather than "printed on it".
          const speed = Math.hypot(lag, ty - drag.py);
          drag.lift.target = REDUCED ? 1 : 1 + clamp(speed / 120, 0, 0.3);

          const rot = stepSpring(drag.rot, dt);
          const scale = stepSpring(drag.scale, dt);
          const lift = stepSpring(drag.lift, dt);

          drag.ghost.style.transform =
            `translate3d(${drag.px}px, ${drag.py - lift * 3}px, 0) rotate(${rot}deg) scale(${scale})`;
          drag.ghost.style.setProperty("--lift", lift.toFixed(3));

          if (drag.dirty) { drag.dirty = false; reposition(); }
          autoScroll(dt);
          drag.raf = requestAnimationFrame(tick);
        }

        // --- lifecycle ---------------------------------------------------
        function startDrag(p) {
          const card = p.card;
          const rect = card.getBoundingClientRect();

          // A clone travels; the original is pulled out and parked. Keeping
          // the real node aside (rather than re-rendering it later) means
          // every listener wireCommonCardActions attached to it survives the
          // trip and it can simply be slotted back in on landing.
          const ghost = card.cloneNode(true);
          ghost.className = "kanban-card kanban-drag-ghost";
          ghost.style.cssText = card.style.cssText;
          ghost.style.width = rect.width + "px";
          ghost.style.height = rect.height + "px";
          ghost.style.transform = `translate3d(${rect.left}px, ${rect.top}px, 0)`;
          document.body.appendChild(ghost);

          // The placeholder is minted at exactly the card's box, so the swap
          // is invisible: nothing reflows at the moment of pickup.
          const ph = document.createElement("div");
          ph.className = "kanban-placeholder";
          ph.style.height = rect.height + "px";
          const homeBody = card.parentElement;
          const homeBefore = card.nextElementSibling;
          homeBody.insertBefore(ph, card);
          card.remove();

          drag = {
            id: card.dataset.kanbanCard,
            source: card, ghost, ph, column: null, homeBody, homeBefore,
            grabX: p.x - rect.left, grabY: p.y - rect.top,
            x: p.x, y: p.y,
            px: rect.left, py: rect.top,
            rot: makeSpring(0, 190, 26),
            scale: makeSpring(1, 300, 30),
            lift: makeSpring(0, 260, 30),
            t: performance.now(), dirty: true, raf: null,
          };
          drag.scale.target = REDUCED ? 1 : DRAG_SCALE;
          drag.lift.target = 1;

          document.body.classList.add("kanban-is-dragging");
          setColumnOver(ph.closest("[data-kanban-dropzone]"));
          drag.raf = requestAnimationFrame(tick);
        }

        function endDrag() {
          const d = drag;
          if (!d) return;
          drag = null;
          cancelAnimationFrame(d.raf);

          const column = d.ph.closest("[data-kanban-dropzone]");
          const target = d.ph.getBoundingClientRect();

          // Settle: one transition carries position, tilt and scale home
          // together. The bezier overshoots a hair past 1 so the card lands
          // with a little weight instead of easing to a stop.
          d.ghost.style.transition = REDUCED
            ? "transform 1ms linear"
            : `transform ${LAND_MS}ms cubic-bezier(.18,.89,.32,1.05), box-shadow ${LAND_MS}ms ease-out`;
          d.ghost.style.setProperty("--lift", "0");
          d.ghost.style.transform = `translate3d(${target.left}px, ${target.top}px, 0) rotate(0deg) scale(1)`;

          // Data first, animation second — the network round-trip should not
          // wait on a third of a second of easing.
          const moved = commit(d.id, column);

          setTimeout(() => {
            d.ph.parentElement?.insertBefore(d.source, d.ph);
            d.ph.remove();
            d.ghost.remove();
            document.body.classList.remove("kanban-is-dragging");
            document.querySelectorAll(".kanban-column").forEach(c => c.classList.remove("kanban-column-over"));
            clearFlip();
            if (moved) {
              d.source.classList.add("kanban-just-dropped");
              column?.classList.add("kanban-column-confirm");
              setTimeout(() => {
                d.source.classList.remove("kanban-just-dropped");
                column?.classList.remove("kanban-column-confirm");
              }, 620);
            }
          }, REDUCED ? 0 : LAND_MS - 10);
        }

        // Persist the move. The board is never re-rendered on success: the
        // DOM already shows the outcome, and `jobs` is resequenced to match
        // so the next render from any other cause agrees with what's on
        // screen. A failed PATCH is the one case worth a full reconcile.
        function commit(id, column) {
          const colKey = column?.dataset.kanbanDropzone;
          const col = columns.find(c => c.key === colKey);
          const job = filtered.find(j => j.id === Number(id));
          if (!job || !col) return false;

          resequence(job, column);
          const currentKey = columnKeyForJob(job, columns);
          if (currentKey === colKey) { refreshCounts(); return false; }

          const patchBody = col.custom
            ? { pipeline_stage: colKey, status: col.status }
            : { pipeline_stage: null, status: col.status };
          const prev = { pipeline_stage: job.pipeline_stage, status: job.status };
          job.pipeline_stage = patchBody.pipeline_stage;
          job.status = patchBody.status;
          refreshCounts();
          showToast(`Moved to ${col.label}`, "success");

          patch(`/api/jobs/${job.id}`, patchBody).catch(() => {
            Object.assign(job, prev);
            showToast("Couldn't save move — reverting", "error");
            applyFilters();
          });
          return true;
        }

        // Card order inside a column is positional, not stored — it comes
        // straight from the order of `jobs`. Splicing the moved job into the
        // same relative spot keeps a later re-render from snapping the card
        // back to where the array, rather than the user, put it.
        function resequence(job, column) {
          const body = column?.querySelector(".kanban-column-body");
          if (!body) return;
          const ids = Array.from(body.querySelectorAll(".kanban-card, .kanban-placeholder"))
            .map(el => el.classList.contains("kanban-placeholder") ? job.id : Number(el.dataset.kanbanCard));
          const at = ids.indexOf(job.id);
          const nextId = ids.slice(at + 1).find(id => id !== job.id);

          const from = jobs.indexOf(job);
          if (from === -1) return;
          jobs.splice(from, 1);
          const anchor = nextId != null ? jobs.findIndex(j => j.id === nextId) : -1;
          jobs.splice(anchor === -1 ? jobs.length : anchor, 0, job);
        }

        function refreshCounts() {
          document.querySelectorAll("[data-kanban-dropzone]").forEach(c => {
            const n = c.querySelectorAll(".kanban-card, .kanban-placeholder").length;
            const badge = c.querySelector(".kanban-count");
            if (badge && badge.textContent !== String(n)) badge.textContent = n;
          });
        }

        // --- input -------------------------------------------------------
        function onMove(e) {
          if (drag) {
            drag.x = e.clientX; drag.y = e.clientY; drag.dirty = true;
            e.preventDefault();
            return;
          }
          if (!pending || e.pointerId !== pending.id) return;
          const dist = Math.hypot(e.clientX - pending.x0, e.clientY - pending.y0);
          if (pending.touch) {
            // A finger that travels before the hold expires is scrolling.
            if (dist > TOUCH_SLOP) cancelPending();
            return;
          }
          if (dist < TAP_SLOP) return;
          pending.x = e.clientX; pending.y = e.clientY;
          promote();
        }

        function promote() {
          const p = pending;
          cancelPending();
          startDrag(p);
        }

        function cancelPending() {
          if (!pending) return;
          clearTimeout(pending.hold);
          pending = null;
        }

        function onUp() {
          if (drag) {
            // The click that follows a drag would otherwise open the card
            // detail; swallow exactly one, in capture, then stand down.
            document.addEventListener("click", swallow, true);
            setTimeout(() => document.removeEventListener("click", swallow, true), 0);
            endDrag();
          }
          cancelPending();
        }
        const swallow = (e) => { e.stopPropagation(); e.preventDefault(); };

        function onKey(e) {
          if (e.key !== "Escape" || !drag) return;
          // Abort: send the placeholder back to the slot the card was lifted
          // out of, then let the ordinary landing animation carry it home.
          flip(() => drag.homeBody.insertBefore(drag.ph, drag.homeBefore));
          setColumnOver(drag.homeBody.closest("[data-kanban-dropzone]"));
          endDrag();
        }

        // These handlers close over this render's `columns` and `filtered`,
        // so the previous render's copies have to come off the window or a
        // drag would commit against a stale board.
        // preventDefault on pointermove does not stop a touch scroll; only a
        // non-passive touchmove does. The card's `touch-action: pan-y` lets
        // the browser scroll before the hold expires, and this takes over the
        // moment the gesture is committed to being a drag.
        const onTouchMove = (e) => { if (drag) e.preventDefault(); };

        const prev = _kanbanDragListeners;
        if (prev) {
          window.removeEventListener("pointermove", prev.onMove, { passive: false });
          window.removeEventListener("pointerup", prev.onUp);
          window.removeEventListener("pointercancel", prev.onUp);
          window.removeEventListener("keydown", prev.onKey);
          window.removeEventListener("touchmove", prev.onTouchMove, { passive: false });
        }
        window.addEventListener("pointermove", onMove, { passive: false });
        window.addEventListener("pointerup", onUp);
        window.addEventListener("pointercancel", onUp);
        window.addEventListener("keydown", onKey);
        window.addEventListener("touchmove", onTouchMove, { passive: false });
        _kanbanDragListeners = { onMove, onUp, onKey, onTouchMove };

        document.querySelectorAll("[data-kanban-card]").forEach(card => {
          card.addEventListener("pointerdown", (e) => {
            if (e.button > 0 || drag || pending) return;
            // presses aimed at the card's own controls are not drags
            if (e.target.closest("[data-job-delete],[data-ats-open],[data-view-cover],button,a,input")) return;

            const touch = e.pointerType === "touch";
            pending = {
              card, id: e.pointerId, touch,
              x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY,
              hold: touch ? setTimeout(() => pending && promote(), TOUCH_HOLD) : null,
            };
          });
        });
      }

      function applyFilters() {
        const term = document.getElementById("job-filter").value.toLowerCase();
        const tagFilter = document.getElementById("job-tag-filter").value;
        let filtered = jobs.filter(j =>
          j.company_name.toLowerCase().includes(term) ||
          (j.skills_required || "").toLowerCase().includes(term) ||
          (j.tags || "").toLowerCase().includes(term)
        );
        if (tagFilter) {
          filtered = filtered.filter(j => (j.tags || "").split(",").map(t => t.trim()).includes(tagFilter));
        }
        if (jobsView.mode === "kanban") renderKanbanView(filtered);
        else renderListView(filtered);
      }

      // Assigned rather than addEventListener: these controls live in the
      // page header and persist across board switches, so adding a listener
      // each time loadBoard() ran would stack duplicate handlers.
      document.getElementById("job-filter").oninput = applyFilters;
      document.getElementById("job-tag-filter").onchange = applyFilters;
      applyFilters();
    }

    function renderCurrentView() {
      renderManageView();
    }
    rerenderCurrentView = renderCurrentView; // used by the header List/Kanban toggle

    renderCurrentView();
  }

  renderBoardTabs();
  await loadBoard();
}
// ============================================================================
// JOB APPLICATION — full-page overlays (Add + Detail), Huntr-style.
// Rendered into #job-overlay-root (a full-screen layer above the app), so
// they behave like dedicated pages rather than cramped modals.
// ============================================================================
const JOB_COLOR_SWATCHES = ["#E4A335", "#E2604F", "#4C6FE7", "#3C9D7B", "#7C5CFC", "#0EA5E9", "#EC4899", "#93968E"];

function jobOverlayRoot() {
  let root = document.getElementById("job-overlay-root");
  if (!root) {
    root = document.createElement("div");
    root.id = "job-overlay-root";
    document.body.appendChild(root);
  }
  return root;
}
function closeJobOverlay() {
  const root = document.getElementById("job-overlay-root");
  if (root) { root.innerHTML = ""; root.classList.remove("open"); }
  document.body.style.overflow = "";
}

// ---------- ADD APPLICATION (image 3 style) ----------
function openAddJobPage(resumes, activeBoardId, boards, onSaved) {
  const root = jobOverlayRoot();
  root.classList.add("open");
  document.body.style.overflow = "hidden";

  const activeTab = { id: "edit" };

  function renderShell() {
    root.innerHTML = `
      <div class="job-overlay-scrim" data-overlay-close></div>
      <div class="job-page job-detail" style="--job-accent:${JOB_COLOR_SWATCHES[0]}">
        <div class="job-detail-head">
          <div class="min-w-0">
            <h2 class="truncate">Add Application</h2>
            <p class="truncate">Fill in the details, then save to unlock AI Tools, Activities &amp; Contacts</p>
          </div>
          <div class="flex items-center gap-2 shrink-0">
            <button class="btn btn-ghost" data-overlay-close>Discard</button>
            <button class="btn btn-accent" id="add-job-save">Save Application</button>
          </div>
        </div>
        <div class="job-detail-tabs">
          ${[["edit", "✎ Edit", false], ["details", "🗂 Additional details", false], ["ai", "✨ AI Tools", true], ["activities", "🕑 Activities", true], ["contacts", "👥 Contacts", true]].map(([id, label, locked]) =>
            `<button class="job-tab ${activeTab.id === id ? "active" : ""} ${locked ? "job-tab-locked" : ""}" data-add-tab="${id}">${label}${locked ? " 🔒" : ""}</button>`).join("")}
        </div>
        <div class="job-detail-body" id="add-tab-body"></div>
      </div>`;
    root.querySelectorAll("[data-overlay-close]").forEach(el => el.addEventListener("click", closeJobOverlay));
    root.querySelectorAll("[data-add-tab]").forEach(el => el.addEventListener("click", () => { activeTab.id = el.dataset.addTab; renderShell(); }));
    root.querySelector("#add-job-save").addEventListener("click", save);
    const body = document.getElementById("add-tab-body");
    if (activeTab.id === "edit") renderEditTab(body);
    else if (activeTab.id === "details") renderDetailsTab(body);
    else renderLockedTab(body, activeTab.id);
  }

  function renderEditTab(body) {
    const baseResumes = resumes.filter(r => !r.tailored_for_job_id);
    const tailoredResumes = resumes.filter(r => r.tailored_for_job_id);
    const resumeOpts = list => list.map(r => `<option value="${r.id}">${esc(r.name)}</option>`).join("");
    body.innerHTML = `
      <div class="job-detail-edit-layout">
        <form id="add-job-form" class="job-detail-edit-main">
          <section class="jf-section">
            <div class="jf-section-head">
              <h3 class="jf-section-title">Essentials</h3>
              <span class="jf-section-tag req">Required</span>
            </div>
            <div class="jf-grid">
              <div class="jf-field jf-col-2"><label>Company</label><input type="text" name="company_name" placeholder="Company" required /></div>
              <div class="jf-field jf-col-2"><label>Job title</label><input type="text" name="role_title" placeholder="Job title" required /></div>
              <div class="jf-field"><label>Status</label><select name="status">${Object.entries(STATUS_LABELS).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select></div>
              <div class="jf-field"><label>Board</label><select name="board_id">${boards.map(b => `<option value="${b.id}" ${b.id === activeBoardId ? "selected" : ""}>${esc(b.name)}</option>`).join("")}</select></div>
              <div class="jf-field jf-col-2"><label>Date applied</label><input type="date" name="date_applied" value="${toISO(new Date())}" required /></div>

              <div class="jf-field jf-col-4"><label>Job description</label><textarea name="job_description" rows="4" placeholder="Paste it here — powers the ATS checker &amp; AI tools"></textarea></div>

              <div class="jf-field jf-col-4">
                <label>Resume used</label>
                <div class="jf-field-action">
                  <select name="resume_id" id="add-resume-select">
                    <option value="">No resume linked</option>
                    ${baseResumes.length ? `<optgroup label="Base resumes" data-group="base">${resumeOpts(baseResumes)}</optgroup>` : ""}
                    ${tailoredResumes.length ? `<optgroup label="Tailored CVs" data-group="tailored">${resumeOpts(tailoredResumes)}</optgroup>` : ""}
                  </select>
                  <button type="button" class="btn-ai-gen" id="add-tailor-btn" title="Create a copy of this resume tailored to this job">✨ Tailor to job</button>
                  <button type="button" class="btn-ats-check" id="add-ats-btn" title="Score this resume against the job description">🎯 ATS check</button>
                </div>
                <div class="jf-dl-row">
                  <span class="jf-dl-label">⬇ Download resume as</span>
                  <button type="button" class="btn-dl" data-dl-resume="pdf">PDF</button>
                </div>
                <div id="add-ats-report-slot"></div>
              </div>

              <div class="jf-field jf-col-4">
                <label>Cover letter used</label>
                <div class="jf-field-action">
                  <textarea name="cover_letter" rows="4" placeholder="Paste the cover letter you used, or generate one from your linked resume + this job"></textarea>
                  <button type="button" class="btn-ai-gen" id="add-cover-btn" title="Write a cover letter from the linked resume and this job">✨ Generate</button>
                </div>
                <div class="jf-dl-row">
                  <span class="jf-dl-label">⬇ Download cover letter as</span>
                  <button type="button" class="btn-dl" data-dl-cover="pdf">PDF</button>
                </div>
                <p class="jf-ai-hint">Both use your linked resume and the <strong>Job description</strong> above.</p>
              </div>
            </div>
            <p class="jf-section-hint">Company, title and date are all you need — the rest can wait. Hit <strong>Save Application</strong> when ready.</p>
          </section>
        </form>

        <div class="job-detail-side">
          <div class="job-glance-card job-color-card">
            <div class="job-glance-head"><span class="job-glance-head-icon">🎨</span> Color</div>
            <div class="color-swatches" id="add-color-swatches">${JOB_COLOR_SWATCHES.map((c, i) => `<button type="button" class="color-swatch ${i === 0 ? "selected" : ""}" data-color="${c}" style="background:${c}"></button>`).join("")}</div>
            <input type="hidden" name="color" form="add-job-form" value="${JOB_COLOR_SWATCHES[0]}" />
          </div>
        </div>
      </div>`;

    const form = body.querySelector("#add-job-form");
    // restore any values the user already typed before switching tabs
    if (formState) {
      Object.entries(formState).forEach(([k, v]) => { const el = form.elements[k]; if (el) el.value = v; });
      const sw = formState.color && body.querySelector(`#add-color-swatches [data-color="${formState.color}"]`);
      if (sw) { body.querySelectorAll("#add-color-swatches [data-color]").forEach(s => s.classList.remove("selected")); sw.classList.add("selected"); }
    }
    wireColorSwatches(body.querySelector("#add-color-swatches"), body.querySelector('input[name="color"]'));

    // Re-show the last ATS report (it's transient, lost on tab re-render).
    if (lastAts) renderAtsResult(body.querySelector("#add-ats-report-slot"), lastAts.result);

    // ---- shared helpers (mirrors the saved-application editor) ----
    async function withBusy(btn, label, fn, onError) {
      const original = btn.textContent;
      btn.disabled = true; btn.textContent = label;
      try { await fn(); }
      catch (err) { showToast(apiErrorMessage(err, "That didn't work — please try again"), "error"); if (onError) onError(err); }
      finally { btn.disabled = false; btn.textContent = original; }
    }
    function requireContext(needResume) {
      const jd = form.elements.job_description.value.trim();
      const resumeId = Number(form.elements.resume_id.value);
      if (needResume && !resumeId) {
        showToast("Link a resume first — it's what the text is written from", "error");
        form.elements.resume_id.focus();
        return null;
      }
      if (jd.length < 20) {
        showToast("Paste the job description first", "error");
        form.elements.job_description.focus();
        return null;
      }
      return { jd, resumeId, company: form.elements.company_name.value, role: form.elements.role_title.value };
    }

    // ---- Generate cover letter ----
    const coverBtn = body.querySelector("#add-cover-btn");
    coverBtn.addEventListener("click", () => {
      const ctx = requireContext(true);
      if (!ctx) return;
      withBusy(coverBtn, "Writing…", async () => {
        const res = await post(`/api/cover-letter/generate`, {
          resume_id: ctx.resumeId, job_description: ctx.jd,
          company_name: ctx.company, role_title: ctx.role,
        });
        form.elements.cover_letter.value = res.cover_letter;
        syncCoverDl();
        showToast(`Cover letter ready — ${res.mode === "llm" ? "AI-generated" : "smart template"}. Save to keep it.`, "success");
      });
    });

    // ---- ATS check (report shown inline; score is saved with the application) ----
    const atsBtn = body.querySelector("#add-ats-btn");
    atsBtn.addEventListener("click", () => {
      const ctx = requireContext(true);
      if (!ctx) return;
      const slot = body.querySelector("#add-ats-report-slot");
      slot.innerHTML = `<div class="ats-loading"><span class="spinner-sm"></span> Scoring your resume against this job…</div>`;
      withBusy(atsBtn, "Checking…", async () => {
        const result = await post(`/api/ats/check`, { resume_id: ctx.resumeId, job_description: ctx.jd });
        renderAtsResult(slot, result);
        lastAts = { result, score: result.score, breakdown: JSON.stringify(result) };
        showToast(`ATS score: ${result.score}% — saved with this application`, result.score >= 75 ? "success" : "info");
      }, () => { slot.innerHTML = ""; });
    });

    // ---- Tailor a resume to this job (creates + selects a tailored copy) ----
    const tailorBtn = body.querySelector("#add-tailor-btn");
    tailorBtn.addEventListener("click", () => {
      const ctx = requireContext(true);
      if (!ctx) return;
      withBusy(tailorBtn, "Tailoring…", async () => {
        const tailored = await post(`/api/resume-builder/tailor-for-job`, {
          resume_id: ctx.resumeId, job_description: ctx.jd,
          company_name: ctx.company, role_title: ctx.role,
        });
        resumes.push(tailored);
        const sel = form.elements.resume_id;
        let tg = sel.querySelector('optgroup[data-group="tailored"]');
        if (!tg) { tg = document.createElement("optgroup"); tg.label = "Tailored CVs"; tg.dataset.group = "tailored"; sel.appendChild(tg); }
        const opt = document.createElement("option");
        opt.value = tailored.id; opt.textContent = tailored.name; opt.selected = true;
        tg.appendChild(opt);
        if (formState) formState.resume_id = String(tailored.id);
        syncResumeDl();
        showToast(`Tailored CV created and selected: ${tailored.name}`, "success");
      });
    });

    // ---- Download resume / cover letter as PDF ----
    const resumeSelect = form.elements.resume_id;
    const resumeDlBtns = body.querySelectorAll("[data-dl-resume]");
    function syncResumeDl() { const has = !!resumeSelect.value; resumeDlBtns.forEach(b => b.disabled = !has); }
    syncResumeDl();
    resumeSelect.addEventListener("change", syncResumeDl);
    resumeDlBtns.forEach(btn => btn.addEventListener("click", () => {
      const id = resumeSelect.value;
      if (!id) { showToast("Link a resume first", "error"); return; }
      const fmt = btn.dataset.dlResume;
      withBusy(btn, "…", () => downloadFile(`/api/resumes/${id}/download?format=${fmt}`, { fallbackName: `resume.${fmt}` }));
    }));

    const coverInput = form.elements.cover_letter;
    const coverDlBtns = body.querySelectorAll("[data-dl-cover]");
    function syncCoverDl() { const has = !!coverInput.value.trim(); coverDlBtns.forEach(b => b.disabled = !has); }
    syncCoverDl();
    coverInput.addEventListener("input", syncCoverDl);
    coverDlBtns.forEach(btn => btn.addEventListener("click", () => {
      const text = coverInput.value.trim();
      if (!text) { showToast("Write or generate a cover letter first", "error"); return; }
      const fmt = btn.dataset.dlCover;
      withBusy(btn, "…", () => downloadFile(`/api/cover-letter/download`, {
        method: "POST",
        body: { text, format: fmt, company_name: form.elements.company_name.value, role_title: form.elements.role_title.value },
        fallbackName: `cover-letter.${fmt}`,
      }));
    }));
  }

  function renderDetailsTab(body) {
    body.innerHTML = `
      <form id="add-details-form" class="job-detail-edit-main">
        <section class="jf-section">
          <div class="jf-section-head">
            <h3 class="jf-section-title">Additional details</h3>
            <span class="jf-section-tag jf-section-tag--optional">Optional</span>
          </div>
          <div class="jf-grid">
            <div class="jf-field jf-col-2"><label>Post URL</label><input type="url" name="job_link" placeholder="https://…" /></div>
            <div class="jf-field"><label>Location</label><input type="text" name="location" placeholder="e.g. Remote" /></div>
            <div class="jf-field"><label>Salary</label><input type="text" name="salary_range" placeholder="e.g. £60k–£80k" /></div>
            <div class="jf-field"><label>Deadline</label><input type="date" name="deadline" /></div>
            <div class="jf-field"><label>Review / follow up by</label><input type="date" name="next_action_date" /></div>
            <div class="jf-field jf-col-2"><label>Skills required</label><input type="text" name="skills_required" placeholder="Comma-separated, e.g. Python, FastAPI, SQL" /></div>
            <div class="jf-field jf-col-2"><label>Tags</label><input type="text" name="tags" placeholder="Comma-separated, e.g. dream-job, urgent" /></div>
            <div class="jf-field jf-col-2"><label>Source</label><input type="text" name="source" placeholder="LinkedIn, referral…" /></div>
            <div class="jf-field jf-col-4"><label>Notes</label><textarea name="notes" rows="2" placeholder="Anything else you want to remember"></textarea></div>
          </div>
        </section>
      </form>`;
    // restore any values the user already typed on other tabs
    if (formState) {
      const form = body.querySelector("#add-details-form");
      Object.entries(formState).forEach(([k, v]) => { const el = form.elements[k]; if (el) el.value = v; });
    }
  }

  function renderLockedTab(body, which) {
    const labels = { ai: "AI Tools", activities: "Activities", contacts: "Contacts" };
    body.innerHTML = `
      <div class="add-locked">
        <div class="add-locked-icon">🔒</div>
        <h3>${labels[which]} unlocks after you save</h3>
        <p>${labels[which]} attach to a saved application. Finish the <strong>Edit</strong> tab and hit <strong>Save Application</strong> — you'll drop straight into the full editor with this tab ready to use.</p>
        <button class="btn btn-accent" id="locked-save">Save &amp; continue</button>
        <button class="btn btn-ghost" id="locked-back">Back to Edit</button>
      </div>`;
    body.querySelector("#locked-save").addEventListener("click", save);
    body.querySelector("#locked-back").addEventListener("click", () => { activeTab.id = "edit"; renderShell(); });
  }

  // keep typed values when flipping tabs (each tab's form is re-created on render)
  let formState = null;
  let lastAts = null; // last ATS report (result + score), persisted to the job on save
  function captureForm() {
    // Essentials live in #add-job-form, the rest in #add-details-form. Only one
    // is mounted at a time, so merge into formState rather than replacing it —
    // otherwise switching tabs would drop the other tab's values.
    const form = root.querySelector("#add-job-form") || root.querySelector("#add-details-form");
    if (form) formState = { ...(formState || {}), ...Object.fromEntries(new FormData(form).entries()) };
  }

  async function save() {
    captureForm(); // grab whatever tab we're currently on
    // make sure we're on Edit so the required-field validation UI is in the DOM
    if (activeTab.id !== "edit") { activeTab.id = "edit"; renderShell(); }
    const form = root.querySelector("#add-job-form");
    if (!form.reportValidity()) return;
    captureForm(); // re-capture the (now restored) Essentials form
    const payload = { ...(formState || {}) };
    if (!payload.company_name?.trim() || !payload.role_title?.trim() || !payload.date_applied) {
      showToast("Company, job title and date applied are required", "error");
      return;
    }
    if (!payload.resume_id) delete payload.resume_id; else payload.resume_id = Number(payload.resume_id);
    payload.board_id = Number(payload.board_id) || activeBoardId;
    ["next_action_date", "deadline", "job_link", "job_description", "notes", "tags", "salary_range", "location", "source", "skills_required", "cover_letter"].forEach(k => { if (!payload[k]) delete payload[k]; });
    const created = await post(`/api/jobs`, payload);
    // JobCreate doesn't take an ATS score, so if one was computed here, save
    // it onto the freshly-created application with a follow-up update.
    if (lastAts && payload.resume_id) {
      try { await patch(`/api/jobs/${created.id}`, { ats_score: lastAts.score, ats_breakdown: lastAts.breakdown }); }
      catch (_) { /* the application is created regardless; the score just isn't cached */ }
    }
    showToast("Application added", "success");
    closeJobOverlay();
    if (onSaved) await onSaved();
    openJobDetailPage(created.id, resumes, boards, onSaved);
  }

  // capture form values whenever the user leaves the current tab
  root.addEventListener("click", (e) => { if (e.target.closest("[data-add-tab]")) captureForm(); }, true);

  renderShell();
}

function wireColorSwatches(container, hiddenInput) {
  if (!container) return;
  container.querySelectorAll("[data-color]").forEach(sw => {
    sw.addEventListener("click", () => {
      container.querySelectorAll("[data-color]").forEach(s => s.classList.remove("selected"));
      sw.classList.add("selected");
      if (hiddenInput) hiddenInput.value = sw.dataset.color;
    });
  });
}

// ---------- AI Tools registry (image 5) ----------
const AI_DOC_STAGES = [
  { stage: "Application Stage", docs: [
    { type: "cover_letter", title: "Cover Letter", desc: "A personalized letter explaining why you're a good fit for the position and how your skills align with the company's needs.", cta: "Generate Cover Letter", color: "#4C6FE7" },
    { type: "follow_up_application", title: "Follow Up After Application", desc: "A polite follow-up email to inquire about the status of your application if there's been no response.", cta: "Generate Follow Up", color: "#3C9D7B" },
  ]},
  { stage: "Interview Stage", docs: [
    { type: "interview_prep", title: "Interview Prep Questions", desc: "A list of likely questions to help you prepare for an upcoming interview.", cta: "Generate Interview Prep", color: "#4C6FE7" },
    { type: "questions_to_ask", title: "Questions to Ask", desc: "A curated list of thoughtful questions to ask employers, aimed at deeper insight into the role and culture.", cta: "Generate Questions", color: "#E2604F" },
    { type: "thank_you", title: "Thank You After Interview", desc: "A message expressing gratitude after an interview, reinforcing your interest and fit.", cta: "Generate Thank You", color: "#E4A335" },
    { type: "follow_up_interview", title: "Follow Up After Interview", desc: "An email to inquire about status if there's been no response within the expected timeframe.", cta: "Generate Follow Up", color: "#3C9D7B" },
    { type: "reschedule", title: "Reschedule Interview", desc: "A courteous request for a new date and time when circumstances require rescheduling.", cta: "Generate Reschedule", color: "#7C5CFC" },
    { type: "decline_interview", title: "Decline Interview", desc: "A gracious email to decline an interview, with a brief explanation and thanks.", cta: "Generate Decline", color: "#3C9D7B" },
  ]},
  { stage: "Offer Stage", docs: [
    { type: "offer_negotiation", title: "Offer Negotiation", desc: "An email to negotiate the terms of a job offer, including salary, benefits, and other terms.", cta: "Generate Negotiation", color: "#E4A335" },
    { type: "offer_acceptance", title: "Offer Acceptance", desc: "A message confirming acceptance of the offer with gratitude, confirmation of terms, and enthusiasm.", cta: "Generate Acceptance", color: "#4C6FE7" },
    { type: "offer_decline", title: "Offer Decline", desc: "An email to decline a job offer, expressing gratitude and a brief explanation for your decision.", cta: "Generate Decline", color: "#3C9D7B" },
    { type: "extension_request", title: "Offer Time Extension Request", desc: "A message asking for more time to consider an offer, with valid reasons and continued interest.", cta: "Generate Extension Request", color: "#3C9D7B" },
  ]},
];

const ACTIVITY_META = {
  applied:        { icon: "📮", color: "#4C6FE7", label: "Applied" },
  interview:      { icon: "🗣️", color: "#E4A335", label: "Interview" },
  offer_received: { icon: "🎉", color: "#3C9D7B", label: "Offer received" },
  offer_accepted: { icon: "✅", color: "#3C9D7B", label: "Offer accepted" },
  offer_declined: { icon: "🚫", color: "#E2604F", label: "Offer declined" },
  note:           { icon: "📝", color: "#7C5CFC", label: "Note" },
  contact:        { icon: "👤", color: "#0EA5E9", label: "Contact" },
  status_change:  { icon: "🔄", color: "#93968E", label: "Status change" },
  other:          { icon: "•",  color: "#93968E", label: "Activity" },
};

function esc(s) { return (s == null ? "" : String(s)).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#39;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

// Sanitises a user-supplied URL before it goes into an href. esc() alone is
// not enough: it stops the attribute being broken out of, but "javascript:..."
// or "data:text/html,..." still execute when clicked. Only http(s) and mailto
// are allowed through; anything else renders as an inert empty link.
function safeUrl(u) {
  const raw = (u == null ? "" : String(u)).trim();
  if (!raw) return "";
  try {
    const parsed = new URL(raw, window.location.origin);
    return ["http:", "https:", "mailto:"].includes(parsed.protocol) ? esc(parsed.href) : "";
  } catch { return ""; }
}

// Pulls the readable message out of an API error. api() throws with the raw
// response body appended, which for FastAPI is JSON like {"detail": "..."} —
// showing that verbatim in a toast looks broken, so unwrap it.
function apiErrorMessage(err, fallback = "Something went wrong — please try again") {
  const stripped = ((err && err.message) || "").replace(/^API.*?failed:\s*\d+\s*/, "").trim();
  try {
    const parsed = JSON.parse(stripped);
    if (typeof parsed?.detail === "string") return parsed.detail;
    if (Array.isArray(parsed?.detail)) {
      const msgs = parsed.detail.map(d => d?.msg).filter(Boolean).join("; ");
      if (msgs) return msgs;
    }
  } catch { /* not JSON — fall through to the plain text */ }
  return stripped || fallback;
}

// ---------- DETAIL PAGE (images 4-6) ----------
async function openJobDetailPage(jobId, resumes, boards, onSaved) {
  const root = jobOverlayRoot();
  root.classList.add("open");
  document.body.style.overflow = "hidden";
  root.innerHTML = `<div class="job-overlay-scrim" data-overlay-close></div><div class="job-page"><div class="p-10"><div class="spinner"></div></div></div>`;
  root.querySelector("[data-overlay-close]").addEventListener("click", closeJobOverlay);

  let detail;
  try {
    detail = await get(`/api/jobs/${jobId}/detail`, { noCache: true });
  } catch (e) {
    root.innerHTML = `<div class="job-overlay-scrim" data-overlay-close></div><div class="job-page"><div class="p-10 text-red-600">Couldn't load this application.</div></div>`;
    root.querySelector("[data-overlay-close]").addEventListener("click", closeJobOverlay);
    return;
  }

  const activeTab = { id: "edit" };
  const refreshAndReload = async () => { if (onSaved) await onSaved(); };

  function renderShell() {
    const j = detail;
    root.innerHTML = `
      <div class="job-overlay-scrim" data-overlay-close></div>
      <div class="job-page job-detail" style="--job-accent:${j.color || "#3D5AFE"}">
        <div class="job-detail-head">
          <div class="flex items-center gap-3 min-w-0">
            ${companyAvatar(j.company_name, "lg")}
            <div class="min-w-0">
              <h2 class="truncate">${esc(j.role_title) || "Untitled role"}</h2>
              <p class="truncate">
                <span class="truncate">${esc(j.company_name)}</span>
                ${j.job_link ? `<a href="${safeUrl(j.job_link)}" target="_blank" rel="noopener noreferrer" class="job-detail-link-icon" title="Open job posting">↗</a>` : ""}
              </p>
            </div>
          </div>
          <div class="flex items-center gap-2 shrink-0">
            <span class="badge ${STATUS_COLORS[j.status]}">${STATUS_LABELS[j.status]}</span>
            <button class="btn btn-accent" id="detail-save-top">Save changes</button>
            <button class="btn btn-close-x" data-overlay-close>Close <span class="btn-close-x-icon">✕</span></button>
          </div>
        </div>
        <div class="job-detail-tabs">
          ${[["edit", "✎ Edit"], ["details", "🗂 Additional details"], ["ai", "✨ AI Tools"], ["activities", "🕑 Activities"], ["contacts", "👥 Contacts"]].map(([id, label]) =>
            `<button class="job-tab ${activeTab.id === id ? "active" : ""}" data-detail-tab="${id}">${label}</button>`).join("")}
        </div>
        <div class="job-detail-body" id="job-detail-body"></div>
      </div>`;
    root.querySelectorAll("[data-overlay-close]").forEach(el => el.addEventListener("click", closeJobOverlay));
    root.querySelectorAll("[data-detail-tab]").forEach(el => el.addEventListener("click", () => { activeTab.id = el.dataset.detailTab; renderShell(); }));
    // Top-right Save mirrors the form's own submit button, so a long form
    // doesn't have to be scrolled to the bottom to save. Only meaningful on
    // the Edit tab — the other tabs save their own changes as you make them.
    const saveTop = root.querySelector("#detail-save-top");
    if (saveTop) {
      saveTop.hidden = !(activeTab.id === "edit" || activeTab.id === "details");
      saveTop.addEventListener("click", () => {
        (document.getElementById("detail-edit-form") || document.getElementById("detail-details-form"))?.requestSubmit();
      });
    }
    const body = document.getElementById("job-detail-body");
    if (activeTab.id === "edit") renderEditTab(body);
    else if (activeTab.id === "details") renderDetailsTab(body);
    else if (activeTab.id === "ai") renderAiTab(body);
    else if (activeTab.id === "activities") renderActivitiesTab(body);
    else if (activeTab.id === "contacts") renderContactsTab(body);
  }

  function renderEditTab(body) {
    const j = detail;
    const currentUserName = (auth.getUser() || {}).name || "You";
    const appIdYear = j.created_at ? new Date(j.created_at).getFullYear() : new Date().getFullYear();
    const appId = `APP-${appIdYear}-${String(j.id).padStart(4, "0")}`;
    const notesPreview = (j.notes || "").trim();
    body.innerHTML = `
      <div class="job-detail-edit-layout">
        <form id="detail-edit-form" class="job-detail-edit-main">
          <section class="jf-section">
            <div class="jf-section-head">
              <h3 class="jf-section-title">Essentials</h3>
              <span class="jf-section-tag req">Required</span>
            </div>
            <div class="jf-grid">
              <div class="jf-field jf-col-2"><label>Company</label><input type="text" name="company_name" value="${esc(j.company_name)}" required /></div>
              <div class="jf-field jf-col-2"><label>Job title</label><input type="text" name="role_title" value="${esc(j.role_title)}" required /></div>
              <div class="jf-field"><label>Status</label><select name="status" id="detail-status-select">${Object.entries(STATUS_LABELS).map(([k, v]) => `<option value="${k}" ${k === j.status ? "selected" : ""}>${v}</option>`).join("")}</select></div>
              <div class="jf-field"><label>Board</label><select name="board_id">${boards.map(b => `<option value="${b.id}" ${b.id === j.board_id ? "selected" : ""}>${esc(b.name)}</option>`).join("")}</select></div>
              <div class="jf-field jf-col-2"><label>Date applied</label><input type="date" name="date_applied" value="${j.date_applied || ""}" required /></div>

              <div class="jf-field jf-col-4"><label>Job description</label><textarea name="job_description" rows="5" placeholder="Paste the description — powers ATS &amp; AI tools">${esc(j.job_description || "")}</textarea></div>

              <div class="jf-field jf-col-4">
                <label>Resume used</label>
                <div class="jf-field-action">
                  <select name="resume_id" id="detail-resume-select">
                    <option value="">No resume linked</option>
                    ${resumes.filter(r => !r.tailored_for_job_id).length ? `<optgroup label="Base resumes" data-group="base">${resumes.filter(r => !r.tailored_for_job_id).map(r => `<option value="${r.id}" ${r.id === j.resume_id ? "selected" : ""}>${esc(r.name)}</option>`).join("")}</optgroup>` : ""}
                    ${resumes.filter(r => r.tailored_for_job_id).length ? `<optgroup label="Tailored CVs" data-group="tailored">${resumes.filter(r => r.tailored_for_job_id).map(r => `<option value="${r.id}" ${r.id === j.resume_id ? "selected" : ""}>${esc(r.name)}</option>`).join("")}</optgroup>` : ""}
                  </select>
                  <button type="button" class="btn-ai-gen" id="tailor-resume-btn" title="Create a copy of this resume tailored to this job">✨ Tailor to job</button>
                  <button type="button" class="btn-ats-check" id="ats-check-btn" title="Score this resume against the job description">🎯 ATS check</button>
                </div>
                <div class="jf-dl-row">
                  <span class="jf-dl-label">⬇ Download resume as</span>
                  <button type="button" class="btn-dl" data-dl-resume="pdf">PDF</button>
                </div>
                <div id="ats-report-slot">${j.ats_score != null ? `
                  <div class="ats-prev">
                    <span class="ats-prev-score ${j.ats_score >= 75 ? "good" : j.ats_score >= 50 ? "mid" : "low"}">${j.ats_score}%</span>
                    <span class="ats-prev-label">last recorded score — run a new check for the full report</span>
                  </div>` : ""}</div>
              </div>

              <div class="jf-field jf-col-4">
                <label>Cover letter used</label>
                <div class="jf-field-action">
                  <textarea name="cover_letter" rows="4" placeholder="Paste the cover letter you used, or generate one from your linked resume + this job">${esc(j.cover_letter || "")}</textarea>
                  <button type="button" class="btn-ai-gen" id="gen-cover-btn" title="Write a cover letter from the linked resume and this job">✨ Generate</button>
                </div>
                <div class="jf-dl-row">
                  <span class="jf-dl-label">⬇ Download cover letter as</span>
                  <button type="button" class="btn-dl" data-dl-cover="pdf">PDF</button>
                </div>
                <p class="jf-ai-hint">Both use your linked resume and the <strong>Job description</strong> above.</p>
              </div>
            </div>
          </section>

          <button type="submit" class="jf-hidden-submit" aria-hidden="true" tabindex="-1">Save</button>
        </form>

        <div class="job-detail-side">
          <div class="job-glance-card job-color-card">
            <div class="job-glance-head"><span class="job-glance-head-icon">🎨</span> Color</div>
            <div class="color-swatches" id="detail-color-swatches">${JOB_COLOR_SWATCHES.map(c => `<button type="button" class="color-swatch ${c === (j.color || "") ? "selected" : ""}" data-color="${c}" style="background:${c}"></button>`).join("")}</div>
            <input type="hidden" name="color" form="detail-edit-form" value="${j.color || ""}" />
          </div>

          <aside class="job-glance-card">
          <div class="job-glance-head"><span class="job-glance-head-icon">🗂️</span> At a glance</div>
          <div class="job-glance-rows">
            <div class="job-glance-row job-glance-row--clickable" data-glance-jump="status">
              <span class="job-glance-icon">◎</span>
              <div class="min-w-0">
                <div class="job-glance-label">Current Stage</div>
                <div class="job-glance-value job-glance-value--accent">${STATUS_LABELS[j.status]}</div>
              </div>
            </div>
            <div class="job-glance-row">
              <span class="job-glance-icon">📅</span>
              <div class="min-w-0">
                <div class="job-glance-label">Applied On</div>
                <div class="job-glance-value">${j.date_applied ? fmtLongDate(fromISO(j.date_applied)) : "—"}</div>
              </div>
            </div>
            <div class="job-glance-row job-glance-row--clickable" data-glance-jump="source">
              <span class="job-glance-icon">🖥</span>
              <div class="min-w-0">
                <div class="job-glance-label">Source</div>
                <div class="job-glance-value">${esc(j.source) || "Manual"}</div>
              </div>
            </div>
            <div class="job-glance-row">
              <span class="job-glance-icon">↻</span>
              <div class="min-w-0">
                <div class="job-glance-label">Last Updated</div>
                <div class="job-glance-value">${j.updated_at ? timeAgo(j.updated_at) : "—"}</div>
              </div>
            </div>
            <div class="job-glance-row">
              <span class="job-glance-icon">◐</span>
              <div class="min-w-0">
                <div class="job-glance-label">Owner</div>
                <div class="job-glance-value">${esc(currentUserName)}</div>
              </div>
            </div>
            <div class="job-glance-row job-glance-row--clickable" data-glance-jump="notes">
              <span class="job-glance-icon">📝</span>
              <div class="min-w-0">
                <div class="job-glance-label">Notes</div>
                <div class="job-glance-value ${notesPreview ? "" : "job-glance-value--muted"} truncate">${notesPreview ? esc(notesPreview) : "Add a note…"}</div>
              </div>
            </div>
          </div>
        </aside>
        </div>
      </div>

      <div class="job-detail-footer">
        <div class="job-detail-footer-left">
          <span class="job-detail-footer-icon">🕐</span>
          <span>Created on ${j.created_at ? fmtShortDate(new Date(j.created_at)) : "—"}</span>
          <span class="job-detail-footer-dot">•</span>
          <span>Last updated ${j.updated_at ? timeAgo(j.updated_at) : "—"}</span>
          <span class="job-detail-footer-dot">•</span>
          <span>Application ID: ${appId}</span>
        </div>
        <button type="button" class="job-detail-footer-delete" id="detail-delete"><span>🗑</span> Delete application</button>
      </div>`;
    // "At a glance" rows that reference a field now living on the Additional
    // details tab switch to that tab and focus the field.
    const jumpToDetails = (sel) => {
      activeTab.id = "details";
      renderShell();
      const el = document.querySelector(sel);
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
      el?.focus();
    };
    body.querySelectorAll("[data-glance-jump]").forEach(row => {
      row.addEventListener("click", () => {
        const target = row.dataset.glanceJump;
        if (target === "status") { body.querySelector("#detail-status-select")?.focus(); return; }
        jumpToDetails(target === "notes" ? "#detail-notes-input" : "#detail-source-input");
      });
    });
    wireColorSwatches(body.querySelector("#detail-color-swatches"), body.querySelector('input[name="color"]'));

    // ---- AI document helpers (both work off the linked resume + this job) ----
    const form = body.querySelector("#detail-edit-form");
    // The job description now lives here in Essentials; if it's missing we
    // just focus it so the user can see exactly what's needed.
    function requireContext(needResume) {
      const jd = form.elements.job_description.value.trim();
      const resumeId = Number(form.elements.resume_id.value);
      if (needResume && !resumeId) {
        showToast("Link a resume first — it's what the text is written from", "error");
        form.elements.resume_id.focus();
        return null;
      }
      if (jd.length < 20) {
        showToast("Paste the job description first", "error");
        form.elements.job_description.focus();
        return null;
      }
      return { jd, resumeId, company: form.elements.company_name.value, role: form.elements.role_title.value };
    }
    async function withBusy(btn, label, fn, onError) {
      const original = btn.textContent;
      btn.disabled = true; btn.textContent = label;
      try { await fn(); }
      catch (err) {
        showToast(apiErrorMessage(err, "That didn't work — please try again"), "error");
        if (onError) onError(err); // lets the caller clear its own loading state
      }
      finally { btn.disabled = false; btn.textContent = original; }
    }

    const coverBtn = body.querySelector("#gen-cover-btn");
    coverBtn.addEventListener("click", () => {
      const ctx = requireContext(true);
      if (!ctx) return;
      withBusy(coverBtn, "Writing…", async () => {
        const res = await post(`/api/cover-letter/generate`, {
          resume_id: ctx.resumeId, job_description: ctx.jd,
          company_name: ctx.company, role_title: ctx.role,
        });
        form.elements.cover_letter.value = res.cover_letter;
        syncCoverDl();
        showToast(`Cover letter ready — ${res.mode === "llm" ? "AI-generated" : "smart template"}. Save to keep it.`, "success");
      });
    });

    const atsBtn = body.querySelector("#ats-check-btn");
    atsBtn.addEventListener("click", () => {
      const ctx = requireContext(true);
      if (!ctx) return;
      const slot = body.querySelector("#ats-report-slot");
      slot.innerHTML = `<div class="ats-loading"><span class="spinner-sm"></span> Scoring your resume against this job…</div>`;
      withBusy(atsBtn, "Checking…", async () => {
        const result = await post(`/api/ats/check`, { resume_id: ctx.resumeId, job_description: ctx.jd });
        renderAtsResult(slot, result);
        // Persist the score so the list rows and kanban cards show it too.
        // Done directly rather than waiting for "Save changes", since the
        // score is a result we computed, not an edit the user typed.
        try {
          await patch(`/api/jobs/${j.id}`, { ats_score: result.score, ats_breakdown: JSON.stringify(result) });
          detail.ats_score = result.score;
          await refreshAndReload();
        } catch { /* the report is still shown even if caching the score fails */ }
        showToast(`ATS score: ${result.score}%`, result.score >= 75 ? "success" : "info");
      }, () => { slot.innerHTML = ""; });
    });

    const tailorBtn = body.querySelector("#tailor-resume-btn");
    tailorBtn.addEventListener("click", () => {
      const ctx = requireContext(true);
      if (!ctx) return;
      withBusy(tailorBtn, "Tailoring…", async () => {
        // Creates a NEW resume tailored to this job (the original is left
        // untouched) and links this application to it.
        const tailored = await post(`/api/resume-builder/tailor-for-job`, {
          resume_id: ctx.resumeId, job_description: ctx.jd,
          company_name: ctx.company, role_title: ctx.role, job_id: j.id,
        });
        resumes.push(tailored);
        const sel = form.elements.resume_id;
        // Drop it into the "Tailored CVs" group so it visibly lands in the
        // tailored section here, mirroring the Resume Library. Create the
        // group the first time a resume is tailored for this application.
        let tg = sel.querySelector('optgroup[data-group="tailored"]');
        if (!tg) { tg = document.createElement("optgroup"); tg.label = "Tailored CVs"; tg.dataset.group = "tailored"; sel.appendChild(tg); }
        const opt = document.createElement("option");
        opt.value = tailored.id; opt.textContent = tailored.name; opt.selected = true;
        tg.appendChild(opt);
        detail.resume_id = tailored.id;
        syncResumeDl();
        showToast(`Tailored CV saved and selected: ${tailored.name}`, "success");
      });
    });

    // ---- Download resume / cover letter as PDF ----
    const resumeSelect = form.elements.resume_id;
    const resumeDlBtns = body.querySelectorAll("[data-dl-resume]");
    function syncResumeDl() { const has = !!resumeSelect.value; resumeDlBtns.forEach(b => b.disabled = !has); }
    syncResumeDl();
    resumeSelect.addEventListener("change", syncResumeDl);
    resumeDlBtns.forEach(btn => btn.addEventListener("click", () => {
      const id = resumeSelect.value;
      if (!id) { showToast("Link a resume first", "error"); return; }
      const fmt = btn.dataset.dlResume;
      withBusy(btn, "…", () => downloadFile(`/api/resumes/${id}/download?format=${fmt}`, { fallbackName: `resume.${fmt}` }));
    }));

    const coverInput = form.elements.cover_letter;
    const coverDlBtns = body.querySelectorAll("[data-dl-cover]");
    function syncCoverDl() { const has = !!coverInput.value.trim(); coverDlBtns.forEach(b => b.disabled = !has); }
    syncCoverDl();
    coverInput.addEventListener("input", syncCoverDl);
    coverDlBtns.forEach(btn => btn.addEventListener("click", () => {
      const text = coverInput.value.trim();
      if (!text) { showToast("Write or generate a cover letter first", "error"); return; }
      const fmt = btn.dataset.dlCover;
      withBusy(btn, "…", () => downloadFile(`/api/cover-letter/download`, {
        method: "POST",
        body: { text, format: fmt, company_name: form.elements.company_name.value, role_title: form.elements.role_title.value },
        fallbackName: `cover-letter.${fmt}`,
      }));
    }));

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const payload = Object.fromEntries(new FormData(e.target).entries());
      payload.resume_id = payload.resume_id ? Number(payload.resume_id) : null;
      payload.board_id = payload.board_id ? Number(payload.board_id) : null;
      if (!payload.color) payload.color = null;
      await patch(`/api/jobs/${j.id}`, payload);
      showToast("Application updated", "success");
      closeJobOverlay(); // saving is the end of the task — return to the board
      await refreshAndReload();
    });
    body.querySelector("#detail-delete").addEventListener("click", async () => {
      const ok = await showConfirmModal({ title: "Delete Application", message: `Remove your application to ${j.company_name}? This can't be undone.` });
      if (!ok) return;
      await del(`/api/jobs/${j.id}`);
      showToast("Application deleted", "success");
      closeJobOverlay();
      await refreshAndReload();
    });
  }

  function renderDetailsTab(body) {
    const j = detail;
    body.innerHTML = `
      <form id="detail-details-form" class="job-detail-edit-main">
        <section class="jf-section">
          <div class="jf-section-head">
            <h3 class="jf-section-title">Additional details</h3>
            <span class="jf-section-tag jf-section-tag--optional">Optional</span>
          </div>
          <div class="jf-grid">
            <div class="jf-field jf-col-2"><label>Post URL</label><input type="url" name="job_link" value="${esc(j.job_link)}" placeholder="+ add URL" /></div>
            <div class="jf-field"><label>Location</label><input type="text" name="location" value="${esc(j.location)}" placeholder="+ add location" /></div>
            <div class="jf-field"><label>Salary</label><input type="text" name="salary_range" value="${esc(j.salary_range)}" placeholder="+ add salary" /></div>
            <div class="jf-field"><label>Deadline</label><input type="date" name="deadline" value="${j.deadline || ""}" /></div>
            <div class="jf-field"><label>Review / follow up by</label><input type="date" name="next_action_date" value="${j.next_action_date || ""}" /></div>
            <div class="jf-field jf-col-2"><label>Skills required</label><input type="text" name="skills_required" value="${esc(j.skills_required)}" placeholder="Comma-separated" /></div>
            <div class="jf-field jf-col-2"><label>Tags</label><input type="text" name="tags" value="${esc(j.tags)}" placeholder="Comma-separated" /></div>
            <div class="jf-field jf-col-2"><label>Source</label><input type="text" name="source" id="detail-source-input" value="${esc(j.source)}" placeholder="LinkedIn, referral…" /></div>
            <div class="jf-field jf-col-4"><label>Notes</label><textarea name="notes" id="detail-notes-input" rows="3">${esc(j.notes || "")}</textarea></div>
          </div>
        </section>
        <button type="submit" class="jf-hidden-submit" aria-hidden="true" tabindex="-1">Save</button>
      </form>`;

    const form = body.querySelector("#detail-details-form");
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const payload = Object.fromEntries(new FormData(e.target).entries());
      ["next_action_date", "deadline", "job_link"].forEach(k => { if (!payload[k]) payload[k] = null; });
      await patch(`/api/jobs/${j.id}`, payload);
      Object.assign(detail, payload); // keep the local copy in sync for the glance card
      showToast("Application updated", "success");
      closeJobOverlay(); // saving is the end of the task — return to the board
      await refreshAndReload();
    });
  }

  function renderAiTab(body) {
    body.innerHTML = `
      <div class="ai-tools">
        ${AI_DOC_STAGES.map(group => `
          <div class="ai-stage">
            <h3 class="ai-stage-title">${group.stage}</h3>
            <div class="ai-doc-grid">
              ${group.docs.map(d => `
                <div class="ai-doc-card">
                  <div class="ai-doc-title">${d.title}</div>
                  <p class="ai-doc-desc">${d.desc}</p>
                  <button class="ai-doc-cta" data-ai-doc="${d.type}" style="color:${d.color}">${d.cta} →</button>
                </div>`).join("")}
            </div>
          </div>`).join("")}
      </div>`;
    body.querySelectorAll("[data-ai-doc]").forEach(btn => btn.addEventListener("click", () => openAiDocModal(btn.dataset.aiDoc, detail)));
  }

  function renderActivitiesTab(body) {
    const j = detail;
    const logButtons = [
      ["applied", "Log Application"], ["interview", "Log Interview"],
      ["offer_received", "Log Offer Received"], ["offer_accepted", "Log Offer Accepted"],
      ["offer_declined", "Log Offer Declined"], ["note", "Add Note"],
    ];
    body.innerHTML = `
      <div class="activities-layout">
        <div class="timeline-col">
          <div class="flex items-center justify-between mb-3">
            <h3 class="font-semibold text-navy">Timeline</h3>
            <span class="text-xs text-gray-400">${j.activities.length} event${j.activities.length === 1 ? "" : "s"}</span>
          </div>
          <div id="timeline-list">${renderTimeline(j.activities)}</div>
        </div>
        <div class="log-col">
          <h4 class="log-col-title">Activity Logging</h4>
          ${logButtons.map(([kind, label]) => `<button class="log-btn" data-log="${kind}"><span class="log-plus">+</span> ${label}</button>`).join("")}
        </div>
      </div>`;
    body.querySelectorAll("[data-log]").forEach(btn => {
      btn.addEventListener("click", () => openLogActivityModal(btn.dataset.log, detail, async () => {
        detail = await get(`/api/jobs/${j.id}/detail`, { noCache: true });
        await refreshAndReload();
        renderShell();
      }));
    });
    body.querySelectorAll("[data-act-delete]").forEach(el => {
      el.addEventListener("click", async () => {
        await del(`/api/jobs/${j.id}/activities/${el.dataset.actDelete}`);
        detail = await get(`/api/jobs/${j.id}/detail`, { noCache: true });
        showToast("Activity removed", "success");
        renderShell();
      });
    });
  }

  function renderTimeline(activities) {
    if (!activities.length) return `<p class="text-sm text-gray-400 py-6">No activity yet — log your first event from the right.</p>`;
    return `<div class="timeline">${activities.map(a => {
      const m = ACTIVITY_META[a.kind] || ACTIVITY_META.other;
      const when = new Date(a.occurred_at);
      return `
        <div class="timeline-item">
          <div class="timeline-dot" style="background:${m.color}">${m.icon}</div>
          <div class="timeline-content">
            <div class="flex items-start justify-between gap-2">
              <div>
                <div class="timeline-title">${esc(a.title) || m.label}</div>
                ${a.body ? `<div class="timeline-detail">${esc(a.body)}</div>` : ""}
              </div>
              <span class="timeline-del" data-act-delete="${a.id}" title="Remove">✕</span>
            </div>
            <div class="timeline-time">${when.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })} · ${when.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}</div>
          </div>
        </div>`;
    }).join("")}</div>`;
  }

  function renderContactsTab(body) {
    const j = detail;
    body.innerHTML = `
      <div style="max-width:760px;">
        <div class="flex items-center justify-between mb-4">
          <h3 class="font-semibold text-navy">Contacts</h3>
          <button class="btn btn-accent" id="add-contact" style="padding:6px 12px; font-size:11px;">+ Add Contact</button>
        </div>
        <div id="contacts-list">${renderContacts(j.contacts)}</div>
      </div>`;
    body.querySelector("#add-contact").addEventListener("click", () => openContactModal(null, detail, reloadDetailContacts));
    wireContactActions();
  }

  function renderContacts(contacts) {
    if (!contacts.length) return `<p class="text-sm text-gray-400 py-6">No contacts yet. Add a recruiter, referrer, or hiring manager — with their LinkedIn — to keep everyone in one place.</p>`;
    return `<div class="contacts-grid">${contacts.map(c => `
      <div class="contact-card">
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0">
            <div class="contact-name">${esc(c.name)}</div>
            ${c.role ? `<div class="contact-role">${esc(c.role)}</div>` : ""}
          </div>
          <div class="flex items-center gap-1.5 shrink-0">
            <span class="contact-action" data-contact-edit="${c.id}" title="Edit">✎</span>
            <span class="contact-action" data-contact-delete="${c.id}" title="Remove">✕</span>
          </div>
        </div>
        <div class="contact-links">
          ${c.email ? `<a href="mailto:${esc(c.email)}" class="contact-link">✉ ${esc(c.email)}</a>` : ""}
          ${c.linkedin_url ? `<a href="${safeUrl(c.linkedin_url)}" target="_blank" rel="noopener noreferrer" class="contact-link contact-linkedin">in · LinkedIn ↗</a>` : ""}
        </div>
        ${c.notes ? `<div class="contact-notes">${esc(c.notes)}</div>` : ""}
      </div>`).join("")}</div>`;
  }

  async function reloadDetailContacts() {
    detail = await get(`/api/jobs/${detail.id}/detail`, { noCache: true });
    const body = document.getElementById("job-detail-body");
    if (activeTab.id === "contacts") renderContactsTab(body);
  }

  function wireContactActions() {
    document.querySelectorAll("[data-contact-edit]").forEach(el => {
      el.addEventListener("click", () => {
        const c = detail.contacts.find(x => x.id === Number(el.dataset.contactEdit));
        openContactModal(c, detail, reloadDetailContacts);
      });
    });
    document.querySelectorAll("[data-contact-delete]").forEach(el => {
      el.addEventListener("click", async () => {
        await del(`/api/jobs/${detail.id}/contacts/${el.dataset.contactDelete}`);
        showToast("Contact removed", "success");
        reloadDetailContacts();
      });
    });
  }

  renderShell();
}

// ---------- Log-activity modal ----------
function openLogActivityModal(kind, job, onSaved) {
  const meta = ACTIVITY_META[kind] || ACTIVITY_META.other;
  const root = document.getElementById("modal-root");
  const nowLocal = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  root.innerHTML = `
    <div class="modal-backdrop" data-modal-backdrop>
      <div class="modal-box p-5" style="max-width:460px;">
        <h3 class="font-bold text-base mb-3">${meta.icon} ${meta.label}</h3>
        <form id="log-activity-form" class="space-y-3">
          <input type="text" name="title" placeholder="Title (e.g. Phone screen with recruiter)" />
          <textarea name="body" rows="3" placeholder="Details (optional)"></textarea>
          <div><label class="text-xs text-gray-400 mb-1 block">When</label><input type="datetime-local" name="occurred_at" value="${nowLocal}" /></div>
          <div class="flex justify-end gap-2 pt-1">
            <button type="button" class="btn btn-ghost" id="log-cancel">Cancel</button>
            <button type="submit" class="btn btn-accent">Log it</button>
          </div>
        </form>
      </div>
    </div>`;
  root.classList.remove("hidden");
  root.querySelector("[data-modal-backdrop]").addEventListener("click", (e) => { if (e.target === e.currentTarget) closeModal(); });
  root.querySelector("#log-cancel").addEventListener("click", closeModal);
  root.querySelector("#log-activity-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const payload = Object.fromEntries(new FormData(e.target).entries());
    payload.kind = kind;
    if (payload.occurred_at) payload.occurred_at = new Date(payload.occurred_at).toISOString();
    if (!payload.title) delete payload.title;
    if (!payload.body) delete payload.body;
    await post(`/api/jobs/${job.id}/activities`, payload);
    const statusMap = { applied: "applied", interview: "interview", offer_received: "offer" };
    if (statusMap[kind] && job.status !== statusMap[kind]) await patch(`/api/jobs/${job.id}`, { status: statusMap[kind] });
    showToast(`${meta.label} logged`, "success");
    closeModal();
    if (onSaved) await onSaved();
  });
}

// ---------- Contact modal ----------
function openContactModal(contact, job, onSaved) {
  const root = document.getElementById("modal-root");
  const c = contact || {};
  root.innerHTML = `
    <div class="modal-backdrop" data-modal-backdrop>
      <div class="modal-box p-5" style="max-width:460px;">
        <h3 class="font-bold text-base mb-3">${contact ? "Edit Contact" : "Add Contact"}</h3>
        <form id="contact-form" class="space-y-3">
          <input type="text" name="name" placeholder="Name" value="${esc(c.name)}" required />
          <input type="text" name="role" placeholder="Role (e.g. Technical Recruiter)" value="${esc(c.role)}" />
          <input type="email" name="email" placeholder="Email" value="${esc(c.email)}" />
          <input type="url" name="linkedin_url" placeholder="LinkedIn URL (https://linkedin.com/in/…)" value="${esc(c.linkedin_url)}" />
          <textarea name="notes" rows="2" placeholder="Notes (optional)">${esc(c.notes || "")}</textarea>
          <div class="flex justify-end gap-2 pt-1">
            <button type="button" class="btn btn-ghost" id="contact-cancel">Cancel</button>
            <button type="submit" class="btn btn-accent">${contact ? "Save" : "Add"}</button>
          </div>
        </form>
      </div>
    </div>`;
  root.classList.remove("hidden");
  root.querySelector("[data-modal-backdrop]").addEventListener("click", (e) => { if (e.target === e.currentTarget) closeModal(); });
  root.querySelector("#contact-cancel").addEventListener("click", closeModal);
  root.querySelector("#contact-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const payload = Object.fromEntries(new FormData(e.target).entries());
    ["role", "email", "linkedin_url", "notes"].forEach(k => { if (!payload[k]) delete payload[k]; });
    if (contact) await patch(`/api/jobs/${job.id}/contacts/${contact.id}`, payload);
    else await post(`/api/jobs/${job.id}/contacts`, payload);
    showToast(contact ? "Contact updated" : "Contact added", "success");
    closeModal();
    if (onSaved) await onSaved();
  });
}

// ---------- AI document modal ----------
function openAiDocModal(docType, job) {
  const root = document.getElementById("modal-root");
  root.innerHTML = `
    <div class="modal-backdrop" data-modal-backdrop>
      <div class="modal-box p-5" style="max-width:640px; max-height:90vh; overflow-y:auto;">
        <div class="flex items-center justify-between mb-3">
          <h3 class="font-bold text-base" id="ai-doc-title">Generating…</h3>
          <button class="btn btn-ghost" id="ai-doc-close" style="padding:4px 10px;">Close</button>
        </div>
        <div id="ai-doc-content"><div class="spinner"></div></div>
      </div>
    </div>`;
  root.classList.remove("hidden");
  root.querySelector("[data-modal-backdrop]").addEventListener("click", (e) => { if (e.target === e.currentTarget) closeModal(); });
  root.querySelector("#ai-doc-close").addEventListener("click", closeModal);

  post(`/api/jobs/ai/document`, { doc_type: docType, job_id: job.id }).then(res => {
    document.getElementById("ai-doc-title").textContent = res.title;
    document.getElementById("ai-doc-content").innerHTML = `
      <div class="ai-doc-output">
        <span class="badge ${res.mode === "llm" ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-500"} mb-2 inline-block">${res.mode === "llm" ? "AI-generated" : "Smart template"}</span>
        <textarea id="ai-doc-text" rows="16" class="w-full text-sm" style="font-family:var(--lp-mono,monospace); line-height:1.6;">${esc(res.text)}</textarea>
        <div class="flex gap-2 mt-3">
          <button class="btn btn-accent" id="ai-doc-copy">Copy</button>
          <button class="btn btn-ghost" id="ai-doc-regen">Regenerate</button>
        </div>
      </div>`;
    document.getElementById("ai-doc-copy").addEventListener("click", () => {
      navigator.clipboard.writeText(document.getElementById("ai-doc-text").value);
      showToast("Copied to clipboard", "success");
    });
    document.getElementById("ai-doc-regen").addEventListener("click", () => { closeModal(); openAiDocModal(docType, job); });
  }).catch(() => {
    document.getElementById("ai-doc-content").innerHTML = `<p class="text-red-600 text-sm">Couldn't generate that document. Please try again.</p>`;
  });
}

function openCoverLetterModal(job, resumes) {
  const root = document.getElementById("modal-root");
  const isJobContext = !!(job && job.id);

  root.innerHTML = `
    <div class="modal-backdrop" data-modal-backdrop>
      <div class="modal-box p-5" style="max-width:600px; max-height:90vh; overflow-y:auto">
        <h3 class="font-bold text-base mb-1">✍️ Cover Letter Generator</h3>
        <p class="text-xs text-gray-400 mb-4">${isJobContext ? `${job.company_name} — ${job.role_title}` : "Runs entirely locally — no external AI service is called"}</p>

        <label class="text-xs font-semibold text-gray-500 mb-1 block">Resume / CV to use</label>
        <select id="cl-resume-select" class="mb-3">
          ${resumes.map(r => `<option value="${r.id}" ${r.id === (job?.resume_id) ? "selected" : ""}>${esc(r.name)}${r.has_text ? "" : " (no text found)"}</option>`).join("")}
        </select>

        <div class="grid grid-cols-2 gap-3 mb-3">
          <input type="text" id="cl-company-input" placeholder="Company (optional)" value="${esc(job?.company_name || "")}" />
          <input type="text" id="cl-role-input" placeholder="Role title (optional)" value="${esc(job?.role_title || "")}" />
        </div>

        <label class="text-xs font-semibold text-gray-500 mb-1 block">Job description</label>
        <textarea id="cl-jd-input" rows="5" placeholder="Paste the job description here...">${esc(job?.job_description || "")}</textarea>

        <div id="cl-result" class="mt-4"></div>

        <div class="flex justify-end gap-2 mt-4">
          <button type="button" class="btn btn-ghost" data-modal-cancel>Close</button>
          <button type="button" class="btn btn-accent" id="cl-generate-btn">✨ ${job?.cover_letter ? "Regenerate" : "Generate"} Cover Letter</button>
        </div>
      </div>
    </div>`;
  root.classList.remove("hidden");

  const resultEl = root.querySelector("#cl-result");
  let currentLetter = job?.cover_letter || "";
  if (currentLetter) renderCoverLetterResult(resultEl, currentLetter, null, job, isJobContext);

  root.querySelector("[data-modal-backdrop]").addEventListener("click", (e) => { if (e.target === e.currentTarget) closeModal(); });
  root.querySelector("[data-modal-cancel]").addEventListener("click", closeModal);

  root.querySelector("#cl-generate-btn").addEventListener("click", async () => {
    const btn = root.querySelector("#cl-generate-btn");
    const resumeId = Number(root.querySelector("#cl-resume-select").value);
    const jd = root.querySelector("#cl-jd-input").value.trim();
    const companyName = root.querySelector("#cl-company-input").value.trim();
    const roleTitle = root.querySelector("#cl-role-input").value.trim();
    if (!jd || jd.length < 20) { showToast("Paste a fuller job description for a tailored letter", "error"); return; }
    btn.disabled = true;
    btn.textContent = "Writing... (can take a moment)";
    try {
      const result = await post(`/api/cover-letter/generate`, {
        resume_id: resumeId, job_description: jd, company_name: companyName, role_title: roleTitle,
      });
      currentLetter = result.cover_letter;
      renderCoverLetterResult(resultEl, result.cover_letter, result, job, isJobContext);
      if (isJobContext) {
        await patch(`/api/jobs/${job.id}`, { cover_letter: result.cover_letter, job_description: jd, resume_id: resumeId });
        job.cover_letter = result.cover_letter;  // keep the in-memory job list in sync immediately
        job.job_description = jd;
        job.resume_id = resumeId;
        showToast("Cover letter saved to this application", "success");
        render(); // refresh the List/Kanban view behind the modal so its "Generate" button becomes "View"
      }
    } catch (err) {
      showToast(err.message.replace(/^API.*?:\s*\d+\s*/, "") || "Couldn't generate the cover letter", "error");
    } finally {
      btn.disabled = false;
      btn.textContent = `✨ ${currentLetter ? "Regenerate" : "Generate"} Cover Letter`;
    }
  });
}

function renderCoverLetterResult(container, letterText, genResult, job, isJobContext) {
  const wordCount = letterText.split(/\s+/).filter(Boolean).length;
  const mode = genResult?.mode;
  container.innerHTML = `
    <div class="border border-gray-100 rounded-lg p-3">
      <div class="flex items-center justify-between mb-2 flex-wrap gap-2">
        <div class="flex items-center gap-2">
          <span class="text-xs font-semibold text-gray-500">${wordCount} words</span>
          ${mode ? `<span class="badge ${mode === "llm" ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-500"} !text-[8px] !py-0.5">${mode === "llm" ? "Local AI" : "Lite mode"}</span>` : ""}
        </div>
        <div class="flex items-center gap-2">
          <button type="button" class="text-xs text-navy underline" id="cl-copy-btn">Copy</button>
          <button type="button" class="text-xs text-navy underline" id="cl-download-btn">Download .txt</button>
        </div>
      </div>
      <textarea id="cl-letter-text" rows="12" class="text-sm leading-relaxed">${esc(letterText)}</textarea>
    </div>
  `;
  container.querySelector("#cl-copy-btn").addEventListener("click", async () => {
    await navigator.clipboard.writeText(container.querySelector("#cl-letter-text").value);
    showToast("Copied to clipboard", "success");
  });
  container.querySelector("#cl-download-btn").addEventListener("click", () => {
    const blob = new Blob([container.querySelector("#cl-letter-text").value], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `cover-letter${job?.company_name ? "-" + job.company_name.replace(/\s+/g, "-") : ""}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  });
  if (isJobContext) {
    container.querySelector("#cl-letter-text").addEventListener("blur", async (e) => {
      if (e.target.value.trim() && e.target.value !== letterText) {
        await patch(`/api/jobs/${job.id}`, { cover_letter: e.target.value });
        job.cover_letter = e.target.value;
        showToast("Edits saved", "success");
      }
    });
  }
}

function openAtsModal(job, resumes) {
  const root = document.getElementById("modal-root");
  const existingBreakdown = job.ats_breakdown ? JSON.parse(job.ats_breakdown) : null;

  root.innerHTML = `
    <div class="modal-backdrop" data-modal-backdrop>
      <div class="modal-box p-5" style="max-width:560px; max-height:90vh; overflow-y:auto">
        <h3 class="font-bold text-base mb-1">ATS Score Checker</h3>
        <p class="text-xs text-gray-400 mb-4">${job.company_name} — ${job.role_title}</p>

        <label class="text-xs font-semibold text-gray-500 mb-1 block">Resume to check</label>
        <select id="ats-resume-select" class="mb-3">
          ${resumes.map(r => `<option value="${r.id}" ${r.id === job.resume_id ? "selected" : ""}>${esc(r.name)}${r.has_text ? "" : " (no text found)"}</option>`).join("")}
        </select>

        <label class="text-xs font-semibold text-gray-500 mb-1 block">Job description</label>
        <textarea id="ats-jd-input" rows="6" placeholder="Paste the job description here...">${esc(job.job_description || "")}</textarea>

        <div id="ats-result" class="mt-4"></div>
        <div id="ats-tailor-action" class="hidden mt-3 border-t border-gray-100 pt-3">
          <button type="button" class="btn btn-accent w-full justify-center" id="ats-tailor-btn">
            📄 Generate ATS-Optimized Resume for This Application
          </button>
          <p class="text-[10px] text-gray-400 mt-1.5 text-center">Rebuilds your resume in the same template with matched keywords emphasized, saves it to your library, and links it to this application. Works on Resume Builder resumes only.</p>
        </div>

        <div class="flex justify-end gap-2 mt-4">
          <button type="button" class="btn btn-ghost" data-modal-cancel>Close</button>
          <button type="button" class="btn btn-accent" id="ats-run-btn">Run ATS Check</button>
        </div>
      </div>
    </div>`;
  root.classList.remove("hidden");

  const resultEl = root.querySelector("#ats-result");
  const tailorAction = root.querySelector("#ats-tailor-action");
  if (existingBreakdown) {
    renderAtsResult(resultEl, { score: job.ats_score, ...existingBreakdown });
    tailorAction.classList.remove("hidden");
  }

  root.querySelector("[data-modal-backdrop]").addEventListener("click", (e) => { if (e.target === e.currentTarget) closeModal(); });
  root.querySelector("[data-modal-cancel]").addEventListener("click", closeModal);

  root.querySelector("#ats-run-btn").addEventListener("click", async () => {
    const btn = root.querySelector("#ats-run-btn");
    const resumeId = Number(root.querySelector("#ats-resume-select").value);
    const jd = root.querySelector("#ats-jd-input").value.trim();
    if (!jd || jd.length < 20) { showToast("Paste a fuller job description for an accurate score", "error"); return; }
    btn.disabled = true;
    btn.textContent = "Scoring...";
    try {
      const result = await post(`/api/ats/check`, { resume_id: resumeId, job_description: jd });
      renderAtsResult(resultEl, result);
      tailorAction.classList.remove("hidden");
      await patch(`/api/jobs/${job.id}`, {
        job_description: jd, resume_id: resumeId,
        ats_score: result.score, ats_breakdown: JSON.stringify(result),
      });
      showToast("ATS score saved to this application", "success");
      render();
    } catch (err) {
      showToast(err.message.replace(/^API.*?:\s*\d+\s*/, "") || "Couldn't run the ATS check", "error");
    } finally {
      btn.disabled = false;
      btn.textContent = "Run ATS Check";
    }
  });

  root.querySelector("#ats-tailor-btn").addEventListener("click", async () => {
    const btn = root.querySelector("#ats-tailor-btn");
    const resumeId = Number(root.querySelector("#ats-resume-select").value);
    const jd = root.querySelector("#ats-jd-input").value.trim();
    if (!jd || jd.length < 20) { showToast("Paste a fuller job description first", "error"); return; }
    btn.disabled = true;
    btn.textContent = "Tailoring... (can take a moment)";
    try {
      const newResume = await post(`/api/resume-builder/tailor-for-job`, {
        resume_id: resumeId, job_description: jd,
        company_name: job.company_name, role_title: job.role_title, job_id: job.id,
      });
      showToast(`Saved "${newResume.name}" to your resume library and linked it to this application`, "success");
      closeModal();
      render();
    } catch (err) {
      showToast(err.message.replace(/^API.*?:\s*\d+\s*/, "") || "Couldn't generate the tailored resume", "error");
    } finally {
      btn.disabled = false;
      btn.textContent = "📄 Generate ATS-Optimized Resume for This Application";
    }
  });
}

function renderAtsResult(container, result) {
  const color = result.score >= 75 ? "#2C42C7" : result.score >= 50 ? "#B45309" : "#B91C1C";
  container.innerHTML = `
    <div class="border border-gray-100 rounded-lg p-4">
      <div class="flex items-center gap-4 mb-3">
        <div class="text-3xl font-extrabold" style="color:${color}">${result.score}%</div>
        <div class="flex-1">
          <div class="progress-track"><div class="progress-fill" style="width:${result.score}%; background:${color}"></div></div>
          <p class="text-xs text-gray-400 mt-1">Keyword coverage ${result.keyword_coverage_percent}% · Term similarity ${result.term_similarity_percent}%</p>
        </div>
      </div>
      ${result.ai_summary ? `
      <div class="ai-insight-card mb-3">
        <div class="flex items-center gap-1.5 mb-1.5">
          <span class="text-sm">✨</span>
          <span class="text-xs font-bold text-navy">AI Insight</span>
          <span class="badge ${result.ai_mode === "llm" ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-500"} !text-[8px] !py-0.5">${result.ai_mode === "llm" ? "Local AI" : "Lite mode"}</span>
        </div>
        <p class="text-xs text-gray-700 leading-relaxed">${esc(result.ai_summary)}</p>
      </div>` : ""}
      ${result.matched_keywords?.length ? `<p class="text-xs font-semibold text-gray-500 mb-1">Matched keywords</p>
      <div class="flex flex-wrap gap-1 mb-3">${result.matched_keywords.map(k => `<span class="badge bg-emerald-100 text-emerald-700">${esc(k)}</span>`).join("")}</div>` : ""}
      ${result.missing_keywords?.length ? `<p class="text-xs font-semibold text-gray-500 mb-1">Missing from your resume</p>
      <div class="flex flex-wrap gap-1 mb-3">${result.missing_keywords.map(k => `<span class="badge bg-red-50 text-red-600">${esc(k)}</span>`).join("")}</div>` : ""}
      ${result.matched_soft_skills?.length ? `<p class="text-xs font-semibold text-gray-500 mb-1">Soft skills detected</p>
      <div class="flex flex-wrap gap-1 mb-3">${result.matched_soft_skills.map(k => `<span class="badge bg-indigo-100 text-indigo-700">${esc(k)}</span>`).join("")}</div>` : ""}
      ${result.title_seniority_match === false ? `<p class="text-xs text-amber-700 bg-amber-50 rounded-md px-2.5 py-1.5 mb-2">⚠ Seniority level may not match this job description.</p>` : ""}
      ${result.recommendations?.length ? `<p class="text-xs font-semibold text-gray-500 mb-1">Recommendations</p>
      <ul class="text-xs text-gray-600 space-y-1 list-disc list-inside">${result.recommendations.map(r => `<li>${esc(r)}</li>`).join("")}</ul>` : ""}
    </div>
  `;
}

// ============================================================================
// RESUMES
// ============================================================================
// ============================================================================
// RESUMES — one page, two views
// The library and the builder used to be separate nav entries, which meant
// editing a resume was a navigation act rather than an edit. They're now
// sub-tabs of a single page (rendered into the header, like the dashboard),
// and `state.builderResumeId` decides whether the builder is creating a new
// resume or editing an existing one in place.
// ============================================================================
async function renderResumesPage(content) {
  const tabsSlot = document.getElementById("view-tabs-slot");
  const controls = document.getElementById("header-controls");
  const view = state.resumesView || "library";

  tabsSlot.innerHTML = `
    <div class="view-tabs dash-tabs" id="resumes-subtabs">
      <button type="button" class="view-tab ${view === "library" ? "active" : ""}" data-res-tab="library">📄 My Resumes</button>
      <button type="button" class="view-tab ${view === "builder" ? "active" : ""}" data-res-tab="builder">🛠️ Builder</button>
    </div>`;
  tabsSlot.querySelectorAll("[data-res-tab]").forEach(btn => {
    btn.addEventListener("click", () => {
      state.resumesView = btn.dataset.resTab;
      if (btn.dataset.resTab === "builder" && !state.builderResumeId) state.builderResumeId = null;
      scrollPageTo(0);
      render();
    });
  });

  if (view === "builder") {
    await renderResumeBuilder(content);
  } else {
    controls.innerHTML = `<button class="btn btn-accent" id="new-resume-btn">+ Build a Resume</button>`;
    controls.querySelector("#new-resume-btn").addEventListener("click", () => {
      EDITOR.loadedFor = null; EDITOR.resumeName = ""; EDITOR.undoStack = []; EDITOR.values = {};
      state.builderResumeId = null;
      state.resumesView = "builder";
      scrollPageTo(0);
      render();
    });
    await renderResumes(content);
  }
}

// Opens a resume in the builder for editing, keeping the same resume id so
// the edit revises it in place rather than spawning a near-duplicate.
function editResumeInBuilder(resumeId) {
  // Clear any previous editing session so the editor loads this resume's
  // data rather than reusing whatever was last open.
  EDITOR.loadedFor = null; EDITOR.resumeName = ""; EDITOR.undoStack = []; EDITOR.values = {};
  state.builderResumeId = resumeId;
  state.resumesView = "builder";
  scrollPageTo(0);
  render();
}

// Relative "Last Edited: a few seconds ago" stamp.
function timeAgo(iso) {
  if (!iso) return "never";
  const secs = Math.max(0, (Date.now() - new Date(iso + (iso.endsWith("Z") ? "" : "Z")).getTime()) / 1000);
  if (secs < 45) return "a few seconds ago";
  const units = [[60, "minute"], [60, "hour"], [24, "day"], [7, "week"], [4.35, "month"], [12, "year"]];
  let v = secs / 60, i = 0;
  while (i < units.length - 1 && v >= units[i + 1][0]) { v /= units[i + 1][0]; i++; }
  const n = Math.floor(v);
  return `${n} ${units[i][1]}${n === 1 ? "" : "s"} ago`;
}

// Downloads a file from an authed endpoint. Works for GET (e.g. resume export)
// and POST-with-body (e.g. cover-letter export). Uses the server's
// Content-Disposition filename when present, falling back to `fallbackName`.
async function downloadFile(path, { method = "GET", body = null, fallbackName = "download" } = {}) {
  const headers = {};
  if (body) headers["Content-Type"] = "application/json";
  const token = auth.getToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  if (!res.ok) {
    let detail = "";
    try { detail = (await res.json()).detail; } catch (_) {}
    const err = new Error(detail || `Download failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  const blob = await res.blob();
  let name = fallbackName;
  const cd = res.headers.get("Content-Disposition") || "";
  const m = cd.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
  if (m) name = decodeURIComponent(m[1]);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

// Fetches a resume PDF as an object URL. The /uploads route is served with
// Content-Disposition: attachment (so a stolen link can't render in-origin),
// which also stops it being used directly as an <iframe src> — fetching it
// as a blob gives us an inline preview without weakening that header.
const _pdfBlobCache = new Map();
async function resumePdfUrl(filename) {
  if (!filename) return null;
  if (_pdfBlobCache.has(filename)) return _pdfBlobCache.get(filename);
  try {
    const res = await fetch(`${API_BASE}/uploads/${encodeURIComponent(filename)}`, {
      headers: auth.getToken() ? { Authorization: `Bearer ${auth.getToken()}` } : {},
    });
    if (!res.ok) return null;
    const url = URL.createObjectURL(await res.blob());
    _pdfBlobCache.set(filename, url);
    return url;
  } catch { return null; }
}

async function renderResumes(content) {
  const [resumes, jobs] = await Promise.all([get(`/api/resumes`), get(`/api/jobs`)]);
  const usageCount = {};
  jobs.forEach(j => { if (j.resume_id) usageCount[j.resume_id] = (usageCount[j.resume_id] || 0) + 1; });
  const jobById = Object.fromEntries(jobs.map(j => [j.id, j]));

  const tab = state.resumesLibTab || "base";
  const base = resumes.filter(r => !r.tailored_for_job_id);
  const tailored = resumes.filter(r => r.tailored_for_job_id);
  const shown = tab === "tailored" ? tailored : base;

  content.innerHTML = `
    <div class="rlib-tabs">
      <button class="rlib-tab ${tab === "base" ? "active" : ""}" data-lib-tab="base">
        <span class="rlib-tab-icon">📄</span> Base Resumes <span class="rlib-tab-count">${base.length}</span>
      </button>
      <button class="rlib-tab ${tab === "tailored" ? "active" : ""}" data-lib-tab="tailored">
        <span class="rlib-tab-icon">🎯</span> Job Tailored Resumes <span class="rlib-tab-count">${tailored.length}</span>
      </button>
      <div class="rlib-tabs-spacer"></div>
      <button class="btn btn-ghost" id="toggle-upload">⬆ Upload &amp; edit</button>
    </div>

    <div class="res-upload" id="res-upload" hidden>
      <form id="resume-form" class="res-upload-form">
        <label class="res-drop" id="res-drop">
          <input type="file" name="file" accept=".pdf,.doc,.docx,.odp" required hidden />
          <span class="res-drop-icon" aria-hidden="true">⬆</span>
          <span class="res-drop-main"><b>Choose a file</b> or drag it here</span>
          <span class="res-drop-sub">PDF, DOC, DOCX or ODP · up to 1MB</span>
        </label>
        <div class="res-drop-picked" id="res-drop-picked" hidden>
          <span class="res-drop-doc" aria-hidden="true">📄</span>
          <span class="res-drop-name" id="res-drop-name"></span>
          <span class="res-drop-size" id="res-drop-size"></span>
          <button type="button" class="res-drop-clear" id="res-drop-clear" aria-label="Remove file">✕</button>
        </div>
        <button class="btn btn-accent res-upload-go" type="submit" disabled>⬆ Upload &amp; make editable</button>
      </form>
      <p class="res-upload-hint">We read the file, pull out your name, contact details, summary, experience, education and skills, and drop them straight into the Resume Builder so you can review and edit everything before saving.</p>
    </div>

    <div class="rlib-grid" id="resume-cards"></div>
  `;

  content.querySelectorAll("[data-lib-tab]").forEach(b => b.addEventListener("click", () => {
    state.resumesLibTab = b.dataset.libTab; render();
  }));
  const uploadPanel = content.querySelector("#res-upload");
  content.querySelector("#toggle-upload").addEventListener("click", (e) => {
    uploadPanel.hidden = !uploadPanel.hidden;
    e.currentTarget.classList.toggle("active", !uploadPanel.hidden);
  });
  // The dropzone. The native file input is the one control browsers refuse to
  // style, and "Choose File / No file chosen" told you nothing about what was
  // accepted and gave you no way to drop a file. The input is still the source
  // of truth — it's just hidden behind a label, so clicks, keyboard and form
  // validation all keep working.
  const drop = content.querySelector("#res-drop");
  const dropInput = drop.querySelector("input[type=file]");
  const picked = content.querySelector("#res-drop-picked");
  const goBtn = content.querySelector(".res-upload-go");

  // The `accept` attribute only filters the file dialog — a drag-and-drop
  // ignores it entirely, so the check has to live here too. The backend
  // enforces both of these again; this exists to fail in a tenth of a second
  // instead of after uploading a megabyte.
  const RESUME_EXTS = [".pdf", ".doc", ".docx", ".odp"];
  const RESUME_MAX_BYTES = 1024 * 1024;
  const rejectReason = (f) => {
    const name = (f.name || "").toLowerCase();
    if (!RESUME_EXTS.some(x => name.endsWith(x))) return "That file type isn't supported — use a PDF, DOC, DOCX or ODP.";
    if (f.size > RESUME_MAX_BYTES) return `That file is ${(f.size / 1024 / 1024).toFixed(1)}MB — the limit is 1MB.`;
    return null;
  };

  const showPicked = () => {
    const f = dropInput.files[0];
    if (f) {
      const bad = rejectReason(f);
      if (bad) {
        dropInput.value = "";
        showToast(bad, "warning");
        picked.hidden = true;
        drop.hidden = false;
        goBtn.disabled = true;
        return;
      }
    }
    if (!f) {
      picked.hidden = true;
      drop.hidden = false;
      goBtn.disabled = true;
      return;
    }
    content.querySelector("#res-drop-name").textContent = f.name;
    const kb = f.size / 1024;
    content.querySelector("#res-drop-size").textContent =
      kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(kb))} KB`;
    picked.hidden = false;
    drop.hidden = true;      // one control at a time — the file replaces the prompt
    goBtn.disabled = false;
  };

  dropInput.addEventListener("change", showPicked);
  content.querySelector("#res-drop-clear").addEventListener("click", () => {
    dropInput.value = "";    // also lets the same file be re-picked, which a
    showPicked();            // change listener alone would silently ignore
  });

  // Dropping a file anywhere on the panel counts, not just on the dashed box.
  ["dragenter", "dragover"].forEach(evt => drop.addEventListener(evt, (e) => {
    e.preventDefault();
    drop.classList.add("is-over");
  }));
  ["dragleave", "drop"].forEach(evt => drop.addEventListener(evt, (e) => {
    e.preventDefault();
    if (evt === "dragleave" && drop.contains(e.relatedTarget)) return; // still inside
    drop.classList.remove("is-over");
  }));
  drop.addEventListener("drop", (e) => {
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (!f) return;
    const dt = new DataTransfer();
    dt.items.add(f);
    dropInput.files = dt.files;   // assigning FileList is how a drop reaches the input
    showPicked();
  });

  content.querySelector("#resume-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.target;
    const fileInput = form.querySelector("input[type=file]");
    if (!fileInput.files.length) { showToast("Choose a file first", "warning"); return; }
    const submitBtn = form.querySelector("button[type=submit]");
    const originalLabel = submitBtn.textContent;
    submitBtn.disabled = true;
    submitBtn.textContent = "Reading your resume…";
    try {
      const fd = new FormData();
      fd.append("file", fileInput.files[0]);
      const result = await post(`/api/resume-builder/parse-upload`, fd);
      EDITOR.loadedFor = "new";
      EDITOR.resumeName = result.resume_name || "Untitled Resume";
      EDITOR.undoStack = [];
      EDITOR.values = { ...result.data };
      delete EDITOR.values.mode;
      state.builderResumeId = null;
      state.resumesView = "builder";
      scrollPageTo(0);
      showToast(
        result.mode === "llm"
          ? "Resume imported — review the details below, then save"
          : "Resume imported — some formatting may need a quick touch-up, review below",
        "success",
      );
      render();
    } catch (err) {
      showToast(apiErrorMessage(err, "Couldn't read that file"), "error");
      submitBtn.disabled = false;
      submitBtn.textContent = originalLabel;
    }
  });

  const grid = document.getElementById("resume-cards");
  if (!shown.length) {
    grid.innerHTML = `
      <div class="res-empty">
        <div class="res-empty-icon">${tab === "tailored" ? "🎯" : "📄"}</div>
        <h3>${tab === "tailored" ? "No tailored resumes yet" : "No resumes yet"}</h3>
        <p>${tab === "tailored"
          ? "Open a job application and use <strong>Tailor to job</strong> — the tailored copy lands here, leaving your base resume untouched."
          : "Build one from a template and it stays fully editable, or upload a PDF you already have."}</p>
        ${tab === "base" ? `<button class="btn btn-accent" id="res-empty-build">+ Build a Resume</button>` : ""}
      </div>`;
    grid.querySelector("#res-empty-build")?.addEventListener("click", () => {
      EDITOR.loadedFor = null; EDITOR.resumeName = ""; EDITOR.undoStack = []; EDITOR.values = {};
      state.builderResumeId = null; state.resumesView = "builder"; render();
    });
    return;
  }

  grid.innerHTML = shown.map(r => {
    const tpl = TEMPLATE_META[r.template_id] || {};
    const job = r.tailored_for_job_id ? jobById[r.tailored_for_job_id] : null;
    const used = usageCount[r.id] || 0;
    const subtitle = job ? `${esc(job.company_name)} · ${esc(job.role_title)}`
                         : (r.notes ? esc(r.notes) : (r.has_builder_data ? "Base resume" : "Uploaded file"));
    return `
    <article class="rcard" data-rid="${r.id}">
      <div class="rcard-preview" data-preview-for="${r.id}" data-filename="${esc(r.filename || "")}">
        <div class="rcard-preview-skeleton"><span class="spinner-sm"></span></div>
        ${r.template_id ? `<div class="rcard-tpl-chip"><span class="rcard-tpl-dot"></span>${esc((tpl.label || r.template_id).replace(/_/g, " "))}</div>` : ""}
      </div>
      <div class="rcard-body">
        <h3 class="rcard-title" title="${esc(r.name)}">${esc(r.name)}</h3>
        <p class="rcard-sub">${subtitle}</p>
        <div class="rcard-actions">
          ${r.has_builder_data
            ? `<button class="rcard-act primary" data-res-edit="${r.id}"><span class="rcard-act-i">✎</span> Edit Resume</button>
               <button class="rcard-act" data-res-tailor="${r.id}"><span class="rcard-act-i">🎯</span> Tailor to Job</button>`
            : `<span class="rcard-act disabled" title="Uploaded files have no structured data to edit"><span class="rcard-act-i">🔒</span> Not editable</span>`}
          <button class="rcard-act" data-res-download="${r.id}" ${r.filename ? "" : "disabled"}><span class="rcard-act-i">⬇</span> Download</button>
          ${r.has_builder_data ? `<button class="rcard-act" data-res-duplicate="${r.id}"><span class="rcard-act-i">⧉</span> Duplicate</button>` : ""}
          <button class="rcard-act danger" data-res-delete="${r.id}"><span class="rcard-act-i">🗑</span> Delete</button>
        </div>
        <p class="rcard-edited">Last Edited: ${timeAgo(r.updated_at || r.created_at)}${used ? ` · used in ${used} application${used === 1 ? "" : "s"}` : ""}</p>
      </div>
    </article>`;
  }).join("");

  // Fill each card's preview after paint, so the grid appears immediately.
  //
  // Anything built here is re-rendered with its own template renderer — the
  // same code the Design gallery and the live preview use — so the card shows
  // the actual chosen design, filling the frame. The old approach embedded the
  // PDF in an iframe, which handed the layout to the browser's PDF viewer and
  // produced a scrollbarred, half-empty crop (and nothing at all for files it
  // wouldn't inline). Uploaded files have no structured data to re-render, so
  // they keep the embedded view.
  const templatesReady = rbEnsureTemplates();
  shown.forEach(async r => {
    const holder = grid.querySelector(`[data-preview-for="${r.id}"]`);
    if (!holder) return;
    const chip = holder.querySelector(".rcard-tpl-chip")?.outerHTML || "";

    if (r.has_builder_data) {
      let saved = null;
      // The real document, rendered by the same endpoint the editor uses. This
      // card used to draw rbMiniPageHTML — a CSS approximation reconstructed
      // from the template's descriptors — so a saved resume was shown in
      // something that merely resembled its template. Anything the mini-HTML
      // has no equivalent for (banded headings, two-column skills, a photo)
      // silently came out as a plain single column, which is exactly the case
      // the customer is looking at when they check what they saved.
      try {
        [saved] = await Promise.all([get(`/api/resume-builder/${r.id}/data`), templatesReady]);
        if (!document.body.contains(holder)) return;
        const tid = saved.template_id || r.template_id;
        const [lib, bytes] = await Promise.all([
          rbPdfLib(),
          rbResumePdfBytes({ ...(saved.data || {}), template_id: tid, resume_name: r.name || "Resume" }),
        ]);
        if (!document.body.contains(holder)) return;
        const doc = await lib.getDocument({ data: bytes }).promise;
        try {
          const page = await doc.getPage(1);          // the card only shows page one
          const base = page.getViewport({ scale: 1 });
          const w = Math.max(140, holder.clientWidth || 200);
          const dpr = Math.min(window.devicePixelRatio || 1, 2);
          const vp = page.getViewport({ scale: (w / base.width) * dpr });
          const canvas = document.createElement("canvas");
          canvas.className = "rcard-canvas";
          canvas.width = Math.floor(vp.width);
          canvas.height = Math.floor(vp.height);
          await page.render({ canvasContext: canvas.getContext("2d"), viewport: vp }).promise;
          if (!document.body.contains(holder)) return;
          holder.innerHTML = chip;
          holder.insertBefore(canvas, holder.firstChild);
        } finally { doc.destroy(); }
        return;
      } catch (err) {
        console.warn("template render failed, falling back to the approximation", err);
        // Better an approximate page than an empty card, so the old path stays
        // as the fallback rather than being deleted.
        if (saved && document.body.contains(holder)) {
          holder.innerHTML = rbMiniPageHTML(saved.template_id || r.template_id, saved.data || {}) + chip;
          rbFitMiniPages(holder);
          return;
        }
      }
    }

    if (!r.filename) {
      holder.innerHTML = `<div class="rcard-noprev">${r.has_builder_data ? "📄" : "📎"}</div>${chip}`;
      return;
    }
    const url = await resumePdfUrl(r.filename);
    if (!document.body.contains(holder)) return;
    holder.innerHTML = url
      ? `<iframe class="rcard-frame" src="${url}#toolbar=0&navpanes=0&scrollbar=0&view=FitH" title="Preview of ${esc(r.name)}" loading="lazy"></iframe><div class="rcard-frame-veil"></div>${chip}`
      : `<div class="rcard-noprev">📎</div>${chip}`;
  });

  grid.querySelectorAll("[data-res-edit]").forEach(el =>
    el.addEventListener("click", () => editResumeInBuilder(Number(el.dataset.resEdit))));
  grid.querySelectorAll("[data-res-tailor]").forEach(el =>
    el.addEventListener("click", () => openTailorPicker(Number(el.dataset.resTailor), jobs)));
  grid.querySelectorAll("[data-res-download]").forEach(el =>
    el.addEventListener("click", async () => {
      const r = shown.find(x => x.id === Number(el.dataset.resDownload));
      const url = await resumePdfUrl(r.filename);
      if (!url) return showToast("No file to download", "error");
      const a = document.createElement("a");
      a.href = url; a.download = `${r.name.replace(/[^\w\-. ]/g, "_")}.pdf`;
      document.body.appendChild(a); a.click(); a.remove();
    }));
  grid.querySelectorAll("[data-res-duplicate]").forEach(el =>
    el.addEventListener("click", async () => {
      await post(`/api/resume-builder/${el.dataset.resDuplicate}/duplicate`);
      showToast("Copy created", "success"); render();
    }));
  grid.querySelectorAll("[data-res-delete]").forEach(el =>
    el.addEventListener("click", async () => {
      const r = shown.find(x => x.id === Number(el.dataset.resDelete));
      const used = usageCount[r?.id] || 0;
      const ok = await showConfirmModal({
        title: "Delete Resume",
        message: used ? `"${r?.name}" is linked to ${used} application${used === 1 ? "" : "s"}, which will be left without a resume. This can't be undone.`
                      : "This can't be undone.",
      });
      if (ok) { await del(`/api/resumes/${el.dataset.resDelete}`); showToast("Resume deleted", "success"); render(); }
    }));
}

// Pick which application to tailor a resume for.
function openTailorPicker(resumeId, jobs) {
  const withJd = jobs.filter(j => (j.job_description || "").trim().length >= 20);
  const root = document.getElementById("modal-root");
  root.innerHTML = `
    <div class="modal-backdrop" data-modal-backdrop>
      <div class="modal-box p-5" style="max-width:460px;">
        <h3 class="font-bold text-base mb-1">🎯 Tailor to a Job</h3>
        <p class="text-xs text-gray-500 mb-3">Creates a tailored copy — your base resume is left untouched.</p>
        ${withJd.length ? `
          <select id="tailor-job" class="mb-3">
            ${withJd.map(j => `<option value="${j.id}">${esc(j.company_name)} — ${esc(j.role_title)}</option>`).join("")}
          </select>` : `
          <p class="text-sm text-gray-400 mb-3">No applications have a job description saved yet. Add one on an application first — that's what the tailoring is based on.</p>`}
        <div class="flex justify-end gap-2">
          <button type="button" class="btn btn-ghost" id="tailor-cancel">Cancel</button>
          ${withJd.length ? `<button type="button" class="btn btn-accent" id="tailor-go">Tailor</button>` : ""}
        </div>
      </div>
    </div>`;
  root.classList.remove("hidden");
  root.querySelector("[data-modal-backdrop]").addEventListener("click", e => { if (e.target === e.currentTarget) closeModal(); });
  root.querySelector("#tailor-cancel").addEventListener("click", closeModal);
  root.querySelector("#tailor-go")?.addEventListener("click", async (e) => {
    const jobId = Number(root.querySelector("#tailor-job").value);
    const job = jobs.find(j => j.id === jobId);
    e.currentTarget.disabled = true; e.currentTarget.textContent = "Tailoring…";
    try {
      await post(`/api/resume-builder/tailor-for-job`, {
        resume_id: resumeId, job_description: job.job_description,
        company_name: job.company_name, role_title: job.role_title, job_id: jobId,
      });
      showToast("Tailored resume created", "success");
      closeModal();
      state.resumesLibTab = "tailored";
      render();
    } catch (err) {
      showToast(apiErrorMessage(err, "Couldn't tailor this resume"), "error");
      e.currentTarget.disabled = false; e.currentTarget.textContent = "Tailor";
    }
  });
}

// ============================================================================
// RESUME BUILDER
// ============================================================================
// Opening the builder for the first time left templateId null until the
// template list arrived, and a preview request with no template_id is a 400 —
// so the panel sat empty until you picked a design, which read as broken
// rather than as "nothing chosen yet". Seeding it here means the very first
// render already has something to draw.
const RB_DEFAULT_TEMPLATE = "compact_onepage";   // "Compact" in the picker
const RESUME_BUILDER_STATE = { templateId: RB_DEFAULT_TEMPLATE };

// Region/flag metadata so people can quickly see who each template is built for.
const TEMPLATE_META = {
  harvard_classic: { flag: "📄", region: "Conservative / ATS-safe" },
  modern_minimalist: { flag: "✦", region: "Modern / Spacious" },
  twocolumn_sidebar: { flag: "🎯", region: "Skills-heavy / Two-column" },
  creative_colorful: { flag: "🎨", region: "Creative / Design" },
  executive_elegant: { flag: "♦", region: "Senior / Executive" },
  classic_professional: { flag: "🌐", region: "Global / Generic" },
  modern_two_column: { flag: "🌐", region: "Global / Generic" },
  us_resume: { flag: "🌍", region: "US / UK / Australia / Singapore" },
  europe_cv: { flag: "🇪🇺", region: "Europe" },
  india_cv: { flag: "🇮🇳", region: "India" },
  canada_resume: { flag: "🇨🇦", region: "Canada" },
  middle_east_cv: { flag: "🇦🇪", region: "Middle East / Gulf" },
  executive_sidebar: { flag: "🎯", region: "Senior / Executive" },
  teal_sidebar: { flag: "🎯", region: "Senior / Executive" },
  header_band: { flag: "✦", region: "Modern / Bold" },
  centered_minimal: { flag: "📄", region: "Conservative / ATS-safe" },
  tinted_sidebar: { flag: "✦", region: "Modern / Print-friendly" },
  compact_dense: { flag: "🗜", region: "Long history, one page" },
};

// Small wireframe SVG previews mirroring each template's real PDF layout
// (header style, columns, photo placement) so people can see how a template
// actually looks before committing to it — without needing to render a PDF.
function templateThumbnailSVG(id) {
  const NAVY = "#171A1F", MINT = "#3D5AFE", LINE = "#E2E4E8", PALE = "#F4F5F7", MUTED = "#C7CBD1";
  const line = (x, y, w, h = 3, fill = LINE) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="1.5" fill="${fill}"/>`;
  const block = (x, y, w, h, fill = PALE) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="2" fill="${fill}"/>`;
  const avatar = (cx, cy, r = 9) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${NAVY}"/>`;

  let body = "";
  if (id === "classic_professional") {
    body = `
      ${line(46, 14, 68, 5, NAVY)} ${line(58, 23, 44, 3)}
      ${line(20, 40, 120, 1.5, LINE)}
      ${line(20, 50, 36, 4, NAVY)} ${line(20, 58, 120, 2.5)} ${line(20, 64, 120, 2.5)} ${line(20, 70, 90, 2.5)}
      ${line(20, 84, 36, 4, NAVY)} ${line(20, 92, 120, 2.5)} ${line(20, 98, 120, 2.5)} ${line(20, 104, 100, 2.5)}
      ${line(20, 118, 36, 4, NAVY)} ${line(20, 126, 120, 2.5)} ${line(20, 132, 80, 2.5)}
    `;
  } else if (id === "modern_two_column") {
    body = `
      ${line(20, 14, 60, 5, NAVY)} ${line(20, 23, 44, 3)}
      ${block(14, 40, 46, 105, PALE)}
      ${line(20, 48, 30, 3, NAVY)} ${line(20, 56, 32, 2.5)} ${line(20, 62, 26, 2.5)}
      ${line(20, 76, 30, 3, NAVY)} ${line(20, 84, 32, 2.5)} ${line(20, 90, 24, 2.5)}
      ${line(20, 104, 30, 3, NAVY)} ${line(20, 112, 32, 2.5)} ${line(20, 118, 28, 2.5)}
      ${line(68, 40, 36, 4, NAVY)} ${line(68, 48, 72, 2.5)} ${line(68, 54, 72, 2.5)} ${line(68, 60, 50, 2.5)}
      ${line(68, 74, 36, 4, NAVY)} ${line(68, 82, 72, 2.5)} ${line(68, 88, 60, 2.5)}
    `;
  } else if (id === "us_resume") {
    body = `
      ${line(20, 14, 66, 5, NAVY)} ${line(20, 23, 44, 3)}
      ${line(20, 32, 120, 2, MINT)}
      ${line(20, 46, 36, 4, NAVY)} ${line(20, 54, 120, 2.5)} ${line(20, 60, 120, 2.5)} ${line(20, 66, 90, 2.5)}
      ${line(20, 80, 36, 4, NAVY)} ${line(20, 88, 120, 2.5)} ${line(20, 94, 100, 2.5)}
      ${line(20, 108, 36, 4, NAVY)} ${line(20, 116, 120, 2.5)} ${line(20, 122, 80, 2.5)}
    `;
  } else if (id === "europe_cv") {
    body = `
      ${line(20, 14, 60, 5, NAVY)} ${line(20, 23, 40, 3)}
      ${avatar(132, 20)}
      ${block(14, 40, 40, 96, PALE)}
      ${line(20, 47, 24, 3, NAVY)} ${line(20, 54, 24, 2.5)} ${line(20, 60, 20, 2.5)}
      ${line(20, 74, 24, 3, NAVY)}
      ${block(20, 81, 24, 5, "#fff")} ${block(20, 88, 24, 5, "#fff")}
      ${line(62, 40, 36, 4, NAVY)} ${line(62, 48, 78, 2.5)} ${line(62, 54, 78, 2.5)} ${line(62, 60, 50, 2.5)}
      ${line(62, 74, 36, 4, NAVY)} ${line(62, 82, 78, 2.5)} ${line(62, 88, 60, 2.5)}
    `;
  } else if (id === "india_cv") {
    body = `
      ${avatar(30, 24, 11)}
      ${line(50, 14, 60, 5, NAVY)} ${line(50, 23, 40, 3)} ${line(50, 30, 50, 2.5)}
      ${line(20, 44, 120, 1.5, LINE)}
      ${line(20, 54, 40, 4, NAVY)} ${line(20, 62, 120, 2.5)} ${line(20, 68, 90, 2.5)}
      ${line(20, 82, 40, 4, NAVY)} ${line(20, 90, 120, 2.5)} ${line(20, 96, 110, 2.5)}
      ${line(20, 112, 44, 4, NAVY)} ${line(20, 120, 100, 2.5, MUTED)}
      ${line(20, 130, 50, 2, MUTED)} ${line(90, 130, 50, 2, MUTED)}
    `;
  } else if (id === "canada_resume") {
    body = `
      ${line(20, 14, 66, 5, NAVY)} ${line(20, 23, 44, 3)}
      ${line(20, 32, 120, 2, NAVY)}
      ${block(46, 44, 68, 10, NAVY)}
      ${line(20, 62, 120, 2.5)} ${line(20, 68, 90, 2.5)}
      ${block(46, 80, 68, 10, NAVY)}
      ${line(20, 98, 120, 2.5)} ${line(20, 104, 100, 2.5)}
      ${block(46, 116, 68, 10, NAVY)}
      ${line(20, 134, 120, 2.5, MUTED)}
    `;
  } else if (id === "middle_east_cv") {
    body = `
      ${line(20, 14, 60, 5, NAVY)} ${line(20, 23, 40, 3)}
      ${avatar(132, 20)}
      ${line(20, 40, 120, 1.5, LINE)}
      ${line(20, 50, 44, 4, NAVY)} ${line(20, 58, 120, 2.5)} ${line(20, 64, 100, 2.5)} ${line(20, 70, 90, 2.5)}
      ${line(20, 84, 36, 4, NAVY)} ${line(20, 92, 120, 2.5)}
      ${line(20, 106, 44, 4, NAVY)} ${line(20, 114, 120, 2.5)} ${line(20, 120, 90, 2.5)}
    `;
  } else {
    body = `${line(20, 20, 100, 5, NAVY)} ${line(20, 40, 120, 2.5)} ${line(20, 46, 120, 2.5)}`;
  }
  return `<svg viewBox="0 0 160 200" xmlns="http://www.w3.org/2000/svg" class="w-full h-full" aria-hidden="true">
    <rect x="0" y="0" width="160" height="200" rx="8" fill="#fff"/>
    ${body}
  </svg>`;
}

// A ready-to-edit example so the templates are useful the moment you open them.
const RESUME_BUILDER_SAMPLE = {
  full_name: "Dheeraj Gudi", title: "Data Analyst",
  location: "Newcastle Upon Tyne, England", phone: "+44 7733 658594",
  email: "dheeraj.gudi1999@gmail.com", linkedin: "linkedin.com/in/gudi-dheeraj",
  website: "gudidheeraj.github.io/personalfwebpage",
  summary: "- Data Analyst with over 4 years of experience in financial data analysis, enterprise reporting, and operations management.\n- Skilled in SQL, Python, and Power BI for dashboards, process automation, and large scale dataset analysis.",
  skills: "Programming Languages: Python, SQL, PL/SQL, R, C, C++\nData Analysis and Visualization: Power BI (DAX), Tableau, Advanced Microsoft Excel\nCloud and Data Platforms: AWS (Redshift, S3, Glue), Google Cloud Platform, Microsoft Azure",
  experience: "Operations Delivery Manager | Department for Work and Pensions | Newcastle, UK | Aug 2025 - Present\n- Manage advanced Excel reporting and data visualization for the team.\n- Lead a team of 12 to 15 specialist caseworkers handling complex cases.\n---\nData Analyst | Tata Consultancy Services | Bangalore, India | Jul 2021 - Oct 2023\n- Analysed financial datasets using SQL and Python across client portfolios worth more than $400,000.\n- Built Power BI dashboards with custom DAX measures across 8 business units.",
  education: "MSc, Data Science (Merit) | Durham University, Durham, UK | Sep 2023 - Jan 2025\n---\nMaster of Computer Applications (MCA), CGPA 8.78/10 | Manipal University (Online), Jaipur, India | Nov 2021 - Dec 2023",
  projects: "Enterprise Knowledge Assistant (RAG/LLM): Built a retrieval augmented generation assistant using Python, LangChain, FAISS, and Azure OpenAI.\n---\nLLM Prompt Evaluation Framework: Built an automated framework in Python that scores LLM outputs on accuracy and relevance.",
  publications: "Numerical Investigation on the Performance of Triple Pipe Heat Exchanger, Springer, Nov 2021",
  certifications: "Google Cloud Certified, Associate Cloud Engineer\nGoogle Cloud Certified, Professional Cloud Architect",
};

// Section schema for the editor's left pane. Grouping the flat builder
// fields into collapsible sections is what turns a long form into something
// navigable — each entry maps to real ResumeBuilderRequest fields.
const BUILDER_SECTIONS = [
  { id: "target",   label: "Target Job Title", icon: "🎯", fields: [
      { name: "title", label: "Target job title", placeholder: "e.g. Data Analyst" }] },
  { id: "contact",  label: "Contact", icon: "👤", fields: [
      { name: "full_name", label: "Full name", placeholder: "Jane Doe", required: true },
      { name: "email", label: "Email", placeholder: "jane@example.com" },
      { name: "phone", label: "Phone", placeholder: "+44 7700 900000" },
      { name: "location", label: "Location", placeholder: "London, UK" },
      { name: "linkedin", label: "LinkedIn", placeholder: "linkedin.com/in/jane" },
      { name: "website", label: "Website / portfolio", placeholder: "jane.dev" }] },
  { id: "summary",  label: "Summary", icon: "📝", ai: true, fields: [
      { name: "summary", label: "Professional summary", type: "textarea", rows: 5,
        hint: "2–4 lines, or one bullet per line starting with '- '." }] },
  { id: "experience", label: "Professional Experience", icon: "💼", ai: true, fields: [
      { name: "experience", label: "Roles", type: "textarea", rows: 12,
        hint: "Separate each role with a line containing only ---" }] },
  { id: "skills",   label: "Technical Skills", icon: "🛠️", ai: true, fields: [
      { name: "skills", label: "Skills", type: "textarea", rows: 5,
        hint: "One category per line, e.g. 'Languages: Python, SQL'" }] },
  { id: "education", label: "Education", icon: "🎓", fields: [
      { name: "education", label: "Education", type: "textarea", rows: 7,
        hint: "Separate each entry with a line containing only ---" }] },
  { id: "certifications", label: "Certifications", icon: "📜", fields: [
      { name: "certifications", label: "Certifications", type: "textarea", rows: 4, hint: "One per line." }] },
  { id: "projects", label: "Projects", icon: "🚀", fields: [
      { name: "projects", label: "Projects", type: "textarea", rows: 7,
        hint: "Separate each project with a line containing only ---" }] },
  { id: "publications", label: "Publications", icon: "📚", fields: [
      { name: "publications", label: "Publications", type: "textarea", rows: 4, hint: "One per line." }] },
  { id: "personal", label: "Personal Details", icon: "🌍", fields: [
      { name: "photo_initials", label: "Avatar initials", placeholder: "JD" },
      { name: "date_of_birth", label: "Date of birth", placeholder: "Used by some EU / India templates" },
      { name: "nationality", label: "Nationality", placeholder: "Used by some EU / India templates" },
      { name: "gender", label: "Gender", placeholder: "Optional" },
      { name: "marital_status", label: "Marital status", placeholder: "Optional" }] },
];

const EDITOR = {
  values: {},        // current form values
  undoStack: [],     // snapshots for Undo
  open: new Set(["contact", "summary"]),
  previewUrl: null,
  previewTimer: null,
  rightTab: "templates",
  dirty: false,
  zoom: 1,
  leftHidden: false,
  rightHidden: false,
};

function editorFieldValue(name) { return EDITOR.values[name] ?? ""; }

// ============================================================================
// RESUME BUILDER v2 — Edit / Design / AI Review / Tailor, with an instant
// live HTML preview. Reuses the existing EDITOR.values data model, the real
// templates endpoint, the real /ai-assist endpoint, saveEditorResume(), and
// the server PDF for downloads — the UI is new, the wiring is real.
// ============================================================================
const rbState = { tab: "edit", open: "sec-details", accent: "#6C5DD3", reviewRun: false, review: null, entries: null, roles: null, roleId: null, roleQuery: "", ai: { kind: null, idx: 0, anchor: null, options: [] } };

function rbVal(name) { return EDITOR.values[name] ?? ""; }
function rbSet(name, val) { EDITOR.values[name] = val; }

// Section list for the Edit pane (module-level so it can be re-rendered when
// sub-boxes are added/removed).
const RB_SECTIONS = [
  { id: "sec-details", icon: "👤", tint: "violet", title: "Personal details", sub: "Name, contact & job title" },
  { id: "sec-profile", icon: "📝", tint: "violet", title: "Profile summary", sub: "A short pitch about you", ai: "summary" },
  { id: "sec-experience", icon: "💼", tint: "amber", title: "Employment history", sub: "Roles, with a box per bullet" },
  { id: "sec-education", icon: "🎓", tint: "green", title: "Education", sub: "Degrees & certifications" },
  { id: "sec-skills", icon: "🛠️", tint: "red", title: "Skills", sub: "Technical & soft skills", ai: "skills" },
  { id: "sec-projects", icon: "🚀", tint: "violet", title: "Projects", sub: "Selected work (optional)" },
  { id: "sec-custom", icon: "➕", tint: "violet", title: "Your own sections", sub: "Add any section you like" },
];

// ---- structured entries <-> the backend's "---"/"|" string format ----
function rbParseField(field) {
  const blocks = String(EDITOR.values[field] || "").split(/\n---+\n/).map(b => b.trim()).filter(Boolean);
  return blocks.map(b => {
    const lines = b.split("\n").map(l => l.trim()).filter(Boolean);
    const head = lines[0] || "";
    const bullets = lines.slice(1).filter(l => l.startsWith("-")).map(l => l.replace(/^-\s*/, ""));
    const p = head.split("|").map(s => s.trim());
    if (field === "experience") return { title: p[0] || "", company: p[1] || "", location: p[2] || "", dates: p[3] || "", bullets };
    if (field === "education") return { degree: p[0] || "", institution: p[1] || "", dates: p[2] || "", bullets };
    return { name: head, bullets };
  });
}
function rbJoinHead(fields) {
  const arr = fields.map(x => (x || "").trim());
  while (arr.length && arr[arr.length - 1] === "") arr.pop();
  return arr.join(" | ");
}
function rbSerializeField(field, items) {
  return items.map(it => {
    let head;
    if (field === "experience") head = rbJoinHead([it.title, it.company, it.location, it.dates]);
    else if (field === "education") head = rbJoinHead([it.degree, it.institution, it.dates]);
    else head = (it.name || "").trim();
    const bl = (it.bullets || []).map(b => (b || "").trim()).filter(Boolean).map(b => "- " + b);
    return [head, ...bl].join("\n");
  }).filter(block => block.replace(/[\s|-]/g, "").length > 0).join("\n---\n");
}
function rbGetEntries(field) {
  rbState.entries = rbState.entries || {};
  if (!rbState.entries[field]) rbState.entries[field] = rbParseField(field);
  return rbState.entries[field];
}
function rbCommitEntries(field) {
  EDITOR.values[field] = rbSerializeField(field, rbState.entries[field] || []);
}

function rbBulletsEditor(ref, bullets) {
  return `<div class="rbx-bullets">
    ${(bullets || []).map((b, bi) => `
      <div class="rbx-bullet-row">
        <span class="rbx-bullet-dot">•</span>
        <input class="rbx-bullet-input" data-bullet="${ref}:${bi}" value="${esc(b)}" placeholder="Achievement or responsibility…">
        <button class="rbx-mini-del" data-del-bullet="${ref}:${bi}" title="Remove">✕</button>
      </div>`).join("")}
    <button class="rbx-add-bullet" data-add-bullet="${ref}">+ point</button>
  </div>`;
}

function rbEntriesEditor(field) {
  const items = rbGetEntries(field);
  const labelFor = { experience: "role", education: "entry", projects: "project" }[field];
  const cards = items.map((it, i) => {
    const ref = `${field}:${i}`;
    let fields;
    if (field === "experience") {
      fields = `
        <div class="rbx-frow">
          <div class="rbx-field"><label>Job title</label><input data-entry="${ref}:title" value="${esc(it.title)}" placeholder="Software Engineer"></div>
          <div class="rbx-field"><label>Employer</label><input data-entry="${ref}:company" value="${esc(it.company)}" placeholder="Company"></div>
        </div>
        <div class="rbx-frow">
          <div class="rbx-field"><label>Location</label><input data-entry="${ref}:location" value="${esc(it.location)}" placeholder="City, Country"></div>
          <div class="rbx-field"><label>Dates</label><input data-entry="${ref}:dates" value="${esc(it.dates)}" placeholder="Jan 2023 – Present"></div>
        </div>
        <label class="rbx-sublabel">Achievements <button class="rbx-spark rbx-spark-inline" data-ai-entry="${ref}" title="Write bullets with AI">✨</button></label>
        ${rbBulletsEditor(ref, it.bullets)}`;
    } else if (field === "education") {
      fields = `
        <div class="rbx-frow">
          <div class="rbx-field"><label>Degree</label><input data-entry="${ref}:degree" value="${esc(it.degree)}" placeholder="BSc Computer Science"></div>
          <div class="rbx-field"><label>Institution</label><input data-entry="${ref}:institution" value="${esc(it.institution)}" placeholder="University"></div>
        </div>
        <div class="rbx-frow"><div class="rbx-field full"><label>Dates</label><input data-entry="${ref}:dates" value="${esc(it.dates)}" placeholder="Sep 2020 – Jun 2023"></div></div>
        <label class="rbx-sublabel">Details (optional)</label>
        ${rbBulletsEditor(ref, it.bullets)}`;
    } else {
      fields = `
        <div class="rbx-frow"><div class="rbx-field full"><label>Project</label><input data-entry="${ref}:name" value="${esc(it.name)}" placeholder="Project name: what it does and the stack"></div></div>
        <label class="rbx-sublabel">Details (optional)</label>
        ${rbBulletsEditor(ref, it.bullets)}`;
    }
    return `<div class="rbx-entry">
      <div class="rbx-entry-head"><span>${labelFor.charAt(0).toUpperCase() + labelFor.slice(1)} ${i + 1}</span>
        <button class="rbx-entry-del" data-del-entry="${ref}" title="Remove">✕ remove</button></div>
      ${fields}
    </div>`;
  }).join("");
  return `<div class="rbx-entries" data-entries="${field}">${cards}
    <button class="rbx-add-entry" data-add-entry="${field}">+ Add ${labelFor}</button></div>`;
}

function rbCustomEditor() {
  const secs = EDITOR.values.custom_sections || [];
  const cards = secs.map((sec, si) => {
    const items = sec.items || [];
    const itemCards = items.map((it, ii) => {
      return `<div class="rbx-entry">
        <div class="rbx-entry-head"><span>Entry ${ii + 1}</span><button class="rbx-entry-del" data-del-citem="${si}:${ii}" title="Remove">✕</button></div>
        <div class="rbx-frow">
          <div class="rbx-field"><label>Heading</label><input data-citem="${si}:${ii}:heading" value="${esc(it.heading || "")}" placeholder="Title / name"></div>
          <div class="rbx-field"><label>Date / meta</label><input data-citem="${si}:${ii}:meta" value="${esc(it.meta || "")}" placeholder="2023 – Present"></div>
        </div>
        <div class="rbx-frow"><div class="rbx-field full"><label>Subheading (optional)</label><input data-citem="${si}:${ii}:subheading" value="${esc(it.subheading || "")}" placeholder="Organisation / location"></div></div>
        <label class="rbx-sublabel">Points</label>
        ${rbBulletsEditor(`csec:${si}:${ii}`, it.bullets || [])}
      </div>`;
    }).join("");
    return `<div class="rbx-custom-sec">
      <div class="rbx-frow rbx-custom-head">
        <div class="rbx-field full"><label>Section title</label><input data-csec-title="${si}" value="${esc(sec.title || "")}" placeholder="e.g. Volunteering, Awards, Languages"></div>
        <button class="rbx-entry-del" data-del-csec="${si}" title="Delete section">🗑</button>
      </div>
      ${itemCards}
      <button class="rbx-add-entry" data-add-citem="${si}">+ Add entry</button>
    </div>`;
  }).join("");
  return `<div class="rbx-custom">${cards}
    <button class="rbx-add-custom" data-add-custom>➕ Add your own section</button></div>`;
}

// Split a "---"-separated field into blocks; first line of each = header.
function rbParseBlocks(text) {
  return String(text || "").split(/\n---+\n/).map(b => b.trim()).filter(Boolean).map(block => {
    const lines = block.split("\n").map(l => l.trim()).filter(Boolean);
    return { head: lines[0] || "", body: lines.slice(1) };
  });
}
function rbHeadParts(head) { return head.split("|").map(s => s.trim()).filter(Boolean); }

async function renderResumeBuilder(content) {
  const templates = await get(`/api/resume-builder/templates`);
  rbState.templates = templates;

  // Load existing resume data (edit) or start from the sample (new).
  let loadedName = "";
  if (state.builderResumeId && !EDITOR.loadedFor) {
    try {
      const d = await get(`/api/resume-builder/${state.builderResumeId}/data`, { noCache: true });
      EDITOR.values = { ...(d.data || {}) };
      loadedName = d.resume_name || "";
      if (d.template_id) RESUME_BUILDER_STATE.templateId = d.template_id;
      EDITOR.loadedFor = state.builderResumeId;
    } catch {
      showToast("That resume can't be edited here — starting a blank one", "error");
      state.builderResumeId = null;
    }
  } else if (!state.builderResumeId && EDITOR.loadedFor !== "new") {
    EDITOR.values = { ...RESUME_BUILDER_SAMPLE };
    EDITOR.loadedFor = "new";
  }
  // Once the catalogue is here, confirm the default actually exists — if the
  // template were ever renamed or removed, fall back to the first one rather
  // than holding an id the server will reject.
  if (!RESUME_BUILDER_STATE.templateId
      || !templates.some(t => t.id === RESUME_BUILDER_STATE.templateId)) {
    RESUME_BUILDER_STATE.templateId =
      (templates.some(t => t.id === RB_DEFAULT_TEMPLATE) ? RB_DEFAULT_TEMPLATE : null)
      || templates[0]?.id;
  }
  EDITOR.resumeName = EDITOR.resumeName || loadedName || "Untitled Resume";
  // adopt saved styling choices (accent falls back to the template's own colour)
  const tplAccent = (templates.find(t => t.id === RESUME_BUILDER_STATE.templateId) || {}).accent;
  rbState.accent = EDITOR.values.accent_color || tplAccent || rbState.accent;
  if (!Array.isArray(EDITOR.values.custom_sections)) EDITOR.values.custom_sections = [];
  rbState.entries = null;  // re-parse structured entries from the freshly-loaded data

  // Everything the preview needs is now known, and building the editor's markup
  // below is a few milliseconds of synchronous work that doesn't need the
  // network. Start the render request and the pdf.js import against it rather
  // than after it: the round trip overlaps the DOM build instead of following
  // it, and by the time rbRenderPreview() runs the bytes are usually cached.
  rbResumePdfBytes(rbPreviewPayload()).catch(() => {});
  rbPdfLib().catch(() => {});

  const secDef = RB_SECTIONS;

  content.innerHTML = `
  <div class="rbx" style="--rb-accent:${rbState.accent}">
    <div class="rbx-layout">
      <div class="rbx-left">
        <!-- EDIT -->
        <div class="rbx-pane" id="rbx-pane-edit">
          <div class="rbx-complete">
            <div class="rbx-complete-top">
              <div class="rbx-complete-label">✨ CV completeness</div>
              <div class="rbx-complete-pct" id="rbx-pct">0%</div>
            </div>
            <div class="rbx-bar"><div class="rbx-bar-fill" id="rbx-bar"></div></div>
            <div class="rbx-chips" id="rbx-chips"></div>
          </div>
          <!-- Only rendered for templates with a picture slot; hidden otherwise
               so the other 30 templates don't ask for something they ignore. -->
          <div class="rbx-photo-card" id="rbx-photo-card" style="display:none"></div>
          <div class="rbx-sections">
            ${secDef.map(s => rbSectionHtml(s)).join("")}
          </div>
        </div>

        <!-- DESIGN -->
        <div class="rbx-pane" id="rbx-pane-design" style="display:none;">
          <div class="rbx-design-sticky">
            <div class="rbx-designrow">
              <div class="rbx-designfield rbx-designfield--wide">
                <label>Font</label>
                <select class="rbx-select" id="rbx-font">
                  ${RB_FONTS.map(f => `<option value="${f.id}" ${(rbVal("font_family") || "helvetica") === f.id ? "selected" : ""}>${f.label}</option>`).join("")}
                </select>
              </div>
              <div class="rbx-designfield">
                <label>Font size</label>
                <div class="rbx-segment" id="rbx-size">
                  ${rbSizeChoices().map(st =>
                    `<button data-size="${st.id}" title="${esc(st.hint)}" class="${rbSizeStep(rbVal("font_size")).id === st.id ? "active" : ""}">`
                    + `<span class="rbx-size-label">${st.label}</span><span class="rbx-size-pt">${st.pt}pt</span></button>`).join("")}
                </div>
              </div>
            </div>
            <div class="rbx-photo-note" id="rbx-photo-note"></div>
            <div class="rbx-tmpl-title">
              <span class="rbx-tmpl-title-text">Templates <span class="rbx-tmpl-count">${templates.length}</span></span>
              <button type="button" class="rbx-tmpl-filter ${rbState.photoOnly ? "active" : ""}" id="rbx-photo-filter"
                      title="Show only templates that print your photo">
                <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" style="width:12px;height:12px"><path d="M4 8.4h3l1.3-2h7.4l1.3 2h3v10.2H4z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><circle cx="12" cy="13.2" r="3" stroke="currentColor" stroke-width="1.7"/></svg>
                With a photo
              </button>
              <div class="rbx-theme">
                <span class="rbx-theme-label">Main colour</span>
                ${["#6C5DD3", "#3D5AFE", "#3C9D7B", "#E4A335", "#E2604F", "#0EA5E9", "#111827"].map(c =>
                  `<div class="rbx-swatch ${c === rbState.accent ? "active" : ""}" style="background:${c}" data-accent="${c}">${c === rbState.accent ? "✓" : ""}</div>`).join("")}
                <label class="rbx-swatch rbx-swatch-custom" title="Custom colour">
                  <span class="rbx-swatch-plus" aria-hidden="true">+</span>
                  <input type="color" id="rbx-color-custom" value="${esc(rbState.accent)}">
                </label>
              </div>
            </div>
          </div>
          ${templates.length ? rbGroupedTemplates(rbState.photoOnly ? templates.filter(t => t.photo) : templates) : rbNoTemplatesNotice()}
        </div>

        <!-- BEST FOR ROLE -->
        <div class="rbx-pane" id="rbx-pane-roles" style="display:none;">
          <div class="rbx-roles-intro">
            <h3>Which template suits your job?</h3>
            <p>Pick the role you're applying for. Recruiters in different fields expect different
               things — a photo, a skills band, two pages, plain text — so these are the templates
               that fit, with the reason for each.</p>
            <input class="rbx-input rbx-roles-search" id="rbx-roles-search" type="search"
                   placeholder="Search roles &mdash; data scientist, nurse, Germany&hellip;"
                   value="${esc(rbState.roleQuery)}" aria-label="Search roles">
          </div>
          <div class="rbx-roles-body" id="rbx-roles-body"></div>
        </div>

        <!-- AI REVIEW -->
        <div class="rbx-pane" id="rbx-pane-review" style="display:none;">
          <div class="rbx-review-hero">
            <div class="rbx-ring-wrap">
              <svg width="132" height="132" viewBox="0 0 150 150" aria-hidden="true">
                <circle class="rbx-ring-bg" cx="75" cy="75" r="62"></circle>
                <circle class="rbx-ring-fg" id="rbx-ring" cx="75" cy="75" r="62" stroke-dasharray="389.6" stroke-dashoffset="389.6"></circle>
              </svg>
              <div class="rbx-ring-center"><div class="rbx-ring-num" id="rbx-score">—</div><div class="rbx-ring-word" id="rbx-score-word">Not run</div></div>
            </div>
            <h3 id="rbx-review-h">Score your resume</h3>
            <p id="rbx-review-p">Checks ATS parsing, structure, writing quality and every experience bullet. Add a job description to also score keyword and skills match against that specific role.</p>
            <div class="rbx-review-jdwrap">
              <textarea id="rbx-review-jd" class="rbx-review-jd" rows="3" placeholder="Optional — paste the job description to score this resume against a specific role"></textarea>
            </div>
            <button class="rbx-rescan" id="rbx-rescan">✨ <span>Run review</span></button>
          </div>
          <div class="rbx-review-body" id="rbx-review-body"></div>
        </div>

        <!-- TAILOR -->
        <div class="rbx-pane" id="rbx-pane-tailor" style="display:none;">
          <div class="rbx-tailor">
            <h3>🎯 Tailor to a job</h3>
            <p>Paste a job description — the AI matches your resume's keywords and skills against it, then you can generate a tailored copy.</p>
            <textarea id="rbx-jd" placeholder="Paste the job description here…"></textarea>
            <button class="rbx-match" id="rbx-match">✨ Match &amp; analyse</button>
            <div class="rbx-kw" id="rbx-kw" style="display:none;"></div>
            <button class="rbx-tailor-go" id="rbx-tailor-go" style="display:none;">Generate tailored resume →</button>
          </div>
        </div>
      </div>

      <div class="rbx-right">
        <div class="rbx-stage">
          <div class="rbx-page rbx-page-pdf" id="rbx-page">${rbPreviewPlaceholder()}</div>
        </div>
      </div>
    </div>

    <div class="rbx-aipop" id="rbx-aipop">
      <div class="rbx-aipop-head">✨ AI suggestion</div>
      <div class="rbx-aipop-text" id="rbx-aipop-text">Generating…</div>
      <div class="rbx-aipop-actions">
        <button class="rbx-aipop-regen" id="rbx-aipop-regen">↻ Regenerate</button>
        <button class="rbx-aipop-insert" id="rbx-aipop-insert">Insert</button>
      </div>
    </div>
  </div>`;

  // The header carries the document: its name on the left, the pane tabs in the
  // centre, and its state plus the two actions on the right. Splitting it into
  // three zones is what killed the dead gap in the middle — the tabs are the
  // thing you use most, so they get the space, and "Resumes" is dropped because
  // the My Resumes / Builder pill already says where you are.
  document.querySelector("header.topbar-glass")?.classList.add("hdr-doc-mode");
  document.getElementById("view-tabs-slot").insertAdjacentHTML("beforeend", `
    <div class="rbx-hdr-doc">
      <label class="rbx-doc-title-wrap" for="rbx-title" title="Rename this resume">
        <input class="rbx-doc-title" id="rbx-title" value="${esc(EDITOR.resumeName)}" spellcheck="false"
               aria-label="Resume name" placeholder="Untitled Resume"
               style="width:${rbTitleInputWidth(EDITOR.resumeName)}px">
        <span class="rbx-pencil" id="rbx-title-edit" aria-hidden="true">
          <svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M11.2 2.3a1.4 1.4 0 0 1 2 2L6 11.5l-2.7.8.8-2.7 7.1-7.3Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>
        </span>
      </label>
      ${state.builderResumeId ? `<span class="rbx-doc-badge" title="You're editing a saved resume — Save changes updates it in your library">Editing</span>` : ""}
    </div>`);

  // Centre zone: the pane switcher. One accent dot marks a tab the customer
  // hasn't seen yet — two shouting "NEW" chips were competing with the tab
  // labels themselves.
  document.getElementById("view-center-slot").innerHTML = `
    <div class="rbx-tabbar" id="rbx-tabbar" role="tablist">
      <button role="tab" data-rtab="edit">Edit</button>
      <button role="tab" data-rtab="design">Design</button>
      <button role="tab" data-rtab="roles"><span class="rbx-tab-long">Best for role</span><span class="rbx-tab-short">Roles</span>${rbTabDot("roles")}</button>
      <button role="tab" data-rtab="review"><span class="rbx-tab-long">AI Review</span><span class="rbx-tab-short">Review</span></button>
      <button role="tab" data-rtab="tailor">Tailor${rbTabDot("tailor")}</button>
    </div>`;

  // Right zone: read-only state, so the two buttons beside it stay unambiguous.
  document.getElementById("header-status").innerHTML = `
    <div class="hdr-status" id="rbx-hdr-status">
      <button type="button" class="hdr-status-chip" id="rbx-status-tmpl"
              title="Current template — click to change it in the Design tab">
        <span class="hdr-status-swatch" id="rbx-status-swatch"></span>
        <span id="rbx-status-tmpl-name">Template</span>
      </button>
      <span class="hdr-status-sep"></span>
      <button type="button" class="hdr-status-chip" id="rbx-status-pct"
              title="How complete this resume is — click for the section checklist">
        <span class="hdr-status-ring" id="rbx-status-ring"><i></i></span>
        <span id="rbx-status-pct-text">0%</span>
      </button>
      <span class="hdr-status-sep"></span>
      <span class="hdr-status-lang" title="Resume language">
        <svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.35"/><path d="M2.4 8h11.2M8 2a11 11 0 0 1 0 12A11 11 0 0 1 8 2Z" stroke="currentColor" stroke-width="1.35"/></svg>
        English
      </span>
    </div>`;
  const hdrControls = document.getElementById("header-controls");
  hdrControls.innerHTML = `
    ${state.builderResumeId ? `<button class="rbx-btn-new" id="builder-new" title="Discard this and start from a blank resume">
      <svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 3.4v9.2M3.4 8h9.2" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>
      New
    </button>` : ""}
    <button class="rbx-btn-download" id="rbx-download" title="Download this resume as a PDF">
      <svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 2.5v7m0 0 2.8-2.8M8 9.5 5.2 6.7M2.8 11.5v1.2a.8.8 0 0 0 .8.8h8.8a.8.8 0 0 0 .8-.8v-1.2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
      Download PDF
    </button>
    <button class="rbx-btn-save" id="rbx-save">${state.builderResumeId ? "Save changes" : "Save to library"}</button>`;
  hdrControls.querySelector("#builder-new")?.addEventListener("click", () => {
    EDITOR.loadedFor = null; EDITOR.resumeName = ""; EDITOR.undoStack = []; EDITOR.values = {};
    state.builderResumeId = null;
    render();
  });

  rbWire(templates);
  rbWatchThumbnails();
  rbRenderPreview(true);
  rbRenderCompleteness();
  rbSwitchTab(rbState.tab);
  rbSyncPhotoNote();
  rbRenderPhotoCard();
  loadProfile().then(() => { rbSyncPhotoNote(); rbRenderPhotoCard(); });
  rbFitHeightSettled();
}

// Size the builder to exactly fill the viewport below whatever sits above it
// (app header/padding), so the left editor panel and the right preview each
// get their own scrollbar instead of the whole page scrolling as one.
function rbFitHeight() {
  const el = document.querySelector(".rbx");
  if (!el) return;
  if (window.innerWidth <= 900) { el.style.height = ""; return; }  // stacked layout scrolls normally
  const top = el.getBoundingClientRect().top;
  el.style.height = Math.max(480, Math.floor(window.innerHeight - top)) + "px";
}
// The preview is drawn to a canvas at the panel's width, so a resize means it
// has to be drawn again to stay sharp. Debounced through rbRenderPreview(), so
// dragging a window edge doesn't fire a render per pixel.
window.addEventListener("resize", () => {
  if (document.getElementById("rbx-page")) rbRenderPreview();
});

function rbFitHeightSettled() {
  // run once now, once after layout settles, and once more shortly after in
  // case a late-loading font/image nudges the header's height
  rbFitHeight();
  requestAnimationFrame(rbFitHeight);
  setTimeout(rbFitHeight, 200);
}
let _rbFitRaf = null;
window.addEventListener("resize", () => {
  if (_rbFitRaf) cancelAnimationFrame(_rbFitRaf);
  _rbFitRaf = requestAnimationFrame(rbFitHeight);
});

function rbSectionHtml(s) {
  const open = rbState.open === s.id;
  const body = (() => {
    if (s.id === "sec-details") {
      const parts = (rbVal("full_name") || "").trim().split(" ");
      const first = parts.slice(0, 1).join(" ");
      const last = parts.slice(1).join(" ");
      return `
        <div class="rbx-frow"><div class="rbx-field full">
          <label>Job title</label>
          <input placeholder="The role you want" data-f="title" value="${esc(rbVal("title"))}">
          <button class="rbx-spark" data-ai="role" title="Suggest a title">✨</button>
        </div></div>
        <div class="rbx-frow">
          <div class="rbx-field"><label>First name</label><input data-name="first" value="${esc(first)}"></div>
          <div class="rbx-field"><label>Surname</label><input data-name="last" value="${esc(last)}"></div>
        </div>
        <div class="rbx-frow">
          <div class="rbx-field"><label>Email</label><input data-f="email" value="${esc(rbVal("email"))}"></div>
          <div class="rbx-field"><label>Phone</label><input data-f="phone" placeholder="+44 7xxx xxx xxx" value="${esc(rbVal("phone"))}"></div>
        </div>
        <div class="rbx-frow"><div class="rbx-field full"><label>Location</label><input data-f="location" placeholder="City, Country" value="${esc(rbVal("location"))}"></div></div>`;
    }
    if (s.id === "sec-profile") {
      return `<div class="rbx-field full"><label>Summary</label>
        <textarea data-f="summary" rows="4" placeholder="e.g. Backend engineer with 3+ years building high-throughput APIs…">${esc(rbVal("summary"))}</textarea>
        <button class="rbx-write" data-ai="summary">✨ Write with AI</button></div>`;
    }
    if (s.id === "sec-experience") {
      return rbEntriesEditor("experience");
    }
    if (s.id === "sec-education") {
      return rbEntriesEditor("education");
    }
    if (s.id === "sec-skills") {
      return `<div class="rbx-field full"><label>Skills <span class="rbx-hint">— one category per line: <code>Category: item, item</code></span></label>
        <textarea data-f="skills" rows="4" placeholder="Languages: Python, SQL&#10;Tools: Git, Docker">${esc(rbVal("skills"))}</textarea>
        <button class="rbx-write" data-ai="skills">✨ Organise with AI</button></div>`;
    }
    if (s.id === "sec-projects") {
      return rbEntriesEditor("projects");
    }
    if (s.id === "sec-custom") {
      return rbCustomEditor();
    }
    return "";
  })();
  return `
    <div class="rbx-section ${open ? "open" : ""}" id="${s.id}">
      <div class="rbx-sec-head" data-toggle="${s.id}">
        <div class="rbx-sec-left">
          <div class="rbx-sec-icon tint-${s.tint}">${s.icon}</div>
          <div><div class="rbx-sec-title">${s.title}</div><div class="rbx-sec-sub">${s.sub}</div></div>
        </div>
        <span class="rbx-chevron">⌄</span>
      </div>
      <div class="rbx-sec-body">${body}</div>
    </div>`;
}

// "With a photo" sits last: most résumés don't carry one, and a customer who
// wants a photo template has the filter chip and the badge to find it.
const RB_CATEGORY_ORDER = ["ATS & Classic", "Professional", "Two-column", "Modern", "Creative", "Editorial", "Sector & Academic", "By market", "Regional & Original", "With a photo"];
const RB_CATEGORY = {
  ats_plain: "ATS & Classic", harvard_classic: "ATS & Classic", compact_onepage: "ATS & Classic",
  executive_elegant: "Professional", corporate_blue: "Professional", consulting_premium: "Professional", finance_formal: "Professional",
  twocolumn_sidebar: "Two-column", bold_sidebar: "Two-column",
  modern_minimalist: "Modern", swiss_grid: "Modern", timeline: "Modern",
  creative_colorful: "Creative", pastel_soft: "Creative", diagonal_split: "Creative", tech_clean_colorful: "Creative", startup_energetic: "Creative", layered_papercard: "Creative",
  newspaper_columns: "Editorial", magazine_editorial: "Editorial",
  centred_serif: "ATS & Classic",
  academic_cv: "Sector & Academic", government_formal: "Sector & Academic",
  // Structure-led layouts: what changes is which section leads the page.
  hybrid_combination: "Professional", functional_skills: "Professional",
  achievement_focused: "Professional", executive_twopage: "Professional",
  graduate_entry: "Modern",
  // Photo-led designs: the picture is what the layout is arranged around, so
  // they get a group of their own instead of being findable only by accident.
  photo_sidebar: "With a photo", photo_banner: "With a photo",
  profile_style: "With a photo", photo_header: "With a photo",
  // Market standards — the format changes with the country, not the job.
  us_chronological: "By market", uk_cv: "By market", europass_cv: "By market",
  india_resume: "By market", canadian_resume: "By market",
  gulf_cv: "By market", japan_rirekisho: "By market",
};
// The Design tab is being rebuilt one template at a time, so an empty
// catalogue is an expected state rather than an error — say so plainly instead
// of rendering a bare, confusing gap where the grid used to be.
function rbNoTemplatesNotice() {
  return `<div class="rbx-tmpl-empty">
    <div class="rbx-tmpl-empty-icon" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="3.5" y="3" width="17" height="18" rx="2.5" stroke="currentColor" stroke-width="1.6"/><path d="M7.5 8h9M7.5 12h9M7.5 16h5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
    </div>
    <p class="rbx-tmpl-empty-title">No templates yet</p>
    <p class="rbx-tmpl-empty-text">The template library is being rebuilt. Your colour, font and size choices still apply, and existing resumes keep rendering with the layout they were made in.</p>
  </div>`;
}

// The thumbnail page is laid out at a fixed 600px width and then scaled to
// whatever width the cell ends up. A fixed scale factor only looked right at
// one panel width, so measure and set it per cell — and again whenever the
// panel resizes (the Design pane is inside a resizable split).
const RB_THUMB_PAGE_W = 600;

// ---- template cards, rendered from the real PDF ---------------------------
// One queue, worked through one card at a time: each entry is a PDF render on
// the server, and 37 of them at once would hammer it and arrive out of order
// anyway. Results are cached against the content they were drawn from, so
// scrolling back to a card is instant and editing invalidates it.
const _rbThumbCache = new Map();     // "templateId|signature" -> data URL
const _rbThumbQueue = [];
let _rbThumbActive = 0;
let _rbThumbWait = null;
let _rbThumbIO = null;

// The account photo is deliberately never sent in the request — the server
// resolves it from the signed-in user, so a client can't point the renderer at
// an arbitrary file. The cost is that it's invisible to every cache key below,
// which are all derived from the payload: upload a photo and the keys don't
// move, so a photo template keeps serving the initials-disc render it already
// had. Folding the current avatar into the keys is what makes the picture
// actually appear (and disappear, on remove).
function rbPhotoSig() {
  return (state.profile && state.profile.avatar_url) || "";
}
// One render is identified by its payload plus whichever photo the account
// carried when it was drawn.
function rbRenderKey(payload) {
  return JSON.stringify(payload) + "|photo:" + rbPhotoSig();
}

// What a thumbnail depends on: the résumé's content and the design choices that
// aren't the template itself. Anything else changing shouldn't redraw 37 cards.
function rbThumbSignature() {
  const v = EDITOR.values || {};
  return JSON.stringify([v.full_name, v.title, v.email, v.phone, v.location, v.linkedin,
                         v.website, v.summary, v.skills, v.experience, v.education,
                         v.projects, v.certifications, v.custom_sections,
                         v.accent_color, v.font_family, v.font_size, rbPhotoSig()]);
}

function rbThumbEnqueue(shot) {
  if (!shot || shot.dataset.thumbDone === rbThumbSignature()) return;
  if (_rbThumbQueue.includes(shot)) return;
  _rbThumbQueue.push(shot);
  rbThumbPump();
}

// Six at a time. One was needlessly cautious and three still left the far end
// of a 37-card list waiting on a dozen renders it didn't care about. The
// endpoint is a plain `def`, so FastAPI runs it in its threadpool and these do
// genuinely overlap; six keeps a couple of cores busy without the queue
// becoming the thing that decides what the customer sees first.
const RB_THUMB_CONCURRENCY = 6;
function rbThumbPump() {
  // The document being edited comes first, but yielding to it must never be
  // permanent: check again shortly rather than waiting to be woken. A queue
  // that can only be restarted by someone else is a queue that can stall.
  if (_rbPdfBusy) {
    // 200ms here was most of the dead air on first open: the cards yield to the
    // main preview, then sit out a fifth of a second after it has finished
    // before noticing. The check is a boolean read, so polling it briskly costs
    // nothing and the queue starts the moment the preview lets go.
    clearTimeout(_rbThumbWait);
    _rbThumbWait = setTimeout(rbThumbPump, 40);
    return;
  }
  while (_rbThumbActive < RB_THUMB_CONCURRENCY && _rbThumbQueue.length) {
    const shot = _rbThumbQueue.shift();
    _rbThumbActive++;
    rbThumbRender(shot)
      .catch(err => rbThumbFail(shot, err))
      .then(() => { _rbThumbActive--; rbThumbPump(); });
  }
}

// ---- the rendered document, kept -----------------------------------------
// A template card and the big preview ask the server for exactly the same
// thing: this résumé, in that template, at these design settings. The card
// used to throw the bytes away the moment it had drawn its picture, so
// choosing a template you could already see on screen still cost a full round
// trip to render a document that had just been rendered. That round trip was
// the wait. Keeping the bytes makes switching to an already-drawn template
// instant, and lets a hover finish the work before the click arrives.
const _rbBytesCache = new Map();          // payload JSON -> Uint8Array
// Bounded two ways. A count alone isn't a bound — twenty photo-heavy CVs is a
// different amount of memory from twenty plain ones — so the budget is in bytes
// and the count only stops the map growing unreasonably long.
const RB_BYTES_CACHE_MAX = 20;            // entries
const RB_BYTES_BUDGET = 16e6;             // ~16MB of held documents

function rbBytesPut(key, bytes) {
  if (bytes.byteLength > 4e6) return;     // an outsized document isn't worth hoarding
  _rbBytesCache.delete(key);
  _rbBytesCache.set(key, bytes);
  // Map iterates in insertion order, so the oldest key is the first one out.
  let held = 0;
  _rbBytesCache.forEach(b => { held += b.byteLength; });
  while (_rbBytesCache.size > RB_BYTES_CACHE_MAX ||
         (held > RB_BYTES_BUDGET && _rbBytesCache.size > 1)) {
    const oldest = _rbBytesCache.keys().next().value;
    held -= _rbBytesCache.get(oldest).byteLength;
    _rbBytesCache.delete(oldest);
  }
}

// pdf.js takes ownership of the buffer it's handed and detaches it, so the
// cache keeps its own copy and hands out a fresh one each time. Passing the
// same array to a second getDocument() is how you get a blank second render.
async function rbResumePdfBytes(payload, signal) {
  const body = JSON.stringify(payload);
  const key = rbRenderKey(payload);   // cached per photo; the photo isn't in the body
  const hit = _rbBytesCache.get(key);
  if (hit) { rbBytesPut(key, hit); return hit.slice(); }   // re-insert = mark recently used
  const res = await fetch(`${API_BASE}/api/resume-builder/preview`, {
    method: "POST", signal,
    headers: { "Content-Type": "application/json",
               ...(auth.getToken() ? { Authorization: `Bearer ${auth.getToken()}` } : {}) },
    body,
  });
  if (!res.ok) throw new Error(await res.text());
  const bytes = new Uint8Array(await res.arrayBuffer());
  rbBytesPut(key, bytes);
  return bytes.slice();
}

// Card renders in flight. The preview is what the customer is waiting on, so
// when it needs the server the cards get out of the way rather than leaving it
// queued behind three PDF renders it doesn't care about.
const _rbThumbAborts = new Set();
function rbThumbAbortInFlight() {
  _rbThumbAborts.forEach(c => { try { c.abort(); } catch (_) {} });
  _rbThumbAborts.clear();
}

async function rbThumbRender(shot) {
  const tid = shot.dataset.thumb;
  if (!tid || !shot.isConnected) return;
  const sig = rbThumbSignature();
  const key = tid + "|" + sig;
  const cached = _rbThumbCache.get(key);
  if (cached) { rbThumbPaint(shot, cached, sig); return; }

  const ctrl = new AbortController();
  _rbThumbAborts.add(ctrl);
  let lib, bytes;
  try {
    [lib, bytes] = await Promise.all([
      rbPdfLib(),
      rbResumePdfBytes({ ...EDITOR.values, template_id: tid,
                         resume_name: EDITOR.resumeName }, ctrl.signal),
    ]);
  } finally { _rbThumbAborts.delete(ctrl); }
  if (!shot.isConnected) return;
  const doc = await lib.getDocument({ data: bytes }).promise;
  try {
    const page = await doc.getPage(1);          // the card only ever shows page one
    const base = page.getViewport({ scale: 1 });
    const w = Math.max(120, shot.clientWidth || 200);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const vp = page.getViewport({ scale: (w / base.width) * dpr });
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(vp.width);
    canvas.height = Math.floor(vp.height);
    await page.render({ canvasContext: canvas.getContext("2d"), viewport: vp }).promise;
    // toBlob rather than toDataURL: no multi-megabyte base64 string to build on
    // the main thread, and the object URL is cheap to hand to an <img>.
    const url = await new Promise(resolve => {
      if (canvas.toBlob) canvas.toBlob(b => resolve(b ? URL.createObjectURL(b) : canvas.toDataURL("image/jpeg", 0.8)), "image/jpeg", 0.8);
      else resolve(canvas.toDataURL("image/jpeg", 0.8));
    });
    // Bound the cache: 37 templates x a couple of edits is plenty to keep.
    if (_rbThumbCache.size > 90) _rbThumbCache.clear();
    _rbThumbCache.set(key, url);
    rbThumbPaint(shot, url, sig);
  } finally { doc.destroy(); }
}

// A card that can't be drawn says why. Swallowing the error left an endlessly
// shimmering placeholder, which looks like slowness and hides the actual fault
// — the difference between "still loading" and "broken" matters when something
// goes wrong, and the previous version could not tell the customer which it was.
function rbThumbFail(shot, err) {
  // Cancelled to let the preview through: that's this card waiting its turn,
  // not this card being broken. Put it back in the queue and say nothing.
  if (err && err.name === "AbortError") {
    if (shot && shot.isConnected) { delete shot.dataset.thumbDone; rbThumbEnqueue(shot); }
    return;
  }
  console.warn("[Momentum] template card failed to render", shot && shot.dataset.thumb, err);
  if (!shot || !shot.isConnected) return;
  // The drawing stays. It is a fair picture of the layout and the customer can
  // still choose from it; a badge in the corner says the live render didn't
  // arrive, which is the honest amount of alarm for a card that still works.
  if (!shot.querySelector(".rbx-thumb-fail")) {
    shot.insertAdjacentHTML("beforeend",
      `<div class="rbx-thumb-fail" title="${esc(String(err && err.message || err))}">Preview unavailable</div>`);
  }
  delete shot.dataset.thumbDone;   // so it retries on the next pass
}

// The real render fades in over the drawing rather than replacing it. Swapping
// the node outright made the grid flicker as cards landed out of order; a
// cross-fade over a layout that was already the right shape reads as the card
// sharpening, which is what it is.
function rbThumbPaint(shot, url, sig) {
  if (!shot.isConnected) return;
  const img = new Image();
  img.className = "rbx-thumb-img";
  img.alt = "";
  img.decoding = "async";
  img.addEventListener("load", () => {
    if (!shot.isConnected) return;
    shot.querySelector(".rbx-thumb-fail")?.remove();
    const old = shot.querySelector(".rbx-thumb-img");
    if (old) old.remove();
    shot.appendChild(img);
    requestAnimationFrame(() => img.classList.add("is-in"));
    // Leave the wireframe underneath for one transition, then drop it: it has
    // nothing left to say once the real page is on top of it.
    setTimeout(() => { if (shot.isConnected) shot.querySelector(".rbx-thumb-wire")?.remove(); }, 260);
  }, { once: true });
  // Waiting on `load` to cross-fade means a decode that never completes — a
  // revoked object URL, a truncated blob — would leave the card marked done and
  // sitting on its drawing forever, with nothing to retry it. So the failure is
  // wired up too: drop the stale cache entry and put the card back in the queue.
  img.addEventListener("error", () => {
    _rbThumbCache.delete((shot.dataset.thumb || "") + "|" + sig);
    delete shot.dataset.thumbDone;
    if (shot.isConnected) rbThumbEnqueue(shot);
  }, { once: true });
  img.src = url;
  shot.dataset.thumbDone = sig;
}

// Cards render as they come into view. The root margin starts them a screen
// early so the next row is usually drawn by the time it's scrolled to.
// Every card is queued straight away, in document order, and the observer only
// promotes what's on screen to the front of that queue.
//
// The first version left the whole grid waiting on IntersectionObserver, so any
// reason the observer didn't fire — a hidden tab, a scroll container it didn't
// account for, a card replaced between observing and firing — meant the cards
// never rendered at all rather than rendering late. A queue that fills itself
// and is merely reordered by visibility can be slow; it can't be stuck.
//
// Every card in the panel is collected, not just the ones in the first grid.
// Grouping splits the catalogue into one .rbx-tmpl-grid per category (plus the
// role-pick grid), so querying a single grid queued only "ATS & Classic" and
// left every later group — By market, With a photo — on skeletons for good.
//
// Order matters more than it looks. Queueing all 37 in document order put
// whatever the customer was actually looking at behind up to three dozen
// renders of cards off the bottom of the panel — the observer could only
// promote a card once it had already lost its place. So the cards on screen
// go in first and get the whole concurrency budget to themselves; the rest are
// added a moment later, once the visible ones are drawn or well under way.
const RB_THUMB_BACKFILL_MS = 700;
let _rbThumbBackfill = null;
function rbWatchThumbnails() {
  if (_rbThumbIO) { _rbThumbIO.disconnect(); _rbThumbIO = null; }
  clearTimeout(_rbThumbBackfill);
  const shots = Array.from(document.querySelectorAll(".rbx-tmpl-shot[data-thumb]"));
  if (!shots.length) return;
  const onScreen = shots.filter(s => {
    const r = s.getBoundingClientRect();
    return r.bottom > -200 && r.top < window.innerHeight + 200 && r.width > 0;
  });
  (onScreen.length ? onScreen : shots).forEach(rbThumbEnqueue);
  if (onScreen.length && onScreen.length < shots.length) {
    _rbThumbBackfill = setTimeout(() => shots.forEach(rbThumbEnqueue), RB_THUMB_BACKFILL_MS);
  }
  if (!window.IntersectionObserver) return;
  _rbThumbIO = new IntersectionObserver(entries => {
    entries.forEach(e => { if (e.isIntersecting) rbThumbPrioritise(e.target); });
  }, { root: null, rootMargin: "400px 0px" });
  shots.forEach(s => _rbThumbIO.observe(s));
}

// Move a card to the front of the queue when it comes into view, so what the
// customer is looking at is drawn before what they haven't scrolled to.
function rbThumbPrioritise(shot) {
  const i = _rbThumbQueue.indexOf(shot);
  if (i > 0) { _rbThumbQueue.splice(i, 1); _rbThumbQueue.unshift(shot); }
  else if (i < 0) rbThumbEnqueue(shot);
  rbThumbPump();
}

// After an edit the cards are stale. Redrawing 37 of them per keystroke is out
// of the question, so they're marked stale and only the visible ones redraw,
// once the customer has stopped typing.
let _rbThumbRefreshTimer = null;
function rbRefreshThumbnails() {
  clearTimeout(_rbThumbRefreshTimer);
  _rbThumbRefreshTimer = setTimeout(() => {
    document.querySelectorAll(".rbx-tmpl-shot[data-thumb]").forEach(shot => {
      if (!shot.offsetParent) return;                // not the visible tab
      const r = shot.getBoundingClientRect();
      if (r.bottom > -400 && r.top < window.innerHeight + 400) rbThumbEnqueue(shot);
    });
  }, 2600);
}

// Category headers only earn their keep once there are enough templates to
// need them. Below that they split a handful of cards into single-card rows —
// which is why five templates rendered as five stacked cards instead of a
// gallery. Under the threshold everything goes into one flat grid.
const RB_GROUPING_THRESHOLD = 9;

function rbGroupedTemplates(templates) {
  if (templates.length < RB_GROUPING_THRESHOLD) {
    return `<div class="rbx-tmpl-grid">${templates.map(rbTemplateCard).join("")}</div>`;
  }
  const groups = {};
  templates.forEach(t => { const c = RB_CATEGORY[t.id] || "Regional & Original"; (groups[c] = groups[c] || []).push(t); });
  const order = [...RB_CATEGORY_ORDER, ...Object.keys(groups).filter(c => !RB_CATEGORY_ORDER.includes(c))];
  return order.filter(c => groups[c]).map(c =>
    `<div class="rbx-tmpl-group">${esc(c)}</div>
     <div class="rbx-tmpl-grid">${groups[c].map(rbTemplateCard).join("")}</div>`).join("");
}

const RB_THUMB_SAMPLE = {
  full_name: "Alex Morgan", title: "Senior Software Engineer",
  email: "alex.morgan@email.com", phone: "+44 7700 900 123",
  location: "London, United Kingdom",
  linkedin: "linkedin.com/in/alexmorgan", website: "alexmorgan.dev",
  summary: "Senior engineer with 8+ years building reliable, scalable distributed systems across fintech and public-sector platforms. Leads delivery end to end \u2014 architecture, hands-on implementation, and mentoring \u2014 with a track record of cutting cost and latency on systems serving millions of users. Comfortable owning a domain from first design review through to production support.",
  skills: "Languages: Python, Go, TypeScript, SQL, Bash\nCloud & Infrastructure: AWS, Terraform, Docker, Kubernetes, Kafka, ArgoCD\nData: PostgreSQL, Redis, Snowflake, dbt, Airflow, Spark\nObservability: Prometheus, Grafana, OpenTelemetry, Datadog\nPractices: Distributed systems, CI/CD, incident response, technical mentoring\nTooling: Git, GitHub Actions, Jira, Figma, Linear",
  experience: "Senior Software Engineer | Acme Corp | 2021 \u2013 Present | London, UK\n- Led a team of 8 rebuilding the payments platform, now serving 2M monthly users at 99.98% availability.\n- Cut infrastructure spend 30% by right-sizing workloads and introducing autoscaling across 40+ services.\n- Designed the event-driven order pipeline handling 12k messages per second on Kafka.\n- Introduced the incident review process now used company-wide, halving mean time to recovery.\n---\nSoftware Engineer | Globex | 2018 \u2013 2021 | Remote\n- Built the core billing services and the CI/CD pipeline later adopted by every product team.\n- Reduced p99 API latency from 800ms to 120ms through query planning and cache optimisation.\n- Migrated 60+ services from EC2 to Kubernetes with no customer-facing downtime.\n---\nJunior Engineer | Initech | 2016 \u2013 2018 | Manchester, UK\n- Shipped internal tooling that removed roughly a day of manual reporting each week.\n- Owned the reporting API and its move to a versioned public contract.\n- Rewrote the nightly reconciliation job, cutting its runtime from 6 hours to 40 minutes.",
  education: "MSc Computer Science (Distinction) | University of Manchester | 2015 \u2013 2016 | Manchester, UK\n- Specialised in distributed systems and machine learning; thesis on consensus under partition.\n---\nBSc Computer Science (First Class) | State University | 2012 \u2013 2015 | Leeds, UK",
  projects: "Open-source Query Planner\n- Built a cost-based planner in Go, now used by three downstream analytics tools and 400+ installs.\n---\nLatency Budget Toolkit\n- Tracing library that attributes p99 latency to individual services across a request path.\n---\nSchema Drift Detector\n- Watches warehouse schemas and opens a pull request when an upstream contract changes.\n---\nOn-call Load Balancer\n- Rota tool that spreads out-of-hours pages evenly across a team and tracks fatigue.",
  publications: "Scaling Event Pipelines Without Losing Ordering, ACM Queue, 2023\nA Practical Guide to Incident Reviews, InfoQ, 2022",
  certifications: "AWS Certified Solutions Architect \u2013 Professional\nCKA: Certified Kubernetes Administrator\nHashiCorp Certified: Terraform Associate",
};

function rbThumbData() {
  return RB_THUMB_SAMPLE;
}

// ---------------------------------------------------------------------------
// A resume rendered small enough to sit inside a library card. Same renderers
// and the same 600px reference page as the Design gallery, so a card, a
// thumbnail and the downloaded PDF are all the same document.
// ---------------------------------------------------------------------------
// The library renders card previews before the builder has ever run, so the
// template descriptors are fetched (once) rather than assumed present.
async function rbEnsureTemplates() {
  if (rbState.templates) return rbState.templates;
  try { rbState.templates = await get(`/api/resume-builder/templates`); }
  catch { rbState.templates = []; }
  return rbState.templates;
}

function rbMiniPageHTML(templateId, values) {
  const t = (rbState.templates || []).find(x => x.id === templateId) || {};
  const style = {
    family: t.family || "single", header: t.header || "left", sec: t.sec || "rule",
    skills: t.skills || "cat", mode: t.mode, border: !!t.border,
  };
  const cls = rbTemplatePageClass(templateId, style).replace("rbx-page", "rbx-page rbx-thumb-page rbx-mini-page");
  const font = RB_FONT_CSS[values.font_family || t.font] || RB_FONT_CSS.helvetica;
  const accent = values.accent_color || t.accent || "#6C5DD3";
  const hv = rbSizeScale(values.font_size, templateId);
  return `<div class="${cls}" style="--rb-accent:${esc(accent)};--hv-scale:${hv};font-family:${font}">` +
         `${rbTemplateInnerHTML(templateId, values, style)}</div>`;
}

function rbFitMiniPages(root = document) {
  root.querySelectorAll(".rbx-mini-page").forEach(page => {
    const box = page.parentElement;
    if (!box) return;
    const w = box.clientWidth;
    if (w) page.style.setProperty("--thumb-scale", String((w / RB_THUMB_PAGE_W).toFixed(4)));
  });
}
// Card widths move with the grid, so re-fit on resize.
if (!window.__rbMiniResizeBound) {
  window.__rbMiniResizeBound = true;
  let queued = false;
  window.addEventListener("resize", () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; rbFitMiniPages(); });
  });
}

// The photo as it appears in a mini-render: the account photo when there is one,
// initials otherwise — the same fallback the PDF uses.
function rbPhotoMarkup() {
  const p = state.profile;
  const url = p && p.avatar_url ? apiUrl(p.avatar_url) : null;
  const name = (EDITOR.values.full_name || (p && p.name) || "Alex Morgan").trim();
  const initials = name.split(/\s+/).slice(0, 2).map(w => w[0].toUpperCase()).join("");
  return url
    ? `<div class="rbx-r-photo has-photo" style="background-image:url(&quot;${esc(url)}&quot;)"></div>`
    : `<div class="rbx-r-photo">${esc(initials)}</div>`;
}

// The card shows the first page of the real PDF, rendered from the customer's
// own content — the same document the preview shows and the same one the
// Download button produces. It used to be a miniature of the HTML imitation,
// which meant the picture you chose a template from could disagree with what
// you got. It also means a photo template shows the actual photo, because the
// server puts it there; the card doesn't have to fake one.
//
// Cards render only when they scroll into view, one at a time, and are cached —
// see rbThumbRender(). Rendering 37 PDFs to fill a grid nobody has scrolled
// through yet would be pointless work for the server and slow for the customer.
// The card is a render of the real PDF, and a real PDF render is a round trip
// to the server. Thirty-seven of those cannot all be instant — so the card
// never starts empty. /templates already returns the descriptors each layout
// is built from (family, header style, section rule, sidebar, timeline,
// border, accent), which is enough to draw the shape of the page on the first
// frame, in the template's own colour. The gallery is legible and clickable
// before a single byte has arrived; the real render then swaps in behind it.
//
// A shimmering grey rectangle communicates "wait"; a layout communicates
// "this is a two-column CV with a tinted sidebar". Only one of those is worth
// looking at while the server works.
function rbTemplateWireframe(t) {
  const acc = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(t.accent || "") ? t.accent : "#6C5DD3";
  const INK = "#7C8296", TXT = "#D2D6DF", FAINT = "#E7EAF1";
  const o = [];
  // Colours are blended to flat hex rather than left as fill-opacity. Opacity
  // on an SVG that is itself being scaled and composited is one more thing that
  // can be rounded differently by a renderer, and a wireframe whose tint is a
  // shade off in one browser is worse than one that is simply the same colour
  // everywhere. Blending here also means the drawing survives being rasterised.
  const hex = c => {
    const v = c.replace("#", "");
    const f = v.length === 3 ? v.split("").map(d => d + d).join("") : v;
    return [parseInt(f.slice(0, 2), 16), parseInt(f.slice(2, 4), 16), parseInt(f.slice(4, 6), 16)];
  };
  const blend = (fg, bg, a) => {
    const [r1, g1, b1] = hex(fg), [r2, g2, b2] = hex(bg);
    const m = (x, y) => Math.round(x * a + y * (1 - a)).toString(16).padStart(2, "0");
    return `#${m(r1, r2)}${m(g1, g2)}${m(b1, b2)}`;
  };
  const tint = a => blend(acc, "#FFFFFF", a);       // accent laid on the page
  const onAcc = a => blend("#FFFFFF", acc, a);      // white laid on the accent
  const R = (x, y, w, h, fill, rx = 0.7) =>
    o.push(`<rect x="${+x.toFixed(1)}" y="${+y.toFixed(1)}" width="${+w.toFixed(1)}" height="${+h.toFixed(1)}" rx="${rx}" fill="${fill}"/>`);

  const side = t.family === "sidebar" ? (t.side === "right" ? "right" : "left") : null;
  const SW = 62, M = 15;
  const x0 = side === "left" ? SW + 9 : M;
  const x1 = side === "right" ? 210 - SW - 9 : 210 - M;
  const W = x1 - x0;

  if (t.border) {
    o.push(`<rect x="6" y="6" width="198" height="285" rx="1.5" fill="none" stroke="${tint(.55)}" stroke-width="1"/>`);
  }

  // ---- sidebar ------------------------------------------------------------
  if (side) {
    const sx = side === "left" ? 0 : 210 - SW;
    const solid = t.mode === "solid";
    R(sx, 0, SW, 297, solid ? acc : tint(.10), 0);
    const sHead = solid ? onAcc(.95) : INK, sBody = solid ? onAcc(.5) : TXT, sSec = solid ? onAcc(.85) : acc;
    let sy = 16;
    if (t.photo) { o.push(`<circle cx="${sx + SW / 2}" cy="30" r="14" fill="${solid ? onAcc(.8) : tint(.3)}"/>`); sy = 52; }
    R(sx + 10, sy, SW - 20, 3.4, sHead);
    R(sx + 14, sy + 6.5, SW - 28, 2.2, sBody);
    sy += 18;
    for (let s = 0; s < 3; s++) {
      R(sx + 10, sy, 22, 2.8, sSec);
      for (let i = 0; i < 3; i++) R(sx + 10, sy + 6 + i * 4.6, (SW - 20) * (i === 2 ? .62 : 1), 1.8, sBody);
      sy += 30;
    }
  }

  // ---- header -------------------------------------------------------------
  let y = 18;
  const H = t.header || "left";
  if (H === "band") {
    R(0, 0, 210, 46, acc, 0);
    if (t.photo) o.push(`<circle cx="${x1 - 14}" cy="23" r="12" fill="${onAcc(.85)}"/>`);
    R(x0, 15, 74, 5.5, onAcc(.95), 0.8);
    R(x0, 25, 52, 2.6, onAcc(.6), 0.8);
    R(x0, 31, 88, 2, onAcc(.42), 0.8);
    y = 60;
  } else if (H === "centered" || H === "caps") {
    const cx = side ? x0 + W / 2 : 105;
    if (t.photo) { o.push(`<circle cx="${cx}" cy="26" r="12" fill="${tint(.28)}"/>`); y = 46; }
    R(cx - 37, y, 74, 5.5, INK);
    R(cx - 26, y + 9.5, 52, 2.6, tint(.8), 0.7);
    R(cx - 44, y + 16, 88, 2, TXT);
    y += 26;
    if (H === "caps") { R(x0, y - 4, W, 1.1, tint(.7), 0); y += 3; }
  } else if (H === "split") {
    R(x0, y, 70, 5.5, INK);
    R(x0, y + 9.5, 46, 2.6, tint(.8), 0.7);
    for (let i = 0; i < 3; i++) R(x1 - 46, y + 1 + i * 5, 46, 2, TXT);
    y += 24;
  } else {
    if (t.photo) { o.push(`<circle cx="${x1 - 14}" cy="26" r="12" fill="${tint(.28)}"/>`); }
    R(x0, y, 72, 5.5, INK);
    R(x0, y + 9.5, 48, 2.6, tint(.8), 0.7);
    R(x0, y + 16, 84, 2, TXT);
    y += 26;
  }

  // ---- section headings, in each template's own idiom ---------------------
  const heading = (yy) => {
    const S = t.sec || "rule";
    if (S === "band") { R(x0, yy - 1, W, 8, tint(.14), 0.8); R(x0 + 3, yy + 1.6, 26, 2.8, tint(.85)); return yy + 12; }
    if (S === "bar")  { R(x0, yy, 2, 6, acc, 0.5); R(x0 + 5, yy + 1.4, 26, 2.8, INK); return yy + 11; }
    if (S === "diamond") { o.push(`<rect x="${x0}" y="${yy + 1}" width="3.4" height="3.4" fill="${acc}" transform="rotate(45 ${x0 + 1.7} ${yy + 2.7})"/>`); R(x0 + 8, yy + 1.4, 26, 2.8, INK); return yy + 11; }
    if (S === "plain") { R(x0, yy, 26, 2.8, INK); return yy + 9; }
    R(x0, yy, 26, 2.8, acc);                       // rule
    R(x0, yy + 5.5, W, 0.7, FAINT, 0);
    return yy + 11;
  };

  // Summary
  y = heading(y);
  for (let i = 0; i < 3; i++) R(x0, y + i * 4.6, W * (i === 2 ? .68 : 1), 1.9, TXT);
  y += 18;

  // Experience — two roles, with the timeline rail if the layout has one
  y = heading(y);
  const entryTop = y;
  for (let e = 0; e < 2; e++) {
    const ex = t.timeline ? x0 + 8 : x0;
    const ew = t.timeline ? W - 8 : W;
    if (t.timeline) o.push(`<circle cx="${x0 + 2}" cy="${y + 2}" r="2" fill="${acc}"/>`);
    R(ex, y, ew * .46, 2.9, INK);
    R(x1 - 24, y, 24, 2.4, TXT);
    R(ex, y + 5, ew * .38, 2.1, tint(.6), 0.7);
    for (let b = 0; b < 3; b++) R(ex + 3, y + 10.5 + b * 4.4, (ew - 3) * (b === 2 ? .74 : 1), 1.8, TXT);
    y += 32;
  }
  if (t.timeline) R(x0 + 1.3, entryTop + 4, 1.4, y - entryTop - 12, tint(.35), 0.7);
  y += 2;

  // Education
  y = heading(y);
  R(x0, y, W * .5, 2.9, INK);
  R(x1 - 24, y, 24, 2.4, TXT);
  R(x0, y + 5, W * .42, 2.1, TXT);
  y += 16;

  // Skills — pills or the label/value grid, whichever this template prints
  if (y < 268) {
    y = heading(y);
    if (t.skills === "chips") {
      let cx = x0, cy = y;
      [26, 19, 30, 22, 17, 27, 21].forEach(w => {
        if (cx + w > x1) { cx = x0; cy += 8; }
        if (cy > 285) return;
        R(cx, cy, w, 5.5, tint(.17), 2.7);
        cx += w + 4;
      });
      y = cy + 12;
    } else {
      for (let i = 0; i < 3 && y + i * 6 < 286; i++) {
        R(x0, y + i * 6, 26, 2.2, INK);
        R(x0 + 31, y + i * 6, W - 31, 2.2, TXT);
      }
      y += 24;
    }
  }

  // Fill the rest of the sheet if there is any. A page that stops two-thirds
  // down reads as a card that gave up halfway, which is precisely the
  // impression this drawing exists to prevent — and real résumés run to the
  // bottom of the page anyway.
  while (y < 258) {
    y = heading(y);
    for (let i = 0; i < 2 && y + i * 4.6 < 284; i++) {
      R(x0, y + i * 4.6, W * (i === 1 ? .72 : 1), 1.9, TXT);
    }
    y += 16;
  }

  return `<svg class="rbx-thumb-wire" viewBox="0 0 210 297" preserveAspectRatio="xMidYMin slice" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <rect width="210" height="297" fill="#fff"/>${o.join("")}</svg>`;
}

// The preview host starts with the same drawing the cards use, at page size.
// It costs under a millisecond and no network at all, so the builder opens onto
// a page rather than onto a white rectangle waiting for 1.33MB of pdf.js and a
// render to arrive. The real page replaces it the moment it is decoded.
function rbPreviewPlaceholder() {
  const t = (rbState.templates || []).find(x => x.id === RESUME_BUILDER_STATE.templateId);
  if (!t) return "";
  return `<div class="rbx-pdf-placeholder">${rbTemplateWireframe(t)}</div>`;
}

function rbTemplateCard(t) {
  const sel = t.id === RESUME_BUILDER_STATE.templateId;
  const acc = t.accent || "#6C5DD3";
  return `
    <div class="rbx-tmpl-cell ${sel ? "selected" : ""}" data-tmpl="${esc(t.id)}" title="${esc(t.description || "")}" style="--rb-accent:${esc(acc)}">
      <div class="rbx-tmpl-shot" data-thumb="${esc(t.id)}">${rbTemplateWireframe(t)}</div>
      <div class="rbx-tmpl-name">${esc(t.name)} ${sel ? '<span class="rbx-tmpl-check">✓</span>' : ""}</div>
      ${t.photo ? `<div class="rbx-tmpl-photo" title="Prints your photo">
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" style="width:11px;height:11px"><path d="M4 8.4h3l1.3-2h7.4l1.3 2h3v10.2H4z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><circle cx="12" cy="13.2" r="3" stroke="currentColor" stroke-width="1.7"/></svg>
        Photo</div>` : ""}
    </div>`;
}

// 12 famous resume fonts. The live preview uses the real font when the viewer
// has it (good fallbacks otherwise); the PDF uses a bundled open equivalent.
const RB_FONTS = [
  { id: "helvetica", label: "Helvetica / Arial", css: "'Helvetica Neue', Helvetica, Arial, sans-serif" },
  { id: "calibri", label: "Calibri", css: "Calibri, Carlito, 'Segoe UI', sans-serif" },
  { id: "lato", label: "Lato", css: "'Lato', 'Helvetica Neue', sans-serif" },
  { id: "roboto", label: "Roboto", css: "'Roboto', 'Helvetica Neue', sans-serif" },
  { id: "opensans", label: "Open Sans", css: "'Open Sans', 'Segoe UI', sans-serif" },
  { id: "montserrat", label: "Montserrat", css: "'Montserrat', 'Helvetica Neue', sans-serif" },
  { id: "verdana", label: "Verdana", css: "Verdana, Geneva, sans-serif" },
  { id: "tahoma", label: "Tahoma", css: "Tahoma, Geneva, sans-serif" },
  { id: "times", label: "Times New Roman", css: "'Times New Roman', Times, serif" },
  { id: "georgia", label: "Georgia", css: "Georgia, 'Times New Roman', serif" },
  { id: "garamond", label: "Garamond", css: "Garamond, 'EB Garamond', Caladea, serif" },
  { id: "cambria", label: "Cambria", css: "Cambria, Caladea, Georgia, serif" },
  { id: "merriweather", label: "Merriweather", css: "'Merriweather', Georgia, serif" },
];
const RB_FONT_CSS = Object.fromEntries(RB_FONTS.map(f => [f.id, f.css]));
RB_FONT_CSS.sans = RB_FONT_CSS.helvetica; RB_FONT_CSS.serif = RB_FONT_CSS.times; RB_FONT_CSS.mono = "'SF Mono', ui-monospace, 'Courier New', monospace";
// Matches _SIZE_MAP in resume_pdf.py, so a template that mirrors the PDF's own
// metrics scales by exactly the same factor the PDF will use.
// S to XXL, matching _SIZE_MAP in resume_pdf.py. M and L are what a résumé is
// normally set in; the two steps above exist for a short career that needs to
// fill the page. Everything derives from `scale` — the preview's root px, the
// thumbnail and the PDF — so the three can't drift apart. They did: the preview
// had its own three-value px table, so picking a size it didn't know left the
// page at 12px and nothing appeared to happen.
// The labels sit one step below the ids they carry: the id that used to be M is
// now shown as S, and so on up. Ids are what get saved, so they stay put — only
// the label and the scale changed when the whole ladder was lifted.
// Four presets, each an absolute body size in points — the same four the PDF
// engine resolves in BODY_PT (resume_pdf.py). They are point sizes rather than
// multipliers because a multiplier could never keep its promise: every template
// declared its own body base, so one setting printed 7.2pt in one design and
// 15.5pt in another. "Standard" now means 10pt body text in all 40 templates,
// measured out of the rendered PDF by the typography harness.
const RB_SIZES = [
  { id: "pt9", label: "Small", pt: 9, hint: "9 pt — dense, for a one-page résumé" },
  { id: "pt10", label: "Standard", pt: 10, hint: "10 pt — the usual choice" },
  { id: "pt11", label: "Medium", pt: 11, hint: "11 pt — more comfortable to read" },
];
// Not offered for new résumés, but still rendered: a document already saved at
// 12pt must not silently reflow the next time it is opened, so the step appears
// in the picker only while the open résumé is using it.
const RB_SIZES_RETIRED = [
  { id: "pt12", label: "Large", pt: 12, hint: "12 pt — no longer offered; shown because this résumé uses it" },
];
const RB_SIZE_ALIASES = {
  small: "pt9", xs: "pt9", compact: "pt9",
  standard: "pt10", medium: "pt10",
  large: "pt11",
  // xl and xxl were the top of the old multiplier ladder; 12pt is retired, so
  // they resolve to the largest size still on offer.
  xl: "pt11", xxl: "pt11",
  9: "pt9", 10: "pt10", 11: "pt11", 12: "pt12",
};
// A4 is 595.28pt wide. The preview sheet is that same page drawn in CSS pixels,
// so one point of type is (sheet width / 595.28) pixels — which is how the
// preview shows the size the PDF will actually print, at whatever width the
// panel happens to be.
const RB_A4_WIDTH_PT = 595.28;
// The generic preview sets body copy at 0.917em, so the root has to be the body
// size divided by that for body text to land on the preset.
const RB_BODY_EM = 0.917;

function rbSizeStep(id) {
  const key = RB_SIZE_ALIASES[id] || id || "pt10";
  return RB_SIZES.find(s => s.id === key)
      || RB_SIZES_RETIRED.find(s => s.id === key)
      || RB_SIZES[1];
}
// What the picker shows: the offered steps, plus the current one if it's retired.
function rbSizeChoices() {
  const cur = rbSizeStep(rbVal("font_size"));
  return RB_SIZES.some(s => s.id === cur.id) ? RB_SIZES : [cur, ...RB_SIZES];
}
function rbSizePt(id) { return rbSizeStep(id).pt; }
// The factor the mirrored templates' cqw-based type is scaled by: the requested
// body size over the size that design was drawn at, matching _sz() on the
// server. Anything not listed was drawn at the catalogue's usual 7.5pt.
const RB_TYPE_BASE = { harvard_classic: 8.1, ats_plain: 8.1, corporate_letter: 10.0 };
function rbSizeScale(id, templateId) {
  return rbSizePt(id) / (RB_TYPE_BASE[templateId] || 7.5);
}
function rbSizePx(id, sheetWidthPx) {
  const perPt = (sheetWidthPx || 820) / RB_A4_WIDTH_PT;
  return +((rbSizePt(id) / RB_BODY_EM) * perPt).toFixed(2);
}

function rbCurrentStyle() {
  const list = rbState.templates || [];
  const t = list.find(x => x.id === RESUME_BUILDER_STATE.templateId) || {};
  return {
    family: t.family || "single", header: t.header || "left", sec: t.sec || "rule",
    skills: t.skills || "cat", mode: t.mode || null, side: t.side || "left",
    border: !!t.border, accent: t.accent || null,
  };
}

// Build the resume HTML for a given style — used by the live preview AND by
// each template thumbnail, so what the customer sees in the grid is exactly
// what they get. `v` = field values, `style` = the template's layout style.
// ===========================================================================
// HARVARD CLASSIC — HTML mirror of the PDF renderer
// ---------------------------------------------------------------------------
// The generic rbResumeHTML() draws every template with the same violet-accent
// "profile card" look, which meant the on-screen preview bore no resemblance
// to the PDF that actually came out. This renders the same structure the
// Python builder does — centred tracked caps name, ruled caps sections, bold
// title with right-aligned dates, italic location, dot bullets, a two-column
// skills table and bold-prefix project lines — so what you see is what you
// download. All metrics are cqw units derived from the PDF's own point sizes
// against a 595pt page, so it stays exact at any preview width.
// ===========================================================================
function rbHarvardHTML(v) {
  const name = (v.full_name || "Your Name").trim().toUpperCase();
  const line1 = [v.title, v.location, v.phone, v.email].map(x => (x || "").trim()).filter(Boolean);
  const line2 = [v.linkedin, v.website].map(x => (x || "").trim()).filter(Boolean);

  const sec = (title, inner) => inner
    ? `<div class="hv-sec"><div class="hv-sec-h">${esc(title)}</div><div class="hv-rule"></div>${inner}</div>`
    : "";

  const headRow = (left, right) =>
    `<div class="hv-row"><span class="hv-role">${esc(left)}</span>${right ? `<span class="hv-dates">${esc(right)}</span>` : ""}</div>`;

  // Header line convention matches the PDF: Role | Company | Dates | Location
  const entries = (text, withDots) => rbParseBlocks(text).map(b => {
    const p = rbHeadParts(b.head);
    const title = p.length > 1 ? `${p[0]}, ${p[1]}` : (p[0] || "");
    const dates = p[2] || "";
    const place = p[3] || "";
    const body = b.body.map(l => {
      const t = l.replace(/^[-•]\s*/, "");
      return withDots ? `<div class="hv-bullet">${esc(t)}</div>` : `<div class="hv-note">${esc(t)}</div>`;
    }).join("");
    return `<div class="hv-entry">${headRow(title, dates)}${place ? `<div class="hv-place">${esc(place)}</div>` : ""}${body}</div>`;
  }).join("");

  const eduHtml = rbParseBlocks(v.education).map(b => {
    const p = rbHeadParts(b.head);
    const inst = p.length > 3 ? p.slice(3).join(", ") : (p[1] || "");
    const body = b.body.map(l => `<div class="hv-note">${esc(l.replace(/^[-•]\s*/, ""))}</div>`).join("");
    return `<div class="hv-entry">${headRow(p[0] || "", p[2] || "")}${inst ? `<div class="hv-place">${esc(inst)}</div>` : ""}${body}</div>`;
  }).join("");

  const skillsHtml = (v.skills || "").split("\n").map(l => l.trim()).filter(Boolean).map(line => {
    const i = line.indexOf(":");
    return i === -1
      ? `<div class="hv-skill-row"><span class="hv-skill-val hv-skill-full">${esc(line)}</span></div>`
      : `<div class="hv-skill-row"><span class="hv-skill-cat">${esc(line.slice(0, i).trim())}</span><span class="hv-skill-val">${esc(line.slice(i + 1).trim())}</span></div>`;
  }).join("");

  // "Name: what it does" — the name up to the colon is bold, as in the PDF.
  const projHtml = rbParseBlocks(v.projects).map(b => {
    const head = rbHeadParts(b.head)[0] || b.head;
    const detail = b.body.map(l => l.replace(/^[-•]\s*/, "")).join(" ");
    return `<div class="hv-line"><b>${esc(head)}${detail ? ":" : ""}</b>${detail ? " " + esc(detail) : ""}</div>`;
  }).join("");

  const listOf = (text) => (text || "").split("\n").map(l => l.trim()).filter(Boolean)
    .map(l => `<div class="hv-line">${esc(l)}</div>`).join("");

  const customHtml = (v.custom_sections || []).map(s => {
    const inner = (s.items || []).map(it => {
      const heading = (it.heading || "").trim();
      const bl = (it.bullets || []).filter(b => (b || "").trim())
        .map(b => `<div class="hv-bullet">${esc(b)}</div>`).join("");
      if (!heading && !bl && !it.subheading && !it.text) return "";
      return `<div class="hv-entry">${heading ? headRow(heading, it.meta || "") : ""}` +
             `${it.subheading ? `<div class="hv-place">${esc(it.subheading)}</div>` : ""}` +
             `${it.text ? `<div class="hv-note">${esc(it.text)}</div>` : ""}${bl}</div>`;
    }).join("");
    return sec(s.title || "Additional", inner);
  }).join("");

  return `<div class="hv">
    <div class="hv-name">${esc(name)}</div>
    ${line1.length ? `<div class="hv-contact">${esc(line1.join("  |  "))}</div>` : ""}
    ${line2.length ? `<div class="hv-contact">${esc(line2.join("  |  "))}</div>` : ""}
    ${sec("Professional Summary", v.summary ? `<div class="hv-body">${esc(v.summary).replace(/\n/g, "<br>")}</div>` : "")}
    ${sec("Professional Experience", entries(v.experience, true))}
    ${sec("Education", eduHtml)}
    ${sec("Technical Skills", skillsHtml)}
    ${sec("Selected Projects", projHtml)}
    ${sec("Publications", listOf(v.publications))}
    ${sec("Certifications", listOf(v.certifications))}
    ${customHtml}
  </div>`;
}

// ---------------------------------------------------------------------------
// Shared pieces for the template-specific HTML renderers. Each mirrors its
// Python builder exactly; metrics live in CSS as cqw units derived from the
// same point sizes (pt / 595 * 100).
// ---------------------------------------------------------------------------
function rbEntries(text) {
  return rbParseBlocks(text).map(b => {
    const p = rbHeadParts(b.head);
    return {
      title: p[0] || "", company: p[1] || "", dates: p[2] || "", place: p[3] || "",
      bullets: b.body.map(l => l.replace(/^[-•]\s*/, "")).filter(Boolean),
    };
  });
}
function rbNamedLines(text) {
  return (text || "").split("\n").map(l => l.trim()).filter(Boolean).map(line => {
    const i = line.indexOf(":");
    return i === -1 ? { label: "", value: line }
                    : { label: line.slice(0, i).trim(), value: line.slice(i + 1).trim() };
  });
}
function rbProjectLines(text) {
  return rbParseBlocks(text).map(b => ({
    name: rbHeadParts(b.head)[0] || b.head,
    detail: b.body.map(l => l.replace(/^[-•]\s*/, "")).join(" "),
  }));
}
function rbContactBits(v) {
  return [v.location, v.phone, v.email, v.linkedin, v.website]
    .map(x => (x || "").trim()).filter(Boolean);
}
const rbListLines = (t) => (t || "").split("\n").map(l => l.trim()).filter(Boolean);

// ===========================================================================
// 02 — MODERN MINIMALIST
// ===========================================================================
function rbModernMinimalistHTML(v) {
  const sec = (title, inner) => inner ? `<div class="mm-sec"><div class="mm-sec-h">${esc(title)}</div>${inner}</div>` : "";
  const row = (l, r) => `<div class="mm-row"><span class="mm-title">${esc(l)}</span>${r ? `<span class="mm-dates">${esc(r)}</span>` : ""}</div>`;
  const entries = t => rbEntries(t).map(e => `<div class="mm-entry">${row(e.title, e.dates)}` +
    `${[e.company, e.place].filter(Boolean).length ? `<div class="mm-meta">${esc([e.company, e.place].filter(Boolean).join(" · "))}</div>` : ""}` +
    `${e.bullets.map(b => `<div class="mm-bullet">${esc(b)}</div>`).join("")}</div>`).join("");
  const skills = rbNamedLines(v.skills).map(s =>
    `<div class="mm-skill"><span class="mm-skill-l">${esc(s.label)}</span><span class="mm-skill-v">${esc(s.value)}</span></div>`).join("");
  const projects = rbProjectLines(v.projects).map(p =>
    `<div class="mm-line"><b>${esc(p.name)}</b>${p.detail ? " — " + esc(p.detail) : ""}</div>`).join("");
  const listSec = (t, k) => sec(t, rbListLines(v[k]).map(l => `<div class="mm-line">${esc(l)}</div>`).join(""));
  const custom = (v.custom_sections || []).map(cs => sec(cs.title || "Additional",
    (cs.items || []).map(it => `<div class="mm-entry">${it.heading ? row(it.heading, it.meta || "") : ""}` +
      `${it.subheading ? `<div class="mm-meta">${esc(it.subheading)}</div>` : ""}` +
      `${it.text ? `<div class="mm-body">${esc(it.text)}</div>` : ""}` +
      `${(it.bullets || []).filter(Boolean).map(b => `<div class="mm-bullet">${esc(b)}</div>`).join("")}</div>`).join(""))).join("");
  return `<div class="mm">
    <div class="mm-name">${esc(v.full_name || "Your Name")}</div>
    ${v.title ? `<div class="mm-role">${esc(v.title)}</div>` : ""}
    ${rbContactBits(v).length ? `<div class="mm-contact">${esc(rbContactBits(v).join(" • "))}</div>` : ""}
    ${sec("Summary", v.summary ? `<div class="mm-body">${esc(v.summary).replace(/\n/g, "<br>")}</div>` : "")}
    ${sec("Experience", entries(v.experience))}
    ${sec("Education", entries(v.education))}
    ${sec("Skills", skills)}
    ${sec("Projects", projects)}
    ${listSec("Publications", "publications")}
    ${listSec("Certifications", "certifications")}
    ${custom}
  </div>`;
}

// ===========================================================================
// 03 — TWO-COLUMN SIDEBAR
// ===========================================================================
function rbTwoColumnSidebarHTML(v) {
  const sideSec = (t, inner) => inner ? `<div class="ts-side-sec"><div class="ts-side-h">${esc(t)}</div><div class="ts-side-rule"></div>${inner}</div>` : "";
  const mainSec = (t, inner) => inner ? `<div class="ts-sec"><div class="ts-sec-h">${esc(t)}</div><div class="ts-rule"></div>${inner}</div>` : "";
  const contact = rbContactBits(v).map(c => `<div class="ts-side-line">${esc(c)}</div>`).join("");
  const skills = rbNamedLines(v.skills).map(s =>
    `<div class="ts-side-skill">${s.label ? `<div class="ts-side-lab">${esc(s.label)}</div>` : ""}<div class="ts-side-val">${esc(s.value)}</div></div>`).join("");
  const edu = rbEntries(v.education).map(e =>
    `<div class="ts-side-skill"><div class="ts-side-lab">${esc(e.title)}</div><div class="ts-side-val">${esc([e.company || e.place, e.dates].filter(Boolean).join(", "))}</div></div>`).join("");
  const certs = rbListLines(v.certifications).map(c => `<div class="ts-side-val ts-side-cert">${esc(c)}</div>`).join("");
  const exp = rbEntries(v.experience).map(e => `<div class="ts-entry">
      <div class="ts-row"><span class="ts-title">${esc(e.title)}</span>${e.dates ? `<span class="ts-dates">${esc(e.dates)}</span>` : ""}</div>
      ${[e.company, e.place].filter(Boolean).length ? `<div class="ts-meta">${esc([e.company, e.place].filter(Boolean).join(" — "))}</div>` : ""}
      ${e.bullets.map(b => `<div class="ts-bullet">${esc(b)}</div>`).join("")}</div>`).join("");
  const proj = rbProjectLines(v.projects).map(p =>
    `<div class="ts-proj"><div class="ts-proj-t">${esc(p.name)}</div>${p.detail ? `<div class="ts-meta">${esc(p.detail)}</div>` : ""}</div>`).join("");
  const pubs = rbListLines(v.publications).map(l => `<div class="ts-body">${esc(l)}</div>`).join("");
  const custom = (v.custom_sections || []).map(cs => mainSec(cs.title || "Additional",
    (cs.items || []).map(it => `<div class="ts-entry">${it.heading ? `<div class="ts-row"><span class="ts-title">${esc(it.heading)}</span>${it.meta ? `<span class="ts-dates">${esc(it.meta)}</span>` : ""}</div>` : ""}` +
      `${it.subheading ? `<div class="ts-meta">${esc(it.subheading)}</div>` : ""}` +
      `${(it.bullets || []).filter(Boolean).map(b => `<div class="ts-bullet">${esc(b)}</div>`).join("")}</div>`).join(""))).join("");
  return `<div class="ts">
    <aside class="ts-side">
      <div class="ts-side-name">${esc(v.full_name || "Your Name")}</div>
      ${v.title ? `<div class="ts-side-role">${esc(v.title)}</div>` : ""}
      ${sideSec("Contact", contact)}
      ${sideSec("Skills", skills)}
      ${sideSec("Education", edu)}
      ${sideSec("Certifications", certs)}
    </aside>
    <main class="ts-main">
      ${mainSec("Summary", v.summary ? `<div class="ts-body">${esc(v.summary).replace(/\n/g, "<br>")}</div>` : "")}
      ${mainSec("Experience", exp)}
      ${mainSec("Projects", proj)}
      ${mainSec("Publications", pubs)}
      ${custom}
    </main>
  </div>`;
}

// ===========================================================================
// 04 — CREATIVE COLORFUL
// ===========================================================================
function rbCreativeColorfulHTML(v) {
  const sec = (t, inner) => inner ? `<div class="cc-sec"><div class="cc-sec-h">${esc(t)}</div>${inner}</div>` : "";
  const exp = rbEntries(v.experience).map(e => `<div class="cc-entry">
      <div class="cc-row"><span class="cc-title">${esc(e.title)}</span>${e.dates ? `<span class="cc-dates">${esc(e.dates)}</span>` : ""}</div>
      ${[e.company, e.place].filter(Boolean).length ? `<div class="cc-meta">${esc([e.company, e.place].filter(Boolean).join(" · "))}</div>` : ""}
      ${e.bullets.map(b => `<div class="cc-bullet">${esc(b)}</div>`).join("")}</div>`).join("");
  const chips = rbNamedLines(v.skills).flatMap(s => s.value.split(",").map(x => x.trim()).filter(Boolean));
  const edu = rbEntries(v.education).map(e =>
    `<div class="cc-block"><div class="cc-block-t">${esc(e.title)}</div><div class="cc-block-d">${esc([e.company || e.place, e.dates].filter(Boolean).join(" · "))}</div></div>`).join("");
  const proj = rbProjectLines(v.projects).map(p =>
    `<div class="cc-block"><div class="cc-block-t">${esc(p.name)}</div>${p.detail ? `<div class="cc-block-d">${esc(p.detail)}</div>` : ""}</div>`).join("");
  const listSec = (t, k) => sec(t, rbListLines(v[k]).map(l => `<div class="cc-body">${esc(l)}</div>`).join(""));
  const custom = (v.custom_sections || []).map(cs => sec(cs.title || "Additional",
    (cs.items || []).map(it => `<div class="cc-block"><div class="cc-block-t">${esc(it.heading || "")}</div>` +
      `${it.subheading || it.meta ? `<div class="cc-block-d">${esc([it.subheading, it.meta].filter(Boolean).join(" · "))}</div>` : ""}` +
      `${(it.bullets || []).filter(Boolean).map(b => `<div class="cc-bullet">${esc(b)}</div>`).join("")}</div>`).join(""))).join("");
  return `<div class="cc">
    <div class="cc-band">
      <div class="cc-name">${esc(v.full_name || "Your Name")}</div>
      ${[v.title, ...rbContactBits(v)].filter(Boolean).length
        ? `<div class="cc-contact">${esc([v.title, ...rbContactBits(v)].filter(Boolean).join("  •  "))}</div>` : ""}
    </div>
    <div class="cc-body-wrap">
      ${sec("Profile", v.summary ? `<div class="cc-body">${esc(v.summary).replace(/\n/g, "<br>")}</div>` : "")}
      ${sec("Experience", exp)}
      ${sec("Skills", chips.length ? `<div class="cc-chips">${chips.map(c => `<span class="cc-chip">${esc(c)}</span>`).join("")}</div>` : "")}
      ${sec("Education", edu)}
      ${sec("Projects", proj)}
      ${listSec("Publications", "publications")}
      ${listSec("Certifications", "certifications")}
      ${custom}
    </div>
  </div>`;
}

// ===========================================================================
// 05 — EXECUTIVE ELEGANT
// ===========================================================================
function rbExecutiveElegantHTML(v) {
  const sec = (t, inner) => inner ? `<div class="ee-sec"><div class="ee-sec-h">${esc(t)}</div>${inner}</div>` : "";
  const entries = t => rbEntries(t).map(e => `<div class="ee-entry">
      <div class="ee-row"><span class="ee-title">${esc(e.title)}</span>${e.dates ? `<span class="ee-dates">${esc(e.dates)}</span>` : ""}</div>
      ${[e.company, e.place].filter(Boolean).length ? `<div class="ee-meta">${esc([e.company, e.place].filter(Boolean).join(" | "))}</div>` : ""}
      ${e.bullets.map(b => `<div class="ee-bullet">${esc(b)}</div>`).join("")}</div>`).join("");
  const comps = rbNamedLines(v.skills).map(s =>
    `<div class="ee-comp">${s.label ? `<b>${esc(s.label)}:</b> ` : ""}${esc(s.value)}</div>`).join("");
  const proj = rbProjectLines(v.projects).map(p =>
    `<div class="ee-line"><b>${esc(p.name)}${p.detail ? ":" : ""}</b>${p.detail ? " " + esc(p.detail) : ""}</div>`).join("");
  const listSec = (t, k) => sec(t, rbListLines(v[k]).map(l => `<div class="ee-line">${esc(l)}</div>`).join(""));
  const custom = (v.custom_sections || []).map(cs => sec(cs.title || "Additional",
    (cs.items || []).map(it => `<div class="ee-entry">${it.heading ? `<div class="ee-row"><span class="ee-title">${esc(it.heading)}</span>${it.meta ? `<span class="ee-dates">${esc(it.meta)}</span>` : ""}</div>` : ""}` +
      `${it.subheading ? `<div class="ee-meta">${esc(it.subheading)}</div>` : ""}` +
      `${(it.bullets || []).filter(Boolean).map(b => `<div class="ee-bullet">${esc(b)}</div>`).join("")}</div>`).join(""))).join("");
  return `<div class="ee">
    <div class="ee-name">${esc(v.full_name || "Your Name")}</div>
    ${v.title ? `<div class="ee-role">${esc(v.title).toUpperCase()}</div>` : ""}
    ${rbContactBits(v).length ? `<div class="ee-contact">${esc(rbContactBits(v).join(" | "))}</div>` : ""}
    <div class="ee-double"><span></span><span></span></div>
    ${sec("Executive Summary", v.summary ? `<div class="ee-body">${esc(v.summary).replace(/\n/g, "<br>")}</div>` : "")}
    ${sec("Professional Experience", entries(v.experience))}
    ${sec("Education", entries(v.education))}
    ${sec("Core Competencies", comps)}
    ${sec("Selected Projects", proj)}
    ${listSec("Publications", "publications")}
    ${listSec("Certifications", "certifications")}
    ${custom}
  </div>`;
}

// ===========================================================================
// 07 — ATS PLAIN
// ===========================================================================
function rbAtsPlainHTML(v) {
  const sec = (t, inner) => inner ? `<div class="ap-sec"><div class="ap-sec-h">${esc(t)}</div>${inner}</div>` : "";
  const entries = t => rbEntries(t).map(e => {
    const head = [e.title, e.company].filter(Boolean).join(" — ");
    const tail = [e.dates, e.place].filter(Boolean).join(" | ");
    return `<div class="ap-entry"><div class="ap-title">${esc(head + (tail ? ` | ${tail}` : ""))}</div>` +
           `${e.bullets.map(b => `<div class="ap-bullet">${esc(b)}</div>`).join("")}</div>`;
  }).join("");
  const skills = rbNamedLines(v.skills).map(s =>
    `<div class="ap-body">${s.label ? `<b>${esc(s.label)}:</b> ` : ""}${esc(s.value)}</div>`).join("");
  const proj = rbProjectLines(v.projects).map(p =>
    `<div class="ap-bullet"><b>${esc(p.name)}${p.detail ? ":" : ""}</b>${p.detail ? " " + esc(p.detail) : ""}</div>`).join("");
  const listSec = (t, k) => sec(t, rbListLines(v[k]).map(l => `<div class="ap-bullet">${esc(l)}</div>`).join(""));
  const custom = (v.custom_sections || []).map(cs => sec(cs.title || "Additional",
    (cs.items || []).map(it => `<div class="ap-entry">${it.heading ? `<div class="ap-title">${esc([it.heading, it.subheading].filter(Boolean).join(" — ") + (it.meta ? ` | ${it.meta}` : ""))}</div>` : ""}` +
      `${(it.bullets || []).filter(Boolean).map(b => `<div class="ap-bullet">${esc(b)}</div>`).join("")}</div>`).join(""))).join("");
  return `<div class="ap">
    <div class="ap-name">${esc(v.full_name || "Your Name")}</div>
    ${v.title ? `<div class="ap-role">${esc(v.title)}</div>` : ""}
    ${rbContactBits(v).length ? `<div class="ap-contact">${esc(rbContactBits(v).join(" | "))}</div>` : ""}
    ${sec("Professional Summary", v.summary ? `<div class="ap-body">${esc(v.summary).replace(/\n/g, "<br>")}</div>` : "")}
    ${sec("Professional Experience", entries(v.experience))}
    ${sec("Education", entries(v.education))}
    ${sec("Technical Skills", skills)}
    ${sec("Projects", proj)}
    ${listSec("Publications", "publications")}
    ${listSec("Certifications", "certifications")}
    ${custom}
  </div>`;
}

// ===========================================================================
// 08 — BOLD SIDEBAR
// ===========================================================================
function rbInitials(name) {
  const p = String(name || "").split(/\s+/).filter(Boolean);
  return (p.slice(0, 2).map(x => x[0]).join("") || "?").toUpperCase();
}
function rbBoldSidebarHTML(v) {
  const sideSec = (t, inner) => inner ? `<div class="bs-side-sec"><div class="bs-side-h">${esc(t)}</div>${inner}</div>` : "";
  const sec = (t, inner) => inner ? `<div class="bs-sec"><div class="bs-sec-h">${esc(t)}</div>${inner}</div>` : "";
  const contact = rbContactBits(v).map(c => `<div class="bs-side-line">${esc(c)}</div>`).join("");
  const skills = rbNamedLines(v.skills).map(s =>
    `<div class="bs-side-skill">${s.label ? `<div class="bs-side-lab">${esc(s.label)}</div>` : ""}<div class="bs-side-val">${esc(s.value)}</div></div>`).join("");
  const edu = rbEntries(v.education).map(e =>
    `<div class="bs-side-skill"><div class="bs-side-lab">${esc(e.title)}</div><div class="bs-side-val">${esc([e.company || e.place, e.dates].filter(Boolean).join(", "))}</div></div>`).join("");
  const certs = rbListLines(v.certifications).map(c => `<div class="bs-side-val bs-side-cert">${esc(c)}</div>`).join("");
  const exp = rbEntries(v.experience).map(e => `<div class="bs-entry">
      <div class="bs-row"><span class="bs-title">${esc(e.title)}</span>${e.dates ? `<span class="bs-dates">${esc(e.dates)}</span>` : ""}</div>
      ${[e.company, e.place].filter(Boolean).length ? `<div class="bs-emp">${esc([e.company, e.place].filter(Boolean).join(" · "))}</div>` : ""}
      ${e.bullets.map(b => `<div class="bs-bullet">${esc(b)}</div>`).join("")}</div>`).join("");
  const proj = rbProjectLines(v.projects).map(p =>
    `<div class="bs-proj"><div class="bs-proj-t">${esc(p.name)}</div>${p.detail ? `<div class="bs-side-val">${esc(p.detail)}</div>` : ""}</div>`).join("");
  const custom = (v.custom_sections || []).map(cs => sec(cs.title || "Additional",
    (cs.items || []).map(it => `<div class="bs-entry">${it.heading ? `<div class="bs-row"><span class="bs-title">${esc(it.heading)}</span>${it.meta ? `<span class="bs-dates">${esc(it.meta)}</span>` : ""}</div>` : ""}` +
      `${it.subheading ? `<div class="bs-emp">${esc(it.subheading)}</div>` : ""}` +
      `${(it.bullets || []).filter(Boolean).map(b => `<div class="bs-bullet">${esc(b)}</div>`).join("")}</div>`).join(""))).join("");
  return `<div class="bs">
    <aside class="bs-side">
      <div class="bs-disc">${esc(rbInitials(v.full_name))}</div>
      ${sideSec("Contact", contact)}
      ${sideSec("Skills", skills)}
      ${sideSec("Education", edu)}
      ${sideSec("Certifications", certs)}
    </aside>
    <main class="bs-main">
      <div class="bs-name">${esc(v.full_name || "Your Name")}</div>
      ${v.title ? `<div class="bs-role">${esc(v.title)}</div>` : ""}
      ${sec("Profile", v.summary ? `<div class="bs-body">${esc(v.summary).replace(/\n/g, "<br>")}</div>` : "")}
      ${sec("Experience", exp)}
      ${sec("Projects", proj)}
      ${sec("Publications", rbListLines(v.publications).map(l => `<div class="bs-body">${esc(l)}</div>`).join(""))}
      ${custom}
    </main>
  </div>`;
}

// ===========================================================================
// 09 — TIMELINE
// ===========================================================================
function rbTimelineHTML(v) {
  const sec = (t, inner) => inner ? `<div class="tl-sec"><div class="tl-sec-h">${esc(t)}</div>${inner}</div>` : "";
  const rail = t => {
    const list = rbEntries(t);
    if (!list.length) return "";
    return `<div class="tl-rail">${list.map((e, i) => `<div class="tl-item${i === list.length - 1 ? " is-last" : ""}">
        <div class="tl-row"><span class="tl-title">${esc(e.title)}</span>${e.dates ? `<span class="tl-dates">${esc(e.dates)}</span>` : ""}</div>
        ${[e.company, e.place].filter(Boolean).length ? `<div class="tl-meta">${esc([e.company, e.place].filter(Boolean).join(" · "))}</div>` : ""}
        ${e.bullets.map(b => `<div class="tl-bullet">${esc(b)}</div>`).join("")}
      </div>`).join("")}</div>`;
  };
  const skills = rbNamedLines(v.skills).map(s =>
    `<div class="tl-skill"><span class="tl-skill-l">${esc(s.label)}</span><span class="tl-skill-v">${esc(s.value)}</span></div>`).join("");
  const proj = rbProjectLines(v.projects).map(p =>
    `<div class="tl-body"><b>${esc(p.name)}</b>${p.detail ? " — " + esc(p.detail) : ""}</div>`).join("");
  const listSec = (t, k) => sec(t, rbListLines(v[k]).map(l => `<div class="tl-body">${esc(l)}</div>`).join(""));
  const custom = (v.custom_sections || []).map(cs => sec(cs.title || "Additional",
    (cs.items || []).map(it => `<div class="tl-body"><b>${esc(it.heading || "")}</b>${it.meta ? " — " + esc(it.meta) : ""}</div>` +
      `${(it.bullets || []).filter(Boolean).map(b => `<div class="tl-bullet tl-bullet-flat">${esc(b)}</div>`).join("")}`).join(""))).join("");
  return `<div class="tl">
    <div class="tl-name">${esc(v.full_name || "Your Name")}</div>
    ${v.title ? `<div class="tl-role">${esc(v.title)}</div>` : ""}
    ${rbContactBits(v).length ? `<div class="tl-contact">${esc(rbContactBits(v).join(" • "))}</div>` : ""}
    ${sec("Summary", v.summary ? `<div class="tl-body">${esc(v.summary).replace(/\n/g, "<br>")}</div>` : "")}
    ${sec("Experience", rail(v.experience))}
    ${sec("Education", rail(v.education))}
    ${sec("Skills", skills)}
    ${sec("Projects", proj)}
    ${listSec("Publications", "publications")}
    ${listSec("Certifications", "certifications")}
    ${custom}
  </div>`;
}

// ===========================================================================
// 10 — INFOGRAPHIC
// ===========================================================================
function rbInfographicHTML(v) {
  const sideSec = (t, inner) => inner ? `<div class="ig-side-sec"><div class="ig-side-h">${esc(t)}</div>${inner}</div>` : "";
  const sec = (t, inner) => inner ? `<div class="ig-sec"><div class="ig-sec-h"><span>${esc(t)}</span></div>${inner}</div>` : "";
  const contact = rbContactBits(v).map(c => `<div class="ig-side-line">${esc(c)}</div>`).join("");
  const rows = rbNamedLines(v.skills);
  const counts = rows.map(s => Math.max(1, s.value.split(",").filter(x => x.trim()).length));
  const top = Math.max(1, ...counts);
  // Bar length reflects how many items a group lists — the only honest signal
  // the form carries. No invented percentages.
  const bars = rows.map((s, i) => `<div class="ig-bar">
      <div class="ig-bar-l">${esc(s.label || s.value.slice(0, 28))}</div>
      <div class="ig-bar-track"><span style="width:${Math.max(12, Math.round(counts[i] / top * 100))}%"></span></div>
    </div>`).join("");
  const edu = rbEntries(v.education).map(e =>
    `<div class="ig-side-skill"><div class="ig-side-lab">${esc(e.title)}</div><div class="ig-side-line">${esc([e.company || e.place, e.dates].filter(Boolean).join(", "))}</div></div>`).join("");
  const certs = rbListLines(v.certifications).map(c => `<div class="ig-side-line ig-side-cert">${esc(c)}</div>`).join("");
  const exp = rbEntries(v.experience).map(e => `<div class="ig-entry">
      <div class="ig-row"><span class="ig-title">${esc(e.title)}</span>${e.dates ? `<span class="ig-dates">${esc(e.dates)}</span>` : ""}</div>
      ${[e.company, e.place].filter(Boolean).length ? `<div class="ig-emp">${esc([e.company, e.place].filter(Boolean).join(" · "))}</div>` : ""}
      ${e.bullets.map(b => `<div class="ig-bullet">${esc(b)}</div>`).join("")}</div>`).join("");
  const proj = rbProjectLines(v.projects).map(p =>
    `<div class="ig-proj"><div class="ig-proj-t">${esc(p.name)}</div>${p.detail ? `<div class="ig-dates">${esc(p.detail)}</div>` : ""}</div>`).join("");
  const custom = (v.custom_sections || []).map(cs => sec(cs.title || "Additional",
    (cs.items || []).map(it => `<div class="ig-entry">${it.heading ? `<div class="ig-row"><span class="ig-title">${esc(it.heading)}</span>${it.meta ? `<span class="ig-dates">${esc(it.meta)}</span>` : ""}</div>` : ""}` +
      `${(it.bullets || []).filter(Boolean).map(b => `<div class="ig-bullet">${esc(b)}</div>`).join("")}</div>`).join(""))).join("");
  return `<div class="ig">
    <aside class="ig-side">
      <div class="ig-side-name">${esc(v.full_name || "Your Name")}</div>
      ${v.title ? `<div class="ig-side-role">${esc(v.title)}</div>` : ""}
      ${sideSec("Contact", contact)}
      ${sideSec("Skill Focus", bars)}
      ${sideSec("Education", edu)}
      ${sideSec("Certifications", certs)}
    </aside>
    <main class="ig-main">
      ${sec("Summary", v.summary ? `<div class="ig-body">${esc(v.summary).replace(/\n/g, "<br>")}</div>` : "")}
      ${sec("Experience", exp)}
      ${sec("Projects", proj)}
      ${sec("Publications", rbListLines(v.publications).map(l => `<div class="ig-body">${esc(l)}</div>`).join(""))}
      ${custom}
    </main>
  </div>`;
}

// ===========================================================================
// 11 — CORPORATE LETTER (US Letter)
// ===========================================================================
function rbCorporateLetterHTML(v) {
  const sec = (t, inner) => inner ? `<div class="cl-sec"><div class="cl-sec-h">${esc(t)}</div><div class="cl-rule"></div>${inner}</div>` : "";
  const entries = t => rbEntries(t).map(e => `<div class="cl-entry">
      <div class="cl-row"><span class="cl-title">${esc(e.title)}</span>${e.dates ? `<span class="cl-dates">${esc(e.dates)}</span>` : ""}</div>
      ${[e.company, e.place].filter(Boolean).length ? `<div class="cl-meta">${esc([e.company, e.place].filter(Boolean).join(", "))}</div>` : ""}
      ${e.bullets.map(b => `<div class="cl-bullet">${esc(b)}</div>`).join("")}</div>`).join("");
  const summaryBits = () => {
    const raw = (v.summary || "").split("\n").map(s => s.trim()).filter(Boolean);
    const bits = raw.length > 1 ? raw : (raw[0] || "").split(". ").map(s => s.trim()).filter(Boolean);
    return bits.map(b => `<div class="cl-bullet">${esc(b.replace(/\.$/, ""))}.</div>`).join("");
  };
  const skills = rbNamedLines(v.skills).map(s =>
    `<div class="cl-body">${s.label ? `<b>${esc(s.label)}:</b> ` : ""}${esc(s.value)}</div>`).join("");
  const proj = rbProjectLines(v.projects).map(p =>
    `<div class="cl-bullet"><b>${esc(p.name)}${p.detail ? ":" : ""}</b>${p.detail ? " " + esc(p.detail) : ""}</div>`).join("");
  const listSec = (t, k) => sec(t, rbListLines(v[k]).map(l => `<div class="cl-bullet">${esc(l)}</div>`).join(""));
  const custom = (v.custom_sections || []).map(cs => sec(cs.title || "Additional",
    (cs.items || []).map(it => `<div class="cl-entry">${it.heading ? `<div class="cl-row"><span class="cl-title">${esc(it.heading)}</span>${it.meta ? `<span class="cl-dates">${esc(it.meta)}</span>` : ""}</div>` : ""}` +
      `${(it.bullets || []).filter(Boolean).map(b => `<div class="cl-bullet">${esc(b)}</div>`).join("")}</div>`).join(""))).join("");
  const line1 = [v.location, v.phone, v.email].filter(Boolean);
  const line2 = [v.linkedin, v.website].filter(Boolean);
  return `<div class="cl">
    <div class="cl-name">${esc((v.full_name || "Your Name")).toUpperCase()}</div>
    ${v.title ? `<div class="cl-role">${esc(v.title)}</div>` : ""}
    ${line1.length ? `<div class="cl-contact">${esc(line1.join(" | "))}</div>` : ""}
    ${line2.length ? `<div class="cl-contact">${esc(line2.join(" | "))}</div>` : ""}
    ${sec("Professional Summary", summaryBits())}
    ${sec("Technical Skills", skills)}
    ${sec("Professional Experience", entries(v.experience))}
    ${sec("Education", entries(v.education))}
    ${sec("Projects", proj)}
    ${listSec("Publications", "publications")}
    ${listSec("Certifications", "certifications")}
    ${custom}
  </div>`;
}

// Templates whose on-screen preview is drawn by a dedicated renderer rather
// than the generic one. Add an entry here as each new template lands.
const RB_TEMPLATE_HTML = {
  harvard_classic: rbHarvardHTML,
  modern_minimalist: rbModernMinimalistHTML,
  twocolumn_sidebar: rbTwoColumnSidebarHTML,
  creative_colorful: rbCreativeColorfulHTML,
  executive_elegant: rbExecutiveElegantHTML,
  ats_plain: rbAtsPlainHTML,
  bold_sidebar: rbBoldSidebarHTML,
  timeline: rbTimelineHTML,
  infographic: rbInfographicHTML,
  corporate_letter: rbCorporateLetterHTML,
};

function rbTemplateInnerHTML(templateId, values, style) {
  const custom = RB_TEMPLATE_HTML[templateId];
  return custom ? custom(values) : rbResumeHTML(values, style);
}
function rbTemplatePageClass(templateId, style) {
  if (RB_TEMPLATE_HTML[templateId]) return `rbx-page rb-tpl-${templateId.replace(/_/g, "-")}`;
  return `rbx-page rb-fam-${style.family} rb-header-${style.header} rb-sec-${style.sec}` +
         ` rb-skills-${style.skills} rb-mode-${style.mode || "none"}${style.border ? " rb-border" : ""}`;
}

function rbResumeHTML(v, style) {
  const esc2 = esc;
  const name = (v.full_name || "Your Name").trim();
  const contact = [v.email, v.phone, v.location, v.linkedin, v.website].map(x => (x || "").trim()).filter(Boolean);
  const sec = (title, inner, hint) => (inner || hint) ? `<div class="rbx-r-sec"><div class="rbx-r-sec-title">${esc2(title)}</div>${inner || `<div class="rbx-r-hint">${hint}</div>`}</div>` : "";

  const summaryHtml = v.summary ? `<p class="rbx-r-summary">${esc2(v.summary).replace(/\n/g, "<br>")}</p>` : "";
  const expHtml = rbParseBlocks(v.experience).map(b => {
    const p = rbHeadParts(b.head); const bl = b.body.map(l => `<li>${esc2(l.replace(/^[-•]\s*/, ""))}</li>`).join("");
    return `<div class="rbx-r-item"><div class="rbx-r-item-top"><span class="rbx-r-item-title">${esc2(p[0] || "")}</span><span class="rbx-r-item-meta">${esc2(p.slice(1).join(" · "))}</span></div>${bl ? `<ul>${bl}</ul>` : ""}</div>`;
  }).join("");
  const eduHtml = rbParseBlocks(v.education).map(b => {
    const p = rbHeadParts(b.head);
    return `<div class="rbx-r-item"><div class="rbx-r-item-top"><span class="rbx-r-item-title">${esc2(p[0] || "")}</span><span class="rbx-r-item-meta">${esc2(p.slice(1).join(" · "))}</span></div>${b.body.map(l => `<div class="rbx-r-item-sub">${esc2(l)}</div>`).join("")}</div>`;
  }).join("");
  const projHtml = rbParseBlocks(v.projects).map(b =>
    `<div class="rbx-r-item"><div class="rbx-r-item-title">${esc2(b.head)}</div>${b.body.map(l => `<div class="rbx-r-item-sub">${esc2(l)}</div>`).join("")}</div>`).join("");
  const flatSkills = () => (v.skills || "").split("\n").map(l => l.trim()).filter(Boolean)
    .flatMap(line => (line.includes(":") ? line.split(":")[1] : line).split(",").map(s => s.trim()).filter(Boolean));
  const skillsHtml = style.skills === "chips"
    ? `<div class="rbx-r-skilltags">${flatSkills().map(s => `<span class="rbx-r-skill">${esc2(s)}</span>`).join("")}</div>`
    : (v.skills || "").split("\n").map(l => l.trim()).filter(Boolean).map(line => {
        const [cat, ...rest] = line.split(":"); const items = rest.join(":").trim();
        return items ? `<div class="rbx-r-skillrow"><span class="rbx-r-skillcat">${esc2(cat)}</span><span class="rbx-r-skilltags">${items.split(",").map(s => `<span class="rbx-r-skill">${esc2(s.trim())}</span>`).join("")}</span></div>` : `<span class="rbx-r-skill">${esc2(line)}</span>`;
      }).join("");
  const customHtml = (v.custom_sections || []).map(s => {
    const inner = (s.items || []).map(it => {
      const bl = (it.bullets || []).filter(b => (b || "").trim()).map(b => `<li>${esc2(b)}</li>`).join("");
      const heading = (it.heading || "").trim(); if (!heading && !bl && !it.subheading) return "";
      return `<div class="rbx-r-item"><div class="rbx-r-item-top"><span class="rbx-r-item-title">${esc2(heading)}</span>${it.meta ? `<span class="rbx-r-item-meta">${esc2(it.meta)}</span>` : ""}</div>${it.subheading ? `<div class="rbx-r-item-sub">${esc2(it.subheading)}</div>` : ""}${bl ? `<ul>${bl}</ul>` : ""}</div>`;
    }).join("");
    return (s.title && inner) ? sec(s.title, inner) : "";
  }).join("");

  // header
  const contactHtml = contact.length ? `<div class="rbx-r-contact">${contact.map(c => `<span>${esc2(c)}</span>`).join("")}</div>` : "";
  const header = `<div class="rbx-r-header"><div class="rbx-r-name">${esc2(style.header === "caps" ? name.toUpperCase() : name)}</div>${v.title ? `<div class="rbx-r-role">${esc2(v.title)}</div>` : ""}${contactHtml}</div>`;

  if (style.family === "sidebar") {
    const sideSkills = (v.skills || "").split("\n").map(l => l.trim()).filter(Boolean).map(l => `<div class="rbx-r-side-line">${esc2(l)}</div>`).join("");
    const sideEdu = rbParseBlocks(v.education).map(b => { const p = rbHeadParts(b.head); return `<div class="rbx-r-side-edu"><b>${esc2(p[0] || "")}</b>${p[1] ? `<div>${esc2(p[1])}</div>` : ""}${p[2] ? `<div class="rbx-r-side-muted">${esc2(p[2])}</div>` : ""}</div>`; }).join("");
    const sideCerts = (v.certifications || "").split("\n").map(l => l.trim()).filter(Boolean).map(l => `<div class="rbx-r-side-line">${esc2(l)}</div>`).join("");
    return `<div class="rbx-r-sidebar-wrap">
      <aside class="rbx-r-side">
        <div class="rbx-r-side-name">${esc2(name)}</div>${v.title ? `<div class="rbx-r-side-role">${esc2(v.title)}</div>` : ""}
        ${contact.length ? `<div class="rbx-r-side-h">Contact</div>${contact.map(c => `<div class="rbx-r-side-line">${esc2(c)}</div>`).join("")}` : ""}
        ${sideSkills ? `<div class="rbx-r-side-h">Skills</div>${sideSkills}` : ""}
        ${sideEdu ? `<div class="rbx-r-side-h">Education</div>${sideEdu}` : ""}
        ${sideCerts ? `<div class="rbx-r-side-h">Certifications</div>${sideCerts}` : ""}
      </aside>
      <main class="rbx-r-main">
        ${sec("Profile", summaryHtml, "Your summary appears here.")}
        ${sec("Experience", expHtml, "Add a role to see it here.")}
        ${sec("Projects", projHtml)}
        ${customHtml}
      </main></div>`;
  }
  return `${header}
    ${sec("Profile", summaryHtml, "Your profile summary appears here — try “✨ Write with AI”.")}
    ${sec("Experience", expHtml, "Add a role on the left to see it here.")}
    ${sec("Skills", skillsHtml)}
    ${sec("Education", eduHtml)}
    ${sec("Projects", projHtml)}
    ${customHtml}`;
}

// ===========================================================================
// LIVE PREVIEW — the real PDF, not an imitation of it
// ---------------------------------------------------------------------------
// The preview used to be HTML built to look like each template. It could not be
// made to match: the browser and ReportLab break lines differently, and only 10
// of the 40 templates ever had a hand-written HTML mirror at all — the other 30
// previewed through a generic renderer, so the customer edited one document and
// downloaded a visibly different one.
//
// So the preview now shows the actual file. Every render posts the current form
// values to the same endpoint the Download button uses and draws the PDF that
// comes back. Preview and download are the same bytes, which makes them
// identical by construction rather than by effort — and it keeps being true for
// every template added later, with no mirror to write and none to fall behind.
//
// The editor itself is untouched: the form on the left is still live HTML, and
// this only changes what is drawn on the right.
// Timings, measured rather than guessed: the server draws a résumé in about
// 10ms (40ms for a long multi-page one), so the delay a customer feels is not
// the PDF — it is the debounce, plus parsing and repainting the document in the
// browser. That shapes everything below:
//
//   * a short debounce, because the round trip is cheap
//   * one render at a time, with the previous request aborted rather than left
//     running — a fast typist was queueing renders nobody would ever see
//   * page one painted as soon as it exists, the rest streamed in after, so a
//     three-page résumé doesn't wait for page three to show page one
//   * draft resolution while typing, redrawn sharp once typing stops; a full
//     2x repaint of every page on every keystroke was most of the cost
// 220ms was set against an assumed slow round trip. Measured, the server
// renders a résumé in about 10ms and returns 3-5KB, so the debounce was most of
// the delay between a keystroke and the page changing — it was protecting
// against a cost that isn't there. 110ms still collapses a burst of typing into
// one render without the preview visibly lagging the cursor.
const RB_PREVIEW_DEBOUNCE_MS = 110;
const RB_SHARPEN_AFTER_MS = 400;       // idle gap before the crisp repaint
let _rbPdfSeq = 0;                     // the render generation, to drop stale replies
let _rbPdfTimer = null;
let _rbSharpenTimer = null;
let _rbPdfAbort = null;                // in-flight request, cancelled when superseded
let _rbPdfBusy = false;                // thumbnails stay out of the way while true
let _rbPdfLib = null;                  // the pdf.js module, imported once
let _rbPdfLastKey = "";                // payload signature, to skip identical renders
// The last parsed document, kept alive against the payload it came from.
// Re-rendering the same résumé at a different size — the sharpening pass, or a
// panel resize — then costs one repaint instead of a round trip and a re-parse,
// and parsing is the expensive half: a PDF carries its embedded fonts with it.
let _rbPdfDocCache = { key: "", doc: null };

// pdf.js is vendored under frontend/vendor so the preview works offline and in
// Docker. It's an ES module, pulled in on first use rather than up front so the
// 300KB isn't on the critical path for someone who never opens the builder.
async function rbPdfLib() {
  if (_rbPdfLib) return _rbPdfLib;
  const lib = await import("./vendor/pdfjs/pdf.min.js");
  lib.GlobalWorkerOptions.workerSrc = "./vendor/pdfjs/pdf.worker.min.js";
  _rbPdfLib = lib;
  return lib;
}

function rbPreviewPayload() {
  return { ...EDITOR.values, template_id: RESUME_BUILDER_STATE.templateId,
           resume_name: EDITOR.resumeName };
}

// Called from every field handler, so it debounces rather than rendering per
// keystroke. `now` forces an immediate render for things that aren't typing —
// switching template, changing the size or the accent.
function rbRenderPreview(now = false) {
  if (!document.getElementById("rbx-page")) return;
  // The template cards show the same document, so they go stale on the same
  // edits. They refresh on a longer delay and only where they can be seen.
  rbRefreshThumbnails();
  clearTimeout(_rbPdfTimer);
  clearTimeout(_rbSharpenTimer);
  if (now) {
    // The draft-then-sharpen pass exists to hide network latency while typing.
    // When the document is already in hand there is no latency to hide, so the
    // blurry frame and the repaint 650ms later are both pure waste — draw it
    // crisp the first time.
    const dk = rbRenderKey(rbPreviewPayload());
    rbRenderPdfPreview(_rbBytesCache.has(dk) || _rbPdfDocCache.key === dk);
    return;
  }
  _rbPdfTimer = setTimeout(rbRenderPdfPreview, RB_PREVIEW_DEBOUNCE_MS);
}

// Warm the document behind a template the pointer is resting on. Hovering a
// card is the strongest signal there is that it's about to be clicked, and the
// render costs the server ~10ms — so by the time the click lands the bytes are
// usually already here and the switch costs no network at all. One at a time,
// and never while the customer is waiting on the real preview.
let _rbWarming = 0;
function rbWarmTemplate(tid) {
  if (!tid || _rbPdfBusy || _rbWarming) return;
  if (tid === RESUME_BUILDER_STATE.templateId) return;
  const payload = { ...EDITOR.values, template_id: tid, resume_name: EDITOR.resumeName };
  if (_rbBytesCache.has(rbRenderKey(payload))) return;
  _rbWarming++;
  rbResumePdfBytes(payload).catch(() => {}).then(() => { _rbWarming--; });
}

// Reject a promise that takes too long, naming what stalled. A render that
// fails says so; a render that hangs used to say nothing at all.
function rbDeadline(promise, ms, what) {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Timed out waiting for ${what}.`)), ms);
    }),
  ]);
}

async function rbRenderPdfPreview(sharp = false) {
  const host = document.getElementById("rbx-page");
  if (!host) return;
  const payload = rbPreviewPayload();
  const cssWidth = Math.max(220, host.clientWidth);
  const dataKey = rbRenderKey(payload);
  const key = dataKey + "|" + Math.round(cssWidth / 8) + "|" + (sharp ? "s" : "d");
  if (key === _rbPdfLastKey) return;       // nothing changed that would redraw
  const seq = ++_rbPdfSeq;
  // Cancel the request the previous keystroke started. Without this a fast
  // typist leaves a queue of renders in flight, every one of them obsolete.
  if (_rbPdfAbort) _rbPdfAbort.abort();
  const ctrl = new AbortController();
  _rbPdfAbort = ctrl;
  _rbPdfBusy = true;
  // Dimming the page is honest when there's a wait to explain and a lie when
  // there isn't: a template whose bytes are already here draws in one frame,
  // and flashing the old one grey first only makes an instant switch look slow.
  const warm = _rbBytesCache.has(dataKey) || (_rbPdfDocCache.key === dataKey && _rbPdfDocCache.doc);
  if (!warm) {
    rbThumbAbortInFlight();   // the customer is waiting on this, not on the cards
    host.classList.add("is-rendering");
  }
  let doc = null;
  try {
    // Same content as last time, only drawn at a different size? Reuse it.
    if (_rbPdfDocCache.key === dataKey && _rbPdfDocCache.doc) {
      doc = _rbPdfDocCache.doc;
    } else {
      // Every await below can hang rather than fail — a worker that never
      // starts leaves getDocument() pending forever, and pdf.js reports
      // nothing. Unbounded, that leaves the skeleton on screen permanently
      // with no error and no clue, which is indistinguishable from "still
      // loading". A deadline converts a hang into a visible, reportable
      // failure; the catch below already knows how to show one.
      const [lib, bytes] = await rbDeadline(Promise.all([
        rbPdfLib(),
        rbResumePdfBytes(payload, ctrl.signal),
      ]), 15000, "the preview library or the render request");
      if (seq !== _rbPdfSeq) return;          // a newer render started; drop this one
      doc = await rbDeadline(lib.getDocument({ data: bytes }).promise, 15000,
                             "pdf.js (its worker may have failed to load)");
      if (seq !== _rbPdfSeq) { doc.destroy(); return; }
      if (_rbPdfDocCache.doc && _rbPdfDocCache.doc !== doc) _rbPdfDocCache.doc.destroy();
      _rbPdfDocCache = { key: dataKey, doc };
    }

    // Draft while typing, full resolution once typing stops. A 2x repaint of an
    // A4 page is nearly four million pixels; doing that for every page on every
    // keystroke is what made the panel feel heavy.
    const dpr = sharp ? Math.min(window.devicePixelRatio || 1, 2) : 1;
    const total = doc.numPages;
    for (let n = 1; n <= total; n++) {
      const page = await doc.getPage(n);
      if (seq !== _rbPdfSeq) return;
      const base = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: (cssWidth / base.width) * dpr });
      const canvas = document.createElement("canvas");
      canvas.className = "rbx-pdf-page";
      canvas.width = Math.floor(vp.width);
      canvas.height = Math.floor(vp.height);
      canvas.style.width = cssWidth + "px";
      canvas.style.height = Math.floor(vp.height / dpr) + "px";
      canvas.setAttribute("aria-label", `Page ${n} of ${total}`);
      await page.render({ canvasContext: canvas.getContext("2d"), viewport: vp }).promise;
      if (seq !== _rbPdfSeq) return;
      const parts = [canvas];
      if (total > 1) {
        const tag = document.createElement("div");
        tag.className = "rbx-pdf-pagenum";
        tag.textContent = `Page ${n} of ${total}`;
        parts.push(tag);
      }
      // Page one replaces the old document; the rest are appended as they
      // arrive, so the panel updates as soon as there is something to see
      // instead of waiting for the last page of a long résumé.
      if (n === 1) {
        host.className = "rbx-page rbx-page-pdf";
        host.replaceChildren(...parts);
        host.classList.remove("is-rendering");
      } else {
        host.append(...parts);
      }
    }
    _rbPdfLastKey = key;
    // Typing has stopped and the draft is on screen: redraw it crisp.
    if (!sharp) {
      clearTimeout(_rbSharpenTimer);
      _rbSharpenTimer = setTimeout(() => rbRenderPdfPreview(true), RB_SHARPEN_AFTER_MS);
    }
  } catch (err) {
    if (err && err.name === "AbortError") return;   // superseded, not a failure
    if (seq !== _rbPdfSeq) return;
    // Keep whatever was last rendered and say what happened, rather than
    // replacing the customer's document with an error.
    if (!host.querySelector(".rbx-pdf-page")) {
      host.className = "rbx-page rbx-page-pdf";
      host.innerHTML = `<div class="rbx-pdf-error">Couldn't render the preview.<br>
        <span>${esc(apiErrorMessage(err, "Check the required fields and try again."))}</span></div>`;
    }
  } finally {
    // No destroy here: the document is owned by _rbPdfDocCache and freed when a
    // newer one replaces it.
    //
    // The busy flag is cleared unconditionally. Clearing it only for the
    // current generation left it stuck on whenever a render was superseded —
    // and since the card queue waits on it, the whole template grid sat on
    // skeletons forever.
    _rbPdfBusy = false;
    if (seq === _rbPdfSeq) host.classList.remove("is-rendering");
    if (_rbThumbQueue.length) rbThumbPump();
  }
}

// Every entry row across every template: role on the left, employer and dates on
// the right. Each design names them differently, so they're listed once here.
const RB_ENTRY_ROW_SEL = [".rbx-r-item-top", ".hv-row", ".mm-row", ".ts-row", ".cc-row",
                          ".ee-row", ".bs-row", ".tl-row", ".ig-row", ".cl-row"].join(",");

// Keep one entry layout for the whole document.
//
// A row puts the employer at the right margin when it fits beside the role, and
// on its own line underneath when it doesn't. Both are fine; a résumé that uses
// the first for one entry and the second for the next is not — it reads as a
// bug. So the moment any row in the document has to stack, they all stack.
//
// The measurement has to be taken with the class off, or the answer would just
// be whatever was decided last time: comparing the top of the last child against
// the first tells us whether the browser actually wrapped this row.
function rbSyncEntryRows(page) {
  if (!page || !page.querySelectorAll) return;
  page.classList.remove("rb-stack-meta");
  const rows = page.querySelectorAll(RB_ENTRY_ROW_SEL);
  for (let i = 0; i < rows.length; i++) {
    const kids = rows[i].children;
    if (kids.length < 2) continue;
    if (kids[kids.length - 1].offsetTop > kids[0].offsetTop + 1) {
      page.classList.add("rb-stack-meta");
      return;
    }
  }
}

// Pagination of the preview was attempted here and reverted: the extra sheets
// were inserted as siblings inside a flex row, so both sheets shrank to a
// fraction of their width and the text wrapped one character per line. Doing it
// properly needs a column wrapper around the sheets and a real browser to
// verify the layout in — neither of which was true when it shipped. The sheet
// below therefore grows continuously, with a hairline marking each A4 boundary,
// which is honest about where page two starts without risking the layout.
// One A4 page is 297/210 of the sheet's own width. Measuring it here rather
// than hard-coding a pixel height keeps the page-boundary guides correct when
// the panel is resized or the window changes.
function rbSetPageHeight(page) {
  const w = page.clientWidth;
  if (w) page.style.setProperty("--rb-page-h", (w * 297 / 210).toFixed(1) + "px");
}

// A photo template that previews without the photo is lying about what it will
// print. This puts the real picture (or the initials it falls back to) into the
// preview header for exactly the templates that carry one.
function rbInjectPreviewPhoto(page, templateId) {
  const t = (rbState.templates || []).find(x => x.id === templateId);
  const header = page.querySelector(".rbx-r-header");
  if (!t || !t.photo || !header) return;
  const p = state.profile;
  const url = p && p.avatar_url ? apiUrl(p.avatar_url) : null;
  const name = (EDITOR.values.full_name || (p && p.name) || "").trim();
  const initials = name ? name.split(/\s+/).slice(0, 2).map(w => w[0].toUpperCase()).join("") : "?";
  const photo = document.createElement("div");
  photo.className = "rbx-r-photo" + (url ? " has-photo" : "");
  if (url) photo.style.backgroundImage = `url("${url}")`;
  else photo.textContent = initials;
  header.classList.add("has-photo");
  header.insertBefore(photo, header.firstChild);
}

// ---- completeness ----
function rbCompleteness() {
  const v = EDITOR.values;
  const checks = [
    { key: "details", label: "Add job title", gain: 10, ok: !!(v.title || "").trim(), section: "sec-details" },
    { key: "profile", label: "Add profile summary", gain: 20, ok: (v.summary || "").trim().length > 10, section: "sec-profile" },
    { key: "experience", label: "Add employment history", gain: 30, ok: (v.experience || "").trim().length > 10, section: "sec-experience" },
    { key: "education", label: "Add education", gain: 15, ok: (v.education || "").trim().length > 5, section: "sec-education" },
    { key: "skills", label: "Add skills", gain: 15, ok: (v.skills || "").trim().length > 3, section: "sec-skills" },
    { key: "contact", label: "Add contact details", gain: 10, ok: !!(v.email || "").trim(), section: "sec-details" },
  ];
  const pct = Math.min(100, checks.reduce((s, c) => s + (c.ok ? c.gain : 0), 0));
  return { pct, checks };
}
function rbRenderCompleteness() {
  const { pct, checks } = rbCompleteness();
  const pctEl = document.getElementById("rbx-pct"), bar = document.getElementById("rbx-bar"), chips = document.getElementById("rbx-chips");
  if (!pctEl) return;
  pctEl.textContent = pct + "%";
  pctEl.className = "rbx-complete-pct " + (pct < 40 ? "low" : pct < 75 ? "mid" : "high");
  bar.style.width = pct + "%";
  const missing = checks.filter(c => !c.ok);
  chips.innerHTML = missing.length
    ? missing.map(c => `<div class="rbx-chip" data-open="${c.section}">${c.label} <span class="rbx-gain">+${c.gain}</span></div>`).join("")
    : `<div class="rbx-chip done">All key sections filled ✓</div>`;
  chips.querySelectorAll("[data-open]").forEach(ch => ch.addEventListener("click", () => rbOpenSection(ch.dataset.open)));
  rbSyncHeaderStatus(pct);
}

// ---- header document bar ---------------------------------------------------
// The right of the header answers "what state is this document in": which
// template it's set in, and how complete it is. Both are read-only summaries of
// state that already exists in the panes — the chips are shortcuts to the tab
// that can change them, not new controls.
function rbSyncHeaderStatus(pct) {
  const host = document.getElementById("rbx-hdr-status");
  if (!host) return;
  const t = (rbState.templates || []).find(x => x.id === RESUME_BUILDER_STATE.templateId);
  const nameEl = document.getElementById("rbx-status-tmpl-name");
  const swatch = document.getElementById("rbx-status-swatch");
  if (nameEl) nameEl.textContent = t ? t.name : "Pick a template";
  if (swatch) swatch.style.background = (t && t.accent) || rbState.accent;
  if (typeof pct !== "number") return;
  const text = document.getElementById("rbx-status-pct-text");
  const ring = document.getElementById("rbx-status-ring");
  if (text) text.textContent = pct + "%";
  if (ring) {
    // conic-gradient reads the fraction off a custom property, so the ring can
    // animate with the number instead of being redrawn.
    ring.style.setProperty("--pct", pct);
    ring.dataset.level = pct < 40 ? "low" : pct < 75 ? "mid" : "high";
  }
}

// A tab the customer hasn't opened yet gets one small accent dot. Two "NEW"
// chips shouted louder than the tab labels, and neither ever went away.
function rbTabDot(tab) {
  return rbTabSeen(tab) ? "" : ` <i class="rbx-tabdot" aria-label="New"></i>`;
}
function rbTabSeen(tab) {
  try { return (localStorage.getItem("momentum_rb_seen_tabs") || "").split(",").includes(tab); }
  catch { return false; }
}
function rbMarkTabSeen(tab) {
  try {
    const seen = new Set((localStorage.getItem("momentum_rb_seen_tabs") || "").split(",").filter(Boolean));
    if (seen.has(tab)) return;
    seen.add(tab);
    localStorage.setItem("momentum_rb_seen_tabs", [...seen].join(","));
  } catch { /* private mode: the dot just stays */ }
}

// ---- tabs / sections ----
function rbSwitchTab(name) {
  rbState.tab = name;
  rbMarkTabSeen(name);
  document.querySelectorAll("#rbx-tabbar button").forEach(b => {
    b.classList.toggle("active", b.dataset.rtab === name);
    if (b.dataset.rtab === name) b.querySelector(".rbx-tabdot")?.remove();
  });
  ["edit", "design", "roles", "review", "tailor"].forEach(t => {
    const p = document.getElementById("rbx-pane-" + t);
    if (p) p.style.display = t === name ? "block" : "none";
  });
  // The role picker's data is only worth fetching once the tab is opened.
  if (name === "roles") rbLoadRoles();
}

// ---- "Best for role": job -> recommended templates -------------------------
// The mapping lives in the backend (app/job_templates.py) so a recommendation
// can be corrected without shipping a new frontend. Everything here is
// presentation: fetch once, filter client-side, and reuse the same template
// cards (and the same click-to-apply behaviour) as the Design grid.
async function rbLoadRoles() {
  const body = document.getElementById("rbx-roles-body");
  if (!body || rbState.roles) { rbRenderRoles(); return; }
  body.innerHTML = `<div class="rbx-roles-loading">Loading recommendations…</div>`;
  try {
    const res = await get(`/api/resume-builder/role-templates`);
    rbState.roles = (res && res.fields) || [];
  } catch {
    rbState.roles = [];
  }
  rbRenderRoles();
}

function rbRoleMatches(role, field, q) {
  if (!q) return true;
  return (role.label + " " + field.label).toLowerCase().includes(q);
}

function rbFindRole(roleId) {
  for (const f of rbState.roles || []) {
    const r = (f.roles || []).find(x => x.id === roleId);
    if (r) return { field: f, role: r };
  }
  return null;
}

function rbRenderRoles() {
  const body = document.getElementById("rbx-roles-body");
  if (!body) return;
  const fields = rbState.roles || [];
  if (!fields.length) {
    body.innerHTML = `<div class="rbx-roles-loading">Recommendations aren't available right now —
      you can still pick any template from the Design tab.</div>`;
    return;
  }
  const q = (rbState.roleQuery || "").trim().toLowerCase();
  const groups = fields
    .map(f => ({ field: f, roles: (f.roles || []).filter(r => rbRoleMatches(r, f, q)) }))
    .filter(g => g.roles.length);

  const list = groups.length ? groups.map(g => `
    <div class="rbx-role-group">
      <div class="rbx-role-group-label">${esc(g.field.label)}</div>
      <div class="rbx-role-chips">
        ${g.roles.map(r => `<button class="rbx-role-chip ${r.id === rbState.roleId ? "active" : ""}"
          data-role="${esc(r.id)}">${esc(r.label)}</button>`).join("")}
      </div>
    </div>`).join("") : `<div class="rbx-roles-loading">No role matches “${esc(rbState.roleQuery)}”.</div>`;

  body.innerHTML = list + `<div class="rbx-role-picks" id="rbx-role-picks"></div>`;
  body.querySelectorAll("[data-role]").forEach(b => b.addEventListener("click", () => {
    rbState.roleId = b.dataset.role;
    rbRenderRoles();
  }));
  rbRenderRolePicks();
}

function rbRenderRolePicks() {
  const host = document.getElementById("rbx-role-picks");
  if (!host) return;
  const found = rbState.roleId ? rbFindRole(rbState.roleId) : null;
  if (!found) {
    host.innerHTML = "";
    return;
  }
  const templates = rbState.templates || [];
  const cards = found.role.picks.map((p, i) => {
    const t = templates.find(x => x.id === p.template_id);
    if (!t) return "";
    return `
      <div class="rbx-role-pick">
        <div class="rbx-role-pick-rank">${i === 0 ? "Best match" : "#" + (i + 1)}</div>
        ${rbTemplateCard(t)}
        <p class="rbx-role-why">${esc(p.why)}</p>
      </div>`;
  }).join("");
  host.innerHTML = `
    <div class="rbx-role-picks-head">
      <h4>${esc(found.role.label)}</h4>
      <span>${found.role.picks.length} templates that fit — click one to apply it</span>
    </div>
    <div class="rbx-role-pick-grid">${cards}</div>`;
  rbBindTemplateCells(host, templates);
  rbWatchThumbnails();
}
function rbToggleSection(id) {
  const el = document.getElementById(id);
  const willOpen = !el.classList.contains("open");
  document.querySelectorAll(".rbx-section").forEach(s => s.classList.remove("open"));
  if (willOpen) { el.classList.add("open"); rbState.open = id; } else rbState.open = null;
}
function rbOpenSection(id) {
  rbSwitchTab("edit");
  document.querySelectorAll(".rbx-section").forEach(s => s.classList.remove("open"));
  const el = document.getElementById(id);
  if (el) { el.classList.add("open"); rbState.open = id; el.scrollIntoView({ behavior: "smooth", block: "start" }); }
}

// ============================================================================
// RESUME REVIEW
// ----------------------------------------------------------------------------
// Renders the report returned by POST /api/review/analyze. All analysis and
// every number shown here comes from the server (app/resume_review.py) — this
// file decides presentation only. Nothing below invents a score, and nothing
// below is reachable without a successful response, so the panel can never
// show a number that isn't backed by an actual analysis.
//
// The previous version of this tab scored the *form's completeness* and
// dressed it up with a fake 700ms "Scanning…" delay. It never read the resume
// and never called the backend. Everything here replaces that.
// ============================================================================

const RB_SEV = {
  critical: { label: "Critical", cls: "sev-critical" },
  high:     { label: "High",     cls: "sev-high" },
  medium:   { label: "Medium",   cls: "sev-med" },
  optional: { label: "Optional", cls: "sev-low" },
};

function rbScoreTone(n) {
  return n >= 70 ? "good" : n >= 50 ? "warn" : "bad";
}
function rbScoreColor(n) {
  return n >= 70 ? "var(--rb-green)" : n >= 50 ? "var(--rb-amber)" : "var(--rb-red)";
}

async function rbRunReview() {
  const btn = document.getElementById("rbx-rescan");
  const body = document.getElementById("rbx-review-body");
  const label = btn.querySelector("span");
  if (btn.disabled) return;

  const jd = (document.getElementById("rbx-review-jd")?.value || "").trim();

  btn.disabled = true;
  label.textContent = "Analysing…";
  body.innerHTML = `<div class="rbx-rev-loading">
      <div class="rbx-rev-spinner" aria-hidden="true"></div>
      <div>Reading your resume — checking ATS parsing, structure, wording and every bullet…</div>
    </div>`;

  try {
    // The draft is sent as-is rather than by id, so the review works on
    // unsaved edits. The server never persists it.
    const report = await post(`/api/review/analyze`, {
      builder_data: EDITOR.values,
      job_description: jd || null,
    });
    rbState.review = report;
    rbRenderReview(report);
    rbState.reviewRun = true;
    label.textContent = "Re-run review";
    showToast(`Review complete — ${report.overall_score}/100`, "success");
  } catch (err) {
    const msg = apiErrorMessage(err, "Couldn't complete the review — please try again.");
    body.innerHTML = `<div class="rbx-rev-error">
        <div class="rbx-rev-error-t">Review couldn't run</div>
        <div class="rbx-rev-error-d">${esc(msg)}</div>
      </div>`;
    rbSetRing(null);
    label.textContent = "Try again";
  } finally {
    btn.disabled = false;
  }
}

function rbSetRing(score) {
  const ring = document.getElementById("rbx-ring");
  const num = document.getElementById("rbx-score");
  const word = document.getElementById("rbx-score-word");
  if (!ring) return;
  const C = 389.6;
  if (score == null) {
    ring.style.strokeDashoffset = C;
    num.textContent = "—";
    word.textContent = "Not run";
    return;
  }
  ring.style.strokeDashoffset = C - (C * score / 100);
  ring.style.stroke = rbScoreColor(score);
  num.textContent = score;
  word.textContent = "out of 100";
}

function rbRenderReview(r) {
  rbSetRing(r.overall_score);
  const h = document.getElementById("rbx-review-h");
  const p = document.getElementById("rbx-review-p");
  if (h) h.textContent = {
    excellent: "Excellent — this is a strong resume",
    strong: "Strong, with a few things worth fixing",
    "needs work": "Needs work before you send it",
    weak: "Significant issues to address",
  }[r.band] || "Review complete";
  if (p) p.textContent = r.mode === "targeted"
    ? "Scored against your resume and the job description you pasted."
    : "General resume-quality review. Paste a job description above to also score keyword and skills match.";

  document.getElementById("rbx-review-body").innerHTML = [
    rbRevSummaryCards(r),
    rbRevOverview(r),
    rbRevBreakdown(r),
    rbRevStrengths(r),
    rbRevFindings(r),
    rbRevJobMatch(r),
    rbRevSkills(r),
    rbRevBullets(r),
    rbRevAtsChecks(r),
    rbRevStructure(r),
    rbRevCaveats(r),
  ].filter(Boolean).join("");

  rbWireReview();
}

// ---- summary cards ----
function rbRevSummaryCards(r) {
  const cards = [
    { label: "Overall", value: r.overall_score, suffix: "/100" },
    { label: "ATS compatibility", value: r.ats.score, suffix: "/100" },
  ];
  if (r.job_match) cards.push({ label: "Job match", value: r.job_match.score, suffix: "/100" });
  const issues = r.counts.critical + r.counts.high;
  cards.push({
    label: issues ? "Priority issues" : "Priority issues",
    value: issues, suffix: "", tone: issues === 0 ? "good" : issues <= 2 ? "warn" : "bad", raw: true,
  });

  return `<div class="rbx-rev-cards">${cards.map(c => `
    <div class="rbx-rev-card">
      <div class="rbx-rev-card-v tone-${c.tone || rbScoreTone(c.value)}">${c.value}<span>${c.suffix}</span></div>
      <div class="rbx-rev-card-l">${esc(c.label)}</div>
    </div>`).join("")}</div>`;
}

// ---- what the analyser actually read ----
// Shown before the scores on purpose: if it reports 2 positions on a resume
// with 4, the parse went wrong and every number below it is suspect. That's
// worth finding out in one glance rather than after acting on the advice.
function rbRevOverview(r) {
  const o = r.overview || {};
  const stats = [
    ["Words", o.words], ["Pages", o.pages], ["Sections", o.sections],
    ["Skills listed", o.skills_found], ["Positions", o.positions],
    ["Education", o.education], ["Bullets", o.bullets],
  ].filter(([, v]) => v != null);
  return rbRevSection("What the review read", `
    <div class="rbx-rev-stats">
      ${stats.map(([l, v]) => `<div><strong>${v}</strong><span>${esc(l)}</span></div>`).join("")}
    </div>
    <p class="rbx-rev-note">If any of these look wrong, the resume didn't parse the way you'd expect — fix that before acting on the findings below.</p>`);
}

// ---- transparent score breakdown ----
// The brief's rule is that a score must be explainable. This section is that
// explanation: every category, the weight it carries, the points it
// contributed, and the arithmetic that sums to the headline number.
function rbRevBreakdown(r) {
  const rows = r.categories.map(c => `
    <div class="rbx-rev-bar-row">
      <div class="rbx-rev-bar-head">
        <span class="rbx-rev-bar-label">${esc(c.label)}</span>
        <span class="rbx-rev-bar-meta">
          <span class="rbx-rev-weight">${c.weight}% weight</span>
          <strong class="tone-${rbScoreTone(c.score)}">${c.score}</strong>
        </span>
      </div>
      <div class="rbx-rev-bar"><div class="rbx-rev-bar-fill tone-${rbScoreTone(c.score)}" style="width:${c.score}%"></div></div>
      <div class="rbx-rev-bar-sub">contributes ${c.contribution} of ${c.weight} points</div>
    </div>`).join("");

  return rbRevSection("How this score was calculated", `
    ${rows}
    <div class="rbx-rev-formula">
      Each category is scored 0-100, multiplied by its weight, and summed.
      ${r.mode === "targeted"
        ? "Because you provided a job description, job-description alignment carries 25% and the other weights are reduced to match."
        : "Without a job description there is nothing to align against, so that weight is redistributed across the other categories rather than counted as zero."}
      Total: <strong>${r.overall_score}/100</strong>.
    </div>`, "open");
}

function rbRevStrengths(r) {
  if (!r.strengths.length) return "";
  return rbRevSection(`What's working (${r.strengths.length})`, `
    <ul class="rbx-rev-strengths">
      ${r.strengths.map(s => `<li>${esc(s)}</li>`).join("")}
    </ul>`);
}

// ---- prioritised recommendations ----
function rbRevFindings(r) {
  if (!r.findings.length) {
    return rbRevSection("Recommendations", `
      <div class="rbx-rev-empty">No issues found. Every check passed.</div>`, "open");
  }
  const items = r.findings.map((f, i) => {
    const sev = RB_SEV[f.severity] || RB_SEV.medium;
    return `
      <div class="rbx-rev-find ${sev.cls}">
        <button class="rbx-rev-find-head" data-rev-toggle="find-${i}" aria-expanded="false">
          <span class="rbx-sev-tag">${sev.label}</span>
          <span class="rbx-rev-find-title">${esc(f.title)}</span>
          <span class="rbx-rev-chev" aria-hidden="true">▾</span>
        </button>
        <div class="rbx-rev-find-body" id="find-${i}" hidden>
          <div class="rbx-rev-kv"><span>Why it matters</span><p>${esc(f.why)}</p></div>
          <div class="rbx-rev-kv"><span>How to fix it</span><p>${esc(f.fix)}</p></div>
          ${f.items && f.items.length ? `<div class="rbx-rev-kv"><span>Affected</span>
            <ul class="rbx-rev-items">${f.items.map(t => `<li>${esc(t)}</li>`).join("")}</ul></div>` : ""}
          ${f.example ? `<div class="rbx-rev-kv"><span>Example</span>
            <pre class="rbx-rev-example">${esc(f.example)}</pre></div>` : ""}
          ${f.section ? `<div class="rbx-review-actions"><button class="rbx-fix" data-fix="${esc(f.section)}">Fix this</button></div>` : ""}
        </div>
      </div>`;
  }).join("");

  const counts = ["critical", "high", "medium", "optional"]
    .filter(k => r.counts[k])
    .map(k => `<span class="rbx-rev-count ${RB_SEV[k].cls}">${r.counts[k]} ${RB_SEV[k].label.toLowerCase()}</span>`)
    .join("");

  return rbRevSection(`Recommendations (${r.findings.length})`,
    `<div class="rbx-rev-counts">${counts}</div>${items}`, "open");
}

// ---- job match ----
function rbRevJobMatch(r) {
  const jm = r.job_match;
  if (!jm) return "";
  const freq = jm.term_frequency || {};
  // Ordered by how often the posting names the term. A requirement repeated
  // five times and one mentioned once are not equally urgent, and sorting by
  // that is what turns a keyword list into a priority order.
  const chips = (list, cls) => list.length
    ? `<div class="rbx-rev-chips">${[...list]
        .sort((a, b) => (freq[b] || 0) - (freq[a] || 0))
        .map(k => `<span class="rbx-kwtag ${cls}">${esc(k)}${
          freq[k] > 1 ? `<i class="rbx-kwn">${freq[k]}</i>` : ""}</span>`).join("")}</div>`
    : `<div class="rbx-rev-empty">None</div>`;

  return rbRevSection(`Job match — ${jm.score}/100`, `
    <div class="rbx-rev-metrics">
      <div><strong>${jm.keyword_coverage_percent ?? 0}%</strong><span>keyword coverage</span></div>
      <div><strong>${jm.term_similarity_percent ?? 0}%</strong><span>overall term similarity</span></div>
      <div><strong>${jm.title_seniority_match === null ? "n/a" : jm.title_seniority_match ? "Yes" : "No"}</strong><span>seniority aligned</span></div>
    </div>
    <div class="rbx-rev-sub">Matched keywords (${jm.matched_keywords.length})</div>
    ${chips(jm.matched_keywords, "match")}
    <div class="rbx-rev-sub">Missing from your resume (${jm.missing_keywords.length})</div>
    ${chips(jm.missing_keywords, "miss")}
    <p class="rbx-rev-note">Only add terms that are genuinely true of your experience. A keyword you can't discuss in an interview costs more than it gains.</p>`);
}

// ---- skills ----
function rbRevSkills(r) {
  const s = r.skills;
  const chips = (list, cls) => list.length
    ? `<div class="rbx-rev-chips">${list.map(k => `<span class="rbx-kwtag ${cls}">${esc(k)}</span>`).join("")}</div>`
    : `<div class="rbx-rev-empty">None detected</div>`;
  // `listed` is what the user wrote; `hard_skills` is the subset a fixed
  // lexicon recognises. Showing the former means a real skill never
  // disappears from the report just because it isn't in the alias table.
  const unev = new Set(s.unevidenced || []);
  const listed = s.listed && s.listed.length ? s.listed : s.hard_skills;
  return rbRevSection(`Skills — ${s.score}/100`, `
    <div class="rbx-rev-sub">Skills on your resume (${listed.length})</div>
    <div class="rbx-rev-chips">${listed.map(k =>
      `<span class="rbx-kwtag ${unev.has(k) ? "warn" : "match"}"${unev.has(k)
        ? ` title="Listed but not shown in any experience bullet"` : ""}>${esc(k)}</span>`).join("")
      || `<span class="rbx-rev-empty">None detected</span>`}</div>
    ${unev.size ? `<p class="rbx-rev-note"><span class="rbx-kwtag warn">amber</span> = listed here but never demonstrated in an experience bullet. ${unev.size} of ${listed.length}.</p>` : ""}
    ${s.soft_skills.length ? `<div class="rbx-rev-sub">Soft skills mentioned (${s.soft_skills.length})</div>${chips(s.soft_skills, "")}` : ""}
    ${s.missing_for_role.length ? `<div class="rbx-rev-sub">Named in the job description, missing here (${s.missing_for_role.length})</div>${chips(s.missing_for_role, "miss")}` : ""}`);
}

// ---- bullet-by-bullet ----
function rbRevBullets(r) {
  const e = r.experience;
  if (!e.total) {
    return rbRevSection("Experience bullets", `
      <div class="rbx-rev-empty">No experience bullets found to analyse.</div>`);
  }
  const pct = n => Math.round(n / e.total * 100);
  const list = e.bullets.map(b => `
    <div class="rbx-rev-bullet ${b.weak ? "is-weak" : ""}">
      <div class="rbx-rev-bullet-top">
        <span class="rbx-rev-bullet-tags">
          ${b.quantified ? `<span class="rbx-rev-mini good">Quantified</span>` : `<span class="rbx-rev-mini bad">No metric</span>`}
          ${b.action_led ? `<span class="rbx-rev-mini good">Action verb</span>` : `<span class="rbx-rev-mini bad">Weak opener</span>`}
        </span>
        ${b.context ? `<span class="rbx-rev-bullet-ctx">${esc(b.context)}</span>` : ""}
      </div>
      <div class="rbx-rev-bullet-text">${esc(b.text)}</div>
      <ul class="rbx-rev-bullet-issues">
        ${b.issues.map(i => `<li>${esc(i.detail)}</li>`).join("")}
      </ul>
      ${b.suggestion ? `<div class="rbx-rev-suggest">
          <span>Stronger framing</span>
          <p>${esc(b.suggestion)}</p>
          <em>Your facts, restated to lead with ownership. Add a number to finish it.</em>
        </div>` : ""}
    </div>`).join("");

  return rbRevSection(`Bullet points — ${e.weak} of ${e.total} need work`, `
    <div class="rbx-rev-metrics">
      <div><strong class="tone-${pct(e.quantified) >= 40 ? "good" : "bad"}">${pct(e.quantified)}%</strong><span>quantified (target 40%+)</span></div>
      <div><strong class="tone-${pct(e.action_led) >= 70 ? "good" : "bad"}">${pct(e.action_led)}%</strong><span>action-verb led (target 70%+)</span></div>
      <div><strong>${e.total}</strong><span>bullets in total</span></div>
    </div>
    ${list || `<div class="rbx-rev-empty">Every bullet passed all checks.</div>`}`);
}

// ---- ATS checks ----
function rbRevAtsChecks(r) {
  const checks = r.ats.checks || [];
  if (!checks.length) return "";
  const icon = { pass: "✓", fail: "✕", skip: "–" };
  return rbRevSection(`ATS compatibility — ${r.ats.score}/100`, `
    <ul class="rbx-rev-checks">
      ${checks.map(c => `<li class="chk-${c.status}">
        <span class="rbx-rev-chk-i" aria-hidden="true">${icon[c.status] || "–"}</span>
        <span>${esc(c.label)}</span>
        ${c.impact ? `<span class="rbx-rev-chk-imp">-${c.impact}</span>` : ""}
      </li>`).join("")}
    </ul>`);
}

// ---- structure ----
function rbRevStructure(r) {
  const s = r.structure;
  return rbRevSection(`Sections — ${s.score}/100`, `
    <div class="rbx-rev-sub">Present (${s.present.length})</div>
    <div class="rbx-rev-chips">${s.present.map(x => `<span class="rbx-kwtag match">${esc(x)}</span>`).join("") || `<span class="rbx-rev-empty">None</span>`}</div>
    ${s.missing.length ? `<div class="rbx-rev-sub">Missing (${s.missing.length})</div>
      <div class="rbx-rev-chips">${s.missing.map(x => `<span class="rbx-kwtag miss">${esc(x)}</span>`).join("")}</div>` : ""}`);
}

// ---- caveats ----
// Deliberately always rendered when present, and never collapsed away to
// nothing: a score is an estimate, and the limits of the estimate belong next
// to it rather than in a footnote nobody opens.
function rbRevCaveats(r) {
  if (!r.caveats || !r.caveats.length) return "";
  return `<div class="rbx-rev-caveats">
    <div class="rbx-rev-caveats-t">What this review can't tell you</div>
    <ul>${r.caveats.map(c => `<li>${esc(c)}</li>`).join("")}</ul>
  </div>`;
}

// ---- shell ----
function rbRevSection(title, inner, state = "") {
  const id = "rev-" + title.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const open = state === "open";
  return `<section class="rbx-rev-sec ${open ? "open" : ""}">
    <button class="rbx-rev-sec-head" data-rev-toggle="${id}" aria-expanded="${open}">
      <span>${esc(title)}</span><span class="rbx-rev-chev" aria-hidden="true">▾</span>
    </button>
    <div class="rbx-rev-sec-body" id="${id}" ${open ? "" : "hidden"}>${inner}</div>
  </section>`;
}

function rbWireReview() {
  const root = document.getElementById("rbx-review-body");
  // Guarded per-element rather than assumed-once. Two handlers on one toggle
  // cancel each other out — the panel opens and immediately re-closes within
  // the same click — which reads as "the button does nothing" and is
  // miserable to trace back to a duplicate listener.
  root.querySelectorAll("[data-rev-toggle]").forEach(btn => {
    if (btn.dataset.wired) return;
    btn.dataset.wired = "1";
    btn.addEventListener("click", () => {
      const panel = document.getElementById(btn.dataset.revToggle);
      if (!panel) return;
      const nowOpen = panel.hasAttribute("hidden");
      panel.toggleAttribute("hidden", !nowOpen);
      btn.setAttribute("aria-expanded", String(nowOpen));
      btn.closest(".rbx-rev-sec, .rbx-rev-find")?.classList.toggle("open", nowOpen);
    });
  });
  // "Fix this" jumps to the Edit tab with the relevant section already open.
  root.querySelectorAll("[data-fix]").forEach(b => {
    if (b.dataset.wired) return;
    b.dataset.wired = "1";
    b.addEventListener("click", () => rbOpenSection(b.dataset.fix));
  });
}

// ---- tailor ----
function rbRunTailor() {
  const jd = (document.getElementById("rbx-jd").value || "").toLowerCase();
  if (jd.trim().length < 20) { showToast("Paste a fuller job description first", "warning"); return; }
  const resumeText = [EDITOR.values.skills, EDITOR.values.summary, EDITOR.values.experience, EDITOR.values.projects].join(" ").toLowerCase();
  // crude keyword extraction: notable words in the JD, 4+ chars, not stopwords
  const stop = new Set("with your team role work will have that this from they them what when have been which about into your you our are for and the a an to of in on as at or be is".split(" "));
  const freq = {};
  (jd.match(/[a-z][a-z+.#/]{3,}/g) || []).forEach(w => { if (!stop.has(w)) freq[w] = (freq[w] || 0) + 1; });
  const top = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 12).map(e => e[0]);
  const kwEl = document.getElementById("rbx-kw");
  kwEl.style.display = "flex";
  kwEl.innerHTML = top.map(k => {
    const hit = resumeText.includes(k);
    return `<span class="rbx-kwtag ${hit ? "match" : "miss"}">${esc(k)} ${hit ? "✓" : "✗"}</span>`;
  }).join("");
  const matched = top.filter(k => resumeText.includes(k)).length;
  showToast(`Matched ${matched}/${top.length} key terms`, matched >= top.length / 2 ? "success" : "warning");
  document.getElementById("rbx-tailor-go").style.display = state.builderResumeId ? "block" : "none";
}

// ---- AI popover (real /ai-assist) ----
async function rbOpenAiPop(btn, kind, entryRef) {
  const pop = document.getElementById("rbx-aipop");
  rbState.ai = { kind, idx: 0, anchor: btn, entryRef: entryRef || null, options: [] };
  const container = btn.closest(".rbx-entry") || btn.closest(".rbx-field") || btn.parentElement;
  container.style.position = "relative";
  container.appendChild(pop);
  const inline = btn.classList.contains("rbx-write");
  pop.style.top = inline ? "auto" : "26px";
  pop.style.bottom = inline ? "44px" : "auto";
  pop.style.right = "0";
  pop.classList.add("show");
  await rbFetchAi();
}
async function rbFetchAi() {
  const txtEl = document.getElementById("rbx-aipop-text");
  txtEl.textContent = "Thinking…";
  const v = EDITOR.values;
  const ai = rbState.ai;
  let title = v.title || "", company = "", existing = "";
  if (ai.kind === "bullets" && ai.entryRef) {
    const [field, i] = ai.entryRef.split(":");
    const e = (rbState.entries[field] || [])[+i] || {};
    title = e.title || v.title || ""; company = e.company || "";
    existing = (e.bullets || []).join("\n");
  } else {
    existing = ai.kind === "summary" ? v.summary : ai.kind === "skills" ? v.skills : (v.summary || v.skills || "");
  }
  try {
    const res = await post(`/api/resume-builder/ai-assist`, { kind: ai.kind, title, company, existing, skills: v.skills || "" });
    txtEl.textContent = res.text || "No suggestion available.";
    rbState.ai.last = res.text || "";
  } catch (err) {
    txtEl.textContent = "Couldn't generate right now — try again.";
  }
}
function rbInsertAi() {
  const text = rbState.ai.last || document.getElementById("rbx-aipop-text").textContent;
  const kind = rbState.ai.kind;
  document.getElementById("rbx-aipop").classList.remove("show");
  if (kind === "bullets" && rbState.ai.entryRef) {
    const [field, i] = rbState.ai.entryRef.split(":");
    const e = (rbState.entries[field] || [])[+i];
    if (e) {
      const newB = text.split("\n").map(l => l.replace(/^[-•]\s*/, "").trim()).filter(Boolean);
      e.bullets = (e.bullets || []).filter(b => (b || "").trim()).concat(newB);
      rbCommitEntries(field);
      rbRenderSections();
    }
  } else {
    const map = { summary: "summary", skills: "skills", role: "title" };
    const f = map[kind];
    if (f) {
      EDITOR.values[f] = text;
      const input = document.querySelector(`[data-f="${f}"]`);
      if (input) input.value = text;
    }
  }
  rbRenderPreview(); rbRenderCompleteness();
  showToast("Inserted AI suggestion", "success");
}

// ---- editor mutations (sub-boxes + custom sections) ----
function rbRenderSections() {
  const el = document.querySelector(".rbx-sections");
  if (el) el.innerHTML = RB_SECTIONS.map(s => rbSectionHtml(s)).join("");
}
function rbSetAccent(hex, root) {
  rbState.accent = hex;
  EDITOR.values.accent_color = hex;
  (root || document.querySelector(".rbx"))?.style.setProperty("--rb-accent", hex);
  rbRenderPreview();
}
function rbSyncName(root) {
  const first = ((root.querySelector('[data-name="first"]') || {}).value || "").trim();
  const last = ((root.querySelector('[data-name="last"]') || {}).value || "").trim();
  rbSet("full_name", (first + " " + last).trim());
  rbRenderPreview(); rbRenderCompleteness();
}
function rbApplyEntryEdit(ref, value) {
  const [field, i, prop] = ref.split(":");
  const e = (rbState.entries[field] || [])[+i]; if (!e) return;
  e[prop] = value; rbCommitEntries(field); rbRenderPreview(); rbRenderCompleteness();
}
function rbApplyBulletEdit(ref, value) {
  const p = ref.split(":");
  if (p[0] === "csec") {
    const it = ((EDITOR.values.custom_sections[+p[1]] || {}).items || [])[+p[2]];
    if (it) { it.bullets[+p[3]] = value; rbRenderPreview(); }
  } else {
    const e = (rbState.entries[p[0]] || [])[+p[1]]; if (!e) return;
    e.bullets[+p[2]] = value; rbCommitEntries(p[0]); rbRenderPreview(); rbRenderCompleteness();
  }
}
function rbApplyCustomItemEdit(ref, value) {
  const [si, ii, prop] = ref.split(":");
  const it = ((EDITOR.values.custom_sections[+si] || {}).items || [])[+ii];
  if (it) { it[prop] = value; rbRenderPreview(); }
}
function rbAddEntry(field) {
  const blank = field === "experience" ? { title: "", company: "", location: "", dates: "", bullets: [""] }
    : field === "education" ? { degree: "", institution: "", dates: "", bullets: [] }
      : { name: "", bullets: [] };
  rbGetEntries(field).push(blank); rbCommitEntries(field); rbRenderSections(); rbRenderPreview(); rbRenderCompleteness();
}
function rbDelEntry(ref) {
  const [field, i] = ref.split(":");
  (rbState.entries[field] || []).splice(+i, 1); rbCommitEntries(field); rbRenderSections(); rbRenderPreview(); rbRenderCompleteness();
}
function rbAddBullet(ref) {
  const p = ref.split(":");
  if (p[0] === "csec") { const it = EDITOR.values.custom_sections[+p[1]].items[+p[2]]; (it.bullets = it.bullets || []).push(""); }
  else { const e = rbState.entries[p[0]][+p[1]]; (e.bullets = e.bullets || []).push(""); rbCommitEntries(p[0]); }
  rbRenderSections();
}
function rbDelBullet(ref) {
  const p = ref.split(":");
  if (p[0] === "csec") { EDITOR.values.custom_sections[+p[1]].items[+p[2]].bullets.splice(+p[3], 1); }
  else { rbState.entries[p[0]][+p[1]].bullets.splice(+p[2], 1); rbCommitEntries(p[0]); }
  rbRenderSections(); rbRenderPreview(); rbRenderCompleteness();
}
function rbAddCustomSec() {
  EDITOR.values.custom_sections = EDITOR.values.custom_sections || [];
  EDITOR.values.custom_sections.push({ title: "", items: [{ heading: "", meta: "", subheading: "", bullets: [""] }] });
  rbState.open = "sec-custom"; rbRenderSections();
}
function rbDelCustomSec(si) { EDITOR.values.custom_sections.splice(+si, 1); rbRenderSections(); rbRenderPreview(); }
function rbAddCustomItem(si) {
  EDITOR.values.custom_sections[+si].items.push({ heading: "", meta: "", subheading: "", bullets: [""] });
  rbRenderSections();
}
function rbDelCustomItem(ref) {
  const [si, ii] = ref.split(":");
  EDITOR.values.custom_sections[+si].items.splice(+ii, 1); rbRenderSections(); rbRenderPreview();
}

// Content-fitting width for the doc-title input, so the rename pencil hugs
// the visible text instead of sitting 180px away for a short name.
let _rbTitleMeasureCtx = null;
function rbTitleInputWidth(name) {
  const text = name || "Untitled Resume";
  try {
    if (!_rbTitleMeasureCtx) _rbTitleMeasureCtx = document.createElement("canvas").getContext("2d");
    _rbTitleMeasureCtx.font = `800 14px ${getComputedStyle(document.documentElement)
      .getPropertyValue("--font-display").trim() || "'Plus Jakarta Sans', sans-serif"}`;
    const w = _rbTitleMeasureCtx.measureText(text).width;
    return Math.min(260, Math.max(90, Math.ceil(w) + 16));
  } catch {
    return Math.min(260, Math.max(90, text.length * 8.6 + 16));
  }
}

// Selecting a template has to work from two places now — the Design grid and
// the role picker's recommendations — so the behaviour lives here and both
// callers bind their own cells. The tick and the "selected" outline are cleared
// across the whole panel, not just the clicked scope, so the two lists can't
// end up both showing a chosen template.
function rbBindTemplateCells(scope, templates) {
  const root = document.querySelector(".rbx");
  if (!scope || !root) return;
  scope.querySelectorAll("[data-tmpl]").forEach(c => {
    // Hovering a card is the clearest signal it's about to be clicked, so the
    // document behind it starts rendering now rather than after the click.
    let warmTimer = null;
    c.addEventListener("mouseenter", () => {
      clearTimeout(warmTimer);
      warmTimer = setTimeout(() => rbWarmTemplate(c.dataset.tmpl), 130);
    });
    c.addEventListener("mouseleave", () => clearTimeout(warmTimer));
    c.addEventListener("click", () => {
      RESUME_BUILDER_STATE.templateId = c.dataset.tmpl;
      root.querySelectorAll(".rbx-tmpl-cell").forEach(x => {
        x.classList.remove("selected");
        const ck = x.querySelector(".rbx-tmpl-check"); if (ck) ck.remove();
      });
      // The same template can appear in both lists; tick every copy of it.
      root.querySelectorAll(`[data-tmpl="${CSS.escape(c.dataset.tmpl)}"]`).forEach(x => {
        x.classList.add("selected");
        const nm = x.querySelector(".rbx-tmpl-name");
        if (nm && !nm.querySelector(".rbx-tmpl-check")) nm.insertAdjacentHTML("beforeend", ' <span class="rbx-tmpl-check">✓</span>');
      });
      const t = (templates || []).find(t => t.id === c.dataset.tmpl);
      // If the customer hasn't picked their own colour, adopt the template's accent.
      if (t && t.accent && !EDITOR.values.accent_color) {
        rbState.accent = t.accent;
        root.style.setProperty("--rb-accent", t.accent);
        const custom = document.getElementById("rbx-color-custom"); if (custom) custom.value = t.accent;
      }
      rbRenderPreview(true);   // a template switch redraws at once, not after the typing pause
      rbSyncHeaderStatus(); // and the header says which template you're now in
      rbSyncPhotoNote();
      rbRenderPhotoCard();
      showToast(`Template: ${t ? t.name : c.dataset.tmpl}`, "success");
    });
  });
}

// Only the picture-carrying templates say anything about a photo. Showing this
// on all 37 would be noise; showing nothing on the seven that do print one is
// how people end up with an initials disc on a Europass CV without knowing why.
function rbSyncPhotoNote() {
  const host = document.getElementById("rbx-photo-note");
  if (!host) return;
  const t = (rbState.templates || []).find(x => x.id === RESUME_BUILDER_STATE.templateId);
  if (!t || !t.photo) { host.innerHTML = ""; host.style.display = "none"; return; }
  const has = state.profile && state.profile.avatar_url;
  host.style.display = "flex";
  host.innerHTML = `
    <span class="rbx-photo-dot ${has ? "on" : ""}"></span>
    <span>${has
      ? `<b>${esc(t.name)}</b> prints your profile photo.`
      : `<b>${esc(t.name)}</b> has a photo slot — add one and it prints here, otherwise your initials do.`}
      <button type="button" class="rbx-photo-link" data-goto-profile>${has ? "Change photo" : "Add a photo"}</button></span>`;
  host.querySelector("[data-goto-profile]")?.addEventListener("click", () => navigate("profile"));
}

// The photo belongs in Edit, next to the rest of the content, not only on the
// Profile page — but only for the templates that actually print one. It writes
// to the same account photo the PDF reads, so what you see here is what renders.
async function rbRenderPhotoCard() {
  const host = document.getElementById("rbx-photo-card");
  if (!host) return;
  const t = (rbState.templates || []).find(x => x.id === RESUME_BUILDER_STATE.templateId);
  if (!t || !t.photo) { host.style.display = "none"; host.innerHTML = ""; return; }

  const p = state.profile || await loadProfile();
  const url = p && p.avatar_url ? apiUrl(p.avatar_url) : null;
  host.style.display = "block";
  host.innerHTML = `
    <div class="rbx-photo-row">
      <div class="rbx-photo-thumb" id="rbx-photo-thumb">${url ? "" : esc((p && p.initials) || "?")}</div>
      <div class="rbx-photo-copy">
        <b>Photo for this template</b>
        <span>${esc(t.name)} prints a picture. ${url ? "This is the one it will use." : "Add one, or it falls back to your initials."}</span>
        <div class="rbx-photo-btns">
          <label class="prof-btn prof-btn-primary">
            <input type="file" id="rbx-photo-input" accept="image/png,image/jpeg,image/webp" hidden>
            ${url ? "Replace photo" : "Upload photo"}
          </label>
          ${url ? `<button class="prof-btn" id="rbx-photo-remove">Remove</button>` : ""}
        </div>
      </div>
    </div>`;
  const thumb = document.getElementById("rbx-photo-thumb");
  if (url) { thumb.style.backgroundImage = `url("${url}")`; thumb.style.backgroundSize = "cover"; thumb.style.backgroundPosition = "center"; }

  document.getElementById("rbx-photo-input").addEventListener("change", async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    e.target.value = "";
    try {
      const blob = await showCropModal(file);
      if (!blob) return;
      state.profile = await uploadAvatar(blob);
      showToast("Photo added — it's in the preview now", "success");
      renderNav();
      rbRenderPhotoCard();
      rbSyncPhotoNote();
      rbRenderPreview(true);
    } catch (err) { showToast(apiErrorMessage(err, "Couldn't upload that image"), "error"); }
  });
  document.getElementById("rbx-photo-remove")?.addEventListener("click", async () => {
    try {
      state.profile = await del(`/api/profile/photo`);
      showToast("Photo removed", "success");
      renderNav(); rbRenderPhotoCard(); rbSyncPhotoNote(); rbRenderPreview(true);
    } catch (err) { showToast(apiErrorMessage(err, "Couldn't remove the photo"), "error"); }
  });
}

// ---- wiring ----
function rbWire(templates) {
  const root = document.querySelector(".rbx");
  // tabs
  document.querySelectorAll("#rbx-tabbar button").forEach(b => b.addEventListener("click", () => rbSwitchTab(b.dataset.rtab)));
  // doc title
  const titleInput = document.getElementById("rbx-title");
  titleInput.addEventListener("input", () => { EDITOR.resumeName = titleInput.value; titleInput.style.width = rbTitleInputWidth(titleInput.value) + "px"; });
  // The pencil is inside the <label>, so the browser already forwards its
  // clicks to the input — no separate handler needed. Select-all on focus so
  // "Untitled Resume" can be typed straight over.
  titleInput.addEventListener("focus", () => {
    if (!titleInput.value || titleInput.value === "Untitled Resume") titleInput.select();
  });
  // --- delegated editor interactions (survive sub-box add/remove re-renders) ---
  root.addEventListener("input", (e) => {
    const d = e.target.dataset;
    if (d.f !== undefined) { rbSet(d.f, e.target.value); rbRenderPreview(); rbRenderCompleteness(); }
    else if (d.name !== undefined) { rbSyncName(root); }
    else if (d.entry !== undefined) { rbApplyEntryEdit(d.entry, e.target.value); }
    else if (d.bullet !== undefined) { rbApplyBulletEdit(d.bullet, e.target.value); }
    else if (d.citem !== undefined) { rbApplyCustomItemEdit(d.citem, e.target.value); }
    else if (d.csecTitle !== undefined) {
      const sec = (EDITOR.values.custom_sections || [])[+d.csecTitle]; if (sec) { sec.title = e.target.value; rbRenderPreview(); }
    }
  });
  root.addEventListener("click", (e) => {
    const t = e.target.closest("[data-toggle],[data-open],[data-ai],[data-ai-entry],[data-add-entry],[data-del-entry],[data-add-bullet],[data-del-bullet],[data-add-citem],[data-del-citem],[data-del-csec],[data-add-custom]");
    if (!t || !root.contains(t)) return;
    const d = t.dataset;
    if (d.toggle) rbToggleSection(d.toggle);
    else if (d.open) rbOpenSection(d.open);
    else if (d.ai) { e.stopPropagation(); rbOpenAiPop(t, d.ai); }
    else if (d.aiEntry) { e.stopPropagation(); rbOpenAiPop(t, "bullets", d.aiEntry); }
    else if (d.addEntry) rbAddEntry(d.addEntry);
    else if (d.delEntry) rbDelEntry(d.delEntry);
    else if (d.addBullet) rbAddBullet(d.addBullet);
    else if (d.delBullet) rbDelBullet(d.delBullet);
    else if (d.addCitem !== undefined) rbAddCustomItem(d.addCitem);
    else if (d.delCitem) rbDelCustomItem(d.delCitem);
    else if (d.delCsec !== undefined) rbDelCustomSec(d.delCsec);
    else if (d.addCustom !== undefined) rbAddCustomSec();
  });
  document.getElementById("rbx-aipop-regen").addEventListener("click", rbFetchAi);
  document.getElementById("rbx-aipop-insert").addEventListener("click", rbInsertAi);
  // rbWire() runs on every Resume Builder render, but this listener lives on
  // `document` itself (never replaced), so guard it — otherwise every visit
  // to the page stacks another permanent listener that never gets cleaned up.
  if (!window.__rbAiPopBound) {
    window.__rbAiPopBound = true;
    document.addEventListener("click", (e) => {
      const pop = document.getElementById("rbx-aipop");
      if (pop && pop.classList.contains("show") && !pop.contains(e.target) && !e.target.closest("[data-ai],[data-ai-entry]")) pop.classList.remove("show");
    });
  }
  // design: colour swatches, custom colour, font, size
  root.querySelectorAll("[data-accent]").forEach(s => s.addEventListener("click", () => {
    rbState.accent = s.dataset.accent;
    root.querySelectorAll(".rbx-swatch").forEach(x => { x.classList.remove("active"); if (!x.classList.contains("rbx-swatch-custom")) x.textContent = ""; });
    s.classList.add("active"); s.textContent = "✓";
    rbSetAccent(s.dataset.accent, root);
  }));
  const colorInput = document.getElementById("rbx-color-custom");
  if (colorInput) colorInput.addEventListener("input", () => {
    root.querySelectorAll(".rbx-swatch").forEach(x => { x.classList.remove("active"); if (!x.classList.contains("rbx-swatch-custom")) x.textContent = ""; });
    colorInput.closest(".rbx-swatch").classList.add("active");
    rbSetAccent(colorInput.value, root);
  });
  const fontSel = document.getElementById("rbx-font");
  if (fontSel) fontSel.addEventListener("change", () => { rbSet("font_family", fontSel.value); rbRenderPreview(); });
  root.querySelectorAll("#rbx-size [data-size]").forEach(b => b.addEventListener("click", () => {
    rbSet("font_size", b.dataset.size);
    root.querySelectorAll("#rbx-size button").forEach(x => x.classList.toggle("active", x === b));
    rbRenderPreview();
  }));
  rbBindTemplateCells(root, templates);
  document.getElementById("rbx-photo-filter")?.addEventListener("click", () => {
    rbState.photoOnly = !rbState.photoOnly;
    render();
  });
  // header status chips are shortcuts to the tab that owns what they report
  document.getElementById("rbx-status-tmpl")?.addEventListener("click", () => rbSwitchTab("design"));
  document.getElementById("rbx-status-pct")?.addEventListener("click", () => {
    rbSwitchTab("edit");
    document.querySelector(".rbx-complete")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  });
  // roles tab: search box (the chips and cards are bound as they're rendered)
  const roleSearch = document.getElementById("rbx-roles-search");
  if (roleSearch) roleSearch.addEventListener("input", () => {
    rbState.roleQuery = roleSearch.value;
    rbRenderRoles();
  });
  // review + tailor
  document.getElementById("rbx-rescan").addEventListener("click", rbRunReview);
  document.getElementById("rbx-match").addEventListener("click", rbRunTailor);
  document.getElementById("rbx-tailor-go").addEventListener("click", async () => {
    const jd = document.getElementById("rbx-jd").value.trim();
    if (!state.builderResumeId) { showToast("Save the resume first, then tailor it", "warning"); return; }
    try {
      const t = await post(`/api/resume-builder/tailor-for-job`, { resume_id: state.builderResumeId, job_description: jd });
      showToast("Tailored copy saved to your library", "success");
      EDITOR.loadedFor = null; EDITOR.resumeName = ""; state.builderResumeId = t.id;
      state.resumesView = "library"; render();
    } catch (err) { showToast(apiErrorMessage(err, "Couldn't tailor the resume"), "error"); }
  });
  // top actions
  document.getElementById("rbx-save").addEventListener("click", rbSaveFromBuilder);
  document.getElementById("rbx-download").addEventListener("click", () => rbDownload());
}

async function rbSaveFromBuilder() {
  const btn = document.getElementById("rbx-save");
  if (!(EDITOR.values.full_name || "").trim()) { rbOpenSection("sec-details"); showToast("Add your name under Personal details", "warning"); return; }
  const original = btn.textContent; btn.disabled = true; btn.textContent = "Saving…";
  try {
    const payload = { ...EDITOR.values, template_id: RESUME_BUILDER_STATE.templateId, resume_name: EDITOR.resumeName };
    if (state.builderResumeId) await put(`/api/resume-builder/${state.builderResumeId}`, payload);
    else await post(`/api/resume-builder/generate`, payload);
    showToast(state.builderResumeId ? "Resume updated" : "Resume saved to your library", "success");
    EDITOR.loadedFor = null; EDITOR.resumeName = ""; state.builderResumeId = null;
    state.resumesView = "library"; scrollPageTo(0); render();
  } catch (err) {
    showToast(apiErrorMessage(err, "Couldn't save the resume"), "error");
  } finally { btn.disabled = false; btn.textContent = original; }
}

// PDF only. A .docx built from the résumé's plain text discarded the template
// the customer had just chosen, so "Word" was a worse copy of their own
// document rather than a second useful format.
async function rbDownload() {
  if (!(EDITOR.values.full_name || "").trim()) { rbOpenSection("sec-details"); showToast("Add your name first", "warning"); return; }
  showToast("Rendering PDF…", "info");
  try {
    const payload = { ...EDITOR.values, template_id: RESUME_BUILDER_STATE.templateId, resume_name: EDITOR.resumeName };
    const res = await fetch(`${API_BASE}/api/resume-builder/preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(auth.getToken() ? { Authorization: `Bearer ${auth.getToken()}` } : {}) },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(await res.text());
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(EDITOR.resumeName || "resume").replace(/[^\w\-. ]/g, "_")}.pdf`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  } catch (err) {
    showToast(apiErrorMessage(err, "Couldn't render the PDF"), "error");
  }
}

function renderEditorSections() {
  const host = document.getElementById("redit-sections");
  if (!host) return;
  host.innerHTML = BUILDER_SECTIONS.map(sec => {
    const open = EDITOR.open.has(sec.id);
    const filled = sec.fields.some(f => (EDITOR.values[f.name] || "").toString().trim());
    return `
      <div class="redit-sec ${open ? "open" : ""}" data-sec="${sec.id}">
        <button class="redit-sec-head" data-sec-toggle="${sec.id}">
          <span class="redit-sec-plus">${open ? "−" : "+"}</span>
          <span class="redit-sec-icon">${sec.icon}</span>
          <span class="redit-sec-label">${sec.label}</span>
          ${sec.ai ? `<span class="redit-ai-chip">✨ AI</span>` : ""}
          ${filled ? "" : `<span class="redit-empty-chip">Empty</span>`}
        </button>
        <div class="redit-sec-body">
          ${sec.fields.map(f => `
            <div class="jf-field">
              <label>${f.label}${f.required ? ` <span class="req">Required</span>` : ""}</label>
              ${f.type === "textarea"
                ? `<textarea name="${f.name}" rows="${f.rows || 4}" placeholder="${esc(f.placeholder || "")}">${esc(editorFieldValue(f.name))}</textarea>`
                : `<input type="text" name="${f.name}" placeholder="${esc(f.placeholder || "")}" value="${esc(editorFieldValue(f.name))}" />`}
              ${f.hint ? `<p class="redit-hint">${f.hint}</p>` : ""}
            </div>`).join("")}
          ${sec.ai ? `<button class="btn-ai-gen redit-ai-btn" data-ai-sec="${sec.id}">✨ Improve with AI</button>` : ""}
        </div>
      </div>`;
  }).join("");

  host.querySelectorAll("[data-sec-toggle]").forEach(b => b.addEventListener("click", () => {
    const id = b.dataset.secToggle;
    EDITOR.open.has(id) ? EDITOR.open.delete(id) : EDITOR.open.add(id);
    renderEditorSections();
  }));

  // Track edits: snapshot for Undo on first keystroke of a burst, then
  // debounce the preview so typing stays smooth.
  host.querySelectorAll("input, textarea").forEach(el => {
    el.addEventListener("focus", () => {
      EDITOR.undoStack.push({ ...EDITOR.values });
      if (EDITOR.undoStack.length > 25) EDITOR.undoStack.shift();
      const u = document.getElementById("redit-undo");
      if (u) u.disabled = false;
    });
    el.addEventListener("input", () => {
      EDITOR.values[el.name] = el.value;
      EDITOR.dirty = true;
      const saved = document.getElementById("redit-saved");
      if (saved) saved.textContent = "Unsaved changes";
      schedulePreview();
    });
  });

  host.querySelectorAll("[data-ai-sec]").forEach(b => b.addEventListener("click", () => {
    showToast("AI polish needs a local model — see AI_SETUP.md", "info");
  }));
}

// Lightweight skeleton preview for each template, drawn as inline SVG.
// Deliberately not a real render: the gallery shows a dozen of these at once
// and rendering a dozen PDFs to pick a layout would be slow and pointless.
// The shapes only need to convey the *layout* — one column vs two, sidebar
// side, whether there's a photo — which is what people actually choose on.
function templatePreviewSVG(templateId) {
  const NAVY = "#2B3444", LINE = "#D8DCE3", ACCENT = "#E4A335", SIDE = "#EDEFF3";
  const line = (x, y, w, h = 2.5, fill = LINE) =>
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" fill="${fill}"/>`;
  const rows = (x, y, widths, gap = 6, fill = LINE) =>
    widths.map((w, i) => line(x, y + i * gap, w, 2.5, fill)).join("");

  let body;
  switch (templateId) {
    case "modern_two_column":
    case "tech_two_column":
    case "tinted_sidebar":
      // left sidebar + main column
      body = `
        <rect x="0" y="0" width="56" height="200" fill="${SIDE}"/>
        <circle cx="28" cy="30" r="13" fill="${LINE}"/>
        ${rows(10, 52, [36, 30, 34], 6)}
        ${line(10, 78, 26, 3, NAVY)} ${rows(10, 86, [36, 32, 30])}
        ${line(10, 112, 26, 3, NAVY)} ${rows(10, 120, [34, 30])}
        ${line(66, 18, 74, 6, NAVY)} ${line(66, 29, 52, 3, ACCENT)}
        ${line(66, 44, 40, 3.5, NAVY)} ${rows(66, 52, [84, 80, 74])}
        ${line(66, 78, 44, 3.5, NAVY)} ${rows(66, 86, [84, 78, 82, 70])}
        ${line(66, 118, 40, 3.5, NAVY)} ${rows(66, 126, [84, 76])}`;
      break;
    case "europe_cv":
    case "india_cv":
      // photo top-right + detail block (regional convention)
      body = `
        ${line(16, 18, 66, 6, NAVY)} ${line(16, 29, 46, 3, ACCENT)}
        <rect x="118" y="14" width="28" height="34" rx="3" fill="${LINE}"/>
        ${rows(16, 42, [70, 64, 58], 6)}
        ${line(16, 68, 34, 3.5, NAVY)} ${rows(16, 76, [124, 118, 112])}
        ${line(16, 102, 40, 3.5, NAVY)} ${rows(16, 110, [124, 116, 120])}
        ${line(16, 136, 36, 3.5, NAVY)} ${rows(16, 144, [124, 110])}`;
      break;
    case "compact_dense":
      // dense two-column, tight leading
      body = `
        ${line(16, 14, 80, 5, NAVY)} ${line(16, 23, 52, 2.5, ACCENT)}
        ${line(16, 32, 128, 1.2, NAVY)}
        ${line(16, 40, 34, 3, NAVY)} ${rows(16, 47, [76, 72, 74, 70, 74], 5)}
        ${line(16, 80, 38, 3, NAVY)} ${rows(16, 87, [76, 70, 74, 72], 5)}
        ${rows(104, 40, [40, 36, 38, 34], 5)}
        ${rows(104, 68, [40, 34, 36], 5)}
        ${rows(104, 92, [40, 38], 5)}`;
      break;
    case "academic_cv":
      // dense, publication-heavy single column
      body = `
        ${line(30, 16, 100, 5.5, NAVY)} ${line(46, 26, 68, 2.5)}
        ${line(16, 42, 32, 3.5, NAVY)} ${rows(16, 50, [128, 124, 120, 126], 5.5)}
        ${line(16, 82, 44, 3.5, NAVY)} ${rows(16, 90, [128, 122, 126, 118, 124], 5.5)}
        ${line(16, 128, 38, 3.5, NAVY)} ${rows(16, 136, [128, 120, 124], 5.5)}`;
      break;
    case "executive_sidebar":
    case "teal_sidebar":
      // dark panel on one side
      body = `
        <rect x="104" y="0" width="56" height="200" fill="#2B3444"/>
        ${line(16, 18, 74, 6, NAVY)} ${line(16, 29, 52, 3, ACCENT)}
        ${line(16, 46, 38, 3.5, NAVY)} ${rows(16, 54, [80, 74, 78])}
        ${line(16, 82, 44, 3.5, NAVY)} ${rows(16, 90, [80, 76, 72, 78])}
        ${line(16, 128, 40, 3.5, NAVY)} ${rows(16, 136, [80, 70])}
        ${rows(112, 20, [40, 34, 38], 6, "#8FA3B8")}
        ${rows(112, 56, [40, 36, 32], 6, "#8FA3B8")}
        ${rows(112, 92, [40, 34], 6, "#8FA3B8")}`;
      break;
    case "header_band":
    case "creative_accent":
      // bold accent header band
      body = `
        <rect x="0" y="0" width="160" height="46" fill="${NAVY}"/>
        ${line(16, 16, 84, 7, "#FFFFFF")} ${line(16, 29, 54, 3, ACCENT)}
        ${line(16, 60, 38, 3.5, NAVY)} ${rows(16, 68, [128, 120, 124])}
        ${line(16, 98, 44, 3.5, ACCENT)} ${rows(16, 106, [128, 118, 122])}
        ${line(16, 136, 34, 3.5, NAVY)} ${rows(16, 144, [128, 112])}`;
      break;
    default:
      // classic / us_resume / anything else: centred header, single column
      body = `
        ${line(38, 16, 84, 6, NAVY)} ${line(50, 27, 60, 2.5)}
        ${line(16, 42, 30, 3.5, NAVY)} ${line(16, 48, 128, 1, LINE)}
        ${rows(16, 54, [128, 122, 116])}
        ${line(16, 82, 44, 3.5, NAVY)} ${line(16, 88, 128, 1, LINE)}
        ${rows(16, 94, [128, 120, 124, 114])}
        ${line(16, 130, 36, 3.5, NAVY)} ${line(16, 136, 128, 1, LINE)}
        ${rows(16, 142, [128, 118])}`;
  }
  return `<svg viewBox="0 0 160 200" xmlns="http://www.w3.org/2000/svg" class="w-full h-full" role="img" aria-label="Template layout preview">
    <rect x="0" y="0" width="160" height="200" fill="#fff"/>
    ${body}
  </svg>`;
}

function renderEditorRight(templates) {
  const host = document.getElementById("redit-right-body");
  if (!host) return;
  if (EDITOR.rightTab === "tips") {
    host.innerHTML = `
      <div class="redit-tips">
        <div class="redit-tip"><strong>Lead with impact.</strong> Start bullets with a verb and end with a number — "cut report time 40%" beats "responsible for reports".</div>
        <div class="redit-tip"><strong>Mirror the posting.</strong> Use the job's own words for tools and skills; ATS matching is literal.</div>
        <div class="redit-tip"><strong>One page per decade.</strong> Under 10 years' experience is almost always one page.</div>
        <div class="redit-tip"><strong>Separate blocks with ---.</strong> In Experience, Education and Projects, a line containing only three dashes starts a new entry.</div>
        <div class="redit-tip"><strong>Tailor per application.</strong> Save this as your base, then use <em>Tailor to Job</em> so each application gets its own copy.</div>
      </div>`;
    return;
  }
  host.innerHTML = `
    <p class="redit-tpl-note">Previews use your own content, so you can see how each layout actually reads.</p>
    <div class="redit-tpl-grid">${templates.map(t => {
      const meta = TEMPLATE_META[t.id] || { flag: "🌐", region: "Generic" };
      const sel = RESUME_BUILDER_STATE.templateId === t.id;
      return `
        <button class="redit-tpl ${sel ? "selected" : ""}" data-tpl="${t.id}" title="${esc(t.description || t.name)}">
          <div class="redit-tpl-thumb" data-tpl-thumb="${t.id}">${templatePreviewSVG(t.id)}</div>
          <div class="redit-tpl-name">${esc(t.name)}</div>
          <div class="redit-tpl-meta">${meta.flag} ${esc(meta.region)}</div>
        </button>`;
    }).join("")}</div>`;
  host.querySelectorAll("[data-tpl]").forEach(b => b.addEventListener("click", () => {
    RESUME_BUILDER_STATE.templateId = b.dataset.tpl;
    host.querySelectorAll("[data-tpl]").forEach(x => x.classList.toggle("selected", x === b));
    schedulePreview();
  }));
  loadTemplateThumbs(host);
}

// Renders each template with the user's REAL content so the gallery shows
// how their resume actually looks in that layout, not a generic mockup.
// Two things keep this from being slow: thumbnails render only when they
// scroll into view, and results are cached per template+content signature
// so switching tabs doesn't re-render everything. The skeleton SVG stays
// visible underneath as the placeholder until its real render lands.
const _tplThumbCache = new Map();
function editorContentSignature() {
  return JSON.stringify(EDITOR.values).length + ":" + (EDITOR.values.full_name || "");
}
function loadTemplateThumbs(host) {
  const sig = editorContentSignature();
  const render = async (el) => {
    const tid = el.dataset.tplThumb;
    const key = `${tid}|${sig}`;
    if (el.dataset.done === key) return;
    el.dataset.done = key;
    if (_tplThumbCache.has(key)) {
      el.innerHTML = `<iframe class="redit-tpl-frame" src="${_tplThumbCache.get(key)}#toolbar=0&navpanes=0&scrollbar=0&view=Fit" title="" tabindex="-1"></iframe>`;
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/api/resume-builder/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(auth.getToken() ? { Authorization: `Bearer ${auth.getToken()}` } : {}) },
        body: JSON.stringify({ ...EDITOR.values, template_id: tid, resume_name: EDITOR.resumeName || "Preview" }),
      });
      if (!res.ok) return;                       // keep the skeleton on failure
      const url = URL.createObjectURL(await res.blob());
      _tplThumbCache.set(key, url);
      el.innerHTML = `<iframe class="redit-tpl-frame" src="${url}#toolbar=0&navpanes=0&scrollbar=0&view=Fit" title="" tabindex="-1"></iframe>`;
    } catch { /* skeleton remains — a failed thumbnail must not break the picker */ }
  };

  const thumbs = host.querySelectorAll("[data-tpl-thumb]");
  if (!("IntersectionObserver" in window)) { thumbs.forEach(render); return; }
  const io = new IntersectionObserver((entries, obs) => {
    entries.forEach(e => { if (e.isIntersecting) { render(e.target); obs.unobserve(e.target); } });
  }, { root: host, rootMargin: "220px" });
  thumbs.forEach(t => io.observe(t));
}

// Debounced live preview. Rendering a PDF per keystroke would be both slow
// and pointless, so edits settle for a moment first; the in-flight request
// is superseded by sequence number so a slow render can't overwrite a newer.
let _previewSeq = 0;
function schedulePreview() {
  clearTimeout(EDITOR.previewTimer);
  EDITOR.previewTimer = setTimeout(runPreview, 550);
}
async function runPreview() {
  const wrap = document.getElementById("redit-preview");
  if (!wrap) return;
  const seq = ++_previewSeq;
  wrap.classList.add("loading");
  try {
    const payload = { ...EDITOR.values, template_id: RESUME_BUILDER_STATE.templateId, resume_name: EDITOR.resumeName };
    const res = await fetch(`${API_BASE}/api/resume-builder/preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(auth.getToken() ? { Authorization: `Bearer ${auth.getToken()}` } : {}) },
      body: JSON.stringify(payload),
    });
    if (seq !== _previewSeq) return;           // a newer render already ran
    if (!res.ok) throw new Error(await res.text());
    if (EDITOR.previewUrl) URL.revokeObjectURL(EDITOR.previewUrl);
    EDITOR.previewUrl = URL.createObjectURL(await res.blob());
    wrap.innerHTML = `<iframe class="redit-frame" src="${EDITOR.previewUrl}#toolbar=0&navpanes=0&view=FitH" title="Live resume preview"></iframe>`;
    applyEditorZoom();
  } catch (err) {
    if (seq !== _previewSeq) return;
    wrap.innerHTML = `<div class="redit-preview-error">Couldn't render the preview.<br><span>${esc(apiErrorMessage(err, "Check the required fields."))}</span></div>`;
  } finally {
    if (seq === _previewSeq) wrap.classList.remove("loading");
  }
}
function applyEditorZoom() {
  const f = document.querySelector(".redit-frame");
  const label = document.getElementById("redit-zoom-val");
  if (label) label.textContent = `${Math.round(EDITOR.zoom * 100)}%`;
  if (f) { f.style.transform = `scale(${EDITOR.zoom})`; f.style.transformOrigin = "top center"; }
}

async function saveEditorResume() {
  const btn = document.getElementById("redit-save");
  if (!EDITOR.values.full_name || !EDITOR.values.full_name.trim()) {
    EDITOR.open.add("contact");
    renderEditorSections();
    showToast("Full name is required — it's under Contact", "error");
    return;
  }
  const original = btn.textContent;
  btn.disabled = true; btn.textContent = "Saving…";
  try {
    const payload = { ...EDITOR.values, template_id: RESUME_BUILDER_STATE.templateId, resume_name: EDITOR.resumeName };
    if (state.builderResumeId) await put(`/api/resume-builder/${state.builderResumeId}`, payload);
    else await post(`/api/resume-builder/generate`, payload);
    showToast(state.builderResumeId ? "Resume updated — linked applications follow the change" : "Resume saved to your library", "success");
    EDITOR.dirty = false;
    EDITOR.loadedFor = null;
    EDITOR.resumeName = "";
    EDITOR.undoStack = [];
    state.builderResumeId = null;
    state.resumesView = "library";
    scrollPageTo(0);
    render();
  } catch (err) {
    showToast(apiErrorMessage(err, "Couldn't save the resume"), "error");
  } finally {
    btn.disabled = false; btn.textContent = original;
  }
}

// ============================================================================
// AUTH SCREEN
// ============================================================================
let authMode = "login"; // or "signup"

// ============================================================================
// THEME (dark mode) — scoped to the logged-in app; the marketing/login page
// always renders light regardless of the saved preference.
// ============================================================================
function applyTheme(theme) {
  if (theme === "dark") document.documentElement.setAttribute("data-theme", "dark");
  else document.documentElement.removeAttribute("data-theme");
  const icon = document.getElementById("theme-toggle-icon");
  if (icon) icon.textContent = theme === "dark" ? "☀️" : "🌙";
}
function toggleTheme() {
  const current = document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
  const next = current === "dark" ? "light" : "dark";
  localStorage.setItem("momentum_theme", next);
  applyTheme(next);
  // Chart.js bakes colors in at creation time, so charts on the current
  // page need to be redrawn (not just the CSS) to pick up the new theme.
  if (document.getElementById("app") && !document.getElementById("app").classList.contains("hidden")) {
    render();
  }
}

function showAuthScreen() {
  document.getElementById("auth-screen").classList.remove("hidden");
  document.getElementById("app").classList.add("hidden");
  document.getElementById("chat-widget").classList.add("hidden");
  resetChatWidgetState(); // avoid open/closed desync across logout -> login cycles
  applyTheme(localStorage.getItem("momentum_theme") || "light"); // landing page has its own dark-mode toggle now, so honor the saved choice
  setAuthMode("login");
  initBrandGrid();
}

function showApp() {
  document.getElementById("auth-screen").classList.add("hidden");
  document.getElementById("app").classList.remove("hidden");
  document.getElementById("chat-widget").classList.remove("hidden");
  applyTheme(localStorage.getItem("momentum_theme") || "light");
  initChatWidget();
  initGlobalSearch();
  renderNav();
  render();
}

function setAuthMode(mode) {
  authMode = mode;
  const isLogin = mode === "login";
  document.getElementById("auth-tab-login").className = `flex-1 py-1.5 rounded-md ${isLogin ? "bg-white shadow-sm" : "text-gray-500"}`;
  document.getElementById("auth-tab-signup").className = `flex-1 py-1.5 rounded-md ${!isLogin ? "bg-white shadow-sm" : "text-gray-500"}`;
  document.getElementById("auth-name-field").classList.toggle("hidden", isLogin);
  document.getElementById("auth-name-field").querySelector("input").required = !isLogin;
  document.getElementById("auth-submit").textContent = isLogin ? "Log In" : "Create Account";
  document.getElementById("auth-heading").textContent = isLogin ? "Welcome back" : "Start your streak";
  document.getElementById("auth-subheading").textContent = isLogin
    ? "Log in to pick up where you left off."
    : "One account, every goal, habit, and application in one place.";
  // The 8-character minimum is a signup requirement, not a login one — an
  // existing account's password could already be any length, so enforcing
  // it on login would incorrectly block correct credentials.
  const passwordInput = document.getElementById("auth-password");
  passwordInput.placeholder = isLogin ? "Password" : "Password (min. 8 characters)";
  if (isLogin) passwordInput.removeAttribute("minlength");
  else passwordInput.setAttribute("minlength", "8");
  document.getElementById("auth-error").classList.add("hidden");
  document.getElementById("auth-form").reset();
}

// Populates the brand panel's ambient grid with cells that sweep in a
// diagonal wave — each day's square lighting up in turn, echoing the
// heatmaps used throughout the app itself.
function initBrandGrid() {
  const grid = document.getElementById("brand-grid");
  if (!grid || grid.dataset.built) return;
  grid.dataset.built = "1";
  const cols = 9, rows = 6;
  let html = "";
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const delay = ((r + c) * 0.12).toFixed(2);
      html += `<div class="brand-grid-cell" style="animation-delay:${delay}s"></div>`;
    }
  }
  grid.innerHTML = html;
}

document.getElementById("auth-tab-login").addEventListener("click", () => setAuthMode("login"));
document.getElementById("auth-tab-signup").addEventListener("click", () => setAuthMode("signup"));

// Marketing-page nav buttons ("Log In" / "Get Started Free") scroll down to
// the embedded auth card and pre-select the right tab, rather than
// navigating away — the login form lives inside the landing page itself.
document.querySelectorAll("[data-nav-auth]").forEach(btn => {
  btn.addEventListener("click", () => {
    setAuthMode(btn.dataset.navAuth === "signup" ? "signup" : "login");
    document.getElementById("auth-card")?.scrollIntoView({ behavior: "smooth", block: "center" });
  });
});

const footerYearEl = document.getElementById("footer-year");
if (footerYearEl) footerYearEl.textContent = new Date().getFullYear();

document.getElementById("auth-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const errEl = document.getElementById("auth-error");
  errEl.classList.add("hidden");
  const fd = new FormData(e.target);
  const payload = Object.fromEntries(fd.entries());
  try {
    const endpoint = authMode === "login" ? "/api/auth/login" : "/api/auth/signup";
    const body = authMode === "login" ? { email: payload.email, password: payload.password } : payload;
    const data = await api(endpoint, { method: "POST", body: JSON.stringify(body) });
    auth.set(data.access_token, data.user);
    showApp();
  } catch (err) {
    errEl.textContent = err.message.includes("401") || err.message.includes("Incorrect")
      ? "Incorrect email or password."
      : (err.message.includes("400") ? "An account with this email already exists." : "Something went wrong. Please try again.");
    errEl.classList.remove("hidden");
  }
});

// Log out moved into the account menu (see wireUserMenu). This used to bind a
// #logout-btn that no longer exists — and because it ran at the top level, the
// null dereference stopped app.js dead, leaving the whole app a blank shell.
// Anything bound out here now has to tolerate a missing element.

// Theme and report export moved into Settings on the profile page. Nothing
// binds them out here any more — a top-level listener on an element that no
// longer exists is what blanked the whole app last time.

// ---------- Google Sign-In ----------
let googleInitialized = false;

function initGoogleSignIn() {
  if (googleInitialized || !window.GOOGLE_CLIENT_ID || !window.google || !window.google.accounts) return;
  googleInitialized = true;
  document.getElementById("google-signin-container").classList.remove("hidden");
  window.google.accounts.id.initialize({
    client_id: window.GOOGLE_CLIENT_ID,
    callback: handleGoogleCredential,
  });
  window.google.accounts.id.renderButton(document.getElementById("google-signin-btn"), {
    theme: "outline", size: "large", width: 280, text: "continue_with",
  });
}

async function handleGoogleCredential(response) {
  const errEl = document.getElementById("auth-error");
  errEl.classList.add("hidden");
  try {
    const data = await api("/api/auth/google", { method: "POST", body: JSON.stringify({ credential: response.credential }) });
    auth.set(data.access_token, data.user);
    showApp();
  } catch (err) {
    errEl.textContent = "Google sign-in failed. Please try again or use email/password.";
    errEl.classList.remove("hidden");
  }
}

// Google's script loads async — poll briefly until it's ready, then wire up the button.
let googleCheckAttempts = 0;
const googleCheckInterval = setInterval(() => {
  googleCheckAttempts++;
  if (window.google && window.google.accounts) {
    initGoogleSignIn();
    clearInterval(googleCheckInterval);
  } else if (googleCheckAttempts > 40) {
    clearInterval(googleCheckInterval); // give up quietly after ~10s; email/password still works
  }
}, 250);


async function downloadExport(btn, endpoint, filename) {
  const originalText = btn.textContent;
  btn.textContent = "Preparing export...";
  btn.disabled = true;
  try {
    const token = auth.getToken();
    const res = await fetch(`${API_BASE}${endpoint}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error("Export failed");
    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
    showToast("Export downloaded", "success");
  } catch (err) {
    showToast("Export failed — please try again.", "error");
  } finally {
    btn.textContent = originalText;
    btn.disabled = false;
  }
}

// The two focused exports behind the Export submenu. Kept separate from the
// full-account report because they answer different questions: how am I doing,
// and what have I applied to.
function downloadReport(btn, endpoint, stem) {
  return downloadExport(btn, `/api/export/${endpoint}`, `${stem}-${toISO(new Date())}.pdf`);
}

// ============================================================================
// STUDY PLAN
// ============================================================================
// ---- shared subject -> color helpers (used by both the Study Plan week
// view and the Dashboard's study ledger, so a subject reads the same
// color everywhere) ----
function subjectColorIndex(subject) {
  let h = 0;
  for (let i = 0; i < subject.length; i++) h = (h * 31 + subject.charCodeAt(i)) >>> 0;
  return h % 4;
}
function timeToMinutes(hhmm) { const [h, m] = (hhmm || "0:0").split(":").map(Number); return h * 60 + (m || 0); }

// ---- Study streaks & consistency (all computed from real study-block data) ----
function computeStudyStreak(allBlocks) {
  const doneDates = new Set(allBlocks.filter(b => b.completed).map(b => b.date));
  let cursor = new Date(); cursor.setHours(0, 0, 0, 0);
  const todayISO = toISO(cursor);
  if (!doneDates.has(todayISO)) cursor = addDays(cursor, -1); // today not done yet doesn't break the streak
  let streak = 0;
  while (doneDates.has(toISO(cursor))) { streak++; cursor = addDays(cursor, -1); }
  return streak;
}
function computeBestStudyStreak(allBlocks) {
  const dates = Array.from(new Set(allBlocks.filter(b => b.completed).map(b => b.date))).sort();
  let best = 0, run = 0, prev = null;
  dates.forEach(iso => {
    run = (prev && (fromISO(iso) - fromISO(prev)) === 86400000) ? run + 1 : 1;
    best = Math.max(best, run);
    prev = iso;
  });
  return best;
}
function computeWeekConsistency(allBlocks, weeks = 13) {
  const cutoff = toISO(addDays(new Date(), -weeks * 7));
  const recent = allBlocks.filter(b => b.date >= cutoff);
  return { pct: recent.length ? Math.round(recent.filter(b => b.completed).length / recent.length * 100) : 0, total: recent.length, done: recent.filter(b => b.completed).length };
}

// ---- Spaced-repetition-style "due for review" queue: real gap since each
// subject's last completed session, not a fake scripted list. ----
function computeReviewQueue(allBlocks) {
  const last = new Map();
  allBlocks.forEach(b => { if (b.completed && (!last.has(b.subject) || b.date > last.get(b.subject))) last.set(b.subject, b.date); });
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return Array.from(last.entries())
    .map(([subject, lastDate]) => ({ subject, days: Math.round((today - fromISO(lastDate)) / 86400000) }))
    .filter(e => e.days >= 2)
    .sort((a, b) => b.days - a.days)
    .slice(0, 4);
}

// ---- Adaptive reschedule: flags a subject whose last 2 past sessions were
// both missed, and proposes an actual free slot found in this week's grid. ----
function findFreeSlotThisWeek(weekBlocks, weekStart) {
  const todayISO = toISO(new Date());
  for (let d = 0; d < 7; d++) {
    const date = addDays(weekStart, d);
    const iso = toISO(date);
    if (iso < todayISO) continue;
    const occupied = weekBlocks.filter(b => b.date === iso).map(b => [timeToMinutes(b.start_time), timeToMinutes(b.end_time)]).sort((a, b) => a[0] - b[0]);
    for (let startMin = 9 * 60; startMin <= 19 * 60; startMin += 30) {
      const endMin = startMin + 60;
      const overlaps = occupied.some(([os, oe]) => startMin < oe && endMin > os);
      if (!overlaps) {
        const fmt = m => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
        return { date: iso, start: fmt(startMin), end: fmt(endMin), dateLabel: fmtNice(date) };
      }
    }
  }
  return null;
}
function computeAdaptiveSuggestion(weekBlocks, allBlocks, weekStart, dismissed) {
  const todayISO = toISO(new Date());
  const bySubject = new Map();
  allBlocks.filter(b => b.date < todayISO).forEach(b => {
    if (!bySubject.has(b.subject)) bySubject.set(b.subject, []);
    bySubject.get(b.subject).push(b);
  });
  for (const [subject, blocks] of bySubject) {
    if (dismissed.has(subject)) continue;
    const recentTwo = blocks.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 2);
    if (recentTwo.length === 2 && recentTwo.every(b => !b.completed)) {
      const slot = findFreeSlotThisWeek(weekBlocks, weekStart);
      if (slot) return { subject, slot };
    }
  }
  return null;
}

// ---- Actual-vs-planned time tracking. The backend's StudyBlock model only
// stores the *planned* start/end time, so actual focused minutes (logged by
// the stopwatch below) are kept client-side, keyed by block id. ----
function getStudyActualLog() {
  try { return JSON.parse(localStorage.getItem("momentum_study_actual") || "{}"); } catch { return {}; }
}
function logStudyActualMinutes(blockId, minutes) {
  const log = getStudyActualLog();
  log[blockId] = minutes;
  localStorage.setItem("momentum_study_actual", JSON.stringify(log));
}

// ---- Shared focus-timer (stopwatch) state. Kept at module scope (rather
// than inside renderStudy) so an in-progress session survives the page
// re-rendering after unrelated actions (toggling a block, adding a new one) —
// the interval callback always re-queries the DOM fresh, so it keeps working
// even after its original elements were replaced by a re-render. ----
// The stopwatch lives on the server (table: study_timers), not in this tab.
// It used to be a plain counter here, which meant a refresh lost the session,
// two tabs disagreed, and a timer started from Telegram was invisible. Now the
// only local state is "which block is selected" and a display interval; the
// elapsed figure is always derived from the server's started_at, so it stays
// right across a reload, a sleeping laptop, or a stop from the phone.
const studyTimerState = { running: false, startedAt: null, intervalId: null,
                          blockId: null, subject: null, source: null };

function formatTimer(totalSeconds) {
  const m = Math.floor(totalSeconds / 60).toString().padStart(2, "0");
  const s = Math.floor(totalSeconds % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

function studyElapsedSeconds() {
  if (!studyTimerState.startedAt) return 0;
  return Math.max(0, Math.floor((Date.now() - studyTimerState.startedAt) / 1000));
}

function tickStudyTimer() {
  const d = document.getElementById("study-timer-display");
  if (d) d.textContent = formatTimer(studyElapsedSeconds());
  const p = document.getElementById("study-timer-elapsed");
  if (p) p.textContent = formatTimer(studyElapsedSeconds());
}

function startStudyTicking() {
  if (studyTimerState.intervalId) clearInterval(studyTimerState.intervalId);
  studyTimerState.intervalId = setInterval(tickStudyTimer, 1000);
  tickStudyTimer();
}

function stopStudyTicking() {
  if (studyTimerState.intervalId) clearInterval(studyTimerState.intervalId);
  studyTimerState.intervalId = null;
}

// started_at comes back as a naive UTC timestamp (the backend stores UTC and
// FastAPI serialises it without a zone). Date.parse would read that as local
// time and show an elapsed figure out by the UTC offset — an hour of study
// that never happened, or a negative timer. The Z is explicit for that reason.
function parseUtc(ts) {
  if (!ts) return null;
  return Date.parse(/[Zz]|[+-]\d{2}:?\d{2}$/.test(ts) ? ts : ts + "Z");
}

// A free timer needs a name before it starts, not after — asking afterwards
// means whatever you type has to be attached to time already spent, and an
// empty answer leaves an unlabelled row in the study log.
async function promptStudySubject() {
  const v = await showPromptModal({
    title: "What are you studying?",
    label: "Subject",
    placeholder: "e.g. Linear Algebra",
    confirmLabel: "Start timer",
  });
  if (v === null || v === undefined) return null;       // cancelled
  return String(v).trim() || null;
}

async function syncStudyTimer() {
  let t = null;
  try { t = await get("/api/study-timer", { noCache: true }); } catch (_) { return null; }
  if (t) {
    studyTimerState.running = true;
    studyTimerState.startedAt = parseUtc(t.started_at);
    studyTimerState.blockId = t.block_id ?? studyTimerState.blockId;
    studyTimerState.subject = t.subject;
    studyTimerState.source = t.source;
  } else {
    studyTimerState.running = false;
    studyTimerState.startedAt = null;
    studyTimerState.subject = null;
    studyTimerState.source = null;
    stopStudyTicking();
  }
  return t;
}

// Subjects progress panel — real data: sessions completed vs. scheduled,
// grouped by subject, most-studied first. `compact` trims it to a handful
// of rows for the Dashboard; the full Study Plan page shows everything.
function renderSubjectsPanel(allBlocks, compact = false, twoCol = false) {
  const bySubject = new Map();
  allBlocks.forEach(b => {
    if (!bySubject.has(b.subject)) bySubject.set(b.subject, { total: 0, done: 0 });
    const s = bySubject.get(b.subject);
    s.total++;
    if (b.completed) s.done++;
  });
  let entries = Array.from(bySubject.entries()).sort((a, b) => b[1].total - a[1].total);
  // In compact (dashboard) mode we normally show the top 5; when the panel is
  // rendered as two columns there's room for roughly twice as many, so show
  // more of them rather than hiding most of the user's subjects.
  if (compact) entries = entries.slice(0, twoCol ? 10 : 5);
  if (!entries.length) return `<p class="text-sm text-gray-400 text-center py-10 px-4">No study subjects yet — add a study block to start tracking progress.</p>`;
  const dotColor = i => ["var(--lp-amber)", "var(--lp-green)", "#4C6FE7", "#E2604F"][subjectColorIndex(entries[i][0])];
  const rows = entries.map(([subject, s], i) => {
    const pct = s.total ? Math.round((s.done / s.total) * 100) : 0;
    return `
      <div class="study-subject-row">
        <span class="study-subject-dot" style="background:${dotColor(i)}"></span>
        <div class="study-subject-info">
          <div class="sname">${esc(subject)}</div>
          <div class="study-subject-track"><div class="study-subject-fill" style="width:${pct}%; background:${dotColor(i)};"></div></div>
        </div>
        <div class="study-subject-num">${s.done}/${s.total} sessions</div>
      </div>`;
  }).join("");
  return twoCol ? `<div class="subjects-grid-2col">${rows}</div>` : rows;
}

// "The Ledger" — GitHub-style consistency heatmap themed in amber, for
// completed study sessions specifically (each filled square = a day with
// at least one completed session). Lives on the Dashboard, not the Study
// Plan page. Structurally the same idea as renderApplicationHeatmap but
// keyed on `date` + `completed` rather than `date_applied`.
function renderStudyLedgerHeatmap(blocks, scrollId = "study-ledger-scroll") {
  const accentHex = "#E4A335";
  const [r, g, b] = hexToRgb(accentHex);
  const isDark = document.documentElement.getAttribute("data-theme") === "dark";
  const emptyCellColor = isDark ? "rgba(255,255,255,0.07)" : "rgba(23,26,31,0.06)";
  const WEEKS = 53;
  const CELL = 11, GAP = 3;
  const days = WEEKS * 7;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = new Date(today);
  start.setDate(start.getDate() - (days - 1) - today.getDay());

  const countByDate = {};
  blocks.forEach(b => {
    if (!b.completed || !b.date) return;
    countByDate[b.date] = (countByDate[b.date] || 0) + 1;
  });
  const maxCount = Math.max(1, ...Object.values(countByDate), 0);

  const weeks = [];
  for (let w = 0; w < WEEKS; w++) {
    const col = [];
    for (let d = 0; d < 7; d++) {
      const date = new Date(start);
      date.setDate(date.getDate() + w * 7 + d);
      const iso = toISO(date);
      const count = countByDate[iso] || 0;
      const inFuture = date > today;
      const opacity = count === 0 ? 0 : Math.max(0.18, count / maxCount);
      col.push({ iso, count, opacity, inFuture });
    }
    weeks.push(col);
  }
  const monthLabels = [];
  let lastMonth = null;
  weeks.forEach((col, w) => {
    const d = new Date(col[0].iso);
    const m = d.toLocaleDateString(undefined, { month: "short" });
    if (m !== lastMonth) { monthLabels.push({ w, label: m }); lastMonth = m; }
  });
  const totalSessions = Object.values(countByDate).reduce((a, b2) => a + b2, 0);
  const gridWidth = WEEKS * (CELL + GAP);

  return `
    <div id="${scrollId}" style="overflow-x:auto; padding-bottom:2px;">
      <div class="text-xs text-gray-400 mb-2">${totalSessions} completed session${totalSessions === 1 ? "" : "s"} in the last year — every filled square is a day you studied at least once.</div>
      <div style="display:grid; grid-template-columns:repeat(${WEEKS},${CELL}px); gap:10px ${GAP}px; margin-bottom:4px; font-size:9px; color:var(--lp-ink-faint,#93968E); font-family:var(--lp-mono,monospace); min-width:${gridWidth}px;">
        ${weeks.map((_, w) => { const found = monthLabels.find(m => m.w === w); return `<div>${found ? found.label : ""}</div>`; }).join("")}
      </div>
      <div style="display:grid; grid-template-columns:repeat(${WEEKS},${CELL}px); grid-auto-flow:column; grid-template-rows:repeat(7,${CELL}px); gap:${GAP}px; min-width:${gridWidth}px;">
        ${weeks.flat().map(cell => `
          <div title="${cell.iso}: ${cell.count} completed session${cell.count === 1 ? "" : "s"}"
               style="width:${CELL}px; height:${CELL}px; border-radius:3px; background:${cell.inFuture ? "transparent" : (cell.count === 0 ? emptyCellColor : `rgba(${r},${g},${b},${cell.opacity})`)};"></div>
        `).join("")}
      </div>
      <div class="flex items-center gap-2 mt-2 text-[9px] text-gray-400">
        <span>Less</span>
        ${[0, 0.25, 0.5, 0.75, 1].map(o => `<div style="width:11px; height:11px; border-radius:3px; background:${o === 0 ? emptyCellColor : `rgba(${r},${g},${b},${o})`};"></div>`).join("")}
        <span>More</span>
      </div>
    </div>
  `;
}

function renderStudyControls(controls) {
  const weekStart = weekStartOf(state.day);
  const weekEnd = addDays(weekStart, 6);
  controls.innerHTML = `
    <button class="btn btn-ghost" id="study-prev">← Prev week</button>
    <span class="text-sm font-semibold text-navy px-2 whitespace-nowrap">${fmtNice(weekStart)} – ${fmtNice(weekEnd)}</span>
    <button class="btn btn-ghost" id="study-next">Next week →</button>
    <button class="btn btn-accent" id="study-today">This week</button>
  `;
  controls.querySelector("#study-prev").onclick = () => { state.day = addDays(state.day, -7); render(); };
  controls.querySelector("#study-next").onclick = () => { state.day = addDays(state.day, 7); render(); };
  controls.querySelector("#study-today").onclick = () => { state.day = new Date(); render(); };
}

function openAddStudyBlockModal(DAYS, todayISO) {
  const root = document.getElementById("modal-root");
  root.innerHTML = `
    <div class="modal-backdrop" data-modal-backdrop>
      <div class="modal-box p-5" style="max-width:440px;">
        <h3 class="font-bold text-base mb-3">+ New Session</h3>
        <form id="study-form" class="space-y-3">
          <div class="form-field">
            <label class="text-xs text-gray-400 mb-1 block">Day</label>
            <select name="date" required>
              ${DAYS.map(d => `<option value="${toISO(d)}" ${toISO(d) === todayISO ? "selected" : ""}>${d.toLocaleDateString(undefined, { weekday: "long" })} — ${fmtNice(d)}</option>`).join("")}
            </select>
          </div>
          <input type="text" name="subject" placeholder="Subject / topic (e.g. Linear Algebra)" required />
          <div class="flex gap-2">
            <input type="time" name="start_time" required />
            <input type="time" name="end_time" required />
          </div>
          <textarea name="notes" placeholder="Notes (optional)" rows="2"></textarea>
          <div class="flex justify-end gap-2 pt-1">
            <button type="button" class="btn btn-ghost" id="study-form-cancel">Cancel</button>
            <button class="btn btn-accent" type="submit">+ Add to Schedule</button>
          </div>
        </form>
      </div>
    </div>`;
  root.classList.remove("hidden");
  root.querySelector("[data-modal-backdrop]").addEventListener("click", (e) => { if (e.target === e.currentTarget) closeModal(); });
  root.querySelector("#study-form-cancel").addEventListener("click", closeModal);
  root.querySelector("#study-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const payload = Object.fromEntries(fd.entries());
    await post(`/api/study-blocks`, payload);
    closeModal();
    showToast("Study session scheduled", "success");
    render();
  });
}

// ============================================================================
// STUDY PLAN — Ledger-style week view with industry-standard study-app
// features layered on top of real data: a stat-card row (today's ring,
// streak, 13-week consistency, focus time), a functional focus-timer
// stopwatch that logs actual-vs-planned minutes per session (surfaced on
// the Dashboard), a real adaptive-reschedule suggestion (detects a subject
// that's slipped and proposes an actual free slot), and a real spaced-
// repetition review queue (subjects ranked by days since last studied).
// Deliberately no charts/graphs on this page — those live on the
// Dashboard instead (see renderStudyLedgerHeatmap / the Planned vs Actual
// chart, both used in renderDashboard).
// ============================================================================
async function renderStudy(content) {
  const weekStart = weekStartOf(state.day);
  const weekEnd = addDays(weekStart, 6);
  const todayISO = toISO(new Date());
  const [weekBlocks, allBlocks] = await Promise.all([
    get(`/api/study-blocks?start=${toISO(weekStart)}&end=${toISO(weekEnd)}`),
    get(`/api/study-blocks`), // all-time — for streaks, consistency, review queue, subjects panel
    syncStudyTimer(),         // a timer may be running from Telegram or another tab
  ]);

  const DAYS = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const blocksByDay = DAYS.map(d => weekBlocks.filter(b => b.date === toISO(d)));

  const allTimes = weekBlocks.flatMap(b => [timeToMinutes(b.start_time), timeToMinutes(b.end_time)]);
  let startHour = Math.max(0, Math.floor((allTimes.length ? Math.min(...allTimes) : 8 * 60) / 60) - 1);
  let endHour = Math.min(24, Math.ceil((allTimes.length ? Math.max(...allTimes) : 20 * 60) / 60) + 1);
  if (endHour - startHour < 8) endHour = Math.min(24, startHour + 8);
  const HOUR_PX = 48;
  const gridHeight = (endHour - startHour) * HOUR_PX;
  const hourLabels = Array.from({ length: endHour - startHour }, (_, i) => startHour + i);

  // ---- stat cards (all real, derived from actual study-block data) ----
  const todayBlocks = allBlocks.filter(b => b.date === todayISO);
  const todayDone = todayBlocks.filter(b => b.completed).length;
  const todayPct = todayBlocks.length ? Math.round((todayDone / todayBlocks.length) * 100) : 0;
  const streak = computeStudyStreak(allBlocks);
  const bestStreak = computeBestStudyStreak(allBlocks);
  const consistency = computeWeekConsistency(allBlocks, 13);
  const thisWeekHours = computeStudyHours(allBlocks.filter(b => b.completed && b.date >= toISO(weekStart) && b.date <= toISO(weekEnd)));
  const lastWeekHours = computeStudyHours(allBlocks.filter(b => b.completed && b.date >= toISO(addDays(weekStart, -7)) && b.date <= toISO(addDays(weekEnd, -7))));
  const hoursDelta = Math.round((thisWeekHours - lastWeekHours) * 10) / 10;

  // ---- real adaptive suggestion + review queue ----
  const dismissed = (window._studyDismissedSubjects ||= new Set());
  const suggestion = computeAdaptiveSuggestion(weekBlocks, allBlocks, weekStart, dismissed);
  const reviewQueue = computeReviewQueue(allBlocks);

  // ---- focus timer: default to today's next incomplete block, if any ----
  // A running timer owns the selection — re-pointing the panel at a different
  // block while the clock is going would show one subject and log another.
  const todayOptions = todayBlocks.filter(b => !b.completed || String(b.id) === String(studyTimerState.blockId));
  if (!studyTimerState.running &&
      (!studyTimerState.blockId || !todayOptions.some(b => String(b.id) === String(studyTimerState.blockId)))) {
    studyTimerState.blockId = todayOptions.filter(b => !b.completed)[0]?.id ?? null;
  }
  const activeBlock = todayOptions.find(b => String(b.id) === String(studyTimerState.blockId));
  const plannedMin = activeBlock ? timeToMinutes(activeBlock.end_time) - timeToMinutes(activeBlock.start_time) : null;

  content.innerHTML = `
    <div class="study-stats-row mb-5">
      <div class="study-stat-card">
        <div class="study-stat-lbl">Today</div>
        <div class="study-ring-wrap">
          <div class="study-ring" style="background:conic-gradient(var(--lp-amber) 0deg ${todayPct * 3.6}deg, var(--lp-border) ${todayPct * 3.6}deg 360deg);">
            <div class="study-ring-inner">${todayDone}/${todayBlocks.length}</div>
          </div>
          <div>
            <div class="study-stat-val" style="font-size:15.5px;">${todayPct}%</div>
            <div class="study-stat-sub">complete</div>
          </div>
        </div>
      </div>
      <div class="study-stat-card">
        <div class="study-stat-lbl">Current Streak</div>
        <div class="study-stat-val">${streak} day${streak === 1 ? "" : "s"}</div>
        <div class="study-stat-sub up">${bestStreak > streak ? `best: ${bestStreak} days` : "🔥 personal best"}</div>
      </div>
      <div class="study-stat-card">
        <div class="study-stat-lbl">13-Wk Consistency</div>
        <div class="study-stat-val">${consistency.pct}%</div>
        <div class="study-stat-sub">${consistency.done} of ${consistency.total} sessions</div>
      </div>
      <div class="study-stat-card">
        <div class="study-stat-lbl">Focus Time This Week</div>
        <div class="study-stat-val">${thisWeekHours} hrs</div>
        <div class="study-stat-sub ${hoursDelta >= 0 ? "up" : ""}">${hoursDelta >= 0 ? "↑" : "↓"} ${Math.abs(hoursDelta)} hrs vs last week</div>
      </div>
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-5">
      <div class="card">
        <div class="card-header flex items-center justify-between">
          <span>This Week</span>
          <div class="flex items-center gap-2">
            <span class="tag text-[10px] font-normal opacity-70">${allBlocks.filter(b => b.completed && b.date >= toISO(weekStart) && b.date <= toISO(weekEnd)).length}/${weekBlocks.length} sessions completed</span>
            <button class="btn btn-accent" id="study-new-session" style="padding:6px 12px; font-size:11px;">+ New Session</button>
          </div>
        </div>
        <div class="study-week-grid" style="overflow-x:auto;">
          <div class="corner"></div>
          ${DAYS.map(d => `
            <div class="study-day-col-head ${toISO(d) === todayISO ? "today" : ""}">
              <div class="dname">${d.toLocaleDateString(undefined, { weekday: "short" })}</div>
              <div class="dnum">${d.getDate()}</div>
            </div>
          `).join("")}

          <div class="study-time-col">
            ${hourLabels.map(h => `<div>${String(h).padStart(2, "0")}:00</div>`).join("")}
          </div>
          ${DAYS.map((d, di) => `
            <div class="study-day-col ${toISO(d) === todayISO ? "today" : ""}" style="min-height:${gridHeight}px;">
              ${hourLabels.map(() => `<div class="study-slot-line"></div>`).join("")}
              ${blocksByDay[di].map(b => {
                const top = Math.max(0, (timeToMinutes(b.start_time) - startHour * 60) / 60 * HOUR_PX);
                const height = Math.max(20, (timeToMinutes(b.end_time) - timeToMinutes(b.start_time)) / 60 * HOUR_PX - 2);
                const c = subjectColorIndex(b.subject);
                return `
                  <div class="study-block c${c} ${b.completed ? "done" : ""}" style="top:${top}px; height:${height}px;" data-block-id="${b.id}" title="${esc(b.subject)}${b.notes ? " — " + esc(b.notes) : ""}">
                    <span class="sb-del" data-block-delete="${b.id}">✕</span>
                    <div class="sb-title">${esc(b.subject)}</div>
                    <div class="sb-time">${b.start_time}–${b.end_time}</div>
                  </div>`;
              }).join("")}
            </div>
          `).join("")}
        </div>
      </div>

      <div class="stack flex flex-col gap-5">
        <div class="study-timer-panel">
          <div class="study-timer-top">
            <div class="tlbl">Focus Session</div>
            <div class="tsubj">${esc(activeBlock ? activeBlock.subject : "No sessions left today")}</div>
          </div>
          ${todayOptions.length > 1 ? `
            <div class="study-timer-select">
              <select id="study-timer-block-select">
                ${todayOptions.map(b => `<option value="${b.id}" ${String(b.id) === String(studyTimerState.blockId) ? "selected" : ""}>${esc(b.subject)} (${b.start_time}–${b.end_time})</option>`).join("")}
              </select>
            </div>` : ""}
          <div class="study-timer-body">
            <div class="study-timer-ring ${studyTimerState.running ? "is-running" : ""}">
              <div class="study-timer-ring-inner" id="study-timer-display">${formatTimer(studyElapsedSeconds())}</div>
            </div>
            <div class="study-timer-actions">
              <button class="study-timer-btn play" id="study-timer-toggle"
                      title="${studyTimerState.running ? "Stop and log" : "Start the timer"}">${studyTimerState.running ? "⏹" : "▶"}</button>
              <button class="study-timer-btn" id="study-timer-reset"
                      title="Discard without logging" ${studyTimerState.running ? "" : "disabled"}>↺</button>
            </div>
          </div>
          ${studyTimerState.running && studyTimerState.source === "telegram" ? `
            <div class="study-timer-note">✈️ started from Telegram — stopping here logs it there too</div>` : ""}
          ${activeBlock ? `
            <div class="study-timer-planned">elapsed <span id="study-timer-elapsed">${formatTimer(studyElapsedSeconds())}</span> · planned ${plannedMin}m</div>
            <button class="btn btn-accent study-timer-finish" id="study-timer-finish" style="justify-content:center;">
              ${studyTimerState.running ? "✓ Finish &amp; Log Session" : "✓ Mark done without timing"}</button>
          ` : `<div class="study-timer-planned">
                 ${studyTimerState.running
                   ? `timing <b>${esc(studyTimerState.subject || "study")}</b> · <span id="study-timer-elapsed">${formatTimer(studyElapsedSeconds())}</span>`
                   : "Add a session today, or press ▶ to time unplanned study."}</div>`}
        </div>

        ${suggestion ? `
          <div class="card study-suggestion">
            <span class="study-flag">⚠ adaptive reschedule</span>
            <p><strong>${suggestion.subject}</strong> has slipped two sessions in a row. There's a free 60-minute block on ${suggestion.slot.dateLabel} at ${suggestion.slot.start} — schedule a catch-up session there instead of losing the topic?</p>
            <div class="actions">
              <button class="btn-ghost" id="study-suggestion-dismiss">Dismiss</button>
              <button class="btn-ghost solid" id="study-suggestion-move">Schedule catch-up</button>
            </div>
          </div>` : ""}

        ${reviewQueue.length ? `
          <div class="card">
            <div class="card-header flex items-center justify-between"><span>Due for Review</span><span class="tag text-[10px] font-normal opacity-70">${reviewQueue.length} subject${reviewQueue.length === 1 ? "" : "s"}</span></div>
            ${reviewQueue.map(e => {
              const tone = e.days >= 6 ? { bg: "#FBE1DC", fg: "#A63A2A" } : e.days >= 4 ? { bg: "var(--lp-amber-soft)", fg: "#8C5E13" } : { bg: "var(--lp-green-soft)", fg: "#1F6B4F" };
              return `
                <div class="study-review-row">
                  <div class="study-review-badge" style="background:${tone.bg}; color:${tone.fg};">${e.days}d</div>
                  <div class="study-review-info"><div class="rname">${e.subject}</div><div class="rmeta">last studied ${e.days} day${e.days === 1 ? "" : "s"} ago</div></div>
                </div>`;
            }).join("")}
          </div>` : ""}

        <div class="card">
          <div class="card-header flex items-center justify-between">
            <span>Subjects</span>
            <span class="tag text-[10px] font-normal opacity-70">${new Set(allBlocks.map(b => b.subject)).size} total</span>
          </div>
          ${renderSubjectsPanel(allBlocks, false)}
        </div>
      </div>
    </div>
  `;

  content.querySelectorAll("[data-block-id]").forEach(el => {
    el.addEventListener("click", async (e) => {
      if (e.target.closest("[data-block-delete]")) return;
      const id = el.dataset.blockId;
      const nowDone = !el.classList.contains("done");
      el.classList.toggle("done");
      try {
        await patch(`/api/study-blocks/${id}`, { completed: nowDone });
        render();
      } catch (err) {
        el.classList.toggle("done"); // revert the optimistic flip
        showToast(apiErrorMessage(err, "Couldn't update that session"), "error");
      }
    });
  });
  content.querySelectorAll("[data-block-delete]").forEach(el => {
    el.addEventListener("click", async (e) => {
      e.stopPropagation();
      await del(`/api/study-blocks/${el.dataset.blockDelete}`);
      showToast("Session removed", "success");
      render();
    });
  });

  document.getElementById("study-new-session").addEventListener("click", () => openAddStudyBlockModal(DAYS, todayISO));

  // ---- focus timer wiring ----
  document.getElementById("study-timer-block-select")?.addEventListener("change", (e) => {
    if (studyTimerState.running) {
      showToast("Stop the running timer before switching session", "warning");
      render();
      return;
    }
    studyTimerState.blockId = e.target.value;
    render();
  });

  // One button, two states. Start posts to the server; stop lets the server
  // work out the minutes from started_at, so a tab that was asleep for an hour
  // still logs the hour.
  document.getElementById("study-timer-toggle").addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      if (studyTimerState.running) {
        const r = await post(`/api/study-timer/stop`, {});
        showToast(r.logged ? `Logged ${r.minutes}m${r.subject ? " of " + r.subject : ""}`
                           : "Under a minute — nothing logged", r.logged ? "success" : "info");
      } else {
        const body = activeBlock ? { block_id: activeBlock.id }
                                 : { subject: await promptStudySubject() };
        if (body.subject === null) { btn.disabled = false; return; }   // cancelled
        await post(`/api/study-timer/start`, body);
      }
      await syncStudyTimer();
      render();
    } catch (err) {
      showToast(apiErrorMessage(err, "Couldn't change the timer"), "error");
      btn.disabled = false;
    }
  });

  document.getElementById("study-timer-reset").addEventListener("click", async () => {
    if (!studyTimerState.running) return;
    const ok = await showConfirmModal({
      title: "Discard this session?",
      message: `${formatTimer(studyElapsedSeconds())} will be thrown away rather than logged.`,
      confirmLabel: "Discard",
    });
    if (!ok) return;
    try {
      await post(`/api/study-timer/stop?discard=true`, {});
      await syncStudyTimer();
      showToast("Timer discarded", "info");
      render();
    } catch (err) { showToast(apiErrorMessage(err, "Couldn't discard the timer"), "error"); }
  });

  document.getElementById("study-timer-finish")?.addEventListener("click", async () => {
    if (!activeBlock) return;
    try {
      if (studyTimerState.running) {
        // Stopping a block timer already ticks the block and writes the
        // session — doing it here as well would double-count the minutes.
        const r = await post(`/api/study-timer/stop`, {});
        showToast(r.logged ? `Logged ${r.minutes}m on ${activeBlock.subject}`
                           : `Marked ${activeBlock.subject} done`, "success");
      } else {
        await patch(`/api/study-blocks/${activeBlock.id}`, { completed: true });
        showToast(`Marked ${activeBlock.subject} done`, "success");
      }
      await syncStudyTimer();
      studyTimerState.blockId = null;
      render();
    } catch (err) { showToast(apiErrorMessage(err, "Couldn't finish that session"), "error"); }
  });

  if (studyTimerState.running) startStudyTicking(); else stopStudyTicking();

  // ---- adaptive suggestion wiring ----
  document.getElementById("study-suggestion-dismiss")?.addEventListener("click", () => {
    dismissed.add(suggestion.subject);
    render();
  });
  document.getElementById("study-suggestion-move")?.addEventListener("click", async () => {
    await post(`/api/study-blocks`, {
      date: suggestion.slot.date, subject: suggestion.subject,
      start_time: suggestion.slot.start, end_time: suggestion.slot.end,
      notes: "Catch-up session (adaptive reschedule)",
    });
    showToast("Catch-up session scheduled", "success");
    render();
  });
}

// ============================================================================
// ADMIN DASHBOARD
// ============================================================================
const ADMIN_TABS = [
  { id: "insights", label: "Insights" },
  { id: "users", label: "Users" },
  { id: "database", label: "Database" },
];

async function renderAdmin(content) {
  const adminState = { tab: "insights" };
  const [users, stats] = await Promise.all([get(`/api/admin/users`), get(`/api/admin/stats`)]);
  const me = auth.getUser();

  content.innerHTML = `
    <div class="view-tabs mb-5" id="admin-tabs">
      ${ADMIN_TABS.map(t => `<button type="button" class="view-tab ${t.id === "insights" ? "active" : ""}" data-admin-tab="${t.id}">${t.label}</button>`).join("")}
    </div>
    <div id="admin-tab-content"></div>
  `;

  document.querySelectorAll("[data-admin-tab]").forEach(el => {
    el.addEventListener("click", () => {
      adminState.tab = el.dataset.adminTab;
      document.querySelectorAll("[data-admin-tab]").forEach(b => b.classList.toggle("active", b.dataset.adminTab === adminState.tab));
      renderAdminTab();
    });
  });

  function renderAdminTab() {
    if (adminState.tab === "insights") renderAdminInsights();
    else if (adminState.tab === "users") renderAdminUsers();
    else renderAdminDatabase();
  }

  // ============================================================
  // INSIGHTS — the real admin dashboard: KPIs, distributions, trends
  // ============================================================
  function renderAdminInsights() {
    const totalContent = stats.total_habits + stats.total_tasks + stats.total_jobs + stats.total_resumes + stats.total_study_blocks;
    const roleColors = ["#3D5AFE", "#6366F1"];
    const jobColors = { applied: "#9CA3AF", oa_test: "#3B82F6", phone_screen: "#6366F1", interview: "#F59E0B", offer: "#10B981", rejected: "#EF4444", ghosted: "#9CA3AF", withdrawn: "#9CA3AF" };
    const jobEntries = Object.entries(stats.job_status_counts || {});

    const tab = document.getElementById("admin-tab-content");
    tab.innerHTML = `
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 mb-5">
        ${statCard("Total Users", stats.total_users, `${stats.admin_count} admin${stats.admin_count === 1 ? "" : "s"}`)}
        ${statCard("Engagement Rate", `${stats.engagement_rate}%`, `${stats.active_users} of ${stats.total_users} active`)}
        ${statCard("Content Created", totalContent, "habits + tasks + jobs + resumes")}
        ${statCard("Job Applications", stats.total_jobs, `${stats.avg_jobs_per_user}/user avg`)}
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-3 gap-5 mb-5">
        <div class="card lg:col-span-2">
          <div class="card-header">Signups — Last 8 Weeks</div>
          <div class="p-5 dash-chart-box--lg"><canvas id="admin-signups-bar"></canvas></div>
        </div>
        <div class="card">
          <div class="card-header">User Roles</div>
          <div class="p-5"><canvas id="admin-role-donut" height="180"></canvas></div>
        </div>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-3 gap-5 mb-5">
        <div class="card">
          <div class="card-header">Job Pipeline — Platform-wide</div>
          <div class="p-5">${jobEntries.length ? `<canvas id="admin-job-donut" height="200"></canvas>` : `<p class="text-sm text-gray-400 text-center py-8">No job applications yet.</p>`}</div>
        </div>
        <div class="card">
          <div class="card-header">Average Activity per User</div>
          <div class="p-5 space-y-4">
            <div>
              <div class="flex justify-between text-sm mb-1"><span>Habits</span><span class="font-bold">${stats.avg_habits_per_user}</span></div>
              <div class="progress-track"><div class="progress-fill" style="width:${Math.min(100, stats.avg_habits_per_user * 8)}%; background:#3D5AFE"></div></div>
            </div>
            <div>
              <div class="flex justify-between text-sm mb-1"><span>Tasks</span><span class="font-bold">${stats.avg_tasks_per_user}</span></div>
              <div class="progress-track"><div class="progress-fill" style="width:${Math.min(100, stats.avg_tasks_per_user * 1.5)}%; background:#6366F1"></div></div>
            </div>
            <div>
              <div class="flex justify-between text-sm mb-1"><span>Job Applications</span><span class="font-bold">${stats.avg_jobs_per_user}</span></div>
              <div class="progress-track"><div class="progress-fill" style="width:${Math.min(100, stats.avg_jobs_per_user * 10)}%; background:#F59E0B"></div></div>
            </div>
          </div>
        </div>
        <div class="card">
          <div class="card-header">Platform Totals</div>
          <div class="divide-y divide-gray-50">
            <div class="flex justify-between px-4 py-2.5 text-sm"><span class="text-gray-500">Habits</span><span class="font-bold">${stats.total_habits}</span></div>
            <div class="flex justify-between px-4 py-2.5 text-sm"><span class="text-gray-500">Tasks</span><span class="font-bold">${stats.total_tasks}</span></div>
            <div class="flex justify-between px-4 py-2.5 text-sm"><span class="text-gray-500">Study blocks</span><span class="font-bold">${stats.total_study_blocks}</span></div>
            <div class="flex justify-between px-4 py-2.5 text-sm"><span class="text-gray-500">Resumes</span><span class="font-bold">${stats.total_resumes}</span></div>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-header">🏆 Most Active Users</div>
        <div class="divide-y divide-gray-50">
          ${(stats.top_active_users || []).map((u, i) => `
            <div class="flex items-center gap-4 px-4 py-3">
              <span class="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${i === 0 ? "bg-amber-100 text-amber-700" : "bg-gray-100 text-gray-500"}">${i + 1}</span>
              <div class="flex-1 min-w-0">
                <p class="text-sm font-semibold truncate">${esc(u.name)}</p>
                <p class="text-xs text-gray-400 truncate">${esc(u.email)}</p>
              </div>
              <div class="flex gap-4 text-xs text-gray-500 shrink-0">
                <span>${u.habits} habits</span><span>${u.tasks} tasks</span><span>${u.jobs} jobs</span>
              </div>
              <span class="badge bg-navy text-white shrink-0">${u.total} total</span>
            </div>
          `).join("") || `<p class="text-sm text-gray-400 p-4">No activity yet.</p>`}
        </div>
      </div>
    `;

    barChart("admin-signups-bar", stats.signups_last_8_weeks.map(w => w.week_start.slice(5)), stats.signups_last_8_weeks.map(w => w.count));
    multiDonutChart("admin-role-donut", ["Users", "Admins"], [stats.total_users - stats.admin_count, stats.admin_count], roleColors);
    if (jobEntries.length) {
      multiDonutChart("admin-job-donut", jobEntries.map(([k]) => STATUS_LABELS[k] || k), jobEntries.map(([, v]) => v),
        jobEntries.map(([k]) => jobColors[k] || "#9CA3AF"));
    }
  }

  // ============================================================
  // USERS — account management table
  // ============================================================
  function renderAdminUsers() {
    const tab = document.getElementById("admin-tab-content");
    tab.innerHTML = `
      <div class="card overflow-x-auto">
        <div class="card-header">All Users</div>
        <table class="w-full text-sm min-w-[640px]">
          <thead><tr class="text-left text-gray-500 border-b border-gray-100">
            <th class="p-3">Name</th><th class="p-3">Email</th><th class="p-3">Role</th>
            <th class="p-3">Status</th><th class="p-3">Habits</th><th class="p-3">Tasks</th>
            <th class="p-3">Jobs</th><th class="p-3">Joined</th><th class="p-3"></th>
          </tr></thead>
          <tbody id="admin-users-body"></tbody>
        </table>
      </div>
    `;

    document.getElementById("admin-users-body").innerHTML = users.map(u => `
      <tr class="border-b border-gray-50">
        <td class="p-3 font-medium">${esc(u.name)}${u.id === me.id ? ' <span class="text-xs text-gray-400">(you)</span>' : ""}</td>
        <td class="p-3 text-gray-500">${esc(u.email)}</td>
        <td class="p-3">
          <select class="!w-auto" data-role-select="${u.id}" ${u.id === me.id ? "disabled" : ""}>
            <option value="user" ${u.role === "user" ? "selected" : ""}>User</option>
            <option value="admin" ${u.role === "admin" ? "selected" : ""}>Admin</option>
          </select>
        </td>
        <td class="p-3">
          <span class="badge ${u.is_active ? "bg-emerald-100 text-emerald-700" : "bg-gray-200 text-gray-500"} cursor-pointer" data-toggle-active="${u.id}" data-active="${u.is_active}">
            ${u.is_active ? "Active" : "Inactive"}
          </span>
        </td>
        <td class="p-3 text-gray-500">${u.habit_count}</td>
        <td class="p-3 text-gray-500">${u.task_count}</td>
        <td class="p-3 text-gray-500">${u.job_count}</td>
        <td class="p-3 text-gray-500 text-xs">${new Date(u.created_at).toLocaleDateString()}</td>
        <td class="p-3">${u.id === me.id ? "" : `<span class="text-gray-300 cursor-pointer" data-delete-user="${u.id}">✕</span>`}</td>
      </tr>`).join("");

    document.querySelectorAll("[data-role-select]").forEach(el => {
      el.addEventListener("change", async () => {
        await patch(`/api/admin/users/${el.dataset.roleSelect}`, { role: el.value });
        render();
      });
    });
    document.querySelectorAll("[data-toggle-active]").forEach(el => {
      el.addEventListener("click", async () => {
        if (el.dataset.toggleActive === String(me.id)) return;
        const newVal = el.dataset.active !== "true";
        await patch(`/api/admin/users/${el.dataset.toggleActive}`, { is_active: newVal });
        render();
      });
    });
    document.querySelectorAll("[data-delete-user]").forEach(el => {
      el.addEventListener("click", async () => {
        const ok = await showConfirmModal({ title: "Delete User", message: "This deletes the user and all their data. This can't be undone." });
        if (ok) {
          await del(`/api/admin/users/${el.dataset.deleteUser}`);
          showToast("User deleted", "success");
          render();
        }
      });
    });
  }

  // ============================================================
  // DATABASE — raw table explorer
  // ============================================================
  async function renderAdminDatabase() {
    const tab = document.getElementById("admin-tab-content");
    tab.innerHTML = `
      <div class="card">
        <div class="card-header flex items-center justify-between flex-wrap gap-2">
          <span>Database Explorer</span>
          <div class="flex items-center gap-2">
            <select id="db-table-select" class="!w-auto"></select>
            <button class="btn btn-ghost text-xs" id="db-prev-page">← Prev</button>
            <span id="db-page-label" class="text-xs text-white/70"></span>
            <button class="btn btn-ghost text-xs" id="db-next-page">Next →</button>
          </div>
        </div>
        <div class="overflow-x-auto">
          <table class="text-sm min-w-[640px]" id="db-explorer-table">
            <thead><tr id="db-explorer-head" class="text-left text-gray-500 border-b border-gray-100"></tr></thead>
            <tbody id="db-explorer-body"></tbody>
          </table>
        </div>
        <p class="text-xs text-gray-400 p-3">Passwords are always redacted. Long text fields are truncated here — use the PDF export for full values.</p>
      </div>
    `;

    const dbTables = await get(`/api/admin/db/tables`);
    const dbState = { table: dbTables[0]?.name, page: 1 };

    const tableSelect = document.getElementById("db-table-select");
    tableSelect.innerHTML = dbTables.map(t => `<option value="${t.name}">${t.name} (${t.row_count})</option>`).join("");
    tableSelect.addEventListener("change", () => { dbState.table = tableSelect.value; dbState.page = 1; loadDbTable(); });
    document.getElementById("db-prev-page").addEventListener("click", () => { if (dbState.page > 1) { dbState.page--; loadDbTable(); } });
    document.getElementById("db-next-page").addEventListener("click", () => { dbState.page++; loadDbTable(); });

    async function loadDbTable() {
      if (!dbState.table) return;
      const result = await get(`/api/admin/db/tables/${dbState.table}?page=${dbState.page}&page_size=25`);
      const totalPages = Math.max(1, Math.ceil(result.total / result.page_size));
      document.getElementById("db-page-label").textContent = `Page ${result.page} of ${totalPages} (${result.total} rows)`;
      document.getElementById("db-explorer-head").innerHTML = result.columns.map(c => `<th class="p-2 whitespace-nowrap">${c}</th>`).join("");
      document.getElementById("db-explorer-body").innerHTML = result.rows.length ? result.rows.map(row => `
        <tr class="border-b border-gray-50">
          ${result.columns.map(c => `<td class="p-2 text-xs text-gray-600 whitespace-nowrap max-w-[220px] overflow-hidden text-ellipsis">${row[c] === null || row[c] === undefined ? '<span class="text-gray-300">null</span>' : esc(String(row[c]))}</td>`).join("")}
        </tr>`).join("") : `<tr><td colspan="${result.columns.length}" class="p-4 text-center text-gray-400 text-xs">No rows in this table.</td></tr>`;
    }
    await loadDbTable();
  }

  renderAdminTab();
}

// ============================================================================
// MOMENTUM ASSISTANT — floating chat widget
// Talks to /api/chat, which runs entirely locally on the backend: a real
// local Llama model if one's been configured (see backend/models/README.md),
// or a built-in "lite" responder otherwise — either way, zero external AI
// API calls, and the widget works immediately with no setup required.
// ============================================================================
const chatState = { open: false, history: [], sending: false, statusChecked: false, available: false, mode: null };

let chatWidgetInitialized = false;

function initChatWidget() {
  if (chatWidgetInitialized) return;
  chatWidgetInitialized = true;
  const toggle = document.getElementById("chat-toggle");
  const closeBtn = document.getElementById("chat-close");
  const sendBtn = document.getElementById("chat-send");
  const input = document.getElementById("chat-input");

  toggle.addEventListener("click", () => {
    // Check the panel's actual DOM state rather than only chatState.open —
    // if the two ever drift apart (e.g. after a session-expiry bounce back
    // to the login screen), trusting the DOM directly means the button
    // still does the right thing instead of silently doing nothing.
    const isOpen = !document.getElementById("chat-panel").classList.contains("hidden");
    isOpen ? closeChatPanel() : openChatPanel();
  });
  closeBtn.addEventListener("click", closeChatPanel);
  sendBtn.addEventListener("click", sendChatMessage);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendChatMessage(); }
  });
  input.addEventListener("input", () => {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 96) + "px";
    document.getElementById("chat-send").disabled = !input.value.trim();
  });
  document.getElementById("chat-send").disabled = true;
}

function openChatPanel() {
  chatState.open = true;
  document.getElementById("chat-panel").classList.remove("hidden");
  document.getElementById("chat-toggle-face").classList.add("hidden");
  document.getElementById("chat-toggle-x").classList.remove("hidden");
  spawnSparkleBurst();
  if (!chatState.statusChecked) checkChatStatus();
  document.getElementById("chat-input").focus();
}
function closeChatPanel() {
  chatState.open = false;
  document.getElementById("chat-panel").classList.add("hidden");
  document.getElementById("chat-toggle-face").classList.remove("hidden");
  document.getElementById("chat-toggle-x").classList.add("hidden");
}

function resetChatWidgetState() {
  chatState.open = false;
  document.getElementById("chat-panel")?.classList.add("hidden");
  document.getElementById("chat-toggle-face")?.classList.remove("hidden");
  document.getElementById("chat-toggle-x")?.classList.add("hidden");
}

function spawnSparkleBurst() {
  const toggle = document.getElementById("chat-toggle");
  const colors = ["#3D5AFE", "#F5C518", "#6366F1", "#F43F5E"];
  for (let i = 0; i < 6; i++) {
    const dot = document.createElement("span");
    const angle = (Math.PI * 2 * i) / 6 + Math.random() * 0.4;
    const distance = 34 + Math.random() * 18;
    dot.className = "sparkle-burst-dot";
    dot.style.background = colors[i % colors.length];
    dot.style.setProperty("--dx", `${Math.cos(angle) * distance}px`);
    dot.style.setProperty("--dy", `${Math.sin(angle) * distance}px`);
    toggle.appendChild(dot);
    dot.addEventListener("animationend", () => dot.remove());
  }
}

function setChatStatusUI(mode, label) {
  const dot = document.getElementById("chat-status-dot");
  const text = document.getElementById("chat-status-text");
  dot.className = "w-1.5 h-1.5 rounded-full inline-block " + (
    mode === "llm" ? "bg-emerald-400" : mode === "lite" ? "bg-amber-300" : "bg-red-400"
  );
  text.textContent = label;
}

async function checkChatStatus() {
  chatState.statusChecked = true;
  setChatStatusUI(null, "checking…");
  try {
    const status = await get("/api/chat/status");
    chatState.available = !!status.available;
    chatState.mode = status.mode;
    if (status.mode === "llm") {
      setChatStatusUI("llm", "Local AI model active");
    } else {
      setChatStatusUI("lite", "Lite mode (built-in)");
    }
    appendChatBubble("assistant", "Hi! I'm your Momentum Assistant. Ask me about your habits, job search, or resume — I run entirely on-device, no external AI service involved.");
  } catch (e) {
    chatState.available = false;
    setChatStatusUI("error", "Unavailable");
    appendChatBubble("assistant", "⚠️ Couldn't reach the assistant service. Make sure the backend is running.");
  }
}

function appendChatBubble(role, text) {
  const messages = document.getElementById("chat-messages");
  const wrap = document.createElement("div");
  wrap.className = role === "user" ? "flex justify-end" : "flex justify-start";
  const bubble = document.createElement("div");
  bubble.className = "chat-bubble " + (role === "user" ? "chat-bubble-user" : "chat-bubble-assistant");
  bubble.innerHTML = escapeHTML(text).replace(/\n/g, "<br>");
  wrap.appendChild(bubble);
  messages.appendChild(wrap);
  messages.scrollTop = messages.scrollHeight;
  return wrap;
}

function appendTypingIndicator() {
  const messages = document.getElementById("chat-messages");
  const wrap = document.createElement("div");
  wrap.className = "flex justify-start";
  wrap.innerHTML = `<div class="chat-bubble chat-bubble-assistant"><span class="typing-dots"><span></span><span></span><span></span></span></div>`;
  messages.appendChild(wrap);
  messages.scrollTop = messages.scrollHeight;
  return wrap;
}

function escapeHTML(s) {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

async function sendChatMessage() {
  const input = document.getElementById("chat-input");
  const sendBtn = document.getElementById("chat-send");
  const text = input.value.trim();
  if (!text || chatState.sending) return;

  input.value = "";
  input.style.height = "auto";
  sendBtn.disabled = true;
  appendChatBubble("user", text);
  chatState.history.push({ role: "user", content: text });
  chatState.sending = true;

  const typingBubble = appendTypingIndicator();
  try {
    const res = await post("/api/chat", { message: text, history: chatState.history.slice(-8) });
    typingBubble.remove();
    if (res.error) {
      appendChatBubble("assistant", `⚠️ ${res.error}`);
    } else {
      appendChatBubble("assistant", res.reply);
      chatState.history.push({ role: "assistant", content: res.reply });
      if (res.mode && res.mode !== chatState.mode) {
        chatState.mode = res.mode;
        setChatStatusUI(res.mode, res.mode === "llm" ? "Local AI model active" : "Lite mode (built-in)");
      }
    }
  } catch (e) {
    typingBubble.remove();
    appendChatBubble("assistant", "⚠️ Something went wrong reaching the assistant.");
  } finally {
    chatState.sending = false;
  }
}

// ============================================================================
// GLOBAL SEARCH — one search across tasks, jobs, and habits (Ctrl/Cmd+K)
// ============================================================================
let searchDebounceTimer = null;
let globalSearchInitialized = false;

function initGlobalSearch() {
  if (globalSearchInitialized) return;
  globalSearchInitialized = true;
  document.getElementById("global-search-trigger").addEventListener("click", openGlobalSearch);
  document.getElementById("global-search-input").addEventListener("input", (e) => {
    clearTimeout(searchDebounceTimer);
    const term = e.target.value;
    searchDebounceTimer = setTimeout(() => runGlobalSearch(term), 220);
  });
  document.querySelector("[data-search-backdrop]").addEventListener("click", closeGlobalSearch);
  document.addEventListener("keydown", (e) => {
    const overlay = document.getElementById("global-search-overlay");
    const isOpen = !overlay.classList.contains("hidden");
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      isOpen ? closeGlobalSearch() : openGlobalSearch();
    } else if (e.key === "Escape" && isOpen) {
      closeGlobalSearch();
    }
  });
}

function openGlobalSearch() {
  const overlay = document.getElementById("global-search-overlay");
  overlay.classList.remove("hidden");
  const input = document.getElementById("global-search-input");
  input.value = "";
  document.getElementById("global-search-results").innerHTML = `<p class="text-xs text-gray-400 text-center py-8">Start typing to search your tasks, jobs, and habits.</p>`;
  input.focus();
}
function closeGlobalSearch() {
  document.getElementById("global-search-overlay").classList.add("hidden");
}

async function runGlobalSearch(term) {
  const resultsEl = document.getElementById("global-search-results");
  if (!term || term.trim().length < 2) {
    resultsEl.innerHTML = `<p class="text-xs text-gray-400 text-center py-8">Keep typing — at least 2 characters.</p>`;
    return;
  }
  let data;
  try {
    data = await get(`/api/search?q=${encodeURIComponent(term.trim())}`);
  } catch (e) {
    resultsEl.innerHTML = `<p class="text-xs text-red-500 text-center py-8">Search failed.</p>`;
    return;
  }
  const hasResults = data.tasks.length || data.jobs.length || data.habits.length ||
    data.resumes.length || data.study_blocks.length || data.weekly_notes.length;
  if (!hasResults) {
    resultsEl.innerHTML = `<p class="text-xs text-gray-400 text-center py-8">No matches for "${escapeHTML(term)}".</p>`;
    return;
  }

  let html = "";
  if (data.tasks.length) {
    html += `<div class="search-result-group-label">Tasks</div>`;
    html += data.tasks.map(t => `
      <div class="search-result-item" data-search-nav="task" data-search-date="${t.date}">
        <span class="checkbox ${t.completed ? "checked" : ""}" style="pointer-events:none; width:16px; height:16px;"></span>
        <span class="text-sm flex-1 truncate">${esc(t.title)}${tagChips(t.tags)}</span>
        <span class="text-xs text-gray-400 shrink-0">${t.date}</span>
      </div>`).join("");
  }
  if (data.jobs.length) {
    html += `<div class="search-result-group-label">Job Applications</div>`;
    html += data.jobs.map(j => `
      <div class="search-result-item" data-search-nav="job">
        <span class="badge ${STATUS_COLORS[j.status] || "bg-gray-100 text-gray-700"} shrink-0">${STATUS_LABELS[j.status] || j.status}</span>
        <span class="text-sm flex-1 truncate"><b>${esc(j.company_name)}</b> — ${esc(j.role_title)}${tagChips(j.tags)}</span>
      </div>`).join("");
  }
  if (data.habits.length) {
    html += `<div class="search-result-group-label">Habits</div>`;
    html += data.habits.map(h => `
      <div class="search-result-item" data-search-nav="habit">
        <span>📆</span>
        <span class="text-sm flex-1 truncate">${esc(h.title)}</span>
        <span class="text-xs text-gray-400 shrink-0">${esc(h.category || "")}</span>
      </div>`).join("");
  }
  if (data.resumes.length) {
    html += `<div class="search-result-group-label">Resumes</div>`;
    html += data.resumes.map(r => `
      <div class="search-result-item" data-search-nav="resume">
        <span>📄</span>
        <span class="text-sm flex-1 truncate">${esc(r.name)}</span>
      </div>`).join("");
  }
  if (data.study_blocks.length) {
    html += `<div class="search-result-group-label">Study Plan</div>`;
    html += data.study_blocks.map(s => `
      <div class="search-result-item" data-search-nav="study">
        <span>📚</span>
        <span class="text-sm flex-1 truncate">${esc(s.subject)}</span>
        <span class="text-xs text-gray-400 shrink-0">${s.date} · ${s.start_time}</span>
      </div>`).join("");
  }
  if (data.weekly_notes.length) {
    html += `<div class="search-result-group-label">Weekly Notes</div>`;
    html += data.weekly_notes.map(w => `
      <div class="search-result-item" data-search-nav="weeklynote" data-search-week="${w.week_start_date}">
        <span>📝</span>
        <span class="text-sm flex-1 truncate">${esc(w.focus_text || w.reward_text || w.affirmation_text || "Weekly note")}</span>
        <span class="text-xs text-gray-400 shrink-0">Week of ${w.week_start_date}</span>
      </div>`).join("");
  }
  resultsEl.innerHTML = html;

  resultsEl.querySelectorAll("[data-search-nav]").forEach(el => {
    el.addEventListener("click", () => {
      const kind = el.dataset.searchNav;
      closeGlobalSearch();
      if (kind === "task") {
        state.day = fromISO(el.dataset.searchDate);
        state.page = "day";
        state.trackerLastPage = "day";
      } else if (kind === "job") {
        state.page = "jobs";
      } else if (kind === "habit") {
        state.page = "week";
        state.trackerLastPage = "week";
      } else if (kind === "resume") {
        state.page = "resumes";
      } else if (kind === "study") {
        state.page = "study";
      } else if (kind === "weeklynote") {
        state.weekStart = fromISO(el.dataset.searchWeek);
        state.page = "week";
        state.trackerLastPage = "week";
      }
      renderNav();
      scrollPageTo(0);
      render();
    });
  });
}

// ============================================================================
// BACKEND CONNECTIVITY CHECK — the most common deploy issue is the frontend
// being served from a different host than the backend, with no
// MOMENTUM_API_BASE set to point at it. Rather than let every request fail
// with a cryptic network error, actively check once on load and show a
// clear, actionable banner if the backend can't be reached at all.
// ============================================================================
async function checkBackendConnection() {
  const banner = document.getElementById("backend-status-banner");
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    const res = await fetch(`${API_BASE}/api/health`, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) throw new Error(`status ${res.status}`);
    banner.classList.add("hidden");
    return true;
  } catch (e) {
    // A browser fetch() failure here is ambiguous by design (the browser
    // deliberately hides the exact reason for cross-origin failures), so
    // rather than guess which one it is, list every likely cause.
    const code = (t) => `<code class="bg-white/20 px-1.5 py-0.5 rounded">${t}</code>`;
    banner.innerHTML = `
      <div class="text-left max-w-2xl">
        <p class="font-semibold mb-1">⚠️ Can't reach the backend at ${code(API_BASE)}</p>
        <ul class="text-xs space-y-0.5 list-disc list-inside text-white/90">
          <li>Is the backend actually running? (check the terminal it's started in)</li>
          <li>If using dev tunnels/Codespaces: is that port's tunnel forwarded and set to <b>Public</b>, not just visible to you?</li>
          <li>Does ${code("window.MOMENTUM_API_BASE")} in ${code("frontend/env.js")} exactly match the backend's URL, with no typo and no trailing slash?</li>
          <li>Does the backend's ${code("FRONTEND_ORIGINS")} (in the root ${code(".env")}) include this page's origin: ${code(window.location.origin)}?</li>
        </ul>
      </div>`;
    banner.classList.remove("hidden");
    return false;
  }
}

// ---------- boot ----------
// pdf.js is imported on demand so it isn't on the boot path, but "on demand"
// meant the first preview paid for the whole 1.33MB before it could draw. The
// preload hints in index.html get it into the HTTP cache; this parses and
// instantiates it once the browser is otherwise idle, so opening the builder
// finds the module already resolved rather than starting a download.
function rbWarmPdfLib() {
  const go = () => { rbPdfLib().catch(() => {}); };   // a failure here is not the customer's problem
  if (window.requestIdleCallback) requestIdleCallback(go, { timeout: 4000 });
  else setTimeout(go, 1500);
}

(async function boot() {
  checkBackendConnection(); // don't block boot on this — just surface the warning if it fails
  rbWarmPdfLib();
  if (auth.getToken()) {
    try {
      const user = await api("/api/auth/me");
      auth.set(auth.getToken(), user);
      showApp();
      return;
    } catch (e) {
      // A real 401 means the token itself was rejected — api() has already
      // cleared it and shown the login screen, so there's nothing left to do.
      //
      // Anything else (a dropped connection, the backend still waking up
      // from a cold start, a timeout, a mobile browser suspending/reloading
      // the tab mid-request) is NOT proof the session is invalid. Wiping a
      // good token here was exactly what made "switching tabs" look like it
      // logged people out on mobile: backgrounding a tab can make the
      // browser reload the page, boot() reruns, one flaky request comes
      // back, and a perfectly good login got thrown away.
      //
      // So: only clear on a confirmed 401. Otherwise, fall back to the
      // last-known user we already have cached and let the app load — any
      // page that actually needs fresh data will just refetch normally.
      if (e.status === 401) return;
      const cachedUser = auth.getUser();
      if (cachedUser) {
        showApp();
        return;
      }
    }
  }
  showAuthScreen();
})();

// ---- build + stylesheet self-check -----------------------------------------
// Several "the fix didn't work" reports turned out to be a stale file being
// served, not the fix. This makes that visible instead of leaving it to guesswork:
// the build stamp is logged, and a rule that only exists in the current
// stylesheet is probed. If it is missing, say so loudly.
(function verifyAssets() {
  const build = document.querySelector('meta[name="app-build"]')?.content || "unknown";
  window.MOMENTUM_BUILD = build;
  const probe = document.createElement("div");
  probe.className = "docs-chip";
  probe.style.position = "absolute";
  probe.style.visibility = "hidden";
  document.body.appendChild(probe);
  const styled = getComputedStyle(probe).borderRadius.startsWith("999");
  probe.remove();
  const tag = styled ? "%cMomentum build " + build : "%cMomentum build " + build + " — STYLESHEET IS STALE";
  console.info(tag, "color:#6C5DD3;font-weight:700");
  if (!styled) {
    console.warn(
      "[Momentum] styles.css is missing or out of date: the page is running current HTML/JS with an old stylesheet.\n" +
      "If you run the app in Docker: `docker compose up -d --build frontend` (the frontend is copied into the image).\n" +
      "Otherwise hard-refresh with Ctrl+Shift+R."
    );
    const bar = document.createElement("div");
    bar.style.cssText = "position:fixed;left:0;right:0;bottom:0;z-index:9999;padding:9px 14px;" +
      "background:#B45309;color:#fff;font:600 12px/1.4 system-ui,sans-serif;text-align:center";
    bar.textContent = "Old stylesheet in use — press Ctrl+Shift+R to load the current build (" + build + ")";
    bar.addEventListener("click", () => bar.remove());
    document.addEventListener("DOMContentLoaded", () => document.body.appendChild(bar));
    if (document.readyState !== "loading") document.body.appendChild(bar);
  }
})();

// The upgrade card's button. Bound once at load rather than in renderNav,
// which runs on every navigation and would stack a listener each time.
document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("sidebar-upgrade-btn")?.addEventListener("click", () => {
    navigate("profile");
    showToast("Plans and billing are coming soon — you're on the Free plan.", "info");
  });
});

// ============================================================================
// TELEGRAM — daily card settings
// ============================================================================
// The backend, the bot and the scheduler for this shipped without a UI, which
// left the one thing a person has to do — prove a chat belongs to their
// account — reachable only by calling the API by hand. Everything here is a
// thin front end over /api/telegram/*; the interesting logic lives in
// backend/app/telegram/.
//
// Three states, and which one you see is decided entirely by the server:
//   not configured -> no TELEGRAM_BOT_TOKEN on the server; nothing to connect to
//   not linked     -> issue a one-time code and wait for the tap
//   linked         -> settings, manual sends, disconnect

const TG_POLL_MS = 3000;      // while waiting for a tap, ask the server if it landed
let _tgPollTimer = null;

function tgStopPolling() {
  if (_tgPollTimer) { clearInterval(_tgPollTimer); _tgPollTimer = null; }
}

// Telegram messages are HTML with a tiny allowed tag set. Escaping everything
// and then re-enabling only those tags means the preview renders like the real
// card without letting anything from the database become live markup.
function tgPreviewHtml(text) {
  let out = esc(text || "");
  out = out.replace(/&lt;(\/?)(b|strong|i|em|u|s|code|pre)&gt;/g, "<$1$2>");
  return out.replace(/\n/g, "<br>");
}

function tgTimezones(current) {
  let zones = [];
  try { zones = Intl.supportedValuesOf("timeZone"); } catch (_) {}
  if (!zones.length) {
    zones = ["UTC", "Asia/Kolkata", "Europe/London", "Europe/Berlin", "America/New_York",
             "America/Chicago", "America/Denver", "America/Los_Angeles", "Asia/Dubai",
             "Asia/Singapore", "Asia/Tokyo", "Australia/Sydney"];
  }
  if (current && !zones.includes(current)) zones.unshift(current);
  return zones;
}

async function renderTelegram(content) {
  tgStopPolling();
  content.innerHTML = `<div class="tg-wrap"><div class="tg-card"><p class="tg-muted">Loading…</p></div></div>`;

  let s;
  try {
    s = await get("/api/telegram/status", { noCache: true });
  } catch (err) {
    content.innerHTML = `<div class="tg-wrap"><div class="tg-card">
      <h3>Couldn't load Telegram settings</h3>
      <p class="tg-muted">${esc(apiErrorMessage(err, "The backend didn't answer."))}</p>
    </div></div>`;
    return;
  }

  if (!s.configured) return tgRenderUnconfigured(content);
  if (!s.linked) return tgRenderConnect(content, s);
  return tgRenderLinked(content, s);
}

// ---------- state 1: the server has no bot token ----------
function tgRenderUnconfigured(content) {
  content.innerHTML = `
    <div class="tg-wrap">
      <div class="tg-card tg-hero">
        <div class="tg-hero-icon">✈️</div>
        <div>
          <h3>Telegram isn't set up on this server</h3>
          <p class="tg-muted">Every morning the bot can send your habits, tasks and study
             blocks as one tappable card. Ticking something there writes to the same
             account you're looking at now.</p>
        </div>
      </div>
      <div class="tg-card">
        <h3>To switch it on</h3>
        <ol class="tg-steps">
          <li>Message <a href="https://t.me/BotFather" target="_blank" rel="noopener">@BotFather</a>
              on Telegram and send <code>/newbot</code>.</li>
          <li>Copy the token it gives you into <code>.env</code> in the project root:
              <div class="tg-code">TELEGRAM_BOT_TOKEN=123456789:AA…</div></li>
          <li>Restart the backend. Look for
              <code>telegram: enabled — starting poller and scheduler</code> in the log.</li>
        </ol>
        <p class="tg-hint">Run <code>python backend/telegram_doctor.py</code> if it doesn't
           come up — it checks the token against Telegram and says which part is wrong.</p>
      </div>
    </div>`;
}

// ---------- state 2: configured, waiting to be linked ----------
function tgRenderConnect(content, s) {
  content.innerHTML = `
    <div class="tg-wrap">
      <div class="tg-card tg-hero">
        <div class="tg-hero-icon">✈️</div>
        <div>
          <h3>Connect Telegram</h3>
          <p class="tg-muted">One message each morning with today's habits, tasks and study
             blocks — as checkboxes you can tap. Ticking one saves straight to this account.</p>
        </div>
      </div>

      <div class="tg-card">
        <h3>Link this account to a chat</h3>
        <p class="tg-muted">You'll get a single-use code that proves the chat is yours.
           It expires in a few minutes.</p>
        <div class="tg-actions">
          <button class="tg-btn tg-btn-primary" id="tg-get-code">Connect Telegram</button>
          ${s.bot_username ? `<span class="tg-hint">Bot: <b>@${esc(s.bot_username)}</b></span>` : ""}
        </div>
        <div id="tg-code-box"></div>
      </div>
    </div>`;

  document.getElementById("tg-get-code").addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.textContent = "Getting a code…";
    try {
      const res = await post("/api/telegram/link-code", {});
      tgShowCode(content, res);
    } catch (err) {
      showToast(apiErrorMessage(err, "Couldn't create a link code"), "error");
      btn.disabled = false;
      btn.textContent = "Connect Telegram";
    }
  });
}

function tgShowCode(content, res) {
  const box = document.getElementById("tg-code-box");
  const mins = Math.max(1, Math.round((res.expires_in_seconds || 900) / 60));
  box.innerHTML = `
    <div class="tg-linkbox">
      ${res.deep_link ? `
        <a class="tg-btn tg-btn-primary tg-btn-lg" href="${esc(res.deep_link)}" target="_blank" rel="noopener">
          Open Telegram and connect
        </a>
        <p class="tg-hint">Opens the chat with the code filled in — just tap <b>Start</b>.
           On a phone, scan or forward yourself this link.</p>
      ` : `
        <p class="tg-muted">The server couldn't work out the bot's username, so send this
           to your bot by hand:</p>
      `}
      <div class="tg-code tg-code-lg">/start ${esc(res.code)}</div>
      <p class="tg-hint">Single use · expires in about ${mins} minute${mins === 1 ? "" : "s"}.
         <span id="tg-wait">Waiting for you to tap Start…</span></p>
    </div>`;

  // Poll rather than make people refresh: the tap happens on another device,
  // so there's no event here to hang a listener on. Stops itself when the page
  // is replaced, otherwise it would keep hitting the API forever in a tab
  // someone left open on a different screen.
  tgStopPolling();
  _tgPollTimer = setInterval(async () => {
    if (state.page !== "telegram" || !document.body.contains(box)) return tgStopPolling();
    try {
      const s2 = await get("/api/telegram/status", { noCache: true });
      if (s2.linked) {
        tgStopPolling();
        showToast("Telegram connected 🎉", "success");
        renderTelegram(content);
      }
    } catch (_) { /* transient — keep waiting */ }
  }, TG_POLL_MS);
}

// ---------- state 3: linked ----------
function tgRenderLinked(content, s) {
  const who = s.username ? "@" + s.username : (s.first_name || "your chat");
  const zones = tgTimezones(s.timezone);
  content.innerHTML = `
    <div class="tg-wrap">
      <div class="tg-card tg-hero">
        <div class="tg-hero-icon">✈️</div>
        <div>
          <h3>Connected to ${esc(who)}</h3>
          <p class="tg-muted">
            ${s.paused ? "⏸️ Paused — no cards are being sent." :
              `Next card at <b>${esc(s.daily_time || "07:30")}</b> your time.`}
            ${s.local_time ? ` It's <b>${esc(s.local_time)}</b> there now.` : ""}
          </p>
        </div>
        <div class="tg-hero-actions">
          <button class="tg-btn" id="tg-send-now">Send now</button>
          <button class="tg-btn" id="tg-close-day">Close the day now</button>
        </div>
      </div>

      <div class="tg-card">
        <h3>When it arrives</h3>
        <p class="tg-muted">A fresh card is sent at this time every day, in the timezone below.</p>
        <div class="tg-grid">
          <label class="tg-field"><span>New card every day at</span>
            <input type="time" id="tg-daily" value="${esc(s.daily_time || "07:30")}">
            <span class="tg-presets">
              ${["06:00", "07:00", "07:30", "08:00", "09:00", "00:00"].map(p =>
                `<button type="button" class="tg-preset ${p === (s.daily_time || "07:30") ? "on" : ""}" data-time="${p}">${p === "00:00" ? "midnight" : p}</button>`).join("")}
            </span></label>
          <label class="tg-field"><span>Day closes at</span>
            <input type="time" id="tg-evening" value="${esc(s.evening_time || "00:00")}"></label>
          <label class="tg-field tg-field-wide"><span>Timezone</span>
            <select id="tg-tz">
              ${zones.map(z => `<option value="${esc(z)}" ${z === s.timezone ? "selected" : ""}>${esc(z)}</option>`).join("")}
            </select></label>
        </div>
        <p class="tg-hint">Times are in the timezone above, not the server's — so 07:30
           means 07:30 where you are.</p>

        <p class="tg-hint">Midnight closes out the day that just ended, not the one starting —
           set 00:00 and the recap covers today.</p>

        <div class="tg-toggles">
          <label class="tg-toggle"><input type="checkbox" id="tg-close-done" ${s.close_when_done ? "checked" : ""}>
            <span><b>Close as soon as everything's ticked</b> — don't wait for the clock if the
              day is already finished.</span></label>
          <label class="tg-toggle"><input type="checkbox" id="tg-send-evening" ${s.send_evening ? "checked" : ""}>
            <span><b>Send a recap when the day closes</b> — a summary, and the card stops being tappable.</span></label>
          <label class="tg-toggle"><input type="checkbox" id="tg-carry" ${s.carry_over_tasks ? "checked" : ""}>
            <span><b>Carry unfinished tasks forward</b> — anything left undone moves to tomorrow.</span></label>
          <label class="tg-toggle"><input type="checkbox" id="tg-paused" ${s.paused ? "checked" : ""}>
            <span><b>Pause</b> — stop sending without disconnecting.</span></label>
        </div>

        <div class="tg-actions">
          <button class="tg-btn tg-btn-primary" id="tg-save">Save changes</button>
          <span class="tg-saved" id="tg-saved"></span>
        </div>
      </div>

      <div class="tg-card">
        <h3>Preview</h3>
        <p class="tg-muted">What today's card says right now.</p>
        <div class="tg-preview" id="tg-preview">Loading…</div>
      </div>

      <div class="tg-card tg-danger">
        <h3>Disconnect</h3>
        <p class="tg-muted">Stops all messages and unlinks the chat. Your habits, tasks and
           logged study minutes stay exactly as they are — only the connection goes.</p>
        <button class="tg-btn tg-btn-danger" id="tg-unlink">Disconnect Telegram</button>
      </div>
    </div>`;

  tgLoadPreview();

  // Presets are a shortcut, not a separate setting — they fill the input and
  // leave saving to the same button, so there's one way to commit a change.
  content.querySelectorAll(".tg-preset").forEach((chip) => {
    chip.addEventListener("click", () => {
      document.getElementById("tg-daily").value = chip.dataset.time;
      content.querySelectorAll(".tg-preset").forEach(c => c.classList.remove("on"));
      chip.classList.add("on");
    });
  });

  document.getElementById("tg-save").addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      await put("/api/telegram/settings", {
        daily_time: document.getElementById("tg-daily").value,
        evening_time: document.getElementById("tg-evening").value,
        timezone: document.getElementById("tg-tz").value,
        send_evening: document.getElementById("tg-send-evening").checked,
        close_when_done: document.getElementById("tg-close-done").checked,
        carry_over_tasks: document.getElementById("tg-carry").checked,
        paused: document.getElementById("tg-paused").checked,
      });
      const saved = document.getElementById("tg-saved");
      saved.textContent = "Saved";
      setTimeout(() => { saved.textContent = ""; }, 2500);
      renderTelegram(content);
    } catch (err) {
      showToast(apiErrorMessage(err, "Couldn't save those settings"), "error");
    } finally { btn.disabled = false; }
  });

  document.getElementById("tg-send-now").addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true; btn.textContent = "Sending…";
    try {
      await post("/api/telegram/send-now", {});
      showToast("Card sent — check Telegram", "success");
      tgLoadPreview();
    } catch (err) {
      showToast(apiErrorMessage(err, "Telegram wouldn't accept the message"), "error");
    } finally { btn.disabled = false; btn.textContent = "Send now"; }
  });

  document.getElementById("tg-close-day").addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true; btn.textContent = "Closing…";
    try {
      await post("/api/telegram/close-day", {});
      showToast("Recap sent and today's card closed", "success");
    } catch (err) {
      showToast(apiErrorMessage(err, "Couldn't run the evening step"), "error");
    } finally { btn.disabled = false; btn.textContent = "Close the day now"; }
  });

  document.getElementById("tg-unlink").addEventListener("click", async () => {
    const ok = await showConfirmModal({
      title: "Disconnect Telegram?",
      message: "The bot will stop sending cards to this chat. You can reconnect any time — nothing else is deleted.",
      confirmLabel: "Disconnect",
    });
    if (!ok) return;
    try {
      await del("/api/telegram/link");
      showToast("Telegram disconnected", "success");
      renderTelegram(content);
    } catch (err) {
      showToast(apiErrorMessage(err, "Couldn't disconnect"), "error");
    }
  });
}

async function tgLoadPreview() {
  const el = document.getElementById("tg-preview");
  if (!el) return;
  try {
    const p = await get("/api/telegram/preview", { noCache: true });
    const t = p.totals || {};
    el.innerHTML = `
      <div class="tg-bubble">${tgPreviewHtml(p.text)}</div>
      ${(p.buttons || []).length ? `<div class="tg-keys">
        ${p.buttons.map(row => `<div class="tg-keyrow">${row.map(b => `<span class="tg-key">${esc(b)}</span>`).join("")}</div>`).join("")}
      </div>` : ""}
      <p class="tg-hint">${t.habits_done ?? 0}/${t.habits ?? 0} habits ·
         ${t.tasks_done ?? 0}/${t.tasks ?? 0} tasks ·
         ${t.blocks_done ?? 0}/${t.blocks ?? 0} study blocks ·
         ${t.logged_minutes ?? 0} min logged</p>`;
  } catch (err) {
    el.innerHTML = `<p class="tg-muted">${esc(apiErrorMessage(err, "Couldn't build a preview."))}</p>`;
  }
}

// ============================================================================
// JOB HUNT — searching company job boards directly
// ============================================================================
// Not a scraper. Greenhouse, Lever, Ashby, Workable, SmartRecruiters and
// Recruitee each publish an open JSON endpoint so companies can render their
// own careers page; this reads those. See backend/app/jobhunt/providers.py for
// why that beats scraping LinkedIn.
//
// The tab is deliberately read-mostly: /run is the only slow call, everything
// else renders what the last run stored.

const JH_SINCE_PRESETS = [
  { days: 3, label: "3 days" }, { days: 7, label: "a week" },
  { days: 14, label: "2 weeks" }, { days: 30, label: "a month" },
  { days: 90, label: "3 months" },
];

function jhAgo(iso) {
  if (!iso) return "";
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

async function renderJobHunt(content) {
  content.innerHTML = `<div class="jh-wrap"><div class="jh-card"><p class="jh-muted">Loading…</p></div></div>`;
  let search, hits, boards, referrals;
  try {
    [search, hits, boards, referrals] = await Promise.all([
      get("/api/job-hunt/search", { noCache: true }),
      get("/api/job-hunt/hits", { noCache: true }),
      get("/api/job-hunt/boards", { noCache: true }),
      get("/api/job-hunt/referrals", { noCache: true }),
    ]);
  } catch (err) {
    content.innerHTML = `<div class="jh-wrap"><div class="jh-card">
      <h3>Couldn't load Job Hunt</h3><p class="jh-muted">${esc(apiErrorMessage(err, "The backend didn't answer."))}</p>
    </div></div>`;
    return;
  }

  const isNew = (h) => h.status === "new";
  const newCount = hits.filter(isNew).length;
  const saved = hits.filter(h => h.status === "saved");

  content.innerHTML = `
    <div class="jh-wrap">
      <div class="jh-card jh-setup">
        <div class="jh-setup-head">
          <div>
            <h3>What are you looking for?</h3>
            <p class="jh-muted">Searched across <b>${boards.length}</b> company job boards —
               Greenhouse, Lever, Ashby, Workable, SmartRecruiters and Recruitee.
               These are the companies' own listings, not a job aggregator.</p>
          </div>
          <button class="jh-btn jh-btn-primary" id="jh-run">Search now</button>
        </div>

        <div class="jh-grid">
          <label class="jh-field jh-field-wide"><span>Role — any of these words in the title</span>
            <input id="jh-roles" value="${esc(search.roles || "")}"
                   placeholder="data engineer, analytics engineer, python"></label>
          <label class="jh-field"><span>Country or city — blank means anywhere</span>
            <input id="jh-locations" value="${esc(search.locations || "")}"
                   placeholder="UK, Ireland, Berlin"></label>
          <label class="jh-field"><span>Exclude titles containing</span>
            <input id="jh-exclude" value="${esc(search.exclude || "")}"
                   placeholder="intern, senior, manager"></label>
        </div>

        <div class="jh-since">
          <span class="jh-since-lbl">Posted within</span>
          ${JH_SINCE_PRESETS.map(p => `
            <button type="button" class="jh-chip ${p.days === search.since_days ? "on" : ""}"
                    data-since="${p.days}">${p.label}</button>`).join("")}
          <span class="jh-hint">Older listings are usually filled.</span>
        </div>

        <div class="jh-toggles">
          <label class="jh-toggle"><input type="checkbox" id="jh-remote" ${search.remote_only ? "checked" : ""}>
            <span>Remote only</span></label>
          <label class="jh-toggle"><input type="checkbox" id="jh-auto" ${search.auto_daily ? "checked" : ""}>
            <span>Search every day automatically</span></label>
          <label class="jh-toggle"><input type="checkbox" id="jh-notify" ${search.notify_telegram ? "checked" : ""}>
            <span>Send new matches to Telegram</span></label>
        </div>

        <div class="jh-actions">
          <button class="jh-btn" id="jh-save">Save search</button>
          <span class="jh-hint" id="jh-status">${search.last_run_at
            ? `Last searched ${jhAgo(search.last_run_at)} · ${search.last_run_new} new`
            : "Not searched yet."}</span>
        </div>
      </div>

      <div class="jh-tabs">
        <button class="jh-tab on" data-jh-tab="results">Results ${newCount ? `<span class="jh-badge">${newCount} new</span>` : ""}</button>
        <button class="jh-tab" data-jh-tab="saved">Saved ${saved.length ? `(${saved.length})` : ""}</button>
        <button class="jh-tab" data-jh-tab="referrals">Referral contacts ${referrals.length ? `(${referrals.length})` : ""}</button>
        <button class="jh-tab" data-jh-tab="companies">Companies (${boards.length})</button>
      </div>

      <div id="jh-panel"></div>
    </div>`;

  const panels = {
    results: () => jhResultsPanel(hits.filter(h => h.status !== "saved")),
    saved: () => jhResultsPanel(saved),
    referrals: () => jhReferralsPanel(referrals),
    companies: () => jhCompaniesPanel(boards),
  };
  const showPanel = (key) => {
    document.getElementById("jh-panel").innerHTML = panels[key]();
    content.querySelectorAll(".jh-tab").forEach(b => b.classList.toggle("on", b.dataset.jhTab === key));
    jhBindPanel(content, key);
  };
  showPanel("results");
  content.querySelectorAll(".jh-tab").forEach(btn =>
    btn.addEventListener("click", () => showPanel(btn.dataset.jhTab)));

  // ---- setup wiring ----
  let sinceDays = search.since_days;
  content.querySelectorAll(".jh-chip").forEach(chip => chip.addEventListener("click", () => {
    sinceDays = Number(chip.dataset.since);
    content.querySelectorAll(".jh-chip").forEach(c => c.classList.remove("on"));
    chip.classList.add("on");
  }));

  const collect = () => ({
    roles: document.getElementById("jh-roles").value,
    locations: document.getElementById("jh-locations").value,
    exclude: document.getElementById("jh-exclude").value,
    since_days: sinceDays,
    remote_only: document.getElementById("jh-remote").checked,
    auto_daily: document.getElementById("jh-auto").checked,
    notify_telegram: document.getElementById("jh-notify").checked,
  });

  document.getElementById("jh-save").addEventListener("click", async (e) => {
    e.currentTarget.disabled = true;
    try {
      await put("/api/job-hunt/search", collect());
      showToast("Search saved", "success");
    } catch (err) { showToast(apiErrorMessage(err, "Couldn't save"), "error"); }
    finally { e.currentTarget.disabled = false; }
  });

  document.getElementById("jh-run").addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    const body = collect();
    if (!body.roles.trim()) { showToast("Type a role to search for first", "warning"); return; }
    btn.disabled = true;
    btn.textContent = "Searching…";
    // Saving first means the run uses what's on screen, not what was last
    // saved — otherwise editing a field and pressing Search does the old search.
    try {
      await put("/api/job-hunt/search", body);
      const r = await post("/api/job-hunt/run", {});
      showToast(r.new
        ? `${r.new} new — ${r.matched} matches across ${r.boards_ok} companies`
        : `No new postings — ${r.matched} matches, all seen before`,
        r.new ? "success" : "info");
      renderJobHunt(content);
    } catch (err) {
      showToast(apiErrorMessage(err, "The search failed"), "error");
      btn.disabled = false;
      btn.textContent = "Search now";
    }
  });
}

function jhResultsPanel(hits) {
  if (!hits.length) {
    return `<div class="jh-card jh-empty">
      <p class="jh-muted">Nothing here yet. Set a role above and press <b>Search now</b> —
         the first run takes a few seconds while it reads every company board.</p></div>`;
  }
  return `<div class="jh-results">${hits.map(h => `
    <div class="jh-hit ${h.status === "new" ? "is-new" : ""}" data-hit="${h.id}">
      <div class="jh-hit-main">
        <div class="jh-hit-top">
          ${h.status === "new" ? `<span class="jh-new">NEW</span>` : ""}
          <span class="jh-co">${esc(h.company)}</span>
          ${h.posted_at ? `<span class="jh-when">${jhAgo(h.posted_at)}</span>` : ""}
        </div>
        <a class="jh-title" href="${esc(h.url || "#")}" target="_blank" rel="noopener">${esc(h.title)}</a>
        <div class="jh-meta">
          ${h.location ? `<span>📍 ${esc(h.location)}</span>` : ""}
          ${h.department ? `<span>🏷 ${esc(h.department)}</span>` : ""}
          ${h.employment_type ? `<span>⏳ ${esc(h.employment_type)}</span>` : ""}
          ${h.remote ? `<span class="jh-remote">Remote</span>` : ""}
        </div>
        ${(h.referrals || []).length ? `
          <div class="jh-referral">🤝 You know
            ${h.referrals.map(r => `<b>${esc(r.name)}</b>${r.role ? ` (${esc(r.role)})` : ""}`).join(", ")}
            here${h.referrals[0].contact ? ` · ${esc(h.referrals[0].contact)}` : ""}</div>` : ""}
        ${h.description ? `<p class="jh-snip">${esc(h.description.slice(0, 180))}…</p>` : ""}
      </div>
      <div class="jh-hit-actions">
        <button class="jh-btn jh-btn-sm" data-jh-act="track" data-id="${h.id}">Track</button>
        <button class="jh-btn jh-btn-sm" data-jh-act="${h.status === "saved" ? "unsave" : "save"}" data-id="${h.id}">
          ${h.status === "saved" ? "Unsave" : "Save"}</button>
        <button class="jh-btn jh-btn-sm jh-btn-quiet" data-jh-act="dismiss" data-id="${h.id}">Hide</button>
      </div>
    </div>`).join("")}</div>`;
}

function jhReferralsPanel(referrals) {
  return `
    <div class="jh-card">
      <h3>People who could refer you</h3>
      <p class="jh-muted">A posting at a company you know somebody at is a different
         proposition to a cold application, so those results get flagged — in the
         list here and in the Telegram alert. Match on company name.</p>
      <div class="jh-grid">
        <label class="jh-field"><span>Company</span><input id="jh-rc-company" placeholder="Stripe"></label>
        <label class="jh-field"><span>Name</span><input id="jh-rc-name" placeholder="Alex Chen"></label>
        <label class="jh-field"><span>Their role</span><input id="jh-rc-role" placeholder="Engineering Manager"></label>
        <label class="jh-field"><span>Email or LinkedIn</span><input id="jh-rc-contact" placeholder="alex@stripe.com"></label>
      </div>
      <div class="jh-actions"><button class="jh-btn jh-btn-primary" id="jh-rc-add">Add contact</button></div>
      ${referrals.length ? `<div class="jh-contacts">${referrals.map(r => `
        <div class="jh-contact">
          <div><b>${esc(r.name)}</b>${r.role ? ` · ${esc(r.role)}` : ""}
            <div class="jh-muted">${esc(r.company)}${r.contact ? ` · ${esc(r.contact)}` : ""}</div></div>
          <button class="jh-btn jh-btn-sm jh-btn-quiet" data-jh-act="rc-del" data-id="${r.id}">Remove</button>
        </div>`).join("")}</div>` : `<p class="jh-hint">No contacts yet.</p>`}
    </div>`;
}

function jhCompaniesPanel(boards) {
  const byProvider = {};
  boards.forEach(b => { (byProvider[b.provider] ||= []).push(b); });
  return `
    <div class="jh-card">
      <h3>Companies searched</h3>
      <p class="jh-muted">Paste any careers page URL and the platform and company id are
         worked out from it. A board that stops answering is retired automatically after
         three failed runs, so the list doesn't rot.</p>
      <div class="jh-addrow">
        <input id="jh-board-url" placeholder="https://boards.greenhouse.io/company  ·  https://jobs.lever.co/company">
        <input id="jh-board-name" placeholder="Display name (optional)">
        <button class="jh-btn jh-btn-primary" id="jh-board-add">Add</button>
      </div>
      ${Object.entries(byProvider).map(([provider, list]) => `
        <div class="jh-provider">
          <div class="jh-provider-head">${esc(provider)} <span>${list.length}</span></div>
          <div class="jh-chips">${list.map(b => `
            <span class="jh-company" title="${esc(b.token)}${b.last_error ? " · " + esc(b.last_error) : ""}">
              ${esc(b.name)}${b.job_count ? `<i>${b.job_count}</i>` : ""}
              <button data-jh-act="board-del" data-id="${b.id}" title="Stop searching this one">×</button>
            </span>`).join("")}</div>
        </div>`).join("")}
    </div>`;
}

function jhBindPanel(content, key) {
  const panel = document.getElementById("jh-panel");

  panel.querySelectorAll("[data-jh-act]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.id;
      const act = btn.dataset.jhAct;
      btn.disabled = true;
      try {
        if (act === "save")    await patch(`/api/job-hunt/hits/${id}`, { status: "saved" });
        if (act === "unsave")  await patch(`/api/job-hunt/hits/${id}`, { status: "new" });
        if (act === "dismiss") await patch(`/api/job-hunt/hits/${id}`, { status: "dismissed" });
        if (act === "track") {
          await post(`/api/job-hunt/hits/${id}/track`, {});
          showToast("Added to Job Applications", "success");
        }
        if (act === "rc-del")    await del(`/api/job-hunt/referrals/${id}`);
        if (act === "board-del") await del(`/api/job-hunt/boards/${id}`);
        renderJobHunt(content);
      } catch (err) {
        showToast(apiErrorMessage(err, "That didn't work"), "error");
        btn.disabled = false;
      }
    });
  });

  if (key === "referrals") {
    document.getElementById("jh-rc-add")?.addEventListener("click", async () => {
      const company = document.getElementById("jh-rc-company").value.trim();
      const name = document.getElementById("jh-rc-name").value.trim();
      if (!company || !name) { showToast("Company and name are both needed", "warning"); return; }
      try {
        await post("/api/job-hunt/referrals", {
          company, name,
          role: document.getElementById("jh-rc-role").value.trim(),
          contact: document.getElementById("jh-rc-contact").value.trim(),
        });
        showToast("Contact added", "success");
        renderJobHunt(content);
      } catch (err) { showToast(apiErrorMessage(err, "Couldn't add that contact"), "error"); }
    });
  }

  if (key === "companies") {
    document.getElementById("jh-board-add")?.addEventListener("click", async (e) => {
      const url = document.getElementById("jh-board-url").value.trim();
      if (!url) { showToast("Paste a careers page URL", "warning"); return; }
      e.currentTarget.disabled = true;
      try {
        const b = await post("/api/job-hunt/boards", {
          url, name: document.getElementById("jh-board-name").value.trim() || null,
        });
        showToast(`Added ${b.name} (${b.provider})`, "success");
        renderJobHunt(content);
      } catch (err) {
        // The backend's 422 explains which platforms are supported, which is
        // the useful thing to show rather than a generic failure.
        showToast(apiErrorMessage(err, "Couldn't add that company"), "error");
        e.currentTarget.disabled = false;
      }
    });
  }
}
