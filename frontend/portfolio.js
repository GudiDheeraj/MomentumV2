// ============================================================================
// Momentum — Portfolio tab
// ============================================================================
// The library (every site you've built) and the builder (the editor beside a
// live preview). The rendering itself lives in portfolio-templates.js; nothing
// in this file knows what a template looks like, which is why adding an
// eleventh one needs no change here.
//
// Loaded as a classic script before app.js and relies on app.js globals:
// get/post/put/del, esc, showToast, showConfirmModal, apiErrorMessage,
// timeAgo, auth, API_BASE, state, render, scrollPageTo.
// ============================================================================

// The one in-progress edit. Kept at module scope (not in `state`) so switching
// to another tab and back doesn't lose unsaved work — same pattern the résumé
// builder's EDITOR uses.
const PF_EDITOR = {
  id: null,            // null while the portfolio has never been saved
  name: "",
  templateId: PF_DEFAULT_TEMPLATE,
  resumeId: null,
  data: null,          // normalized portfolio data
  dirty: false,
  loadedFor: null,     // guards against re-loading the same portfolio on re-render
  tab: "content",      // which builder panel is open
  device: "desktop",   // preview width
  photoSeeded: false,  // the profile-photo auto-fill is a one-shot per portfolio
  photoBusy: false,    // guards against two photo loads racing each other
};

let _pfResumes = null;      // cached résumé list for the Résumé panel
let _pfPreviewTimer = null;
let _pfLastHTML = "";
// Where the preview is scrolled to. The iframe reports this by postMessage
// (see PF_PREVIEW_BRIDGE) because it is sandboxed to an opaque origin and the
// parent therefore cannot read its scroll position directly.
let _pfPreviewScrollY = 0;
let _pfBridgeWired = false;

// Scrolling the page. Newer builds cap the shell at the viewport and give
// <main> the only scrollbar, so they route this through their own helper;
// older ones scroll the window. Feature-detect rather than assume, so this
// file drops into either without an edit.
function pfScrollTop() {
  if (typeof scrollPageTo === "function") { scrollPageTo(0); return; }
  const main = document.querySelector("#app > main");
  if (main) main.scrollTop = 0;
  else window.scrollTo(0, 0);
}

function pfBlankData() { return pfNormalize({}); }

// Resolves a stored template id to one that can actually be drawn.
//
// A "custom:12" reference is kept only while the design behind it still
// exists. When it doesn't — the customer deleted the design — this falls back
// to the default rather than leaving the builder pointing at nothing, which
// is the same thing pfRenderSite does with an unresolvable id. Keeping the two
// in step matters: if the builder held on to a dead reference, the preview
// would draw the default while the picker claimed a design was selected.
function pfKnownTemplate(id) {
  if (PF_TEMPLATE_BY_ID[id]) return id;
  if (typeof pfDesignRow === "function" && pfDesignRow(id)) return id;
  return PF_DEFAULT_TEMPLATE;
}

// What the current template is called, whether it is one of the built-in 38 or
// a design the customer assembled.
function pfTemplateName(id) {
  const design = typeof pfDesignLabel === "function" ? pfDesignLabel(id) : null;
  if (design) return design;
  return (PF_TEMPLATE_BY_ID[id] || PF_TEMPLATE_BY_ID[PF_DEFAULT_TEMPLATE]).name;
}

// ---------------------------------------------------------------------------
// Page shell
// ---------------------------------------------------------------------------
async function renderPortfolioPage(content) {
  const tabsSlot = document.getElementById("view-tabs-slot");
  const controls = document.getElementById("header-controls");
  const view = state.portfolioView || "library";

  // Saved designs have to be in memory before anything renders: the template
  // picker lists them, the library draws them, and pfRenderSite resolves a
  // "custom:12" template through them. Loading is failure-tolerant — the 38
  // built-in templates do not depend on it — so this is not guarded.
  await pfDesignsLoad();

  // The designer takes the whole screen. Leaving the sub-tabs above it would
  // offer a one-click exit from an editor holding unsaved work, with no
  // chance to ask about it first — the ← in its own top bar does that.
  if (view === "designer") {
    tabsSlot.innerHTML = "";
    controls.innerHTML = "";
    await pfRenderDesigner(content);
    return;
  }

  tabsSlot.innerHTML = `
    <div class="view-tabs dash-tabs" id="pf-subtabs">
      <button type="button" class="view-tab ${view === "library" ? "active" : ""}" data-pf-tab="library">🌐 My Portfolios</button>
      <button type="button" class="view-tab ${view === "builder" ? "active" : ""}" data-pf-tab="builder">🛠️ Builder</button>
    </div>`;
  tabsSlot.querySelectorAll("[data-pf-tab]").forEach(btn => {
    btn.addEventListener("click", () => {
      state.portfolioView = btn.dataset.pfTab;
      pfScrollTop();
      render();
    });
  });

  if (view === "builder") {
    controls.innerHTML = "";
    await pfRenderBuilder(content);
  } else {
    controls.innerHTML = `<button class="btn btn-accent" id="pf-new-btn">+ New portfolio</button>`;
    controls.querySelector("#pf-new-btn").addEventListener("click", () => pfStartNew());
    await pfRenderLibrary(content);
  }
}

function pfStartNew(templateId) {
  PF_EDITOR.id = null;
  PF_EDITOR.name = "";
  PF_EDITOR.templateId = templateId || PF_DEFAULT_TEMPLATE;
  PF_EDITOR.resumeId = null;
  PF_EDITOR.data = pfBlankData();
  PF_EDITOR.dirty = false;
  PF_EDITOR.photoSeeded = false;
  PF_EDITOR.loadedFor = "new";
  PF_EDITOR.tab = "content";
  state.portfolioId = null;
  state.portfolioView = "builder";
  pfScrollTop();
  render();
}

function pfEditPortfolio(id) {
  PF_EDITOR.loadedFor = null;   // forces a reload from the API
  PF_EDITOR.photoSeeded = true; // an existing portfolio keeps the photo it was saved with
  state.portfolioId = id;
  state.portfolioView = "builder";
  pfScrollTop();
  render();
}

// ---------------------------------------------------------------------------
// Library
// ---------------------------------------------------------------------------
async function pfRenderLibrary(content) {
  let rows = [];
  try {
    rows = await get("/api/portfolios");
  } catch (err) {
    content.innerHTML = `<div class="card p-6 text-sm text-red-600">Couldn't load your portfolios. ${esc(apiErrorMessage(err, ""))}</div>`;
    return;
  }

  if (!rows.length) {
    // An empty library is the one moment where showing the options beats
    // showing a button: the question isn't "do you want a portfolio", it's
    // "which one". So the hero stays short and the choosing starts high —
    // building your own leads, then the templates, and neither should be
    // below the fold.
    content.innerHTML = pfHero() + pfDesignsSection() + pfGallerySection({
      title: "Choose a template",
      sub: "Each card is the real template, rendered with sample content — the same engine that builds your download. Hover for a full-size preview.",
    });
    pfWireGallery(content);
    pfWireDesignsSection(content);
    return;
  }

  content.innerHTML = `
    ${pfDesignsSection()}
    <div class="pf-cards" id="pf-cards">${rows.map(pfLibraryCard).join("")}</div>
    ${pfGallerySection({
      title: "Start another from a template",
      sub: "Shown with sample content. Your words replace it — and switching template later keeps every one of them.",
    })}`;

  pfWireGallery(content);
  pfWireDesignsSection(content);

  content.querySelectorAll("[data-pf-open]").forEach(el =>
    el.addEventListener("click", () => pfEditPortfolio(Number(el.dataset.pfOpen))));

  content.querySelectorAll("[data-pf-action]").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const id = Number(btn.dataset.pfId);
      const row = rows.find(r => r.id === id);
      const action = btn.dataset.pfAction;

      if (action === "edit") return pfEditPortfolio(id);

      if (action === "download") {
        try {
          const full = await get(`/api/portfolios/${id}`, { noCache: true });
          pfDownloadSite(full.template_id, full.data, full.name, id);
        } catch (err) { showToast(apiErrorMessage(err, "Couldn't build that file"), "error"); }
        return;
      }

      if (action === "preview") {
        try {
          const full = await get(`/api/portfolios/${id}`, { noCache: true });
          pfOpenInNewTab(pfRenderSite(full.template_id, full.data));
        } catch (err) { showToast(apiErrorMessage(err, "Couldn't open the preview"), "error"); }
        return;
      }

      if (action === "duplicate") {
        try {
          await post(`/api/portfolios/${id}/duplicate`);
          showToast("Copy created", "success");
          render();
        } catch (err) { showToast(apiErrorMessage(err, "Couldn't duplicate"), "error"); }
        return;
      }

      if (action === "delete") {
        const ok = await showConfirmModal({
          title: "Delete this portfolio?",
          message: `"${esc(row ? row.name : "This portfolio")}" and its content will be removed. Any file you already downloaded keeps working — it's a standalone page.`,
          confirmLabel: "Delete",
        });
        if (!ok) return;
        try {
          await del(`/api/portfolios/${id}`);
          if (PF_EDITOR.id === id) { PF_EDITOR.id = null; PF_EDITOR.loadedFor = null; }
          showToast("Portfolio deleted", "success");
          render();
        } catch (err) { showToast(apiErrorMessage(err, "Couldn't delete"), "error"); }
      }
    });
  });

  // Thumbnails render after the cards are in the DOM, one per frame, so a
  // library of twenty doesn't lock the tab up while ten iframes boot at once.
  pfPaintThumbnails(rows);
}

function pfLibraryCard(r) {
  const design = typeof pfDesignRow === "function" ? pfDesignRow(r.template_id) : null;
  const t = PF_TEMPLATE_BY_ID[r.template_id] || PF_TEMPLATE_BY_ID[PF_DEFAULT_TEMPLATE];
  const tplName = design ? design.name : t.name;
  const tplAccent = design ? (design.design && design.design.theme && design.design.theme.accent) || t.accent : t.accent;
  return `
  <article class="pf-card" data-pf-open="${r.id}" tabindex="0" role="button" aria-label="Open ${esc(r.name)}">
    <div class="pf-card-shot" data-pf-shot="${r.id}">
      <div class="pf-shot-skeleton"><span class="spinner-sm"></span></div>
      <span class="pf-card-tpl"><i style="background:${esc(tplAccent)}"></i>${esc(tplName)}${design ? ` <em>your design</em>` : ""}</span>
    </div>
    <div class="pf-card-body">
      <h3>${esc(r.name)}</h3>
      <p>${esc(r.headline || "No name set yet")}${r.subheading ? " · " + esc(r.subheading) : ""}</p>
      <div class="pf-card-meta">
        <span>${r.section_count} section${r.section_count === 1 ? "" : "s"}</span>
        <span>·</span>
        <span>Edited ${esc(timeAgo(r.updated_at || r.created_at))}</span>
        ${r.resume_id ? `<span class="pf-card-flag" title="A résumé is attached to this site">📄 Résumé linked</span>` : ""}
        ${r.last_exported_at ? `<span class="pf-card-flag pf-flag-ok">↓ Downloaded</span>` : `<span class="pf-card-flag pf-flag-warn">Not downloaded yet</span>`}
      </div>
    </div>
    <div class="pf-card-actions">
      <button class="btn btn-accent btn-xs" data-pf-action="edit" data-pf-id="${r.id}">Edit</button>
      <button class="btn btn-ghost btn-xs" data-pf-action="download" data-pf-id="${r.id}">Download</button>
      <button class="btn btn-ghost btn-xs" data-pf-action="preview" data-pf-id="${r.id}">Preview</button>
      <button class="btn btn-ghost btn-xs" data-pf-action="duplicate" data-pf-id="${r.id}">Duplicate</button>
      <button class="btn btn-ghost btn-xs pf-danger" data-pf-action="delete" data-pf-id="${r.id}">Delete</button>
    </div>
  </article>`;
}

// ---------------------------------------------------------------------------
// Template picker
// ---------------------------------------------------------------------------

