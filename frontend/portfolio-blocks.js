// ============================================================================
// Momentum — Portfolio block library
// ============================================================================
// The other 38 templates are hand-written functions. This file is the one that
// is *composed*: a design document — a theme plus an ordered list of blocks —
// is turned into the exact same { fonts, css, body, js } shape every other
// renderer returns.
//
// That is the whole trick. Because a custom design ends up in the same shape,
// it flows through every pipeline that already exists — the live preview, the
// sandboxed thumbnails, the download, the reduced-motion rules, the scroll
// reveal, the anchor handling — without one of them knowing it is looking at
// something a person assembled rather than something I wrote.
//
// Two rules kept the block model honest:
//
//   1. Blocks stack. There are no absolute coordinates anywhere in a design
//      document, so a layout cannot be "correct on my screen" and broken on a
//      phone. Every block is responsive by construction.
//   2. Blocks bind to real content. A projects block draws the projects in the
//      portfolio; it does not hold copies of them. Editing your work in the
//      Content tab updates every design that shows it, and switching design
//      never loses a word.
//
// Loaded after portfolio-templates.js, whose helpers (pfEsc, pfRgba, pfShade,
// pfHueShift, pfAvatar, pfSocialRow, pfProjectLinks, pfJoin, PF_ICONS) it uses.
// ============================================================================

// ---------------------------------------------------------------------------
// Option tables — these drive both the renderer and the designer's inspector,
// so a new option appears in the UI and in the output from one edit.
// ---------------------------------------------------------------------------

// Block backgrounds. "invert" marks the ones that carry light text, which the
// renderer needs to know so it can flip every colour inside the block.
const PF_BLK_BG = [
  { id: "none",     label: "None",         invert: false },
  { id: "tint",     label: "Accent tint",  invert: false },
  { id: "surface",  label: "Surface",      invert: false },
  { id: "gradient", label: "Gradient",     invert: true  },
  { id: "deep",     label: "Deep",         invert: true  },
  { id: "glass",    label: "Glass",        invert: false },
  // Added for the art directions the designer's presets are built on. Each
  // one changes what a block *is* rather than tinting it: a paper stock, a
  // solid accent field, a flat two-colour poster, or an outline that draws
  // the block's own edge.
  { id: "paper",    label: "Paper stock",  invert: false },
  { id: "solid",    label: "Solid accent", invert: true  },
  { id: "duotone",  label: "Duotone",      invert: true  },
  { id: "outline",  label: "Outlined",     invert: false },
];

// The decorative layer. Every one of these is pure CSS on a pointer-events:none
// child, so a graphic can never push text around or intercept a click.
const PF_BLK_GFX = [
  { id: "none",   label: "None" },
  { id: "blobs",  label: "Soft blobs" },
  { id: "grid",   label: "Grid" },
  { id: "dots",   label: "Dot field" },
  { id: "rings",  label: "Rings" },
  { id: "waves",  label: "Waves" },
  { id: "beams",  label: "Beams" },
  { id: "glow",   label: "Corner glow" },
  { id: "noise",  label: "Fine grain" },
  { id: "halftone",   label: "Halftone" },
  { id: "crosshatch", label: "Crosshatch" },
  { id: "stripes",    label: "Diagonal stripes" },
  { id: "scanlines",  label: "Scanlines" },
  { id: "topo",       label: "Contour lines" },
  { id: "confetti",   label: "Confetti" },
];

// Entrance animations. They ride the scroll-reveal every template already has:
// [data-reveal] starts hidden, .pf-in clears it, and these classes only change
// what "hidden" looks like — so reduced motion disables them all for free.
const PF_BLK_ANIM = [
  { id: "none",    label: "None" },
  { id: "fade",    label: "Fade" },
  { id: "rise",    label: "Rise" },
  { id: "fall",    label: "Fall from above" },
  { id: "slide",   label: "Slide from left" },
  { id: "slideR",  label: "Slide from right" },
  { id: "zoom",    label: "Zoom in" },
  { id: "shrink",  label: "Zoom out" },
  { id: "blur",    label: "Focus in" },
  { id: "mask",    label: "Wipe up" },
  { id: "curtain", label: "Wipe across" },
  { id: "tilt",    label: "Tilt in" },
  { id: "flip",    label: "Flip" },
  { id: "swing",   label: "Swing" },
  { id: "skew",    label: "Skew" },
  { id: "drift",   label: "Drift up slowly" },
  { id: "pop",     label: "Pop" },
  { id: "stagger", label: "Stagger children" },
  { id: "cascade", label: "Cascade children" },
];

const PF_BLK_PAD  = [
  { id: "none", label: "Flush" }, { id: "sm", label: "Tight" },
  { id: "md",   label: "Normal" }, { id: "lg", label: "Roomy" }, { id: "xl", label: "Generous" },
];

const PF_THEME_FONTS = [
  { id: "sans",       label: "Inter — modern sans" },
  { id: "grotesk",    label: "Space Grotesk — geometric" },
  { id: "swiss",      label: "Inter Tight — Swiss grid" },
  { id: "condensed",  label: "Archivo — condensed poster" },
  { id: "serif",      label: "Fraunces — editorial serif" },
  { id: "slab",       label: "Playfair Display — classic" },
  { id: "broadsheet", label: "Newsreader — broadsheet" },
  { id: "mono",       label: "JetBrains Mono — code" },
  { id: "system",     label: "System UI — raw, unstyled" },
];

const PF_THEME_WIDTH = [
  { id: "narrow", label: "Narrow", px: 820 },
  { id: "normal", label: "Normal", px: 1080 },
  { id: "wide",   label: "Wide",   px: 1280 },
];

const PF_THEME_MOTION = [
  { id: "none",   label: "Still",  s: 0 },
  { id: "subtle", label: "Subtle", s: 1 },
  { id: "lively", label: "Lively", s: 1.7 },
];

// ---------------------------------------------------------------------------
// The blocks
// ---------------------------------------------------------------------------
// `needs` names the portfolio section a block draws. The renderer skips a block
// whose content is empty rather than emitting a heading with nothing under it —
// the same rule the hand-written templates follow via c.has().
const PF_BLOCKS = [
  { type: "nav", label: "Navigation", icon: "☰", once: true, needs: null,
    hint: "Sticky links to the sections below.",
    variants: [{ id: "bar", label: "Bar" }, { id: "pill", label: "Floating pill" }, { id: "minimal", label: "Minimal" }] },

  { type: "hero", label: "Hero", icon: "⭐", once: true, needs: null,
    hint: "Your name, title and the first thing anyone reads.",
    variants: [{ id: "center", label: "Centred" }, { id: "split", label: "Split" },
               { id: "banner", label: "Wide banner" }, { id: "stack", label: "Left stack" }] },

  { type: "stats", label: "Highlights", icon: "📊", needs: "stats",
    hint: "The numbers from your Content tab.",
    variants: [{ id: "cards", label: "Cards" }, { id: "inline", label: "Inline row" }, { id: "big", label: "Oversized" }] },

  { type: "about", label: "About", icon: "👤", needs: "about",
    hint: "Your written introduction.",
    variants: [{ id: "prose", label: "Single column" }, { id: "split", label: "Heading beside text" },
               { id: "lead", label: "Large lead" }] },

  { type: "skills", label: "Skills", icon: "🧩", needs: "skills",
    hint: "Chips, or grouped if you used 'Category:' prefixes.",
    variants: [{ id: "chips", label: "Chips" }, { id: "grouped", label: "Grouped" },
               { id: "columns", label: "Columns" }, { id: "marquee", label: "Marquee" }] },

  { type: "projects", label: "Projects", icon: "🚀", needs: "projects",
    hint: "Your selected work.",
    variants: [{ id: "grid", label: "Grid" }, { id: "list", label: "List" },
               { id: "feature", label: "Alternating feature" }, { id: "rail", label: "Scroll rail" }] },

  { type: "experience", label: "Experience", icon: "💼", needs: "experience",
    hint: "Where you have worked.",
    variants: [{ id: "timeline", label: "Timeline" }, { id: "rows", label: "Rows" }, { id: "cards", label: "Cards" }] },

  { type: "education", label: "Education", icon: "🎓", needs: "education",
    hint: "Degrees and study.",
    variants: [{ id: "cards", label: "Cards" }, { id: "rows", label: "Rows" }] },

  { type: "certifications", label: "Certifications", icon: "🏅", needs: "certifications",
    hint: "Credentials, as chips or a list.",
    variants: [{ id: "chips", label: "Chips" }, { id: "list", label: "List" }] },

  { type: "band", label: "Divider band", icon: "〰️", needs: null,
    hint: "A decorative strip. Pure decoration — no content of yours.",
    variants: [{ id: "rule", label: "Rule" }, { id: "marquee", label: "Scrolling text" },
               { id: "shapes", label: "Shape row" }, { id: "space", label: "Empty space" }] },

  { type: "quote", label: "Pull quote", icon: "❝", needs: null,
    hint: "Your one-line pitch, set large.",
    variants: [{ id: "plain", label: "Plain" }, { id: "marks", label: "With quote marks" }, { id: "boxed", label: "Boxed" }] },

  { type: "contact", label: "Contact", icon: "✉️", needs: "contact",
    hint: "Email, links and your résumé button.",
    variants: [{ id: "panel", label: "Panel" }, { id: "split", label: "Split" }, { id: "big", label: "Oversized" }] },

  // ---- The blocks the art directions are built on -----------------------
  // Each of these presents content the portfolio already has in a form none
  // of the blocks above can produce — not another variant of a card grid.
  // They are what makes a design assembled here look unlike the built-in
  // templates rather than like a rearrangement of them.

  { type: "poster", label: "Poster name", icon: "🅰️", needs: null,
    hint: "Your name at poster scale, everything else small around it.",
    variants: [{ id: "stack", label: "Stacked words" }, { id: "fill", label: "Edge to edge" },
               { id: "split", label: "Name over rule" }, { id: "outline", label: "Outlined type" }] },

  { type: "index", label: "Index", icon: "🔢", needs: null,
    hint: "A numbered contents list of the sections on your page.",
    variants: [{ id: "rows", label: "Numbered rows" }, { id: "columns", label: "Two columns" },
               { id: "inline", label: "Running line" }] },

  { type: "spotlight", label: "Spotlight project", icon: "🔦", needs: "projects",
    hint: "Your first project, given a whole screen.",
    variants: [{ id: "editorial", label: "Editorial" }, { id: "poster", label: "Poster" },
               { id: "figure", label: "Numbered figure" }] },

  { type: "ledger", label: "Ledger", icon: "📒", needs: "experience",
    hint: "Your history as ruled table rows — dates in one column, roles in another.",
    variants: [{ id: "table", label: "Ruled table" }, { id: "receipt", label: "Receipt" },
               { id: "dotted", label: "Dot leaders" }] },

  { type: "wall", label: "Gallery wall", icon: "🖼️", needs: "projects",
    hint: "Projects hung like works in a gallery, each with a small label.",
    variants: [{ id: "salon", label: "Salon hang" }, { id: "grid", label: "Even grid" },
               { id: "strip", label: "Single strip" }] },

  { type: "note", label: "Letter", icon: "✍️", needs: "about",
    hint: "Your introduction set as a signed note rather than a paragraph.",
    variants: [{ id: "letter", label: "Letter" }, { id: "memo", label: "Memo" },
               { id: "card", label: "Postcard" }] },

  { type: "now", label: "Currently", icon: "📍", needs: null,
    hint: "Where you are, what you're open to, what you do — as a status panel.",
    variants: [{ id: "list", label: "Labelled list" }, { id: "row", label: "Single row" },
               { id: "board", label: "Split board" }] },

  { type: "cta", label: "Call to action", icon: "📣", needs: null,
    hint: "A full-width band with one thing to do.",
    variants: [{ id: "band", label: "Band" }, { id: "huge", label: "Oversized" },
               { id: "ticket", label: "Boxed" }] },

  { type: "footer", label: "Footer", icon: "▁", once: true, needs: null,
    hint: "Copyright line at the very bottom.",
    variants: [{ id: "simple", label: "Simple" }, { id: "centered", label: "Centred" }] },
];

const PF_BLOCK_BY_TYPE = Object.fromEntries(PF_BLOCKS.map(b => [b.type, b]));

// ---------------------------------------------------------------------------
// Design documents
// ---------------------------------------------------------------------------

let _pfBlockSeq = 0;
function pfBlockId() { return "b" + (Date.now().toString(36)) + (_pfBlockSeq++).toString(36); }

function pfNewBlock(type, over) {
  const def = PF_BLOCK_BY_TYPE[type];
  return Object.assign({
    id: pfBlockId(),
    type,
    variant: def && def.variants.length ? def.variants[0].id : "default",
    bg: "none", gfx: "none", anim: "rise", pad: "md",
    title: "",            // "" means use the block's own default heading
    hidden: false,        // kept in the design, skipped by the renderer
  }, over || {});
}

