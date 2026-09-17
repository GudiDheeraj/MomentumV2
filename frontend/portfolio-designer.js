// ============================================================================
// Momentum — Portfolio designer
// ============================================================================
// The no-code editor: a palette of blocks on the left, the real page in the
// middle, and the controls for whatever is selected on the right.
//
// What it edits is a *design*, never content. A design is a theme plus an
// ordered list of blocks, and it is stored on its own (`/api/portfolio-designs`)
// rather than inside a portfolio. Three things follow from that, and they are
// the reasons the split is worth the extra endpoint:
//
//   * one design can dress several portfolios, each still drawing its own
//     name, projects and photo;
//   * deleting a design can never cost anybody a word of their writing; and
//   * the canvas can be previewed with sample content before a portfolio
//     exists at all, so somebody can design first and write later.
//
// The middle pane is not a mock. It is the same `pfRenderSite` that draws the
// live preview in the builder and writes the downloaded file, so there is no
// second rendering path here that could drift from the thing that ships.
//
// Loaded after portfolio-blocks.js and before portfolio.js. It uses the block
// library's option tables (PF_BLOCKS, PF_BLK_*, PF_THEME_*) and the app-wide
// helpers from app.js (get/post/put/del, esc, showToast, showConfirmModal,
// apiErrorMessage, state, render).
// ============================================================================

// The one design being edited. At module scope, like PF_EDITOR, so switching
// tabs and coming back does not throw away unsaved work.
const PF_DESIGNER = {
  id: null,             // null until saved for the first time
  name: "",
  design: null,         // the normalized design document
  dirty: false,
  sel: null,            // id of the selected block
  device: "desktop",
  panel: "blocks",      // which left panel: blocks | layers | theme
  past: [],             // undo stack, newest last
  future: [],           // redo stack
  returnTo: "library",  // where ← goes back to
  loadedFor: null,
};

let _pfDesigns = [];            // the customer's saved designs
let _pfDesignsLoaded = false;
let _pfDsnTimer = null;
let _pfDsnLastHTML = "";
let _pfDsnScrollY = 0;
let _pfDsnWired = false;
let _pfDsnDrag = null;          // an in-flight drag from the palette

const PF_UNDO_DEPTH = 60;

// ---------------------------------------------------------------------------
// The saved-design store
// ---------------------------------------------------------------------------
// Loaded once per session and kept in memory, because every template card,
// every library row and every preview render asks "what is custom:12?" and
// none of them can wait on a request.

async function pfDesignsLoad(force) {
  if (_pfDesignsLoaded && !force) return _pfDesigns;
  try {
    _pfDesigns = await get("/api/portfolio-designs", { noCache: true });
    _pfDesignsLoaded = true;
  } catch (err) {
    // A designs endpoint that is down must not take the whole Portfolio tab
    // with it: the 38 built-in templates still render without this list.
    console.warn("[portfolio] couldn't load designs", err);
    _pfDesigns = [];
  }
  return _pfDesigns;
}

function pfDesignRow(templateId) {
  const m = /^custom:(\d+)$/.exec(String(templateId || ""));
  if (!m) return null;
  return _pfDesigns.find(d => String(d.id) === m[1]) || null;
}

// The hook portfolio-templates.js calls for anything shaped like "custom:12".
// Returning null is a supported answer — the renderer falls back to the
// default template, which is exactly what should happen to a portfolio whose
// design has since been deleted.
// "custom:preview" is the designer's own live document — the one being edited,
// which by definition has no id yet on a first draft. Routing it through the
// same lookup is what lets the canvas use pfRenderSite unchanged instead of a
// second rendering path that would eventually disagree with it.
const PF_LIVE_DESIGN = "custom:preview";

// And one more for thumbnails: a preset being drawn for the Start panel is
// not the design being edited, so it needs an id of its own rather than
// swapping PF_DESIGNER.design out and back around a render.
const PF_SHOT_DESIGN = "custom:shot";
let _pfShotDesign = null;

if (typeof pfSetDesignLookup === "function") {
  pfSetDesignLookup((templateId) => {
    if (templateId === PF_LIVE_DESIGN) return PF_DESIGNER.design;
    if (templateId === PF_SHOT_DESIGN) return _pfShotDesign;
    const row = pfDesignRow(templateId);
    return row && row.design && Array.isArray(row.design.blocks) ? row.design : null;
  });
}

function pfDesignLabel(templateId) {
  const row = pfDesignRow(templateId);
  return row ? row.name : null;
}

// ---------------------------------------------------------------------------
// Opening and closing
// ---------------------------------------------------------------------------

function pfDesignerReset() {
  PF_DESIGNER.past = [];
  PF_DESIGNER.future = [];
  PF_DESIGNER.sel = null;
  PF_DESIGNER.dirty = false;
  _pfDsnLastHTML = "";
  _pfDsnScrollY = 0;
}

// Start a new design. `from` seeds the blocks — used by "duplicate" and by
// the starting points offered on the library page.
function pfDesignerNew(from, name) {
  pfDesignerReset();
  PF_DESIGNER.id = null;
  // A new design opens on the Start panel: an empty canvas is a worse first
  // question than "which of these do you want to take apart".
  PF_DESIGNER.panel = from ? "blocks" : "start";
  PF_DESIGNER.design = pfNormalizeDesign(from || pfBlankDesign(name));
  PF_DESIGNER.name = name || PF_DESIGNER.design.name || "My design";
  PF_DESIGNER.design.name = PF_DESIGNER.name;
  PF_DESIGNER.loadedFor = "new";
  PF_DESIGNER.returnTo = state.portfolioView || "library";
  state.portfolioView = "designer";
  state.portfolioDesignId = null;
  pfScrollTop();
  render();
}

function pfDesignerOpen(id) {
  pfDesignerReset();
  PF_DESIGNER.loadedFor = null;
  PF_DESIGNER.returnTo = state.portfolioView || "library";
  state.portfolioDesignId = id;
  state.portfolioView = "designer";
  pfScrollTop();
  render();
}

function pfDesignerClose() {
  document.documentElement.classList.remove("pf-immersive");
  state.portfolioView = PF_DESIGNER.returnTo === "designer" ? "library" : PF_DESIGNER.returnTo;
  pfScrollTop();
  render();
}

// ---------------------------------------------------------------------------
// Edits, undo and redo
// ---------------------------------------------------------------------------
// Every change goes through pfDsnEdit. Undo therefore cannot miss a case —
// there is no second way to modify the design — and the snapshot is taken
// before the mutation rather than after, so undo restores what was on screen
// when the customer decided they preferred it.

function pfDsnSnapshot() {
  return JSON.stringify(PF_DESIGNER.design);
}

function pfDsnEdit(mutate, opts) {
  const before = pfDsnSnapshot();
  mutate(PF_DESIGNER.design);
  const after = pfDsnSnapshot();
  if (before === after) return;          // a no-op edit is not worth an undo step

  PF_DESIGNER.past.push(before);
  if (PF_DESIGNER.past.length > PF_UNDO_DEPTH) PF_DESIGNER.past.shift();
  PF_DESIGNER.future.length = 0;         // a new edit ends the old redo branch
  PF_DESIGNER.dirty = true;
  pfDsnAfterChange(opts);
}

function pfDsnRestore(json) {
  PF_DESIGNER.design = pfNormalizeDesign(JSON.parse(json));
  // The selected block may have been the one that was just undone away.
  if (!PF_DESIGNER.design.blocks.some(b => b.id === PF_DESIGNER.sel)) PF_DESIGNER.sel = null;
  PF_DESIGNER.dirty = true;
  pfDsnAfterChange();
}

function pfDsnUndo() {
  if (!PF_DESIGNER.past.length) return;
  PF_DESIGNER.future.push(pfDsnSnapshot());
  pfDsnRestore(PF_DESIGNER.past.pop());
}

function pfDsnRedo() {
  if (!PF_DESIGNER.future.length) return;
  PF_DESIGNER.past.push(pfDsnSnapshot());
  pfDsnRestore(PF_DESIGNER.future.pop());
}