// Short on purpose. The old hero was a 370px-tall empty card with a globe in
// it, which pushed the ten templates — the actual decision on this screen —
// below the fold. Three steps in one band says the same thing in a third of
// the height.
function pfHero() {
  const steps = [
    // The count comes from the catalogue: it said "Ten to choose from" for a
    // long time after there were thirty-eight, because it was typed once.
    [`Pick a design`, `${PF_TEMPLATES.length} to choose from, or build your own. Switch whenever you like — your words carry over.`],
    ["Pull in your résumé", "Name, roles, skills and projects, filled in from one you have already built."],
    ["Download one file", "Self-contained HTML. Netlify, GitHub Pages, Vercel or your own domain."],
  ];
  return `
  <section class="pf-hero">
    <div class="pf-hero-main">
      <span class="pf-hero-eyebrow">Portfolio builder</span>
      <h2>A portfolio site, built from the résumé you already wrote.</h2>
      <p>No build step, no hosting account, no monthly fee — one HTML file you own and can put anywhere.</p>
    </div>
    <ol class="pf-hero-steps">
      ${steps.map(([h, d], i) => `
        <li class="pf-step">
          <span class="pf-step-n">${i + 1}</span>
          <span class="pf-step-t"><strong>${h}</strong><small>${d}</small></span>
        </li>`).join("")}
    </ol>
  </section>`;
}

// Tone is the filter that actually narrows a choice of ten — every other axis
// (minimal, bold, narrative) is one template deep and would just be a chip
// that hides nine things.
function pfGallerySection({ title, sub }) {
  // "auto" templates follow the visitor's system setting, so the filter shows
  // them under both Light and Dark — and the count has to say so, or the chips
  // add up to nine out of ten and look like a bug.
  const counts = { all: PF_TEMPLATES.length, light: 0, dark: 0 };
  PF_TEMPLATES.forEach(t => {
    if (t.tone === "light" || t.tone === "auto") counts.light++;
    if (t.tone === "dark" || t.tone === "auto") counts.dark++;
  });
  const filters = [
    { id: "all", label: "All" },
    { id: "light", label: "Light" },
    { id: "dark", label: "Dark" },
  ];
  return `
  <section class="pf-gallery-wrap">
    <div class="pf-gallery-head">
      <div class="pf-gallery-lede">
        <h3>${esc(title)}</h3>
        <p>${esc(sub)}</p>
      </div>
      <div class="pf-filters" role="group" aria-label="Filter templates by tone">
        ${filters.map(f => `
          <button type="button" class="pf-chip${f.id === "all" ? " active" : ""}"
                  data-pf-filter="${f.id}" aria-pressed="${f.id === "all"}">
            ${f.label}<span class="pf-chip-n">${counts[f.id] || 0}</span>
          </button>`).join("")}
      </div>
    </div>
    <div class="pf-gallery" id="pf-gallery">${PF_TEMPLATES.map(pfTemplateCard).join("")}</div>
    <p class="pf-gallery-foot" hidden data-pf-empty-filter>No templates in that tone.</p>
  </section>`;
}

// The card is an <article>, not a <button>, because it now contains two real
// buttons of its own and a button inside a button is invalid markup that
// browsers silently unnest. It keeps the keyboard behaviour a button would
// have had via role/tabindex/Enter.
function pfTemplateCard(t) {
  return `
  <article class="pf-tpl" data-pf-template="${t.id}" data-pf-tone="${t.tone}"
           tabindex="0" role="button" aria-label="Use the ${esc(t.name)} template">
    <div class="pf-tpl-shot" data-pf-tplshot="${t.id}">
      <div class="pf-tpl-fallback" aria-hidden="true">${pfTemplateSwatch(t)}</div>
      <div class="pf-tpl-hover">
        <button type="button" class="pf-mini-btn pf-mini-ghost" data-pf-preview="${t.id}">Preview full size</button>
        <button type="button" class="pf-mini-btn pf-mini-solid" data-pf-use="${t.id}">Use this template</button>
      </div>
    </div>
    <div class="pf-tpl-body">
      <span class="pf-tpl-name">
        <i class="pf-tpl-dot" style="background:${esc(t.accent)}"></i>${esc(t.name)}
        <span class="pf-tpl-badge">${esc(t.tag)}</span>
      </span>
      <span class="pf-tpl-desc">${esc(t.description)}</span>
      <span class="pf-tpl-best">Best for ${esc(t.bestFor.toLowerCase())}</span>
    </div>
  </article>`;
}

function pfWireGallery(root) {
  root.querySelectorAll("[data-pf-template]").forEach(card => {
    const id = card.dataset.pfTemplate;
    card.addEventListener("click", (e) => {
      if (e.target.closest("[data-pf-preview],[data-pf-use]")) return;
      pfStartNew(id);
    });
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pfStartNew(id); }
    });
  });
  root.querySelectorAll("[data-pf-use]").forEach(b =>
    b.addEventListener("click", (e) => { e.stopPropagation(); pfStartNew(b.dataset.pfUse); }));
  root.querySelectorAll("[data-pf-preview]").forEach(b =>
    b.addEventListener("click", (e) => { e.stopPropagation(); pfOpenTemplatePreview(b.dataset.pfPreview); }));

  const chips = Array.from(root.querySelectorAll("[data-pf-filter]"));
  chips.forEach(chip => chip.addEventListener("click", () => {
    const tone = chip.dataset.pfFilter;
    chips.forEach(c => {
      const on = c === chip;
      c.classList.toggle("active", on);
      c.setAttribute("aria-pressed", String(on));
    });
    let shown = 0;
    root.querySelectorAll("[data-pf-tone]").forEach(card => {
      // "auto" follows the visitor's system setting, so it belongs in both.
      const t = card.dataset.pfTone;
      const match = tone === "all" || t === tone || t === "auto";
      card.hidden = !match;
      if (match) shown++;
    });
    const empty = root.querySelector("[data-pf-empty-filter]");
    if (empty) empty.hidden = shown > 0;
  }));

  pfPaintTemplateShots(root);
}

// ---------------------------------------------------------------------------
// Real template thumbnails
// ---------------------------------------------------------------------------
// Ten sandboxed iframes, each running a full site with webfonts, is not
// something to boot on page load. Two rules keep it cheap: a card is only
// rendered once it is near the viewport, and only one boots at a time. Until
// then the card shows the cheap SVG swatch, so nothing is ever blank.
function pfPaintTemplateShots(root) {
  const holders = Array.from(root.querySelectorAll("[data-pf-tplshot]"));
  if (!holders.length) return;

  // Two at a time. One was safe but serial: a slow webfont on card three held
  // up cards four through ten, and the tail of the grid sat on its swatch for
  // seconds. Two halves that without putting ten renderers on the main thread
  // at once, which is what the sequencing exists to prevent.
  const MAX_IN_FLIGHT = 2;
  const queue = [];
  let inFlight = 0;

  const pump = () => {
    while (inFlight < MAX_IN_FLIGHT) {
      const holder = queue.shift();
      if (!holder) return;
      if (!holder.isConnected || holder.dataset.pfPainted) continue;
      inFlight++;
      holder.dataset.pfPainted = "1";
      pfMountTemplateFrame(holder, holder.dataset.pfTplshot, () => {
        inFlight--;
        requestAnimationFrame(pump);
      });
    }
  };

  const enqueue = (holder) => { queue.push(holder); pump(); };

  if (typeof IntersectionObserver === "function") {
    const io = new IntersectionObserver((entries) => {
      entries.forEach(e => {
        if (!e.isIntersecting) return;
        io.unobserve(e.target);
        enqueue(e.target);
      });
    }, { rootMargin: "500px 0px" });
    holders.forEach(h => io.observe(h));
  } else {
    holders.forEach(enqueue);
  }
}

function pfMountTemplateFrame(holder, id, done) {
  let settled = false;
  const finish = () => { if (settled) return; settled = true; done(); };

  const t = PF_TEMPLATE_BY_ID[id];
  if (!t) return finish();

  const frame = document.createElement("iframe");
  frame.className = "pf-shot-frame";
  frame.setAttribute("scrolling", "no");
  frame.setAttribute("tabindex", "-1");
  frame.setAttribute("aria-hidden", "true");
  frame.setAttribute("sandbox", "allow-scripts");
  frame.addEventListener("load", () => {
    holder.classList.add("is-live");
    // A beat after load so webfonts have swapped in before the swatch behind
    // it fades out — otherwise the card flashes from art to unstyled text.
    setTimeout(finish, 140);
  }, { once: true });

  // A frame that never fires load (a blocked font host, an odd browser) must
  // not wedge the queue and leave the other nine cards as swatches forever.
  setTimeout(() => { holder.classList.add("is-live"); finish(); }, 4000);

  let html;
  try {
    html = pfRenderSite(id, pfDemoData(), { thumb: true });
  } catch (err) {
    // One broken template leaves its own card on the SVG swatch and lets the
    // other twenty render, rather than wedging the queue.
    console.error("[portfolio] thumbnail render failed for " + id, err);
    return finish();
  }
  frame.srcdoc = html;              // document first, then attach
  holder.insertBefore(frame, holder.firstChild);
  pfFitThumb(frame, holder);
}

// ---------------------------------------------------------------------------
// Full-size template preview
// ---------------------------------------------------------------------------
// The card answers "what does this look like"; this answers "what is it like
// to be on it" — scrollable, animated, at a real device width, and steppable
// through all ten without closing and reopening.
let _pfPv = null;

function pfOpenTemplatePreview(id) {
  const root = document.getElementById("modal-root");
  if (!root) return;
  // Opening a 1280px layout on a 390px screen means scaling it to 28% — a
  // grey smudge that answers nothing. Start at the width the person is
  // actually holding; the toggle is right there if they want the desktop view.
  _pfPv = { id, device: window.innerWidth < 780 ? "mobile" : "desktop" };

  root.innerHTML = `
    <div class="modal-backdrop pf-pv-backdrop" data-modal-backdrop>
      <div class="modal-box pf-pv-box">
        <header class="pf-pv-bar">
          <div class="pf-pv-id">
            <i class="pf-pv-dot" data-pf-pv-dot></i>
            <h3 data-pf-pv-name></h3>
            <span class="pf-tpl-badge" data-pf-pv-badge></span>
            <span class="pf-pv-sample">Sample content — your details replace all of this</span>
          </div>
          <div class="pf-pv-devices" role="group" aria-label="Preview width">
            ${Object.entries(PF_DEVICES).map(([k, d]) => `
              <button type="button" class="pf-pv-dev" data-pf-dev="${k}"
                      aria-pressed="false" title="${d.label} — ${d.w}px">${d.icon}<span>${d.label}</span></button>`).join("")}
          </div>
          <div class="pf-pv-actions">
            <button type="button" class="pf-pv-step" data-pf-pv-step="-1" aria-label="Previous template">‹</button>
            <span class="pf-pv-count" data-pf-pv-count></span>
            <button type="button" class="pf-pv-step" data-pf-pv-step="1" aria-label="Next template">›</button>
            <button type="button" class="btn btn-accent" data-pf-pv-use>Use this template</button>
            <button type="button" class="pf-pv-close" data-pf-pv-close aria-label="Close preview">✕</button>
          </div>
        </header>
        <div class="pf-pv-stage" data-pf-pv-stage></div>
      </div>
    </div>`;
  root.classList.remove("hidden");

  root.querySelector("[data-pf-pv-close]").addEventListener("click", closeModal);
  root.querySelector("[data-modal-backdrop]").addEventListener("click", (e) => {
    if (e.target === e.currentTarget) closeModal();
  });
  root.querySelectorAll("[data-pf-pv-step]").forEach(b =>
    b.addEventListener("click", () => pfPvStep(Number(b.dataset.pfPvStep))));
  root.querySelectorAll("[data-pf-dev]").forEach(b =>
    b.addEventListener("click", () => { _pfPv.device = b.dataset.pfDev; pfPvPaint(); }));
  root.querySelector("[data-pf-pv-use]").addEventListener("click", () => {
    const chosen = _pfPv.id;
    closeModal();
    pfStartNew(chosen);
  });

  // Left/right step through the gallery without leaving the preview. Bound on
  // the overlay rather than the document so it dies with the modal.
  root.querySelector(".pf-pv-box").addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft") { e.preventDefault(); pfPvStep(-1); }
    if (e.key === "ArrowRight") { e.preventDefault(); pfPvStep(1); }
  });

  window.addEventListener("resize", pfPvFit, { passive: true });
  pfPvPaint();
  _activateModal(root, closeModal);
}

function pfPvStep(delta) {
  const i = PF_TEMPLATES.findIndex(t => t.id === _pfPv.id);
  const next = PF_TEMPLATES[(i + delta + PF_TEMPLATES.length) % PF_TEMPLATES.length];
  _pfPv.id = next.id;
  pfPvPaint();
}