// The starting point when somebody presses "Design your own". A blank canvas
// is a worse first experience than something that already looks like a site:
// this is a complete, presentable portfolio you can immediately take apart.
function pfBlankDesign(name) {
  return {
    v: 1,
    name: name || "My design",
    theme: {
      tone: "light", accent: "#6D5AE6", accent2: "",
      font: "sans", width: "normal", radius: 16, motion: "subtle", texture: "none",
    },
    blocks: [
      pfNewBlock("nav",        { variant: "pill",   bg: "glass" }),
      pfNewBlock("hero",       { variant: "split",  bg: "tint",     gfx: "blobs", anim: "rise", pad: "xl" }),
      pfNewBlock("stats",      { variant: "cards",  bg: "none",     gfx: "none",  anim: "stagger" }),
      pfNewBlock("about",      { variant: "split",  bg: "none",     gfx: "none",  anim: "fade" }),
      pfNewBlock("skills",     { variant: "grouped",bg: "surface",  gfx: "dots",  anim: "stagger", pad: "lg" }),
      pfNewBlock("projects",   { variant: "grid",   bg: "none",     gfx: "none",  anim: "stagger", pad: "lg" }),
      pfNewBlock("experience", { variant: "timeline", bg: "surface",gfx: "grid",  anim: "slide",   pad: "lg" }),
      pfNewBlock("education",  { variant: "cards",  bg: "none",     gfx: "none",  anim: "rise" }),
      pfNewBlock("certifications", { variant: "chips", bg: "none",  gfx: "none",  anim: "fade" }),
      pfNewBlock("contact",    { variant: "panel",  bg: "gradient", gfx: "glow",  anim: "zoom",    pad: "xl" }),
      pfNewBlock("footer",     { variant: "simple", bg: "none",     gfx: "none",  anim: "none", pad: "sm" }),
    ],
  };
}

// ---------------------------------------------------------------------------
// Starting points
// ---------------------------------------------------------------------------
// Ten complete designs, offered in the designer's Presets tab.
//
// They are not templates. A template is markup somebody wrote and you choose
// between; each of these is an ordinary design document — the same theme and
// list of blocks the designer produces — so applying one gives you something
// you can immediately take apart, reorder and recolour. Nothing here can do
// anything you could not have assembled by hand; they exist because assembling
// a coherent art direction from an empty canvas is a lot to ask of somebody
// who came here to write a portfolio.
//
// The territory is chosen against the built-in templates rather than in a
// vacuum. Aurora already owns glassmorphic dark, Terminal the shell, Neon Grid
// the cyberpunk grid, Editorial the magazine, Sidebar the profile rail. So
// these go where none of them do: newsprint, poster, gallery wall, raw
// unstyled HTML, Swiss contents page, a printed dossier, a cut-paper zine, a
// two-colour risograph, a written letter, a financial statement.
const PF_PRESETS = [
  {
    id: "broadsheet",
    name: "Broadsheet",
    blurb: "A newspaper front page. Ruled columns, a serif built for print, and your history set as a table.",
    best: "Writers, researchers, editors, analysts",
    theme: { tone: "light", accent: "#8C2F1F", accent2: "#1A1A1A", font: "broadsheet",
             width: "wide", radius: 0, motion: "subtle", texture: "none" },
    blocks: [
      ["index",     "inline",   { bg: "outline", pad: "sm",  anim: "fade" }],
      ["poster",    "split",    { bg: "none",    pad: "lg",  anim: "mask" }],
      ["note",      "memo",     { bg: "none",    pad: "lg",  anim: "fade" }],
      ["ledger",    "table",    { bg: "none",    pad: "lg",  anim: "stagger" }],
      ["skills",    "columns",  { bg: "none",    pad: "md",  anim: "fade" }],
      ["projects",  "list",     { bg: "none",    pad: "lg",  anim: "stagger" }],
      ["education", "rows",     { bg: "none",    pad: "md",  anim: "fade" }],
      ["contact",   "split",    { bg: "outline", pad: "lg",  anim: "fade" }],
      ["footer",    "simple",   { bg: "none",    pad: "sm",  anim: "none" }],
    ],
  },
  {
    id: "poster",
    name: "Poster",
    blurb: "Your name at the size of a gig poster, on flat fields of colour. Condensed type, nothing decorative.",
    best: "Designers, directors, anyone with a short name",
    theme: { tone: "light", accent: "#FF3B00", accent2: "#101010", font: "condensed",
             width: "wide", radius: 0, motion: "lively", texture: "none" },
    blocks: [
      ["poster",    "fill",     { bg: "solid",   pad: "xl",  anim: "curtain" }],
      ["now",       "row",      { bg: "none",    pad: "md",  anim: "rise" }],
      ["spotlight", "poster",   { bg: "none",    pad: "xl",  anim: "mask" }],
      ["projects",  "rail",     { bg: "surface", pad: "lg",  anim: "cascade" }],
      ["skills",    "marquee",  { bg: "solid",   pad: "md",  anim: "fade" }],
      ["experience","rows",     { bg: "none",    pad: "lg",  anim: "stagger" }],
      ["cta",       "huge",     { bg: "duotone", pad: "xl",  anim: "zoom" }],
      ["footer",    "centered", { bg: "none",    pad: "sm",  anim: "none" }],
    ],
  },
  {
    id: "salon",
    name: "Salon",
    blurb: "Work hung on a gallery wall, each piece with a small printed label. Warm paper, quiet type.",
    best: "Artists, photographers, architects, makers",
    theme: { tone: "light", accent: "#6B5B4B", accent2: "#A08B72", font: "serif",
             width: "wide", radius: 2, motion: "subtle", texture: "none" },
    blocks: [
      ["nav",       "minimal",  { bg: "paper",   pad: "sm",  anim: "none" }],
      ["hero",      "stack",    { bg: "paper",   pad: "lg",  anim: "fade" }],
      ["wall",      "salon",    { bg: "none",    pad: "xl",  anim: "stagger" }],
      ["note",      "letter",   { bg: "paper",   pad: "lg",  anim: "fade" }],
      ["ledger",    "dotted",   { bg: "paper",   pad: "lg",  anim: "fade" }],
      ["certifications", "list",{ bg: "none",    pad: "md",  anim: "fade" }],
      ["contact",   "split",    { bg: "paper",   pad: "lg",  anim: "fade" }],
      ["footer",    "centered", { bg: "none",    pad: "sm",  anim: "none" }],
    ],
  },
  {
    id: "brutalist",
    name: "Brutalist",
    blurb: "Raw and unstyled on purpose. System type, square corners, visible rules, default-blue links.",
    best: "Engineers and anyone who wants the content to be the design",
    theme: { tone: "light", accent: "#0000EE", accent2: "#D00000", font: "system",
             width: "wide", radius: 0, motion: "none", texture: "none" },
    blocks: [
      ["index",     "rows",     { bg: "outline", pad: "md",  anim: "none" }],
      ["poster",    "stack",    { bg: "none",    pad: "lg",  anim: "none" }],
      ["about",     "prose",    { bg: "outline", pad: "md",  anim: "none" }],
      ["skills",    "columns",  { bg: "none",    pad: "md",  anim: "none" }],
      ["ledger",    "table",    { bg: "none",    pad: "md",  anim: "none" }],
      ["projects",  "list",     { bg: "outline", pad: "md",  anim: "none" }],
      ["education", "rows",     { bg: "none",    pad: "md",  anim: "none" }],
      ["contact",   "big",      { bg: "none",    pad: "lg",  anim: "none" }],
      ["footer",    "simple",   { bg: "none",    pad: "sm",  anim: "none" }],
    ],
  },
  {
    id: "swiss",
    name: "Swiss Index",
    blurb: "A contents page as the front door. Hairline rules, tabular numbers, one accent used sparingly.",
    best: "Product designers, consultants, researchers",
    theme: { tone: "light", accent: "#E8452C", accent2: "#1B1B1B", font: "swiss",
             width: "normal", radius: 0, motion: "subtle", texture: "none" },
    blocks: [
      ["poster",    "split",    { bg: "none",    pad: "lg",  anim: "mask" }],
      ["index",     "rows",     { bg: "none",    pad: "lg",  anim: "stagger" }],
      ["about",     "split",    { bg: "none",    pad: "lg",  anim: "fade" }],
      ["skills",    "grouped",  { bg: "surface", pad: "lg",  anim: "stagger" }],
      ["projects",  "grid",     { bg: "none",    pad: "lg",  anim: "cascade" }],
      ["experience","rows",     { bg: "none",    pad: "lg",  anim: "stagger" }],
      ["education", "rows",     { bg: "surface", pad: "md",  anim: "fade" }],
      ["contact",   "panel",    { bg: "none",    pad: "lg",  anim: "rise" }],
      ["footer",    "simple",   { bg: "none",    pad: "sm",  anim: "none" }],
    ],
  },
  {
    id: "dossier",
    name: "Dossier",
    blurb: "A printed file rather than a screen. Monospaced, dark, your history on a perforated receipt.",
    best: "Security, infrastructure, data and research engineers",
    theme: { tone: "dark", accent: "#4ADE80", accent2: "#22D3EE", font: "mono",
             width: "normal", radius: 2, motion: "subtle", texture: "scanlines" },
    blocks: [
      ["nav",       "minimal",  { bg: "deep",    pad: "sm",  anim: "none" }],
      ["poster",    "split",    { bg: "deep",    pad: "lg",  anim: "curtain", gfx: "scanlines" }],
      ["now",       "list",     { bg: "none",    pad: "lg",  anim: "stagger" }],
      ["about",     "prose",    { bg: "none",    pad: "lg",  anim: "fade" }],
      ["ledger",    "receipt",  { bg: "surface", pad: "lg",  anim: "rise" }],
      ["skills",    "grouped",  { bg: "none",    pad: "lg",  anim: "stagger" }],
      ["projects",  "list",     { bg: "none",    pad: "lg",  anim: "stagger" }],
      ["certifications", "list",{ bg: "surface", pad: "md",  anim: "fade" }],
      ["contact",   "panel",    { bg: "deep",    pad: "lg",  anim: "rise" }],
      ["footer",    "simple",   { bg: "none",    pad: "sm",  anim: "none" }],
    ],
  },
  {
    id: "zine",
    name: "Zine",
    blurb: "Cut-paper collage. Things sit slightly crooked, colours are loud, and nothing is subtle.",
    best: "Illustrators, game devs, students, creative coders",
    theme: { tone: "light", accent: "#FF2D8B", accent2: "#FFD400", font: "grotesk",
             width: "normal", radius: 18, motion: "lively", texture: "none" },
    blocks: [
      ["poster",    "stack",    { bg: "solid",   gfx: "confetti", pad: "xl", anim: "pop" }],
      ["stats",     "big",      { bg: "none",    gfx: "crosshatch", pad: "lg", anim: "cascade" }],
      ["skills",    "chips",    { bg: "tint",    gfx: "stripes", pad: "lg", anim: "swing" }],
      ["wall",      "grid",     { bg: "none",    pad: "lg",  anim: "skew" }],
      ["projects",  "feature",  { bg: "surface", gfx: "halftone", pad: "lg", anim: "cascade" }],
      ["quote",     "marks",    { bg: "solid",   pad: "lg",  anim: "zoom" }],
      ["experience","cards",    { bg: "none",    pad: "lg",  anim: "stagger" }],
      ["cta",       "ticket",   { bg: "none",    pad: "lg",  anim: "pop" }],
      ["footer",    "centered", { bg: "none",    pad: "sm",  anim: "none" }],
    ],
  },
  {
    id: "riso",
    name: "Duotone",
    blurb: "Two inks and nothing else, the way a risograph prints. Outlined type on a hard colour split.",
    best: "Brand and motion designers, art directors",
    theme: { tone: "dark", accent: "#3B1CFF", accent2: "#FF5FA2", font: "condensed",
             width: "wide", radius: 0, motion: "lively", texture: "none" },
    blocks: [
      ["poster",    "outline",  { bg: "duotone", pad: "xl",  anim: "curtain" }],
      ["index",     "columns",  { bg: "none",    pad: "lg",  anim: "stagger" }],
      ["spotlight", "poster",   { bg: "deep",    gfx: "halftone", pad: "xl", anim: "mask" }],
      ["projects",  "grid",     { bg: "none",    pad: "lg",  anim: "cascade" }],
      ["skills",    "marquee",  { bg: "solid",   pad: "md",  anim: "fade" }],
      ["experience","timeline", { bg: "none",    pad: "lg",  anim: "slide" }],
      ["cta",       "huge",     { bg: "duotone", pad: "xl",  anim: "zoom" }],
      ["footer",    "centered", { bg: "none",    pad: "sm",  anim: "none" }],
    ],
  },
  {
    id: "letter",
    name: "Correspondence",
    blurb: "A written note, signed, on good paper. One narrow column and no cards anywhere.",
    best: "Writers, coaches, consultants, freelancers",
    theme: { tone: "light", accent: "#2F5D50", accent2: "#B08968", font: "serif",
             width: "narrow", radius: 10, motion: "subtle", texture: "none" },
    blocks: [
      ["hero",      "stack",    { bg: "none",    pad: "lg",  anim: "drift" }],
      ["note",      "letter",   { bg: "paper",   pad: "xl",  anim: "fade" }],
      ["now",       "list",     { bg: "none",    pad: "lg",  anim: "stagger" }],
      ["ledger",    "dotted",   { bg: "none",    pad: "lg",  anim: "fade" }],
      ["projects",  "list",     { bg: "paper",   pad: "lg",  anim: "stagger" }],
      ["certifications", "chips",{ bg: "none",   pad: "md",  anim: "fade" }],
      ["contact",   "split",    { bg: "none",    pad: "lg",  anim: "rise" }],
      ["footer",    "centered", { bg: "none",    pad: "sm",  anim: "none" }],
    ],
  },
  {
    id: "statement",
    name: "Statement",
    blurb: "Set like a financial statement. Dot leaders, tabular figures, deep navy and a single gold rule.",
    best: "Finance, strategy, operations, senior ICs",
    theme: { tone: "light", accent: "#14213D", accent2: "#C89B3C", font: "swiss",
             width: "normal", radius: 0, motion: "subtle", texture: "none" },
    blocks: [
      ["nav",       "bar",      { bg: "none",    pad: "sm",  anim: "none" }],
      ["poster",    "split",    { bg: "none",    pad: "xl",  anim: "mask" }],
      ["now",       "board",    { bg: "surface", pad: "lg",  anim: "stagger" }],
      ["ledger",    "dotted",   { bg: "none",    pad: "lg",  anim: "fade" }],
      ["stats",     "inline",   { bg: "solid",   pad: "lg",  anim: "rise" }],
      ["projects",  "list",     { bg: "none",    pad: "lg",  anim: "stagger" }],
      ["skills",    "columns",  { bg: "surface", pad: "lg",  anim: "fade" }],
      ["education", "rows",     { bg: "none",    pad: "md",  anim: "fade" }],
      ["cta",       "band",     { bg: "solid",   pad: "lg",  anim: "rise" }],
      ["footer",    "simple",   { bg: "none",    pad: "sm",  anim: "none" }],
    ],
  },
];