// One repaint path for every change, so a new kind of edit cannot forget to
// refresh one of the three panes.
function pfDsnAfterChange(opts) {
  PF_DESIGNER.design.name = PF_DESIGNER.name;
  pfDsnPaintPanel();
  pfDsnPaintInspector();
  pfDsnPaintTopbar();
  if (opts && opts.instant) pfDsnRefresh(true);
  else {
    clearTimeout(_pfDsnTimer);
    _pfDsnTimer = setTimeout(() => pfDsnRefresh(false), 240);
  }
}

// ---------------------------------------------------------------------------
// Block operations
// ---------------------------------------------------------------------------

function pfDsnBlock(id) {
  return PF_DESIGNER.design.blocks.find(b => b.id === id) || null;
}
function pfDsnIndex(id) {
  return PF_DESIGNER.design.blocks.findIndex(b => b.id === id);
}

// "once" blocks (nav, hero, footer) may exist only in one copy — two sticky
// navs would fight for the top of the page. The palette greys them out rather
// than letting the add silently do nothing.
function pfDsnCanAdd(type) {
  const def = PF_BLOCK_BY_TYPE[type];
  if (!def) return false;
  if (!def.once) return true;
  return !PF_DESIGNER.design.blocks.some(b => b.type === type);
}

function pfDsnAdd(type, index) {
  if (!pfDsnCanAdd(type)) {
    showToast(`Your design already has a ${PF_BLOCK_BY_TYPE[type].label.toLowerCase()}.`, "error");
    return;
  }
  const blk = pfNewBlock(type);
  pfDsnEdit((d) => {
    const at = (typeof index === "number" && index >= 0)
      ? Math.min(index, d.blocks.length)
      // No drop point given: land it after whatever is selected, which is
      // where somebody who just clicked a block and then a palette item is
      // looking. Falling back to the end would send it off screen.
      : (PF_DESIGNER.sel ? pfDsnIndex(PF_DESIGNER.sel) + 1 : d.blocks.length);
    d.blocks.splice(at, 0, blk);
  }, { instant: true });
  pfDsnSelect(blk.id, true);
}

function pfDsnMove(id, index) {
  pfDsnEdit((d) => {
    const from = d.blocks.findIndex(b => b.id === id);
    if (from < 0) return;
    const [blk] = d.blocks.splice(from, 1);
    d.blocks.splice(Math.max(0, Math.min(index, d.blocks.length)), 0, blk);
  }, { instant: true });
}

function pfDsnNudge(id, delta) {
  const i = pfDsnIndex(id);
  if (i < 0) return;
  pfDsnMove(id, Math.max(0, Math.min(PF_DESIGNER.design.blocks.length - 1, i + delta)));
}

function pfDsnDuplicate(id) {
  const src = pfDsnBlock(id);
  if (!src) return;
  if (!pfDsnCanAdd(src.type)) {
    showToast(`A design can only have one ${PF_BLOCK_BY_TYPE[src.type].label.toLowerCase()}.`, "error");
    return;
  }
  const copy = Object.assign({}, src, { id: pfBlockId() });
  pfDsnEdit((d) => { d.blocks.splice(pfDsnIndex(id) + 1, 0, copy); }, { instant: true });
  pfDsnSelect(copy.id, true);
}

function pfDsnDelete(id) {
  const i = pfDsnIndex(id);
  if (i < 0) return;
  pfDsnEdit((d) => { d.blocks.splice(i, 1); }, { instant: true });
  // Select the neighbour rather than nothing, so deleting several in a row
  // does not send the inspector blank between each one.
  const next = PF_DESIGNER.design.blocks[Math.min(i, PF_DESIGNER.design.blocks.length - 1)];
  pfDsnSelect(next ? next.id : null);
}

function pfDsnToggleHidden(id) {
  pfDsnEdit((d) => {
    const b = d.blocks.find(x => x.id === id);
    if (b) b.hidden = !b.hidden;
  }, { instant: true });
}

function pfDsnSet(id, key, value) {
  pfDsnEdit((d) => {
    const b = d.blocks.find(x => x.id === id);
    if (b) b[key] = value;
  }, { instant: key !== "title" });
}

function pfDsnSelect(id, reveal) {
  PF_DESIGNER.sel = id;
  pfDsnPaintInspector();
  pfDsnPaintPanel();
  const frame = document.getElementById("pf-dsn-frame");
  if (frame && frame.contentWindow) {
    frame.contentWindow.postMessage({ __pf: "sel", id }, "*");
    if (reveal && id) frame.contentWindow.postMessage({ __pf: "reveal", id }, "*");
  }
}

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------

async function pfRenderDesigner(content) {
  const wantId = state.portfolioDesignId;
  const key = wantId == null ? "new" : String(wantId);

  if (PF_DESIGNER.loadedFor !== key) {
    if (wantId == null) {
      if (!PF_DESIGNER.design) PF_DESIGNER.design = pfNormalizeDesign(pfBlankDesign());
      PF_DESIGNER.loadedFor = "new";
    } else {
      content.innerHTML = `<div class="spinner"></div>`;
      try {
        const row = await get(`/api/portfolio-designs/${wantId}`, { noCache: true });
        pfDesignerReset();
        PF_DESIGNER.id = row.id;
        PF_DESIGNER.name = row.name;
        PF_DESIGNER.design = pfNormalizeDesign(row.design);
        PF_DESIGNER.design.name = row.name;
        PF_DESIGNER.loadedFor = key;
      } catch (err) {
        content.innerHTML = `<div class="card p-6 text-sm text-red-600">Couldn't open that design. ${esc(apiErrorMessage(err, ""))}</div>`;
        return;
      }
    }
  }

  // A full-screen editor. The page's own header — title, search, sub-tabs —
  // is a second bar stacked above the designer's own, and between them they
  // spent about a fifth of the viewport before the canvas began. render() in
  // app.js clears this class on the way to any other page.
  document.documentElement.classList.add("pf-immersive");

  content.innerHTML = `
  <div class="pf-dsn">
    <div class="pf-dsn-top" id="pf-dsn-top"></div>
    <div class="pf-dsn-work">
      <aside class="pf-dsn-left">
        <nav class="pf-dsn-tabs" role="tablist">
          <button type="button" class="pf-dsn-tab" data-pf-dsn-panel="start"  role="tab">✦ Start</button>
          <button type="button" class="pf-dsn-tab" data-pf-dsn-panel="blocks" role="tab">＋ Blocks</button>
          <button type="button" class="pf-dsn-tab" data-pf-dsn-panel="layers" role="tab">☰ Layers</button>
          <button type="button" class="pf-dsn-tab" data-pf-dsn-panel="theme"  role="tab">🎨 Theme</button>
        </nav>
        <div class="pf-dsn-panel" id="pf-dsn-panel"></div>
      </aside>

      <section class="pf-dsn-canvas" id="pf-dsn-stage">
        <iframe id="pf-dsn-frame" title="Your design, as it will look"
                sandbox="allow-scripts allow-popups allow-modals"></iframe>
        <div class="pf-dsn-hint" id="pf-dsn-hint" hidden>Drop to place the block</div>
      </section>

      <aside class="pf-dsn-right" id="pf-dsn-inspector"></aside>
    </div>
  </div>`;

  pfDsnPaintTopbar();
  pfDsnPaintPanel();
  pfDsnPaintInspector();
  pfDsnRefresh(true);
  pfDsnWire(content);
}

function pfDsnWire(root) {
  root.querySelectorAll("[data-pf-dsn-panel]").forEach(btn => btn.addEventListener("click", () => {
    PF_DESIGNER.panel = btn.dataset.pfDsnPanel;
    pfDsnPaintPanel();
  }));

  pfDsnWireBridge();

  if (!_pfDsnWired) {
    _pfDsnWired = true;
    window.addEventListener("resize", pfDsnFit, { passive: true });
    window.addEventListener("keydown", (e) => {
      if (state.page !== "portfolio" || state.portfolioView !== "designer") return;
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target || {}).tagName || "");
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "s") { e.preventDefault(); pfDsnSave(); return; }
      if (mod && e.key.toLowerCase() === "z" && !e.shiftKey) { e.preventDefault(); pfDsnUndo(); return; }
      if (mod && (e.key.toLowerCase() === "y" || (e.key.toLowerCase() === "z" && e.shiftKey))) {
        e.preventDefault(); pfDsnRedo(); return;
      }
      if (typing || !PF_DESIGNER.sel) return;
      // Delete only when the customer is not in a field — otherwise
      // backspacing a heading would delete the block under it.
      if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); pfDsnDelete(PF_DESIGNER.sel); }
      if (e.key === "Escape") pfDsnSelect(null);
    });
    // Leaving with unsaved work is almost always an accident.
    window.addEventListener("beforeunload", (e) => {
      if (state.portfolioView === "designer" && PF_DESIGNER.dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    });
  }
}

