/**
 * Regression harness for designs built in the portfolio designer.
 *
 * A design goes through exactly the pipeline the thirty-eight hand-written
 * templates go through — pfRenderSite -> pfDocument -> one self-contained
 * file — so it has to keep exactly the same promises: valid document, nothing
 * loaded from another host, and hostile content that cannot execute. The
 * template harness next door asserts those for templates somebody wrote; this
 * asserts them for a layout a customer assembled, which is the case where the
 * *shape* of the page is user input too.
 *
 * It also covers the three rules that only exist for designs:
 *   - a block bound to a section with no content is dropped, not drawn empty;
 *   - a hidden block is absent from the page but kept in the document; and
 *   - the editor's data-blk hooks appear only when the designer asks for them,
 *     never in the file a customer publishes.
 *
 *     node frontend/tests/test_portfolio_designs.js
 *     node frontend/tests/test_portfolio_designs.js --verbose
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const VERBOSE = process.argv.includes("--verbose");
const HERE = path.join(__dirname, "..");
const ctx = { console };
vm.createContext(ctx);
vm.runInContext(
  fs.readFileSync(path.join(HERE, "portfolio-templates.js"), "utf8") + "\n" +
  fs.readFileSync(path.join(HERE, "portfolio-blocks.js"), "utf8") + "\n" +
  // Hand the pieces the harness drives back out of the sandbox.
  "this.pfRenderSite = pfRenderSite; this.pfSetDesignLookup = pfSetDesignLookup;" +
  "this.pfBlankDesign = pfBlankDesign; this.pfNormalizeDesign = pfNormalizeDesign;" +
  "this.pfNewBlock = pfNewBlock; this.PF_BLOCKS = PF_BLOCKS; this.PF_BLK_BG = PF_BLK_BG;" +
  "this.PF_BLK_GFX = PF_BLK_GFX; this.PF_BLK_ANIM = PF_BLK_ANIM; this.PF_BLK_PAD = PF_BLK_PAD;" +
  "this.PF_THEME_FONTS = PF_THEME_FONTS; this.PF_THEME_WIDTH = PF_THEME_WIDTH;" +
  "this.PF_THEME_MOTION = PF_THEME_MOTION; this.PF_SECTIONS = PF_SECTIONS;" +
  "this.PF_PRESETS = PF_PRESETS; this.pfPresetDesign = pfPresetDesign;",
  ctx
);

// The design under test is swapped in through the same hook portfolio.js
// uses, so the harness exercises the real resolution path rather than
// calling the renderer directly.
let CURRENT = null;
ctx.pfSetDesignLookup((id) => (id === "custom:1" ? CURRENT : null));
const render = (design, data, opts) => {
  CURRENT = design;
  return ctx.pfRenderSite("custom:1", data, opts);
};

let failures = [];
function check(scenario, label, condition, detail) {
  if (!condition) failures.push(`${scenario}: ${label}${detail ? " — " + detail : ""}`);
  else if (VERBOSE) console.log(`    ok  ${label}`);
}

// --------------------------------------------------------------------------
// Fixtures
// --------------------------------------------------------------------------
const FULL = {
  full_name: "Ada Bell", title: "Staff Engineer", tagline: "I make slow things fast.",
  about: "Fifteen years of making systems smaller.", email: "ada@example.com",
  location: "Leeds, UK", website: "ada.dev", github: "github.com/ada", linkedin: "in/ada",
  available: "Open to work", cta_text: "Say hello", footer_note: "Built in Leeds",
  stats: [{ value: "15", label: "Years" }, { value: "40", label: "Shipped" }],
  skills: ["Backend: Go", "Backend: Rust", "Data: Postgres"],
  projects: [{ name: "Kettle", role: "Lead", period: "2024", description: "A queue.",
               bullets: ["Cut p99 by half"], tags: ["Go"], link: "kettle.dev", repo: "github.com/ada/kettle" }],
  experience: [{ role: "Staff Engineer", org: "Northwind", period: "2020—", location: "Leeds",
                 summary: "Platform.", bullets: ["Ran the migration"] }],
  education: [{ degree: "BSc Computing", school: "Leeds", period: "2008", detail: "First" }],
  certifications: ["AWS SA Pro"],
};

const SPARSE = { full_name: "A", email: "a@example.com" };

const PAYLOAD = '"><script>window.PWNED=1<\/script><img src=x onerror="window.PWNED=1">';
const HOSTILE = {
  ...FULL,
  full_name: PAYLOAD, title: PAYLOAD, tagline: PAYLOAD, about: PAYLOAD, location: PAYLOAD,
  email: PAYLOAD, website: PAYLOAD, github: PAYLOAD, linkedin: PAYLOAD,
  available: PAYLOAD, cta_text: PAYLOAD, footer_note: PAYLOAD,
  skills: [PAYLOAD], certifications: [PAYLOAD],
  stats: [{ value: PAYLOAD, label: PAYLOAD }],
  projects: [{ name: PAYLOAD, role: PAYLOAD, description: PAYLOAD, bullets: [PAYLOAD],
               tags: [PAYLOAD], link: PAYLOAD, repo: PAYLOAD }],
  experience: [{ role: PAYLOAD, org: PAYLOAD, summary: PAYLOAD, bullets: [PAYLOAD] }],
  education: [{ degree: PAYLOAD, school: PAYLOAD, detail: PAYLOAD }],
};

// A design carrying every block type, so no renderer goes unexercised.
function everyBlock(over) {
  const design = ctx.pfNormalizeDesign(ctx.pfBlankDesign("Everything"));
  design.blocks = ctx.PF_BLOCKS.map(b => ctx.pfNewBlock(b.type, over));
  return design;
}

// --------------------------------------------------------------------------
// Every block, every fixture: still one safe, self-contained page
// --------------------------------------------------------------------------
for (const [name, data] of [["full", FULL], ["sparse", SPARSE], ["hostile", HOSTILE]]) {
  let html;
  try {
    html = render(everyBlock(), data);
  } catch (err) {
    failures.push(`every block / ${name}: threw — ${err.message}`);
    continue;
  }
  const s = `every block / ${name}`;
  check(s, "starts with a doctype", html.startsWith("<!DOCTYPE html>"));
  check(s, "has one <html> and one </html>",
    (html.match(/<html/g) || []).length === 1 && (html.match(/<\/html>/g) || []).length === 1);
  check(s, "has a <title>", /<title>[^<]/.test(html));
  check(s, "has the #main landmark", html.includes('id="main"'));

  const externalScripts = (html.match(/<script[^>]+src=/gi) || []).length;
  check(s, "no external <script src>", externalScripts === 0, `${externalScripts} found`);
  const links = html.match(/<link[^>]+href="https?:\/\/[^"]+"/gi) || [];
  const nonFont = links.filter(l => !/fonts\.(googleapis|gstatic)\.com/.test(l));
  check(s, "no external stylesheets besides Google Fonts", nonFont.length === 0, nonFont.join(" "));
  const imgs = html.match(/<img[^>]+src="(?!data:)[^"]*"/gi) || [];
  check(s, "no images loaded from another host", imgs.length === 0, imgs.join(" "));

  // Every anchor the page emits has to land somewhere on the page.
  const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]));
  const dangling = [...html.matchAll(/href="#([^"]+)"/g)].map(m => m[1]).filter(a => !ids.has(a));
  check(s, "no nav or footer link points at a missing anchor", dangling.length === 0, dangling.join(" "));

  // No id twice — two #projects would send every link to whichever came first.
  const all = [...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]);
  const dupes = all.filter((x, i) => all.indexOf(x) !== i);
  check(s, "no duplicate ids", dupes.length === 0, dupes.join(" "));

  if (name === "hostile") {
    check(s, "payload appears escaped", html.includes("&lt;script&gt;"));
    const blocks = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]);
    const leaked = blocks.filter(b => /<\s*\/?\s*script/i.test(b));
    check(s, "no unescaped script tag inside a script block", leaked.length === 0);
    check(s, "no live onerror attribute", !/<img(?:[^>]*\s)onerror=(?!&quot;)/i.test(html));
  }
}

// --------------------------------------------------------------------------
// Every option value renders
// --------------------------------------------------------------------------
// The inspector offers these, so every one of them has to produce a page. A
// background or animation with no matching CSS is invisible in the designer
// (it just looks like nothing happened) and ships broken.
for (const [table, key] of [[ctx.PF_BLK_BG, "bg"], [ctx.PF_BLK_GFX, "gfx"],
                            [ctx.PF_BLK_ANIM, "anim"], [ctx.PF_BLK_PAD, "pad"]]) {
  for (const opt of table) {
    try {
      const html = render(everyBlock({ [key]: opt.id }), FULL);
      check(`${key}=${opt.id}`, "renders a document", html.startsWith("<!DOCTYPE html>"));
      if (key !== "pad" && opt.id !== "none") {
        const cls = key === "anim" ? `rv-${opt.id}` : `${key === "bg" ? "bg" : "gfx"}-${opt.id}`;
        check(`${key}=${opt.id}`, `the stylesheet defines .${cls}`, html.includes(`.${cls}`));
      }
    } catch (err) {
      failures.push(`${key}=${opt.id}: threw — ${err.message}`);
    }
  }
}

for (const b of ctx.PF_BLOCKS) {
  for (const v of b.variants) {
    const design = ctx.pfNormalizeDesign(ctx.pfBlankDesign());
    design.blocks = [ctx.pfNewBlock(b.type, { variant: v.id })];
    try {
      const html = render(design, FULL);
      check(`${b.type}/${v.id}`, "renders a document", html.startsWith("<!DOCTYPE html>"));
    } catch (err) {
      failures.push(`${b.type}/${v.id}: threw — ${err.message}`);
    }
  }
}

for (const t of ctx.PF_THEME_FONTS) {
  for (const w of ctx.PF_THEME_WIDTH) {
    for (const m of ctx.PF_THEME_MOTION) {
      const design = everyBlock();
      Object.assign(design.theme, { font: t.id, width: w.id, motion: m.id });
      try {
        check(`theme ${t.id}/${w.id}/${m.id}`, "renders a document",
          render(design, FULL).startsWith("<!DOCTYPE html>"));
      } catch (err) {
        failures.push(`theme ${t.id}/${w.id}/${m.id}: threw — ${err.message}`);
      }
    }
  }
}

// --------------------------------------------------------------------------
// The presets
// --------------------------------------------------------------------------
// Each one is offered as a finished starting point, so each has to survive
// the same three fixtures every template does — including the almost-empty
// one, because somebody will apply a preset before writing a word.
for (const p of ctx.PF_PRESETS) {
  const design = ctx.pfPresetDesign(p.id);
  check(`preset ${p.id}`, "expands to a design", !!design && design.blocks.length > 0);
  if (!design) continue;

  // A preset that loses blocks in normalisation has a typo in it — a block
  // type that does not exist, or a variant that block does not have. Both
  // fail silently at runtime, which is exactly why this is asserted.
  check(`preset ${p.id}`, "every block survived normalisation",
    design.blocks.length === p.blocks.length,
    `${design.blocks.length} of ${p.blocks.length}`);
  p.blocks.forEach(([type, variant], i) => {
    const got = design.blocks[i];
    if (!got) return;
    check(`preset ${p.id}`, `block ${i} keeps its variant (${type}/${variant})`,
      got.type === type && got.variant === variant, `${got.type}/${got.variant}`);
  });

  for (const [name, data] of [["full", FULL], ["sparse", SPARSE], ["hostile", HOSTILE]]) {
    try {
      const html = render(design, data);
      check(`preset ${p.id} / ${name}`, "renders one document", html.startsWith("<!DOCTYPE html>"));
      const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]));
      const dangling = [...html.matchAll(/href="#([^"]+)"/g)].map(m => m[1]).filter(a => !ids.has(a));
      check(`preset ${p.id} / ${name}`, "no link points at a missing anchor",
        dangling.length === 0, dangling.join(" "));
      const all = [...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]);
      const dupes = all.filter((x, i) => all.indexOf(x) !== i);
      check(`preset ${p.id} / ${name}`, "no duplicate ids", dupes.length === 0, dupes.join(" "));
    } catch (err) {
      failures.push(`preset ${p.id} / ${name}: threw — ${err.message}`);
    }
  }

  // The catalogue entry is what somebody picks from, so it has to be filled in.
  for (const field of ["name", "blurb", "best"]) {
    check(`preset ${p.id}`, `has a ${field}`, !!(p[field] || "").trim());
  }
}

// Presets are meant to be visibly different from each other, not ten
// recolourings of one arrangement. Two with the same block order and the same
// typeface would be a copy-paste that nobody would notice by reading the file.
{
  const seen = {};
  for (const p of ctx.PF_PRESETS) {
    const shape = p.theme.font + "|" + p.blocks.map(b => b[0] + ":" + b[1]).join(",");
    check("presets", `${p.id} is not a duplicate of ${seen[shape] || ""}`, !seen[shape]);
    seen[shape] = p.id;
  }
  const ids = ctx.PF_PRESETS.map(p => p.id);
  check("presets", "ids are unique", new Set(ids).size === ids.length);
}

// --------------------------------------------------------------------------
// The rules that only designs have
// --------------------------------------------------------------------------

// A block bound to a section the customer has not filled in draws nothing —
// a heading over an empty grid is worse than no heading.
{
  const html = render(everyBlock(), SPARSE);
  for (const id of ["projects", "experience", "education", "certifications", "skills", "about"]) {
    check("empty sections", `#${id} is absent when there is no content`, !html.includes(`id="${id}"`));
  }
  check("empty sections", "the hero still renders", html.includes('id="top"'));
}

// Hiding is not deleting: gone from the page, still in the document.
//
// Built from a named list rather than everyBlock(): several blocks draw the
// projects section (a grid, a spotlight, a gallery wall) and each claims the
// #projects anchor, so hiding one of them on a page that has all three is
// correctly expected to leave the anchor behind. The assertion here is about
// the block that is the *only* one drawing its section.
{
  const design = ctx.pfNormalizeDesign(ctx.pfBlankDesign());
  design.blocks = ["nav", "hero", "about", "projects", "contact", "footer"]
    .map(t => ctx.pfNewBlock(t));
  const projects = design.blocks.find(b => b.type === "projects");
  projects.hidden = true;
  const html = render(design, FULL);
  check("hidden", "a hidden block leaves no section behind", !html.includes('id="projects"'));
  check("hidden", "and no nav link pointing at it", !html.includes('href="#projects"'));
  const kept = ctx.pfNormalizeDesign(JSON.parse(JSON.stringify(design)));
  const still = kept.blocks.find(b => b.type === "projects");
  check("hidden", "the block survives a save-and-reload", !!still && still.hidden === true);
  check("hidden", "and keeps its settings", !!still && still.variant === projects.variant);
  check("hidden", "showing it again brings the section back",
    (() => { still.hidden = false; return render(kept, FULL).includes('id="projects"'); })());
}

// The canvas hooks are for the canvas only.
{
  const design = everyBlock();
  const published = render(design, FULL);
  check("editor hooks", "a published file carries no data-blk", !published.includes("data-blk"));
  check("editor hooks", "and no editor bridge", !published.includes("pfe-tag"));

  const editing = render(design, FULL, { preview: true, editor: true });
  check("editor hooks", "the canvas tags every rendered block", editing.includes("data-blk="));
  check("editor hooks", "and labels them for the drag handle", editing.includes("data-blk-label="));
  check("editor hooks", "and ships the editor bridge", editing.includes("pfe-tag"));

  const plain = render(design, FULL, { preview: true });
  check("editor hooks", "an ordinary preview gets the plain bridge, not the editor",
    !plain.includes("data-blk=") && !plain.includes("pfe-tag"));
}

// A design that arrives damaged still produces a page rather than an
// exception — old saves, hand-edited JSON, a half-written write.
{
  const junk = [
    null, undefined, {}, { blocks: null }, { blocks: [{ type: "nope" }] },
    { theme: { tone: "sideways", accent: "not-a-colour", radius: 9999 },
      blocks: [{ type: "hero", variant: "nope", bg: "nope", gfx: "nope", anim: "nope", pad: "nope" }] },
    { blocks: [{ type: "nav" }, { type: "nav" }, { type: "hero" }, { type: "hero" }] },
  ];
  junk.forEach((raw, i) => {
    try {
      const html = render(ctx.pfNormalizeDesign(raw), FULL);
      check(`damaged design ${i}`, "still renders a document", html.startsWith("<!DOCTYPE html>"));
      check(`damaged design ${i}`, "with at most one nav", (html.match(/<nav /g) || []).length <= 1);
    } catch (err) {
      failures.push(`damaged design ${i}: threw — ${err.message}`);
    }
  });
}

// --------------------------------------------------------------------------
if (failures.length) {
  console.error(`\nFAILED — ${failures.length} assertion(s):\n`);
  failures.forEach(f => console.error("  • " + f));
  process.exit(1);
}
console.log(`\nPASS — designs render as one valid, self-contained, escape-safe file,\n` +
            `       every block, variant, option and theme combination.`);