// A preset's blocks are written as terse triples above — [type, variant,
// options] — because a preset is read far more often than it is written, and
// ten full block objects each would be a page of punctuation to scan past.
// This expands one into the real design document.
function pfPresetDesign(id) {
  const p = PF_PRESETS.find(x => x.id === id);
  if (!p) return null;
  return pfNormalizeDesign({
    v: 1,
    name: p.name,
    theme: p.theme,
    blocks: p.blocks.map(([type, variant, over]) =>
      pfNewBlock(type, Object.assign({ variant }, over || {}))),
  });
}

// Anything that reaches the renderer has been through here, so a design saved
// by an older build — or hand-edited, or half-written by a failed save — still
// produces a page instead of an exception.
function pfNormalizeDesign(raw) {
  const src = (raw && typeof raw === "object") ? raw : {};
  const t = (src.theme && typeof src.theme === "object") ? src.theme : {};
  const pick = (list, v, dflt) => list.some(x => x.id === v) ? v : dflt;
  const theme = {
    tone:    t.tone === "dark" ? "dark" : "light",
    accent:  /^#[0-9a-f]{6}$/i.test(String(t.accent || "")) ? t.accent : "#6D5AE6",
    accent2: /^#[0-9a-f]{6}$/i.test(String(t.accent2 || "")) ? t.accent2 : "",
    font:    pick(PF_THEME_FONTS, t.font, "sans"),
    width:   pick(PF_THEME_WIDTH, t.width, "normal"),
    radius:  Math.max(0, Math.min(36, Number(t.radius) >= 0 ? Number(t.radius) : 16)),
    motion:  pick(PF_THEME_MOTION, t.motion, "subtle"),
    texture: pick(PF_BLK_GFX, t.texture, "none"),
  };
  const seen = {};
  const blocks = (Array.isArray(src.blocks) ? src.blocks : [])
    .filter(b => b && PF_BLOCK_BY_TYPE[b.type])
    .filter(b => {
      // nav, hero and footer are structural: a second one is always a mistake,
      // and two <nav>s would also be two sticky bars fighting for the top.
      if (!PF_BLOCK_BY_TYPE[b.type].once) return true;
      if (seen[b.type]) return false;
      seen[b.type] = 1; return true;
    })
    .map(b => {
      const def = PF_BLOCK_BY_TYPE[b.type];
      return {
        id: String(b.id || pfBlockId()),
        type: b.type,
        variant: def.variants.some(v => v.id === b.variant) ? b.variant : def.variants[0].id,
        bg:   pick(PF_BLK_BG,   b.bg,   "none"),
        gfx:  pick(PF_BLK_GFX,  b.gfx,  "none"),
        anim: pick(PF_BLK_ANIM, b.anim, "rise"),
        pad:  pick(PF_BLK_PAD,  b.pad,  "md"),
        title: typeof b.title === "string" ? b.title.slice(0, 80) : "",
        // Hiding is not deleting. The block keeps its variant, colours and
        // heading so switching it back on restores what was there rather
        // than a default one the customer has to set up again.
        hidden: !!b.hidden,
      };
    });
  return { v: 1, name: String(src.name || "My design").slice(0, 80), theme, blocks };
}

// ---------------------------------------------------------------------------
// Theme -> CSS custom properties
// ---------------------------------------------------------------------------
function pfDesignTheme(theme) {
  const dark = theme.tone === "dark";
  const acc  = theme.accent;
  const acc2 = theme.accent2 || pfHueShift(acc, 42);
  const width = (PF_THEME_WIDTH.find(w => w.id === theme.width) || PF_THEME_WIDTH[1]).px;
  const mo    = (PF_THEME_MOTION.find(m => m.id === theme.motion) || PF_THEME_MOTION[1]).s;
  return {
    dark, acc, acc2, width, mo,
    ink:     dark ? "#EEF1F6" : "#14181F",
    mute:    dark ? "#A2AAB8" : "#5A6473",
    faint:   dark ? "#6C7686" : "#98A1AF",
    bg:      dark ? "#0C1017" : "#FFFFFF",
    surface: dark ? "#141A24" : "#F6F8FB",
    card:    dark ? "#161D28" : "#FFFFFF",
    line:    dark ? "#242D3B" : "#E6EAF1",
    onAcc:   pfInkOn(acc),
    radius:  theme.radius,
  };
}

