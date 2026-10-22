// ============================================================================
// Momentum Tracker extension: AI bridge, app side
// ============================================================================
// Runs on every page but only wakes up on the Momentum web app itself. It is
// the doorway between the app and the extension for "use my own ChatGPT,
// Claude, Grok or Gemini": the app posts a request here, this hands it to the
// background worker, and the worker's progress and the AI's answer come back
// the same way.
//
// The doorway is guarded because what is on the other side is powerful: the
// person's logged in AI accounts. Any page could post a message to this
// script, so it only listens on the app's own origin (localhost, 127.0.0.1,
// or the host the extension is configured to use) and only to messages from
// the page's own window. The background worker checks the sender again.

(() => {
  if (window.__momentumAiBridgeApp) return;
  window.__momentumAiBridgeApp = true;

  const TAG = "__momentumAiBridge";
  const VERSION = "1.0";

  // The background worker decides, from the tab's real URL, whether this is
  // the Momentum app. One rule in one place, and a page can't talk its way in.
  function isMomentumOrigin() {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ type: "MOMENTUM_AI_HELLO" }, (res) => {
          if (chrome.runtime.lastError) return resolve(false);
          resolve(!!(res && res.ok));
        });
      } catch { resolve(false); }
    });
  }

  function toApp(payload) {
    window.postMessage({ [TAG]: true, dir: "to-app", ...payload }, location.origin);
  }

  // Cheap early exit so the other pages of the web never even ask.
  const h = location.hostname;
  if (!/^(localhost|127\.0\.0\.1|\[::1\])$/.test(h) && !document.querySelector("meta[name='app-build']")) return;

  isMomentumOrigin().then((ok) => {
    if (!ok) return;
    // Lets the app see the bridge on load without a round trip.
    document.documentElement.dataset.momentumAiBridge = VERSION;

    window.addEventListener("message", (e) => {
      if (e.source !== window || e.origin !== location.origin) return;
      const m = e.data;
      if (!m || m[TAG] !== true || m.dir !== "to-ext") return;

      if (m.type === "hello") {
        toApp({ type: "hello", version: VERSION });
        return;
      }
      if (m.type === "ask" || m.type === "focus" || m.type === "cancel") {
        const kind = { ask: "MOMENTUM_AI_ASK", focus: "MOMENTUM_AI_FOCUS", cancel: "MOMENTUM_AI_CANCEL" }[m.type];
        try {
          chrome.runtime.sendMessage({
            type: kind, id: String(m.id || ""), provider: String(m.provider || ""),
            text: typeof m.text === "string" ? m.text.slice(0, 60000) : "",
          }, (res) => {
            if (chrome.runtime.lastError) {
              toApp({ type: "event", id: m.id, stage: "error",
                error: "The Momentum extension needs reloading. Open chrome://extensions and press reload on it." });
              return;
            }
            if (res && res.ok === false) toApp({ type: "event", id: m.id, stage: "error", error: res.error });
          });
        } catch {
          toApp({ type: "event", id: m.id, stage: "error",
            error: "The Momentum extension needs reloading. Open chrome://extensions and press reload on it." });
        }
      }
    });

    chrome.runtime.onMessage.addListener((msg) => {
      if (msg && msg.type === "MOMENTUM_AI_EVENT") {
        toApp({ type: "event", id: msg.id, stage: msg.stage, text: msg.text, error: msg.error,
                provider: msg.provider });
      }
    });

    toApp({ type: "hello", version: VERSION });
  });
})();