// The canvas talks back: a block was clicked, a block was dragged, the page
// scrolled. Everything it says is an intention about a block id — never a
// pixel — so the parent stays the only owner of the design document.
function pfDsnWireBridge() {
  if (pfDsnWireBridge._on) return;
  pfDsnWireBridge._on = true;
  window.addEventListener("message", (e) => {
    const frame = document.getElementById("pf-dsn-frame");
    if (!frame || e.source !== frame.contentWindow) return;
    const m = e.data;
    if (!m || typeof m !== "object") return;
    if (m.__pf === "scroll" && typeof m.y === "number") _pfDsnScrollY = m.y;
    if (m.__pf === "ready") {
      if (_pfDsnScrollY > 0) frame.contentWindow.postMessage({ __pf: "restore", y: _pfDsnScrollY }, "*");
      if (PF_DESIGNER.sel) frame.contentWindow.postMessage({ __pf: "sel", id: PF_DESIGNER.sel }, "*");
    }
    if (m.__pf === "sel") { PF_DESIGNER.sel = m.id || null; pfDsnPaintInspector(); pfDsnPaintPanel(); }
    if (m.__pf === "move" && m.id) pfDsnMove(m.id, m.index);
    if (m.__pf === "dropIdx" && _pfDsnDrag) _pfDsnDrag.index = m.index;
  });
}

function pfDsnRefresh(force) {
  const frame = document.getElementById("pf-dsn-frame");
  if (!frame) return;
  let html;
  try {
    html = pfRenderSite(PF_LIVE_DESIGN, pfDsnPreviewData(), { preview: true, editor: true });
  } catch (err) {
    console.error("[portfolio] design render failed", err);
    showToast("That change couldn't be drawn — check the browser console", "error");
    return;
  }
  if (!force && html === _pfDsnLastHTML) return;
  _pfDsnLastHTML = html;
  frame.srcdoc = html;
  pfDsnFit();
}

// What the canvas is filled with. A design holds no content, so it borrows
// some: the portfolio currently open in the builder if there is one, and the
// same sample content the template gallery uses if there is not. Designing
// against your own words is the better experience where they exist, and
// designing before writing a single one still has to work.
function pfDsnPreviewData() {
  const d = PF_EDITOR && PF_EDITOR.data;
  const real = d && (d.full_name || d.about || (d.projects || []).length);
  return real ? d : pfDemoData();
}

function pfDsnFit() {
  const stage = document.getElementById("pf-dsn-stage");
  const frame = document.getElementById("pf-dsn-frame");
  if (!stage || !frame) return;
  const target = (PF_DEVICES[PF_DESIGNER.device] || PF_DEVICES.desktop).w;
  const avail = stage.clientWidth - 32;
  const scale = Math.min(1, avail / target);
  frame.style.width = target + "px";
  frame.style.height = Math.round((stage.clientHeight - 32) / scale) + "px";
  frame.style.transform = `scale(${scale})`;
  frame.style.transformOrigin = "top left";
  frame.style.left = Math.max(16, (stage.clientWidth - target * scale) / 2) + "px";
  stage.dataset.scale = String(scale);
}

// ---------------------------------------------------------------------------
// Top bar
// ---------------------------------------------------------------------------

function pfDsnPaintTopbar() {
  const bar = document.getElementById("pf-dsn-top");
  if (!bar) return;
  const canUndo = PF_DESIGNER.past.length > 0;
  const canRedo = PF_DESIGNER.future.length > 0;

  // Three zones, laid out on a grid rather than with justify-content: the
  // device switcher belongs over the middle of the canvas, and flexbox put it
  // wherever the two side groups happened to leave room — which is what left
  // a hand's width of empty bar between the name and the save state.
  bar.innerHTML = `
    <div class="pf-dsn-top-l">
      <button class="pf-icon-btn pf-dsn-back" id="pf-dsn-back"
              title="Back to portfolios" aria-label="Back to portfolios">←</button>
      <span class="pf-dsn-namewrap" data-value="${esc(PF_DESIGNER.name || "Untitled design")}">
        <input id="pf-dsn-name" class="pf-dsn-name" placeholder="Untitled design"
               value="${esc(PF_DESIGNER.name)}" aria-label="Design name" spellcheck="false">
      </span>
      <span class="pf-dsn-state ${PF_DESIGNER.dirty ? "is-unsaved" : ""}"
            title="${PF_DESIGNER.dirty ? "This design has unsaved changes" : "Everything is saved"}">
        <i aria-hidden="true"></i>${PF_DESIGNER.dirty ? "Unsaved" : (PF_DESIGNER.id ? "Saved" : "New")}
      </span>
    </div>

    <div class="pf-dsn-top-c">
      <div class="pf-devices" role="group" aria-label="Preview size">
        ${Object.entries(PF_DEVICES).map(([k, v]) =>
          `<button type="button" class="pf-device ${PF_DESIGNER.device === k ? "active" : ""}"
             data-pf-dsn-device="${k}" title="${v.label}" aria-label="${v.label} preview">${v.icon}</button>`).join("")}
      </div>
    </div>

    <div class="pf-dsn-top-r">
      <div class="pf-dsn-history" role="group" aria-label="History">
        <button type="button" class="pf-icon-btn" id="pf-dsn-undo" ${canUndo ? "" : "disabled"}
                title="Undo (Ctrl+Z)" aria-label="Undo">↶</button>
        <button type="button" class="pf-icon-btn" id="pf-dsn-redo" ${canRedo ? "" : "disabled"}
                title="Redo (Ctrl+Shift+Z)" aria-label="Redo">↷</button>
      </div>
      <button class="btn btn-ghost btn-xs" id="pf-dsn-apply">Use in a portfolio</button>
      <button class="btn btn-accent btn-xs" id="pf-dsn-save">Save</button>
    </div>`;

  const name = bar.querySelector("#pf-dsn-name");
  const wrap = bar.querySelector(".pf-dsn-namewrap");
  name.addEventListener("input", () => {
    PF_DESIGNER.name = name.value;
    PF_DESIGNER.design.name = name.value;
    PF_DESIGNER.dirty = true;
    // The field is sized by the text behind it (see .pf-dsn-namewrap), so the
    // mirror has to follow what is typed or the box stops matching the name.
    if (wrap) wrap.dataset.value = name.value || "Untitled design";
    // Repainting the whole bar here would take the field being typed in with
    // it, so only the state chip is updated.
    const chip = bar.querySelector(".pf-dsn-state");
    if (chip) { chip.classList.add("is-unsaved"); chip.lastChild.textContent = "Unsaved"; }
  });

  bar.querySelector("#pf-dsn-back").addEventListener("click", pfDsnLeave);
  bar.querySelector("#pf-dsn-undo").addEventListener("click", pfDsnUndo);
  bar.querySelector("#pf-dsn-redo").addEventListener("click", pfDsnRedo);
  bar.querySelector("#pf-dsn-save").addEventListener("click", pfDsnSave);
  bar.querySelector("#pf-dsn-apply").addEventListener("click", pfDsnApply);
  bar.querySelectorAll("[data-pf-dsn-device]").forEach(btn => btn.addEventListener("click", () => {
    PF_DESIGNER.device = btn.dataset.pfDsnDevice;
    pfDsnPaintTopbar();
    pfDsnFit();
  }));
}

async function pfDsnLeave() {
  if (PF_DESIGNER.dirty) {
    const ok = await showConfirmModal({
      title: "Leave without saving?",
      message: "This design has changes that haven't been saved. They'll be lost.",
      confirmLabel: "Discard changes",
    });
    if (!ok) return;
  }
  pfDesignerClose();
}