// ---------------------------------------------------------------------------
// The shared stylesheet
// ---------------------------------------------------------------------------
// One sheet for every design. The per-design differences all arrive as custom
// properties, and the per-block differences as classes, which is what keeps a
// twelve-block page from emitting twelve near-identical copies of the same
// rules.
function pfDesignCSS(c, design) {
  const T = pfDesignTheme(design.theme);
  const R = T.radius;
  const stack = c.fontStack || `'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif`;

  return `
:root{
  --acc:${T.acc}; --acc2:${T.acc2}; --on-acc:${T.onAcc};
  --ink:${T.ink}; --mute:${T.mute}; --faint:${T.faint};
  --bg:${T.bg}; --surface:${T.surface}; --card:${T.card}; --line:${T.line};
  --r:${R}px; --r-sm:${Math.max(4, Math.round(R * 0.55))}px; --r-lg:${Math.round(R * 1.5)}px;
  --w:${T.width}px;
  --font:${stack};
}
body{background:var(--bg);color:var(--ink);font-family:var(--font);font-size:16px;line-height:1.7;overflow-x:hidden}
.pf-skip{background:var(--acc);color:var(--on-acc)}
.shell{width:min(var(--w),92vw);margin:0 auto;position:relative;z-index:1}

/* ---- the page texture, behind everything ---- */
.page-tex{position:fixed;inset:0;z-index:0;pointer-events:none}

/* ---- block frame ------------------------------------------------------
   Every block is a <section> with the same skeleton: a background, an optional
   decorative layer that cannot be clicked, and the content above both. */
.blk{position:relative;isolation:isolate}
.blk-gfx{position:absolute;inset:0;z-index:0;pointer-events:none;overflow:hidden}
.blk > .shell{position:relative;z-index:1}
.pad-none{padding:0}
.pad-sm{padding:clamp(1rem,2.4vw,1.6rem) 0}
.pad-md{padding:clamp(1.8rem,4.4vw,2.8rem) 0}
.pad-lg{padding:clamp(2.6rem,6.4vw,4.2rem) 0}
.pad-xl{padding:clamp(3.4rem,8.4vw,5.6rem) 0}

.bg-tint{background:${pfRgba(T.acc, T.dark ? .14 : .07)}}
.bg-surface{background:var(--surface)}
.bg-gradient{background:linear-gradient(135deg,var(--acc),var(--acc2))}
.bg-deep{background:${T.dark ? "#070A0F" : "#101720"}}
.bg-glass{background:${pfRgba(T.dark ? "#141A24" : "#FFFFFF", .68)};
  backdrop-filter:blur(16px) saturate(1.4);-webkit-backdrop-filter:blur(16px) saturate(1.4);
  border-top:1px solid ${pfRgba(T.dark ? "#FFFFFF" : "#0C1017", .08)};
  border-bottom:1px solid ${pfRgba(T.dark ? "#FFFFFF" : "#0C1017", .08)}}

/* A warm off-white stock with a faint fibre, for the paper directions. It is
   a colour, not an image: an uploaded texture would be the one asset the
   downloaded file could not carry with it. */
.bg-paper{background-color:${T.dark ? "#15140F" : "#F7F3E8"};
  background-image:radial-gradient(${pfRgba(T.dark ? "#FFFFFF" : "#000000", .035)} .6px,transparent .6px),
    radial-gradient(${pfRgba(T.dark ? "#FFFFFF" : "#000000", .025)} .6px,transparent .6px);
  background-size:7px 7px,11px 11px;background-position:0 0,3px 4px}
/* The accent as a full field. The invert flag on this one is what flips the
   text inside it, so nothing has to be recoloured block by block. */
.bg-solid{background:var(--acc)}
.bg-solid.invert{--ink:${T.onAcc};--mute:${pfRgba(T.onAcc, .8)};--faint:${pfRgba(T.onAcc, .62)};
  --line:${pfRgba(T.onAcc, .28)};color:${T.onAcc}}
.bg-solid.invert .btn-primary{background:${T.onAcc};color:var(--acc)}
.bg-duotone{background:linear-gradient(160deg,var(--acc) 0 48%,var(--acc2) 48% 100%)}
/* Outlined draws the block's own edge instead of filling it — the structural
   move the brutalist and index directions are built on. */
.bg-outline{background:transparent;border-top:2px solid var(--ink);border-bottom:2px solid var(--ink)}

/* A block on a gradient or a deep panel carries light text, so every colour
   inside it flips together. Doing this with one class rather than per-element
   overrides is what stops a stray muted paragraph going invisible. */
.invert{--ink:#FFFFFF;--mute:${pfRgba("#FFFFFF", .82)};--faint:${pfRgba("#FFFFFF", .6)};
  --line:${pfRgba("#FFFFFF", .22)};--card:${pfRgba("#FFFFFF", .12)};--surface:${pfRgba("#FFFFFF", .1)};
  color:#FFFFFF}
.invert .chip,.invert .tag{background:${pfRgba("#FFFFFF", .16)};color:#fff;border-color:transparent}
.invert .btn-primary{background:#fff;color:${T.acc};box-shadow:none}
.invert .btn-ghost{background:transparent;border-color:${pfRgba("#FFFFFF", .45)};color:#fff}
.invert .btn-ghost:hover{background:${pfRgba("#FFFFFF", .14)}}
.invert .card{background:${pfRgba("#FFFFFF", .12)};border-color:${pfRgba("#FFFFFF", .2)}}
.invert .kicker{color:${pfRgba("#FFFFFF", .85)}}
.invert .socials a{background:${pfRgba("#FFFFFF", .14)};border-color:transparent;color:#fff}

/* ---- decorative layers. Every one is a gradient on a masked box: no images,
   no requests, and nothing that can fail to load on somebody else's host. ---- */
.gfx-blobs::before,.gfx-blobs::after{content:"";position:absolute;border-radius:50%;filter:blur(58px);opacity:.5}
.gfx-blobs::before{width:46%;padding-bottom:46%;left:-8%;top:-24%;background:${pfRgba(T.acc, .75)}}
.gfx-blobs::after{width:38%;padding-bottom:38%;right:-6%;bottom:-26%;background:${pfRgba(T.acc2, .6)}}
.gfx-grid{background-image:linear-gradient(${pfRgba(T.acc, .16)} 1px,transparent 1px),
  linear-gradient(90deg,${pfRgba(T.acc, .16)} 1px,transparent 1px);background-size:44px 44px;
  -webkit-mask-image:radial-gradient(80% 70% at 50% 40%,#000,transparent 78%);
          mask-image:radial-gradient(80% 70% at 50% 40%,#000,transparent 78%)}
.gfx-dots{background-image:radial-gradient(${pfRgba(T.acc, .3)} 1.4px,transparent 1.4px);background-size:22px 22px;
  -webkit-mask-image:radial-gradient(78% 68% at 50% 45%,#000,transparent 80%);
          mask-image:radial-gradient(78% 68% at 50% 45%,#000,transparent 80%)}
.gfx-rings{background-image:repeating-radial-gradient(circle at 82% 22%,
  ${pfRgba(T.acc, .2)} 0 1.5px,transparent 1.5px 26px)}
.gfx-waves::before,.gfx-waves::after{content:"";position:absolute;left:-10%;right:-10%;height:64%;
  border-radius:50%;border:1.5px solid ${pfRgba(T.acc, .22)}}
.gfx-waves::before{top:14%}
.gfx-waves::after{top:42%;border-color:${pfRgba(T.acc2, .22)}}
.gfx-beams{background-image:repeating-linear-gradient(112deg,${pfRgba(T.acc, .1)} 0 2px,transparent 2px 34px);
  -webkit-mask-image:linear-gradient(180deg,#000,transparent);mask-image:linear-gradient(180deg,#000,transparent)}
.gfx-glow{background:radial-gradient(52% 60% at 88% 10%,${pfRgba(T.acc2, .5)},transparent 68%),
  radial-gradient(48% 56% at 6% 92%,${pfRgba(T.acc, .42)},transparent 70%)}
.gfx-noise{background-image:radial-gradient(${pfRgba(T.acc, .22)} .5px,transparent .5px);background-size:3px 3px;opacity:.6}
.gfx-halftone{background-image:radial-gradient(${pfRgba(T.acc, .5)} 2.4px,transparent 2.6px);background-size:12px 12px;
  -webkit-mask-image:linear-gradient(140deg,#000,transparent 72%);mask-image:linear-gradient(140deg,#000,transparent 72%)}
.gfx-crosshatch{background-image:repeating-linear-gradient(45deg,${pfRgba(T.acc, .16)} 0 1px,transparent 1px 9px),
  repeating-linear-gradient(-45deg,${pfRgba(T.acc, .16)} 0 1px,transparent 1px 9px)}
.gfx-stripes{background-image:repeating-linear-gradient(-45deg,${pfRgba(T.acc, .13)} 0 14px,transparent 14px 28px)}
.gfx-scanlines{background-image:repeating-linear-gradient(180deg,${pfRgba(T.acc, .14)} 0 1px,transparent 1px 5px)}
.gfx-topo{background-image:repeating-radial-gradient(ellipse 62% 34% at 42% 58%,
  transparent 0 12px,${pfRgba(T.acc, .17)} 12px 13px)}
.gfx-confetti{background-image:
  radial-gradient(${pfRgba(T.acc, .5)} 2.5px,transparent 3px),
  radial-gradient(${pfRgba(T.acc2, .45)} 2px,transparent 2.5px),
  radial-gradient(${pfRgba(T.acc, .3)} 1.5px,transparent 2px);
  background-size:74px 74px,53px 53px,39px 39px;background-position:0 0,22px 31px,44px 12px}

/* ---- entrance animations -------------------------------------------------
   These only redefine the "before" state of the reveal every template shares,
   so .pf-in still clears them and the reduced-motion rule in the reset still
   switches all of it off in one place. */
[data-reveal]{transition-duration:${(0.62 * (T.mo || 1)).toFixed(2)}s}
.rv-none[data-reveal],.rv-none [data-reveal]{opacity:1;transform:none;filter:none}
/* "Rise" is what the shared reveal already does, so this rule restates the
   base state rather than changing it. It is here on purpose: without it the
   default animation is the only one in the inspector with no CSS of its own,
   which reads as an omission every time somebody greps for it — and would
   become one the moment the shared reveal changed underneath it. */
.rv-rise[data-reveal]{transform:translateY(18px)}
.rv-fall[data-reveal]{transform:translateY(-22px)}
.rv-fade[data-reveal]{transform:none}
.rv-slide[data-reveal]{transform:translateX(-26px)}
.rv-slideR[data-reveal]{transform:translateX(26px)}
.rv-zoom[data-reveal]{transform:scale(.93)}
.rv-shrink[data-reveal]{transform:scale(1.07)}
.rv-blur[data-reveal]{transform:none;filter:blur(11px)}
.rv-blur[data-reveal].pf-in{filter:blur(0)}
.rv-tilt[data-reveal]{transform:perspective(900px) rotateX(9deg) translateY(16px)}
.rv-flip[data-reveal]{transform:perspective(900px) rotateY(22deg)}
.rv-swing[data-reveal]{transform-origin:top center;transform:rotate(-3.5deg) translateY(-10px)}
.rv-skew[data-reveal]{transform:skewY(3.5deg) translateY(16px)}
.rv-pop[data-reveal]{transform:scale(.86)}
.rv-pop[data-reveal].pf-in{transition-timing-function:cubic-bezier(.2,1.5,.4,1)}
/* Drift is the same move, slower and further — the "expensive" one, for a
   single hero rather than every block on the page. */
.rv-drift[data-reveal]{transform:translateY(46px);transition-duration:${(1.15 * (T.mo || 1)).toFixed(2)}s}
/* The wipes reveal through a mask rather than moving the block, so text
   arrives from behind an edge instead of sliding under the one above it. */
.rv-mask[data-reveal]{transform:none;
  -webkit-mask-image:linear-gradient(180deg,#000 0,#000 100%);mask-image:linear-gradient(180deg,#000 0,#000 100%);
  -webkit-mask-size:100% 0%;mask-size:100% 0%;-webkit-mask-position:0 100%;mask-position:0 100%;
  -webkit-mask-repeat:no-repeat;mask-repeat:no-repeat;
  transition:opacity ${(0.7 * (T.mo || 1)).toFixed(2)}s ease,-webkit-mask-size ${(0.7 * (T.mo || 1)).toFixed(2)}s cubic-bezier(.2,.7,.2,1),mask-size ${(0.7 * (T.mo || 1)).toFixed(2)}s cubic-bezier(.2,.7,.2,1)}
.rv-mask[data-reveal].pf-in{-webkit-mask-size:100% 100%;mask-size:100% 100%}
.rv-curtain[data-reveal]{transform:none;
  -webkit-mask-image:linear-gradient(90deg,#000 0,#000 100%);mask-image:linear-gradient(90deg,#000 0,#000 100%);
  -webkit-mask-size:0% 100%;mask-size:0% 100%;-webkit-mask-repeat:no-repeat;mask-repeat:no-repeat;
  transition:opacity ${(0.7 * (T.mo || 1)).toFixed(2)}s ease,-webkit-mask-size ${(0.75 * (T.mo || 1)).toFixed(2)}s cubic-bezier(.2,.7,.2,1),mask-size ${(0.75 * (T.mo || 1)).toFixed(2)}s cubic-bezier(.2,.7,.2,1)}
.rv-curtain[data-reveal].pf-in{-webkit-mask-size:100% 100%;mask-size:100% 100%}
.rv-stagger [data-reveal]{opacity:0;transform:translateY(18px);
  transition:opacity ${(0.6 * (T.mo || 1)).toFixed(2)}s cubic-bezier(.2,.7,.2,1),transform ${(0.6 * (T.mo || 1)).toFixed(2)}s cubic-bezier(.2,.7,.2,1)}
.rv-stagger [data-reveal].pf-in{opacity:1;transform:none}
/* Cascade is stagger with sideways travel and a longer throw, so a grid of
   cards arrives as a diagonal rather than a wave. */
.rv-cascade [data-reveal]{opacity:0;transform:translate3d(-16px,26px,0) scale(.97);
  transition:opacity ${(0.66 * (T.mo || 1)).toFixed(2)}s cubic-bezier(.2,.7,.2,1),transform ${(0.66 * (T.mo || 1)).toFixed(2)}s cubic-bezier(.2,.7,.2,1)}
.rv-cascade [data-reveal].pf-in{opacity:1;transform:none}
${T.mo === 0 ? `[data-reveal]{opacity:1!important;transform:none!important;filter:none!important}` : ""}
`;
}

// The component styles every block draws from. Split out from the theme sheet
// above only for readability — they are concatenated into one <style>.
function pfDesignComponentCSS(c, design) {
  const T = pfDesignTheme(design.theme);
  return `
/* ---- type ---- */
.kicker{display:inline-flex;align-items:center;gap:.5rem;font-size:.73rem;font-weight:800;letter-spacing:.18em;
  text-transform:uppercase;color:var(--acc);margin-bottom:.55rem}
.kicker::before{content:"";width:22px;height:2px;border-radius:2px;background:currentColor;opacity:.7}
.h2{font-size:clamp(1.5rem,3.6vw,2.3rem);font-weight:800;letter-spacing:-.035em;line-height:1.12;margin-bottom:1.3rem}
.lead{color:var(--mute);font-size:1.05rem}
.sec-head{margin-bottom:1.4rem}

/* ---- surfaces ---- */
.card{background:var(--card);border:1px solid var(--line);border-radius:var(--r);
  transition:transform .28s,box-shadow .28s,border-color .28s}
.card-hover:hover{transform:translateY(-4px);border-color:${pfRgba(T.acc, .5)};
  box-shadow:0 18px 40px ${pfRgba(T.dark ? "#000000" : "#0C1017", T.dark ? .5 : .1)}}
.chip{display:inline-block;padding:.44rem 1rem;border-radius:999px;font-size:.85rem;font-weight:600;
  background:var(--surface);border:1px solid var(--line);color:var(--ink)}
.tag{display:inline-block;padding:.22rem .66rem;border-radius:var(--r-sm);font-size:.72rem;font-weight:700;
  color:var(--acc);background:${pfRgba(T.acc, .12)}}
.chips{display:flex;flex-wrap:wrap;gap:.5rem}

/* ---- buttons + socials ---- */
.acts{display:flex;flex-wrap:wrap;gap:.65rem;align-items:center;margin-top:1.6rem}
.btn{display:inline-flex;align-items:center;gap:.5rem;padding:.78rem 1.45rem;border-radius:var(--r-sm);
  font-weight:700;font-size:.9rem;text-decoration:none;border:1px solid transparent;transition:.24s;cursor:pointer}
.btn svg{width:16px;height:16px}
.btn-primary{background:linear-gradient(120deg,var(--acc),var(--acc2));color:var(--on-acc);
  box-shadow:0 10px 26px ${pfRgba(T.acc, .32)}}
.btn-primary:hover{transform:translateY(-3px);box-shadow:0 16px 34px ${pfRgba(T.acc, .42)}}
.btn-ghost{background:transparent;border-color:var(--line);color:var(--ink)}
.btn-ghost:hover{border-color:var(--acc);color:var(--acc);transform:translateY(-3px)}
.socials{display:flex;gap:.45rem}
.socials a{display:grid;place-items:center;width:40px;height:40px;border-radius:var(--r-sm);
  background:var(--card);border:1px solid var(--line);color:var(--mute);transition:.24s}
.socials a svg{width:16px;height:16px}
.socials a:hover{background:var(--acc);border-color:var(--acc);color:var(--on-acc);transform:translateY(-3px)}

/* ---- nav ---- */
.nav{position:sticky;top:0;z-index:30}
.nav-in{display:flex;align-items:center;gap:1rem;padding:.8rem 0}
.nav-pill .nav-in{padding:.5rem .6rem .5rem 1rem;border-radius:999px;margin-top:.7rem;
  border:1px solid var(--line);box-shadow:0 8px 26px ${pfRgba(T.dark ? "#000000" : "#0C1017", .07)}}
.nav-pill{padding-bottom:.7rem}
.brand{display:flex;align-items:center;gap:.6rem;font-weight:800;letter-spacing:-.02em;
  text-decoration:none;font-size:1rem;color:var(--ink)}
.brand i{width:30px;height:30px;display:grid;place-items:center;font-style:normal;font-size:.64rem;font-weight:800;
  color:var(--on-acc);border-radius:var(--r-sm);background:linear-gradient(135deg,var(--acc),var(--acc2))}
.nav-links{display:flex;gap:.15rem;margin-left:auto;flex-wrap:wrap}
.nav-links a{padding:.4rem .85rem;border-radius:var(--r-sm);font-size:.85rem;font-weight:600;
  color:var(--mute);text-decoration:none;transition:.2s}
.nav-links a:hover,.nav-links a.on{color:var(--acc);background:${pfRgba(T.acc, .12)}}
.nav-minimal .nav-links a{border-radius:0;padding:.4rem 0;margin-left:1.1rem;background:none}
.nav-minimal .nav-links a:hover,.nav-minimal .nav-links a.on{background:none;box-shadow:inset 0 -2px 0 var(--acc)}
/* The pill floats, so the strip beside it must fade into the page rather than
   letting content scroll past in full view above it. */
.nav-pill::before{content:"";position:absolute;inset:-1px 0 -18px;z-index:-1;pointer-events:none;
  background:linear-gradient(180deg,var(--bg) 54%,${pfRgba(T.bg, 0)})}

/* ---- hero ---- */
.hero-center{text-align:center}
.hero-center .acts{justify-content:center}
.hero-center .lead{margin-left:auto;margin-right:auto}
.hero-split{display:grid;grid-template-columns:minmax(0,1.25fr) minmax(0,.75fr);gap:clamp(1.4rem,4vw,3rem);align-items:center}
.hero-banner{text-align:center;padding-block:clamp(1rem,3vw,2rem)}
.name{font-size:clamp(2.2rem,6.6vw,4.4rem);font-weight:800;letter-spacing:-.045em;line-height:1.02}
.name-grad{background:linear-gradient(100deg,var(--ink) 8%,var(--acc) 56%,var(--acc2));
  -webkit-background-clip:text;background-clip:text;color:transparent}
.invert .name-grad{background:none;color:#fff;-webkit-text-fill-color:#fff}
.role{font-size:clamp(1rem,2.3vw,1.24rem);font-weight:600;color:var(--mute);margin:.85rem 0 .7rem}
.hero .lead{max-width:54ch}
.badge{display:inline-flex;align-items:center;gap:.5rem;padding:.34rem .95rem;border-radius:999px;
  background:${pfRgba(T.acc, .12)};color:var(--acc);font-size:.79rem;font-weight:700;margin-bottom:1.1rem}
.invert .badge{background:${pfRgba("#FFFFFF", .18)};color:#fff}
.badge i{width:8px;height:8px;border-radius:50%;background:currentColor}
.portrait{justify-self:center}
.portrait .pf-avatar{width:min(280px,60vw);aspect-ratio:1;object-fit:cover;border-radius:var(--r-lg);
  box-shadow:0 22px 56px ${pfRgba(T.dark ? "#000000" : "#0C1017", T.dark ? .55 : .16)}}
.pf-avatar-initials{display:grid;place-items:center;font-weight:800;font-size:clamp(2rem,6vw,3rem);
  color:var(--on-acc);background:linear-gradient(140deg,var(--acc),var(--acc2))}
.hero-banner .portrait{margin:0 auto 1.5rem}
.hero-banner .portrait .pf-avatar{width:min(150px,38vw);border-radius:50%}
@media (max-width:820px){.hero-split{grid-template-columns:1fr}.hero-split .portrait{order:-1}}

/* ---- stats ---- */
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:.9rem}
.stat{padding:1.3rem 1.1rem;text-align:center}
.stat b{display:block;font-size:clamp(1.7rem,4.4vw,2.5rem);font-weight:800;letter-spacing:-.04em;line-height:1;
  background:linear-gradient(140deg,var(--acc),var(--acc2));-webkit-background-clip:text;background-clip:text;color:transparent}
.invert .stat b{background:none;color:#fff;-webkit-text-fill-color:#fff}
.stat span{display:block;margin-top:.4rem;font-size:.79rem;font-weight:600;color:var(--mute)}
.stats-inline{display:flex;flex-wrap:wrap;gap:clamp(1.4rem,5vw,3.4rem);justify-content:center;text-align:center}
.stats-inline .stat{padding:0;background:none;border:none}
.stats-big .stat b{font-size:clamp(2.4rem,7vw,4rem)}
`;
}