function pfPvPaint() {
  const root = document.getElementById("modal-root");
  if (!root || !_pfPv) return;
  const t = PF_TEMPLATE_BY_ID[_pfPv.id];
  if (!t) return;
  const i = PF_TEMPLATES.findIndex(x => x.id === t.id);

  root.querySelector("[data-pf-pv-dot]").style.background = t.accent;
  root.querySelector("[data-pf-pv-name]").textContent = t.name;
  root.querySelector("[data-pf-pv-badge]").textContent = t.tag;
  root.querySelector("[data-pf-pv-count]").textContent = `${i + 1} / ${PF_TEMPLATES.length}`;
  root.querySelectorAll("[data-pf-dev]").forEach(b => {
    const on = b.dataset.pfDev === _pfPv.device;
    b.classList.toggle("active", on);
    b.setAttribute("aria-pressed", String(on));
  });

  const stage = root.querySelector("[data-pf-pv-stage]");
  if (!stage) return;

  // Full fidelity here: no thumb flag, so reveals reveal and animations run.
  let html;
  try {
    html = pfRenderSite(t.id, pfDemoData());
  } catch (err) {
    // A template that throws must say so. Silently leaving the previous frame
    // in place is how a preview ends up showing something that is not the
    // template you clicked — the worst possible outcome for a dialog whose
    // entire job is telling you what you are about to choose.
    console.error("[portfolio] preview render failed for " + t.id, err);
    stage.innerHTML = `<div class="pf-pv-fail">
      <b>This template failed to render.</b>
      <span>${esc(t.name)} — ${esc(err && err.message ? err.message : String(err))}</span>
      <span class="pf-pv-fail-hint">The details are in the browser console. Other templates are unaffected.</span>
    </div>`;
    return;
  }

  // A fresh element every paint, with its document set BEFORE it is attached.
  //
  // Two reasons, both about never showing the wrong page. An <iframe> that
  // ends up with an empty src resolves it against the parent's URL and loads
  // the app itself — so this one is never given a src at all, and being built
  // in JS means no markup can accidentally add one. And re-using a live frame
  // keeps whatever document it already had if the new srcdoc does not take;
  // a new element has nothing to fall back to.
  const frame = document.createElement("iframe");
  frame.className = "pf-pv-frame";
  frame.setAttribute("data-pf-pv-frame", "");
  frame.setAttribute("title", "Preview of the " + t.name + " template");
  frame.setAttribute("sandbox", "allow-scripts allow-popups");
  frame.srcdoc = html;
  stage.replaceChildren(frame);
  pfPvFit();
}

// The site renders at the device's real width and the whole frame is scaled to
// fit the stage. Scaling rather than resizing is the point: a 1280px layout
// shown in a 900px stage is still a 1280px layout, which is what you are
// trying to judge. It never scales up past 1:1.
function pfPvFit() {
  const root = document.getElementById("modal-root");
  if (!root || !_pfPv) return;
  const stage = root.querySelector("[data-pf-pv-stage]");
  const frame = root.querySelector("[data-pf-pv-frame]");
  if (!stage || !frame) return;
  const w = PF_DEVICES[_pfPv.device].w;
  const avail = stage.clientWidth - 32;
  const scale = Math.min(1, avail / w);
  frame.style.width = w + "px";
  frame.style.height = Math.round((stage.clientHeight - 24) / scale) + "px";
  frame.style.transform = `scale(${scale})`;
  frame.classList.toggle("pf-pv-framed", _pfPv.device !== "desktop");
}

// A tiny abstract wireframe per template — hero shape, colour, rhythm. Cheaper
// and steadier than booting ten iframes just to fill a picker.
function pfTemplateSwatch(t) {
  const [a, b, bg] = t.swatch;
  const dark = t.tone === "dark";
  const ink = dark ? "rgba(255,255,255,.9)" : "rgba(20,22,26,.85)";
  const soft = dark ? "rgba(255,255,255,.24)" : "rgba(20,22,26,.18)";
  const bar = (x, y, w, h, fill, r = 2) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}"/>`;
  let art = "";
  if (t.id === "aurora") {
    art = `<circle cx="128" cy="18" r="42" fill="${a}" opacity=".55"/><circle cx="24" cy="70" r="34" fill="${b}" opacity=".35"/>
      ${bar(14, 30, 62, 9, ink, 3)}${bar(14, 44, 44, 5, soft)}${bar(14, 56, 30, 8, a, 4)}
      ${bar(96, 46, 44, 44, a, 8)}`;
  } else if (t.id === "monogram") {
    art = `${bar(14, 12, 132, 1, soft, 0)}${bar(18, 30, 84, 12, ink, 2)}${bar(18, 48, 52, 4, soft)}
      ${bar(18, 62, 128, 1, soft, 0)}${bar(18, 70, 100, 4, soft)}${bar(18, 80, 76, 4, soft)}`;
  } else if (t.id === "terminal") {
    art = `${bar(12, 12, 136, 52, dark ? "#111820" : "#111820", 5)}
      <circle cx="20" cy="19" r="2.4" fill="#FF5F57"/><circle cx="28" cy="19" r="2.4" fill="#FEBC2E"/><circle cx="36" cy="19" r="2.4" fill="#28C840"/>
      ${bar(18, 28, 40, 3.5, a)}${bar(18, 36, 76, 3.5, soft)}${bar(18, 44, 58, 3.5, soft)}${bar(18, 52, 6, 5, a, 1)}
      ${bar(14, 72, 66, 8, ink, 2)}${bar(14, 85, 40, 4, a)}`;
  } else if (t.id === "neon") {
    art = `${bar(0, 62, 160, 38, a, 0)}<g opacity=".25">
      ${[0, 1, 2, 3, 4].map(i => bar(10 + i * 34, 64, 1, 36, "#fff", 0)).join("")}</g>
      ${bar(30, 24, 100, 12, ink, 2)}${bar(46, 42, 68, 5, b)}`;
  } else if (t.id === "editorial") {
    art = `${bar(14, 14, 132, 1.5, ink, 0)}${bar(30, 26, 100, 14, ink, 2)}${bar(44, 46, 72, 4, soft)}
      ${bar(14, 62, 62, 4, soft)}${bar(14, 71, 62, 4, soft)}${bar(14, 80, 48, 4, soft)}
      ${bar(84, 62, 62, 4, soft)}${bar(84, 71, 62, 4, soft)}${bar(84, 80, 38, 4, a)}`;
  } else if (t.id === "sidebar") {
    art = `${bar(8, 8, 46, 84, dark ? "rgba(255,255,255,.08)" : "#fff", 6)}
      <circle cx="31" cy="26" r="11" fill="${a}"/>${bar(16, 42, 30, 4, ink)}${bar(20, 50, 22, 3, soft)}
      ${bar(16, 60, 30, 3, soft)}${bar(16, 68, 30, 3, a)}${bar(16, 76, 30, 3, soft)}
      ${bar(62, 12, 90, 22, dark ? "rgba(255,255,255,.06)" : "#fff", 5)}${bar(62, 40, 90, 22, dark ? "rgba(255,255,255,.06)" : "#fff", 5)}
      ${bar(62, 68, 90, 22, dark ? "rgba(255,255,255,.06)" : "#fff", 5)}`;
  } else if (t.id === "timeline") {
    art = `${bar(24, 14, 2, 76, a, 1)}
      ${[18, 44, 70].map(y => `<circle cx="25" cy="${y}" r="5" fill="${bg}" stroke="${a}" stroke-width="2.5"/>
        ${bar(38, y - 8, 108, 18, dark ? "rgba(255,255,255,.07)" : "#fff", 4)}
        ${bar(44, y - 3, 50, 3.5, ink)}${bar(44, y + 4, 74, 3, soft)}`).join("")}`;
  } else if (t.id === "deck") {
    art = `${bar(14, 12, 60, 9, ink, 2)}${bar(78, 12, 40, 9, a, 2)}
      ${[0, 1, 2].map(i => bar(14 + i * 46, 32, 40, 30, dark ? "rgba(255,255,255,.07)" : "#fff", 5)).join("")}
      ${[0, 1, 2].map(i => bar(14 + i * 46, 68, 40, 24, dark ? "rgba(255,255,255,.07)" : "#fff", 5)).join("")}`;
  } else if (t.id === "aquarelle") {
    art = `<ellipse cx="128" cy="26" rx="34" ry="28" fill="${a}" opacity=".3"/>
      <ellipse cx="20" cy="74" rx="28" ry="24" fill="${b}" opacity=".28"/>
      ${bar(14, 22, 26, 4, b, 2)}${bar(14, 32, 74, 11, ink, 2)}
      <path d="M14 50 C36 47 58 52 88 49" stroke="${a}" stroke-width="2" fill="none" opacity=".7"/>
      ${bar(14, 62, 120, 4, soft)}${bar(14, 72, 104, 4, soft)}${bar(14, 82, 62, 4, soft)}`;
  } else if (["memphis", "isometric", "comic", "ticket", "notebook", "arcade",
              "botanical", "bauhaus", "clay", "chart"].includes(t.id)) {
    // The ten bright templates share a generic-but-coloured placeholder: it is
    // only on screen for the second before the real render lands, so the
    // budget for it is "not grey", not "an illustration of the design".
    art = `<rect x="0" y="0" width="160" height="16" fill="${a}" opacity=".2"/>
      ${bar(10, 5, 24, 6, a, 2)}${bar(112, 5, 38, 6, soft, 2)}
      ${bar(10, 26, 70, 12, ink, 2)}${bar(10, 44, 46, 5, a)}
      ${[0, 1, 2].map(i => bar(10 + i * 48, 58, 42, 16, i % 2 ? b : a, 3)).join("")}
      ${[0, 1, 2].map(i => bar(10 + i * 48, 80, 42, 12, soft, 3)).join("")}`;
  } else if (t.id === "beacon") {
    art = `${bar(10, 10, 140, 13, dark ? "rgba(255,255,255,.08)" : "#fff", 3)}
      ${bar(15, 14, 26, 5, ink)}${bar(120, 13, 26, 7, a, 3)}
      ${bar(14, 32, 62, 10, ink, 2)}${bar(14, 46, 44, 4, a)}
      ${[0, 1, 2].map(i => bar(14 + i * 46, 60, 40, 32, dark ? "rgba(255,255,255,.07)" : "#fff", 4)).join("")}
      ${[0, 1, 2].map(i => bar(19 + i * 46, 65, 20, 3, a)).join("")}
      ${[0, 1, 2].map(i => bar(19 + i * 46, 73, 30, 3, soft) + bar(19 + i * 46, 80, 24, 3, soft)).join("")}`;
  } else if (t.id === "bold") {
    art = `${bar(10, 14, 128, 20, ink, 2)}${bar(10, 38, 84, 20, a, 2)}
      ${bar(0, 66, 160, 12, a, 0)}${bar(10, 84, 60, 5, soft)}`;
  } else if (t.id === "flux") {
    art = `<defs><linearGradient id="fxg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs>
      <path d="M0 24 C 40 4 68 40 100 22 S 148 6 160 18 L160 0 L0 0 Z" fill="url(#fxg)" opacity=".9"/>
      <path d="M0 40 C 34 22 74 54 108 38 S 150 26 160 34 L160 12 C 148 4 116 20 92 30 S 34 12 0 30 Z" fill="${b}" opacity=".35"/>
      ${bar(14, 52, 92, 11, ink, 3)}${bar(14, 69, 58, 5, soft)}${bar(14, 82, 34, 9, a, 4)}`;
  } else if (t.id === "reel") {
    art = `<g transform="translate(30 50) rotate(-16)">${bar(-18, -24, 36, 48, a, 5)}</g>
      <g transform="translate(130 50) rotate(16)">${bar(-18, -24, 36, 48, b, 5)}</g>
      <g transform="translate(80 48)">${bar(-27, -32, 54, 64, dark ? "rgba(255,255,255,.14)" : "#fff", 7)}
        ${bar(-19, -22, 38, 22, a, 4)}${bar(-19, 4, 30, 4, ink)}${bar(-19, 13, 20, 3, soft)}</g>
      ${[0, 1, 2].map(i => `<circle cx="${70 + i * 10}" cy="92" r="${i === 1 ? 3 : 2}" fill="${i === 1 ? a : soft}"/>`).join("")}`;
  } else if (t.id === "halo") {
    art = `<circle cx="80" cy="40" r="28" fill="none" stroke="${a}" stroke-width="3" stroke-dasharray="118 58"/>
      <circle cx="80" cy="40" r="20" fill="none" stroke="${b}" stroke-width="2.5" stroke-dasharray="82 44"/>
      <circle cx="80" cy="40" r="12" fill="${a}" opacity=".9"/>
      ${bar(44, 76, 72, 8, ink, 3)}${bar(60, 90, 40, 4, soft)}`;
  } else if (t.id === "filament") {
    art = `${bar(16, 18, 128, 1.6, a, 1)}
      ${[[30, 16], [58, 27], [86, 20], [114, 31]].map(([x, len]) => `
        <line x1="${x}" y1="19" x2="${x}" y2="${19 + len}" stroke="${a}" stroke-width="1.4"/>
        <circle cx="${x}" cy="19" r="2" fill="${a}"/>
        ${bar(x - 13, 19 + len, 26, 11, dark ? "rgba(255,255,255,.14)" : "#fff", 5.5)}`).join("")}
      ${bar(16, 70, 78, 9, ink, 3)}${bar(16, 85, 48, 4, b)}`;
  } else if (t.id === "morph") {
    art = `<ellipse cx="30" cy="24" rx="30" ry="24" fill="${a}" opacity=".45"/>
      <ellipse cx="132" cy="72" rx="28" ry="24" fill="${b}" opacity=".4"/>
      ${bar(16, 14, 78, 12, ink, 6)}${bar(16, 32, 50, 5, soft, 3)}
      ${[0, 1].map(i => `${bar(16 + i * 68, 48, 60, 40, dark ? "rgba(255,255,255,.14)" : "#fff", 13)}
        ${bar(24 + i * 68, 55, 44, 12, i ? b : a, 6)}${bar(24 + i * 68, 72, 30, 4, soft)}`).join("")}`;
  } else if (t.id === "aperture") {
    art = `<circle cx="112" cy="46" r="32" fill="${a}" opacity=".16"/>
      ${[0, 60, 120, 180, 240, 300].map(deg => `<path d="M112 46 L${(112 + 32 * Math.cos((deg - 90) * Math.PI / 180)).toFixed(1)} ${(46 + 32 * Math.sin((deg - 90) * Math.PI / 180)).toFixed(1)} L${(112 + 32 * Math.cos((deg - 30) * Math.PI / 180)).toFixed(1)} ${(46 + 32 * Math.sin((deg - 30) * Math.PI / 180)).toFixed(1)} Z" fill="${a}" opacity="${deg % 120 === 0 ? ".85" : ".6"}"/>`).join("")}
      <circle cx="112" cy="46" r="10" fill="${bg}"/>
      <circle cx="112" cy="46" r="34" fill="none" stroke="${b}" stroke-width="1.6" stroke-dasharray="3 5"/>
      ${bar(12, 24, 62, 11, ink, 2)}${bar(12, 41, 44, 4, soft)}${bar(12, 52, 36, 4, soft)}${bar(12, 66, 30, 8, a, 3)}`;
  } else {
    art = `${bar(10, 8, 140, 14, dark ? "rgba(255,255,255,.08)" : "#fff", 4)}
      ${bar(16, 12, 40, 5, ink)}${bar(126, 11, 18, 7, a, 3)}
      ${bar(10, 28, 88, 10, ink, 2)}${bar(10, 43, 60, 4, a)}
      ${[0, 1, 2].map(i => bar(10 + i * 48, 56, 42, 20, dark ? "rgba(255,255,255,.07)" : "#fff", 4)).join("")}
      ${bar(10, 82, 140, 10, dark ? "rgba(255,255,255,.07)" : "#fff", 4)}`;
  }
  return `<svg viewBox="0 0 160 100" width="100%" height="100%" role="img" aria-label="${esc(t.name)} layout preview">
    <rect width="160" height="100" fill="${bg}"/>${art}</svg>`;
}