async function pfDsnSave() {
  const name = (PF_DESIGNER.name || "").trim() || "Untitled design";
  PF_DESIGNER.name = name;
  PF_DESIGNER.design.name = name;
  const body = { name, design: PF_DESIGNER.design };
  try {
    const row = PF_DESIGNER.id
      ? await put(`/api/portfolio-designs/${PF_DESIGNER.id}`, body)
      : await post("/api/portfolio-designs", body);
    PF_DESIGNER.id = row.id;
    PF_DESIGNER.dirty = false;
    PF_DESIGNER.loadedFor = String(row.id);
    state.portfolioDesignId = row.id;
    // Keep the in-memory store in step so the library and the template picker
    // show the new name without a round trip.
    const at = _pfDesigns.findIndex(d => d.id === row.id);
    if (at >= 0) _pfDesigns[at] = row; else _pfDesigns.unshift(row);
    _pfDesignsLoaded = true;
    pfDsnPaintTopbar();
    showToast("Design saved");
  } catch (err) {
    showToast(apiErrorMessage(err, "Couldn't save that design"), "error");
  }
}

// "Use in a portfolio" is the bridge back to content. A design that cannot be
// worn is just a drawing, so this saves first (an unsaved design has no id to
// point a portfolio at) and then hands it to the builder.
async function pfDsnApply() {
  if (PF_DESIGNER.dirty || !PF_DESIGNER.id) await pfDsnSave();
  if (!PF_DESIGNER.id) return;
  PF_EDITOR.templateId = `custom:${PF_DESIGNER.id}`;
  PF_EDITOR.dirty = true;
  _pfLastHTML = "";
  state.portfolioView = "builder";
  PF_EDITOR.tab = "template";
  pfScrollTop();
  render();
  showToast(`"${PF_DESIGNER.name}" applied to this portfolio`);
}

// ---------------------------------------------------------------------------
// Left pane
// ---------------------------------------------------------------------------

function pfDsnPaintPanel() {
  const host = document.getElementById("pf-dsn-panel");
  if (!host) return;
  document.querySelectorAll("[data-pf-dsn-panel]").forEach(b =>
    b.classList.toggle("active", b.dataset.pfDsnPanel === PF_DESIGNER.panel));

  if (PF_DESIGNER.panel === "start")      { host.innerHTML = pfDsnStartHTML();  pfDsnWireStart(host); }
  else if (PF_DESIGNER.panel === "layers") { host.innerHTML = pfDsnLayersHTML(); pfDsnWireLayers(host); }
  else if (PF_DESIGNER.panel === "theme")  { host.innerHTML = pfDsnThemeHTML();  pfDsnWireTheme(host); }
  else                                     { host.innerHTML = pfDsnPaletteHTML(); pfDsnWirePalette(host); }
}

// --- Blocks -----------------------------------------------------------------

function pfDsnPaletteHTML() {
  const d = pfDsnPreviewData();
  return `
  <p class="pf-dsn-note">Click to add after the selected block, or drag one onto the page.</p>
  <div class="pf-dsn-blocks">
    ${PF_BLOCKS.map(b => {
      const can = pfDsnCanAdd(b.type);
      // A block bound to a section nobody has filled in renders as nothing.
      // Saying so on the card is kinder than letting somebody add it three
      // times wondering why the page never changes.
      const empty = b.needs && !pfDsnHasContent(d, b.needs);
      return `
      <button type="button" class="pf-dsn-block ${can ? "" : "is-used"}" data-pf-add="${b.type}"
              ${can ? `draggable="true"` : "disabled"}
              title="${esc(b.hint)}">
        <span class="pf-dsn-block-ico" aria-hidden="true">${b.icon}</span>
        <span class="pf-dsn-block-name">${esc(b.label)}
          ${can ? "" : `<em>added</em>`}
          ${can && empty ? `<em class="is-empty">no content yet</em>` : ""}
        </span>
        <span class="pf-dsn-block-hint">${esc(b.hint)}</span>
      </button>`;
    }).join("")}
  </div>`;
}

// Whether the content the canvas is drawing actually has anything for a
// section. Mirrors the renderer's own `c.has()` rule so the palette and the
// page never disagree about what is empty.
function pfDsnHasContent(d, needs) {
  if (!d) return false;
  if (needs === "about")    return !!(d.about || "").trim();
  if (needs === "contact")  return !!(d.email || d.phone || d.linkedin || d.github || d.website);
  return Array.isArray(d[needs]) ? d[needs].length > 0 : !!d[needs];
}

function pfDsnWirePalette(host) {
  host.querySelectorAll("[data-pf-add]").forEach(btn => {
    btn.addEventListener("click", () => pfDsnAdd(btn.dataset.pfAdd));
    btn.addEventListener("pointerdown", (e) => pfDsnStartPaletteDrag(e, btn.dataset.pfAdd));
    // The palette items are draggable="true" so the cursor changes, but the
    // drag itself is done with pointer events: an HTML5 drag cannot report a
    // position inside a sandboxed cross-origin iframe, and the canvas is one.
    btn.addEventListener("dragstart", (e) => e.preventDefault());
  });
}

// Dragging a block from the palette onto the page.
//
// The pointer is in the parent document; the drop target is inside a sandboxed
// iframe that is also CSS-scaled. So the parent converts its own pointer
// position into the canvas's coordinate space and asks the canvas where that
// would land — the canvas draws the insertion line, because only it knows
// where its blocks actually are.
function pfDsnStartPaletteDrag(e, type) {
  if (e.button !== 0 || !pfDsnCanAdd(type)) return;
  const stage = document.getElementById("pf-dsn-stage");
  const frame = document.getElementById("pf-dsn-frame");
  const hint = document.getElementById("pf-dsn-hint");
  if (!stage || !frame) return;

  const def = PF_BLOCK_BY_TYPE[type];
  const ghost = document.createElement("div");
  ghost.className = "pf-dsn-ghost";
  ghost.textContent = `${def.icon} ${def.label}`;
  document.body.appendChild(ghost);

  _pfDsnDrag = { type, index: -1, started: false, x: e.clientX, y: e.clientY };
  const move = (ev) => {
    // A few pixels of travel before this counts as a drag, so a plain click
    // still adds the block rather than starting an empty drag that ends
    // nowhere.
    if (!_pfDsnDrag.started &&
        Math.hypot(ev.clientX - _pfDsnDrag.x, ev.clientY - _pfDsnDrag.y) < 6) return;
    _pfDsnDrag.started = true;
    document.body.classList.add("pf-dsn-dragging");
    ghost.style.transform = `translate(${ev.clientX + 14}px, ${ev.clientY + 12}px)`;

    const r = frame.getBoundingClientRect();
    const inside = ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom;
    if (hint) hint.hidden = !inside;
    if (!inside) { _pfDsnDrag.index = -1; frame.contentWindow.postMessage({ __pf: "dropEnd" }, "*"); return; }
    const scale = Number(stage.dataset.scale || 1) || 1;
    frame.contentWindow.postMessage({ __pf: "dropAt", y: (ev.clientY - r.top) / scale }, "*");
  };
  const up = () => {
    document.removeEventListener("pointermove", move);
    ghost.remove();
    document.body.classList.remove("pf-dsn-dragging");
    if (hint) hint.hidden = true;
    if (frame.contentWindow) frame.contentWindow.postMessage({ __pf: "dropEnd" }, "*");
    const drag = _pfDsnDrag;
    _pfDsnDrag = null;
    if (!drag) return;
    // A drag that ended inside the canvas drops where the line was; one that
    // ended outside it is a cancelled drag, not an add at the end.
    if (drag.started && drag.index >= 0) pfDsnAdd(drag.type, drag.index);
    else if (!drag.started) pfDsnAdd(drag.type);
  };
  document.addEventListener("pointermove", move);
  document.addEventListener("pointerup", up, { once: true });
  e.preventDefault();
}

// --- Layers -----------------------------------------------------------------