// Part two: the content blocks. Kept in a second function purely so neither
// grows past the point where you can find a rule by scrolling.
function pfDesignBlockCSS(c, design) {
  const T = pfDesignTheme(design.theme);
  return `
/* ---- about ---- */
.about-split{display:grid;grid-template-columns:minmax(0,.42fr) minmax(0,1fr);gap:clamp(1.2rem,4vw,3rem);align-items:start}
@media (max-width:820px){.about-split{grid-template-columns:1fr}}
.prose{white-space:pre-wrap;color:var(--mute)}
.prose-lead{font-size:clamp(1.05rem,2.4vw,1.35rem);line-height:1.62;color:var(--ink)}
.about-card{padding:clamp(1.3rem,3.4vw,2rem)}

/* ---- skills ---- */
.skgroup{margin-bottom:1.1rem}
.skgroup:last-child{margin-bottom:0}
.skgroup h4{font-size:.78rem;font-weight:800;letter-spacing:.12em;text-transform:uppercase;
  color:var(--acc);margin-bottom:.5rem}
.skcols{columns:3 180px;column-gap:1.6rem}
.skcols span{display:block;padding:.34rem 0;border-bottom:1px solid var(--line);
  break-inside:avoid;font-size:.92rem;color:var(--mute)}
/* The marquee duplicates its run of chips so the loop has something to scroll
   into; aria-hidden on the copy keeps a screen reader from reading it twice. */
.marq{overflow:hidden;-webkit-mask-image:linear-gradient(90deg,transparent,#000 8%,#000 92%,transparent);
  mask-image:linear-gradient(90deg,transparent,#000 8%,#000 92%,transparent)}
.marq-run{display:flex;gap:.6rem;width:max-content;animation:marq ${(28 / (T.mo || 1)).toFixed(0)}s linear infinite}
.marq:hover .marq-run{animation-play-state:paused}
@keyframes marq{to{transform:translateX(-50%)}}

/* ---- projects ---- */
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(288px,1fr));gap:1.1rem}
.proj{padding:1.5rem 1.4rem;display:flex;flex-direction:column;gap:.55rem}
.proj h3{font-size:1.12rem;font-weight:800;letter-spacing:-.02em}
.proj .role{font-size:.78rem;font-weight:700;color:var(--acc);margin:0}
.proj p{color:var(--mute);font-size:.93rem}
.proj ul{display:grid;gap:.38rem;margin-top:.2rem}
.proj li,.row li{position:relative;padding-left:1.25rem;color:var(--mute);font-size:.89rem}
.proj li::before,.row li::before{content:"";position:absolute;left:.15rem;top:.6em;width:6px;height:6px;
  border-radius:50%;background:var(--acc)}
.tags{display:flex;flex-wrap:wrap;gap:.34rem;margin-top:auto;padding-top:.4rem}
.links{display:flex;gap:.85rem;flex-wrap:wrap;padding-top:.2rem}
.links a{display:inline-flex;align-items:center;gap:.32rem;font-size:.81rem;font-weight:700;
  color:var(--acc);text-decoration:none}
.links a svg{width:14px;height:14px}
.links a:hover{text-decoration:underline}
.proj-list{display:grid;gap:.8rem}
.proj-list .proj{flex-direction:row;flex-wrap:wrap;align-items:baseline;gap:.4rem 1rem}
.proj-list .proj h3{flex:0 0 auto}
.proj-list .proj p{flex:1 1 260px;margin:0}
.feature{display:grid;gap:1.4rem}
.feature .proj{display:grid;grid-template-columns:minmax(0,.9fr) minmax(0,1.1fr);gap:clamp(1rem,3vw,2.2rem);
  align-items:center;padding:clamp(1.3rem,3.4vw,2rem)}
.feature .proj:nth-child(even) .fig{order:2}
.fig{aspect-ratio:16/10;border-radius:var(--r);background:linear-gradient(135deg,var(--acc),var(--acc2));
  position:relative;overflow:hidden;display:grid;place-items:center;
  font-size:clamp(2rem,5vw,3.4rem);font-weight:800;color:${pfRgba("#FFFFFF", .42)}}
@media (max-width:760px){.feature .proj{grid-template-columns:1fr}.feature .proj:nth-child(even) .fig{order:0}}
/* A scroll rail beats a JS carousel here: snap points, real momentum on touch,
   keyboard scrolling for free, and nothing to go wrong when the JS does not run. */
.rail{display:grid;grid-auto-flow:column;grid-auto-columns:min(340px,78vw);gap:1rem;
  overflow-x:auto;scroll-snap-type:x mandatory;padding-bottom:.7rem;scrollbar-width:thin}
.rail .proj{scroll-snap-align:start}

/* ---- experience / education ---- */
.rows{display:grid;gap:.85rem}
.row{padding:1.35rem 1.4rem}
.row-top{display:flex;flex-wrap:wrap;align-items:baseline;gap:.6rem;justify-content:space-between}
.row h3{font-size:1.04rem;font-weight:800;letter-spacing:-.02em}
.when{font-size:.75rem;font-weight:700;color:var(--acc);background:${pfRgba(T.acc, .12)};
  padding:.2rem .6rem;border-radius:999px;white-space:nowrap}
.invert .when{background:${pfRgba("#FFFFFF", .2)};color:#fff}
.org{font-size:.85rem;font-weight:600;color:var(--faint);margin:.15rem 0 .5rem}
.row p{color:var(--mute);font-size:.93rem;margin-bottom:.45rem}
.row ul{display:grid;gap:.38rem}
.tl{position:relative;padding-left:2rem}
.tl::before{content:"";position:absolute;left:7px;top:.6rem;bottom:.6rem;width:2px;border-radius:2px;
  background:linear-gradient(180deg,transparent,${pfRgba(T.acc, .5)} 12%,${pfRgba(T.acc2, .5)} 88%,transparent)}
.tl .row::before{content:"";position:absolute;left:-2rem;top:1.7rem;width:16px;height:16px;border-radius:50%;
  background:var(--bg);border:2px solid var(--acc)}
.tl .row{position:relative;margin-bottom:.85rem}
@media (max-width:620px){.tl{padding-left:1.55rem}.tl .row::before{left:-1.55rem;width:14px;height:14px}}
.cards2{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:.9rem}

/* ---- certifications ---- */
.certlist{display:grid;gap:.5rem}
.certlist li{display:flex;gap:.6rem;align-items:flex-start;color:var(--mute);font-size:.93rem}
.certlist li::before{content:"";flex:0 0 auto;width:18px;height:18px;margin-top:.2rem;border-radius:50%;
  background:${pfRgba(T.acc, .16)};box-shadow:inset 0 0 0 2px ${pfRgba(T.acc, .55)}}

/* ---- quote ---- */
.quote{font-size:clamp(1.3rem,3.6vw,2.2rem);font-weight:700;line-height:1.28;letter-spacing:-.025em;
  max-width:24ch;margin:0 auto;text-align:center}
.quote-left{margin:0;text-align:left;max-width:30ch}
.quote-marks::before{content:"\\201C";display:block;font-size:3.4em;line-height:.7;color:var(--acc);opacity:.35}
.quote-boxed{padding:clamp(1.4rem,4vw,2.4rem);border-radius:var(--r-lg);border:1px solid var(--line);
  background:var(--card);max-width:38ch}

/* ---- band ---- */
.band-rule{height:1px;background:linear-gradient(90deg,transparent,var(--line),transparent)}
.band-shapes{display:flex;gap:.9rem;justify-content:center;align-items:center;flex-wrap:wrap}
.band-shapes i{display:block;width:clamp(26px,5vw,44px);aspect-ratio:1;
  background:linear-gradient(135deg,var(--acc),var(--acc2));opacity:.85}
.band-shapes i:nth-child(1){border-radius:50%}
.band-shapes i:nth-child(2){border-radius:var(--r-sm);transform:rotate(45deg)}
.band-shapes i:nth-child(3){clip-path:polygon(50% 0,100% 100%,0 100%)}
.band-shapes i:nth-child(4){border-radius:50% 50% 50% 0}
.band-shapes i:nth-child(5){clip-path:polygon(50% 0,100% 38%,82% 100%,18% 100%,0 38%)}
.band-marq{font-size:clamp(1.6rem,5vw,3rem);font-weight:800;letter-spacing:-.03em;color:${pfRgba(T.acc, .55)}}
.band-marq .marq-run{gap:2.5rem}

/* ---- contact + footer ---- */
.contact-panel{padding:clamp(1.8rem,4.6vw,3rem);border-radius:var(--r-lg);text-align:center}
.contact-split{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:clamp(1.2rem,4vw,2.6rem);align-items:center}
@media (max-width:760px){.contact-split{grid-template-columns:1fr}}
.contact-big .h2{font-size:clamp(2rem,7vw,4rem)}
.mail{display:inline-block;font-size:clamp(1.1rem,3vw,1.7rem);font-weight:800;letter-spacing:-.02em;
  color:inherit;text-decoration:none;border-bottom:2px solid currentColor;padding-bottom:.1rem}
.clist{display:flex;flex-wrap:wrap;gap:.5rem;justify-content:center;margin-top:1.4rem}
.clist a,.clist span{display:inline-flex;align-items:center;gap:.45rem;padding:.42rem .95rem;border-radius:999px;
  font-size:.82rem;font-weight:600;background:var(--surface);color:var(--mute);text-decoration:none;transition:.22s}
.clist a:hover{background:var(--acc);color:var(--on-acc)}
.clist svg{width:14px;height:14px}
/* ---- poster ---- */
.poster{position:relative}
.poster-type{display:grid;gap:0;line-height:.86;letter-spacing:-.055em;font-weight:900;margin:0;
  font-size:clamp(2.8rem,13vw,9rem);text-transform:uppercase}
.poster-type span{display:block}
.poster-fill .poster-type{font-size:clamp(3rem,15.5vw,12rem)}
.poster-outline{color:transparent;-webkit-text-stroke:2px var(--ink)}
@supports not ((-webkit-text-stroke: 1px black)) { .poster-outline{color:var(--ink)} }
.poster-tag{display:inline-flex;align-items:center;gap:.5rem;font-size:.74rem;font-weight:800;
  letter-spacing:.16em;text-transform:uppercase;color:var(--acc);margin-bottom:1rem}
.poster-meta{margin-top:1.1rem;font-size:clamp(.9rem,1.7vw,1.1rem);font-weight:700;
  letter-spacing:.02em;text-transform:uppercase;color:var(--mute)}
.poster-lede{margin-top:.8rem;max-width:46ch;color:var(--mute);font-size:1.03rem}
.poster-rule{display:flex;flex-wrap:wrap;gap:.6rem 1.4rem;justify-content:space-between;
  margin-top:1.1rem;padding-top:.8rem;border-top:2px solid var(--ink);
  font-size:.78rem;font-weight:700;letter-spacing:.14em;text-transform:uppercase}

/* ---- index ---- */
.idx{counter-reset:none;display:grid;gap:0}
.idx-cols{grid-template-columns:repeat(auto-fit,minmax(230px,1fr));column-gap:2.4rem}
.idx li{border-bottom:1px solid var(--line)}
.idx a{display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:1rem;
  padding:.85rem .2rem;text-decoration:none;transition:.22s;position:relative}
.idx a b{font-size:.72rem;font-weight:800;letter-spacing:.1em;color:var(--faint);font-variant-numeric:tabular-nums}
.idx a span{font-size:clamp(1.05rem,2.4vw,1.5rem);font-weight:700;letter-spacing:-.02em}
.idx a i{width:16px;height:2px;background:currentColor;opacity:.35;transition:.22s}
.idx a:hover{color:var(--acc);padding-left:.7rem}
.idx a:hover i{width:30px;opacity:1}
.idx-inline{display:flex;flex-wrap:wrap;gap:.4rem 1.6rem}
.idx-inline a{display:inline-flex;align-items:baseline;gap:.4rem;text-decoration:none;
  font-weight:700;font-size:.95rem;transition:.2s}
.idx-inline a b{font-size:.66rem;color:var(--faint)}
.idx-inline a:hover{color:var(--acc)}

/* ---- spotlight ---- */
.spot-name{font-size:clamp(1.8rem,5.4vw,3.6rem);font-weight:800;letter-spacing:-.04em;line-height:1.04}
.spot-meta{margin-top:.6rem;font-size:.8rem;font-weight:700;letter-spacing:.13em;
  text-transform:uppercase;color:var(--acc)}
.spot-lede{margin-top:1rem;font-size:clamp(1rem,2.1vw,1.24rem);line-height:1.6;color:var(--mute);max-width:60ch}
.spot-list{margin-top:1.1rem;display:grid;gap:.5rem;max-width:62ch}
.spot-list li{position:relative;padding-left:1.4rem;color:var(--mute)}
.spot-list li::before{content:"";position:absolute;left:0;top:.62em;width:8px;height:2px;background:var(--acc)}
.spot .tags,.spot .links{margin-top:1.1rem;display:flex;flex-wrap:wrap;gap:.5rem}
.spot .links a{display:inline-flex;align-items:center;gap:.4rem;font-weight:700;font-size:.85rem;
  text-decoration:none;color:var(--acc)}
.spot .links a svg{width:15px;height:15px}
.spot-editorial{display:grid;grid-template-columns:minmax(0,.26fr) minmax(0,1fr);gap:clamp(1.2rem,4vw,3rem)}
.spot-when{font-size:.82rem;font-weight:700;color:var(--mute)}
.spot-figure{display:grid;grid-template-columns:auto minmax(0,1fr);gap:clamp(1rem,3.4vw,2.6rem);align-items:start}
.spot-fig{font-size:clamp(3rem,9vw,7rem);font-weight:900;line-height:.8;color:transparent;
  -webkit-text-stroke:2px var(--acc);letter-spacing:-.05em}
@supports not ((-webkit-text-stroke: 1px black)) { .spot-fig{color:var(--acc)} }
.spot-poster{text-align:center}
.spot-poster .spot-lede{margin-inline:auto}
.spot-poster .tags,.spot-poster .links{justify-content:center}
@media (max-width:820px){.spot-editorial,.spot-figure{grid-template-columns:1fr}}

/* ---- ledger ---- */
.led{display:grid}
.led-row{display:grid;grid-template-columns:minmax(84px,.2fr) minmax(0,1fr);gap:1rem;
  padding:.9rem 0;border-bottom:1px solid var(--line);align-items:baseline}
.led-when{font-size:.78rem;font-weight:700;letter-spacing:.06em;color:var(--faint);
  font-variant-numeric:tabular-nums;white-space:nowrap}
.led-what b{display:block;font-size:1.02rem;font-weight:700;letter-spacing:-.015em}
.led-what > span{display:block;font-size:.85rem;color:var(--acc);margin-top:.15rem}
.led-what em{display:block;font-style:normal;font-size:.88rem;color:var(--mute);margin-top:.4rem;line-height:1.55}
.led-table .led-row{border-bottom:1px solid var(--line)}
.led-table .led-row:first-child{border-top:2px solid var(--ink)}
/* The receipt is deliberately narrow and monospaced — it reads as a printed
   slip rather than a table, which is the whole point of the variant. */
.led-receipt{max-width:44rem;margin-inline:auto;font-family:var(--font);
  border:1px dashed var(--line);padding:1.2rem clamp(1rem,3vw,2rem)}
.led-receipt .led-row{border-bottom:1px dashed var(--line)}
.led-receipt .led-when,.led-receipt .led-what b{font-variant-numeric:tabular-nums;letter-spacing:.02em}
/* Dot leaders, drawn with a repeating gradient so they stretch to fill
   whatever gap the two columns leave. */
.led-dotted .led-row{grid-template-columns:minmax(0,1fr) auto;border-bottom:0;padding:.55rem 0}
.led-dotted .led-what{order:1}
.led-dotted .led-when{order:2}
.led-dotted .led-row::after{content:"";grid-row:1;grid-column:1/-1;align-self:center;height:1px;margin:0 .5rem;
  background-image:radial-gradient(circle,var(--line) 1px,transparent 1px);background-size:6px 1px;
  background-repeat:repeat-x;order:0}

/* ---- gallery wall ---- */
.wall{display:grid;gap:clamp(1.2rem,3.4vw,2.4rem)}
.wall-grid{grid-template-columns:repeat(auto-fit,minmax(240px,1fr))}
.wall-salon{grid-template-columns:repeat(auto-fit,minmax(240px,1fr));align-items:end}
/* The salon hang staggers alternate works, the way a real one does — nothing
   is absolutely positioned, so it still stacks cleanly on a phone. */
.wall-salon .wall-item:nth-child(even){transform:translateY(clamp(14px,3vw,38px))}
.wall-salon .wall-item:nth-child(3n){transform:translateY(clamp(-22px,-2vw,-8px))}
.wall-strip{grid-auto-flow:column;grid-auto-columns:minmax(230px,1fr);overflow-x:auto;
  padding-bottom:.8rem;scroll-snap-type:x mandatory}
.wall-strip .wall-item{scroll-snap-align:start}
.wall-frame{aspect-ratio:4/5;display:grid;place-items:center;background:var(--surface);
  border:1px solid var(--line);box-shadow:0 1px 0 var(--line),0 14px 34px ${pfRgba(T.dark ? "#000000" : "#0C1017", T.dark ? .45 : .09)};
  padding:8%;position:relative}
.wall-frame::after{content:"";position:absolute;inset:6%;border:1px solid var(--line)}
.wall-frame span{font-size:clamp(1.6rem,4vw,2.6rem);font-weight:800;letter-spacing:-.03em;
  color:var(--acc);opacity:.55}
.wall-grid .wall-frame{aspect-ratio:1}
.wall-label{margin-top:.85rem;max-width:34ch}
.wall-label b{display:block;font-size:.95rem;font-weight:700;letter-spacing:-.01em}
.wall-label > span{display:block;font-size:.74rem;letter-spacing:.1em;text-transform:uppercase;
  color:var(--faint);margin-top:.2rem}
.wall-label em{display:block;font-style:normal;font-size:.84rem;color:var(--mute);margin-top:.45rem;line-height:1.55}
.wall-links{display:flex;gap:.7rem;margin-top:.5rem}
.wall-links a{display:inline-flex;align-items:center;gap:.3rem;font-size:.78rem;font-weight:700;
  color:var(--acc);text-decoration:none}
.wall-links a svg{width:13px;height:13px}

/* ---- letter ---- */
.note{max-width:60rem;margin-inline:auto}
.note-open{font-size:1.05rem;color:var(--mute);margin-bottom:.8rem}
.note-body{font-size:clamp(1rem,2vw,1.14rem);line-height:1.75}
.note-letter{padding:clamp(1.4rem,4vw,3rem);background:var(--card);border:1px solid var(--line);
  border-radius:var(--r);box-shadow:0 18px 44px ${pfRgba(T.dark ? "#000000" : "#0C1017", T.dark ? .42 : .07)}}
.note-card{max-width:46rem;padding:clamp(1.2rem,3.4vw,2.2rem);border:1px solid var(--line);
  border-radius:var(--r);background:var(--surface)}
.note-memo{border-top:3px solid var(--ink);padding-top:1.1rem}
.note-head{display:grid;gap:.25rem;padding-bottom:1rem;margin-bottom:1.2rem;border-bottom:1px solid var(--line);
  font-size:.8rem;color:var(--mute);letter-spacing:.02em}
.note-head b{display:inline-block;min-width:3.4rem;font-weight:800;font-size:.68rem;
  letter-spacing:.14em;text-transform:uppercase;color:var(--faint)}
.note-sign{margin-top:1.6rem}
.note-name{display:block;font-size:1.35rem;font-weight:700;letter-spacing:-.02em;
  transform:rotate(-1.6deg);transform-origin:left center;color:var(--acc)}
.note-role{display:block;font-size:.78rem;color:var(--faint);margin-top:.5rem}

/* ---- currently ---- */
.now{display:grid;gap:0}
.now-item{display:grid;grid-template-columns:minmax(110px,.24fr) minmax(0,1fr);gap:1rem;
  padding:.7rem 0;border-bottom:1px solid var(--line);align-items:baseline}
.now-item dt{font-size:.7rem;font-weight:800;letter-spacing:.13em;text-transform:uppercase;color:var(--faint)}
.now-item dd{margin:0;font-size:1rem;font-weight:600}
.now-board{grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:.9rem}
.now-board .now-item{display:block;border:1px solid var(--line);border-radius:var(--r);
  padding:1rem;background:var(--card)}
.now-board .now-item dd{margin-top:.35rem}
.now-row{display:flex;flex-wrap:wrap;gap:.6rem 2rem}
.now-row span{display:inline-flex;flex-direction:column;gap:.15rem;font-size:.98rem;font-weight:600}
.now-row b{font-size:.66rem;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:var(--faint)}

/* ---- call to action ---- */
.cta-band,.cta-ticket{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:1rem}
.cta-line{font-size:clamp(1.15rem,2.8vw,1.9rem);font-weight:800;letter-spacing:-.03em}
.cta-ticket{padding:clamp(1rem,3vw,1.7rem);border-style:dashed}
.cta-huge{text-align:center}
.cta-big{font-size:clamp(1.9rem,7vw,4.6rem);font-weight:900;letter-spacing:-.05em;line-height:1.02}

.foot{font-size:.82rem;color:var(--faint);display:flex;flex-wrap:wrap;gap:.6rem;
  justify-content:space-between;align-items:center;border-top:1px solid var(--line);padding-top:1.3rem}
.foot-centered{justify-content:center;text-align:center}
@media (max-width:620px){.nav-links{display:none}.skcols{columns:1}}
`;
}