// Real thumbnails for saved portfolios: the actual site, rendered in a
// sandboxed iframe and scaled down. Sequenced one per animation frame.
function pfPaintThumbnails(rows) {
  let i = 0;
  const next = () => {
    if (i >= rows.length) return;
    const row = rows[i++];
    const holder = document.querySelector(`[data-pf-shot="${row.id}"]`);
    if (!holder || !holder.isConnected) return next();
    get(`/api/portfolios/${row.id}`).then(full => {
      if (!holder.isConnected) return;
      const frame = document.createElement("iframe");
      frame.className = "pf-shot-frame";
      frame.setAttribute("scrolling", "no");
      frame.setAttribute("tabindex", "-1");
      frame.setAttribute("aria-hidden", "true");
      frame.setAttribute("sandbox", "allow-scripts");
      try {
        frame.srcdoc = pfRenderSite(full.template_id, full.data);
      } catch (err) {
        console.error("[portfolio] thumbnail render failed for portfolio " + row.id, err);
        holder.querySelector(".pf-shot-skeleton")?.remove();
        return;
      }
      holder.querySelector(".pf-shot-skeleton")?.remove();
      holder.insertBefore(frame, holder.firstChild);
      pfFitThumb(frame, holder);
    }).catch(() => {
      holder.querySelector(".pf-shot-skeleton")?.remove();
    }).finally(() => requestAnimationFrame(next));
  };
  requestAnimationFrame(next);
}

// The thumbnail renders the site at a real desktop width and scales the whole
// frame down to the card. Scaling from the holder's measured width (rather
// than a fixed factor) is what keeps it edge-to-edge at every column width the
// fluid grid produces.
const PF_THUMB_W = 1280;
function pfFitThumb(frame, holder) {
  const apply = () => {
    const w = holder.clientWidth, h = holder.clientHeight;
    if (!w) return;
    const scale = w / PF_THUMB_W;
    frame.style.width = PF_THUMB_W + "px";
    frame.style.height = Math.round(h / scale) + "px";
    frame.style.transform = `scale(${scale})`;
  };
  apply();
  if (typeof ResizeObserver === "function") {
    const ro = new ResizeObserver(apply);
    ro.observe(holder);
    // Stop observing once the card leaves the DOM, so navigating away from the
    // library doesn't leave one observer per portfolio running forever.
    const mo = new MutationObserver(() => {
      if (!holder.isConnected) { ro.disconnect(); mo.disconnect(); }
    });
    mo.observe(document.body, { childList: true, subtree: true });
  } else {
    window.addEventListener("resize", apply, { passive: true });
  }
}

// ---------------------------------------------------------------------------
// Path helpers — every input in the builder binds to a path like
// "projects.2.name", so one delegated listener can write the whole form.
// ---------------------------------------------------------------------------
function pfGetPath(obj, path) {
  return path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
}
function pfSetPath(obj, path, value) {
  const keys = path.split(".");
  const last = keys.pop();
  let node = obj;
  for (const k of keys) {
    if (node[k] == null || typeof node[k] !== "object") node[k] = /^\d+$/.test(k) ? [] : {};
    node = node[k];
  }
  node[last] = value;
}

const PF_BUILDER_TABS = [
  { id: "content",  label: "Content",  icon: "✍️" },
  { id: "template", label: "Design",   icon: "🎨" },
  { id: "sections", label: "Sections", icon: "🧱" },
  { id: "resume",   label: "Résumé",   icon: "📄" },
  { id: "seo",      label: "Publish",  icon: "🚀" },
];

const PF_DEVICES = {
  desktop: { w: 1280, label: "Desktop", icon: "🖥" },
  tablet:  { w: 834,  label: "Tablet",  icon: "▭" },
  mobile:  { w: 390,  label: "Phone",   icon: "▯" },
};

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------
async function pfRenderBuilder(content) {
  const wantId = state.portfolioId;

  // Load, but only once per portfolio — re-rendering the page (a theme
  // toggle, a resize) must not throw away unsaved edits.
  if (PF_EDITOR.loadedFor !== (wantId == null ? "new" : String(wantId))) {
    _pfPreviewScrollY = 0;
    _pfLastHTML = "";
    if (wantId == null) {
      PF_EDITOR.id = null;
      PF_EDITOR.name = PF_EDITOR.name || "";
      PF_EDITOR.data = PF_EDITOR.data || pfBlankData();
      PF_EDITOR.loadedFor = "new";
    } else {
      content.innerHTML = `<div class="spinner"></div>`;
      try {
        const full = await get(`/api/portfolios/${wantId}`, { noCache: true });
        PF_EDITOR.id = full.id;
        PF_EDITOR.name = full.name;
        PF_EDITOR.templateId = pfKnownTemplate(full.template_id);
        PF_EDITOR.resumeId = full.resume_id || null;
        PF_EDITOR.data = pfNormalize(full.data);
        PF_EDITOR.dirty = false;
        PF_EDITOR.loadedFor = String(full.id);
      } catch (err) {
        content.innerHTML = `<div class="card p-6 text-sm text-red-600">Couldn't open that portfolio. ${esc(apiErrorMessage(err, ""))}</div>`;
        return;
      }
    }
  }

  // Seed a brand-new portfolio from the signed-in account, so the form is
  // never a wall of empty boxes on the first visit.
  if (!PF_EDITOR.id && !PF_EDITOR.data.full_name) {
    const user = auth.getUser();
    if (user) {
      PF_EDITOR.data.full_name = user.name || "";
      PF_EDITOR.data.email = user.email || "";
    }
    const p = state.profile;
    if (p) {
      PF_EDITOR.data.title = PF_EDITOR.data.title || p.headline || "";
      PF_EDITOR.data.location = PF_EDITOR.data.location || p.location || "";
      PF_EDITOR.data.website = PF_EDITOR.data.website || p.website || "";
      PF_EDITOR.data.linkedin = PF_EDITOR.data.linkedin || p.linkedin || "";
    }
  }

  // The photo is seeded like the fields above it, but it cannot be done
  // inline: the bytes have to be fetched and re-encoded. So it is fired once
  // per new portfolio and repaints the panel when it lands. photoSeeded is set
  // before the await, not after, or a second render would start a second fetch.
  if (!PF_EDITOR.id && !PF_EDITOR.photoSeeded && !PF_EDITOR.data.avatar && pfProfilePhotoPath()) {
    PF_EDITOR.photoSeeded = true;
    pfUseProfilePhoto({ silent: true });
  }

  content.innerHTML = `
  <div class="pf-builder">
    <div class="pf-topbar">
      <button class="btn btn-ghost btn-xs" id="pf-back">← Portfolios</button>
      <input id="pf-name" class="pf-name-input" placeholder="Untitled portfolio"
             value="${esc(PF_EDITOR.name)}" aria-label="Portfolio name">
      <span class="pf-save-state" id="pf-save-state">${PF_EDITOR.dirty ? "Unsaved changes" : (PF_EDITOR.id ? "Saved" : "Not saved yet")}</span>
      <div class="pf-devices" role="group" aria-label="Preview size">
        ${Object.entries(PF_DEVICES).map(([k, v]) =>
          `<button type="button" class="pf-device ${PF_EDITOR.device === k ? "active" : ""}" data-pf-device="${k}"
             title="${v.label}" aria-label="${v.label} preview">${v.icon}</button>`).join("")}
      </div>
      <button class="btn btn-ghost btn-xs" id="pf-open-tab">Open preview ↗</button>
      <button class="btn btn-ghost btn-xs" id="pf-download">↓ Download site</button>
      <button class="btn btn-accent btn-xs" id="pf-save">Save</button>
    </div>

    <div class="pf-workspace">
      <aside class="pf-panel">
        <nav class="pf-panel-tabs">
          ${PF_BUILDER_TABS.map(t => `<button type="button" class="pf-panel-tab ${PF_EDITOR.tab === t.id ? "active" : ""}"
            data-pf-panel="${t.id}"><span>${t.icon}</span>${esc(t.label)}</button>`).join("")}
        </nav>
        <div class="pf-panel-body" id="pf-panel-body"></div>
      </aside>

      <section class="pf-preview-wrap">
        <div class="pf-preview-stage" id="pf-stage">
          <iframe id="pf-preview" title="Live preview of your portfolio site"
                  sandbox="allow-scripts allow-popups allow-downloads allow-modals"></iframe>
        </div>
      </section>
    </div>
  </div>`;

  pfPaintPanel();
  pfRefreshPreview(true);

  const nameInput = content.querySelector("#pf-name");
  nameInput.addEventListener("input", () => { PF_EDITOR.name = nameInput.value; pfMarkDirty(); });

  content.querySelector("#pf-back").addEventListener("click", () => {
    state.portfolioView = "library";
    pfScrollTop();
    render();
  });

  content.querySelectorAll("[data-pf-panel]").forEach(btn => btn.addEventListener("click", () => {
    PF_EDITOR.tab = btn.dataset.pfPanel;
    content.querySelectorAll("[data-pf-panel]").forEach(b => b.classList.toggle("active", b === btn));
    pfPaintPanel();
  }));

  content.querySelectorAll("[data-pf-device]").forEach(btn => btn.addEventListener("click", () => {
    PF_EDITOR.device = btn.dataset.pfDevice;
    content.querySelectorAll("[data-pf-device]").forEach(b => b.classList.toggle("active", b === btn));
    pfFitPreview();
  }));

  content.querySelector("#pf-save").addEventListener("click", pfSave);
  content.querySelector("#pf-download").addEventListener("click", () =>
    pfDownloadSite(PF_EDITOR.templateId, PF_EDITOR.data, PF_EDITOR.name, PF_EDITOR.id));
  content.querySelector("#pf-open-tab").addEventListener("click", () =>
    pfOpenInNewTab(pfRenderSite(PF_EDITOR.templateId, PF_EDITOR.data)));

  // Ctrl/Cmd-S saves, because everyone tries it.
  if (!pfRenderBuilder._keys) {
    pfRenderBuilder._keys = true;
    window.addEventListener("keydown", (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s"
          && state.page === "portfolio" && state.portfolioView === "builder") {
        e.preventDefault();
        pfSave();
      }
    });
  }
  window.addEventListener("resize", pfFitPreview, { passive: true });
}