function pfDsnLayersHTML() {
  const blocks = PF_DESIGNER.design.blocks;
  if (!blocks.length) {
    return `<p class="pf-dsn-empty">No blocks yet. Add one from the Blocks tab.</p>`;
  }
  return `
  <p class="pf-dsn-note">Drag to reorder. The eye hides a block without deleting it.</p>
  <ol class="pf-dsn-layers" id="pf-dsn-layers">
    ${blocks.map((b, i) => {
      const def = PF_BLOCK_BY_TYPE[b.type];
      const variant = (def.variants.find(v => v.id === b.variant) || {}).label || "";
      return `
      <li class="pf-dsn-layer ${b.id === PF_DESIGNER.sel ? "active" : ""} ${b.hidden ? "is-hidden" : ""}"
          data-pf-layer="${esc(b.id)}" data-index="${i}" draggable="true">
        <span class="pf-dsn-grip" aria-hidden="true">⠿</span>
        <span class="pf-dsn-layer-ico" aria-hidden="true">${def.icon}</span>
        <span class="pf-dsn-layer-name">${esc(b.title || def.label)}<em>${esc(variant)}</em></span>
        <span class="pf-dsn-layer-acts">
          <button type="button" class="pf-icon-btn" data-pf-layer-hide="${esc(b.id)}"
                  title="${b.hidden ? "Show" : "Hide"} this block"
                  aria-label="${b.hidden ? "Show" : "Hide"} ${esc(def.label)}">${b.hidden ? "🚫" : "👁"}</button>
          <button type="button" class="pf-icon-btn" data-pf-layer-dup="${esc(b.id)}"
                  title="Duplicate" aria-label="Duplicate ${esc(def.label)}">⧉</button>
          <button type="button" class="pf-icon-btn pf-danger" data-pf-layer-del="${esc(b.id)}"
                  title="Delete" aria-label="Delete ${esc(def.label)}">🗑</button>
        </span>
      </li>`;
    }).join("")}
  </ol>`;
}

function pfDsnWireLayers(host) {
  host.querySelectorAll("[data-pf-layer]").forEach(li => {
    li.addEventListener("click", (e) => {
      if (e.target.closest("button")) return;
      pfDsnSelect(li.dataset.pfLayer, true);
    });
    li.addEventListener("dragstart", (e) => {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", li.dataset.pfLayer);
      li.classList.add("is-dragging");
    });
    li.addEventListener("dragend", () => {
      li.classList.remove("is-dragging");
      host.querySelectorAll(".pf-dsn-layer").forEach(x => x.classList.remove("drop-before", "drop-after"));
    });
    li.addEventListener("dragover", (e) => {
      e.preventDefault();
      const r = li.getBoundingClientRect();
      const after = e.clientY > r.top + r.height / 2;
      li.classList.toggle("drop-before", !after);
      li.classList.toggle("drop-after", after);
    });
    li.addEventListener("dragleave", () => li.classList.remove("drop-before", "drop-after"));
    li.addEventListener("drop", (e) => {
      e.preventDefault();
      const id = e.dataTransfer.getData("text/plain");
      if (!id) return;
      const r = li.getBoundingClientRect();
      let target = Number(li.dataset.index);
      if (e.clientY > r.top + r.height / 2) target += 1;
      // Removing the dragged block first shifts everything after it up by one,
      // so a downward move has to account for its own removal.
      const from = pfDsnIndex(id);
      if (from >= 0 && from < target) target -= 1;
      li.classList.remove("drop-before", "drop-after");
      pfDsnMove(id, target);
    });
  });
  host.querySelectorAll("[data-pf-layer-hide]").forEach(b =>
    b.addEventListener("click", () => pfDsnToggleHidden(b.dataset.pfLayerHide)));
  host.querySelectorAll("[data-pf-layer-dup]").forEach(b =>
    b.addEventListener("click", () => pfDsnDuplicate(b.dataset.pfLayerDup)));
  host.querySelectorAll("[data-pf-layer-del]").forEach(b =>
    b.addEventListener("click", () => pfDsnDelete(b.dataset.pfLayerDel)));
}

// --- Theme ------------------------------------------------------------------

// Starting points, not a fixed set: every one of these is just an accent, a
// partner colour and a tone, so a customer who nudges one is not "off-preset"
// — there is nothing to be off. Ordered light-first because most portfolios
// are, and the dark ones read as a deliberate choice further down.
const PF_PALETTES = [
  { id: "indigo",    name: "Indigo",        tone: "light", accent: "#6D5AE6", accent2: "#22C1DC" },
  { id: "cobalt",    name: "Cobalt",        tone: "light", accent: "#2C6FDB", accent2: "#4FC3F7" },
  { id: "forest",    name: "Forest",        tone: "light", accent: "#1F7A5C", accent2: "#8BC34A" },
  { id: "ember",     name: "Ember",         tone: "light", accent: "#E2604F", accent2: "#F2A65A" },
  { id: "plum",      name: "Plum",          tone: "light", accent: "#8E44AD", accent2: "#E056A0" },
  { id: "clay",      name: "Clay",          tone: "light", accent: "#B5432E", accent2: "#D99058" },
  { id: "teal",      name: "Teal",          tone: "light", accent: "#1F7A8C", accent2: "#3CC7B4" },
  { id: "ink",       name: "Ink",           tone: "light", accent: "#171A1F", accent2: "#6B7280" },
  { id: "rose",      name: "Rose",          tone: "light", accent: "#DB2777", accent2: "#FB7185" },
  { id: "amber",     name: "Amber",         tone: "light", accent: "#D97706", accent2: "#FBBF24" },
  { id: "sage",      name: "Sage",          tone: "light", accent: "#5F7A61", accent2: "#A3B18A" },
  { id: "denim",     name: "Denim",         tone: "light", accent: "#3D5AFE", accent2: "#7C4DFF" },
  { id: "midnight",  name: "Midnight",      tone: "dark",  accent: "#7C5CFC", accent2: "#22D3EE" },
  { id: "neon",      name: "Neon",          tone: "dark",  accent: "#FF2E88", accent2: "#22D3EE" },
  { id: "matrix",    name: "Matrix",        tone: "dark",  accent: "#3CE88F", accent2: "#0EA5E9" },
  { id: "sunset",    name: "Sunset",        tone: "dark",  accent: "#FF5A3C", accent2: "#FFB43C" },
  { id: "arctic",    name: "Arctic",        tone: "dark",  accent: "#38BDF8", accent2: "#A78BFA" },
  { id: "gold",      name: "Gold",          tone: "dark",  accent: "#E4A335", accent2: "#F5E1A4" },
  { id: "orchid",    name: "Orchid",        tone: "dark",  accent: "#C084FC", accent2: "#F0ABFC" },
  { id: "slate",     name: "Slate",         tone: "dark",  accent: "#94A3B8", accent2: "#38BDF8" },
];