// ---------------------------------------------------------------------------
// Block -> HTML
// ---------------------------------------------------------------------------
// One function per block type. Each receives the same computed context every
// hand-written template gets, so the content is identical no matter which
// design draws it.

// A heading with the block's own default, overridable per block in the
// inspector. Passing "" through the designer means "use the default", which is
// why an empty string is not simply written into the design document.
function pfBlkHead(blk, kicker, dflt) {
  const title = (blk.title || dflt || "").trim();
  if (!title && !kicker) return "";
  return `<div class="sec-head" data-reveal>
    ${kicker ? `<div class="kicker">${pfEsc(kicker)}</div>` : ""}
    ${title ? `<h2 class="h2">${pfEsc(title)}</h2>` : ""}
  </div>`;
}

const PF_BLK_HTML = {

  // `anchors` is the set of section ids the rest of this design will really
  // emit. The portfolio's own section list is not the same thing: a block can
  // be hidden, or absent from the design altogether, and a nav built from the
  // content alone would then link to somewhere that is not on the page.
  nav(c, blk, anchors) {
    const items = anchors ? c.navItems.filter(n => anchors.has(n.id)) : c.navItems;
    const links = items.map(n => `<a href="#${n.id}">${pfEsc(n.label)}</a>`).join("");
    return `<div class="nav-in">
      <a class="brand" href="#top"><i>${pfEsc(c.initials)}</i>${pfEsc(c.name)}</a>
      ${links ? `<div class="nav-links">${links}</div>` : ""}
    </div>`;
  },

  hero(c, blk) {
    const d = c.d;
    const badge = d.available ? `<div class="badge"><i></i>${pfEsc(d.available)}</div>` : "";
    const acts = `<div class="acts">
      ${d.email ? `<a class="btn btn-primary" href="mailto:${pfEsc(d.email)}">${PF_ICONS.mail}${pfEsc(d.cta_text || "Get in touch")}</a>` : ""}
      ${c.hasResume ? `<a class="btn btn-ghost" ${pfResumeAttrs(c)}>${PF_ICONS.download}${pfEsc(c.resumeLabel)}</a>` : ""}
      ${pfSocialRow(c, "socials")}
    </div>`;
    const words = `
      ${badge}
      <h1 class="name name-grad" data-reveal>${pfEsc(c.name)}</h1>
      ${c.title ? `<div class="role" data-reveal>${pfEsc(c.title)}</div>` : ""}
      ${c.tagline ? `<p class="lead" data-reveal>${pfEsc(c.tagline)}</p>` : ""}
      ${acts}`;
    const photo = d.avatar ? `<div class="portrait" data-reveal>${pfAvatar(c)}</div>` : "";

    if (blk.variant === "split")  return `<div class="hero-split">${`<div>${words}</div>`}${photo}</div>`;
    if (blk.variant === "banner") return `<div class="hero-banner">${photo}${words}</div>`;
    if (blk.variant === "stack")  return `<div class="hero-stack">${words}</div>`;
    return `<div class="hero-center">${photo}${words}</div>`;
  },

  stats(c, blk) {
    const items = c.d.stats.map(x => `<div class="stat ${blk.variant === "cards" ? "card" : ""}" data-reveal>
      <b>${pfEsc(x.value)}</b><span>${pfEsc(x.label)}</span></div>`).join("");
    const cls = blk.variant === "inline" ? "stats-inline" : blk.variant === "big" ? "stats stats-big" : "stats";
    return `${pfBlkHead(blk, "", "")}<div class="${cls}">${items}</div>`;
  },

  about(c, blk) {
    const head = pfBlkHead(blk, "About", "The short version");
    const body = `<div class="prose ${blk.variant === "lead" ? "prose-lead" : ""}" data-reveal>${pfEsc(c.d.about)}</div>`;
    if (blk.variant === "split") return `<div class="about-split">${head}<div class="card about-card">${body}</div></div>`;
    return `${head}${body}`;
  },

  skills(c, blk) {
    const head = pfBlkHead(blk, "Toolkit", "What I work with");
    if (blk.variant === "grouped" && c.skillGroups.length) {
      return head + c.skillGroups.map(g => `<div class="skgroup" data-reveal>
        ${g.name ? `<h4>${pfEsc(g.name)}</h4>` : ""}
        <div class="chips">${g.items.map(x => `<span class="chip">${pfEsc(x)}</span>`).join("")}</div>
      </div>`).join("");
    }
    if (blk.variant === "columns") {
      return head + `<div class="skcols" data-reveal>${c.d.skills.map(x => `<span>${pfEsc(x)}</span>`).join("")}</div>`;
    }
    if (blk.variant === "marquee") {
      const run = c.d.skills.map(x => `<span class="chip">${pfEsc(x)}</span>`).join("");
      return head + `<div class="marq"><div class="marq-run">${run}<span aria-hidden="true" style="display:contents">${run}</span></div></div>`;
    }
    return head + `<div class="chips" data-reveal>${c.d.skills.map(x => `<span class="chip">${pfEsc(x)}</span>`).join("")}</div>`;
  },

  projects(c, blk) {
    const head = pfBlkHead(blk, "Work", "Selected projects");
    const card = (x, i, withFig) => `<article class="card card-hover proj" data-reveal>
      ${withFig ? `<div class="fig" aria-hidden="true">${String(i + 1).padStart(2, "0")}</div>` : ""}
      <div>
        <h3>${pfEsc(x.name || "")}</h3>
        ${pfJoin([x.role, x.period]) ? `<div class="role">${pfJoin([x.role, x.period])}</div>` : ""}
        ${x.description ? `<p>${pfEsc(x.description)}</p>` : ""}
        ${(x.bullets || []).length ? `<ul>${x.bullets.map(b => `<li>${pfEsc(b)}</li>`).join("")}</ul>` : ""}
        ${(x.tags || []).length ? `<div class="tags">${x.tags.map(t => `<span class="tag">${pfEsc(t)}</span>`).join("")}</div>` : ""}
        ${pfProjectLinks(x) ? `<div class="links">${pfProjectLinks(x)}</div>` : ""}
      </div>
    </article>`;
    const items = c.d.projects;
    if (blk.variant === "feature") return head + `<div class="feature">${items.map((x, i) => card(x, i, true)).join("")}</div>`;
    if (blk.variant === "list")    return head + `<div class="proj-list">${items.map((x, i) => card(x, i, false)).join("")}</div>`;
    if (blk.variant === "rail")    return head + `<div class="rail">${items.map((x, i) => card(x, i, false)).join("")}</div>`;
    return head + `<div class="grid">${items.map((x, i) => card(x, i, false)).join("")}</div>`;
  },

  experience(c, blk) {
    const head = pfBlkHead(blk, "Experience", "Where I have worked");
    const row = (x) => `<article class="card row" data-reveal>
      <div class="row-top"><h3>${pfEsc(x.role || "")}</h3>
        ${x.period ? `<span class="when">${pfEsc(x.period)}</span>` : ""}</div>
      ${x.org ? `<div class="org">${pfJoin([x.org, x.location])}</div>` : ""}
      ${x.summary ? `<p>${pfEsc(x.summary)}</p>` : ""}
      ${(x.bullets || []).length ? `<ul>${x.bullets.map(b => `<li>${pfEsc(b)}</li>`).join("")}</ul>` : ""}
    </article>`;
    const inner = c.d.experience.map(row).join("");
    if (blk.variant === "timeline") return head + `<div class="tl">${inner}</div>`;
    if (blk.variant === "cards")    return head + `<div class="cards2">${inner}</div>`;
    return head + `<div class="rows">${inner}</div>`;
  },

  education(c, blk) {
    const head = pfBlkHead(blk, "Education", "Where I studied");
    const inner = c.d.education.map(x => `<article class="card row" data-reveal>
      <div class="row-top"><h3>${pfEsc(x.degree || "")}</h3>
        ${x.period ? `<span class="when">${pfEsc(x.period)}</span>` : ""}</div>
      ${x.school ? `<div class="org">${pfEsc(x.school)}</div>` : ""}
      ${x.detail ? `<p>${pfEsc(x.detail)}</p>` : ""}
    </article>`).join("");
    return head + `<div class="${blk.variant === "cards" ? "cards2" : "rows"}">${inner}</div>`;
  },

  certifications(c, blk) {
    const head = pfBlkHead(blk, "Credentials", "Certifications");
    if (blk.variant === "list") {
      return head + `<ul class="certlist" data-reveal>${c.d.certifications.map(x => `<li>${pfEsc(x)}</li>`).join("")}</ul>`;
    }
    return head + `<div class="chips" data-reveal>${c.d.certifications.map(x => `<span class="chip">${pfEsc(x)}</span>`).join("")}</div>`;
  },

  quote(c, blk) {
    const text = blk.title || c.tagline || c.title || c.name;
    const cls = "quote" + (blk.variant === "marks" ? " quote-marks" : blk.variant === "boxed" ? " quote-boxed" : "");
    return `<blockquote class="${cls}" data-reveal>${pfEsc(text)}</blockquote>`;
  },

  band(c, blk) {
    if (blk.variant === "rule")   return `<div class="band-rule" role="presentation"></div>`;
    if (blk.variant === "space")  return `<div style="height:1px" role="presentation"></div>`;
    if (blk.variant === "shapes") return `<div class="band-shapes" role="presentation" data-reveal><i></i><i></i><i></i><i></i><i></i></div>`;
    const word = pfEsc(blk.title || c.title || c.name);
    const run = `<span>${word}</span><span>✷</span><span>${word}</span><span>✷</span>`;
    return `<div class="marq band-marq"><div class="marq-run">${run}<span aria-hidden="true" style="display:contents">${run}</span></div></div>`;
  },

  contact(c, blk) {
    const d = c.d;
    const head = pfBlkHead(blk, "", blk.title || "Let's work together");
    const blurb = `<p class="lead">${pfEsc(d.cta_text || "Tell me what you are building and where it is stuck.")}</p>`;
    const acts = `<div class="acts" style="justify-content:center">
      ${d.email ? `<a class="btn btn-primary" href="mailto:${pfEsc(d.email)}">${PF_ICONS.mail}${pfEsc(d.email)}</a>` : ""}
      ${c.hasResume ? `<a class="btn btn-ghost" ${pfResumeAttrs(c)}>${PF_ICONS.download}Résumé</a>` : ""}
    </div>`;
    const list = `<div class="clist">${c.links.map(x => x.url
      ? `<a href="${pfEsc(x.url)}"${/^https?:/i.test(x.url) ? ` target="_blank" rel="noopener"` : ""}>${x.icon}${pfEsc(x.handle)}</a>`
      : `<span>${x.icon}${pfEsc(x.handle)}</span>`).join("")}</div>`;

    if (blk.variant === "split") {
      return `<div class="contact-split" data-reveal>
        <div>${head}${blurb}</div>
        <div>${d.email ? `<a class="mail" href="mailto:${pfEsc(d.email)}">${pfEsc(d.email)}</a>` : ""}${list}</div>
      </div>`;
    }
    if (blk.variant === "big") {
      return `<div class="contact-big" style="text-align:center" data-reveal>${head}${blurb}${acts}${list}</div>`;
    }
    return `<div class="card contact-panel" data-reveal>${head}${blurb}${acts}${list}</div>`;
  },

  // ---- the art-direction blocks ----------------------------------------

  poster(c, blk) {
    // The name is split so each word can take a line of its own — one long
    // name set on one line is a small name, which is the opposite of a poster.
    const words = c.name.split(/\s+/).filter(Boolean);
    const meta = pfJoin([c.title, c.d.location]);
    const type = `<h1 class="poster-type ${blk.variant === "outline" ? "poster-outline" : ""}" data-reveal>
      ${words.map(w => `<span>${pfEsc(w)}</span>`).join("")}</h1>`;

    if (blk.variant === "split") {
      return `<div class="poster poster-split">
        ${type}
        <div class="poster-rule" data-reveal>
          <span>${pfEsc(meta || c.title)}</span>
          ${c.d.available ? `<span>${pfEsc(c.d.available)}</span>` : ""}
        </div>
      </div>`;
    }
    return `<div class="poster poster-${blk.variant}">
      ${blk.variant === "fill" ? "" : (c.d.available ? `<div class="poster-tag" data-reveal>${pfEsc(c.d.available)}</div>` : "")}
      ${type}
      ${meta ? `<div class="poster-meta" data-reveal>${meta}</div>` : ""}
      ${c.tagline ? `<p class="poster-lede" data-reveal>${pfEsc(c.tagline)}</p>` : ""}
    </div>`;
  },

  // A contents page for a personal site. It draws the same anchors the nav
  // does, so it can replace a nav entirely in the layouts where a sticky bar
  // would fight the design.
  index(c, blk, anchors) {
    const items = (anchors ? c.navItems.filter(n => anchors.has(n.id)) : c.navItems);
    if (!items.length) return "";
    const head = pfBlkHead(blk, "", blk.title || "");
    const rows = items.map((n, i) => `
      <li data-reveal><a href="#${n.id}">
        <b>${String(i + 1).padStart(2, "0")}</b>
        <span>${pfEsc(n.label)}</span>
        <i aria-hidden="true"></i>
      </a></li>`).join("");
    if (blk.variant === "inline") {
      return head + `<nav class="idx-inline" data-reveal>${items.map((n, i) =>
        `<a href="#${n.id}"><b>${String(i + 1).padStart(2, "0")}</b>${pfEsc(n.label)}</a>`).join("")}</nav>`;
    }
    return head + `<ol class="idx ${blk.variant === "columns" ? "idx-cols" : ""}">${rows}</ol>`;
  },

  spotlight(c, blk) {
    const p = c.d.projects[0];
    if (!p) return "";
    const head = pfBlkHead(blk, "Selected work", "");
    const links = pfProjectLinks(p);
    const body = `
      <h3 class="spot-name" data-reveal>${pfEsc(p.name || "")}</h3>
      ${pfJoin([p.role, p.period]) ? `<div class="spot-meta" data-reveal>${pfJoin([p.role, p.period])}</div>` : ""}
      ${p.description ? `<p class="spot-lede" data-reveal>${pfEsc(p.description)}</p>` : ""}
      ${(p.bullets || []).length ? `<ul class="spot-list" data-reveal>${p.bullets.map(b => `<li>${pfEsc(b)}</li>`).join("")}</ul>` : ""}
      ${(p.tags || []).length ? `<div class="tags" data-reveal>${p.tags.map(t => `<span class="tag">${pfEsc(t)}</span>`).join("")}</div>` : ""}
      ${links ? `<div class="links" data-reveal>${links}</div>` : ""}`;

    if (blk.variant === "figure") {
      return head + `<article class="spot spot-figure">
        <div class="spot-fig" aria-hidden="true" data-reveal>01</div>
        <div>${body}</div>
      </article>`;
    }
    if (blk.variant === "poster") {
      return head + `<article class="spot spot-poster">${body}</article>`;
    }
    return head + `<article class="spot spot-editorial">
      <div class="spot-side" data-reveal>
        <span class="kicker">Case</span>
        ${p.period ? `<div class="spot-when">${pfEsc(p.period)}</div>` : ""}
      </div>
      <div>${body}</div>
    </article>`;
  },

  ledger(c, blk) {
    const head = pfBlkHead(blk, "Record", "Where I have worked");
    const rows = c.d.experience.map(x => `
      <li class="led-row" data-reveal>
        <span class="led-when">${pfEsc(x.period || "")}</span>
        <span class="led-what">
          <b>${pfEsc(x.role || "")}</b>
          ${x.org ? `<span>${pfJoin([x.org, x.location])}</span>` : ""}
          ${x.summary ? `<em>${pfEsc(x.summary)}</em>` : ""}
        </span>
      </li>`).join("");
    return head + `<ul class="led led-${blk.variant}">${rows}</ul>`;
  },

  wall(c, blk) {
    const head = pfBlkHead(blk, "Works", "");
    const items = c.d.projects.map((p, i) => `
      <figure class="wall-item" data-reveal>
        <div class="wall-frame" aria-hidden="true"><span>${pfEsc((p.name || "?").slice(0, 2).toUpperCase())}</span></div>
        <figcaption class="wall-label">
          <b>${pfEsc(p.name || "")}</b>
          <span>${pfJoin([p.role, p.period]) || pfEsc((p.tags || [])[0] || "")}</span>
          ${p.description ? `<em>${pfEsc(p.description)}</em>` : ""}
          ${pfProjectLinks(p) ? `<span class="wall-links">${pfProjectLinks(p)}</span>` : ""}
        </figcaption>
      </figure>`).join("");
    return head + `<div class="wall wall-${blk.variant}">${items}</div>`;
  },

  note(c, blk) {
    const head = pfBlkHead(blk, "", blk.title || "");
    const opening = blk.variant === "memo" ? "" : "Hello —";
    return head + `<article class="note note-${blk.variant}" data-reveal>
      ${blk.variant === "memo" ? `<div class="note-head">
        <span><b>From</b> ${pfEsc(c.name)}</span>
        ${c.title ? `<span><b>Re</b> ${pfEsc(c.title)}</span>` : ""}
        ${c.d.location ? `<span><b>At</b> ${pfEsc(c.d.location)}</span>` : ""}
      </div>` : ""}
      ${opening ? `<p class="note-open">${opening}</p>` : ""}
      <div class="prose note-body">${pfEsc(c.d.about)}</div>
      <div class="note-sign">
        <span class="note-name">${pfEsc(c.name)}</span>
        ${c.title ? `<span class="note-role">${pfEsc(c.title)}</span>` : ""}
      </div>
    </article>`;
  },

  now(c, blk) {
    const d = c.d;
    const rows = [
      d.location  && ["Based in", d.location],
      c.title     && ["Working as", c.title],
      d.available && ["Status", d.available],
      c.d.skills.length && ["Mostly using", c.d.skills.slice(0, 4).join(", ")],
      d.email     && ["Reachable at", d.email],
    ].filter(Boolean);
    if (!rows.length) return "";
    const head = pfBlkHead(blk, "", blk.title || "Currently");
    if (blk.variant === "row") {
      return head + `<div class="now-row" data-reveal>${rows.map(([k, v]) =>
        `<span><b>${pfEsc(k)}</b>${pfEsc(v)}</span>`).join("")}</div>`;
    }
    return head + `<dl class="now now-${blk.variant}">${rows.map(([k, v]) => `
      <div class="now-item" data-reveal><dt>${pfEsc(k)}</dt><dd>${pfEsc(v)}</dd></div>`).join("")}</dl>`;
  },

  cta(c, blk) {
    const d = c.d;
    const line = blk.title || d.cta_text || "Let's build something";
    const btn = d.email
      ? `<a class="btn btn-primary" href="mailto:${pfEsc(d.email)}">${PF_ICONS.mail}${pfEsc(d.email)}</a>` : "";
    const res = c.hasResume ? `<a class="btn btn-ghost" ${pfResumeAttrs(c)}>${PF_ICONS.download}${pfEsc(c.resumeLabel)}</a>` : "";
    if (blk.variant === "huge") {
      return `<div class="cta cta-huge" data-reveal>
        <p class="cta-big">${pfEsc(line)}</p>
        <div class="acts" style="justify-content:center">${btn}${res}</div>
      </div>`;
    }
    if (blk.variant === "ticket") {
      return `<div class="cta cta-ticket card" data-reveal>
        <span class="cta-line">${pfEsc(line)}</span>
        <span class="acts" style="margin:0">${btn}${res}</span>
      </div>`;
    }
    return `<div class="cta cta-band" data-reveal>
      <span class="cta-line">${pfEsc(line)}</span>
      <span class="acts" style="margin:0">${btn}${res}</span>
    </div>`;
  },

  footer(c, blk) {
    const line = `© <span data-year>${c.year}</span> ${pfEsc(c.name)}${c.d.footer_note ? " · " + pfEsc(c.d.footer_note) : ""}`;
    if (blk.variant === "centered") return `<div class="foot foot-centered"><span>${line}</span></div>`;
    return `<div class="foot"><span>${line}</span><a href="#top" style="color:inherit;text-decoration:none">Back to top ↑</a></div>`;
  },
};