function pfMarkDirty() {
  PF_EDITOR.dirty = true;
  const el = document.getElementById("pf-save-state");
  if (el) { el.textContent = "Unsaved changes"; el.classList.add("pf-unsaved"); }
  pfSchedulePreview();
}

function pfSchedulePreview() {
  clearTimeout(_pfPreviewTimer);
  _pfPreviewTimer = setTimeout(() => pfRefreshPreview(false), 320);
}

// Re-renders the preview iframe. The iframe's own scroll position is carried
// across so typing in a field doesn't fling the preview back to the top —
// which is what makes editing the last section on a long page bearable.
function pfWirePreviewBridge() {
  if (_pfBridgeWired) return;
  _pfBridgeWired = true;
  window.addEventListener("message", (e) => {
    const frame = document.getElementById("pf-preview");
    if (!frame || e.source !== frame.contentWindow) return;   // only our own preview
    const msg = e.data;
    if (!msg || typeof msg !== "object") return;
    if (msg.__pf === "scroll" && typeof msg.y === "number") _pfPreviewScrollY = msg.y;
    // On "ready" the document has just been replaced, so put it back where the
    // customer was — otherwise editing the last section on a long page snaps
    // the preview to the top on every keystroke.
    if (msg.__pf === "ready" && _pfPreviewScrollY > 0) {
      frame.contentWindow.postMessage({ __pf: "restore", y: _pfPreviewScrollY }, "*");
    }
  });
}

function pfRefreshPreview(force) {
  const frame = document.getElementById("pf-preview");
  if (!frame) return;
  pfWirePreviewBridge();
  let html;
  try {
    html = pfRenderSite(PF_EDITOR.templateId, PF_EDITOR.data, { preview: true });
  } catch (err) {
    console.error("[portfolio] render failed", err);
    showToast("Preview couldn't render — check the browser console", "error");
    return;
  }
  if (!force && html === _pfLastHTML) return;
  _pfLastHTML = html;
  frame.srcdoc = html;
  pfFitPreview();
}

// The preview renders at a real device width and is then scaled to fit the
// column. Scaling (rather than just narrowing the iframe) is what makes the
// desktop preview honest: media queries see 1280px, not 700px.
function pfFitPreview() {
  const stage = document.getElementById("pf-stage");
  const frame = document.getElementById("pf-preview");
  if (!stage || !frame) return;
  const target = (PF_DEVICES[PF_EDITOR.device] || PF_DEVICES.desktop).w;
  const avail = stage.clientWidth - 24;
  const scale = Math.min(1, avail / target);
  frame.style.width = target + "px";
  frame.style.height = Math.round((stage.clientHeight - 24) / scale) + "px";
  frame.style.transform = `scale(${scale})`;
  frame.style.transformOrigin = "top left";
  stage.style.setProperty("--pf-scaled-w", Math.round(target * scale) + "px");
}

// ---------------------------------------------------------------------------
// Form field builders
// ---------------------------------------------------------------------------
function pfField(path, label, { type = "text", placeholder = "", hint = "", rows = 0, value = null, half = false } = {}) {
  const v = value != null ? value : (pfGetPath(PF_EDITOR.data, path) ?? "");
  const common = `data-pf-field="${esc(path)}" placeholder="${esc(placeholder)}" id="pf-f-${esc(path)}"`;
  const input = rows
    ? `<textarea ${common} rows="${rows}">${esc(v)}</textarea>`
    : `<input type="${type}" ${common} value="${esc(v)}">`;
  return `<div class="pf-field ${half ? "pf-half" : ""}">
    <label for="pf-f-${esc(path)}">${esc(label)}</label>
    ${input}
    ${hint ? `<small>${hint}</small>` : ""}
  </div>`;
}

// Arrays of plain strings (skills, certifications) are edited as text and
// stored as arrays — the split happens on the way in, so the stored shape
// never depends on how somebody happened to type it.
function pfListField(path, label, { placeholder = "", hint = "", rows = 4, sep = "line" } = {}) {
  const arr = pfGetPath(PF_EDITOR.data, path) || [];
  const v = sep === "comma" ? arr.join(", ") : arr.join("\n");
  return `<div class="pf-field">
    <label for="pf-f-${esc(path)}">${esc(label)}</label>
    <textarea data-pf-list="${esc(path)}" data-pf-sep="${sep}" rows="${rows}" id="pf-f-${esc(path)}"
      placeholder="${esc(placeholder)}">${esc(v)}</textarea>
    ${hint ? `<small>${hint}</small>` : ""}
  </div>`;
}

function pfRepeatHead(path, index, title, count) {
  return `<div class="pf-item-head">
    <span class="pf-item-n">${title} ${index + 1}</span>
    <span class="pf-item-tools">
      <button type="button" class="pf-icon-btn" data-pf-move="${path}" data-pf-i="${index}" data-pf-dir="-1"
        ${index === 0 ? "disabled" : ""} title="Move up" aria-label="Move up">↑</button>
      <button type="button" class="pf-icon-btn" data-pf-move="${path}" data-pf-i="${index}" data-pf-dir="1"
        ${index === count - 1 ? "disabled" : ""} title="Move down" aria-label="Move down">↓</button>
      <button type="button" class="pf-icon-btn pf-danger" data-pf-remove="${path}" data-pf-i="${index}"
        title="Remove" aria-label="Remove">✕</button>
    </span>
  </div>`;
}

function pfAddBtn(path, label, blank) {
  return `<button type="button" class="pf-add" data-pf-add="${path}" data-pf-blank="${esc(JSON.stringify(blank))}">+ ${esc(label)}</button>`;
}

// ---------------------------------------------------------------------------
// Panels
// ---------------------------------------------------------------------------
function pfPaintPanel() {
  const body = document.getElementById("pf-panel-body");
  if (!body) return;
  const tab = PF_EDITOR.tab;
  body.innerHTML =
    tab === "template" ? pfPanelTemplate() :
    tab === "sections" ? pfPanelSections() :
    tab === "resume"   ? pfPanelResume() :
    tab === "seo"      ? pfPanelPublish() :
                         pfPanelContent();
  pfWirePanel(body);
  if (tab === "template") {
    body.querySelectorAll("[data-pf-preview]").forEach(b =>
      b.addEventListener("click", (e) => { e.stopPropagation(); pfOpenTemplatePreview(b.dataset.pfPreview); }));
    pfPaintTemplateShots(body);
  }
  if (tab === "resume") pfLoadResumeList();
}

