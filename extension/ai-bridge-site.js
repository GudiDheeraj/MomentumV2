// ============================================================================
// Momentum Tracker extension: AI bridge, chatbot side
// ============================================================================
// Injected on demand into a ChatGPT, Claude, Grok or Gemini tab that the
// extension opened for one request. It types the request into the site's own
// chat box, presses send, waits for the answer to finish and reads it back.
// It runs in the person's own logged in session, one message at a time, only
// when they press Ask in Momentum.
//
// These sites change their markup often, so nothing here depends on a single
// class name. Each step tries the known selectors first and then falls back
// to the shape of the page: the biggest visible editable box, a button whose
// label says send or stop, a code block whose text is the JSON we asked for.
// If a step still fails the person gets a plain message and the app falls
// back to copy and paste, so a markup change degrades rather than breaks.

(() => {
  if (window.__momentumAiSite) return;
  window.__momentumAiSite = true;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const SITES = {
    chatgpt: {
      name: "ChatGPT",
      input: ["#prompt-textarea", "div[contenteditable='true'][data-id='root']", "form textarea"],
      send: ["[data-testid='send-button']", "#composer-submit-button", "button[aria-label*='Send' i]"],
      answer: ["[data-message-author-role='assistant']"],
    },
    claude: {
      name: "Claude",
      input: ["div[contenteditable='true'].ProseMirror", "[data-testid='chat-input']", "fieldset [contenteditable='true']"],
      send: ["button[aria-label='Send message' i]", "button[aria-label*='Send' i]"],
      answer: ["[data-is-streaming]", ".font-claude-response", ".font-claude-message"],
      streaming: "[data-is-streaming='true']",
    },
    grok: {
      name: "Grok",
      input: ["textarea[aria-label*='Ask' i]", "form textarea", "div[contenteditable='true'].ProseMirror", "div[contenteditable='true']"],
      send: ["button[type='submit'][aria-label*='Submit' i]", "button[aria-label*='Submit' i]", "form button[type='submit']", "button[aria-label*='Send' i]"],
      answer: ["[data-testid='assistant-message']", ".message-bubble", ".response-content-markdown"],
    },
    gemini: {
      name: "Gemini",
      input: ["rich-textarea .ql-editor", "div[contenteditable='true'].textarea", "div[contenteditable='true'][role='textbox']"],
      send: ["button.send-button", "button[aria-label*='Send' i]"],
      answer: ["model-response message-content", "model-response", "message-content"],
    },
  };

  const visible = (el) => {
    if (!el || !el.isConnected) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 8 || r.height < 8) return false;
    const s = getComputedStyle(el);
    return s.visibility !== "hidden" && s.display !== "none" && Number(s.opacity) > 0.05;
  };

  function first(selectors, root = document) {
    for (const sel of selectors) {
      let list = [];
      try { list = [...root.querySelectorAll(sel)]; } catch { continue; }
      const hit = list.find(visible);
      if (hit) return hit;
    }
    return null;
  }

  function findInput(site) {
    const hit = first(site.input);
    if (hit) return hit;
    // Shape fallback: the biggest visible editable box in the lower half.
    const all = [...document.querySelectorAll("textarea, [contenteditable='true'], [role='textbox']")]
      .filter(visible)
      .filter((el) => el.getBoundingClientRect().top > window.innerHeight * 0.3);
    all.sort((a, b) => {
      const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
      return rb.width * rb.height - ra.width * ra.height;
    });
    return all[0] || null;
  }

  function inputText(el) {
    return (el.tagName === "TEXTAREA" || el.tagName === "INPUT") ? el.value : (el.innerText || "");
  }

  async function typeInto(el, text) {
    el.focus();
    await sleep(120);
    if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
      const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
      setter.call(el, text);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    } else {
      // Rich editors (ProseMirror, Quill, Lexical) all listen for the
      // browser's own insertText, which is why this beats setting innerHTML:
      // the editor's state updates and its send button enables.
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(el);
      sel.removeAllRanges(); sel.addRange(range);
      document.execCommand("delete");
      document.execCommand("insertText", false, text);
    }
    await sleep(300);
    const got = inputText(el).replace(/\s+/g, "").length;
    const want = text.replace(/\s+/g, "").length;
    if (got >= want * 0.9) return true;
    // Some editors turn a long insert into nothing; a paste event is the
    // other route they all support (ChatGPT may attach it as a text file,
    // which it still reads).
    try {
      const dt = new DataTransfer();
      dt.setData("text/plain", text);
      el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
    } catch { /* old Chrome */ }
    await sleep(600);
    return true;
  }

  function findSend(site, input) {
    const scoped = input.closest("form") || input.closest("fieldset") || null;
    const hit = (scoped && first(site.send, scoped)) || first(site.send);
    if (hit) return hit;
    const btns = [...document.querySelectorAll("button")].filter(visible);
    return btns.find((b) => /send|submit/i.test(`${b.getAttribute("aria-label") || ""} ${b.dataset.testid || ""}`)) || null;
  }

  function stopVisible() {
    return [...document.querySelectorAll("button, [role='button']")].some((b) =>
      visible(b) && /\bstop\b/i.test(`${b.getAttribute("aria-label") || ""} ${b.dataset.testid || ""} ${b.title || ""}`));
  }

  function answers(site) {
    for (const sel of site.answer) {
      let list = [];
      try { list = [...document.querySelectorAll(sel)]; } catch { continue; }
      // Keep outermost matches only: selectors like "model-response" and
      // "message-content" nest.
      list = list.filter((el) => !list.some((o) => o !== el && o.contains(el)));
      if (list.length) return list;
    }
    return [];
  }

  // The JSON we asked for, wherever it rendered. Only code blocks count, so the
  // request itself (which quotes the shape we want) is never mistaken for it.
  function jsonBlocks() {
    return [...document.querySelectorAll("pre code, pre, code")]
      .map((el) => el.textContent || "")
      .filter((t) => /"(changes|reply)"\s*:/.test(t) && t.trim().startsWith("{"));
  }

  function balanced(t) {
    let depth = 0, inStr = false, esc = false;
    for (const ch of t) {
      if (inStr) { if (esc) esc = false; else if (ch === "\\") esc = true; else if (ch === '"') inStr = false; }
      else if (ch === '"') inStr = true;
      else if (ch === "{") depth++;
      else if (ch === "}") depth--;
    }
    return depth === 0 && !inStr;
  }

  function report(id, stage, extra = {}) {
    try { chrome.runtime.sendMessage({ type: "MOMENTUM_AI_SITE_EVENT", id, stage, ...extra }); } catch { /* worker gone */ }
  }

  async function run({ id, provider, text }) {
    const site = SITES[provider];
    if (!site) return report(id, "error", { error: "Unknown AI." });

    // 1. Wait for the chat box. No box after a while almost always means the
    // person isn't signed in, or a check page is showing.
    report(id, "loading");
    let input = null;
    for (let i = 0; i < 60 && !input; i++) {
      if (/\/(auth|login|signin|sign-in)\b/i.test(location.pathname)) break;
      input = findInput(site);
      if (!input) await sleep(500);
    }
    if (!input) {
      return report(id, "error", { code: "login",
        error: `Couldn't find ${site.name}'s message box. If it's asking you to sign in, sign in in the AI window, then press Ask again.` });
    }

    // 2. Type and send.
    report(id, "typing");
    const before = answers(site).length;
    const blocksBefore = jsonBlocks().length;
    await typeInto(input, text);
    let sent = false;
    for (let i = 0; i < 40 && !sent; i++) {
      const btn = findSend(site, input);
      if (btn && !btn.disabled && btn.getAttribute("aria-disabled") !== "true") {
        btn.click(); sent = true; break;
      }
      await sleep(250);
    }
    if (!sent) {
      input.focus();
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true }));
      await sleep(800);
      sent = !inputText(input).trim() || stopVisible();
    }
    if (!sent) {
      return report(id, "error", { error: `The request is typed into ${site.name} but I couldn't press send. Press send in the AI window, then paste the answer back.` });
    }

    // 3. Wait for the answer to finish: something new appeared, the stop
    // button is gone, and the text has stopped changing for a few seconds.
    report(id, "waiting");
    const started = Date.now();
    let lastText = "", stableFor = 0;
    // Last resort when the site's answer markup has changed: whatever the
    // page shows after the final line of our own request. It only counts once
    // it has moved on from what was there the moment we pressed send.
    const MARK = "following the rules above.";
    const tailText = () => {
      const body = document.body ? document.body.innerText : "";
      const at = body.lastIndexOf(MARK);
      return at >= 0 ? body.slice(at + MARK.length).trim() : "";
    };
    await sleep(400);
    const tailAtSend = tailText();
    while (Date.now() - started < 240000) {
      await sleep(1000);
      const blocks = jsonBlocks();
      const newJson = blocks.length > blocksBefore ? blocks[blocks.length - 1] : "";
      const list = answers(site);
      const last = list.length > before ? list[list.length - 1] : null;
      const streaming = stopVisible() || (site.streaming && document.querySelector(site.streaming));
      let tail = "";
      if (!newJson && !last) {
        let t = tailText();
        // Drop the page furniture that was already under the request (the
        // input box's own labels, footer links), which would otherwise ride
        // along at the end of the answer.
        if (tailAtSend) {
          const furniture = new Set(tailAtSend.split("\n").map((l) => l.trim()).filter(Boolean));
          const lines = t.split("\n");
          while (lines.length && (!lines[lines.length - 1].trim() || furniture.has(lines[lines.length - 1].trim()))) lines.pop();
          t = lines.join("\n").trim();
        }
        if (t && t !== tailAtSend) tail = t;
      }
      const current = newJson || (last ? (last.innerText || "") : "") || tail;
      if (!current) continue;
      if (current === lastText) stableFor += 1; else { stableFor = 0; lastText = current; }
      if (!streaming && ((newJson && balanced(newJson) && stableFor >= 2) || stableFor >= 4)) {
        const full = last ? (last.innerText || "") : tail;
        // Prefer the clean code block; send the whole message too in case the
        // model put the JSON somewhere else.
        const answer = newJson && balanced(newJson) ? newJson : (full || current);
        return report(id, "done", { text: answer.slice(0, 60000) });
      }
    }
    report(id, "error", { error: `${site.name} is taking too long. When it finishes, copy the answer and paste it back.` });
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg && msg.type === "MOMENTUM_AI_RUN") {
      sendResponse({ ok: true });
      run(msg);
    }
  });
})();