// ---------------------------------------------------------------------------
// The composer
// ---------------------------------------------------------------------------

// Which portfolio section a block anchors, so nav links land on it. Only the
// first block of a given type takes the id — two projects blocks would
// otherwise emit the same id twice and the nav would jump to whichever the
// browser found first.
const PF_BLK_ANCHOR = {
  about: "about", skills: "skills", projects: "projects", experience: "experience",
  education: "education", certifications: "certifications", contact: "contact",
  // The art-direction blocks draw the same content as their plain
  // counterparts, so they claim the same anchor: a page whose projects are a
  // gallery wall still has a #projects for the nav to land on. Whichever
  // comes first takes it — the `used` guard in pfDesignBody stops a page with
  // both a wall and a grid emitting #projects twice.
  spotlight: "projects", wall: "projects", ledger: "experience", note: "about",
  cta: "contact",
};

// `opts.editor` is set only by the designer's own preview. It adds a
// data-blk attribute naming the block each section came from, which is what
// lets the canvas overlay line its outlines and toolbar up with the real
// rendered page. It is deliberately absent everywhere else: the downloaded
// file is somebody's public site and should carry no trace of the tool that
// built it.
function pfDesignBody(c, design, opts) {
  const editor = !!(opts && opts.editor);
  const used = {};
  const parts = [];
  let hasNav = false;

  // The canvas needs to know which block a section came from and what to call
  // it in the drag handle. Built once per block rather than inline twice.
  const mark = (blk, def) => editor
    ? ` data-blk="${pfEsc(blk.id)}" data-blk-label="${pfEsc(def.label)}"` : "";

  // Which blocks will draw something, decided before anything is drawn: the
  // nav comes first in the output but has to know what the rest of the page
  // ends up containing.
  const draws = (blk) => {
    const def = PF_BLOCK_BY_TYPE[blk.type];
    return !!def && !blk.hidden && (!def.needs || c.has(def.needs));
  };
  const anchors = new Set();
  design.blocks.filter(draws).forEach((blk) => {
    const a = PF_BLK_ANCHOR[blk.type];
    if (a) anchors.add(a);
  });

  design.blocks.forEach((blk) => {
    const def = PF_BLOCK_BY_TYPE[blk.type];
    if (!def) return;
    // Hidden blocks are absent from the page but still present in the design,
    // so the designer can list them and switch them back on.
    if (blk.hidden) return;
    // A block whose content is switched off or empty is dropped entirely.
    // Emitting "Projects" over an empty grid is worse than not asking.
    if (def.needs && !c.has(def.needs)) return;

    const html = (PF_BLK_HTML[blk.type] || (() => ""))(c, blk, anchors);
    if (!html) return;

    if (blk.type === "nav") {
      hasNav = true;
      parts.push(`<nav class="nav nav-${blk.variant} bg-${blk.bg} ${PF_BLK_BG.find(b => b.id === blk.bg && b.invert) ? "invert" : ""} pf-noprint"${mark(blk, def)}>
        <div class="shell">${html}</div></nav>`);
      return;
    }

    const anchor = PF_BLK_ANCHOR[blk.type];
    const id = blk.type === "hero" ? "top" : (anchor && !used[anchor] ? anchor : "");
    if (id) used[id] = 1;

    const invert = PF_BLK_BG.some(b => b.id === blk.bg && b.invert);
    const cls = [
      "blk", "blk-" + blk.type, "pad-" + blk.pad,
      blk.bg !== "none" ? "bg-" + blk.bg : "",
      invert ? "invert" : "",
      "rv-" + blk.anim,
    ].filter(Boolean).join(" ");

    parts.push(`<section class="${cls}"${id ? ` id="${id}"` : ""}${mark(blk, def)}>
      ${blk.gfx !== "none" ? `<div class="blk-gfx gfx-${blk.gfx}" aria-hidden="true"></div>` : ""}
      <div class="shell">${html}</div>
    </section>`);
  });

  // Without a hero block there is no #top, and the nav's brand link plus the
  // footer's "back to top" would both dangle. An empty anchor at the very top
  // costs nothing and keeps every link honest.
  const topAnchor = design.blocks.some(b => b.type === "hero") ? "" : `<span id="top"></span>`;
  const tex = design.theme.texture !== "none"
    ? `<div class="page-tex gfx-${design.theme.texture}" aria-hidden="true"></div>` : "";

  return `${tex}${topAnchor}${hasNav ? parts.shift() : ""}<main id="main">${parts.join("\n")}</main>`;
}