function pfPanelContent() {
  const d = PF_EDITOR.data;
  return `
  <div class="pf-group">
    <h4>Who you are</h4>
    <div class="pf-grid2">
      ${pfField("full_name", "Full name", { placeholder: "Jane Okafor", half: true })}
      ${pfField("title", "Job title", { placeholder: "Senior Product Designer", half: true })}
    </div>
    ${pfField("tagline", "One-line pitch", { rows: 2, placeholder: "I design systems that make complicated products feel obvious.", hint: "Shown large under your name. One sentence beats three." })}
    <div class="pf-grid2">
      ${pfField("location", "Location", { placeholder: "London, UK", half: true })}
      ${pfField("available", "Availability badge", { placeholder: "Open to work — Sept 2026", half: true, hint: "Leave empty to hide it." })}
    </div>
    <div class="pf-field">
      <label>Profile photo</label>
      <div class="pf-photo-row">
        <div class="pf-photo-preview">${d.avatar
          ? `<img src="${esc(d.avatar)}" alt="">`
          : `<span>${esc(pfInitials(d.full_name || "?"))}</span>`}</div>
        <div>
          <input type="file" accept="image/png,image/jpeg,image/webp" id="pf-photo" hidden>
          <button type="button" class="btn btn-ghost btn-xs" id="pf-photo-btn">${d.avatar ? "Replace photo" : "Upload photo"}</button>
          ${pfProfilePhotoPath() && d.avatar_source !== "profile"
            ? `<button type="button" class="btn btn-ghost btn-xs" id="pf-photo-profile">Use my profile photo</button>` : ""}
          ${d.avatar ? `<button type="button" class="btn btn-ghost btn-xs pf-danger" id="pf-photo-clear">Remove</button>` : ""}
          ${d.avatar && d.avatar_source === "profile" && !pfProfilePhotoMoved()
            ? `<span class="pf-photo-tag">From your profile</span>` : ""}
          <small>Embedded straight into the file, so the site needs no image hosting. Resized to 512px.</small>
        </div>
      </div>
      ${pfProfilePhotoMoved() ? `
      <div class="pf-photo-note" role="status">
        <span>Your profile photo has changed since this was added.</span>
        <button type="button" class="btn btn-ghost btn-xs" id="pf-photo-resync">Use the new one</button>
        <button type="button" class="btn btn-ghost btn-xs" id="pf-photo-keep">Keep this one</button>
      </div>` : ""}
      ${pfPhotolessTemplate() ? `
      <div class="pf-photo-note pf-photo-note--quiet" role="status">
        <span><b>${esc(pfPhotolessTemplate().name)}</b> is a type-led design and doesn't show a portrait.
        Your photo is saved either way — switch template to use it.</span>
        <button type="button" class="btn btn-ghost btn-xs" id="pf-photo-switch">Choose another</button>
      </div>` : ""}
    </div>
  </div>

  <div class="pf-group">
    <h4>Contact & links</h4>
    <div class="pf-grid2">
      ${pfField("email", "Email", { type: "email", placeholder: "jane@example.com", half: true })}
      ${pfField("phone", "Phone", { placeholder: "+44 7700 900123", half: true, hint: "Optional — a public site means a public number." })}
      ${pfField("website", "Website", { placeholder: "jane.design", half: true })}
      ${pfField("linkedin", "LinkedIn", { placeholder: "linkedin.com/in/jane", half: true })}
      ${pfField("github", "GitHub", { placeholder: "github.com/jane", half: true })}
      ${pfField("twitter", "X / Twitter", { placeholder: "x.com/jane", half: true })}
    </div>
  </div>

  <div class="pf-group">
    <h4>About</h4>
    ${pfField("about", "About you", { rows: 7, placeholder: "Two or three short paragraphs.\n\nLeave a blank line between them — several templates set the first paragraph with a drop cap and pull a quote from the second." })}
  </div>

  <div class="pf-group">
    <h4>Skills</h4>
    ${pfListField("skills", "Skills", { sep: "comma", rows: 3, placeholder: "TypeScript, React, Figma, Postgres", hint: "Comma separated. List strongest first — Sidebar Pro draws its meters from that order. Prefix an entry with a category (\"Languages: Python\") and everything after it is grouped under that heading, which Beacon renders as a skills matrix." })}
  </div>

  <div class="pf-group">
    <h4>Highlights <span class="pf-count-pill">${d.stats.length}</span></h4>
    <p class="pf-group-note">Big numbers, counted up as the visitor scrolls. Three or four is the sweet spot.</p>
    ${d.stats.map((s, i) => `
      <div class="pf-item">
        ${pfRepeatHead("stats", i, "Highlight", d.stats.length)}
        <div class="pf-grid2">
          ${pfField(`stats.${i}.value`, "Number", { placeholder: "40k", half: true })}
          ${pfField(`stats.${i}.label`, "Label", { placeholder: "Users served", half: true })}
        </div>
      </div>`).join("")}
    ${pfAddBtn("stats", "Add highlight", { value: "", label: "" })}
  </div>

  <div class="pf-group">
    <h4>Projects <span class="pf-count-pill">${d.projects.length}</span></h4>
    ${d.projects.map((p, i) => `
      <div class="pf-item">
        ${pfRepeatHead("projects", i, "Project", d.projects.length)}
        ${pfField(`projects.${i}.name`, "Project name", { placeholder: "Atlas Design System" })}
        <div class="pf-grid2">
          ${pfField(`projects.${i}.role`, "Your role", { placeholder: "Tech lead", half: true })}
          ${pfField(`projects.${i}.period`, "When", { placeholder: "2025", half: true })}
        </div>
        ${pfField(`projects.${i}.description`, "Description", { rows: 3, placeholder: "One or two sentences on what it is and what it changed." })}
        ${pfListField(`projects.${i}.bullets`, "Detail points", { rows: 3, placeholder: "Cut load time from 4.2s to 380ms\nAdopted by six product teams" })}
        ${pfListField(`projects.${i}.tags`, "Tech / tags", { sep: "comma", rows: 2, placeholder: "React, Storybook, a11y", hint: "These become the filter chips on Card Deck and Neon Grid." })}
        <div class="pf-grid2">
          ${pfField(`projects.${i}.link`, "Live link", { placeholder: "atlas.example.com", half: true })}
          ${pfField(`projects.${i}.repo`, "Repository", { placeholder: "github.com/jane/atlas", half: true })}
        </div>
      </div>`).join("")}
    ${pfAddBtn("projects", "Add project", { name: "", role: "", period: "", description: "", bullets: [], tags: [], link: "", repo: "" })}
  </div>

  <div class="pf-group">
    <h4>Experience <span class="pf-count-pill">${d.experience.length}</span></h4>
    ${d.experience.map((e, i) => `
      <div class="pf-item">
        ${pfRepeatHead("experience", i, "Role", d.experience.length)}
        <div class="pf-grid2">
          ${pfField(`experience.${i}.role`, "Job title", { placeholder: "Senior Engineer", half: true })}
          ${pfField(`experience.${i}.org`, "Company", { placeholder: "Northwind", half: true })}
          ${pfField(`experience.${i}.period`, "Dates", { placeholder: "2022 — Present", half: true })}
          ${pfField(`experience.${i}.location`, "Location", { placeholder: "London, UK", half: true })}
        </div>
        ${pfField(`experience.${i}.summary`, "Summary", { rows: 2, placeholder: "What you owned." })}
        ${pfListField(`experience.${i}.bullets`, "Achievements", { rows: 4, placeholder: "One per line — lead with the result, not the task." })}
      </div>`).join("")}
    ${pfAddBtn("experience", "Add role", { role: "", org: "", period: "", location: "", summary: "", bullets: [] })}
  </div>

  <div class="pf-group">
    <h4>Education <span class="pf-count-pill">${d.education.length}</span></h4>
    ${d.education.map((e, i) => `
      <div class="pf-item">
        ${pfRepeatHead("education", i, "Entry", d.education.length)}
        ${pfField(`education.${i}.degree`, "Qualification", { placeholder: "BSc Computer Science" })}
        <div class="pf-grid2">
          ${pfField(`education.${i}.school`, "Institution", { placeholder: "UCL", half: true })}
          ${pfField(`education.${i}.period`, "Dates", { placeholder: "2015 — 2019", half: true })}
        </div>
        ${pfField(`education.${i}.detail`, "Detail", { rows: 2, placeholder: "Grade, dissertation, anything worth a line." })}
      </div>`).join("")}
    ${pfAddBtn("education", "Add education", { degree: "", school: "", period: "", detail: "" })}
  </div>

  <div class="pf-group">
    <h4>Certifications</h4>
    ${pfListField("certifications", "Certifications", { rows: 4, placeholder: "AWS Solutions Architect — Associate (2023)\nCKAD (2022)" })}
  </div>`;
}

function pfPanelTemplate() {
  const d = PF_EDITOR.data;
  const accent = d.accent_color || (PF_TEMPLATE_BY_ID[PF_EDITOR.templateId] || {}).accent || "#7C5CFC";
  const swatches = ["#3D5AFE", "#7C5CFC", "#1FAE6B", "#E4A335", "#FF5A3C", "#E2604F", "#1F7A8C", "#B5432E", "#171A1F", "#2C6FDB"];
  // A design the customer built carries its own accent, typeface and motion.
  // The two groups below it would silently do nothing while it is worn, so
  // they are replaced by the one control that does work: a way back into the
  // designer where those settings actually live.
  const wearing = typeof pfDesignRow === "function" ? pfDesignRow(PF_EDITOR.templateId) : null;
  const designs = typeof _pfDesigns !== "undefined" ? _pfDesigns : [];

  return `
  <div class="pf-group">
    <h4>Your designs</h4>
    <p class="pf-group-note">Built from blocks, in your own layout. One design can dress any number of portfolios.</p>
    ${designs.length ? `
      <div class="pf-tpl-pick pf-own-pick">
        ${designs.map(x => {
          const theme = (x.design && x.design.theme) || {};
          const on = PF_EDITOR.templateId === `custom:${x.id}`;
          return `
          <div class="pf-pk ${on ? "active" : ""}" data-pf-pick="custom:${x.id}" tabindex="0"
               role="button" aria-pressed="${on}" title="${esc(x.name)} — your own design">
            <span class="pf-pk-shot pf-pk-own"
                  style="background:linear-gradient(135deg,${esc(theme.accent || "#6D5AE6")},${esc(theme.accent2 || theme.accent || "#22C1DC")})">
              <em>${esc(((x.design && x.design.blocks) || []).length)} blocks</em>
            </span>
            <span class="pf-pk-name"><i style="background:${esc(theme.accent || "#6D5AE6")}"></i>${esc(x.name)}
              ${on ? `<b>✓</b>` : ""}</span>
          </div>`;
        }).join("")}
      </div>` : ""}
    <div class="pf-own-acts">
      <button type="button" class="btn btn-ghost btn-xs" id="pf-open-designer">✨ Design your own</button>
      ${wearing ? `<button type="button" class="btn btn-ghost btn-xs" id="pf-edit-design">Edit "${esc(wearing.name)}"</button>` : ""}
    </div>
  </div>

  <div class="pf-group">
    <h4>Template</h4>
    <p class="pf-group-note">Switching keeps every word you've written — only the design changes.</p>
    <div class="pf-tpl-pick" id="pf-tpl-pick">
      ${PF_TEMPLATES.map(t => `
        <div class="pf-pk ${t.id === PF_EDITOR.templateId ? "active" : ""}" data-pf-pick="${t.id}"
             tabindex="0" role="button" aria-pressed="${t.id === PF_EDITOR.templateId}"
             title="${esc(t.name)} — ${esc(t.description)}">
          <span class="pf-pk-shot" data-pf-tplshot="${t.id}">
            <span class="pf-tpl-fallback" aria-hidden="true">${pfTemplateSwatch(t)}</span>
            <button type="button" class="pf-pk-eye" data-pf-preview="${t.id}"
                    aria-label="Preview ${esc(t.name)} full size" title="Preview full size">⤢</button>
          </span>
          <span class="pf-pk-name"><i style="background:${esc(t.accent)}"></i>${esc(t.name)}
            ${t.id === PF_EDITOR.templateId ? `<b>✓</b>` : ""}</span>
        </div>`).join("")}
    </div>
  </div>

  ${wearing ? `
  <div class="pf-group">
    <h4>Colour and type</h4>
    <p class="pf-group-note">"${esc(wearing.name)}" carries its own palette, typeface and motion — change them in the designer so every portfolio wearing it follows.</p>
  </div>` : `
  <div class="pf-group">
    <h4>Accent colour</h4>
    <div class="pf-swatches">
      ${swatches.map(s => `<button type="button" class="pf-swatch ${s.toLowerCase() === accent.toLowerCase() ? "active" : ""}"
        data-pf-accent="${s}" style="background:${s}" title="${s}" aria-label="Accent ${s}"></button>`).join("")}
      <label class="pf-swatch-custom" title="Custom colour">
        <input type="color" data-pf-accent-input value="${esc(accent)}" aria-label="Custom accent colour">
        <span>Custom</span>
      </label>
      ${d.accent_color ? `<button type="button" class="pf-reset" id="pf-accent-reset">Use template default</button>` : ""}
    </div>
    <small class="pf-note">Every gradient, chip and button on the site is derived from this one colour.</small>
  </div>

  <div class="pf-group">
    <h4>Typeface</h4>
    <div class="pf-field">
      <select data-pf-field="font" id="pf-font">
        <option value="">Template default</option>
        ${Object.entries(PF_FONTS).map(([k, f]) =>
          `<option value="${k}" ${d.font === k ? "selected" : ""}>${esc(f.label)}</option>`).join("")}
      </select>
      <small>Loaded from Google Fonts with a system fallback, so the page still reads correctly offline.</small>
    </div>
  </div>`}`;
}

function pfPanelSections() {
  const d = PF_EDITOR.data;
  const filled = {
    about: !!(d.about || "").trim(), stats: d.stats.length, skills: d.skills.length,
    projects: d.projects.length, experience: d.experience.length, education: d.education.length,
    certifications: d.certifications.length, contact: !!(d.email || d.phone || d.linkedin || d.github || d.website),
  };
  return `
  <div class="pf-group">
    <h4>Sections on the site</h4>
    <p class="pf-group-note">A section with nothing in it is hidden automatically — this is for hiding one you've filled in but don't want public yet.</p>
    ${PF_SECTIONS.map(s => `
      <label class="pf-toggle">
        <input type="checkbox" data-pf-section="${s.id}" ${d.sections[s.id] ? "checked" : ""}>
        <span class="pf-toggle-track"><span class="pf-toggle-dot"></span></span>
        <span class="pf-toggle-label">${s.icon} ${esc(s.label)}</span>
        <span class="pf-toggle-state">${filled[s.id] ? "" : "empty"}</span>
      </label>`).join("")}
  </div>
  <div class="pf-group">
    <h4>Calls to action</h4>
    ${pfField("cta_text", "Button / contact text", { placeholder: "Get in touch", hint: "Used on the hero button and the contact block." })}
    ${pfField("footer_note", "Footer note", { placeholder: "Built in London", hint: "Appears next to the copyright line." })}
  </div>`;
}

function pfPanelResume() {
  const r = PF_EDITOR.data.resume || {};
  return `
  <div class="pf-group">
    <h4>Link a résumé</h4>
    <p class="pf-group-note">Pull your content across in one click, and give the site a working download button.</p>
    <div class="pf-field">
      <label for="pf-resume-pick">Your résumés</label>
      <select id="pf-resume-pick"><option>Loading…</option></select>
      <small id="pf-resume-note">Built in the Resume Builder? Its content can be imported. Uploaded as a file? It can still be attached for download.</small>
    </div>
    <div class="pf-resume-actions">
      <button type="button" class="btn btn-accent btn-xs" id="pf-import" disabled>↙ Import content from this résumé</button>
      <button type="button" class="btn btn-ghost btn-xs" id="pf-attach" disabled>📎 Attach for download</button>
    </div>
    <small class="pf-note">Import overwrites the name, title, about, skills, projects, experience and education fields.
      Anything you've typed that the résumé doesn't cover is left alone.</small>
  </div>

  <div class="pf-group">
    <h4>Download button on the site</h4>
    <div class="pf-radios">
      ${[["embed", "Embed the PDF in the file", "The résumé is baked into the HTML as data. One file, works everywhere, no hosting — the file gets bigger by roughly the size of the PDF."],
         ["link", "Link to a URL", "The button points at a résumé you host somewhere else. Keeps the file small; breaks if that link moves."],
         ["none", "No download button", "Don't offer the résumé on the site at all."]].map(([val, label, note]) => `
        <label class="pf-radio ${r.mode === val ? "active" : ""}">
          <input type="radio" name="pf-resume-mode" value="${val}" ${r.mode === val ? "checked" : ""}>
          <span><b>${label}</b><small>${note}</small></span>
        </label>`).join("")}
    </div>
    ${r.mode === "embed" && r.data_url ? `<div class="pf-attached">
      <span>📄 ${esc(r.filename || "resume.pdf")}</span>
      <span class="pf-attached-size">${pfApproxKB(r.data_url)} KB embedded</span>
    </div>` : ""}
    ${r.mode === "link" ? pfField("resume.url", "Résumé URL", { placeholder: "https://example.com/jane-cv.pdf" }) : ""}
    ${r.mode !== "none" ? pfField("resume.label", "Button label", { placeholder: "Download résumé" }) : ""}
  </div>`;
}