function pfDsnThemeHTML() {
  const t = PF_DESIGNER.design.theme;
  const on = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
  return `
  <div class="pf-dsn-group">
    <h4>Palette</h4>
    <div class="pf-dsn-palettes">
      ${PF_PALETTES.map(p => `
        <button type="button" class="pf-dsn-pal ${on(p.accent, t.accent) && on(p.accent2, t.accent2) && p.tone === t.tone ? "active" : ""}"
                data-pf-pal="${p.id}" title="${esc(p.name)} — ${p.tone}" aria-label="${esc(p.name)}">
          <span style="background:linear-gradient(135deg,${p.accent},${p.accent2})"></span>
          <em>${esc(p.name)}</em>
        </button>`).join("")}
    </div>
  </div>

  <div class="pf-dsn-group">
    <h4>Tone</h4>
    <div class="pf-dsn-seg" role="group">
      <button type="button" class="${t.tone === "light" ? "active" : ""}" data-pf-tone="light">☀︎ Light</button>
      <button type="button" class="${t.tone === "dark" ? "active" : ""}" data-pf-tone="dark">☾ Dark</button>
    </div>
    <small class="pf-dsn-small">Every surface, border and muted line is derived from this — nothing has to be recoloured by hand.</small>
  </div>

  <div class="pf-dsn-group">
    <h4>Colours</h4>
    <label class="pf-dsn-colour">
      <input type="color" data-pf-theme="accent" value="${esc(t.accent)}" aria-label="Accent colour">
      <span>Accent</span>
    </label>
    <label class="pf-dsn-colour">
      <input type="color" data-pf-theme="accent2" value="${esc(t.accent2 || pfHueShift(t.accent, 42))}" aria-label="Second colour">
      <span>Second<em>gradients and highlights</em></span>
    </label>
  </div>

  <div class="pf-dsn-group">
    <h4>Typeface</h4>
    <select data-pf-theme="font" class="pf-dsn-select" aria-label="Typeface">
      ${PF_THEME_FONTS.map(f => `<option value="${f.id}" ${t.font === f.id ? "selected" : ""}>${esc(f.label)}</option>`).join("")}
    </select>
  </div>

  <div class="pf-dsn-group">
    <h4>Page width</h4>
    <div class="pf-dsn-seg" role="group">
      ${PF_THEME_WIDTH.map(w => `<button type="button" class="${t.width === w.id ? "active" : ""}"
        data-pf-theme-btn="width" data-value="${w.id}">${esc(w.label)}</button>`).join("")}
    </div>
  </div>

  <div class="pf-dsn-group">
    <h4>Corners</h4>
    <input type="range" min="0" max="36" step="2" value="${t.radius}" data-pf-theme="radius"
           class="pf-dsn-range" aria-label="Corner radius">
    <small class="pf-dsn-small">${t.radius}px — every card, button and chip follows this.</small>
  </div>

  <div class="pf-dsn-group">
    <h4>Motion</h4>
    <div class="pf-dsn-seg" role="group">
      ${PF_THEME_MOTION.map(m => `<button type="button" class="${t.motion === m.id ? "active" : ""}"
        data-pf-theme-btn="motion" data-value="${m.id}">${esc(m.label)}</button>`).join("")}
    </div>
    <small class="pf-dsn-small">A visitor who has asked their system for reduced motion gets none of it, whatever is chosen here.</small>
  </div>

  <div class="pf-dsn-group">
    <h4>Page texture</h4>
    <select data-pf-theme="texture" class="pf-dsn-select" aria-label="Page texture">
      ${PF_BLK_GFX.map(g => `<option value="${g.id}" ${t.texture === g.id ? "selected" : ""}>${esc(g.label)}</option>`).join("")}
    </select>
    <small class="pf-dsn-small">Sits behind the whole page, below every block.</small>
  </div>`;
}

function pfDsnWireTheme(host) {
  const setTheme = (key, value, instant) =>
    pfDsnEdit((d) => { d.theme[key] = value; }, { instant: instant !== false });

  host.querySelectorAll("[data-pf-pal]").forEach(btn => btn.addEventListener("click", () => {
    const p = PF_PALETTES.find(x => x.id === btn.dataset.pfPal);
    if (!p) return;
    pfDsnEdit((d) => {
      d.theme.accent = p.accent;
      d.theme.accent2 = p.accent2;
      d.theme.tone = p.tone;
    }, { instant: true });
    pfDsnPaintPanel();
  }));

  host.querySelectorAll("[data-pf-tone]").forEach(btn => btn.addEventListener("click", () => {
    setTheme("tone", btn.dataset.pfTone);
    pfDsnPaintPanel();
  }));

  host.querySelectorAll("[data-pf-theme-btn]").forEach(btn => btn.addEventListener("click", () => {
    setTheme(btn.dataset.pfThemeBtn, btn.dataset.value);
    pfDsnPaintPanel();
  }));

  host.querySelectorAll("[data-pf-theme]").forEach(el => {
    const key = el.dataset.pfTheme;
    const read = () => (key === "radius" ? Number(el.value) : el.value);
    // A colour picker and a range slider both fire `input` continuously while
    // being dragged. Those repaint the canvas — dragging a colour and watching
    // the page follow is the whole point — but they must not each become an
    // undo step, or one sweep of the corner slider would bury the history.
    // So the value before the drag is remembered, the drag itself is applied
    // without history, and `change` (which fires once, when the drag ends)
    // commits that one step.
    const live = el.type === "color" || el.type === "range";
    if (!live) {
      el.addEventListener("change", () => pfDsnEdit((d) => { d.theme[key] = read(); }, { instant: true }));
      return;
    }
    el.addEventListener("pointerdown", () => { _pfDsnLiveBefore[key] = PF_DESIGNER.design.theme[key]; });
    el.addEventListener("keydown", () => {
      if (_pfDsnLiveBefore[key] === undefined) _pfDsnLiveBefore[key] = PF_DESIGNER.design.theme[key];
    });
    el.addEventListener("input", () => {
      if (_pfDsnLiveBefore[key] === undefined) _pfDsnLiveBefore[key] = PF_DESIGNER.design.theme[key];
      PF_DESIGNER.design.theme[key] = read();
      PF_DESIGNER.dirty = true;
      clearTimeout(_pfDsnTimer);
      _pfDsnTimer = setTimeout(() => pfDsnRefresh(false), 90);
      if (key === "radius") {
        const note = el.parentElement && el.parentElement.querySelector(".pf-dsn-small");
        if (note) note.textContent = `${read()}px — every card, button and chip follows this.`;
      }
    });
    el.addEventListener("change", () => pfDsnCommitLive(key));
  });
}

// The undo step for a control that was dragged rather than clicked. The new
// value is already applied, so this pushes the value from *before* the drag
// onto the history — which is the only way undo steps back to where the drag
// started rather than to somewhere in the middle of it.
const _pfDsnLiveBefore = {};

function pfDsnCommitLive(key) {
  const before = _pfDsnLiveBefore[key];
  delete _pfDsnLiveBefore[key];
  if (before === undefined || before === PF_DESIGNER.design.theme[key]) return;
  const snap = JSON.parse(JSON.stringify(PF_DESIGNER.design));
  snap.theme[key] = before;
  PF_DESIGNER.past.push(JSON.stringify(snap));
  if (PF_DESIGNER.past.length > PF_UNDO_DEPTH) PF_DESIGNER.past.shift();
  PF_DESIGNER.future.length = 0;
  pfDsnPaintTopbar();
}

// ---------------------------------------------------------------------------
// Right pane — the selected block
// ---------------------------------------------------------------------------