function pfDesignJS(c, design) {
  if (!design.blocks.some(b => b.type === "nav")) return "";
  return `
(function(){
  var nav = document.querySelector('.nav');
  var links = Array.prototype.slice.call(document.querySelectorAll('.nav-links a'));
  var targets = links.map(function(a){ return document.querySelector(a.getAttribute('href')); }).filter(Boolean);
  if (!targets.length) return;
  /* Scroll spy on an observer rather than a scroll handler: no layout read on
     any frame the page is not actually crossing a boundary. */
  var seen = {};
  var spy = new IntersectionObserver(function(entries){
    entries.forEach(function(en){ seen[en.target.id] = en.intersectionRatio; });
    var best = '', bestR = 0;
    Object.keys(seen).forEach(function(id){ if (seen[id] > bestR) { bestR = seen[id]; best = id; } });
    links.forEach(function(a){ a.classList.toggle('on', a.getAttribute('href') === '#' + best && bestR > 0); });
  }, { threshold: [0, .2, .55, .9], rootMargin: '-24% 0px -46% 0px' });
  targets.forEach(function(t){ spy.observe(t); });
})();`;
}

// The one entry point. Returns exactly what every hand-written renderer
// returns, which is why nothing downstream needs to know this design was
// assembled rather than authored.
function pfRenderCustom(c, rawDesign, opts) {
  const design = pfNormalizeDesign(rawDesign);
  const T = pfDesignTheme(design.theme);
  const font = PF_FONTS[design.theme.font];
  return {
    fonts: [c.googleFont || (font && font.google) || "Inter:wght@400;500;600;700;800"].filter(Boolean),
    css: pfDesignCSS(c, design) + pfDesignComponentCSS(c, design) + pfDesignBlockCSS(c, design),
    body: pfDesignBody(c, design, opts),
    js: pfDesignJS(c, design),
    themeColor: T.bg,
  };
}

// A design's font choice lives in the design, not in the portfolio's data, so
// the context has to be told about it before the renderer runs. Everything else
// a custom template needs is already in the normal context.
function pfCustomContext(design, rawData) {
  const c = pfContext(PF_DEFAULT_TEMPLATE, rawData);
  const d = pfNormalizeDesign(design);
  const font = PF_FONTS[d.theme.font];
  if (font && !rawData.font) { c.fontStack = font.stack; c.googleFont = font.google; }
  c.accent = d.theme.accent;
  return c;
}