function pfPanelPublish() {
  const d = PF_EDITOR.data;
  const html = (() => { try { return pfRenderSite(PF_EDITOR.templateId, d); } catch (_) { return ""; } })();
  const kb = Math.round(new Blob([html]).size / 1024);
  return `
  <div class="pf-group">
    <h4>Search & sharing</h4>
    ${pfField("seo_title", "Page title", { placeholder: `${d.full_name || "Your name"} — ${d.title || "Your title"}`, hint: "Shown in the browser tab and in search results. Defaults to your name and title." })}
    ${pfField("seo_description", "Meta description", { rows: 3, placeholder: "One or two lines that show under the title in Google and in link previews.", hint: "Around 150 characters is the limit before it gets cut off." })}
    ${pfField("analytics", "Analytics snippet", { rows: 3, placeholder: `<script defer src="https://…"></script>`, hint: "Optional. Pasted verbatim before &lt;/body&gt;. Only add a snippet you trust — it runs on your live site." })}
  </div>

  <div class="pf-group">
    <h4>Your file</h4>
    <div class="pf-filecard">
      <div class="pf-filecard-icon">📄</div>
      <div>
        <b>${esc(pfFileName(PF_EDITOR.name, d))}</b>
        <small>${kb} KB · one self-contained page · HTML + CSS + JavaScript inlined</small>
      </div>
      <button type="button" class="btn btn-accent btn-xs" id="pf-download-2">Download</button>
    </div>
    <ol class="pf-deploy">
      <li><b>Netlify Drop</b> — open <code>app.netlify.com/drop</code> and drag the file in. Live in seconds, free HTTPS.</li>
      <li><b>GitHub Pages</b> — commit it as <code>index.html</code> on a repo, then Settings → Pages → deploy from that branch.</li>
      <li><b>Vercel / Cloudflare Pages</b> — same idea: point the project at a folder containing this one file.</li>
      <li><b>Your own domain</b> — upload it as <code>index.html</code> to your hosting's public folder.</li>
    </ol>
    <small class="pf-note">Rename the file to <code>index.html</code> and it becomes the front page of whatever you deploy it to.</small>
  </div>`;
}

function pfApproxKB(dataUrl) {
  const b64 = String(dataUrl || "").split(",")[1] || "";
  return Math.max(1, Math.round(b64.length * 0.75 / 1024));
}

function pfFileName(name, d) {
  const base = (name || d.full_name || "portfolio").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "portfolio";
  return base + ".html";
}

// ---------------------------------------------------------------------------
// Panel wiring
// ---------------------------------------------------------------------------
// One delegated listener writes every plain field. Repeatable lists only
// repaint the panel when the *shape* changes (add / remove / reorder) —
// repainting on every keystroke would steal focus mid-word.
function pfWirePanel(body) {
  // The template tiles are divs with role="button" (they contain a real button
  // of their own, and a button inside a button is invalid), so the keyboard
  // activation a <button> gave for free has to be put back by hand.
  body.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const pick = e.target.closest("[data-pf-pick]");
    if (!pick) return;
    e.preventDefault();
    pick.click();
  });

  body.addEventListener("input", (e) => {
    const el = e.target;
    if (el.dataset.pfField != null) {
      pfSetPath(PF_EDITOR.data, el.dataset.pfField, el.value);
      pfMarkDirty();
      return;
    }
    if (el.dataset.pfList != null) {
      const sep = el.dataset.pfSep === "comma" ? /[,\n]/ : /\n/;
      const items = el.value.split(sep).map(s => s.replace(/^[-•*]\s*/, "").trim()).filter(Boolean);
      pfSetPath(PF_EDITOR.data, el.dataset.pfList, items);
      pfMarkDirty();
    }
  });

  body.addEventListener("change", (e) => {
    const el = e.target;
    if (el.dataset.pfSection != null) {
      PF_EDITOR.data.sections[el.dataset.pfSection] = el.checked;
      pfMarkDirty();
      return;
    }
    if (el.name === "pf-resume-mode") {
      PF_EDITOR.data.resume.mode = el.value;
      pfMarkDirty();
      pfPaintPanel();          // the mode changes which fields belong here
      return;
    }
    if (el.dataset.pfAccentInput != null) {
      PF_EDITOR.data.accent_color = el.value;
      pfMarkDirty();
      pfPaintPanel();
    }
  });

  body.addEventListener("click", (e) => {
    const add = e.target.closest("[data-pf-add]");
    if (add) {
      const path = add.dataset.pfAdd;
      const arr = pfGetPath(PF_EDITOR.data, path) || [];
      arr.push(JSON.parse(add.dataset.pfBlank));
      pfSetPath(PF_EDITOR.data, path, arr);
      pfMarkDirty();
      pfPaintPanel();
      // Drop the cursor into the new block's first input — the reason you
      // clicked Add was to type something.
      const inputs = document.querySelectorAll(`#pf-panel-body [data-pf-field^="${path}.${arr.length - 1}."]`);
      if (inputs.length) { inputs[0].focus(); inputs[0].scrollIntoView({ block: "center", behavior: "smooth" }); }
      return;
    }

    const rm = e.target.closest("[data-pf-remove]");
    if (rm) {
      const arr = pfGetPath(PF_EDITOR.data, rm.dataset.pfRemove) || [];
      arr.splice(Number(rm.dataset.pfI), 1);
      pfMarkDirty();
      pfPaintPanel();
      return;
    }

    const mv = e.target.closest("[data-pf-move]");
    if (mv) {
      const arr = pfGetPath(PF_EDITOR.data, mv.dataset.pfMove) || [];
      const i = Number(mv.dataset.pfI), j = i + Number(mv.dataset.pfDir);
      if (j >= 0 && j < arr.length) {
        [arr[i], arr[j]] = [arr[j], arr[i]];
        pfMarkDirty();
        pfPaintPanel();
      }
      return;
    }

    // Into the designer, either on a blank canvas or on the design this
    // portfolio is already wearing.
    if (e.target.closest("#pf-open-designer")) {
      pfDesignerNew(null, "My design");
      return;
    }
    const editDesign = e.target.closest("#pf-edit-design");
    if (editDesign) {
      const row = pfDesignRow(PF_EDITOR.templateId);
      if (row) pfDesignerOpen(row.id);
      return;
    }

    const pick = e.target.closest("[data-pf-pick]");
    if (pick) {
      if (e.target.closest("[data-pf-preview]")) return;   // the eye is not a pick
      PF_EDITOR.templateId = pick.dataset.pfPick;
      _pfPreviewScrollY = 0;   // a different design is a different page
      pfMarkDirty();
      pfPaintPanel();
      pfRefreshPreview(true);
      return;
    }

    const sw = e.target.closest("[data-pf-accent]");
    if (sw) {
      PF_EDITOR.data.accent_color = sw.dataset.pfAccent;
      pfMarkDirty();
      pfPaintPanel();
      return;
    }

    if (e.target.closest("#pf-accent-reset")) {
      PF_EDITOR.data.accent_color = "";
      pfMarkDirty();
      pfPaintPanel();
      return;
    }

    if (e.target.closest("#pf-download-2")) {
      pfDownloadSite(PF_EDITOR.templateId, PF_EDITOR.data, PF_EDITOR.name, PF_EDITOR.id);
      return;
    }

    if (e.target.closest("#pf-photo-btn")) { document.getElementById("pf-photo").click(); return; }
    if (e.target.closest("#pf-photo-profile") || e.target.closest("#pf-photo-resync")) {
      pfUseProfilePhoto();
      return;
    }
    if (e.target.closest("#pf-photo-switch")) {
      // The tab strip is wired once when the builder renders and lives outside
      // the panel body, so switching from in here has to move its active state
      // by hand as well as the panel's.
      PF_EDITOR.tab = "template";
      document.querySelectorAll("[data-pf-panel]").forEach(bt =>
        bt.classList.toggle("active", bt.dataset.pfPanel === "template"));
      pfPaintPanel();
      return;
    }
    if (e.target.closest("#pf-photo-keep")) {
      // "Mine now." Dropping the profile link is what stops the prompt coming
      // back on every render, and it is honest: this is no longer a copy of
      // the account photo.
      PF_EDITOR.data.avatar_source = "custom";
      PF_EDITOR.data.avatar_ref = "";
      pfMarkDirty();
      pfPaintPanel();
      return;
    }
    if (e.target.closest("#pf-photo-clear")) {
      PF_EDITOR.data.avatar = "";
      PF_EDITOR.data.avatar_source = "";
      PF_EDITOR.data.avatar_ref = "";
      // Removing it counts as a decision: do not let the auto-fill put it back.
      PF_EDITOR.photoSeeded = true;
      pfMarkDirty();
      pfPaintPanel();
      return;
    }
    if (e.target.closest("#pf-import")) { pfImportFromResume(); return; }
    if (e.target.closest("#pf-attach")) { pfAttachResume(); return; }
  });

  const photo = body.querySelector("#pf-photo");
  if (photo) photo.addEventListener("change", () => pfHandlePhoto(photo.files && photo.files[0]));

  const font = body.querySelector("#pf-font");
  if (font) font.addEventListener("change", () => {
    PF_EDITOR.data.font = font.value;
    pfMarkDirty();
  });

  const pick = body.querySelector("#pf-resume-pick");
  if (pick) pick.addEventListener("change", () => pfUpdateResumeButtons());
}

// ---------------------------------------------------------------------------
// Photo
// ---------------------------------------------------------------------------
// Two sources, one destination. Whether the picture comes from a file the
// person picked or from the photo already on their account, it ends up as the
// same thing: a 512px square JPEG data URI sitting inside `data.avatar`.
//
// It has to be a data URI. The exported site is one self-contained file meant
// to be dropped on Netlify, a USB stick or somebody else's server, and a
// reference back to this app's /uploads/avatars/... would be a broken image
// everywhere except this machine.
//
// `avatar_source` records where it came from, which is what lets the builder
// label the photo and notice later that the account photo has moved on:
//   ""        no photo
//   "profile" a copy of the account photo identified by `avatar_ref`
//   "custom"  uploaded here, or an older profile photo deliberately kept
// Both fields ride along in the free-form `data` bag — no schema change, and
// older portfolios simply have neither.

// The crop every photo goes through: centre square, at most 512px, JPEG.
function pfSquarePhoto(img) {
  const MAX = 512;
  const side = Math.min(img.width, img.height);           // square centre crop
  const sx = (img.width - side) / 2, sy = (img.height - side) / 2;
  const out = Math.min(MAX, side);
  const cv = document.createElement("canvas");
  cv.width = cv.height = out;
  const ctx = cv.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, sx, sy, side, side, 0, 0, out, out);
  return cv.toDataURL("image/jpeg", 0.86);
}

function pfDecode(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("could not decode the image"));
    img.src = src;
  });
}

// The account photo is served by the API, which is usually a different origin
// from the page. Pointing an <img> straight at it would taint the canvas and
// make toDataURL throw, so the bytes are fetched first and handed to the image
// as a blob URL — same-origin as far as the canvas is concerned.
async function pfPhotoFromUrl(url) {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) throw new Error("HTTP " + res.status);
  const blob = await res.blob();
  if (blob.size > 24 * 1024 * 1024) throw new Error("image too large");
  const obj = URL.createObjectURL(blob);
  try {
    return pfSquarePhoto(await pfDecode(obj));
  } finally {
    URL.revokeObjectURL(obj);                              // or the blob leaks for the tab's life
  }
}