function pfDsnPaintInspector() {
  const host = document.getElementById("pf-dsn-inspector");
  if (!host) return;
  const blk = PF_DESIGNER.sel ? pfDsnBlock(PF_DESIGNER.sel) : null;

  // Every edit repaints this pane, including the ones made *in* it — typing a
  // heading changes the design, which redraws the control being typed into.
  // So which control had focus, and where the caret was in it, is carried
  // across the repaint. Without this the heading field would lose focus after
  // each character and the customer would type one letter per click.
  const active = document.activeElement;
  const keep = host.contains(active) && active.dataset ? {
    key: active.dataset.pfBlk || null,
    start: active.selectionStart,
    end: active.selectionEnd,
  } : null;
  const restore = () => {
    if (!keep || !keep.key) return;
    const el = host.querySelector(`[data-pf-blk="${keep.key}"]`);
    if (!el) return;
    el.focus();
    if (keep.start != null && el.setSelectionRange) {
      try { el.setSelectionRange(keep.start, keep.end); } catch (e) { /* not a text input */ }
    }
  };

  if (!blk) {
    host.innerHTML = `
      <div class="pf-dsn-none">
        <span aria-hidden="true">⌖</span>
        <h4>Nothing selected</h4>
        <p>Click any part of the page to change how it looks. Everything you edit here is design — your words stay in the portfolio's Content tab.</p>
      </div>`;
    return;
  }

  const def = PF_BLOCK_BY_TYPE[blk.type];
  const i = pfDsnIndex(blk.id);
  const last = PF_DESIGNER.design.blocks.length - 1;
  const opts = (list, key) => list.map(o =>
    `<option value="${o.id}" ${blk[key] === o.id ? "selected" : ""}>${esc(o.label)}</option>`).join("");

  host.innerHTML = `
  <div class="pf-dsn-insp-head">
    <span class="pf-dsn-insp-ico" aria-hidden="true">${def.icon}</span>
    <div>
      <h4>${esc(def.label)}</h4>
      <small>${esc(def.hint)}</small>
    </div>
  </div>

  <div class="pf-dsn-insp-acts">
    <button type="button" class="pf-icon-btn" data-pf-insp="up"   ${i <= 0 ? "disabled" : ""} title="Move up" aria-label="Move up">↑</button>
    <button type="button" class="pf-icon-btn" data-pf-insp="down" ${i >= last ? "disabled" : ""} title="Move down" aria-label="Move down">↓</button>
    <button type="button" class="pf-icon-btn" data-pf-insp="dup"  title="Duplicate" aria-label="Duplicate">⧉</button>
    <button type="button" class="pf-icon-btn" data-pf-insp="hide" title="${blk.hidden ? "Show" : "Hide"}" aria-label="${blk.hidden ? "Show" : "Hide"}">${blk.hidden ? "🚫" : "👁"}</button>
    <button type="button" class="pf-icon-btn pf-danger" data-pf-insp="del" title="Delete" aria-label="Delete">🗑</button>
  </div>

  ${blk.hidden ? `<p class="pf-dsn-warn">This block is hidden — it won't appear on the page or in the download.</p>` : ""}

  <div class="pf-dsn-group">
    <h4>Layout</h4>
    <select class="pf-dsn-select" data-pf-blk="variant" aria-label="Layout">${opts(def.variants, "variant")}</select>
  </div>

  <div class="pf-dsn-group">
    <h4>Heading</h4>
    <input type="text" class="pf-dsn-input" data-pf-blk="title" maxlength="80"
           value="${esc(blk.title)}" placeholder="Use the default"
           aria-label="Heading for this block">
    <small class="pf-dsn-small">Leave it empty to keep the wording this block comes with.</small>
  </div>

  <div class="pf-dsn-group">
    <h4>Background</h4>
    <select class="pf-dsn-select" data-pf-blk="bg" aria-label="Background">${opts(PF_BLK_BG, "bg")}</select>
    ${PF_BLK_BG.some(b => b.id === blk.bg && b.invert)
      ? `<small class="pf-dsn-small">Light text is used on this background, so everything inside flips together.</small>` : ""}
  </div>

  <div class="pf-dsn-group">
    <h4>Decoration</h4>
    <select class="pf-dsn-select" data-pf-blk="gfx" aria-label="Decoration">${opts(PF_BLK_GFX, "gfx")}</select>
  </div>

  <div class="pf-dsn-group">
    <h4>Entrance</h4>
    <select class="pf-dsn-select" data-pf-blk="anim" aria-label="Entrance animation">${opts(PF_BLK_ANIM, "anim")}</select>
  </div>

  <div class="pf-dsn-group">
    <h4>Spacing</h4>
    <div class="pf-dsn-seg" role="group">
      ${PF_BLK_PAD.map(p => `<button type="button" class="${blk.pad === p.id ? "active" : ""}"
        data-pf-blk-btn="pad" data-value="${p.id}">${esc(p.label)}</button>`).join("")}
    </div>
  </div>`;

  host.querySelectorAll("[data-pf-insp]").forEach(btn => btn.addEventListener("click", () => {
    const what = btn.dataset.pfInsp;
    if (what === "up")   pfDsnNudge(blk.id, -1);
    if (what === "down") pfDsnNudge(blk.id, 1);
    if (what === "dup")  pfDsnDuplicate(blk.id);
    if (what === "hide") pfDsnToggleHidden(blk.id);
    if (what === "del")  pfDsnDelete(blk.id);
  }));

  host.querySelectorAll("[data-pf-blk]").forEach(el => {
    const key = el.dataset.pfBlk;
    // A heading is typed, so it repaints on a debounce; a dropdown is one
    // decision and repaints at once.
    el.addEventListener(key === "title" ? "input" : "change", () => pfDsnSet(blk.id, key, el.value));
  });

  host.querySelectorAll("[data-pf-blk-btn]").forEach(btn => btn.addEventListener("click", () =>
    pfDsnSet(blk.id, btn.dataset.pfBlkBtn, btn.dataset.value)));

  restore();
}

// ---------------------------------------------------------------------------
// The library's "Your designs" shelf
// ---------------------------------------------------------------------------

function pfDesignsSection() {
  const mine = _pfDesigns;

  // Nothing built yet. This is a one-line offer, not a section: a heading, a
  // paragraph and a dashed "you haven't built one yet" panel spent a quarter
  // of the screen telling somebody they have nothing — above the templates,
  // which is what they actually came to look at. One row makes the same offer
  // and costs a sixth of the height.
  if (!mine.length) {
    return `
    <section class="pf-own-promo">
      <span class="pf-own-promo-ico" aria-hidden="true">✨</span>
      <div class="pf-own-promo-copy">
        <h3>Build your own</h3>
        <p>Assemble a design from blocks — your layout, colours and motion. One design can dress every portfolio you make.</p>
      </div>
      <button class="btn btn-accent btn-sm" id="pf-dsn-start">Design your own</button>
    </section>`;
  }

  return `
  <section class="pf-gallery-wrap pf-dsn-shelf">
    <div class="pf-gallery-head">
      <div class="pf-gallery-lede">
        <h3>Your designs</h3>
        <p>Built from blocks. A design holds no content, so one can dress every portfolio you make.</p>
      </div>
      <button class="btn btn-accent btn-sm" id="pf-dsn-start">✨ Design your own</button>
    </div>
    <div class="pf-dsn-cards">
      ${mine.map(d => {
        const theme = (d.design && d.design.theme) || {};
        const blocks = ((d.design && d.design.blocks) || []).length;
        const accent = theme.accent || "#6D5AE6";
        const accent2 = theme.accent2 || accent;
        return `
        <article class="pf-dsn-card" data-pf-design="${d.id}" tabindex="0" role="button"
                 aria-label="Edit the design ${esc(d.name)}">
          <div class="pf-dsn-card-shot" data-pf-dsnshot="${d.id}">
            <span class="pf-dsn-card-swatch" aria-hidden="true"
                  style="background:linear-gradient(135deg,${esc(accent)},${esc(accent2)})"></span>
          </div>
          <div class="pf-dsn-card-body">
            <h3>${esc(d.name)}</h3>
            <p>${blocks} block${blocks === 1 ? "" : "s"} · ${esc(theme.tone === "dark" ? "Dark" : "Light")}
               ${d.used_by ? ` · used by ${d.used_by} portfolio${d.used_by === 1 ? "" : "s"}` : ""}</p>
          </div>
          <div class="pf-dsn-card-acts">
            <button class="btn btn-accent btn-xs" data-pf-dsn-act="edit" data-pf-dsn-id="${d.id}">Edit</button>
            <button class="btn btn-ghost btn-xs" data-pf-dsn-act="use" data-pf-dsn-id="${d.id}">New portfolio</button>
            <button class="btn btn-ghost btn-xs" data-pf-dsn-act="dup" data-pf-dsn-id="${d.id}">Duplicate</button>
            <button class="btn btn-ghost btn-xs pf-danger" data-pf-dsn-act="del" data-pf-dsn-id="${d.id}">Delete</button>
          </div>
        </article>`;
      }).join("")}
    </div>
  </section>`;
}

function pfWireDesignsSection(root) {
  const start = root.querySelector("#pf-dsn-start");
  if (start) start.addEventListener("click", () => pfDesignerNew(null, "My design"));

  root.querySelectorAll("[data-pf-design]").forEach(card => {
    card.addEventListener("click", (e) => {
      if (e.target.closest("button")) return;
      pfDesignerOpen(Number(card.dataset.pfDesign));
    });
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pfDesignerOpen(Number(card.dataset.pfDesign)); }
    });
  });

  root.querySelectorAll("[data-pf-dsn-act]").forEach(btn => btn.addEventListener("click", async (e) => {
    e.stopPropagation();
    const id = Number(btn.dataset.pfDsnId);
    const row = _pfDesigns.find(d => d.id === id);
    const act = btn.dataset.pfDsnAct;

    if (act === "edit") return pfDesignerOpen(id);

    if (act === "use") {
      // A new portfolio already wearing this design. The builder opens on
      // Content because that is the only thing left to decide.
      pfStartNew(`custom:${id}`);
      return;
    }

    if (act === "dup") {
      try {
        const copy = await post(`/api/portfolio-designs/${id}/duplicate`);
        _pfDesigns.unshift(copy);
        showToast("Design duplicated");
        render();
      } catch (err) { showToast(apiErrorMessage(err, "Couldn't duplicate that design"), "error"); }
      return;
    }

    if (act === "del") {
      const used = row ? row.used_by : 0;
      const ok = await showConfirmModal({
        title: "Delete this design?",
        message: used
          ? `${used} portfolio${used === 1 ? "" : "s"} currently use this design. Deleting it doesn't touch their content — they'll fall back to the default template until you pick another.`
          : "The design will be removed. No portfolio content is affected.",
        confirmLabel: "Delete",
      });
      if (!ok) return;
      try {
        await del(`/api/portfolio-designs/${id}`);
        _pfDesigns = _pfDesigns.filter(d => d.id !== id);
        if (PF_DESIGNER.id === id) { PF_DESIGNER.id = null; PF_DESIGNER.loadedFor = null; }
        showToast("Design deleted");
        render();
      } catch (err) { showToast(apiErrorMessage(err, "Couldn't delete that design"), "error"); }
    }
  }));

  pfPaintDesignShots(root);
}

// Live thumbnails, same approach as the template gallery: the real renderer at
// a real width, scaled down, one frame at a time so a shelf of designs does
// not boot ten iframes in the same tick.
function pfPaintDesignShots(root) {
  const holders = [].slice.call(root.querySelectorAll("[data-pf-dsnshot]"));
  let i = 0;
  const next = () => {
    if (i >= holders.length) return;
    const holder = holders[i++];
    const id = holder.dataset.pfDsnshot;
    let html;
    try {
      html = pfRenderSite(`custom:${id}`, pfDemoData(), { thumb: true });
    } catch (err) {
      console.error("[portfolio] design thumbnail failed for " + id, err);
      return requestAnimationFrame(next);
    }
    const frame = document.createElement("iframe");
    frame.className = "pf-shot-frame";
    frame.setAttribute("scrolling", "no");
    frame.setAttribute("tabindex", "-1");
    frame.setAttribute("aria-hidden", "true");
    frame.setAttribute("sandbox", "allow-scripts");
    frame.addEventListener("load", () => holder.classList.add("is-live"), { once: true });
    setTimeout(() => holder.classList.add("is-live"), 4000);
    frame.srcdoc = html;
    holder.insertBefore(frame, holder.firstChild);
    if (typeof pfFitThumb === "function") pfFitThumb(frame, holder);
    requestAnimationFrame(next);
  };
  next();
}

// ---------------------------------------------------------------------------
// Left pane — Start
// ---------------------------------------------------------------------------
// The ten art directions, each drawn as a real thumbnail by the same renderer
// that draws the canvas. A swatch of the palette would be quicker and would
// also be a lie: the whole claim these make is "your page will look like
// this", and only the renderer can honour it.

function pfDsnStartHTML() {
  const current = PF_DESIGNER.design;
  return `
  <p class="pf-dsn-note">A finished design to take apart. Applying one changes the layout and
     the theme — never your content — and undo puts it back.</p>
  <div class="pf-dsn-presets">
    ${PF_PRESETS.map(p => `
      <button type="button" class="pf-dsn-preset" data-pf-preset="${esc(p.id)}"
              title="${esc(p.blurb)}">
        <span class="pf-dsn-preset-shot" data-pf-presetshot="${esc(p.id)}">
          <span class="pf-dsn-preset-swatch" aria-hidden="true"
                style="background:linear-gradient(135deg,${esc(p.theme.accent)},${esc(p.theme.accent2)})"></span>
        </span>
        <span class="pf-dsn-preset-body">
          <b>${esc(p.name)}</b>
          <em>${esc(p.blurb)}</em>
          <i>${esc(p.best)}</i>
        </span>
      </button>`).join("")}
    <button type="button" class="pf-dsn-preset pf-dsn-preset-blank" data-pf-preset="__blank">
      <span class="pf-dsn-preset-shot pf-dsn-preset-empty" aria-hidden="true">＋</span>
      <span class="pf-dsn-preset-body">
        <b>Blank canvas</b>
        <em>Nothing but a hero and a footer. Build it up block by block.</em>
        <i>When you already know what you want</i>
      </span>
    </button>
  </div>
  <p class="pf-dsn-small" style="padding:.2rem .1rem 0">
    Currently: ${esc(current.name || "Untitled")} · ${current.blocks.length} blocks
  </p>`;
}

function pfDsnWireStart(host) {
  host.querySelectorAll("[data-pf-preset]").forEach(btn => btn.addEventListener("click", async () => {
    const id = btn.dataset.pfPreset;

    // Replacing the design is the single most destructive thing in here, so
    // it asks once — but only when there is work to lose. Applying a preset
    // to the untouched default is what the panel is for.
    if (PF_DESIGNER.dirty || PF_DESIGNER.id) {
      const ok = await showConfirmModal({
        title: "Replace this design?",
        message: "The layout, colours and every block setting will be replaced. Your portfolio's content isn't touched, and Ctrl+Z undoes this.",
        confirmLabel: "Replace",
        danger: false,
      });
      if (!ok) return;
    }

    const next = id === "__blank"
      ? pfNormalizeDesign(pfBlankDesign(PF_DESIGNER.name || "My design"))
      : pfPresetDesign(id);
    if (!next) return;

    // Through pfDsnEdit, so it lands on the undo stack like any other change.
    pfDsnEdit((d) => {
      d.theme = next.theme;
      d.blocks = next.blocks;
    }, { instant: true });

    // The name follows the preset only while it is still the default one —
    // renaming somebody's saved design out from under them would be rude.
    const preset = PF_PRESETS.find(x => x.id === id);
    if (preset && !PF_DESIGNER.id && /^(my design|untitled design|)$/i.test((PF_DESIGNER.name || "").trim())) {
      PF_DESIGNER.name = preset.name;
      PF_DESIGNER.design.name = preset.name;
      pfDsnPaintTopbar();
    }

    PF_DESIGNER.sel = null;
    PF_DESIGNER.panel = "layers";     // straight to what you can now change
    pfDsnPaintPanel();
    pfDsnPaintInspector();
    showToast(preset ? `${preset.name} applied` : "Blank canvas");
  }));

  pfDsnPaintPresetShots(host);
}

// Thumbnails, one frame at a time. Same queue-per-frame approach the template
// gallery uses: eleven iframes booting in one tick locks the tab up.
function pfDsnPaintPresetShots(host) {
  const holders = [].slice.call(host.querySelectorAll("[data-pf-presetshot]"));
  const data = pfDsnPreviewData();
  let i = 0;
  const next = () => {
    if (i >= holders.length) return;
    // The panel is repainted on every edit; a queue left running against a
    // detached node would keep building frames nobody can see.
    if (!host.isConnected) return;
    const holder = holders[i++];
    const design = pfPresetDesign(holder.dataset.pfPresetshot);
    if (!design) return requestAnimationFrame(next);

    let html;
    try {
      // Rendered through the same lookup hook the canvas uses, with the
      // preset swapped in for the length of this one call.
      _pfShotDesign = design;
      html = pfRenderSite(PF_SHOT_DESIGN, data, { thumb: true });
    } catch (err) {
      console.error("[portfolio] preset thumbnail failed", err);
      return requestAnimationFrame(next);
    } finally {
      _pfShotDesign = null;
    }

    const frame = document.createElement("iframe");
    frame.className = "pf-shot-frame";
    frame.setAttribute("scrolling", "no");
    frame.setAttribute("tabindex", "-1");
    frame.setAttribute("aria-hidden", "true");
    frame.setAttribute("sandbox", "allow-scripts");
    frame.addEventListener("load", () => holder.classList.add("is-live"), { once: true });
    setTimeout(() => holder.classList.add("is-live"), 4000);
    frame.srcdoc = html;
    holder.insertBefore(frame, holder.firstChild);
    if (typeof pfFitThumb === "function") pfFitThumb(frame, holder);
    requestAnimationFrame(next);
  };
  next();
}