// The account photo's path, or "" when the person has never uploaded one.
function pfProfilePhotoPath() {
  return (typeof state !== "undefined" && state.profile && state.profile.avatar_url) || "";
}

// True when this portfolio is carrying a copy of an account photo that has
// since been replaced. Only ever true for photos that came from the profile —
// a photo somebody uploaded here is theirs, and nagging about it would be rude.
function pfProfilePhotoMoved() {
  const d = PF_EDITOR.data || {};
  const now = pfProfilePhotoPath();
  return !!(now && d.avatar && d.avatar_source === "profile" && d.avatar_ref && d.avatar_ref !== now);
}

// The chosen template when it has a photo but no way to show one. Somebody who
// has just added a picture and sees nothing change in the preview deserves an
// explanation rather than a puzzle; returning the template (not a boolean)
// lets the message name it.
function pfPhotolessTemplate() {
  if (!PF_EDITOR.data || !PF_EDITOR.data.avatar) return null;
  const t = PF_TEMPLATE_BY_ID[PF_EDITOR.templateId];
  return t && t.photo === false ? t : null;
}

// Copy the account photo into this portfolio. `silent` is the auto-fill on a
// brand-new portfolio: it must not mark the form dirty, because seeding a
// blank form is not an edit the person made — the name, title and location
// beside it are seeded the same way.
async function pfUseProfilePhoto(opts) {
  const options = opts || {};
  const path = pfProfilePhotoPath();
  if (!path || PF_EDITOR.photoBusy) return false;
  PF_EDITOR.photoBusy = true;
  try {
    const dataUrl = await pfPhotoFromUrl(apiUrl(path));
    PF_EDITOR.data.avatar = dataUrl;
    PF_EDITOR.data.avatar_source = "profile";
    PF_EDITOR.data.avatar_ref = path;
    if (!options.silent) {
      pfMarkDirty();
      showToast("Using your profile photo", "success");
    }
    pfPaintPanel();
    return true;
  } catch (err) {
    // A missing or unreadable account photo is not worth interrupting anybody
    // over when we reached for it on our own; the initials stand in as before.
    console.error("[portfolio] could not use the profile photo", err);
    if (!options.silent) showToast("Couldn't load your profile photo", "error");
    return false;
  } finally {
    PF_EDITOR.photoBusy = false;
  }
}

// The photo is downscaled and re-encoded in the browser before it ever reaches
// the data model. A 6MB phone photo would otherwise become an 8MB base64 blob
// inside the HTML file — a portfolio nobody can host and the server refuses to
// save.
function pfHandlePhoto(file) {
  if (!file) return;
  if (!/^image\/(png|jpe?g|webp)$/i.test(file.type)) {
    showToast("Use a PNG, JPG or WebP image", "warning");
    return;
  }
  if (file.size > 12 * 1024 * 1024) {
    showToast("That image is over 12MB — try a smaller one", "warning");
    return;
  }
  const obj = URL.createObjectURL(file);
  pfDecode(obj)
    .then((img) => {
      PF_EDITOR.data.avatar = pfSquarePhoto(img);
      // Uploaded here, so it is this portfolio's own picture from now on: no
      // "your profile photo changed" prompt will ever second-guess it.
      PF_EDITOR.data.avatar_source = "custom";
      PF_EDITOR.data.avatar_ref = "";
      pfMarkDirty();
      pfPaintPanel();
      showToast("Photo added", "success");
    })
    .catch(() => showToast("Couldn't read that image", "error"))
    .finally(() => URL.revokeObjectURL(obj));
}

// ---------------------------------------------------------------------------
// Résumé linking
// ---------------------------------------------------------------------------
async function pfLoadResumeList() {
  const sel = document.getElementById("pf-resume-pick");
  if (!sel) return;
  try {
    if (!_pfResumes) _pfResumes = await get("/api/resumes");
  } catch (err) {
    sel.innerHTML = `<option value="">Couldn't load your résumés</option>`;
    return;
  }
  if (!_pfResumes.length) {
    sel.innerHTML = `<option value="">You haven't saved a résumé yet</option>`;
    const note = document.getElementById("pf-resume-note");
    if (note) note.innerHTML = `Build one in the <b>Resumes</b> tab first, then come back — its content imports in one click.`;
    return;
  }
  sel.innerHTML = `<option value="">Choose a résumé…</option>` + _pfResumes.map(r =>
    `<option value="${r.id}" ${String(PF_EDITOR.resumeId) === String(r.id) ? "selected" : ""}>
      ${esc(r.name)}${r.has_builder_data ? "" : " (uploaded file)"}
    </option>`).join("");
  pfUpdateResumeButtons();
}

function pfUpdateResumeButtons() {
  const sel = document.getElementById("pf-resume-pick");
  const imp = document.getElementById("pf-import");
  const att = document.getElementById("pf-attach");
  if (!sel || !imp || !att) return;
  const id = Number(sel.value);
  const row = (_pfResumes || []).find(r => r.id === id);
  // An uploaded PDF has no structured content behind it, so "import" would
  // have nothing to import — say so on the button rather than failing later.
  imp.disabled = !row || !row.has_builder_data;
  imp.title = row && !row.has_builder_data
    ? "This résumé was uploaded as a file, so there's no structured content to import."
    : "";
  att.disabled = !row;
}

async function pfImportFromResume() {
  const sel = document.getElementById("pf-resume-pick");
  const id = Number(sel && sel.value);
  if (!id) return;
  const btn = document.getElementById("pf-import");
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Importing…";
  try {
    const res = await get(`/api/portfolios/import/resume/${id}`, { noCache: true });
    const incoming = res.data || {};
    // Merge, don't replace: a field the résumé says nothing about keeps
    // whatever the customer typed here.
    Object.entries(incoming).forEach(([k, v]) => {
      if (v == null || v === "" || (Array.isArray(v) && !v.length)) return;
      PF_EDITOR.data[k] = v;
    });
    PF_EDITOR.data = pfNormalize(PF_EDITOR.data);
    PF_EDITOR.resumeId = id;
    if (!PF_EDITOR.name) PF_EDITOR.name = res.suggested_name || "My Portfolio";
    const nameInput = document.getElementById("pf-name");
    if (nameInput) nameInput.value = PF_EDITOR.name;
    // Sections that just received content should be visible — importing an
    // experience list and leaving it switched off is not what anyone means.
    ["about", "skills", "projects", "experience", "education", "certifications"].forEach(k => {
      const v = PF_EDITOR.data[k];
      if ((Array.isArray(v) && v.length) || (typeof v === "string" && v.trim())) PF_EDITOR.data.sections[k] = true;
    });
    pfMarkDirty();
    pfRefreshPreview(true);
    showToast("Content imported — check it over in the Content tab", "success");
    await pfAttachResume(true);
    PF_EDITOR.tab = "content";
    document.querySelectorAll("[data-pf-panel]").forEach(b => b.classList.toggle("active", b.dataset.pfPanel === "content"));
    pfPaintPanel();
  } catch (err) {
    showToast(apiErrorMessage(err, "Couldn't import that résumé"), "error");
    btn.disabled = false;
    btn.textContent = label;
  }
}

// Fetches the résumé PDF and embeds it as a data URI, so the download button
// on the exported site works from any host — including a file:// copy opened
// straight off a USB stick.
// Gets a résumé's PDF bytes. Builds differ on how they hand a résumé file
// back: newer ones expose /api/resumes/<id>/download (which can also convert
// format), older ones only serve the stored file from /uploads. Try the
// endpoint, fall back to the file — so the Portfolio tab works on either
// without a second copy of this function.
async function pfFetchResumePdf(id, row) {
  const token = auth.getToken();
  const headers = token ? { Authorization: `Bearer ${token}` } : {};

  let res = await fetch(`${API_BASE}/api/resumes/${id}/download?format=pdf`, { headers });
  if (res.ok) return res.blob();

  // 404 here means either "no such résumé" or "this build has no such route".
  // The fallback tells the two apart: if the stored file comes back, it was
  // the route that was missing.
  const missingRoute = res.status === 404 || res.status === 405;
  if (missingRoute && row && row.filename) {
    const alt = await fetch(`${API_BASE}/uploads/${encodeURIComponent(row.filename)}`, { headers });
    if (alt.ok) return alt.blob();
  }
  let detail = "";
  try { detail = (await res.json()).detail; } catch (_) {}
  throw new Error(detail || (missingRoute
    ? "That résumé has no PDF file stored to attach."
    : `Couldn't fetch that résumé (${res.status}).`));
}

async function pfAttachResume(quiet) {
  const sel = document.getElementById("pf-resume-pick");
  const id = Number((sel && sel.value) || PF_EDITOR.resumeId);
  if (!id) return;
  const row = (_pfResumes || []).find(r => r.id === id);
  const btn = document.getElementById("pf-attach");
  if (btn && !quiet) { btn.disabled = true; btn.textContent = "Attaching…"; }
  try {
    const blob = await pfFetchResumePdf(id, row);
    if (blob.size > 6 * 1024 * 1024) {
      showToast("That résumé PDF is over 6MB — link to it instead of embedding it", "warning");
      return;
    }
    const dataUrl = await new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = reject;
      fr.readAsDataURL(blob);
    });
    const stem = ((row && row.name) || "resume").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    PF_EDITOR.data.resume = {
      ...PF_EDITOR.data.resume,
      mode: "embed",
      filename: `${stem || "resume"}.pdf`,
      data_url: dataUrl,
      label: PF_EDITOR.data.resume.label || "Download résumé",
    };
    PF_EDITOR.resumeId = id;
    pfMarkDirty();
    pfRefreshPreview(true);
    if (!quiet) {
      showToast(`Résumé attached — ${Math.round(blob.size / 1024)} KB embedded in the file`, "success");
      pfPaintPanel();
    }
  } catch (err) {
    showToast(apiErrorMessage(err, "Couldn't attach that résumé"), "error");
  } finally {
    if (btn && !quiet) { btn.disabled = false; btn.textContent = "📎 Attach for download"; }
  }
}

// ---------------------------------------------------------------------------
// Save / export
// ---------------------------------------------------------------------------
async function pfSave() {
  const btn = document.getElementById("pf-save");
  const stateEl = document.getElementById("pf-save-state");
  if (btn) { btn.disabled = true; btn.textContent = "Saving…"; }
  const name = (PF_EDITOR.name || "").trim() || (PF_EDITOR.data.full_name ? `${PF_EDITOR.data.full_name}'s Portfolio` : "Untitled Portfolio");
  const payload = {
    name,
    template_id: PF_EDITOR.templateId,
    data: PF_EDITOR.data,
    resume_id: PF_EDITOR.resumeId || 0,   // 0 clears the link; see the API schema
  };
  try {
    const saved = PF_EDITOR.id
      ? await put(`/api/portfolios/${PF_EDITOR.id}`, payload)
      : await post("/api/portfolios", payload);
    PF_EDITOR.id = saved.id;
    PF_EDITOR.name = saved.name;
    PF_EDITOR.loadedFor = String(saved.id);
    PF_EDITOR.dirty = false;
    state.portfolioId = saved.id;
    const nameInput = document.getElementById("pf-name");
    if (nameInput) nameInput.value = saved.name;
    if (stateEl) { stateEl.textContent = "Saved"; stateEl.classList.remove("pf-unsaved"); }
    showToast("Portfolio saved", "success");
  } catch (err) {
    showToast(apiErrorMessage(err, "Couldn't save"), "error");
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "Save"; }
  }
}

function pfDownloadSite(templateId, data, name, id) {
  let html;
  try {
    html = pfRenderSite(templateId, data);
  } catch (err) {
    console.error("[portfolio] export failed", err);
    showToast("Couldn't build that file — check the browser console", "error");
    return;
  }
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = pfFileName(name, pfNormalize(data));
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  showToast(`Downloaded — rename it to index.html and drop it on any static host`, "success");
  // Best effort: the stamp on the library card is a nicety, never a reason to
  // interrupt a successful download with an error.
  if (id) post(`/api/portfolios/${id}/exported`).catch(() => {});
}

function pfOpenInNewTab(html) {
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const win = window.open(url, "_blank", "noopener");
  if (!win) showToast("Your browser blocked the pop-up — allow pop-ups to preview in a new tab", "warning");
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
