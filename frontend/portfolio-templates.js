// ============================================================================
// Momentum — Portfolio site templates
// ============================================================================
// Ten site designs, one content shape. Every template is a pure function of
// the portfolio's data, which is what lets somebody switch template without
// re-typing a word, and what lets the live preview and the downloaded file
// come from the same code path — what you see while editing IS the file.
//
// The output is a single self-contained .html document: markup, styles and
// behaviour inlined, no build step, no bundler, no node_modules. Drop it on
// Netlify, GitHub Pages, Cloudflare Pages, S3 or a USB stick and it works.
// The only outbound request any template makes is to Google Fonts, and every
// font declaration carries a full system fallback stack, so a site opened
// offline still reads correctly.
//
// Loaded as a classic script before app.js. Everything here is namespaced
// `pf*` / `PF_*` so nothing collides with the main app's globals.
// ============================================================================

// ---------------------------------------------------------------------------
// Catalogue. Mirrors backend/app/routers/portfolios.py::TEMPLATES — the server
// keeps its own copy purely to validate a saved template_id; this is the copy
// that decides what the picker shows and what actually renders.
// ---------------------------------------------------------------------------
// `photo` says whether the design has somewhere to put a portrait. Not every
// one does — the type-led designs are built around words, and dropping a face
// into them would be a different template. The builder reads this so somebody
// who has just added a photo is told, rather than left wondering why it did
// not appear. It is asserted against the renderers in the template tests, so
// it cannot quietly drift out of date.
const PF_TEMPLATES = [
  { id: "aurora", photo: true,    name: "Aurora",        tone: "dark",  accent: "#7C5CFC", swatch: ["#7C5CFC", "#2DD4BF", "#0B1020"],
    tag: "Animated",  bestFor: "Designers, founders, product people",
    description: "Glassmorphic dark hero with a living gradient and a drifting particle field." },
  { id: "monogram", photo: false,  name: "Monogram",      tone: "light", accent: "#171A1F", swatch: ["#171A1F", "#8A8F98", "#FFFFFF"],
    tag: "Minimal",   bestFor: "Writers, researchers, consultants",
    description: "Quiet black-and-white typography. Nothing moves that doesn't earn it." },
  { id: "terminal", photo: false,  name: "Terminal",      tone: "dark",  accent: "#3CE88F", swatch: ["#3CE88F", "#1B2430", "#0C1016"],
    tag: "Interactive", bestFor: "Backend, DevOps and security engineers",
    description: "A shell that types itself out — and a prompt whose commands really run." },
  { id: "neon", photo: false,      name: "Neon Grid",     tone: "dark",  accent: "#FF2E88", swatch: ["#FF2E88", "#22D3EE", "#0A0714"],
    tag: "Bold",      bestFor: "Game devs, creative coders, students",
    description: "Cyberpunk grid, glitching headline and a scanline sweep across every card." },
  { id: "editorial", photo: true, name: "Editorial",     tone: "light", accent: "#B5432E", swatch: ["#B5432E", "#2B2622", "#FBF7F0"],
    tag: "Typographic", bestFor: "Content, marketing and UX writers",
    description: "Magazine layout — oversized serif headline, drop cap, a real reading column." },
  { id: "sidebar", photo: true,   name: "Sidebar Pro",   tone: "light", accent: "#2C6FDB", swatch: ["#2C6FDB", "#1B2A41", "#F5F7FA"],
    tag: "Classic",   bestFor: "Corporate roles, analysts, PMs",
    description: "Fixed profile rail, scroll-spy navigation, skill meters, prints beautifully." },
  { id: "timeline", photo: true,  name: "Timeline",      tone: "light", accent: "#3C9D7B", swatch: ["#3C9D7B", "#22333B", "#F4F7F5"],
    tag: "Narrative", bestFor: "Long histories and career changers",
    description: "One vertical spine down the page; every role reveals itself as you scroll." },
  { id: "deck", photo: true,      name: "Card Deck",     tone: "light", accent: "#E4A335", swatch: ["#E4A335", "#2A2622", "#FFFDF8"],
    tag: "Projects",  bestFor: "Portfolios where the work is the point",
    description: "Filterable project grid, tilt-on-hover cards and a detail dialog per project." },
  { id: "bold", photo: false,      name: "Gradient Bold", tone: "dark",  accent: "#FF5A3C", swatch: ["#FF5A3C", "#FFC93C", "#141018"],
    tag: "Statement", bestFor: "Creatives, brand and motion designers",
    description: "Full-bleed colour blocks, a scrolling skills marquee and type at full volume." },
  { id: "slate", photo: true,     name: "Slate",         tone: "auto",  accent: "#1F7A8C", swatch: ["#1F7A8C", "#3C6E71", "#EDF2F4"],
    tag: "Corporate", bestFor: "Engineering, data and finance",
    description: "Clean two-column layout, counting stat tiles and a real light/dark toggle." },

  // --- the graphics-forward ten -------------------------------------------
  // Each of these leads with one visual mechanic rather than a colour scheme,
  // because "the same layout in ten palettes" is what makes a template picker
  // feel like a lie. Every one of them respects prefers-reduced-motion: the
  // effect is the design, but nobody should get motion sickness from a CV.
  { id: "prism", photo: false,     name: "Prism",         tone: "dark",  accent: "#8B5CF6", swatch: ["#8B5CF6", "#22D3EE", "#0A0714"],
    tag: "Holographic", bestFor: "Designers and creative technologists",
    description: "Iridescent conic aura, chromatic-split headline, glass cards that refract under the cursor." },
  { id: "nebula", photo: false,    name: "Nebula",        tone: "dark",  accent: "#38BDF8", swatch: ["#38BDF8", "#A78BFA", "#05070F"],
    tag: "Cosmic",    bestFor: "Data, ML and research engineers",
    description: "A real canvas starfield with depth parallax, and constellations that draw to your cursor." },
  { id: "kinetic", photo: false,   name: "Kinetic",       tone: "light", accent: "#FF3B2F", swatch: ["#FF3B2F", "#111111", "#FAF9F7"],
    tag: "Typographic", bestFor: "Art directors, copywriters, brand",
    description: "Type at billboard scale — letters spring in one by one and the headline warps as you scroll." },
  { id: "blueprint", photo: false, name: "Blueprint",     tone: "dark",  accent: "#4CC9F0", swatch: ["#4CC9F0", "#1B3A5C", "#0B1B2B"],
    tag: "Technical", bestFor: "Architects, hardware and systems engineers",
    description: "Drafting paper, crosshairs and dimension lines that draw themselves as each section arrives." },
  { id: "liquid", photo: true,    name: "Liquid",        tone: "light", accent: "#FF6B9D", swatch: ["#FF6B9D", "#7DD3C0", "#FFF8FB"],
    tag: "Organic",   bestFor: "Illustrators, educators, wellness",
    description: "Gooey metaballs that chase the cursor and morphing blob dividers between every section." },
  { id: "bento", photo: true,     name: "Bento",         tone: "light", accent: "#0EA5E9", swatch: ["#0EA5E9", "#64748B", "#F1F5F9"],
    tag: "Modular",   bestFor: "Product managers and generalists",
    description: "A bento grid of unequal tiles, each one springing and tilting under the pointer." },
  { id: "riso", photo: false,      name: "Risograph",     tone: "light", accent: "#E8503A", swatch: ["#E8503A", "#2B4C8C", "#F7F1E4"],
    tag: "Print",     bestFor: "Illustrators, zine makers, studios",
    description: "Duotone halftone, paper grain and rotated stickers — a printed poster that happens to scroll." },
  { id: "orbit", photo: true,     name: "Orbit",         tone: "dark",  accent: "#FBBF24", swatch: ["#FBBF24", "#F472B6", "#0D0B14"],
    tag: "Radial",    bestFor: "Multi-disciplinary and portfolio careers",
    description: "Skills ride rotating orbital rings around your portrait, and the sections turn on a dial." },
  { id: "strata", photo: false,    name: "Strata",        tone: "dark",  accent: "#60A5FA", swatch: ["#60A5FA", "#F9A8D4", "#0F172A"],
    tag: "Cinematic", bestFor: "Filmmakers, photographers, storytellers",
    description: "Five parallax layers drifting at different speeds — a dusk landscape you scroll through." },
  { id: "chrome", photo: false,    name: "Chrome",        tone: "dark",  accent: "#A5B4FC", swatch: ["#A5B4FC", "#E879F9", "#08080C"],
    tag: "Y2K",       bestFor: "Music, fashion and motion designers",
    description: "Liquid-metal type with a sheen that sweeps on a loop, bevelled glass and a scrolling ticker." },
  { id: "aquarelle", photo: true, name: "Aquarelle",     tone: "light", accent: "#5B8FB9", swatch: ["#5B8FB9", "#E0919B", "#FBF8F3"],
    tag: "Painterly", bestFor: "Editors, teachers, writers and career changers",
    description: "Watercolour washes that bleed into the paper, a handwritten greeting and a hand-drawn underline under every heading." },
  { id: "beacon", photo: true,    name: "Beacon",        tone: "light", accent: "#4F46E5", swatch: ["#4F46E5", "#0EA5E9", "#FFFFFF"],
    tag: "Graduate",  bestFor: "Students, bootcamp grads and first-role developers",
    description: "Bright and uncluttered, with a skills matrix grouped by category and a contact form that really sends." },

  // --- the bright ten -----------------------------------------------------
  // All light on purpose, and each one led by a mechanic none of the first
  // twenty-two use. Colour alone does not make a template distinct; what the
  // page DOES is what you remember.
  { id: "memphis", photo: false,   name: "Memphis",       tone: "light", accent: "#FF4D6D", swatch: ["#FF4D6D", "#FFC93C", "#FDF6E8"],
    tag: "Playful",   bestFor: "Illustrators, event and brand designers",
    description: "Squiggles, zigzags and terrazzo confetti that bounce and spin as the page scrolls past them." },
  { id: "isometric", photo: true, name: "Isometric",     tone: "light", accent: "#6C5CE7", swatch: ["#6C5CE7", "#00CEC9", "#F2F1FB"],
    tag: "Dimensional", bestFor: "3D artists, game and systems designers",
    description: "A real isometric plane — cards sit on the grid at 30 degrees and rotate flat when you reach them." },
  { id: "comic", photo: true,     name: "Comic",         tone: "light", accent: "#E4002B", swatch: ["#E4002B", "#FFD100", "#FFFDF5"],
    tag: "Panelled",  bestFor: "Storytellers, comic artists, animators",
    description: "Inked panels, speech bubbles and a halftone action burst behind every heading." },
  { id: "ticket", photo: true,    name: "Boarding Pass", tone: "light", accent: "#0F8A8A", swatch: ["#0F8A8A", "#F26B38", "#F4F7F6"],
    tag: "Travel",    bestFor: "Travel writers, consultants, anyone who moves",
    description: "Every section is a perforated stub — dashed tear lines, a real barcode and an ink stamp." },
  { id: "notebook", photo: true,  name: "Notebook",      tone: "light", accent: "#2F6FED", swatch: ["#2F6FED", "#FFD84D", "#FFFEF7"],
    tag: "Annotated", bestFor: "Teachers, students, researchers",
    description: "Ruled paper with a highlighter that wipes across each heading, sticky notes and margin doodles." },
  { id: "arcade", photo: false,    name: "Arcade",        tone: "light", accent: "#FF3B6B", swatch: ["#FF3B6B", "#22C1F3", "#FFF9E6"],
    tag: "8-bit",     bestFor: "Game developers, hobbyists, indie makers",
    description: "Pixel borders, a blinking score HUD and chunky sprite type — daylight arcade, not another black CRT." },
  { id: "botanical", photo: true, name: "Botanical",     tone: "light", accent: "#3F8F5B", swatch: ["#3F8F5B", "#E4785B", "#F7FBF4"],
    tag: "Growing",   bestFor: "Ecology, wellness, food and craft",
    description: "A vine draws itself down the page as you scroll, sprouting a leaf beside every entry." },
  { id: "bauhaus", photo: true,   name: "Bauhaus",       tone: "light", accent: "#E63946", swatch: ["#E63946", "#1D3FB5", "#F5F1E8"],
    tag: "Geometric", bestFor: "Architects, product and industrial designers",
    description: "Primaries, hard grid and oversized arcs — a poster composition that reassembles as you scroll." },
  { id: "clay", photo: true,      name: "Clay",          tone: "light", accent: "#8B7BF7", swatch: ["#8B7BF7", "#FF9BB3", "#F3F0FF"],
    tag: "Soft 3D",   bestFor: "App designers, illustrators, kids and education",
    description: "Puffy claymorphic shapes with double shadows that squish inward under the pointer." },
  { id: "chart", photo: true,     name: "Chart",         tone: "light", accent: "#2A78D6", swatch: ["#2A78D6", "#EB6834", "#FCFCFB"],
    tag: "Data",      bestFor: "Analysts, data scientists, researchers",
    description: "Your career as an infographic — animated bars, a donut and a plotted timeline, with a table view." },

  // --- the advanced six ---------------------------------------------------
  // Each of these is anchored by a platform capability none of the first
  // thirty-two touch: the GPU, Houdini's typed custom properties, a physics
  // integrator, the View Transitions API. Every one degrades to something
  // deliberate when the capability is missing, because a portfolio that only
  // works on one browser is not a portfolio.
  { id: "flux", photo: true,      name: "Flux",          tone: "light", accent: "#FF7A00", swatch: ["#FF7A00", "#FF3D81", "#FFF7ED"],
    tag: "WebGL",     bestFor: "Creative technologists and motion designers",
    description: "A live fragment shader on the GPU — domain-warped noise flowing behind the page, never the same twice." },
  { id: "reel", photo: true,      name: "Reel",          tone: "light", accent: "#C026D3", swatch: ["#C026D3", "#7C3AED", "#FDF4FF"],
    tag: "3D",        bestFor: "Photographers, film and product designers",
    description: "A cover-flow carousel in real perspective — drag, flick or scroll it and the cards settle on a spring." },
  { id: "halo", photo: true,      name: "Halo",          tone: "light", accent: "#0891B2", swatch: ["#0891B2", "#22D3EE", "#F0FDFF"],
    tag: "Houdini",   bestFor: "Front-end engineers and design engineers",
    description: "Conic borders that rotate through a typed @property angle, and a spotlight that tracks your cursor across the grid." },
  { id: "filament", photo: true,  name: "Filament",      tone: "light", accent: "#65A30D", swatch: ["#65A30D", "#F59E0B", "#FAFDF2"],
    tag: "Physics",   bestFor: "Makers, engineers and interaction designers",
    description: "Skills hang from verlet-simulated threads that swing when you push them and settle under real gravity." },
  { id: "morph", photo: true,     name: "Morph",         tone: "light", accent: "#DB2777", swatch: ["#DB2777", "#F472B6", "#FFF5F9"],
    tag: "Transitions", bestFor: "Product designers and case-study portfolios",
    description: "Projects morph open with shared-element View Transitions — the card becomes the detail page, not a modal over it." },
  { id: "aperture", photo: true,  name: "Aperture",      tone: "light", accent: "#7E22CE", swatch: ["#7E22CE", "#A78BFA", "#FAF5FF"],
    tag: "Cinematic", bestFor: "Directors, editors and photographers",
    description: "Sections open through a clip-path iris and the page racks focus as you scroll, like a lens finding its subject." },
];

const PF_TEMPLATE_BY_ID = Object.fromEntries(PF_TEMPLATES.map(t => [t.id, t]));
const PF_DEFAULT_TEMPLATE = "aurora";

// ---------------------------------------------------------------------------
// Sample content for the template picker.
//
// The picker used to show ten abstract wireframes — grey bars on a coloured
// rectangle. They told you a template was dark, or had a sidebar, and nothing
// else. You picked one, spent an hour filling it in, and only then found out
// what it actually looked like.
//
// So the picker renders the real thing instead, through the same
// pfRenderSite() that builds the file you download. There is no second
// rendering path that could flatter a template it shouldn't.
//
// One fictional person across all ten, deliberately: holding the content
// constant is the only way the designs are comparable. And every section is
// filled, because a layout's whole job is what it does with a full page —
// an empty template looks identical to every other empty template.
// ---------------------------------------------------------------------------
const PF_DEMO = {
  full_name: "Ava Sinclair",
  title: "Senior Product Engineer",
  tagline: "I build the unglamorous parts of a product — the ones people only notice when they break.",
  location: "London, UK",
  available: "Open to work — September 2026",
  email: "ava@sinclair.dev",
  phone: "+44 7700 900123",
  website: "sinclair.dev",
  linkedin: "linkedin.com/in/avasinclair",
  github: "github.com/avasinclair",
  twitter: "x.com/avasinclair",
  about:
    "I have spent eight years on the seam between design and infrastructure — design systems, "
    + "developer tooling, and the slow work of making a large codebase feel small again.\n\n"
    + "Most of what I am proud of is subtractive. A checkout that lost four steps. A build that "
    + "went from eleven minutes to ninety seconds. A component library three teams stopped "
    + "arguing about. I like problems where the fix is smaller than the thing it replaces.",
  // Written in the grouped form so the templates that render a skills matrix
  // have something to render. Every other template strips the prefixes and
  // shows the same flat run of chips it always did.
  skills: [
    "Languages: TypeScript", "JavaScript", "Python", "SQL",
    "Frameworks: React", "Node.js", "GraphQL",
    "Data & tooling: PostgreSQL", "AWS", "Playwright", "Figma",
  ],
  stats: [
    { value: "8", label: "Years shipping" },
    { value: "40k", label: "Daily users served" },
    { value: "12x", label: "Faster builds" },
    { value: "6", label: "Teams onboarded" },
  ],
  projects: [
    {
      name: "Atlas Design System",
      role: "Tech lead",
      period: "2024 — 2026",
      description: "A component library and token pipeline shared by six product teams, "
        + "built to end a three-year argument about buttons.",
      bullets: [
        "Cut time-to-first-screen for a new product from two weeks to two days",
        "Automated contrast and focus-order checks in CI — 94% of a11y bugs never reached review",
      ],
      tags: ["React", "Storybook", "Design tokens", "a11y"],
      link: "atlas.sinclair.dev",
      repo: "github.com/avasinclair/atlas",
    },
    {
      name: "Northwind Checkout",
      role: "Lead engineer",
      period: "2023",
      description: "Rebuilt a seven-step checkout as three, without dropping a single "
        + "compliance requirement.",
      bullets: [
        "Conversion up 18% on mobile in the first quarter after launch",
        "Rewrote the payment state machine so a failed card no longer lost the basket",
      ],
      tags: ["TypeScript", "Stripe", "XState"],
      link: "northwind.example.com",
      repo: "",
    },
    {
      name: "Ledger",
      role: "Creator",
      period: "2022 — Present",
      description: "An open-source CLI that turns a messy monorepo's dependency graph into "
        + "something you can actually read. 4.2k stars.",
      bullets: [
        "Used in production by three companies I have never worked at",
        "Zero runtime dependencies, on purpose",
      ],
      tags: ["Rust", "CLI", "Open source"],
      link: "",
      repo: "github.com/avasinclair/ledger",
    },
  ],
  experience: [
    {
      role: "Senior Product Engineer",
      org: "Northwind",
      period: "2023 — Present",
      location: "London, UK",
      summary: "Own the design system and the front-end platform the rest of engineering builds on.",
      bullets: [
        "Took the build from 11 minutes to 90 seconds; the team started shipping twice a day",
        "Led the accessibility audit that moved the flagship product to WCAG 2.2 AA",
        "Mentored four engineers, two of whom now run their own surfaces",
      ],
    },
    {
      role: "Product Engineer",
      org: "Harbour Labs",
      period: "2020 — 2023",
      location: "Remote",
      summary: "Second engineering hire. Built most of the first product, then most of its replacement.",
      bullets: [
        "Shipped the onboarding flow that took activation from 31% to 58%",
        "Ran the migration off a single Postgres box with no scheduled downtime",
      ],
    },
    {
      role: "Front-end Developer",
      org: "Fieldnote Studio",
      period: "2018 — 2020",
      location: "Manchester, UK",
      summary: "Agency work — fourteen client sites, all of them somebody else's deadline.",
      bullets: [
        "Standardised the studio's project starter; new builds began a week ahead",
      ],
    },
  ],
  education: [
    {
      degree: "BSc Computer Science",
      school: "University of Manchester",
      period: "2015 — 2018",
      detail: "First class honours. Dissertation on incremental type checking.",
    },
  ],
  certifications: [
    "AWS Solutions Architect — Associate (2024)",
    "IAAP Web Accessibility Specialist (2023)",
  ],
  cta_text: "Get in touch",
  footer_note: "Built with Momentum",
  sections: {
    about: true, stats: true, skills: true, projects: true,
    experience: true, education: true, certifications: true, contact: true,
  },
};

// A fresh copy every time — every caller normalizes, sorts or mutates, and one
// shared object handed to ten renderers is a bug waiting for a rainy day.
function pfDemoData() {
  return JSON.parse(JSON.stringify(PF_DEMO));
}

// Thumbnail mode. A card is a still: nothing in it will ever be scrolled, so
// reveal-on-scroll content would sit at opacity 0 forever and every template
// would thumbnail as an empty page. Motion is stilled to its end state for the
// same reason, and because ten live animation loops on one screen is a cost
// the picker has no reason to pay. The full-size preview runs everything.
const PF_THUMB_CSS = `
[data-reveal]{opacity:1!important;transform:none!important;filter:none!important}
.pf-skip{display:none!important}
html{scroll-behavior:auto!important}
*,*::before,*::after{animation-duration:.01ms!important;animation-delay:0s!important;animation-iteration-count:1!important;transition-duration:.01ms!important;transition-delay:0s!important}
`;

// Every section the builder can switch on, in the order they appear on a site.
const PF_SECTIONS = [
  { id: "about",          label: "About",          icon: "👤" },
  { id: "stats",          label: "Highlights",     icon: "📊" },
  { id: "skills",         label: "Skills",         icon: "🧩" },
  { id: "projects",       label: "Projects",       icon: "🚀" },
  { id: "experience",     label: "Experience",     icon: "💼" },
  { id: "education",      label: "Education",      icon: "🎓" },
  { id: "certifications", label: "Certifications", icon: "🏅" },
  { id: "contact",        label: "Contact",        icon: "✉️" },
];

// ---------------------------------------------------------------------------
// Small pure helpers
// ---------------------------------------------------------------------------

// Escapes for HTML text and double-quoted attributes both. The exported file
// is a document somebody else will host, so an unescaped angle bracket in a
// job title isn't a cosmetic bug — it's broken markup on their live site.
function pfEsc(s) {
  return (s == null ? "" : String(s))
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// For text that lands inside a <script> in the exported file. `</script>` in a
// project description would otherwise close the tag early and dump the rest of
// the JSON onto the page as visible text.
function pfJsonInline(value) {
  return JSON.stringify(value == null ? null : value)
    .replace(/</g, "\\u003C").replace(/>/g, "\\u003E")
    .replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

// People type "github.com/me", not "https://github.com/me". Left alone that
// becomes a relative link that 404s on their own domain.
function pfUrl(raw) {
  const s = (raw || "").trim();
  if (!s) return "";
  if (/^(https?:|mailto:|tel:|#|\/)/i.test(s)) return s;
  return "https://" + s.replace(/^\/+/, "");
}

// The visible half of a link: "https://www.linkedin.com/in/jane/" -> "linkedin.com/in/jane"
function pfPrettyUrl(raw) {
  return (raw || "").trim()
    .replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/+$/, "");
}

function pfInitials(name) {
  const parts = (name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "•";
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

function pfHexToRgb(hex) {
  let h = (hex || "").replace("#", "").trim();
  if (h.length === 3) h = h.split("").map(c => c + c).join("");
  if (!/^[0-9a-f]{6}$/i.test(h)) return { r: 124, g: 92, b: 252 };
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
}
function pfRgba(hex, a) { const { r, g, b } = pfHexToRgb(hex); return `rgba(${r},${g},${b},${a})`; }

// Mixes toward white (amt > 0) or black (amt < 0). Used to derive a whole
// palette from the one accent colour the customer picks, so a hand-picked
// colour never lands next to a hard-coded one that clashes with it.
function pfShade(hex, amt) {
  const { r, g, b } = pfHexToRgb(hex);
  const n = Number(amt) || 0;
  const t = n < 0 ? 0 : 255;
  // amt is a FRACTION (-1..1), not a percentage. Clamped rather than trusted:
  // passing 30 where .3 was meant used to emit "#b3197e156", and one invalid
  // colour in a gradient makes the browser discard the entire background —
  // which shows up as an invisible button, not as an error.
  const p = Math.min(1, Math.abs(n));
  const mix = (c) => Math.max(0, Math.min(255, Math.round((t - c) * p + c)));
  return "#" + [mix(r), mix(g), mix(b)].map(v => v.toString(16).padStart(2, "0")).join("");
}

// Rotates the hue to get a second, related accent for gradients. Two colours
// from one input beats asking somebody to pick a matching pair.
function pfHueShift(hex, deg) {
  let { r, g, b } = pfHexToRgb(hex);
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h, s, l = (max + min) / 2;
  if (max === min) { h = s = 0; }
  else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  h = (h + deg / 360 + 1) % 1;
  const hue = (p, q, t) => {
    if (t < 0) t += 1; if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  let R, G, B;
  if (s === 0) { R = G = B = l; }
  else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
    R = hue(p, q, h + 1 / 3); G = hue(p, q, h); B = hue(p, q, h - 1 / 3);
  }
  return "#" + [R, G, B].map(v => Math.round(v * 255).toString(16).padStart(2, "0")).join("");
}

// Black or white text on a given background, by perceived luminance. Picking
// this by eye is how you end up with white-on-yellow buttons.
function pfInkOn(hex) {
  const { r, g, b } = pfHexToRgb(hex);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.62 ? "#111318" : "#FFFFFF";
}

// Turns a "one per line" textarea into a list. Every list field in the builder
// is stored as an array, but users paste text — this is the one place that
// decides how a paste becomes items.
function pfLines(v) {
  if (Array.isArray(v)) return v.map(x => String(x).trim()).filter(Boolean);
  return String(v || "").split("\n").map(s => s.replace(/^[-•*]\s*/, "").trim()).filter(Boolean);
}

function pfArr(v) { return Array.isArray(v) ? v.filter(x => x && typeof x === "object") : []; }

// ---------------------------------------------------------------------------
// Data model
// ---------------------------------------------------------------------------
// One shape, every template. A field a template doesn't use costs nothing, and
// a field it does use is never missing — which is why switching template is
// safe at any point.
const PF_BLANK = {
  full_name: "", title: "", tagline: "", location: "", available: "",
  email: "", phone: "", website: "", linkedin: "", github: "", twitter: "", dribbble: "",
  avatar: "", about: "",
  skills: [], stats: [], projects: [], experience: [], education: [], certifications: [],
  accent_color: "", font: "", theme: "",
  cta_text: "", footer_note: "",
  seo_title: "", seo_description: "",
  analytics: "",
  resume: { mode: "none", filename: "", data_url: "", url: "", label: "Download résumé" },
  sections: { about: true, stats: false, skills: true, projects: true, experience: true, education: true, certifications: false, contact: true },
};

function pfNormalize(raw) {
  const d = { ...PF_BLANK, ...(raw || {}) };
  d.sections = { ...PF_BLANK.sections, ...(raw && raw.sections ? raw.sections : {}) };
  d.resume = { ...PF_BLANK.resume, ...(raw && raw.resume ? raw.resume : {}) };
  d.skills = pfLines(d.skills);
  d.certifications = pfLines(d.certifications);
  d.stats = pfArr(d.stats);
  d.projects = pfArr(d.projects);
  d.experience = pfArr(d.experience);
  d.education = pfArr(d.education);
  return d;
}

const PF_FONTS = {
  sans:    { label: "Inter (modern sans)", stack: `'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif`, google: "Inter:wght@400;500;600;700;800;900" },
  grotesk: { label: "Space Grotesk (geometric)", stack: `'Space Grotesk','Inter',-apple-system,'Segoe UI',Roboto,sans-serif`, google: "Space+Grotesk:wght@400;500;600;700" },
  serif:   { label: "Fraunces (editorial serif)", stack: `'Fraunces',Georgia,'Times New Roman',serif`, google: "Fraunces:opsz,wght@9..144,400;9..144,600;9..144,900" },
  slab:    { label: "Playfair Display (classic)", stack: `'Playfair Display',Georgia,serif`, google: "Playfair+Display:wght@400;600;800" },
  mono:    { label: "JetBrains Mono (code)", stack: `'JetBrains Mono','SFMono-Regular',Consolas,'Liberation Mono',monospace`, google: "JetBrains+Mono:wght@400;500;700" },
  // Added for the designer's art directions. Each one is the face a whole
  // layout is built around rather than a variation on the five above:
  // condensed for poster-scale headlines, a grotesque for Swiss grids, a
  // humanist slab for broadsheet columns, and a system stack for the
  // brutalist direction, which has to look like nothing was chosen at all.
  condensed: { label: "Archivo (condensed poster)", stack: `'Archivo','Inter',Impact,'Helvetica Neue',sans-serif`, google: "Archivo:wght@400;600;800;900" },
  swiss:     { label: "Inter Tight (Swiss grid)", stack: `'Inter Tight','Inter','Helvetica Neue',Helvetica,Arial,sans-serif`, google: "Inter+Tight:wght@400;500;600;700;800" },
  broadsheet:{ label: "Newsreader (broadsheet)", stack: `'Newsreader','Iowan Old Style',Georgia,serif`, google: "Newsreader:opsz,wght@6..72,300;6..72,400;6..72,600;6..72,800" },
  system:    { label: "System UI (raw, unstyled)", stack: `-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif`, google: "" },
};

// ---------------------------------------------------------------------------
// Computed context handed to every template
// ---------------------------------------------------------------------------
function pfContext(templateId, raw) {
  const t = PF_TEMPLATE_BY_ID[templateId] || PF_TEMPLATE_BY_ID[PF_DEFAULT_TEMPLATE];
  const d = pfNormalize(raw);
  const accent = (d.accent_color || t.accent).trim() || t.accent;
  const name = d.full_name || "Your Name";

  const socials = [
    d.linkedin && { key: "linkedin", label: "LinkedIn", url: pfUrl(d.linkedin), handle: pfPrettyUrl(d.linkedin), icon: PF_ICONS.linkedin },
    d.github   && { key: "github",   label: "GitHub",   url: pfUrl(d.github),   handle: pfPrettyUrl(d.github),   icon: PF_ICONS.github },
    d.twitter  && { key: "twitter",  label: "X",        url: pfUrl(d.twitter),  handle: pfPrettyUrl(d.twitter),  icon: PF_ICONS.twitter },
    d.dribbble && { key: "dribbble", label: "Dribbble", url: pfUrl(d.dribbble), handle: pfPrettyUrl(d.dribbble), icon: PF_ICONS.dribbble },
    d.website  && { key: "website",  label: "Website",  url: pfUrl(d.website),  handle: pfPrettyUrl(d.website),  icon: PF_ICONS.globe },
  ].filter(Boolean);

  const contacts = [
    d.email    && { key: "email",    label: "Email",    url: `mailto:${d.email}`, handle: d.email, icon: PF_ICONS.mail },
    d.phone    && { key: "phone",    label: "Phone",    url: `tel:${d.phone.replace(/[^\d+]/g, "")}`, handle: d.phone, icon: PF_ICONS.phone },
    d.location && { key: "location", label: "Location", url: "", handle: d.location, icon: PF_ICONS.pin },
  ].filter(Boolean);

  // The résumé link. "embed" bakes the PDF into the file as a data URI, which
  // is the only mode that still works when the site is hosted somewhere with
  // no connection back to Momentum — i.e. everywhere it will actually live.
  const r = d.resume || {};
  let resumeHref = "", resumeDownload = "";
  if (r.mode === "embed" && r.data_url) { resumeHref = r.data_url; resumeDownload = r.filename || "resume.pdf"; }
  else if (r.mode === "link" && r.url)  { resumeHref = pfUrl(r.url); }
  const font = PF_FONTS[d.font] || null;

  // ---------------------------------------------------------------------
  // Grouped skills.
  //
  // The stored field is one flat list, and it stays that way — no schema
  // change, nothing to migrate. A grouping is expressed by prefixing an entry
  // with "Category:", and everything after it belongs to that category until
  // the next prefix:
  //
  //     Languages: TypeScript, JavaScript, Frameworks: React, Node.js
  //     -> Languages [TypeScript, JavaScript]  Frameworks [React, Node.js]
  //
  // Templates that want the matrix read skillGroups; the other twenty read
  // d.skills and never see the prefixes, because they are stripped out here.
  // Write no colons and you get exactly what you had: one unnamed group.
  // ---------------------------------------------------------------------
  const skillGroups = [];
  d.skills.forEach((raw) => {
    const item = String(raw).trim();
    if (!item) return;
    // Two guards, because a skill can legitimately contain a colon. The
    // heading has to be short, and what follows it must not itself contain a
    // colon — which is what stops "Ratio: 3:1 contrast" turning into a
    // category called Ratio.
    const m = item.match(/^([^:]{1,28}):\s*(.*)$/);
    if (m && m[2].indexOf(":") === -1) {
      skillGroups.push({ name: m[1].trim(), items: m[2] ? [m[2].trim()] : [] });
    } else if (skillGroups.length) {
      skillGroups[skillGroups.length - 1].items.push(item);
    } else {
      skillGroups.push({ name: "", items: [item] });
    }
  });
  const skillGroupsClean = skillGroups.filter(g => g.items.length);
  d.skills = skillGroupsClean.reduce((all, g) => all.concat(g.items), []);

  const font2 = font ? font.stack : null;
  const sections = d.sections;
  const has = (id) => {
    if (!sections[id]) return false;
    if (id === "about") return !!(d.about || "").trim();
    if (id === "skills") return d.skills.length > 0;
    if (id === "stats") return d.stats.length > 0;
    if (id === "projects") return d.projects.length > 0;
    if (id === "experience") return d.experience.length > 0;
    if (id === "education") return d.education.length > 0;
    if (id === "certifications") return d.certifications.length > 0;
    if (id === "contact") return !!(d.email || d.phone || socials.length);
    return true;
  };

  const navItems = PF_SECTIONS.filter(s => s.id !== "stats" && has(s.id))
    .map(s => ({ id: s.id, label: s.id === "about" ? "About" : s.label }));

  return {
    t, d, accent,
    accent2: pfHueShift(accent, 42),
    accentSoft: pfRgba(accent, 0.12),
    accentInk: pfInkOn(accent),
    name, initials: pfInitials(name),
    title: d.title || "", tagline: d.tagline || "",
    socials, contacts, links: [...contacts, ...socials],
    resumeHref, resumeDownload,
    resumeLabel: r.label || "Download résumé",
    hasResume: !!resumeHref,
    fontStack: font2, googleFont: font ? font.google : null,
    has, navItems,
    skillGroups: skillGroupsClean,
    year: new Date().getFullYear(),
    esc: pfEsc,
  };
}

// Inline SVG. Icon fonts and sprite CDNs both mean an outbound request that
// can fail on somebody else's host; a 300-byte path never does.
const PF_ICONS = {
  mail: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="4.5" width="19" height="15" rx="2.5"/><path d="m3 7 9 6 9-6"/></svg>`,
  phone: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h3l2 5-2.5 1.5a12 12 0 0 0 6 6L16 13l5 2v3a2 2 0 0 1-2.2 2A17 17 0 0 1 4 5.2 2 2 0 0 1 6 3z"/></svg>`,
  pin: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s7-5.6 7-11a7 7 0 1 0-14 0c0 5.4 7 11 7 11z"/><circle cx="12" cy="10" r="2.6"/></svg>`,
  globe: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18z"/></svg>`,
  linkedin: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M4.98 3.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5zM3 9h4v12H3zM9 9h3.8v1.7h.05c.53-.95 1.83-1.95 3.77-1.95 4.03 0 4.78 2.5 4.78 5.76V21h-4v-5.6c0-1.34-.03-3.06-1.9-3.06-1.9 0-2.2 1.45-2.2 2.96V21H9z"/></svg>`,
  github: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48l-.01-1.7c-2.78.6-3.37-1.34-3.37-1.34-.46-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.9 1.53 2.35 1.09 2.92.83.09-.65.35-1.09.63-1.34-2.22-.25-4.56-1.11-4.56-4.95 0-1.09.39-1.99 1.03-2.69-.1-.25-.45-1.27.1-2.65 0 0 .84-.27 2.75 1.03a9.5 9.5 0 0 1 5 0c1.91-1.3 2.75-1.03 2.75-1.03.55 1.38.2 2.4.1 2.65.64.7 1.03 1.6 1.03 2.69 0 3.85-2.34 4.7-4.57 4.94.36.31.68.92.68 1.85l-.01 2.75c0 .27.18.58.69.48A10 10 0 0 0 12 2z"/></svg>`,
  twitter: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M17.5 3h3.2l-7 8 8.2 10h-6.4l-5-6.1L4.7 21H1.5l7.5-8.6L1.1 3h6.6l4.5 5.6L17.5 3zm-1.1 16.1h1.8L7.7 4.8H5.8l10.6 14.3z"/></svg>`,
  dribbble: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="9.2"/><path d="M4.5 8.3c5.6 1 10.6-.4 13.6-2.6M3.4 14.6c5.4-1.6 10.9-.3 14.4 3.6M8.6 3.4c3.6 4.6 5.7 9.9 6.2 17"/></svg>`,
  download: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12m0 0 4.5-4.5M12 15l-4.5-4.5M4 19h16"/></svg>`,
  arrow: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14m0 0-6-6m6 6-6 6"/></svg>`,
  link: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M10 14a4 4 0 0 0 5.7 0l3-3A4 4 0 1 0 13 5.3l-1.6 1.6"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3A4 4 0 1 0 11 18.7l1.6-1.6"/></svg>`,
};

// ============================================================================
// Document assembler
// ============================================================================
// Every template returns the same four things; this turns them into one valid,
// standalone HTML file. Centralising it means the <head> — viewport, SEO,
// Open Graph, theme-colour, a skip link, reduced-motion handling — is correct
// on all ten designs rather than on whichever ones I remembered.

// Shared reset + the two behaviours every site gets: scroll reveal and a
// focus ring that only shows for keyboard users.
const PF_RESET = `
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%;scroll-behavior:smooth}
@media (prefers-reduced-motion:reduce){html{scroll-behavior:auto}}
body{margin:0;min-height:100vh;text-rendering:optimizeLegibility;-webkit-font-smoothing:antialiased}
img,svg,video{max-width:100%;height:auto;display:block}
a{color:inherit}
button{font:inherit;color:inherit}
ul,ol{margin:0;padding:0;list-style:none}
h1,h2,h3,h4,p,figure,blockquote{margin:0}
:focus-visible{outline:2px solid currentColor;outline-offset:3px;border-radius:4px}
.pf-skip{position:absolute;left:-9999px;top:0;z-index:999;padding:.7rem 1.1rem;border-radius:0 0 8px 0}
.pf-skip:focus{left:0}
.pf-sr{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
[data-reveal]{opacity:0;transform:translateY(20px);transition:opacity .75s cubic-bezier(.2,.7,.2,1),transform .75s cubic-bezier(.2,.7,.2,1)}
[data-reveal].pf-in{opacity:1;transform:none}
@media (prefers-reduced-motion:reduce){
  [data-reveal]{opacity:1!important;transform:none!important;transition:none!important}
  *{animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important}
}
@media print{
  .pf-noprint{display:none!important}
  body{background:#fff!important;color:#000!important}
  [data-reveal]{opacity:1!important;transform:none!important}
}
`;

// The behaviour shared by all ten: reveal on scroll, staggered so a section
// arrives as a wave rather than all at once; anchor links that respect
// reduced-motion; and a copy-to-clipboard for any element that asks for it.
const PF_BASE_JS = `
(function(){
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var targets = document.querySelectorAll('[data-reveal]');
  if (!('IntersectionObserver' in window) || reduce) {
    for (var i=0;i<targets.length;i++) targets[i].classList.add('pf-in');
  } else {
    var io = new IntersectionObserver(function(entries){
      entries.forEach(function(e){
        if (!e.isIntersecting) return;
        var d = parseInt(e.target.getAttribute('data-reveal-delay') || '0', 10);
        setTimeout(function(){ e.target.classList.add('pf-in'); }, d);
        io.unobserve(e.target);
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    for (var j=0;j<targets.length;j++) io.observe(targets[j]);
  }

  document.addEventListener('click', function(ev){
    var copy = ev.target.closest('[data-copy]');
    if (copy) {
      var text = copy.getAttribute('data-copy');
      var done = function(){
        var old = copy.getAttribute('data-copy-label') || copy.textContent;
        copy.setAttribute('data-copy-label', old);
        copy.textContent = 'Copied';
        setTimeout(function(){ copy.textContent = old; }, 1400);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, function(){});
      else {
        var ta = document.createElement('textarea');
        ta.value = text; ta.setAttribute('readonly',''); ta.style.position='fixed'; ta.style.opacity='0';
        document.body.appendChild(ta); ta.select();
        try { document.execCommand('copy'); done(); } catch(e){}
        ta.remove();
      }
      ev.preventDefault();
      return;
    }
    var a = ev.target.closest('a[href^="#"]');
    if (a && a.getAttribute('href').length > 1) {
      /* Cancel FIRST, and cancel even when the target does not exist.
         This document may be living inside an about:srcdoc iframe — which the
         template picker's preview is — and there a relative URL resolves
         against the PARENT page's URL, not against the iframe. So an
         unresolvable "#whatever" is not the harmless no-op it looks like: the
         browser treats it as a cross-document navigation and replaces the
         template with whatever page is hosting the frame. Cancelling
         unconditionally makes that escape impossible. */
      ev.preventDefault();
      var href = a.getAttribute('href'), el = null;
      try { el = document.querySelector(href); } catch (err) { el = null; }  /* "#3d" is a valid id, not a valid selector */
      if (!el) { try { el = document.getElementById(href.slice(1)); } catch (err2) {} }
      if (!el && href === '#top') {
        window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
        return;
      }
      if (el) {
        el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
        /* A sandboxed document has an opaque origin, and replaceState rejects
           every URL from one. The scroll is the feature; the address bar is a
           nicety, and it must not throw and abort the handler. */
        try { if (history.replaceState) history.replaceState(null, '', href); } catch (err3) {}
      }
    }
  });

  var y = document.querySelectorAll('[data-year]');
  for (var k=0;k<y.length;k++) y[k].textContent = new Date().getFullYear();
})();
`;

function pfFontHref(families) {
  const list = families.filter(Boolean);
  if (!list.length) return "";
  return "https://fonts.googleapis.com/css2?" + list.map(f => "family=" + f).join("&") + "&display=swap";
}

// Assembles the file. `parts` is what a template renderer returns:
//   { fonts: [google family strings], css, body, js, htmlClass, themeColor }
const PF_PREVIEW_BRIDGE = `
(function(){
  var post = function(m){ try { parent.postMessage(m, '*'); } catch(e){} };
  addEventListener('scroll', function(){ post({ __pf:'scroll', y: window.scrollY }); }, { passive:true });
  addEventListener('message', function(e){
    if (e.data && e.data.__pf === 'restore' && typeof e.data.y === 'number') window.scrollTo(0, e.data.y);
  });
  post({ __pf:'ready' });
})();
`;

// The designer canvas.
//
// This is injected only when the designer is previewing a design, never into
// a downloaded site. It lives inside the iframe rather than in the parent for
// one reason: the preview is sandboxed to an opaque origin and scaled with a
// CSS transform, so a parent-side overlay would have to mirror the page's
// layout and re-derive every rectangle on each scroll, resize and font swap.
// Drawing the outlines in the same document as the blocks means they simply
// cannot drift — they are laid out by the same engine as the thing they mark.
//
// It talks to the parent in whole intentions ("this block moved to index 4"),
// never in pixels. The parent owns the design document; this owns the
// pointer. No fragment of the design is duplicated here, so the two cannot
// disagree about what the page currently is.
const PF_EDITOR_BRIDGE = `
(function(){
  var post = function(m){ try { parent.postMessage(m, '*'); } catch(e){} };
  var sel = null, dragId = null, dropIdx = -1, tag = null, line = null;

  var css = document.createElement('style');
  css.textContent =
    '[data-blk]{position:relative}' +
    '.pfe-hot{outline:2px dashed rgba(99,102,241,.6);outline-offset:-2px}' +
    '.pfe-sel{outline:2px solid #6366F1;outline-offset:-2px}' +
    '.pfe-tag{position:absolute;top:0;left:0;z-index:2147483646;display:flex;align-items:center;gap:7px;' +
      'padding:4px 9px;border-radius:0 0 8px 0;background:#6366F1;color:#fff;white-space:nowrap;' +
      'font:700 11px/1.35 ui-sans-serif,system-ui,-apple-system,Segoe UI,sans-serif;' +
      '-webkit-user-select:none;user-select:none;letter-spacing:.02em}' +
    '.pfe-tag b{font-weight:700}' +
    '.pfe-tag i{font-style:normal;cursor:grab;opacity:.9;font-size:13px;line-height:1;touch-action:none}' +
    '.pfe-tag i:active{cursor:grabbing}' +
    '.pfe-dragging{opacity:.4}' +
    '.pfe-line{position:absolute;left:0;width:100%;height:3px;background:#6366F1;border-radius:3px;' +
      'z-index:2147483647;pointer-events:none;box-shadow:0 0 0 3px rgba(99,102,241,.22)}' +
    '@media print{.pfe-tag,.pfe-line{display:none!important}}';
  document.head.appendChild(css);

  var blocks = function(){ return [].slice.call(document.querySelectorAll('[data-blk]')); };
  var idOf   = function(el){ return el && el.getAttribute('data-blk'); };

  function paint(){
    blocks().forEach(function(el){
      el.classList.toggle('pfe-sel', idOf(el) === sel);
    });
    var el = sel && document.querySelector('[data-blk="' + (window.CSS && CSS.escape ? CSS.escape(sel) : sel) + '"]');
    if (!el) { if (tag) tag.remove(); tag = null; return; }
    if (!tag) {
      tag = document.createElement('div');
      tag.className = 'pfe-tag';
      tag.innerHTML = '<i title="Drag to reorder">⠿</i><b></b>';
      tag.querySelector('i').addEventListener('pointerdown', startDrag);
    }
    tag.querySelector('b').textContent = el.getAttribute('data-blk-label') || 'Block';
    el.appendChild(tag);
  }

  /* Where a block dropped at this page Y would land. Midpoints rather than
     edges, so the insertion point flips when the pointer passes the middle of
     a block instead of only at its boundary — which is what makes dropping
     between two blocks feel like it lands where you aimed. */
  function indexAt(pageY, skipId){
    var list = blocks().filter(function(el){ return idOf(el) !== skipId; });
    for (var i = 0; i < list.length; i++) {
      var r = list[i].getBoundingClientRect();
      if (pageY < r.top + window.scrollY + r.height / 2) return { i: i, before: list[i] };
    }
    return { i: list.length, before: null };
  }

  function showLine(hit){
    if (!line) { line = document.createElement('div'); line.className = 'pfe-line'; }
    document.body.appendChild(line);
    var y;
    if (hit.before) {
      var r = hit.before.getBoundingClientRect();
      y = r.top + window.scrollY;
    } else {
      var list = blocks();
      var last = list[list.length - 1];
      var lr = last ? last.getBoundingClientRect() : { bottom: 0 };
      y = lr.bottom + window.scrollY;
    }
    line.style.top = (y - 1.5) + 'px';
  }
  function hideLine(){ if (line) line.remove(); }

  function startDrag(e){
    if (!sel) return;
    e.preventDefault(); e.stopPropagation();
    dragId = sel;
    var el = document.querySelector('[data-blk="' + (window.CSS && CSS.escape ? CSS.escape(dragId) : dragId) + '"]');
    if (el) el.classList.add('pfe-dragging');
    document.addEventListener('pointermove', onDrag);
    document.addEventListener('pointerup', endDrag, { once: true });
  }
  function onDrag(e){
    /* Auto-scroll near the edges, or a block can never be dragged past the
       fold of a page taller than the canvas. */
    if (e.clientY < 60) window.scrollBy(0, -14);
    else if (e.clientY > window.innerHeight - 60) window.scrollBy(0, 14);
    var hit = indexAt(e.clientY + window.scrollY, dragId);
    dropIdx = hit.i;
    showLine(hit);
  }
  function endDrag(){
    document.removeEventListener('pointermove', onDrag);
    hideLine();
    var el = dragId && document.querySelector('[data-blk="' + (window.CSS && CSS.escape ? CSS.escape(dragId) : dragId) + '"]');
    if (el) el.classList.remove('pfe-dragging');
    if (dragId && dropIdx >= 0) post({ __pf: 'move', id: dragId, index: dropIdx });
    dragId = null; dropIdx = -1;
  }

  document.addEventListener('mouseover', function(e){
    var el = e.target.closest && e.target.closest('[data-blk]');
    blocks().forEach(function(b){ b.classList.toggle('pfe-hot', b === el && idOf(b) !== sel); });
  });
  document.addEventListener('mouseleave', function(){
    blocks().forEach(function(b){ b.classList.remove('pfe-hot'); });
  });

  document.addEventListener('click', function(e){
    /* The canvas is an editing surface, not a live site: a mailto or an
       outbound project link must select the block it sits in, not navigate
       the customer away from their own design. */
    var a = e.target.closest && e.target.closest('a');
    if (a) { e.preventDefault(); }
    if (tag && tag.contains(e.target)) return;
    var el = e.target.closest && e.target.closest('[data-blk]');
    if (!el) return;
    sel = idOf(el); paint();
    post({ __pf: 'sel', id: sel });
  }, true);

  addEventListener('scroll', function(){ post({ __pf: 'scroll', y: window.scrollY }); }, { passive: true });

  addEventListener('message', function(e){
    var m = e.data; if (!m || typeof m !== 'object') return;
    if (m.__pf === 'restore' && typeof m.y === 'number') window.scrollTo(0, m.y);
    if (m.__pf === 'sel') { sel = m.id || null; paint(); }
    if (m.__pf === 'reveal') {
      var el = m.id && document.querySelector('[data-blk="' + (window.CSS && CSS.escape ? CSS.escape(m.id) : m.id) + '"]');
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    /* The parent is dragging a new block in from the palette. It owns the
       pointer (the drag started outside this document), so it sends the
       position and we answer with where that would land. */
    if (m.__pf === 'dropAt') {
      var hit = indexAt(m.y + window.scrollY, null);
      showLine(hit);
      post({ __pf: 'dropIdx', index: hit.i });
    }
    if (m.__pf === 'dropEnd') hideLine();
  });

  post({ __pf: 'ready' });
})();
`;

function pfDocument(c, parts, opts) {
  const d = c.d;
  const preview = !!(opts && opts.preview);
  const thumb = !!(opts && opts.thumb);
  const title = (d.seo_title || `${c.name}${c.title ? " — " + c.title : ""}`).trim();
  const desc = (d.seo_description || d.tagline || (d.about || "").slice(0, 155) ||
                `The personal portfolio of ${c.name}.`).replace(/\s+/g, " ").trim();
  const fontHref = pfFontHref([...(parts.fonts || []), c.googleFont]);
  const themeColor = parts.themeColor || c.accent;

  // The favicon is the person's initials on their accent colour, drawn as an
  // inline SVG data URI — a real tab icon with no second file to upload.
  const favicon = "data:image/svg+xml," + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="${c.accent}"/>` +
    `<text x="32" y="43" font-family="Helvetica,Arial,sans-serif" font-size="30" font-weight="700" fill="${c.accentInk}" text-anchor="middle">${c.initials}</text></svg>`
  );

  const analytics = (d.analytics || "").trim();

  return `<!DOCTYPE html>
<html lang="en"${parts.htmlClass ? ` class="${parts.htmlClass}"` : ""}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${pfEsc(title)}</title>
<meta name="description" content="${pfEsc(desc)}">
<meta name="author" content="${pfEsc(c.name)}">
<meta name="theme-color" content="${pfEsc(themeColor)}">
<meta name="generator" content="Momentum Portfolio Builder">
<meta property="og:type" content="profile">
<meta property="og:title" content="${pfEsc(title)}">
<meta property="og:description" content="${pfEsc(desc)}">
${d.avatar ? `<meta property="og:image" content="${pfEsc(d.avatar)}">` : ""}
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${pfEsc(title)}">
<meta name="twitter:description" content="${pfEsc(desc)}">
<link rel="icon" href="${favicon}">
${fontHref ? `<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${fontHref}">` : ""}
<script type="application/ld+json">${pfJsonInline({
    "@context": "https://schema.org", "@type": "Person",
    name: c.name, jobTitle: d.title || undefined,
    email: d.email ? "mailto:" + d.email : undefined,
    address: d.location || undefined, description: desc,
    url: d.website ? pfUrl(d.website) : undefined,
    sameAs: c.socials.map(s => s.url),
  })}</script>
<style>
${PF_RESET}
${parts.css}
${thumb ? PF_THUMB_CSS : ""}
</style>
</head>
<body${parts.bodyClass ? ` class="${parts.bodyClass}"` : ""}>
<a class="pf-skip" href="#main">Skip to content</a>
${parts.body}
<!-- Three tags, not one. A parse error inside a template's own script used to
     take the shared behaviour down with it — the scroll reveal never ran and
     the whole page sat at opacity 0. Separate script elements are parsed and
     failed independently, so a broken template loses only its own flourish. -->
<script>
${PF_BASE_JS}
</script>
${parts.js ? `<script>
${parts.js}
</script>` : ""}
${preview ? `<script>
${opts && opts.editor ? PF_EDITOR_BRIDGE : PF_PREVIEW_BRIDGE}
</script>` : ""}
${analytics && /^<script/i.test(analytics) ? analytics : ""}
</body>
</html>
`;
}

// The one public entry point. Both the live preview and the downloaded file
// call this — there is no second rendering path that could drift from it.
function pfRenderSite(templateId, rawData, opts) {
  // A design somebody assembled themselves arrives as "custom:<id>". It is
  // resolved here rather than anywhere downstream, so the preview, the
  // thumbnails, the download and every future caller get custom designs for
  // free — they only ever call this one function.
  const custom = pfLookupDesign ? pfLookupDesign(templateId) : null;
  if (custom) {
    const cc = pfCustomContext(custom, rawData);
    return pfDocument(cc, pfRenderCustom(cc, custom, opts), opts);
  }
  const id = PF_TEMPLATE_BY_ID[templateId] ? templateId : PF_DEFAULT_TEMPLATE;
  const c = pfContext(id, rawData);
  const renderer = PF_RENDERERS[id] || PF_RENDERERS[PF_DEFAULT_TEMPLATE];
  return pfDocument(c, renderer(c), opts);
}

// Filled in by portfolio.js once the person's saved designs have loaded. It is
// a hook rather than a direct lookup because portfolio-templates.js is the
// lower layer: it must keep rendering the built-in 38 even if the designer
// never loads at all.
let pfLookupDesign = null;
function pfSetDesignLookup(fn) { pfLookupDesign = fn; }

// ---------------------------------------------------------------------------
// Shared fragment builders
// ---------------------------------------------------------------------------
// Not every template uses these — several draw their own — but where two
// designs want the same thing (a résumé button, a social row), they share it
// so a fix lands in both.

// The href + download/target attributes for a résumé link, in one place.
// "embed" mode carries a filename so the browser saves it; "link" mode has no
// filename to give (it points at somebody else's server) so it opens instead.
// `data-resume` is the hook the live preview and tests use to find the button.
function pfResumeAttrs(c) {
  if (!c.hasResume) return "";
  return `href="${pfEsc(c.resumeHref)}" data-resume` +
    (c.resumeDownload ? ` download="${pfEsc(c.resumeDownload)}"` : ` target="_blank" rel="noopener"`);
}

function pfResumeBtn(c, cls = "pf-btn pf-btn-ghost") {
  if (!c.hasResume) return "";
  return `<a class="${cls}" ${pfResumeAttrs(c)}>${PF_ICONS.download}<span>${pfEsc(c.resumeLabel)}</span></a>`;
}

function pfSocialRow(c, cls = "pf-socials") {
  if (!c.socials.length) return "";
  return `<ul class="${cls}">${c.socials.map(s => `
    <li><a href="${pfEsc(s.url)}" target="_blank" rel="noopener me" aria-label="${pfEsc(s.label)}" title="${pfEsc(s.label)}">${s.icon}</a></li>`).join("")}</ul>`;
}

function pfAvatar(c, cls = "pf-avatar") {
  if (c.d.avatar) return `<img class="${cls}" src="${pfEsc(c.d.avatar)}" alt="${pfEsc(c.name)}" width="240" height="240" loading="eager">`;
  return `<div class="${cls} pf-avatar-initials" aria-hidden="true">${pfEsc(c.initials)}</div>`;
}

// Experience/education/project entries all render "Role · Org · Period" from
// fields that may each be missing. This keeps the separators from turning into
// " ·  · " when only one of them is filled in.
function pfJoin(parts, sep = " · ") {
  return parts.filter(p => p && String(p).trim()).map(p => pfEsc(p)).join(sep);
}

function pfProjectLinks(p, iconCls = "") {
  const out = [];
  if (p.link) out.push(`<a class="${iconCls}" href="${pfEsc(pfUrl(p.link))}" target="_blank" rel="noopener">${PF_ICONS.link}<span>Live</span></a>`);
  if (p.repo) out.push(`<a class="${iconCls}" href="${pfEsc(pfUrl(p.repo))}" target="_blank" rel="noopener">${PF_ICONS.github}<span>Code</span></a>`);
  return out.join("");
}

// ============================================================================
// The ten templates
// ============================================================================
// Each renderer takes the computed context and returns { fonts, css, body, js }.
// They share content, never markup: a template that wants a different structure
// writes a different structure, because "one layout with ten skins" is exactly
// what makes template pickers feel fake.
const PF_RENDERERS = {};

// ---------------------------------------------------------------------------
// 1. AURORA — glassmorphic dark, animated gradient mesh, particle field
// ---------------------------------------------------------------------------
PF_RENDERERS.aurora = (c) => {
  const d = c.d;
  const nav = c.navItems.map(n => `<a href="#${n.id}">${pfEsc(n.label)}</a>`).join("");

  const css = `
:root{
  --acc:${c.accent}; --acc2:${c.accent2};
  --bg:#080B14; --bg2:#0D1220; --panel:rgba(255,255,255,.045); --line:rgba(255,255,255,.10);
  --ink:#EEF1F8; --muted:#9AA6BF; --radius:20px;
  --font:${c.fontStack || `'Space Grotesk','Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif`};
}
body{background:var(--bg);color:var(--ink);font-family:var(--font);font-size:16px;line-height:1.65;overflow-x:hidden}
.pf-skip{background:var(--acc);color:${c.accentInk}}

/* The mesh: three slow-drifting radial blobs behind a fixed layer. Cheap
   (no repaint of content) and it gives the page depth a flat colour can't. */
.pf-mesh{position:fixed;inset:0;z-index:0;pointer-events:none;overflow:hidden;background:
  radial-gradient(1200px 700px at 8% -10%, ${pfRgba(c.accent, .30)}, transparent 60%),
  radial-gradient(900px 600px at 100% 0%, ${pfRgba(c.accent2, .22)}, transparent 55%),
  radial-gradient(900px 900px at 50% 110%, ${pfRgba(c.accent, .16)}, transparent 60%)}
.pf-mesh::after{content:"";position:absolute;inset:-30%;background:
  radial-gradient(420px 420px at 30% 40%, ${pfRgba(c.accent2, .18)}, transparent 60%);
  animation:pf-drift 24s ease-in-out infinite alternate}
@keyframes pf-drift{from{transform:translate3d(-6%,-4%,0) scale(1)}to{transform:translate3d(10%,8%,0) scale(1.18)}}
#pf-particles{position:fixed;inset:0;z-index:0;pointer-events:none;opacity:.55}
.pf-wrap{position:relative;z-index:1}

.pf-shell{width:min(1120px,92vw);margin:0 auto}

/* nav */
.pf-nav{position:sticky;top:0;z-index:40;backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);
  background:rgba(8,11,20,.62);border-bottom:1px solid transparent;transition:border-color .3s,background .3s}
.pf-nav.pf-stuck{border-bottom-color:var(--line);background:rgba(8,11,20,.86)}
.pf-nav-in{display:flex;align-items:center;gap:1.4rem;padding:.85rem 0;width:min(1120px,92vw);margin:0 auto;flex-wrap:wrap;row-gap:.5rem}
.pf-brand{display:flex;align-items:center;gap:.6rem;font-weight:700;letter-spacing:-.02em;text-decoration:none;margin-right:auto}
.pf-brand-dot{width:30px;height:30px;border-radius:9px;display:grid;place-items:center;font-size:.78rem;font-weight:800;
  background:linear-gradient(135deg,var(--acc),var(--acc2));color:${c.accentInk}}
.pf-nav-links{display:flex;gap:1.35rem;flex-wrap:wrap;min-width:0;row-gap:.4rem}
.pf-nav-links a{position:relative;text-decoration:none;color:var(--muted);font-size:.9rem;font-weight:500;transition:color .2s}
.pf-nav-links a::after{content:"";position:absolute;left:0;right:100%;bottom:-5px;height:2px;background:var(--acc);
  border-radius:2px;transition:right .28s cubic-bezier(.2,.7,.2,1)}
.pf-nav-links a:hover,.pf-nav-links a.pf-active{color:var(--ink)}
.pf-nav-links a:hover::after,.pf-nav-links a.pf-active::after{right:0}
.pf-burger{display:none;background:none;border:1px solid var(--line);border-radius:10px;padding:.45rem .6rem;cursor:pointer}

/* buttons */
.pf-btn{display:inline-flex;align-items:center;gap:.55rem;padding:.78rem 1.35rem;border-radius:999px;
  text-decoration:none;font-weight:600;font-size:.94rem;border:1px solid transparent;cursor:pointer;
  transition:transform .18s cubic-bezier(.2,.7,.2,1),box-shadow .25s,background .2s,border-color .2s}
.pf-btn svg{width:18px;height:18px}
.pf-btn:hover{transform:translateY(-2px)}
.pf-btn-primary{background:linear-gradient(135deg,var(--acc),var(--acc2));color:${c.accentInk};
  box-shadow:0 10px 30px ${pfRgba(c.accent, .35)}}
.pf-btn-primary:hover{box-shadow:0 16px 40px ${pfRgba(c.accent, .48)}}
.pf-btn-ghost{background:var(--panel);border-color:var(--line);color:var(--ink)}
.pf-btn-ghost:hover{border-color:${pfRgba(c.accent, .55)};background:${pfRgba(c.accent, .10)}}

/* hero */
.pf-hero{padding:clamp(3.5rem,9vw,7rem) 0 clamp(3rem,6vw,5rem);display:grid;gap:3rem;
  grid-template-columns:minmax(0,1.35fr) minmax(0,.65fr);align-items:center;overflow-x:clip}
.pf-pill{display:inline-flex;align-items:center;gap:.5rem;padding:.4rem .85rem;border-radius:999px;font-size:.8rem;
  font-weight:600;color:var(--acc);background:${pfRgba(c.accent, .12)};border:1px solid ${pfRgba(c.accent, .28)};margin-bottom:1.3rem}
.pf-pill i{width:7px;height:7px;border-radius:50%;background:var(--acc);box-shadow:0 0 0 0 ${pfRgba(c.accent, .7)};
  animation:pf-ping 2.4s infinite}
@keyframes pf-ping{0%{box-shadow:0 0 0 0 ${pfRgba(c.accent, .65)}}70%{box-shadow:0 0 0 9px ${pfRgba(c.accent, 0)}}100%{box-shadow:0 0 0 0 ${pfRgba(c.accent, 0)}}}
.pf-h1{font-size:clamp(2.6rem,7vw,4.6rem);line-height:1.02;letter-spacing:-.035em;font-weight:800;margin-bottom:.7rem}
.pf-h1 span{background:linear-gradient(120deg,var(--acc) 10%,var(--acc2) 55%,var(--ink) 95%);
  -webkit-background-clip:text;background-clip:text;color:transparent}
.pf-role{font-size:clamp(1.05rem,2.4vw,1.4rem);color:var(--ink);font-weight:600;margin-bottom:.9rem}
.pf-tagline{color:var(--muted);font-size:1.06rem;max-width:54ch;margin-bottom:2rem}
.pf-cta{display:flex;flex-wrap:wrap;gap:.85rem;align-items:center}
.pf-hero-art{position:relative;display:grid;place-items:center}
.pf-avatar{width:min(300px,68vw);aspect-ratio:1;border-radius:32px;object-fit:cover;
  border:1px solid var(--line);box-shadow:0 30px 80px rgba(0,0,0,.55)}
.pf-avatar-initials{display:grid;place-items:center;font-size:4.6rem;font-weight:800;color:${c.accentInk};
  background:linear-gradient(140deg,var(--acc),var(--acc2))}
.pf-hero-art::before{content:"";position:absolute;inset:-14%;border-radius:50%;
  background:radial-gradient(circle,${pfRgba(c.accent, .35)},transparent 62%);filter:blur(26px);z-index:-1}
.pf-socials{display:flex;gap:.6rem;margin-top:1.6rem}
.pf-socials a{display:grid;place-items:center;width:42px;height:42px;border-radius:12px;background:var(--panel);
  border:1px solid var(--line);color:var(--muted);transition:.22s}
.pf-socials a svg{width:19px;height:19px}
.pf-socials a:hover{color:var(--acc);border-color:${pfRgba(c.accent, .5)};transform:translateY(-3px);background:${pfRgba(c.accent, .1)}}

/* sections */
.pf-sec{padding:clamp(3rem,7vw,5.5rem) 0;position:relative}
.pf-sec-head{margin-bottom:2.6rem}
.pf-kicker{display:block;font-size:.78rem;font-weight:700;letter-spacing:.22em;text-transform:uppercase;color:var(--acc);margin-bottom:.6rem}
.pf-h2{font-size:clamp(1.7rem,4vw,2.5rem);letter-spacing:-.03em;font-weight:700}
.pf-lead{color:var(--muted);font-size:1.08rem;max-width:66ch;white-space:pre-line}

.pf-card{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);padding:1.6rem;
  backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);position:relative;overflow:hidden;transition:.3s}
.pf-card:hover{border-color:${pfRgba(c.accent, .42)};transform:translateY(-4px)}
/* Cursor-follow glow. The two custom properties are written by JS on
   pointermove; with none set it simply never paints. */
.pf-card::before{content:"";position:absolute;width:420px;height:420px;border-radius:50%;pointer-events:none;
  left:var(--mx,-999px);top:var(--my,-999px);transform:translate(-50%,-50%);opacity:0;transition:opacity .35s;
  background:radial-gradient(circle,${pfRgba(c.accent, .17)},transparent 62%)}
.pf-card:hover::before{opacity:1}
.pf-card>*{position:relative}

.pf-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:1rem}
.pf-stat{text-align:center;padding:1.5rem 1rem}
.pf-stat b{display:block;font-size:clamp(1.9rem,4vw,2.7rem);font-weight:800;letter-spacing:-.03em;
  background:linear-gradient(135deg,var(--acc),var(--acc2));-webkit-background-clip:text;background-clip:text;color:transparent}
.pf-stat span{color:var(--muted);font-size:.86rem;font-weight:500}

.pf-chips{display:flex;flex-wrap:wrap;gap:.6rem}
.pf-chip{padding:.5rem 1rem;border-radius:999px;background:var(--panel);border:1px solid var(--line);
  font-size:.88rem;font-weight:500;color:var(--ink);transition:.22s}
.pf-chip:hover{border-color:${pfRgba(c.accent, .5)};color:var(--acc);transform:translateY(-2px)}

.pf-grid{display:grid;gap:1.3rem;grid-template-columns:repeat(auto-fit,minmax(310px,1fr))}
.pf-proj h3{font-size:1.22rem;font-weight:700;letter-spacing:-.02em;margin-bottom:.35rem}
.pf-proj-meta{font-size:.8rem;color:var(--acc);font-weight:600;margin-bottom:.7rem}
.pf-proj p{color:var(--muted);font-size:.95rem;margin-bottom:1rem}
.pf-proj ul{margin-bottom:1rem}
.pf-proj li{color:var(--muted);font-size:.92rem;padding-left:1.1rem;position:relative;margin-bottom:.3rem}
.pf-proj li::before{content:"";position:absolute;left:0;top:.62em;width:5px;height:5px;border-radius:50%;background:var(--acc)}
.pf-tags{display:flex;flex-wrap:wrap;gap:.4rem;margin-bottom:1rem}
.pf-tag{font-size:.74rem;font-weight:600;padding:.25rem .6rem;border-radius:6px;
  background:${pfRgba(c.accent, .13)};color:var(--acc);letter-spacing:.02em}
.pf-proj-links{display:flex;gap:1rem;font-size:.86rem;font-weight:600}
.pf-proj-links a{display:inline-flex;align-items:center;gap:.35rem;color:var(--ink);text-decoration:none;transition:color .2s}
.pf-proj-links a svg{width:15px;height:15px}
.pf-proj-links a:hover{color:var(--acc)}

.pf-xp{display:grid;gap:1.1rem}
.pf-xp-item{display:grid;grid-template-columns:minmax(0,190px) minmax(0,1fr);gap:1.6rem;padding:1.5rem 1.6rem}
.pf-xp-when{color:var(--acc);font-weight:600;font-size:.88rem}
.pf-xp-where{color:var(--muted);font-size:.84rem;margin-top:.2rem}
.pf-xp h3{font-size:1.1rem;font-weight:700;margin-bottom:.15rem}
.pf-xp-org{color:var(--muted);font-size:.92rem;margin-bottom:.75rem}
.pf-xp ul li{color:var(--muted);font-size:.94rem;padding-left:1.15rem;position:relative;margin-bottom:.4rem}
.pf-xp ul li::before{content:"";position:absolute;left:0;top:.62em;width:5px;height:5px;border-radius:50%;background:var(--acc)}
.pf-xp-sum{color:var(--muted);font-size:.94rem}

.pf-two{display:grid;gap:1.3rem;grid-template-columns:repeat(auto-fit,minmax(280px,1fr))}
.pf-edu h3{font-size:1.05rem;font-weight:700;margin-bottom:.2rem}
.pf-edu p{color:var(--muted);font-size:.92rem}
.pf-edu .pf-xp-when{margin-bottom:.5rem}
.pf-certs{display:grid;gap:.7rem}
.pf-cert{display:flex;gap:.8rem;align-items:flex-start;color:var(--muted);font-size:.95rem}
.pf-cert::before{content:"";flex:0 0 auto;width:8px;height:8px;margin-top:.55em;border-radius:3px;
  background:linear-gradient(135deg,var(--acc),var(--acc2))}

/* contact */
.pf-contact{text-align:center;padding:clamp(2.5rem,6vw,4rem) clamp(1.4rem,4vw,3rem);
  background:linear-gradient(160deg,${pfRgba(c.accent, .16)},${pfRgba(c.accent2, .07)});
  border:1px solid ${pfRgba(c.accent, .3)};border-radius:28px}
.pf-contact .pf-h2{margin-bottom:.8rem}
.pf-contact p{color:var(--muted);max-width:52ch;margin:0 auto 2rem}
.pf-contact-list{display:flex;flex-wrap:wrap;gap:1rem;justify-content:center;margin-top:2rem}
.pf-contact-list a,.pf-contact-list span{display:inline-flex;align-items:center;gap:.5rem;color:var(--muted);
  text-decoration:none;font-size:.94rem;transition:color .2s}
.pf-contact-list svg{width:17px;height:17px;color:var(--acc)}
.pf-contact-list a:hover{color:var(--ink)}

footer{padding:2.5rem 0 3rem;border-top:1px solid var(--line);margin-top:4rem;
  display:flex;flex-wrap:wrap;gap:1rem;justify-content:space-between;align-items:center;color:var(--muted);font-size:.86rem}
footer a{color:var(--muted)}

@media (max-width:900px){
  .pf-hero{grid-template-columns:1fr;text-align:center;padding-top:2.5rem}
  .pf-hero-art{order:-1}
  .pf-cta,.pf-socials,.pf-chips{justify-content:center}
  .pf-tagline{margin-left:auto;margin-right:auto}
  .pf-xp-item{grid-template-columns:1fr;gap:.7rem}
  .pf-nav-links{position:fixed;inset:64px 0 auto;flex-direction:column;gap:0;padding:1rem 6vw 1.6rem;
    background:rgba(8,11,20,.97);border-bottom:1px solid var(--line);display:none}
  .pf-nav-links.pf-open{display:flex}
  .pf-nav-links a{padding:.8rem 0;font-size:1rem}
  .pf-burger{display:block}
}`;

  const body = `
<div class="pf-mesh" aria-hidden="true"></div>
<canvas id="pf-particles" aria-hidden="true"></canvas>
<div class="pf-wrap">

<header class="pf-nav pf-noprint">
  <div class="pf-nav-in">
    <a class="pf-brand" href="#top"><span class="pf-brand-dot">${pfEsc(c.initials)}</span>${pfEsc(c.name)}</a>
    <nav class="pf-nav-links" id="pf-menu">${nav}</nav>
    ${c.hasResume ? pfResumeBtn(c, "pf-btn pf-btn-ghost") : ""}
    <button class="pf-burger" id="pf-burger" aria-label="Menu" aria-expanded="false" aria-controls="pf-menu">☰</button>
  </div>
</header>

<main id="main" class="pf-shell">
  <section class="pf-hero" id="top">
    <div>
      ${d.available ? `<span class="pf-pill"><i></i>${pfEsc(d.available)}</span>` : ""}
      <h1 class="pf-h1">${pfEsc(c.name.split(" ")[0])}<br><span>${pfEsc(c.name.split(" ").slice(1).join(" ") || c.name)}</span></h1>
      ${c.title ? `<p class="pf-role">${pfEsc(c.title)}</p>` : ""}
      ${c.tagline ? `<p class="pf-tagline">${pfEsc(c.tagline)}</p>` : ""}
      <div class="pf-cta">
        ${d.email ? `<a class="pf-btn pf-btn-primary" href="mailto:${pfEsc(d.email)}">${pfEsc(d.cta_text || "Get in touch")}${PF_ICONS.arrow}</a>` : ""}
        ${pfResumeBtn(c, "pf-btn pf-btn-ghost")}
      </div>
      ${pfSocialRow(c)}
    </div>
    <div class="pf-hero-art">${pfAvatar(c)}</div>
  </section>

  ${c.has("stats") ? `<section class="pf-sec" style="padding-top:0">
    <div class="pf-stats">${d.stats.map((s, i) => `
      <div class="pf-card pf-stat" data-reveal data-reveal-delay="${i * 70}">
        <b data-count="${pfEsc(s.value)}">${pfEsc(s.value)}</b><span>${pfEsc(s.label)}</span>
      </div>`).join("")}</div>
  </section>` : ""}

  ${c.has("about") ? `<section class="pf-sec" id="about">
    <div class="pf-sec-head" data-reveal><span class="pf-kicker">About</span><h2 class="pf-h2">A little context</h2></div>
    <p class="pf-lead" data-reveal>${pfEsc(d.about)}</p>
  </section>` : ""}

  ${c.has("skills") ? `<section class="pf-sec" id="skills">
    <div class="pf-sec-head" data-reveal><span class="pf-kicker">Toolkit</span><h2 class="pf-h2">What I work with</h2></div>
    <div class="pf-chips" data-reveal>${d.skills.map(s => `<span class="pf-chip">${pfEsc(s)}</span>`).join("")}</div>
  </section>` : ""}

  ${c.has("projects") ? `<section class="pf-sec" id="projects">
    <div class="pf-sec-head" data-reveal><span class="pf-kicker">Selected work</span><h2 class="pf-h2">Projects</h2></div>
    <div class="pf-grid">${d.projects.map((p, i) => `
      <article class="pf-card pf-proj" data-glow data-reveal data-reveal-delay="${(i % 3) * 90}">
        <h3>${pfEsc(p.name)}</h3>
        ${pfJoin([p.role, p.period]) ? `<div class="pf-proj-meta">${pfJoin([p.role, p.period])}</div>` : ""}
        ${p.description ? `<p>${pfEsc(p.description)}</p>` : ""}
        ${(p.bullets || []).length && !p.description ? `<ul>${p.bullets.map(b => `<li>${pfEsc(b)}</li>`).join("")}</ul>` : ""}
        ${(p.tags || []).length ? `<div class="pf-tags">${p.tags.map(t => `<span class="pf-tag">${pfEsc(t)}</span>`).join("")}</div>` : ""}
        ${pfProjectLinks(p) ? `<div class="pf-proj-links">${pfProjectLinks(p)}</div>` : ""}
      </article>`).join("")}</div>
  </section>` : ""}

  ${c.has("experience") ? `<section class="pf-sec" id="experience">
    <div class="pf-sec-head" data-reveal><span class="pf-kicker">Track record</span><h2 class="pf-h2">Experience</h2></div>
    <div class="pf-xp">${d.experience.map((e, i) => `
      <article class="pf-card pf-xp-item" data-glow data-reveal data-reveal-delay="${i * 70}">
        <div><div class="pf-xp-when">${pfEsc(e.period || "")}</div>${e.location ? `<div class="pf-xp-where">${pfEsc(e.location)}</div>` : ""}</div>
        <div>
          <h3>${pfEsc(e.role || "")}</h3>
          ${e.org ? `<div class="pf-xp-org">${pfEsc(e.org)}</div>` : ""}
          ${e.summary ? `<p class="pf-xp-sum">${pfEsc(e.summary)}</p>` : ""}
          ${(e.bullets || []).length ? `<ul>${e.bullets.map(b => `<li>${pfEsc(b)}</li>`).join("")}</ul>` : ""}
        </div>
      </article>`).join("")}</div>
  </section>` : ""}

  ${c.has("education") || c.has("certifications") ? `<section class="pf-sec" id="education">
    <div class="pf-sec-head" data-reveal><span class="pf-kicker">Background</span><h2 class="pf-h2">Education${c.has("certifications") ? " & certifications" : ""}</h2></div>
    <div class="pf-two">
      ${c.has("education") ? d.education.map((e, i) => `
        <div class="pf-card pf-edu" data-reveal data-reveal-delay="${i * 70}">
          <div class="pf-xp-when">${pfEsc(e.period || "")}</div>
          <h3>${pfEsc(e.degree || "")}</h3>
          <p>${pfJoin([e.school, e.detail])}</p>
        </div>`).join("") : ""}
      ${c.has("certifications") ? `<div class="pf-card" id="certifications" data-reveal>
        <h3 style="font-size:1.05rem;font-weight:700;margin-bottom:.9rem">Certifications</h3>
        <div class="pf-certs">${d.certifications.map(x => `<div class="pf-cert">${pfEsc(x)}</div>`).join("")}</div>
      </div>` : ""}
    </div>
  </section>` : ""}

  ${c.has("contact") ? `<section class="pf-sec" id="contact">
    <div class="pf-contact" data-reveal>
      <h2 class="pf-h2">Let's build something</h2>
      <p>${pfEsc(d.cta_text || "Open to new opportunities and interesting problems. The fastest way to reach me is email.")}</p>
      <div class="pf-cta" style="justify-content:center">
        ${d.email ? `<a class="pf-btn pf-btn-primary" href="mailto:${pfEsc(d.email)}">${pfEsc(d.email)}${PF_ICONS.arrow}</a>` : ""}
        ${pfResumeBtn(c, "pf-btn pf-btn-ghost")}
      </div>
      <div class="pf-contact-list">
        ${c.contacts.map(x => x.url ? `<a href="${pfEsc(x.url)}">${x.icon}${pfEsc(x.handle)}</a>` : `<span>${x.icon}${pfEsc(x.handle)}</span>`).join("")}
        ${c.socials.map(s => `<a href="${pfEsc(s.url)}" target="_blank" rel="noopener">${s.icon}${pfEsc(s.label)}</a>`).join("")}
      </div>
    </div>
  </section>` : ""}

  <footer>
    <span>© <span data-year>${c.year}</span> ${pfEsc(c.name)}${d.footer_note ? " · " + pfEsc(d.footer_note) : ""}</span>
    <span><a href="#top">Back to top ↑</a></span>
  </footer>
</main>
</div>`;

  const js = `
(function(){
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var navEl = document.querySelector('.pf-nav');
  var onScroll = function(){ navEl.classList.toggle('pf-stuck', window.scrollY > 12); };
  onScroll(); window.addEventListener('scroll', onScroll, { passive:true });

  var burger = document.getElementById('pf-burger'), menu = document.getElementById('pf-menu');
  if (burger) burger.addEventListener('click', function(){
    var open = menu.classList.toggle('pf-open');
    burger.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
  menu.addEventListener('click', function(e){ if (e.target.tagName === 'A') menu.classList.remove('pf-open'); });

  /* Scroll spy: highlights the section currently filling the viewport. */
  var links = [].slice.call(document.querySelectorAll('.pf-nav-links a'));
  var secs = links.map(function(a){ return document.querySelector(a.getAttribute('href')); }).filter(Boolean);
  if ('IntersectionObserver' in window && secs.length) {
    var spy = new IntersectionObserver(function(entries){
      entries.forEach(function(en){
        if (!en.isIntersecting) return;
        links.forEach(function(a){ a.classList.toggle('pf-active', a.getAttribute('href') === '#' + en.target.id); });
      });
    }, { rootMargin: '-45% 0px -50% 0px' });
    secs.forEach(function(s){ spy.observe(s); });
  }

  /* Cursor glow: writes the pointer position onto the card as CSS vars, so
     the gradient follows the mouse without a repaint of anything else. */
  document.querySelectorAll('[data-glow]').forEach(function(card){
    card.addEventListener('pointermove', function(e){
      var r = card.getBoundingClientRect();
      card.style.setProperty('--mx', (e.clientX - r.left) + 'px');
      card.style.setProperty('--my', (e.clientY - r.top) + 'px');
    });
  });

  /* Stat counters — count up once, when the tile is first seen. */
  document.querySelectorAll('[data-count]').forEach(function(el){
    var raw = el.getAttribute('data-count') || '';
    var m = raw.match(/-?[\\d.,]+/);
    if (!m || reduce) return;
    var target = parseFloat(m[0].replace(/,/g,'')), pre = raw.slice(0, m.index), post = raw.slice(m.index + m[0].length);
    var dec = (m[0].split('.')[1] || '').length;
    var run = function(){
      var t0 = performance.now(), dur = 1300;
      var step = function(now){
        var k = Math.min(1, (now - t0) / dur), eased = 1 - Math.pow(1 - k, 3);
        el.textContent = pre + (target * eased).toFixed(dec).replace(/\\B(?=(\\d{3})+(?!\\d))/g, ',') + post;
        if (k < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    };
    if ('IntersectionObserver' in window) {
      var o = new IntersectionObserver(function(en){ if (en[0].isIntersecting) { run(); o.disconnect(); } }, { threshold:.4 });
      o.observe(el);
    } else run();
  });

  /* Particle field. Density scales with viewport area and is capped, so a
     4K monitor doesn't get 900 particles and a phone doesn't get 12.
     Paused entirely when the tab is hidden or motion is reduced. */
  var cv = document.getElementById('pf-particles');
  if (cv && cv.getContext && !reduce) {
    var ctx = cv.getContext('2d'), dots = [], raf = null, dpr = Math.min(window.devicePixelRatio || 1, 2);
    var size = function(){
      cv.width = innerWidth * dpr; cv.height = innerHeight * dpr;
      cv.style.width = innerWidth + 'px'; cv.style.height = innerHeight + 'px';
      ctx.setTransform(dpr,0,0,dpr,0,0);
      var n = Math.min(90, Math.round(innerWidth * innerHeight / 19000));
      dots = [];
      for (var i=0;i<n;i++) dots.push({
        x: Math.random()*innerWidth, y: Math.random()*innerHeight,
        vx: (Math.random()-.5)*.22, vy: (Math.random()-.5)*.22, r: Math.random()*1.7+.5
      });
    };
    var tick = function(){
      ctx.clearRect(0,0,innerWidth,innerHeight);
      for (var i=0;i<dots.length;i++){
        var p = dots[i];
        p.x += p.vx; p.y += p.vy;
        if (p.x < -10) p.x = innerWidth+10; if (p.x > innerWidth+10) p.x = -10;
        if (p.y < -10) p.y = innerHeight+10; if (p.y > innerHeight+10) p.y = -10;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.284);
        ctx.fillStyle = 'rgba(255,255,255,.34)'; ctx.fill();
        for (var j=i+1;j<dots.length;j++){
          var q = dots[j], dx = p.x-q.x, dy = p.y-q.y, dd = dx*dx+dy*dy;
          if (dd < 15000) {
            ctx.beginPath(); ctx.moveTo(p.x,p.y); ctx.lineTo(q.x,q.y);
            ctx.strokeStyle = 'rgba(255,255,255,' + (0.13 * (1 - dd/15000)).toFixed(3) + ')';
            ctx.lineWidth = 1; ctx.stroke();
          }
        }
      }
      raf = requestAnimationFrame(tick);
    };
    var start = function(){ if (!raf) tick(); };
    var stop = function(){ if (raf) { cancelAnimationFrame(raf); raf = null; } };
    size(); start();
    addEventListener('resize', function(){ size(); }, { passive:true });
    document.addEventListener('visibilitychange', function(){ document.hidden ? stop() : start(); });
  }
})();`;

  return { fonts: [c.googleFont ? null : "Space+Grotesk:wght@400;500;600;700", "Inter:wght@400;500;600;700;800"].filter(Boolean), css, body, js, themeColor: "#080B14" };
};

// ---------------------------------------------------------------------------
// 2. MONOGRAM — editorial minimalism. Type, rules, whitespace. Almost no motion.
// ---------------------------------------------------------------------------
PF_RENDERERS.monogram = (c) => {
  const d = c.d;
  // Sections are numbered in the order they actually appear, so switching one
  // off doesn't leave a gap in the sequence.
  let n = 0;
  const num = () => String(++n).padStart(2, "0");

  const css = `
:root{
  --acc:${c.accent}; --ink:#14161A; --muted:#6C7178; --faint:#9AA0A8;
  --line:#E4E6E9; --bg:#FFFFFF; --wash:#F7F7F5;
  --font:${c.fontStack || `'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif`};
  --display:'Fraunces',Georgia,'Times New Roman',serif;
}
body{background:var(--bg);color:var(--ink);font-family:var(--font);font-size:16.5px;line-height:1.7}
.pf-skip{background:var(--ink);color:#fff}
.pf-prog{position:fixed;top:0;left:0;height:2px;width:0;background:var(--acc);z-index:99;transition:width .1s linear}
.pf-shell{width:min(940px,88vw);margin:0 auto}

header.pf-top{position:sticky;top:0;z-index:40;background:rgba(255,255,255,.9);backdrop-filter:blur(10px);
  -webkit-backdrop-filter:blur(10px);border-bottom:1px solid var(--line)}
.pf-top-in{width:min(940px,88vw);margin:0 auto;display:flex;align-items:center;gap:2rem;padding:1.05rem 0;flex-wrap:wrap;row-gap:.5rem}
.pf-mono{font-family:var(--display);font-weight:600;font-size:1.02rem;letter-spacing:-.01em;text-decoration:none;margin-right:auto}
.pf-mono b{color:var(--acc)}
.pf-top nav{display:flex;gap:1.6rem;flex-wrap:wrap;min-width:0;row-gap:.4rem}
.pf-top nav a{text-decoration:none;color:var(--muted);font-size:.83rem;letter-spacing:.04em;text-transform:uppercase;
  font-weight:600;padding-bottom:2px;border-bottom:1px solid transparent;transition:.2s}
.pf-top nav a:hover,.pf-top nav a.pf-active{color:var(--ink);border-bottom-color:var(--acc)}

.pf-hero{padding:clamp(4rem,12vw,9rem) 0 clamp(3rem,7vw,5rem);border-bottom:1px solid var(--line)}
.pf-eyebrow{font-size:.78rem;letter-spacing:.24em;text-transform:uppercase;color:var(--faint);font-weight:600;margin-bottom:1.8rem;display:block}
.pf-name{font-family:var(--display);font-size:clamp(3rem,10vw,6.4rem);line-height:.95;letter-spacing:-.045em;
  font-weight:600;margin-bottom:1.6rem}
.pf-name em{font-style:italic;color:var(--acc)}
.pf-sub{display:flex;flex-wrap:wrap;gap:.5rem 1.6rem;align-items:baseline;margin-bottom:2rem;
  color:var(--muted);font-size:1rem}
.pf-sub strong{color:var(--ink);font-weight:600}
.pf-intro{font-size:clamp(1.05rem,2.2vw,1.3rem);line-height:1.6;max-width:60ch;color:var(--ink);margin-bottom:2.5rem}
.pf-hero-actions{display:flex;flex-wrap:wrap;gap:2rem;align-items:center}
.pf-link{display:inline-flex;align-items:center;gap:.5rem;text-decoration:none;font-weight:600;font-size:.95rem;
  color:var(--ink);border-bottom:1px solid var(--ink);padding-bottom:2px;transition:.2s;cursor:pointer;
  background:none;border-top:0;border-left:0;border-right:0}
.pf-link svg{width:16px;height:16px}
.pf-link:hover{color:var(--acc);border-bottom-color:var(--acc);gap:.75rem}

.pf-sec{padding:clamp(3rem,7vw,5rem) 0;border-bottom:1px solid var(--line)}
.pf-sec:last-of-type{border-bottom:0}
.pf-row{display:grid;grid-template-columns:minmax(0,200px) minmax(0,1fr);gap:clamp(1.5rem,5vw,4rem);align-items:start}
.pf-label{font-size:.78rem;letter-spacing:.2em;text-transform:uppercase;color:var(--faint);font-weight:700;
  position:sticky;top:5.5rem}
.pf-label i{font-style:normal;color:var(--acc);margin-right:.5rem}
.pf-body p{max-width:62ch;white-space:pre-line}
.pf-body>p+p{margin-top:1.1rem}
.pf-body .pf-first::first-letter{font-family:var(--display);font-size:3.4em;line-height:.82;float:left;
  padding:.06em .12em 0 0;font-weight:600;color:var(--acc)}

.pf-skills{display:flex;flex-wrap:wrap;gap:.45rem .5rem}
.pf-skills li{font-size:.9rem;padding:.34rem .8rem;border:1px solid var(--line);border-radius:2px;color:var(--muted);
  transition:.2s;background:var(--wash)}
.pf-skills li:hover{border-color:var(--ink);color:var(--ink)}

.pf-entry{padding:1.6rem 0;border-top:1px solid var(--line)}
.pf-entry:first-child{border-top:0;padding-top:0}
.pf-entry-head{display:flex;flex-wrap:wrap;gap:.4rem 1rem;align-items:baseline;justify-content:space-between;margin-bottom:.5rem}
.pf-entry h3{font-family:var(--display);font-size:1.28rem;font-weight:600;letter-spacing:-.015em}
.pf-entry .pf-when{font-size:.84rem;color:var(--faint);font-variant-numeric:tabular-nums;white-space:nowrap}
.pf-entry .pf-org{color:var(--acc);font-size:.94rem;font-weight:600;margin-bottom:.6rem}
.pf-entry p{color:var(--muted);font-size:.97rem;max-width:62ch}
.pf-entry ul{margin-top:.6rem}
.pf-entry ul li{color:var(--muted);font-size:.96rem;padding-left:1.3rem;position:relative;margin-bottom:.35rem;max-width:62ch}
.pf-entry ul li::before{content:"—";position:absolute;left:0;color:var(--acc)}
.pf-entry-tags{margin-top:.8rem;font-size:.8rem;color:var(--faint);letter-spacing:.03em}
.pf-entry-links{display:flex;gap:1.4rem;margin-top:.9rem}
.pf-entry-links a{font-size:.86rem;font-weight:600;text-decoration:none;color:var(--ink);
  border-bottom:1px solid var(--line);transition:.2s;display:inline-flex;align-items:center;gap:.35rem}
.pf-entry-links a svg{width:14px;height:14px}
.pf-entry-links a:hover{color:var(--acc);border-bottom-color:var(--acc)}

.pf-stat-row{display:flex;flex-wrap:wrap;gap:2.5rem}
.pf-stat-row div b{display:block;font-family:var(--display);font-size:2.4rem;font-weight:600;letter-spacing:-.03em;line-height:1}
.pf-stat-row div span{font-size:.82rem;color:var(--faint);letter-spacing:.08em;text-transform:uppercase;font-weight:600}

.pf-contact-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:1.4rem}
.pf-contact-grid a,.pf-contact-grid span{display:block;text-decoration:none;padding-top:1rem;border-top:1px solid var(--line)}
.pf-contact-grid small{display:block;font-size:.74rem;letter-spacing:.18em;text-transform:uppercase;color:var(--faint);
  font-weight:700;margin-bottom:.4rem}
.pf-contact-grid strong{font-weight:500;font-size:1rem;color:var(--ink);transition:color .2s;word-break:break-word}
.pf-contact-grid a:hover strong{color:var(--acc)}

footer{padding:2.5rem 0 3.5rem;color:var(--faint);font-size:.84rem;display:flex;flex-wrap:wrap;
  gap:1rem;justify-content:space-between;border-top:1px solid var(--line)}
footer a{color:var(--faint);text-decoration:none}
footer a:hover{color:var(--ink)}

@media (max-width:760px){
  .pf-row{grid-template-columns:1fr;gap:1rem}
  .pf-label{position:static}
  .pf-top nav{display:none}
}`;

  const entryLinks = (p) => {
    const bits = [];
    if (p.link) bits.push(`<a href="${pfEsc(pfUrl(p.link))}" target="_blank" rel="noopener">${PF_ICONS.link}Live site</a>`);
    if (p.repo) bits.push(`<a href="${pfEsc(pfUrl(p.repo))}" target="_blank" rel="noopener">${PF_ICONS.github}Source</a>`);
    return bits.length ? `<div class="pf-entry-links">${bits.join("")}</div>` : "";
  };

  const body = `
<div class="pf-prog" id="pf-prog" aria-hidden="true"></div>
<header class="pf-top pf-noprint">
  <div class="pf-top-in">
    <a class="pf-mono" href="#top">${pfEsc(c.name)}<b>.</b></a>
    <nav>${c.navItems.map(x => `<a href="#${x.id}">${pfEsc(x.label)}</a>`).join("")}</nav>
    ${c.hasResume ? `<a class="pf-link" ${pfResumeAttrs(c)}>${PF_ICONS.download}Résumé</a>` : ""}
  </div>
</header>

<main id="main" class="pf-shell">
  <section class="pf-hero" id="top">
    <span class="pf-eyebrow">${pfEsc(d.available || c.title || "Portfolio")}</span>
    <h1 class="pf-name">${pfEsc(c.name.split(" ").slice(0, -1).join(" ") || c.name)}${c.name.split(" ").length > 1 ? `<br><em>${pfEsc(c.name.split(" ").slice(-1)[0])}</em>` : ""}</h1>
    <div class="pf-sub">
      ${c.title ? `<strong>${pfEsc(c.title)}</strong>` : ""}
      ${d.location ? `<span>${pfEsc(d.location)}</span>` : ""}
    </div>
    ${c.tagline ? `<p class="pf-intro">${pfEsc(c.tagline)}</p>` : ""}
    <div class="pf-hero-actions">
      ${d.email ? `<a class="pf-link" href="mailto:${pfEsc(d.email)}">${pfEsc(d.cta_text || "Get in touch")}${PF_ICONS.arrow}</a>` : ""}
      ${c.hasResume ? `<a class="pf-link" ${pfResumeAttrs(c)}>${PF_ICONS.download}${pfEsc(c.resumeLabel)}</a>` : ""}
      ${d.email ? `<button class="pf-link" data-copy="${pfEsc(d.email)}" type="button">Copy email</button>` : ""}
    </div>
  </section>

  ${c.has("about") ? `<section class="pf-sec" id="about"><div class="pf-row">
    <div class="pf-label"><i>${num()}</i>About</div>
    <div class="pf-body" data-reveal>${(d.about || "").split(/\n{2,}/).map((para, i) =>
      `<p${i === 0 ? ` class="pf-first"` : ""}>${pfEsc(para.trim())}</p>`).join("")}</div>
  </div></section>` : ""}

  ${c.has("stats") ? `<section class="pf-sec"><div class="pf-row">
    <div class="pf-label"><i>${num()}</i>By the numbers</div>
    <div class="pf-stat-row" data-reveal>${d.stats.map(s =>
      `<div><b>${pfEsc(s.value)}</b><span>${pfEsc(s.label)}</span></div>`).join("")}</div>
  </div></section>` : ""}

  ${c.has("skills") ? `<section class="pf-sec" id="skills"><div class="pf-row">
    <div class="pf-label"><i>${num()}</i>Skills</div>
    <ul class="pf-skills" data-reveal>${d.skills.map(s => `<li>${pfEsc(s)}</li>`).join("")}</ul>
  </div></section>` : ""}

  ${c.has("projects") ? `<section class="pf-sec" id="projects"><div class="pf-row">
    <div class="pf-label"><i>${num()}</i>Selected work</div>
    <div data-reveal>${d.projects.map(p => `
      <article class="pf-entry">
        <div class="pf-entry-head"><h3>${pfEsc(p.name)}</h3><span class="pf-when">${pfEsc(p.period || "")}</span></div>
        ${p.role ? `<div class="pf-org">${pfEsc(p.role)}</div>` : ""}
        ${p.description ? `<p>${pfEsc(p.description)}</p>` : ""}
        ${(p.bullets || []).length ? `<ul>${p.bullets.map(b => `<li>${pfEsc(b)}</li>`).join("")}</ul>` : ""}
        ${(p.tags || []).length ? `<div class="pf-entry-tags">${p.tags.map(pfEsc).join(" / ")}</div>` : ""}
        ${entryLinks(p)}
      </article>`).join("")}</div>
  </div></section>` : ""}

  ${c.has("experience") ? `<section class="pf-sec" id="experience"><div class="pf-row">
    <div class="pf-label"><i>${num()}</i>Experience</div>
    <div data-reveal>${d.experience.map(e => `
      <article class="pf-entry">
        <div class="pf-entry-head"><h3>${pfEsc(e.role || "")}</h3><span class="pf-when">${pfEsc(e.period || "")}</span></div>
        <div class="pf-org">${pfJoin([e.org, e.location])}</div>
        ${e.summary ? `<p>${pfEsc(e.summary)}</p>` : ""}
        ${(e.bullets || []).length ? `<ul>${e.bullets.map(b => `<li>${pfEsc(b)}</li>`).join("")}</ul>` : ""}
      </article>`).join("")}</div>
  </div></section>` : ""}

  ${c.has("education") ? `<section class="pf-sec" id="education"><div class="pf-row">
    <div class="pf-label"><i>${num()}</i>Education</div>
    <div data-reveal>${d.education.map(e => `
      <article class="pf-entry">
        <div class="pf-entry-head"><h3>${pfEsc(e.degree || "")}</h3><span class="pf-when">${pfEsc(e.period || "")}</span></div>
        <div class="pf-org">${pfEsc(e.school || "")}</div>
        ${e.detail ? `<p>${pfEsc(e.detail)}</p>` : ""}
      </article>`).join("")}</div>
  </div></section>` : ""}

  ${c.has("certifications") ? `<section class="pf-sec" id="certifications"><div class="pf-row">
    <div class="pf-label"><i>${num()}</i>Certifications</div>
    <div data-reveal>${d.certifications.map(x => `<article class="pf-entry"><h3 style="font-size:1.05rem">${pfEsc(x)}</h3></article>`).join("")}</div>
  </div></section>` : ""}

  ${c.has("contact") ? `<section class="pf-sec" id="contact"><div class="pf-row">
    <div class="pf-label"><i>${num()}</i>Contact</div>
    <div data-reveal>
      <p class="pf-intro" style="margin-bottom:2rem">${pfEsc(d.cta_text || "Always glad to talk about new work, collaborations, or a problem you're stuck on.")}</p>
      <div class="pf-contact-grid">
        ${c.links.map(x => x.url
          ? `<a href="${pfEsc(x.url)}"${x.key === "email" || x.key === "phone" ? "" : ` target="_blank" rel="noopener"`}><small>${pfEsc(x.label)}</small><strong>${pfEsc(x.handle)}</strong></a>`
          : `<span><small>${pfEsc(x.label)}</small><strong>${pfEsc(x.handle)}</strong></span>`).join("")}
      </div>
    </div>
  </div></section>` : ""}

  <footer>
    <span>© <span data-year>${c.year}</span> ${pfEsc(c.name)}${d.footer_note ? " — " + pfEsc(d.footer_note) : ""}</span>
    <a href="#top">Top ↑</a>
  </footer>
</main>`;

  const js = `
(function(){
  var bar = document.getElementById('pf-prog');
  var tick = function(){
    var h = document.documentElement.scrollHeight - innerHeight;
    bar.style.width = (h > 0 ? (scrollY / h) * 100 : 0) + '%';
  };
  tick(); addEventListener('scroll', tick, { passive:true }); addEventListener('resize', tick);

  var links = [].slice.call(document.querySelectorAll('.pf-top nav a'));
  var secs = links.map(function(a){ return document.querySelector(a.getAttribute('href')); }).filter(Boolean);
  if ('IntersectionObserver' in window && secs.length) {
    var spy = new IntersectionObserver(function(es){
      es.forEach(function(e){
        if (!e.isIntersecting) return;
        links.forEach(function(a){ a.classList.toggle('pf-active', a.getAttribute('href') === '#' + e.target.id); });
      });
    }, { rootMargin: '-40% 0px -55% 0px' });
    secs.forEach(function(s){ spy.observe(s); });
  }
})();`;

  return { fonts: ["Fraunces:opsz,wght@9..144,400;9..144,600", c.googleFont ? null : "Inter:wght@400;500;600;700"].filter(Boolean),
           css, body, js, themeColor: "#FFFFFF" };
};

// ---------------------------------------------------------------------------
// 3. TERMINAL — a real, working shell. Type `help` and it answers.
// ---------------------------------------------------------------------------
// The gimmick has to survive contact with a recruiter who doesn't type: every
// command is also a clickable chip, and the whole site is rendered as ordinary
// scrollable sections below the prompt. The terminal is the flourish, never
// the only way in.
PF_RENDERERS.terminal = (c) => {
  const d = c.d;
  const user = (c.name.split(" ")[0] || "guest").toLowerCase().replace(/[^a-z0-9]/g, "");
  let host = (pfPrettyUrl(d.website).split(".")[0] || "").replace(/[^a-z0-9-]/gi, "").toLowerCase();
  if (!host || host === user) host = "portfolio";

  const css = `
:root{
  --acc:${c.accent}; --acc2:${c.accent2};
  --bg:#0B0F14; --panel:#111820; --panel2:#0E141B; --line:#1E2A36;
  --ink:#D7E2ED; --muted:#7C8CA0; --amber:#FFB454;
  --font:${c.fontStack || `'JetBrains Mono','SFMono-Regular',Consolas,'Liberation Mono',monospace`};
}
body{background:var(--bg);color:var(--ink);font-family:var(--font);font-size:15px;line-height:1.75;
  background-image:radial-gradient(${pfRgba(c.accent, .07)} 1px,transparent 1px);background-size:34px 34px}
.pf-skip{background:var(--acc);color:${c.accentInk}}
.pf-shell{width:min(980px,92vw);margin:0 auto;padding-bottom:4rem}

.pf-win{margin:clamp(1.5rem,5vw,3.5rem) 0 2.5rem;border:1px solid var(--line);border-radius:12px;overflow:hidden;
  background:var(--panel);box-shadow:0 24px 70px rgba(0,0,0,.55)}
.pf-bar{display:flex;align-items:center;gap:.55rem;padding:.7rem 1rem;background:var(--panel2);border-bottom:1px solid var(--line)}
.pf-dot{width:11px;height:11px;border-radius:50%}
.pf-bar span.pf-t{margin-left:auto;margin-right:auto;font-size:.78rem;color:var(--muted);letter-spacing:.04em}
.pf-term{padding:1.3rem 1.4rem 1.1rem;min-height:270px;max-height:60vh;overflow-y:auto;font-size:.92rem;scrollbar-width:thin}
.pf-term::-webkit-scrollbar{width:8px}
.pf-term::-webkit-scrollbar-thumb{background:var(--line);border-radius:8px}
.pf-line{white-space:pre-wrap;word-break:break-word}
.pf-prompt{color:var(--acc);font-weight:700}
.pf-path{color:#5FB3F2}
.pf-out{color:var(--muted);padding-left:0}
.pf-out b{color:var(--ink);font-weight:700}
.pf-out .k{color:var(--amber)}
.pf-out a{color:var(--acc)}
.pf-cursor{display:inline-block;width:9px;height:1.05em;background:var(--acc);vertical-align:-.18em;
  animation:pf-blink 1.05s steps(2,start) infinite}
@keyframes pf-blink{to{visibility:hidden}}
.pf-inline{display:flex;align-items:baseline;gap:.5rem;flex-wrap:wrap}
#pf-input{flex:1;min-width:120px;background:none;border:0;outline:none;color:var(--ink);font:inherit;caret-color:var(--acc)}
.pf-hintbar{display:flex;flex-wrap:wrap;gap:.45rem;padding:.75rem 1.4rem 1rem;border-top:1px solid var(--line);background:var(--panel2)}
.pf-cmd{border:1px solid var(--line);background:transparent;color:var(--muted);border-radius:6px;padding:.28rem .68rem;
  font:inherit;font-size:.78rem;cursor:pointer;transition:.18s}
.pf-cmd:hover{border-color:var(--acc);color:var(--acc);background:${pfRgba(c.accent, .1)}}

.pf-head h1{font-size:clamp(1.9rem,5vw,3rem);letter-spacing:-.02em;font-weight:700;line-height:1.12;margin-bottom:.5rem}
.pf-head h1 b{color:var(--acc)}
.pf-head p.pf-role{color:var(--amber);font-size:1rem;margin-bottom:.6rem}
.pf-head p.pf-hero-tag{color:var(--muted);max-width:62ch}
.pf-head .pf-meta{margin-top:1.1rem;display:flex;flex-wrap:wrap;gap:.5rem 1.4rem;font-size:.84rem;color:var(--muted)}
.pf-head .pf-meta a{color:var(--acc);text-decoration:none}
.pf-head .pf-meta a:hover{text-decoration:underline}
.pf-actions{display:flex;flex-wrap:wrap;gap:.7rem;margin-top:1.5rem}
.pf-btn{display:inline-flex;align-items:center;gap:.5rem;border:1px solid var(--line);border-radius:8px;
  padding:.6rem 1.1rem;text-decoration:none;font-size:.86rem;font-weight:600;color:var(--ink);
  background:var(--panel);transition:.2s;cursor:pointer}
.pf-btn svg{width:16px;height:16px}
.pf-btn:hover{border-color:var(--acc);color:var(--acc);background:${pfRgba(c.accent, .1)};transform:translateY(-2px)}
.pf-btn-go{background:var(--acc);border-color:var(--acc);color:${c.accentInk}}
.pf-btn-go:hover{background:${pfShade(c.accent, .12)};color:${c.accentInk}}

.pf-sec{margin-top:3.2rem;scroll-margin-top:1.5rem}
.pf-sec>h2{font-size:1.02rem;font-weight:700;color:var(--ink);margin-bottom:1.2rem;display:flex;align-items:center;gap:.6rem}
.pf-sec>h2::before{content:"$";color:var(--acc);font-weight:700}
.pf-sec>h2::after{content:"";flex:1;height:1px;background:var(--line)}

.pf-block{border:1px solid var(--line);border-left:2px solid var(--acc);border-radius:0 10px 10px 0;
  background:var(--panel);padding:1.15rem 1.3rem;margin-bottom:.9rem;transition:.24s}
.pf-block:hover{border-left-color:var(--acc2);transform:translateX(3px);background:#131C25}
.pf-block h3{font-size:1rem;font-weight:700;margin-bottom:.2rem}
.pf-block .pf-sub{color:var(--amber);font-size:.85rem;margin-bottom:.55rem}
.pf-block .pf-when{float:right;color:var(--muted);font-size:.8rem}
.pf-block p{color:var(--muted);font-size:.9rem}
.pf-block ul{margin-top:.5rem}
.pf-block li{color:var(--muted);font-size:.88rem;padding-left:1.3rem;position:relative;margin-bottom:.25rem}
.pf-block li::before{content:"›";position:absolute;left:.2rem;color:var(--acc)}
.pf-tags{margin-top:.75rem;display:flex;flex-wrap:wrap;gap:.35rem}
.pf-tag{font-size:.72rem;padding:.18rem .5rem;border-radius:4px;background:${pfRgba(c.accent, .13)};color:var(--acc)}
.pf-links{display:flex;gap:1.1rem;margin-top:.8rem;font-size:.82rem}
.pf-links a{color:var(--ink);text-decoration:none;display:inline-flex;align-items:center;gap:.3rem}
.pf-links a svg{width:14px;height:14px}
.pf-links a:hover{color:var(--acc)}
.pf-skills{display:flex;flex-wrap:wrap;gap:.4rem}
.pf-skills li{font-size:.83rem;padding:.3rem .7rem;border:1px solid var(--line);border-radius:6px;color:var(--muted)}
.pf-skills li::before{content:"› ";color:var(--acc)}
.pf-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:.8rem}
.pf-statc{border:1px solid var(--line);border-radius:10px;padding:1.1rem;background:var(--panel);text-align:center}
.pf-statc b{display:block;font-size:1.9rem;color:var(--acc);font-weight:700;line-height:1.1}
.pf-statc span{font-size:.78rem;color:var(--muted)}
.pf-about{color:var(--muted);white-space:pre-line;max-width:72ch;border:1px solid var(--line);border-radius:10px;
  background:var(--panel);padding:1.3rem}
footer{margin-top:3.5rem;padding-top:1.4rem;border-top:1px solid var(--line);color:var(--muted);font-size:.8rem;
  display:flex;flex-wrap:wrap;gap:.8rem;justify-content:space-between}
footer a{color:var(--acc);text-decoration:none}
@media (max-width:640px){ .pf-block .pf-when{float:none;display:block;margin-bottom:.3rem} .pf-term{min-height:210px} }`;

  // The shell's data. Passed as JSON rather than baked into strings so the
  // command handlers stay short and nothing needs re-escaping at runtime.
  const shellData = {
    user, host,
    name: c.name, title: c.title, location: d.location, about: d.about,
    skills: d.skills,
    projects: d.projects.map(p => ({ name: p.name, desc: p.description || (p.bullets || [])[0] || "", tags: p.tags || [], link: pfUrl(p.link || p.repo || "") })),
    experience: d.experience.map(e => ({ role: e.role, org: e.org, period: e.period })),
    education: d.education.map(e => ({ degree: e.degree, school: e.school, period: e.period })),
    contact: c.links.map(x => ({ label: x.label, handle: x.handle, url: x.url })),
    resume: c.hasResume ? { href: c.resumeHref, download: c.resumeDownload, label: c.resumeLabel } : null,
  };

  const body = `
<main id="main" class="pf-shell">

  <section class="pf-win pf-noprint" aria-label="Interactive terminal">
    <div class="pf-bar">
      <span class="pf-dot" style="background:#FF5F57"></span>
      <span class="pf-dot" style="background:#FEBC2E"></span>
      <span class="pf-dot" style="background:#28C840"></span>
      <span class="pf-t">${pfEsc(user)}@${pfEsc(host)} — zsh</span>
    </div>
    <div class="pf-term" id="pf-term" role="log" aria-live="polite"></div>
    <form class="pf-inline" id="pf-form" style="padding:.2rem 1.4rem 1rem">
      <span class="pf-prompt">${pfEsc(user)}@${pfEsc(host)}</span><span class="pf-path">~</span><span class="pf-prompt">$</span>
      <label class="pf-sr" for="pf-input">Type a command</label>
      <input id="pf-input" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="type help and press enter">
    </form>
    <div class="pf-hintbar">
      ${["help", "about", "skills", "projects", "experience", "education", "contact", "resume", "clear"]
        .map(x => `<button class="pf-cmd" data-cmd="${x}" type="button">${x}</button>`).join("")}
    </div>
  </section>

  <section class="pf-head" id="top">
    <h1>${pfEsc(c.name)}<b>_</b></h1>
    ${c.title ? `<p class="pf-role">// ${pfEsc(c.title)}</p>` : ""}
    ${c.tagline ? `<p class="pf-hero-tag">${pfEsc(c.tagline)}</p>` : ""}
    <div class="pf-meta">
      ${d.location ? `<span>📍 ${pfEsc(d.location)}</span>` : ""}
      ${d.available ? `<span>🟢 ${pfEsc(d.available)}</span>` : ""}
      ${c.socials.map(s => `<a href="${pfEsc(s.url)}" target="_blank" rel="noopener">${pfEsc(s.label.toLowerCase())}</a>`).join("")}
    </div>
    <div class="pf-actions">
      ${d.email ? `<a class="pf-btn pf-btn-go" href="mailto:${pfEsc(d.email)}">${PF_ICONS.mail}${pfEsc(d.cta_text || "Email me")}</a>` : ""}
      ${pfResumeBtn(c, "pf-btn")}
    </div>
  </section>

  ${c.has("about") ? `<section class="pf-sec" id="about"><h2>cat about.md</h2>
    <div class="pf-about" data-reveal>${pfEsc(d.about)}</div></section>` : ""}

  ${c.has("stats") ? `<section class="pf-sec"><h2>stats --summary</h2>
    <div class="pf-stats" data-reveal>${d.stats.map(s =>
      `<div class="pf-statc"><b>${pfEsc(s.value)}</b><span>${pfEsc(s.label)}</span></div>`).join("")}</div></section>` : ""}

  ${c.has("skills") ? `<section class="pf-sec" id="skills"><h2>ls ~/skills</h2>
    <ul class="pf-skills" data-reveal>${d.skills.map(s => `<li>${pfEsc(s)}</li>`).join("")}</ul></section>` : ""}

  ${c.has("projects") ? `<section class="pf-sec" id="projects"><h2>ls ~/projects</h2>
    <div data-reveal>${d.projects.map(p => `
      <article class="pf-block">
        ${p.period ? `<span class="pf-when">${pfEsc(p.period)}</span>` : ""}
        <h3>${pfEsc(p.name)}</h3>
        ${p.role ? `<div class="pf-sub">${pfEsc(p.role)}</div>` : ""}
        ${p.description ? `<p>${pfEsc(p.description)}</p>` : ""}
        ${(p.bullets || []).length ? `<ul>${p.bullets.map(b => `<li>${pfEsc(b)}</li>`).join("")}</ul>` : ""}
        ${(p.tags || []).length ? `<div class="pf-tags">${p.tags.map(t => `<span class="pf-tag">${pfEsc(t)}</span>`).join("")}</div>` : ""}
        ${pfProjectLinks(p) ? `<div class="pf-links">${pfProjectLinks(p)}</div>` : ""}
      </article>`).join("")}</div></section>` : ""}

  ${c.has("experience") ? `<section class="pf-sec" id="experience"><h2>git log --author="${pfEsc(c.name)}"</h2>
    <div data-reveal>${d.experience.map(e => `
      <article class="pf-block">
        ${e.period ? `<span class="pf-when">${pfEsc(e.period)}</span>` : ""}
        <h3>${pfEsc(e.role || "")}</h3>
        <div class="pf-sub">${pfJoin([e.org, e.location])}</div>
        ${e.summary ? `<p>${pfEsc(e.summary)}</p>` : ""}
        ${(e.bullets || []).length ? `<ul>${e.bullets.map(b => `<li>${pfEsc(b)}</li>`).join("")}</ul>` : ""}
      </article>`).join("")}</div></section>` : ""}

  ${c.has("education") ? `<section class="pf-sec" id="education"><h2>cat education.txt</h2>
    <div data-reveal>${d.education.map(e => `
      <article class="pf-block">
        ${e.period ? `<span class="pf-when">${pfEsc(e.period)}</span>` : ""}
        <h3>${pfEsc(e.degree || "")}</h3>
        <div class="pf-sub">${pfEsc(e.school || "")}</div>
        ${e.detail ? `<p>${pfEsc(e.detail)}</p>` : ""}
      </article>`).join("")}</div></section>` : ""}

  ${c.has("certifications") ? `<section class="pf-sec" id="certifications"><h2>cat certs.log</h2>
    <div data-reveal>${d.certifications.map(x => `<article class="pf-block"><h3>${pfEsc(x)}</h3></article>`).join("")}</div></section>` : ""}

  ${c.has("contact") ? `<section class="pf-sec" id="contact"><h2>./contact.sh</h2>
    <div class="pf-about" data-reveal style="white-space:normal">
      <p style="color:var(--muted);margin-bottom:1rem">${pfEsc(d.cta_text || "Fastest route is email. I read everything.")}</p>
      ${c.links.map(x => `<div style="margin-bottom:.4rem"><span style="color:var(--amber)">${pfEsc(x.label.toLowerCase().padEnd(9, " "))}</span> ${
        x.url ? `<a href="${pfEsc(x.url)}"${/^(https?:)/i.test(x.url) ? ` target="_blank" rel="noopener"` : ""} style="color:var(--acc);text-decoration:none">${pfEsc(x.handle)}</a>` : pfEsc(x.handle)
      }</div>`).join("")}
      <div class="pf-actions">${pfResumeBtn(c, "pf-btn")}</div>
    </div></section>` : ""}

  <footer>
    <span># © <span data-year>${c.year}</span> ${pfEsc(c.name)}${d.footer_note ? " — " + pfEsc(d.footer_note) : ""}</span>
    <a href="#top">^ top</a>
  </footer>
</main>`;

  const js = `
(function(){
  var DATA = ${pfJsonInline(shellData)};
  var term = document.getElementById('pf-term'), form = document.getElementById('pf-form'), input = document.getElementById('pf-input');
  if (!term) return;
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var esc = function(s){ return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); };
  var pad = function(s, n){ s = String(s); return s + new Array(Math.max(1, n - s.length + 1)).join(' '); };

  function line(html, cls){
    var el = document.createElement('div');
    el.className = 'pf-line ' + (cls || '');
    el.innerHTML = html;
    term.appendChild(el);
    term.scrollTop = term.scrollHeight;
    return el;
  }
  function prompt(cmd){
    line('<span class="pf-prompt">' + esc(DATA.user) + '@' + esc(DATA.host) + '</span><span class="pf-path">~</span><span class="pf-prompt">$</span> ' + esc(cmd));
  }

  var COMMANDS = {
    help: function(){
      return 'Available commands:\\n' +
        '  <b class="k">about</b>       who I am\\n' +
        '  <b class="k">skills</b>      what I work with\\n' +
        '  <b class="k">projects</b>    things I have built\\n' +
        '  <b class="k">experience</b>  where I have worked\\n' +
        '  <b class="k">education</b>   where I studied\\n' +
        '  <b class="k">contact</b>     how to reach me\\n' +
        (DATA.resume ? '  <b class="k">resume</b>      download my résumé\\n' : '') +
        '  <b class="k">whoami</b>      short version\\n' +
        '  <b class="k">clear</b>       clear the screen\\n\\n' +
        'Tip: ↑ / ↓ walks your history, Tab completes.';
    },
    about: function(){ return DATA.about ? esc(DATA.about) : 'No bio written yet.'; },
    whoami: function(){ return '<b>' + esc(DATA.name) + '</b>' + (DATA.title ? ' — ' + esc(DATA.title) : '') + (DATA.location ? '\\n' + esc(DATA.location) : ''); },
    skills: function(){
      if (!DATA.skills.length) return 'No skills listed.';
      var rows = [], per = innerWidth < 620 ? 2 : 4;
      for (var i=0;i<DATA.skills.length;i+=per) rows.push(DATA.skills.slice(i,i+per).map(function(s){ return pad(esc(s), 20); }).join(''));
      return rows.join('\\n');
    },
    projects: function(){
      if (!DATA.projects.length) return 'No projects listed.';
      return DATA.projects.map(function(p){
        return '<b>' + esc(p.name) + '</b>' + (p.tags.length ? ' <span class="k">[' + p.tags.map(esc).join(', ') + ']</span>' : '') +
          (p.desc ? '\\n  ' + esc(p.desc) : '') +
          (p.link ? '\\n  <a href="' + esc(p.link) + '" target="_blank" rel="noopener">' + esc(p.link) + '</a>' : '');
      }).join('\\n\\n');
    },
    experience: function(){
      if (!DATA.experience.length) return 'No roles listed.';
      return DATA.experience.map(function(e){
        return '<span class="k">' + esc(e.period || '') + '</span>  <b>' + esc(e.role || '') + '</b>' + (e.org ? ' @ ' + esc(e.org) : '');
      }).join('\\n');
    },
    education: function(){
      if (!DATA.education.length) return 'Nothing listed.';
      return DATA.education.map(function(e){
        return '<span class="k">' + esc(e.period || '') + '</span>  <b>' + esc(e.degree || '') + '</b>' + (e.school ? ', ' + esc(e.school) : '');
      }).join('\\n');
    },
    contact: function(){
      if (!DATA.contact.length) return 'No contact details listed.';
      return DATA.contact.map(function(x){
        var v = x.url ? '<a href="' + esc(x.url) + '"' + (/^https?:/i.test(x.url) ? ' target="_blank" rel="noopener"' : '') + '>' + esc(x.handle) + '</a>' : esc(x.handle);
        return '<span class="k">' + pad(esc(x.label.toLowerCase()), 10) + '</span>' + v;
      }).join('\\n');
    },
    resume: function(){
      if (!DATA.resume) return 'No résumé attached to this site.';
      var a = document.createElement('a');
      a.href = DATA.resume.href;
      if (DATA.resume.download) a.download = DATA.resume.download; else { a.target = '_blank'; a.rel = 'noopener'; }
      document.body.appendChild(a); a.click(); a.remove();
      return 'Downloading <b>' + esc(DATA.resume.download || 'résumé') + '</b>…';
    },
    clear: function(){ term.innerHTML = ''; return null; },
    ls: function(){ return 'about.md   skills/   projects/   experience/   education/   contact.sh'; },
    pwd: function(){ return '/home/' + esc(DATA.user); },
    date: function(){ return new Date().toString(); },
    echo: function(args){ return esc(args.join(' ')); },
    sudo: function(){ return '<span class="k">' + esc(DATA.user) + ' is not in the sudoers file. This incident will be reported.</span>'; }
  };

  var history = [], hIdx = -1;

  function run(raw){
    var cmd = String(raw || '').trim();
    if (!cmd) { prompt(''); return; }
    prompt(cmd);
    history.push(cmd); hIdx = history.length;
    var bits = cmd.split(/\\s+/), key = bits[0].toLowerCase(), fn = COMMANDS[key];
    if (!fn) { line('<span class="k">command not found: ' + esc(key) + '</span> — try <b>help</b>', 'pf-out'); return; }
    var out = fn(bits.slice(1));
    if (out !== null && out !== undefined) line(out, 'pf-out');
  }

  form.addEventListener('submit', function(e){ e.preventDefault(); run(input.value); input.value = ''; });
  input.addEventListener('keydown', function(e){
    if (e.key === 'ArrowUp') { e.preventDefault(); if (hIdx > 0) input.value = history[--hIdx] || ''; }
    else if (e.key === 'ArrowDown') { e.preventDefault(); if (hIdx < history.length - 1) input.value = history[++hIdx] || ''; else { hIdx = history.length; input.value = ''; } }
    else if (e.key === 'Tab') {
      e.preventDefault();
      var part = input.value.trim().toLowerCase();
      if (!part) return;
      var hit = Object.keys(COMMANDS).filter(function(k){ return k.indexOf(part) === 0; });
      if (hit.length === 1) input.value = hit[0];
      else if (hit.length > 1) { prompt(input.value); line(hit.join('   '), 'pf-out'); }
    }
    else if (e.key === 'l' && e.ctrlKey) { e.preventDefault(); term.innerHTML = ''; }
  });
  document.querySelectorAll('[data-cmd]').forEach(function(b){
    b.addEventListener('click', function(){ run(b.getAttribute('data-cmd')); input.focus(); });
  });
  document.querySelector('.pf-win').addEventListener('click', function(e){
    if (e.target.closest('a') || e.target.closest('button')) return;
    if (!window.getSelection || String(window.getSelection()) === '') input.focus();
  });

  /* The intro types itself out. Reduced motion gets the same text instantly —
     an animation nobody can watch is just a delay. */
  var intro = [
    { cmd: 'whoami', out: COMMANDS.whoami() },
    { cmd: 'help',   out: COMMANDS.help() }
  ];
  if (reduce) {
    intro.forEach(function(step){ prompt(step.cmd); line(step.out, 'pf-out'); });
  } else {
    var si = 0;
    (function step(){
      if (si >= intro.length) return;
      var s = intro[si++], typed = '', i = 0;
      var el = line('<span class="pf-prompt">' + esc(DATA.user) + '@' + esc(DATA.host) + '</span><span class="pf-path">~</span><span class="pf-prompt">$</span> <span class="pf-typed"></span><span class="pf-cursor"></span>');
      var slot = el.querySelector('.pf-typed');
      var t = setInterval(function(){
        typed += s.cmd[i++];
        slot.textContent = typed;
        if (i >= s.cmd.length) {
          clearInterval(t);
          setTimeout(function(){
            var cur = el.querySelector('.pf-cursor'); if (cur) cur.remove();
            line(s.out, 'pf-out');
            setTimeout(step, 240);
          }, 260);
        }
      }, 58);
    })();
  }
})();`;

  return { fonts: [c.googleFont ? null : "JetBrains+Mono:wght@400;500;700"].filter(Boolean), css, body, js, themeColor: "#0B0F14" };
};

// ---------------------------------------------------------------------------
// 4. NEON GRID — cyberpunk. Glitching headline, scanlines, live project filter.
// ---------------------------------------------------------------------------
PF_RENDERERS.neon = (c) => {
  const d = c.d;
  // Every distinct tag across all projects becomes a filter. Built here rather
  // than in the browser so a site with no JS still shows every project.
  const allTags = [...new Set(d.projects.flatMap(p => (p.tags || []).map(t => String(t).trim())).filter(Boolean))];

  const css = `
:root{
  --acc:${c.accent}; --acc2:${c.accent2}; --cy:#22D3EE;
  --bg:#07040F; --panel:#100B1E; --line:${pfRgba(c.accent, .3)};
  --ink:#F2ECFF; --muted:#A091C4;
  --font:${c.fontStack || `'Space Grotesk','Inter',-apple-system,'Segoe UI',Roboto,sans-serif`};
}
body{background:var(--bg);color:var(--ink);font-family:var(--font);font-size:16px;line-height:1.65;overflow-x:hidden}
.pf-skip{background:var(--acc);color:${c.accentInk}}
/* Perspective floor grid + a slow horizontal sweep. Pure CSS: no canvas, no
   repaint of anything above it. */
.pf-grid-bg{position:fixed;inset:0;z-index:0;pointer-events:none;overflow:hidden;
  background:radial-gradient(ellipse 90% 60% at 50% 0%,${pfRgba(c.accent, .18)},transparent 70%),
             radial-gradient(ellipse 70% 50% at 80% 100%,${pfRgba(c.accent2, .14)},transparent 70%)}
.pf-grid-bg::before{content:"";position:absolute;left:-50%;right:-50%;bottom:-20%;height:75%;
  background-image:linear-gradient(${pfRgba(c.accent, .28)} 1px,transparent 1px),
                   linear-gradient(90deg,${pfRgba(c.accent, .28)} 1px,transparent 1px);
  background-size:56px 56px;transform:perspective(340px) rotateX(70deg);transform-origin:bottom;
  animation:pf-scroll 9s linear infinite;mask-image:linear-gradient(transparent,#000 55%)}
@keyframes pf-scroll{to{background-position:0 56px}}
.pf-wrap{position:relative;z-index:1}
.pf-shell{width:min(1100px,92vw);margin:0 auto}

header{position:sticky;top:0;z-index:40;background:rgba(7,4,15,.82);backdrop-filter:blur(14px);
  -webkit-backdrop-filter:blur(14px);border-bottom:1px solid var(--line)}
.pf-nav{width:min(1100px,92vw);margin:0 auto;display:flex;align-items:center;gap:1.5rem;padding:.9rem 0;flex-wrap:wrap;row-gap:.5rem}
.pf-logo{font-weight:700;letter-spacing:.12em;text-transform:uppercase;font-size:.9rem;text-decoration:none;margin-right:auto;
  color:var(--ink);text-shadow:0 0 14px ${pfRgba(c.accent, .8)}}
.pf-logo b{color:var(--acc)}
.pf-nav nav{display:flex;gap:1.3rem;flex-wrap:wrap;min-width:0;row-gap:.4rem}
.pf-nav nav a{color:var(--muted);text-decoration:none;font-size:.82rem;letter-spacing:.1em;text-transform:uppercase;
  font-weight:600;transition:.2s}
.pf-nav nav a:hover{color:var(--acc);text-shadow:0 0 12px ${pfRgba(c.accent, .9)}}

.pf-btn{display:inline-flex;align-items:center;gap:.5rem;padding:.7rem 1.3rem;font-size:.84rem;font-weight:700;
  letter-spacing:.08em;text-transform:uppercase;text-decoration:none;cursor:pointer;position:relative;
  clip-path:polygon(10px 0,100% 0,100% calc(100% - 10px),calc(100% - 10px) 100%,0 100%,0 10px);
  border:1px solid var(--acc);color:var(--acc);background:${pfRgba(c.accent, .1)};transition:.22s}
.pf-btn svg{width:16px;height:16px}
.pf-btn:hover{background:var(--acc);color:${c.accentInk};box-shadow:0 0 26px ${pfRgba(c.accent, .7)}}
.pf-btn-cy{border-color:var(--cy);color:var(--cy);background:rgba(34,211,238,.08)}
.pf-btn-cy:hover{background:var(--cy);color:#04121A;box-shadow:0 0 26px rgba(34,211,238,.6)}

.pf-hero{padding:clamp(3.5rem,10vw,7rem) 0 clamp(2.5rem,6vw,4.5rem);text-align:center}
.pf-badge{display:inline-block;font-size:.74rem;letter-spacing:.28em;text-transform:uppercase;color:var(--cy);
  border:1px solid rgba(34,211,238,.4);padding:.35rem .9rem;margin-bottom:1.8rem;
  clip-path:polygon(8px 0,100% 0,100% calc(100% - 8px),calc(100% - 8px) 100%,0 100%,0 8px)}
/* Glitch: two coloured copies of the same text, clipped to shifting bands. */
.pf-glitch{position:relative;display:inline-block;font-size:clamp(2.4rem,8vw,5.4rem);font-weight:700;
  letter-spacing:-.02em;line-height:1.05;text-transform:uppercase}
.pf-glitch::before,.pf-glitch::after{content:attr(data-text);position:absolute;inset:0;background:var(--bg);overflow:hidden}
.pf-glitch::before{left:2px;text-shadow:-2px 0 var(--acc);animation:pf-g1 3.4s infinite linear alternate-reverse}
.pf-glitch::after{left:-2px;text-shadow:2px 0 var(--cy);animation:pf-g2 2.7s infinite linear alternate-reverse}
@keyframes pf-g1{0%{clip-path:inset(12% 0 78% 0)}20%{clip-path:inset(62% 0 22% 0)}40%{clip-path:inset(38% 0 51% 0)}
  60%{clip-path:inset(84% 0 6% 0)}80%{clip-path:inset(24% 0 66% 0)}100%{clip-path:inset(52% 0 34% 0)}}
@keyframes pf-g2{0%{clip-path:inset(72% 0 16% 0)}25%{clip-path:inset(18% 0 70% 0)}50%{clip-path:inset(44% 0 44% 0)}
  75%{clip-path:inset(8% 0 84% 0)}100%{clip-path:inset(64% 0 24% 0)}}
.pf-role{font-size:clamp(1rem,2.6vw,1.35rem);color:var(--cy);letter-spacing:.2em;text-transform:uppercase;
  margin:1rem 0 1.2rem;font-weight:600}
.pf-tagline{color:var(--muted);max-width:60ch;margin:0 auto 2.2rem;font-size:1.03rem}
.pf-cta{display:flex;gap:.9rem;justify-content:center;flex-wrap:wrap}
.pf-socials{display:flex;gap:.7rem;justify-content:center;margin-top:1.8rem}
.pf-socials a{display:grid;place-items:center;width:40px;height:40px;color:var(--muted);border:1px solid var(--line);
  transition:.2s;clip-path:polygon(7px 0,100% 0,100% calc(100% - 7px),calc(100% - 7px) 100%,0 100%,0 7px)}
.pf-socials a svg{width:18px;height:18px}
.pf-socials a:hover{color:var(--acc);border-color:var(--acc);box-shadow:0 0 18px ${pfRgba(c.accent, .45)}}

.pf-sec{padding:clamp(2.8rem,7vw,5rem) 0}
.pf-h2{font-size:clamp(1.5rem,4vw,2.2rem);font-weight:700;text-transform:uppercase;letter-spacing:.06em;
  margin-bottom:2rem;display:flex;align-items:center;gap:1rem}
.pf-h2::before{content:"//";color:var(--acc)}
.pf-h2::after{content:"";flex:1;height:1px;background:linear-gradient(90deg,var(--line),transparent)}

/* The scanline sweep is one gradient bar animated across the card on hover. */
.pf-card{position:relative;background:var(--panel);border:1px solid var(--line);padding:1.5rem;overflow:hidden;
  clip-path:polygon(14px 0,100% 0,100% calc(100% - 14px),calc(100% - 14px) 100%,0 100%,0 14px);transition:.25s}
.pf-card::after{content:"";position:absolute;left:0;right:0;top:-100%;height:100%;
  background:linear-gradient(180deg,transparent,${pfRgba(c.accent, .16)},transparent);transition:top .75s ease}
.pf-card:hover::after{top:100%}
.pf-card:hover{border-color:var(--acc);box-shadow:0 0 30px ${pfRgba(c.accent, .28)};transform:translateY(-3px)}

.pf-filters{display:flex;flex-wrap:wrap;gap:.5rem;margin-bottom:1.6rem}
.pf-filter{background:transparent;border:1px solid var(--line);color:var(--muted);font-size:.76rem;font-weight:700;
  letter-spacing:.1em;text-transform:uppercase;padding:.4rem .85rem;cursor:pointer;transition:.2s}
.pf-filter:hover{color:var(--ink);border-color:var(--acc)}
.pf-filter[aria-pressed="true"]{background:var(--acc);border-color:var(--acc);color:${c.accentInk}}
.pf-projects{display:grid;gap:1.2rem;grid-template-columns:repeat(auto-fit,minmax(300px,1fr))}
.pf-projects article[hidden]{display:none}
.pf-card h3{font-size:1.15rem;font-weight:700;margin-bottom:.3rem}
.pf-card .pf-when{color:var(--cy);font-size:.78rem;letter-spacing:.1em;text-transform:uppercase;margin-bottom:.7rem}
.pf-card p{color:var(--muted);font-size:.93rem;margin-bottom:.9rem}
.pf-card ul li{color:var(--muted);font-size:.9rem;padding-left:1.1rem;position:relative;margin-bottom:.3rem}
.pf-card ul li::before{content:"▸";position:absolute;left:0;color:var(--acc)}
.pf-tags{display:flex;flex-wrap:wrap;gap:.35rem;margin:.9rem 0}
.pf-tag{font-size:.7rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;padding:.2rem .55rem;
  border:1px solid var(--line);color:var(--cy)}
.pf-links{display:flex;gap:1.1rem;font-size:.8rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase}
.pf-links a{color:var(--ink);text-decoration:none;display:inline-flex;align-items:center;gap:.35rem}
.pf-links a svg{width:14px;height:14px}
.pf-links a:hover{color:var(--acc)}

.pf-chips{display:flex;flex-wrap:wrap;gap:.5rem}
.pf-chip{font-size:.82rem;padding:.4rem .9rem;border:1px solid var(--line);color:var(--muted);transition:.2s;
  clip-path:polygon(6px 0,100% 0,100% calc(100% - 6px),calc(100% - 6px) 100%,0 100%,0 6px)}
.pf-chip:hover{color:var(--acc);border-color:var(--acc);box-shadow:0 0 14px ${pfRgba(c.accent, .35)}}
.pf-stack{display:grid;gap:1rem}
.pf-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:1rem;text-align:center}
.pf-stats b{display:block;font-size:2.2rem;font-weight:700;color:var(--acc);text-shadow:0 0 22px ${pfRgba(c.accent, .7)}}
.pf-stats span{font-size:.76rem;letter-spacing:.14em;text-transform:uppercase;color:var(--muted)}
.pf-about{color:var(--muted);white-space:pre-line;max-width:70ch;font-size:1.02rem}
.pf-contact{text-align:center}
.pf-contact-list{display:flex;flex-wrap:wrap;gap:.6rem 2rem;justify-content:center;margin-top:1.8rem;font-size:.9rem}
.pf-contact-list a,.pf-contact-list span{color:var(--muted);text-decoration:none;display:inline-flex;align-items:center;gap:.45rem}
.pf-contact-list svg{width:16px;height:16px;color:var(--acc)}
.pf-contact-list a:hover{color:var(--acc)}
footer{padding:2.2rem 0 3rem;border-top:1px solid var(--line);margin-top:3rem;text-align:center;
  color:var(--muted);font-size:.78rem;letter-spacing:.1em;text-transform:uppercase}
@media (max-width:760px){ .pf-nav nav{display:none} }`;

  const body = `
<div class="pf-grid-bg" aria-hidden="true"></div>
<div class="pf-wrap">
<header class="pf-noprint"><div class="pf-nav">
  <a class="pf-logo" href="#top">${pfEsc(c.name)}<b>_</b></a>
  <nav>${c.navItems.map(x => `<a href="#${x.id}">${pfEsc(x.label)}</a>`).join("")}</nav>
</div></header>

<main id="main" class="pf-shell">
  <section class="pf-hero" id="top">
    ${d.available ? `<span class="pf-badge">${pfEsc(d.available)}</span>` : ""}
    <h1><span class="pf-glitch" data-text="${pfEsc(c.name)}">${pfEsc(c.name)}</span></h1>
    ${c.title ? `<p class="pf-role">${pfEsc(c.title)}</p>` : ""}
    ${c.tagline ? `<p class="pf-tagline">${pfEsc(c.tagline)}</p>` : ""}
    <div class="pf-cta">
      ${d.email ? `<a class="pf-btn" href="mailto:${pfEsc(d.email)}">${pfEsc(d.cta_text || "Initiate contact")}</a>` : ""}
      ${c.hasResume ? `<a class="pf-btn pf-btn-cy" ${pfResumeAttrs(c)}>${PF_ICONS.download}${pfEsc(c.resumeLabel)}</a>` : ""}
    </div>
    ${pfSocialRow(c)}
  </section>

  ${c.has("stats") ? `<section class="pf-sec" style="padding-top:0"><div class="pf-stats" data-reveal>
    ${d.stats.map(s => `<div class="pf-card"><b>${pfEsc(s.value)}</b><span>${pfEsc(s.label)}</span></div>`).join("")}
  </div></section>` : ""}

  ${c.has("about") ? `<section class="pf-sec" id="about">
    <h2 class="pf-h2">About</h2>
    <p class="pf-about" data-reveal>${pfEsc(d.about)}</p></section>` : ""}

  ${c.has("skills") ? `<section class="pf-sec" id="skills">
    <h2 class="pf-h2">Stack</h2>
    <div class="pf-chips" data-reveal>${d.skills.map(s => `<span class="pf-chip">${pfEsc(s)}</span>`).join("")}</div></section>` : ""}

  ${c.has("projects") ? `<section class="pf-sec" id="projects">
    <h2 class="pf-h2">Projects</h2>
    ${allTags.length > 1 ? `<div class="pf-filters" role="group" aria-label="Filter projects by technology">
      <button class="pf-filter" type="button" data-filter="*" aria-pressed="true">All</button>
      ${allTags.map(t => `<button class="pf-filter" type="button" data-filter="${pfEsc(t.toLowerCase())}" aria-pressed="false">${pfEsc(t)}</button>`).join("")}
    </div>` : ""}
    <div class="pf-projects" id="pf-projects">${d.projects.map((p, i) => `
      <article class="pf-card" data-tags="${pfEsc((p.tags || []).map(t => String(t).toLowerCase()).join("|"))}" data-reveal data-reveal-delay="${(i % 3) * 80}">
        <h3>${pfEsc(p.name)}</h3>
        ${pfJoin([p.role, p.period]) ? `<div class="pf-when">${pfJoin([p.role, p.period], " // ")}</div>` : ""}
        ${p.description ? `<p>${pfEsc(p.description)}</p>` : ""}
        ${(p.bullets || []).length ? `<ul>${p.bullets.map(b => `<li>${pfEsc(b)}</li>`).join("")}</ul>` : ""}
        ${(p.tags || []).length ? `<div class="pf-tags">${p.tags.map(t => `<span class="pf-tag">${pfEsc(t)}</span>`).join("")}</div>` : ""}
        ${pfProjectLinks(p) ? `<div class="pf-links">${pfProjectLinks(p)}</div>` : ""}
      </article>`).join("")}</div>
    <p id="pf-empty" hidden style="color:var(--muted);margin-top:1rem">No projects match that filter.</p>
  </section>` : ""}

  ${c.has("experience") ? `<section class="pf-sec" id="experience">
    <h2 class="pf-h2">Experience</h2>
    <div class="pf-stack">${d.experience.map((e, i) => `
      <article class="pf-card" data-reveal data-reveal-delay="${i * 70}">
        <h3>${pfEsc(e.role || "")}</h3>
        <div class="pf-when">${pfJoin([e.org, e.period, e.location], " // ")}</div>
        ${e.summary ? `<p>${pfEsc(e.summary)}</p>` : ""}
        ${(e.bullets || []).length ? `<ul>${e.bullets.map(b => `<li>${pfEsc(b)}</li>`).join("")}</ul>` : ""}
      </article>`).join("")}</div></section>` : ""}

  ${c.has("education") || c.has("certifications") ? `<section class="pf-sec" id="education">
    <h2 class="pf-h2">Credentials</h2>
    <div class="pf-projects">
      ${c.has("education") ? d.education.map(e => `
        <article class="pf-card" data-reveal>
          <h3>${pfEsc(e.degree || "")}</h3>
          <div class="pf-when">${pfJoin([e.school, e.period], " // ")}</div>
          ${e.detail ? `<p>${pfEsc(e.detail)}</p>` : ""}
        </article>`).join("") : ""}
      ${c.has("certifications") ? `<article class="pf-card" id="certifications" data-reveal><h3>Certifications</h3>
        <ul style="margin-top:.7rem">${d.certifications.map(x => `<li>${pfEsc(x)}</li>`).join("")}</ul></article>` : ""}
    </div></section>` : ""}

  ${c.has("contact") ? `<section class="pf-sec pf-contact" id="contact">
    <h2 class="pf-h2" style="justify-content:center">Contact</h2>
    <p class="pf-tagline">${pfEsc(d.cta_text || "Channel open. Send a message.")}</p>
    <div class="pf-cta">
      ${d.email ? `<a class="pf-btn" href="mailto:${pfEsc(d.email)}">${pfEsc(d.email)}</a>` : ""}
      ${c.hasResume ? `<a class="pf-btn pf-btn-cy" ${pfResumeAttrs(c)}>${PF_ICONS.download}Résumé</a>` : ""}
    </div>
    <div class="pf-contact-list">
      ${c.links.map(x => x.url ? `<a href="${pfEsc(x.url)}"${/^https?:/i.test(x.url) ? ` target="_blank" rel="noopener"` : ""}>${x.icon}${pfEsc(x.handle)}</a>` : `<span>${x.icon}${pfEsc(x.handle)}</span>`).join("")}
    </div></section>` : ""}

  <footer>© <span data-year>${c.year}</span> ${pfEsc(c.name)}${d.footer_note ? " // " + pfEsc(d.footer_note) : ""}</footer>
</main>
</div>`;

  const js = `
(function(){
  var wrap = document.getElementById('pf-projects');
  if (!wrap) return;
  var cards = [].slice.call(wrap.children), empty = document.getElementById('pf-empty');
  document.querySelectorAll('[data-filter]').forEach(function(btn){
    btn.addEventListener('click', function(){
      var want = btn.getAttribute('data-filter');
      document.querySelectorAll('[data-filter]').forEach(function(b){ b.setAttribute('aria-pressed', b === btn ? 'true' : 'false'); });
      var shown = 0;
      cards.forEach(function(card){
        var tags = (card.getAttribute('data-tags') || '').split('|');
        var ok = want === '*' || tags.indexOf(want) > -1;
        card.hidden = !ok;
        if (ok) shown++;
      });
      if (empty) empty.hidden = shown > 0;
    });
  });
})();`;

  return { fonts: [c.googleFont ? null : "Space+Grotesk:wght@400;500;600;700"].filter(Boolean), css, body, js, themeColor: "#07040F" };
};

// ---------------------------------------------------------------------------
// 5. EDITORIAL — a magazine feature about one person. Serif, drop cap, columns.
// ---------------------------------------------------------------------------
PF_RENDERERS.editorial = (c) => {
  const d = c.d;
  const paras = (d.about || "").split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
  // A pull quote lifts the strongest sentence out of the body copy — the thing
  // a magazine designer does by hand. Longest sentence in the second paragraph
  // is a decent proxy for "the interesting claim".
  const quoteSrc = paras[1] || paras[0] || "";
  const pull = quoteSrc.split(/(?<=[.!?])\s+/).sort((a, b) => b.length - a.length)[0] || "";

  const css = `
:root{
  --acc:${c.accent}; --ink:#231F1C; --muted:#6A625C; --faint:#9C948C;
  --paper:#FBF8F3; --paper2:#F2ECE3; --line:#DED5C8;
  --font:${c.fontStack || `'Fraunces',Georgia,'Times New Roman',serif`};
  --sans:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
}
body{background:var(--paper);color:var(--ink);font-family:var(--font);font-size:17px;line-height:1.72}
.pf-skip{background:var(--ink);color:var(--paper)}
.pf-shell{width:min(1080px,90vw);margin:0 auto}
.pf-read{width:min(680px,90vw);margin:0 auto}

header{border-bottom:2px solid var(--ink);position:sticky;top:0;background:rgba(251,248,243,.95);z-index:40;
  backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px)}
.pf-masthead{width:min(1080px,90vw);margin:0 auto;display:flex;align-items:center;gap:1.5rem;padding:.8rem 0;flex-wrap:wrap;row-gap:.5rem}
.pf-masthead .pf-issue{font-family:var(--sans);font-size:.7rem;letter-spacing:.24em;text-transform:uppercase;
  color:var(--faint);font-weight:700}
.pf-masthead nav{margin-left:auto;display:flex;gap:1.4rem;flex-wrap:wrap;min-width:0;row-gap:.4rem}
.pf-masthead nav a{font-family:var(--sans);font-size:.76rem;letter-spacing:.14em;text-transform:uppercase;
  font-weight:700;color:var(--muted);text-decoration:none;transition:color .2s}
.pf-masthead nav a:hover{color:var(--acc)}

.pf-hero{padding:clamp(3rem,8vw,6rem) 0 clamp(2rem,5vw,3.5rem);text-align:center;border-bottom:1px solid var(--line)}
.pf-rubric{font-family:var(--sans);font-size:.74rem;letter-spacing:.3em;text-transform:uppercase;color:var(--acc);
  font-weight:800;margin-bottom:1.5rem}
.pf-headline{font-size:clamp(2.6rem,8vw,5.2rem);line-height:.98;letter-spacing:-.035em;font-weight:900;
  margin-bottom:1.4rem;max-width:14ch;margin-left:auto;margin-right:auto}
.pf-standfirst{font-size:clamp(1.1rem,2.4vw,1.4rem);line-height:1.5;color:var(--muted);max-width:52ch;
  margin:0 auto 2rem;font-style:italic}
.pf-byline{font-family:var(--sans);font-size:.78rem;letter-spacing:.16em;text-transform:uppercase;color:var(--faint);
  font-weight:700;display:flex;flex-wrap:wrap;gap:.5rem 1.5rem;justify-content:center;
  padding-top:1.4rem;border-top:1px solid var(--line);max-width:44ch;margin:0 auto}
.pf-byline b{color:var(--ink)}
.pf-portrait{width:min(190px,45vw);aspect-ratio:1;border-radius:50%;object-fit:cover;margin:0 auto 2rem;
  border:1px solid var(--line);filter:saturate(.92)}
.pf-avatar-initials{display:grid;place-items:center;font-size:3.6rem;font-weight:900;color:var(--paper);background:var(--acc)}
.pf-hero-actions{display:flex;gap:1.6rem;justify-content:center;flex-wrap:wrap;margin-top:2rem}
.pf-link{font-family:var(--sans);font-size:.82rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;
  text-decoration:none;color:var(--ink);border-bottom:2px solid var(--acc);padding-bottom:3px;transition:.2s;
  display:inline-flex;align-items:center;gap:.45rem;background:none;border-top:0;border-left:0;border-right:0;cursor:pointer}
.pf-link svg{width:15px;height:15px}
.pf-link:hover{color:var(--acc);gap:.7rem}

.pf-sec{padding:clamp(2.6rem,6vw,4.5rem) 0}
.pf-sec+.pf-sec{border-top:1px solid var(--line)}
.pf-h2{font-family:var(--sans);font-size:.76rem;letter-spacing:.28em;text-transform:uppercase;font-weight:800;
  color:var(--acc);margin-bottom:1.8rem;text-align:center}
.pf-h2 span{background:var(--paper);padding:0 1.2rem}
.pf-h2{position:relative}
.pf-h2::before{content:"";position:absolute;left:0;right:0;top:50%;height:1px;background:var(--line);z-index:-1}

.pf-article{column-count:2;column-gap:2.6rem;column-rule:1px solid var(--line);font-size:1.02rem}
.pf-article p{margin-bottom:1.1rem;break-inside:avoid-column}
.pf-article p:first-child::first-letter{font-size:4.1em;line-height:.78;float:left;padding:.05em .1em 0 0;
  font-weight:900;color:var(--acc)}
.pf-quote{margin:2.5rem auto;max-width:34ch;text-align:center;font-size:clamp(1.3rem,3.4vw,1.9rem);line-height:1.35;
  font-style:italic;color:var(--acc);position:relative;padding:1.6rem 0;
  border-top:2px solid var(--ink);border-bottom:2px solid var(--ink)}

.pf-entry{padding:1.7rem 0;border-bottom:1px solid var(--line)}
.pf-entry:last-child{border-bottom:0}
.pf-entry-top{display:flex;flex-wrap:wrap;gap:.3rem 1rem;align-items:baseline;justify-content:space-between}
.pf-entry h3{font-size:1.4rem;font-weight:700;letter-spacing:-.02em}
.pf-entry .pf-when{font-family:var(--sans);font-size:.74rem;letter-spacing:.14em;text-transform:uppercase;
  color:var(--faint);font-weight:700;white-space:nowrap}
.pf-entry .pf-org{font-family:var(--sans);font-size:.86rem;font-weight:600;color:var(--acc);margin:.2rem 0 .7rem}
.pf-entry p{color:var(--muted);max-width:64ch}
.pf-entry ul{margin-top:.6rem}
.pf-entry li{color:var(--muted);padding-left:1.4rem;position:relative;margin-bottom:.35rem;max-width:64ch}
.pf-entry li::before{content:"◆";position:absolute;left:0;font-size:.6em;top:.55em;color:var(--acc)}
.pf-entry-foot{display:flex;flex-wrap:wrap;gap:.6rem 1.6rem;margin-top:.9rem;align-items:center}
.pf-tags{font-family:var(--sans);font-size:.72rem;letter-spacing:.12em;text-transform:uppercase;color:var(--faint);font-weight:700}
.pf-entry-foot a{font-family:var(--sans);font-size:.76rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;
  color:var(--ink);text-decoration:none;border-bottom:1px solid var(--acc);display:inline-flex;align-items:center;gap:.3rem}
.pf-entry-foot a svg{width:13px;height:13px}
.pf-entry-foot a:hover{color:var(--acc)}

.pf-skills{display:flex;flex-wrap:wrap;gap:.5rem .55rem;justify-content:center;max-width:760px;margin:0 auto}
.pf-skills li{font-family:var(--sans);font-size:.82rem;font-weight:600;padding:.4rem .95rem;background:var(--paper2);
  border:1px solid var(--line);color:var(--muted);transition:.2s}
.pf-skills li:hover{background:var(--acc);color:var(--paper);border-color:var(--acc)}
.pf-stats{display:flex;flex-wrap:wrap;gap:3rem;justify-content:center;text-align:center}
.pf-stats b{display:block;font-size:3rem;font-weight:900;letter-spacing:-.04em;line-height:1;color:var(--acc)}
.pf-stats span{font-family:var(--sans);font-size:.72rem;letter-spacing:.18em;text-transform:uppercase;
  color:var(--faint);font-weight:700}
.pf-certs{max-width:640px;margin:0 auto}
.pf-certs li{padding:.75rem 0;border-bottom:1px solid var(--line);color:var(--muted);display:flex;gap:.9rem}
.pf-certs li::before{content:"—";color:var(--acc)}

.pf-contact{text-align:center;background:var(--paper2);padding:clamp(2.5rem,6vw,4rem) 2rem;border:1px solid var(--line)}
.pf-contact h2{font-size:clamp(1.8rem,4.5vw,2.8rem);font-weight:900;letter-spacing:-.03em;margin-bottom:1rem}
.pf-contact p{color:var(--muted);max-width:48ch;margin:0 auto 2rem;font-style:italic}
.pf-contact-grid{display:flex;flex-wrap:wrap;gap:1rem 2.5rem;justify-content:center;font-family:var(--sans);font-size:.88rem}
.pf-contact-grid a,.pf-contact-grid span{color:var(--muted);text-decoration:none;display:inline-flex;align-items:center;gap:.5rem}
.pf-contact-grid svg{width:16px;height:16px;color:var(--acc)}
.pf-contact-grid a:hover{color:var(--acc)}
footer{padding:2.5rem 0 3.5rem;text-align:center;font-family:var(--sans);font-size:.74rem;letter-spacing:.16em;
  text-transform:uppercase;color:var(--faint);font-weight:700}

@media (max-width:760px){
  .pf-article{column-count:1}
  .pf-masthead nav{display:none}
  .pf-masthead .pf-issue{margin:0 auto}
}`;

  const body = `
<header class="pf-noprint"><div class="pf-masthead">
  <span class="pf-issue">${pfEsc(c.name)}</span>
  <nav>${c.navItems.map(x => `<a href="#${x.id}">${pfEsc(x.label)}</a>`).join("")}</nav>
</div></header>

<main id="main" class="pf-shell">
  <article class="pf-hero" id="top">
    ${d.avatar ? `<img class="pf-portrait" src="${pfEsc(d.avatar)}" alt="${pfEsc(c.name)}">`
               : `<div class="pf-portrait pf-avatar-initials" aria-hidden="true">${pfEsc(c.initials)}</div>`}
    <div class="pf-rubric">${pfEsc(d.available || c.title || "Profile")}</div>
    <h1 class="pf-headline">${pfEsc(c.name)}</h1>
    ${c.tagline ? `<p class="pf-standfirst">${pfEsc(c.tagline)}</p>` : ""}
    <div class="pf-byline">
      ${c.title ? `<span><b>${pfEsc(c.title)}</b></span>` : ""}
      ${d.location ? `<span>${pfEsc(d.location)}</span>` : ""}
    </div>
    <div class="pf-hero-actions">
      ${d.email ? `<a class="pf-link" href="mailto:${pfEsc(d.email)}">${pfEsc(d.cta_text || "Get in touch")}${PF_ICONS.arrow}</a>` : ""}
      ${c.hasResume ? `<a class="pf-link" ${pfResumeAttrs(c)}>${PF_ICONS.download}${pfEsc(c.resumeLabel)}</a>` : ""}
    </div>
  </article>

  ${c.has("about") ? `<section class="pf-sec" id="about">
    <h2 class="pf-h2"><span>The story</span></h2>
    <div class="pf-read">
      <div class="pf-article" data-reveal>${paras.map(p => `<p>${pfEsc(p)}</p>`).join("")}</div>
      ${pull && pull.length > 30 ? `<blockquote class="pf-quote" data-reveal>${pfEsc(pull)}</blockquote>` : ""}
    </div></section>` : ""}

  ${c.has("stats") ? `<section class="pf-sec">
    <h2 class="pf-h2"><span>In numbers</span></h2>
    <div class="pf-stats" data-reveal>${d.stats.map(s =>
      `<div><b>${pfEsc(s.value)}</b><span>${pfEsc(s.label)}</span></div>`).join("")}</div></section>` : ""}

  ${c.has("skills") ? `<section class="pf-sec" id="skills">
    <h2 class="pf-h2"><span>The toolkit</span></h2>
    <ul class="pf-skills" data-reveal>${d.skills.map(s => `<li>${pfEsc(s)}</li>`).join("")}</ul></section>` : ""}

  ${c.has("projects") ? `<section class="pf-sec" id="projects">
    <h2 class="pf-h2"><span>Selected work</span></h2>
    <div class="pf-read" data-reveal>${d.projects.map(p => `
      <article class="pf-entry">
        <div class="pf-entry-top"><h3>${pfEsc(p.name)}</h3><span class="pf-when">${pfEsc(p.period || "")}</span></div>
        ${p.role ? `<div class="pf-org">${pfEsc(p.role)}</div>` : ""}
        ${p.description ? `<p>${pfEsc(p.description)}</p>` : ""}
        ${(p.bullets || []).length ? `<ul>${p.bullets.map(b => `<li>${pfEsc(b)}</li>`).join("")}</ul>` : ""}
        <div class="pf-entry-foot">
          ${(p.tags || []).length ? `<span class="pf-tags">${p.tags.map(pfEsc).join(" · ")}</span>` : ""}
          ${pfProjectLinks(p)}
        </div>
      </article>`).join("")}</div></section>` : ""}

  ${c.has("experience") ? `<section class="pf-sec" id="experience">
    <h2 class="pf-h2"><span>Career</span></h2>
    <div class="pf-read" data-reveal>${d.experience.map(e => `
      <article class="pf-entry">
        <div class="pf-entry-top"><h3>${pfEsc(e.role || "")}</h3><span class="pf-when">${pfEsc(e.period || "")}</span></div>
        <div class="pf-org">${pfJoin([e.org, e.location])}</div>
        ${e.summary ? `<p>${pfEsc(e.summary)}</p>` : ""}
        ${(e.bullets || []).length ? `<ul>${e.bullets.map(b => `<li>${pfEsc(b)}</li>`).join("")}</ul>` : ""}
      </article>`).join("")}</div></section>` : ""}

  ${c.has("education") ? `<section class="pf-sec" id="education">
    <h2 class="pf-h2"><span>Education</span></h2>
    <div class="pf-read" data-reveal>${d.education.map(e => `
      <article class="pf-entry">
        <div class="pf-entry-top"><h3>${pfEsc(e.degree || "")}</h3><span class="pf-when">${pfEsc(e.period || "")}</span></div>
        <div class="pf-org">${pfEsc(e.school || "")}</div>
        ${e.detail ? `<p>${pfEsc(e.detail)}</p>` : ""}
      </article>`).join("")}</div></section>` : ""}

  ${c.has("certifications") ? `<section class="pf-sec" id="certifications">
    <h2 class="pf-h2"><span>Certifications</span></h2>
    <ul class="pf-certs" data-reveal>${d.certifications.map(x => `<li>${pfEsc(x)}</li>`).join("")}</ul></section>` : ""}

  ${c.has("contact") ? `<section class="pf-sec" id="contact"><div class="pf-contact" data-reveal>
    <h2>Get in touch</h2>
    <p>${pfEsc(d.cta_text || "For work, collaborations, or a question — the door is open.")}</p>
    <div class="pf-hero-actions" style="margin-top:0;margin-bottom:2rem">
      ${d.email ? `<a class="pf-link" href="mailto:${pfEsc(d.email)}">${pfEsc(d.email)}</a>` : ""}
      ${c.hasResume ? `<a class="pf-link" ${pfResumeAttrs(c)}>${PF_ICONS.download}Résumé</a>` : ""}
    </div>
    <div class="pf-contact-grid">
      ${c.links.map(x => x.url ? `<a href="${pfEsc(x.url)}"${/^https?:/i.test(x.url) ? ` target="_blank" rel="noopener"` : ""}>${x.icon}${pfEsc(x.handle)}</a>` : `<span>${x.icon}${pfEsc(x.handle)}</span>`).join("")}
    </div>
  </div></section>` : ""}

  <footer>© <span data-year>${c.year}</span> ${pfEsc(c.name)}${d.footer_note ? " · " + pfEsc(d.footer_note) : ""}</footer>
</main>`;

  return { fonts: ["Fraunces:opsz,wght@9..144,400;9..144,700;9..144,900", "Inter:wght@600;700;800"],
           css, body, js: "", themeColor: "#FBF8F3" };
};

// ---------------------------------------------------------------------------
// 6. SIDEBAR PRO — fixed profile rail, scroll-spy dots, skill meters, prints well.
// ---------------------------------------------------------------------------
PF_RENDERERS.sidebar = (c) => {
  const d = c.d;

  const css = `
:root{
  --acc:${c.accent}; --acc-ink:${c.accentInk};
  --ink:#152033; --muted:#5C6B80; --faint:#8A98AB;
  --bg:#F4F6FA; --card:#FFFFFF; --line:#E1E7EF;
  --font:${c.fontStack || `'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif`};
}
body{background:var(--bg);color:var(--ink);font-family:var(--font);font-size:15.5px;line-height:1.68}
.pf-skip{background:var(--acc);color:var(--acc-ink)}
.pf-layout{display:grid;grid-template-columns:322px minmax(0,1fr);min-height:100vh}

/* rail */
.pf-rail{position:sticky;top:0;height:100vh;overflow-y:auto;background:var(--card);border-right:1px solid var(--line);
  padding:2.4rem 1.9rem;display:flex;flex-direction:column;gap:1.5rem;scrollbar-width:thin}
.pf-rail::-webkit-scrollbar{width:6px}
.pf-rail::-webkit-scrollbar-thumb{background:var(--line);border-radius:6px}
.pf-rail-top{text-align:center}
.pf-avatar{width:118px;height:118px;border-radius:50%;object-fit:cover;margin:0 auto .95rem;
  border:3px solid var(--card);box-shadow:0 0 0 2px var(--acc),0 12px 28px rgba(21,32,51,.16)}
.pf-avatar-initials{display:grid;place-items:center;font-size:2.5rem;font-weight:800;background:var(--acc);color:var(--acc-ink)}
.pf-rail h1{font-size:1.32rem;font-weight:800;letter-spacing:-.02em;margin-bottom:.2rem}
.pf-rail .pf-role{color:var(--acc);font-weight:600;font-size:.9rem}
.pf-rail .pf-loc{color:var(--faint);font-size:.82rem;margin-top:.35rem}
.pf-avail{display:inline-flex;align-items:center;gap:.4rem;margin-top:.85rem;font-size:.74rem;font-weight:700;
  padding:.28rem .7rem;border-radius:999px;background:${pfRgba(c.accent, .12)};color:var(--acc)}
.pf-avail i{width:6px;height:6px;border-radius:50%;background:var(--acc)}

.pf-railnav{display:flex;flex-direction:column;gap:.1rem;border-top:1px solid var(--line);
  border-bottom:1px solid var(--line);padding:1rem 0}
.pf-railnav a{display:flex;align-items:center;gap:.75rem;padding:.55rem .7rem;border-radius:9px;text-decoration:none;
  color:var(--muted);font-size:.9rem;font-weight:500;transition:.18s}
.pf-railnav a span.pf-ico{width:20px;text-align:center;font-size:.95rem;opacity:.8}
.pf-railnav a:hover{background:var(--bg);color:var(--ink)}
.pf-railnav a.pf-active{background:${pfRgba(c.accent, .11)};color:var(--acc);font-weight:600}

.pf-rail-contact{display:flex;flex-direction:column;gap:.6rem;font-size:.85rem}
.pf-rail-contact a,.pf-rail-contact span{display:flex;align-items:center;gap:.6rem;color:var(--muted);
  text-decoration:none;word-break:break-word;transition:color .2s}
.pf-rail-contact svg{width:16px;height:16px;flex:0 0 16px;color:var(--acc)}
.pf-rail-contact a:hover{color:var(--acc)}
.pf-socials{display:flex;gap:.5rem;justify-content:center}
.pf-socials a{display:grid;place-items:center;width:36px;height:36px;border-radius:9px;background:var(--bg);
  color:var(--muted);border:1px solid var(--line);transition:.2s}
.pf-socials a svg{width:16px;height:16px}
.pf-socials a:hover{background:var(--acc);color:var(--acc-ink);border-color:var(--acc)}
.pf-btn{display:flex;align-items:center;justify-content:center;gap:.5rem;padding:.75rem 1.1rem;border-radius:10px;
  font-weight:600;font-size:.88rem;text-decoration:none;transition:.2s;cursor:pointer;border:1px solid transparent}
.pf-btn svg{width:16px;height:16px}
.pf-btn-primary{background:var(--acc);color:var(--acc-ink);box-shadow:0 6px 18px ${pfRgba(c.accent, .3)}}
.pf-btn-primary:hover{filter:brightness(1.07);transform:translateY(-1px)}
.pf-btn-ghost{border-color:var(--line);color:var(--ink);background:var(--card)}
.pf-btn-ghost:hover{border-color:var(--acc);color:var(--acc)}
.pf-rail-foot{margin-top:auto;text-align:center;color:var(--faint);font-size:.72rem;padding-top:1rem}

/* body */
.pf-main{padding:clamp(2rem,4vw,3.4rem) clamp(1.5rem,5vw,4rem);max-width:940px}
.pf-sec{margin-bottom:clamp(2.2rem,5vw,3.4rem);scroll-margin-top:1.5rem}
.pf-h2{font-size:.8rem;font-weight:800;letter-spacing:.18em;text-transform:uppercase;color:var(--acc);
  margin-bottom:1.1rem;display:flex;align-items:center;gap:.7rem}
.pf-h2::after{content:"";flex:1;height:1px;background:var(--line)}
.pf-card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:1.5rem 1.6rem;
  box-shadow:0 1px 2px rgba(21,32,51,.04)}
.pf-card+.pf-card{margin-top:.9rem}
.pf-about{white-space:pre-line;color:var(--muted);font-size:1rem}

.pf-meters{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:1rem 2rem}
.pf-meter-top{display:flex;justify-content:space-between;font-size:.87rem;margin-bottom:.35rem}
.pf-meter-top b{font-weight:600}
.pf-meter-top span{color:var(--faint);font-size:.78rem}
.pf-track{height:6px;border-radius:999px;background:var(--bg);overflow:hidden}
.pf-fill{height:100%;border-radius:999px;background:linear-gradient(90deg,var(--acc),${pfShade(c.accent, .3)});
  width:0;transition:width 1.1s cubic-bezier(.2,.7,.2,1)}

.pf-item{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:.4rem 1.5rem;align-items:baseline}
.pf-item h3{font-size:1.05rem;font-weight:700}
.pf-item .pf-when{color:var(--faint);font-size:.82rem;white-space:nowrap;font-variant-numeric:tabular-nums}
.pf-item .pf-org{grid-column:1/-1;color:var(--acc);font-weight:600;font-size:.9rem;margin-bottom:.35rem}
.pf-item .pf-body{grid-column:1/-1}
.pf-item p{color:var(--muted);font-size:.94rem}
.pf-item ul{margin-top:.5rem}
.pf-item li{color:var(--muted);font-size:.93rem;padding-left:1.2rem;position:relative;margin-bottom:.3rem}
.pf-item li::before{content:"";position:absolute;left:.1rem;top:.62em;width:5px;height:5px;border-radius:50%;background:var(--acc)}
.pf-tags{display:flex;flex-wrap:wrap;gap:.35rem;margin-top:.8rem}
.pf-tag{font-size:.73rem;font-weight:600;padding:.2rem .55rem;border-radius:5px;background:${pfRgba(c.accent, .11)};color:var(--acc)}
.pf-links{display:flex;gap:1.1rem;margin-top:.85rem;font-size:.84rem;font-weight:600}
.pf-links a{color:var(--ink);text-decoration:none;display:inline-flex;align-items:center;gap:.35rem}
.pf-links a svg{width:14px;height:14px}
.pf-links a:hover{color:var(--acc)}
.pf-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:.9rem}
.pf-statc{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:1.2rem;text-align:center}
.pf-statc b{display:block;font-size:1.85rem;font-weight:800;color:var(--acc);letter-spacing:-.02em}
.pf-statc span{font-size:.78rem;color:var(--faint);font-weight:500}
.pf-certs li{display:flex;gap:.7rem;color:var(--muted);font-size:.94rem;padding:.4rem 0}
.pf-certs li::before{content:"✓";color:var(--acc);font-weight:800}
.pf-cta-card{background:linear-gradient(135deg,var(--acc),${pfShade(c.accent, -.2)});color:var(--acc-ink);
  border-radius:16px;padding:2rem;text-align:center}
.pf-cta-card h3{font-size:1.35rem;font-weight:800;margin-bottom:.5rem}
.pf-cta-card p{opacity:.9;margin-bottom:1.4rem;font-size:.95rem}
.pf-cta-card .pf-btn{display:inline-flex;background:var(--card);color:var(--ink)}

@media (max-width:960px){
  .pf-layout{grid-template-columns:1fr}
  .pf-rail{position:static;height:auto;border-right:0;border-bottom:1px solid var(--line)}
  .pf-railnav{flex-direction:row;flex-wrap:wrap;justify-content:center}
  .pf-railnav a span.pf-ico{display:none}
  .pf-rail-foot{margin-top:1rem}
}
@media print{
  .pf-layout{grid-template-columns:250px 1fr}
  .pf-rail{position:static;height:auto;box-shadow:none}
  .pf-railnav,.pf-btn{display:none}
  .pf-card{break-inside:avoid;box-shadow:none}
}`;

  const railNav = c.navItems.map(x => {
    const meta = PF_SECTIONS.find(s => s.id === x.id);
    return `<a href="#${x.id}"><span class="pf-ico">${meta ? meta.icon : "•"}</span>${pfEsc(x.label)}</a>`;
  }).join("");

  const body = `
<div class="pf-layout">
<aside class="pf-rail">
  <div class="pf-rail-top">
    ${pfAvatar(c)}
    <h1>${pfEsc(c.name)}</h1>
    ${c.title ? `<div class="pf-role">${pfEsc(c.title)}</div>` : ""}
    ${d.location ? `<div class="pf-loc">${pfEsc(d.location)}</div>` : ""}
    ${d.available ? `<div class="pf-avail"><i></i>${pfEsc(d.available)}</div>` : ""}
  </div>

  <nav class="pf-railnav pf-noprint">${railNav}</nav>

  <div class="pf-rail-contact">
    ${c.links.map(x => x.url
      ? `<a href="${pfEsc(x.url)}"${/^https?:/i.test(x.url) ? ` target="_blank" rel="noopener"` : ""}>${x.icon}${pfEsc(x.handle)}</a>`
      : `<span>${x.icon}${pfEsc(x.handle)}</span>`).join("")}
  </div>

  <div style="display:flex;flex-direction:column;gap:.6rem">
    ${d.email ? `<a class="pf-btn pf-btn-primary" href="mailto:${pfEsc(d.email)}">${PF_ICONS.mail}${pfEsc(d.cta_text || "Get in touch")}</a>` : ""}
    ${c.hasResume ? `<a class="pf-btn pf-btn-ghost" ${pfResumeAttrs(c)}>${PF_ICONS.download}${pfEsc(c.resumeLabel)}</a>` : ""}
  </div>

  ${pfSocialRow(c)}
  <div class="pf-rail-foot">© <span data-year>${c.year}</span> ${pfEsc(c.name)}${d.footer_note ? `<br>${pfEsc(d.footer_note)}` : ""}</div>
</aside>

<main id="main" class="pf-main">
  ${c.has("stats") ? `<section class="pf-sec">
    <h2 class="pf-h2">Highlights</h2>
    <div class="pf-stats" data-reveal>${d.stats.map(s =>
      `<div class="pf-statc"><b>${pfEsc(s.value)}</b><span>${pfEsc(s.label)}</span></div>`).join("")}</div></section>` : ""}

  ${c.has("about") ? `<section class="pf-sec" id="about">
    <h2 class="pf-h2">About</h2>
    <div class="pf-card" data-reveal><p class="pf-about">${pfEsc(d.about)}</p></div></section>` : ""}

  ${c.has("skills") ? `<section class="pf-sec" id="skills">
    <h2 class="pf-h2">Skills</h2>
    <div class="pf-card" data-reveal><div class="pf-meters">${d.skills.map((s, i) => {
      // No self-rating input, and inventing "92%" would be a lie. The bar
      // reflects the order the person listed things in — first = strongest —
      // and the label says exactly that, so the meter is honest decoration.
      const pct = Math.max(52, 96 - i * 4);
      return `<div class="pf-meter">
        <div class="pf-meter-top"><b>${pfEsc(s)}</b></div>
        <div class="pf-track"><div class="pf-fill" data-fill="${pct}"></div></div>
      </div>`;
    }).join("")}</div>
    <p style="margin-top:1rem;font-size:.78rem;color:var(--faint)">Listed in order of depth.</p></div></section>` : ""}

  ${c.has("projects") ? `<section class="pf-sec" id="projects">
    <h2 class="pf-h2">Projects</h2>
    ${d.projects.map((p, i) => `
      <article class="pf-card pf-item" data-reveal data-reveal-delay="${i * 60}">
        <h3>${pfEsc(p.name)}</h3><span class="pf-when">${pfEsc(p.period || "")}</span>
        ${p.role ? `<div class="pf-org">${pfEsc(p.role)}</div>` : ""}
        <div class="pf-body">
          ${p.description ? `<p>${pfEsc(p.description)}</p>` : ""}
          ${(p.bullets || []).length ? `<ul>${p.bullets.map(b => `<li>${pfEsc(b)}</li>`).join("")}</ul>` : ""}
          ${(p.tags || []).length ? `<div class="pf-tags">${p.tags.map(t => `<span class="pf-tag">${pfEsc(t)}</span>`).join("")}</div>` : ""}
          ${pfProjectLinks(p) ? `<div class="pf-links">${pfProjectLinks(p)}</div>` : ""}
        </div>
      </article>`).join("")}</section>` : ""}

  ${c.has("experience") ? `<section class="pf-sec" id="experience">
    <h2 class="pf-h2">Experience</h2>
    ${d.experience.map((e, i) => `
      <article class="pf-card pf-item" data-reveal data-reveal-delay="${i * 60}">
        <h3>${pfEsc(e.role || "")}</h3><span class="pf-when">${pfEsc(e.period || "")}</span>
        <div class="pf-org">${pfJoin([e.org, e.location])}</div>
        <div class="pf-body">
          ${e.summary ? `<p>${pfEsc(e.summary)}</p>` : ""}
          ${(e.bullets || []).length ? `<ul>${e.bullets.map(b => `<li>${pfEsc(b)}</li>`).join("")}</ul>` : ""}
        </div>
      </article>`).join("")}</section>` : ""}

  ${c.has("education") ? `<section class="pf-sec" id="education">
    <h2 class="pf-h2">Education</h2>
    ${d.education.map(e => `
      <article class="pf-card pf-item" data-reveal>
        <h3>${pfEsc(e.degree || "")}</h3><span class="pf-when">${pfEsc(e.period || "")}</span>
        <div class="pf-org">${pfEsc(e.school || "")}</div>
        ${e.detail ? `<div class="pf-body"><p>${pfEsc(e.detail)}</p></div>` : ""}
      </article>`).join("")}</section>` : ""}

  ${c.has("certifications") ? `<section class="pf-sec" id="certifications">
    <h2 class="pf-h2">Certifications</h2>
    <div class="pf-card" data-reveal><ul class="pf-certs">${d.certifications.map(x => `<li>${pfEsc(x)}</li>`).join("")}</ul></div></section>` : ""}

  ${c.has("contact") ? `<section class="pf-sec" id="contact">
    <h2 class="pf-h2">Contact</h2>
    <div class="pf-cta-card" data-reveal>
      <h3>${pfEsc(d.cta_text || "Let's talk")}</h3>
      <p>${pfEsc(d.email ? "The quickest way to reach me is email — I reply to everything." : "Reach me through any of the links in the sidebar.")}</p>
      ${d.email ? `<a class="pf-btn" href="mailto:${pfEsc(d.email)}">${PF_ICONS.mail}${pfEsc(d.email)}</a>` : ""}
    </div></section>` : ""}
</main>
</div>`;

  const js = `
(function(){
  /* Meters fill when the section is first seen, not on load — a bar that
     already finished animating before you scrolled to it is just a static bar. */
  var fills = document.querySelectorAll('.pf-fill');
  var paint = function(){ fills.forEach(function(f){ f.style.width = f.getAttribute('data-fill') + '%'; }); };
  if ('IntersectionObserver' in window && fills.length) {
    var o = new IntersectionObserver(function(en){ if (en[0].isIntersecting) { paint(); o.disconnect(); } }, { threshold:.25 });
    o.observe(fills[0].closest('.pf-sec') || fills[0]);
  } else paint();

  var links = [].slice.call(document.querySelectorAll('.pf-railnav a'));
  var secs = links.map(function(a){ return document.querySelector(a.getAttribute('href')); }).filter(Boolean);
  if ('IntersectionObserver' in window && secs.length) {
    var spy = new IntersectionObserver(function(es){
      es.forEach(function(e){
        if (!e.isIntersecting) return;
        links.forEach(function(a){ a.classList.toggle('pf-active', a.getAttribute('href') === '#' + e.target.id); });
      });
    }, { rootMargin: '-25% 0px -65% 0px' });
    secs.forEach(function(s){ spy.observe(s); });
  }
})();`;

  return { fonts: [c.googleFont ? null : "Inter:wght@400;500;600;700;800"].filter(Boolean), css, body, js, themeColor: "#FFFFFF" };
};

// ---------------------------------------------------------------------------
// 7. TIMELINE — one spine down the page. Everything is a moment in a sequence.
// ---------------------------------------------------------------------------
PF_RENDERERS.timeline = (c) => {
  const d = c.d;
  // Experience, projects and education merge into one dated stream, newest
  // first, because that is how a career actually reads. A "year" chip is
  // stamped whenever the leading year changes.
  const yearOf = (period) => {
    const m = String(period || "").match(/(19|20)\d{2}/g);
    return m ? Math.max(...m.map(Number)) : null;
  };
  const isNow = (p) => /present|now|current/i.test(String(p || ""));
  const stream = [
    ...(c.has("experience") ? d.experience.map(e => ({ kind: "Role", icon: "💼", title: e.role, sub: pfJoin([e.org, e.location]), period: e.period, text: e.summary, bullets: e.bullets || [] })) : []),
    ...(c.has("projects") ? d.projects.map(p => ({ kind: "Project", icon: "🚀", title: p.name, sub: p.role || "", period: p.period, text: p.description, bullets: p.bullets || [], tags: p.tags || [], link: p.link, repo: p.repo })) : []),
    ...(c.has("education") ? d.education.map(e => ({ kind: "Education", icon: "🎓", title: e.degree, sub: e.school, period: e.period, text: e.detail, bullets: [] })) : []),
  ].sort((a, b) => (isNow(b.period) - isNow(a.period)) || ((yearOf(b.period) || 0) - (yearOf(a.period) || 0)));

  let lastYear = null;

  const css = `
:root{
  --acc:${c.accent}; --acc-ink:${c.accentInk}; --ink:#1B2A2F; --muted:#5F7078; --faint:#93A3A9;
  --bg:#F5F8F6; --card:#FFFFFF; --line:#DFE7E3;
  --font:${c.fontStack || `'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif`};
}
body{background:var(--bg);color:var(--ink);font-family:var(--font);font-size:16px;line-height:1.68}
.pf-skip{background:var(--acc);color:var(--acc-ink)}
.pf-shell{width:min(940px,90vw);margin:0 auto}

.pf-hero{padding:clamp(3.5rem,9vw,6.5rem) 0 clamp(2rem,5vw,3rem);display:grid;
  grid-template-columns:auto minmax(0,1fr);gap:2rem;align-items:center}
.pf-avatar{width:120px;height:120px;border-radius:26px;object-fit:cover;box-shadow:0 14px 34px rgba(27,42,47,.14)}
.pf-avatar-initials{display:grid;place-items:center;font-size:2.6rem;font-weight:800;background:var(--acc);color:var(--acc-ink)}
.pf-hero h1{font-size:clamp(2.1rem,5.5vw,3.3rem);font-weight:800;letter-spacing:-.035em;line-height:1.06;margin-bottom:.4rem}
.pf-hero .pf-role{color:var(--acc);font-weight:700;font-size:1.05rem;margin-bottom:.7rem}
.pf-hero p{color:var(--muted);max-width:58ch}
.pf-meta{display:flex;flex-wrap:wrap;gap:.5rem 1.3rem;margin-top:1rem;font-size:.88rem;color:var(--faint)}
.pf-avail{display:inline-flex;align-items:center;gap:.45rem;color:var(--acc);font-weight:600}
.pf-avail i{width:7px;height:7px;border-radius:50%;background:var(--acc)}
.pf-actions{display:flex;flex-wrap:wrap;gap:.7rem;margin-top:1.5rem;align-items:center}
.pf-btn{display:inline-flex;align-items:center;gap:.5rem;padding:.72rem 1.25rem;border-radius:999px;font-weight:600;
  font-size:.92rem;text-decoration:none;transition:.2s;border:1px solid transparent}
.pf-btn svg{width:16px;height:16px}
.pf-btn-primary{background:var(--acc);color:var(--acc-ink);box-shadow:0 8px 22px ${pfRgba(c.accent, .32)}}
.pf-btn-primary:hover{transform:translateY(-2px);box-shadow:0 12px 28px ${pfRgba(c.accent, .42)}}
.pf-btn-ghost{background:var(--card);border-color:var(--line);color:var(--ink)}
.pf-btn-ghost:hover{border-color:var(--acc);color:var(--acc);transform:translateY(-2px)}
.pf-socials{display:flex;gap:.5rem}
.pf-socials a{display:grid;place-items:center;width:38px;height:38px;border-radius:999px;background:var(--card);
  border:1px solid var(--line);color:var(--muted);transition:.2s}
.pf-socials a svg{width:16px;height:16px}
.pf-socials a:hover{color:var(--acc);border-color:var(--acc)}

.pf-band{background:var(--card);border-top:1px solid var(--line);border-bottom:1px solid var(--line);
  padding:1.8rem 0;margin:1rem 0 0}
.pf-band-in{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:1.5rem;text-align:center}
.pf-band b{display:block;font-size:1.9rem;font-weight:800;color:var(--acc);letter-spacing:-.025em}
.pf-band span{font-size:.8rem;color:var(--faint);font-weight:600}

.pf-sec{padding:clamp(2.6rem,6vw,4rem) 0}
.pf-h2{font-size:1.5rem;font-weight:800;letter-spacing:-.025em;margin-bottom:.4rem}
.pf-sub2{color:var(--faint);font-size:.92rem;margin-bottom:2rem}
.pf-about{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:1.8rem;
  white-space:pre-line;color:var(--muted)}
.pf-chips{display:flex;flex-wrap:wrap;gap:.5rem}
.pf-chip{background:var(--card);border:1px solid var(--line);border-radius:999px;padding:.45rem 1rem;
  font-size:.88rem;color:var(--muted);transition:.2s}
.pf-chip:hover{border-color:var(--acc);color:var(--acc);transform:translateY(-2px)}

/* the spine */
.pf-line{position:relative;padding-left:2.6rem}
.pf-line::before{content:"";position:absolute;left:11px;top:.4rem;bottom:.4rem;width:2px;
  background:linear-gradient(180deg,var(--acc),${pfRgba(c.accent, .15)})}
.pf-year{position:relative;margin:2rem 0 1rem;display:inline-block;font-size:.76rem;font-weight:800;
  letter-spacing:.14em;color:var(--acc);background:${pfRgba(c.accent, .12)};padding:.28rem .8rem;border-radius:999px}
.pf-year:first-child{margin-top:0}
.pf-node{position:relative;margin-bottom:1.1rem}
.pf-node::before{content:"";position:absolute;left:calc(-2.6rem + 5px);top:1.55rem;width:14px;height:14px;border-radius:50%;
  background:var(--card);border:3px solid var(--acc);box-shadow:0 0 0 4px var(--bg);transition:.25s}
.pf-node:hover::before{transform:scale(1.22);background:var(--acc)}
.pf-node-in{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:1.35rem 1.5rem;transition:.25s}
.pf-node:hover .pf-node-in{border-color:${pfRgba(c.accent, .5)};transform:translateX(4px);box-shadow:0 10px 26px rgba(27,42,47,.07)}
.pf-node-top{display:flex;flex-wrap:wrap;gap:.4rem .9rem;align-items:center;margin-bottom:.3rem}
.pf-kind{font-size:.68rem;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:var(--acc);
  background:${pfRgba(c.accent, .11)};padding:.16rem .5rem;border-radius:5px}
.pf-when{margin-left:auto;color:var(--faint);font-size:.82rem;white-space:nowrap;font-variant-numeric:tabular-nums}
.pf-node h3{font-size:1.12rem;font-weight:700;letter-spacing:-.015em}
.pf-node .pf-org{color:var(--muted);font-size:.92rem;margin-bottom:.6rem}
.pf-node p{color:var(--muted);font-size:.95rem}
.pf-node ul{margin-top:.55rem}
.pf-node li{color:var(--muted);font-size:.93rem;padding-left:1.15rem;position:relative;margin-bottom:.3rem}
.pf-node li::before{content:"";position:absolute;left:0;top:.62em;width:5px;height:5px;border-radius:50%;background:var(--acc)}
.pf-tags{display:flex;flex-wrap:wrap;gap:.35rem;margin-top:.8rem}
.pf-tag{font-size:.72rem;font-weight:600;padding:.2rem .55rem;border-radius:5px;background:var(--bg);color:var(--muted)}
.pf-links{display:flex;gap:1.1rem;margin-top:.8rem;font-size:.85rem;font-weight:600}
.pf-links a{color:var(--ink);text-decoration:none;display:inline-flex;align-items:center;gap:.35rem}
.pf-links a svg{width:14px;height:14px}
.pf-links a:hover{color:var(--acc)}
.pf-certs{display:grid;gap:.6rem}
.pf-cert{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:.85rem 1.2rem;
  color:var(--muted);font-size:.94rem;display:flex;gap:.8rem;align-items:center}
.pf-cert::before{content:"🏅"}

.pf-contact{background:var(--card);border:1px solid var(--line);border-radius:22px;padding:clamp(2rem,5vw,3rem);
  text-align:center}
.pf-contact h2{font-size:clamp(1.6rem,4vw,2.2rem);font-weight:800;letter-spacing:-.03em;margin-bottom:.7rem}
.pf-contact p{color:var(--muted);max-width:48ch;margin:0 auto 1.8rem}
.pf-contact-list{display:flex;flex-wrap:wrap;gap:.8rem 2rem;justify-content:center;margin-top:1.8rem;font-size:.9rem}
.pf-contact-list a,.pf-contact-list span{color:var(--muted);text-decoration:none;display:inline-flex;align-items:center;gap:.45rem}
.pf-contact-list svg{width:16px;height:16px;color:var(--acc)}
.pf-contact-list a:hover{color:var(--acc)}
footer{padding:2.5rem 0 3rem;text-align:center;color:var(--faint);font-size:.85rem}
@media (max-width:700px){
  .pf-hero{grid-template-columns:1fr;text-align:center}
  .pf-avatar{margin:0 auto}
  .pf-meta,.pf-actions{justify-content:center}
  .pf-line{padding-left:1.9rem}
  .pf-node::before{left:calc(-1.9rem + 4px)}
  .pf-when{margin-left:0;width:100%}
}`;

  const nodes = stream.map((s, i) => {
    const y = yearOf(s.period);
    let chip = "";
    if (y && y !== lastYear) { chip = `<div class="pf-year">${isNow(s.period) ? "Now" : y}</div>`; lastYear = y; }
    return chip + `
      <article class="pf-node" data-reveal data-reveal-delay="${Math.min(i, 6) * 60}">
        <div class="pf-node-in">
          <div class="pf-node-top">
            <span class="pf-kind">${pfEsc(s.kind)}</span>
            ${s.period ? `<span class="pf-when">${pfEsc(s.period)}</span>` : ""}
          </div>
          <h3>${pfEsc(s.title || "")}</h3>
          ${s.sub ? `<div class="pf-org">${pfEsc(s.sub)}</div>` : ""}
          ${s.text ? `<p>${pfEsc(s.text)}</p>` : ""}
          ${(s.bullets || []).length ? `<ul>${s.bullets.map(b => `<li>${pfEsc(b)}</li>`).join("")}</ul>` : ""}
          ${(s.tags || []).length ? `<div class="pf-tags">${s.tags.map(t => `<span class="pf-tag">${pfEsc(t)}</span>`).join("")}</div>` : ""}
          ${pfProjectLinks(s) ? `<div class="pf-links">${pfProjectLinks(s)}</div>` : ""}
        </div>
      </article>`;
  }).join("");

  const body = `
<main id="main">
  <div class="pf-shell">
    <section class="pf-hero" id="top">
      ${pfAvatar(c)}
      <div>
        <h1>${pfEsc(c.name)}</h1>
        ${c.title ? `<div class="pf-role">${pfEsc(c.title)}</div>` : ""}
        ${c.tagline ? `<p>${pfEsc(c.tagline)}</p>` : ""}
        <div class="pf-meta">
          ${d.location ? `<span>${pfEsc(d.location)}</span>` : ""}
          ${d.available ? `<span class="pf-avail"><i></i>${pfEsc(d.available)}</span>` : ""}
        </div>
        <div class="pf-actions">
          ${d.email ? `<a class="pf-btn pf-btn-primary" href="mailto:${pfEsc(d.email)}">${PF_ICONS.mail}${pfEsc(d.cta_text || "Get in touch")}</a>` : ""}
          ${c.hasResume ? `<a class="pf-btn pf-btn-ghost" ${pfResumeAttrs(c)}>${PF_ICONS.download}${pfEsc(c.resumeLabel)}</a>` : ""}
          ${pfSocialRow(c)}
        </div>
      </div>
    </section>
  </div>

  ${c.has("stats") ? `<div class="pf-band"><div class="pf-shell"><div class="pf-band-in">
    ${d.stats.map(s => `<div><b>${pfEsc(s.value)}</b><span>${pfEsc(s.label)}</span></div>`).join("")}
  </div></div></div>` : ""}

  <div class="pf-shell">
    ${c.has("about") ? `<section class="pf-sec" id="about">
      <h2 class="pf-h2">About</h2><p class="pf-sub2">The short version</p>
      <div class="pf-about" data-reveal>${pfEsc(d.about)}</div></section>` : ""}

    ${c.has("skills") ? `<section class="pf-sec" id="skills">
      <h2 class="pf-h2">Skills</h2><p class="pf-sub2">Tools and technologies I reach for</p>
      <div class="pf-chips" data-reveal>${d.skills.map(s => `<span class="pf-chip">${pfEsc(s)}</span>`).join("")}</div></section>` : ""}

    ${nodes ? `<section class="pf-sec" id="experience">
      <h2 class="pf-h2">The path so far</h2>
      <p class="pf-sub2">Roles, projects and study, most recent first</p>
      <div class="pf-line" id="projects">${nodes}</div></section>` : ""}

    ${c.has("certifications") ? `<section class="pf-sec" id="certifications">
      <h2 class="pf-h2">Certifications</h2><p class="pf-sub2">Verified along the way</p>
      <div class="pf-certs" data-reveal>${d.certifications.map(x => `<div class="pf-cert">${pfEsc(x)}</div>`).join("")}</div></section>` : ""}

    ${c.has("contact") ? `<section class="pf-sec" id="contact"><div class="pf-contact" data-reveal>
      <h2>What's next?</h2>
      <p>${pfEsc(d.cta_text || "I'm always up for a conversation about interesting work.")}</p>
      <div class="pf-actions" style="justify-content:center;margin-top:0">
        ${d.email ? `<a class="pf-btn pf-btn-primary" href="mailto:${pfEsc(d.email)}">${PF_ICONS.mail}${pfEsc(d.email)}</a>` : ""}
        ${c.hasResume ? `<a class="pf-btn pf-btn-ghost" ${pfResumeAttrs(c)}>${PF_ICONS.download}Résumé</a>` : ""}
      </div>
      <div class="pf-contact-list">
        ${c.links.map(x => x.url ? `<a href="${pfEsc(x.url)}"${/^https?:/i.test(x.url) ? ` target="_blank" rel="noopener"` : ""}>${x.icon}${pfEsc(x.handle)}</a>` : `<span>${x.icon}${pfEsc(x.handle)}</span>`).join("")}
      </div>
    </div></section>` : ""}

    <footer>© <span data-year>${c.year}</span> ${pfEsc(c.name)}${d.footer_note ? " · " + pfEsc(d.footer_note) : ""}</footer>
  </div>
</main>`;

  return { fonts: [c.googleFont ? null : "Inter:wght@400;500;600;700;800"].filter(Boolean), css, body, js: "", themeColor: "#F5F8F6" };
};

// ---------------------------------------------------------------------------
// 8. CARD DECK — the work leads. Filterable grid, tilt on hover, detail dialog.
// ---------------------------------------------------------------------------
PF_RENDERERS.deck = (c) => {
  const d = c.d;
  const allTags = [...new Set(d.projects.flatMap(p => (p.tags || []).map(t => String(t).trim())).filter(Boolean))];

  const css = `
:root{
  --acc:${c.accent}; --acc-ink:${c.accentInk}; --ink:#241F1A; --muted:#6B625A; --faint:#9C948B;
  --bg:#FFFCF6; --card:#FFFFFF; --line:#EDE5D9;
  --font:${c.fontStack || `'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif`};
}
body{background:var(--bg);color:var(--ink);font-family:var(--font);font-size:16px;line-height:1.65}
.pf-skip{background:var(--acc);color:var(--acc-ink)}
.pf-shell{width:min(1140px,92vw);margin:0 auto}

header{position:sticky;top:0;z-index:40;background:rgba(255,252,246,.9);backdrop-filter:blur(12px);
  -webkit-backdrop-filter:blur(12px);border-bottom:1px solid var(--line)}
.pf-nav{width:min(1140px,92vw);margin:0 auto;display:flex;align-items:center;gap:1.4rem;padding:.9rem 0;flex-wrap:wrap;row-gap:.5rem}
.pf-brand{font-weight:800;letter-spacing:-.02em;text-decoration:none;margin-right:auto;display:flex;align-items:center;gap:.55rem}
.pf-brand i{width:28px;height:28px;border-radius:8px;background:var(--acc);color:var(--acc-ink);display:grid;
  place-items:center;font-style:normal;font-size:.75rem;font-weight:800}
.pf-nav nav{display:flex;gap:1.3rem;flex-wrap:wrap;min-width:0;row-gap:.4rem}
.pf-nav nav a{color:var(--muted);text-decoration:none;font-size:.9rem;font-weight:500;transition:color .2s}
.pf-nav nav a:hover{color:var(--acc)}

.pf-btn{display:inline-flex;align-items:center;gap:.5rem;padding:.72rem 1.3rem;border-radius:12px;font-weight:600;
  font-size:.92rem;text-decoration:none;cursor:pointer;border:1px solid transparent;transition:.2s}
.pf-btn svg{width:16px;height:16px}
.pf-btn-primary{background:var(--ink);color:var(--bg)}
.pf-btn-primary:hover{background:var(--acc);color:var(--acc-ink);transform:translateY(-2px)}
.pf-btn-ghost{border-color:var(--line);background:var(--card);color:var(--ink)}
.pf-btn-ghost:hover{border-color:var(--acc);color:var(--acc);transform:translateY(-2px)}

.pf-hero{padding:clamp(3rem,8vw,6rem) 0 clamp(2rem,5vw,3.5rem);display:grid;
  grid-template-columns:minmax(0,1fr) auto;gap:2.5rem;align-items:end}
.pf-hero h1{font-size:clamp(2.4rem,7vw,4.4rem);font-weight:800;letter-spacing:-.04em;line-height:1.02;margin-bottom:.6rem}
.pf-hero h1 mark{background:linear-gradient(180deg,transparent 58%,${pfRgba(c.accent, .38)} 58%);color:inherit;padding:0 .05em}
.pf-hero .pf-role{font-size:1.15rem;color:var(--acc);font-weight:700;margin-bottom:.9rem}
.pf-hero p{color:var(--muted);max-width:52ch;font-size:1.03rem}
.pf-hero-actions{display:flex;flex-wrap:wrap;gap:.8rem;margin-top:1.8rem;align-items:center}
.pf-avatar{width:170px;height:170px;border-radius:24px;object-fit:cover;box-shadow:0 18px 40px rgba(36,31,26,.16);
  transform:rotate(3deg)}
.pf-avatar-initials{display:grid;place-items:center;font-size:3.4rem;font-weight:800;background:var(--acc);color:var(--acc-ink)}
.pf-socials{display:flex;gap:.5rem}
.pf-socials a{display:grid;place-items:center;width:38px;height:38px;border-radius:11px;background:var(--card);
  border:1px solid var(--line);color:var(--muted);transition:.2s}
.pf-socials a svg{width:16px;height:16px}
.pf-socials a:hover{background:var(--acc);color:var(--acc-ink);border-color:var(--acc);transform:translateY(-2px)}

.pf-sec{padding:clamp(2.5rem,6vw,4rem) 0}
.pf-sec-head{display:flex;flex-wrap:wrap;gap:1rem;align-items:flex-end;justify-content:space-between;margin-bottom:1.6rem}
.pf-h2{font-size:clamp(1.5rem,3.6vw,2.1rem);font-weight:800;letter-spacing:-.03em}
.pf-count{color:var(--faint);font-size:.88rem}
.pf-filters{display:flex;flex-wrap:wrap;gap:.45rem;margin-bottom:1.6rem}
.pf-filter{border:1px solid var(--line);background:var(--card);color:var(--muted);border-radius:999px;
  padding:.38rem .95rem;font-size:.85rem;font-weight:600;cursor:pointer;transition:.2s}
.pf-filter:hover{border-color:var(--acc);color:var(--acc)}
.pf-filter[aria-pressed="true"]{background:var(--ink);border-color:var(--ink);color:var(--bg)}

.pf-deck{display:grid;gap:1.3rem;grid-template-columns:repeat(auto-fill,minmax(300px,1fr))}
/* Tilt is applied by JS on pointermove; without it the card is simply flat. */
.pf-proj{background:var(--card);border:1px solid var(--line);border-radius:20px;padding:1.6rem;cursor:pointer;
  transform-style:preserve-3d;transition:box-shadow .3s,border-color .25s,transform .18s ease-out;
  text-align:left;width:100%;font:inherit;color:inherit;display:block}
.pf-proj:hover{box-shadow:0 20px 44px rgba(36,31,26,.13);border-color:${pfRgba(c.accent, .45)}}
.pf-proj[hidden]{display:none}
.pf-proj-num{font-size:.72rem;font-weight:800;letter-spacing:.14em;color:var(--faint);margin-bottom:.9rem;
  display:flex;justify-content:space-between;align-items:center}
.pf-proj-num em{font-style:normal;color:var(--acc)}
.pf-proj h3{font-size:1.28rem;font-weight:700;letter-spacing:-.02em;margin-bottom:.4rem}
.pf-proj p{color:var(--muted);font-size:.94rem;margin-bottom:1rem;
  display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.pf-tags{display:flex;flex-wrap:wrap;gap:.35rem;margin-bottom:1rem}
.pf-tag{font-size:.73rem;font-weight:600;padding:.22rem .6rem;border-radius:6px;background:${pfRgba(c.accent, .12)};color:${pfShade(c.accent, -.25)}}
.pf-more{font-size:.85rem;font-weight:700;color:var(--acc);display:inline-flex;align-items:center;gap:.4rem}
.pf-more svg{width:15px;height:15px;transition:transform .2s}
.pf-proj:hover .pf-more svg{transform:translateX(4px)}

/* dialog */
dialog.pf-modal{border:0;border-radius:22px;padding:0;max-width:min(660px,92vw);width:100%;background:var(--card);
  color:var(--ink);box-shadow:0 30px 80px rgba(36,31,26,.32)}
dialog.pf-modal::backdrop{background:rgba(36,31,26,.55);backdrop-filter:blur(3px)}
.pf-modal-in{padding:2rem}
.pf-modal h3{font-size:1.6rem;font-weight:800;letter-spacing:-.03em;margin-bottom:.3rem;padding-right:2rem}
.pf-modal .pf-when{color:var(--acc);font-weight:600;font-size:.9rem;margin-bottom:1rem}
.pf-modal p{color:var(--muted);margin-bottom:1rem}
.pf-modal ul{margin-bottom:1.2rem}
.pf-modal li{color:var(--muted);padding-left:1.3rem;position:relative;margin-bottom:.4rem}
.pf-modal li::before{content:"";position:absolute;left:0;top:.62em;width:6px;height:6px;border-radius:50%;background:var(--acc)}
.pf-modal-actions{display:flex;flex-wrap:wrap;gap:.7rem;margin-top:1.4rem}
.pf-x{position:absolute;top:1.1rem;right:1.1rem;width:34px;height:34px;border-radius:50%;border:1px solid var(--line);
  background:var(--card);cursor:pointer;font-size:1.1rem;line-height:1;color:var(--muted)}
.pf-x:hover{background:var(--acc);color:var(--acc-ink);border-color:var(--acc)}

.pf-two{display:grid;gap:1.2rem;grid-template-columns:repeat(auto-fit,minmax(300px,1fr))}
.pf-card{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:1.5rem}
.pf-card h3{font-size:1.08rem;font-weight:700;margin-bottom:.2rem}
.pf-card .pf-when{color:var(--acc);font-size:.85rem;font-weight:600;margin-bottom:.5rem}
.pf-card .pf-org{color:var(--muted);font-size:.92rem;margin-bottom:.6rem}
.pf-card p{color:var(--muted);font-size:.94rem}
.pf-card ul{margin-top:.5rem}
.pf-card li{color:var(--muted);font-size:.93rem;padding-left:1.15rem;position:relative;margin-bottom:.3rem}
.pf-card li::before{content:"";position:absolute;left:0;top:.62em;width:5px;height:5px;border-radius:50%;background:var(--acc)}
.pf-chips{display:flex;flex-wrap:wrap;gap:.5rem}
.pf-chip{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:.45rem 1rem;font-size:.88rem;color:var(--muted)}
.pf-about{color:var(--muted);white-space:pre-line;max-width:68ch;font-size:1.02rem}
.pf-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:1rem}
.pf-statc{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:1.4rem;text-align:center}
.pf-statc b{display:block;font-size:2rem;font-weight:800;color:var(--acc);letter-spacing:-.03em}
.pf-statc span{font-size:.8rem;color:var(--faint)}
.pf-contact{background:var(--ink);color:var(--bg);border-radius:24px;padding:clamp(2.2rem,5vw,3.4rem);text-align:center}
.pf-contact h2{font-size:clamp(1.7rem,4vw,2.5rem);font-weight:800;letter-spacing:-.03em;margin-bottom:.7rem}
.pf-contact p{opacity:.78;max-width:48ch;margin:0 auto 1.8rem}
.pf-contact .pf-btn-primary{background:var(--acc);color:var(--acc-ink)}
.pf-contact .pf-btn-ghost{background:transparent;border-color:rgba(255,255,255,.28);color:var(--bg)}
.pf-contact .pf-btn-ghost:hover{background:rgba(255,255,255,.1);color:var(--bg)}
.pf-contact-list{display:flex;flex-wrap:wrap;gap:.7rem 2rem;justify-content:center;margin-top:1.8rem;font-size:.9rem;opacity:.8}
.pf-contact-list a,.pf-contact-list span{color:var(--bg);text-decoration:none;display:inline-flex;align-items:center;gap:.45rem}
.pf-contact-list svg{width:16px;height:16px;color:var(--acc)}
footer{padding:2.5rem 0 3rem;color:var(--faint);font-size:.86rem;display:flex;flex-wrap:wrap;
  gap:.8rem;justify-content:space-between}
footer a{color:var(--faint);text-decoration:none}
@media (max-width:800px){
  .pf-hero{grid-template-columns:1fr}
  .pf-nav nav{display:none}
  .pf-avatar{width:120px;height:120px}
}`;

  // The dialog reads from this, so a project's full detail never has to be
  // duplicated into the card's markup just to be available on click.
  const modalData = d.projects.map(p => ({
    name: p.name || "", period: pfJoin([p.role, p.period]) , description: p.description || "",
    bullets: p.bullets || [], tags: p.tags || [],
    link: p.link ? pfUrl(p.link) : "", repo: p.repo ? pfUrl(p.repo) : "",
  }));

  const body = `
<header class="pf-noprint"><div class="pf-nav">
  <a class="pf-brand" href="#top"><i>${pfEsc(c.initials)}</i>${pfEsc(c.name)}</a>
  <nav>${c.navItems.map(x => `<a href="#${x.id}">${pfEsc(x.label)}</a>`).join("")}</nav>
  ${c.hasResume ? `<a class="pf-btn pf-btn-ghost" ${pfResumeAttrs(c)}>${PF_ICONS.download}Résumé</a>` : ""}
</div></header>

<main id="main" class="pf-shell">
  <section class="pf-hero" id="top">
    <div>
      <h1>${pfEsc(c.name.split(" ")[0])} <mark>${pfEsc(c.name.split(" ").slice(1).join(" ") || "")}</mark></h1>
      ${c.title ? `<div class="pf-role">${pfEsc(c.title)}</div>` : ""}
      ${c.tagline ? `<p>${pfEsc(c.tagline)}</p>` : ""}
      <div class="pf-hero-actions">
        ${d.email ? `<a class="pf-btn pf-btn-primary" href="mailto:${pfEsc(d.email)}">${pfEsc(d.cta_text || "Work with me")}${PF_ICONS.arrow}</a>` : ""}
        ${c.hasResume ? `<a class="pf-btn pf-btn-ghost" ${pfResumeAttrs(c)}>${PF_ICONS.download}${pfEsc(c.resumeLabel)}</a>` : ""}
        ${pfSocialRow(c)}
      </div>
    </div>
    ${d.avatar || true ? pfAvatar(c) : ""}
  </section>

  ${c.has("projects") ? `<section class="pf-sec" id="projects">
    <div class="pf-sec-head">
      <div><h2 class="pf-h2">Selected work</h2></div>
      <span class="pf-count" id="pf-count">${d.projects.length} project${d.projects.length === 1 ? "" : "s"}</span>
    </div>
    ${allTags.length > 1 ? `<div class="pf-filters" role="group" aria-label="Filter by technology">
      <button class="pf-filter" type="button" data-filter="*" aria-pressed="true">Everything</button>
      ${allTags.map(t => `<button class="pf-filter" type="button" data-filter="${pfEsc(t.toLowerCase())}" aria-pressed="false">${pfEsc(t)}</button>`).join("")}
    </div>` : ""}
    <div class="pf-deck" id="pf-deck">${d.projects.map((p, i) => `
      <button class="pf-proj" type="button" data-i="${i}" data-tilt
        data-tags="${pfEsc((p.tags || []).map(t => String(t).toLowerCase()).join("|"))}"
        data-reveal data-reveal-delay="${(i % 3) * 80}">
        <div class="pf-proj-num"><span>${String(i + 1).padStart(2, "0")}</span><em>${pfEsc(p.period || "")}</em></div>
        <h3>${pfEsc(p.name)}</h3>
        ${p.description ? `<p>${pfEsc(p.description)}</p>` : ""}
        ${(p.tags || []).length ? `<div class="pf-tags">${p.tags.slice(0, 4).map(t => `<span class="pf-tag">${pfEsc(t)}</span>`).join("")}</div>` : ""}
        <span class="pf-more">View details${PF_ICONS.arrow}</span>
      </button>`).join("")}</div>
  </section>` : ""}

  ${c.has("about") ? `<section class="pf-sec" id="about">
    <div class="pf-sec-head"><h2 class="pf-h2">About</h2></div>
    <p class="pf-about" data-reveal>${pfEsc(d.about)}</p></section>` : ""}

  ${c.has("stats") ? `<section class="pf-sec" style="padding-top:0">
    <div class="pf-stats" data-reveal>${d.stats.map(s =>
      `<div class="pf-statc"><b>${pfEsc(s.value)}</b><span>${pfEsc(s.label)}</span></div>`).join("")}</div></section>` : ""}

  ${c.has("skills") ? `<section class="pf-sec" id="skills">
    <div class="pf-sec-head"><h2 class="pf-h2">Skills</h2></div>
    <div class="pf-chips" data-reveal>${d.skills.map(s => `<span class="pf-chip">${pfEsc(s)}</span>`).join("")}</div></section>` : ""}

  ${c.has("experience") ? `<section class="pf-sec" id="experience">
    <div class="pf-sec-head"><h2 class="pf-h2">Experience</h2></div>
    <div class="pf-two">${d.experience.map((e, i) => `
      <article class="pf-card" data-reveal data-reveal-delay="${i * 70}">
        <h3>${pfEsc(e.role || "")}</h3>
        <div class="pf-when">${pfEsc(e.period || "")}</div>
        <div class="pf-org">${pfJoin([e.org, e.location])}</div>
        ${e.summary ? `<p>${pfEsc(e.summary)}</p>` : ""}
        ${(e.bullets || []).length ? `<ul>${e.bullets.map(b => `<li>${pfEsc(b)}</li>`).join("")}</ul>` : ""}
      </article>`).join("")}</div></section>` : ""}

  ${c.has("education") || c.has("certifications") ? `<section class="pf-sec" id="education">
    <div class="pf-sec-head"><h2 class="pf-h2">Education${c.has("certifications") ? " & certifications" : ""}</h2></div>
    <div class="pf-two">
      ${c.has("education") ? d.education.map(e => `
        <article class="pf-card" data-reveal>
          <h3>${pfEsc(e.degree || "")}</h3>
          <div class="pf-when">${pfEsc(e.period || "")}</div>
          <div class="pf-org">${pfEsc(e.school || "")}</div>
          ${e.detail ? `<p>${pfEsc(e.detail)}</p>` : ""}
        </article>`).join("") : ""}
      ${c.has("certifications") ? `<article class="pf-card" id="certifications" data-reveal><h3>Certifications</h3>
        <ul style="margin-top:.7rem">${d.certifications.map(x => `<li>${pfEsc(x)}</li>`).join("")}</ul></article>` : ""}
    </div></section>` : ""}

  ${c.has("contact") ? `<section class="pf-sec" id="contact"><div class="pf-contact" data-reveal>
    <h2>Got something to build?</h2>
    <p>${pfEsc(d.cta_text || "Tell me about it — I read every message and reply to all of them.")}</p>
    <div class="pf-hero-actions" style="justify-content:center;margin-top:0">
      ${d.email ? `<a class="pf-btn pf-btn-primary" href="mailto:${pfEsc(d.email)}">${pfEsc(d.email)}</a>` : ""}
      ${c.hasResume ? `<a class="pf-btn pf-btn-ghost" ${pfResumeAttrs(c)}>${PF_ICONS.download}Résumé</a>` : ""}
    </div>
    <div class="pf-contact-list">
      ${c.links.map(x => x.url ? `<a href="${pfEsc(x.url)}"${/^https?:/i.test(x.url) ? ` target="_blank" rel="noopener"` : ""}>${x.icon}${pfEsc(x.handle)}</a>` : `<span>${x.icon}${pfEsc(x.handle)}</span>`).join("")}
    </div>
  </div></section>` : ""}

  <footer>
    <span>© <span data-year>${c.year}</span> ${pfEsc(c.name)}${d.footer_note ? " · " + pfEsc(d.footer_note) : ""}</span>
    <a href="#top">Back to top ↑</a>
  </footer>
</main>

<dialog class="pf-modal" id="pf-modal" aria-label="Project details">
  <button class="pf-x" id="pf-close" aria-label="Close">✕</button>
  <div class="pf-modal-in" id="pf-modal-body"></div>
</dialog>`;

  const js = `
(function(){
  var PROJECTS = ${pfJsonInline(modalData)};
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var esc = function(s){ return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); };

  /* Tilt. Small angles only — past about 8° it stops reading as depth and
     starts reading as a bug. */
  if (!reduce && matchMedia('(hover: hover)').matches) {
    document.querySelectorAll('[data-tilt]').forEach(function(el){
      el.addEventListener('pointermove', function(e){
        var r = el.getBoundingClientRect();
        var px = (e.clientX - r.left) / r.width - .5, py = (e.clientY - r.top) / r.height - .5;
        el.style.transform = 'perspective(900px) rotateX(' + (-py * 7).toFixed(2) + 'deg) rotateY(' + (px * 7).toFixed(2) + 'deg) translateY(-4px)';
      });
      el.addEventListener('pointerleave', function(){ el.style.transform = ''; });
    });
  }

  /* Filter */
  var deck = document.getElementById('pf-deck'), count = document.getElementById('pf-count');
  if (deck) {
    var cards = [].slice.call(deck.children);
    document.querySelectorAll('[data-filter]').forEach(function(btn){
      btn.addEventListener('click', function(){
        var want = btn.getAttribute('data-filter'), shown = 0;
        document.querySelectorAll('[data-filter]').forEach(function(b){ b.setAttribute('aria-pressed', b === btn ? 'true' : 'false'); });
        cards.forEach(function(card){
          var ok = want === '*' || (card.getAttribute('data-tags') || '').split('|').indexOf(want) > -1;
          card.hidden = !ok; if (ok) shown++;
        });
        if (count) count.textContent = shown + ' project' + (shown === 1 ? '' : 's');
      });
    });
  }

  /* Detail dialog. <dialog> where supported; a plain shown/hidden panel where
     it isn't, so the click never does nothing. */
  var dlg = document.getElementById('pf-modal'), slot = document.getElementById('pf-modal-body');
  var open = function(i){
    var p = PROJECTS[i]; if (!p) return;
    var html = '<h3>' + esc(p.name) + '</h3>';
    if (p.period) html += '<div class="pf-when">' + esc(p.period) + '</div>';
    if (p.description) html += '<p>' + esc(p.description) + '</p>';
    if (p.bullets.length) html += '<ul>' + p.bullets.map(function(b){ return '<li>' + esc(b) + '</li>'; }).join('') + '</ul>';
    if (p.tags.length) html += '<div class="pf-tags">' + p.tags.map(function(t){ return '<span class="pf-tag">' + esc(t) + '</span>'; }).join('') + '</div>';
    var acts = [];
    if (p.link) acts.push('<a class="pf-btn pf-btn-primary" href="' + esc(p.link) + '" target="_blank" rel="noopener">Visit site</a>');
    if (p.repo) acts.push('<a class="pf-btn pf-btn-ghost" href="' + esc(p.repo) + '" target="_blank" rel="noopener">View code</a>');
    if (acts.length) html += '<div class="pf-modal-actions">' + acts.join('') + '</div>';
    slot.innerHTML = html;
    if (dlg.showModal) dlg.showModal(); else { dlg.setAttribute('open',''); dlg.style.display = 'block'; }
  };
  var close = function(){ if (dlg.close) dlg.close(); else { dlg.removeAttribute('open'); dlg.style.display = 'none'; } };
  document.querySelectorAll('.pf-proj').forEach(function(card){
    card.addEventListener('click', function(){ open(parseInt(card.getAttribute('data-i'), 10)); });
  });
  document.getElementById('pf-close').addEventListener('click', close);
  /* Click on the backdrop (i.e. outside the panel) closes it too. */
  dlg.addEventListener('click', function(e){
    var r = dlg.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) close();
  });
})();`;

  return { fonts: [c.googleFont ? null : "Inter:wght@400;500;600;700;800"].filter(Boolean), css, body, js, themeColor: "#FFFCF6" };
};

// ---------------------------------------------------------------------------
// 9. GRADIENT BOLD — full-bleed colour blocks, marquee skills, type at volume.
// ---------------------------------------------------------------------------
PF_RENDERERS.bold = (c) => {
  const d = c.d;
  const marquee = d.skills.length ? d.skills : ["Design", "Build", "Ship"];

  const css = `
:root{
  --acc:${c.accent}; --acc2:${c.accent2}; --acc-ink:${c.accentInk};
  --ink:#FFFFFF; --dark:#120E17; --muted:rgba(255,255,255,.68); --line:rgba(255,255,255,.14);
  --font:${c.fontStack || `'Space Grotesk','Inter',-apple-system,'Segoe UI',Roboto,sans-serif`};
}
body{background:var(--dark);color:var(--ink);font-family:var(--font);font-size:16px;line-height:1.6;overflow-x:hidden}
.pf-skip{background:var(--acc);color:var(--acc-ink)}
.pf-shell{width:min(1160px,92vw);margin:0 auto}

/* A blob that trails the cursor, one composited transform per frame. */
#pf-blob{position:fixed;width:520px;height:520px;border-radius:50%;pointer-events:none;z-index:0;left:0;top:0;
  background:radial-gradient(circle,${pfRgba(c.accent, .30)},transparent 62%);filter:blur(46px);
  transform:translate(-50%,-50%);transition:opacity .4s;will-change:transform}
.pf-wrap{position:relative;z-index:1}

header{position:fixed;top:0;left:0;right:0;z-index:50;padding:1.1rem 0;transition:background .3s,padding .3s}
header.pf-stuck{background:rgba(18,14,23,.9);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);padding:.7rem 0}
.pf-nav{width:min(1160px,92vw);margin:0 auto;display:flex;align-items:center;gap:1.5rem;flex-wrap:wrap;row-gap:.5rem}
.pf-brand{font-weight:700;font-size:1.02rem;letter-spacing:-.02em;text-decoration:none;margin-right:auto}
.pf-nav nav{display:flex;gap:1.4rem;flex-wrap:wrap;min-width:0;row-gap:.4rem}
.pf-nav nav a{color:var(--muted);text-decoration:none;font-size:.88rem;font-weight:600;transition:color .2s}
.pf-nav nav a:hover{color:var(--ink)}

.pf-btn{display:inline-flex;align-items:center;gap:.55rem;padding:.85rem 1.7rem;border-radius:999px;font-weight:700;
  font-size:.94rem;text-decoration:none;cursor:pointer;border:2px solid transparent;transition:.22s}
.pf-btn svg{width:17px;height:17px}
.pf-btn-primary{background:var(--ink);color:var(--dark)}
.pf-btn-primary:hover{transform:translateY(-3px) scale(1.02)}
.pf-btn-ghost{border-color:var(--line);color:var(--ink)}
.pf-btn-ghost:hover{border-color:var(--ink);transform:translateY(-3px)}
.pf-btn-dark{background:var(--dark);color:var(--ink)}
.pf-btn-dark:hover{transform:translateY(-3px)}

.pf-hero{min-height:100svh;display:grid;align-items:center;padding:7rem 0 4rem;position:relative}
.pf-hero h1{font-size:clamp(3rem,13vw,9rem);font-weight:700;letter-spacing:-.055em;line-height:.86;
  margin-bottom:1.6rem;text-transform:uppercase}
.pf-hero h1 span{display:block}
.pf-hero h1 span:nth-child(2){color:transparent;-webkit-text-stroke:2px var(--acc);
  background:linear-gradient(120deg,var(--acc),var(--acc2));-webkit-background-clip:text;background-clip:text}
.pf-hero-row{display:flex;flex-wrap:wrap;gap:2rem;align-items:flex-end;justify-content:space-between}
.pf-hero .pf-role{font-size:clamp(1rem,2.2vw,1.4rem);font-weight:600;color:var(--acc);margin-bottom:.6rem}
.pf-hero p{color:var(--muted);max-width:46ch;font-size:1.05rem}
.pf-hero-actions{display:flex;flex-wrap:wrap;gap:.9rem;align-items:center;margin-top:2rem}
.pf-scroll{position:absolute;bottom:2rem;left:0;font-size:.74rem;letter-spacing:.24em;text-transform:uppercase;
  color:var(--muted);display:flex;align-items:center;gap:.7rem}
.pf-scroll::after{content:"";width:52px;height:1px;background:var(--muted);animation:pf-sweep 2.2s ease-in-out infinite}
@keyframes pf-sweep{0%,100%{transform:scaleX(.4);transform-origin:left}50%{transform:scaleX(1);transform-origin:left}}

/* marquee */
.pf-marquee{overflow:hidden;border-top:2px solid var(--acc);border-bottom:2px solid var(--acc);
  background:var(--acc);color:var(--acc-ink);padding:1.1rem 0;white-space:nowrap;position:relative}
.pf-track{display:inline-flex;gap:3rem;padding-right:3rem;animation:pf-marq 32s linear infinite;will-change:transform}
.pf-marquee:hover .pf-track{animation-play-state:paused}
.pf-track span{font-size:1.5rem;font-weight:700;letter-spacing:-.02em;text-transform:uppercase;display:inline-flex;
  align-items:center;gap:3rem}
.pf-track span::after{content:"◆";font-size:.7rem;opacity:.55}
@keyframes pf-marq{to{transform:translateX(-50%)}}

.pf-block{padding:clamp(3.5rem,9vw,7rem) 0;position:relative}
.pf-block--light{background:#F7F4F0;color:var(--dark)}
.pf-block--light .pf-muted{color:#5E5A55}
.pf-block--acc{background:linear-gradient(135deg,var(--acc),var(--acc2));color:var(--acc-ink)}
.pf-num{font-size:.76rem;font-weight:800;letter-spacing:.26em;text-transform:uppercase;opacity:.5;margin-bottom:1rem}
.pf-h2{font-size:clamp(2rem,6vw,4rem);font-weight:700;letter-spacing:-.045em;line-height:1;text-transform:uppercase;
  margin-bottom:2.2rem}
.pf-lead{font-size:clamp(1.05rem,2.2vw,1.35rem);line-height:1.55;max-width:60ch;white-space:pre-line}
.pf-muted{color:var(--muted)}

.pf-list{display:grid;gap:0}
.pf-row{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:1.5rem;align-items:baseline;
  padding:1.7rem 0;border-top:1px solid currentColor;position:relative;transition:padding .28s}
.pf-row:last-child{border-bottom:1px solid currentColor}
.pf-row:hover{padding-left:1rem}
.pf-row-n{font-size:.8rem;font-weight:800;opacity:.45;font-variant-numeric:tabular-nums}
.pf-row h3{font-size:clamp(1.2rem,3vw,2rem);font-weight:700;letter-spacing:-.03em;line-height:1.1}
.pf-row .pf-org{font-size:.95rem;opacity:.66;margin-top:.3rem}
.pf-row .pf-when{font-size:.85rem;opacity:.6;white-space:nowrap;font-variant-numeric:tabular-nums}
.pf-row-body{grid-column:2/-1;margin-top:.8rem}
.pf-row-body p{opacity:.72;max-width:62ch}
.pf-row-body ul{margin-top:.5rem}
.pf-row-body li{opacity:.72;padding-left:1.3rem;position:relative;margin-bottom:.3rem;max-width:62ch}
.pf-row-body li::before{content:"→";position:absolute;left:0}
.pf-row-tags{display:flex;flex-wrap:wrap;gap:.4rem;margin-top:.8rem}
.pf-row-tags span{font-size:.74rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;
  border:1px solid currentColor;border-radius:999px;padding:.16rem .65rem;opacity:.7}
.pf-row-links{display:flex;gap:1.2rem;margin-top:.9rem;font-size:.85rem;font-weight:700}
.pf-row-links a{text-decoration:none;display:inline-flex;align-items:center;gap:.35rem;border-bottom:2px solid currentColor}
.pf-row-links a svg{width:14px;height:14px}

.pf-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:2.5rem}
.pf-stats b{display:block;font-size:clamp(2.4rem,6vw,4rem);font-weight:700;letter-spacing:-.05em;line-height:1}
.pf-stats span{font-size:.8rem;font-weight:700;letter-spacing:.14em;text-transform:uppercase;opacity:.62}

.pf-contact{text-align:center}
.pf-contact h2{font-size:clamp(2.4rem,9vw,6rem);font-weight:700;letter-spacing:-.05em;line-height:.9;
  text-transform:uppercase;margin-bottom:1.5rem}
.pf-contact .pf-mail{font-size:clamp(1.1rem,3.5vw,2rem);font-weight:700;text-decoration:none;
  border-bottom:3px solid currentColor;word-break:break-all}
.pf-contact-list{display:flex;flex-wrap:wrap;gap:.8rem 2.2rem;justify-content:center;margin-top:2.5rem;
  font-size:.86rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase}
.pf-contact-list a,.pf-contact-list span{text-decoration:none;display:inline-flex;align-items:center;gap:.5rem;opacity:.82}
.pf-contact-list a:hover{opacity:1}
.pf-contact-list svg{width:16px;height:16px}
footer{padding:2.5rem 0;display:flex;flex-wrap:wrap;gap:1rem;justify-content:space-between;
  font-size:.78rem;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--muted)}
footer a{text-decoration:none;color:var(--muted)}
@media (max-width:800px){
  .pf-nav nav{display:none}
  .pf-row{grid-template-columns:auto minmax(0,1fr);gap:.5rem 1rem}
  .pf-row .pf-when{grid-column:2}
  .pf-row-body{grid-column:1/-1}
}`;

  const rows = (items, render) => `<div class="pf-list">${items.map((it, i) => render(it, i)).join("")}</div>`;

  const body = `
<div id="pf-blob" aria-hidden="true"></div>
<div class="pf-wrap">
<header class="pf-noprint"><div class="pf-nav">
  <a class="pf-brand" href="#top">${pfEsc(c.name)}</a>
  <nav>${c.navItems.map(x => `<a href="#${x.id}">${pfEsc(x.label)}</a>`).join("")}</nav>
  ${c.hasResume ? `<a class="pf-btn pf-btn-ghost" style="padding:.55rem 1.2rem;font-size:.84rem" ${pfResumeAttrs(c)}>${PF_ICONS.download}Résumé</a>` : ""}
</div></header>

<main id="main">
  <section class="pf-hero" id="top"><div class="pf-shell">
    <h1><span>${pfEsc(c.name.split(" ")[0])}</span><span>${pfEsc(c.name.split(" ").slice(1).join(" ") || "•")}</span></h1>
    <div class="pf-hero-row">
      <div>
        ${c.title ? `<div class="pf-role">${pfEsc(c.title)}</div>` : ""}
        ${c.tagline ? `<p>${pfEsc(c.tagline)}</p>` : ""}
        <div class="pf-hero-actions">
          ${d.email ? `<a class="pf-btn pf-btn-primary" href="mailto:${pfEsc(d.email)}">${pfEsc(d.cta_text || "Start a project")}${PF_ICONS.arrow}</a>` : ""}
          ${c.hasResume ? `<a class="pf-btn pf-btn-ghost" ${pfResumeAttrs(c)}>${PF_ICONS.download}${pfEsc(c.resumeLabel)}</a>` : ""}
        </div>
      </div>
      <div style="text-align:right">
        ${d.available ? `<div class="pf-role" style="font-size:.85rem;letter-spacing:.16em;text-transform:uppercase">${pfEsc(d.available)}</div>` : ""}
        ${d.location ? `<div class="pf-muted" style="font-size:.9rem">${pfEsc(d.location)}</div>` : ""}
      </div>
    </div>
    <div class="pf-scroll">Scroll</div>
  </div></section>

  ${c.has("skills") ? `<div class="pf-marquee" id="skills" aria-label="Skills">
    <div class="pf-track">${[0, 1].map(() => `<span>${marquee.map(pfEsc).join("</span><span>")}</span>`).join("")}</div>
  </div>` : ""}

  ${c.has("about") ? `<section class="pf-block pf-block--light" id="about"><div class="pf-shell">
    <div class="pf-num">01 — About</div>
    <h2 class="pf-h2">Who's<br>behind this</h2>
    <p class="pf-lead pf-muted" data-reveal>${pfEsc(d.about)}</p>
  </div></section>` : ""}

  ${c.has("stats") ? `<section class="pf-block pf-block--acc"><div class="pf-shell">
    <div class="pf-stats" data-reveal>${d.stats.map(s =>
      `<div><b>${pfEsc(s.value)}</b><span>${pfEsc(s.label)}</span></div>`).join("")}</div>
  </div></section>` : ""}

  ${c.has("projects") ? `<section class="pf-block" id="projects"><div class="pf-shell">
    <div class="pf-num">02 — Work</div>
    <h2 class="pf-h2">Selected<br>projects</h2>
    ${rows(d.projects, (p, i) => `
      <article class="pf-row" data-reveal data-reveal-delay="${i * 60}">
        <span class="pf-row-n">${String(i + 1).padStart(2, "0")}</span>
        <div><h3>${pfEsc(p.name)}</h3>${p.role ? `<div class="pf-org">${pfEsc(p.role)}</div>` : ""}</div>
        <span class="pf-when">${pfEsc(p.period || "")}</span>
        <div class="pf-row-body">
          ${p.description ? `<p>${pfEsc(p.description)}</p>` : ""}
          ${(p.bullets || []).length ? `<ul>${p.bullets.map(b => `<li>${pfEsc(b)}</li>`).join("")}</ul>` : ""}
          ${(p.tags || []).length ? `<div class="pf-row-tags">${p.tags.map(t => `<span>${pfEsc(t)}</span>`).join("")}</div>` : ""}
          ${pfProjectLinks(p) ? `<div class="pf-row-links">${pfProjectLinks(p)}</div>` : ""}
        </div>
      </article>`)}
  </div></section>` : ""}

  ${c.has("experience") ? `<section class="pf-block pf-block--light" id="experience"><div class="pf-shell">
    <div class="pf-num">03 — Career</div>
    <h2 class="pf-h2">Where<br>I've been</h2>
    ${rows(d.experience, (e, i) => `
      <article class="pf-row" data-reveal data-reveal-delay="${i * 60}">
        <span class="pf-row-n">${String(i + 1).padStart(2, "0")}</span>
        <div><h3>${pfEsc(e.role || "")}</h3><div class="pf-org">${pfJoin([e.org, e.location])}</div></div>
        <span class="pf-when">${pfEsc(e.period || "")}</span>
        <div class="pf-row-body">
          ${e.summary ? `<p>${pfEsc(e.summary)}</p>` : ""}
          ${(e.bullets || []).length ? `<ul>${e.bullets.map(b => `<li>${pfEsc(b)}</li>`).join("")}</ul>` : ""}
        </div>
      </article>`)}
  </div></section>` : ""}

  ${c.has("education") || c.has("certifications") ? `<section class="pf-block" id="education"><div class="pf-shell">
    <div class="pf-num">04 — Background</div>
    <h2 class="pf-h2">Study &<br>credentials</h2>
    ${rows([...d.education.map(e => ({ h: e.degree, o: e.school, w: e.period, t: e.detail })),
            ...(c.has("certifications") ? d.certifications.map((x, k) => ({ h: x, o: "Certification", w: "", t: "", cert: k === 0 })) : [])],
      (e, i) => `
      <article class="pf-row"${e.cert ? ` id="certifications"` : ""} data-reveal data-reveal-delay="${i * 50}">
        <span class="pf-row-n">${String(i + 1).padStart(2, "0")}</span>
        <div><h3>${pfEsc(e.h || "")}</h3>${e.o ? `<div class="pf-org">${pfEsc(e.o)}</div>` : ""}</div>
        <span class="pf-when">${pfEsc(e.w || "")}</span>
        ${e.t ? `<div class="pf-row-body"><p>${pfEsc(e.t)}</p></div>` : ""}
      </article>`)}
  </div></section>` : ""}

  ${c.has("contact") ? `<section class="pf-block pf-block--acc pf-contact" id="contact"><div class="pf-shell">
    <h2>Let's<br>work together</h2>
    <p class="pf-lead" style="margin:0 auto 2.5rem;opacity:.85">${pfEsc(d.cta_text || "Tell me what you're building.")}</p>
    ${d.email ? `<a class="pf-mail" href="mailto:${pfEsc(d.email)}">${pfEsc(d.email)}</a>` : ""}
    <div class="pf-hero-actions" style="justify-content:center">
      ${c.hasResume ? `<a class="pf-btn pf-btn-dark" ${pfResumeAttrs(c)}>${PF_ICONS.download}${pfEsc(c.resumeLabel)}</a>` : ""}
    </div>
    <div class="pf-contact-list">
      ${c.links.filter(x => x.key !== "email").map(x => x.url
        ? `<a href="${pfEsc(x.url)}"${/^https?:/i.test(x.url) ? ` target="_blank" rel="noopener"` : ""}>${x.icon}${pfEsc(x.label)}</a>`
        : `<span>${x.icon}${pfEsc(x.handle)}</span>`).join("")}
    </div>
  </div></section>` : ""}

  <div class="pf-shell"><footer>
    <span>© <span data-year>${c.year}</span> ${pfEsc(c.name)}</span>
    ${d.footer_note ? `<span>${pfEsc(d.footer_note)}</span>` : ""}
    <a href="#top">Top ↑</a>
  </footer></div>
</main>
</div>`;

  const js = `
(function(){
  var head = document.querySelector('header');
  var onScroll = function(){ head.classList.toggle('pf-stuck', scrollY > 40); };
  onScroll(); addEventListener('scroll', onScroll, { passive:true });

  /* The blob lerps toward the pointer inside one rAF loop rather than moving
     on every pointermove event — same effect, a fraction of the work. */
  var blob = document.getElementById('pf-blob');
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (blob && !reduce && matchMedia('(hover: hover)').matches) {
    var tx = innerWidth / 2, ty = innerHeight / 2, x = tx, y = ty, raf = null;
    addEventListener('pointermove', function(e){ tx = e.clientX; ty = e.clientY; if (!raf) raf = requestAnimationFrame(loop); });
    function loop(){
      x += (tx - x) * .085; y += (ty - y) * .085;
      blob.style.transform = 'translate(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px) translate(-50%,-50%)';
      raf = (Math.abs(tx - x) > .5 || Math.abs(ty - y) > .5) ? requestAnimationFrame(loop) : null;
    }
    loop();
  } else if (blob) { blob.style.opacity = '.5'; }
})();`;

  return { fonts: [c.googleFont ? null : "Space+Grotesk:wght@400;500;600;700"].filter(Boolean), css, body, js, themeColor: "#120E17" };
};

// ---------------------------------------------------------------------------
// 10. SLATE — the sober one. Real light/dark toggle, counting stats, prints.
// ---------------------------------------------------------------------------
// The only template that ships both themes. It follows the visitor's system
// setting by default and remembers an explicit choice in localStorage — which
// is what a hiring manager opening it at 11pm actually wants.
PF_RENDERERS.slate = (c) => {
  const d = c.d;

  const css = `
:root{
  --acc:${c.accent}; --acc-ink:${c.accentInk};
  --bg:#EEF2F4; --card:#FFFFFF; --ink:#12222B; --muted:#54666F; --faint:#87979F; --line:#DCE4E8;
  --shadow:0 1px 3px rgba(18,34,43,.06);
  --font:${c.fontStack || `'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif`};
}
:root[data-theme="dark"]{
  --bg:#0D1519; --card:#141F25; --ink:#E6EFF3; --muted:#96A9B2; --faint:#6C7F88; --line:#22313A;
  --shadow:0 1px 3px rgba(0,0,0,.4);
}
@media (prefers-color-scheme:dark){
  :root:not([data-theme="light"]){
    --bg:#0D1519; --card:#141F25; --ink:#E6EFF3; --muted:#96A9B2; --faint:#6C7F88; --line:#22313A;
    --shadow:0 1px 3px rgba(0,0,0,.4);
  }
}
body{background:var(--bg);color:var(--ink);font-family:var(--font);font-size:15.5px;line-height:1.68;
  transition:background .25s,color .25s}
.pf-skip{background:var(--acc);color:var(--acc-ink)}
.pf-shell{width:min(1080px,92vw);margin:0 auto}

header{position:sticky;top:0;z-index:40;background:var(--bg);border-bottom:1px solid var(--line)}
.pf-nav{width:min(1080px,92vw);margin:0 auto;display:flex;align-items:center;gap:1.3rem;padding:.85rem 0;flex-wrap:wrap;row-gap:.5rem}
.pf-brand{display:flex;align-items:center;gap:.6rem;font-weight:700;text-decoration:none;margin-right:auto;letter-spacing:-.01em}
.pf-brand i{width:30px;height:30px;border-radius:8px;background:var(--acc);color:var(--acc-ink);display:grid;
  place-items:center;font-style:normal;font-size:.76rem;font-weight:800}
.pf-nav nav{display:flex;gap:1.25rem;flex-wrap:wrap;min-width:0;row-gap:.4rem}
.pf-nav nav a{color:var(--muted);text-decoration:none;font-size:.88rem;font-weight:500;transition:color .2s}
.pf-nav nav a:hover{color:var(--acc)}
.pf-theme{width:36px;height:36px;border-radius:10px;border:1px solid var(--line);background:var(--card);
  cursor:pointer;display:grid;place-items:center;font-size:.95rem;color:var(--muted);transition:.2s}
.pf-theme:hover{border-color:var(--acc);color:var(--acc)}

.pf-btn{display:inline-flex;align-items:center;gap:.5rem;padding:.7rem 1.25rem;border-radius:10px;font-weight:600;
  font-size:.9rem;text-decoration:none;cursor:pointer;border:1px solid transparent;transition:.2s}
.pf-btn svg{width:16px;height:16px}
.pf-btn-primary{background:var(--acc);color:var(--acc-ink)}
.pf-btn-primary:hover{filter:brightness(1.08);transform:translateY(-1px)}
.pf-btn-ghost{border-color:var(--line);color:var(--ink);background:var(--card)}
.pf-btn-ghost:hover{border-color:var(--acc);color:var(--acc)}

.pf-hero{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:2.5rem;align-items:center;
  padding:clamp(2.5rem,6vw,4.5rem) 0}
.pf-hero h1{font-size:clamp(2rem,5vw,3.1rem);font-weight:800;letter-spacing:-.035em;line-height:1.08;margin-bottom:.5rem}
.pf-hero .pf-role{color:var(--acc);font-weight:600;font-size:1.05rem;margin-bottom:.9rem}
.pf-hero p{color:var(--muted);max-width:56ch}
.pf-avail{display:inline-flex;align-items:center;gap:.45rem;font-size:.78rem;font-weight:700;padding:.3rem .75rem;
  border-radius:999px;background:${pfRgba(c.accent, .13)};color:var(--acc);margin-bottom:1rem}
.pf-avail i{width:6px;height:6px;border-radius:50%;background:var(--acc)}
.pf-hero-actions{display:flex;flex-wrap:wrap;gap:.7rem;align-items:center;margin-top:1.6rem}
.pf-avatar{width:150px;height:150px;border-radius:18px;object-fit:cover;box-shadow:0 12px 30px rgba(18,34,43,.15)}
.pf-avatar-initials{display:grid;place-items:center;font-size:3rem;font-weight:800;background:var(--acc);color:var(--acc-ink)}
.pf-socials{display:flex;gap:.45rem}
.pf-socials a{display:grid;place-items:center;width:36px;height:36px;border-radius:10px;background:var(--card);
  border:1px solid var(--line);color:var(--muted);transition:.2s}
.pf-socials a svg{width:16px;height:16px}
.pf-socials a:hover{background:var(--acc);color:var(--acc-ink);border-color:var(--acc)}

.pf-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:1rem;
  padding-bottom:clamp(1.5rem,4vw,2.5rem)}
.pf-statc{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:1.3rem;text-align:center;
  box-shadow:var(--shadow)}
.pf-statc b{display:block;font-size:1.95rem;font-weight:800;letter-spacing:-.03em;color:var(--acc);
  font-variant-numeric:tabular-nums}
.pf-statc span{font-size:.79rem;color:var(--faint);font-weight:500}

.pf-sec{padding:clamp(2rem,5vw,3.2rem) 0;border-top:1px solid var(--line)}
.pf-sec-grid{display:grid;grid-template-columns:minmax(0,220px) minmax(0,1fr);gap:2rem}
.pf-h2{font-size:1.02rem;font-weight:800;letter-spacing:-.015em;margin-bottom:.35rem}
.pf-h2-sub{color:var(--faint);font-size:.84rem}
.pf-card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:1.4rem 1.5rem;
  box-shadow:var(--shadow)}
.pf-card+.pf-card{margin-top:.85rem}
.pf-about{color:var(--muted);white-space:pre-line}
.pf-chips{display:flex;flex-wrap:wrap;gap:.45rem}
.pf-chip{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:.4rem .85rem;
  font-size:.86rem;color:var(--muted);transition:.2s}
.pf-chip:hover{border-color:var(--acc);color:var(--acc)}
.pf-item-top{display:flex;flex-wrap:wrap;gap:.3rem 1rem;align-items:baseline;justify-content:space-between}
.pf-item-top h3{font-size:1.03rem;font-weight:700}
.pf-when{color:var(--faint);font-size:.82rem;white-space:nowrap;font-variant-numeric:tabular-nums}
.pf-org{color:var(--acc);font-size:.9rem;font-weight:600;margin:.15rem 0 .6rem}
.pf-card p{color:var(--muted);font-size:.94rem}
.pf-card ul{margin-top:.5rem}
.pf-card li{color:var(--muted);font-size:.93rem;padding-left:1.15rem;position:relative;margin-bottom:.3rem}
.pf-card li::before{content:"";position:absolute;left:0;top:.62em;width:5px;height:5px;border-radius:50%;background:var(--acc)}
.pf-tags{display:flex;flex-wrap:wrap;gap:.35rem;margin-top:.8rem}
.pf-tag{font-size:.73rem;font-weight:600;padding:.2rem .55rem;border-radius:5px;background:${pfRgba(c.accent, .13)};color:var(--acc)}
.pf-links{display:flex;gap:1rem;margin-top:.8rem;font-size:.84rem;font-weight:600}
.pf-links a{color:var(--ink);text-decoration:none;display:inline-flex;align-items:center;gap:.35rem}
.pf-links a svg{width:14px;height:14px}
.pf-links a:hover{color:var(--acc)}
.pf-certs li{display:flex;gap:.7rem;color:var(--muted);font-size:.93rem;padding:.35rem 0}
.pf-certs li::before{content:"✓";color:var(--acc);font-weight:800}
.pf-contact-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:.85rem}
.pf-contact-grid a,.pf-contact-grid span{background:var(--card);border:1px solid var(--line);border-radius:12px;
  padding:.95rem 1.1rem;text-decoration:none;display:block;transition:.2s;box-shadow:var(--shadow)}
.pf-contact-grid a:hover{border-color:var(--acc);transform:translateY(-2px)}
.pf-contact-grid small{display:block;font-size:.72rem;letter-spacing:.1em;text-transform:uppercase;color:var(--faint);
  font-weight:700;margin-bottom:.25rem}
.pf-contact-grid strong{font-weight:500;font-size:.92rem;color:var(--ink);word-break:break-word}
footer{padding:2rem 0 3rem;border-top:1px solid var(--line);color:var(--faint);font-size:.84rem;
  display:flex;flex-wrap:wrap;gap:.8rem;justify-content:space-between}
footer a{color:var(--faint);text-decoration:none}
footer a:hover{color:var(--acc)}
@media (max-width:820px){
  .pf-sec-grid{grid-template-columns:1fr;gap:1rem}
  .pf-hero{grid-template-columns:1fr}
  .pf-nav nav{display:none}
}
@media print{ header,.pf-theme,.pf-socials{display:none} .pf-card{break-inside:avoid} }`;

  const section = (id, title, sub, inner) => `
    <section class="pf-sec" id="${id}"><div class="pf-sec-grid">
      <div><h2 class="pf-h2">${pfEsc(title)}</h2><p class="pf-h2-sub">${pfEsc(sub)}</p></div>
      <div>${inner}</div>
    </div></section>`;

  const body = `
<header class="pf-noprint"><div class="pf-nav">
  <a class="pf-brand" href="#top"><i>${pfEsc(c.initials)}</i>${pfEsc(c.name)}</a>
  <nav>${c.navItems.map(x => `<a href="#${x.id}">${pfEsc(x.label)}</a>`).join("")}</nav>
  ${c.hasResume ? `<a class="pf-btn pf-btn-ghost" ${pfResumeAttrs(c)}>${PF_ICONS.download}Résumé</a>` : ""}
  <button class="pf-theme" id="pf-theme" type="button" aria-label="Switch between light and dark">◐</button>
</div></header>

<main id="main" class="pf-shell">
  <section class="pf-hero" id="top">
    <div>
      ${d.available ? `<div class="pf-avail"><i></i>${pfEsc(d.available)}</div>` : ""}
      <h1>${pfEsc(c.name)}</h1>
      ${c.title ? `<div class="pf-role">${pfEsc(c.title)}</div>` : ""}
      ${c.tagline ? `<p>${pfEsc(c.tagline)}</p>` : ""}
      <div class="pf-hero-actions">
        ${d.email ? `<a class="pf-btn pf-btn-primary" href="mailto:${pfEsc(d.email)}">${PF_ICONS.mail}${pfEsc(d.cta_text || "Get in touch")}</a>` : ""}
        ${c.hasResume ? `<a class="pf-btn pf-btn-ghost" ${pfResumeAttrs(c)}>${PF_ICONS.download}${pfEsc(c.resumeLabel)}</a>` : ""}
        ${pfSocialRow(c)}
      </div>
    </div>
    ${pfAvatar(c)}
  </section>

  ${c.has("stats") ? `<div class="pf-stats">${d.stats.map(s =>
    `<div class="pf-statc" data-reveal><b data-count="${pfEsc(s.value)}">${pfEsc(s.value)}</b><span>${pfEsc(s.label)}</span></div>`).join("")}</div>` : ""}

  ${c.has("about") ? section("about", "About", "The short version",
    `<div class="pf-card" data-reveal><p class="pf-about">${pfEsc(d.about)}</p></div>`) : ""}

  ${c.has("skills") ? section("skills", "Skills", `${d.skills.length} tools and technologies`,
    `<div class="pf-chips" data-reveal>${d.skills.map(s => `<span class="pf-chip">${pfEsc(s)}</span>`).join("")}</div>`) : ""}

  ${c.has("experience") ? section("experience", "Experience", `${d.experience.length} role${d.experience.length === 1 ? "" : "s"}`,
    d.experience.map((e, i) => `
      <article class="pf-card" data-reveal data-reveal-delay="${i * 60}">
        <div class="pf-item-top"><h3>${pfEsc(e.role || "")}</h3><span class="pf-when">${pfEsc(e.period || "")}</span></div>
        <div class="pf-org">${pfJoin([e.org, e.location])}</div>
        ${e.summary ? `<p>${pfEsc(e.summary)}</p>` : ""}
        ${(e.bullets || []).length ? `<ul>${e.bullets.map(b => `<li>${pfEsc(b)}</li>`).join("")}</ul>` : ""}
      </article>`).join("")) : ""}

  ${c.has("projects") ? section("projects", "Projects", `${d.projects.length} selected`,
    d.projects.map((p, i) => `
      <article class="pf-card" data-reveal data-reveal-delay="${i * 60}">
        <div class="pf-item-top"><h3>${pfEsc(p.name)}</h3><span class="pf-when">${pfEsc(p.period || "")}</span></div>
        ${p.role ? `<div class="pf-org">${pfEsc(p.role)}</div>` : ""}
        ${p.description ? `<p>${pfEsc(p.description)}</p>` : ""}
        ${(p.bullets || []).length ? `<ul>${p.bullets.map(b => `<li>${pfEsc(b)}</li>`).join("")}</ul>` : ""}
        ${(p.tags || []).length ? `<div class="pf-tags">${p.tags.map(t => `<span class="pf-tag">${pfEsc(t)}</span>`).join("")}</div>` : ""}
        ${pfProjectLinks(p) ? `<div class="pf-links">${pfProjectLinks(p)}</div>` : ""}
      </article>`).join("")) : ""}

  ${c.has("education") ? section("education", "Education", "Where I studied",
    d.education.map(e => `
      <article class="pf-card" data-reveal>
        <div class="pf-item-top"><h3>${pfEsc(e.degree || "")}</h3><span class="pf-when">${pfEsc(e.period || "")}</span></div>
        <div class="pf-org">${pfEsc(e.school || "")}</div>
        ${e.detail ? `<p>${pfEsc(e.detail)}</p>` : ""}
      </article>`).join("")) : ""}

  ${c.has("certifications") ? section("certifications", "Certifications", `${d.certifications.length} earned`,
    `<div class="pf-card" data-reveal><ul class="pf-certs">${d.certifications.map(x => `<li>${pfEsc(x)}</li>`).join("")}</ul></div>`) : ""}

  ${c.has("contact") ? section("contact", "Contact", d.cta_text || "Open to new work",
    `<div class="pf-contact-grid" data-reveal>${c.links.map(x => x.url
      ? `<a href="${pfEsc(x.url)}"${/^https?:/i.test(x.url) ? ` target="_blank" rel="noopener"` : ""}><small>${pfEsc(x.label)}</small><strong>${pfEsc(x.handle)}</strong></a>`
      : `<span><small>${pfEsc(x.label)}</small><strong>${pfEsc(x.handle)}</strong></span>`).join("")}</div>`) : ""}

  <footer>
    <span>© <span data-year>${c.year}</span> ${pfEsc(c.name)}${d.footer_note ? " · " + pfEsc(d.footer_note) : ""}</span>
    <a href="#top">Back to top ↑</a>
  </footer>
</main>`;

  const js = `
(function(){
  var root = document.documentElement, btn = document.getElementById('pf-theme');
  var KEY = 'pf-theme';
  /* A stored choice wins; with none, the OS setting decides and keeps
     deciding — so someone who switches their laptop to dark at sunset gets a
     dark page without touching anything here. */
  try { var saved = localStorage.getItem(KEY); if (saved) root.setAttribute('data-theme', saved); } catch(e){}
  var paint = function(){
    var dark = root.getAttribute('data-theme') === 'dark' ||
      (!root.getAttribute('data-theme') && matchMedia('(prefers-color-scheme: dark)').matches);
    btn.textContent = dark ? '☀' : '☾';
    btn.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
  };
  paint();
  btn.addEventListener('click', function(){
    var dark = root.getAttribute('data-theme') === 'dark' ||
      (!root.getAttribute('data-theme') && matchMedia('(prefers-color-scheme: dark)').matches);
    var next = dark ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    try { localStorage.setItem(KEY, next); } catch(e){}
    paint();
  });
  matchMedia('(prefers-color-scheme: dark)').addEventListener &&
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', paint);

  /* Stat counters */
  var reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  document.querySelectorAll('[data-count]').forEach(function(el){
    var raw = el.getAttribute('data-count') || '', m = raw.match(/-?[\\d.,]+/);
    if (!m || reduce) return;
    var target = parseFloat(m[0].replace(/,/g,'')), pre = raw.slice(0, m.index), post = raw.slice(m.index + m[0].length);
    var dec = (m[0].split('.')[1] || '').length;
    var run = function(){
      var t0 = performance.now();
      (function step(now){
        var k = Math.min(1, (now - t0) / 1200), e = 1 - Math.pow(1 - k, 3);
        el.textContent = pre + (target * e).toFixed(dec).replace(/\\B(?=(\\d{3})+(?!\\d))/g, ',') + post;
        if (k < 1) requestAnimationFrame(step);
      })(t0);
    };
    if ('IntersectionObserver' in window) {
      var o = new IntersectionObserver(function(en){ if (en[0].isIntersecting) { run(); o.disconnect(); } }, { threshold:.4 });
      o.observe(el);
    } else run();
  });
})();`;

  return { fonts: [c.googleFont ? null : "Inter:wght@400;500;600;700;800"].filter(Boolean), css, body, js, themeColor: "#EEF2F4" };
};


// ---------------------------------------------------------------------------
// 11. PRISM — light refracted. Iridescent conic aura, chromatic-split name,
//     glass that bends what is behind it as the pointer crosses.
// ---------------------------------------------------------------------------
PF_RENDERERS.prism = (c) => {
  const d = c.d;
  const nav = c.navItems.map(n => `<a href="#${n.id}">${pfEsc(n.label)}</a>`).join("");
  const a2 = pfHueShift(c.accent, 70), a3 = pfHueShift(c.accent, 170);

  const css = `
:root{
  --acc:${c.accent}; --acc2:${a2}; --acc3:${a3}; --ink:#F2EEFF; --muted:#A79FC4; --faint:#6E6790;
  --bg:#0A0714; --panel:rgba(20,14,38,.55); --line:rgba(255,255,255,.11);
  --font:${c.fontStack || `'Space Grotesk','Inter',-apple-system,'Segoe UI',Roboto,sans-serif`};
}
body{background:var(--bg);color:var(--ink);font-family:var(--font);font-size:16px;line-height:1.7;overflow-x:hidden}
.pf-skip{background:var(--acc);color:${c.accentInk}}
.pf-shell{width:min(1120px,92vw);margin:0 auto}

/* The aura. One element, three conic stops, rotating forever behind a heavy
   blur — cheaper than a canvas and it never drops a frame.
   It is anchored to the top and veiled below, because a full-bleed rotating
   gradient at this saturation turns the whole page into a pastel wash and
   takes every word of body copy down with it. Colour belongs behind the name;
   everything past the fold falls back to near-black so the text can be read. */
.pf-aura{position:fixed;top:-45vmin;left:50%;width:150vw;height:115vh;transform:translateX(-50%);
  z-index:0;pointer-events:none;filter:blur(110px) saturate(135%);opacity:.4}
.pf-aura i{position:absolute;inset:0;border-radius:50%;
  background:conic-gradient(from 0deg,var(--acc),var(--acc2),var(--acc3),var(--acc));
  animation:pf-spin 26s linear infinite}
.pf-aura i:nth-child(2){inset:14vmin 18vmin;animation-duration:38s;animation-direction:reverse;opacity:.65;
  background:conic-gradient(from 120deg,var(--acc3),transparent 40%,var(--acc2),transparent 80%,var(--acc3))}
@keyframes pf-spin{to{transform:rotate(360deg)}}
.pf-veil{position:fixed;inset:0;z-index:1;pointer-events:none;
  background:radial-gradient(125% 78% at 50% -6%,transparent 0%,${pfRgba("#0A0714", .55)} 42%,var(--bg) 74%)}
.pf-grain{position:fixed;inset:0;z-index:2;pointer-events:none;opacity:.32;mix-blend-mode:overlay;
  background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='3'/%3E%3C/filter%3E%3Crect width='140' height='140' filter='url(%23n)' opacity='.5'/%3E%3C/svg%3E")}
main{position:relative;z-index:3}
.pf-nav{position:sticky;z-index:20}

.pf-nav{position:sticky;top:0;backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);
  border-bottom:1px solid transparent;transition:.3s}
.pf-nav.pf-stuck{background:rgba(10,7,20,.94);border-bottom-color:var(--line)}
.pf-nav-in{display:flex;align-items:center;gap:1.4rem;padding:.9rem 0}
.pf-brand{font-weight:800;letter-spacing:-.02em;display:flex;align-items:center;gap:.6rem;text-decoration:none}
.pf-brand i{width:26px;height:26px;border-radius:8px;display:grid;place-items:center;font-size:.7rem;font-weight:800;
  background:linear-gradient(135deg,var(--acc),var(--acc3));color:#fff;font-style:normal}
.pf-nav-links{display:flex;gap:.3rem;margin-left:auto}
.pf-nav-links a{padding:.4rem .8rem;border-radius:999px;font-size:.87rem;color:var(--muted);text-decoration:none;transition:.2s}
.pf-nav-links a:hover,.pf-nav-links a.pf-active{color:var(--ink);background:var(--panel)}

.pf-hero{padding:clamp(3.5rem,10vw,6.5rem) 0 clamp(1.5rem,4vw,2.5rem);text-align:center}
.pf-badge{display:inline-flex;align-items:center;gap:.5rem;padding:.4rem 1rem;border-radius:999px;
  border:1px solid var(--line);background:var(--panel);font-size:.8rem;font-weight:600;color:var(--muted);margin-bottom:1.6rem}
.pf-badge i{width:7px;height:7px;border-radius:50%;background:var(--acc);box-shadow:0 0 0 4px ${pfRgba(c.accent, .18)};
  animation:pf-pulse 2.4s ease-in-out infinite}
@keyframes pf-pulse{50%{box-shadow:0 0 0 9px ${pfRgba(c.accent, 0)}}}

/* Chromatic split: the same word three times, two of them offset and screened
   back in. It reads as one word until it moves. */
.pf-chroma{position:relative;display:inline-block;font-size:clamp(2.8rem,9vw,6.4rem);font-weight:800;
  letter-spacing:-.045em;line-height:1;background:linear-gradient(100deg,#fff 20%,var(--acc2) 60%,#fff);
  -webkit-background-clip:text;background-clip:text;color:transparent}
.pf-chroma::before,.pf-chroma::after{content:attr(data-text);position:absolute;left:0;top:0;width:100%;
  -webkit-background-clip:border-box;background-clip:border-box;background:none;pointer-events:none;mix-blend-mode:screen}
.pf-chroma::before{color:${pfRgba(a3, .6)};animation:pf-chr1 5s ease-in-out infinite}
.pf-chroma::after{color:${pfRgba(c.accent, .6)};animation:pf-chr2 5s ease-in-out infinite}
@keyframes pf-chr1{0%,100%{transform:translate(-2px,0)}50%{transform:translate(2px,0)}}
@keyframes pf-chr2{0%,100%{transform:translate(2px,0)}50%{transform:translate(-2px,0)}}

.pf-hero h2{font-size:clamp(1rem,2.4vw,1.35rem);font-weight:600;color:var(--acc2);margin:1.1rem 0 .9rem;letter-spacing:.01em}
.pf-hero p{color:var(--muted);max-width:56ch;margin:0 auto;font-size:1.02rem}
.pf-actions{display:flex;flex-wrap:wrap;gap:.7rem;justify-content:center;align-items:center;margin-top:2rem}
.pf-btn{display:inline-flex;align-items:center;gap:.5rem;padding:.8rem 1.5rem;border-radius:999px;font-weight:600;
  font-size:.93rem;text-decoration:none;border:1px solid var(--line);transition:.25s;position:relative;overflow:hidden}
.pf-btn svg{width:16px;height:16px}
.pf-btn-primary{border-color:transparent;color:#fff;
  background:linear-gradient(120deg,var(--acc),var(--acc3));box-shadow:0 10px 34px ${pfRgba(c.accent, .4)}}
.pf-btn-primary:hover{transform:translateY(-3px);box-shadow:0 16px 44px ${pfRgba(c.accent, .55)}}
.pf-btn-ghost{background:var(--panel);color:var(--ink)}
.pf-btn-ghost:hover{border-color:var(--acc2);transform:translateY(-3px)}
.pf-socials{display:flex;gap:.5rem}
.pf-socials a{display:grid;place-items:center;width:40px;height:40px;border-radius:50%;
  background:var(--panel);border:1px solid var(--line);color:var(--muted);transition:.25s}
.pf-socials a svg{width:16px;height:16px}
.pf-socials a:hover{color:#fff;border-color:var(--acc2);transform:translateY(-3px) rotate(-6deg)}

/* Glass. The sheen is a radial gradient parked at the pointer, so hovering a
   card lights the surface instead of just changing its border colour. */
.pf-glass{position:relative;border:1px solid var(--line);border-radius:20px;background:var(--panel);
  backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);overflow:hidden;transition:.3s}
.pf-glass::before{content:"";position:absolute;inset:0;opacity:0;transition:opacity .35s;pointer-events:none;
  background:radial-gradient(340px circle at var(--mx,50%) var(--my,50%),${pfRgba(c.accent, .22)},transparent 70%)}
.pf-glass::after{content:"";position:absolute;inset:0;border-radius:20px;pointer-events:none;padding:1px;
  background:linear-gradient(140deg,${pfRgba(a2, .55)},transparent 40%,${pfRgba(c.accent, .45)});
  -webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);
  -webkit-mask-composite:xor;mask-composite:exclude;opacity:0;transition:opacity .35s}
.pf-glass:hover{transform:translateY(-4px);border-color:transparent}
.pf-glass:hover::before,.pf-glass:hover::after{opacity:1}

.pf-sec{padding:clamp(2.4rem,6vw,4rem) 0}
.pf-eyebrow{font-size:.72rem;font-weight:800;letter-spacing:.2em;text-transform:uppercase;
  background:linear-gradient(90deg,var(--acc),var(--acc3));-webkit-background-clip:text;background-clip:text;
  color:transparent;margin-bottom:.6rem}
.pf-h2{font-size:clamp(1.6rem,4vw,2.4rem);font-weight:800;letter-spacing:-.035em;margin-bottom:2rem}
.pf-about{padding:2rem;white-space:pre-line;color:var(--muted);font-size:1.02rem}

.pf-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:1rem}
.pf-stat{padding:1.6rem 1.2rem;text-align:center}
.pf-stat b{display:block;font-size:2.4rem;font-weight:800;letter-spacing:-.04em;
  background:linear-gradient(160deg,#fff,var(--acc2));-webkit-background-clip:text;background-clip:text;color:transparent}
.pf-stat span{font-size:.78rem;color:var(--faint);font-weight:600;letter-spacing:.06em;text-transform:uppercase}

.pf-pills{display:flex;flex-wrap:wrap;gap:.55rem}
.pf-pill{position:relative;padding:.5rem 1.15rem;border-radius:999px;font-size:.9rem;color:var(--muted);
  border:1px solid var(--line);background:var(--panel);transition:.25s;cursor:default}
.pf-pill:hover{color:#fff;transform:translateY(-3px) scale(1.04);
  background:linear-gradient(120deg,${pfRgba(c.accent, .3)},${pfRgba(a3, .3)});border-color:transparent}

.pf-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:1.1rem}
.pf-proj{padding:1.7rem}
.pf-proj h3{font-size:1.2rem;font-weight:700;letter-spacing:-.02em;margin-bottom:.2rem}
.pf-proj .pf-role{font-size:.8rem;color:var(--acc2);font-weight:600;margin-bottom:.7rem}
.pf-proj p{color:var(--muted);font-size:.94rem}
.pf-proj ul{margin-top:.7rem}
.pf-proj li{color:var(--muted);font-size:.9rem;padding-left:1.15rem;position:relative;margin-bottom:.28rem}
.pf-proj li::before{content:"";position:absolute;left:0;top:.62em;width:5px;height:5px;border-radius:50%;
  background:linear-gradient(120deg,var(--acc),var(--acc3))}
.pf-tags{display:flex;flex-wrap:wrap;gap:.35rem;margin-top:.9rem}
.pf-tag{font-size:.71rem;font-weight:600;padding:.2rem .58rem;border-radius:6px;color:var(--muted);
  background:rgba(255,255,255,.06);border:1px solid var(--line)}
.pf-links{display:flex;gap:1rem;margin-top:.9rem;font-size:.84rem;font-weight:600}
.pf-links a{color:var(--acc2);text-decoration:none;display:inline-flex;align-items:center;gap:.35rem}
.pf-links a svg{width:14px;height:14px}
.pf-links a:hover{color:#fff}

.pf-rows{display:grid;gap:.9rem}
.pf-row{padding:1.5rem 1.7rem}
.pf-row-top{display:flex;flex-wrap:wrap;gap:.3rem 1rem;align-items:baseline}
.pf-row h3{font-size:1.1rem;font-weight:700}
.pf-row .pf-org{color:var(--acc2);font-size:.92rem;font-weight:600}
.pf-row .pf-when{margin-left:auto;color:var(--faint);font-size:.82rem;white-space:nowrap;font-variant-numeric:tabular-nums}
.pf-row p{color:var(--muted);font-size:.94rem;margin-top:.5rem}
.pf-row ul{margin-top:.5rem}
.pf-row li{color:var(--muted);font-size:.9rem;padding-left:1.15rem;position:relative;margin-bottom:.28rem}
.pf-row li::before{content:"";position:absolute;left:0;top:.62em;width:5px;height:5px;border-radius:50%;background:var(--acc)}

.pf-contact{padding:clamp(2.4rem,6vw,4rem);text-align:center}
.pf-contact h2{font-size:clamp(1.8rem,5vw,3rem);font-weight:800;letter-spacing:-.04em;margin-bottom:.8rem}
.pf-contact p{color:var(--muted);max-width:48ch;margin:0 auto 1.8rem}
.pf-clist{display:flex;flex-wrap:wrap;gap:.7rem 1.8rem;justify-content:center;margin-top:1.8rem;font-size:.9rem}
.pf-clist a,.pf-clist span{color:var(--muted);text-decoration:none;display:inline-flex;align-items:center;gap:.45rem}
.pf-clist svg{width:16px;height:16px;color:var(--acc2)}
.pf-clist a:hover{color:#fff}
footer{padding:3rem 0;text-align:center;color:var(--faint);font-size:.84rem}
@media (max-width:760px){.pf-nav-links{display:none}.pf-row .pf-when{margin-left:0;width:100%}}
@media (prefers-reduced-motion:reduce){.pf-aura i{animation:none}.pf-chroma::before,.pf-chroma::after{animation:none;display:none}}`;

  const body = `
<div class="pf-aura" aria-hidden="true"><i></i><i></i></div>
<div class="pf-veil" aria-hidden="true"></div>
<div class="pf-grain" aria-hidden="true"></div>
<nav class="pf-nav pf-noprint"><div class="pf-shell pf-nav-in">
  <a class="pf-brand" href="#top"><i>${pfEsc(c.initials)}</i>${pfEsc(c.name)}</a>
  ${nav ? `<div class="pf-nav-links">${nav}</div>` : ""}
</div></nav>

<main id="main"><div class="pf-shell">
  <section class="pf-hero" id="top">
    ${d.available ? `<div class="pf-badge"><i></i>${pfEsc(d.available)}</div>` : ""}
    <h1><span class="pf-chroma" data-text="${pfEsc(c.name)}">${pfEsc(c.name)}</span></h1>
    ${c.title ? `<h2>${pfEsc(c.title)}</h2>` : ""}
    ${c.tagline ? `<p>${pfEsc(c.tagline)}</p>` : ""}
    <div class="pf-actions">
      ${d.email ? `<a class="pf-btn pf-btn-primary" href="mailto:${pfEsc(d.email)}">${PF_ICONS.mail}${pfEsc(d.cta_text || "Get in touch")}</a>` : ""}
      ${c.hasResume ? `<a class="pf-btn pf-btn-ghost" ${pfResumeAttrs(c)}>${PF_ICONS.download}${pfEsc(c.resumeLabel)}</a>` : ""}
      ${pfSocialRow(c)}
    </div>
  </section>

  ${c.has("stats") ? `<section class="pf-sec"><div class="pf-stats">
    ${d.stats.map((x, i) => `<div class="pf-glass pf-stat" data-glow data-reveal data-reveal-delay="${i * 70}">
      <b>${pfEsc(x.value)}</b><span>${pfEsc(x.label)}</span></div>`).join("")}
  </div></section>` : ""}

  ${c.has("about") ? `<section class="pf-sec" id="about">
    <div class="pf-eyebrow">About</div><h2 class="pf-h2">The short version</h2>
    <div class="pf-glass pf-about" data-glow data-reveal>${pfEsc(d.about)}</div></section>` : ""}

  ${c.has("skills") ? `<section class="pf-sec" id="skills">
    <div class="pf-eyebrow">Toolkit</div><h2 class="pf-h2">What I work with</h2>
    <div class="pf-pills" data-reveal>${d.skills.map(x => `<span class="pf-pill">${pfEsc(x)}</span>`).join("")}</div></section>` : ""}

  ${c.has("projects") ? `<section class="pf-sec" id="projects">
    <div class="pf-eyebrow">Work</div><h2 class="pf-h2">Selected projects</h2>
    <div class="pf-grid">${d.projects.map((x, i) => `
      <article class="pf-glass pf-proj" data-glow data-reveal data-reveal-delay="${Math.min(i, 5) * 80}">
        <h3>${pfEsc(x.name || "")}</h3>
        ${pfJoin([x.role, x.period]) ? `<div class="pf-role">${pfJoin([x.role, x.period])}</div>` : ""}
        ${x.description ? `<p>${pfEsc(x.description)}</p>` : ""}
        ${(x.bullets || []).length ? `<ul>${x.bullets.map(b => `<li>${pfEsc(b)}</li>`).join("")}</ul>` : ""}
        ${(x.tags || []).length ? `<div class="pf-tags">${x.tags.map(t => `<span class="pf-tag">${pfEsc(t)}</span>`).join("")}</div>` : ""}
        ${pfProjectLinks(x) ? `<div class="pf-links">${pfProjectLinks(x)}</div>` : ""}
      </article>`).join("")}</div></section>` : ""}

  ${c.has("experience") ? `<section class="pf-sec" id="experience">
    <div class="pf-eyebrow">Experience</div><h2 class="pf-h2">Where I have worked</h2>
    <div class="pf-rows">${d.experience.map((x, i) => `
      <article class="pf-glass pf-row" data-glow data-reveal data-reveal-delay="${Math.min(i, 5) * 70}">
        <div class="pf-row-top"><h3>${pfEsc(x.role || "")}</h3>
          ${x.org ? `<span class="pf-org">${pfEsc(x.org)}</span>` : ""}
          ${x.period ? `<span class="pf-when">${pfEsc(x.period)}</span>` : ""}</div>
        ${x.summary ? `<p>${pfEsc(x.summary)}</p>` : ""}
        ${(x.bullets || []).length ? `<ul>${x.bullets.map(b => `<li>${pfEsc(b)}</li>`).join("")}</ul>` : ""}
      </article>`).join("")}</div></section>` : ""}

  ${c.has("education") ? `<section class="pf-sec" id="education">
    <div class="pf-eyebrow">Education</div><h2 class="pf-h2">Where I studied</h2>
    <div class="pf-rows">${d.education.map(x => `
      <article class="pf-glass pf-row" data-glow data-reveal>
        <div class="pf-row-top"><h3>${pfEsc(x.degree || "")}</h3>
          ${x.school ? `<span class="pf-org">${pfEsc(x.school)}</span>` : ""}
          ${x.period ? `<span class="pf-when">${pfEsc(x.period)}</span>` : ""}</div>
        ${x.detail ? `<p>${pfEsc(x.detail)}</p>` : ""}
      </article>`).join("")}</div></section>` : ""}

  ${c.has("certifications") ? `<section class="pf-sec" id="certifications">
    <div class="pf-eyebrow">Credentials</div><h2 class="pf-h2">Certifications</h2>
    <div class="pf-pills" data-reveal>${d.certifications.map(x => `<span class="pf-pill">${pfEsc(x)}</span>`).join("")}</div></section>` : ""}

  ${c.has("contact") ? `<section class="pf-sec" id="contact">
    <div class="pf-glass pf-contact" data-glow data-reveal>
      <h2>Let's make something</h2>
      <p>${pfEsc(d.cta_text || "Tell me what you are building and I will tell you if I can help.")}</p>
      <div class="pf-actions" style="margin-top:0">
        ${d.email ? `<a class="pf-btn pf-btn-primary" href="mailto:${pfEsc(d.email)}">${PF_ICONS.mail}${pfEsc(d.email)}</a>` : ""}
        ${c.hasResume ? `<a class="pf-btn pf-btn-ghost" ${pfResumeAttrs(c)}>${PF_ICONS.download}Résumé</a>` : ""}
      </div>
      <div class="pf-clist">${c.links.map(x => x.url
        ? `<a href="${pfEsc(x.url)}"${/^https?:/i.test(x.url) ? ` target="_blank" rel="noopener"` : ""}>${x.icon}${pfEsc(x.handle)}</a>`
        : `<span>${x.icon}${pfEsc(x.handle)}</span>`).join("")}</div>
    </div></section>` : ""}

  <footer>© <span data-year>${c.year}</span> ${pfEsc(c.name)}${d.footer_note ? " · " + pfEsc(d.footer_note) : ""}</footer>
</div></main>`;

  const js = `
(function(){
  var nav = document.querySelector('.pf-nav');
  var onScroll = function(){ nav.classList.toggle('pf-stuck', window.scrollY > 12); };
  onScroll(); addEventListener('scroll', onScroll, { passive:true });

  var links = [].slice.call(document.querySelectorAll('.pf-nav-links a'));
  var secs = links.map(function(a){ return document.querySelector(a.getAttribute('href')); }).filter(Boolean);
  if ('IntersectionObserver' in window && secs.length) {
    var spy = new IntersectionObserver(function(es){
      es.forEach(function(e){ if(!e.isIntersecting) return;
        links.forEach(function(a){ a.classList.toggle('pf-active', a.getAttribute('href') === '#' + e.target.id); }); });
    }, { rootMargin:'-45% 0px -50% 0px' });
    secs.forEach(function(s){ spy.observe(s); });
  }

  /* The refraction sheen is two CSS custom properties, not a repaint of the
     card: the browser only re-resolves one gradient's centre point. */
  document.querySelectorAll('[data-glow]').forEach(function(el){
    el.addEventListener('pointermove', function(e){
      var r = el.getBoundingClientRect();
      el.style.setProperty('--mx', (e.clientX - r.left) + 'px');
      el.style.setProperty('--my', (e.clientY - r.top) + 'px');
    });
  });
})();`;

  return { fonts: [c.googleFont ? null : "Space+Grotesk:wght@500;600;700"].filter(Boolean),
           css, body, js, themeColor: "#0A0714" };
};


// ---------------------------------------------------------------------------
// 12. NEBULA — a real starfield on canvas. Stars carry a depth value, so they
//     parallax against scroll and pointer, and the near ones join up into
//     constellations when the cursor passes.
// ---------------------------------------------------------------------------
PF_RENDERERS.nebula = (c) => {
  const d = c.d;
  const nav = c.navItems.map(n => `<a href="#${n.id}">${pfEsc(n.label)}</a>`).join("");
  const a2 = pfHueShift(c.accent, 55);

  const css = `
:root{
  --acc:${c.accent}; --acc2:${a2}; --ink:#E8EEFF; --muted:#93A0C0; --faint:#5D6788;
  --bg:#05070F; --panel:rgba(16,22,44,.66); --line:rgba(120,150,220,.18);
  --font:${c.fontStack || `'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif`};
}
body{background:var(--bg);color:var(--ink);font-family:var(--font);font-size:16px;line-height:1.7;overflow-x:hidden}
.pf-skip{background:var(--acc);color:${c.accentInk}}
.pf-shell{width:min(1100px,92vw);margin:0 auto}
#pf-sky{position:fixed;inset:0;z-index:0;pointer-events:none}
.pf-glowtop{position:fixed;top:0;left:0;right:0;height:70vh;z-index:1;pointer-events:none;
  background:radial-gradient(70% 60% at 50% -10%,${pfRgba(c.accent, .18)},transparent 66%),
             radial-gradient(50% 40% at 80% 10%,${pfRgba(a2, .12)},transparent 72%)}
main{position:relative;z-index:3}
.pf-nav{position:sticky;top:0;z-index:20;backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);
  border-bottom:1px solid transparent;transition:.3s}
.pf-nav.pf-stuck{background:rgba(5,7,15,.95);border-bottom-color:var(--line)}
.pf-nav-in{display:flex;align-items:center;gap:1.4rem;padding:.9rem 0}
.pf-brand{font-weight:700;letter-spacing:-.02em;display:flex;align-items:center;gap:.6rem;text-decoration:none}
.pf-brand i{width:28px;height:28px;border-radius:50%;display:grid;place-items:center;font-size:.68rem;font-weight:800;
  background:radial-gradient(circle at 30% 30%,#fff,var(--acc) 60%,${pfShade(c.accent, -0.40)});color:#04121f;font-style:normal;
  box-shadow:0 0 18px ${pfRgba(c.accent, .6)}}
.pf-nav-links{display:flex;gap:.25rem;margin-left:auto}
.pf-nav-links a{padding:.4rem .8rem;border-radius:999px;font-size:.86rem;color:var(--muted);text-decoration:none;transition:.2s}
.pf-nav-links a:hover,.pf-nav-links a.pf-active{color:#fff;background:rgba(255,255,255,.07)}

.pf-hero{padding:clamp(4rem,11vw,7rem) 0 clamp(2rem,5vw,3rem);text-align:center;position:relative}
.pf-badge{display:inline-flex;align-items:center;gap:.5rem;padding:.38rem 1rem;border-radius:999px;
  border:1px solid var(--line);background:rgba(255,255,255,.04);font-size:.79rem;font-weight:600;color:var(--muted);margin-bottom:1.5rem}
.pf-badge i{width:6px;height:6px;border-radius:50%;background:var(--acc);box-shadow:0 0 10px var(--acc)}
.pf-hero h1{font-size:clamp(2.6rem,8vw,5.4rem);font-weight:800;letter-spacing:-.045em;line-height:1.02;
  background:linear-gradient(180deg,#fff 30%,${pfRgba(a2, .8)});-webkit-background-clip:text;background-clip:text;color:transparent;
  text-shadow:0 0 60px ${pfRgba(c.accent, .35)}}
.pf-hero h2{font-size:clamp(.95rem,2.2vw,1.25rem);font-weight:600;color:var(--acc);margin:.9rem 0 .8rem;
  letter-spacing:.14em;text-transform:uppercase}
.pf-hero p{color:var(--muted);max-width:56ch;margin:0 auto}
.pf-actions{display:flex;flex-wrap:wrap;gap:.7rem;justify-content:center;align-items:center;margin-top:1.9rem}
.pf-btn{display:inline-flex;align-items:center;gap:.5rem;padding:.78rem 1.5rem;border-radius:999px;font-weight:600;
  font-size:.92rem;text-decoration:none;border:1px solid var(--line);transition:.25s}
.pf-btn svg{width:16px;height:16px}
.pf-btn-primary{border-color:transparent;background:var(--acc);
  color:${c.accentInk};font-weight:700;box-shadow:0 12px 34px ${pfRgba(c.accent, .38)}}
.pf-btn-primary:hover{transform:translateY(-3px);box-shadow:0 0 0 1px ${pfRgba(c.accent, .8)},0 18px 44px ${pfRgba(c.accent, .5)}}
.pf-btn-ghost{background:rgba(255,255,255,.04);color:var(--ink)}
.pf-btn-ghost:hover{border-color:var(--acc);transform:translateY(-3px)}
.pf-socials{display:flex;gap:.5rem}
.pf-socials a{display:grid;place-items:center;width:40px;height:40px;border-radius:50%;
  background:rgba(255,255,255,.04);border:1px solid var(--line);color:var(--muted);transition:.25s}
.pf-socials a svg{width:16px;height:16px}
.pf-socials a:hover{color:#fff;border-color:var(--acc);box-shadow:0 0 20px ${pfRgba(c.accent, .4)}}

.pf-sec{padding:clamp(2.4rem,6vw,4rem) 0}
.pf-eyebrow{font-size:.71rem;font-weight:800;letter-spacing:.22em;text-transform:uppercase;color:var(--acc);margin-bottom:.55rem}
.pf-h2{font-size:clamp(1.5rem,3.6vw,2.2rem);font-weight:800;letter-spacing:-.032em;margin-bottom:1.8rem}
.pf-card{position:relative;background:var(--panel);border:1px solid var(--line);border-radius:18px;
  backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);transition:.3s}
.pf-card:hover{border-color:${pfRgba(c.accent, .55)};transform:translateY(-4px);
  box-shadow:0 18px 50px rgba(0,0,0,.5),0 0 40px ${pfRgba(c.accent, .12)}}
.pf-about{padding:1.9rem;white-space:pre-line;color:var(--muted)}
.pf-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(155px,1fr));gap:1rem}
.pf-stat{padding:1.5rem 1rem;text-align:center}
.pf-stat b{display:block;font-size:2.3rem;font-weight:800;letter-spacing:-.04em;color:var(--acc);
  text-shadow:0 0 26px ${pfRgba(c.accent, .55)}}
.pf-stat span{font-size:.75rem;color:var(--faint);font-weight:700;letter-spacing:.09em;text-transform:uppercase}
.pf-pills{display:flex;flex-wrap:wrap;gap:.5rem}
.pf-pill{padding:.46rem 1.05rem;border-radius:999px;font-size:.88rem;color:var(--muted);
  border:1px solid var(--line);background:rgba(255,255,255,.03);transition:.25s;cursor:default}
.pf-pill:hover{color:#fff;border-color:var(--acc);box-shadow:0 0 20px ${pfRgba(c.accent, .3)};transform:translateY(-2px)}
.pf-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(290px,1fr));gap:1rem}
.pf-proj{padding:1.6rem}
.pf-proj h3{font-size:1.15rem;font-weight:700;letter-spacing:-.02em;margin-bottom:.15rem}
.pf-proj .pf-role{font-size:.79rem;color:var(--acc);font-weight:600;margin-bottom:.65rem}
.pf-proj p,.pf-row p{color:var(--muted);font-size:.93rem}
.pf-proj ul,.pf-row ul{margin-top:.6rem}
.pf-proj li,.pf-row li{color:var(--muted);font-size:.89rem;padding-left:1.1rem;position:relative;margin-bottom:.26rem}
.pf-proj li::before,.pf-row li::before{content:"";position:absolute;left:0;top:.6em;width:5px;height:5px;border-radius:50%;
  background:var(--acc);box-shadow:0 0 8px var(--acc)}
.pf-tags{display:flex;flex-wrap:wrap;gap:.32rem;margin-top:.85rem}
.pf-tag{font-size:.7rem;font-weight:600;padding:.18rem .55rem;border-radius:5px;color:var(--muted);
  background:rgba(255,255,255,.05);border:1px solid var(--line)}
.pf-links{display:flex;gap:1rem;margin-top:.85rem;font-size:.83rem;font-weight:600}
.pf-links a{color:var(--acc);text-decoration:none;display:inline-flex;align-items:center;gap:.32rem}
.pf-links a svg{width:14px;height:14px}
.pf-links a:hover{color:#fff}
.pf-rows{display:grid;gap:.85rem}
.pf-row{padding:1.45rem 1.6rem}
.pf-row-top{display:flex;flex-wrap:wrap;gap:.3rem 1rem;align-items:baseline}
.pf-row h3{font-size:1.06rem;font-weight:700}
.pf-row .pf-org{color:var(--acc);font-size:.9rem;font-weight:600}
.pf-row .pf-when{margin-left:auto;color:var(--faint);font-size:.81rem;white-space:nowrap;font-variant-numeric:tabular-nums}
.pf-contact{padding:clamp(2.2rem,5vw,3.4rem);text-align:center}
.pf-contact h2{font-size:clamp(1.7rem,4.5vw,2.7rem);font-weight:800;letter-spacing:-.04em;margin-bottom:.7rem}
.pf-contact p{color:var(--muted);max-width:46ch;margin:0 auto 1.6rem}
.pf-clist{display:flex;flex-wrap:wrap;gap:.7rem 1.7rem;justify-content:center;margin-top:1.6rem;font-size:.89rem}
.pf-clist a,.pf-clist span{color:var(--muted);text-decoration:none;display:inline-flex;align-items:center;gap:.42rem}
.pf-clist svg{width:16px;height:16px;color:var(--acc)}
.pf-clist a:hover{color:#fff}
footer{padding:2.8rem 0;text-align:center;color:var(--faint);font-size:.83rem}
@media (max-width:760px){.pf-nav-links{display:none}.pf-row .pf-when{margin-left:0;width:100%}}`;

  const body = `
<canvas id="pf-sky" aria-hidden="true"></canvas>
<div class="pf-glowtop" aria-hidden="true"></div>
<nav class="pf-nav pf-noprint"><div class="pf-shell pf-nav-in">
  <a class="pf-brand" href="#top"><i>${pfEsc(c.initials)}</i>${pfEsc(c.name)}</a>
  ${nav ? `<div class="pf-nav-links">${nav}</div>` : ""}
</div></nav>

<main id="main"><div class="pf-shell">
  <section class="pf-hero" id="top">
    ${d.available ? `<div class="pf-badge"><i></i>${pfEsc(d.available)}</div>` : ""}
    <h1>${pfEsc(c.name)}</h1>
    ${c.title ? `<h2>${pfEsc(c.title)}</h2>` : ""}
    ${c.tagline ? `<p>${pfEsc(c.tagline)}</p>` : ""}
    <div class="pf-actions">
      ${d.email ? `<a class="pf-btn pf-btn-primary" href="mailto:${pfEsc(d.email)}">${PF_ICONS.mail}${pfEsc(d.cta_text || "Get in touch")}</a>` : ""}
      ${c.hasResume ? `<a class="pf-btn pf-btn-ghost" ${pfResumeAttrs(c)}>${PF_ICONS.download}${pfEsc(c.resumeLabel)}</a>` : ""}
      ${pfSocialRow(c)}
    </div>
  </section>

  ${c.has("stats") ? `<section class="pf-sec"><div class="pf-stats">
    ${d.stats.map((x, i) => `<div class="pf-card pf-stat" data-reveal data-reveal-delay="${i * 70}">
      <b>${pfEsc(x.value)}</b><span>${pfEsc(x.label)}</span></div>`).join("")}</div></section>` : ""}

  ${c.has("about") ? `<section class="pf-sec" id="about">
    <div class="pf-eyebrow">About</div><h2 class="pf-h2">The short version</h2>
    <div class="pf-card pf-about" data-reveal>${pfEsc(d.about)}</div></section>` : ""}

  ${c.has("skills") ? `<section class="pf-sec" id="skills">
    <div class="pf-eyebrow">Toolkit</div><h2 class="pf-h2">What I work with</h2>
    <div class="pf-pills" data-reveal>${d.skills.map(x => `<span class="pf-pill">${pfEsc(x)}</span>`).join("")}</div></section>` : ""}

  ${c.has("projects") ? `<section class="pf-sec" id="projects">
    <div class="pf-eyebrow">Work</div><h2 class="pf-h2">Selected projects</h2>
    <div class="pf-grid">${d.projects.map((x, i) => `
      <article class="pf-card pf-proj" data-reveal data-reveal-delay="${Math.min(i, 5) * 80}">
        <h3>${pfEsc(x.name || "")}</h3>
        ${pfJoin([x.role, x.period]) ? `<div class="pf-role">${pfJoin([x.role, x.period])}</div>` : ""}
        ${x.description ? `<p>${pfEsc(x.description)}</p>` : ""}
        ${(x.bullets || []).length ? `<ul>${x.bullets.map(b => `<li>${pfEsc(b)}</li>`).join("")}</ul>` : ""}
        ${(x.tags || []).length ? `<div class="pf-tags">${x.tags.map(t => `<span class="pf-tag">${pfEsc(t)}</span>`).join("")}</div>` : ""}
        ${pfProjectLinks(x) ? `<div class="pf-links">${pfProjectLinks(x)}</div>` : ""}
      </article>`).join("")}</div></section>` : ""}

  ${c.has("experience") ? `<section class="pf-sec" id="experience">
    <div class="pf-eyebrow">Experience</div><h2 class="pf-h2">Where I have worked</h2>
    <div class="pf-rows">${d.experience.map((x, i) => `
      <article class="pf-card pf-row" data-reveal data-reveal-delay="${Math.min(i, 5) * 70}">
        <div class="pf-row-top"><h3>${pfEsc(x.role || "")}</h3>
          ${x.org ? `<span class="pf-org">${pfEsc(x.org)}</span>` : ""}
          ${x.period ? `<span class="pf-when">${pfEsc(x.period)}</span>` : ""}</div>
        ${x.summary ? `<p>${pfEsc(x.summary)}</p>` : ""}
        ${(x.bullets || []).length ? `<ul>${x.bullets.map(b => `<li>${pfEsc(b)}</li>`).join("")}</ul>` : ""}
      </article>`).join("")}</div></section>` : ""}

  ${c.has("education") ? `<section class="pf-sec" id="education">
    <div class="pf-eyebrow">Education</div><h2 class="pf-h2">Where I studied</h2>
    <div class="pf-rows">${d.education.map(x => `
      <article class="pf-card pf-row" data-reveal>
        <div class="pf-row-top"><h3>${pfEsc(x.degree || "")}</h3>
          ${x.school ? `<span class="pf-org">${pfEsc(x.school)}</span>` : ""}
          ${x.period ? `<span class="pf-when">${pfEsc(x.period)}</span>` : ""}</div>
        ${x.detail ? `<p>${pfEsc(x.detail)}</p>` : ""}
      </article>`).join("")}</div></section>` : ""}

  ${c.has("certifications") ? `<section class="pf-sec" id="certifications">
    <div class="pf-eyebrow">Credentials</div><h2 class="pf-h2">Certifications</h2>
    <div class="pf-pills" data-reveal>${d.certifications.map(x => `<span class="pf-pill">${pfEsc(x)}</span>`).join("")}</div></section>` : ""}

  ${c.has("contact") ? `<section class="pf-sec" id="contact"><div class="pf-card pf-contact" data-reveal>
    <h2>Say hello</h2>
    <p>${pfEsc(d.cta_text || "I read everything that isn't a recruiter template.")}</p>
    <div class="pf-actions" style="margin-top:0">
      ${d.email ? `<a class="pf-btn pf-btn-primary" href="mailto:${pfEsc(d.email)}">${PF_ICONS.mail}${pfEsc(d.email)}</a>` : ""}
      ${c.hasResume ? `<a class="pf-btn pf-btn-ghost" ${pfResumeAttrs(c)}>${PF_ICONS.download}Résumé</a>` : ""}
    </div>
    <div class="pf-clist">${c.links.map(x => x.url
      ? `<a href="${pfEsc(x.url)}"${/^https?:/i.test(x.url) ? ` target="_blank" rel="noopener"` : ""}>${x.icon}${pfEsc(x.handle)}</a>`
      : `<span>${x.icon}${pfEsc(x.handle)}</span>`).join("")}</div>
  </div></section>` : ""}

  <footer>© <span data-year>${c.year}</span> ${pfEsc(c.name)}${d.footer_note ? " · " + pfEsc(d.footer_note) : ""}</footer>
</div></main>`;

  const js = `
(function(){
  var nav = document.querySelector('.pf-nav');
  var onScroll = function(){ nav.classList.toggle('pf-stuck', window.scrollY > 12); };
  onScroll(); addEventListener('scroll', onScroll, { passive:true });

  var links = [].slice.call(document.querySelectorAll('.pf-nav-links a'));
  var secs = links.map(function(a){ return document.querySelector(a.getAttribute('href')); }).filter(Boolean);
  if ('IntersectionObserver' in window && secs.length) {
    var spy = new IntersectionObserver(function(es){
      es.forEach(function(e){ if(!e.isIntersecting) return;
        links.forEach(function(a){ a.classList.toggle('pf-active', a.getAttribute('href') === '#' + e.target.id); }); });
    }, { rootMargin:'-45% 0px -50% 0px' });
    secs.forEach(function(s){ spy.observe(s); });
  }

  /* The sky.
     Every star carries a depth z in (0,1]. Everything else follows from it:
     radius, brightness, and how far it shifts against scroll and pointer. That
     one value is what turns a field of dots into something with distance in it.
     Reduced motion gets a still sky rather than no sky — the picture is part of
     the design, the movement is not. */
  var cv = document.getElementById('pf-sky');
  if (!cv || !cv.getContext) return;
  var ctx = cv.getContext('2d'), stars = [], w = 0, h = 0, dpr = 1;
  var reduce = matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var px = 0, py = 0, tx = 0, ty = 0, sy = 0;
  var ACC = ${JSON.stringify(c.accent)}, ACC2 = ${JSON.stringify(a2)};

  function build(){
    dpr = Math.min(devicePixelRatio || 1, 2);
    w = cv.clientWidth; h = cv.clientHeight;
    cv.width = w * dpr; cv.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var n = Math.round(Math.min(420, (w * h) / 4200));
    stars = [];
    for (var i = 0; i < n; i++) {
      var z = Math.random() * 0.9 + 0.1;
      stars.push({ x: Math.random() * w, y: Math.random() * h * 1.6, z: z,
                   r: z * 1.7 + 0.25, tw: Math.random() * 6.28,
                   c: Math.random() < 0.14 ? ACC : (Math.random() < 0.1 ? ACC2 : '#ffffff') });
    }
  }

  function draw(t){
    ctx.clearRect(0, 0, w, h);
    px += (tx - px) * 0.06; py += (ty - py) * 0.06;
    var near = [];
    for (var i = 0; i < stars.length; i++) {
      var s = stars[i];
      var x = s.x + px * s.z * 26;
      var y = s.y + py * s.z * 26 - (sy * s.z * 0.35);
      y = ((y % (h * 1.6)) + h * 1.6) % (h * 1.6);
      if (y > h + 4) continue;
      var a = reduce ? 0.7 : (0.42 + 0.5 * (0.5 + 0.5 * Math.sin(t / 900 + s.tw))) * (0.45 + s.z * 0.55);
      ctx.globalAlpha = a;
      ctx.fillStyle = s.c;
      ctx.beginPath(); ctx.arc(x, y, s.r, 0, 6.2832); ctx.fill();
      if (s.z > 0.72) near.push([x, y]);
    }
    /* Constellations: only the nearest stars, only near the pointer, and only
       the short links. Drawing every pair turns the sky into a cobweb. */
    if (!reduce && tx !== 0) {
      var mx = (tx + 1) / 2 * w, my = (ty + 1) / 2 * h;
      ctx.lineWidth = 1;
      for (var j = 0; j < near.length; j++) {
        var A = near[j];
        if (Math.abs(A[0] - mx) > 190 || Math.abs(A[1] - my) > 190) continue;
        for (var k = j + 1; k < near.length; k++) {
          var B = near[k], dx = A[0] - B[0], dy = A[1] - B[1], dd = dx * dx + dy * dy;
          if (dd > 15000) continue;
          ctx.globalAlpha = (1 - dd / 15000) * 0.28;
          ctx.strokeStyle = ACC;
          ctx.beginPath(); ctx.moveTo(A[0], A[1]); ctx.lineTo(B[0], B[1]); ctx.stroke();
        }
      }
    }
    ctx.globalAlpha = 1;
    requestAnimationFrame(draw);
  }

  build();
  addEventListener('resize', build);
  addEventListener('scroll', function(){ sy = window.scrollY; }, { passive:true });
  if (!reduce) addEventListener('pointermove', function(e){
    tx = (e.clientX / innerWidth) * 2 - 1; ty = (e.clientY / innerHeight) * 2 - 1;
  }, { passive:true });
  requestAnimationFrame(draw);
})();`;

  return { fonts: [c.googleFont ? null : "Inter:wght@400;500;600;700;800"].filter(Boolean),
           css, body, js, themeColor: "#05070F" };
};


// ---------------------------------------------------------------------------
// 13. KINETIC — type as the whole design. Letters spring in one at a time, the
//     skills run past on an infinite track, and the headline shears with the
//     scroll velocity.
// ---------------------------------------------------------------------------
PF_RENDERERS.kinetic = (c) => {
  const d = c.d;
  // Split for the stagger. Spaces have to stay real spaces or the name loses
  // its word breaks; every other character gets its own animated span.
  const letters = (str) => str.split("").map((ch, i) =>
    ch === " " ? " " : `<span class="pf-l" style="--i:${i}">${pfEsc(ch)}</span>`).join("");
  const marquee = d.skills.length
    ? d.skills.concat(d.skills).map(x => `<span>${pfEsc(x)}</span>`).join(`<i aria-hidden="true">✳</i>`) : "";

  const css = `
:root{
  --acc:${c.accent}; --ink:#111111; --muted:#5A5A5A; --faint:#9A9A9A;
  --bg:#FAF9F7; --line:#E3E0DA; --card:#FFFFFF;
  --font:${c.fontStack || `'Space Grotesk','Inter',-apple-system,'Segoe UI',Roboto,sans-serif`};
}
body{background:var(--bg);color:var(--ink);font-family:var(--font);font-size:16px;line-height:1.6;overflow-x:hidden}
.pf-skip{background:var(--acc);color:${c.accentInk}}
.pf-shell{width:min(1240px,92vw);margin:0 auto}

.pf-nav{position:sticky;top:0;z-index:20;background:${pfRgba("#FAF9F7", .96)};
  backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);border-bottom:1px solid transparent;transition:.25s}
.pf-nav.pf-stuck{border-bottom-color:var(--line)}
.pf-nav-in{display:flex;align-items:center;gap:1.2rem;padding:.85rem 0}
.pf-brand{font-weight:800;letter-spacing:-.03em;text-decoration:none;font-size:1.02rem}
.pf-brand em{color:var(--acc);font-style:normal}
.pf-nav-links{display:flex;gap:1.3rem;margin-left:auto}
.pf-nav-links a{font-size:.82rem;font-weight:700;letter-spacing:.04em;text-transform:uppercase;
  color:var(--muted);text-decoration:none;position:relative;padding:.2rem 0}
.pf-nav-links a::after{content:"";position:absolute;left:0;right:100%;bottom:0;height:2px;background:var(--acc);transition:right .3s}
.pf-nav-links a:hover::after,.pf-nav-links a.pf-active::after{right:0}

/* The headline. --shear is written by the scroll handler; at rest it is 0 and
   the type is upright, so nothing depends on JS having run. */
.pf-hero{padding:clamp(3rem,9vw,6rem) 0 clamp(2rem,5vw,3rem)}
.pf-kicker{display:flex;align-items:center;gap:.8rem;font-size:.78rem;font-weight:800;letter-spacing:.2em;
  text-transform:uppercase;color:var(--acc);margin-bottom:1.2rem}
.pf-kicker::after{content:"";flex:1;height:1px;background:var(--line)}
.pf-big{font-size:clamp(3rem,13vw,10rem);font-weight:800;letter-spacing:-.055em;line-height:.88;
  text-transform:uppercase;transform:skewY(calc(var(--shear,0) * -1deg));transition:transform .25s ease-out}
.pf-l{display:inline-block;opacity:0;transform:translateY(.5em) rotate(6deg);
  animation:pf-drop .8s cubic-bezier(.2,1.5,.35,1) forwards;animation-delay:calc(var(--i) * 42ms)}
@keyframes pf-drop{to{opacity:1;transform:none}}
.pf-big .pf-l:nth-child(even){color:var(--acc)}
.pf-hero-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,.85fr);gap:2rem 3rem;
  align-items:end;margin-top:2rem;padding-top:1.6rem;border-top:3px solid var(--ink)}
.pf-role{font-size:clamp(1.1rem,2.6vw,1.6rem);font-weight:700;letter-spacing:-.02em}
.pf-hero p{color:var(--muted);font-size:1.02rem;max-width:46ch}
.pf-meta{display:flex;flex-wrap:wrap;gap:.4rem 1.2rem;margin-top:1rem;font-size:.83rem;font-weight:700;
  letter-spacing:.06em;text-transform:uppercase;color:var(--faint)}
.pf-avail{color:var(--acc)}
.pf-actions{display:flex;flex-wrap:wrap;gap:.6rem;align-items:center;margin-top:1.4rem}
.pf-btn{display:inline-flex;align-items:center;gap:.5rem;padding:.8rem 1.5rem;border-radius:0;font-weight:800;
  font-size:.83rem;letter-spacing:.08em;text-transform:uppercase;text-decoration:none;
  border:2px solid var(--ink);transition:.2s}
.pf-btn svg{width:15px;height:15px}
.pf-btn-primary{background:var(--ink);color:var(--bg)}
.pf-btn-primary:hover{background:var(--acc);border-color:var(--acc);color:#fff;transform:translate(-3px,-3px);
  box-shadow:5px 5px 0 var(--ink)}
.pf-btn-ghost{background:transparent;color:var(--ink)}
.pf-btn-ghost:hover{transform:translate(-3px,-3px);box-shadow:5px 5px 0 var(--acc)}
.pf-socials{display:flex;gap:.4rem}
.pf-socials a{display:grid;place-items:center;width:40px;height:40px;border:2px solid var(--ink);
  color:var(--ink);transition:.2s}
.pf-socials a svg{width:16px;height:16px}
.pf-socials a:hover{background:var(--acc);border-color:var(--acc);color:#fff;transform:translate(-3px,-3px);box-shadow:5px 5px 0 var(--ink)}

/* The track. Two identical halves translating -50% is the only way to loop a
   marquee without a seam or a resize listener. */
.pf-track{border-top:3px solid var(--ink);border-bottom:3px solid var(--ink);padding:.9rem 0;
  margin:clamp(1.5rem,4vw,2.5rem) 0;overflow:hidden;background:var(--acc);color:${c.accentInk}}
.pf-track-in{display:flex;gap:1.6rem;align-items:center;width:max-content;animation:pf-run 34s linear infinite;
  font-size:clamp(1rem,2.4vw,1.5rem);font-weight:800;letter-spacing:-.02em;text-transform:uppercase;white-space:nowrap}
.pf-track-in i{opacity:.65;font-style:normal}
.pf-track:hover .pf-track-in{animation-play-state:paused}
@keyframes pf-run{to{transform:translateX(-50%)}}

.pf-sec{padding:clamp(2.4rem,6vw,4rem) 0}
.pf-h2{font-size:clamp(1.8rem,5vw,3.2rem);font-weight:800;letter-spacing:-.045em;text-transform:uppercase;
  margin-bottom:.3rem;line-height:.95}
.pf-sub{color:var(--faint);font-size:.82rem;font-weight:700;letter-spacing:.16em;text-transform:uppercase;margin-bottom:2rem}
.pf-about{font-size:clamp(1.05rem,2.2vw,1.35rem);line-height:1.55;white-space:pre-line;max-width:62ch;color:var(--ink)}

/* Numbered rows. The whole row is the hover target and the fill wipes in from
   the left, so the eye follows the direction of reading. */
.pf-list{border-top:2px solid var(--ink)}
.pf-item{position:relative;display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:.6rem 1.6rem;
  align-items:baseline;padding:1.5rem 1.2rem;border-bottom:2px solid var(--ink);transition:.3s;overflow:hidden}
.pf-item::before{content:"";position:absolute;inset:0;background:var(--ink);transform:scaleX(0);transform-origin:left;
  transition:transform .4s cubic-bezier(.2,.8,.2,1);z-index:0}
.pf-item>*{position:relative;z-index:1;transition:color .3s}
.pf-item:hover::before{transform:scaleX(1)}
.pf-item:hover,.pf-item:hover .pf-num,.pf-item:hover .pf-when,.pf-item:hover p,.pf-item:hover li{color:var(--bg)}
.pf-item:hover .pf-org{color:var(--acc)}
.pf-num{font-size:.82rem;font-weight:800;color:var(--faint);font-variant-numeric:tabular-nums;letter-spacing:.06em}
.pf-item h3{font-size:clamp(1.15rem,2.6vw,1.6rem);font-weight:800;letter-spacing:-.03em}
.pf-org{color:var(--acc);font-weight:700;font-size:.92rem;margin-top:.1rem}
.pf-when{font-size:.8rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--faint);white-space:nowrap}
.pf-item p{color:var(--muted);font-size:.95rem;margin-top:.5rem;grid-column:2}
.pf-item ul{grid-column:2;margin-top:.4rem}
.pf-item li{color:var(--muted);font-size:.92rem;padding-left:1.1rem;position:relative;margin-bottom:.22rem}
.pf-item li::before{content:"→";position:absolute;left:0;color:var(--acc)}
.pf-tags{grid-column:2;display:flex;flex-wrap:wrap;gap:.35rem;margin-top:.7rem}
.pf-tag{font-size:.7rem;font-weight:800;letter-spacing:.06em;text-transform:uppercase;padding:.2rem .55rem;
  border:1.5px solid currentColor;color:var(--faint)}
.pf-links{grid-column:2;display:flex;gap:1.1rem;margin-top:.7rem;font-size:.78rem;font-weight:800;
  letter-spacing:.07em;text-transform:uppercase}
.pf-links a{color:var(--acc);text-decoration:none;display:inline-flex;align-items:center;gap:.3rem}
.pf-links a svg{width:13px;height:13px}

.pf-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:0;border:2px solid var(--ink)}
.pf-stat{padding:1.6rem 1.2rem;border-right:2px solid var(--ink);transition:.25s}
.pf-stat:last-child{border-right:0}
.pf-stat:hover{background:var(--acc);color:#fff}
.pf-stat b{display:block;font-size:clamp(2rem,4.5vw,3rem);font-weight:800;letter-spacing:-.05em;line-height:1}
.pf-stat span{font-size:.72rem;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:var(--faint)}
.pf-stat:hover span{color:${pfRgba("#ffffff", .8)}}
.pf-certs{display:grid;gap:0;border-top:2px solid var(--ink)}
.pf-cert{padding:1rem 1.2rem;border-bottom:2px solid var(--ink);font-weight:600;color:var(--muted);transition:.25s}
.pf-cert:hover{background:var(--ink);color:var(--bg);padding-left:2rem}

.pf-contact{border:3px solid var(--ink);padding:clamp(2rem,5vw,3.4rem);text-align:center;background:var(--card)}
.pf-contact h2{font-size:clamp(2rem,7vw,4.5rem);font-weight:800;letter-spacing:-.05em;text-transform:uppercase;
  line-height:.92;margin-bottom:.8rem}
.pf-contact p{color:var(--muted);max-width:46ch;margin:0 auto 1.6rem}
.pf-clist{display:flex;flex-wrap:wrap;gap:.6rem 1.6rem;justify-content:center;margin-top:1.6rem;font-size:.82rem;
  font-weight:700;letter-spacing:.05em}
.pf-clist a,.pf-clist span{color:var(--muted);text-decoration:none;display:inline-flex;align-items:center;gap:.4rem}
.pf-clist svg{width:15px;height:15px;color:var(--acc)}
.pf-clist a:hover{color:var(--acc)}
footer{padding:2.5rem 0;text-align:center;color:var(--faint);font-size:.78rem;font-weight:700;
  letter-spacing:.12em;text-transform:uppercase}
@media (max-width:820px){
  .pf-nav-links{display:none}
  .pf-hero-grid{grid-template-columns:1fr}
  .pf-item{grid-template-columns:auto minmax(0,1fr)}
  .pf-when{grid-column:2}
  .pf-item p,.pf-item ul,.pf-tags,.pf-links{grid-column:2}
}
@media (prefers-reduced-motion:reduce){
  .pf-l{animation:none;opacity:1;transform:none}
  .pf-track-in{animation:none}
  .pf-big{transform:none}
}`;

  const rows = (arr, mapper) => arr.map((x, i) => {
    const r = mapper(x);
    return `<article class="pf-item" data-reveal data-reveal-delay="${Math.min(i, 6) * 55}">
      <span class="pf-num">${String(i + 1).padStart(2, "0")}</span>
      <div><h3>${pfEsc(r.title || "")}</h3>${r.org ? `<div class="pf-org">${pfEsc(r.org)}</div>` : ""}</div>
      <span class="pf-when">${pfEsc(r.when || "")}</span>
      ${r.text ? `<p>${pfEsc(r.text)}</p>` : ""}
      ${(r.bullets || []).length ? `<ul>${r.bullets.map(b => `<li>${pfEsc(b)}</li>`).join("")}</ul>` : ""}
      ${(r.tags || []).length ? `<div class="pf-tags">${r.tags.map(t => `<span class="pf-tag">${pfEsc(t)}</span>`).join("")}</div>` : ""}
      ${r.links ? `<div class="pf-links">${r.links}</div>` : ""}
    </article>`;
  }).join("");

  const body = `
<nav class="pf-nav pf-noprint"><div class="pf-shell pf-nav-in">
  <a class="pf-brand" href="#top">${pfEsc(c.name)}<em>.</em></a>
  ${c.navItems.length ? `<div class="pf-nav-links">${c.navItems.map(n => `<a href="#${n.id}">${pfEsc(n.label)}</a>`).join("")}</div>` : ""}
</div></nav>

<main id="main"><div class="pf-shell">
  <section class="pf-hero" id="top">
    <div class="pf-kicker">Portfolio ${c.year}</div>
    <h1 class="pf-big" id="pf-big">${letters(c.name)}</h1>
    <div class="pf-hero-grid">
      <div>
        ${c.title ? `<div class="pf-role">${pfEsc(c.title)}</div>` : ""}
        <div class="pf-meta">
          ${d.location ? `<span>${pfEsc(d.location)}</span>` : ""}
          ${d.available ? `<span class="pf-avail">${pfEsc(d.available)}</span>` : ""}
        </div>
        <div class="pf-actions">
          ${d.email ? `<a class="pf-btn pf-btn-primary" href="mailto:${pfEsc(d.email)}">${PF_ICONS.mail}${pfEsc(d.cta_text || "Get in touch")}</a>` : ""}
          ${c.hasResume ? `<a class="pf-btn pf-btn-ghost" ${pfResumeAttrs(c)}>${PF_ICONS.download}${pfEsc(c.resumeLabel)}</a>` : ""}
          ${pfSocialRow(c)}
        </div>
      </div>
      ${c.tagline ? `<p>${pfEsc(c.tagline)}</p>` : "<div></div>"}
    </div>
  </section>
</div>

${marquee ? `<div class="pf-track" id="skills"><div class="pf-track-in">${marquee}</div></div>` : ""}

<div class="pf-shell">
  ${c.has("stats") ? `<section class="pf-sec"><div class="pf-stats" data-reveal>
    ${d.stats.map(x => `<div class="pf-stat"><b>${pfEsc(x.value)}</b><span>${pfEsc(x.label)}</span></div>`).join("")}
  </div></section>` : ""}

  ${c.has("about") ? `<section class="pf-sec" id="about">
    <h2 class="pf-h2">About</h2><p class="pf-sub">Who is typing</p>
    <div class="pf-about" data-reveal>${pfEsc(d.about)}</div></section>` : ""}

  ${c.has("projects") ? `<section class="pf-sec" id="projects">
    <h2 class="pf-h2">Selected work</h2><p class="pf-sub">${d.projects.length} project${d.projects.length === 1 ? "" : "s"}</p>
    <div class="pf-list">${rows(d.projects, x => ({ title: x.name, org: x.role, when: x.period,
      text: x.description, bullets: x.bullets, tags: x.tags, links: pfProjectLinks(x) }))}</div></section>` : ""}

  ${c.has("experience") ? `<section class="pf-sec" id="experience">
    <h2 class="pf-h2">Experience</h2><p class="pf-sub">Where the hours went</p>
    <div class="pf-list">${rows(d.experience, x => ({ title: x.role, org: x.org, when: x.period,
      text: x.summary, bullets: x.bullets }))}</div></section>` : ""}

  ${c.has("education") ? `<section class="pf-sec" id="education">
    <h2 class="pf-h2">Education</h2><p class="pf-sub">Formally speaking</p>
    <div class="pf-list">${rows(d.education, x => ({ title: x.degree, org: x.school, when: x.period, text: x.detail }))}</div></section>` : ""}

  ${c.has("certifications") ? `<section class="pf-sec" id="certifications">
    <h2 class="pf-h2">Certified</h2><p class="pf-sub">Paperwork</p>
    <div class="pf-certs" data-reveal>${d.certifications.map(x => `<div class="pf-cert">${pfEsc(x)}</div>`).join("")}</div></section>` : ""}

  ${c.has("contact") ? `<section class="pf-sec" id="contact"><div class="pf-contact" data-reveal>
    <h2>Let's talk</h2>
    <p>${pfEsc(d.cta_text || "Briefs, questions and long shots all welcome.")}</p>
    <div class="pf-actions" style="justify-content:center;margin-top:0">
      ${d.email ? `<a class="pf-btn pf-btn-primary" href="mailto:${pfEsc(d.email)}">${PF_ICONS.mail}${pfEsc(d.email)}</a>` : ""}
      ${c.hasResume ? `<a class="pf-btn pf-btn-ghost" ${pfResumeAttrs(c)}>${PF_ICONS.download}Résumé</a>` : ""}
    </div>
    <div class="pf-clist">${c.links.map(x => x.url
      ? `<a href="${pfEsc(x.url)}"${/^https?:/i.test(x.url) ? ` target="_blank" rel="noopener"` : ""}>${x.icon}${pfEsc(x.handle)}</a>`
      : `<span>${x.icon}${pfEsc(x.handle)}</span>`).join("")}</div>
  </div></section>` : ""}

  <footer>© <span data-year>${c.year}</span> ${pfEsc(c.name)}${d.footer_note ? " · " + pfEsc(d.footer_note) : ""}</footer>
</div></main>`;

  const js = `
(function(){
  var nav = document.querySelector('.pf-nav');
  var onScroll = function(){ nav.classList.toggle('pf-stuck', window.scrollY > 8); };
  onScroll(); addEventListener('scroll', onScroll, { passive:true });

  var links = [].slice.call(document.querySelectorAll('.pf-nav-links a'));
  var secs = links.map(function(a){ return document.querySelector(a.getAttribute('href')); }).filter(Boolean);
  if ('IntersectionObserver' in window && secs.length) {
    var spy = new IntersectionObserver(function(es){
      es.forEach(function(e){ if(!e.isIntersecting) return;
        links.forEach(function(a){ a.classList.toggle('pf-active', a.getAttribute('href') === '#' + e.target.id); }); });
    }, { rootMargin:'-45% 0px -50% 0px' });
    secs.forEach(function(s){ spy.observe(s); });
  }

  /* Scroll shear.
     The headline leans with the scroll velocity and springs back when you stop.
     Velocity, not position — tying it to scrollY would leave the type
     permanently crooked at the bottom of the page. Capped hard, because past a
     few degrees it stops reading as motion and starts reading as broken. */
  var big = document.getElementById('pf-big');
  if (!big || (matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches)) return;
  var last = window.scrollY, shear = 0, raf = null;
  var tick = function(){
    shear *= 0.86;
    big.style.setProperty('--shear', shear.toFixed(3));
    raf = Math.abs(shear) > 0.01 ? requestAnimationFrame(tick) : null;
  };
  addEventListener('scroll', function(){
    var y = window.scrollY, dv = y - last; last = y;
    shear = Math.max(-3.5, Math.min(3.5, shear + dv * 0.035));
    if (!raf) raf = requestAnimationFrame(tick);
  }, { passive:true });
})();`;

  return { fonts: [c.googleFont ? null : "Space+Grotesk:wght@500;700"].filter(Boolean),
           css, body, js, themeColor: "#FAF9F7" };
};


// ---------------------------------------------------------------------------
// 14. BLUEPRINT — a drafting sheet. Graph paper, crosshair corners, monospace
//     annotations, and dimension rules that draw themselves as each section
//     comes into view.
// ---------------------------------------------------------------------------
PF_RENDERERS.blueprint = (c) => {
  const d = c.d;
  const nav = c.navItems.map((n, i) => `<a href="#${n.id}"><i>${String(i + 1).padStart(2, "0")}</i>${pfEsc(n.label)}</a>`).join("");

  // One drawn rule per section head. stroke-dashoffset goes to 0 when the
  // wrapper picks up .pf-in, so the line inks itself in as you arrive.
  const rule = `<svg class="pf-rule" viewBox="0 0 600 12" preserveAspectRatio="none" aria-hidden="true">
      <path d="M0 6 H600" /><path d="M0 1 V11" /><path d="M600 1 V11" /></svg>`;

  const css = `
:root{
  --acc:${c.accent}; --ink:#DCEBF7; --muted:#8FB0C9; --faint:#5C7C99;
  --bg:#0B1B2B; --panel:rgba(15,38,58,.72); --line:rgba(76,201,240,.22); --line2:rgba(76,201,240,.09);
  --font:${c.fontStack || `'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif`};
  --mono:'JetBrains Mono','SFMono-Regular',Consolas,'Liberation Mono',monospace;
}
body{background:var(--bg);color:var(--ink);font-family:var(--font);font-size:16px;line-height:1.68;overflow-x:hidden}
.pf-skip{background:var(--acc);color:#04121f}
.pf-shell{width:min(1140px,92vw);margin:0 auto}

/* Drafting paper: a 20px minor grid and a 100px major one, both pure CSS. */
.pf-paper{position:fixed;inset:0;z-index:0;pointer-events:none;
  background-image:
    linear-gradient(var(--line2) 1px,transparent 1px),
    linear-gradient(90deg,var(--line2) 1px,transparent 1px),
    linear-gradient(${pfRgba(c.accent, .16)} 1px,transparent 1px),
    linear-gradient(90deg,${pfRgba(c.accent, .16)} 1px,transparent 1px);
  background-size:20px 20px,20px 20px,100px 100px,100px 100px}
.pf-vig{position:fixed;inset:0;z-index:1;pointer-events:none;
  background:radial-gradient(120% 90% at 50% 0%,transparent 30%,${pfRgba("#0B1B2B", .85)} 100%)}
main{position:relative;z-index:3}

.pf-nav{position:sticky;top:0;z-index:20;background:${pfRgba("#0B1B2B", .96)};
  backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border-bottom:1px solid var(--line)}
.pf-nav-in{display:flex;align-items:center;gap:1.2rem;padding:.75rem 0}
.pf-brand{font-family:var(--mono);font-weight:700;font-size:.9rem;letter-spacing:.02em;text-decoration:none;
  display:flex;align-items:center;gap:.6rem}
.pf-brand i{width:26px;height:26px;border:1px solid var(--acc);color:var(--acc);display:grid;place-items:center;
  font-size:.65rem;font-style:normal;font-weight:700}
.pf-nav-links{display:flex;gap:.15rem;margin-left:auto}
.pf-nav-links a{font-family:var(--mono);font-size:.74rem;color:var(--muted);text-decoration:none;
  padding:.35rem .7rem;border:1px solid transparent;transition:.2s;display:flex;gap:.45rem;align-items:center}
.pf-nav-links a i{color:var(--faint);font-style:normal;font-size:.66rem}
.pf-nav-links a:hover,.pf-nav-links a.pf-active{color:var(--acc);border-color:var(--line)}

/* Crosshairs. Four corner ticks drawn with borders on two pseudo-elements —
   the mark a draughtsman puts at every registration point. */
.pf-frame{position:relative;background:var(--panel);border:1px solid var(--line);
  backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);transition:.28s}
.pf-frame::before,.pf-frame::after{content:"";position:absolute;width:11px;height:11px;pointer-events:none;
  border:1px solid var(--acc);opacity:.55;transition:.28s}
.pf-frame::before{top:-1px;left:-1px;border-right:0;border-bottom:0}
.pf-frame::after{bottom:-1px;right:-1px;border-left:0;border-top:0}
.pf-frame:hover{border-color:${pfRgba(c.accent, .55)};transform:translateY(-3px);
  box-shadow:0 16px 40px rgba(0,0,0,.45)}
.pf-frame:hover::before,.pf-frame:hover::after{opacity:1;width:18px;height:18px}

.pf-hero{padding:clamp(3rem,8vw,5rem) 0 clamp(2rem,5vw,3rem)}
.pf-sheet{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(0,1fr);gap:0}
.pf-sheet>div{padding:clamp(1.6rem,4vw,2.6rem)}
.pf-sheet>div+div{border-left:1px solid var(--line)}
.pf-tag-line{font-family:var(--mono);font-size:.72rem;color:var(--acc);letter-spacing:.08em;margin-bottom:1rem}
.pf-hero h1{font-size:clamp(2.2rem,6vw,3.9rem);font-weight:800;letter-spacing:-.04em;line-height:1.02;margin-bottom:.5rem}
.pf-hero h2{font-family:var(--mono);font-size:clamp(.85rem,1.9vw,1.05rem);font-weight:500;color:var(--acc);
  margin-bottom:1rem;letter-spacing:.02em}
.pf-hero p{color:var(--muted);max-width:52ch}
.pf-spec{display:grid;gap:.55rem;font-family:var(--mono);font-size:.78rem}
.pf-spec div{display:flex;gap:.8rem;justify-content:space-between;padding-bottom:.5rem;border-bottom:1px dashed var(--line)}
.pf-spec dt{color:var(--faint)}
.pf-spec dd{color:var(--ink);text-align:right;margin:0}
.pf-actions{display:flex;flex-wrap:wrap;gap:.6rem;align-items:center;margin-top:1.6rem}
.pf-btn{display:inline-flex;align-items:center;gap:.5rem;padding:.7rem 1.3rem;font-family:var(--mono);
  font-size:.8rem;font-weight:500;text-decoration:none;border:1px solid var(--acc);transition:.22s;letter-spacing:.03em}
.pf-btn svg{width:15px;height:15px}
.pf-btn-primary{background:var(--acc);color:#04121f;font-weight:700}
.pf-btn-primary:hover{box-shadow:0 0 0 3px ${pfRgba(c.accent, .25)};transform:translateY(-2px)}
.pf-btn-ghost{color:var(--acc);background:transparent}
.pf-btn-ghost:hover{background:${pfRgba(c.accent, .12)};transform:translateY(-2px)}
.pf-socials{display:flex;gap:.4rem}
.pf-socials a{display:grid;place-items:center;width:36px;height:36px;border:1px solid var(--line);
  color:var(--muted);transition:.22s}
.pf-socials a svg{width:15px;height:15px}
.pf-socials a:hover{color:var(--acc);border-color:var(--acc)}

.pf-sec{padding:clamp(2.2rem,5.5vw,3.6rem) 0}
.pf-head{margin-bottom:1.6rem}
.pf-idx{font-family:var(--mono);font-size:.72rem;color:var(--acc);letter-spacing:.14em;margin-bottom:.4rem}
.pf-h2{font-size:clamp(1.4rem,3.4vw,2rem);font-weight:800;letter-spacing:-.03em;margin-bottom:.5rem}
.pf-rule{display:block;width:100%;height:12px;overflow:visible}
.pf-rule path{stroke:${pfRgba(c.accent, .55)};stroke-width:1;fill:none;
  stroke-dasharray:620;stroke-dashoffset:620;transition:stroke-dashoffset 1.1s ease-out .1s}
[data-reveal].pf-in .pf-rule path,.pf-head.pf-in .pf-rule path{stroke-dashoffset:0}
.pf-about{padding:1.8rem;white-space:pre-line;color:var(--muted)}
.pf-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:1px;background:var(--line)}
.pf-stat{padding:1.5rem 1.1rem;text-align:center;background:var(--panel)}
.pf-stat b{display:block;font-size:2.2rem;font-weight:800;color:var(--acc);letter-spacing:-.04em;font-variant-numeric:tabular-nums}
.pf-stat span{font-family:var(--mono);font-size:.68rem;color:var(--faint);letter-spacing:.08em;text-transform:uppercase}
.pf-pills{display:flex;flex-wrap:wrap;gap:.4rem}
.pf-pill{font-family:var(--mono);font-size:.78rem;padding:.35rem .8rem;border:1px solid var(--line);
  color:var(--muted);background:${pfRgba(c.accent, .05)};transition:.22s;cursor:default}
.pf-pill:hover{color:var(--acc);border-color:var(--acc);background:${pfRgba(c.accent, .14)}}
.pf-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(290px,1fr));gap:1rem}
.pf-proj{padding:1.5rem}
.pf-proj h3{font-size:1.1rem;font-weight:700;letter-spacing:-.02em;margin-bottom:.15rem}
.pf-proj .pf-role,.pf-row .pf-org{font-family:var(--mono);font-size:.75rem;color:var(--acc);margin-bottom:.6rem}
.pf-proj p,.pf-row p{color:var(--muted);font-size:.93rem}
.pf-proj ul,.pf-row ul{margin-top:.55rem}
.pf-proj li,.pf-row li{color:var(--muted);font-size:.89rem;padding-left:1.2rem;position:relative;margin-bottom:.25rem}
.pf-proj li::before,.pf-row li::before{content:"—";position:absolute;left:0;color:var(--acc)}
.pf-tags{display:flex;flex-wrap:wrap;gap:.3rem;margin-top:.8rem}
.pf-tag{font-family:var(--mono);font-size:.68rem;padding:.14rem .48rem;border:1px solid var(--line);color:var(--faint)}
.pf-links{display:flex;gap:1rem;margin-top:.8rem;font-family:var(--mono);font-size:.76rem}
.pf-links a{color:var(--acc);text-decoration:none;display:inline-flex;align-items:center;gap:.3rem}
.pf-links a svg{width:13px;height:13px}
.pf-rows{display:grid;gap:.8rem}
.pf-row{padding:1.4rem 1.5rem}
.pf-row-top{display:flex;flex-wrap:wrap;gap:.25rem 1rem;align-items:baseline}
.pf-row h3{font-size:1.04rem;font-weight:700}
.pf-row .pf-when{margin-left:auto;font-family:var(--mono);font-size:.75rem;color:var(--faint);white-space:nowrap}
.pf-contact{padding:clamp(2rem,5vw,3.2rem);text-align:center}
.pf-contact h2{font-size:clamp(1.6rem,4vw,2.4rem);font-weight:800;letter-spacing:-.035em;margin-bottom:.7rem}
.pf-contact p{color:var(--muted);max-width:46ch;margin:0 auto 1.5rem}
.pf-clist{display:flex;flex-wrap:wrap;gap:.6rem 1.6rem;justify-content:center;margin-top:1.5rem;
  font-family:var(--mono);font-size:.8rem}
.pf-clist a,.pf-clist span{color:var(--muted);text-decoration:none;display:inline-flex;align-items:center;gap:.4rem}
.pf-clist svg{width:15px;height:15px;color:var(--acc)}
.pf-clist a:hover{color:var(--acc)}
footer{padding:2.4rem 0;text-align:center;font-family:var(--mono);color:var(--faint);font-size:.75rem}
@media (max-width:860px){.pf-nav-links{display:none}.pf-sheet{grid-template-columns:1fr}
  .pf-sheet>div+div{border-left:0;border-top:1px solid var(--line)}.pf-row .pf-when{margin-left:0;width:100%}}
@media (prefers-reduced-motion:reduce){.pf-rule path{stroke-dashoffset:0;transition:none}}`;

  const head = (idx, title, sub) => `<div class="pf-head" data-reveal>
    <div class="pf-idx">${idx} / ${sub}</div><h2 class="pf-h2">${title}</h2>${rule}</div>`;

  const body = `
<div class="pf-paper" aria-hidden="true"></div>
<div class="pf-vig" aria-hidden="true"></div>
<nav class="pf-nav pf-noprint"><div class="pf-shell pf-nav-in">
  <a class="pf-brand" href="#top"><i>${pfEsc(c.initials)}</i>${pfEsc(c.name)}</a>
  ${nav ? `<div class="pf-nav-links">${nav}</div>` : ""}
</div></nav>

<main id="main"><div class="pf-shell">
  <section class="pf-hero" id="top"><div class="pf-frame pf-sheet">
    <div>
      <div class="pf-tag-line">DRAWING 001 — ELEVATION</div>
      <h1>${pfEsc(c.name)}</h1>
      ${c.title ? `<h2>${pfEsc(c.title)}</h2>` : ""}
      ${c.tagline ? `<p>${pfEsc(c.tagline)}</p>` : ""}
      <div class="pf-actions">
        ${d.email ? `<a class="pf-btn pf-btn-primary" href="mailto:${pfEsc(d.email)}">${PF_ICONS.mail}${pfEsc(d.cta_text || "Get in touch")}</a>` : ""}
        ${c.hasResume ? `<a class="pf-btn pf-btn-ghost" ${pfResumeAttrs(c)}>${PF_ICONS.download}${pfEsc(c.resumeLabel)}</a>` : ""}
        ${pfSocialRow(c)}
      </div>
    </div>
    <div>
      <div class="pf-tag-line">SPECIFICATION</div>
      <dl class="pf-spec">
        ${d.location ? `<div><dt>Location</dt><dd>${pfEsc(d.location)}</dd></div>` : ""}
        ${d.available ? `<div><dt>Status</dt><dd>${pfEsc(d.available)}</dd></div>` : ""}
        ${d.experience.length ? `<div><dt>Roles</dt><dd>${d.experience.length}</dd></div>` : ""}
        ${d.projects.length ? `<div><dt>Projects</dt><dd>${d.projects.length}</dd></div>` : ""}
        ${d.skills.length ? `<div><dt>Disciplines</dt><dd>${d.skills.length}</dd></div>` : ""}
        <div><dt>Revision</dt><dd>${c.year}.1</dd></div>
      </dl>
    </div>
  </div></section>

  ${c.has("stats") ? `<section class="pf-sec"><div class="pf-stats" data-reveal>
    ${d.stats.map(x => `<div class="pf-stat"><b>${pfEsc(x.value)}</b><span>${pfEsc(x.label)}</span></div>`).join("")}
  </div></section>` : ""}

  ${c.has("about") ? `<section class="pf-sec" id="about">${head("01", "About", "NOTES")}
    <div class="pf-frame pf-about" data-reveal>${pfEsc(d.about)}</div></section>` : ""}

  ${c.has("skills") ? `<section class="pf-sec" id="skills">${head("02", "Skills", "MATERIALS")}
    <div class="pf-pills" data-reveal>${d.skills.map(x => `<span class="pf-pill">${pfEsc(x)}</span>`).join("")}</div></section>` : ""}

  ${c.has("projects") ? `<section class="pf-sec" id="projects">${head("03", "Projects", "ASSEMBLIES")}
    <div class="pf-grid">${d.projects.map((x, i) => `
      <article class="pf-frame pf-proj" data-reveal data-reveal-delay="${Math.min(i, 5) * 80}">
        <h3>${pfEsc(x.name || "")}</h3>
        ${pfJoin([x.role, x.period]) ? `<div class="pf-role">${pfJoin([x.role, x.period])}</div>` : ""}
        ${x.description ? `<p>${pfEsc(x.description)}</p>` : ""}
        ${(x.bullets || []).length ? `<ul>${x.bullets.map(b => `<li>${pfEsc(b)}</li>`).join("")}</ul>` : ""}
        ${(x.tags || []).length ? `<div class="pf-tags">${x.tags.map(t => `<span class="pf-tag">${pfEsc(t)}</span>`).join("")}</div>` : ""}
        ${pfProjectLinks(x) ? `<div class="pf-links">${pfProjectLinks(x)}</div>` : ""}
      </article>`).join("")}</div></section>` : ""}

  ${c.has("experience") ? `<section class="pf-sec" id="experience">${head("04", "Experience", "SITE LOG")}
    <div class="pf-rows">${d.experience.map((x, i) => `
      <article class="pf-frame pf-row" data-reveal data-reveal-delay="${Math.min(i, 5) * 70}">
        <div class="pf-row-top"><h3>${pfEsc(x.role || "")}</h3>
          ${x.period ? `<span class="pf-when">${pfEsc(x.period)}</span>` : ""}</div>
        ${x.org ? `<div class="pf-org">${pfJoin([x.org, x.location])}</div>` : ""}
        ${x.summary ? `<p>${pfEsc(x.summary)}</p>` : ""}
        ${(x.bullets || []).length ? `<ul>${x.bullets.map(b => `<li>${pfEsc(b)}</li>`).join("")}</ul>` : ""}
      </article>`).join("")}</div></section>` : ""}

  ${c.has("education") ? `<section class="pf-sec" id="education">${head("05", "Education", "TRAINING")}
    <div class="pf-rows">${d.education.map(x => `
      <article class="pf-frame pf-row" data-reveal>
        <div class="pf-row-top"><h3>${pfEsc(x.degree || "")}</h3>
          ${x.period ? `<span class="pf-when">${pfEsc(x.period)}</span>` : ""}</div>
        ${x.school ? `<div class="pf-org">${pfEsc(x.school)}</div>` : ""}
        ${x.detail ? `<p>${pfEsc(x.detail)}</p>` : ""}
      </article>`).join("")}</div></section>` : ""}

  ${c.has("certifications") ? `<section class="pf-sec" id="certifications">${head("06", "Certifications", "APPROVALS")}
    <div class="pf-pills" data-reveal>${d.certifications.map(x => `<span class="pf-pill">${pfEsc(x)}</span>`).join("")}</div></section>` : ""}

  ${c.has("contact") ? `<section class="pf-sec" id="contact"><div class="pf-frame pf-contact" data-reveal>
    <h2>Request for information</h2>
    <p>${pfEsc(d.cta_text || "Send the brief. I will send back questions before I send back a price.")}</p>
    <div class="pf-actions" style="justify-content:center;margin-top:0">
      ${d.email ? `<a class="pf-btn pf-btn-primary" href="mailto:${pfEsc(d.email)}">${PF_ICONS.mail}${pfEsc(d.email)}</a>` : ""}
      ${c.hasResume ? `<a class="pf-btn pf-btn-ghost" ${pfResumeAttrs(c)}>${PF_ICONS.download}Résumé</a>` : ""}
    </div>
    <div class="pf-clist">${c.links.map(x => x.url
      ? `<a href="${pfEsc(x.url)}"${/^https?:/i.test(x.url) ? ` target="_blank" rel="noopener"` : ""}>${x.icon}${pfEsc(x.handle)}</a>`
      : `<span>${x.icon}${pfEsc(x.handle)}</span>`).join("")}</div>
  </div></section>` : ""}

  <footer>SHEET ${c.year} · ${pfEsc(c.name.toUpperCase())}${d.footer_note ? " · " + pfEsc(d.footer_note.toUpperCase()) : ""}</footer>
</div></main>`;

  const js = `
(function(){
  var links = [].slice.call(document.querySelectorAll('.pf-nav-links a'));
  var secs = links.map(function(a){ return document.querySelector(a.getAttribute('href')); }).filter(Boolean);
  if ('IntersectionObserver' in window && secs.length) {
    var spy = new IntersectionObserver(function(es){
      es.forEach(function(e){ if(!e.isIntersecting) return;
        links.forEach(function(a){ a.classList.toggle('pf-active', a.getAttribute('href') === '#' + e.target.id); }); });
    }, { rootMargin:'-45% 0px -50% 0px' });
    secs.forEach(function(s){ spy.observe(s); });
  }
  /* The paper drifts a fraction of the scroll distance. Any more and the grid
     reads as a second scrolling surface instead of the sheet underneath. */
  var paper = document.querySelector('.pf-paper');
  if (paper && !(matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches)) {
    addEventListener('scroll', function(){
      paper.style.backgroundPosition = (function(y){
        var o = (y * 0.08).toFixed(1) + 'px';
        return '0 ' + o + ',0 0,0 ' + o + ',0 0';
      })(window.scrollY);
    }, { passive:true });
  }
})();`;

  return { fonts: [c.googleFont ? null : "Inter:wght@400;500;700;800", "JetBrains+Mono:wght@400;500;700"].filter(Boolean),
           css, body, js, themeColor: "#0B1B2B" };
};


// ---------------------------------------------------------------------------
// 15. LIQUID — SVG goo. Three blobs chase the cursor through a threshold
//     filter, so they merge and separate like mercury instead of overlapping
//     like circles. Blob dividers between every section.
// ---------------------------------------------------------------------------
PF_RENDERERS.liquid = (c) => {
  const d = c.d;
  const a2 = pfHueShift(c.accent, -38);
  const nav = c.navItems.map(n => `<a href="#${n.id}">${pfEsc(n.label)}</a>`).join("");
  // Alternating blob silhouettes so no two dividers on a page are the same shape.
  const wave = (flip) => `<svg class="pf-wave${flip ? " pf-flip" : ""}" viewBox="0 0 1440 90" preserveAspectRatio="none" aria-hidden="true">
    <path d="M0 46c180-46 320 30 520 22s300-58 480-40 260 62 440 34V90H0z"/></svg>`;

  const css = `
:root{
  --acc:${c.accent}; --acc2:${a2}; --ink:#2A2233; --muted:#6C6079; --faint:#A79CB1;
  --bg:#FFF8FB; --card:#FFFFFF; --line:#F2E3EC; --soft:${pfRgba(c.accent, .1)};
  --font:${c.fontStack || `'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif`};
}
body{background:var(--bg);color:var(--ink);font-family:var(--font);font-size:16px;line-height:1.72;overflow-x:hidden}
.pf-skip{background:var(--acc);color:${c.accentInk}}
.pf-shell{width:min(1080px,90vw);margin:0 auto}
.pf-defs{position:absolute;width:0;height:0;overflow:hidden}

/* The goo. Blur then a hard alpha threshold: overlapping blurred circles fuse
   into one silhouette instead of stacking. Behind the content and never
   interactive, so the whole layer can be ignored by the pointer. */
.pf-blobs{position:fixed;inset:0;z-index:0;pointer-events:none;filter:url(#pf-goo);opacity:.3}
.pf-blobs i{position:absolute;display:block;border-radius:50%;will-change:transform}
.pf-blobs i:nth-child(1){width:300px;height:300px;background:${pfRgba(c.accent, .7)}}
.pf-blobs i:nth-child(2){width:250px;height:250px;background:${pfRgba(a2, .75)}}
.pf-blobs i:nth-child(3){width:170px;height:170px;background:${pfRgba(pfHueShift(c.accent, 28), .65)}}
main{position:relative;z-index:2}

.pf-nav{position:sticky;top:0;z-index:20;background:${pfRgba("#FFF8FB", .9)};
  backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px)}
.pf-nav-in{display:flex;align-items:center;gap:1.2rem;padding:.8rem 0}
.pf-brand{font-weight:800;letter-spacing:-.02em;text-decoration:none;display:flex;align-items:center;gap:.55rem}
.pf-brand i{width:30px;height:30px;display:grid;place-items:center;font-size:.7rem;font-weight:800;font-style:normal;
  color:#fff;background:linear-gradient(135deg,var(--acc),var(--acc2));
  border-radius:60% 40% 55% 45%/50% 55% 45% 50%;animation:pf-morph 9s ease-in-out infinite}
@keyframes pf-morph{
  0%,100%{border-radius:60% 40% 55% 45%/50% 55% 45% 50%}
  33%{border-radius:45% 55% 40% 60%/55% 45% 60% 40%}
  66%{border-radius:55% 45% 60% 40%/40% 60% 45% 55%}}
.pf-nav-links{display:flex;gap:.2rem;margin-left:auto}
.pf-nav-links a{padding:.4rem .9rem;border-radius:999px;font-size:.86rem;font-weight:600;color:var(--muted);
  text-decoration:none;transition:.25s}
.pf-nav-links a:hover,.pf-nav-links a.pf-active{color:var(--acc);background:var(--soft)}

.pf-hero{padding:clamp(3rem,9vw,5.5rem) 0 clamp(2rem,5vw,3rem);text-align:center}
.pf-avatar{width:132px;height:132px;object-fit:cover;margin:0 auto 1.6rem;
  border-radius:58% 42% 48% 52%/45% 50% 50% 55%;animation:pf-morph 11s ease-in-out infinite;
  box-shadow:0 20px 50px ${pfRgba(c.accent, .28)}}
.pf-avatar-initials{display:grid;place-items:center;font-size:2.9rem;font-weight:800;color:#fff;
  background:linear-gradient(140deg,var(--acc),var(--acc2))}
.pf-badge{display:inline-flex;align-items:center;gap:.5rem;padding:.4rem 1.05rem;border-radius:999px;
  background:var(--soft);color:var(--acc);font-size:.8rem;font-weight:700;margin-bottom:1.2rem}
.pf-badge i{width:7px;height:7px;border-radius:50%;background:var(--acc);animation:pf-bob 2s ease-in-out infinite}
@keyframes pf-bob{50%{transform:translateY(-3px)}}
.pf-hero h1{font-size:clamp(2.3rem,6.5vw,4.2rem);font-weight:800;letter-spacing:-.04em;line-height:1.04}
.pf-hero h1 em{font-style:normal;background:linear-gradient(100deg,var(--acc),var(--acc2));
  -webkit-background-clip:text;background-clip:text;color:transparent}
.pf-hero h2{font-size:clamp(1rem,2.3vw,1.25rem);font-weight:700;color:var(--acc);margin:.7rem 0 .8rem}
.pf-hero p{color:var(--muted);max-width:52ch;margin:0 auto}
.pf-actions{display:flex;flex-wrap:wrap;gap:.65rem;justify-content:center;align-items:center;margin-top:1.7rem}
.pf-btn{display:inline-flex;align-items:center;gap:.5rem;padding:.82rem 1.6rem;border-radius:999px;font-weight:700;
  font-size:.92rem;text-decoration:none;border:2px solid transparent;transition:.28s cubic-bezier(.2,1.4,.4,1)}
.pf-btn svg{width:16px;height:16px}
.pf-btn-primary{background:linear-gradient(120deg,var(--acc),var(--acc2));color:#fff;
  box-shadow:0 12px 30px ${pfRgba(c.accent, .35)}}
.pf-btn-primary:hover{transform:translateY(-4px) scale(1.03);box-shadow:0 18px 40px ${pfRgba(c.accent, .45)}}
.pf-btn-ghost{background:var(--card);border-color:var(--line);color:var(--ink)}
.pf-btn-ghost:hover{border-color:var(--acc);color:var(--acc);transform:translateY(-4px) scale(1.03)}
.pf-socials{display:flex;gap:.45rem}
.pf-socials a{display:grid;place-items:center;width:42px;height:42px;background:var(--card);
  border:2px solid var(--line);color:var(--muted);transition:.28s cubic-bezier(.2,1.4,.4,1);
  border-radius:55% 45% 50% 50%/50% 50% 45% 55%}
.pf-socials a svg{width:16px;height:16px}
.pf-socials a:hover{color:#fff;background:var(--acc);border-color:var(--acc);transform:translateY(-4px) rotate(8deg)}

.pf-band{position:relative;background:var(--card);padding:clamp(2rem,5vw,3rem) 0;margin:2.5rem 0}
.pf-wave{position:absolute;left:0;width:100%;height:70px;fill:var(--card);display:block}
.pf-wave:first-of-type{top:-69px}
.pf-wave.pf-flip{bottom:-69px;transform:scaleY(-1)}
.pf-sec{padding:clamp(2.2rem,5.5vw,3.6rem) 0}
.pf-h2{font-size:clamp(1.6rem,4vw,2.4rem);font-weight:800;letter-spacing:-.035em;margin-bottom:.3rem;text-align:center}
.pf-sub{color:var(--faint);text-align:center;margin-bottom:2rem;font-size:.92rem}
.pf-card{background:var(--card);border:2px solid var(--line);border-radius:26px;transition:.3s cubic-bezier(.2,1.2,.4,1)}
.pf-card:hover{border-color:${pfRgba(c.accent, .5)};transform:translateY(-6px);box-shadow:0 22px 46px ${pfRgba(c.accent, .16)}}
.pf-about{padding:2rem;white-space:pre-line;color:var(--muted);max-width:66ch;margin:0 auto}
.pf-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:1rem}
.pf-stat{padding:1.6rem 1rem;text-align:center;border-radius:26px;background:var(--card);border:2px solid var(--line);
  transition:.3s cubic-bezier(.2,1.2,.4,1)}
.pf-stat:hover{transform:translateY(-6px) rotate(-1.5deg);border-color:var(--acc)}
.pf-stat b{display:block;font-size:2.4rem;font-weight:800;letter-spacing:-.04em;
  background:linear-gradient(140deg,var(--acc),var(--acc2));-webkit-background-clip:text;background-clip:text;color:transparent}
.pf-stat span{font-size:.78rem;color:var(--faint);font-weight:700}
.pf-pills{display:flex;flex-wrap:wrap;gap:.5rem;justify-content:center}
.pf-pill{padding:.5rem 1.15rem;border-radius:999px;font-size:.9rem;font-weight:600;color:var(--muted);
  background:var(--card);border:2px solid var(--line);transition:.28s cubic-bezier(.2,1.4,.4,1);cursor:default}
.pf-pill:hover{color:#fff;background:linear-gradient(120deg,var(--acc),var(--acc2));border-color:transparent;
  transform:translateY(-4px) rotate(-2deg)}
.pf-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(290px,1fr));gap:1.1rem}
.pf-proj{padding:1.8rem}
.pf-proj h3{font-size:1.18rem;font-weight:800;letter-spacing:-.02em;margin-bottom:.15rem}
.pf-proj .pf-role,.pf-row .pf-org{font-size:.83rem;color:var(--acc);font-weight:700;margin-bottom:.65rem}
.pf-proj p,.pf-row p{color:var(--muted);font-size:.94rem}
.pf-proj ul,.pf-row ul{margin-top:.6rem}
.pf-proj li,.pf-row li{color:var(--muted);font-size:.9rem;padding-left:1.3rem;position:relative;margin-bottom:.26rem}
.pf-proj li::before,.pf-row li::before{content:"";position:absolute;left:0;top:.55em;width:8px;height:8px;
  background:var(--acc);border-radius:60% 40% 50% 50%/50% 55% 45% 50%}
.pf-tags{display:flex;flex-wrap:wrap;gap:.35rem;margin-top:.9rem}
.pf-tag{font-size:.72rem;font-weight:700;padding:.2rem .6rem;border-radius:999px;color:var(--acc);background:var(--soft)}
.pf-links{display:flex;gap:1rem;margin-top:.9rem;font-size:.85rem;font-weight:700}
.pf-links a{color:var(--acc);text-decoration:none;display:inline-flex;align-items:center;gap:.32rem}
.pf-links a svg{width:14px;height:14px}
.pf-rows{display:grid;gap:.9rem}
.pf-row{padding:1.5rem 1.8rem}
.pf-row-top{display:flex;flex-wrap:wrap;gap:.3rem 1rem;align-items:baseline}
.pf-row h3{font-size:1.1rem;font-weight:800}
.pf-row .pf-when{margin-left:auto;color:var(--faint);font-size:.83rem;white-space:nowrap;font-weight:600}
.pf-contact{padding:clamp(2.2rem,5vw,3.4rem);text-align:center;border-radius:34px;
  background:linear-gradient(140deg,${pfRgba(c.accent, .1)},${pfRgba(a2, .12)});border:2px solid var(--line)}
.pf-contact h2{font-size:clamp(1.8rem,5vw,2.8rem);font-weight:800;letter-spacing:-.04em;margin-bottom:.7rem}
.pf-contact p{color:var(--muted);max-width:46ch;margin:0 auto 1.6rem}
.pf-clist{display:flex;flex-wrap:wrap;gap:.6rem 1.7rem;justify-content:center;margin-top:1.6rem;font-size:.9rem}
.pf-clist a,.pf-clist span{color:var(--muted);text-decoration:none;display:inline-flex;align-items:center;gap:.42rem;font-weight:600}
.pf-clist svg{width:16px;height:16px;color:var(--acc)}
.pf-clist a:hover{color:var(--acc)}
footer{padding:2.6rem 0;text-align:center;color:var(--faint);font-size:.85rem}
@media (max-width:760px){.pf-nav-links{display:none}.pf-row .pf-when{margin-left:0;width:100%}}
@media (prefers-reduced-motion:reduce){.pf-blobs i,.pf-avatar,.pf-brand i{animation:none}}`;

  const body = `
<svg class="pf-defs" aria-hidden="true"><defs><filter id="pf-goo">
  <feGaussianBlur in="SourceGraphic" stdDeviation="14" result="b"/>
  <feColorMatrix in="b" mode="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 22 -9"/>
</filter></defs></svg>
<div class="pf-blobs" id="pf-blobs" aria-hidden="true"><i></i><i></i><i></i></div>

<nav class="pf-nav pf-noprint"><div class="pf-shell pf-nav-in">
  <a class="pf-brand" href="#top"><i>${pfEsc(c.initials)}</i>${pfEsc(c.name)}</a>
  ${nav ? `<div class="pf-nav-links">${nav}</div>` : ""}
</div></nav>

<main id="main"><div class="pf-shell">
  <section class="pf-hero" id="top">
    ${pfAvatar(c)}
    ${d.available ? `<div class="pf-badge"><i></i>${pfEsc(d.available)}</div>` : ""}
    <h1>${pfEsc(c.name.split(" ")[0] || c.name)}<em>${pfEsc(c.name.split(" ").slice(1).join(" ") ? " " + c.name.split(" ").slice(1).join(" ") : "")}</em></h1>
    ${c.title ? `<h2>${pfEsc(c.title)}</h2>` : ""}
    ${c.tagline ? `<p>${pfEsc(c.tagline)}</p>` : ""}
    <div class="pf-actions">
      ${d.email ? `<a class="pf-btn pf-btn-primary" href="mailto:${pfEsc(d.email)}">${PF_ICONS.mail}${pfEsc(d.cta_text || "Say hello")}</a>` : ""}
      ${c.hasResume ? `<a class="pf-btn pf-btn-ghost" ${pfResumeAttrs(c)}>${PF_ICONS.download}${pfEsc(c.resumeLabel)}</a>` : ""}
      ${pfSocialRow(c)}
    </div>
  </section>
</div>

${c.has("stats") ? `<div class="pf-band">${wave(false)}<div class="pf-shell"><div class="pf-stats" data-reveal>
  ${d.stats.map(x => `<div class="pf-stat"><b>${pfEsc(x.value)}</b><span>${pfEsc(x.label)}</span></div>`).join("")}
</div></div>${wave(true)}</div>` : ""}

<div class="pf-shell">
  ${c.has("about") ? `<section class="pf-sec" id="about"><h2 class="pf-h2">About</h2>
    <p class="pf-sub">A little context</p>
    <div class="pf-card pf-about" data-reveal>${pfEsc(d.about)}</div></section>` : ""}

  ${c.has("skills") ? `<section class="pf-sec" id="skills"><h2 class="pf-h2">Skills</h2>
    <p class="pf-sub">Things I am fluent in</p>
    <div class="pf-pills" data-reveal>${d.skills.map(x => `<span class="pf-pill">${pfEsc(x)}</span>`).join("")}</div></section>` : ""}

  ${c.has("projects") ? `<section class="pf-sec" id="projects"><h2 class="pf-h2">Work</h2>
    <p class="pf-sub">Selected projects</p>
    <div class="pf-grid">${d.projects.map((x, i) => `
      <article class="pf-card pf-proj" data-reveal data-reveal-delay="${Math.min(i, 5) * 80}">
        <h3>${pfEsc(x.name || "")}</h3>
        ${pfJoin([x.role, x.period]) ? `<div class="pf-role">${pfJoin([x.role, x.period])}</div>` : ""}
        ${x.description ? `<p>${pfEsc(x.description)}</p>` : ""}
        ${(x.bullets || []).length ? `<ul>${x.bullets.map(b => `<li>${pfEsc(b)}</li>`).join("")}</ul>` : ""}
        ${(x.tags || []).length ? `<div class="pf-tags">${x.tags.map(t => `<span class="pf-tag">${pfEsc(t)}</span>`).join("")}</div>` : ""}
        ${pfProjectLinks(x) ? `<div class="pf-links">${pfProjectLinks(x)}</div>` : ""}
      </article>`).join("")}</div></section>` : ""}

  ${c.has("experience") ? `<section class="pf-sec" id="experience"><h2 class="pf-h2">Experience</h2>
    <p class="pf-sub">Where I have been</p>
    <div class="pf-rows">${d.experience.map((x, i) => `
      <article class="pf-card pf-row" data-reveal data-reveal-delay="${Math.min(i, 5) * 70}">
        <div class="pf-row-top"><h3>${pfEsc(x.role || "")}</h3>
          ${x.period ? `<span class="pf-when">${pfEsc(x.period)}</span>` : ""}</div>
        ${x.org ? `<div class="pf-org">${pfJoin([x.org, x.location])}</div>` : ""}
        ${x.summary ? `<p>${pfEsc(x.summary)}</p>` : ""}
        ${(x.bullets || []).length ? `<ul>${x.bullets.map(b => `<li>${pfEsc(b)}</li>`).join("")}</ul>` : ""}
      </article>`).join("")}</div></section>` : ""}

  ${c.has("education") ? `<section class="pf-sec" id="education"><h2 class="pf-h2">Education</h2>
    <p class="pf-sub">Formally</p>
    <div class="pf-rows">${d.education.map(x => `
      <article class="pf-card pf-row" data-reveal>
        <div class="pf-row-top"><h3>${pfEsc(x.degree || "")}</h3>
          ${x.period ? `<span class="pf-when">${pfEsc(x.period)}</span>` : ""}</div>
        ${x.school ? `<div class="pf-org">${pfEsc(x.school)}</div>` : ""}
        ${x.detail ? `<p>${pfEsc(x.detail)}</p>` : ""}
      </article>`).join("")}</div></section>` : ""}

  ${c.has("certifications") ? `<section class="pf-sec" id="certifications"><h2 class="pf-h2">Certifications</h2>
    <p class="pf-sub">On paper</p>
    <div class="pf-pills" data-reveal>${d.certifications.map(x => `<span class="pf-pill">${pfEsc(x)}</span>`).join("")}</div></section>` : ""}

  ${c.has("contact") ? `<section class="pf-sec" id="contact"><div class="pf-contact" data-reveal>
    <h2>Let's work together</h2>
    <p>${pfEsc(d.cta_text || "The inbox is open and the kettle is on.")}</p>
    <div class="pf-actions" style="margin-top:0">
      ${d.email ? `<a class="pf-btn pf-btn-primary" href="mailto:${pfEsc(d.email)}">${PF_ICONS.mail}${pfEsc(d.email)}</a>` : ""}
      ${c.hasResume ? `<a class="pf-btn pf-btn-ghost" ${pfResumeAttrs(c)}>${PF_ICONS.download}Résumé</a>` : ""}
    </div>
    <div class="pf-clist">${c.links.map(x => x.url
      ? `<a href="${pfEsc(x.url)}"${/^https?:/i.test(x.url) ? ` target="_blank" rel="noopener"` : ""}>${x.icon}${pfEsc(x.handle)}</a>`
      : `<span>${x.icon}${pfEsc(x.handle)}</span>`).join("")}</div>
  </div></section>` : ""}

  <footer>© <span data-year>${c.year}</span> ${pfEsc(c.name)}${d.footer_note ? " · " + pfEsc(d.footer_note) : ""}</footer>
</div></main>`;

  const js = `
(function(){
  var links = [].slice.call(document.querySelectorAll('.pf-nav-links a'));
  var secs = links.map(function(a){ return document.querySelector(a.getAttribute('href')); }).filter(Boolean);
  if ('IntersectionObserver' in window && secs.length) {
    var spy = new IntersectionObserver(function(es){
      es.forEach(function(e){ if(!e.isIntersecting) return;
        links.forEach(function(a){ a.classList.toggle('pf-active', a.getAttribute('href') === '#' + e.target.id); }); });
    }, { rootMargin:'-45% 0px -50% 0px' });
    secs.forEach(function(s){ spy.observe(s); });
  }

  /* Each blob eases toward the pointer at its own rate, and the slower ones
     trail. Equal speeds would just be three concentric circles; the lag is the
     whole illusion. They idle on a slow figure of eight when nothing is
     moving, so the page is alive before it is touched. */
  var wrap = document.getElementById('pf-blobs');
  if (!wrap || (matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches)) return;
  var b = [].slice.call(wrap.children);
  var ease = [0.085, 0.055, 0.035];
  var pos = b.map(function(){ return { x: innerWidth / 2, y: innerHeight / 2 }; });
  var tx = innerWidth / 2, ty = innerHeight * 0.42, idle = true, t0 = 0;

  addEventListener('pointermove', function(e){ idle = false; tx = e.clientX; ty = e.clientY; }, { passive:true });

  (function loop(t){
    if (idle) {
      var k = t / 4200;
      tx = innerWidth * (0.5 + 0.42 * Math.sin(k));
      ty = innerHeight * (0.52 + 0.26 * Math.sin(k * 1.7));
    }
    for (var i = 0; i < b.length; i++) {
      pos[i].x += (tx - pos[i].x) * ease[i];
      pos[i].y += (ty - pos[i].y) * ease[i];
      var w = b[i].offsetWidth / 2, h = b[i].offsetHeight / 2;
      b[i].style.transform = 'translate(' + (pos[i].x - w) + 'px,' + (pos[i].y - h) + 'px)';
    }
    requestAnimationFrame(loop);
  })(0);
})();`;

  return { fonts: [c.googleFont ? null : "Inter:wght@400;600;700;800"].filter(Boolean),
           css, body, js, themeColor: "#FFF8FB" };
};


// ---------------------------------------------------------------------------
// 16. BENTO — unequal tiles on one grid. Every tile tilts toward the pointer in
//     3D and springs back; the grid is the layout, not a wrapper around one.
// ---------------------------------------------------------------------------
PF_RENDERERS.bento = (c) => {
  const d = c.d;
  const a2 = pfHueShift(c.accent, 42);
  const nav = c.navItems.map(n => `<a href="#${n.id}">${pfEsc(n.label)}</a>`).join("");

  const css = `
:root{
  --acc:${c.accent}; --acc2:${a2}; --ink:#0F172A; --muted:#54637A; --faint:#94A3B8;
  --bg:#F1F5F9; --card:#FFFFFF; --line:#E2E8F0;
  --font:${c.fontStack || `'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif`};
}
body{background:var(--bg);color:var(--ink);font-family:var(--font);font-size:16px;line-height:1.65}
.pf-skip{background:var(--acc);color:${c.accentInk}}
.pf-shell{width:min(1180px,93vw);margin:0 auto}
.pf-nav{position:sticky;top:0;z-index:20;background:${pfRgba("#F1F5F9", .93)};
  backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px)}
.pf-nav-in{display:flex;align-items:center;gap:1.2rem;padding:.8rem 0}
.pf-brand{font-weight:800;letter-spacing:-.025em;text-decoration:none;display:flex;align-items:center;gap:.55rem}
.pf-brand i{width:28px;height:28px;border-radius:9px;display:grid;place-items:center;font-size:.68rem;font-weight:800;
  font-style:normal;color:#fff;background:linear-gradient(135deg,var(--acc),var(--acc2))}
.pf-nav-links{display:flex;gap:.15rem;margin-left:auto}
.pf-nav-links a{padding:.4rem .85rem;border-radius:9px;font-size:.86rem;font-weight:600;color:var(--muted);
  text-decoration:none;transition:.2s}
.pf-nav-links a:hover,.pf-nav-links a.pf-active{color:var(--acc);background:var(--card)}

/* The grid. Twelve columns and explicit spans per tile: an auto-fit grid would
   make every tile the same size, which is the one thing a bento must not do. */
.pf-bento{display:grid;grid-template-columns:repeat(12,1fr);gap:1rem;padding:1.4rem 0 0}
.pf-t{position:relative;background:var(--card);border:1px solid var(--line);border-radius:22px;padding:1.6rem;
  overflow:hidden;transform-style:preserve-3d;
  transform:perspective(900px) rotateX(var(--rx,0deg)) rotateY(var(--ry,0deg)) translateZ(0);
  transition:transform .5s cubic-bezier(.2,1.1,.3,1),box-shadow .35s,border-color .35s}
.pf-t:hover{box-shadow:0 22px 48px rgba(15,23,42,.13);border-color:${pfRgba(c.accent, .4)};z-index:2}
.pf-t.pf-tilting{transition:transform .08s linear,box-shadow .35s,border-color .35s}
.pf-t-head{display:flex;align-items:center;gap:.5rem;font-size:.7rem;font-weight:800;letter-spacing:.13em;
  text-transform:uppercase;color:var(--faint);margin-bottom:.9rem}
.pf-t-head::after{content:"";flex:1;height:1px;background:var(--line)}

.pf-t-hero{grid-column:span 7;background:linear-gradient(150deg,var(--acc),var(--acc2));color:#fff;
  border-color:transparent;padding:clamp(1.8rem,4vw,2.6rem)}
.pf-t-hero::after{content:"";position:absolute;right:-70px;bottom:-90px;width:260px;height:260px;border-radius:50%;
  background:rgba(255,255,255,.14)}
.pf-t-hero h1{font-size:clamp(1.9rem,4.4vw,3rem);font-weight:800;letter-spacing:-.04em;line-height:1.04;position:relative}
.pf-t-hero h2{font-size:clamp(.95rem,2vw,1.15rem);font-weight:600;opacity:.92;margin:.5rem 0 .7rem;position:relative}
.pf-t-hero p{opacity:.88;max-width:40ch;font-size:.96rem;position:relative}
.pf-avatar{width:64px;height:64px;border-radius:18px;object-fit:cover;margin-bottom:1rem;position:relative;
  border:2px solid rgba(255,255,255,.5)}
.pf-avatar-initials{display:grid;place-items:center;font-size:1.5rem;font-weight:800;color:var(--acc);background:#fff}
.pf-t-avail{grid-column:span 5;display:flex;flex-direction:column;justify-content:center;gap:.7rem}
.pf-live{display:inline-flex;align-items:center;gap:.5rem;font-weight:700;color:var(--acc);font-size:.92rem}
.pf-live i{width:9px;height:9px;border-radius:50%;background:var(--acc);
  box-shadow:0 0 0 0 ${pfRgba(c.accent, .5)};animation:pf-ping 2s cubic-bezier(0,0,.2,1) infinite}
@keyframes pf-ping{70%,100%{box-shadow:0 0 0 12px ${pfRgba(c.accent, 0)}}}
.pf-where{color:var(--muted);font-size:.92rem}
.pf-actions{display:flex;flex-wrap:wrap;gap:.55rem;align-items:center;margin-top:.4rem}
.pf-btn{display:inline-flex;align-items:center;gap:.45rem;padding:.68rem 1.2rem;border-radius:12px;font-weight:700;
  font-size:.87rem;text-decoration:none;border:1px solid transparent;transition:.25s}
.pf-btn svg{width:15px;height:15px}
.pf-btn-primary{background:var(--ink);color:#fff}
.pf-btn-primary:hover{background:var(--acc);transform:translateY(-2px)}
.pf-btn-ghost{background:var(--bg);border-color:var(--line);color:var(--ink)}
.pf-btn-ghost:hover{border-color:var(--acc);color:var(--acc);transform:translateY(-2px)}
.pf-socials{display:flex;gap:.4rem}
.pf-socials a{display:grid;place-items:center;width:36px;height:36px;border-radius:11px;background:var(--bg);
  border:1px solid var(--line);color:var(--muted);transition:.25s}
.pf-socials a svg{width:15px;height:15px}
.pf-socials a:hover{color:#fff;background:var(--acc);border-color:var(--acc);transform:translateY(-2px)}

.pf-t-stat{grid-column:span 3;text-align:center;padding:1.4rem 1rem}
.pf-t-stat b{display:block;font-size:2.2rem;font-weight:800;letter-spacing:-.045em;color:var(--acc);
  font-variant-numeric:tabular-nums}
.pf-t-stat span{font-size:.75rem;font-weight:700;color:var(--faint)}
.pf-t-about{grid-column:span 7}
.pf-t-about p{color:var(--muted);white-space:pre-line;font-size:.95rem}
.pf-t-skills{grid-column:span 5}
.pf-pills{display:flex;flex-wrap:wrap;gap:.4rem}
.pf-pill{padding:.34rem .8rem;border-radius:9px;font-size:.82rem;font-weight:600;color:var(--muted);
  background:var(--bg);border:1px solid var(--line);transition:.22s;cursor:default}
.pf-pill:hover{color:#fff;background:var(--acc);border-color:var(--acc);transform:translateY(-2px)}
.pf-t-proj{grid-column:span 4}
.pf-t-proj h3{font-size:1.08rem;font-weight:800;letter-spacing:-.02em;margin-bottom:.15rem}
.pf-t-role{font-size:.79rem;color:var(--acc);font-weight:700;margin-bottom:.6rem}
.pf-t-proj p,.pf-t-role2{color:var(--muted);font-size:.91rem}
.pf-t ul:not(.pf-socials){margin-top:.55rem}
.pf-t ul:not(.pf-socials) li{color:var(--muted);font-size:.88rem;padding-left:1.05rem;position:relative;margin-bottom:.24rem}
.pf-t ul:not(.pf-socials) li::before{content:"";position:absolute;left:0;top:.6em;width:5px;height:5px;border-radius:2px;background:var(--acc)}
.pf-tags{display:flex;flex-wrap:wrap;gap:.3rem;margin-top:.8rem}
.pf-tag{font-size:.7rem;font-weight:700;padding:.16rem .5rem;border-radius:6px;color:var(--acc);
  background:${pfRgba(c.accent, .1)}}
.pf-links{display:flex;gap:.9rem;margin-top:.8rem;font-size:.82rem;font-weight:700}
.pf-links a{color:var(--acc);text-decoration:none;display:inline-flex;align-items:center;gap:.3rem}
.pf-links a svg{width:13px;height:13px}
.pf-t-exp{grid-column:span 6}
.pf-t-row{padding:.85rem 0;border-bottom:1px solid var(--line)}
.pf-t-row:last-child{border-bottom:0;padding-bottom:0}
.pf-t-row h4{font-size:.98rem;font-weight:700;display:flex;flex-wrap:wrap;gap:.2rem .6rem;align-items:baseline}
.pf-t-row h4 em{font-style:normal;color:var(--acc);font-weight:600;font-size:.87rem}
.pf-t-row .pf-when{margin-left:auto;font-size:.78rem;color:var(--faint);white-space:nowrap;font-weight:600}
.pf-t-row p{color:var(--muted);font-size:.88rem;margin-top:.2rem}
.pf-t-cta{grid-column:span 12;background:var(--ink);color:#fff;border-color:transparent;text-align:center;
  padding:clamp(1.8rem,4vw,2.8rem)}
.pf-t-cta h2{font-size:clamp(1.5rem,3.6vw,2.2rem);font-weight:800;letter-spacing:-.035em;margin-bottom:.6rem}
.pf-t-cta p{color:${pfRgba("#ffffff", .72)};max-width:44ch;margin:0 auto 1.4rem}
.pf-t-cta .pf-btn-primary{background:var(--acc);color:${c.accentInk}}
.pf-t-cta .pf-btn-ghost{background:rgba(255,255,255,.08);border-color:rgba(255,255,255,.2);color:#fff}
.pf-clist{display:flex;flex-wrap:wrap;gap:.55rem 1.5rem;justify-content:center;margin-top:1.4rem;font-size:.86rem}
.pf-clist a,.pf-clist span{color:${pfRgba("#ffffff", .72)};text-decoration:none;display:inline-flex;align-items:center;gap:.4rem}
.pf-clist svg{width:15px;height:15px;color:var(--acc)}
.pf-clist a:hover{color:#fff}
footer{padding:2.2rem 0;text-align:center;color:var(--faint);font-size:.83rem}
@media (max-width:1000px){
  .pf-t-hero,.pf-t-about,.pf-t-skills,.pf-t-exp{grid-column:span 12}
  .pf-t-avail{grid-column:span 12}
  .pf-t-proj{grid-column:span 6}
  .pf-t-stat{grid-column:span 6}
}
@media (max-width:640px){.pf-nav-links{display:none}.pf-t-proj,.pf-t-stat{grid-column:span 12}}
@media (prefers-reduced-motion:reduce){.pf-t{transform:none!important}.pf-live i{animation:none}}`;

  const tile = (cls, head, inner, i) =>
    `<div class="pf-t ${cls}" data-tilt data-reveal data-reveal-delay="${Math.min(i || 0, 8) * 55}">
       ${head ? `<div class="pf-t-head">${head}</div>` : ""}${inner}</div>`;

  const body = `
<nav class="pf-nav pf-noprint"><div class="pf-shell pf-nav-in">
  <a class="pf-brand" href="#top"><i>${pfEsc(c.initials)}</i>${pfEsc(c.name)}</a>
  ${nav ? `<div class="pf-nav-links">${nav}</div>` : ""}
</div></nav>

<main id="main"><div class="pf-shell"><div class="pf-bento" id="top">

  <div class="pf-t pf-t-hero" data-tilt>
    ${pfAvatar(c)}
    <h1>${pfEsc(c.name)}</h1>
    ${c.title ? `<h2>${pfEsc(c.title)}</h2>` : ""}
    ${c.tagline ? `<p>${pfEsc(c.tagline)}</p>` : ""}
  </div>

  <div class="pf-t pf-t-avail" data-tilt>
    ${d.available ? `<div class="pf-live"><i></i>${pfEsc(d.available)}</div>` : ""}
    ${d.location ? `<div class="pf-where">${pfEsc(d.location)}</div>` : ""}
    <div class="pf-actions">
      ${d.email ? `<a class="pf-btn pf-btn-primary" href="mailto:${pfEsc(d.email)}">${PF_ICONS.mail}${pfEsc(d.cta_text || "Get in touch")}</a>` : ""}
      ${c.hasResume ? `<a class="pf-btn pf-btn-ghost" ${pfResumeAttrs(c)}>${PF_ICONS.download}${pfEsc(c.resumeLabel)}</a>` : ""}
    </div>
    ${pfSocialRow(c)}
  </div>

  ${c.has("stats") ? d.stats.slice(0, 4).map((x, i) =>
    tile("pf-t-stat", "", `<b>${pfEsc(x.value)}</b><span>${pfEsc(x.label)}</span>`, i)).join("") : ""}

  ${c.has("about") ? `<div class="pf-t pf-t-about" id="about" data-tilt data-reveal>
    <div class="pf-t-head">About</div><p>${pfEsc(d.about)}</p></div>` : ""}

  ${c.has("skills") ? `<div class="pf-t pf-t-skills" id="skills" data-tilt data-reveal data-reveal-delay="60">
    <div class="pf-t-head">Skills</div>
    <div class="pf-pills">${d.skills.map(x => `<span class="pf-pill">${pfEsc(x)}</span>`).join("")}</div></div>` : ""}

  ${c.has("projects") ? `<div class="pf-t pf-t-about" id="projects" style="grid-column:span 12;background:transparent;border:0;padding:.4rem 0 0">
    <div class="pf-t-head">Selected work</div></div>` +
    d.projects.map((x, i) => tile("pf-t-proj", "", `
      <h3>${pfEsc(x.name || "")}</h3>
      ${pfJoin([x.role, x.period]) ? `<div class="pf-t-role">${pfJoin([x.role, x.period])}</div>` : ""}
      ${x.description ? `<p>${pfEsc(x.description)}</p>` : ""}
      ${(x.bullets || []).length ? `<ul>${x.bullets.map(b => `<li>${pfEsc(b)}</li>`).join("")}</ul>` : ""}
      ${(x.tags || []).length ? `<div class="pf-tags">${x.tags.map(t => `<span class="pf-tag">${pfEsc(t)}</span>`).join("")}</div>` : ""}
      ${pfProjectLinks(x) ? `<div class="pf-links">${pfProjectLinks(x)}</div>` : ""}`, i)).join("") : ""}

  ${c.has("experience") ? `<div class="pf-t pf-t-exp" id="experience" data-tilt data-reveal>
    <div class="pf-t-head">Experience</div>
    ${d.experience.map(x => `<div class="pf-t-row">
      <h4>${pfEsc(x.role || "")}${x.org ? `<em>${pfEsc(x.org)}</em>` : ""}
        ${x.period ? `<span class="pf-when">${pfEsc(x.period)}</span>` : ""}</h4>
      ${x.summary ? `<p>${pfEsc(x.summary)}</p>` : ""}
      ${(x.bullets || []).length ? `<ul>${x.bullets.map(b => `<li>${pfEsc(b)}</li>`).join("")}</ul>` : ""}
    </div>`).join("")}</div>` : ""}

  ${c.has("education") || c.has("certifications") ? `<div class="pf-t pf-t-exp" id="education" data-tilt data-reveal data-reveal-delay="60">
    <div class="pf-t-head">${c.has("education") ? "Education" : "Certifications"}</div>
    ${c.has("education") ? d.education.map(x => `<div class="pf-t-row">
      <h4>${pfEsc(x.degree || "")}${x.school ? `<em>${pfEsc(x.school)}</em>` : ""}
        ${x.period ? `<span class="pf-when">${pfEsc(x.period)}</span>` : ""}</h4>
      ${x.detail ? `<p>${pfEsc(x.detail)}</p>` : ""}</div>`).join("") : ""}
    ${c.has("certifications") ? `<div class="pf-t-row" id="certifications"><h4>Certifications</h4>
      <div class="pf-pills" style="margin-top:.5rem">${d.certifications.map(x => `<span class="pf-pill">${pfEsc(x)}</span>`).join("")}</div></div>` : ""}
  </div>` : ""}

  ${c.has("contact") ? `<div class="pf-t pf-t-cta" id="contact" data-reveal>
    <h2>Let's build something</h2>
    <p>${pfEsc(d.cta_text || "Happy to talk about roles, projects or a problem you cannot name yet.")}</p>
    <div class="pf-actions" style="justify-content:center">
      ${d.email ? `<a class="pf-btn pf-btn-primary" href="mailto:${pfEsc(d.email)}">${PF_ICONS.mail}${pfEsc(d.email)}</a>` : ""}
      ${c.hasResume ? `<a class="pf-btn pf-btn-ghost" ${pfResumeAttrs(c)}>${PF_ICONS.download}Résumé</a>` : ""}
    </div>
    <div class="pf-clist">${c.links.map(x => x.url
      ? `<a href="${pfEsc(x.url)}"${/^https?:/i.test(x.url) ? ` target="_blank" rel="noopener"` : ""}>${x.icon}${pfEsc(x.handle)}</a>`
      : `<span>${x.icon}${pfEsc(x.handle)}</span>`).join("")}</div>
  </div>` : ""}

</div>
<footer>© <span data-year>${c.year}</span> ${pfEsc(c.name)}${d.footer_note ? " · " + pfEsc(d.footer_note) : ""}</footer>
</div></main>`;

  const js = `
(function(){
  var links = [].slice.call(document.querySelectorAll('.pf-nav-links a'));
  var secs = links.map(function(a){ return document.querySelector(a.getAttribute('href')); }).filter(Boolean);
  if ('IntersectionObserver' in window && secs.length) {
    var spy = new IntersectionObserver(function(es){
      es.forEach(function(e){ if(!e.isIntersecting) return;
        links.forEach(function(a){ a.classList.toggle('pf-active', a.getAttribute('href') === '#' + e.target.id); }); });
    }, { rootMargin:'-45% 0px -50% 0px' });
    secs.forEach(function(s){ spy.observe(s); });
  }

  /* Tilt.
     Two custom properties per tile, and the transform is declared once in CSS.
     A class swap switches between a near-instant transition while the pointer
     is on the tile (so it tracks) and a long spring when it leaves (so it
     settles) — one transition duration cannot do both. */
  if (matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  var MAX = 6;
  document.querySelectorAll('[data-tilt]').forEach(function(t){
    t.addEventListener('pointermove', function(e){
      var r = t.getBoundingClientRect();
      var x = (e.clientX - r.left) / r.width - 0.5;
      var y = (e.clientY - r.top) / r.height - 0.5;
      t.classList.add('pf-tilting');
      t.style.setProperty('--ry', (x * MAX).toFixed(2) + 'deg');
      t.style.setProperty('--rx', (-y * MAX).toFixed(2) + 'deg');
    });
    t.addEventListener('pointerleave', function(){
      t.classList.remove('pf-tilting');
      t.style.setProperty('--ry', '0deg');
      t.style.setProperty('--rx', '0deg');
    });
  });
})();`;

  return { fonts: [c.googleFont ? null : "Inter:wght@400;600;700;800"].filter(Boolean),
           css, body, js, themeColor: "#F1F5F9" };
};


// ---------------------------------------------------------------------------
// 17. RISOGRAPH — a printed poster that happens to scroll. Two inks, visible
//     halftone, paper grain and a misregistration shadow on every heading.
// ---------------------------------------------------------------------------
PF_RENDERERS.riso = (c) => {
  const d = c.d;
  const ink2 = pfHueShift(c.accent, 195);
  const nav = c.navItems.map(n => `<a href="#${n.id}">${pfEsc(n.label)}</a>`).join("");
  // Stickers are rotated by index, not at random: a fixed sequence looks
  // hand-placed and stays put between renders. Random would jitter on reload.
  const tilt = (i) => [-2.4, 1.8, -1.2, 2.6, -3, 1.1][i % 6];

  const css = `
:root{
  --ink1:${c.accent}; --ink2:${ink2}; --ink:#231F1C; --muted:#5C544D; --faint:#8E837A;
  --paper:#F7F1E4; --card:#FFFDF7; --line:#DED2BC;
  --font:${c.fontStack || `'Fraunces',Georgia,'Times New Roman',serif`};
  --sans:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;
}
body{background:var(--paper);color:var(--ink);font-family:var(--sans);font-size:16px;line-height:1.68}
.pf-skip{background:var(--ink1);color:${c.accentInk}}
.pf-shell{width:min(1080px,91vw);margin:0 auto}

/* Paper. Fibre noise from an SVG turbulence, multiplied over everything, plus
   a halftone dot screen at 4px pitch — the two things that separate a riso
   print from a flat fill. */
.pf-paper{position:fixed;inset:0;z-index:60;pointer-events:none;mix-blend-mode:multiply;opacity:.5;
  background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='p'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.7' numOctaves='4' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='180' height='180' filter='url(%23p)' opacity='.42'/%3E%3C/svg%3E")}
.pf-dots{background-image:radial-gradient(${pfRgba(c.accent, .55)} 1.1px,transparent 1.2px);
  background-size:4px 4px}

.pf-nav{position:sticky;top:0;z-index:20;background:${pfRgba("#F7F1E4", .95)};border-bottom:2px solid var(--ink)}
.pf-nav-in{display:flex;align-items:center;gap:1.1rem;padding:.7rem 0}
.pf-brand{font-family:var(--font);font-weight:900;font-size:1.1rem;letter-spacing:-.02em;text-decoration:none}
.pf-brand span{color:var(--ink1)}
.pf-nav-links{display:flex;gap:1.1rem;margin-left:auto}
.pf-nav-links a{font-size:.76rem;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);
  text-decoration:none;transition:.2s}
.pf-nav-links a:hover,.pf-nav-links a.pf-active{color:var(--ink1)}

/* Misregistration. The second ink is printed a hair off, the way a two-drum
   press actually lands it. */
.pf-mis{position:relative;display:inline-block}
.pf-mis::before{content:attr(data-text);position:absolute;left:3px;top:3px;color:${pfRgba(ink2, .55)};
  z-index:-1;pointer-events:none}

.pf-hero{padding:clamp(2.4rem,6vw,4rem) 0 clamp(1.6rem,4vw,2.4rem)}
.pf-poster{border:3px solid var(--ink);background:var(--card);padding:clamp(1.6rem,4.5vw,3rem);position:relative;
  box-shadow:9px 9px 0 var(--ink)}
.pf-poster::after{content:"";position:absolute;inset:0;pointer-events:none;opacity:.16;
  background-image:radial-gradient(${pfRgba(c.accent, .9)} 1.1px,transparent 1.2px);background-size:5px 5px}
.pf-kick{font-size:.74rem;font-weight:800;letter-spacing:.22em;text-transform:uppercase;color:var(--ink1);margin-bottom:1rem}
.pf-hero h1{font-family:var(--font);font-size:clamp(2.4rem,8vw,5.2rem);font-weight:900;letter-spacing:-.03em;
  line-height:.96;margin-bottom:.6rem;position:relative}
.pf-hero h2{font-family:var(--font);font-size:clamp(1.1rem,2.6vw,1.6rem);font-weight:700;color:var(--ink1);
  font-style:italic;margin-bottom:.9rem}
.pf-hero p{color:var(--muted);max-width:50ch;font-size:1.02rem}
.pf-stickers{display:flex;flex-wrap:wrap;gap:.6rem;margin-top:1.3rem}
.pf-sticker{font-size:.72rem;font-weight:800;letter-spacing:.08em;text-transform:uppercase;padding:.3rem .8rem;
  border:2px solid var(--ink);background:var(--ink1);color:${c.accentInk};transition:.22s}
.pf-sticker.pf-alt{background:var(--card);color:var(--ink)}
.pf-sticker:hover{transform:rotate(0deg) scale(1.06)}
.pf-actions{display:flex;flex-wrap:wrap;gap:.6rem;align-items:center;margin-top:1.6rem}
.pf-btn{display:inline-flex;align-items:center;gap:.5rem;padding:.7rem 1.35rem;font-weight:800;font-size:.82rem;
  letter-spacing:.06em;text-transform:uppercase;text-decoration:none;border:2px solid var(--ink);transition:.18s}
.pf-btn svg{width:15px;height:15px}
.pf-btn-primary{background:var(--ink1);color:${c.accentInk};box-shadow:4px 4px 0 var(--ink)}
.pf-btn-primary:hover{transform:translate(-2px,-2px);box-shadow:6px 6px 0 var(--ink)}
.pf-btn-ghost{background:var(--card);color:var(--ink);box-shadow:4px 4px 0 var(--ink2)}
.pf-btn-ghost:hover{transform:translate(-2px,-2px);box-shadow:6px 6px 0 var(--ink2)}
.pf-socials{display:flex;gap:.4rem}
.pf-socials a{display:grid;place-items:center;width:38px;height:38px;border:2px solid var(--ink);
  background:var(--card);color:var(--ink);transition:.18s}
.pf-socials a svg{width:15px;height:15px}
.pf-socials a:hover{background:var(--ink2);color:var(--card);transform:translate(-2px,-2px);box-shadow:4px 4px 0 var(--ink)}

.pf-sec{padding:clamp(2rem,5vw,3.2rem) 0}
.pf-h2{font-family:var(--font);font-size:clamp(1.7rem,4.5vw,2.8rem);font-weight:900;letter-spacing:-.025em;
  margin-bottom:.25rem;position:relative}
.pf-sub{font-size:.74rem;font-weight:800;letter-spacing:.2em;text-transform:uppercase;color:var(--faint);margin-bottom:1.6rem}
.pf-block{border:3px solid var(--ink);background:var(--card);box-shadow:7px 7px 0 var(--ink);transition:.24s}
.pf-block:hover{transform:translate(-3px,-3px);box-shadow:10px 10px 0 var(--ink1)}
.pf-about{padding:1.8rem;white-space:pre-line;color:var(--muted);font-size:1rem}
.pf-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:0;border:3px solid var(--ink);
  background:var(--ink);box-shadow:7px 7px 0 var(--ink2)}
.pf-stat{padding:1.5rem 1rem;text-align:center;background:var(--card);margin:0 1.5px 0 0}
.pf-stat:last-child{margin-right:0}
.pf-stat b{display:block;font-family:var(--font);font-size:2.4rem;font-weight:900;color:var(--ink1);line-height:1}
.pf-stat span{font-size:.7rem;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:var(--faint)}
.pf-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:1.4rem}
.pf-proj{padding:1.6rem}
.pf-proj h3{font-family:var(--font);font-size:1.32rem;font-weight:900;letter-spacing:-.02em;margin-bottom:.15rem}
.pf-proj .pf-role,.pf-row .pf-org{font-size:.76rem;font-weight:800;letter-spacing:.08em;text-transform:uppercase;
  color:var(--ink1);margin-bottom:.7rem}
.pf-proj p,.pf-row p{color:var(--muted);font-size:.95rem}
.pf-proj ul,.pf-row ul{margin-top:.6rem}
.pf-proj li,.pf-row li{color:var(--muted);font-size:.91rem;padding-left:1.3rem;position:relative;margin-bottom:.26rem}
.pf-proj li::before,.pf-row li::before{content:"▪";position:absolute;left:0;color:var(--ink2);font-size:1rem;line-height:1}
.pf-tags{display:flex;flex-wrap:wrap;gap:.35rem;margin-top:.9rem}
.pf-tag{font-size:.68rem;font-weight:800;letter-spacing:.06em;text-transform:uppercase;padding:.16rem .5rem;
  border:1.5px solid var(--ink2);color:var(--ink2)}
.pf-links{display:flex;gap:1rem;margin-top:.9rem;font-size:.76rem;font-weight:800;letter-spacing:.08em;text-transform:uppercase}
.pf-links a{color:var(--ink1);text-decoration:none;display:inline-flex;align-items:center;gap:.3rem}
.pf-links a svg{width:13px;height:13px}
.pf-rows{display:grid;gap:1.2rem}
.pf-row{padding:1.4rem 1.6rem}
.pf-row-top{display:flex;flex-wrap:wrap;gap:.25rem 1rem;align-items:baseline}
.pf-row h3{font-family:var(--font);font-size:1.2rem;font-weight:900}
.pf-row .pf-when{margin-left:auto;font-size:.76rem;font-weight:800;letter-spacing:.08em;text-transform:uppercase;
  color:var(--faint);white-space:nowrap}
.pf-contact{padding:clamp(2rem,5vw,3.2rem);text-align:center;background:var(--ink1);color:${c.accentInk};
  border:3px solid var(--ink);box-shadow:9px 9px 0 var(--ink)}
.pf-contact h2{font-family:var(--font);font-size:clamp(1.9rem,6vw,3.4rem);font-weight:900;letter-spacing:-.03em;
  margin-bottom:.7rem;line-height:1}
.pf-contact p{max-width:44ch;margin:0 auto 1.5rem;opacity:.9}
.pf-contact .pf-btn-primary{background:var(--card);color:var(--ink)}
.pf-contact .pf-btn-ghost{background:transparent;color:${c.accentInk};box-shadow:4px 4px 0 var(--ink)}
.pf-clist{display:flex;flex-wrap:wrap;gap:.55rem 1.5rem;justify-content:center;margin-top:1.5rem;font-size:.82rem;
  font-weight:700}
.pf-clist a,.pf-clist span{color:${c.accentInk};opacity:.9;text-decoration:none;display:inline-flex;align-items:center;gap:.4rem}
.pf-clist svg{width:15px;height:15px}
.pf-clist a:hover{opacity:1}
footer{padding:2.4rem 0;text-align:center;font-size:.72rem;font-weight:800;letter-spacing:.16em;
  text-transform:uppercase;color:var(--faint)}
@media (max-width:760px){.pf-nav-links{display:none}.pf-row .pf-when{margin-left:0;width:100%}
  .pf-poster,.pf-block,.pf-stats,.pf-contact{box-shadow:5px 5px 0 var(--ink)}}
@media (prefers-reduced-motion:reduce){.pf-sticker{transform:none!important}}`;

  const body = `
<div class="pf-paper" aria-hidden="true"></div>
<nav class="pf-nav pf-noprint"><div class="pf-shell pf-nav-in">
  <a class="pf-brand" href="#top">${pfEsc(c.name)}<span>.</span></a>
  ${nav ? `<div class="pf-nav-links">${nav}</div>` : ""}
</div></nav>

<main id="main"><div class="pf-shell">
  <section class="pf-hero" id="top"><div class="pf-poster">
    <div class="pf-kick">Portfolio · Edition ${c.year}</div>
    <h1><span class="pf-mis" data-text="${pfEsc(c.name)}">${pfEsc(c.name)}</span></h1>
    ${c.title ? `<h2>${pfEsc(c.title)}</h2>` : ""}
    ${c.tagline ? `<p>${pfEsc(c.tagline)}</p>` : ""}
    <div class="pf-stickers">
      ${d.location ? `<span class="pf-sticker pf-alt" style="transform:rotate(${tilt(0)}deg)">${pfEsc(d.location)}</span>` : ""}
      ${d.available ? `<span class="pf-sticker" style="transform:rotate(${tilt(1)}deg)">${pfEsc(d.available)}</span>` : ""}
      ${d.skills.slice(0, 3).map((x, i) => `<span class="pf-sticker pf-alt" style="transform:rotate(${tilt(i + 2)}deg)">${pfEsc(x)}</span>`).join("")}
    </div>
    <div class="pf-actions">
      ${d.email ? `<a class="pf-btn pf-btn-primary" href="mailto:${pfEsc(d.email)}">${PF_ICONS.mail}${pfEsc(d.cta_text || "Get in touch")}</a>` : ""}
      ${c.hasResume ? `<a class="pf-btn pf-btn-ghost" ${pfResumeAttrs(c)}>${PF_ICONS.download}${pfEsc(c.resumeLabel)}</a>` : ""}
      ${pfSocialRow(c)}
    </div>
  </div></section>

  ${c.has("stats") ? `<section class="pf-sec"><div class="pf-stats" data-reveal>
    ${d.stats.map(x => `<div class="pf-stat"><b>${pfEsc(x.value)}</b><span>${pfEsc(x.label)}</span></div>`).join("")}
  </div></section>` : ""}

  ${c.has("about") ? `<section class="pf-sec" id="about">
    <h2 class="pf-h2"><span class="pf-mis" data-text="About">About</span></h2><p class="pf-sub">Colophon</p>
    <div class="pf-block pf-about" data-reveal>${pfEsc(d.about)}</div></section>` : ""}

  ${c.has("skills") ? `<section class="pf-sec" id="skills">
    <h2 class="pf-h2"><span class="pf-mis" data-text="Skills">Skills</span></h2><p class="pf-sub">Set in</p>
    <div class="pf-stickers" data-reveal>${d.skills.map((x, i) =>
      `<span class="pf-sticker ${i % 2 ? "pf-alt" : ""}" style="transform:rotate(${tilt(i)}deg)">${pfEsc(x)}</span>`).join("")}</div></section>` : ""}

  ${c.has("projects") ? `<section class="pf-sec" id="projects">
    <h2 class="pf-h2"><span class="pf-mis" data-text="Work">Work</span></h2><p class="pf-sub">Selected plates</p>
    <div class="pf-grid">${d.projects.map((x, i) => `
      <article class="pf-block pf-proj" data-reveal data-reveal-delay="${Math.min(i, 5) * 80}">
        <h3>${pfEsc(x.name || "")}</h3>
        ${pfJoin([x.role, x.period]) ? `<div class="pf-role">${pfJoin([x.role, x.period])}</div>` : ""}
        ${x.description ? `<p>${pfEsc(x.description)}</p>` : ""}
        ${(x.bullets || []).length ? `<ul>${x.bullets.map(b => `<li>${pfEsc(b)}</li>`).join("")}</ul>` : ""}
        ${(x.tags || []).length ? `<div class="pf-tags">${x.tags.map(t => `<span class="pf-tag">${pfEsc(t)}</span>`).join("")}</div>` : ""}
        ${pfProjectLinks(x) ? `<div class="pf-links">${pfProjectLinks(x)}</div>` : ""}
      </article>`).join("")}</div></section>` : ""}

  ${c.has("experience") ? `<section class="pf-sec" id="experience">
    <h2 class="pf-h2"><span class="pf-mis" data-text="Experience">Experience</span></h2><p class="pf-sub">Print run</p>
    <div class="pf-rows">${d.experience.map((x, i) => `
      <article class="pf-block pf-row" data-reveal data-reveal-delay="${Math.min(i, 5) * 70}">
        <div class="pf-row-top"><h3>${pfEsc(x.role || "")}</h3>
          ${x.period ? `<span class="pf-when">${pfEsc(x.period)}</span>` : ""}</div>
        ${x.org ? `<div class="pf-org">${pfJoin([x.org, x.location])}</div>` : ""}
        ${x.summary ? `<p>${pfEsc(x.summary)}</p>` : ""}
        ${(x.bullets || []).length ? `<ul>${x.bullets.map(b => `<li>${pfEsc(b)}</li>`).join("")}</ul>` : ""}
      </article>`).join("")}</div></section>` : ""}

  ${c.has("education") ? `<section class="pf-sec" id="education">
    <h2 class="pf-h2"><span class="pf-mis" data-text="Education">Education</span></h2><p class="pf-sub">Apprenticeship</p>
    <div class="pf-rows">${d.education.map(x => `
      <article class="pf-block pf-row" data-reveal>
        <div class="pf-row-top"><h3>${pfEsc(x.degree || "")}</h3>
          ${x.period ? `<span class="pf-when">${pfEsc(x.period)}</span>` : ""}</div>
        ${x.school ? `<div class="pf-org">${pfEsc(x.school)}</div>` : ""}
        ${x.detail ? `<p>${pfEsc(x.detail)}</p>` : ""}
      </article>`).join("")}</div></section>` : ""}

  ${c.has("certifications") ? `<section class="pf-sec" id="certifications">
    <h2 class="pf-h2"><span class="pf-mis" data-text="Certified">Certified</span></h2><p class="pf-sub">Stamped</p>
    <div class="pf-stickers" data-reveal>${d.certifications.map((x, i) =>
      `<span class="pf-sticker ${i % 2 ? "" : "pf-alt"}" style="transform:rotate(${tilt(i + 3)}deg)">${pfEsc(x)}</span>`).join("")}</div></section>` : ""}

  ${c.has("contact") ? `<section class="pf-sec" id="contact"><div class="pf-contact" data-reveal>
    <h2>Get in touch</h2>
    <p>${pfEsc(d.cta_text || "Commissions, collaborations and questions about ink.")}</p>
    <div class="pf-actions" style="justify-content:center;margin-top:0">
      ${d.email ? `<a class="pf-btn pf-btn-primary" href="mailto:${pfEsc(d.email)}">${PF_ICONS.mail}${pfEsc(d.email)}</a>` : ""}
      ${c.hasResume ? `<a class="pf-btn pf-btn-ghost" ${pfResumeAttrs(c)}>${PF_ICONS.download}Résumé</a>` : ""}
    </div>
    <div class="pf-clist">${c.links.map(x => x.url
      ? `<a href="${pfEsc(x.url)}"${/^https?:/i.test(x.url) ? ` target="_blank" rel="noopener"` : ""}>${x.icon}${pfEsc(x.handle)}</a>`
      : `<span>${x.icon}${pfEsc(x.handle)}</span>`).join("")}</div>
  </div></section>` : ""}

  <footer>Printed ${c.year} · ${pfEsc(c.name)}${d.footer_note ? " · " + pfEsc(d.footer_note) : ""}</footer>
</div></main>`;

  const js = `
(function(){
  var links = [].slice.call(document.querySelectorAll('.pf-nav-links a'));
  var secs = links.map(function(a){ return document.querySelector(a.getAttribute('href')); }).filter(Boolean);
  if ('IntersectionObserver' in window && secs.length) {
    var spy = new IntersectionObserver(function(es){
      es.forEach(function(e){ if(!e.isIntersecting) return;
        links.forEach(function(a){ a.classList.toggle('pf-active', a.getAttribute('href') === '#' + e.target.id); }); });
    }, { rootMargin:'-45% 0px -50% 0px' });
    secs.forEach(function(s){ spy.observe(s); });
  }
})();`;

  return { fonts: [c.googleFont ? null : "Fraunces:opsz,wght@9..144,700;9..144,900", "Inter:wght@400;600;800"].filter(Boolean),
           css, body, js, themeColor: "#F7F1E4" };
};


// ---------------------------------------------------------------------------
// 18. ORBIT — your skills literally circle you. Three dashed rings turning at
//     different rates, chips riding them, and the text staying upright the
//     whole way round.
// ---------------------------------------------------------------------------
PF_RENDERERS.orbit = (c) => {
  const d = c.d;
  const a2 = pfHueShift(c.accent, -46);
  const nav = c.navItems.map(n => `<a href="#${n.id}">${pfEsc(n.label)}</a>`).join("");

  // Three rings, filled outside-in so the shortest list still looks deliberate.
  // The innermost radius has to clear the core, which is an avatar plus three
  // lines of text — roughly 205px from centre to corner. A 258px ring (129px
  // radius) put skill chips straight through the person's name.
  const RINGS = [
    { size: 740, dur: 58, dir: "normal" },
    { size: 620, dur: 44, dir: "reverse" },
    { size: 520, dur: 32, dir: "normal" },
  ];
  const buckets = [[], [], []];
  d.skills.slice(0, 14).forEach((sk, i) => buckets[i % 3].push(sk));

  const rings = RINGS.map((r, ri) => {
    const items = buckets[ri];
    if (!items.length) return "";
    return `<div class="pf-ring" style="--size:${r.size}px;--dur:${r.dur}s;--dir:${r.dir}">
      ${items.map((sk, i) => {
        const a = Math.round((360 / items.length) * i);
        return `<span class="pf-orb" style="--a:${a}deg"><b>${pfEsc(sk)}</b></span>`;
      }).join("")}
    </div>`;
  }).join("");

  const css = `
:root{
  --acc:${c.accent}; --acc2:${a2}; --ink:#F4EFE6; --muted:#A79C8C; --faint:#6E6557;
  --bg:#0D0B14; --panel:rgba(28,24,40,.72); --line:rgba(255,255,255,.1);
  --font:${c.fontStack || `'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif`};
}
body{background:var(--bg);color:var(--ink);font-family:var(--font);font-size:16px;line-height:1.68;overflow-x:hidden}
.pf-skip{background:var(--acc);color:${c.accentInk}}
.pf-shell{width:min(1080px,92vw);margin:0 auto}
.pf-glow{position:fixed;inset:0;z-index:0;pointer-events:none;
  background:radial-gradient(48% 40% at 50% 26%,${pfRgba(c.accent, .16)},transparent 70%),
             radial-gradient(40% 34% at 78% 72%,${pfRgba(a2, .1)},transparent 72%)}
main{position:relative;z-index:3}
.pf-nav{position:sticky;top:0;z-index:20;background:${pfRgba("#0D0B14", .95)};
  backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);border-bottom:1px solid transparent;transition:.25s}
.pf-nav.pf-stuck{border-bottom-color:var(--line)}
.pf-nav-in{display:flex;align-items:center;gap:1.2rem;padding:.8rem 0}
.pf-brand{font-weight:800;letter-spacing:-.02em;text-decoration:none;display:flex;align-items:center;gap:.55rem}
.pf-brand i{width:28px;height:28px;border-radius:50%;display:grid;place-items:center;font-size:.66rem;font-weight:800;
  font-style:normal;color:${c.accentInk};background:var(--acc)}
.pf-nav-links{display:flex;gap:.2rem;margin-left:auto}
.pf-nav-links a{padding:.4rem .85rem;border-radius:999px;font-size:.85rem;color:var(--muted);text-decoration:none;transition:.2s}
.pf-nav-links a:hover,.pf-nav-links a.pf-active{color:var(--acc);background:${pfRgba(c.accent, .12)}}

/* The orrery.
   Ring turns. Orb is placed at its angle and immediately un-rotated, so its own
   axes stay level. The label then runs the ring's animation in reverse, which
   cancels the ring's turn and keeps the word the right way up all the way
   round — the alternative is skill names standing on their heads at the top. */
.pf-orrery{position:relative;height:min(780px,96vw);display:grid;place-items:center;margin-bottom:.5rem}
.pf-ring{position:absolute;left:50%;top:50%;width:var(--size);height:var(--size);
  margin:calc(var(--size) / -2) 0 0 calc(var(--size) / -2);
  border:1px dashed ${pfRgba(c.accent, .22)};border-radius:50%;
  animation:pf-orbit var(--dur) linear infinite;animation-direction:var(--dir)}
@keyframes pf-orbit{to{transform:rotate(360deg)}}
.pf-orb{position:absolute;left:50%;top:50%;width:0;height:0;display:grid;place-items:center;
  transform:rotate(var(--a)) translateX(calc(var(--size) / 2)) rotate(calc(var(--a) * -1))}
.pf-orb b{transform-origin:center;white-space:nowrap;
  animation:pf-orbit var(--dur) linear infinite;animation-direction:reverse;
  padding:.3rem .8rem;border-radius:999px;font-size:.78rem;font-weight:600;
  background:var(--panel);border:1px solid var(--line);color:var(--muted);
  backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px)}
.pf-ring:nth-child(2) .pf-orb b{animation-direction:normal}
.pf-orrery:hover .pf-ring,.pf-orrery:hover .pf-orb b{animation-play-state:paused}
.pf-core{position:relative;z-index:2;text-align:center;max-width:min(280px,56vw)}
.pf-avatar{width:118px;height:118px;border-radius:50%;object-fit:cover;margin:0 auto .9rem;
  border:2px solid ${pfRgba(c.accent, .5)};box-shadow:0 0 60px ${pfRgba(c.accent, .35)}}
.pf-avatar-initials{display:grid;place-items:center;font-size:2.5rem;font-weight:800;
  background:radial-gradient(circle at 32% 28%,${pfShade(c.accent, 0.30)},var(--acc));color:${c.accentInk}}
.pf-core h1{font-size:clamp(1.7rem,4.4vw,2.6rem);font-weight:800;letter-spacing:-.035em;line-height:1.08}
.pf-core h2{font-size:.92rem;font-weight:700;color:var(--acc);margin-top:.4rem;letter-spacing:.1em;text-transform:uppercase}
.pf-avail{display:inline-flex;align-items:center;gap:.45rem;margin-top:.7rem;font-size:.78rem;font-weight:600;
  color:var(--muted);padding:.28rem .8rem;border-radius:999px;background:var(--panel);border:1px solid var(--line)}
.pf-avail i{width:6px;height:6px;border-radius:50%;background:var(--acc)}
.pf-lede{text-align:center;color:var(--muted);max-width:54ch;margin:0 auto}
.pf-actions{display:flex;flex-wrap:wrap;gap:.65rem;justify-content:center;align-items:center;margin-top:1.5rem}
.pf-btn{display:inline-flex;align-items:center;gap:.5rem;padding:.78rem 1.5rem;border-radius:999px;font-weight:700;
  font-size:.9rem;text-decoration:none;border:1px solid var(--line);transition:.25s}
.pf-btn svg{width:16px;height:16px}
.pf-btn-primary{background:var(--acc);color:${c.accentInk};border-color:transparent;
  box-shadow:0 12px 32px ${pfRgba(c.accent, .32)}}
.pf-btn-primary:hover{transform:translateY(-3px);box-shadow:0 18px 42px ${pfRgba(c.accent, .45)}}
.pf-btn-ghost{background:var(--panel);color:var(--ink)}
.pf-btn-ghost:hover{border-color:var(--acc);color:var(--acc);transform:translateY(-3px)}
.pf-socials{display:flex;gap:.45rem}
.pf-socials a{display:grid;place-items:center;width:40px;height:40px;border-radius:50%;background:var(--panel);
  border:1px solid var(--line);color:var(--muted);transition:.25s}
.pf-socials a svg{width:16px;height:16px}
.pf-socials a:hover{color:var(--acc);border-color:var(--acc);transform:translateY(-3px)}

.pf-sec{padding:clamp(2.2rem,5.5vw,3.6rem) 0}
.pf-h2{font-size:clamp(1.5rem,3.6vw,2.2rem);font-weight:800;letter-spacing:-.035em;text-align:center;margin-bottom:.3rem}
.pf-sub{text-align:center;color:var(--faint);font-size:.86rem;letter-spacing:.1em;text-transform:uppercase;
  font-weight:700;margin-bottom:1.9rem}
.pf-card{background:var(--panel);border:1px solid var(--line);border-radius:20px;transition:.3s;
  backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px)}
.pf-card:hover{border-color:${pfRgba(c.accent, .5)};transform:translateY(-4px);box-shadow:0 20px 44px rgba(0,0,0,.45)}
.pf-about{padding:1.9rem;white-space:pre-line;color:var(--muted);max-width:68ch;margin:0 auto}
.pf-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:1rem}
.pf-stat{padding:1.5rem 1rem;text-align:center}
.pf-stat b{display:block;font-size:2.2rem;font-weight:800;color:var(--acc);letter-spacing:-.04em}
.pf-stat span{font-size:.74rem;color:var(--faint);font-weight:700;letter-spacing:.08em;text-transform:uppercase}
.pf-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(290px,1fr));gap:1rem}
.pf-proj{padding:1.6rem}
.pf-proj h3{font-size:1.14rem;font-weight:800;letter-spacing:-.02em;margin-bottom:.15rem}
.pf-proj .pf-role,.pf-row .pf-org{font-size:.8rem;color:var(--acc);font-weight:700;margin-bottom:.6rem}
.pf-proj p,.pf-row p{color:var(--muted);font-size:.93rem}
.pf-proj ul,.pf-row ul{margin-top:.55rem}
.pf-proj li,.pf-row li{color:var(--muted);font-size:.89rem;padding-left:1.1rem;position:relative;margin-bottom:.24rem}
.pf-proj li::before,.pf-row li::before{content:"";position:absolute;left:0;top:.6em;width:6px;height:6px;
  border-radius:50%;border:1.5px solid var(--acc)}
.pf-tags{display:flex;flex-wrap:wrap;gap:.32rem;margin-top:.85rem}
.pf-tag{font-size:.7rem;font-weight:700;padding:.16rem .55rem;border-radius:999px;color:var(--acc);
  background:${pfRgba(c.accent, .12)}}
.pf-links{display:flex;gap:1rem;margin-top:.85rem;font-size:.83rem;font-weight:700}
.pf-links a{color:var(--acc);text-decoration:none;display:inline-flex;align-items:center;gap:.3rem}
.pf-links a svg{width:14px;height:14px}
.pf-rows{display:grid;gap:.85rem}
.pf-row{padding:1.45rem 1.6rem}
.pf-row-top{display:flex;flex-wrap:wrap;gap:.25rem 1rem;align-items:baseline}
.pf-row h3{font-size:1.06rem;font-weight:800}
.pf-row .pf-when{margin-left:auto;color:var(--faint);font-size:.81rem;white-space:nowrap;font-weight:600}
.pf-contact{padding:clamp(2.2rem,5vw,3.4rem);text-align:center;border-radius:26px}
.pf-contact h2{font-size:clamp(1.7rem,4.5vw,2.6rem);font-weight:800;letter-spacing:-.04em;margin-bottom:.7rem}
.pf-contact p{color:var(--muted);max-width:46ch;margin:0 auto 1.6rem}
.pf-clist{display:flex;flex-wrap:wrap;gap:.6rem 1.6rem;justify-content:center;margin-top:1.5rem;font-size:.88rem}
.pf-clist a,.pf-clist span{color:var(--muted);text-decoration:none;display:inline-flex;align-items:center;gap:.42rem}
.pf-clist svg{width:16px;height:16px;color:var(--acc)}
.pf-clist a:hover{color:var(--acc)}
footer{padding:2.6rem 0;text-align:center;color:var(--faint);font-size:.83rem}
@media (max-width:900px){.pf-nav-links{display:none}
  /* Below this the rings overlap the text more than they orbit it. */
  .pf-orrery{height:auto;padding:1.5rem 0}
  .pf-ring{display:none}}
@media (max-width:760px){.pf-row .pf-when{margin-left:0;width:100%}}
@media (prefers-reduced-motion:reduce){.pf-ring,.pf-orb b{animation:none}}`;

  const body = `
<div class="pf-glow" aria-hidden="true"></div>
<nav class="pf-nav pf-noprint"><div class="pf-shell pf-nav-in">
  <a class="pf-brand" href="#top"><i>${pfEsc(c.initials)}</i>${pfEsc(c.name)}</a>
  ${nav ? `<div class="pf-nav-links">${nav}</div>` : ""}
</div></nav>

<main id="main"><div class="pf-shell">
  <section id="top">
    <!-- The orrery IS this template's skills section — the rings are the
         skill list. So it only carries the #skills anchor when there are
         skills to anchor to; otherwise a nav or a link pointing at #skills
         would scroll to a hero that shows none. -->
    <div class="pf-orrery"${c.has("skills") ? ` id="skills"` : ""}>
      ${rings}
      <div class="pf-core">
        ${pfAvatar(c)}
        <h1>${pfEsc(c.name)}</h1>
        ${c.title ? `<h2>${pfEsc(c.title)}</h2>` : ""}
        ${d.available ? `<div class="pf-avail"><i></i>${pfEsc(d.available)}</div>` : ""}
      </div>
    </div>
    ${c.tagline ? `<p class="pf-lede">${pfEsc(c.tagline)}</p>` : ""}
    <div class="pf-actions">
      ${d.email ? `<a class="pf-btn pf-btn-primary" href="mailto:${pfEsc(d.email)}">${PF_ICONS.mail}${pfEsc(d.cta_text || "Get in touch")}</a>` : ""}
      ${c.hasResume ? `<a class="pf-btn pf-btn-ghost" ${pfResumeAttrs(c)}>${PF_ICONS.download}${pfEsc(c.resumeLabel)}</a>` : ""}
      ${pfSocialRow(c)}
    </div>
  </section>

  ${c.has("stats") ? `<section class="pf-sec"><div class="pf-stats">
    ${d.stats.map((x, i) => `<div class="pf-card pf-stat" data-reveal data-reveal-delay="${i * 70}">
      <b>${pfEsc(x.value)}</b><span>${pfEsc(x.label)}</span></div>`).join("")}</div></section>` : ""}

  ${c.has("about") ? `<section class="pf-sec" id="about"><h2 class="pf-h2">About</h2>
    <p class="pf-sub">Centre of mass</p>
    <div class="pf-card pf-about" data-reveal>${pfEsc(d.about)}</div></section>` : ""}

  ${c.has("projects") ? `<section class="pf-sec" id="projects"><h2 class="pf-h2">Work</h2>
    <p class="pf-sub">Selected projects</p>
    <div class="pf-grid">${d.projects.map((x, i) => `
      <article class="pf-card pf-proj" data-reveal data-reveal-delay="${Math.min(i, 5) * 80}">
        <h3>${pfEsc(x.name || "")}</h3>
        ${pfJoin([x.role, x.period]) ? `<div class="pf-role">${pfJoin([x.role, x.period])}</div>` : ""}
        ${x.description ? `<p>${pfEsc(x.description)}</p>` : ""}
        ${(x.bullets || []).length ? `<ul>${x.bullets.map(b => `<li>${pfEsc(b)}</li>`).join("")}</ul>` : ""}
        ${(x.tags || []).length ? `<div class="pf-tags">${x.tags.map(t => `<span class="pf-tag">${pfEsc(t)}</span>`).join("")}</div>` : ""}
        ${pfProjectLinks(x) ? `<div class="pf-links">${pfProjectLinks(x)}</div>` : ""}
      </article>`).join("")}</div></section>` : ""}

  ${c.has("experience") ? `<section class="pf-sec" id="experience"><h2 class="pf-h2">Experience</h2>
    <p class="pf-sub">Trajectory</p>
    <div class="pf-rows">${d.experience.map((x, i) => `
      <article class="pf-card pf-row" data-reveal data-reveal-delay="${Math.min(i, 5) * 70}">
        <div class="pf-row-top"><h3>${pfEsc(x.role || "")}</h3>
          ${x.period ? `<span class="pf-when">${pfEsc(x.period)}</span>` : ""}</div>
        ${x.org ? `<div class="pf-org">${pfJoin([x.org, x.location])}</div>` : ""}
        ${x.summary ? `<p>${pfEsc(x.summary)}</p>` : ""}
        ${(x.bullets || []).length ? `<ul>${x.bullets.map(b => `<li>${pfEsc(b)}</li>`).join("")}</ul>` : ""}
      </article>`).join("")}</div></section>` : ""}

  ${c.has("education") ? `<section class="pf-sec" id="education"><h2 class="pf-h2">Education</h2>
    <p class="pf-sub">Launch site</p>
    <div class="pf-rows">${d.education.map(x => `
      <article class="pf-card pf-row" data-reveal>
        <div class="pf-row-top"><h3>${pfEsc(x.degree || "")}</h3>
          ${x.period ? `<span class="pf-when">${pfEsc(x.period)}</span>` : ""}</div>
        ${x.school ? `<div class="pf-org">${pfEsc(x.school)}</div>` : ""}
        ${x.detail ? `<p>${pfEsc(x.detail)}</p>` : ""}
      </article>`).join("")}</div></section>` : ""}

  ${c.has("certifications") ? `<section class="pf-sec" id="certifications"><h2 class="pf-h2">Certifications</h2>
    <p class="pf-sub">Verified</p>
    <div class="pf-tags" style="justify-content:center" data-reveal>
      ${d.certifications.map(x => `<span class="pf-tag" style="font-size:.82rem;padding:.35rem .9rem">${pfEsc(x)}</span>`).join("")}</div></section>` : ""}

  ${c.has("contact") ? `<section class="pf-sec" id="contact"><div class="pf-card pf-contact" data-reveal>
    <h2>Come into orbit</h2>
    <p>${pfEsc(d.cta_text || "Roles, collaborations, or a question you have been circling for a while.")}</p>
    <div class="pf-actions" style="margin-top:0">
      ${d.email ? `<a class="pf-btn pf-btn-primary" href="mailto:${pfEsc(d.email)}">${PF_ICONS.mail}${pfEsc(d.email)}</a>` : ""}
      ${c.hasResume ? `<a class="pf-btn pf-btn-ghost" ${pfResumeAttrs(c)}>${PF_ICONS.download}Résumé</a>` : ""}
    </div>
    <div class="pf-clist">${c.links.map(x => x.url
      ? `<a href="${pfEsc(x.url)}"${/^https?:/i.test(x.url) ? ` target="_blank" rel="noopener"` : ""}>${x.icon}${pfEsc(x.handle)}</a>`
      : `<span>${x.icon}${pfEsc(x.handle)}</span>`).join("")}</div>
  </div></section>` : ""}

  <footer>© <span data-year>${c.year}</span> ${pfEsc(c.name)}${d.footer_note ? " · " + pfEsc(d.footer_note) : ""}</footer>
</div></main>`;

  const js = `
(function(){
  var nav = document.querySelector('.pf-nav');
  var onScroll = function(){ nav.classList.toggle('pf-stuck', window.scrollY > 10); };
  onScroll(); addEventListener('scroll', onScroll, { passive:true });
  var links = [].slice.call(document.querySelectorAll('.pf-nav-links a'));
  var secs = links.map(function(a){ return document.querySelector(a.getAttribute('href')); }).filter(Boolean);
  if ('IntersectionObserver' in window && secs.length) {
    var spy = new IntersectionObserver(function(es){
      es.forEach(function(e){ if(!e.isIntersecting) return;
        links.forEach(function(a){ a.classList.toggle('pf-active', a.getAttribute('href') === '#' + e.target.id); }); });
    }, { rootMargin:'-45% 0px -50% 0px' });
    secs.forEach(function(s){ spy.observe(s); });
  }
})();`;

  return { fonts: [c.googleFont ? null : "Inter:wght@400;600;700;800"].filter(Boolean),
           css, body, js, themeColor: "#0D0B14" };
};


// ---------------------------------------------------------------------------
// 19. STRATA — five parallax layers at dusk. Sky, sun, and three ridges, each
//     drifting at its own rate as you scroll into the valley.
// ---------------------------------------------------------------------------
PF_RENDERERS.strata = (c) => {
  const d = c.d;
  const a2 = pfHueShift(c.accent, 90);
  const nav = c.navItems.map(n => `<a href="#${n.id}">${pfEsc(n.label)}</a>`).join("");
  // Far ridges are lighter and move least; near ridges are darker and move
  // most. That relationship IS the depth cue — get it backwards and the
  // landscape turns inside out.
  const ridge = (pathD, fill, speed, z) =>
    `<svg class="pf-layer" style="--sp:${speed};z-index:${z}" viewBox="0 0 1440 420" preserveAspectRatio="none" aria-hidden="true">
       <path d="${pathD}" fill="${fill}"/></svg>`;

  const css = `
:root{
  --acc:${c.accent}; --acc2:${a2}; --ink:#EAF1FF; --muted:#9FB0CC; --faint:#6B7C99;
  --bg:#0F172A; --panel:rgba(23,35,60,.78); --line:rgba(140,170,220,.16);
  --font:${c.fontStack || `'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif`};
}
body{background:var(--bg);color:var(--ink);font-family:var(--font);font-size:16px;line-height:1.68;overflow-x:hidden}
.pf-skip{background:var(--acc);color:${c.accentInk}}
.pf-shell{width:min(1080px,92vw);margin:0 auto}

.pf-scene{position:relative;height:min(88vh,720px);min-height:460px;overflow:hidden;
  background:linear-gradient(180deg,#0B1224 0%,${pfShade(c.accent, -0.62)} 46%,${pfShade(a2, -0.46)} 76%,#131C31 100%)}
.pf-sun{position:absolute;left:50%;top:44%;width:min(300px,52vw);aspect-ratio:1;transform:translate(-50%,-50%);
  border-radius:50%;background:radial-gradient(circle,${pfRgba(a2, .95)} 0%,${pfRgba(c.accent, .55)} 45%,transparent 70%);
  filter:blur(2px);z-index:1;will-change:transform}
.pf-layer{position:absolute;left:0;bottom:0;width:100%;height:62%;display:block;will-change:transform}
.pf-haze{position:absolute;left:0;right:0;bottom:0;height:46%;z-index:5;pointer-events:none;
  background:linear-gradient(180deg,transparent,${pfRgba(pfShade(c.accent, -0.6), .55)} 62%,#131C31 100%)}
.pf-scene-copy{position:absolute;inset:0;z-index:9;display:grid;place-items:center;text-align:center;padding:0 5vw}
.pf-scene-copy>div{max-width:44ch}
.pf-badge{display:inline-flex;align-items:center;gap:.5rem;padding:.35rem 1rem;border-radius:999px;
  background:rgba(10,16,30,.5);border:1px solid var(--line);font-size:.78rem;font-weight:600;
  color:var(--ink);margin-bottom:1.1rem;backdrop-filter:blur(6px)}
.pf-badge i{width:6px;height:6px;border-radius:50%;background:var(--acc)}
.pf-scene-copy h1{font-size:clamp(2.4rem,7vw,4.6rem);font-weight:800;letter-spacing:-.045em;line-height:1.02;
  text-shadow:0 4px 40px rgba(0,0,0,.5)}
.pf-scene-copy h2{font-size:clamp(.95rem,2.2vw,1.2rem);font-weight:700;letter-spacing:.16em;text-transform:uppercase;
  color:${pfRgba("#EAF1FF", .82)};margin:.8rem 0 .7rem}
.pf-scene-copy p{color:${pfRgba("#EAF1FF", .74)};text-shadow:0 2px 18px rgba(0,0,0,.5)}
.pf-scroll{position:absolute;left:50%;bottom:1.4rem;z-index:10;transform:translateX(-50%);
  width:22px;height:34px;border:2px solid ${pfRgba("#EAF1FF", .4)};border-radius:12px}
.pf-scroll::after{content:"";position:absolute;left:50%;top:6px;width:3px;height:7px;border-radius:2px;
  background:${pfRgba("#EAF1FF", .7)};transform:translateX(-50%);animation:pf-scroll 1.9s ease-in-out infinite}
@keyframes pf-scroll{0%,100%{opacity:0;transform:translate(-50%,0)}40%{opacity:1}70%{opacity:0;transform:translate(-50%,11px)}}

main{position:relative;z-index:3;background:var(--bg)}
.pf-nav{position:sticky;top:0;z-index:20;background:${pfRgba("#0F172A", .94)};
  backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);border-bottom:1px solid transparent;transition:.25s}
.pf-nav.pf-stuck{border-bottom-color:var(--line)}
.pf-nav-in{display:flex;align-items:center;gap:1.2rem;padding:.8rem 0}
.pf-brand{font-weight:800;letter-spacing:-.02em;text-decoration:none;display:flex;align-items:center;gap:.55rem}
.pf-brand i{width:28px;height:28px;border-radius:9px;display:grid;place-items:center;font-size:.66rem;font-weight:800;
  font-style:normal;color:${c.accentInk};background:linear-gradient(140deg,var(--acc),var(--acc2))}
.pf-nav-links{display:flex;gap:.2rem;margin-left:auto}
.pf-nav-links a{padding:.4rem .85rem;border-radius:8px;font-size:.85rem;color:var(--muted);text-decoration:none;transition:.2s}
.pf-nav-links a:hover,.pf-nav-links a.pf-active{color:var(--acc);background:${pfRgba(c.accent, .12)}}
.pf-actions{display:flex;flex-wrap:wrap;gap:.6rem;justify-content:center;align-items:center;margin-top:1.5rem}
.pf-btn{display:inline-flex;align-items:center;gap:.5rem;padding:.76rem 1.45rem;border-radius:10px;font-weight:700;
  font-size:.9rem;text-decoration:none;border:1px solid var(--line);transition:.25s}
.pf-btn svg{width:16px;height:16px}
.pf-btn-primary{background:var(--acc);color:${c.accentInk};border-color:transparent;
  box-shadow:0 12px 32px ${pfRgba(c.accent, .34)}}
.pf-btn-primary:hover{transform:translateY(-3px);box-shadow:0 18px 42px ${pfRgba(c.accent, .46)}}
.pf-btn-ghost{background:rgba(255,255,255,.07);color:var(--ink)}
.pf-btn-ghost:hover{border-color:var(--acc);transform:translateY(-3px)}
.pf-socials{display:flex;gap:.45rem}
.pf-socials a{display:grid;place-items:center;width:40px;height:40px;border-radius:10px;background:rgba(255,255,255,.07);
  border:1px solid var(--line);color:var(--ink);transition:.25s}
.pf-socials a svg{width:16px;height:16px}
.pf-socials a:hover{color:var(--acc);border-color:var(--acc);transform:translateY(-3px)}

.pf-sec{padding:clamp(2.2rem,5.5vw,3.6rem) 0}
.pf-h2{font-size:clamp(1.5rem,3.6vw,2.2rem);font-weight:800;letter-spacing:-.035em;margin-bottom:.3rem}
.pf-sub{color:var(--faint);font-size:.8rem;letter-spacing:.14em;text-transform:uppercase;font-weight:700;margin-bottom:1.8rem}
.pf-card{background:var(--panel);border:1px solid var(--line);border-radius:16px;transition:.3s}
.pf-card:hover{border-color:${pfRgba(c.accent, .5)};transform:translateY(-4px);box-shadow:0 18px 44px rgba(0,0,0,.45)}
.pf-about{padding:1.9rem;white-space:pre-line;color:var(--muted)}
.pf-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:1rem}
.pf-stat{padding:1.5rem 1rem;text-align:center}
.pf-stat b{display:block;font-size:2.2rem;font-weight:800;letter-spacing:-.04em;
  background:linear-gradient(150deg,var(--acc),var(--acc2));-webkit-background-clip:text;background-clip:text;color:transparent}
.pf-stat span{font-size:.74rem;color:var(--faint);font-weight:700;letter-spacing:.08em;text-transform:uppercase}
.pf-pills{display:flex;flex-wrap:wrap;gap:.45rem}
.pf-pill{padding:.42rem 1rem;border-radius:8px;font-size:.86rem;color:var(--muted);background:var(--panel);
  border:1px solid var(--line);transition:.22s;cursor:default}
.pf-pill:hover{color:var(--acc);border-color:var(--acc);transform:translateY(-2px)}
.pf-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(290px,1fr));gap:1rem}
.pf-proj{padding:1.6rem}
.pf-proj h3{font-size:1.13rem;font-weight:800;letter-spacing:-.02em;margin-bottom:.15rem}
.pf-proj .pf-role,.pf-row .pf-org{font-size:.8rem;color:var(--acc);font-weight:700;margin-bottom:.6rem}
.pf-proj p,.pf-row p{color:var(--muted);font-size:.93rem}
.pf-proj ul,.pf-row ul{margin-top:.55rem}
.pf-proj li,.pf-row li{color:var(--muted);font-size:.89rem;padding-left:1.1rem;position:relative;margin-bottom:.24rem}
.pf-proj li::before,.pf-row li::before{content:"";position:absolute;left:0;top:.62em;width:6px;height:3px;
  border-radius:2px;background:var(--acc)}
.pf-tags{display:flex;flex-wrap:wrap;gap:.32rem;margin-top:.85rem}
.pf-tag{font-size:.7rem;font-weight:700;padding:.16rem .55rem;border-radius:5px;color:var(--acc);
  background:${pfRgba(c.accent, .12)}}
.pf-links{display:flex;gap:1rem;margin-top:.85rem;font-size:.83rem;font-weight:700}
.pf-links a{color:var(--acc);text-decoration:none;display:inline-flex;align-items:center;gap:.3rem}
.pf-links a svg{width:14px;height:14px}
.pf-rows{display:grid;gap:.85rem}
.pf-row{padding:1.45rem 1.6rem}
.pf-row-top{display:flex;flex-wrap:wrap;gap:.25rem 1rem;align-items:baseline}
.pf-row h3{font-size:1.05rem;font-weight:800}
.pf-row .pf-when{margin-left:auto;color:var(--faint);font-size:.81rem;white-space:nowrap;font-weight:600}
.pf-contact{padding:clamp(2.2rem,5vw,3.4rem);text-align:center;border-radius:20px;
  background:linear-gradient(150deg,${pfRgba(c.accent, .16)},${pfRgba(a2, .12)});border:1px solid var(--line)}
.pf-contact h2{font-size:clamp(1.7rem,4.5vw,2.6rem);font-weight:800;letter-spacing:-.04em;margin-bottom:.7rem}
.pf-contact p{color:var(--muted);max-width:46ch;margin:0 auto 1.5rem}
.pf-clist{display:flex;flex-wrap:wrap;gap:.6rem 1.6rem;justify-content:center;margin-top:1.5rem;font-size:.88rem}
.pf-clist a,.pf-clist span{color:var(--muted);text-decoration:none;display:inline-flex;align-items:center;gap:.42rem}
.pf-clist svg{width:16px;height:16px;color:var(--acc)}
.pf-clist a:hover{color:var(--acc)}
footer{padding:2.6rem 0;text-align:center;color:var(--faint);font-size:.83rem}
@media (max-width:760px){.pf-nav-links{display:none}.pf-row .pf-when{margin-left:0;width:100%}}
@media (prefers-reduced-motion:reduce){.pf-layer,.pf-sun{transform:none!important}.pf-scroll::after{animation:none}}`;

  const body = `
<header class="pf-scene" id="top">
  <div class="pf-sun" id="pf-sun" aria-hidden="true"></div>
  ${ridge("M0 292 C120 246 210 232 320 268 C430 304 500 214 620 208 C740 202 812 268 930 262 C1048 256 1140 206 1260 222 C1350 234 1400 252 1440 244 V420 H0 Z", pfShade(c.accent, -0.34), 0.06, 2)}
  ${ridge("M0 334 C140 296 236 282 356 314 C476 346 548 268 668 262 C788 256 862 320 986 314 C1110 308 1200 264 1320 278 C1390 286 1416 300 1440 296 V420 H0 Z", pfShade(c.accent, -0.55), 0.14, 3)}
  ${ridge("M0 372 C160 340 260 328 388 356 C516 384 588 316 716 312 C844 308 918 366 1046 362 C1174 358 1268 320 1392 336 C1418 339 1430 344 1440 342 V420 H0 Z", "#131C31", 0.26, 4)}
  <div class="pf-haze" aria-hidden="true"></div>
  <div class="pf-scene-copy"><div>
    ${d.available ? `<div class="pf-badge"><i></i>${pfEsc(d.available)}</div>` : ""}
    <h1>${pfEsc(c.name)}</h1>
    ${c.title ? `<h2>${pfEsc(c.title)}</h2>` : ""}
    ${c.tagline ? `<p>${pfEsc(c.tagline)}</p>` : ""}
    <div class="pf-actions">
      ${d.email ? `<a class="pf-btn pf-btn-primary" href="mailto:${pfEsc(d.email)}">${PF_ICONS.mail}${pfEsc(d.cta_text || "Get in touch")}</a>` : ""}
      ${c.hasResume ? `<a class="pf-btn pf-btn-ghost" ${pfResumeAttrs(c)}>${PF_ICONS.download}${pfEsc(c.resumeLabel)}</a>` : ""}
      ${pfSocialRow(c)}
    </div>
  </div></div>
  <div class="pf-scroll pf-noprint" aria-hidden="true"></div>
</header>

<nav class="pf-nav pf-noprint"><div class="pf-shell pf-nav-in">
  <a class="pf-brand" href="#top"><i>${pfEsc(c.initials)}</i>${pfEsc(c.name)}</a>
  ${nav ? `<div class="pf-nav-links">${nav}</div>` : ""}
</div></nav>

<main id="main"><div class="pf-shell">
  ${c.has("stats") ? `<section class="pf-sec"><div class="pf-stats">
    ${d.stats.map((x, i) => `<div class="pf-card pf-stat" data-reveal data-reveal-delay="${i * 70}">
      <b>${pfEsc(x.value)}</b><span>${pfEsc(x.label)}</span></div>`).join("")}</div></section>` : ""}

  ${c.has("about") ? `<section class="pf-sec" id="about"><h2 class="pf-h2">About</h2>
    <p class="pf-sub">Ground level</p>
    <div class="pf-card pf-about" data-reveal>${pfEsc(d.about)}</div></section>` : ""}

  ${c.has("skills") ? `<section class="pf-sec" id="skills"><h2 class="pf-h2">Skills</h2>
    <p class="pf-sub">Equipment</p>
    <div class="pf-pills" data-reveal>${d.skills.map(x => `<span class="pf-pill">${pfEsc(x)}</span>`).join("")}</div></section>` : ""}

  ${c.has("projects") ? `<section class="pf-sec" id="projects"><h2 class="pf-h2">Work</h2>
    <p class="pf-sub">Selected projects</p>
    <div class="pf-grid">${d.projects.map((x, i) => `
      <article class="pf-card pf-proj" data-reveal data-reveal-delay="${Math.min(i, 5) * 80}">
        <h3>${pfEsc(x.name || "")}</h3>
        ${pfJoin([x.role, x.period]) ? `<div class="pf-role">${pfJoin([x.role, x.period])}</div>` : ""}
        ${x.description ? `<p>${pfEsc(x.description)}</p>` : ""}
        ${(x.bullets || []).length ? `<ul>${x.bullets.map(b => `<li>${pfEsc(b)}</li>`).join("")}</ul>` : ""}
        ${(x.tags || []).length ? `<div class="pf-tags">${x.tags.map(t => `<span class="pf-tag">${pfEsc(t)}</span>`).join("")}</div>` : ""}
        ${pfProjectLinks(x) ? `<div class="pf-links">${pfProjectLinks(x)}</div>` : ""}
      </article>`).join("")}</div></section>` : ""}

  ${c.has("experience") ? `<section class="pf-sec" id="experience"><h2 class="pf-h2">Experience</h2>
    <p class="pf-sub">The climb</p>
    <div class="pf-rows">${d.experience.map((x, i) => `
      <article class="pf-card pf-row" data-reveal data-reveal-delay="${Math.min(i, 5) * 70}">
        <div class="pf-row-top"><h3>${pfEsc(x.role || "")}</h3>
          ${x.period ? `<span class="pf-when">${pfEsc(x.period)}</span>` : ""}</div>
        ${x.org ? `<div class="pf-org">${pfJoin([x.org, x.location])}</div>` : ""}
        ${x.summary ? `<p>${pfEsc(x.summary)}</p>` : ""}
        ${(x.bullets || []).length ? `<ul>${x.bullets.map(b => `<li>${pfEsc(b)}</li>`).join("")}</ul>` : ""}
      </article>`).join("")}</div></section>` : ""}

  ${c.has("education") ? `<section class="pf-sec" id="education"><h2 class="pf-h2">Education</h2>
    <p class="pf-sub">Base camp</p>
    <div class="pf-rows">${d.education.map(x => `
      <article class="pf-card pf-row" data-reveal>
        <div class="pf-row-top"><h3>${pfEsc(x.degree || "")}</h3>
          ${x.period ? `<span class="pf-when">${pfEsc(x.period)}</span>` : ""}</div>
        ${x.school ? `<div class="pf-org">${pfEsc(x.school)}</div>` : ""}
        ${x.detail ? `<p>${pfEsc(x.detail)}</p>` : ""}
      </article>`).join("")}</div></section>` : ""}

  ${c.has("certifications") ? `<section class="pf-sec" id="certifications"><h2 class="pf-h2">Certifications</h2>
    <p class="pf-sub">Logged</p>
    <div class="pf-pills" data-reveal>${d.certifications.map(x => `<span class="pf-pill">${pfEsc(x)}</span>`).join("")}</div></section>` : ""}

  ${c.has("contact") ? `<section class="pf-sec" id="contact"><div class="pf-contact" data-reveal>
    <h2>Start a conversation</h2>
    <p>${pfEsc(d.cta_text || "Tell me where you are heading and I will tell you if I know the route.")}</p>
    <div class="pf-actions" style="margin-top:0">
      ${d.email ? `<a class="pf-btn pf-btn-primary" href="mailto:${pfEsc(d.email)}">${PF_ICONS.mail}${pfEsc(d.email)}</a>` : ""}
      ${c.hasResume ? `<a class="pf-btn pf-btn-ghost" ${pfResumeAttrs(c)}>${PF_ICONS.download}Résumé</a>` : ""}
    </div>
    <div class="pf-clist">${c.links.map(x => x.url
      ? `<a href="${pfEsc(x.url)}"${/^https?:/i.test(x.url) ? ` target="_blank" rel="noopener"` : ""}>${x.icon}${pfEsc(x.handle)}</a>`
      : `<span>${x.icon}${pfEsc(x.handle)}</span>`).join("")}</div>
  </div></section>` : ""}

  <footer>© <span data-year>${c.year}</span> ${pfEsc(c.name)}${d.footer_note ? " · " + pfEsc(d.footer_note) : ""}</footer>
</div></main>`;

  const js = `
(function(){
  var nav = document.querySelector('.pf-nav');
  var onScroll = function(){ nav.classList.toggle('pf-stuck', window.scrollY > 10); };
  onScroll(); addEventListener('scroll', onScroll, { passive:true });
  var links = [].slice.call(document.querySelectorAll('.pf-nav-links a'));
  var secs = links.map(function(a){ return document.querySelector(a.getAttribute('href')); }).filter(Boolean);
  if ('IntersectionObserver' in window && secs.length) {
    var spy = new IntersectionObserver(function(es){
      es.forEach(function(e){ if(!e.isIntersecting) return;
        links.forEach(function(a){ a.classList.toggle('pf-active', a.getAttribute('href') === '#' + e.target.id); }); });
    }, { rootMargin:'-45% 0px -50% 0px' });
    secs.forEach(function(s){ spy.observe(s); });
  }

  /* Parallax.
     Each layer carries its own --sp and translates by scrollY * sp. Batched
     into one rAF because a scroll event can fire many times per frame and
     writing transforms on every one of them is how a parallax hero ends up
     janky on the machines that most need it not to be. */
  if (matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  var layers = [].slice.call(document.querySelectorAll('.pf-layer'));
  var sun = document.getElementById('pf-sun');
  var scene = document.querySelector('.pf-scene');
  var ticking = false;
  function apply(){
    var y = window.scrollY;
    ticking = false;
    if (y > scene.offsetHeight + 80) return;          /* off screen: stop writing */
    for (var i = 0; i < layers.length; i++) {
      var sp = parseFloat(layers[i].style.getPropertyValue('--sp')) || 0;
      layers[i].style.transform = 'translate3d(0,' + (y * sp).toFixed(1) + 'px,0)';
    }
    if (sun) sun.style.transform = 'translate(-50%,calc(-50% + ' + (y * 0.3).toFixed(1) + 'px))';
  }
  addEventListener('scroll', function(){
    if (!ticking) { ticking = true; requestAnimationFrame(apply); }
  }, { passive:true });
  apply();
})();`;

  return { fonts: [c.googleFont ? null : "Inter:wght@400;600;700;800"].filter(Boolean),
           css, body, js, themeColor: "#0F172A" };
};


// ---------------------------------------------------------------------------
// 20. CHROME — liquid metal. A sheen sweeps the headline on a loop, cards are
//     bevelled glass, and a ticker runs the skills past the bottom of the hero.
// ---------------------------------------------------------------------------
PF_RENDERERS.chrome = (c) => {
  const d = c.d;
  const a2 = pfHueShift(c.accent, 62);
  const nav = c.navItems.map(n => `<a href="#${n.id}">${pfEsc(n.label)}</a>`).join("");
  const ticker = d.skills.length
    ? d.skills.concat(d.skills).map(x => `<span>${pfEsc(x)}</span>`).join(`<i aria-hidden="true">◆</i>`) : "";

  const css = `
:root{
  --acc:${c.accent}; --acc2:${a2}; --ink:#EDEDF5; --muted:#9A9AB4; --faint:#65657E;
  --bg:#08080C; --panel:rgba(255,255,255,.045); --line:rgba(255,255,255,.12);
  --font:${c.fontStack || `'Space Grotesk','Inter',-apple-system,'Segoe UI',Roboto,sans-serif`};
}
body{background:var(--bg);color:var(--ink);font-family:var(--font);font-size:16px;line-height:1.66;overflow-x:hidden}
.pf-skip{background:var(--acc);color:${c.accentInk}}
.pf-shell{width:min(1100px,92vw);margin:0 auto}
.pf-glow{position:fixed;inset:0;z-index:0;pointer-events:none;
  background:radial-gradient(52% 40% at 50% 0%,${pfRgba(c.accent, .2)},transparent 68%),
             radial-gradient(44% 34% at 12% 84%,${pfRgba(a2, .12)},transparent 74%)}
main{position:relative;z-index:3}
.pf-nav{position:sticky;top:0;z-index:20;background:${pfRgba("#08080C", .94)};
  backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);border-bottom:1px solid transparent;transition:.25s}
.pf-nav.pf-stuck{border-bottom-color:var(--line)}
.pf-nav-in{display:flex;align-items:center;gap:1.2rem;padding:.8rem 0}
.pf-brand{font-weight:700;letter-spacing:-.01em;text-decoration:none;display:flex;align-items:center;gap:.55rem}
.pf-brand i{width:28px;height:28px;border-radius:50%;display:grid;place-items:center;font-size:.64rem;font-weight:800;
  font-style:normal;color:#0A0A12;
  background:linear-gradient(150deg,#fff 0%,var(--acc) 34%,#7E7E9C 55%,var(--acc2) 78%,#fff 100%);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.9),0 4px 14px ${pfRgba(c.accent, .4)}}
.pf-nav-links{display:flex;gap:.2rem;margin-left:auto}
.pf-nav-links a{padding:.4rem .85rem;border-radius:999px;font-size:.85rem;color:var(--muted);text-decoration:none;transition:.2s}
.pf-nav-links a:hover,.pf-nav-links a.pf-active{color:var(--ink);background:var(--panel)}

/* Liquid metal.
   Chrome is a gradient with a hard light band in it, clipped to the glyphs.
   The band is animated by moving background-position across an oversized
   gradient — 300% wide so there is somewhere for it to travel. */
.pf-hero{padding:clamp(3rem,9vw,5.5rem) 0 clamp(1.6rem,4vw,2.4rem);text-align:center}
.pf-metal{font-size:clamp(2.6rem,9vw,6.2rem);font-weight:700;letter-spacing:-.045em;line-height:1;
  background:linear-gradient(100deg,#5B5B78 0%,#C9C9E4 14%,#FFFFFF 22%,var(--acc) 34%,#8E8EB0 46%,
             #FFFFFF 58%,var(--acc2) 70%,#B9B9D6 82%,#5B5B78 100%);
  background-size:300% 100%;-webkit-background-clip:text;background-clip:text;color:transparent;
  animation:pf-sheen 7s linear infinite;
  filter:drop-shadow(0 3px 14px ${pfRgba(c.accent, .35)})}
@keyframes pf-sheen{to{background-position:-300% 0}}
.pf-badge{display:inline-flex;align-items:center;gap:.5rem;padding:.36rem 1rem;border-radius:999px;
  border:1px solid var(--line);background:var(--panel);font-size:.78rem;font-weight:600;color:var(--muted);margin-bottom:1.4rem}
.pf-badge i{width:6px;height:6px;border-radius:50%;background:var(--acc);box-shadow:0 0 10px var(--acc)}
.pf-hero h2{font-size:clamp(.92rem,2.1vw,1.15rem);font-weight:700;letter-spacing:.2em;text-transform:uppercase;
  color:var(--acc);margin:1rem 0 .8rem}
.pf-hero p{color:var(--muted);max-width:52ch;margin:0 auto}
.pf-actions{display:flex;flex-wrap:wrap;gap:.65rem;justify-content:center;align-items:center;margin-top:1.7rem}

/* Bevel: a bright inner top edge and a dark inner bottom edge is the whole
   trick — it reads as a raised surface without a single image. */
.pf-btn{display:inline-flex;align-items:center;gap:.5rem;padding:.78rem 1.5rem;border-radius:999px;font-weight:700;
  font-size:.9rem;text-decoration:none;border:1px solid var(--line);transition:.25s;
  box-shadow:inset 0 1px 0 rgba(255,255,255,.16),inset 0 -1px 0 rgba(0,0,0,.4)}
.pf-btn svg{width:16px;height:16px}
.pf-btn-primary{border-color:transparent;color:#0A0A12;
  background:linear-gradient(180deg,#FFFFFF 0%,var(--acc) 40%,${pfShade(c.accent, -0.28)} 100%);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.9),0 10px 30px ${pfRgba(c.accent, .4)}}
.pf-btn-primary:hover{transform:translateY(-3px);box-shadow:inset 0 1px 0 rgba(255,255,255,.9),0 16px 40px ${pfRgba(c.accent, .55)}}
.pf-btn-ghost{background:var(--panel);color:var(--ink)}
.pf-btn-ghost:hover{border-color:var(--acc);transform:translateY(-3px)}
.pf-socials{display:flex;gap:.45rem}
.pf-socials a{display:grid;place-items:center;width:40px;height:40px;border-radius:50%;background:var(--panel);
  border:1px solid var(--line);color:var(--muted);transition:.25s;
  box-shadow:inset 0 1px 0 rgba(255,255,255,.14)}
.pf-socials a svg{width:16px;height:16px}
.pf-socials a:hover{color:var(--ink);border-color:var(--acc);transform:translateY(-3px);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.3),0 0 22px ${pfRgba(c.accent, .35)}}

.pf-ticker{overflow:hidden;border-top:1px solid var(--line);border-bottom:1px solid var(--line);
  padding:.8rem 0;margin:clamp(1.6rem,4vw,2.4rem) 0;background:var(--panel)}
.pf-ticker-in{display:flex;gap:1.5rem;align-items:center;width:max-content;white-space:nowrap;
  animation:pf-run 38s linear infinite;font-size:.92rem;font-weight:600;letter-spacing:.06em;
  text-transform:uppercase;color:var(--muted)}
.pf-ticker-in i{color:var(--acc);font-style:normal;font-size:.6rem}
.pf-ticker:hover .pf-ticker-in{animation-play-state:paused}
@keyframes pf-run{to{transform:translateX(-50%)}}

.pf-sec{padding:clamp(2.2rem,5.5vw,3.6rem) 0}
.pf-h2{font-size:clamp(1.5rem,3.6vw,2.2rem);font-weight:700;letter-spacing:-.03em;margin-bottom:.3rem}
.pf-sub{color:var(--faint);font-size:.78rem;letter-spacing:.18em;text-transform:uppercase;font-weight:700;margin-bottom:1.8rem}
.pf-card{background:var(--panel);border:1px solid var(--line);border-radius:18px;transition:.3s;
  box-shadow:inset 0 1px 0 rgba(255,255,255,.09),inset 0 -1px 0 rgba(0,0,0,.35)}
.pf-card:hover{border-color:${pfRgba(c.accent, .5)};transform:translateY(-4px);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.16),0 20px 46px rgba(0,0,0,.55)}
.pf-about{padding:1.9rem;white-space:pre-line;color:var(--muted)}
.pf-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:1rem}
.pf-stat{padding:1.5rem 1rem;text-align:center}
.pf-stat b{display:block;font-size:2.3rem;font-weight:700;letter-spacing:-.045em;
  background:linear-gradient(180deg,#FFFFFF,var(--acc) 65%,${pfShade(c.accent, -0.30)});
  -webkit-background-clip:text;background-clip:text;color:transparent}
.pf-stat span{font-size:.73rem;color:var(--faint);font-weight:700;letter-spacing:.1em;text-transform:uppercase}
.pf-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(290px,1fr));gap:1rem}
.pf-proj{padding:1.6rem}
.pf-proj h3{font-size:1.14rem;font-weight:700;letter-spacing:-.02em;margin-bottom:.15rem}
.pf-proj .pf-role,.pf-row .pf-org{font-size:.79rem;color:var(--acc);font-weight:600;margin-bottom:.6rem}
.pf-proj p,.pf-row p{color:var(--muted);font-size:.93rem}
.pf-proj ul,.pf-row ul{margin-top:.55rem}
.pf-proj li,.pf-row li{color:var(--muted);font-size:.89rem;padding-left:1.1rem;position:relative;margin-bottom:.24rem}
.pf-proj li::before,.pf-row li::before{content:"";position:absolute;left:0;top:.58em;width:6px;height:6px;
  transform:rotate(45deg);background:linear-gradient(140deg,#fff,var(--acc))}
.pf-tags{display:flex;flex-wrap:wrap;gap:.32rem;margin-top:.85rem}
.pf-tag{font-size:.7rem;font-weight:600;padding:.16rem .55rem;border-radius:999px;color:var(--muted);
  background:rgba(255,255,255,.06);border:1px solid var(--line)}
.pf-links{display:flex;gap:1rem;margin-top:.85rem;font-size:.82rem;font-weight:700}
.pf-links a{color:var(--acc);text-decoration:none;display:inline-flex;align-items:center;gap:.3rem}
.pf-links a svg{width:14px;height:14px}
.pf-rows{display:grid;gap:.85rem}
.pf-row{padding:1.45rem 1.6rem}
.pf-row-top{display:flex;flex-wrap:wrap;gap:.25rem 1rem;align-items:baseline}
.pf-row h3{font-size:1.05rem;font-weight:700}
.pf-row .pf-when{margin-left:auto;color:var(--faint);font-size:.81rem;white-space:nowrap;font-weight:600}
.pf-contact{padding:clamp(2.2rem,5vw,3.4rem);text-align:center;border-radius:24px}
.pf-contact h2{font-size:clamp(1.9rem,5.5vw,3.2rem);font-weight:700;letter-spacing:-.045em;margin-bottom:.7rem;
  background:linear-gradient(100deg,#8E8EB0,#FFFFFF 30%,var(--acc) 55%,#FFFFFF 75%,#8E8EB0);
  background-size:300% 100%;-webkit-background-clip:text;background-clip:text;color:transparent;
  animation:pf-sheen 9s linear infinite}
.pf-contact p{color:var(--muted);max-width:46ch;margin:0 auto 1.6rem}
.pf-clist{display:flex;flex-wrap:wrap;gap:.6rem 1.6rem;justify-content:center;margin-top:1.5rem;font-size:.88rem}
.pf-clist a,.pf-clist span{color:var(--muted);text-decoration:none;display:inline-flex;align-items:center;gap:.42rem}
.pf-clist svg{width:16px;height:16px;color:var(--acc)}
.pf-clist a:hover{color:var(--ink)}
footer{padding:2.6rem 0;text-align:center;color:var(--faint);font-size:.82rem}
@media (max-width:760px){.pf-nav-links{display:none}.pf-row .pf-when{margin-left:0;width:100%}}
@media (prefers-reduced-motion:reduce){
  .pf-metal,.pf-contact h2{animation:none;background-position:50% 0}
  .pf-ticker-in{animation:none}}`;

  const body = `
<div class="pf-glow" aria-hidden="true"></div>
<nav class="pf-nav pf-noprint"><div class="pf-shell pf-nav-in">
  <a class="pf-brand" href="#top"><i>${pfEsc(c.initials)}</i>${pfEsc(c.name)}</a>
  ${nav ? `<div class="pf-nav-links">${nav}</div>` : ""}
</div></nav>

<main id="main"><div class="pf-shell">
  <section class="pf-hero" id="top">
    ${d.available ? `<div class="pf-badge"><i></i>${pfEsc(d.available)}</div>` : ""}
    <h1 class="pf-metal">${pfEsc(c.name)}</h1>
    ${c.title ? `<h2>${pfEsc(c.title)}</h2>` : ""}
    ${c.tagline ? `<p>${pfEsc(c.tagline)}</p>` : ""}
    <div class="pf-actions">
      ${d.email ? `<a class="pf-btn pf-btn-primary" href="mailto:${pfEsc(d.email)}">${PF_ICONS.mail}${pfEsc(d.cta_text || "Get in touch")}</a>` : ""}
      ${c.hasResume ? `<a class="pf-btn pf-btn-ghost" ${pfResumeAttrs(c)}>${PF_ICONS.download}${pfEsc(c.resumeLabel)}</a>` : ""}
      ${pfSocialRow(c)}
    </div>
  </section>
</div>

${ticker ? `<div class="pf-ticker" id="skills"><div class="pf-ticker-in">${ticker}</div></div>` : ""}

<div class="pf-shell">
  ${c.has("stats") ? `<section class="pf-sec"><div class="pf-stats">
    ${d.stats.map((x, i) => `<div class="pf-card pf-stat" data-reveal data-reveal-delay="${i * 70}">
      <b>${pfEsc(x.value)}</b><span>${pfEsc(x.label)}</span></div>`).join("")}</div></section>` : ""}

  ${c.has("about") ? `<section class="pf-sec" id="about"><h2 class="pf-h2">About</h2>
    <p class="pf-sub">Specification</p>
    <div class="pf-card pf-about" data-reveal>${pfEsc(d.about)}</div></section>` : ""}

  ${c.has("projects") ? `<section class="pf-sec" id="projects"><h2 class="pf-h2">Work</h2>
    <p class="pf-sub">Selected projects</p>
    <div class="pf-grid">${d.projects.map((x, i) => `
      <article class="pf-card pf-proj" data-reveal data-reveal-delay="${Math.min(i, 5) * 80}">
        <h3>${pfEsc(x.name || "")}</h3>
        ${pfJoin([x.role, x.period]) ? `<div class="pf-role">${pfJoin([x.role, x.period])}</div>` : ""}
        ${x.description ? `<p>${pfEsc(x.description)}</p>` : ""}
        ${(x.bullets || []).length ? `<ul>${x.bullets.map(b => `<li>${pfEsc(b)}</li>`).join("")}</ul>` : ""}
        ${(x.tags || []).length ? `<div class="pf-tags">${x.tags.map(t => `<span class="pf-tag">${pfEsc(t)}</span>`).join("")}</div>` : ""}
        ${pfProjectLinks(x) ? `<div class="pf-links">${pfProjectLinks(x)}</div>` : ""}
      </article>`).join("")}</div></section>` : ""}

  ${c.has("experience") ? `<section class="pf-sec" id="experience"><h2 class="pf-h2">Experience</h2>
    <p class="pf-sub">Track record</p>
    <div class="pf-rows">${d.experience.map((x, i) => `
      <article class="pf-card pf-row" data-reveal data-reveal-delay="${Math.min(i, 5) * 70}">
        <div class="pf-row-top"><h3>${pfEsc(x.role || "")}</h3>
          ${x.period ? `<span class="pf-when">${pfEsc(x.period)}</span>` : ""}</div>
        ${x.org ? `<div class="pf-org">${pfJoin([x.org, x.location])}</div>` : ""}
        ${x.summary ? `<p>${pfEsc(x.summary)}</p>` : ""}
        ${(x.bullets || []).length ? `<ul>${x.bullets.map(b => `<li>${pfEsc(b)}</li>`).join("")}</ul>` : ""}
      </article>`).join("")}</div></section>` : ""}

  ${c.has("education") ? `<section class="pf-sec" id="education"><h2 class="pf-h2">Education</h2>
    <p class="pf-sub">Origin</p>
    <div class="pf-rows">${d.education.map(x => `
      <article class="pf-card pf-row" data-reveal>
        <div class="pf-row-top"><h3>${pfEsc(x.degree || "")}</h3>
          ${x.period ? `<span class="pf-when">${pfEsc(x.period)}</span>` : ""}</div>
        ${x.school ? `<div class="pf-org">${pfEsc(x.school)}</div>` : ""}
        ${x.detail ? `<p>${pfEsc(x.detail)}</p>` : ""}
      </article>`).join("")}</div></section>` : ""}

  ${c.has("certifications") ? `<section class="pf-sec" id="certifications"><h2 class="pf-h2">Certifications</h2>
    <p class="pf-sub">Verified</p>
    <div class="pf-tags" data-reveal>${d.certifications.map(x =>
      `<span class="pf-tag" style="font-size:.82rem;padding:.34rem .9rem">${pfEsc(x)}</span>`).join("")}</div></section>` : ""}

  ${c.has("contact") ? `<section class="pf-sec" id="contact"><div class="pf-card pf-contact" data-reveal>
    <h2>Get in touch</h2>
    <p>${pfEsc(d.cta_text || "For work, collaborations, or an argument about typefaces.")}</p>
    <div class="pf-actions" style="margin-top:0">
      ${d.email ? `<a class="pf-btn pf-btn-primary" href="mailto:${pfEsc(d.email)}">${PF_ICONS.mail}${pfEsc(d.email)}</a>` : ""}
      ${c.hasResume ? `<a class="pf-btn pf-btn-ghost" ${pfResumeAttrs(c)}>${PF_ICONS.download}Résumé</a>` : ""}
    </div>
    <div class="pf-clist">${c.links.map(x => x.url
      ? `<a href="${pfEsc(x.url)}"${/^https?:/i.test(x.url) ? ` target="_blank" rel="noopener"` : ""}>${x.icon}${pfEsc(x.handle)}</a>`
      : `<span>${x.icon}${pfEsc(x.handle)}</span>`).join("")}</div>
  </div></section>` : ""}

  <footer>© <span data-year>${c.year}</span> ${pfEsc(c.name)}${d.footer_note ? " · " + pfEsc(d.footer_note) : ""}</footer>
</div></main>`;

  const js = `
(function(){
  var nav = document.querySelector('.pf-nav');
  var onScroll = function(){ nav.classList.toggle('pf-stuck', window.scrollY > 10); };
  onScroll(); addEventListener('scroll', onScroll, { passive:true });
  var links = [].slice.call(document.querySelectorAll('.pf-nav-links a'));
  var secs = links.map(function(a){ return document.querySelector(a.getAttribute('href')); }).filter(Boolean);
  if ('IntersectionObserver' in window && secs.length) {
    var spy = new IntersectionObserver(function(es){
      es.forEach(function(e){ if(!e.isIntersecting) return;
        links.forEach(function(a){ a.classList.toggle('pf-active', a.getAttribute('href') === '#' + e.target.id); }); });
    }, { rootMargin:'-45% 0px -50% 0px' });
    secs.forEach(function(s){ spy.observe(s); });
  }
})();`;

  return { fonts: [c.googleFont ? null : "Space+Grotesk:wght@500;700"].filter(Boolean),
           css, body, js, themeColor: "#08080C" };
};


// ---------------------------------------------------------------------------
// 21. AQUARELLE — paint on paper. The washes are generated, not pictures: soft
//     ellipses pushed through a turbulence displacement so their edges bleed
//     the way pigment does on cotton rag. Nothing here is a stock asset, which
//     matters for a file somebody else is going to host under their own name.
// ---------------------------------------------------------------------------
PF_RENDERERS.aquarelle = (c) => {
  const d = c.d;
  const a2 = pfHueShift(c.accent, 130);         // the rose that answers the blue
  const a3 = pfHueShift(c.accent, 52);
  const nav = c.navItems.map(n => `<a href="#${n.id}">${pfEsc(n.label)}</a>`).join("");

  // A hand-drawn rule. Slightly off-level and not quite straight, because a
  // ruled line under a serif heading reads as a border; a wobbly one reads as
  // a person with a brush. Draws itself when the heading arrives.
  const stroke = `<svg class="pf-ul" viewBox="0 0 220 12" preserveAspectRatio="none" aria-hidden="true">
      <path d="M3 8.4C38 4.2 74 9.6 108 6.2c34-3.4 70 1.8 109 3.1"/></svg>`;
  const head = (title, kicker) => `<div class="pf-head" data-reveal>
      ${kicker ? `<div class="pf-kicker">${pfEsc(kicker)}</div>` : ""}
      <h2 class="pf-h2">${pfEsc(title)}${stroke}</h2></div>`;

  const css = `
:root{
  --acc:${c.accent}; --blush:${a2}; --acc3:${a3};
  --ink:#33302B; --muted:#6B655C; --faint:#9C948A;
  --paper:#FBF8F3; --card:#FFFDFA; --line:#E7DFD3;
  --serif:'Newsreader',Georgia,'Times New Roman',serif;
  --hand:'Caveat','Segoe Script',cursive;
  --font:${c.fontStack || `'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif`};
}
body{background:var(--paper);color:var(--ink);font-family:var(--font);font-size:16px;line-height:1.75;overflow-x:hidden}
.pf-skip{background:var(--acc);color:${c.accentInk}}
.pf-shell{width:min(880px,90vw);margin:0 auto}
.pf-defs{position:absolute;width:0;height:0;overflow:hidden}

/* The washes live behind everything and drift on a very long loop. Two per
   screenful at most — watercolour reads as calm, and calm is mostly restraint. */
.pf-washes{position:fixed;inset:0;z-index:0;pointer-events:none;overflow:hidden}
.pf-washes svg{position:absolute;filter:url(#pf-bleed);opacity:.55;will-change:transform}
.pf-w1{top:-8vh;right:-10vw;width:58vw;height:58vw;animation:pf-float1 34s ease-in-out infinite}
.pf-w2{top:38vh;left:-16vw;width:46vw;height:46vw;animation:pf-float2 44s ease-in-out infinite}
.pf-w3{bottom:-12vh;right:4vw;width:38vw;height:38vw;animation:pf-float1 52s ease-in-out infinite reverse}
@keyframes pf-float1{50%{transform:translate3d(-2.5vw,3vh,0) rotate(7deg) scale(1.06)}}
@keyframes pf-float2{50%{transform:translate3d(3vw,-2.5vh,0) rotate(-6deg) scale(1.05)}}

/* Cotton-rag fibre. Multiplied so it darkens the paper rather than fogging it. */
.pf-grain{position:fixed;inset:0;z-index:1;pointer-events:none;mix-blend-mode:multiply;opacity:.4;
  background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Cfilter id='g'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.62' numOctaves='4' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='200' height='200' filter='url(%23g)' opacity='.35'/%3E%3C/svg%3E")}
main{position:relative;z-index:3}

.pf-nav{position:sticky;top:0;z-index:20;background:${pfRgba("#FBF8F3", .9)};
  backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border-bottom:1px solid transparent;transition:.3s}
.pf-nav.pf-stuck{border-bottom-color:var(--line)}
.pf-nav-in{display:flex;align-items:center;gap:1.2rem;padding:.85rem 0}
.pf-brand{font-family:var(--serif);font-weight:600;font-size:1.08rem;letter-spacing:-.01em;text-decoration:none;
  display:flex;align-items:center;gap:.6rem}
.pf-brand i{width:30px;height:30px;display:grid;place-items:center;font-family:var(--font);font-size:.66rem;
  font-weight:700;font-style:normal;color:#fff;background:var(--acc);
  border-radius:52% 48% 44% 56%/46% 52% 48% 54%}
.pf-nav-links{display:flex;gap:1.1rem;margin-left:auto}
.pf-nav-links a{font-size:.87rem;color:var(--muted);text-decoration:none;position:relative;padding:.15rem 0;transition:color .2s}
.pf-nav-links a::after{content:"";position:absolute;left:0;right:100%;bottom:-1px;height:1.5px;
  background:var(--acc);border-radius:2px;transition:right .3s ease}
.pf-nav-links a:hover,.pf-nav-links a.pf-active{color:var(--ink)}
.pf-nav-links a:hover::after,.pf-nav-links a.pf-active::after{right:0}

.pf-hero{padding:clamp(2.6rem,7vw,4.5rem) 0 clamp(1.8rem,4vw,2.6rem);
  display:grid;grid-template-columns:minmax(0,1fr) auto;gap:2.4rem;align-items:center}
.pf-hello{font-family:var(--hand);font-size:clamp(1.5rem,3.4vw,2.1rem);color:var(--acc);
  transform:rotate(-2deg);transform-origin:left;margin-bottom:.1rem}
.pf-hero h1{font-family:var(--serif);font-size:clamp(2.2rem,6vw,3.7rem);font-weight:600;letter-spacing:-.025em;
  line-height:1.08;margin-bottom:.4rem}
.pf-hero h2{font-size:clamp(.95rem,2vw,1.12rem);font-weight:600;color:var(--acc);margin-bottom:.8rem;
  letter-spacing:.02em}
.pf-hero p{color:var(--muted);max-width:44ch}
.pf-meta{display:flex;flex-wrap:wrap;gap:.4rem 1.2rem;margin-top:1rem;font-size:.86rem;color:var(--faint)}
.pf-avail{display:inline-flex;align-items:center;gap:.45rem;color:var(--acc);font-weight:600}
.pf-avail i{width:7px;height:7px;border-radius:50%;background:var(--acc)}

/* The portrait sits in a painted disc rather than a circle: same idea as the
   washes, one more place the geometry is allowed to be imperfect. */
.pf-portrait{position:relative;width:min(210px,34vw);aspect-ratio:1}
.pf-portrait::before{content:"";position:absolute;inset:-14%;opacity:.75;
  background:radial-gradient(circle at 42% 38%,${pfRgba(a2, .8)} 0%,${pfRgba(a2, .42)} 48%,${pfRgba(a2, 0)} 76%);
  border-radius:56% 44% 48% 52%/50% 56% 44% 50%;filter:url(#pf-bleed)}
.pf-avatar{position:relative;width:100%;height:100%;object-fit:cover;
  border-radius:63% 37% 48% 52%/42% 58% 42% 58%}
.pf-avatar-initials{display:grid;place-items:center;font-family:var(--serif);font-size:3.4rem;font-weight:600;
  color:#fff;background:radial-gradient(circle at 34% 30%,${pfShade(c.accent, 0.22)},var(--acc) 58%,${pfShade(c.accent, -0.16)})}

.pf-actions{display:flex;flex-wrap:wrap;gap:.6rem;align-items:center;margin-top:1.5rem}
.pf-btn{display:inline-flex;align-items:center;gap:.5rem;padding:.72rem 1.4rem;border-radius:999px;font-weight:600;
  font-size:.9rem;text-decoration:none;border:1.5px solid transparent;transition:.26s ease}
.pf-btn svg{width:16px;height:16px}
.pf-btn-primary{background:var(--acc);color:${c.accentInk};box-shadow:0 8px 22px ${pfRgba(c.accent, .28)}}
.pf-btn-primary:hover{transform:translateY(-3px);box-shadow:0 14px 30px ${pfRgba(c.accent, .38)}}
.pf-btn-ghost{background:transparent;border-color:var(--line);color:var(--ink)}
.pf-btn-ghost:hover{border-color:var(--acc);color:var(--acc);transform:translateY(-3px)}
.pf-socials{display:flex;gap:.4rem}
.pf-socials a{display:grid;place-items:center;width:38px;height:38px;color:var(--muted);
  background:var(--card);border:1px solid var(--line);transition:.26s;
  border-radius:54% 46% 48% 52%/50% 54% 46% 50%}
.pf-socials a svg{width:16px;height:16px}
.pf-socials a:hover{color:#fff;background:var(--acc);border-color:var(--acc);transform:translateY(-3px) rotate(-6deg)}

.pf-sec{padding:clamp(2rem,5vw,3.2rem) 0}
.pf-head{margin-bottom:1.5rem}
.pf-kicker{font-family:var(--hand);font-size:1.25rem;color:var(--blush);margin-bottom:-.15rem}
.pf-h2{position:relative;display:inline-block;font-family:var(--serif);font-weight:600;
  font-size:clamp(1.5rem,3.6vw,2.1rem);letter-spacing:-.02em}
.pf-ul{position:absolute;left:0;right:-4px;bottom:-9px;width:calc(100% + 4px);height:11px;overflow:visible}
.pf-ul path{fill:none;stroke:var(--acc);stroke-width:2.6;stroke-linecap:round;opacity:.55;
  stroke-dasharray:230;stroke-dashoffset:230;transition:stroke-dashoffset 1s ease-out .15s}
.pf-head.pf-in .pf-ul path{stroke-dashoffset:0}

.pf-card{background:var(--card);border:1px solid var(--line);border-radius:18px;transition:.3s ease}
.pf-card:hover{border-color:${pfRgba(c.accent, .45)};transform:translateY(-4px);
  box-shadow:0 16px 34px rgba(51,48,43,.08)}
.pf-about{padding:1.8rem;white-space:pre-line;color:var(--muted);font-size:1.02rem}
.pf-about::first-letter{float:left;font-family:var(--serif);font-size:3.1rem;line-height:.82;
  padding:.14em .12em 0 0;color:var(--acc)}
.pf-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:1rem}
.pf-stat{padding:1.4rem 1rem;text-align:center}
.pf-stat b{display:block;font-family:var(--serif);font-size:2.2rem;font-weight:600;color:var(--acc);line-height:1}
.pf-stat span{font-size:.78rem;color:var(--faint)}
.pf-pills{display:flex;flex-wrap:wrap;gap:.5rem}
.pf-pill{padding:.42rem 1rem;border-radius:999px;font-size:.88rem;color:var(--muted);background:var(--card);
  border:1px solid var(--line);transition:.24s ease;cursor:default}
.pf-pill:hover{color:var(--acc);border-color:${pfRgba(c.accent, .55)};background:${pfRgba(c.accent, .07)};
  transform:translateY(-3px) rotate(-1.5deg)}

/* The journey. The spine is a painted gradient, not a rule, and each dot is a
   little wet blob rather than a circle. */
.pf-journey{position:relative;padding-left:2.4rem}
.pf-journey::before{content:"";position:absolute;left:9px;top:.6rem;bottom:.6rem;width:3px;border-radius:3px;
  background:linear-gradient(180deg,${pfRgba(c.accent, .55)},${pfRgba(a2, .45)})}
.pf-stop{position:relative;margin-bottom:1rem}
.pf-stop::before{content:"";position:absolute;left:-2.4rem;top:1.5rem;width:21px;height:21px;
  background:var(--acc);border-radius:56% 44% 48% 52%/50% 56% 44% 50%;
  box-shadow:0 0 0 5px var(--paper);transition:.3s ease}
.pf-stop:nth-child(even)::before{background:var(--blush)}
.pf-stop:hover::before{transform:scale(1.18) rotate(14deg)}
.pf-stop-in{padding:1.35rem 1.5rem}
.pf-stop-top{display:flex;flex-wrap:wrap;gap:.2rem 1rem;align-items:baseline}
.pf-stop h3{font-family:var(--serif);font-size:1.15rem;font-weight:600}
.pf-when{margin-left:auto;font-size:.8rem;color:var(--faint);white-space:nowrap;font-variant-numeric:tabular-nums}
.pf-org{color:var(--acc);font-size:.9rem;font-weight:600;margin-bottom:.5rem}
.pf-stop p,.pf-proj p{color:var(--muted);font-size:.95rem}
.pf-stop ul,.pf-proj ul{margin-top:.55rem}
.pf-stop li,.pf-proj li{color:var(--muted);font-size:.91rem;padding-left:1.25rem;position:relative;margin-bottom:.28rem}
.pf-stop li::before,.pf-proj li::before{content:"";position:absolute;left:0;top:.6em;width:8px;height:8px;
  background:${pfRgba(c.accent, .55)};border-radius:58% 42% 46% 54%/50% 58% 42% 50%}

.pf-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:1.1rem}
.pf-proj{position:relative;padding:1.6rem;overflow:hidden}
.pf-proj::before{content:"";position:absolute;right:-32px;top:-42px;width:130px;height:130px;
  background:var(--blush);opacity:.24;border-radius:52% 48% 46% 54%/48% 52% 48% 52%;transition:.4s ease}
.pf-proj:nth-child(even)::before{background:var(--acc3)}
.pf-proj:hover::before{transform:scale(1.25) rotate(18deg);opacity:.34}
.pf-proj>*{position:relative}
.pf-proj h3{font-family:var(--serif);font-size:1.22rem;font-weight:600;margin-bottom:.1rem}
.pf-proj .pf-role{font-size:.82rem;color:var(--acc);font-weight:600;margin-bottom:.6rem}
.pf-tags{display:flex;flex-wrap:wrap;gap:.35rem;margin-top:.9rem}
.pf-tag{font-size:.72rem;font-weight:600;padding:.18rem .6rem;border-radius:999px;color:var(--muted);
  background:${pfRgba(c.accent, .1)}}
.pf-links{display:flex;gap:1rem;margin-top:.9rem;font-size:.85rem;font-weight:600}
.pf-links a{color:var(--acc);text-decoration:none;display:inline-flex;align-items:center;gap:.32rem}
.pf-links a svg{width:14px;height:14px}
.pf-links a:hover{color:var(--ink)}
.pf-notes{display:grid;gap:.6rem}
.pf-note{padding:.9rem 1.25rem;color:var(--muted);font-size:.94rem;display:flex;gap:.8rem;align-items:baseline}
.pf-note::before{content:"✎";color:var(--blush);font-size:1rem}

.pf-contact{position:relative;padding:clamp(2rem,5vw,3.2rem);text-align:center;overflow:hidden;border-radius:26px}
.pf-contact::before{content:"";position:absolute;inset:-18%;opacity:.6;
  background:radial-gradient(circle at 38% 34%,${pfRgba(c.accent, .3)} 0%,${pfRgba(c.accent, .16)} 46%,${pfRgba(c.accent, 0)} 74%);
  border-radius:50% 50% 46% 54%/48% 52% 48% 52%;filter:url(#pf-bleed)}
.pf-contact>*{position:relative}
.pf-contact .pf-hello{transform:none;text-align:center;margin-bottom:.2rem}
.pf-contact h2{font-family:var(--serif);font-size:clamp(1.7rem,4.5vw,2.6rem);font-weight:600;
  letter-spacing:-.025em;margin-bottom:.7rem}
.pf-contact p{color:var(--muted);max-width:44ch;margin:0 auto 1.5rem}
.pf-clist{display:flex;flex-wrap:wrap;gap:.6rem 1.6rem;justify-content:center;margin-top:1.5rem;font-size:.88rem}
.pf-clist a,.pf-clist span{color:var(--muted);text-decoration:none;display:inline-flex;align-items:center;gap:.42rem}
.pf-clist svg{width:16px;height:16px;color:var(--acc)}
.pf-clist a:hover{color:var(--acc)}
footer{padding:2.4rem 0;text-align:center;color:var(--faint);font-size:.84rem}
footer em{font-family:var(--hand);font-size:1.05rem;font-style:normal;color:var(--blush)}
@media (max-width:780px){
  .pf-nav-links{display:none}
  .pf-hero{grid-template-columns:1fr;gap:1.6rem}
  .pf-portrait{order:-1;margin:0 auto}
  .pf-when{margin-left:0;width:100%}
}
@media (prefers-reduced-motion:reduce){
  .pf-washes svg{animation:none}
  .pf-ul path{stroke-dashoffset:0;transition:none}
}`;

  const body = `
<svg class="pf-defs" aria-hidden="true"><defs>
  <!-- The bleed. Turbulence displaces the shape's own edge, so a smooth ellipse
       comes out with the ragged, feathered boundary wet pigment makes when it
       hits paper. Everything decorative on this page goes through it. -->
  <filter id="pf-bleed" x="-40%" y="-40%" width="180%" height="180%">
    <feTurbulence type="fractalNoise" baseFrequency="0.008 0.011" numOctaves="4" seed="9" result="n"/>
    <feDisplacementMap in="SourceGraphic" in2="n" scale="38" xChannelSelector="R" yChannelSelector="G"/>
    <feGaussianBlur stdDeviation="3.2"/>
  </filter>
  ${[["pf-p1", c.accent], ["pf-p2", a2], ["pf-p3", a3]].map(([id, col]) => `
  <radialGradient id="${id}" cx="42%" cy="38%" r="62%">
    <stop offset="0%" stop-color="${pfEsc(col)}" stop-opacity=".85"/>
    <stop offset="46%" stop-color="${pfEsc(col)}" stop-opacity=".5"/>
    <stop offset="78%" stop-color="${pfEsc(col)}" stop-opacity=".18"/>
    <stop offset="100%" stop-color="${pfEsc(col)}" stop-opacity="0"/>
  </radialGradient>`).join("")}
</defs></svg>

<div class="pf-washes" aria-hidden="true">
  <svg class="pf-w1" viewBox="0 0 100 100">
    <ellipse cx="50" cy="50" rx="46" ry="42" fill="url(#pf-p1)"/>
    <ellipse cx="56" cy="44" rx="30" ry="27" fill="url(#pf-p1)" opacity=".5"/></svg>
  <svg class="pf-w2" viewBox="0 0 100 100">
    <ellipse cx="50" cy="50" rx="44" ry="46" fill="url(#pf-p2)"/>
    <ellipse cx="44" cy="56" rx="27" ry="30" fill="url(#pf-p2)" opacity=".5"/></svg>
  <svg class="pf-w3" viewBox="0 0 100 100">
    <ellipse cx="50" cy="50" rx="47" ry="40" fill="url(#pf-p3)"/>
    <ellipse cx="54" cy="52" rx="29" ry="25" fill="url(#pf-p3)" opacity=".5"/></svg>
</div>
<div class="pf-grain" aria-hidden="true"></div>

<nav class="pf-nav pf-noprint"><div class="pf-shell pf-nav-in">
  <a class="pf-brand" href="#top"><i>${pfEsc(c.initials)}</i>${pfEsc(c.name)}</a>
  ${nav ? `<div class="pf-nav-links">${nav}</div>` : ""}
</div></nav>

<main id="main"><div class="pf-shell">
  <section class="pf-hero" id="top">
    <div>
      <div class="pf-hello">hello, I'm</div>
      <h1>${pfEsc(c.name)}</h1>
      ${c.title ? `<h2>${pfEsc(c.title)}</h2>` : ""}
      ${c.tagline ? `<p>${pfEsc(c.tagline)}</p>` : ""}
      <div class="pf-meta">
        ${d.location ? `<span>${pfEsc(d.location)}</span>` : ""}
        ${d.available ? `<span class="pf-avail"><i></i>${pfEsc(d.available)}</span>` : ""}
      </div>
      <div class="pf-actions">
        ${d.email ? `<a class="pf-btn pf-btn-primary" href="mailto:${pfEsc(d.email)}">${PF_ICONS.mail}${pfEsc(d.cta_text || "Say hello")}</a>` : ""}
        ${c.hasResume ? `<a class="pf-btn pf-btn-ghost" ${pfResumeAttrs(c)}>${PF_ICONS.download}${pfEsc(c.resumeLabel)}</a>` : ""}
        ${pfSocialRow(c)}
      </div>
    </div>
    <div class="pf-portrait">${pfAvatar(c)}</div>
  </section>

  ${c.has("stats") ? `<section class="pf-sec"><div class="pf-stats">
    ${d.stats.map((x, i) => `<div class="pf-card pf-stat" data-reveal data-reveal-delay="${i * 70}">
      <b>${pfEsc(x.value)}</b><span>${pfEsc(x.label)}</span></div>`).join("")}</div></section>` : ""}

  ${c.has("about") ? `<section class="pf-sec" id="about">${head("A little about me", "who's writing")}
    <div class="pf-card pf-about" data-reveal>${pfEsc(d.about)}</div></section>` : ""}

  ${c.has("skills") ? `<section class="pf-sec" id="skills">${head("What I work with", "the toolkit")}
    <div class="pf-pills" data-reveal>${d.skills.map(x => `<span class="pf-pill">${pfEsc(x)}</span>`).join("")}</div></section>` : ""}

  ${c.has("projects") ? `<section class="pf-sec" id="projects">${head("Things I have made", "selected work")}
    <div class="pf-grid">${d.projects.map((x, i) => `
      <article class="pf-card pf-proj" data-reveal data-reveal-delay="${Math.min(i, 5) * 80}">
        <h3>${pfEsc(x.name || "")}</h3>
        ${pfJoin([x.role, x.period]) ? `<div class="pf-role">${pfJoin([x.role, x.period])}</div>` : ""}
        ${x.description ? `<p>${pfEsc(x.description)}</p>` : ""}
        ${(x.bullets || []).length ? `<ul>${x.bullets.map(b => `<li>${pfEsc(b)}</li>`).join("")}</ul>` : ""}
        ${(x.tags || []).length ? `<div class="pf-tags">${x.tags.map(t => `<span class="pf-tag">${pfEsc(t)}</span>`).join("")}</div>` : ""}
        ${pfProjectLinks(x) ? `<div class="pf-links">${pfProjectLinks(x)}</div>` : ""}
      </article>`).join("")}</div></section>` : ""}

  ${c.has("experience") ? `<section class="pf-sec" id="experience">${head("The journey so far", "where I have been")}
    <div class="pf-journey">${d.experience.map((x, i) => `
      <article class="pf-stop" data-reveal data-reveal-delay="${Math.min(i, 5) * 70}">
        <div class="pf-card pf-stop-in">
          <div class="pf-stop-top"><h3>${pfEsc(x.role || "")}</h3>
            ${x.period ? `<span class="pf-when">${pfEsc(x.period)}</span>` : ""}</div>
          ${x.org ? `<div class="pf-org">${pfJoin([x.org, x.location])}</div>` : ""}
          ${x.summary ? `<p>${pfEsc(x.summary)}</p>` : ""}
          ${(x.bullets || []).length ? `<ul>${x.bullets.map(b => `<li>${pfEsc(b)}</li>`).join("")}</ul>` : ""}
        </div>
      </article>`).join("")}</div></section>` : ""}

  ${c.has("education") ? `<section class="pf-sec" id="education">${head("Where I studied", "the groundwork")}
    <div class="pf-journey">${d.education.map(x => `
      <article class="pf-stop" data-reveal>
        <div class="pf-card pf-stop-in">
          <div class="pf-stop-top"><h3>${pfEsc(x.degree || "")}</h3>
            ${x.period ? `<span class="pf-when">${pfEsc(x.period)}</span>` : ""}</div>
          ${x.school ? `<div class="pf-org">${pfEsc(x.school)}</div>` : ""}
          ${x.detail ? `<p>${pfEsc(x.detail)}</p>` : ""}
        </div>
      </article>`).join("")}</div></section>` : ""}

  ${c.has("certifications") ? `<section class="pf-sec" id="certifications">${head("Certifications", "on paper")}
    <div class="pf-notes" data-reveal>${d.certifications.map(x => `<div class="pf-card pf-note">${pfEsc(x)}</div>`).join("")}</div></section>` : ""}

  ${c.has("contact") ? `<section class="pf-sec" id="contact"><div class="pf-card pf-contact" data-reveal>
    <div class="pf-hello">get in touch</div>
    <h2>Let's talk about it</h2>
    <p>${pfEsc(d.cta_text || "Questions, projects, or just to say hello — the inbox is open.")}</p>
    <div class="pf-actions" style="justify-content:center;margin-top:0">
      ${d.email ? `<a class="pf-btn pf-btn-primary" href="mailto:${pfEsc(d.email)}">${PF_ICONS.mail}${pfEsc(d.email)}</a>` : ""}
      ${c.hasResume ? `<a class="pf-btn pf-btn-ghost" ${pfResumeAttrs(c)}>${PF_ICONS.download}Résumé</a>` : ""}
    </div>
    <div class="pf-clist">${c.links.map(x => x.url
      ? `<a href="${pfEsc(x.url)}"${/^https?:/i.test(x.url) ? ` target="_blank" rel="noopener"` : ""}>${x.icon}${pfEsc(x.handle)}</a>`
      : `<span>${x.icon}${pfEsc(x.handle)}</span>`).join("")}</div>
  </div></section>` : ""}

  <footer><em>thanks for reading</em><br>© <span data-year>${c.year}</span> ${pfEsc(c.name)}${d.footer_note ? " · " + pfEsc(d.footer_note) : ""}</footer>
</div></main>`;

  const js = `
(function(){
  var nav = document.querySelector('.pf-nav');
  var onScroll = function(){ nav.classList.toggle('pf-stuck', window.scrollY > 10); };
  onScroll(); addEventListener('scroll', onScroll, { passive:true });

  var links = [].slice.call(document.querySelectorAll('.pf-nav-links a'));
  var secs = links.map(function(a){ return document.querySelector(a.getAttribute('href')); }).filter(Boolean);
  if ('IntersectionObserver' in window && secs.length) {
    var spy = new IntersectionObserver(function(es){
      es.forEach(function(e){ if(!e.isIntersecting) return;
        links.forEach(function(a){ a.classList.toggle('pf-active', a.getAttribute('href') === '#' + e.target.id); }); });
    }, { rootMargin:'-45% 0px -50% 0px' });
    secs.forEach(function(s){ spy.observe(s); });
  }

  /* The section heads carry the drawn underline, and they are the reveal
     target themselves — PF_BASE_JS adds .pf-in, the CSS runs the dash offset
     to zero. Nothing to do here except make sure a head that is already on
     screen at load gets marked, which the shared observer handles. */
})();`;

  return { fonts: ["Newsreader:opsz,wght@6..72,400;6..72,600", "Caveat:wght@500;600",
                   c.googleFont ? null : "Inter:wght@400;500;600;700"].filter(Boolean),
           css, body, js, themeColor: "#FBF8F3" };
};


// ---------------------------------------------------------------------------
// 22. BEACON — the bright, uncluttered first-role portfolio. Two things here
//     that none of the other twenty-one have: skills grouped into a real
//     matrix rather than one long run of chips, and a contact form that
//     actually delivers a message with no server behind it.
// ---------------------------------------------------------------------------
PF_RENDERERS.beacon = (c) => {
  const d = c.d;
  const a2 = pfHueShift(c.accent, 42);
  const nav = c.navItems.map(n => `<a href="#${n.id}">${pfEsc(n.label)}</a>`).join("");
  const first = (c.name.split(" ")[0] || c.name);

  const css = `
:root{
  --acc:${c.accent}; --acc2:${a2}; --ink:#0F1222; --muted:#5A6079; --faint:#98A0B8;
  --bg:#FFFFFF; --tint:#F6F7FB; --line:#E6E9F2;
  --font:${c.fontStack || `'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif`};
}
body{background:var(--bg);color:var(--ink);font-family:var(--font);font-size:16px;line-height:1.7}
.pf-skip{background:var(--acc);color:${c.accentInk}}
.pf-shell{width:min(1060px,91vw);margin:0 auto}

/* Reading position, not decoration: on a long single-column page the bar is
   the only thing telling you how much is left. */
.pf-prog{position:fixed;top:0;left:0;height:3px;width:0;z-index:30;
  background:linear-gradient(90deg,var(--acc),var(--acc2));transition:width .1s linear}
.pf-nav{position:sticky;top:0;z-index:20;background:${pfRgba("#FFFFFF", .93)};
  backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);border-bottom:1px solid transparent;transition:.25s}
.pf-nav.pf-stuck{border-bottom-color:var(--line)}
.pf-nav-in{display:flex;align-items:center;gap:1.2rem;padding:.85rem 0}
.pf-brand{font-weight:800;font-size:1.02rem;letter-spacing:-.025em;text-decoration:none}
.pf-brand span{color:var(--acc)}
.pf-nav-links{display:flex;gap:.2rem;margin-left:auto}
.pf-nav-links a{padding:.4rem .85rem;border-radius:8px;font-size:.87rem;font-weight:500;color:var(--muted);
  text-decoration:none;transition:.2s}
.pf-nav-links a:hover,.pf-nav-links a.pf-active{color:var(--acc);background:${pfRgba(c.accent, .08)}}

.pf-hero{position:relative;padding:clamp(3rem,8vw,5.5rem) 0 clamp(2rem,5vw,3rem);overflow:hidden}
.pf-dots{position:absolute;inset:0;z-index:0;pointer-events:none;opacity:.5;
  background-image:radial-gradient(${pfRgba(c.accent, .3)} 1px,transparent 1.2px);background-size:22px 22px;
  -webkit-mask-image:radial-gradient(70% 60% at 30% 30%,#000,transparent 72%);
  mask-image:radial-gradient(70% 60% at 30% 30%,#000,transparent 72%)}
.pf-hero-in{position:relative;z-index:1;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:2.4rem;align-items:center}
.pf-badge{display:inline-flex;align-items:center;gap:.5rem;padding:.34rem .9rem;border-radius:999px;
  background:${pfRgba(c.accent, .09)};color:var(--acc);font-size:.8rem;font-weight:600;margin-bottom:1.1rem}
.pf-badge i{width:7px;height:7px;border-radius:50%;background:var(--acc);
  box-shadow:0 0 0 0 ${pfRgba(c.accent, .45)};animation:pf-ping 2.2s cubic-bezier(0,0,.2,1) infinite}
@keyframes pf-ping{70%,100%{box-shadow:0 0 0 10px ${pfRgba(c.accent, 0)}}}
.pf-hero h1{font-size:clamp(2.1rem,5.5vw,3.5rem);font-weight:800;letter-spacing:-.04em;line-height:1.06;margin-bottom:.5rem}
.pf-hero h1 span{background:linear-gradient(100deg,var(--acc),var(--acc2));
  -webkit-background-clip:text;background-clip:text;color:transparent}
.pf-hero h2{font-size:clamp(1rem,2.2vw,1.2rem);font-weight:600;color:var(--muted);margin-bottom:.8rem}
.pf-hero p{color:var(--muted);max-width:48ch}
.pf-meta{display:flex;flex-wrap:wrap;gap:.4rem 1.2rem;margin-top:.9rem;font-size:.86rem;color:var(--faint)}
.pf-portrait{width:min(190px,32vw);aspect-ratio:1;position:relative}
.pf-portrait::before{content:"";position:absolute;inset:-8%;border-radius:26px;
  background:linear-gradient(140deg,${pfRgba(c.accent, .22)},${pfRgba(a2, .18)})}
.pf-avatar{position:relative;width:100%;height:100%;object-fit:cover;border-radius:22px}
.pf-avatar-initials{display:grid;place-items:center;font-size:3rem;font-weight:800;color:#fff;
  background:linear-gradient(140deg,var(--acc),var(--acc2))}
.pf-actions{display:flex;flex-wrap:wrap;gap:.6rem;align-items:center;margin-top:1.5rem}
.pf-btn{display:inline-flex;align-items:center;gap:.5rem;padding:.75rem 1.4rem;border-radius:10px;font-weight:600;
  font-size:.9rem;text-decoration:none;border:1px solid transparent;transition:.22s;cursor:pointer}
.pf-btn svg{width:16px;height:16px}
.pf-btn-primary{background:var(--acc);color:${c.accentInk};box-shadow:0 8px 20px ${pfRgba(c.accent, .26)}}
.pf-btn-primary:hover{transform:translateY(-2px);box-shadow:0 12px 26px ${pfRgba(c.accent, .36)}}
.pf-btn-ghost{background:var(--bg);border-color:var(--line);color:var(--ink)}
.pf-btn-ghost:hover{border-color:var(--acc);color:var(--acc);transform:translateY(-2px)}
.pf-socials{display:flex;gap:.4rem}
.pf-socials a{display:grid;place-items:center;width:38px;height:38px;border-radius:10px;background:var(--bg);
  border:1px solid var(--line);color:var(--muted);transition:.22s}
.pf-socials a svg{width:16px;height:16px}
.pf-socials a:hover{color:var(--acc);border-color:var(--acc);transform:translateY(-2px)}

.pf-sec{padding:clamp(2.2rem,5.5vw,3.6rem) 0}
.pf-head{margin-bottom:1.7rem}
.pf-kicker{font-size:.73rem;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:var(--acc);margin-bottom:.4rem}
.pf-h2{font-size:clamp(1.5rem,3.4vw,2.1rem);font-weight:800;letter-spacing:-.03em}
.pf-card{background:var(--bg);border:1px solid var(--line);border-radius:14px;transition:.25s}
.pf-card:hover{border-color:${pfRgba(c.accent, .45)};transform:translateY(-3px);box-shadow:0 14px 30px rgba(15,18,34,.07)}
.pf-about{padding:1.8rem;white-space:pre-line;color:var(--muted);background:var(--tint);border-radius:14px}
.pf-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:1rem}
.pf-stat{padding:1.4rem 1rem;text-align:center;background:var(--tint);border-radius:14px}
.pf-stat b{display:block;font-size:2rem;font-weight:800;color:var(--acc);letter-spacing:-.04em;font-variant-numeric:tabular-nums}
.pf-stat span{font-size:.76rem;color:var(--faint);font-weight:600}

/* The matrix. One column per category — the thing a flat cloud of chips can
   never tell you, which is what somebody is a *language* person in versus
   what they have merely used once. */
.pf-matrix{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:1rem}
.pf-mgroup{padding:1.4rem 1.5rem}
.pf-mgroup h3{display:flex;align-items:center;gap:.5rem;font-size:.78rem;font-weight:800;letter-spacing:.11em;
  text-transform:uppercase;color:var(--faint);margin-bottom:.9rem}
.pf-mgroup h3::before{content:"";width:14px;height:3px;border-radius:2px;background:var(--acc);flex:none}
.pf-chips{display:flex;flex-wrap:wrap;gap:.4rem}
.pf-chip{padding:.34rem .8rem;border-radius:8px;font-size:.84rem;font-weight:500;color:var(--muted);
  background:var(--tint);border:1px solid transparent;transition:.2s;cursor:default}
.pf-chip:hover{color:var(--acc);background:${pfRgba(c.accent, .1)};border-color:${pfRgba(c.accent, .3)}}

.pf-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(290px,1fr));gap:1rem}
.pf-proj{padding:1.6rem;display:flex;flex-direction:column}
.pf-proj h3{font-size:1.1rem;font-weight:700;letter-spacing:-.02em;margin-bottom:.15rem}
.pf-proj .pf-role{font-size:.79rem;color:var(--acc);font-weight:600;margin-bottom:.6rem}
.pf-proj p,.pf-row p{color:var(--muted);font-size:.93rem}
.pf-proj ul,.pf-row ul{margin-top:.55rem}
.pf-proj li,.pf-row li{color:var(--muted);font-size:.89rem;padding-left:1.15rem;position:relative;margin-bottom:.24rem}
.pf-proj li::before,.pf-row li::before{content:"";position:absolute;left:0;top:.62em;width:6px;height:6px;
  border-radius:2px;background:${pfRgba(c.accent, .55)}}
.pf-tags{display:flex;flex-wrap:wrap;gap:.3rem;margin-top:.85rem}
.pf-tag{font-size:.71rem;font-weight:600;padding:.16rem .55rem;border-radius:6px;color:var(--acc);
  background:${pfRgba(c.accent, .1)}}
.pf-links{display:flex;gap:1rem;margin-top:.9rem;padding-top:.9rem;border-top:1px solid var(--line);
  font-size:.83rem;font-weight:600}
.pf-links a{color:var(--acc);text-decoration:none;display:inline-flex;align-items:center;gap:.3rem}
.pf-links a svg{width:14px;height:14px}
.pf-links a:hover{color:var(--ink)}

.pf-rows{display:grid;gap:.8rem}
.pf-row{padding:1.4rem 1.5rem}
.pf-row-top{display:flex;flex-wrap:wrap;gap:.25rem 1rem;align-items:baseline}
.pf-row h3{font-size:1.03rem;font-weight:700}
.pf-row .pf-org{color:var(--acc);font-size:.9rem;font-weight:600}
.pf-row .pf-when{margin-left:auto;color:var(--faint);font-size:.81rem;white-space:nowrap;font-variant-numeric:tabular-nums}
.pf-notes{display:grid;gap:.5rem}
.pf-note{padding:.8rem 1.2rem;background:var(--tint);border-radius:10px;color:var(--muted);font-size:.92rem;
  display:flex;gap:.7rem;align-items:center}
.pf-note::before{content:"🏅"}

/* Contact. Two columns: the form on the left, the direct routes on the right,
   because a form is not everyone's preference and hiding the email address
   behind one is a way of losing messages. */
.pf-contact{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(0,.85fr);gap:1.5rem}
.pf-formwrap{padding:1.7rem;background:var(--tint);border-radius:14px}
.pf-form{display:grid;gap:.85rem}
.pf-frow{display:grid;grid-template-columns:1fr 1fr;gap:.85rem}
.pf-form label{display:grid;gap:.32rem;font-size:.8rem;font-weight:600;color:var(--muted)}
.pf-form input,.pf-form textarea{font:inherit;font-size:.92rem;color:var(--ink);background:var(--bg);
  border:1px solid var(--line);border-radius:9px;padding:.62rem .8rem;width:100%;transition:.2s;resize:vertical}
.pf-form input:focus,.pf-form textarea:focus{outline:none;border-color:var(--acc);
  box-shadow:0 0 0 3px ${pfRgba(c.accent, .16)}}
.pf-form button{justify-content:center;width:100%}
.pf-form-note{font-size:.76rem;color:var(--faint);line-height:1.5}
.pf-reach{display:grid;gap:.55rem;align-content:start}
.pf-reach a,.pf-reach span{display:flex;align-items:center;gap:.7rem;padding:.8rem 1rem;border-radius:11px;
  border:1px solid var(--line);color:var(--ink);text-decoration:none;font-size:.9rem;transition:.22s}
.pf-reach svg{width:17px;height:17px;color:var(--acc);flex:none}
.pf-reach a:hover{border-color:var(--acc);background:${pfRgba(c.accent, .05)};transform:translateX(3px)}
.pf-reach b{font-weight:600}
.pf-reach small{display:block;color:var(--faint);font-size:.74rem}
footer{padding:2.4rem 0;text-align:center;color:var(--faint);font-size:.84rem;border-top:1px solid var(--line);
  margin-top:1.5rem}
@media (max-width:820px){
  .pf-nav-links{display:none}
  .pf-hero-in{grid-template-columns:1fr}
  .pf-portrait{order:-1}
  .pf-contact{grid-template-columns:1fr}
  .pf-row .pf-when{margin-left:0;width:100%}
}
@media (max-width:520px){.pf-frow{grid-template-columns:1fr}}
@media (prefers-reduced-motion:reduce){.pf-badge i{animation:none}.pf-prog{transition:none}}`;

  const head = (kicker, title) => `<div class="pf-head" data-reveal>
    <div class="pf-kicker">${pfEsc(kicker)}</div><h2 class="pf-h2">${pfEsc(title)}</h2></div>`;

  const body = `
<div class="pf-prog" id="pf-prog" aria-hidden="true"></div>
<nav class="pf-nav pf-noprint"><div class="pf-shell pf-nav-in">
  <a class="pf-brand" href="#top">${pfEsc(first)}<span>.dev</span></a>
  ${nav ? `<div class="pf-nav-links">${nav}</div>` : ""}
</div></nav>

<main id="main"><div class="pf-shell">
  <section class="pf-hero" id="top">
    <div class="pf-dots" aria-hidden="true"></div>
    <div class="pf-hero-in">
      <div>
        ${d.available ? `<div class="pf-badge"><i></i>${pfEsc(d.available)}</div>` : ""}
        <h1>Hi, I'm <span>${pfEsc(first)}</span></h1>
        ${c.title ? `<h2>${pfEsc(c.title)}</h2>` : ""}
        ${c.tagline ? `<p>${pfEsc(c.tagline)}</p>` : ""}
        <div class="pf-meta">${d.location ? `<span>${pfEsc(d.location)}</span>` : ""}</div>
        <div class="pf-actions">
          ${d.email ? `<a class="pf-btn pf-btn-primary" href="#contact">${PF_ICONS.mail}${pfEsc(d.cta_text || "Get in touch")}</a>` : ""}
          ${c.hasResume ? `<a class="pf-btn pf-btn-ghost" ${pfResumeAttrs(c)}>${PF_ICONS.download}${pfEsc(c.resumeLabel)}</a>` : ""}
          ${pfSocialRow(c)}
        </div>
      </div>
      <div class="pf-portrait">${pfAvatar(c)}</div>
    </div>
  </section>

  ${c.has("stats") ? `<section class="pf-sec"><div class="pf-stats">
    ${d.stats.map((x, i) => `<div class="pf-stat" data-reveal data-reveal-delay="${i * 60}">
      <b>${pfEsc(x.value)}</b><span>${pfEsc(x.label)}</span></div>`).join("")}</div></section>` : ""}

  ${c.has("about") ? `<section class="pf-sec" id="about">${head("About", "A bit about me")}
    <div class="pf-about" data-reveal>${pfEsc(d.about)}</div></section>` : ""}

  ${c.has("skills") ? `<section class="pf-sec" id="skills">${head("Skills", "What I work with")}
    <div class="pf-matrix">${c.skillGroups.map((g, i) => `
      <div class="pf-card pf-mgroup" data-reveal data-reveal-delay="${Math.min(i, 5) * 70}">
        ${g.name ? `<h3>${pfEsc(g.name)}</h3>` : ""}
        <div class="pf-chips">${g.items.map(x => `<span class="pf-chip">${pfEsc(x)}</span>`).join("")}</div>
      </div>`).join("")}</div></section>` : ""}

  ${c.has("projects") ? `<section class="pf-sec" id="projects">${head("Projects", "Things I have built")}
    <div class="pf-grid">${d.projects.map((x, i) => `
      <article class="pf-card pf-proj" data-reveal data-reveal-delay="${Math.min(i, 5) * 70}">
        <h3>${pfEsc(x.name || "")}</h3>
        ${pfJoin([x.role, x.period]) ? `<div class="pf-role">${pfJoin([x.role, x.period])}</div>` : ""}
        ${x.description ? `<p>${pfEsc(x.description)}</p>` : ""}
        ${(x.bullets || []).length ? `<ul>${x.bullets.map(b => `<li>${pfEsc(b)}</li>`).join("")}</ul>` : ""}
        ${(x.tags || []).length ? `<div class="pf-tags">${x.tags.map(t => `<span class="pf-tag">${pfEsc(t)}</span>`).join("")}</div>` : ""}
        ${pfProjectLinks(x) ? `<div class="pf-links">${pfProjectLinks(x)}</div>` : ""}
      </article>`).join("")}</div></section>` : ""}

  ${c.has("experience") ? `<section class="pf-sec" id="experience">${head("Experience", "Where I have worked")}
    <div class="pf-rows">${d.experience.map((x, i) => `
      <article class="pf-card pf-row" data-reveal data-reveal-delay="${Math.min(i, 5) * 60}">
        <div class="pf-row-top"><h3>${pfEsc(x.role || "")}</h3>
          ${x.org ? `<span class="pf-org">${pfEsc(x.org)}</span>` : ""}
          ${x.period ? `<span class="pf-when">${pfEsc(x.period)}</span>` : ""}</div>
        ${x.summary ? `<p>${pfEsc(x.summary)}</p>` : ""}
        ${(x.bullets || []).length ? `<ul>${x.bullets.map(b => `<li>${pfEsc(b)}</li>`).join("")}</ul>` : ""}
      </article>`).join("")}</div></section>` : ""}

  ${c.has("education") ? `<section class="pf-sec" id="education">${head("Education", "Where I studied")}
    <div class="pf-rows">${d.education.map(x => `
      <article class="pf-card pf-row" data-reveal>
        <div class="pf-row-top"><h3>${pfEsc(x.degree || "")}</h3>
          ${x.school ? `<span class="pf-org">${pfEsc(x.school)}</span>` : ""}
          ${x.period ? `<span class="pf-when">${pfEsc(x.period)}</span>` : ""}</div>
        ${x.detail ? `<p>${pfEsc(x.detail)}</p>` : ""}
      </article>`).join("")}</div></section>` : ""}

  ${c.has("certifications") ? `<section class="pf-sec" id="certifications">${head("Certifications", "Verified")}
    <div class="pf-notes" data-reveal>${d.certifications.map(x => `<div class="pf-note">${pfEsc(x)}</div>`).join("")}</div></section>` : ""}

  ${c.has("contact") ? `<section class="pf-sec" id="contact">${head("Contact", "Let's talk")}
    <div class="pf-contact" data-reveal>
      ${d.email ? `<div class="pf-formwrap">
        <form class="pf-form" data-pf-form novalidate>
          <div class="pf-frow">
            <label>Your name<input name="name" type="text" autocomplete="name" required></label>
            <label>Your email<input name="email" type="email" autocomplete="email" required></label>
          </div>
          <label>Message<textarea name="message" rows="5" required></textarea></label>
          <button class="pf-btn pf-btn-primary" type="submit">${PF_ICONS.mail}Send message</button>
          <p class="pf-form-note" data-pf-form-note>This opens your own email app with the message written out,
            so nothing is sent to a third party and nothing is stored anywhere.</p>
        </form>
      </div>` : ""}
      <div class="pf-reach">
        ${c.links.map(x => x.url
          ? `<a href="${pfEsc(x.url)}"${/^https?:/i.test(x.url) ? ` target="_blank" rel="noopener"` : ""}>
              ${x.icon}<span><b>${pfEsc(x.label)}</b><small>${pfEsc(x.handle)}</small></span></a>`
          : `<span>${x.icon}<span><b>${pfEsc(x.label)}</b><small>${pfEsc(x.handle)}</small></span></span>`).join("")}
        ${c.hasResume ? `<a ${pfResumeAttrs(c)}>${PF_ICONS.download}<span><b>Résumé</b><small>${pfEsc(c.resumeLabel)}</small></span></a>` : ""}
      </div>
    </div></section>` : ""}

  <footer>© <span data-year>${c.year}</span> ${pfEsc(c.name)}${d.footer_note ? " · " + pfEsc(d.footer_note) : ""}</footer>
</div></main>`;

  const js = `
(function(){
  var nav = document.querySelector('.pf-nav');
  var bar = document.getElementById('pf-prog');
  var onScroll = function(){
    nav.classList.toggle('pf-stuck', window.scrollY > 8);
    if (bar) {
      var max = document.documentElement.scrollHeight - innerHeight;
      bar.style.width = (max > 0 ? (window.scrollY / max) * 100 : 0) + '%';
    }
  };
  onScroll(); addEventListener('scroll', onScroll, { passive:true });
  addEventListener('resize', onScroll, { passive:true });

  var links = [].slice.call(document.querySelectorAll('.pf-nav-links a'));
  var secs = links.map(function(a){ return document.querySelector(a.getAttribute('href')); }).filter(Boolean);
  if ('IntersectionObserver' in window && secs.length) {
    var spy = new IntersectionObserver(function(es){
      es.forEach(function(e){ if(!e.isIntersecting) return;
        links.forEach(function(a){ a.classList.toggle('pf-active', a.getAttribute('href') === '#' + e.target.id); }); });
    }, { rootMargin:'-45% 0px -50% 0px' });
    secs.forEach(function(s){ spy.observe(s); });
  }

  /* The contact form.
     A static file has nowhere to POST to, and the usual answers are a
     third-party form service (an account, a free tier, someone else holding
     your messages) or a form that silently does nothing — which is worse than
     no form, because the sender believes they have written to you.
     This composes a mailto: instead. It always works, it needs no account, and
     the sender can see exactly what is being sent because it lands in their
     own drafts. The address is not scraped from the page any more than the
     mailto links already on it. */
  var form = document.querySelector('[data-pf-form]');
  if (!form) return;
  /* pfJsonInline, not JSON.stringify. This string is written into an inline
     script element, and JSON.stringify escapes for JavaScript but not for
     HTML: an address containing a closing script tag would end this element
     early, and everything after it would be parsed as markup. pfJsonInline
     escapes the angle brackets, so it cannot. */
  var TO = ${pfJsonInline(d.email || "")};
  var note = document.querySelector('[data-pf-form-note]');

  form.addEventListener('submit', function(e){
    e.preventDefault();
    var get = function(n){ var el = form.elements[n]; return el ? String(el.value || '').trim() : ''; };
    var name = get('name'), from = get('email'), msg = get('message');

    if (!name || !from || !msg) {
      if (note) note.textContent = 'Please fill in your name, your email and a message.';
      var firstEmpty = !name ? 'name' : (!from ? 'email' : 'message');
      if (form.elements[firstEmpty]) form.elements[firstEmpty].focus();
      return;
    }

    /* Mail clients truncate very long mailto bodies, and a silently cut
       message is exactly the failure this whole approach exists to avoid. */
    if (msg.length > 1500) {
      if (note) note.textContent = 'That message is long enough that some email apps would cut it off — '
        + 'trim it a little, or write to ' + TO + ' directly.';
      return;
    }

    var subject = 'Portfolio enquiry from ' + name;
    var bodyText = msg + '\\n\\n\\u2014 ' + name + (from ? ' <' + from + '>' : '');
    location.href = 'mailto:' + TO
      + '?subject=' + encodeURIComponent(subject)
      + '&body=' + encodeURIComponent(bodyText);
    if (note) note.textContent = 'Opening your email app with the message ready to send.';
  });
})();`;

  return { fonts: [c.googleFont ? null : "Inter:wght@400;500;600;700;800"].filter(Boolean),
           css, body, js, themeColor: "#FFFFFF" };
};


// ---------------------------------------------------------------------------
// 23. MEMPHIS — Milano 1981. Squiggles, zigzags and terrazzo confetti scattered
//     behind the content, each drifting and spinning at its own rate against
//     the scroll.
// ---------------------------------------------------------------------------
PF_RENDERERS.memphis = (c) => {
  const d = c.d;
  const a2 = pfHueShift(c.accent, 48), a3 = pfHueShift(c.accent, 160), a4 = pfHueShift(c.accent, -70);
  const nav = c.navItems.map(n => `<a href="#${n.id}">${pfEsc(n.label)}</a>`).join("");

  // Fixed positions and rates, not random: a reload must not reshuffle the
  // composition, and each shape needs its own speed or the whole field moves
  // as one sheet and reads as a background image rather than confetti.
  const SHAPES = [
    { k: "squiggle", x: "6%",  y: "12%", s: 120, r: -12, sp: 0.16, c: a2 },
    { k: "zig",      x: "88%", y: "8%",  s: 96,  r: 8,   sp: 0.28, c: a3 },
    { k: "dot",      x: "78%", y: "34%", s: 54,  r: 0,   sp: 0.22, c: c.accent },
    { k: "tri",      x: "12%", y: "48%", s: 78,  r: 18,  sp: 0.34, c: a4 },
    { k: "ring",     x: "92%", y: "62%", s: 88,  r: -6,  sp: 0.19, c: a2 },
    { k: "squiggle", x: "4%",  y: "78%", s: 104, r: 22,  sp: 0.26, c: a3 },
    { k: "zig",      x: "70%", y: "86%", s: 88,  r: -14, sp: 0.31, c: c.accent },
    { k: "dot",      x: "30%", y: "94%", s: 44,  r: 0,   sp: 0.2,  c: a4 },
  ];
  const shapeSvg = (k, col) => {
    if (k === "squiggle") return `<svg viewBox="0 0 100 40"><path d="M4 24C14 4 26 4 36 24s22 20 32 0 22-20 28-4" fill="none" stroke="${pfEsc(col)}" stroke-width="9" stroke-linecap="round"/></svg>`;
    if (k === "zig") return `<svg viewBox="0 0 100 46"><path d="M4 34 24 10l18 24L60 10l18 24 18-24" fill="none" stroke="${pfEsc(col)}" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    if (k === "tri") return `<svg viewBox="0 0 100 88"><path d="M50 4 96 84H4z" fill="${pfEsc(col)}"/></svg>`;
    if (k === "ring") return `<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="none" stroke="${pfEsc(col)}" stroke-width="12"/></svg>`;
    return `<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="42" fill="${pfEsc(col)}"/></svg>`;
  };

  const css = `
:root{
  --acc:${c.accent}; --a2:${a2}; --a3:${a3}; --a4:${a4};
  --ink:#1E1B2E; --muted:#5B5570; --faint:#918AA8;
  --bg:#FDF6E8; --card:#FFFFFF; --line:#1E1B2E;
  --font:${c.fontStack || `'Space Grotesk','Inter',-apple-system,'Segoe UI',Roboto,sans-serif`};
}
body{background:var(--bg);color:var(--ink);font-family:var(--font);font-size:16px;line-height:1.68;overflow-x:hidden}
.pf-skip{background:var(--acc);color:#fff}
.pf-shell{width:min(1060px,91vw);margin:0 auto}
.pf-field{position:fixed;inset:0;z-index:0;pointer-events:none;overflow:hidden}
.pf-sh{position:absolute;will-change:transform}
.pf-sh svg{display:block;width:100%;height:auto}
main{position:relative;z-index:2}

.pf-nav{position:sticky;top:0;z-index:20;background:${pfRgba("#FDF6E8", .93)};
  backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);border-bottom:3px solid transparent;transition:.25s}
.pf-nav.pf-stuck{border-bottom-color:var(--line)}
.pf-nav-in{display:flex;align-items:center;gap:1.1rem;padding:.8rem 0}
.pf-brand{font-weight:800;font-size:1.06rem;letter-spacing:-.03em;text-decoration:none;
  display:flex;align-items:center;gap:.55rem}
.pf-brand i{width:30px;height:30px;display:grid;place-items:center;font-size:.68rem;font-weight:800;font-style:normal;
  color:#fff;background:var(--acc);border:2.5px solid var(--line);border-radius:50%;box-shadow:3px 3px 0 var(--line)}
.pf-nav-links{display:flex;gap:.2rem;margin-left:auto}
.pf-nav-links a{padding:.34rem .8rem;border-radius:999px;font-size:.85rem;font-weight:700;color:var(--muted);
  text-decoration:none;border:2px solid transparent;transition:.2s}
.pf-nav-links a:hover,.pf-nav-links a.pf-active{color:var(--ink);background:var(--a2);border-color:var(--line)}

.pf-hero{padding:clamp(3rem,8vw,5rem) 0 clamp(2rem,5vw,3rem);text-align:center}
.pf-badge{display:inline-flex;align-items:center;gap:.5rem;padding:.36rem 1rem;border:2.5px solid var(--line);
  border-radius:999px;background:var(--a2);font-size:.82rem;font-weight:800;margin-bottom:1.4rem;
  box-shadow:4px 4px 0 var(--line);transform:rotate(-1.6deg)}
.pf-hero h1{font-size:clamp(2.4rem,7.5vw,5rem);font-weight:800;letter-spacing:-.045em;line-height:1;margin-bottom:.6rem}
.pf-hero h1 em{font-style:normal;color:var(--acc);-webkit-text-stroke:2px var(--line);paint-order:stroke fill}
.pf-hero h2{font-size:clamp(1rem,2.4vw,1.3rem);font-weight:700;color:var(--muted);margin-bottom:.8rem}
.pf-hero p{color:var(--muted);max-width:52ch;margin:0 auto}
.pf-actions{display:flex;flex-wrap:wrap;gap:.7rem;justify-content:center;align-items:center;margin-top:1.8rem}
.pf-btn{display:inline-flex;align-items:center;gap:.5rem;padding:.75rem 1.5rem;border-radius:999px;font-weight:800;
  font-size:.9rem;text-decoration:none;border:2.5px solid var(--line);transition:.16s;box-shadow:5px 5px 0 var(--line)}
.pf-btn svg{width:16px;height:16px}
.pf-btn:hover{transform:translate(-2px,-2px);box-shadow:8px 8px 0 var(--line)}
.pf-btn-primary{background:var(--acc);color:#fff}
.pf-btn-ghost{background:var(--card);color:var(--ink)}
.pf-socials{display:flex;gap:.5rem}
.pf-socials a{display:grid;place-items:center;width:42px;height:42px;border-radius:50%;background:var(--card);
  border:2.5px solid var(--line);color:var(--ink);transition:.16s;box-shadow:4px 4px 0 var(--line)}
.pf-socials a svg{width:16px;height:16px}
.pf-socials a:hover{transform:translate(-2px,-2px) rotate(-8deg);background:var(--a3);box-shadow:6px 6px 0 var(--line)}

.pf-sec{padding:clamp(2.2rem,5.5vw,3.4rem) 0}
.pf-h2{display:inline-block;font-size:clamp(1.6rem,4vw,2.4rem);font-weight:800;letter-spacing:-.035em;
  background:var(--a2);border:2.5px solid var(--line);border-radius:999px;padding:.25rem 1.3rem;
  box-shadow:5px 5px 0 var(--line);transform:rotate(-1.2deg);margin-bottom:1.6rem}
.pf-card{background:var(--card);border:2.5px solid var(--line);border-radius:20px;
  box-shadow:6px 6px 0 var(--line);transition:.18s}
.pf-card:hover{transform:translate(-3px,-3px);box-shadow:10px 10px 0 var(--acc)}
.pf-about{padding:1.8rem;white-space:pre-line;color:var(--muted)}
.pf-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:1.1rem}
.pf-stat{padding:1.5rem 1rem;text-align:center}
.pf-stat:nth-child(4n+1){background:var(--acc);color:#fff}
.pf-stat:nth-child(4n+2){background:var(--a2)}
.pf-stat:nth-child(4n+3){background:var(--a3);color:#fff}
.pf-stat:nth-child(4n){background:var(--a4);color:#fff}
.pf-stat b{display:block;font-size:2.3rem;font-weight:800;letter-spacing:-.045em;line-height:1}
.pf-stat span{font-size:.78rem;font-weight:700;opacity:.85}
.pf-chips{display:flex;flex-wrap:wrap;gap:.55rem}
.pf-chip{padding:.42rem 1rem;border-radius:999px;font-size:.88rem;font-weight:700;background:var(--card);
  border:2.5px solid var(--line);box-shadow:3px 3px 0 var(--line);transition:.16s;cursor:default}
.pf-chip:nth-child(3n+1):hover{background:var(--acc);color:#fff}
.pf-chip:nth-child(3n+2):hover{background:var(--a2)}
.pf-chip:nth-child(3n):hover{background:var(--a3);color:#fff}
.pf-chip:hover{transform:translate(-2px,-2px) rotate(-2deg);box-shadow:5px 5px 0 var(--line)}
.pf-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(290px,1fr));gap:1.4rem}
.pf-proj{padding:1.6rem}
.pf-proj h3{font-size:1.2rem;font-weight:800;letter-spacing:-.025em;margin-bottom:.15rem}
.pf-proj .pf-role,.pf-row .pf-org{font-size:.8rem;font-weight:800;color:var(--acc);margin-bottom:.65rem}
.pf-proj p,.pf-row p{color:var(--muted);font-size:.94rem}
.pf-proj ul,.pf-row ul{margin-top:.6rem}
.pf-proj li,.pf-row li{color:var(--muted);font-size:.9rem;padding-left:1.3rem;position:relative;margin-bottom:.26rem}
.pf-proj li::before,.pf-row li::before{content:"";position:absolute;left:0;top:.5em;width:9px;height:9px;
  background:var(--a3);border:2px solid var(--line);border-radius:50%}
.pf-tags{display:flex;flex-wrap:wrap;gap:.35rem;margin-top:.9rem}
.pf-tag{font-size:.72rem;font-weight:800;padding:.16rem .6rem;border-radius:999px;background:var(--a2);
  border:2px solid var(--line)}
.pf-links{display:flex;gap:1rem;margin-top:.9rem;font-size:.84rem;font-weight:800}
.pf-links a{color:var(--acc);text-decoration:none;display:inline-flex;align-items:center;gap:.3rem}
.pf-links a svg{width:14px;height:14px}
.pf-rows{display:grid;gap:1.1rem}
.pf-row{padding:1.5rem 1.7rem}
.pf-row-top{display:flex;flex-wrap:wrap;gap:.25rem 1rem;align-items:baseline}
.pf-row h3{font-size:1.1rem;font-weight:800}
.pf-row .pf-when{margin-left:auto;font-size:.8rem;font-weight:700;color:var(--faint);white-space:nowrap}
.pf-contact{padding:clamp(2rem,5vw,3.2rem);text-align:center;background:var(--acc);color:#fff}
.pf-contact h2{font-size:clamp(1.9rem,5.5vw,3rem);font-weight:800;letter-spacing:-.04em;margin-bottom:.7rem}
.pf-contact p{max-width:46ch;margin:0 auto 1.6rem;opacity:.92}
.pf-contact .pf-btn-primary{background:var(--a2);color:var(--ink)}
.pf-clist{display:flex;flex-wrap:wrap;gap:.6rem 1.6rem;justify-content:center;margin-top:1.6rem;font-size:.88rem;font-weight:600}
.pf-clist a,.pf-clist span{color:#fff;text-decoration:none;display:inline-flex;align-items:center;gap:.42rem;opacity:.92}
.pf-clist svg{width:16px;height:16px}
.pf-clist a:hover{opacity:1}
footer{padding:2.6rem 0;text-align:center;color:var(--faint);font-size:.85rem;font-weight:600}
@media (max-width:780px){.pf-nav-links{display:none}.pf-row .pf-when{margin-left:0;width:100%}
  .pf-field{opacity:.55}}
@media (prefers-reduced-motion:reduce){.pf-sh{transform:none!important}}`;

  const body = `
<div class="pf-field" aria-hidden="true">
  ${SHAPES.map(sh => `<div class="pf-sh" data-sp="${sh.sp}" data-r="${sh.r}"
    style="left:${sh.x};top:${sh.y};width:${sh.s}px;transform:rotate(${sh.r}deg)">${shapeSvg(sh.k, sh.c)}</div>`).join("")}
</div>

<nav class="pf-nav pf-noprint"><div class="pf-shell pf-nav-in">
  <a class="pf-brand" href="#top"><i>${pfEsc(c.initials)}</i>${pfEsc(c.name)}</a>
  ${nav ? `<div class="pf-nav-links">${nav}</div>` : ""}
</div></nav>

<main id="main"><div class="pf-shell">
  <section class="pf-hero" id="top">
    ${d.available ? `<div class="pf-badge">${pfEsc(d.available)}</div>` : ""}
    <h1>${pfEsc(c.name.split(" ")[0] || c.name)} <em>${pfEsc(c.name.split(" ").slice(1).join(" "))}</em></h1>
    ${c.title ? `<h2>${pfEsc(c.title)}</h2>` : ""}
    ${c.tagline ? `<p>${pfEsc(c.tagline)}</p>` : ""}
    <div class="pf-actions">
      ${d.email ? `<a class="pf-btn pf-btn-primary" href="mailto:${pfEsc(d.email)}">${PF_ICONS.mail}${pfEsc(d.cta_text || "Say hello")}</a>` : ""}
      ${c.hasResume ? `<a class="pf-btn pf-btn-ghost" ${pfResumeAttrs(c)}>${PF_ICONS.download}${pfEsc(c.resumeLabel)}</a>` : ""}
      ${pfSocialRow(c)}
    </div>
  </section>

  ${c.has("stats") ? `<section class="pf-sec"><div class="pf-stats">
    ${d.stats.map((x, i) => `<div class="pf-card pf-stat" data-reveal data-reveal-delay="${i * 70}">
      <b>${pfEsc(x.value)}</b><span>${pfEsc(x.label)}</span></div>`).join("")}</div></section>` : ""}

  ${c.has("about") ? `<section class="pf-sec" id="about"><h2 class="pf-h2">About me</h2>
    <div class="pf-card pf-about" data-reveal>${pfEsc(d.about)}</div></section>` : ""}

  ${c.has("skills") ? `<section class="pf-sec" id="skills"><h2 class="pf-h2">Skills</h2>
    <div class="pf-chips" data-reveal>${d.skills.map(x => `<span class="pf-chip">${pfEsc(x)}</span>`).join("")}</div></section>` : ""}

  ${c.has("projects") ? `<section class="pf-sec" id="projects"><h2 class="pf-h2">Work</h2>
    <div class="pf-grid">${d.projects.map((x, i) => `
      <article class="pf-card pf-proj" data-reveal data-reveal-delay="${Math.min(i, 5) * 80}">
        <h3>${pfEsc(x.name || "")}</h3>
        ${pfJoin([x.role, x.period]) ? `<div class="pf-role">${pfJoin([x.role, x.period])}</div>` : ""}
        ${x.description ? `<p>${pfEsc(x.description)}</p>` : ""}
        ${(x.bullets || []).length ? `<ul>${x.bullets.map(b => `<li>${pfEsc(b)}</li>`).join("")}</ul>` : ""}
        ${(x.tags || []).length ? `<div class="pf-tags">${x.tags.map(t => `<span class="pf-tag">${pfEsc(t)}</span>`).join("")}</div>` : ""}
        ${pfProjectLinks(x) ? `<div class="pf-links">${pfProjectLinks(x)}</div>` : ""}
      </article>`).join("")}</div></section>` : ""}

  ${c.has("experience") ? `<section class="pf-sec" id="experience"><h2 class="pf-h2">Experience</h2>
    <div class="pf-rows">${d.experience.map((x, i) => `
      <article class="pf-card pf-row" data-reveal data-reveal-delay="${Math.min(i, 5) * 70}">
        <div class="pf-row-top"><h3>${pfEsc(x.role || "")}</h3>
          ${x.period ? `<span class="pf-when">${pfEsc(x.period)}</span>` : ""}</div>
        ${x.org ? `<div class="pf-org">${pfJoin([x.org, x.location])}</div>` : ""}
        ${x.summary ? `<p>${pfEsc(x.summary)}</p>` : ""}
        ${(x.bullets || []).length ? `<ul>${x.bullets.map(b => `<li>${pfEsc(b)}</li>`).join("")}</ul>` : ""}
      </article>`).join("")}</div></section>` : ""}

  ${c.has("education") ? `<section class="pf-sec" id="education"><h2 class="pf-h2">Education</h2>
    <div class="pf-rows">${d.education.map(x => `
      <article class="pf-card pf-row" data-reveal>
        <div class="pf-row-top"><h3>${pfEsc(x.degree || "")}</h3>
          ${x.period ? `<span class="pf-when">${pfEsc(x.period)}</span>` : ""}</div>
        ${x.school ? `<div class="pf-org">${pfEsc(x.school)}</div>` : ""}
        ${x.detail ? `<p>${pfEsc(x.detail)}</p>` : ""}
      </article>`).join("")}</div></section>` : ""}

  ${c.has("certifications") ? `<section class="pf-sec" id="certifications"><h2 class="pf-h2">Certified</h2>
    <div class="pf-chips" data-reveal>${d.certifications.map(x => `<span class="pf-chip">${pfEsc(x)}</span>`).join("")}</div></section>` : ""}

  ${c.has("contact") ? `<section class="pf-sec" id="contact"><div class="pf-card pf-contact" data-reveal>
    <h2>Let's make something loud</h2>
    <p>${pfEsc(d.cta_text || "Briefs, collaborations and daft ideas all welcome.")}</p>
    <div class="pf-actions" style="margin-top:0">
      ${d.email ? `<a class="pf-btn pf-btn-primary" href="mailto:${pfEsc(d.email)}">${PF_ICONS.mail}${pfEsc(d.email)}</a>` : ""}
      ${c.hasResume ? `<a class="pf-btn pf-btn-ghost" ${pfResumeAttrs(c)}>${PF_ICONS.download}Résumé</a>` : ""}
    </div>
    <div class="pf-clist">${c.links.map(x => x.url
      ? `<a href="${pfEsc(x.url)}"${/^https?:/i.test(x.url) ? ` target="_blank" rel="noopener"` : ""}>${x.icon}${pfEsc(x.handle)}</a>`
      : `<span>${x.icon}${pfEsc(x.handle)}</span>`).join("")}</div>
  </div></section>` : ""}

  <footer>© <span data-year>${c.year}</span> ${pfEsc(c.name)}${d.footer_note ? " · " + pfEsc(d.footer_note) : ""}</footer>
</div></main>`;

  const js = `
(function(){
  var nav = document.querySelector('.pf-nav');
  var onNav = function(){ nav.classList.toggle('pf-stuck', window.scrollY > 8); };
  onNav(); addEventListener('scroll', onNav, { passive:true });

  var links = [].slice.call(document.querySelectorAll('.pf-nav-links a'));
  var secs = links.map(function(a){ return document.querySelector(a.getAttribute('href')); }).filter(Boolean);
  if ('IntersectionObserver' in window && secs.length) {
    var spy = new IntersectionObserver(function(es){
      es.forEach(function(e){ if(!e.isIntersecting) return;
        links.forEach(function(a){ a.classList.toggle('pf-active', a.getAttribute('href') === '#' + e.target.id); }); });
    }, { rootMargin:'-45% 0px -50% 0px' });
    secs.forEach(function(s){ spy.observe(s); });
  }

  /* Confetti drift.
     Each shape moves and spins at its own rate against the scroll — different
     rates are the whole point, because one shared rate makes the field read as
     a static backdrop that happens to slide. Batched into one rAF: a scroll
     event can fire many times per frame and writing eight transforms on each
     one is how a decorative layer ends up costing more than the page. */
  if (matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  var shapes = [].slice.call(document.querySelectorAll('.pf-sh'));
  var ticking = false;
  function paint(){
    ticking = false;
    var y = window.scrollY;
    for (var i = 0; i < shapes.length; i++) {
      var el = shapes[i];
      var sp = parseFloat(el.getAttribute('data-sp')) || 0.2;
      var r0 = parseFloat(el.getAttribute('data-r')) || 0;
      el.style.transform = 'translate3d(0,' + (-y * sp).toFixed(1) + 'px,0) rotate('
        + (r0 + y * sp * 0.12).toFixed(2) + 'deg)';
    }
  }
  addEventListener('scroll', function(){ if (!ticking) { ticking = true; requestAnimationFrame(paint); } }, { passive:true });
  paint();
})();`;

  return { fonts: [c.googleFont ? null : "Space+Grotesk:wght@500;700"].filter(Boolean),
           css, body, js, themeColor: "#FDF6E8" };
};


// ---------------------------------------------------------------------------
// 24. ISOMETRIC — everything sits on a 30-degree plane. Cards arrive tilted
//     into that plane and rotate flat as they reach you, so scrolling reads as
//     picking objects up off a table.
// ---------------------------------------------------------------------------
PF_RENDERERS.isometric = (c) => {
  const d = c.d;
  const a2 = pfHueShift(c.accent, 148), a3 = pfHueShift(c.accent, -46);
  const nav = c.navItems.map(n => `<a href="#${n.id}">${pfEsc(n.label)}</a>`).join("");

  const css = `
:root{
  --acc:${c.accent}; --a2:${a2}; --a3:${a3};
  --ink:#221E3D; --muted:#5C5580; --faint:#9A93BC;
  --bg:#F2F1FB; --card:#FFFFFF; --line:#DDD9F2; --edge:${pfShade(c.accent, -0.25)};
  --font:${c.fontStack || `'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif`};
}
body{background:var(--bg);color:var(--ink);font-family:var(--font);font-size:16px;line-height:1.68;overflow-x:hidden}
.pf-skip{background:var(--acc);color:#fff}
.pf-shell{width:min(1080px,91vw);margin:0 auto}

/* The plane. A flat grid rotated into isometry once, at the root — every tile
   below inherits the same 30 degrees, so nothing has to re-derive the angle. */
.pf-floor{position:fixed;inset:-40% -20%;z-index:0;pointer-events:none;
  transform:rotateX(58deg) rotateZ(45deg);transform-origin:50% 40%;
  background-image:linear-gradient(${pfRgba(c.accent, .13)} 1px,transparent 1px),
                   linear-gradient(90deg,${pfRgba(c.accent, .13)} 1px,transparent 1px);
  background-size:64px 64px;
  -webkit-mask-image:radial-gradient(60% 55% at 50% 42%,#000,transparent 78%);
  mask-image:radial-gradient(60% 55% at 50% 42%,#000,transparent 78%)}
main{position:relative;z-index:2}

.pf-nav{position:sticky;top:0;z-index:20;background:${pfRgba("#F2F1FB", .93)};
  backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border-bottom:1px solid transparent;transition:.25s}
.pf-nav.pf-stuck{border-bottom-color:var(--line)}
.pf-nav-in{display:flex;align-items:center;gap:1.2rem;padding:.85rem 0}
.pf-brand{font-weight:800;font-size:1.03rem;letter-spacing:-.025em;text-decoration:none;
  display:flex;align-items:center;gap:.6rem}
.pf-brand i{width:28px;height:28px;display:grid;place-items:center;font-size:.66rem;font-weight:800;font-style:normal;
  color:#fff;background:var(--acc);border-radius:7px;
  box-shadow:3px 3px 0 var(--edge)}
.pf-nav-links{display:flex;gap:.2rem;margin-left:auto}
.pf-nav-links a{padding:.4rem .85rem;border-radius:8px;font-size:.86rem;font-weight:600;color:var(--muted);
  text-decoration:none;transition:.2s}
.pf-nav-links a:hover,.pf-nav-links a.pf-active{color:var(--acc);background:${pfRgba(c.accent, .1)}}

.pf-hero{padding:clamp(3rem,8vw,5rem) 0 clamp(2rem,5vw,3rem);
  display:grid;grid-template-columns:minmax(0,1fr) auto;gap:2.6rem;align-items:center}
.pf-badge{display:inline-flex;align-items:center;gap:.5rem;padding:.34rem .95rem;border-radius:8px;
  background:${pfRgba(c.accent, .1)};color:var(--acc);font-size:.8rem;font-weight:700;margin-bottom:1.1rem}
.pf-hero h1{font-size:clamp(2.2rem,6vw,3.8rem);font-weight:800;letter-spacing:-.04em;line-height:1.05;margin-bottom:.5rem}
.pf-hero h2{font-size:clamp(1rem,2.2vw,1.2rem);font-weight:600;color:var(--acc);margin-bottom:.8rem}
.pf-hero p{color:var(--muted);max-width:46ch}

/* A stack of three plates, drawn once and left turning slowly. Rotating the
   whole stack rather than each plate keeps them locked in the same plane. */
.pf-stack{width:min(230px,36vw);aspect-ratio:1;position:relative;transform-style:preserve-3d;
  transform:rotateX(58deg) rotateZ(45deg);animation:pf-turn 26s linear infinite}
@keyframes pf-turn{to{transform:rotateX(58deg) rotateZ(405deg)}}
.pf-plate{position:absolute;inset:12%;border-radius:16px;box-shadow:0 10px 0 var(--edge)}
.pf-plate:nth-child(1){background:var(--acc);transform:translateZ(0)}
.pf-plate:nth-child(2){background:var(--a2);transform:translateZ(34px);inset:20%;box-shadow:0 8px 0 ${pfShade(a2, -0.28)}}
.pf-plate:nth-child(3){background:var(--a3);transform:translateZ(66px);inset:28%;box-shadow:0 6px 0 ${pfShade(a3, -0.28)};
  display:grid;place-items:center;font-size:1.5rem;font-weight:800;color:#fff}
.pf-avatar{position:absolute;inset:28%;border-radius:14px;object-fit:cover;transform:translateZ(66px);z-index:2}

.pf-actions{display:flex;flex-wrap:wrap;gap:.65rem;align-items:center;margin-top:1.6rem}
.pf-btn{display:inline-flex;align-items:center;gap:.5rem;padding:.72rem 1.4rem;border-radius:10px;font-weight:700;
  font-size:.9rem;text-decoration:none;transition:.16s;border:0}
.pf-btn svg{width:16px;height:16px}
.pf-btn-primary{background:var(--acc);color:#fff;box-shadow:0 5px 0 var(--edge)}
.pf-btn-primary:active,.pf-btn-ghost:active{transform:translateY(4px);box-shadow:0 1px 0 var(--edge)}
.pf-btn-primary:hover{transform:translateY(-2px);box-shadow:0 7px 0 var(--edge)}
.pf-btn-ghost{background:var(--card);color:var(--ink);box-shadow:0 5px 0 var(--line)}
.pf-btn-ghost:hover{transform:translateY(-2px);box-shadow:0 7px 0 var(--line)}
.pf-socials{display:flex;gap:.5rem}
.pf-socials a{display:grid;place-items:center;width:40px;height:40px;border-radius:10px;background:var(--card);
  color:var(--muted);box-shadow:0 4px 0 var(--line);transition:.16s}
.pf-socials a svg{width:16px;height:16px}
.pf-socials a:hover{color:var(--acc);transform:translateY(-2px);box-shadow:0 6px 0 var(--line)}

.pf-sec{padding:clamp(2.2rem,5.5vw,3.5rem) 0}
.pf-kicker{font-size:.72rem;font-weight:800;letter-spacing:.18em;text-transform:uppercase;color:var(--acc);margin-bottom:.4rem}
.pf-h2{font-size:clamp(1.5rem,3.6vw,2.2rem);font-weight:800;letter-spacing:-.035em;margin-bottom:1.6rem}

/* The arrival. Cards are laid into the plane and rotate out of it as they are
   reached — the reveal IS the isometry, which is why it overrides the shared
   translateY rather than adding to it. */
.pf-tile{background:var(--card);border-radius:16px;box-shadow:0 8px 0 var(--line);
  transform-style:preserve-3d;transition:transform .8s cubic-bezier(.2,.8,.25,1),opacity .7s ease,box-shadow .2s}
.pf-tile[data-reveal]{opacity:0;transform:perspective(1200px) rotateX(58deg) rotateZ(28deg) translateY(30px)}
.pf-tile[data-reveal].pf-in{opacity:1;transform:none}
.pf-tile:hover{transform:translateY(-4px);box-shadow:0 12px 0 ${pfRgba(c.accent, .35)}}
.pf-about{padding:1.9rem;white-space:pre-line;color:var(--muted)}
.pf-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:1.1rem}
.pf-stat{padding:1.5rem 1rem;text-align:center}
.pf-stat b{display:block;font-size:2.2rem;font-weight:800;color:var(--acc);letter-spacing:-.045em;line-height:1}
.pf-stat span{font-size:.77rem;color:var(--faint);font-weight:600}
.pf-chips{display:flex;flex-wrap:wrap;gap:.5rem}
.pf-chip{padding:.42rem 1rem;border-radius:9px;font-size:.87rem;font-weight:600;background:var(--card);
  color:var(--muted);box-shadow:0 3px 0 var(--line);transition:.16s;cursor:default}
.pf-chip:hover{color:var(--acc);transform:translateY(-2px);box-shadow:0 5px 0 ${pfRgba(c.accent, .4)}}
.pf-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(290px,1fr));gap:1.2rem}
.pf-proj{padding:1.6rem}
.pf-proj h3{font-size:1.14rem;font-weight:800;letter-spacing:-.02em;margin-bottom:.15rem}
.pf-proj .pf-role,.pf-row .pf-org{font-size:.79rem;color:var(--acc);font-weight:700;margin-bottom:.6rem}
.pf-proj p,.pf-row p{color:var(--muted);font-size:.93rem}
.pf-proj ul,.pf-row ul{margin-top:.55rem}
.pf-proj li,.pf-row li{color:var(--muted);font-size:.89rem;padding-left:1.15rem;position:relative;margin-bottom:.24rem}
.pf-proj li::before,.pf-row li::before{content:"";position:absolute;left:0;top:.55em;width:7px;height:7px;
  background:var(--a2);transform:rotate(45deg)}
.pf-tags{display:flex;flex-wrap:wrap;gap:.32rem;margin-top:.85rem}
.pf-tag{font-size:.71rem;font-weight:700;padding:.16rem .55rem;border-radius:6px;color:var(--acc);
  background:${pfRgba(c.accent, .1)}}
.pf-links{display:flex;gap:1rem;margin-top:.85rem;font-size:.83rem;font-weight:700}
.pf-links a{color:var(--acc);text-decoration:none;display:inline-flex;align-items:center;gap:.3rem}
.pf-links a svg{width:14px;height:14px}
.pf-rows{display:grid;gap:1rem}
.pf-row{padding:1.45rem 1.6rem}
.pf-row-top{display:flex;flex-wrap:wrap;gap:.25rem 1rem;align-items:baseline}
.pf-row h3{font-size:1.05rem;font-weight:800}
.pf-row .pf-when{margin-left:auto;color:var(--faint);font-size:.81rem;white-space:nowrap;font-weight:600}
.pf-contact{padding:clamp(2.2rem,5vw,3.4rem);text-align:center;background:var(--acc);color:#fff;
  box-shadow:0 10px 0 var(--edge)}
.pf-contact h2{font-size:clamp(1.7rem,4.5vw,2.6rem);font-weight:800;letter-spacing:-.04em;margin-bottom:.7rem}
.pf-contact p{max-width:46ch;margin:0 auto 1.5rem;opacity:.9}
.pf-contact .pf-btn-primary{background:#fff;color:var(--acc);box-shadow:0 5px 0 ${pfRgba("#000000", .18)}}
.pf-contact .pf-btn-ghost{background:${pfRgba("#ffffff", .16)};color:#fff;box-shadow:0 5px 0 ${pfRgba("#000000", .16)}}
.pf-clist{display:flex;flex-wrap:wrap;gap:.6rem 1.6rem;justify-content:center;margin-top:1.5rem;font-size:.88rem}
.pf-clist a,.pf-clist span{color:#fff;opacity:.9;text-decoration:none;display:inline-flex;align-items:center;gap:.42rem}
.pf-clist svg{width:16px;height:16px}
.pf-clist a:hover{opacity:1}
footer{padding:2.6rem 0;text-align:center;color:var(--faint);font-size:.84rem}
@media (max-width:820px){.pf-nav-links{display:none}.pf-hero{grid-template-columns:1fr}
  .pf-stack{order:-1;margin:0 auto}.pf-row .pf-when{margin-left:0;width:100%}}
@media (prefers-reduced-motion:reduce){
  .pf-stack{animation:none}
  .pf-tile[data-reveal]{opacity:1;transform:none}}`;

  const body = `
<div class="pf-floor" aria-hidden="true"></div>
<nav class="pf-nav pf-noprint"><div class="pf-shell pf-nav-in">
  <a class="pf-brand" href="#top"><i>${pfEsc(c.initials)}</i>${pfEsc(c.name)}</a>
  ${nav ? `<div class="pf-nav-links">${nav}</div>` : ""}
</div></nav>

<main id="main"><div class="pf-shell">
  <section class="pf-hero" id="top">
    <div>
      ${d.available ? `<div class="pf-badge">${pfEsc(d.available)}</div>` : ""}
      <h1>${pfEsc(c.name)}</h1>
      ${c.title ? `<h2>${pfEsc(c.title)}</h2>` : ""}
      ${c.tagline ? `<p>${pfEsc(c.tagline)}</p>` : ""}
      <div class="pf-actions">
        ${d.email ? `<a class="pf-btn pf-btn-primary" href="mailto:${pfEsc(d.email)}">${PF_ICONS.mail}${pfEsc(d.cta_text || "Get in touch")}</a>` : ""}
        ${c.hasResume ? `<a class="pf-btn pf-btn-ghost" ${pfResumeAttrs(c)}>${PF_ICONS.download}${pfEsc(c.resumeLabel)}</a>` : ""}
        ${pfSocialRow(c)}
      </div>
    </div>
    <div class="pf-stack" aria-hidden="true">
      <div class="pf-plate"></div><div class="pf-plate"></div>
      ${d.avatar ? `<div class="pf-plate"></div><img class="pf-avatar" src="${pfEsc(d.avatar)}" alt="">`
                 : `<div class="pf-plate">${pfEsc(c.initials)}</div>`}
    </div>
  </section>

  ${c.has("stats") ? `<section class="pf-sec"><div class="pf-stats">
    ${d.stats.map((x, i) => `<div class="pf-tile pf-stat" data-reveal data-reveal-delay="${i * 80}">
      <b>${pfEsc(x.value)}</b><span>${pfEsc(x.label)}</span></div>`).join("")}</div></section>` : ""}

  ${c.has("about") ? `<section class="pf-sec" id="about"><div class="pf-kicker">About</div>
    <h2 class="pf-h2">The short version</h2>
    <div class="pf-tile pf-about" data-reveal>${pfEsc(d.about)}</div></section>` : ""}

  ${c.has("skills") ? `<section class="pf-sec" id="skills"><div class="pf-kicker">Toolkit</div>
    <h2 class="pf-h2">What I work with</h2>
    <div class="pf-chips" data-reveal>${d.skills.map(x => `<span class="pf-chip">${pfEsc(x)}</span>`).join("")}</div></section>` : ""}

  ${c.has("projects") ? `<section class="pf-sec" id="projects"><div class="pf-kicker">Work</div>
    <h2 class="pf-h2">Selected projects</h2>
    <div class="pf-grid">${d.projects.map((x, i) => `
      <article class="pf-tile pf-proj" data-reveal data-reveal-delay="${Math.min(i, 5) * 90}">
        <h3>${pfEsc(x.name || "")}</h3>
        ${pfJoin([x.role, x.period]) ? `<div class="pf-role">${pfJoin([x.role, x.period])}</div>` : ""}
        ${x.description ? `<p>${pfEsc(x.description)}</p>` : ""}
        ${(x.bullets || []).length ? `<ul>${x.bullets.map(b => `<li>${pfEsc(b)}</li>`).join("")}</ul>` : ""}
        ${(x.tags || []).length ? `<div class="pf-tags">${x.tags.map(t => `<span class="pf-tag">${pfEsc(t)}</span>`).join("")}</div>` : ""}
        ${pfProjectLinks(x) ? `<div class="pf-links">${pfProjectLinks(x)}</div>` : ""}
      </article>`).join("")}</div></section>` : ""}

  ${c.has("experience") ? `<section class="pf-sec" id="experience"><div class="pf-kicker">Experience</div>
    <h2 class="pf-h2">Where I have worked</h2>
    <div class="pf-rows">${d.experience.map((x, i) => `
      <article class="pf-tile pf-row" data-reveal data-reveal-delay="${Math.min(i, 5) * 80}">
        <div class="pf-row-top"><h3>${pfEsc(x.role || "")}</h3>
          ${x.period ? `<span class="pf-when">${pfEsc(x.period)}</span>` : ""}</div>
        ${x.org ? `<div class="pf-org">${pfJoin([x.org, x.location])}</div>` : ""}
        ${x.summary ? `<p>${pfEsc(x.summary)}</p>` : ""}
        ${(x.bullets || []).length ? `<ul>${x.bullets.map(b => `<li>${pfEsc(b)}</li>`).join("")}</ul>` : ""}
      </article>`).join("")}</div></section>` : ""}

  ${c.has("education") ? `<section class="pf-sec" id="education"><div class="pf-kicker">Education</div>
    <h2 class="pf-h2">Where I studied</h2>
    <div class="pf-rows">${d.education.map(x => `
      <article class="pf-tile pf-row" data-reveal>
        <div class="pf-row-top"><h3>${pfEsc(x.degree || "")}</h3>
          ${x.period ? `<span class="pf-when">${pfEsc(x.period)}</span>` : ""}</div>
        ${x.school ? `<div class="pf-org">${pfEsc(x.school)}</div>` : ""}
        ${x.detail ? `<p>${pfEsc(x.detail)}</p>` : ""}
      </article>`).join("")}</div></section>` : ""}

  ${c.has("certifications") ? `<section class="pf-sec" id="certifications"><div class="pf-kicker">Credentials</div>
    <h2 class="pf-h2">Certifications</h2>
    <div class="pf-chips" data-reveal>${d.certifications.map(x => `<span class="pf-chip">${pfEsc(x)}</span>`).join("")}</div></section>` : ""}

  ${c.has("contact") ? `<section class="pf-sec" id="contact"><div class="pf-tile pf-contact" data-reveal>
    <h2>Let's build something</h2>
    <p>${pfEsc(d.cta_text || "Tell me what you are making and where it is stuck.")}</p>
    <div class="pf-actions" style="justify-content:center;margin-top:0">
      ${d.email ? `<a class="pf-btn pf-btn-primary" href="mailto:${pfEsc(d.email)}">${PF_ICONS.mail}${pfEsc(d.email)}</a>` : ""}
      ${c.hasResume ? `<a class="pf-btn pf-btn-ghost" ${pfResumeAttrs(c)}>${PF_ICONS.download}Résumé</a>` : ""}
    </div>
    <div class="pf-clist">${c.links.map(x => x.url
      ? `<a href="${pfEsc(x.url)}"${/^https?:/i.test(x.url) ? ` target="_blank" rel="noopener"` : ""}>${x.icon}${pfEsc(x.handle)}</a>`
      : `<span>${x.icon}${pfEsc(x.handle)}</span>`).join("")}</div>
  </div></section>` : ""}

  <footer>© <span data-year>${c.year}</span> ${pfEsc(c.name)}${d.footer_note ? " · " + pfEsc(d.footer_note) : ""}</footer>
</div></main>`;

  const js = `
(function(){
  var nav = document.querySelector('.pf-nav');
  var onNav = function(){ nav.classList.toggle('pf-stuck', window.scrollY > 8); };
  onNav(); addEventListener('scroll', onNav, { passive:true });
  var links = [].slice.call(document.querySelectorAll('.pf-nav-links a'));
  var secs = links.map(function(a){ return document.querySelector(a.getAttribute('href')); }).filter(Boolean);
  if ('IntersectionObserver' in window && secs.length) {
    var spy = new IntersectionObserver(function(es){
      es.forEach(function(e){ if(!e.isIntersecting) return;
        links.forEach(function(a){ a.classList.toggle('pf-active', a.getAttribute('href') === '#' + e.target.id); }); });
    }, { rootMargin:'-45% 0px -50% 0px' });
    secs.forEach(function(s){ spy.observe(s); });
  }
  /* The floor drifts a fraction of the scroll so the plane feels like it
     extends past the viewport rather than being painted onto it. */
  var floor = document.querySelector('.pf-floor');
  if (floor && !(matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches)) {
    var t = false;
    addEventListener('scroll', function(){
      if (t) return; t = true;
      requestAnimationFrame(function(){ t = false;
        floor.style.backgroundPosition = '0 ' + (window.scrollY * 0.12).toFixed(1) + 'px'; });
    }, { passive:true });
  }
})();`;

  return { fonts: [c.googleFont ? null : "Inter:wght@400;600;700;800"].filter(Boolean),
           css, body, js, themeColor: "#F2F1FB" };
};


// ---------------------------------------------------------------------------
// 25. COMIC — inked panels. Heavy borders, hard shadows, a speech bubble with a
//     real tail, and a halftone starburst that spins slowly behind every
//     section heading.
// ---------------------------------------------------------------------------
PF_RENDERERS.comic = (c) => {
  const d = c.d;
  const a2 = pfHueShift(c.accent, 46), a3 = pfHueShift(c.accent, 200);
  const nav = c.navItems.map(n => `<a href="#${n.id}">${pfEsc(n.label)}</a>`).join("");
  const bangs = ["POW!", "ZAP!", "BAM!", "WHAM!", "BOOM!", "KAPOW!"];

  const css = `
:root{
  --acc:${c.accent}; --a2:${a2}; --a3:${a3};
  --ink:#141414; --muted:#4A4A4A; --faint:#8A8A8A;
  --bg:#FFFDF5; --card:#FFFFFF;
  --font:${c.fontStack || `'Bangers','Impact','Arial Black',sans-serif`};
  --body:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;
}
body{background:var(--bg);color:var(--ink);font-family:var(--body);font-size:16px;line-height:1.66;overflow-x:hidden}
.pf-skip{background:var(--acc);color:#fff}
.pf-shell{width:min(1060px,91vw);margin:0 auto}
/* Ben Day dots over the whole page, faint enough to be paper rather than art. */
.pf-benday{position:fixed;inset:0;z-index:0;pointer-events:none;opacity:.35;
  background-image:radial-gradient(${pfRgba(c.accent, .5)} 1.1px,transparent 1.2px);background-size:8px 8px}
main{position:relative;z-index:2}

.pf-nav{position:sticky;top:0;z-index:20;background:${pfRgba("#FFFDF5", .95)};border-bottom:4px solid var(--ink)}
.pf-nav-in{display:flex;align-items:center;gap:1.1rem;padding:.7rem 0}
.pf-brand{font-family:var(--font);font-size:1.5rem;letter-spacing:.02em;text-decoration:none;
  color:var(--ink);-webkit-text-stroke:0;display:flex;align-items:center;gap:.55rem}
.pf-brand i{width:30px;height:30px;display:grid;place-items:center;font-family:var(--body);font-size:.66rem;
  font-weight:800;font-style:normal;color:#fff;background:var(--acc);border:3px solid var(--ink);border-radius:50%}
.pf-nav-links{display:flex;gap:.9rem;margin-left:auto}
.pf-nav-links a{font-family:var(--font);font-size:1rem;letter-spacing:.04em;color:var(--muted);
  text-decoration:none;transition:.15s}
.pf-nav-links a:hover,.pf-nav-links a.pf-active{color:var(--acc);transform:rotate(-3deg);display:inline-block}

/* A panel. The border and the hard offset are the entire visual language —
   everything on this page is a box that has been inked. */
.pf-panel{background:var(--card);border:4px solid var(--ink);border-radius:4px;box-shadow:8px 8px 0 var(--ink);
  transition:.16s}
.pf-panel:hover{transform:translate(-3px,-3px);box-shadow:12px 12px 0 var(--acc)}

.pf-hero{padding:clamp(2.4rem,6vw,3.6rem) 0}
.pf-hero-in{display:grid;grid-template-columns:minmax(0,1.25fr) minmax(0,.75fr);gap:1.4rem;align-items:stretch}
.pf-hero-main{padding:clamp(1.6rem,4vw,2.4rem);position:relative;overflow:hidden}
.pf-burst{position:absolute;right:-70px;top:-70px;width:240px;height:240px;opacity:.24;
  animation:pf-spin 44s linear infinite}
@keyframes pf-spin{to{transform:rotate(360deg)}}
.pf-kick{display:inline-block;font-family:var(--font);font-size:1.15rem;letter-spacing:.06em;color:#fff;
  background:var(--a3);border:3px solid var(--ink);padding:.1rem .8rem;transform:rotate(-2.5deg);margin-bottom:.9rem;
  position:relative}
.pf-hero h1{position:relative;font-family:var(--font);font-size:clamp(2.6rem,8vw,5rem);line-height:.95;
  letter-spacing:.01em;margin-bottom:.5rem;color:var(--acc);
  -webkit-text-stroke:3px var(--ink);paint-order:stroke fill;
  text-shadow:5px 5px 0 var(--a2)}
.pf-hero h2{position:relative;font-family:var(--font);font-size:clamp(1.1rem,2.8vw,1.6rem);letter-spacing:.04em;
  color:var(--ink);margin-bottom:.8rem}
/* The bubble tail is a rotated square poking out from under the box — two
   borders on one corner, which is cheaper and crisper than an SVG. */
.pf-bubble{position:relative;background:var(--card);border:4px solid var(--ink);border-radius:22px;
  padding:1.1rem 1.3rem;margin-top:1rem;font-size:.98rem;color:var(--muted)}
.pf-bubble::after{content:"";position:absolute;left:38px;bottom:-15px;width:22px;height:22px;background:var(--card);
  border-right:4px solid var(--ink);border-bottom:4px solid var(--ink);transform:rotate(45deg)}
.pf-hero-side{display:grid;gap:1.4rem;align-content:start}
.pf-portrait{padding:1rem;display:grid;place-items:center}
.pf-avatar{width:100%;aspect-ratio:1;object-fit:cover;border:4px solid var(--ink);border-radius:3px}
.pf-avatar-initials{display:grid;place-items:center;font-family:var(--font);font-size:3.4rem;color:#fff;
  background:var(--acc)}
.pf-facts{padding:1.1rem 1.3rem;display:grid;gap:.5rem;font-size:.88rem;font-weight:600}
.pf-facts div{display:flex;gap:.6rem;align-items:center;color:var(--muted)}
.pf-facts b{font-family:var(--font);font-size:1.05rem;letter-spacing:.04em;color:var(--acc)}

.pf-actions{display:flex;flex-wrap:wrap;gap:.6rem;align-items:center;margin-top:1.4rem;position:relative}
.pf-btn{display:inline-flex;align-items:center;gap:.5rem;padding:.6rem 1.3rem;font-family:var(--font);
  font-size:1.05rem;letter-spacing:.05em;text-decoration:none;border:3px solid var(--ink);border-radius:4px;
  box-shadow:5px 5px 0 var(--ink);transition:.14s}
.pf-btn svg{width:16px;height:16px}
.pf-btn:hover{transform:translate(-2px,-2px);box-shadow:8px 8px 0 var(--ink)}
.pf-btn-primary{background:var(--acc);color:#fff}
.pf-btn-ghost{background:var(--a2);color:var(--ink)}
.pf-socials{display:flex;gap:.45rem}
.pf-socials a{display:grid;place-items:center;width:40px;height:40px;background:var(--card);
  border:3px solid var(--ink);border-radius:4px;color:var(--ink);box-shadow:4px 4px 0 var(--ink);transition:.14s}
.pf-socials a svg{width:16px;height:16px}
.pf-socials a:hover{background:var(--a3);color:#fff;transform:translate(-2px,-2px) rotate(-6deg)}

.pf-sec{padding:clamp(1.8rem,4.5vw,2.8rem) 0}
.pf-head{position:relative;display:inline-block;margin-bottom:1.5rem}
.pf-h2{position:relative;z-index:1;font-family:var(--font);font-size:clamp(1.9rem,5vw,3rem);letter-spacing:.02em;
  color:var(--ink);-webkit-text-stroke:0}
.pf-h2 span{color:var(--acc)}
.pf-bang{position:absolute;right:-64px;top:-18px;z-index:0;font-family:var(--font);font-size:1.05rem;color:#fff;
  background:var(--a3);border:3px solid var(--ink);border-radius:50%;width:58px;height:58px;display:grid;
  place-items:center;transform:rotate(-14deg);letter-spacing:.03em}
.pf-about{padding:1.7rem;white-space:pre-line;color:var(--muted)}
.pf-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(148px,1fr));gap:1.2rem}
.pf-stat{padding:1.3rem 1rem;text-align:center}
.pf-stat:nth-child(3n+1){background:var(--a2)}
.pf-stat:nth-child(3n+2){background:var(--card)}
.pf-stat:nth-child(3n){background:var(--acc);color:#fff}
.pf-stat b{display:block;font-family:var(--font);font-size:2.4rem;letter-spacing:.02em;line-height:1}
.pf-stat span{font-size:.75rem;font-weight:700;opacity:.85}
.pf-chips{display:flex;flex-wrap:wrap;gap:.55rem}
.pf-chip{font-family:var(--font);font-size:1rem;letter-spacing:.04em;padding:.18rem .8rem;background:var(--card);
  border:3px solid var(--ink);border-radius:4px;box-shadow:3px 3px 0 var(--ink);transition:.14s;cursor:default}
.pf-chip:nth-child(2n):hover{background:var(--a2)}
.pf-chip:nth-child(2n+1):hover{background:var(--acc);color:#fff}
.pf-chip:hover{transform:translate(-2px,-2px) rotate(-2deg);box-shadow:5px 5px 0 var(--ink)}
.pf-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(290px,1fr));gap:1.4rem}
.pf-proj{padding:1.5rem}
.pf-proj h3{font-family:var(--font);font-size:1.4rem;letter-spacing:.02em;margin-bottom:.1rem}
.pf-proj .pf-role,.pf-row .pf-org{font-size:.78rem;font-weight:800;letter-spacing:.06em;text-transform:uppercase;
  color:var(--acc);margin-bottom:.6rem}
.pf-proj p,.pf-row p{color:var(--muted);font-size:.93rem}
.pf-proj ul,.pf-row ul{margin-top:.55rem}
.pf-proj li,.pf-row li{color:var(--muted);font-size:.89rem;padding-left:1.25rem;position:relative;margin-bottom:.24rem}
.pf-proj li::before,.pf-row li::before{content:"★";position:absolute;left:0;color:var(--a2);
  -webkit-text-stroke:.6px var(--ink)}
.pf-tags{display:flex;flex-wrap:wrap;gap:.32rem;margin-top:.85rem}
.pf-tag{font-size:.7rem;font-weight:800;letter-spacing:.05em;text-transform:uppercase;padding:.14rem .5rem;
  background:var(--a2);border:2px solid var(--ink)}
.pf-links{display:flex;gap:1rem;margin-top:.85rem;font-family:var(--font);font-size:.98rem;letter-spacing:.04em}
.pf-links a{color:var(--acc);text-decoration:none;display:inline-flex;align-items:center;gap:.3rem}
.pf-links a svg{width:14px;height:14px}
.pf-rows{display:grid;gap:1.3rem}
.pf-row{padding:1.4rem 1.6rem}
.pf-row-top{display:flex;flex-wrap:wrap;gap:.25rem 1rem;align-items:baseline}
.pf-row h3{font-family:var(--font);font-size:1.3rem;letter-spacing:.02em}
.pf-row .pf-when{margin-left:auto;font-size:.78rem;font-weight:800;letter-spacing:.05em;color:var(--faint);white-space:nowrap}
.pf-contact{padding:clamp(2rem,5vw,3.2rem);text-align:center;background:var(--acc);color:#fff}
.pf-contact h2{font-family:var(--font);font-size:clamp(2.2rem,6.5vw,3.8rem);letter-spacing:.02em;margin-bottom:.6rem;
  -webkit-text-stroke:3px var(--ink);paint-order:stroke fill;text-shadow:5px 5px 0 var(--a2)}
.pf-contact p{max-width:44ch;margin:0 auto 1.5rem;opacity:.94}
.pf-contact .pf-btn-primary{background:var(--a2);color:var(--ink)}
.pf-contact .pf-btn-ghost{background:var(--card);color:var(--ink)}
.pf-clist{display:flex;flex-wrap:wrap;gap:.6rem 1.5rem;justify-content:center;margin-top:1.5rem;font-size:.87rem;
  font-weight:700}
.pf-clist a,.pf-clist span{color:#fff;text-decoration:none;display:inline-flex;align-items:center;gap:.4rem;opacity:.94}
.pf-clist svg{width:16px;height:16px}
footer{padding:2.4rem 0;text-align:center;font-family:var(--font);font-size:1.05rem;letter-spacing:.05em;color:var(--faint)}
@media (max-width:820px){.pf-nav-links{display:none}.pf-hero-in{grid-template-columns:1fr}
  .pf-bang{right:-10px;top:-40px}.pf-row .pf-when{margin-left:0;width:100%}}
@media (prefers-reduced-motion:reduce){.pf-burst{animation:none}}`;

  const burst = `<svg class="pf-burst" viewBox="0 0 100 100" aria-hidden="true">
    ${Array.from({ length: 24 }, (_, i) => {
      const a = (Math.PI * 2 / 24) * i, r1 = 16, r2 = i % 2 ? 34 : 48;
      return `${i ? "L" : "M"}${(50 + Math.cos(a) * r2).toFixed(1)} ${(50 + Math.sin(a) * r2).toFixed(1)}` +
             `L${(50 + Math.cos(a + Math.PI / 24) * r1).toFixed(1)} ${(50 + Math.sin(a + Math.PI / 24) * r1).toFixed(1)}`;
    }).join("")}Z<path d="" /></svg>`.replace("<svg", "<svg").replace(/(\$\{[^}]*\})/g, "$1");

  const burstSvg = `<svg class="pf-burst" viewBox="0 0 100 100" aria-hidden="true"><path fill="${pfEsc(a2)}" d="${
    Array.from({ length: 24 }, (_, i) => {
      const a = (Math.PI * 2 / 24) * i;
      const r2 = i % 2 ? 30 : 48;
      return `${i ? "L" : "M"}${(50 + Math.cos(a) * r2).toFixed(1)} ${(50 + Math.sin(a) * r2).toFixed(1)}`;
    }).join("")}Z"/></svg>`;

  const head = (title, hi, i) => `<div class="pf-head" data-reveal>
    <h2 class="pf-h2">${pfEsc(title)} <span>${pfEsc(hi)}</span></h2>
    <span class="pf-bang">${pfEsc(bangs[i % bangs.length])}</span></div>`;

  const body = `
<div class="pf-benday" aria-hidden="true"></div>
<nav class="pf-nav pf-noprint"><div class="pf-shell pf-nav-in">
  <a class="pf-brand" href="#top"><i>${pfEsc(c.initials)}</i>${pfEsc(c.name)}</a>
  ${nav ? `<div class="pf-nav-links">${nav}</div>` : ""}
</div></nav>

<main id="main"><div class="pf-shell">
  <section class="pf-hero" id="top"><div class="pf-hero-in">
    <div class="pf-panel pf-hero-main">
      ${burstSvg}
      ${d.available ? `<div class="pf-kick">${pfEsc(d.available)}</div>` : ""}
      <h1>${pfEsc(c.name)}</h1>
      ${c.title ? `<h2>${pfEsc(c.title)}</h2>` : ""}
      ${c.tagline ? `<div class="pf-bubble">${pfEsc(c.tagline)}</div>` : ""}
      <div class="pf-actions">
        ${d.email ? `<a class="pf-btn pf-btn-primary" href="mailto:${pfEsc(d.email)}">${PF_ICONS.mail}${pfEsc(d.cta_text || "Get in touch")}</a>` : ""}
        ${c.hasResume ? `<a class="pf-btn pf-btn-ghost" ${pfResumeAttrs(c)}>${PF_ICONS.download}Résumé</a>` : ""}
        ${pfSocialRow(c)}
      </div>
    </div>
    <div class="pf-hero-side">
      <div class="pf-panel pf-portrait">${pfAvatar(c)}</div>
      <div class="pf-panel pf-facts">
        ${d.location ? `<div><b>Base</b>${pfEsc(d.location)}</div>` : ""}
        ${d.projects.length ? `<div><b>Built</b>${d.projects.length} projects</div>` : ""}
        ${d.experience.length ? `<div><b>Roles</b>${d.experience.length}</div>` : ""}
      </div>
    </div>
  </div></section>

  ${c.has("stats") ? `<section class="pf-sec"><div class="pf-stats">
    ${d.stats.map((x, i) => `<div class="pf-panel pf-stat" data-reveal data-reveal-delay="${i * 70}">
      <b>${pfEsc(x.value)}</b><span>${pfEsc(x.label)}</span></div>`).join("")}</div></section>` : ""}

  ${c.has("about") ? `<section class="pf-sec" id="about">${head("Origin", "story", 0)}
    <div class="pf-panel pf-about" data-reveal>${pfEsc(d.about)}</div></section>` : ""}

  ${c.has("skills") ? `<section class="pf-sec" id="skills">${head("Super", "powers", 1)}
    <div class="pf-chips" data-reveal>${d.skills.map(x => `<span class="pf-chip">${pfEsc(x)}</span>`).join("")}</div></section>` : ""}

  ${c.has("projects") ? `<section class="pf-sec" id="projects">${head("The", "work", 2)}
    <div class="pf-grid">${d.projects.map((x, i) => `
      <article class="pf-panel pf-proj" data-reveal data-reveal-delay="${Math.min(i, 5) * 80}">
        <h3>${pfEsc(x.name || "")}</h3>
        ${pfJoin([x.role, x.period]) ? `<div class="pf-role">${pfJoin([x.role, x.period])}</div>` : ""}
        ${x.description ? `<p>${pfEsc(x.description)}</p>` : ""}
        ${(x.bullets || []).length ? `<ul>${x.bullets.map(b => `<li>${pfEsc(b)}</li>`).join("")}</ul>` : ""}
        ${(x.tags || []).length ? `<div class="pf-tags">${x.tags.map(t => `<span class="pf-tag">${pfEsc(t)}</span>`).join("")}</div>` : ""}
        ${pfProjectLinks(x) ? `<div class="pf-links">${pfProjectLinks(x)}</div>` : ""}
      </article>`).join("")}</div></section>` : ""}

  ${c.has("experience") ? `<section class="pf-sec" id="experience">${head("Issue", "history", 3)}
    <div class="pf-rows">${d.experience.map((x, i) => `
      <article class="pf-panel pf-row" data-reveal data-reveal-delay="${Math.min(i, 5) * 70}">
        <div class="pf-row-top"><h3>${pfEsc(x.role || "")}</h3>
          ${x.period ? `<span class="pf-when">${pfEsc(x.period)}</span>` : ""}</div>
        ${x.org ? `<div class="pf-org">${pfJoin([x.org, x.location])}</div>` : ""}
        ${x.summary ? `<p>${pfEsc(x.summary)}</p>` : ""}
        ${(x.bullets || []).length ? `<ul>${x.bullets.map(b => `<li>${pfEsc(b)}</li>`).join("")}</ul>` : ""}
      </article>`).join("")}</div></section>` : ""}

  ${c.has("education") ? `<section class="pf-sec" id="education">${head("Training", "arc", 4)}
    <div class="pf-rows">${d.education.map(x => `
      <article class="pf-panel pf-row" data-reveal>
        <div class="pf-row-top"><h3>${pfEsc(x.degree || "")}</h3>
          ${x.period ? `<span class="pf-when">${pfEsc(x.period)}</span>` : ""}</div>
        ${x.school ? `<div class="pf-org">${pfEsc(x.school)}</div>` : ""}
        ${x.detail ? `<p>${pfEsc(x.detail)}</p>` : ""}
      </article>`).join("")}</div></section>` : ""}

  ${c.has("certifications") ? `<section class="pf-sec" id="certifications">${head("Badges", "earned", 5)}
    <div class="pf-chips" data-reveal>${d.certifications.map(x => `<span class="pf-chip">${pfEsc(x)}</span>`).join("")}</div></section>` : ""}

  ${c.has("contact") ? `<section class="pf-sec" id="contact"><div class="pf-panel pf-contact" data-reveal>
    <h2>Get in touch!</h2>
    <p>${pfEsc(d.cta_text || "Send a signal. I answer everything that isn't a form letter.")}</p>
    <div class="pf-actions" style="justify-content:center;margin-top:0">
      ${d.email ? `<a class="pf-btn pf-btn-primary" href="mailto:${pfEsc(d.email)}">${PF_ICONS.mail}${pfEsc(d.email)}</a>` : ""}
      ${c.hasResume ? `<a class="pf-btn pf-btn-ghost" ${pfResumeAttrs(c)}>${PF_ICONS.download}Résumé</a>` : ""}
    </div>
    <div class="pf-clist">${c.links.map(x => x.url
      ? `<a href="${pfEsc(x.url)}"${/^https?:/i.test(x.url) ? ` target="_blank" rel="noopener"` : ""}>${x.icon}${pfEsc(x.handle)}</a>`
      : `<span>${x.icon}${pfEsc(x.handle)}</span>`).join("")}</div>
  </div></section>` : ""}

  <footer>© <span data-year>${c.year}</span> ${pfEsc(c.name)}${d.footer_note ? " · " + pfEsc(d.footer_note) : ""}</footer>
</div></main>`;

  const js = `
(function(){
  var links = [].slice.call(document.querySelectorAll('.pf-nav-links a'));
  var secs = links.map(function(a){ return document.querySelector(a.getAttribute('href')); }).filter(Boolean);
  if ('IntersectionObserver' in window && secs.length) {
    var spy = new IntersectionObserver(function(es){
      es.forEach(function(e){ if(!e.isIntersecting) return;
        links.forEach(function(a){ a.classList.toggle('pf-active', a.getAttribute('href') === '#' + e.target.id); }); });
    }, { rootMargin:'-45% 0px -50% 0px' });
    secs.forEach(function(s){ spy.observe(s); });
  }
})();`;

  return { fonts: ["Bangers", c.googleFont ? null : "Inter:wght@400;600;700;800"].filter(Boolean),
           css, body, js, themeColor: "#FFFDF5" };
};


// ---------------------------------------------------------------------------
// 26. BOARDING PASS — every section is a perforated stub. Notches punched out
//     of both edges, a dashed tear line, a real barcode and an ink stamp that
//     lands with a thump when the section arrives.
// ---------------------------------------------------------------------------
PF_RENDERERS.ticket = (c) => {
  const d = c.d;
  const a2 = pfHueShift(c.accent, 168);
  const nav = c.navItems.map(n => `<a href="#${n.id}">${pfEsc(n.label)}</a>`).join("");
  // A barcode that is deliberately not scannable — it is a texture, and
  // encoding anything real into it would be a small lie on someone's CV.
  const bars = (seed) => {
    let x = seed * 9301 % 233280, out = [];
    for (let i = 0; i < 46; i++) { x = (x * 9301 + 49297) % 233280; out.push(1 + (x % 3)); }
    return out.map(w => `<i style="width:${w}px"></i>`).join("");
  };
  const code = (c.initials + String(c.year)).toUpperCase();

  const css = `
:root{
  --acc:${c.accent}; --a2:${a2}; --ink:#16302F; --muted:#4F6B6A; --faint:#8AA3A2;
  --bg:#F4F7F6; --card:#FFFFFF; --line:#D9E4E2;
  --mono:'JetBrains Mono','SFMono-Regular',Consolas,'Liberation Mono',monospace;
  --font:${c.fontStack || `'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif`};
}
body{background:var(--bg);color:var(--ink);font-family:var(--font);font-size:16px;line-height:1.66}
.pf-skip{background:var(--acc);color:#fff}
.pf-shell{width:min(980px,92vw);margin:0 auto}
.pf-nav{position:sticky;top:0;z-index:20;background:${pfRgba("#F4F7F6", .94)};
  backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border-bottom:1px dashed var(--line)}
.pf-nav-in{display:flex;align-items:center;gap:1.1rem;padding:.8rem 0}
.pf-brand{font-family:var(--mono);font-weight:700;font-size:.92rem;letter-spacing:.04em;text-decoration:none;
  display:flex;align-items:center;gap:.6rem}
.pf-brand i{width:28px;height:28px;display:grid;place-items:center;font-size:.64rem;font-style:normal;
  color:#fff;background:var(--acc);border-radius:6px}
.pf-nav-links{display:flex;gap:.15rem;margin-left:auto}
.pf-nav-links a{font-family:var(--mono);font-size:.75rem;letter-spacing:.05em;text-transform:uppercase;
  color:var(--muted);text-decoration:none;padding:.35rem .7rem;border-radius:6px;transition:.2s}
.pf-nav-links a:hover,.pf-nav-links a.pf-active{color:var(--acc);background:${pfRgba(c.accent, .1)}}

/* The stub.
   Two notches punched out of the side edges with radial-gradients on the card
   itself, so the shape survives any background behind it — a pseudo-element
   circle painted in the page colour only works while the page colour never
   changes. The dashed rule between them is the tear. */
.pf-stub{position:relative;background:var(--card);border-radius:14px;box-shadow:0 8px 26px rgba(22,48,47,.08);
  transition:.25s;
  -webkit-mask:radial-gradient(13px at 0 var(--notch,50%),transparent 98%,#000) left/51% 100% no-repeat,
               radial-gradient(13px at 100% var(--notch,50%),transparent 98%,#000) right/51% 100% no-repeat;
  mask:radial-gradient(13px at 0 var(--notch,50%),transparent 98%,#000) left/51% 100% no-repeat,
       radial-gradient(13px at 100% var(--notch,50%),transparent 98%,#000) right/51% 100% no-repeat}
.pf-stub:hover{transform:translateY(-3px);box-shadow:0 14px 34px rgba(22,48,47,.13)}
.pf-tear{position:absolute;left:14px;right:14px;height:0;border-top:2px dashed var(--line);pointer-events:none}

.pf-hero{padding:clamp(2.2rem,6vw,3.4rem) 0 clamp(1.4rem,3vw,2rem)}
.pf-pass{--notch:132px;display:grid;grid-template-columns:minmax(0,1fr) 214px}
.pf-pass-main{padding:clamp(1.6rem,4vw,2.3rem)}
.pf-pass-side{padding:clamp(1.4rem,3vw,1.8rem);border-left:2px dashed var(--line);display:grid;
  align-content:space-between;gap:1rem}
.pf-air{display:flex;align-items:center;justify-content:space-between;gap:1rem;
  padding-bottom:.9rem;margin-bottom:1.1rem;border-bottom:1px solid var(--line)}
.pf-air b{font-family:var(--mono);font-size:.74rem;letter-spacing:.16em;text-transform:uppercase;color:var(--acc)}
.pf-air span{font-family:var(--mono);font-size:.72rem;color:var(--faint);letter-spacing:.08em}
.pf-route{display:flex;align-items:center;gap:1rem;margin-bottom:1.2rem}
.pf-route div{font-family:var(--mono)}
.pf-route dt{font-size:.64rem;letter-spacing:.14em;text-transform:uppercase;color:var(--faint)}
.pf-route dd{margin:0;font-size:1.5rem;font-weight:700;letter-spacing:.04em;color:var(--ink)}
.pf-plane{flex:1;height:1px;border-top:2px dotted var(--line);position:relative}
.pf-plane::after{content:"✈";position:absolute;right:-4px;top:-12px;color:var(--acc);font-size:1.05rem}
.pf-pass h1{font-size:clamp(1.9rem,5vw,3rem);font-weight:800;letter-spacing:-.035em;line-height:1.06;margin-bottom:.35rem}
.pf-pass h2{font-size:clamp(.92rem,2vw,1.08rem);font-weight:600;color:var(--acc);margin-bottom:.7rem}
.pf-pass p{color:var(--muted);max-width:44ch;font-size:.95rem}
.pf-fields{display:grid;grid-template-columns:repeat(auto-fit,minmax(88px,1fr));gap:.9rem;margin-top:1.2rem}
.pf-fields div{font-family:var(--mono)}
.pf-fields dt{font-size:.62rem;letter-spacing:.13em;text-transform:uppercase;color:var(--faint)}
.pf-fields dd{margin:0;font-size:.86rem;font-weight:700;color:var(--ink)}
.pf-barcode{display:flex;gap:1.5px;align-items:flex-end;height:56px}
.pf-barcode i{display:block;height:100%;background:var(--ink);border-radius:.5px}
.pf-barcode.pf-short{height:38px}
.pf-code{font-family:var(--mono);font-size:.66rem;letter-spacing:.24em;color:var(--faint);text-align:center;margin-top:.4rem}
.pf-avatar{width:100%;aspect-ratio:1;object-fit:cover;border-radius:10px}
.pf-avatar-initials{display:grid;place-items:center;font-size:2.2rem;font-weight:800;color:#fff;background:var(--acc)}

.pf-actions{display:flex;flex-wrap:wrap;gap:.6rem;align-items:center;margin-top:1.4rem}
.pf-btn{display:inline-flex;align-items:center;gap:.5rem;padding:.7rem 1.35rem;border-radius:8px;font-weight:700;
  font-size:.88rem;text-decoration:none;border:1px solid transparent;transition:.22s}
.pf-btn svg{width:15px;height:15px}
.pf-btn-primary{background:var(--acc);color:#fff;box-shadow:0 6px 16px ${pfRgba(c.accent, .3)}}
.pf-btn-primary:hover{transform:translateY(-2px);box-shadow:0 10px 22px ${pfRgba(c.accent, .4)}}
.pf-btn-ghost{background:var(--card);border-color:var(--line);color:var(--ink)}
.pf-btn-ghost:hover{border-color:var(--acc);color:var(--acc);transform:translateY(-2px)}
.pf-socials{display:flex;gap:.4rem}
.pf-socials a{display:grid;place-items:center;width:38px;height:38px;border-radius:8px;background:var(--card);
  border:1px solid var(--line);color:var(--muted);transition:.22s}
.pf-socials a svg{width:15px;height:15px}
.pf-socials a:hover{color:var(--acc);border-color:var(--acc);transform:translateY(-2px)}

.pf-sec{padding:clamp(1.2rem,3vw,1.8rem) 0}
.pf-body{padding:clamp(1.5rem,3.5vw,2rem)}
.pf-shead{display:flex;align-items:baseline;gap:.8rem;flex-wrap:wrap;margin-bottom:1.1rem}
.pf-shead h2{font-size:clamp(1.25rem,3vw,1.7rem);font-weight:800;letter-spacing:-.03em}
.pf-shead span{font-family:var(--mono);font-size:.68rem;letter-spacing:.16em;text-transform:uppercase;
  color:var(--faint);margin-left:auto}
/* The stamp lands when the stub arrives — over-rotated and scaled up, then
   snapping down, which is what makes it read as an impact rather than a fade. */
.pf-stamp{position:absolute;right:22px;top:14px;z-index:2;width:88px;height:88px;border:3px solid ${pfRgba(c.accent, .5)};
  border-radius:50%;display:grid;place-items:center;text-align:center;color:${pfRgba(c.accent, .62)};
  font-family:var(--mono);font-size:.56rem;letter-spacing:.1em;line-height:1.3;text-transform:uppercase;
  transform:rotate(-26deg) scale(1.6);opacity:0;transition:transform .45s cubic-bezier(.2,1.6,.4,1),opacity .3s}
[data-reveal].pf-in .pf-stamp{transform:rotate(-13deg) scale(1);opacity:1}
.pf-about{white-space:pre-line;color:var(--muted)}
.pf-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:1rem;text-align:center}
.pf-stat b{display:block;font-family:var(--mono);font-size:1.9rem;font-weight:700;color:var(--acc);letter-spacing:-.02em}
.pf-stat span{font-size:.72rem;color:var(--faint);font-weight:600;letter-spacing:.06em;text-transform:uppercase}
.pf-chips{display:flex;flex-wrap:wrap;gap:.4rem}
.pf-chip{font-family:var(--mono);font-size:.78rem;padding:.28rem .7rem;border-radius:6px;color:var(--muted);
  background:${pfRgba(c.accent, .07)};border:1px dashed ${pfRgba(c.accent, .35)};transition:.2s;cursor:default}
.pf-chip:hover{color:var(--acc);border-style:solid;background:${pfRgba(c.accent, .14)}}
.pf-list{display:grid;gap:1.1rem}
.pf-entry{padding-bottom:1.1rem;border-bottom:1px dashed var(--line)}
.pf-entry:last-child{padding-bottom:0;border-bottom:0}
.pf-entry-top{display:flex;flex-wrap:wrap;gap:.2rem 1rem;align-items:baseline}
.pf-entry h3{font-size:1.05rem;font-weight:800}
.pf-entry .pf-org{color:var(--acc);font-size:.88rem;font-weight:600}
.pf-entry .pf-when{margin-left:auto;font-family:var(--mono);font-size:.74rem;color:var(--faint);white-space:nowrap}
.pf-entry p{color:var(--muted);font-size:.93rem;margin-top:.3rem}
.pf-entry ul{margin-top:.45rem}
.pf-entry li{color:var(--muted);font-size:.89rem;padding-left:1.15rem;position:relative;margin-bottom:.22rem}
.pf-entry li::before{content:"›";position:absolute;left:0;color:var(--acc);font-weight:700}
.pf-tags{display:flex;flex-wrap:wrap;gap:.3rem;margin-top:.7rem}
.pf-tag{font-family:var(--mono);font-size:.68rem;padding:.12rem .48rem;border-radius:4px;color:var(--a2);
  background:${pfRgba(a2, .12)}}
.pf-links{display:flex;gap:1rem;margin-top:.7rem;font-size:.82rem;font-weight:700}
.pf-links a{color:var(--acc);text-decoration:none;display:inline-flex;align-items:center;gap:.3rem}
.pf-links a svg{width:14px;height:14px}
.pf-contact{text-align:center}
.pf-contact h2{font-size:clamp(1.5rem,4vw,2.2rem);font-weight:800;letter-spacing:-.035em;margin-bottom:.6rem}
.pf-contact p{color:var(--muted);max-width:44ch;margin:0 auto 1.4rem}
.pf-clist{display:flex;flex-wrap:wrap;gap:.55rem 1.5rem;justify-content:center;margin-top:1.4rem;
  font-family:var(--mono);font-size:.8rem}
.pf-clist a,.pf-clist span{color:var(--muted);text-decoration:none;display:inline-flex;align-items:center;gap:.4rem}
.pf-clist svg{width:15px;height:15px;color:var(--acc)}
.pf-clist a:hover{color:var(--acc)}
footer{padding:2.2rem 0;text-align:center;font-family:var(--mono);font-size:.72rem;letter-spacing:.1em;
  color:var(--faint);text-transform:uppercase}
@media (max-width:820px){.pf-nav-links{display:none}
  .pf-pass{grid-template-columns:1fr;--notch:none}
  .pf-pass-side{border-left:0;border-top:2px dashed var(--line)}
  .pf-entry .pf-when{margin-left:0;width:100%}
  .pf-stamp{width:66px;height:66px;font-size:.48rem;right:12px}}
@media (prefers-reduced-motion:reduce){.pf-stamp{transform:rotate(-13deg) scale(1);opacity:1;transition:none}}`;

  const stub = (id, title, right, inner, stamp) => `
    <section class="pf-sec"${id ? ` id="${id}"` : ""}>
      <div class="pf-stub pf-body" data-reveal style="--notch:26px">
        <div class="pf-tear" style="top:26px"></div>
        ${stamp ? `<div class="pf-stamp">${pfEsc(stamp)}<br>${pfEsc(code)}</div>` : ""}
        <div class="pf-shead"><h2>${pfEsc(title)}</h2><span>${pfEsc(right)}</span></div>
        ${inner}
      </div></section>`;

  const entries = (arr, m) => `<div class="pf-list">${arr.map(x => {
    const r = m(x);
    return `<article class="pf-entry">
      <div class="pf-entry-top"><h3>${pfEsc(r.title || "")}</h3>
        ${r.org ? `<span class="pf-org">${pfEsc(r.org)}</span>` : ""}
        ${r.when ? `<span class="pf-when">${pfEsc(r.when)}</span>` : ""}</div>
      ${r.text ? `<p>${pfEsc(r.text)}</p>` : ""}
      ${(r.bullets || []).length ? `<ul>${r.bullets.map(b => `<li>${pfEsc(b)}</li>`).join("")}</ul>` : ""}
      ${(r.tags || []).length ? `<div class="pf-tags">${r.tags.map(t => `<span class="pf-tag">${pfEsc(t)}</span>`).join("")}</div>` : ""}
      ${r.links ? `<div class="pf-links">${r.links}</div>` : ""}
    </article>`;
  }).join("")}</div>`;

  const body = `
<nav class="pf-nav pf-noprint"><div class="pf-shell pf-nav-in">
  <a class="pf-brand" href="#top"><i>${pfEsc(c.initials)}</i>${pfEsc(c.name)}</a>
  ${nav ? `<div class="pf-nav-links">${nav}</div>` : ""}
</div></nav>

<main id="main"><div class="pf-shell">
  <section class="pf-hero" id="top"><div class="pf-stub pf-pass">
    <div class="pf-pass-main">
      <div class="pf-air"><b>Boarding pass</b><span>${pfEsc(code)} · ${c.year}</span></div>
      <div class="pf-route">
        <div><dt>From</dt><dd>${pfEsc((d.location || "Here").slice(0, 3).toUpperCase())}</dd></div>
        <div class="pf-plane"></div>
        <div><dt>To</dt><dd>YOU</dd></div>
      </div>
      <h1>${pfEsc(c.name)}</h1>
      ${c.title ? `<h2>${pfEsc(c.title)}</h2>` : ""}
      ${c.tagline ? `<p>${pfEsc(c.tagline)}</p>` : ""}
      <dl class="pf-fields">
        ${d.location ? `<div><dt>Based</dt><dd>${pfEsc(d.location)}</dd></div>` : ""}
        ${d.available ? `<div><dt>Status</dt><dd>${pfEsc(d.available)}</dd></div>` : ""}
        ${d.experience.length ? `<div><dt>Roles</dt><dd>${d.experience.length}</dd></div>` : ""}
        ${d.projects.length ? `<div><dt>Projects</dt><dd>${d.projects.length}</dd></div>` : ""}
      </dl>
      <div class="pf-actions">
        ${d.email ? `<a class="pf-btn pf-btn-primary" href="mailto:${pfEsc(d.email)}">${PF_ICONS.mail}${pfEsc(d.cta_text || "Get in touch")}</a>` : ""}
        ${c.hasResume ? `<a class="pf-btn pf-btn-ghost" ${pfResumeAttrs(c)}>${PF_ICONS.download}${pfEsc(c.resumeLabel)}</a>` : ""}
        ${pfSocialRow(c)}
      </div>
    </div>
    <div class="pf-pass-side">
      ${pfAvatar(c)}
      <div><div class="pf-barcode">${bars(7)}</div><div class="pf-code">${pfEsc(code)}</div></div>
    </div>
  </div></section>

  ${c.has("stats") ? stub("", "In numbers", "Summary", `<div class="pf-stats">
    ${d.stats.map(x => `<div class="pf-stat"><b>${pfEsc(x.value)}</b><span>${pfEsc(x.label)}</span></div>`).join("")}
  </div>`, "") : ""}

  ${c.has("about") ? stub("about", "About", "Passenger", `<p class="pf-about">${pfEsc(d.about)}</p>`, "Checked in") : ""}
  ${c.has("skills") ? stub("skills", "Skills", "Carry on", `<div class="pf-chips">
    ${d.skills.map(x => `<span class="pf-chip">${pfEsc(x)}</span>`).join("")}</div>`, "Cleared") : ""}
  ${c.has("projects") ? stub("projects", "Projects", "Itinerary",
    entries(d.projects, x => ({ title: x.name, org: x.role, when: x.period, text: x.description,
      bullets: x.bullets, tags: x.tags, links: pfProjectLinks(x) })), "Departed") : ""}
  ${c.has("experience") ? stub("experience", "Experience", "Flight log",
    entries(d.experience, x => ({ title: x.role, org: pfJoin([x.org, x.location]), when: x.period,
      text: x.summary, bullets: x.bullets })), "Logged") : ""}
  ${c.has("education") ? stub("education", "Education", "Origin",
    entries(d.education, x => ({ title: x.degree, org: x.school, when: x.period, text: x.detail })), "Verified") : ""}
  ${c.has("certifications") ? stub("certifications", "Certifications", "Endorsements", `<div class="pf-chips">
    ${d.certifications.map(x => `<span class="pf-chip">${pfEsc(x)}</span>`).join("")}</div>`, "Stamped") : ""}

  ${c.has("contact") ? `<section class="pf-sec" id="contact">
    <div class="pf-stub pf-body pf-contact" data-reveal style="--notch:26px">
      <div class="pf-tear" style="top:26px"></div>
      <h2>Next departure</h2>
      <p>${pfEsc(d.cta_text || "Tell me where you are going and I will tell you if I can help you get there.")}</p>
      <div class="pf-actions" style="justify-content:center;margin-top:0">
        ${d.email ? `<a class="pf-btn pf-btn-primary" href="mailto:${pfEsc(d.email)}">${PF_ICONS.mail}${pfEsc(d.email)}</a>` : ""}
        ${c.hasResume ? `<a class="pf-btn pf-btn-ghost" ${pfResumeAttrs(c)}>${PF_ICONS.download}Résumé</a>` : ""}
      </div>
      <div class="pf-clist">${c.links.map(x => x.url
        ? `<a href="${pfEsc(x.url)}"${/^https?:/i.test(x.url) ? ` target="_blank" rel="noopener"` : ""}>${x.icon}${pfEsc(x.handle)}</a>`
        : `<span>${x.icon}${pfEsc(x.handle)}</span>`).join("")}</div>
      <div class="pf-barcode pf-short" style="justify-content:center;margin-top:1.4rem">${bars(19)}</div>
    </div></section>` : ""}

  <footer>${pfEsc(c.name)} · ${c.year}${d.footer_note ? " · " + pfEsc(d.footer_note) : ""}</footer>
</div></main>`;

  const js = `
(function(){
  var links = [].slice.call(document.querySelectorAll('.pf-nav-links a'));
  var secs = links.map(function(a){ return document.querySelector(a.getAttribute('href')); }).filter(Boolean);
  if ('IntersectionObserver' in window && secs.length) {
    var spy = new IntersectionObserver(function(es){
      es.forEach(function(e){ if(!e.isIntersecting) return;
        links.forEach(function(a){ a.classList.toggle('pf-active', a.getAttribute('href') === '#' + e.target.id); }); });
    }, { rootMargin:'-45% 0px -50% 0px' });
    secs.forEach(function(s){ spy.observe(s); });
  }
})();`;

  return { fonts: [c.googleFont ? null : "Inter:wght@400;600;700;800", "JetBrains+Mono:wght@400;700"].filter(Boolean),
           css, body, js, themeColor: "#F4F7F6" };
};


// ---------------------------------------------------------------------------
// 27. NOTEBOOK — ruled paper with a red margin. A highlighter wipes across each
//     heading as you reach it, entries are pinned as sticky notes, and the
//     margin carries handwritten notes.
// ---------------------------------------------------------------------------
PF_RENDERERS.notebook = (c) => {
  const d = c.d;
  const hi = pfHueShift(c.accent, 168);           // the highlighter
  const nav = c.navItems.map(n => `<a href="#${n.id}">${pfEsc(n.label)}</a>`).join("");
  const tilt = (i) => [-1.8, 1.4, -1.1, 2.1, -2.3, 1.1][i % 6];
  const noteColour = (i) => [hi, pfHueShift(c.accent, 92), pfHueShift(c.accent, 40)][i % 3];

  const css = `
:root{
  --acc:${c.accent}; --hi:${hi}; --ink:#252231; --muted:#575269; --faint:#918CA6;
  --paper:#FFFEF7; --rule:#D6E4F5; --margin:#F2A2A2; --line:#E7E3D8;
  --hand:'Kalam','Segoe Script',cursive;
  --font:${c.fontStack || `'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif`};
}
/* The page itself is the paper: horizontal rules every 32px and one red margin
   rule down the left, both painted on the body so they run the full height
   however long the content gets. */
body{background:var(--paper);color:var(--ink);font-family:var(--font);font-size:16px;line-height:2;
  background-image:linear-gradient(var(--rule) 1px,transparent 1px);background-size:100% 32px;
  background-position:0 -1px;overflow-x:hidden}
.pf-margin{position:fixed;top:0;bottom:0;left:max(3vw,calc(50vw - 490px + 44px));width:2px;
  background:var(--margin);opacity:.7;z-index:1;pointer-events:none}
.pf-skip{background:var(--acc);color:#fff}
.pf-shell{width:min(980px,94vw);margin:0 auto;padding-left:clamp(2.6rem,6vw,4.4rem)}
main{position:relative;z-index:2}

.pf-nav{position:sticky;top:0;z-index:20;background:${pfRgba("#FFFEF7", .93)};
  backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);border-bottom:1px solid transparent;transition:.25s}
.pf-nav.pf-stuck{border-bottom-color:var(--line)}
.pf-nav-in{display:flex;align-items:center;gap:1.1rem;padding:.7rem 0;line-height:1.5}
.pf-brand{font-family:var(--hand);font-size:1.3rem;font-weight:700;text-decoration:none;
  display:flex;align-items:center;gap:.55rem}
.pf-brand i{width:30px;height:30px;display:grid;place-items:center;font-family:var(--font);font-size:.64rem;
  font-weight:800;font-style:normal;color:#fff;background:var(--acc);border-radius:50%}
.pf-nav-links{display:flex;gap:.9rem;margin-left:auto}
.pf-nav-links a{font-family:var(--hand);font-size:1.02rem;color:var(--muted);text-decoration:none;
  padding:.1rem .2rem;transition:.2s;position:relative}
.pf-nav-links a::after{content:"";position:absolute;left:-2px;right:100%;bottom:2px;height:8px;
  background:${pfRgba(hi, .55)};z-index:-1;transition:right .25s ease;border-radius:2px}
.pf-nav-links a:hover,.pf-nav-links a.pf-active{color:var(--ink)}
.pf-nav-links a:hover::after,.pf-nav-links a.pf-active::after{right:-2px}

.pf-hero{padding:clamp(2rem,5vw,3rem) 0 clamp(1.4rem,3vw,2rem);position:relative;
  display:grid;grid-template-columns:minmax(0,1fr) auto;gap:2rem;align-items:center}
.pf-scrawl{font-family:var(--hand);font-size:1.35rem;color:var(--acc);transform:rotate(-2deg);
  display:inline-block;margin-bottom:.2rem}
.pf-hero h1{font-size:clamp(2.1rem,5.6vw,3.4rem);font-weight:800;letter-spacing:-.035em;line-height:1.15;
  margin-bottom:.2rem}
.pf-mark{position:relative;display:inline;background-image:linear-gradient(${pfRgba(hi, .6)},${pfRgba(hi, .6)});
  background-repeat:no-repeat;background-size:0 .62em;background-position:0 .62em;
  transition:background-size .8s cubic-bezier(.2,.8,.25,1) .15s;padding:0 .1em}
[data-reveal].pf-in .pf-mark,.pf-hero .pf-mark{background-size:100% .62em}
.pf-hero h2{font-size:clamp(.98rem,2.1vw,1.15rem);font-weight:600;color:var(--muted);margin-bottom:.5rem;line-height:1.6}
.pf-hero p{color:var(--muted);max-width:46ch;line-height:1.8}
.pf-clip{width:min(170px,30vw);aspect-ratio:1;position:relative;transform:rotate(2.4deg)}
.pf-clip::before{content:"";position:absolute;left:50%;top:-14px;width:56px;height:26px;transform:translateX(-50%);
  border:4px solid #B9BCC6;border-bottom:0;border-radius:14px 14px 0 0;z-index:2}
.pf-avatar{width:100%;height:100%;object-fit:cover;background:#fff;padding:8px;
  box-shadow:0 6px 18px rgba(37,34,49,.16)}
.pf-avatar-initials{display:grid;place-items:center;font-family:var(--hand);font-size:3rem;font-weight:700;
  color:#fff;background:var(--acc)}
.pf-meta{display:flex;flex-wrap:wrap;gap:.3rem 1.1rem;margin-top:.6rem;font-family:var(--hand);font-size:1.05rem;
  color:var(--faint)}
.pf-actions{display:flex;flex-wrap:wrap;gap:.6rem;align-items:center;margin-top:1.2rem;line-height:1.5}
.pf-btn{display:inline-flex;align-items:center;gap:.5rem;padding:.62rem 1.3rem;border-radius:22px 20px 24px 18px;
  font-weight:700;font-size:.88rem;text-decoration:none;border:2px solid var(--ink);transition:.18s}
.pf-btn svg{width:15px;height:15px}
.pf-btn-primary{background:var(--acc);color:#fff;box-shadow:3px 3px 0 var(--ink)}
.pf-btn-ghost{background:var(--paper);color:var(--ink);box-shadow:3px 3px 0 var(--ink)}
.pf-btn:hover{transform:translate(-2px,-2px);box-shadow:5px 5px 0 var(--ink)}
.pf-socials{display:flex;gap:.4rem}
.pf-socials a{display:grid;place-items:center;width:38px;height:38px;border-radius:50%;background:var(--paper);
  border:2px solid var(--ink);color:var(--ink);transition:.18s;box-shadow:2px 2px 0 var(--ink)}
.pf-socials a svg{width:15px;height:15px}
.pf-socials a:hover{transform:translate(-2px,-2px) rotate(-8deg);box-shadow:4px 4px 0 var(--ink);background:var(--hi)}

.pf-sec{padding:clamp(1.4rem,3.5vw,2.2rem) 0;position:relative}
.pf-h2{font-size:clamp(1.4rem,3.4vw,2rem);font-weight:800;letter-spacing:-.03em;margin-bottom:1rem;line-height:1.5}
.pf-doodle{position:absolute;left:calc(-1 * clamp(2.4rem,5.6vw,4.1rem));top:clamp(1.5rem,3.6vw,2.3rem);
  font-family:var(--hand);font-size:1.4rem;color:var(--margin);transform:rotate(-8deg)}
.pf-about{font-size:1.02rem;color:var(--muted);white-space:pre-line;max-width:64ch}
.pf-stats{display:flex;flex-wrap:wrap;gap:1rem}
.pf-stat{padding:.9rem 1.2rem;background:var(--paper);border:2px solid var(--ink);border-radius:6px;
  box-shadow:3px 3px 0 var(--ink);text-align:center;line-height:1.4;transition:.18s}
.pf-stat:hover{transform:translate(-2px,-2px) rotate(-1.5deg);box-shadow:5px 5px 0 var(--acc)}
.pf-stat b{display:block;font-size:1.7rem;font-weight:800;color:var(--acc);letter-spacing:-.03em}
.pf-stat span{font-family:var(--hand);font-size:.95rem;color:var(--faint)}
.pf-chips{display:flex;flex-wrap:wrap;gap:.5rem;line-height:1.5}
.pf-chip{font-family:var(--hand);font-size:1.05rem;padding:.1rem .7rem;border:2px solid var(--ink);
  border-radius:16px 14px 18px 12px;background:var(--paper);transition:.18s;cursor:default}
.pf-chip:hover{background:var(--hi);transform:rotate(-2deg)}
/* Sticky notes. Pinned at a slight angle with a shadow that gets deeper on the
   lifted corner, which is what reads as "stuck on" rather than "drawn on". */
.pf-notes{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:1.4rem}
.pf-note{padding:1.3rem 1.4rem;line-height:1.65;box-shadow:2px 4px 12px rgba(37,34,49,.16);transition:.2s}
.pf-note:hover{transform:rotate(0deg) translateY(-4px);box-shadow:4px 10px 22px rgba(37,34,49,.22)}
.pf-note h3{font-size:1.08rem;font-weight:800;letter-spacing:-.02em;margin-bottom:.1rem}
.pf-note .pf-role,.pf-entry .pf-org{font-family:var(--hand);font-size:1rem;color:var(--ink);opacity:.72;margin-bottom:.5rem}
.pf-note p,.pf-entry p{font-size:.93rem;color:${pfRgba("#252231", .78)}}
.pf-note ul,.pf-entry ul{margin-top:.5rem}
.pf-note li,.pf-entry li{font-size:.89rem;padding-left:1.2rem;position:relative;margin-bottom:.2rem;
  color:${pfRgba("#252231", .78)};line-height:1.55}
.pf-note li::before,.pf-entry li::before{content:"✓";position:absolute;left:0;font-weight:800;opacity:.6}
.pf-tags{display:flex;flex-wrap:wrap;gap:.3rem;margin-top:.7rem}
.pf-tag{font-family:var(--hand);font-size:.9rem;padding:0 .5rem;border:1.5px solid ${pfRgba("#252231", .35)};
  border-radius:10px}
.pf-links{display:flex;gap:.9rem;margin-top:.7rem;font-size:.82rem;font-weight:700}
.pf-links a{color:var(--ink);text-decoration:underline;display:inline-flex;align-items:center;gap:.3rem}
.pf-links a svg{width:14px;height:14px}
.pf-list{display:grid;gap:1rem}
.pf-entry{padding-left:1.4rem;border-left:3px solid ${pfRgba(c.accent, .3)};line-height:1.7}
.pf-entry-top{display:flex;flex-wrap:wrap;gap:.1rem .9rem;align-items:baseline}
.pf-entry h3{font-size:1.05rem;font-weight:800}
.pf-entry .pf-when{margin-left:auto;font-family:var(--hand);font-size:1rem;color:var(--faint);white-space:nowrap}
.pf-contact{padding:1.7rem 1.8rem;background:var(--paper);border:2px dashed var(--ink);border-radius:10px;
  text-align:center;line-height:1.6}
.pf-contact h2{font-size:clamp(1.4rem,3.6vw,2rem);font-weight:800;letter-spacing:-.03em;margin-bottom:.5rem}
.pf-contact p{color:var(--muted);max-width:44ch;margin:0 auto 1.2rem}
.pf-clist{display:flex;flex-wrap:wrap;gap:.5rem 1.4rem;justify-content:center;margin-top:1.2rem;
  font-family:var(--hand);font-size:1.05rem}
.pf-clist a,.pf-clist span{color:var(--muted);text-decoration:none;display:inline-flex;align-items:center;gap:.4rem}
.pf-clist svg{width:15px;height:15px;color:var(--acc)}
.pf-clist a:hover{color:var(--acc)}
footer{padding:2rem 0;text-align:center;font-family:var(--hand);font-size:1.05rem;color:var(--faint)}
@media (max-width:820px){.pf-nav-links{display:none}.pf-hero{grid-template-columns:1fr}
  .pf-clip{order:-1;margin:0 auto}.pf-margin{display:none}.pf-doodle{display:none}
  .pf-entry .pf-when{margin-left:0;width:100%}}
@media (prefers-reduced-motion:reduce){.pf-mark{background-size:100% .62em;transition:none}}`;

  const head = (title, doodle) => `<div data-reveal>
      ${doodle ? `<span class="pf-doodle">${pfEsc(doodle)}</span>` : ""}
      <h2 class="pf-h2"><span class="pf-mark">${pfEsc(title)}</span></h2></div>`;

  const body = `
<div class="pf-margin" aria-hidden="true"></div>
<nav class="pf-nav pf-noprint"><div class="pf-shell pf-nav-in">
  <a class="pf-brand" href="#top"><i>${pfEsc(c.initials)}</i>${pfEsc(c.name)}</a>
  ${nav ? `<div class="pf-nav-links">${nav}</div>` : ""}
</div></nav>

<main id="main"><div class="pf-shell">
  <section class="pf-hero" id="top">
    <div>
      <div class="pf-scrawl">${pfEsc(d.available || "hello there")}</div>
      <h1><span class="pf-mark">${pfEsc(c.name)}</span></h1>
      ${c.title ? `<h2>${pfEsc(c.title)}</h2>` : ""}
      ${c.tagline ? `<p>${pfEsc(c.tagline)}</p>` : ""}
      ${d.location ? `<div class="pf-meta"><span>${pfEsc(d.location)}</span></div>` : ""}
      <div class="pf-actions">
        ${d.email ? `<a class="pf-btn pf-btn-primary" href="mailto:${pfEsc(d.email)}">${PF_ICONS.mail}${pfEsc(d.cta_text || "Write to me")}</a>` : ""}
        ${c.hasResume ? `<a class="pf-btn pf-btn-ghost" ${pfResumeAttrs(c)}>${PF_ICONS.download}${pfEsc(c.resumeLabel)}</a>` : ""}
        ${pfSocialRow(c)}
      </div>
    </div>
    <div class="pf-clip">${pfAvatar(c)}</div>
  </section>

  ${c.has("stats") ? `<section class="pf-sec"><div class="pf-stats" data-reveal>
    ${d.stats.map(x => `<div class="pf-stat"><b>${pfEsc(x.value)}</b><span>${pfEsc(x.label)}</span></div>`).join("")}
  </div></section>` : ""}

  ${c.has("about") ? `<section class="pf-sec" id="about">${head("About me", "★")}
    <p class="pf-about" data-reveal>${pfEsc(d.about)}</p></section>` : ""}

  ${c.has("skills") ? `<section class="pf-sec" id="skills">${head("Skills", "→")}
    <div class="pf-chips" data-reveal>${d.skills.map(x => `<span class="pf-chip">${pfEsc(x)}</span>`).join("")}</div></section>` : ""}

  ${c.has("projects") ? `<section class="pf-sec" id="projects">${head("Projects", "!")}
    <div class="pf-notes">${d.projects.map((x, i) => `
      <article class="pf-note" data-reveal data-reveal-delay="${Math.min(i, 5) * 80}"
        style="background:${pfEsc(pfRgba(noteColour(i), .5))};transform:rotate(${tilt(i)}deg)">
        <h3>${pfEsc(x.name || "")}</h3>
        ${pfJoin([x.role, x.period]) ? `<div class="pf-role">${pfJoin([x.role, x.period])}</div>` : ""}
        ${x.description ? `<p>${pfEsc(x.description)}</p>` : ""}
        ${(x.bullets || []).length ? `<ul>${x.bullets.map(b => `<li>${pfEsc(b)}</li>`).join("")}</ul>` : ""}
        ${(x.tags || []).length ? `<div class="pf-tags">${x.tags.map(t => `<span class="pf-tag">${pfEsc(t)}</span>`).join("")}</div>` : ""}
        ${pfProjectLinks(x) ? `<div class="pf-links">${pfProjectLinks(x)}</div>` : ""}
      </article>`).join("")}</div></section>` : ""}

  ${c.has("experience") ? `<section class="pf-sec" id="experience">${head("Experience", "✎")}
    <div class="pf-list">${d.experience.map((x, i) => `
      <article class="pf-entry" data-reveal data-reveal-delay="${Math.min(i, 5) * 70}">
        <div class="pf-entry-top"><h3>${pfEsc(x.role || "")}</h3>
          ${x.period ? `<span class="pf-when">${pfEsc(x.period)}</span>` : ""}</div>
        ${x.org ? `<div class="pf-org">${pfJoin([x.org, x.location])}</div>` : ""}
        ${x.summary ? `<p>${pfEsc(x.summary)}</p>` : ""}
        ${(x.bullets || []).length ? `<ul>${x.bullets.map(b => `<li>${pfEsc(b)}</li>`).join("")}</ul>` : ""}
      </article>`).join("")}</div></section>` : ""}

  ${c.has("education") ? `<section class="pf-sec" id="education">${head("Education", "✚")}
    <div class="pf-list">${d.education.map(x => `
      <article class="pf-entry" data-reveal>
        <div class="pf-entry-top"><h3>${pfEsc(x.degree || "")}</h3>
          ${x.period ? `<span class="pf-when">${pfEsc(x.period)}</span>` : ""}</div>
        ${x.school ? `<div class="pf-org">${pfEsc(x.school)}</div>` : ""}
        ${x.detail ? `<p>${pfEsc(x.detail)}</p>` : ""}
      </article>`).join("")}</div></section>` : ""}

  ${c.has("certifications") ? `<section class="pf-sec" id="certifications">${head("Certifications", "✓")}
    <div class="pf-chips" data-reveal>${d.certifications.map(x => `<span class="pf-chip">${pfEsc(x)}</span>`).join("")}</div></section>` : ""}

  ${c.has("contact") ? `<section class="pf-sec" id="contact"><div class="pf-contact" data-reveal>
    <h2><span class="pf-mark">Drop me a line</span></h2>
    <p>${pfEsc(d.cta_text || "Questions, ideas, or a project you cannot quite describe yet.")}</p>
    <div class="pf-actions" style="justify-content:center;margin-top:0">
      ${d.email ? `<a class="pf-btn pf-btn-primary" href="mailto:${pfEsc(d.email)}">${PF_ICONS.mail}${pfEsc(d.email)}</a>` : ""}
      ${c.hasResume ? `<a class="pf-btn pf-btn-ghost" ${pfResumeAttrs(c)}>${PF_ICONS.download}Résumé</a>` : ""}
    </div>
    <div class="pf-clist">${c.links.map(x => x.url
      ? `<a href="${pfEsc(x.url)}"${/^https?:/i.test(x.url) ? ` target="_blank" rel="noopener"` : ""}>${x.icon}${pfEsc(x.handle)}</a>`
      : `<span>${x.icon}${pfEsc(x.handle)}</span>`).join("")}</div>
  </div></section>` : ""}

  <footer>© <span data-year>${c.year}</span> ${pfEsc(c.name)}${d.footer_note ? " · " + pfEsc(d.footer_note) : ""}</footer>
</div></main>`;

  const js = `
(function(){
  var nav = document.querySelector('.pf-nav');
  var onNav = function(){ nav.classList.toggle('pf-stuck', window.scrollY > 8); };
  onNav(); addEventListener('scroll', onNav, { passive:true });
  var links = [].slice.call(document.querySelectorAll('.pf-nav-links a'));
  var secs = links.map(function(a){ return document.querySelector(a.getAttribute('href')); }).filter(Boolean);
  if ('IntersectionObserver' in window && secs.length) {
    var spy = new IntersectionObserver(function(es){
      es.forEach(function(e){ if(!e.isIntersecting) return;
        links.forEach(function(a){ a.classList.toggle('pf-active', a.getAttribute('href') === '#' + e.target.id); }); });
    }, { rootMargin:'-45% 0px -50% 0px' });
    secs.forEach(function(s){ spy.observe(s); });
  }
})();`;

  return { fonts: ["Kalam:wght@400;700", c.googleFont ? null : "Inter:wght@400;600;700;800"].filter(Boolean),
           css, body, js, themeColor: "#FFFEF7" };
};


// ---------------------------------------------------------------------------
// 28. ARCADE — a cabinet at midday. Stepped pixel borders, a HUD that counts
//     your scroll as a score, and a blinking "insert coin". Daylight palette on
//     purpose: every 8-bit portfolio on the internet is black.
// ---------------------------------------------------------------------------
PF_RENDERERS.arcade = (c) => {
  const d = c.d;
  const a2 = pfHueShift(c.accent, 175), a3 = pfHueShift(c.accent, 78);
  const nav = c.navItems.map(n => `<a href="#${n.id}">${pfEsc(n.label)}</a>`).join("");

  const css = `
:root{
  --acc:${c.accent}; --a2:${a2}; --a3:${a3};
  --ink:#241C3B; --muted:#5A4F7D; --faint:#9089AD;
  --bg:#FFF9E6; --card:#FFFFFF; --edge:#241C3B;
  --px:'Press Start 2P','Courier New',monospace;
  --font:${c.fontStack || `'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif`};
}
body{background:var(--bg);color:var(--ink);font-family:var(--font);font-size:16px;line-height:1.7;
  image-rendering:pixelated;overflow-x:hidden}
.pf-skip{background:var(--acc);color:#fff}
.pf-shell{width:min(1020px,92vw);margin:0 auto}
/* A checker wash, 8px cells — the background of every bright cabinet screen. */
.pf-scan{position:fixed;inset:0;z-index:0;pointer-events:none;opacity:.5;
  background-image:linear-gradient(45deg,${pfRgba(c.accent, .07)} 25%,transparent 25%,transparent 75%,${pfRgba(c.accent, .07)} 75%),
                   linear-gradient(45deg,${pfRgba(c.accent, .07)} 25%,transparent 25%,transparent 75%,${pfRgba(c.accent, .07)} 75%);
  background-size:16px 16px;background-position:0 0,8px 8px}
main{position:relative;z-index:2}

/* The pixel edge: four hard offsets instead of a border, so corners step
   rather than curve. A border-radius anywhere on this page would undo it. */
.pf-px{position:relative;background:var(--card);
  box-shadow:0 -4px 0 0 var(--edge),0 4px 0 0 var(--edge),-4px 0 0 0 var(--edge),4px 0 0 0 var(--edge),
             8px 8px 0 0 ${pfRgba("#241C3B", .18)}}
.pf-px:hover{transform:translate(-2px,-2px);
  box-shadow:0 -4px 0 0 var(--edge),0 4px 0 0 var(--edge),-4px 0 0 0 var(--edge),4px 0 0 0 var(--edge),
             12px 12px 0 0 ${pfRgba(c.accent, .45)}}
.pf-px{transition:transform .12s steps(3),box-shadow .12s steps(3)}

.pf-hud{position:sticky;top:0;z-index:20;background:var(--ink);color:var(--bg);
  font-family:var(--px);font-size:.56rem;letter-spacing:.06em;line-height:2}
.pf-hud-in{display:flex;align-items:center;gap:1.2rem;padding:.55rem 0;flex-wrap:wrap}
.pf-hud b{color:var(--a3)}
.pf-hud .pf-coin{margin-left:auto;color:var(--a2);animation:pf-blink 1.1s steps(1) infinite}
@keyframes pf-blink{50%{opacity:0}}
.pf-nav{position:sticky;top:34px;z-index:19;background:${pfRgba("#FFF9E6", .95)};
  border-bottom:4px solid var(--edge)}
.pf-nav-in{display:flex;align-items:center;gap:1rem;padding:.6rem 0}
.pf-brand{font-family:var(--px);font-size:.72rem;letter-spacing:.02em;text-decoration:none;
  display:flex;align-items:center;gap:.6rem;line-height:1.6}
.pf-brand i{width:26px;height:26px;display:grid;place-items:center;font-size:.5rem;font-style:normal;
  color:var(--bg);background:var(--acc)}
.pf-nav-links{display:flex;gap:.7rem;margin-left:auto;flex-wrap:wrap}
.pf-nav-links a{font-family:var(--px);font-size:.54rem;letter-spacing:.02em;color:var(--muted);
  text-decoration:none;padding:.3rem .35rem;transition:.1s steps(2)}
.pf-nav-links a:hover,.pf-nav-links a.pf-active{color:var(--bg);background:var(--acc)}

.pf-hero{padding:clamp(2.2rem,6vw,3.4rem) 0}
.pf-screen{padding:clamp(1.6rem,4vw,2.6rem);text-align:center}
.pf-p1{font-family:var(--px);font-size:.6rem;color:var(--a2);letter-spacing:.06em;margin-bottom:1.2rem;line-height:2}
.pf-hero h1{font-family:var(--px);font-size:clamp(1.1rem,3.6vw,2.2rem);line-height:1.5;letter-spacing:.01em;
  margin-bottom:.9rem;color:var(--acc);text-shadow:4px 4px 0 var(--edge)}
.pf-hero h2{font-family:var(--px);font-size:clamp(.56rem,1.5vw,.76rem);line-height:2;color:var(--ink);
  margin-bottom:1rem;letter-spacing:.04em}
.pf-hero p{color:var(--muted);max-width:52ch;margin:0 auto}
.pf-lives{display:flex;gap:.4rem;justify-content:center;margin-top:1rem;font-family:var(--px);font-size:.6rem;
  color:var(--acc);line-height:2}
.pf-actions{display:flex;flex-wrap:wrap;gap:.8rem;justify-content:center;align-items:center;margin-top:1.6rem}
.pf-btn{display:inline-flex;align-items:center;gap:.5rem;padding:.7rem 1.2rem;font-family:var(--px);
  font-size:.58rem;letter-spacing:.04em;line-height:1.9;text-decoration:none;transition:.1s steps(2);
  box-shadow:0 -4px 0 0 var(--edge),0 4px 0 0 var(--edge),-4px 0 0 0 var(--edge),4px 0 0 0 var(--edge),
             6px 6px 0 0 ${pfRgba("#241C3B", .3)}}
.pf-btn svg{width:14px;height:14px}
.pf-btn:hover{transform:translate(-2px,-2px);
  box-shadow:0 -4px 0 0 var(--edge),0 4px 0 0 var(--edge),-4px 0 0 0 var(--edge),4px 0 0 0 var(--edge),
             9px 9px 0 0 ${pfRgba("#241C3B", .3)}}
.pf-btn-primary{background:var(--acc);color:#fff}
.pf-btn-ghost{background:var(--a3);color:var(--ink)}
.pf-socials{display:flex;gap:.7rem}
.pf-socials a{display:grid;place-items:center;width:38px;height:38px;background:var(--card);color:var(--ink);
  transition:.1s steps(2);
  box-shadow:0 -4px 0 0 var(--edge),0 4px 0 0 var(--edge),-4px 0 0 0 var(--edge),4px 0 0 0 var(--edge)}
.pf-socials a svg{width:15px;height:15px}
.pf-socials a:hover{background:var(--a2);transform:translateY(-3px)}

.pf-sec{padding:clamp(1.6rem,4vw,2.6rem) 0}
.pf-h2{font-family:var(--px);font-size:clamp(.8rem,2.2vw,1.15rem);line-height:1.7;letter-spacing:.02em;
  margin-bottom:1.3rem;color:var(--ink)}
.pf-h2 span{color:var(--acc)}
.pf-body{padding:1.6rem}
.pf-about{white-space:pre-line;color:var(--muted)}
.pf-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:1.4rem}
.pf-stat{padding:1.3rem 1rem;text-align:center}
.pf-stat b{display:block;font-family:var(--px);font-size:1.3rem;line-height:1.6;color:var(--acc)}
.pf-stat span{font-family:var(--px);font-size:.46rem;line-height:2.2;color:var(--faint);letter-spacing:.04em}
.pf-chips{display:flex;flex-wrap:wrap;gap:.8rem}
.pf-chip{font-family:var(--px);font-size:.52rem;line-height:2;padding:.45rem .7rem;background:var(--card);
  transition:.1s steps(2);cursor:default;
  box-shadow:0 -3px 0 0 var(--edge),0 3px 0 0 var(--edge),-3px 0 0 0 var(--edge),3px 0 0 0 var(--edge)}
.pf-chip:nth-child(3n+1):hover{background:var(--acc);color:#fff}
.pf-chip:nth-child(3n+2):hover{background:var(--a2)}
.pf-chip:nth-child(3n):hover{background:var(--a3)}
.pf-chip:hover{transform:translateY(-3px)}
.pf-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(290px,1fr));gap:1.6rem}
.pf-proj{padding:1.5rem}
.pf-proj h3{font-family:var(--px);font-size:.72rem;line-height:1.8;color:var(--acc);margin-bottom:.4rem}
.pf-proj .pf-role,.pf-row .pf-org{font-family:var(--px);font-size:.46rem;line-height:2.2;color:var(--faint);
  letter-spacing:.04em;margin-bottom:.7rem}
.pf-proj p,.pf-row p{color:var(--muted);font-size:.93rem}
.pf-proj ul,.pf-row ul{margin-top:.6rem}
.pf-proj li,.pf-row li{color:var(--muted);font-size:.89rem;padding-left:1.3rem;position:relative;margin-bottom:.24rem}
.pf-proj li::before,.pf-row li::before{content:"";position:absolute;left:0;top:.62em;width:8px;height:8px;
  background:var(--a2);box-shadow:0 -2px 0 0 var(--edge),0 2px 0 0 var(--edge),-2px 0 0 0 var(--edge),2px 0 0 0 var(--edge)}
.pf-tags{display:flex;flex-wrap:wrap;gap:.5rem;margin-top:.9rem}
.pf-tag{font-family:var(--px);font-size:.44rem;line-height:2.2;padding:.2rem .45rem;background:var(--a3);color:var(--ink)}
.pf-links{display:flex;gap:1.2rem;margin-top:.9rem;font-family:var(--px);font-size:.5rem;line-height:2}
.pf-links a{color:var(--acc);text-decoration:none;display:inline-flex;align-items:center;gap:.35rem}
.pf-links a svg{width:13px;height:13px}
.pf-rows{display:grid;gap:1.4rem}
.pf-row{padding:1.4rem 1.6rem}
.pf-row-top{display:flex;flex-wrap:wrap;gap:.2rem 1rem;align-items:baseline}
.pf-row h3{font-family:var(--px);font-size:.7rem;line-height:1.8}
.pf-row .pf-when{margin-left:auto;font-family:var(--px);font-size:.46rem;line-height:2.4;color:var(--faint);white-space:nowrap}
.pf-contact{padding:clamp(1.8rem,4.5vw,2.8rem);text-align:center;background:var(--acc);color:#fff}
.pf-contact h2{font-family:var(--px);font-size:clamp(.9rem,2.6vw,1.4rem);line-height:1.7;margin-bottom:.9rem;
  text-shadow:4px 4px 0 var(--edge)}
.pf-contact p{max-width:44ch;margin:0 auto 1.4rem;opacity:.94}
.pf-contact .pf-btn-primary{background:var(--a3);color:var(--ink)}
.pf-contact .pf-btn-ghost{background:var(--card);color:var(--ink)}
.pf-clist{display:flex;flex-wrap:wrap;gap:.7rem 1.4rem;justify-content:center;margin-top:1.4rem;
  font-family:var(--px);font-size:.48rem;line-height:2.4}
.pf-clist a,.pf-clist span{color:#fff;text-decoration:none;display:inline-flex;align-items:center;gap:.4rem;opacity:.94}
.pf-clist svg{width:14px;height:14px}
footer{padding:2.4rem 0;text-align:center;font-family:var(--px);font-size:.5rem;line-height:2.4;color:var(--faint)}
@media (max-width:820px){.pf-nav-links{display:none}.pf-nav{top:56px}.pf-row .pf-when{margin-left:0;width:100%}}
@media (prefers-reduced-motion:reduce){.pf-hud .pf-coin{animation:none}}`;

  const body = `
<div class="pf-scan" aria-hidden="true"></div>
<div class="pf-hud pf-noprint"><div class="pf-shell pf-hud-in">
  <span>SCORE <b data-score>000000</b></span>
  <span>LEVEL <b>${d.experience.length || 1}</b></span>
  <span>HI <b>${pfEsc(String(d.projects.length || 0)).padStart(2, "0")}</b></span>
  <span class="pf-coin">INSERT COIN</span>
</div></div>
<nav class="pf-nav pf-noprint"><div class="pf-shell pf-nav-in">
  <a class="pf-brand" href="#top"><i>${pfEsc(c.initials)}</i>${pfEsc(c.name)}</a>
  ${nav ? `<div class="pf-nav-links">${nav}</div>` : ""}
</div></nav>

<main id="main"><div class="pf-shell">
  <section class="pf-hero" id="top"><div class="pf-px pf-screen">
    <div class="pf-p1">${pfEsc(d.available || "PLAYER 1 READY")}</div>
    <h1>${pfEsc(c.name)}</h1>
    ${c.title ? `<h2>${pfEsc(c.title)}</h2>` : ""}
    ${c.tagline ? `<p>${pfEsc(c.tagline)}</p>` : ""}
    ${d.location ? `<div class="pf-lives">▮ ▮ ▮ &nbsp;${pfEsc(d.location)}</div>` : ""}
    <div class="pf-actions">
      ${d.email ? `<a class="pf-btn pf-btn-primary" href="mailto:${pfEsc(d.email)}">${PF_ICONS.mail}${pfEsc(d.cta_text || "START")}</a>` : ""}
      ${c.hasResume ? `<a class="pf-btn pf-btn-ghost" ${pfResumeAttrs(c)}>${PF_ICONS.download}RESUME</a>` : ""}
      ${pfSocialRow(c)}
    </div>
  </div></section>

  ${c.has("stats") ? `<section class="pf-sec"><div class="pf-stats">
    ${d.stats.map((x, i) => `<div class="pf-px pf-stat" data-reveal data-reveal-delay="${i * 70}">
      <b>${pfEsc(x.value)}</b><span>${pfEsc(x.label)}</span></div>`).join("")}</div></section>` : ""}

  ${c.has("about") ? `<section class="pf-sec" id="about">
    <h2 class="pf-h2">&gt; <span>ABOUT</span></h2>
    <div class="pf-px pf-body pf-about" data-reveal>${pfEsc(d.about)}</div></section>` : ""}

  ${c.has("skills") ? `<section class="pf-sec" id="skills">
    <h2 class="pf-h2">&gt; <span>POWER-UPS</span></h2>
    <div class="pf-chips" data-reveal>${d.skills.map(x => `<span class="pf-chip">${pfEsc(x)}</span>`).join("")}</div></section>` : ""}

  ${c.has("projects") ? `<section class="pf-sec" id="projects">
    <h2 class="pf-h2">&gt; <span>STAGES CLEARED</span></h2>
    <div class="pf-grid">${d.projects.map((x, i) => `
      <article class="pf-px pf-proj" data-reveal data-reveal-delay="${Math.min(i, 5) * 80}">
        <h3>${pfEsc(x.name || "")}</h3>
        ${pfJoin([x.role, x.period]) ? `<div class="pf-role">${pfJoin([x.role, x.period])}</div>` : ""}
        ${x.description ? `<p>${pfEsc(x.description)}</p>` : ""}
        ${(x.bullets || []).length ? `<ul>${x.bullets.map(b => `<li>${pfEsc(b)}</li>`).join("")}</ul>` : ""}
        ${(x.tags || []).length ? `<div class="pf-tags">${x.tags.map(t => `<span class="pf-tag">${pfEsc(t)}</span>`).join("")}</div>` : ""}
        ${pfProjectLinks(x) ? `<div class="pf-links">${pfProjectLinks(x)}</div>` : ""}
      </article>`).join("")}</div></section>` : ""}

  ${c.has("experience") ? `<section class="pf-sec" id="experience">
    <h2 class="pf-h2">&gt; <span>LEVEL HISTORY</span></h2>
    <div class="pf-rows">${d.experience.map((x, i) => `
      <article class="pf-px pf-row" data-reveal data-reveal-delay="${Math.min(i, 5) * 70}">
        <div class="pf-row-top"><h3>${pfEsc(x.role || "")}</h3>
          ${x.period ? `<span class="pf-when">${pfEsc(x.period)}</span>` : ""}</div>
        ${x.org ? `<div class="pf-org">${pfJoin([x.org, x.location])}</div>` : ""}
        ${x.summary ? `<p>${pfEsc(x.summary)}</p>` : ""}
        ${(x.bullets || []).length ? `<ul>${x.bullets.map(b => `<li>${pfEsc(b)}</li>`).join("")}</ul>` : ""}
      </article>`).join("")}</div></section>` : ""}

  ${c.has("education") ? `<section class="pf-sec" id="education">
    <h2 class="pf-h2">&gt; <span>TUTORIAL</span></h2>
    <div class="pf-rows">${d.education.map(x => `
      <article class="pf-px pf-row" data-reveal>
        <div class="pf-row-top"><h3>${pfEsc(x.degree || "")}</h3>
          ${x.period ? `<span class="pf-when">${pfEsc(x.period)}</span>` : ""}</div>
        ${x.school ? `<div class="pf-org">${pfEsc(x.school)}</div>` : ""}
        ${x.detail ? `<p>${pfEsc(x.detail)}</p>` : ""}
      </article>`).join("")}</div></section>` : ""}

  ${c.has("certifications") ? `<section class="pf-sec" id="certifications">
    <h2 class="pf-h2">&gt; <span>ACHIEVEMENTS</span></h2>
    <div class="pf-chips" data-reveal>${d.certifications.map(x => `<span class="pf-chip">${pfEsc(x)}</span>`).join("")}</div></section>` : ""}

  ${c.has("contact") ? `<section class="pf-sec" id="contact"><div class="pf-px pf-contact" data-reveal>
    <h2>GAME OVER?</h2>
    <p>${pfEsc(d.cta_text || "Continue? Drop me a message and let's start a new game.")}</p>
    <div class="pf-actions" style="margin-top:0">
      ${d.email ? `<a class="pf-btn pf-btn-primary" href="mailto:${pfEsc(d.email)}">${PF_ICONS.mail}CONTINUE</a>` : ""}
      ${c.hasResume ? `<a class="pf-btn pf-btn-ghost" ${pfResumeAttrs(c)}>${PF_ICONS.download}RESUME</a>` : ""}
    </div>
    <div class="pf-clist">${c.links.map(x => x.url
      ? `<a href="${pfEsc(x.url)}"${/^https?:/i.test(x.url) ? ` target="_blank" rel="noopener"` : ""}>${x.icon}${pfEsc(x.handle)}</a>`
      : `<span>${x.icon}${pfEsc(x.handle)}</span>`).join("")}</div>
  </div></section>` : ""}

  <footer>(C) ${c.year} ${pfEsc(c.name.toUpperCase())}${d.footer_note ? " · " + pfEsc(d.footer_note.toUpperCase()) : ""}</footer>
</div></main>`;

  const js = `
(function(){
  var links = [].slice.call(document.querySelectorAll('.pf-nav-links a'));
  var secs = links.map(function(a){ return document.querySelector(a.getAttribute('href')); }).filter(Boolean);
  if ('IntersectionObserver' in window && secs.length) {
    var spy = new IntersectionObserver(function(es){
      es.forEach(function(e){ if(!e.isIntersecting) return;
        links.forEach(function(a){ a.classList.toggle('pf-active', a.getAttribute('href') === '#' + e.target.id); }); });
    }, { rootMargin:'-45% 0px -50% 0px' });
    secs.forEach(function(s){ spy.observe(s); });
  }

  /* The score counts how far you have read. It is the only honest number a
     portfolio can put in an arcade HUD, and it gives the top bar a reason to
     exist beyond decoration. Padded to six digits like the real thing. */
  var el = document.querySelector('[data-score]');
  if (!el) return;
  var t = false;
  function paint(){
    t = false;
    var max = document.documentElement.scrollHeight - innerHeight;
    var pct = max > 0 ? window.scrollY / max : 0;
    var n = Math.round(pct * 999999);
    el.textContent = String(n).padStart(6, '0');
  }
  addEventListener('scroll', function(){ if (!t) { t = true; requestAnimationFrame(paint); } }, { passive:true });
  paint();
})();`;

  return { fonts: ["Press+Start+2P", c.googleFont ? null : "Inter:wght@400;600;700"].filter(Boolean),
           css, body, js, themeColor: "#FFF9E6" };
};


// ---------------------------------------------------------------------------
// 29. BOTANICAL — one vine, drawn by the scrollbar. The stem's dash offset is
//     tied to how far down the page you are, so the plant grows exactly as
//     fast as you read and the leaves open as the stem reaches them.
// ---------------------------------------------------------------------------
PF_RENDERERS.botanical = (c) => {
  const d = c.d;
  const a2 = pfHueShift(c.accent, -128), a3 = pfHueShift(c.accent, 48);
  const nav = c.navItems.map(n => `<a href="#${n.id}">${pfEsc(n.label)}</a>`).join("");

  // One long stem plus leaves hung off it at fixed heights. Both are drawn in
  // a 100x1000 box and stretched, so the vine always spans the page whatever
  // the content length turns out to be.
  const LEAVES = [80, 175, 270, 365, 460, 555, 650, 745, 840, 930];
  const leafPath = (y, i) => {
    const flip = i % 2 === 0;
    const x = 50, dx = flip ? 34 : -34;
    return `<path class="pf-leaf" style="--i:${i}"
      d="M${x} ${y} C${x + dx * .5} ${y - 20},${x + dx} ${y - 14},${x + dx} ${y + 3}
         C${x + dx} ${y + 20},${x + dx * .45} ${y + 16},${x} ${y}Z"
      fill="${i % 3 === 0 ? pfEsc(a3) : pfEsc(c.accent)}" opacity="${i % 3 === 0 ? ".55" : ".72"}"/>`;
  };

  const css = `
:root{
  --acc:${c.accent}; --a2:${a2}; --a3:${a3};
  --ink:#20302A; --muted:#4F6459; --faint:#8CA096;
  --bg:#F7FBF4; --card:#FFFFFF; --line:#DDEAD8;
  --serif:'Fraunces',Georgia,'Times New Roman',serif;
  --font:${c.fontStack || `'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif`};
}
body{background:var(--bg);color:var(--ink);font-family:var(--font);font-size:16px;line-height:1.72;overflow-x:hidden}
.pf-skip{background:var(--acc);color:#fff}
.pf-shell{width:min(900px,88vw);margin:0 auto}
.pf-vine{position:fixed;left:max(1.5vw,calc(50vw - 450px - 96px));top:0;width:96px;height:100vh;z-index:1;
  pointer-events:none}
.pf-vine svg{width:100%;height:100%}
.pf-stem{fill:none;stroke:var(--acc);stroke-width:3;stroke-linecap:round;
  stroke-dasharray:2400;stroke-dashoffset:calc(2400 - 2400 * var(--grow,.1))}
.pf-leaf{transform-origin:50px center;opacity:0;transform:scale(.2) rotate(-18deg);
  transition:opacity .5s ease,transform .6s cubic-bezier(.2,1.4,.4,1)}
.pf-vine.pf-open .pf-leaf{opacity:1;transform:none;transition-delay:calc(var(--i) * 40ms)}
main{position:relative;z-index:2}

.pf-nav{position:sticky;top:0;z-index:20;background:${pfRgba("#F7FBF4", .93)};
  backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border-bottom:1px solid transparent;transition:.25s}
.pf-nav.pf-stuck{border-bottom-color:var(--line)}
.pf-nav-in{display:flex;align-items:center;gap:1.2rem;padding:.85rem 0}
.pf-brand{font-family:var(--serif);font-weight:600;font-size:1.08rem;text-decoration:none;
  display:flex;align-items:center;gap:.6rem}
.pf-brand i{width:30px;height:30px;display:grid;place-items:center;font-family:var(--font);font-size:.66rem;
  font-weight:700;font-style:normal;color:#fff;background:var(--acc);
  border-radius:60% 40% 55% 45%/55% 45% 60% 40%}
.pf-nav-links{display:flex;gap:1rem;margin-left:auto}
.pf-nav-links a{font-size:.87rem;color:var(--muted);text-decoration:none;transition:.2s;position:relative}
.pf-nav-links a::after{content:"";position:absolute;left:0;right:100%;bottom:-3px;height:2px;
  background:var(--acc);border-radius:2px;transition:right .3s}
.pf-nav-links a:hover,.pf-nav-links a.pf-active{color:var(--acc)}
.pf-nav-links a:hover::after,.pf-nav-links a.pf-active::after{right:0}

.pf-hero{padding:clamp(2.8rem,7vw,4.5rem) 0 clamp(1.8rem,4vw,2.6rem);
  display:grid;grid-template-columns:minmax(0,1fr) auto;gap:2.4rem;align-items:center}
.pf-badge{display:inline-flex;align-items:center;gap:.5rem;padding:.32rem .95rem;border-radius:999px;
  background:${pfRgba(c.accent, .12)};color:var(--acc);font-size:.8rem;font-weight:600;margin-bottom:1rem}
.pf-hero h1{font-family:var(--serif);font-size:clamp(2.2rem,6vw,3.6rem);font-weight:600;letter-spacing:-.03em;
  line-height:1.08;margin-bottom:.4rem}
.pf-hero h2{font-size:clamp(.98rem,2.1vw,1.15rem);font-weight:600;color:var(--acc);margin-bottom:.8rem}
.pf-hero p{color:var(--muted);max-width:46ch}
.pf-portrait{width:min(190px,32vw);aspect-ratio:1;position:relative}
.pf-portrait::before{content:"";position:absolute;inset:-10%;background:${pfRgba(a3, .3)};
  border-radius:62% 38% 46% 54%/48% 60% 40% 52%}
.pf-avatar{position:relative;width:100%;height:100%;object-fit:cover;
  border-radius:58% 42% 50% 50%/46% 56% 44% 54%}
.pf-avatar-initials{display:grid;place-items:center;font-family:var(--serif);font-size:2.8rem;font-weight:600;
  color:#fff;background:linear-gradient(150deg,var(--acc),${pfShade(c.accent, -0.2)})}
.pf-actions{display:flex;flex-wrap:wrap;gap:.6rem;align-items:center;margin-top:1.4rem}
.pf-btn{display:inline-flex;align-items:center;gap:.5rem;padding:.72rem 1.4rem;border-radius:999px;font-weight:600;
  font-size:.9rem;text-decoration:none;border:1.5px solid transparent;transition:.25s}
.pf-btn svg{width:16px;height:16px}
.pf-btn-primary{background:var(--acc);color:#fff;box-shadow:0 8px 20px ${pfRgba(c.accent, .28)}}
.pf-btn-primary:hover{transform:translateY(-3px);box-shadow:0 12px 26px ${pfRgba(c.accent, .38)}}
.pf-btn-ghost{background:var(--card);border-color:var(--line);color:var(--ink)}
.pf-btn-ghost:hover{border-color:var(--acc);color:var(--acc);transform:translateY(-3px)}
.pf-socials{display:flex;gap:.45rem}
.pf-socials a{display:grid;place-items:center;width:40px;height:40px;background:var(--card);
  border:1.5px solid var(--line);color:var(--muted);transition:.25s;
  border-radius:58% 42% 50% 50%/50% 55% 45% 50%}
.pf-socials a svg{width:16px;height:16px}
.pf-socials a:hover{color:#fff;background:var(--acc);border-color:var(--acc);transform:translateY(-3px) rotate(-8deg)}

.pf-sec{padding:clamp(2rem,5vw,3.2rem) 0}
.pf-kicker{font-size:.72rem;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:var(--a2);margin-bottom:.3rem}
.pf-h2{font-family:var(--serif);font-size:clamp(1.5rem,3.6vw,2.2rem);font-weight:600;letter-spacing:-.025em;
  margin-bottom:1.5rem}
.pf-card{background:var(--card);border:1px solid var(--line);border-radius:20px;transition:.28s}
.pf-card:hover{border-color:${pfRgba(c.accent, .45)};transform:translateY(-4px);box-shadow:0 16px 34px rgba(32,48,42,.08)}
.pf-about{padding:1.9rem;white-space:pre-line;color:var(--muted)}
.pf-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:1rem}
.pf-stat{padding:1.5rem 1rem;text-align:center}
.pf-stat b{display:block;font-family:var(--serif);font-size:2.1rem;font-weight:600;color:var(--acc);line-height:1}
.pf-stat span{font-size:.77rem;color:var(--faint)}
.pf-chips{display:flex;flex-wrap:wrap;gap:.5rem}
.pf-chip{padding:.42rem 1rem;border-radius:999px;font-size:.87rem;color:var(--muted);background:var(--card);
  border:1px solid var(--line);transition:.24s;cursor:default}
.pf-chip:hover{color:var(--acc);border-color:var(--acc);background:${pfRgba(c.accent, .08)};transform:translateY(-2px)}
.pf-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:1.1rem}
.pf-proj{padding:1.7rem;position:relative;overflow:hidden}
.pf-proj::after{content:"";position:absolute;right:-30px;bottom:-34px;width:110px;height:110px;
  background:${pfRgba(a3, .22)};border-radius:60% 40% 50% 50%/45% 55% 45% 55%;transition:.4s}
.pf-proj:hover::after{transform:scale(1.2) rotate(20deg)}
.pf-proj>*{position:relative}
.pf-proj h3{font-family:var(--serif);font-size:1.18rem;font-weight:600;margin-bottom:.1rem}
.pf-proj .pf-role,.pf-row .pf-org{font-size:.8rem;color:var(--acc);font-weight:600;margin-bottom:.6rem}
.pf-proj p,.pf-row p{color:var(--muted);font-size:.93rem}
.pf-proj ul,.pf-row ul{margin-top:.55rem}
.pf-proj li,.pf-row li{color:var(--muted);font-size:.89rem;padding-left:1.25rem;position:relative;margin-bottom:.24rem}
.pf-proj li::before,.pf-row li::before{content:"";position:absolute;left:0;top:.55em;width:9px;height:9px;
  background:var(--acc);border-radius:60% 40% 50% 50%/45% 55% 45% 55%}
.pf-tags{display:flex;flex-wrap:wrap;gap:.32rem;margin-top:.85rem}
.pf-tag{font-size:.71rem;font-weight:600;padding:.16rem .58rem;border-radius:999px;color:var(--a2);
  background:${pfRgba(a2, .13)}}
.pf-links{display:flex;gap:1rem;margin-top:.85rem;font-size:.84rem;font-weight:600}
.pf-links a{color:var(--acc);text-decoration:none;display:inline-flex;align-items:center;gap:.3rem}
.pf-links a svg{width:14px;height:14px}
.pf-rows{display:grid;gap:.9rem}
.pf-row{padding:1.5rem 1.7rem}
.pf-row-top{display:flex;flex-wrap:wrap;gap:.25rem 1rem;align-items:baseline}
.pf-row h3{font-family:var(--serif);font-size:1.1rem;font-weight:600}
.pf-row .pf-when{margin-left:auto;color:var(--faint);font-size:.82rem;white-space:nowrap}
.pf-contact{padding:clamp(2.2rem,5vw,3.4rem);text-align:center;border-radius:26px;
  background:linear-gradient(150deg,${pfRgba(c.accent, .12)},${pfRgba(a3, .16)});border:1px solid var(--line)}
.pf-contact h2{font-family:var(--serif);font-size:clamp(1.7rem,4.5vw,2.5rem);font-weight:600;
  letter-spacing:-.03em;margin-bottom:.6rem}
.pf-contact p{color:var(--muted);max-width:44ch;margin:0 auto 1.5rem}
.pf-clist{display:flex;flex-wrap:wrap;gap:.6rem 1.6rem;justify-content:center;margin-top:1.5rem;font-size:.88rem}
.pf-clist a,.pf-clist span{color:var(--muted);text-decoration:none;display:inline-flex;align-items:center;gap:.42rem}
.pf-clist svg{width:16px;height:16px;color:var(--acc)}
.pf-clist a:hover{color:var(--acc)}
footer{padding:2.6rem 0;text-align:center;color:var(--faint);font-size:.85rem}
@media (max-width:1120px){.pf-vine{display:none}}
@media (max-width:820px){.pf-nav-links{display:none}.pf-hero{grid-template-columns:1fr}
  .pf-portrait{order:-1;margin:0 auto}.pf-row .pf-when{margin-left:0;width:100%}}
@media (prefers-reduced-motion:reduce){
  .pf-stem{stroke-dashoffset:0}
  .pf-leaf{opacity:1;transform:none;transition:none}}`;

  const body = `
<div class="pf-vine" id="pf-vine" aria-hidden="true">
  <svg viewBox="0 0 100 1000" preserveAspectRatio="none">
    <path class="pf-stem" d="M50 0 C22 90,78 170,50 260 C22 350,78 430,50 520 C22 610,78 690,50 780 C22 870,72 940,50 1000"/>
    ${LEAVES.map((y, i) => leafPath(y, i)).join("")}
  </svg>
</div>

<nav class="pf-nav pf-noprint"><div class="pf-shell pf-nav-in">
  <a class="pf-brand" href="#top"><i>${pfEsc(c.initials)}</i>${pfEsc(c.name)}</a>
  ${nav ? `<div class="pf-nav-links">${nav}</div>` : ""}
</div></nav>

<main id="main"><div class="pf-shell">
  <section class="pf-hero" id="top">
    <div>
      ${d.available ? `<div class="pf-badge">${pfEsc(d.available)}</div>` : ""}
      <h1>${pfEsc(c.name)}</h1>
      ${c.title ? `<h2>${pfEsc(c.title)}</h2>` : ""}
      ${c.tagline ? `<p>${pfEsc(c.tagline)}</p>` : ""}
      <div class="pf-actions">
        ${d.email ? `<a class="pf-btn pf-btn-primary" href="mailto:${pfEsc(d.email)}">${PF_ICONS.mail}${pfEsc(d.cta_text || "Get in touch")}</a>` : ""}
        ${c.hasResume ? `<a class="pf-btn pf-btn-ghost" ${pfResumeAttrs(c)}>${PF_ICONS.download}${pfEsc(c.resumeLabel)}</a>` : ""}
        ${pfSocialRow(c)}
      </div>
    </div>
    <div class="pf-portrait">${pfAvatar(c)}</div>
  </section>

  ${c.has("stats") ? `<section class="pf-sec"><div class="pf-stats">
    ${d.stats.map((x, i) => `<div class="pf-card pf-stat" data-reveal data-reveal-delay="${i * 70}">
      <b>${pfEsc(x.value)}</b><span>${pfEsc(x.label)}</span></div>`).join("")}</div></section>` : ""}

  ${c.has("about") ? `<section class="pf-sec" id="about"><div class="pf-kicker">Roots</div>
    <h2 class="pf-h2">A little about me</h2>
    <div class="pf-card pf-about" data-reveal>${pfEsc(d.about)}</div></section>` : ""}

  ${c.has("skills") ? `<section class="pf-sec" id="skills"><div class="pf-kicker">Cultivated</div>
    <h2 class="pf-h2">What I work with</h2>
    <div class="pf-chips" data-reveal>${d.skills.map(x => `<span class="pf-chip">${pfEsc(x)}</span>`).join("")}</div></section>` : ""}

  ${c.has("projects") ? `<section class="pf-sec" id="projects"><div class="pf-kicker">Harvest</div>
    <h2 class="pf-h2">Selected work</h2>
    <div class="pf-grid">${d.projects.map((x, i) => `
      <article class="pf-card pf-proj" data-reveal data-reveal-delay="${Math.min(i, 5) * 80}">
        <h3>${pfEsc(x.name || "")}</h3>
        ${pfJoin([x.role, x.period]) ? `<div class="pf-role">${pfJoin([x.role, x.period])}</div>` : ""}
        ${x.description ? `<p>${pfEsc(x.description)}</p>` : ""}
        ${(x.bullets || []).length ? `<ul>${x.bullets.map(b => `<li>${pfEsc(b)}</li>`).join("")}</ul>` : ""}
        ${(x.tags || []).length ? `<div class="pf-tags">${x.tags.map(t => `<span class="pf-tag">${pfEsc(t)}</span>`).join("")}</div>` : ""}
        ${pfProjectLinks(x) ? `<div class="pf-links">${pfProjectLinks(x)}</div>` : ""}
      </article>`).join("")}</div></section>` : ""}

  ${c.has("experience") ? `<section class="pf-sec" id="experience"><div class="pf-kicker">Growth</div>
    <h2 class="pf-h2">Where I have worked</h2>
    <div class="pf-rows">${d.experience.map((x, i) => `
      <article class="pf-card pf-row" data-reveal data-reveal-delay="${Math.min(i, 5) * 70}">
        <div class="pf-row-top"><h3>${pfEsc(x.role || "")}</h3>
          ${x.period ? `<span class="pf-when">${pfEsc(x.period)}</span>` : ""}</div>
        ${x.org ? `<div class="pf-org">${pfJoin([x.org, x.location])}</div>` : ""}
        ${x.summary ? `<p>${pfEsc(x.summary)}</p>` : ""}
        ${(x.bullets || []).length ? `<ul>${x.bullets.map(b => `<li>${pfEsc(b)}</li>`).join("")}</ul>` : ""}
      </article>`).join("")}</div></section>` : ""}

  ${c.has("education") ? `<section class="pf-sec" id="education"><div class="pf-kicker">Seeded</div>
    <h2 class="pf-h2">Where I studied</h2>
    <div class="pf-rows">${d.education.map(x => `
      <article class="pf-card pf-row" data-reveal>
        <div class="pf-row-top"><h3>${pfEsc(x.degree || "")}</h3>
          ${x.period ? `<span class="pf-when">${pfEsc(x.period)}</span>` : ""}</div>
        ${x.school ? `<div class="pf-org">${pfEsc(x.school)}</div>` : ""}
        ${x.detail ? `<p>${pfEsc(x.detail)}</p>` : ""}
      </article>`).join("")}</div></section>` : ""}

  ${c.has("certifications") ? `<section class="pf-sec" id="certifications"><div class="pf-kicker">Pressed</div>
    <h2 class="pf-h2">Certifications</h2>
    <div class="pf-chips" data-reveal>${d.certifications.map(x => `<span class="pf-chip">${pfEsc(x)}</span>`).join("")}</div></section>` : ""}

  ${c.has("contact") ? `<section class="pf-sec" id="contact"><div class="pf-contact" data-reveal>
    <h2>Let's grow something</h2>
    <p>${pfEsc(d.cta_text || "Slow replies, considered ones. Write whenever.")}</p>
    <div class="pf-actions" style="justify-content:center;margin-top:0">
      ${d.email ? `<a class="pf-btn pf-btn-primary" href="mailto:${pfEsc(d.email)}">${PF_ICONS.mail}${pfEsc(d.email)}</a>` : ""}
      ${c.hasResume ? `<a class="pf-btn pf-btn-ghost" ${pfResumeAttrs(c)}>${PF_ICONS.download}Résumé</a>` : ""}
    </div>
    <div class="pf-clist">${c.links.map(x => x.url
      ? `<a href="${pfEsc(x.url)}"${/^https?:/i.test(x.url) ? ` target="_blank" rel="noopener"` : ""}>${x.icon}${pfEsc(x.handle)}</a>`
      : `<span>${x.icon}${pfEsc(x.handle)}</span>`).join("")}</div>
  </div></section>` : ""}

  <footer>© <span data-year>${c.year}</span> ${pfEsc(c.name)}${d.footer_note ? " · " + pfEsc(d.footer_note) : ""}</footer>
</div></main>`;

  const js = `
(function(){
  var nav = document.querySelector('.pf-nav');
  var onNav = function(){ nav.classList.toggle('pf-stuck', window.scrollY > 8); };
  onNav(); addEventListener('scroll', onNav, { passive:true });
  var links = [].slice.call(document.querySelectorAll('.pf-nav-links a'));
  var secs = links.map(function(a){ return document.querySelector(a.getAttribute('href')); }).filter(Boolean);
  if ('IntersectionObserver' in window && secs.length) {
    var spy = new IntersectionObserver(function(es){
      es.forEach(function(e){ if(!e.isIntersecting) return;
        links.forEach(function(a){ a.classList.toggle('pf-active', a.getAttribute('href') === '#' + e.target.id); }); });
    }, { rootMargin:'-45% 0px -50% 0px' });
    secs.forEach(function(s){ spy.observe(s); });
  }

  /* Growth is scroll position, not a timer.
     --grow is the fraction of the page read; the stem's dash offset is derived
     from it in CSS, so the plant is exactly as far along as the reader is —
     scroll back up and it retracts, which a one-shot animation cannot do. */
  var vine = document.getElementById('pf-vine');
  if (!vine || (matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches)) return;
  var t = false;
  function paint(){
    t = false;
    var max = document.documentElement.scrollHeight - innerHeight;
    var pct = max > 0 ? Math.min(1, window.scrollY / max) : 1;
    // Floor it: a plant that is invisible until you scroll looks like a broken
    // asset, and the card previews never scroll at all.
    vine.style.setProperty('--grow', Math.max(0.1, pct).toFixed(4));
    vine.classList.add('pf-open');
  }
  addEventListener('scroll', function(){ if (!t) { t = true; requestAnimationFrame(paint); } }, { passive:true });
  addEventListener('resize', paint, { passive:true });
  paint();
})();`;

  return { fonts: ["Fraunces:opsz,wght@9..144,600", c.googleFont ? null : "Inter:wght@400;600;700"].filter(Boolean),
           css, body, js, themeColor: "#F7FBF4" };
};


// ---------------------------------------------------------------------------
// 30. BAUHAUS — a poster that reassembles itself. Primaries, a hard twelve
//     column grid, and oversized arcs that slide in from opposite edges as each
//     block arrives.
// ---------------------------------------------------------------------------
PF_RENDERERS.bauhaus = (c) => {
  const d = c.d;
  const blue = pfHueShift(c.accent, -140), yellow = pfHueShift(c.accent, 44);
  const nav = c.navItems.map(n => `<a href="#${n.id}">${pfEsc(n.label)}</a>`).join("");

  const css = `
:root{
  --red:${c.accent}; --blue:${blue}; --yellow:${yellow};
  --ink:#141414; --muted:#4B4B48; --faint:#8B8B85;
  --bg:#F5F1E8; --card:#FFFFFF; --line:#141414;
  --font:${c.fontStack || `'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif`};
}
body{background:var(--bg);color:var(--ink);font-family:var(--font);font-size:16px;line-height:1.66;overflow-x:hidden}
.pf-skip{background:var(--red);color:#fff}
.pf-shell{width:min(1100px,92vw);margin:0 auto}
.pf-nav{position:sticky;top:0;z-index:20;background:var(--bg);border-bottom:3px solid var(--line)}
.pf-nav-in{display:flex;align-items:center;gap:1.1rem;padding:.7rem 0}
.pf-brand{font-weight:800;font-size:1.02rem;letter-spacing:-.04em;text-transform:uppercase;text-decoration:none;
  display:flex;align-items:center;gap:.6rem}
.pf-brand i{width:26px;height:26px;display:grid;place-items:center;font-size:.62rem;font-style:normal;
  color:#fff;background:var(--red);border-radius:50%}
.pf-nav-links{display:flex;gap:1rem;margin-left:auto}
.pf-nav-links a{font-size:.76rem;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);
  text-decoration:none;transition:.2s}
.pf-nav-links a:hover,.pf-nav-links a.pf-active{color:var(--red)}

/* The composition. Twelve columns and hard blocks — the grid IS the design, so
   nothing here gets a border radius or a shadow to soften it. */
.pf-grid12{display:grid;grid-template-columns:repeat(12,1fr);gap:0;border:3px solid var(--line);
  border-bottom:0;margin:clamp(1.6rem,4vw,2.6rem) 0}
.pf-cell{border-bottom:3px solid var(--line);border-right:3px solid var(--line);padding:clamp(1.3rem,3vw,2rem);
  position:relative;overflow:hidden}
.pf-cell:last-child{border-right:0}
.pf-c12{grid-column:span 12;border-right:0}
.pf-c8{grid-column:span 8}
.pf-c7{grid-column:span 7}
.pf-c6{grid-column:span 6}
.pf-c5{grid-column:span 5;border-right:0}
.pf-c4{grid-column:span 4;border-right:0}
.pf-c3{grid-column:span 3}
.pf-red{background:var(--red);color:#fff}
.pf-blue{background:var(--blue);color:#fff}
.pf-yellow{background:var(--yellow)}
.pf-white{background:var(--card)}

/* The arcs slide in from the edge the block sits on, so the composition
   assembles inward rather than everything drifting the same way. */
.pf-arc{position:absolute;pointer-events:none;
  transition:transform 1s cubic-bezier(.2,.8,.2,1),opacity .7s ease}
.pf-arc-l{left:-38%;bottom:-52%;width:78%;aspect-ratio:1;border-radius:50%;
  transform:translateX(-40%) scale(.7);opacity:0}
.pf-arc-r{right:-30%;top:-46%;width:66%;aspect-ratio:1;border-radius:0 0 0 100%;
  transform:translateX(40%) scale(.7);opacity:0}
.pf-cell.pf-in .pf-arc{transform:none;opacity:1}
.pf-cell>*{position:relative;z-index:1}

.pf-hero h1{font-size:clamp(2.2rem,7vw,4.6rem);font-weight:800;letter-spacing:-.05em;line-height:.96;
  text-transform:uppercase;margin-bottom:.4rem}
.pf-hero h2{font-size:clamp(.95rem,2.2vw,1.2rem);font-weight:700;letter-spacing:.06em;text-transform:uppercase;
  margin-bottom:.8rem}
.pf-hero p{font-size:.98rem;max-width:44ch;opacity:.92}
.pf-num{font-size:clamp(2.6rem,7vw,4.6rem);font-weight:800;letter-spacing:-.05em;line-height:1}
.pf-lab{font-size:.7rem;font-weight:800;letter-spacing:.14em;text-transform:uppercase;opacity:.78}
.pf-shape{display:grid;place-items:center;min-height:120px}
.pf-shape i{display:block;width:64px;height:64px;background:currentColor}
.pf-shape.pf-circle i{border-radius:50%}
.pf-shape.pf-half i{border-radius:64px 64px 0 0}
.pf-shape.pf-tri i{width:0;height:0;background:none;border-left:34px solid transparent;
  border-right:34px solid transparent;border-bottom:60px solid currentColor}
.pf-cell.pf-portrait-cell{padding:0;display:grid}
.pf-avatar{width:100%;height:100%;min-height:200px;object-fit:cover;display:block}
.pf-avatar-initials{display:grid;place-items:center;min-height:200px;font-size:clamp(2.6rem,7vw,4.4rem);
  font-weight:800;color:#fff;background:var(--blue)}

.pf-actions{display:flex;flex-wrap:wrap;gap:.6rem;align-items:center;margin-top:1.3rem}
.pf-btn{display:inline-flex;align-items:center;gap:.5rem;padding:.7rem 1.4rem;font-weight:800;font-size:.8rem;
  letter-spacing:.09em;text-transform:uppercase;text-decoration:none;border:3px solid var(--line);transition:.15s}
.pf-btn svg{width:15px;height:15px}
.pf-btn-primary{background:var(--line);color:var(--bg)}
.pf-btn-primary:hover{background:var(--red);border-color:var(--red)}
.pf-btn-ghost{background:transparent;color:inherit;border-color:currentColor}
.pf-btn-ghost:hover{background:var(--line);color:var(--bg);border-color:var(--line)}
.pf-socials{display:flex;gap:.4rem}
.pf-socials a{display:grid;place-items:center;width:40px;height:40px;border:3px solid currentColor;
  color:inherit;transition:.15s}
.pf-socials a svg{width:16px;height:16px}
.pf-socials a:hover{background:var(--line);color:var(--bg);border-color:var(--line)}

.pf-sec{padding:0}
.pf-h2{font-size:clamp(1.4rem,3.6vw,2.2rem);font-weight:800;letter-spacing:-.04em;text-transform:uppercase;
  margin-bottom:1rem}
.pf-about{white-space:pre-line;color:var(--muted);font-size:.98rem}
.pf-chips{display:flex;flex-wrap:wrap;gap:.45rem}
.pf-chip{font-size:.78rem;font-weight:800;letter-spacing:.06em;text-transform:uppercase;padding:.28rem .75rem;
  border:2.5px solid var(--line);background:var(--card);transition:.14s;cursor:default}
.pf-chip:nth-child(3n+1):hover{background:var(--red);color:#fff;border-color:var(--red)}
.pf-chip:nth-child(3n+2):hover{background:var(--blue);color:#fff;border-color:var(--blue)}
.pf-chip:nth-child(3n):hover{background:var(--yellow)}
.pf-entry{padding-bottom:1rem;margin-bottom:1rem;border-bottom:2px solid ${pfRgba("#141414", .18)}}
.pf-entry:last-child{padding-bottom:0;margin-bottom:0;border-bottom:0}
.pf-entry-top{display:flex;flex-wrap:wrap;gap:.15rem .9rem;align-items:baseline}
.pf-entry h3{font-size:1.05rem;font-weight:800;letter-spacing:-.02em}
.pf-entry .pf-org{font-size:.76rem;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--red)}
.pf-entry .pf-when{margin-left:auto;font-size:.74rem;font-weight:800;letter-spacing:.08em;color:var(--faint);
  white-space:nowrap}
.pf-entry p{color:var(--muted);font-size:.93rem;margin-top:.25rem}
.pf-entry ul{margin-top:.45rem}
.pf-entry li{color:var(--muted);font-size:.89rem;padding-left:1.15rem;position:relative;margin-bottom:.2rem}
.pf-entry li::before{content:"";position:absolute;left:0;top:.6em;width:8px;height:8px;background:var(--blue)}
.pf-tags{display:flex;flex-wrap:wrap;gap:.3rem;margin-top:.65rem}
.pf-tag{font-size:.68rem;font-weight:800;letter-spacing:.07em;text-transform:uppercase;padding:.12rem .5rem;
  border:2px solid var(--line)}
.pf-links{display:flex;gap:1rem;margin-top:.7rem;font-size:.74rem;font-weight:800;letter-spacing:.08em;
  text-transform:uppercase}
.pf-links a{color:var(--red);text-decoration:none;display:inline-flex;align-items:center;gap:.3rem}
.pf-links a svg{width:13px;height:13px}
.pf-contact h2{font-size:clamp(1.8rem,5.5vw,3.2rem);font-weight:800;letter-spacing:-.05em;text-transform:uppercase;
  line-height:.98;margin-bottom:.6rem}
.pf-contact p{max-width:44ch;opacity:.92;margin-bottom:1.2rem}
.pf-clist{display:flex;flex-wrap:wrap;gap:.5rem 1.4rem;margin-top:1.2rem;font-size:.78rem;font-weight:700;
  letter-spacing:.05em}
.pf-clist a,.pf-clist span{color:inherit;opacity:.9;text-decoration:none;display:inline-flex;align-items:center;gap:.4rem}
.pf-clist svg{width:15px;height:15px}
footer{padding:2rem 0;text-align:center;font-size:.72rem;font-weight:800;letter-spacing:.16em;
  text-transform:uppercase;color:var(--faint)}
@media (max-width:900px){
  .pf-nav-links{display:none}
  .pf-c8,.pf-c7,.pf-c6,.pf-c5,.pf-c4,.pf-c3{grid-column:span 12;border-right:0}
  .pf-entry .pf-when{margin-left:0;width:100%}}
@media (prefers-reduced-motion:reduce){.pf-arc{transform:none!important;opacity:1!important;transition:none}}`;

  const entries = (arr, m) => arr.map(x => {
    const r = m(x);
    return `<article class="pf-entry">
      <div class="pf-entry-top"><h3>${pfEsc(r.title || "")}</h3>
        ${r.org ? `<span class="pf-org">${pfEsc(r.org)}</span>` : ""}
        ${r.when ? `<span class="pf-when">${pfEsc(r.when)}</span>` : ""}</div>
      ${r.text ? `<p>${pfEsc(r.text)}</p>` : ""}
      ${(r.bullets || []).length ? `<ul>${r.bullets.map(b => `<li>${pfEsc(b)}</li>`).join("")}</ul>` : ""}
      ${(r.tags || []).length ? `<div class="pf-tags">${r.tags.map(t => `<span class="pf-tag">${pfEsc(t)}</span>`).join("")}</div>` : ""}
      ${r.links ? `<div class="pf-links">${r.links}</div>` : ""}
    </article>`;
  }).join("");

  const body = `
<nav class="pf-nav pf-noprint"><div class="pf-shell pf-nav-in">
  <a class="pf-brand" href="#top"><i>${pfEsc(c.initials)}</i>${pfEsc(c.name)}</a>
  ${nav ? `<div class="pf-nav-links">${nav}</div>` : ""}
</div></nav>

<main id="main"><div class="pf-shell">
  <section id="top"><div class="pf-grid12">
    <div class="pf-cell pf-c7 pf-red pf-hero" data-reveal>
      <div class="pf-arc pf-arc-l" style="background:${pfRgba("#ffffff", .18)}"></div>
      <h1>${pfEsc(c.name)}</h1>
      ${c.title ? `<h2>${pfEsc(c.title)}</h2>` : ""}
      ${c.tagline ? `<p>${pfEsc(c.tagline)}</p>` : ""}
      <div class="pf-actions">
        ${d.email ? `<a class="pf-btn pf-btn-ghost" href="mailto:${pfEsc(d.email)}">${PF_ICONS.mail}${pfEsc(d.cta_text || "Get in touch")}</a>` : ""}
        ${c.hasResume ? `<a class="pf-btn pf-btn-ghost" ${pfResumeAttrs(c)}>${PF_ICONS.download}Résumé</a>` : ""}
      </div>
    </div>
    <div class="pf-cell pf-c5 pf-white pf-portrait-cell" data-reveal>${pfAvatar(c)}</div>

    <div class="pf-cell pf-c4 pf-blue pf-shape pf-circle" data-reveal><i></i></div>
    <div class="pf-cell pf-c4 pf-yellow" data-reveal>
      <div class="pf-arc pf-arc-r" style="background:${pfRgba("#141414", .1)}"></div>
      <div class="pf-lab">${pfEsc(d.location || "Studio")}</div>
      <div class="pf-num">${pfEsc(String(d.projects.length || 0)).padStart(2, "0")}</div>
      <div class="pf-lab">Projects</div>
    </div>
    <div class="pf-cell pf-c4 pf-white pf-shape pf-tri" style="color:${pfEsc(c.accent)}" data-reveal><i></i></div>

    ${c.has("stats") ? d.stats.slice(0, 4).map((x, i) => `
      <div class="pf-cell pf-c3 ${["pf-white", "pf-yellow", "pf-white", "pf-blue"][i % 4]}" data-reveal
           ${i === 3 ? 'style="border-right:0"' : ""}>
        <div class="pf-num">${pfEsc(x.value)}</div><div class="pf-lab">${pfEsc(x.label)}</div>
      </div>`).join("") : ""}

    ${c.has("about") ? `<div class="pf-cell pf-c7 pf-white" id="about" data-reveal>
      <h2 class="pf-h2">About</h2><div class="pf-about">${pfEsc(d.about)}</div></div>
      <div class="pf-cell pf-c5 pf-blue pf-shape pf-half" data-reveal>
        <div class="pf-arc pf-arc-r" style="background:${pfRgba("#ffffff", .16)}"></div><i></i></div>` : ""}

    ${c.has("skills") ? `<div class="pf-cell pf-c12 pf-white" id="skills" data-reveal>
      <h2 class="pf-h2">Skills</h2>
      <div class="pf-chips">${d.skills.map(x => `<span class="pf-chip">${pfEsc(x)}</span>`).join("")}</div></div>` : ""}

    ${c.has("projects") ? `<div class="pf-cell pf-c12 pf-yellow" id="projects" data-reveal>
      <div class="pf-arc pf-arc-l" style="background:${pfRgba("#141414", .08)}"></div>
      <h2 class="pf-h2">Work</h2>${entries(d.projects, x => ({ title: x.name, org: x.role, when: x.period,
        text: x.description, bullets: x.bullets, tags: x.tags, links: pfProjectLinks(x) }))}</div>` : ""}

    ${c.has("experience") ? `<div class="pf-cell pf-c12 pf-white" id="experience" data-reveal>
      <h2 class="pf-h2">Experience</h2>${entries(d.experience, x => ({ title: x.role,
        org: pfJoin([x.org, x.location]), when: x.period, text: x.summary, bullets: x.bullets }))}</div>` : ""}

    ${c.has("education") ? `<div class="pf-cell pf-c7 pf-white" id="education" data-reveal>
      <h2 class="pf-h2">Education</h2>${entries(d.education, x => ({ title: x.degree, org: x.school,
        when: x.period, text: x.detail }))}</div>
      <div class="pf-cell pf-c5 pf-red pf-shape pf-circle" data-reveal>
        <div class="pf-arc pf-arc-l" style="background:${pfRgba("#ffffff", .16)}"></div><i></i></div>` : ""}

    ${c.has("certifications") ? `<div class="pf-cell pf-c12 pf-white" id="certifications" data-reveal>
      <h2 class="pf-h2">Certifications</h2>
      <div class="pf-chips">${d.certifications.map(x => `<span class="pf-chip">${pfEsc(x)}</span>`).join("")}</div></div>` : ""}

    ${c.has("contact") ? `<div class="pf-cell pf-c12 pf-blue pf-contact" id="contact" data-reveal>
      <div class="pf-arc pf-arc-r" style="background:${pfRgba("#ffffff", .14)}"></div>
      <h2>Let's talk</h2>
      <p>${pfEsc(d.cta_text || "Straight lines, plain answers, no discovery call.")}</p>
      <div class="pf-actions" style="margin-top:0">
        ${d.email ? `<a class="pf-btn pf-btn-ghost" href="mailto:${pfEsc(d.email)}">${PF_ICONS.mail}${pfEsc(d.email)}</a>` : ""}
        ${pfSocialRow(c)}
      </div>
      <div class="pf-clist">${c.links.map(x => x.url
        ? `<a href="${pfEsc(x.url)}"${/^https?:/i.test(x.url) ? ` target="_blank" rel="noopener"` : ""}>${x.icon}${pfEsc(x.handle)}</a>`
        : `<span>${x.icon}${pfEsc(x.handle)}</span>`).join("")}</div></div>` : ""}
  </div></section>

  <footer>${pfEsc(c.name)} · ${c.year}${d.footer_note ? " · " + pfEsc(d.footer_note) : ""}</footer>
</div></main>`;

  const js = `
(function(){
  var links = [].slice.call(document.querySelectorAll('.pf-nav-links a'));
  var secs = links.map(function(a){ return document.querySelector(a.getAttribute('href')); }).filter(Boolean);
  if ('IntersectionObserver' in window && secs.length) {
    var spy = new IntersectionObserver(function(es){
      es.forEach(function(e){ if(!e.isIntersecting) return;
        links.forEach(function(a){ a.classList.toggle('pf-active', a.getAttribute('href') === '#' + e.target.id); }); });
    }, { rootMargin:'-45% 0px -50% 0px' });
    secs.forEach(function(s){ spy.observe(s); });
  }
})();`;

  return { fonts: [c.googleFont ? null : "Inter:wght@400;700;800"].filter(Boolean),
           css, body, js, themeColor: "#F5F1E8" };
};


// ---------------------------------------------------------------------------
// 31. CLAY — claymorphic. Every surface is a puffy shape lit from the top-left:
//     a dark shadow one way, a light one the other, and two insets to round the
//     edge. Pressing one squishes it inward.
// ---------------------------------------------------------------------------
PF_RENDERERS.clay = (c) => {
  const d = c.d;
  const a2 = pfHueShift(c.accent, 88), a3 = pfHueShift(c.accent, -62);
  const nav = c.navItems.map(n => `<a href="#${n.id}">${pfEsc(n.label)}</a>`).join("");

  const css = `
:root{
  --acc:${c.accent}; --a2:${a2}; --a3:${a3};
  --ink:#2E2A48; --muted:#635D89; --faint:#9C96BC;
  --bg:#F3F0FF; --card:#FBFAFF;
  --dark:${pfRgba("#2E2A48", .16)}; --light:#FFFFFF;
  --font:${c.fontStack || `'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif`};
}
body{background:var(--bg);color:var(--ink);font-family:var(--font);font-size:16px;line-height:1.7;overflow-x:hidden}
.pf-skip{background:var(--acc);color:#fff}
.pf-shell{width:min(1020px,91vw);margin:0 auto}
.pf-blobs{position:fixed;inset:0;z-index:0;pointer-events:none;overflow:hidden}
.pf-blobs i{position:absolute;display:block;border-radius:44% 56% 52% 48%/52% 44% 56% 48%;filter:blur(2px)}
.pf-blobs i:nth-child(1){width:34vw;height:34vw;top:-8vh;right:-6vw;background:${pfRgba(a2, .3)};
  animation:pf-wob 19s ease-in-out infinite}
.pf-blobs i:nth-child(2){width:26vw;height:26vw;top:52vh;left:-8vw;background:${pfRgba(a3, .26)};
  animation:pf-wob 25s ease-in-out infinite reverse}
@keyframes pf-wob{50%{border-radius:56% 44% 46% 54%/46% 56% 44% 54%;transform:translate(2vw,-3vh) rotate(9deg)}}
main{position:relative;z-index:2}

/* The clay surface. Light from the top-left: a soft dark shadow bottom-right,
   a white one top-left, then two insets to bevel the rim. Take away either
   inset and it flattens into an ordinary card. */
.pf-clay{background:var(--card);border-radius:28px;
  box-shadow:10px 10px 22px var(--dark),-8px -8px 20px var(--light),
             inset -4px -4px 9px ${pfRgba("#2E2A48", .07)},inset 5px 5px 10px var(--light);
  transition:box-shadow .3s ease,transform .3s cubic-bezier(.2,1.3,.4,1)}
/* Squish: the outer shadows collapse and the insets deepen, which is what a
   soft object does when you press it. Scale alone just looks like a zoom. */
.pf-clay:hover{transform:translateY(-3px) scale(.995);
  box-shadow:6px 6px 14px var(--dark),-5px -5px 13px var(--light),
             inset -6px -6px 13px ${pfRgba("#2E2A48", .1)},inset 7px 7px 15px var(--light)}
.pf-clay:active{transform:scale(.985);
  box-shadow:2px 2px 6px var(--dark),inset -8px -8px 16px ${pfRgba("#2E2A48", .13)},inset 9px 9px 18px var(--light)}

.pf-nav{position:sticky;top:0;z-index:20;background:${pfRgba("#F3F0FF", .88)};
  backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px)}
.pf-nav-in{display:flex;align-items:center;gap:1.2rem;padding:.8rem 0}
.pf-brand{font-weight:800;font-size:1.03rem;letter-spacing:-.025em;text-decoration:none;
  display:flex;align-items:center;gap:.6rem}
.pf-brand i{width:32px;height:32px;display:grid;place-items:center;font-size:.66rem;font-weight:800;font-style:normal;
  color:#fff;background:var(--acc);border-radius:12px;
  box-shadow:4px 4px 9px ${pfRgba(c.accent, .4)},inset -2px -2px 5px ${pfRgba("#000000", .16)},
             inset 2px 2px 5px ${pfRgba("#ffffff", .5)}}
.pf-nav-links{display:flex;gap:.2rem;margin-left:auto}
.pf-nav-links a{padding:.4rem .9rem;border-radius:12px;font-size:.86rem;font-weight:600;color:var(--muted);
  text-decoration:none;transition:.24s}
.pf-nav-links a:hover,.pf-nav-links a.pf-active{color:var(--acc);background:var(--card);
  box-shadow:4px 4px 9px var(--dark),-3px -3px 8px var(--light)}

.pf-hero{padding:clamp(2.6rem,7vw,4.2rem) 0 clamp(1.8rem,4vw,2.6rem);
  display:grid;grid-template-columns:minmax(0,1fr) auto;gap:2.4rem;align-items:center}
.pf-badge{display:inline-flex;align-items:center;gap:.5rem;padding:.4rem 1.05rem;border-radius:999px;
  background:var(--card);color:var(--acc);font-size:.8rem;font-weight:700;margin-bottom:1.1rem;
  box-shadow:5px 5px 11px var(--dark),-4px -4px 10px var(--light)}
.pf-hero h1{font-size:clamp(2.2rem,6vw,3.6rem);font-weight:800;letter-spacing:-.04em;line-height:1.06;margin-bottom:.45rem}
.pf-hero h1 span{color:var(--acc)}
.pf-hero h2{font-size:clamp(.98rem,2.1vw,1.15rem);font-weight:600;color:var(--muted);margin-bottom:.8rem}
.pf-hero p{color:var(--muted);max-width:45ch}
.pf-portrait{width:min(200px,33vw);aspect-ratio:1;border-radius:34px;padding:14px;
  box-shadow:12px 12px 26px var(--dark),-9px -9px 22px var(--light)}
.pf-avatar{width:100%;height:100%;object-fit:cover;border-radius:22px}
.pf-avatar-initials{display:grid;place-items:center;font-size:2.8rem;font-weight:800;color:#fff;
  background:linear-gradient(140deg,var(--acc),var(--a3))}
.pf-actions{display:flex;flex-wrap:wrap;gap:.7rem;align-items:center;margin-top:1.5rem}
.pf-btn{display:inline-flex;align-items:center;gap:.5rem;padding:.78rem 1.5rem;border-radius:16px;font-weight:700;
  font-size:.9rem;text-decoration:none;border:0;transition:.26s cubic-bezier(.2,1.3,.4,1)}
.pf-btn svg{width:16px;height:16px}
.pf-btn-primary{background:var(--acc);color:#fff;
  box-shadow:7px 7px 16px ${pfRgba(c.accent, .4)},-4px -4px 12px var(--light),
             inset -3px -3px 7px ${pfRgba("#000000", .16)},inset 3px 3px 7px ${pfRgba("#ffffff", .35)}}
.pf-btn-primary:hover{transform:translateY(-2px) scale(.99);
  box-shadow:4px 4px 11px ${pfRgba(c.accent, .45)},inset -5px -5px 11px ${pfRgba("#000000", .2)},
             inset 5px 5px 11px ${pfRgba("#ffffff", .35)}}
.pf-btn-ghost{background:var(--card);color:var(--ink);
  box-shadow:7px 7px 15px var(--dark),-5px -5px 13px var(--light)}
.pf-btn-ghost:hover{transform:translateY(-2px) scale(.99);
  box-shadow:4px 4px 10px var(--dark),inset -4px -4px 9px ${pfRgba("#2E2A48", .09)},inset 5px 5px 10px var(--light)}
.pf-socials{display:flex;gap:.55rem}
.pf-socials a{display:grid;place-items:center;width:44px;height:44px;border-radius:15px;background:var(--card);
  color:var(--muted);transition:.26s cubic-bezier(.2,1.3,.4,1);
  box-shadow:6px 6px 13px var(--dark),-4px -4px 11px var(--light)}
.pf-socials a svg{width:16px;height:16px}
.pf-socials a:hover{color:var(--acc);transform:scale(.95);
  box-shadow:inset -4px -4px 9px ${pfRgba("#2E2A48", .1)},inset 5px 5px 10px var(--light)}

.pf-sec{padding:clamp(2rem,5vw,3.2rem) 0}
.pf-kicker{font-size:.72rem;font-weight:800;letter-spacing:.17em;text-transform:uppercase;color:var(--acc);margin-bottom:.35rem}
.pf-h2{font-size:clamp(1.5rem,3.6vw,2.2rem);font-weight:800;letter-spacing:-.035em;margin-bottom:1.6rem}
.pf-about{padding:2rem;white-space:pre-line;color:var(--muted)}
.pf-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:1.4rem}
.pf-stat{padding:1.6rem 1rem;text-align:center}
.pf-stat b{display:block;font-size:2.2rem;font-weight:800;letter-spacing:-.045em;color:var(--acc);line-height:1}
.pf-stat span{font-size:.77rem;color:var(--faint);font-weight:600}
.pf-chips{display:flex;flex-wrap:wrap;gap:.7rem}
.pf-chip{padding:.48rem 1.1rem;border-radius:14px;font-size:.87rem;font-weight:600;color:var(--muted);
  background:var(--card);cursor:default;transition:.26s cubic-bezier(.2,1.3,.4,1);
  box-shadow:5px 5px 11px var(--dark),-4px -4px 10px var(--light)}
.pf-chip:hover{color:var(--acc);transform:scale(.96);
  box-shadow:inset -3px -3px 8px ${pfRgba("#2E2A48", .1)},inset 4px 4px 9px var(--light)}
.pf-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(290px,1fr));gap:1.5rem}
.pf-proj{padding:1.8rem}
.pf-proj h3{font-size:1.16rem;font-weight:800;letter-spacing:-.02em;margin-bottom:.1rem}
.pf-proj .pf-role,.pf-row .pf-org{font-size:.8rem;color:var(--acc);font-weight:700;margin-bottom:.6rem}
.pf-proj p,.pf-row p{color:var(--muted);font-size:.93rem}
.pf-proj ul,.pf-row ul{margin-top:.55rem}
.pf-proj li,.pf-row li{color:var(--muted);font-size:.89rem;padding-left:1.25rem;position:relative;margin-bottom:.24rem}
.pf-proj li::before,.pf-row li::before{content:"";position:absolute;left:0;top:.55em;width:9px;height:9px;
  border-radius:50%;background:var(--a2);box-shadow:inset -1px -1px 2px ${pfRgba("#000000", .2)}}
.pf-tags{display:flex;flex-wrap:wrap;gap:.4rem;margin-top:.9rem}
.pf-tag{font-size:.72rem;font-weight:700;padding:.2rem .65rem;border-radius:9px;color:var(--acc);
  background:${pfRgba(c.accent, .12)}}
.pf-links{display:flex;gap:1rem;margin-top:.9rem;font-size:.84rem;font-weight:700}
.pf-links a{color:var(--acc);text-decoration:none;display:inline-flex;align-items:center;gap:.3rem}
.pf-links a svg{width:14px;height:14px}
.pf-rows{display:grid;gap:1.2rem}
.pf-row{padding:1.6rem 1.8rem}
.pf-row-top{display:flex;flex-wrap:wrap;gap:.25rem 1rem;align-items:baseline}
.pf-row h3{font-size:1.08rem;font-weight:800}
.pf-row .pf-when{margin-left:auto;color:var(--faint);font-size:.82rem;white-space:nowrap;font-weight:600}
.pf-contact{padding:clamp(2.2rem,5vw,3.4rem);text-align:center}
.pf-contact h2{font-size:clamp(1.7rem,4.5vw,2.5rem);font-weight:800;letter-spacing:-.04em;margin-bottom:.7rem}
.pf-contact p{color:var(--muted);max-width:44ch;margin:0 auto 1.5rem}
.pf-clist{display:flex;flex-wrap:wrap;gap:.6rem 1.6rem;justify-content:center;margin-top:1.5rem;font-size:.88rem}
.pf-clist a,.pf-clist span{color:var(--muted);text-decoration:none;display:inline-flex;align-items:center;gap:.42rem}
.pf-clist svg{width:16px;height:16px;color:var(--acc)}
.pf-clist a:hover{color:var(--acc)}
footer{padding:2.6rem 0;text-align:center;color:var(--faint);font-size:.85rem}
@media (max-width:820px){.pf-nav-links{display:none}.pf-hero{grid-template-columns:1fr}
  .pf-portrait{order:-1;margin:0 auto}.pf-row .pf-when{margin-left:0;width:100%}}
@media (prefers-reduced-motion:reduce){.pf-blobs i{animation:none}}`;

  const body = `
<div class="pf-blobs" aria-hidden="true"><i></i><i></i></div>
<nav class="pf-nav pf-noprint"><div class="pf-shell pf-nav-in">
  <a class="pf-brand" href="#top"><i>${pfEsc(c.initials)}</i>${pfEsc(c.name)}</a>
  ${nav ? `<div class="pf-nav-links">${nav}</div>` : ""}
</div></nav>

<main id="main"><div class="pf-shell">
  <section class="pf-hero" id="top">
    <div>
      ${d.available ? `<div class="pf-badge">${pfEsc(d.available)}</div>` : ""}
      <h1>${pfEsc(c.name.split(" ")[0] || c.name)} <span>${pfEsc(c.name.split(" ").slice(1).join(" "))}</span></h1>
      ${c.title ? `<h2>${pfEsc(c.title)}</h2>` : ""}
      ${c.tagline ? `<p>${pfEsc(c.tagline)}</p>` : ""}
      <div class="pf-actions">
        ${d.email ? `<a class="pf-btn pf-btn-primary" href="mailto:${pfEsc(d.email)}">${PF_ICONS.mail}${pfEsc(d.cta_text || "Say hello")}</a>` : ""}
        ${c.hasResume ? `<a class="pf-btn pf-btn-ghost" ${pfResumeAttrs(c)}>${PF_ICONS.download}${pfEsc(c.resumeLabel)}</a>` : ""}
        ${pfSocialRow(c)}
      </div>
    </div>
    <div class="pf-portrait">${pfAvatar(c)}</div>
  </section>

  ${c.has("stats") ? `<section class="pf-sec"><div class="pf-stats">
    ${d.stats.map((x, i) => `<div class="pf-clay pf-stat" data-reveal data-reveal-delay="${i * 70}">
      <b>${pfEsc(x.value)}</b><span>${pfEsc(x.label)}</span></div>`).join("")}</div></section>` : ""}

  ${c.has("about") ? `<section class="pf-sec" id="about"><div class="pf-kicker">About</div>
    <h2 class="pf-h2">The short version</h2>
    <div class="pf-clay pf-about" data-reveal>${pfEsc(d.about)}</div></section>` : ""}

  ${c.has("skills") ? `<section class="pf-sec" id="skills"><div class="pf-kicker">Toolkit</div>
    <h2 class="pf-h2">What I work with</h2>
    <div class="pf-chips" data-reveal>${d.skills.map(x => `<span class="pf-chip">${pfEsc(x)}</span>`).join("")}</div></section>` : ""}

  ${c.has("projects") ? `<section class="pf-sec" id="projects"><div class="pf-kicker">Work</div>
    <h2 class="pf-h2">Selected projects</h2>
    <div class="pf-grid">${d.projects.map((x, i) => `
      <article class="pf-clay pf-proj" data-reveal data-reveal-delay="${Math.min(i, 5) * 80}">
        <h3>${pfEsc(x.name || "")}</h3>
        ${pfJoin([x.role, x.period]) ? `<div class="pf-role">${pfJoin([x.role, x.period])}</div>` : ""}
        ${x.description ? `<p>${pfEsc(x.description)}</p>` : ""}
        ${(x.bullets || []).length ? `<ul>${x.bullets.map(b => `<li>${pfEsc(b)}</li>`).join("")}</ul>` : ""}
        ${(x.tags || []).length ? `<div class="pf-tags">${x.tags.map(t => `<span class="pf-tag">${pfEsc(t)}</span>`).join("")}</div>` : ""}
        ${pfProjectLinks(x) ? `<div class="pf-links">${pfProjectLinks(x)}</div>` : ""}
      </article>`).join("")}</div></section>` : ""}

  ${c.has("experience") ? `<section class="pf-sec" id="experience"><div class="pf-kicker">Experience</div>
    <h2 class="pf-h2">Where I have worked</h2>
    <div class="pf-rows">${d.experience.map((x, i) => `
      <article class="pf-clay pf-row" data-reveal data-reveal-delay="${Math.min(i, 5) * 70}">
        <div class="pf-row-top"><h3>${pfEsc(x.role || "")}</h3>
          ${x.period ? `<span class="pf-when">${pfEsc(x.period)}</span>` : ""}</div>
        ${x.org ? `<div class="pf-org">${pfJoin([x.org, x.location])}</div>` : ""}
        ${x.summary ? `<p>${pfEsc(x.summary)}</p>` : ""}
        ${(x.bullets || []).length ? `<ul>${x.bullets.map(b => `<li>${pfEsc(b)}</li>`).join("")}</ul>` : ""}
      </article>`).join("")}</div></section>` : ""}

  ${c.has("education") ? `<section class="pf-sec" id="education"><div class="pf-kicker">Education</div>
    <h2 class="pf-h2">Where I studied</h2>
    <div class="pf-rows">${d.education.map(x => `
      <article class="pf-clay pf-row" data-reveal>
        <div class="pf-row-top"><h3>${pfEsc(x.degree || "")}</h3>
          ${x.period ? `<span class="pf-when">${pfEsc(x.period)}</span>` : ""}</div>
        ${x.school ? `<div class="pf-org">${pfEsc(x.school)}</div>` : ""}
        ${x.detail ? `<p>${pfEsc(x.detail)}</p>` : ""}
      </article>`).join("")}</div></section>` : ""}

  ${c.has("certifications") ? `<section class="pf-sec" id="certifications"><div class="pf-kicker">Credentials</div>
    <h2 class="pf-h2">Certifications</h2>
    <div class="pf-chips" data-reveal>${d.certifications.map(x => `<span class="pf-chip">${pfEsc(x)}</span>`).join("")}</div></section>` : ""}

  ${c.has("contact") ? `<section class="pf-sec" id="contact"><div class="pf-clay pf-contact" data-reveal>
    <h2>Let's make something soft</h2>
    <p>${pfEsc(d.cta_text || "Say hello — I reply to everything that isn't automated.")}</p>
    <div class="pf-actions" style="justify-content:center;margin-top:0">
      ${d.email ? `<a class="pf-btn pf-btn-primary" href="mailto:${pfEsc(d.email)}">${PF_ICONS.mail}${pfEsc(d.email)}</a>` : ""}
      ${c.hasResume ? `<a class="pf-btn pf-btn-ghost" ${pfResumeAttrs(c)}>${PF_ICONS.download}Résumé</a>` : ""}
    </div>
    <div class="pf-clist">${c.links.map(x => x.url
      ? `<a href="${pfEsc(x.url)}"${/^https?:/i.test(x.url) ? ` target="_blank" rel="noopener"` : ""}>${x.icon}${pfEsc(x.handle)}</a>`
      : `<span>${x.icon}${pfEsc(x.handle)}</span>`).join("")}</div>
  </div></section>` : ""}

  <footer>© <span data-year>${c.year}</span> ${pfEsc(c.name)}${d.footer_note ? " · " + pfEsc(d.footer_note) : ""}</footer>
</div></main>`;

  const js = `
(function(){
  var links = [].slice.call(document.querySelectorAll('.pf-nav-links a'));
  var secs = links.map(function(a){ return document.querySelector(a.getAttribute('href')); }).filter(Boolean);
  if ('IntersectionObserver' in window && secs.length) {
    var spy = new IntersectionObserver(function(es){
      es.forEach(function(e){ if(!e.isIntersecting) return;
        links.forEach(function(a){ a.classList.toggle('pf-active', a.getAttribute('href') === '#' + e.target.id); }); });
    }, { rootMargin:'-45% 0px -50% 0px' });
    secs.forEach(function(s){ spy.observe(s); });
  }
})();`;

  return { fonts: [c.googleFont ? null : "Inter:wght@400;600;700;800"].filter(Boolean),
           css, body, js, themeColor: "#F3F0FF" };
};


// ---------------------------------------------------------------------------
// 32. CHART — the portfolio as an infographic.
//
//     Every mark encodes something the person actually wrote down: how many
//     skills sit in each category, and the real year span of each role parsed
//     out of its period. Nothing here invents a "proficiency 87%" — a bar whose
//     length is made up is worse than no bar, because it looks like evidence.
//
//     The categorical palette is the validated default (blue / orange / aqua /
//     yellow on #fcfcfb); its contrast check warns below 3:1, which obligates
//     visible labels — so every mark is directly labelled and a real table view
//     carries the same numbers for anyone the colour does not reach.
// ---------------------------------------------------------------------------
PF_RENDERERS.chart = (c) => {
  const d = c.d;
  const nav = c.navItems.map(n => `<a href="#${n.id}">${pfEsc(n.label)}</a>`).join("");
  const SERIES = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#4a3aa7"];

  // Year span out of a free-text period. Anything unparseable is dropped from
  // the plot rather than guessed at, and still appears in the table.
  const span = (period) => {
    const t = String(period || "");
    const found = (t.match(/(?:19|20)\d{2}/g) || []).map(Number);
    if (!found.length) return null;
    const open = /present|now|current/i.test(t);
    const from = Math.min.apply(null, found);
    const to = open ? c.year : (found.length > 1 ? Math.max.apply(null, found) : from + 1);
    return { from, to: Math.max(to, from + 1), open };
  };
  const roles = d.experience.map(x => ({ x, s: span(x.period) })).filter(r => r.s);
  const lo = roles.length ? Math.min.apply(null, roles.map(r => r.s.from)) : 0;
  const hi = roles.length ? Math.max.apply(null, roles.map(r => r.s.to)) : 0;
  const rangeYears = Math.max(1, hi - lo);
  const ticks = [];
  if (roles.length) {
    const step = rangeYears <= 6 ? 1 : (rangeYears <= 12 ? 2 : 5);
    for (let y = Math.ceil(lo / step) * step; y <= hi; y += step) ticks.push(y);
  }
  const maxGroup = Math.max(1, ...c.skillGroups.map(g => g.items.length));

  const css = `
:root{
  --acc:${c.accent}; --ink:#0b0b0b; --muted:#52514e; --faint:#8B8A85;
  --bg:#fcfcfb; --card:#FFFFFF; --line:#E6E5E0; --grid:#EFEEE9;
  --s1:${SERIES[0]}; --s2:${SERIES[1]}; --s3:${SERIES[2]}; --s4:${SERIES[3]};
  --font:${c.fontStack || `'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif`};
}
body{background:var(--bg);color:var(--ink);font-family:var(--font);font-size:16px;line-height:1.66}
.pf-skip{background:var(--acc);color:#fff}
.pf-shell{width:min(1000px,92vw);margin:0 auto}
.pf-nav{position:sticky;top:0;z-index:20;background:${pfRgba("#fcfcfb", .94)};
  backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border-bottom:1px solid transparent;transition:.25s}
.pf-nav.pf-stuck{border-bottom-color:var(--line)}
.pf-nav-in{display:flex;align-items:center;gap:1.2rem;padding:.8rem 0}
.pf-brand{font-weight:800;font-size:1.02rem;letter-spacing:-.025em;text-decoration:none;
  display:flex;align-items:center;gap:.6rem}
.pf-brand i{width:28px;height:28px;display:grid;place-items:center;font-size:.64rem;font-weight:800;font-style:normal;
  color:#fff;background:var(--s1);border-radius:6px}
.pf-nav-links{display:flex;gap:.15rem;margin-left:auto}
.pf-nav-links a{padding:.4rem .8rem;border-radius:6px;font-size:.85rem;font-weight:600;color:var(--muted);
  text-decoration:none;transition:.2s}
.pf-nav-links a:hover,.pf-nav-links a.pf-active{color:var(--s1);background:${pfRgba("#2a78d6", .09)}}

.pf-hero{padding:clamp(2.4rem,6vw,3.8rem) 0 clamp(1.4rem,3vw,2rem);
  display:grid;grid-template-columns:minmax(0,1fr) auto;gap:2.2rem;align-items:center}
.pf-badge{display:inline-flex;align-items:center;gap:.5rem;padding:.3rem .9rem;border-radius:5px;
  background:${pfRgba("#1baf7a", .13)};color:${SERIES[2]};font-size:.78rem;font-weight:700;margin-bottom:1rem}
.pf-hero h1{font-size:clamp(2rem,5.4vw,3.3rem);font-weight:800;letter-spacing:-.04em;line-height:1.06;margin-bottom:.4rem}
.pf-hero h2{font-size:clamp(.95rem,2.1vw,1.12rem);font-weight:600;color:var(--muted);margin-bottom:.7rem}
.pf-hero p{color:var(--muted);max-width:46ch}
.pf-avatar{width:min(158px,28vw);aspect-ratio:1;object-fit:cover;border-radius:10px;border:1px solid var(--line)}
.pf-avatar-initials{display:grid;place-items:center;font-size:2.4rem;font-weight:800;color:#fff;background:var(--s1)}
.pf-actions{display:flex;flex-wrap:wrap;gap:.6rem;align-items:center;margin-top:1.3rem}
.pf-btn{display:inline-flex;align-items:center;gap:.5rem;padding:.7rem 1.35rem;border-radius:7px;font-weight:600;
  font-size:.89rem;text-decoration:none;border:1px solid transparent;transition:.2s;cursor:pointer}
.pf-btn svg{width:15px;height:15px}
.pf-btn-primary{background:var(--s1);color:#fff}
.pf-btn-primary:hover{background:${pfShade("#2a78d6", -0.15)}}
.pf-btn-ghost{background:var(--card);border-color:var(--line);color:var(--ink)}
.pf-btn-ghost:hover{border-color:var(--s1);color:var(--s1)}
.pf-socials{display:flex;gap:.4rem}
.pf-socials a{display:grid;place-items:center;width:38px;height:38px;border-radius:7px;background:var(--card);
  border:1px solid var(--line);color:var(--muted);transition:.2s}
.pf-socials a svg{width:15px;height:15px}
.pf-socials a:hover{color:var(--s1);border-color:var(--s1)}

/* Hero numbers, not charts: four values with no relationship to each other are
   a stat row, and drawing them as bars would imply a comparison that isn't
   there. */
.pf-tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:1px;background:var(--line);
  border:1px solid var(--line);border-radius:10px;overflow:hidden}
.pf-tile{padding:1.4rem 1.1rem;background:var(--card)}
.pf-tile b{display:block;font-size:2rem;font-weight:800;letter-spacing:-.045em;line-height:1;
  font-variant-numeric:tabular-nums}
.pf-tile:nth-child(4n+1) b{color:var(--s1)}.pf-tile:nth-child(4n+2) b{color:var(--s2)}
.pf-tile:nth-child(4n+3) b{color:var(--s3)}.pf-tile:nth-child(4n) b{color:var(--s4)}
.pf-tile span{font-size:.76rem;color:var(--faint);font-weight:600}

.pf-sec{padding:clamp(1.8rem,4.5vw,2.8rem) 0}
.pf-fig{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:1.5rem}
.pf-fig-head{display:flex;align-items:baseline;gap:.8rem;flex-wrap:wrap;margin-bottom:.3rem}
.pf-fig-head h2{font-size:1.12rem;font-weight:800;letter-spacing:-.025em}
.pf-fig-sub{font-size:.83rem;color:var(--faint);margin-bottom:1.2rem}
.pf-toggle{margin-left:auto;font-size:.78rem;font-weight:600;color:var(--s1);background:none;border:0;
  cursor:pointer;padding:.2rem .1rem;border-bottom:1px solid currentColor}

/* Bars: thin marks, a 4px rounded data-end, and a 2px surface gap between
   rows. They grow from the baseline when the figure is first seen. */
.pf-bars{display:grid;gap:2px}
.pf-bar-row{display:grid;grid-template-columns:minmax(96px,auto) 1fr;gap:.9rem;align-items:center}
.pf-bar-lab{font-size:.82rem;color:var(--muted);font-weight:600;text-align:right}
.pf-bar-track{position:relative;height:26px;display:flex;align-items:center;gap:.55rem}
.pf-bar{height:14px;border-radius:0 4px 4px 0;width:0;transition:width .9s cubic-bezier(.2,.8,.2,1)}
.pf-in .pf-bar{width:var(--w)}
.pf-bar-val{font-size:.8rem;font-weight:700;color:var(--muted);font-variant-numeric:tabular-nums}
.pf-legend{display:flex;flex-wrap:wrap;gap:.5rem 1.1rem;margin-top:1rem;padding-top:.9rem;border-top:1px solid var(--grid)}
.pf-legend span{display:inline-flex;align-items:center;gap:.4rem;font-size:.78rem;color:var(--muted)}
.pf-legend i{width:10px;height:10px;border-radius:3px;display:block}

/* The career plot: one row per role on a shared year axis, so the reader can
   see overlap and gaps rather than a list of dates. */
.pf-plot{position:relative;padding-top:1.4rem}
.pf-axis{position:absolute;top:0;left:0;right:0;height:100%;pointer-events:none}
.pf-axis i{position:absolute;top:1.1rem;bottom:0;width:1px;background:var(--grid)}
.pf-axis b{position:absolute;top:0;transform:translateX(-50%);font-size:.7rem;color:var(--faint);
  font-weight:600;font-variant-numeric:tabular-nums}
.pf-plot-rows{position:relative;display:grid;gap:6px}
.pf-plot-row{position:relative;height:38px}
.pf-plot-bar{position:absolute;top:5px;height:28px;border-radius:5px;display:flex;align-items:center;
  padding:0 .6rem;gap:.5rem;overflow:hidden;transform:scaleX(0);transform-origin:left;
  transition:transform .8s cubic-bezier(.2,.8,.2,1)}
.pf-in .pf-plot-bar{transform:scaleX(1)}
.pf-plot-bar b{font-size:.78rem;font-weight:700;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pf-plot-bar span{font-size:.72rem;color:${pfRgba("#ffffff", .85)};white-space:nowrap}
.pf-plot-note{font-size:.78rem;color:var(--faint);margin-top:.9rem}

.pf-table{width:100%;border-collapse:collapse;font-size:.84rem;margin-top:1rem}
.pf-table caption{text-align:left;font-size:.78rem;color:var(--faint);padding-bottom:.5rem}
.pf-table th,.pf-table td{text-align:left;padding:.45rem .6rem;border-bottom:1px solid var(--grid)}
.pf-table th{font-weight:700;color:var(--ink);font-size:.76rem;letter-spacing:.04em;text-transform:uppercase}
.pf-table td{color:var(--muted);font-variant-numeric:tabular-nums}
[hidden]{display:none!important}

.pf-h2{font-size:clamp(1.4rem,3.4vw,2rem);font-weight:800;letter-spacing:-.035em;margin-bottom:1.2rem}
.pf-card{background:var(--card);border:1px solid var(--line);border-radius:10px;transition:.2s}
.pf-card:hover{border-color:${pfRgba("#2a78d6", .5)};transform:translateY(-2px);box-shadow:0 10px 24px rgba(11,11,11,.06)}
.pf-about{padding:1.6rem;white-space:pre-line;color:var(--muted)}
.pf-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:1rem}
.pf-proj{padding:1.5rem}
.pf-proj h3{font-size:1.08rem;font-weight:800;letter-spacing:-.02em;margin-bottom:.1rem}
.pf-proj .pf-role,.pf-row .pf-org{font-size:.78rem;color:var(--s1);font-weight:700;margin-bottom:.55rem}
.pf-proj p,.pf-row p{color:var(--muted);font-size:.92rem}
.pf-proj ul,.pf-row ul{margin-top:.5rem}
.pf-proj li,.pf-row li{color:var(--muted);font-size:.88rem;padding-left:1.1rem;position:relative;margin-bottom:.22rem}
.pf-proj li::before,.pf-row li::before{content:"";position:absolute;left:0;top:.62em;width:6px;height:6px;
  border-radius:2px;background:var(--s3)}
.pf-tags{display:flex;flex-wrap:wrap;gap:.3rem;margin-top:.8rem}
.pf-tag{font-size:.71rem;font-weight:600;padding:.14rem .5rem;border-radius:4px;color:var(--muted);background:var(--grid)}
.pf-links{display:flex;gap:1rem;margin-top:.8rem;font-size:.82rem;font-weight:700}
.pf-links a{color:var(--s1);text-decoration:none;display:inline-flex;align-items:center;gap:.3rem}
.pf-links a svg{width:14px;height:14px}
.pf-rows{display:grid;gap:.8rem}
.pf-row{padding:1.4rem 1.5rem}
.pf-row-top{display:flex;flex-wrap:wrap;gap:.25rem 1rem;align-items:baseline}
.pf-row h3{font-size:1.03rem;font-weight:800}
.pf-row .pf-when{margin-left:auto;color:var(--faint);font-size:.8rem;white-space:nowrap;font-variant-numeric:tabular-nums}
.pf-contact{padding:clamp(2rem,5vw,3rem);text-align:center}
.pf-contact h2{font-size:clamp(1.5rem,4vw,2.2rem);font-weight:800;letter-spacing:-.035em;margin-bottom:.6rem}
.pf-contact p{color:var(--muted);max-width:44ch;margin:0 auto 1.4rem}
.pf-clist{display:flex;flex-wrap:wrap;gap:.55rem 1.5rem;justify-content:center;margin-top:1.4rem;font-size:.86rem}
.pf-clist a,.pf-clist span{color:var(--muted);text-decoration:none;display:inline-flex;align-items:center;gap:.4rem}
.pf-clist svg{width:15px;height:15px;color:var(--s1)}
.pf-clist a:hover{color:var(--s1)}
footer{padding:2.2rem 0;text-align:center;color:var(--faint);font-size:.83rem;border-top:1px solid var(--line);margin-top:1.4rem}
@media (max-width:820px){.pf-nav-links{display:none}.pf-hero{grid-template-columns:1fr}
  .pf-avatar{order:-1}.pf-row .pf-when{margin-left:0;width:100%}
  .pf-bar-row{grid-template-columns:1fr}.pf-bar-lab{text-align:left}}
@media (prefers-reduced-motion:reduce){.pf-bar,.pf-plot-bar{transition:none}
  .pf-bar{width:var(--w)}.pf-plot-bar{transform:scaleX(1)}}`;

  const skillFig = c.skillGroups.length ? `
    <figure class="pf-fig" data-reveal>
      <div class="pf-fig-head"><h2>Skills by category</h2>
        <button type="button" class="pf-toggle" data-table="skills">Show table</button></div>
      <p class="pf-fig-sub">How many named skills sit in each group.</p>
      <div class="pf-bars" data-view="skills-chart">
        ${c.skillGroups.map((g, i) => `
          <div class="pf-bar-row">
            <div class="pf-bar-lab">${pfEsc(g.name || "Skills")}</div>
            <div class="pf-bar-track">
              <div class="pf-bar" style="--w:${Math.round(g.items.length / maxGroup * 100)}%;
                background:${SERIES[i % SERIES.length]}"></div>
              <span class="pf-bar-val">${g.items.length}</span>
            </div>
          </div>`).join("")}
      </div>
      ${c.skillGroups.length > 1 ? `<div class="pf-legend">
        ${c.skillGroups.map((g, i) => `<span><i style="background:${SERIES[i % SERIES.length]}"></i>${pfEsc(g.name || "Skills")}</span>`).join("")}
      </div>` : ""}
      <table class="pf-table" data-view="skills-table" hidden>
        <caption>Skills by category</caption>
        <thead><tr><th scope="col">Category</th><th scope="col">Count</th><th scope="col">Skills</th></tr></thead>
        <tbody>${c.skillGroups.map(g => `<tr><th scope="row">${pfEsc(g.name || "Skills")}</th>
          <td>${g.items.length}</td><td>${pfEsc(g.items.join(", "))}</td></tr>`).join("")}</tbody>
      </table>
    </figure>` : "";

  const plotFig = roles.length ? `
    <figure class="pf-fig" data-reveal>
      <div class="pf-fig-head"><h2>Career timeline</h2>
        <button type="button" class="pf-toggle" data-table="roles">Show table</button></div>
      <p class="pf-fig-sub">Each role plotted across the years it ran, ${lo}–${hi}.</p>
      <div class="pf-plot" data-view="roles-chart">
        <div class="pf-axis" aria-hidden="true">
          ${ticks.map(y => { const l = ((y - lo) / rangeYears * 100).toFixed(2);
            return `<b style="left:${l}%">${y}</b><i style="left:${l}%"></i>`; }).join("")}
        </div>
        <div class="pf-plot-rows">
          ${roles.map((r, i) => {
            const left = ((r.s.from - lo) / rangeYears * 100);
            const w = Math.max(6, ((r.s.to - r.s.from) / rangeYears * 100));
            return `<div class="pf-plot-row">
              <div class="pf-plot-bar" style="left:${left.toFixed(2)}%;width:${w.toFixed(2)}%;
                background:${SERIES[i % SERIES.length]};transition-delay:${i * 90}ms">
                <b>${pfEsc(r.x.role || "")}</b><span>${pfEsc(r.x.org || "")}</span></div>
            </div>`;
          }).join("")}
        </div>
      </div>
      <p class="pf-plot-note" data-view="roles-chart">Bars are drawn from the dates written on each role — nothing is estimated.</p>
      <table class="pf-table" data-view="roles-table" hidden>
        <caption>Career timeline</caption>
        <thead><tr><th scope="col">Role</th><th scope="col">Organisation</th><th scope="col">From</th><th scope="col">To</th><th scope="col">Years</th></tr></thead>
        <tbody>${roles.map(r => `<tr><th scope="row">${pfEsc(r.x.role || "")}</th>
          <td>${pfEsc(r.x.org || "")}</td><td>${r.s.from}</td><td>${r.s.open ? "Present" : r.s.to}</td>
          <td>${r.s.to - r.s.from}</td></tr>`).join("")}</tbody>
      </table>
    </figure>` : "";

  const body = `
<nav class="pf-nav pf-noprint"><div class="pf-shell pf-nav-in">
  <a class="pf-brand" href="#top"><i>${pfEsc(c.initials)}</i>${pfEsc(c.name)}</a>
  ${nav ? `<div class="pf-nav-links">${nav}</div>` : ""}
</div></nav>

<main id="main"><div class="pf-shell">
  <section class="pf-hero" id="top">
    <div>
      ${d.available ? `<div class="pf-badge">${pfEsc(d.available)}</div>` : ""}
      <h1>${pfEsc(c.name)}</h1>
      ${c.title ? `<h2>${pfEsc(c.title)}</h2>` : ""}
      ${c.tagline ? `<p>${pfEsc(c.tagline)}</p>` : ""}
      <div class="pf-actions">
        ${d.email ? `<a class="pf-btn pf-btn-primary" href="mailto:${pfEsc(d.email)}">${PF_ICONS.mail}${pfEsc(d.cta_text || "Get in touch")}</a>` : ""}
        ${c.hasResume ? `<a class="pf-btn pf-btn-ghost" ${pfResumeAttrs(c)}>${PF_ICONS.download}${pfEsc(c.resumeLabel)}</a>` : ""}
        ${pfSocialRow(c)}
      </div>
    </div>
    ${pfAvatar(c)}
  </section>

  ${c.has("stats") ? `<section class="pf-sec"><div class="pf-tiles" data-reveal>
    ${d.stats.map(x => `<div class="pf-tile"><b>${pfEsc(x.value)}</b><span>${pfEsc(x.label)}</span></div>`).join("")}
  </div></section>` : ""}

  ${skillFig ? `<section class="pf-sec" id="skills">${skillFig}</section>` : ""}
  ${plotFig ? `<section class="pf-sec" id="experience">${plotFig}</section>` : ""}

  ${c.has("about") ? `<section class="pf-sec" id="about"><h2 class="pf-h2">About</h2>
    <div class="pf-card pf-about" data-reveal>${pfEsc(d.about)}</div></section>` : ""}

  ${c.has("projects") ? `<section class="pf-sec" id="projects"><h2 class="pf-h2">Projects</h2>
    <div class="pf-grid">${d.projects.map((x, i) => `
      <article class="pf-card pf-proj" data-reveal data-reveal-delay="${Math.min(i, 5) * 70}">
        <h3>${pfEsc(x.name || "")}</h3>
        ${pfJoin([x.role, x.period]) ? `<div class="pf-role">${pfJoin([x.role, x.period])}</div>` : ""}
        ${x.description ? `<p>${pfEsc(x.description)}</p>` : ""}
        ${(x.bullets || []).length ? `<ul>${x.bullets.map(b => `<li>${pfEsc(b)}</li>`).join("")}</ul>` : ""}
        ${(x.tags || []).length ? `<div class="pf-tags">${x.tags.map(t => `<span class="pf-tag">${pfEsc(t)}</span>`).join("")}</div>` : ""}
        ${pfProjectLinks(x) ? `<div class="pf-links">${pfProjectLinks(x)}</div>` : ""}
      </article>`).join("")}</div></section>` : ""}

  ${c.has("experience") ? `<section class="pf-sec"><h2 class="pf-h2">Experience in detail</h2>
    <div class="pf-rows">${d.experience.map((x, i) => `
      <article class="pf-card pf-row" data-reveal data-reveal-delay="${Math.min(i, 5) * 60}">
        <div class="pf-row-top"><h3>${pfEsc(x.role || "")}</h3>
          ${x.period ? `<span class="pf-when">${pfEsc(x.period)}</span>` : ""}</div>
        ${x.org ? `<div class="pf-org">${pfJoin([x.org, x.location])}</div>` : ""}
        ${x.summary ? `<p>${pfEsc(x.summary)}</p>` : ""}
        ${(x.bullets || []).length ? `<ul>${x.bullets.map(b => `<li>${pfEsc(b)}</li>`).join("")}</ul>` : ""}
      </article>`).join("")}</div></section>` : ""}

  ${c.has("education") ? `<section class="pf-sec" id="education"><h2 class="pf-h2">Education</h2>
    <div class="pf-rows">${d.education.map(x => `
      <article class="pf-card pf-row" data-reveal>
        <div class="pf-row-top"><h3>${pfEsc(x.degree || "")}</h3>
          ${x.period ? `<span class="pf-when">${pfEsc(x.period)}</span>` : ""}</div>
        ${x.school ? `<div class="pf-org">${pfEsc(x.school)}</div>` : ""}
        ${x.detail ? `<p>${pfEsc(x.detail)}</p>` : ""}
      </article>`).join("")}</div></section>` : ""}

  ${c.has("certifications") ? `<section class="pf-sec" id="certifications"><h2 class="pf-h2">Certifications</h2>
    <div class="pf-tags" data-reveal>${d.certifications.map(x =>
      `<span class="pf-tag" style="font-size:.82rem;padding:.3rem .8rem">${pfEsc(x)}</span>`).join("")}</div></section>` : ""}

  ${c.has("contact") ? `<section class="pf-sec" id="contact"><div class="pf-card pf-contact" data-reveal>
    <h2>Get in touch</h2>
    <p>${pfEsc(d.cta_text || "Happy to talk through any of the numbers above.")}</p>
    <div class="pf-actions" style="justify-content:center;margin-top:0">
      ${d.email ? `<a class="pf-btn pf-btn-primary" href="mailto:${pfEsc(d.email)}">${PF_ICONS.mail}${pfEsc(d.email)}</a>` : ""}
      ${c.hasResume ? `<a class="pf-btn pf-btn-ghost" ${pfResumeAttrs(c)}>${PF_ICONS.download}Résumé</a>` : ""}
    </div>
    <div class="pf-clist">${c.links.map(x => x.url
      ? `<a href="${pfEsc(x.url)}"${/^https?:/i.test(x.url) ? ` target="_blank" rel="noopener"` : ""}>${x.icon}${pfEsc(x.handle)}</a>`
      : `<span>${x.icon}${pfEsc(x.handle)}</span>`).join("")}</div>
  </div></section>` : ""}

  <footer>© <span data-year>${c.year}</span> ${pfEsc(c.name)}${d.footer_note ? " · " + pfEsc(d.footer_note) : ""}</footer>
</div></main>`;

  const js = `
(function(){
  var nav = document.querySelector('.pf-nav');
  var onNav = function(){ nav.classList.toggle('pf-stuck', window.scrollY > 8); };
  onNav(); addEventListener('scroll', onNav, { passive:true });
  var links = [].slice.call(document.querySelectorAll('.pf-nav-links a'));
  var secs = links.map(function(a){ return document.querySelector(a.getAttribute('href')); }).filter(Boolean);
  if ('IntersectionObserver' in window && secs.length) {
    var spy = new IntersectionObserver(function(es){
      es.forEach(function(e){ if(!e.isIntersecting) return;
        links.forEach(function(a){ a.classList.toggle('pf-active', a.getAttribute('href') === '#' + e.target.id); }); });
    }, { rootMargin:'-45% 0px -50% 0px' });
    secs.forEach(function(s){ spy.observe(s); });
  }

  /* The table view is not a fallback, it is the same data in the form some
     readers need — colour-blind, screen-reader, printing, or just wanting the
     numbers. Swapping which node is hidden keeps one source of truth in the
     markup rather than rebuilding a table from the DOM. */
  document.querySelectorAll('[data-table]').forEach(function(btn){
    var key = btn.getAttribute('data-table');
    var fig = btn.closest('figure');
    btn.addEventListener('click', function(){
      var showTable = fig.querySelector('[data-view="' + key + '-table"]').hasAttribute('hidden');
      fig.querySelectorAll('[data-view="' + key + '-chart"]').forEach(function(el){
        el.toggleAttribute('hidden', showTable); });
      var legend = fig.querySelector('.pf-legend');
      if (legend) legend.toggleAttribute('hidden', showTable);
      fig.querySelector('[data-view="' + key + '-table"]').toggleAttribute('hidden', !showTable);
      btn.textContent = showTable ? 'Show chart' : 'Show table';
    });
  });
})();`;

  return { fonts: [c.googleFont ? null : "Inter:wght@400;600;700;800"].filter(Boolean),
           css, body, js, themeColor: "#fcfcfb" };
};


// ---------------------------------------------------------------------------
// 33. FLUX — a live fragment shader.
//
//     The background is not a gradient or a video: it is domain-warped fbm
//     noise evaluated per pixel on the GPU, every frame. Two rounds of warping
//     (noise sampled at coordinates that are themselves noise) is what turns
//     smooth blobs into the marbled flow you get in ink or oil.
//
//     WebGL can be absent — old hardware, a blocklisted driver, a locked-down
//     browser. The canvas therefore sits ON TOP of a CSS gradient that is
//     already correct on its own, so a failed context is a still version of the
//     same picture rather than a white hole in the page.
// ---------------------------------------------------------------------------
PF_RENDERERS.flux = (c) => {
  const d = c.d;
  const a2 = pfHueShift(c.accent, -38), a3 = pfHueShift(c.accent, 46);
  const nav = c.navItems.map(n => `<a href="#${n.id}">${pfEsc(n.label)}</a>`).join("");
  const glslRgb = (hex) => { const { r, g, b } = pfHexToRgb(hex);
    return `vec3(${(r / 255).toFixed(3)},${(g / 255).toFixed(3)},${(b / 255).toFixed(3)})`; };

  const css = `
:root{
  --acc:${c.accent}; --a2:${a2}; --a3:${a3};
  --ink:#241505; --muted:#6B513A; --faint:#A08975;
  --bg:#FFF7ED; --card:#FFFFFF; --line:#F0E2D2;
  --font:${c.fontStack || `'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif`};
}
body{background:var(--bg);color:var(--ink);font-family:var(--font);font-size:16px;line-height:1.7;overflow-x:hidden}
.pf-skip{background:var(--acc);color:#fff}
.pf-shell{width:min(1060px,91vw);margin:0 auto}

/* The still version, always present. The canvas is painted over it, so if the
   GL context never arrives this is what you see — and it is deliberately a
   composition, not a placeholder. */
.pf-flow{position:fixed;inset:0;z-index:0;pointer-events:none;
  background:
    radial-gradient(58% 48% at 22% 26%,${pfRgba(c.accent, .34)},transparent 62%),
    radial-gradient(52% 46% at 82% 30%,${pfRgba(a3, .3)},transparent 66%),
    radial-gradient(64% 52% at 54% 88%,${pfRgba(a2, .26)},transparent 68%),
    var(--bg)}
#pf-gl{position:absolute;inset:0;width:100%;height:100%;display:block;opacity:0;transition:opacity 1.2s ease}
#pf-gl.pf-live{opacity:.9}
.pf-veil{position:fixed;inset:0;z-index:1;pointer-events:none;
  background:radial-gradient(120% 90% at 50% 40%,${pfRgba("#FFF7ED", .3)},${pfRgba("#FFF7ED", .82)} 78%)}
main{position:relative;z-index:3}

.pf-nav{position:sticky;top:0;z-index:20;background:${pfRgba("#FFF7ED", .72)};
  backdrop-filter:blur(18px) saturate(150%);-webkit-backdrop-filter:blur(18px) saturate(150%);
  border-bottom:1px solid transparent;transition:.25s}
.pf-nav.pf-stuck{border-bottom-color:var(--line);background:${pfRgba("#FFF7ED", .9)}}
.pf-nav-in{display:flex;align-items:center;gap:1.2rem;padding:.85rem 0}
.pf-brand{font-weight:800;font-size:1.03rem;letter-spacing:-.025em;text-decoration:none;
  display:flex;align-items:center;gap:.6rem}
.pf-brand i{width:28px;height:28px;display:grid;place-items:center;font-size:.64rem;font-weight:800;font-style:normal;
  color:#fff;background:linear-gradient(135deg,var(--acc),var(--a2));border-radius:9px}
.pf-nav-links{display:flex;gap:.2rem;margin-left:auto}
.pf-nav-links a{padding:.4rem .85rem;border-radius:8px;font-size:.86rem;font-weight:600;color:var(--muted);
  text-decoration:none;transition:.2s}
.pf-nav-links a:hover,.pf-nav-links a.pf-active{color:var(--acc);background:${pfRgba(c.accent, .1)}}

.pf-hero{padding:clamp(3.4rem,10vw,6rem) 0 clamp(2rem,5vw,3rem);text-align:center}
/* Drawn only when the portfolio actually has a photo, so a portfolio without
   one looks exactly as it did before. The ring is what separates a face from
   what is moving behind it. */
.pf-portrait{width:clamp(96px,13vw,128px);aspect-ratio:1;border-radius:50%;object-fit:cover;
  margin:0 auto 1.3rem;border:3px solid ${pfRgba("#FFFFFF", .85)};
  box-shadow:0 16px 42px ${pfRgba(c.accent, .32)}}
.pf-badge{display:inline-flex;align-items:center;gap:.5rem;padding:.36rem 1rem;border-radius:999px;
  background:${pfRgba("#ffffff", .7)};border:1px solid var(--line);font-size:.8rem;font-weight:600;
  color:var(--muted);margin-bottom:1.3rem;backdrop-filter:blur(8px)}
.pf-badge i{width:7px;height:7px;border-radius:50%;background:var(--acc)}
.pf-hero h1{font-size:clamp(2.5rem,8vw,5.2rem);font-weight:800;letter-spacing:-.05em;line-height:1;
  background:linear-gradient(100deg,var(--ink) 18%,var(--acc) 52%,var(--a2) 82%);
  -webkit-background-clip:text;background-clip:text;color:transparent}
.pf-hero h2{font-size:clamp(1rem,2.3vw,1.28rem);font-weight:600;color:var(--muted);margin:.9rem 0 .8rem}
.pf-hero p{color:var(--muted);max-width:52ch;margin:0 auto}
.pf-actions{display:flex;flex-wrap:wrap;gap:.7rem;justify-content:center;align-items:center;margin-top:1.9rem}
.pf-btn{display:inline-flex;align-items:center;gap:.5rem;padding:.78rem 1.5rem;border-radius:12px;font-weight:700;
  font-size:.9rem;text-decoration:none;border:1px solid transparent;transition:.24s}
.pf-btn svg{width:16px;height:16px}
.pf-btn-primary{background:linear-gradient(120deg,var(--acc),var(--a2));color:#fff;
  box-shadow:0 10px 26px ${pfRgba(c.accent, .34)}}
.pf-btn-primary:hover{transform:translateY(-3px);box-shadow:0 16px 34px ${pfRgba(c.accent, .44)}}
.pf-btn-ghost{background:${pfRgba("#ffffff", .72)};border-color:var(--line);color:var(--ink);
  backdrop-filter:blur(8px)}
.pf-btn-ghost:hover{border-color:var(--acc);color:var(--acc);transform:translateY(-3px)}
.pf-socials{display:flex;gap:.45rem}
.pf-socials a{display:grid;place-items:center;width:40px;height:40px;border-radius:11px;
  background:${pfRgba("#ffffff", .72)};border:1px solid var(--line);color:var(--muted);transition:.24s;
  backdrop-filter:blur(8px)}
.pf-socials a svg{width:16px;height:16px}
.pf-socials a:hover{color:var(--acc);border-color:var(--acc);transform:translateY(-3px)}

.pf-sec{padding:clamp(2.2rem,5.5vw,3.6rem) 0}
.pf-kicker{font-size:.72rem;font-weight:800;letter-spacing:.18em;text-transform:uppercase;color:var(--acc);margin-bottom:.35rem}
.pf-h2{font-size:clamp(1.5rem,3.6vw,2.2rem);font-weight:800;letter-spacing:-.035em;margin-bottom:1.6rem}
.pf-card{background:${pfRgba("#ffffff", .74)};border:1px solid ${pfRgba("#ffffff", .9)};border-radius:18px;
  backdrop-filter:blur(14px) saturate(140%);-webkit-backdrop-filter:blur(14px) saturate(140%);
  box-shadow:0 10px 30px ${pfRgba("#241505", .06)};transition:.3s}
.pf-card:hover{transform:translateY(-4px);box-shadow:0 18px 44px ${pfRgba("#241505", .1)};
  border-color:${pfRgba(c.accent, .4)}}
.pf-about{padding:1.9rem;white-space:pre-line;color:var(--muted)}
.pf-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:1rem}
.pf-stat{padding:1.5rem 1rem;text-align:center}
.pf-stat b{display:block;font-size:2.2rem;font-weight:800;letter-spacing:-.045em;line-height:1;
  background:linear-gradient(140deg,var(--acc),var(--a2));-webkit-background-clip:text;background-clip:text;color:transparent}
.pf-stat span{font-size:.77rem;color:var(--faint);font-weight:600}
.pf-chips{display:flex;flex-wrap:wrap;gap:.5rem}
.pf-chip{padding:.44rem 1rem;border-radius:999px;font-size:.87rem;color:var(--muted);
  background:${pfRgba("#ffffff", .72)};border:1px solid var(--line);transition:.24s;cursor:default;
  backdrop-filter:blur(8px)}
.pf-chip:hover{color:#fff;background:linear-gradient(120deg,var(--acc),var(--a2));border-color:transparent;
  transform:translateY(-3px)}
.pf-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(290px,1fr));gap:1.1rem}
.pf-proj{padding:1.7rem}
.pf-proj h3{font-size:1.16rem;font-weight:800;letter-spacing:-.02em;margin-bottom:.12rem}
.pf-proj .pf-role,.pf-row .pf-org{font-size:.8rem;color:var(--acc);font-weight:700;margin-bottom:.6rem}
.pf-proj p,.pf-row p{color:var(--muted);font-size:.93rem}
.pf-proj ul,.pf-row ul{margin-top:.55rem}
.pf-proj li,.pf-row li{color:var(--muted);font-size:.89rem;padding-left:1.15rem;position:relative;margin-bottom:.24rem}
.pf-proj li::before,.pf-row li::before{content:"";position:absolute;left:0;top:.6em;width:6px;height:6px;
  border-radius:50%;background:linear-gradient(120deg,var(--acc),var(--a2))}
.pf-tags{display:flex;flex-wrap:wrap;gap:.32rem;margin-top:.85rem}
.pf-tag{font-size:.71rem;font-weight:700;padding:.16rem .58rem;border-radius:999px;color:var(--acc);
  background:${pfRgba(c.accent, .12)}}
.pf-links{display:flex;gap:1rem;margin-top:.85rem;font-size:.84rem;font-weight:700}
.pf-links a{color:var(--acc);text-decoration:none;display:inline-flex;align-items:center;gap:.3rem}
.pf-links a svg{width:14px;height:14px}
.pf-rows{display:grid;gap:.9rem}
.pf-row{padding:1.5rem 1.7rem}
.pf-row-top{display:flex;flex-wrap:wrap;gap:.25rem 1rem;align-items:baseline}
.pf-row h3{font-size:1.08rem;font-weight:800}
.pf-row .pf-when{margin-left:auto;color:var(--faint);font-size:.82rem;white-space:nowrap;font-weight:600}
.pf-contact{padding:clamp(2.2rem,5vw,3.4rem);text-align:center}
.pf-contact h2{font-size:clamp(1.7rem,4.5vw,2.6rem);font-weight:800;letter-spacing:-.04em;margin-bottom:.7rem}
.pf-contact p{color:var(--muted);max-width:46ch;margin:0 auto 1.5rem}
.pf-clist{display:flex;flex-wrap:wrap;gap:.6rem 1.6rem;justify-content:center;margin-top:1.5rem;font-size:.88rem}
.pf-clist a,.pf-clist span{color:var(--muted);text-decoration:none;display:inline-flex;align-items:center;gap:.42rem}
.pf-clist svg{width:16px;height:16px;color:var(--acc)}
.pf-clist a:hover{color:var(--acc)}
footer{padding:2.6rem 0;text-align:center;color:var(--faint);font-size:.84rem}
@media (max-width:820px){.pf-nav-links{display:none}.pf-row .pf-when{margin-left:0;width:100%}}
@media (prefers-reduced-motion:reduce){#pf-gl{display:none}}`;

  const body = `
<div class="pf-flow" aria-hidden="true"><canvas id="pf-gl"></canvas></div>
<div class="pf-veil" aria-hidden="true"></div>
<nav class="pf-nav pf-noprint"><div class="pf-shell pf-nav-in">
  <a class="pf-brand" href="#top"><i>${pfEsc(c.initials)}</i>${pfEsc(c.name)}</a>
  ${nav ? `<div class="pf-nav-links">${nav}</div>` : ""}
</div></nav>

<main id="main"><div class="pf-shell">
  <section class="pf-hero" id="top">
    ${d.avatar ? `<img class="pf-portrait" src="${pfEsc(d.avatar)}" alt="${pfEsc(c.name)}" width="128" height="128">` : ""}
    ${d.available ? `<div class="pf-badge"><i></i>${pfEsc(d.available)}</div>` : ""}
    <h1>${pfEsc(c.name)}</h1>
    ${c.title ? `<h2>${pfEsc(c.title)}</h2>` : ""}
    ${c.tagline ? `<p>${pfEsc(c.tagline)}</p>` : ""}
    <div class="pf-actions">
      ${d.email ? `<a class="pf-btn pf-btn-primary" href="mailto:${pfEsc(d.email)}">${PF_ICONS.mail}${pfEsc(d.cta_text || "Get in touch")}</a>` : ""}
      ${c.hasResume ? `<a class="pf-btn pf-btn-ghost" ${pfResumeAttrs(c)}>${PF_ICONS.download}${pfEsc(c.resumeLabel)}</a>` : ""}
      ${pfSocialRow(c)}
    </div>
  </section>

  ${c.has("stats") ? `<section class="pf-sec"><div class="pf-stats">
    ${d.stats.map((x, i) => `<div class="pf-card pf-stat" data-reveal data-reveal-delay="${i * 70}">
      <b>${pfEsc(x.value)}</b><span>${pfEsc(x.label)}</span></div>`).join("")}</div></section>` : ""}

  ${c.has("about") ? `<section class="pf-sec" id="about"><div class="pf-kicker">About</div>
    <h2 class="pf-h2">The short version</h2>
    <div class="pf-card pf-about" data-reveal>${pfEsc(d.about)}</div></section>` : ""}

  ${c.has("skills") ? `<section class="pf-sec" id="skills"><div class="pf-kicker">Toolkit</div>
    <h2 class="pf-h2">What I work with</h2>
    <div class="pf-chips" data-reveal>${d.skills.map(x => `<span class="pf-chip">${pfEsc(x)}</span>`).join("")}</div></section>` : ""}

  ${c.has("projects") ? `<section class="pf-sec" id="projects"><div class="pf-kicker">Work</div>
    <h2 class="pf-h2">Selected projects</h2>
    <div class="pf-grid">${d.projects.map((x, i) => `
      <article class="pf-card pf-proj" data-reveal data-reveal-delay="${Math.min(i, 5) * 80}">
        <h3>${pfEsc(x.name || "")}</h3>
        ${pfJoin([x.role, x.period]) ? `<div class="pf-role">${pfJoin([x.role, x.period])}</div>` : ""}
        ${x.description ? `<p>${pfEsc(x.description)}</p>` : ""}
        ${(x.bullets || []).length ? `<ul>${x.bullets.map(b => `<li>${pfEsc(b)}</li>`).join("")}</ul>` : ""}
        ${(x.tags || []).length ? `<div class="pf-tags">${x.tags.map(t => `<span class="pf-tag">${pfEsc(t)}</span>`).join("")}</div>` : ""}
        ${pfProjectLinks(x) ? `<div class="pf-links">${pfProjectLinks(x)}</div>` : ""}
      </article>`).join("")}</div></section>` : ""}

  ${c.has("experience") ? `<section class="pf-sec" id="experience"><div class="pf-kicker">Experience</div>
    <h2 class="pf-h2">Where I have worked</h2>
    <div class="pf-rows">${d.experience.map((x, i) => `
      <article class="pf-card pf-row" data-reveal data-reveal-delay="${Math.min(i, 5) * 70}">
        <div class="pf-row-top"><h3>${pfEsc(x.role || "")}</h3>
          ${x.period ? `<span class="pf-when">${pfEsc(x.period)}</span>` : ""}</div>
        ${x.org ? `<div class="pf-org">${pfJoin([x.org, x.location])}</div>` : ""}
        ${x.summary ? `<p>${pfEsc(x.summary)}</p>` : ""}
        ${(x.bullets || []).length ? `<ul>${x.bullets.map(b => `<li>${pfEsc(b)}</li>`).join("")}</ul>` : ""}
      </article>`).join("")}</div></section>` : ""}

  ${c.has("education") ? `<section class="pf-sec" id="education"><div class="pf-kicker">Education</div>
    <h2 class="pf-h2">Where I studied</h2>
    <div class="pf-rows">${d.education.map(x => `
      <article class="pf-card pf-row" data-reveal>
        <div class="pf-row-top"><h3>${pfEsc(x.degree || "")}</h3>
          ${x.period ? `<span class="pf-when">${pfEsc(x.period)}</span>` : ""}</div>
        ${x.school ? `<div class="pf-org">${pfEsc(x.school)}</div>` : ""}
        ${x.detail ? `<p>${pfEsc(x.detail)}</p>` : ""}
      </article>`).join("")}</div></section>` : ""}

  ${c.has("certifications") ? `<section class="pf-sec" id="certifications"><div class="pf-kicker">Credentials</div>
    <h2 class="pf-h2">Certifications</h2>
    <div class="pf-chips" data-reveal>${d.certifications.map(x => `<span class="pf-chip">${pfEsc(x)}</span>`).join("")}</div></section>` : ""}

  ${c.has("contact") ? `<section class="pf-sec" id="contact"><div class="pf-card pf-contact" data-reveal>
    <h2>Let's make something</h2>
    <p>${pfEsc(d.cta_text || "Tell me what you are building and where it is stuck.")}</p>
    <div class="pf-actions" style="margin-top:0">
      ${d.email ? `<a class="pf-btn pf-btn-primary" href="mailto:${pfEsc(d.email)}">${PF_ICONS.mail}${pfEsc(d.email)}</a>` : ""}
      ${c.hasResume ? `<a class="pf-btn pf-btn-ghost" ${pfResumeAttrs(c)}>${PF_ICONS.download}Résumé</a>` : ""}
    </div>
    <div class="pf-clist">${c.links.map(x => x.url
      ? `<a href="${pfEsc(x.url)}"${/^https?:/i.test(x.url) ? ` target="_blank" rel="noopener"` : ""}>${x.icon}${pfEsc(x.handle)}</a>`
      : `<span>${x.icon}${pfEsc(x.handle)}</span>`).join("")}</div>
  </div></section>` : ""}

  <footer>© <span data-year>${c.year}</span> ${pfEsc(c.name)}${d.footer_note ? " · " + pfEsc(d.footer_note) : ""}</footer>
</div></main>`;

  // The fragment shader is assembled HERE, at render time, and injected as a
  // JSON string literal below. Building it inside the emitted script instead
  // was two bugs in one line: glslRgb/c do not exist in the browser, and the
  // \n in .join() was consumed by this template literal and became a real
  // newline inside a single-quoted string — a syntax error that took the whole
  // <script> down with it, reveal system included.
  const FS_SRC = [
    'precision mediump float;',
    'uniform vec2 u_res;uniform float u_t;uniform vec2 u_m;',
    'float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453123);}',
    'float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);',
    ' return mix(mix(hash(i),hash(i+vec2(1.0,0.0)),f.x),',
    '            mix(hash(i+vec2(0.0,1.0)),hash(i+vec2(1.0,1.0)),f.x),f.y);}',
    'float fbm(vec2 p){float v=0.0,a=0.5;for(int i=0;i<5;i++){v+=a*noise(p);p*=2.03;a*=0.5;}return v;}',
    'void main(){',
    ' vec2 uv=gl_FragCoord.xy/u_res;uv.x*=u_res.x/u_res.y;',
    ' float t=u_t*0.045;',
    // Domain warping: sample the field at coordinates that are themselves a
    // noise field, twice. One pass gives soft blobs; two gives the marbling.
    ' vec2 q=vec2(fbm(uv*1.5+t),fbm(uv*1.5+vec2(5.2,1.3)-t));',
    ' vec2 r=vec2(fbm(uv*1.5+3.4*q+vec2(1.7,9.2)+t*1.4),',
    '             fbm(uv*1.5+3.4*q+vec2(8.3,2.8)-t*1.1));',
    ' float f=fbm(uv*1.5+3.6*r);',
    ' float m=1.0-clamp(length(uv-u_m)*1.1,0.0,1.0);',
    ' vec3 col=mix(' + glslRgb(c.accent) + ',' + glslRgb(a3) + ',clamp(f*f*2.6,0.0,1.0));',
    ' col=mix(col,' + glslRgb(a2) + ',clamp(length(q)*0.85,0.0,1.0));',
    ' col=mix(col,vec3(1.0),0.42-0.16*m);',
    ' gl_FragColor=vec4(col,1.0);}'
  ].join("\n");

  const js = `
(function(){
  var nav = document.querySelector('.pf-nav');
  var onNav = function(){ nav.classList.toggle('pf-stuck', window.scrollY > 8); };
  onNav(); addEventListener('scroll', onNav, { passive:true });
  var links = [].slice.call(document.querySelectorAll('.pf-nav-links a'));
  var secs = links.map(function(a){ return document.querySelector(a.getAttribute('href')); }).filter(Boolean);
  if ('IntersectionObserver' in window && secs.length) {
    var spy = new IntersectionObserver(function(es){
      es.forEach(function(e){ if(!e.isIntersecting) return;
        links.forEach(function(a){ a.classList.toggle('pf-active', a.getAttribute('href') === '#' + e.target.id); }); });
    }, { rootMargin:'-45% 0px -50% 0px' });
    secs.forEach(function(s){ spy.observe(s); });
  }

  if (matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  var cv = document.getElementById('pf-gl');
  if (!cv) return;
  var gl = cv.getContext('webgl', { antialias:false, alpha:false, depth:false,
                                    powerPreference:'low-power' })
        || cv.getContext('experimental-webgl');
  if (!gl) return;                       /* the CSS composition stays; nothing breaks */

  var VS = 'attribute vec2 p;void main(){gl_Position=vec4(p,0.0,1.0);}';
  var FS = ${JSON.stringify(FS_SRC)};

  function build(type, src){
    var sh = gl.createShader(type); gl.shaderSource(sh, src); gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      /* A driver that rejects the shader is not an error worth a console wall —
         the still gradient underneath is already a finished design. */
      gl.deleteShader(sh); return null;
    }
    return sh;
  }
  var vs = build(gl.VERTEX_SHADER, VS), fs = build(gl.FRAGMENT_SHADER, FS);
  if (!vs || !fs) return;
  var prog = gl.createProgram();
  gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;
  gl.useProgram(prog);

  /* One full-screen triangle, not two — fewer vertices and no seam down the
     diagonal where the two halves meet. */
  var buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);
  var loc = gl.getAttribLocation(prog, 'p');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  var uRes = gl.getUniformLocation(prog, 'u_res'),
      uT   = gl.getUniformLocation(prog, 'u_t'),
      uM   = gl.getUniformLocation(prog, 'u_m');
  var mx = 0.5, my = 0.5, tx = 0.5, ty = 0.5, raf = null, visible = true;

  function size(){
    /* Capped DPR: this shader is five octaves of noise per pixel, and a 3x
       retina buffer triples that for a background nobody looks at directly. */
    var dpr = Math.min(devicePixelRatio || 1, 1.5);
    cv.width = Math.floor(cv.clientWidth * dpr);
    cv.height = Math.floor(cv.clientHeight * dpr);
    gl.viewport(0, 0, cv.width, cv.height);
  }
  size(); addEventListener('resize', size);
  addEventListener('pointermove', function(e){
    tx = e.clientX / innerWidth; ty = 1.0 - e.clientY / innerHeight;
  }, { passive:true });

  var start = 0;
  function frame(ts){
    if (!start) start = ts;
    mx += (tx - mx) * 0.05; my += (ty - my) * 0.05;
    gl.uniform2f(uRes, cv.width, cv.height);
    gl.uniform1f(uT, (ts - start) / 1000);
    gl.uniform2f(uM, mx * (cv.width / cv.height), my);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    raf = visible ? requestAnimationFrame(frame) : null;
  }
  cv.classList.add('pf-live');
  raf = requestAnimationFrame(frame);

  /* Stop the loop when the tab is hidden. A shader that keeps running in a
     background tab is a battery bug, not a feature. */
  document.addEventListener('visibilitychange', function(){
    visible = !document.hidden;
    if (visible && !raf) { start = 0; raf = requestAnimationFrame(frame); }
  });
})();`;

  return { fonts: [c.googleFont ? null : "Inter:wght@400;600;700;800"].filter(Boolean),
           css, body, js, themeColor: "#FFF7ED" };
};


// ---------------------------------------------------------------------------
// 34. REEL — a cover-flow carousel in real perspective.
//
//     One float, `pos`, is the truth: every card derives its translate, depth,
//     rotation, scale and opacity from its distance to it. Wheel, drag, arrow
//     keys and the dots all move a *target*; a critically-damped spring chases
//     it. Animating each card independently is what makes carousels feel
//     rubbery — deriving them all from one integrated value is what makes this
//     one feel like an object.
// ---------------------------------------------------------------------------
PF_RENDERERS.reel = (c) => {
  const d = c.d;
  const a2 = pfHueShift(c.accent, -38);
  const nav = c.navItems.map(n => `<a href="#${n.id}">${pfEsc(n.label)}</a>`).join("");
  const cards = d.projects.length ? d.projects : [];

  const css = `
:root{
  --acc:${c.accent}; --a2:${a2}; --ink:#2A0B2E; --muted:#6B4A70; --faint:#A288A6;
  --bg:#FDF4FF; --card:#FFFFFF; --line:#F0DDF5;
  --font:${c.fontStack || `'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif`};
}
body{background:var(--bg);color:var(--ink);font-family:var(--font);font-size:16px;line-height:1.7;overflow-x:hidden}
.pf-skip{background:var(--acc);color:#fff}
.pf-shell{width:min(1080px,92vw);margin:0 auto}
.pf-glow{position:fixed;inset:0;z-index:0;pointer-events:none;
  background:radial-gradient(56% 44% at 50% 12%,${pfRgba(c.accent, .16)},transparent 66%),
             radial-gradient(44% 40% at 14% 82%,${pfRgba(a2, .13)},transparent 72%)}
main{position:relative;z-index:2}
.pf-nav{position:sticky;top:0;z-index:20;background:${pfRgba("#FDF4FF", .92)};
  backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);border-bottom:1px solid transparent;transition:.25s}
.pf-nav.pf-stuck{border-bottom-color:var(--line)}
.pf-nav-in{display:flex;align-items:center;gap:1.2rem;padding:.85rem 0}
.pf-brand{font-weight:800;font-size:1.03rem;letter-spacing:-.025em;text-decoration:none;
  display:flex;align-items:center;gap:.6rem}
.pf-brand i{width:28px;height:28px;display:grid;place-items:center;font-size:.64rem;font-weight:800;font-style:normal;
  color:#fff;background:linear-gradient(135deg,var(--acc),var(--a2));border-radius:9px}
.pf-nav-links{display:flex;gap:.2rem;margin-left:auto}
.pf-nav-links a{padding:.4rem .85rem;border-radius:8px;font-size:.86rem;font-weight:600;color:var(--muted);
  text-decoration:none;transition:.2s}
.pf-nav-links a:hover,.pf-nav-links a.pf-active{color:var(--acc);background:${pfRgba(c.accent, .1)}}

.pf-hero{padding:clamp(2.6rem,7vw,4rem) 0 clamp(1.4rem,3vw,2rem);text-align:center}
/* Drawn only when the portfolio actually has a photo, so a portfolio without
   one looks exactly as it did before. The ring is what separates a face from
   what is moving behind it. */
.pf-portrait{width:clamp(96px,13vw,128px);aspect-ratio:1;border-radius:50%;object-fit:cover;
  margin:0 auto 1.3rem;border:3px solid ${pfRgba("#FFFFFF", .85)};
  box-shadow:0 16px 42px ${pfRgba(c.accent, .32)}}
.pf-badge{display:inline-flex;align-items:center;gap:.5rem;padding:.34rem .95rem;border-radius:999px;
  background:${pfRgba(c.accent, .11)};color:var(--acc);font-size:.8rem;font-weight:700;margin-bottom:1.1rem}
.pf-hero h1{font-size:clamp(2.2rem,6.4vw,4rem);font-weight:800;letter-spacing:-.045em;line-height:1.02;
  background:linear-gradient(100deg,var(--ink) 20%,var(--acc) 60%,var(--a2));
  -webkit-background-clip:text;background-clip:text;color:transparent}
.pf-hero h2{font-size:clamp(.98rem,2.2vw,1.2rem);font-weight:600;color:var(--muted);margin:.8rem 0 .7rem}
.pf-hero p{color:var(--muted);max-width:50ch;margin:0 auto}
.pf-actions{display:flex;flex-wrap:wrap;gap:.65rem;justify-content:center;align-items:center;margin-top:1.6rem}
.pf-btn{display:inline-flex;align-items:center;gap:.5rem;padding:.76rem 1.45rem;border-radius:12px;font-weight:700;
  font-size:.9rem;text-decoration:none;border:1px solid transparent;transition:.24s;cursor:pointer}
.pf-btn svg{width:16px;height:16px}
.pf-btn-primary{background:linear-gradient(120deg,var(--acc),var(--a2));color:#fff;
  box-shadow:0 10px 26px ${pfRgba(c.accent, .34)}}
.pf-btn-primary:hover{transform:translateY(-3px);box-shadow:0 16px 34px ${pfRgba(c.accent, .44)}}
.pf-btn-ghost{background:var(--card);border-color:var(--line);color:var(--ink)}
.pf-btn-ghost:hover{border-color:var(--acc);color:var(--acc);transform:translateY(-3px)}
.pf-socials{display:flex;gap:.45rem}
.pf-socials a{display:grid;place-items:center;width:40px;height:40px;border-radius:11px;background:var(--card);
  border:1px solid var(--line);color:var(--muted);transition:.24s}
.pf-socials a svg{width:16px;height:16px}
.pf-socials a:hover{color:var(--acc);border-color:var(--acc);transform:translateY(-3px)}

/* The stage. perspective-origin sits above centre so the cards lean away from
   a viewpoint slightly above them, which is what stops it reading as a flat
   fan of rectangles. */
.pf-stage{position:relative;height:clamp(300px,44vw,420px);perspective:1400px;perspective-origin:50% 42%;
  touch-action:pan-y;cursor:grab;user-select:none;margin-bottom:1rem}
.pf-stage:active{cursor:grabbing}
.pf-slide{position:absolute;left:50%;top:50%;width:min(340px,62vw);
  margin:calc(min(200px,34vw) * -1) 0 0 calc(min(170px,31vw) * -1);
  height:min(400px,68vw);border-radius:18px;background:var(--card);border:1px solid var(--line);
  box-shadow:0 24px 60px ${pfRgba("#2A0B2E", .16)};overflow:hidden;
  transform-style:preserve-3d;will-change:transform,opacity;padding:1.5rem;display:flex;flex-direction:column}
.pf-slide::after{content:"";position:absolute;inset:0;pointer-events:none;border-radius:18px;
  background:linear-gradient(160deg,${pfRgba("#ffffff", .5)},transparent 46%);opacity:var(--sheen,0)}
.pf-slide h3{font-size:1.18rem;font-weight:800;letter-spacing:-.025em;margin-bottom:.15rem}
.pf-slide .pf-role{font-size:.79rem;color:var(--acc);font-weight:700;margin-bottom:.7rem}
.pf-slide p{color:var(--muted);font-size:.92rem}
.pf-slide ul{margin-top:.6rem}
.pf-slide li{color:var(--muted);font-size:.88rem;padding-left:1.15rem;position:relative;margin-bottom:.22rem}
.pf-slide li::before{content:"";position:absolute;left:0;top:.6em;width:6px;height:6px;border-radius:50%;
  background:linear-gradient(120deg,var(--acc),var(--a2))}
.pf-slide .pf-tags{margin-top:auto;padding-top:.9rem}
.pf-tags{display:flex;flex-wrap:wrap;gap:.32rem}
.pf-tag{font-size:.71rem;font-weight:700;padding:.16rem .58rem;border-radius:999px;color:var(--acc);
  background:${pfRgba(c.accent, .12)}}
.pf-links{display:flex;gap:1rem;margin-top:.7rem;font-size:.83rem;font-weight:700}
.pf-links a{color:var(--acc);text-decoration:none;display:inline-flex;align-items:center;gap:.3rem}
.pf-links a svg{width:14px;height:14px}
.pf-reel-ui{display:flex;align-items:center;justify-content:center;gap:.9rem;margin-top:.4rem}
.pf-dot{width:9px;height:9px;border-radius:50%;border:0;padding:0;cursor:pointer;background:var(--line);
  transition:.25s}
.pf-dot.pf-on{background:var(--acc);transform:scale(1.35)}
.pf-arrow{width:38px;height:38px;border-radius:50%;border:1px solid var(--line);background:var(--card);
  color:var(--muted);cursor:pointer;font-size:1rem;line-height:1;transition:.2s}
.pf-arrow:hover{color:var(--acc);border-color:var(--acc)}
.pf-hint{text-align:center;font-size:.78rem;color:var(--faint);margin-top:.7rem}

.pf-sec{padding:clamp(2.2rem,5.5vw,3.6rem) 0}
.pf-kicker{font-size:.72rem;font-weight:800;letter-spacing:.18em;text-transform:uppercase;color:var(--acc);margin-bottom:.35rem}
.pf-h2{font-size:clamp(1.5rem,3.6vw,2.2rem);font-weight:800;letter-spacing:-.035em;margin-bottom:1.6rem}
.pf-card{background:var(--card);border:1px solid var(--line);border-radius:16px;transition:.28s}
.pf-card:hover{border-color:${pfRgba(c.accent, .45)};transform:translateY(-4px);box-shadow:0 16px 36px ${pfRgba("#2A0B2E", .08)}}
.pf-about{padding:1.9rem;white-space:pre-line;color:var(--muted)}
.pf-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:1rem}
.pf-stat{padding:1.5rem 1rem;text-align:center}
.pf-stat b{display:block;font-size:2.2rem;font-weight:800;letter-spacing:-.045em;line-height:1;
  background:linear-gradient(140deg,var(--acc),var(--a2));-webkit-background-clip:text;background-clip:text;color:transparent}
.pf-stat span{font-size:.77rem;color:var(--faint);font-weight:600}
.pf-chips{display:flex;flex-wrap:wrap;gap:.5rem}
.pf-chip{padding:.44rem 1rem;border-radius:999px;font-size:.87rem;color:var(--muted);background:var(--card);
  border:1px solid var(--line);transition:.24s;cursor:default}
.pf-chip:hover{color:#fff;background:linear-gradient(120deg,var(--acc),var(--a2));border-color:transparent;
  transform:translateY(-3px)}
.pf-rows{display:grid;gap:.9rem}
.pf-row{padding:1.5rem 1.7rem}
.pf-row-top{display:flex;flex-wrap:wrap;gap:.25rem 1rem;align-items:baseline}
.pf-row h3{font-size:1.08rem;font-weight:800}
.pf-row .pf-org{color:var(--acc);font-size:.88rem;font-weight:700}
.pf-row .pf-when{margin-left:auto;color:var(--faint);font-size:.82rem;white-space:nowrap;font-weight:600}
.pf-row p{color:var(--muted);font-size:.93rem}
.pf-row ul{margin-top:.55rem}
.pf-row li{color:var(--muted);font-size:.89rem;padding-left:1.15rem;position:relative;margin-bottom:.24rem}
.pf-row li::before{content:"";position:absolute;left:0;top:.6em;width:6px;height:6px;border-radius:50%;
  background:linear-gradient(120deg,var(--acc),var(--a2))}
.pf-contact{padding:clamp(2.2rem,5vw,3.4rem);text-align:center}
.pf-contact h2{font-size:clamp(1.7rem,4.5vw,2.6rem);font-weight:800;letter-spacing:-.04em;margin-bottom:.7rem}
.pf-contact p{color:var(--muted);max-width:46ch;margin:0 auto 1.5rem}
.pf-clist{display:flex;flex-wrap:wrap;gap:.6rem 1.6rem;justify-content:center;margin-top:1.5rem;font-size:.88rem}
.pf-clist a,.pf-clist span{color:var(--muted);text-decoration:none;display:inline-flex;align-items:center;gap:.42rem}
.pf-clist svg{width:16px;height:16px;color:var(--acc)}
.pf-clist a:hover{color:var(--acc)}
footer{padding:2.6rem 0;text-align:center;color:var(--faint);font-size:.84rem}
@media (max-width:820px){.pf-nav-links{display:none}.pf-row .pf-when{margin-left:0;width:100%}}
/* No perspective without motion: the deck falls back to a plain readable
   column, which is what somebody who asked for less movement wants. */
@media (prefers-reduced-motion:reduce){
  .pf-stage{height:auto;perspective:none;display:grid;gap:1rem;cursor:auto}
  .pf-slide{position:static;margin:0;width:auto;height:auto;transform:none!important;opacity:1!important;filter:none!important}
  .pf-reel-ui,.pf-hint{display:none}}`;

  const body = `
<div class="pf-glow" aria-hidden="true"></div>
<nav class="pf-nav pf-noprint"><div class="pf-shell pf-nav-in">
  <a class="pf-brand" href="#top"><i>${pfEsc(c.initials)}</i>${pfEsc(c.name)}</a>
  ${nav ? `<div class="pf-nav-links">${nav}</div>` : ""}
</div></nav>

<main id="main"><div class="pf-shell">
  <section class="pf-hero" id="top">
    ${d.avatar ? `<img class="pf-portrait" src="${pfEsc(d.avatar)}" alt="${pfEsc(c.name)}" width="128" height="128">` : ""}
    ${d.available ? `<div class="pf-badge">${pfEsc(d.available)}</div>` : ""}
    <h1>${pfEsc(c.name)}</h1>
    ${c.title ? `<h2>${pfEsc(c.title)}</h2>` : ""}
    ${c.tagline ? `<p>${pfEsc(c.tagline)}</p>` : ""}
    <div class="pf-actions">
      ${d.email ? `<a class="pf-btn pf-btn-primary" href="mailto:${pfEsc(d.email)}">${PF_ICONS.mail}${pfEsc(d.cta_text || "Get in touch")}</a>` : ""}
      ${c.hasResume ? `<a class="pf-btn pf-btn-ghost" ${pfResumeAttrs(c)}>${PF_ICONS.download}${pfEsc(c.resumeLabel)}</a>` : ""}
      ${pfSocialRow(c)}
    </div>
  </section>

  ${cards.length ? `<section class="pf-sec" id="projects"><div class="pf-kicker">Work</div>
    <h2 class="pf-h2">Selected projects</h2>
    <div class="pf-stage" id="pf-stage" tabindex="0" role="group" aria-roledescription="carousel"
         aria-label="Project carousel — use the arrow keys">
      ${cards.map((x, i) => `
        <article class="pf-slide" data-slide="${i}" aria-label="${pfEsc(x.name || "Project")}">
          <h3>${pfEsc(x.name || "")}</h3>
          ${pfJoin([x.role, x.period]) ? `<div class="pf-role">${pfJoin([x.role, x.period])}</div>` : ""}
          ${x.description ? `<p>${pfEsc(x.description)}</p>` : ""}
          ${(x.bullets || []).length ? `<ul>${x.bullets.slice(0, 3).map(b => `<li>${pfEsc(b)}</li>`).join("")}</ul>` : ""}
          <div class="pf-tags">${(x.tags || []).map(t => `<span class="pf-tag">${pfEsc(t)}</span>`).join("")}</div>
          ${pfProjectLinks(x) ? `<div class="pf-links">${pfProjectLinks(x)}</div>` : ""}
        </article>`).join("")}
    </div>
    <div class="pf-reel-ui pf-noprint">
      <button class="pf-arrow" data-step="-1" aria-label="Previous project">‹</button>
      ${cards.map((x, i) => `<button class="pf-dot" data-go="${i}" aria-label="Go to ${pfEsc(x.name || "project " + (i + 1))}"></button>`).join("")}
      <button class="pf-arrow" data-step="1" aria-label="Next project">›</button>
    </div>
    <p class="pf-hint pf-noprint">Drag, scroll or use the arrow keys</p>
  </section>` : ""}

  ${c.has("stats") ? `<section class="pf-sec"><div class="pf-stats">
    ${d.stats.map((x, i) => `<div class="pf-card pf-stat" data-reveal data-reveal-delay="${i * 70}">
      <b>${pfEsc(x.value)}</b><span>${pfEsc(x.label)}</span></div>`).join("")}</div></section>` : ""}

  ${c.has("about") ? `<section class="pf-sec" id="about"><div class="pf-kicker">About</div>
    <h2 class="pf-h2">The short version</h2>
    <div class="pf-card pf-about" data-reveal>${pfEsc(d.about)}</div></section>` : ""}

  ${c.has("skills") ? `<section class="pf-sec" id="skills"><div class="pf-kicker">Toolkit</div>
    <h2 class="pf-h2">What I work with</h2>
    <div class="pf-chips" data-reveal>${d.skills.map(x => `<span class="pf-chip">${pfEsc(x)}</span>`).join("")}</div></section>` : ""}

  ${c.has("experience") ? `<section class="pf-sec" id="experience"><div class="pf-kicker">Experience</div>
    <h2 class="pf-h2">Where I have worked</h2>
    <div class="pf-rows">${d.experience.map((x, i) => `
      <article class="pf-card pf-row" data-reveal data-reveal-delay="${Math.min(i, 5) * 70}">
        <div class="pf-row-top"><h3>${pfEsc(x.role || "")}</h3>
          ${x.org ? `<span class="pf-org">${pfEsc(x.org)}</span>` : ""}
          ${x.period ? `<span class="pf-when">${pfEsc(x.period)}</span>` : ""}</div>
        ${x.summary ? `<p>${pfEsc(x.summary)}</p>` : ""}
        ${(x.bullets || []).length ? `<ul>${x.bullets.map(b => `<li>${pfEsc(b)}</li>`).join("")}</ul>` : ""}
      </article>`).join("")}</div></section>` : ""}

  ${c.has("education") ? `<section class="pf-sec" id="education"><div class="pf-kicker">Education</div>
    <h2 class="pf-h2">Where I studied</h2>
    <div class="pf-rows">${d.education.map(x => `
      <article class="pf-card pf-row" data-reveal>
        <div class="pf-row-top"><h3>${pfEsc(x.degree || "")}</h3>
          ${x.school ? `<span class="pf-org">${pfEsc(x.school)}</span>` : ""}
          ${x.period ? `<span class="pf-when">${pfEsc(x.period)}</span>` : ""}</div>
        ${x.detail ? `<p>${pfEsc(x.detail)}</p>` : ""}
      </article>`).join("")}</div></section>` : ""}

  ${c.has("certifications") ? `<section class="pf-sec" id="certifications"><div class="pf-kicker">Credentials</div>
    <h2 class="pf-h2">Certifications</h2>
    <div class="pf-chips" data-reveal>${d.certifications.map(x => `<span class="pf-chip">${pfEsc(x)}</span>`).join("")}</div></section>` : ""}

  ${c.has("contact") ? `<section class="pf-sec" id="contact"><div class="pf-card pf-contact" data-reveal>
    <h2>Let's talk</h2>
    <p>${pfEsc(d.cta_text || "Briefs, questions and long shots all welcome.")}</p>
    <div class="pf-actions" style="margin-top:0">
      ${d.email ? `<a class="pf-btn pf-btn-primary" href="mailto:${pfEsc(d.email)}">${PF_ICONS.mail}${pfEsc(d.email)}</a>` : ""}
      ${c.hasResume ? `<a class="pf-btn pf-btn-ghost" ${pfResumeAttrs(c)}>${PF_ICONS.download}Résumé</a>` : ""}
    </div>
    <div class="pf-clist">${c.links.map(x => x.url
      ? `<a href="${pfEsc(x.url)}"${/^https?:/i.test(x.url) ? ` target="_blank" rel="noopener"` : ""}>${x.icon}${pfEsc(x.handle)}</a>`
      : `<span>${x.icon}${pfEsc(x.handle)}</span>`).join("")}</div>
  </div></section>` : ""}

  <footer>© <span data-year>${c.year}</span> ${pfEsc(c.name)}${d.footer_note ? " · " + pfEsc(d.footer_note) : ""}</footer>
</div></main>`;

  const js = `
(function(){
  var nav = document.querySelector('.pf-nav');
  var onNav = function(){ nav.classList.toggle('pf-stuck', window.scrollY > 8); };
  onNav(); addEventListener('scroll', onNav, { passive:true });
  var links = [].slice.call(document.querySelectorAll('.pf-nav-links a'));
  var secs = links.map(function(a){ return document.querySelector(a.getAttribute('href')); }).filter(Boolean);
  if ('IntersectionObserver' in window && secs.length) {
    var spy = new IntersectionObserver(function(es){
      es.forEach(function(e){ if(!e.isIntersecting) return;
        links.forEach(function(a){ a.classList.toggle('pf-active', a.getAttribute('href') === '#' + e.target.id); }); });
    }, { rootMargin:'-45% 0px -50% 0px' });
    secs.forEach(function(s){ spy.observe(s); });
  }

  var stage = document.getElementById('pf-stage');
  if (!stage) return;
  var slides = [].slice.call(stage.querySelectorAll('.pf-slide'));
  var dots = [].slice.call(document.querySelectorAll('[data-go]'));
  if (!slides.length) return;
  if (matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  var N = slides.length, pos = 0, target = 0, vel = 0, raf = null;
  var GAP = 0, DEPTH = 240, ANGLE = 42;

  function measure(){ GAP = Math.min(260, stage.clientWidth * 0.30); }
  measure(); addEventListener('resize', function(){ measure(); layout(); });

  function layout(){
    for (var i = 0; i < N; i++) {
      var o = i - pos;                        /* signed distance from the front */
      var ab = Math.abs(o);
      var s = slides[i];
      /* clamp() the lateral offset so far-off cards stack at the edge instead
         of flying off screen — the deck stays a deck at any length. */
      var x = Math.sign(o) * Math.min(ab, 2.4) * GAP;
      var z = -Math.min(ab, 3) * DEPTH;
      var ry = -Math.max(-1.2, Math.min(1.2, o)) * ANGLE;
      var sc = 1 - Math.min(ab, 3) * 0.06;
      s.style.transform = 'translate3d(' + x.toFixed(1) + 'px,0,' + z.toFixed(1) + 'px) '
                        + 'rotateY(' + ry.toFixed(2) + 'deg) scale(' + sc.toFixed(3) + ')';
      s.style.opacity = ab > 2.6 ? 0 : (1 - Math.min(ab, 2.6) * 0.22).toFixed(3);
      s.style.zIndex = String(100 - Math.round(ab * 10));
      s.style.setProperty('--sheen', Math.min(0.9, ab * 0.35).toFixed(2));
      /* Depth of field. Opacity alone left three headlines competing for the
         same glance; a little blur on everything but the front card puts them
         behind it instead of beside it. Capped so it stays cheap to composite. */
      s.style.filter = ab < 0.16 ? 'none' : 'blur(' + Math.min(3.4, ab * 2.1).toFixed(2) + 'px)';
      s.setAttribute('aria-hidden', ab > 0.5 ? 'true' : 'false');
      /* Only the front card is reachable by tab — otherwise focus walks into
         cards nobody can read. */
      s.querySelectorAll('a').forEach(function(a){ a.tabIndex = ab < 0.5 ? 0 : -1; });
    }
    dots.forEach(function(dt, i){ dt.classList.toggle('pf-on', Math.round(pos) === i); });
  }

  /* Critically-damped spring. Stiffness and damping are paired so it arrives
     without overshoot; a plain lerp eases out but never has weight. */
  function tick(){
    var dx = target - pos;
    vel += dx * 0.11;                /* stiffness */
    vel *= 0.76;                     /* damping   */
    pos += vel;
    layout();
    if (Math.abs(dx) < 0.0009 && Math.abs(vel) < 0.0009) { pos = target; layout(); raf = null; return; }
    raf = requestAnimationFrame(tick);
  }
  function go(n){
    target = Math.max(0, Math.min(N - 1, n));
    if (!raf) raf = requestAnimationFrame(tick);
  }
  layout();

  document.querySelectorAll('[data-step]').forEach(function(b){
    b.addEventListener('click', function(){ go(Math.round(target) + Number(b.getAttribute('data-step'))); });
  });
  dots.forEach(function(dt){ dt.addEventListener('click', function(){ go(Number(dt.getAttribute('data-go'))); }); });

  stage.addEventListener('keydown', function(e){
    if (e.key === 'ArrowLeft') { e.preventDefault(); go(Math.round(target) - 1); }
    if (e.key === 'ArrowRight') { e.preventDefault(); go(Math.round(target) + 1); }
  });

  /* Horizontal wheel/trackpad only. Claiming vertical wheel would hijack the
     page scroll, which is the single most hated carousel behaviour there is. */
  stage.addEventListener('wheel', function(e){
    if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
    e.preventDefault();
    go(target + e.deltaX * 0.006);
  }, { passive:false });

  var dragging = false, startX = 0, startTarget = 0, moved = 0;
  stage.addEventListener('pointerdown', function(e){
    dragging = true; moved = 0; startX = e.clientX; startTarget = target;
    stage.setPointerCapture(e.pointerId);
  });
  stage.addEventListener('pointermove', function(e){
    if (!dragging) return;
    moved = e.clientX - startX;
    target = startTarget - moved / (GAP || 200);
    if (!raf) raf = requestAnimationFrame(tick);
  });
  function release(){
    if (!dragging) return;
    dragging = false;
    /* Snap on release, but only if the drag was a real gesture — a stray 3px
       nudge should put the card back, not advance the deck. */
    go(Math.abs(moved) > 18 ? Math.round(target) : Math.round(startTarget));
  }
  stage.addEventListener('pointerup', release);
  stage.addEventListener('pointercancel', release);
})();`;

  return { fonts: [c.googleFont ? null : "Inter:wght@400;600;700;800"].filter(Boolean),
           css, body, js, themeColor: "#FDF4FF" };
};

// ---------------------------------------------------------------------------
// Halo — animated conic borders (CSS Houdini) + a cursor spotlight
// ---------------------------------------------------------------------------
// The one thing plain CSS cannot do is animate a conic-gradient's angle: an
// <angle> inside a gradient is not an interpolatable value, so a keyframe on it
// simply snaps. @property registers --pf-ang WITH a type, which makes it
// interpolatable, and the whole ring starts turning — one declaration, no JS,
// no canvas, running on the compositor.
//
// The fallback is the reason this is safe: a browser without @property ignores
// the rule, --pf-ang stays at its fallback 0deg, and every ring renders as a
// static three-stop conic. Still a gradient border, just not a moving one.
PF_RENDERERS.halo = (c) => {
  const d = c.d;
  const a2 = pfHueShift(c.accent, 26);
  const a3 = pfHueShift(c.accent, -40);
  const nav = c.navItems.map(n => `<a href="#${n.id}">${pfEsc(n.label)}</a>`).join("");

  const css = `
@property --pf-ang{syntax:'<angle>';initial-value:0deg;inherits:false}
@property --pf-lit{syntax:'<number>';initial-value:0;inherits:false}

:root{
  --acc:${c.accent}; --a2:${a2}; --a3:${a3};
  --ink:#062E36; --muted:#3F707A; --faint:#87ABB2;
  --bg:#F0FDFF; --card:#FFFFFF; --line:#CDEEF4; --sink:#E3F8FC;
  --font:${c.fontStack || `'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif`};
  --ring:conic-gradient(from var(--pf-ang),var(--acc),var(--a2),var(--a3),var(--acc));
}
body{background:var(--bg);color:var(--ink);font-family:var(--font);font-size:16px;line-height:1.7;overflow-x:hidden}
.pf-skip{background:var(--acc);color:#fff}
.pf-shell{width:min(1120px,92vw);margin:0 auto}

/* Ambient field. Two soft lobes plus a faint grid — the grid is what keeps the
   glow from reading as a blurry JPEG; it gives the eye a hard edge to focus. */
.pf-field{position:fixed;inset:0;z-index:0;pointer-events:none;
  background:
    radial-gradient(52% 40% at 50% 0%,${pfRgba(c.accent, .17)},transparent 70%),
    radial-gradient(40% 36% at 88% 74%,${pfRgba(a3, .14)},transparent 72%),
    radial-gradient(38% 34% at 8% 60%,${pfRgba(a2, .11)},transparent 74%)}
.pf-mesh{position:fixed;inset:0;z-index:1;pointer-events:none;opacity:.5;
  background-image:linear-gradient(${pfRgba(c.accent, .07)} 1px,transparent 1px),
                   linear-gradient(90deg,${pfRgba(c.accent, .07)} 1px,transparent 1px);
  background-size:46px 46px;
  -webkit-mask-image:radial-gradient(70% 55% at 50% 30%,#000,transparent 78%);
          mask-image:radial-gradient(70% 55% at 50% 30%,#000,transparent 78%)}
main{position:relative;z-index:3}

/* ---- the ring primitive -------------------------------------------------
   border-box paints the turning conic; padding-box paints the card. Composited
   with exclude, the conic survives only in the 1.5px border band. No pseudo
   element, no extra node, and it clips correctly on any border-radius. */
.pf-ring{position:relative;background:var(--card);border-radius:20px;
  border:1.5px solid transparent;
  background-image:linear-gradient(var(--card),var(--card)),var(--ring);
  background-origin:border-box;background-clip:padding-box,border-box;
  animation:pf-spin 9s linear infinite}
@keyframes pf-spin{to{--pf-ang:360deg}}

/* Spotlight. --mx/--my are written by one pointermove handler on the grid, so
   N cards cost one listener; opacity is the only thing that transitions. */
.pf-lit{position:relative;isolation:isolate}
/* border-radius:inherit instead of overflow:hidden — the timeline rows hang
   their node dots outside their own box, and overflow:hidden would eat them. */
.pf-lit::after{content:"";position:absolute;inset:0;border-radius:inherit;z-index:-1;pointer-events:none;opacity:0;transition:opacity .32s;
  background:radial-gradient(220px circle at var(--mx,50%) var(--my,50%),${pfRgba(c.accent, .13)},transparent 68%)}
.pf-lit:hover::after,.pf-lit:focus-within::after{opacity:1}

/* A floating pill leaves the strip either side of it transparent, so page
   content scrolled up behind the nav stayed fully legible above the pill.
   The scrim fades it into the page background instead of clipping it. */
.pf-nav{position:sticky;top:0;z-index:20;padding:.7rem 0}
.pf-nav::before{content:"";position:absolute;inset:-1px 0 -20px;z-index:-1;pointer-events:none;
  background:linear-gradient(180deg,var(--bg) 52%,${pfRgba("#F0FDFF", 0)})}
.pf-nav-in{display:flex;align-items:center;gap:1rem;padding:.55rem .6rem .55rem 1rem;border-radius:999px;
  background:${pfRgba("#FFFFFF", .78)};backdrop-filter:blur(16px) saturate(1.5);-webkit-backdrop-filter:blur(16px) saturate(1.5);
  border:1px solid ${pfRgba(c.accent, .16)};box-shadow:0 8px 30px ${pfRgba("#062E36", .07)};transition:.3s}
.pf-nav.pf-stuck .pf-nav-in{box-shadow:0 12px 40px ${pfRgba("#062E36", .12)};border-color:${pfRgba(c.accent, .3)}}
.pf-brand{display:flex;align-items:center;gap:.6rem;font-weight:800;letter-spacing:-.025em;text-decoration:none;font-size:1rem}
.pf-brand i{width:30px;height:30px;display:grid;place-items:center;font-size:.66rem;font-weight:800;font-style:normal;
  color:#fff;border-radius:50%;background:conic-gradient(from var(--pf-ang),var(--acc),var(--a2),var(--a3),var(--acc));
  animation:pf-spin 9s linear infinite}
.pf-nav-links{display:flex;gap:.15rem;margin-left:auto;flex-wrap:wrap}
.pf-nav-links a{padding:.42rem .9rem;border-radius:999px;font-size:.85rem;font-weight:600;color:var(--muted);
  text-decoration:none;transition:.22s}
.pf-nav-links a:hover,.pf-nav-links a.pf-active{color:#fff;background:var(--acc)}

/* ---- hero ---- */
.pf-hero{padding:clamp(2.4rem,7vw,4.4rem) 0 clamp(1.6rem,4vw,2.6rem);text-align:center;position:relative}
.pf-orbit{position:relative;width:clamp(190px,32vw,250px);aspect-ratio:1;margin:0 auto 1.9rem}
/* Three concentric rings at different speeds and one reversed. Same conic,
   different mask radii — a ring is just a disc with its middle masked out. */
.pf-orbit i{position:absolute;inset:0;border-radius:50%;
  background:conic-gradient(from var(--pf-ang),transparent 0deg,var(--acc) 70deg,var(--a2) 150deg,var(--a3) 230deg,transparent 320deg);
  -webkit-mask:radial-gradient(farthest-side,transparent calc(100% - 3px),#000 calc(100% - 3px));
          mask:radial-gradient(farthest-side,transparent calc(100% - 3px),#000 calc(100% - 3px));
  animation:pf-spin 7s linear infinite}
.pf-orbit i:nth-child(2){inset:13%;animation-duration:11s;animation-direction:reverse;opacity:.72}
.pf-orbit i:nth-child(3){inset:26%;animation-duration:16s;opacity:.5}
.pf-orbit .pf-avatar{position:absolute;inset:33%;border-radius:50%;width:auto;height:auto;object-fit:cover;
  box-shadow:0 14px 44px ${pfRgba(c.accent, .3)}}
.pf-avatar-initials{display:grid;place-items:center;font-weight:800;letter-spacing:.02em;color:#fff;
  font-size:clamp(1.5rem,4.4vw,2rem);background:linear-gradient(150deg,var(--acc),var(--a3))}
.pf-badge{display:inline-flex;align-items:center;gap:.55rem;padding:.36rem .95rem .36rem .6rem;border-radius:999px;
  background:#fff;border:1px solid ${pfRgba(c.accent, .24)};color:var(--acc);font-size:.8rem;font-weight:700;margin-bottom:1.2rem}
.pf-badge i{width:8px;height:8px;border-radius:50%;background:var(--acc);box-shadow:0 0 0 0 ${pfRgba(c.accent, .55)};
  animation:pf-pulse 2.2s ease-out infinite}
@keyframes pf-pulse{70%{box-shadow:0 0 0 9px ${pfRgba(c.accent, 0)}}100%{box-shadow:0 0 0 0 ${pfRgba(c.accent, 0)}}}
.pf-hero h1{font-size:clamp(2.2rem,6.6vw,4.2rem);font-weight:800;letter-spacing:-.045em;line-height:1.02;
  background:linear-gradient(100deg,var(--ink) 12%,var(--acc) 52%,var(--a3) 88%);
  -webkit-background-clip:text;background-clip:text;color:transparent}
.pf-hero h2{font-size:clamp(1rem,2.3vw,1.24rem);font-weight:600;color:var(--muted);margin:.85rem 0 .7rem}
.pf-hero p{color:var(--muted);max-width:52ch;margin:0 auto}
.pf-actions{display:flex;flex-wrap:wrap;gap:.65rem;justify-content:center;align-items:center;margin-top:1.7rem}
.pf-btn{display:inline-flex;align-items:center;gap:.5rem;padding:.78rem 1.5rem;border-radius:999px;font-weight:700;
  font-size:.9rem;text-decoration:none;border:1px solid transparent;transition:.24s;cursor:pointer}
.pf-btn svg{width:16px;height:16px}
.pf-btn-primary{background:linear-gradient(120deg,var(--acc),var(--a3));color:#fff;
  box-shadow:0 10px 28px ${pfRgba(c.accent, .34)}}
.pf-btn-primary:hover{transform:translateY(-3px);box-shadow:0 18px 38px ${pfRgba(c.accent, .45)}}
.pf-btn-ghost{background:#fff;border-color:var(--line);color:var(--ink)}
.pf-btn-ghost:hover{border-color:var(--acc);color:var(--acc);transform:translateY(-3px)}
.pf-socials{display:flex;gap:.45rem}
.pf-socials a{display:grid;place-items:center;width:40px;height:40px;border-radius:50%;background:#fff;
  border:1px solid var(--line);color:var(--muted);transition:.24s}
.pf-socials a svg{width:16px;height:16px}
.pf-socials a:hover{color:#fff;background:var(--acc);border-color:var(--acc);transform:translateY(-3px)}

/* ---- sections ---- */
.pf-sec{padding:clamp(2.2rem,5.5vw,3.4rem) 0}
.pf-kicker{display:inline-flex;align-items:center;gap:.55rem;font-size:.74rem;font-weight:800;letter-spacing:.18em;
  text-transform:uppercase;color:var(--acc);margin-bottom:.6rem}
.pf-kicker::before{content:"";width:26px;height:2px;border-radius:2px;background:linear-gradient(90deg,var(--acc),transparent)}
.pf-h2{font-size:clamp(1.5rem,3.6vw,2.2rem);font-weight:800;letter-spacing:-.035em;margin-bottom:1.4rem}

.pf-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(155px,1fr));gap:.9rem}
.pf-stat{padding:1.3rem 1.15rem;text-align:center}
.pf-stat b{display:block;font-size:clamp(1.7rem,4.4vw,2.4rem);font-weight:800;letter-spacing:-.04em;line-height:1;
  background:linear-gradient(140deg,var(--acc),var(--a3));-webkit-background-clip:text;background-clip:text;color:transparent}
.pf-stat span{display:block;margin-top:.45rem;font-size:.8rem;font-weight:600;color:var(--muted)}

.pf-about{padding:clamp(1.4rem,3.4vw,2.1rem);white-space:pre-wrap;color:var(--muted);font-size:1.02rem}

.pf-group{margin-bottom:1.15rem}
.pf-group:last-child{margin-bottom:0}
.pf-chips{display:flex;flex-wrap:wrap;gap:.5rem}
.pf-chip{padding:.5rem 1.05rem;border-radius:999px;font-size:.86rem;font-weight:600;background:#fff;color:var(--ink);
  border:1.5px solid transparent;
  background-image:linear-gradient(#fff,#fff),linear-gradient(120deg,${pfRgba(c.accent, .35)},${pfRgba(a3, .35)});
  background-origin:border-box;background-clip:padding-box,border-box;transition:.24s}
.pf-chip:hover{transform:translateY(-3px);
  background-image:linear-gradient(#fff,#fff),var(--ring);animation:pf-spin 4s linear infinite;
  box-shadow:0 8px 22px ${pfRgba(c.accent, .2)}}

.pf-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:1.1rem}
.pf-proj{padding:1.5rem 1.4rem;display:flex;flex-direction:column;gap:.6rem;transition:transform .3s,box-shadow .3s}
.pf-proj:hover{transform:translateY(-5px);box-shadow:0 20px 46px ${pfRgba("#062E36", .13)}}
.pf-proj h3{font-size:1.14rem;font-weight:800;letter-spacing:-.02em}
.pf-role{font-size:.8rem;font-weight:700;color:var(--acc)}
.pf-proj p{color:var(--muted);font-size:.94rem}
.pf-proj ul,.pf-row ul{display:grid;gap:.4rem}
.pf-proj li,.pf-row li{position:relative;padding-left:1.35rem;color:var(--muted);font-size:.9rem}
.pf-proj li::before,.pf-row li::before{content:"";position:absolute;left:.15rem;top:.62em;width:7px;height:7px;
  border-radius:50%;background:linear-gradient(140deg,var(--acc),var(--a3))}
.pf-tags{display:flex;flex-wrap:wrap;gap:.35rem;margin-top:auto;padding-top:.35rem}
.pf-tag{padding:.24rem .68rem;border-radius:999px;font-size:.72rem;font-weight:700;color:var(--acc);
  background:${pfRgba(c.accent, .1)}}
.pf-links{display:flex;gap:.9rem;flex-wrap:wrap;padding-top:.25rem}
.pf-links a{display:inline-flex;align-items:center;gap:.35rem;font-size:.82rem;font-weight:700;color:var(--acc);
  text-decoration:none}
.pf-links a svg{width:14px;height:14px}
.pf-links a:hover{text-decoration:underline}

/* Timeline. The rail is a gradient that fades at both ends, so it reads as
   a continuing thread rather than a line that starts and stops. */
.pf-time{position:relative;padding-left:2.1rem}
.pf-time::before{content:"";position:absolute;left:8px;top:.4rem;bottom:.4rem;width:2px;border-radius:2px;
  background:linear-gradient(180deg,transparent,${pfRgba(c.accent, .45)} 14%,${pfRgba(a3, .45)} 86%,transparent)}
.pf-row{padding:1.35rem 1.35rem;margin-bottom:.9rem;position:relative}
.pf-row::before{content:"";position:absolute;left:-2.1rem;top:1.7rem;width:18px;height:18px;border-radius:50%;
  background:#fff;border:2px solid var(--acc);box-shadow:0 0 0 4px ${pfRgba(c.accent, .13)}}
.pf-row::after{content:"";position:absolute;left:-1.75rem;top:2.05rem;width:8px;height:8px;border-radius:50%;
  background:linear-gradient(140deg,var(--acc),var(--a3))}
.pf-row-top{display:flex;flex-wrap:wrap;align-items:baseline;gap:.6rem;justify-content:space-between}
.pf-row h3{font-size:1.06rem;font-weight:800;letter-spacing:-.02em}
.pf-when{font-size:.76rem;font-weight:700;color:var(--acc);background:${pfRgba(c.accent, .1)};
  padding:.2rem .6rem;border-radius:999px;white-space:nowrap}
.pf-org{font-size:.85rem;font-weight:600;color:var(--faint);margin:.15rem 0 .5rem}
.pf-row p{color:var(--muted);font-size:.94rem;margin-bottom:.5rem}

.pf-contact{padding:clamp(1.8rem,4.6vw,2.8rem);text-align:center}
.pf-contact h2{font-size:clamp(1.5rem,3.8vw,2.2rem);font-weight:800;letter-spacing:-.035em}
.pf-contact p{color:var(--muted);max-width:46ch;margin:.6rem auto 0}
.pf-clist{display:flex;flex-wrap:wrap;gap:.5rem;justify-content:center;margin-top:1.5rem}
.pf-clist a,.pf-clist span{display:inline-flex;align-items:center;gap:.45rem;padding:.44rem .95rem;border-radius:999px;
  font-size:.83rem;font-weight:600;background:var(--sink);color:var(--muted);text-decoration:none;transition:.22s}
.pf-clist a:hover{background:var(--acc);color:#fff}
.pf-clist svg{width:14px;height:14px}

footer{padding:2.4rem 0 3rem;text-align:center;font-size:.83rem;color:var(--faint);
  border-top:1px solid var(--line);margin-top:1.6rem}

@media (max-width:640px){
  .pf-nav-links{display:none}
  .pf-time{padding-left:1.6rem}
  .pf-row::before{left:-1.6rem;width:15px;height:15px}
  .pf-row::after{left:-1.32rem;top:2.02rem;width:7px;height:7px}
}
/* Reduced motion kills every rotation. The conic stops at 0deg, which is a
   perfectly good static gradient — nothing disappears, it just holds still. */
@media (prefers-reduced-motion:reduce){
  .pf-ring,.pf-orbit i,.pf-brand i,.pf-chip:hover,.pf-badge i{animation:none!important}
  .pf-proj:hover,.pf-chip:hover,.pf-btn:hover,.pf-socials a:hover{transform:none!important}
}`;

  const body = `
<div class="pf-field" aria-hidden="true"></div>
<div class="pf-mesh" aria-hidden="true"></div>
<nav class="pf-nav pf-noprint"><div class="pf-shell"><div class="pf-nav-in">
  <a class="pf-brand" href="#top"><i>${pfEsc(c.initials)}</i>${pfEsc(c.name)}</a>
  ${nav ? `<div class="pf-nav-links">${nav}</div>` : ""}
</div></div></nav>

<main id="main"><div class="pf-shell">
  <section class="pf-hero" id="top">
    <div class="pf-orbit"><i></i><i></i><i></i>${pfAvatar(c)}</div>
    ${d.available ? `<div class="pf-badge"><i></i>${pfEsc(d.available)}</div>` : ""}
    <h1>${pfEsc(c.name)}</h1>
    ${c.title ? `<h2>${pfEsc(c.title)}</h2>` : ""}
    ${c.tagline ? `<p>${pfEsc(c.tagline)}</p>` : ""}
    <div class="pf-actions">
      ${d.email ? `<a class="pf-btn pf-btn-primary" href="mailto:${pfEsc(d.email)}">${PF_ICONS.mail}${pfEsc(d.cta_text || "Get in touch")}</a>` : ""}
      ${c.hasResume ? `<a class="pf-btn pf-btn-ghost" ${pfResumeAttrs(c)}>${PF_ICONS.download}${pfEsc(c.resumeLabel)}</a>` : ""}
      ${pfSocialRow(c)}
    </div>
  </section>

  ${c.has("stats") ? `<section class="pf-sec"><div class="pf-stats" data-spot>
    ${d.stats.map((x, i) => `<div class="pf-ring pf-lit pf-stat" data-reveal data-reveal-delay="${i * 70}">
      <b>${pfEsc(x.value)}</b><span>${pfEsc(x.label)}</span></div>`).join("")}</div></section>` : ""}

  ${c.has("about") ? `<section class="pf-sec" id="about"><div class="pf-kicker">About</div>
    <h2 class="pf-h2">The short version</h2>
    <div class="pf-ring pf-lit pf-about" data-spot data-reveal>${pfEsc(d.about)}</div></section>` : ""}

  ${c.has("skills") ? `<section class="pf-sec" id="skills"><div class="pf-kicker">Toolkit</div>
    <h2 class="pf-h2">What I work with</h2>
    ${c.skillGroups.length > 1
      ? c.skillGroups.map((g, i) => `<div class="pf-group" data-reveal data-reveal-delay="${i * 70}">
          ${g.name ? `<div class="pf-role" style="margin-bottom:.5rem">${pfEsc(g.name)}</div>` : ""}
          <div class="pf-chips">${g.items.map(x => `<span class="pf-chip">${pfEsc(x)}</span>`).join("")}</div></div>`).join("")
      : `<div class="pf-chips" data-reveal>${d.skills.map(x => `<span class="pf-chip">${pfEsc(x)}</span>`).join("")}</div>`}
  </section>` : ""}

  ${c.has("projects") ? `<section class="pf-sec" id="projects"><div class="pf-kicker">Work</div>
    <h2 class="pf-h2">Selected projects</h2>
    <div class="pf-grid" data-spot>${d.projects.map((x, i) => `
      <article class="pf-ring pf-lit pf-proj" data-reveal data-reveal-delay="${Math.min(i, 5) * 80}">
        <h3>${pfEsc(x.name || "")}</h3>
        ${pfJoin([x.role, x.period]) ? `<div class="pf-role">${pfJoin([x.role, x.period])}</div>` : ""}
        ${x.description ? `<p>${pfEsc(x.description)}</p>` : ""}
        ${(x.bullets || []).length ? `<ul>${x.bullets.map(b => `<li>${pfEsc(b)}</li>`).join("")}</ul>` : ""}
        ${(x.tags || []).length ? `<div class="pf-tags">${x.tags.map(t => `<span class="pf-tag">${pfEsc(t)}</span>`).join("")}</div>` : ""}
        ${pfProjectLinks(x) ? `<div class="pf-links">${pfProjectLinks(x)}</div>` : ""}
      </article>`).join("")}</div></section>` : ""}

  ${c.has("experience") ? `<section class="pf-sec" id="experience"><div class="pf-kicker">Experience</div>
    <h2 class="pf-h2">Where I have worked</h2>
    <div class="pf-time" data-spot>${d.experience.map((x, i) => `
      <article class="pf-ring pf-lit pf-row" data-reveal data-reveal-delay="${Math.min(i, 5) * 70}">
        <div class="pf-row-top"><h3>${pfEsc(x.role || "")}</h3>
          ${x.period ? `<span class="pf-when">${pfEsc(x.period)}</span>` : ""}</div>
        ${x.org ? `<div class="pf-org">${pfJoin([x.org, x.location])}</div>` : ""}
        ${x.summary ? `<p>${pfEsc(x.summary)}</p>` : ""}
        ${(x.bullets || []).length ? `<ul>${x.bullets.map(b => `<li>${pfEsc(b)}</li>`).join("")}</ul>` : ""}
      </article>`).join("")}</div></section>` : ""}

  ${c.has("education") ? `<section class="pf-sec" id="education"><div class="pf-kicker">Education</div>
    <h2 class="pf-h2">Where I studied</h2>
    <div class="pf-time" data-spot>${d.education.map(x => `
      <article class="pf-ring pf-lit pf-row" data-reveal>
        <div class="pf-row-top"><h3>${pfEsc(x.degree || "")}</h3>
          ${x.period ? `<span class="pf-when">${pfEsc(x.period)}</span>` : ""}</div>
        ${x.school ? `<div class="pf-org">${pfEsc(x.school)}</div>` : ""}
        ${x.detail ? `<p>${pfEsc(x.detail)}</p>` : ""}
      </article>`).join("")}</div></section>` : ""}

  ${c.has("certifications") ? `<section class="pf-sec" id="certifications"><div class="pf-kicker">Credentials</div>
    <h2 class="pf-h2">Certifications</h2>
    <div class="pf-chips" data-reveal>${d.certifications.map(x => `<span class="pf-chip">${pfEsc(x)}</span>`).join("")}</div></section>` : ""}

  ${c.has("contact") ? `<section class="pf-sec" id="contact"><div class="pf-ring pf-lit pf-contact" data-spot data-reveal>
    <h2>Let's build something that lasts</h2>
    <p>${pfEsc(d.cta_text || "Tell me what you are building and where it is stuck.")}</p>
    <div class="pf-actions" style="margin-top:1.4rem">
      ${d.email ? `<a class="pf-btn pf-btn-primary" href="mailto:${pfEsc(d.email)}">${PF_ICONS.mail}${pfEsc(d.email)}</a>` : ""}
      ${c.hasResume ? `<a class="pf-btn pf-btn-ghost" ${pfResumeAttrs(c)}>${PF_ICONS.download}Résumé</a>` : ""}
    </div>
    <div class="pf-clist">${c.links.map(x => x.url
      ? `<a href="${pfEsc(x.url)}"${/^https?:/i.test(x.url) ? ` target="_blank" rel="noopener"` : ""}>${x.icon}${pfEsc(x.handle)}</a>`
      : `<span>${x.icon}${pfEsc(x.handle)}</span>`).join("")}</div>
  </div></section>` : ""}

  <footer>© <span data-year>${c.year}</span> ${pfEsc(c.name)}${d.footer_note ? " · " + pfEsc(d.footer_note) : ""}</footer>
</div></main>`;

  const js = `
(function(){
  var nav = document.querySelector('.pf-nav');
  var links = Array.prototype.slice.call(document.querySelectorAll('.pf-nav-links a'));
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* Rings all start at --pf-ang:0deg, so without this every conic on the page
     turns in perfect lockstep and the effect reads as one big rotating layer
     rather than N independent objects. A negative delay starts each one
     mid-cycle at load, which costs nothing and fixes it. */
  if (!reduce) {
    Array.prototype.forEach.call(document.querySelectorAll('.pf-ring'), function(el, i){
      el.style.animationDelay = (-(i * 1.37) % 9).toFixed(2) + 's';
    });
  }

  /* One pointermove listener per group instead of one per card, and the rect
     read is deferred to a rAF so a fast sweep across twelve cards still costs
     one layout per frame. */
  Array.prototype.forEach.call(document.querySelectorAll('[data-spot]'), function(group){
    var pending = null, queued = false;
    function flush(){
      queued = false;
      if (!pending) return;
      var el = pending.el, r = el.getBoundingClientRect();
      if (!r.width || !r.height) return;
      el.style.setProperty('--mx', (((pending.x - r.left) / r.width) * 100).toFixed(1) + '%');
      el.style.setProperty('--my', (((pending.y - r.top) / r.height) * 100).toFixed(1) + '%');
    }
    group.addEventListener('pointermove', function(e){
      var el = e.target.closest ? e.target.closest('.pf-lit') : null;
      if (!el || !group.contains(el)) return;
      pending = { el: el, x: e.clientX, y: e.clientY };
      if (!queued) { queued = true; requestAnimationFrame(flush); }
    }, { passive: true });
  });

  /* Nav shadow + scroll spy, both off the same observer set so there is no
     scroll listener doing getBoundingClientRect on every frame. */
  var top = document.getElementById('top');
  if (nav && top) {
    new IntersectionObserver(function(es){
      nav.classList.toggle('pf-stuck', !es[0].isIntersecting);
    }, { rootMargin: '-60px 0px 0px 0px' }).observe(top);
  }

  var targets = links.map(function(a){
    return document.querySelector(a.getAttribute('href'));
  }).filter(Boolean);
  if (targets.length) {
    var seen = {};
    var spy = new IntersectionObserver(function(entries){
      entries.forEach(function(en){ seen[en.target.id] = en.intersectionRatio; });
      var best = '', bestR = 0;
      Object.keys(seen).forEach(function(id){ if (seen[id] > bestR) { bestR = seen[id]; best = id; } });
      links.forEach(function(a){
        a.classList.toggle('pf-active', a.getAttribute('href') === '#' + best && bestR > 0);
      });
    }, { threshold: [0, .18, .5, .85], rootMargin: '-25% 0px -45% 0px' });
    targets.forEach(function(t){ spy.observe(t); });
  }
})();`;

  return { fonts: [c.googleFont ? null : "Inter:wght@400;600;700;800"].filter(Boolean),
           css, body, js, themeColor: "#F0FDFF" };
};

// ---------------------------------------------------------------------------
// Filament — a verlet-integrated curtain of hanging skill chips
// ---------------------------------------------------------------------------
// The skills section is a real physics simulation, not a keyframe: every chip
// hangs from a rope of six point masses, integrated with verlet (position +
// implied velocity, no stored velocity vector) and relaxed against distance
// constraints three times a frame. Drag a chip and the rope follows with the
// right lag; let go and it swings down and settles. Scrolling adds a lateral
// impulse, so the whole curtain leans as the page moves.
//
// Verlet rather than Euler because the constraint solve is the whole trick:
// you move a point wherever you like and its velocity updates itself, which is
// what makes "grab it and throw it" three lines instead of thirty.
PF_RENDERERS.filament = (c) => {
  const d = c.d;
  const a2 = pfHueShift(c.accent, -44);
  const a3 = pfHueShift(c.accent, 52);
  const nav = c.navItems.map(n => `<a href="#${n.id}">${pfEsc(n.label)}</a>`).join("");

  const css = `
:root{
  --acc:${c.accent}; --a2:${a2}; --a3:${a3};
  --ink:#1B2A08; --muted:#516B36; --faint:#8FA574;
  --bg:#FAFDF2; --card:#FFFFFF; --line:#E2EFCE; --sink:#F1F8E4;
  --font:${c.fontStack || `'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif`};
}
body{background:var(--bg);color:var(--ink);font-family:var(--font);font-size:16px;line-height:1.7;overflow-x:hidden}
.pf-skip{background:var(--acc);color:#fff}
.pf-shell{width:min(1100px,92vw);margin:0 auto}

/* Ruled ground. A faint horizontal rule every 34px reads as lab paper and,
   more usefully, gives the hanging ropes something to be measured against. */
.pf-paper{position:fixed;inset:0;z-index:0;pointer-events:none;
  background-image:repeating-linear-gradient(180deg,${pfRgba(c.accent, .06)} 0 1px,transparent 1px 34px);
  -webkit-mask-image:linear-gradient(180deg,#000,transparent 92%);
          mask-image:linear-gradient(180deg,#000,transparent 92%)}
.pf-lamp{position:fixed;inset:0;z-index:0;pointer-events:none;
  background:radial-gradient(48% 34% at 50% -4%,${pfRgba(a2, .2)},transparent 72%),
             radial-gradient(40% 32% at 92% 66%,${pfRgba(c.accent, .13)},transparent 74%),
             radial-gradient(36% 30% at 4% 44%,${pfRgba(a3, .11)},transparent 76%)}
main{position:relative;z-index:3}

.pf-nav{position:sticky;top:0;z-index:20;background:${pfRgba("#FAFDF2", .9)};
  backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);
  border-bottom:1px solid transparent;transition:.28s}
.pf-nav.pf-stuck{border-bottom-color:var(--line);box-shadow:0 6px 24px ${pfRgba("#1B2A08", .06)}}
.pf-nav-in{display:flex;align-items:center;gap:1.1rem;padding:.8rem 0}
.pf-brand{display:flex;align-items:center;gap:.6rem;font-weight:800;letter-spacing:-.025em;
  text-decoration:none;font-size:1rem}
/* The brand mark is a filament: a wire with a bulb on the end. */
.pf-brand i{position:relative;width:30px;height:30px;display:grid;place-items:center;font-style:normal;
  font-size:.64rem;font-weight:800;color:#fff;border-radius:10px 10px 14px 14px;
  background:linear-gradient(160deg,var(--acc),var(--a3))}
.pf-brand i::before{content:"";position:absolute;top:-7px;left:50%;width:1.5px;height:7px;background:var(--faint)}
.pf-nav-links{display:flex;gap:.15rem;margin-left:auto;flex-wrap:wrap}
.pf-nav-links a{padding:.42rem .85rem;border-radius:8px;font-size:.85rem;font-weight:600;color:var(--muted);
  text-decoration:none;transition:.22s}
.pf-nav-links a:hover,.pf-nav-links a.pf-active{color:var(--acc);background:${pfRgba(c.accent, .12)}}

/* ---- hero ---- */
.pf-hero{padding:clamp(2.6rem,7vw,4.4rem) 0 clamp(1.4rem,3.4vw,2.2rem);position:relative}
.pf-hero-in{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(0,.65fr);gap:clamp(1.4rem,4vw,3rem);align-items:center}
@media (max-width:860px){.pf-hero-in{grid-template-columns:1fr}}
.pf-badge{display:inline-flex;align-items:center;gap:.55rem;padding:.34rem .95rem .34rem .55rem;border-radius:999px;
  background:#fff;border:1px solid ${pfRgba(c.accent, .26)};color:var(--acc);font-size:.79rem;font-weight:700;margin-bottom:1.1rem}
.pf-badge i{width:9px;height:9px;border-radius:50%;background:var(--a2);
  box-shadow:0 0 8px ${pfRgba(a2, .9)};animation:pf-glow 2.4s ease-in-out infinite}
@keyframes pf-glow{50%{box-shadow:0 0 15px ${pfRgba(a2, 1)};transform:scale(1.18)}}
.pf-hero h1{font-size:clamp(2.2rem,6.6vw,4.1rem);font-weight:800;letter-spacing:-.045em;line-height:1.03}
.pf-hero h1 em{font-style:normal;
  background:linear-gradient(100deg,var(--acc),var(--a2));-webkit-background-clip:text;background-clip:text;color:transparent}
.pf-hero h2{font-size:clamp(1rem,2.3vw,1.22rem);font-weight:600;color:var(--muted);margin:.85rem 0 .7rem}
.pf-hero p{color:var(--muted);max-width:54ch}
/* The portrait hangs from the same rail the skills do: two wires to a bar, a
   terminal dot at the top, and a slow sway pivoting about that dot rather than
   about the frame — which is the difference between a picture that hangs and a
   picture that wobbles. */
.pf-portrait{position:relative;justify-self:center;margin-top:52px;
  transform-origin:50% -52px;animation:pf-sway 7.5s ease-in-out infinite}
@keyframes pf-sway{0%,100%{transform:rotate(-1.1deg)}50%{transform:rotate(1.1deg)}}
.pf-portrait .pf-avatar{width:clamp(158px,23vw,208px);aspect-ratio:1;object-fit:cover;border-radius:22px;
  box-shadow:0 22px 54px ${pfRgba("#1B2A08", .2)}}
.pf-avatar-initials{display:grid;place-items:center;font-weight:800;color:#fff;font-size:clamp(1.7rem,5vw,2.4rem);
  background:radial-gradient(120% 100% at 26% 12%,${pfRgba("#FFFFFF", .3)},transparent 56%),
             linear-gradient(150deg,var(--acc),var(--a3));
  box-shadow:inset 0 0 0 1.5px ${pfRgba("#FFFFFF", .3)},0 22px 54px ${pfRgba("#1B2A08", .2)}}
/* Two cords meeting at one nail. A bordered box was the cheap version of this
   and it read as a box; preserveAspectRatio="none" lets one 120x58 viewBox
   stretch to whatever width the frame ends up, so the cords always meet the
   top corners no matter how the clamp() resolves. */
.pf-cord{position:absolute;left:0;right:0;top:-54px;width:100%;height:54px;overflow:visible}
.pf-cord path{fill:none;stroke:${pfRgba(c.accent, .6)};stroke-width:1.6;
  vector-effect:non-scaling-stroke;stroke-linejoin:round;stroke-linecap:round}
.pf-portrait::after{content:"";position:absolute;left:50%;top:-59px;width:10px;height:10px;margin-left:-5px;
  border-radius:50%;background:var(--acc);box-shadow:0 0 0 4px ${pfRgba(c.accent, .16)}}

.pf-actions{display:flex;flex-wrap:wrap;gap:.65rem;align-items:center;margin-top:1.6rem}
.pf-btn{display:inline-flex;align-items:center;gap:.5rem;padding:.78rem 1.45rem;border-radius:12px;font-weight:700;
  font-size:.9rem;text-decoration:none;border:1px solid transparent;transition:.24s;cursor:pointer}
.pf-btn svg{width:16px;height:16px}
.pf-btn-primary{background:linear-gradient(120deg,var(--acc),var(--a3));color:#fff;
  box-shadow:0 10px 26px ${pfRgba(c.accent, .32)}}
.pf-btn-primary:hover{transform:translateY(-3px);box-shadow:0 16px 36px ${pfRgba(c.accent, .42)}}
.pf-btn-ghost{background:#fff;border-color:var(--line);color:var(--ink)}
.pf-btn-ghost:hover{border-color:var(--acc);color:var(--acc);transform:translateY(-3px)}
.pf-socials{display:flex;gap:.45rem}
.pf-socials a{display:grid;place-items:center;width:40px;height:40px;border-radius:11px;background:#fff;
  border:1px solid var(--line);color:var(--muted);transition:.24s}
.pf-socials a svg{width:16px;height:16px}
.pf-socials a:hover{color:#fff;background:var(--acc);border-color:var(--acc);transform:translateY(-3px)}

/* ---- sections ---- */
.pf-sec{padding:clamp(2.2rem,5.5vw,3.4rem) 0}
.pf-kicker{display:inline-flex;align-items:center;gap:.5rem;font-size:.72rem;font-weight:800;letter-spacing:.2em;
  text-transform:uppercase;color:var(--acc)}
.pf-kicker b{font-variant-numeric:tabular-nums;color:var(--faint)}
.pf-h2{font-size:clamp(1.5rem,3.6vw,2.2rem);font-weight:800;letter-spacing:-.035em;margin:.4rem 0 1.4rem}
.pf-card{background:var(--card);border:1px solid var(--line);border-radius:18px}

.pf-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:.9rem}
.pf-stat{padding:1.3rem 1.1rem;position:relative;overflow:hidden}
.pf-stat::before{content:"";position:absolute;left:0;top:0;width:100%;height:3px;
  background:linear-gradient(90deg,var(--acc),var(--a2))}
.pf-stat b{display:block;font-size:clamp(1.7rem,4.4vw,2.4rem);font-weight:800;letter-spacing:-.04em;line-height:1;color:var(--acc)}
.pf-stat span{display:block;margin-top:.4rem;font-size:.8rem;font-weight:600;color:var(--muted)}

.pf-about{padding:clamp(1.4rem,3.4vw,2.1rem);white-space:pre-wrap;color:var(--muted);font-size:1.02rem}

/* ---- the curtain ---------------------------------------------------------
   Height is set by JS once the chips have been measured and packed into rows;
   the min-height only stops the section collapsing before that happens. */
.pf-curtain{position:relative;min-height:210px;touch-action:pan-y;user-select:none}
.pf-wires{position:absolute;inset:0;width:100%;height:100%;overflow:visible;pointer-events:none}
.pf-wires path{fill:none;stroke:${pfRgba(c.accent, .5)};stroke-width:1.6;stroke-linecap:round}
.pf-wires circle{fill:var(--acc)}
.pf-hangs{position:absolute;inset:0;margin:0;padding:0;list-style:none}
.pf-rail{position:absolute;height:2px;border-radius:2px;
  background:linear-gradient(90deg,transparent,${pfRgba(c.accent, .5)} 8%,${pfRgba(a3, .5)} 92%,transparent)}
.pf-hang{position:absolute;top:0;left:0;padding:.5rem 1rem;border-radius:999px;font-size:.86rem;font-weight:700;
  white-space:nowrap;background:#fff;color:var(--ink);border:1.5px solid ${pfRgba(c.accent, .34)};
  box-shadow:0 6px 16px ${pfRgba("#1B2A08", .09)};cursor:grab;
  transform-origin:50% -6px;will-change:transform;transition:border-color .2s,box-shadow .2s,background .2s}
.pf-hang:hover,.pf-hang:focus-visible{border-color:var(--acc);background:var(--sink);
  box-shadow:0 10px 24px ${pfRgba(c.accent, .26)}}
.pf-hang.pf-held{cursor:grabbing;border-color:var(--a2);background:#fff;
  box-shadow:0 14px 30px ${pfRgba(a2, .34)}}
/* The hook: a small dot at the chip's top edge where the rope terminates. */
.pf-hang::before{content:"";position:absolute;left:50%;top:-4px;width:7px;height:7px;margin-left:-3.5px;
  border-radius:50%;background:var(--acc)}
.pf-hint{margin-top:.9rem;font-size:.78rem;font-weight:600;color:var(--faint)}
/* The static fallback, used for reduced motion and when JS never runs. */
.pf-flat{display:flex;flex-wrap:wrap;gap:.5rem}
.pf-flat span{padding:.5rem 1rem;border-radius:999px;font-size:.86rem;font-weight:700;background:#fff;
  border:1.5px solid ${pfRgba(c.accent, .34)}}

.pf-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:1.1rem}
.pf-proj{padding:1.5rem 1.4rem;display:flex;flex-direction:column;gap:.6rem;position:relative;
  transition:transform .3s,box-shadow .3s,border-color .3s}
.pf-proj::before{content:attr(data-n);position:absolute;right:1.1rem;top:1rem;font-size:.72rem;font-weight:800;
  letter-spacing:.14em;color:var(--faint)}
.pf-proj:hover{transform:translateY(-5px);border-color:${pfRgba(c.accent, .5)};
  box-shadow:0 20px 44px ${pfRgba("#1B2A08", .12)}}
.pf-proj h3{font-size:1.14rem;font-weight:800;letter-spacing:-.02em;padding-right:2.4rem}
.pf-role{font-size:.79rem;font-weight:700;color:var(--acc)}
.pf-proj p{color:var(--muted);font-size:.94rem}
.pf-proj ul,.pf-row ul{display:grid;gap:.4rem}
.pf-proj li,.pf-row li{position:relative;padding-left:1.3rem;color:var(--muted);font-size:.9rem}
.pf-proj li::before,.pf-row li::before{content:"";position:absolute;left:.2rem;top:.55em;width:8px;height:8px;
  border-radius:2px;transform:rotate(45deg);background:linear-gradient(140deg,var(--acc),var(--a2))}
.pf-tags{display:flex;flex-wrap:wrap;gap:.35rem;margin-top:auto;padding-top:.35rem}
.pf-tag{padding:.24rem .68rem;border-radius:6px;font-size:.72rem;font-weight:700;color:var(--acc);
  background:${pfRgba(c.accent, .11)}}
.pf-links{display:flex;gap:.9rem;flex-wrap:wrap;padding-top:.25rem}
.pf-links a{display:inline-flex;align-items:center;gap:.35rem;font-size:.82rem;font-weight:700;color:var(--acc);
  text-decoration:none}
.pf-links a svg{width:14px;height:14px}
.pf-links a:hover{text-decoration:underline}

/* Experience hangs off a vertical filament of its own. */
.pf-time{position:relative;padding-left:2rem}
.pf-time::before{content:"";position:absolute;left:7px;top:.5rem;bottom:.5rem;width:2px;
  background:repeating-linear-gradient(180deg,${pfRgba(c.accent, .55)} 0 7px,transparent 7px 13px)}
.pf-row{padding:1.35rem;margin-bottom:.9rem;position:relative}
.pf-row::before{content:"";position:absolute;left:-2rem;top:1.75rem;width:16px;height:16px;border-radius:50%;
  background:#fff;border:2px solid var(--acc)}
.pf-row::after{content:"";position:absolute;left:-1.7rem;top:2.05rem;width:6px;height:6px;border-radius:50%;
  background:var(--a2);box-shadow:0 0 9px ${pfRgba(a2, .9)}}
.pf-row-top{display:flex;flex-wrap:wrap;align-items:baseline;gap:.6rem;justify-content:space-between}
.pf-row h3{font-size:1.05rem;font-weight:800;letter-spacing:-.02em}
.pf-when{font-size:.75rem;font-weight:700;color:var(--acc);background:${pfRgba(c.accent, .11)};
  padding:.2rem .6rem;border-radius:6px;white-space:nowrap}
.pf-org{font-size:.85rem;font-weight:600;color:var(--faint);margin:.15rem 0 .5rem}
.pf-row p{color:var(--muted);font-size:.94rem;margin-bottom:.5rem}

.pf-contact{padding:clamp(1.8rem,4.6vw,2.8rem);text-align:center;position:relative;overflow:hidden}
.pf-contact::before{content:"";position:absolute;left:0;right:0;top:0;height:4px;
  background:linear-gradient(90deg,var(--acc),var(--a2),var(--a3))}
.pf-contact h2{font-size:clamp(1.5rem,3.8vw,2.2rem);font-weight:800;letter-spacing:-.035em}
.pf-contact p{color:var(--muted);max-width:46ch;margin:.6rem auto 0}
.pf-clist{display:flex;flex-wrap:wrap;gap:.5rem;justify-content:center;margin-top:1.5rem}
.pf-clist a,.pf-clist span{display:inline-flex;align-items:center;gap:.45rem;padding:.44rem .95rem;border-radius:8px;
  font-size:.83rem;font-weight:600;background:var(--sink);color:var(--muted);text-decoration:none;transition:.22s}
.pf-clist a:hover{background:var(--acc);color:#fff}
.pf-clist svg{width:14px;height:14px}

footer{padding:2.4rem 0 3rem;text-align:center;font-size:.83rem;color:var(--faint);
  border-top:1px solid var(--line);margin-top:1.6rem}

@media (max-width:640px){
  .pf-nav-links{display:none}
  .pf-time{padding-left:1.55rem}
  .pf-row::before{left:-1.55rem;width:14px;height:14px}
  .pf-row::after{left:-1.3rem;top:2rem}
}
@media (prefers-reduced-motion:reduce){
  .pf-curtain,.pf-hint{display:none!important}
  .pf-badge i,.pf-portrait{animation:none!important}
  .pf-proj:hover,.pf-btn:hover,.pf-socials a:hover{transform:none!important}
}
/* Without JS the curtain never gets its height or its chip positions, so the
   flat list is what ships and the curtain is revealed only once JS marks it. */
.pf-flat{display:flex}
.pf-live .pf-flat{display:none}
.pf-curtain{display:none}
.pf-live .pf-curtain{display:block}
@media (prefers-reduced-motion:reduce){.pf-live .pf-flat{display:flex}}`;

  const chips = d.skills;
  const body = `
<div class="pf-paper" aria-hidden="true"></div>
<div class="pf-lamp" aria-hidden="true"></div>
<nav class="pf-nav pf-noprint"><div class="pf-shell pf-nav-in">
  <a class="pf-brand" href="#top"><i>${pfEsc(c.initials)}</i>${pfEsc(c.name)}</a>
  ${nav ? `<div class="pf-nav-links">${nav}</div>` : ""}
</div></nav>

<main id="main"><div class="pf-shell">
  <section class="pf-hero" id="top"><div class="pf-hero-in">
    <div>
      ${d.available ? `<div class="pf-badge"><i></i>${pfEsc(d.available)}</div>` : ""}
      <h1>${pfEsc(c.name)}</h1>
      ${c.title ? `<h2><em>${pfEsc(c.title)}</em></h2>` : ""}
      ${c.tagline ? `<p>${pfEsc(c.tagline)}</p>` : ""}
      <div class="pf-actions">
        ${d.email ? `<a class="pf-btn pf-btn-primary" href="mailto:${pfEsc(d.email)}">${PF_ICONS.mail}${pfEsc(d.cta_text || "Get in touch")}</a>` : ""}
        ${c.hasResume ? `<a class="pf-btn pf-btn-ghost" ${pfResumeAttrs(c)}>${PF_ICONS.download}${pfEsc(c.resumeLabel)}</a>` : ""}
        ${pfSocialRow(c)}
      </div>
    </div>
    <div class="pf-portrait">
      <svg class="pf-cord" viewBox="0 0 120 54" preserveAspectRatio="none" aria-hidden="true">
        <path d="M9 54 L60 4 L111 54"/></svg>
      ${pfAvatar(c)}
    </div>
  </div></section>

  ${c.has("stats") ? `<section class="pf-sec"><div class="pf-stats">
    ${d.stats.map((x, i) => `<div class="pf-card pf-stat" data-reveal data-reveal-delay="${i * 70}">
      <b>${pfEsc(x.value)}</b><span>${pfEsc(x.label)}</span></div>`).join("")}</div></section>` : ""}

  ${c.has("about") ? `<section class="pf-sec" id="about"><div class="pf-kicker"><b>01</b> About</div>
    <h2 class="pf-h2">The short version</h2>
    <div class="pf-card pf-about" data-reveal>${pfEsc(d.about)}</div></section>` : ""}

  ${c.has("skills") ? `<section class="pf-sec" id="skills"><div class="pf-kicker"><b>02</b> Toolkit</div>
    <h2 class="pf-h2">Everything I keep on the bench</h2>
    <div class="pf-flat">${chips.map(x => `<span>${pfEsc(x)}</span>`).join("")}</div>
    <div class="pf-curtain" data-curtain>
      <svg class="pf-wires" aria-hidden="true"></svg>
      <ul class="pf-hangs">${chips.map(x => `<li class="pf-hang">${pfEsc(x)}</li>`).join("")}</ul>
    </div>
    <p class="pf-hint" aria-hidden="true">Drag one.</p>
  </section>` : ""}

  ${c.has("projects") ? `<section class="pf-sec" id="projects"><div class="pf-kicker"><b>03</b> Work</div>
    <h2 class="pf-h2">Selected projects</h2>
    <div class="pf-grid">${d.projects.map((x, i) => `
      <article class="pf-card pf-proj" data-n="${String(i + 1).padStart(2, "0")}" data-reveal data-reveal-delay="${Math.min(i, 5) * 80}">
        <h3>${pfEsc(x.name || "")}</h3>
        ${pfJoin([x.role, x.period]) ? `<div class="pf-role">${pfJoin([x.role, x.period])}</div>` : ""}
        ${x.description ? `<p>${pfEsc(x.description)}</p>` : ""}
        ${(x.bullets || []).length ? `<ul>${x.bullets.map(b => `<li>${pfEsc(b)}</li>`).join("")}</ul>` : ""}
        ${(x.tags || []).length ? `<div class="pf-tags">${x.tags.map(t => `<span class="pf-tag">${pfEsc(t)}</span>`).join("")}</div>` : ""}
        ${pfProjectLinks(x) ? `<div class="pf-links">${pfProjectLinks(x)}</div>` : ""}
      </article>`).join("")}</div></section>` : ""}

  ${c.has("experience") ? `<section class="pf-sec" id="experience"><div class="pf-kicker"><b>04</b> Experience</div>
    <h2 class="pf-h2">Where I have worked</h2>
    <div class="pf-time">${d.experience.map((x, i) => `
      <article class="pf-card pf-row" data-reveal data-reveal-delay="${Math.min(i, 5) * 70}">
        <div class="pf-row-top"><h3>${pfEsc(x.role || "")}</h3>
          ${x.period ? `<span class="pf-when">${pfEsc(x.period)}</span>` : ""}</div>
        ${x.org ? `<div class="pf-org">${pfJoin([x.org, x.location])}</div>` : ""}
        ${x.summary ? `<p>${pfEsc(x.summary)}</p>` : ""}
        ${(x.bullets || []).length ? `<ul>${x.bullets.map(b => `<li>${pfEsc(b)}</li>`).join("")}</ul>` : ""}
      </article>`).join("")}</div></section>` : ""}

  ${c.has("education") ? `<section class="pf-sec" id="education"><div class="pf-kicker"><b>05</b> Education</div>
    <h2 class="pf-h2">Where I studied</h2>
    <div class="pf-time">${d.education.map(x => `
      <article class="pf-card pf-row" data-reveal>
        <div class="pf-row-top"><h3>${pfEsc(x.degree || "")}</h3>
          ${x.period ? `<span class="pf-when">${pfEsc(x.period)}</span>` : ""}</div>
        ${x.school ? `<div class="pf-org">${pfEsc(x.school)}</div>` : ""}
        ${x.detail ? `<p>${pfEsc(x.detail)}</p>` : ""}
      </article>`).join("")}</div></section>` : ""}

  ${c.has("certifications") ? `<section class="pf-sec" id="certifications"><div class="pf-kicker"><b>06</b> Credentials</div>
    <h2 class="pf-h2">Certifications</h2>
    <div class="pf-flat" style="display:flex" data-reveal>${d.certifications.map(x => `<span>${pfEsc(x)}</span>`).join("")}</div></section>` : ""}

  ${c.has("contact") ? `<section class="pf-sec" id="contact"><div class="pf-card pf-contact" data-reveal>
    <h2>Let's wire something up</h2>
    <p>${pfEsc(d.cta_text || "Tell me what you are building and where it is stuck.")}</p>
    <div class="pf-actions" style="justify-content:center;margin-top:1.4rem">
      ${d.email ? `<a class="pf-btn pf-btn-primary" href="mailto:${pfEsc(d.email)}">${PF_ICONS.mail}${pfEsc(d.email)}</a>` : ""}
      ${c.hasResume ? `<a class="pf-btn pf-btn-ghost" ${pfResumeAttrs(c)}>${PF_ICONS.download}Résumé</a>` : ""}
    </div>
    <div class="pf-clist">${c.links.map(x => x.url
      ? `<a href="${pfEsc(x.url)}"${/^https?:/i.test(x.url) ? ` target="_blank" rel="noopener"` : ""}>${x.icon}${pfEsc(x.handle)}</a>`
      : `<span>${x.icon}${pfEsc(x.handle)}</span>`).join("")}</div>
  </div></section>` : ""}

  <footer>© <span data-year>${c.year}</span> ${pfEsc(c.name)}${d.footer_note ? " · " + pfEsc(d.footer_note) : ""}</footer>
</div></main>`;

  const js = `
(function(){
  var root = document.documentElement;
  var stage = document.querySelector('[data-curtain]');
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------------- the curtain ---------------- */
  if (stage && !reduce) (function(){
    var svg = stage.querySelector('.pf-wires');
    var NS = 'http://www.w3.org/2000/svg';
    var els = Array.prototype.slice.call(stage.querySelectorAll('.pf-hang'));
    if (!svg || !els.length) return;

    /* Reveal the curtain before measuring: the chips are display:none until
       .pf-live lands, and a hidden element measures zero. */
    root.classList.add('pf-live');

    var SEGS = 6, GRAV = 0.55, DAMP = 0.985, ITER = 3, GAP = 14, ROWH = 108, PAD = 16;
    var chips = [], rails = [], W = 0, running = false, raf = 0, idle = 0, held = null;
    var lastScroll = window.pageYOffset || 0, lag = 0, t = 0;

    els.forEach(function(el, i){
      var path = document.createElementNS(NS, 'path');
      var dot  = document.createElementNS(NS, 'circle');
      dot.setAttribute('r', '3.5');
      svg.appendChild(path); svg.appendChild(dot);
      chips.push({ el: el, path: path, dot: dot, i: i, w: 0, ax: 0, ay: 0, seg: 10, pts: [] });
    });

    function layout(){
      W = stage.clientWidth;
      if (!W) return;
      chips.forEach(function(ch){ ch.el.style.transform = 'none'; ch.w = ch.el.offsetWidth; });

      /* Greedy row packing on measured widths — the chips are text, so their
         widths are whatever the font gives us and cannot be assumed. */
      var rows = [], cur = [], run = 0;
      chips.forEach(function(ch){
        if (cur.length && run + GAP + ch.w > W) { rows.push({ items: cur, w: run }); cur = []; run = 0; }
        run += (cur.length ? GAP : 0) + ch.w;
        cur.push(ch);
      });
      if (cur.length) rows.push({ items: cur, w: run });

      rails.forEach(function(r){ r.remove(); });
      rails = [];
      var maxRope = 0;
      rows.forEach(function(row, r){
        var railY = PAD + r * ROWH;
        var x = Math.max(0, (W - row.w) / 2);
        var rail = document.createElement('div');
        rail.className = 'pf-rail';
        rail.style.left = Math.max(0, x - 24) + 'px';
        rail.style.width = Math.min(W, row.w + 48) + 'px';
        rail.style.top = railY + 'px';
        stage.appendChild(rail); rails.push(rail);

        row.items.forEach(function(ch, k){
          /* Deterministic rope lengths — a fixed pattern rather than random, so
             a thumbnail and the live page draw the same curtain. */
          var rope = 34 + ((ch.i * 29 + k * 17) % 46);
          maxRope = Math.max(maxRope, rope);
          ch.ax = x + ch.w / 2;
          ch.ay = railY;
          ch.seg = rope / (SEGS - 1);
          ch.pts = [];
          for (var s = 0; s < SEGS; s++) {
            /* Start at rest, hanging straight down. A still frame — a
               thumbnail, a print, the first paint — then looks correct with
               no settling animation to wait through. */
            ch.pts.push({ x: ch.ax, y: railY + s * ch.seg, px: ch.ax, py: railY + s * ch.seg });
          }
          x += ch.w + GAP;
        });
      });

      var h = PAD + Math.max(0, rows.length - 1) * ROWH + maxRope + 52;
      stage.style.height = h + 'px';
      svg.setAttribute('viewBox', '0 0 ' + W + ' ' + h);
      draw();
    }

    function step(){
      /* Equilibrium lean of a pendulum is atan(wind/gravity), so with GRAV at
         0.55 an amplitude of 0.044 is about four degrees of sway — enough to
         look alive, small enough that the labels stay level and readable. */
      var wind = Math.sin(t * 0.013) * 0.030 + Math.sin(t * 0.031) * 0.014;
      for (var i = 0; i < chips.length; i++) {
        var ch = chips[i], pts = ch.pts, last = SEGS - 1;
        for (var k = 1; k < SEGS; k++) {
          if (held && held.ch === ch && k === last) continue;   // the hand owns it
          var p = pts[k];
          var vx = (p.x - p.px) * DAMP, vy = (p.y - p.py) * DAMP;
          p.px = p.x; p.py = p.y;
          p.x += vx + wind * (k / (SEGS - 1));
          p.y += vy + GRAV + lag;
        }
        for (var it = 0; it < ITER; it++) {
          for (var s = 0; s < last; s++) {
            var a = pts[s], b = pts[s + 1];
            var dx = b.x - a.x, dy = b.y - a.y;
            var dist = Math.sqrt(dx * dx + dy * dy) || 0.0001;
            var corr = (dist - ch.seg) / dist;
            /* Pinned points take no correction; the other end takes all of it.
               Weighting by "is this end free" is what makes one solver handle
               the anchor, the free middle, and a grabbed tail identically. */
            var fa = s === 0 ? 0 : 1;
            var fb = (held && held.ch === ch && s + 1 === last) ? 0 : 1;
            var tot = fa + fb;
            if (!tot) continue;
            var cx = dx * corr, cy = dy * corr;
            a.x += cx * (fa / tot); a.y += cy * (fa / tot);
            b.x -= cx * (fb / tot); b.y -= cy * (fb / tot);
          }
        }
        for (var m = 1; m < SEGS; m++) {
          var q = pts[m];
          if (held && held.ch === ch && m === last) continue;  /* the hand may lift it anywhere */
          if (q.x < 6) { q.x = 6; } else if (q.x > W - 6) { q.x = W - 6; }
          /* A rope may not swing above its own pin. The constraint solver only
             fixes distance, not direction, so a hard enough impulse used to
             throw a chip clean over the rail — physically defensible, visually
             broken. Below the anchor is the only valid half-plane. */
          if (q.y < ch.ay + 2) q.y = ch.ay + 2;
        }
      }
    }

    function draw(){
      for (var i = 0; i < chips.length; i++) {
        var ch = chips[i], pts = ch.pts;
        if (!pts.length) continue;
        var dstr = 'M' + pts[0].x.toFixed(1) + ' ' + pts[0].y.toFixed(1);
        for (var k = 1; k < SEGS; k++) dstr += 'L' + pts[k].x.toFixed(1) + ' ' + pts[k].y.toFixed(1);
        ch.path.setAttribute('d', dstr);
        ch.dot.setAttribute('cx', pts[0].x.toFixed(1));
        ch.dot.setAttribute('cy', pts[0].y.toFixed(1));
        var tip = pts[SEGS - 1], up = pts[SEGS - 2];
        /* The chip is a rigid extension of the last segment: rotating its local
           "down" onto the rope direction gives -atan2(dx,dy), not +. */
        var ang = -Math.atan2(tip.x - up.x, tip.y - up.y) * 180 / Math.PI;
        ch.el.style.transform = 'translate(' + (tip.x - ch.w / 2).toFixed(1) + 'px,' + tip.y.toFixed(1) + 'px) rotate(' + ang.toFixed(2) + 'deg)';
      }
    }

    function energy(){
      var e = 0;
      for (var i = 0; i < chips.length; i++) {
        var p = chips[i].pts[SEGS - 1];
        if (!p) continue;
        e += Math.abs(p.x - p.px) + Math.abs(p.y - p.py);
      }
      return e;
    }

    function tick(){
      t++;
      step(); draw();
      lag *= 0.86;
      /* Sleep once it has settled. A curtain at rest should not cost a frame
         of work forever; any interaction wakes it again. */
      idle = (energy() < 0.12 && !held && Math.abs(lag) < 0.05) ? idle + 1 : 0;
      if (idle > 45) { running = false; raf = 0; return; }
      raf = requestAnimationFrame(tick);
    }
    function wake(){ idle = 0; if (!running) { running = true; raf = requestAnimationFrame(tick); } }

    /* ---- drag ---- */
    function local(e){
      var r = stage.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    }
    chips.forEach(function(ch){
      ch.el.addEventListener('pointerdown', function(e){
        e.preventDefault();
        held = { ch: ch, id: e.pointerId };
        ch.el.classList.add('pf-held');
        try { stage.setPointerCapture(e.pointerId); } catch (err) {}
        wake();
      });
    });
    stage.addEventListener('pointermove', function(e){
      if (!held || e.pointerId !== held.id) return;
      var p = local(e), tip = held.ch.pts[SEGS - 1];
      /* px/py are deliberately left behind: the implied velocity they encode is
         exactly the throw the user just made. */
      tip.x = p.x; tip.y = p.y;
      var mx = tip.x - tip.px, my = tip.y - tip.py, sp = Math.sqrt(mx * mx + my * my);
      if (sp > 26) { tip.px = tip.x - mx / sp * 26; tip.py = tip.y - my / sp * 26; }
      wake();
    });
    function drop(e){
      if (!held || (e && e.pointerId !== held.id)) return;
      held.ch.el.classList.remove('pf-held');
      held = null; wake();
    }
    stage.addEventListener('pointerup', drop);
    stage.addEventListener('pointercancel', drop);

    window.addEventListener('scroll', function(){
      var y = window.pageYOffset || 0, dv = y - lastScroll;
      lastScroll = y;
      /* Scroll inertia, deliberately small: gravity is 0.55 px/frame^2, so
         even the cap here is under three times body weight and a flung
         scroll nudges the curtain instead of launching it. */
      lag = Math.max(-1.5, Math.min(1.5, -dv * 0.05));
      wake();
    }, { passive: true });

    var rt = 0;
    window.addEventListener('resize', function(){
      clearTimeout(rt); rt = setTimeout(function(){ layout(); wake(); }, 140);
    });
    document.addEventListener('visibilitychange', function(){
      if (document.hidden) { if (raf) cancelAnimationFrame(raf); raf = 0; running = false; }
      else wake();
    });
    /* Only simulate while it is on screen. */
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function(es){
        if (es[0].isIntersecting) wake();
        else if (raf) { cancelAnimationFrame(raf); raf = 0; running = false; }
      }, { rootMargin: '120px' }).observe(stage);
    } else { wake(); }

    layout();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(layout);
  })();

  /* ---------------- nav ---------------- */
  var nav = document.querySelector('.pf-nav');
  var links = Array.prototype.slice.call(document.querySelectorAll('.pf-nav-links a'));
  var top = document.getElementById('top');
  if (nav && top) {
    new IntersectionObserver(function(es){
      nav.classList.toggle('pf-stuck', !es[0].isIntersecting);
    }, { rootMargin: '-60px 0px 0px 0px' }).observe(top);
  }
  var targets = links.map(function(a){ return document.querySelector(a.getAttribute('href')); }).filter(Boolean);
  if (targets.length) {
    var seen = {};
    var spy = new IntersectionObserver(function(entries){
      entries.forEach(function(en){ seen[en.target.id] = en.intersectionRatio; });
      var best = '', bestR = 0;
      Object.keys(seen).forEach(function(id){ if (seen[id] > bestR) { bestR = seen[id]; best = id; } });
      links.forEach(function(a){ a.classList.toggle('pf-active', a.getAttribute('href') === '#' + best && bestR > 0); });
    }, { threshold: [0, .18, .5, .85], rootMargin: '-25% 0px -45% 0px' });
    targets.forEach(function(x){ spy.observe(x); });
  }
})();`;

  return { fonts: [c.googleFont ? null : "Inter:wght@400;600;700;800"].filter(Boolean),
           css, body, js, themeColor: "#FAFDF2" };
};

// ---------------------------------------------------------------------------
// Morph — the View Transitions API, used for what it is actually good at
// ---------------------------------------------------------------------------
// Two transitions, both impossible to fake cheaply:
//
//   1. Filtering the project grid. Every card carries a stable
//      view-transition-name, so wrapping the filter in startViewTransition()
//      makes the browser tween every surviving card from its old box to its new
//      one — a full FLIP reflow for one line of code, and it is the browser
//      doing the measuring, not a rAF loop guessing at layout.
//
//   2. Opening a project. The card is given a shared name, the detail panel
//      takes the same name on the other side of the swap, and the two are
//      matched into one morph: the card grows into the panel and the panel
//      shrinks back into the card on close.
//
// Everything degrades honestly. Without startViewTransition the same DOM swap
// runs unwrapped and a CSS transition covers it; the site loses the morph and
// keeps every feature.
PF_RENDERERS.morph = (c) => {
  const d = c.d;
  const a2 = pfHueShift(c.accent, 36);
  const a3 = pfHueShift(c.accent, -46);
  const nav = c.navItems.map(n => `<a href="#${n.id}">${pfEsc(n.label)}</a>`).join("");

  // The filter rail is built from whatever tags the projects actually carry —
  // no tags, no rail, and the grid behaves like every other template.
  const tags = [];
  d.projects.forEach(p => (p.tags || []).forEach(t => {
    const s = String(t).trim();
    if (s && tags.indexOf(s) === -1) tags.push(s);
  }));
  const showFilter = tags.length > 1 && d.projects.length > 2;

  const css = `
:root{
  --acc:${c.accent}; --a2:${a2}; --a3:${a3};
  --ink:#3B0A21; --muted:#7C3F58; --faint:#B98BA0;
  --bg:#FFF5F9; --card:#FFFFFF; --line:#FADCE8; --sink:#FDEBF2;
  --font:${c.fontStack || `'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif`};
}
body{background:var(--bg);color:var(--ink);font-family:var(--font);font-size:16px;line-height:1.7;overflow-x:hidden}
.pf-skip{background:var(--acc);color:#fff}
.pf-shell{width:min(1100px,92vw);margin:0 auto}
.pf-blobs{position:fixed;inset:0;z-index:0;pointer-events:none;filter:blur(46px);opacity:.5}
.pf-blobs i{position:absolute;display:block;border-radius:44% 56% 62% 38%/48% 42% 58% 52%;
  animation:pf-drift 26s ease-in-out infinite}
.pf-blobs i:nth-child(1){width:46vw;height:38vw;left:-8vw;top:-8vw;background:${pfRgba(c.accent, .5)}}
.pf-blobs i:nth-child(2){width:40vw;height:36vw;right:-10vw;top:24vh;background:${pfRgba(a3, .42)};animation-duration:34s;animation-direction:reverse}
.pf-blobs i:nth-child(3){width:36vw;height:34vw;left:22vw;bottom:-12vw;background:${pfRgba(a2, .34)};animation-duration:30s}
@keyframes pf-drift{
  33%{border-radius:60% 40% 38% 62%/42% 60% 40% 58%;transform:translate(4%,-3%) rotate(9deg) scale(1.06)}
  66%{border-radius:38% 62% 56% 44%/60% 38% 62% 40%;transform:translate(-3%,4%) rotate(-7deg) scale(.96)}}
main{position:relative;z-index:3}

.pf-nav{position:sticky;top:0;z-index:30;padding:.65rem 0}
/* Same reason as Halo: the pill floats, the strip beside it must not. */
.pf-nav::before{content:"";position:absolute;inset:-1px 0 -20px;z-index:-1;pointer-events:none;
  background:linear-gradient(180deg,var(--bg) 52%,${pfRgba("#FFF5F9", 0)})}
.pf-nav-in{display:flex;align-items:center;gap:1rem;padding:.55rem .6rem .55rem 1rem;border-radius:22px;
  background:${pfRgba("#FFFFFF", .8)};backdrop-filter:blur(16px) saturate(1.6);-webkit-backdrop-filter:blur(16px) saturate(1.6);
  border:1px solid ${pfRgba(c.accent, .14)};box-shadow:0 8px 28px ${pfRgba("#3B0A21", .07)};transition:.3s}
.pf-nav.pf-stuck .pf-nav-in{box-shadow:0 14px 38px ${pfRgba("#3B0A21", .13)};border-color:${pfRgba(c.accent, .28)}}
.pf-brand{display:flex;align-items:center;gap:.6rem;font-weight:800;letter-spacing:-.025em;text-decoration:none;font-size:1rem}
.pf-brand i{width:32px;height:32px;display:grid;place-items:center;font-size:.66rem;font-weight:800;font-style:normal;
  color:#fff;background:linear-gradient(140deg,var(--acc),var(--a3));
  border-radius:52% 48% 42% 58%/46% 54% 46% 54%;animation:pf-drift 12s ease-in-out infinite}
.pf-nav-links{display:flex;gap:.15rem;margin-left:auto;flex-wrap:wrap}
.pf-nav-links a{padding:.42rem .9rem;border-radius:12px;font-size:.85rem;font-weight:600;color:var(--muted);
  text-decoration:none;transition:.22s}
.pf-nav-links a:hover,.pf-nav-links a.pf-active{color:#fff;background:var(--acc)}

.pf-hero{padding:clamp(2.4rem,7vw,4.2rem) 0 clamp(1.4rem,3.4vw,2.2rem)}
.pf-hero-in{display:grid;grid-template-columns:minmax(0,1.3fr) minmax(0,.7fr);gap:clamp(1.4rem,4vw,3rem);align-items:center}
@media (max-width:860px){.pf-hero-in{grid-template-columns:1fr}}
.pf-badge{display:inline-flex;align-items:center;gap:.55rem;padding:.34rem 1rem .34rem .6rem;border-radius:999px;
  background:#fff;border:1px solid ${pfRgba(c.accent, .24)};color:var(--acc);font-size:.79rem;font-weight:700;margin-bottom:1.1rem}
.pf-badge i{width:9px;height:9px;border-radius:50%;background:var(--acc);animation:pf-blip 2s ease-in-out infinite}
@keyframes pf-blip{50%{transform:scale(1.4);opacity:.55}}
.pf-hero h1{font-size:clamp(2.2rem,6.6vw,4.2rem);font-weight:800;letter-spacing:-.048em;line-height:1.02;
  background:linear-gradient(104deg,var(--ink) 8%,var(--acc) 54%,var(--a3) 92%);
  -webkit-background-clip:text;background-clip:text;color:transparent}
.pf-hero h2{font-size:clamp(1rem,2.3vw,1.22rem);font-weight:600;color:var(--muted);margin:.85rem 0 .7rem}
.pf-hero p{color:var(--muted);max-width:54ch}
.pf-portrait{justify-self:center;position:relative;width:clamp(180px,27vw,250px);aspect-ratio:1}
.pf-portrait .pf-avatar{width:100%;height:100%;object-fit:cover;
  border-radius:46% 54% 58% 42%/48% 44% 56% 52%;animation:pf-drift 18s ease-in-out infinite;
  box-shadow:0 22px 60px ${pfRgba(c.accent, .3)}}
.pf-avatar-initials{display:grid;place-items:center;font-weight:800;color:#fff;font-size:clamp(1.8rem,5vw,2.5rem);
  background:linear-gradient(150deg,var(--acc),var(--a3))}

.pf-actions{display:flex;flex-wrap:wrap;gap:.65rem;align-items:center;margin-top:1.6rem}
.pf-btn{display:inline-flex;align-items:center;gap:.5rem;padding:.78rem 1.5rem;border-radius:999px;font-weight:700;
  font-size:.9rem;text-decoration:none;border:1px solid transparent;transition:.24s;cursor:pointer}
.pf-btn svg{width:16px;height:16px}
.pf-btn-primary{background:linear-gradient(120deg,var(--acc),var(--a3));color:#fff;
  box-shadow:0 10px 28px ${pfRgba(c.accent, .34)}}
.pf-btn-primary:hover{transform:translateY(-3px);box-shadow:0 18px 40px ${pfRgba(c.accent, .44)}}
.pf-btn-ghost{background:#fff;border-color:var(--line);color:var(--ink)}
.pf-btn-ghost:hover{border-color:var(--acc);color:var(--acc);transform:translateY(-3px)}
.pf-socials{display:flex;gap:.45rem}
.pf-socials a{display:grid;place-items:center;width:40px;height:40px;border-radius:14px;background:#fff;
  border:1px solid var(--line);color:var(--muted);transition:.24s}
.pf-socials a svg{width:16px;height:16px}
.pf-socials a:hover{color:#fff;background:var(--acc);border-color:var(--acc);transform:translateY(-3px) rotate(-6deg)}

.pf-sec{padding:clamp(2.2rem,5.5vw,3.4rem) 0}
.pf-kicker{display:inline-flex;align-items:center;gap:.5rem;font-size:.73rem;font-weight:800;letter-spacing:.19em;
  text-transform:uppercase;color:var(--acc);margin-bottom:.5rem}
.pf-kicker::before{content:"";width:20px;height:8px;border-radius:60% 40% 45% 55%;background:var(--acc)}
.pf-h2{font-size:clamp(1.5rem,3.6vw,2.2rem);font-weight:800;letter-spacing:-.035em;margin-bottom:1.4rem}
.pf-card{background:var(--card);border:1px solid var(--line);border-radius:26px}

.pf-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:.9rem}
.pf-stat{padding:1.35rem 1.1rem;text-align:center;transition:.3s}
.pf-stat:hover{transform:translateY(-4px);border-color:${pfRgba(c.accent, .45)}}
.pf-stat b{display:block;font-size:clamp(1.7rem,4.4vw,2.4rem);font-weight:800;letter-spacing:-.04em;line-height:1;
  background:linear-gradient(140deg,var(--acc),var(--a3));-webkit-background-clip:text;background-clip:text;color:transparent}
.pf-stat span{display:block;margin-top:.4rem;font-size:.8rem;font-weight:600;color:var(--muted)}
.pf-about{padding:clamp(1.4rem,3.4vw,2.1rem);white-space:pre-wrap;color:var(--muted);font-size:1.02rem}

.pf-chips{display:flex;flex-wrap:wrap;gap:.5rem}
.pf-chip{padding:.5rem 1.05rem;border-radius:999px;font-size:.86rem;font-weight:700;background:#fff;
  border:1.5px solid var(--line);transition:.24s}
.pf-chip:hover{border-color:var(--acc);color:var(--acc);transform:translateY(-3px) rotate(-2deg)}

/* ---- filter rail ---- */
.pf-filters{display:flex;flex-wrap:wrap;gap:.45rem;margin-bottom:1.2rem}
.pf-filters button{padding:.42rem 1rem;border-radius:999px;font-size:.82rem;font-weight:700;cursor:pointer;
  background:#fff;border:1.5px solid var(--line);color:var(--muted);transition:.22s}
.pf-filters button:hover{border-color:var(--acc);color:var(--acc)}
.pf-filters button[aria-pressed="true"]{background:var(--acc);border-color:var(--acc);color:#fff}

.pf-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(290px,1fr));gap:1.1rem}
.pf-proj{padding:1.5rem 1.4rem;display:flex;flex-direction:column;gap:.55rem;text-align:left;width:100%;
  cursor:pointer;transition:transform .3s,box-shadow .3s,border-color .3s}
.pf-proj:hover{transform:translateY(-5px);border-color:${pfRgba(c.accent, .5)};
  box-shadow:0 22px 48px ${pfRgba("#3B0A21", .13)}}
.pf-proj[hidden]{display:none}
.pf-thumb{height:96px;border-radius:20px;margin-bottom:.35rem;
  background:linear-gradient(135deg,${pfRgba(c.accent, .9)},${pfRgba(a3, .85)});position:relative;overflow:hidden}
.pf-thumb::after{content:attr(data-n);position:absolute;right:.85rem;bottom:.35rem;font-size:2.4rem;font-weight:800;
  color:${pfRgba("#FFFFFF", .34)};line-height:1}
.pf-thumb i{position:absolute;display:block;border-radius:50%;background:${pfRgba("#FFFFFF", .22)}}
.pf-thumb i:nth-child(1){width:74px;height:74px;left:-16px;top:-22px}
.pf-thumb i:nth-child(2){width:46px;height:46px;left:44px;bottom:-18px;background:${pfRgba("#FFFFFF", .16)}}
.pf-proj h3{font-size:1.13rem;font-weight:800;letter-spacing:-.02em}
.pf-role{font-size:.79rem;font-weight:700;color:var(--acc)}
.pf-proj p{color:var(--muted);font-size:.93rem}
.pf-tags{display:flex;flex-wrap:wrap;gap:.35rem;margin-top:auto;padding-top:.4rem}
.pf-tag{padding:.24rem .68rem;border-radius:999px;font-size:.72rem;font-weight:700;color:var(--acc);
  background:${pfRgba(c.accent, .11)}}
.pf-more{display:inline-flex;align-items:center;gap:.35rem;font-size:.8rem;font-weight:800;color:var(--acc);
  padding-top:.2rem}
.pf-more svg{width:14px;height:14px;transition:transform .24s}
.pf-proj:hover .pf-more svg{transform:translateX(4px)}

/* ---- detail panel ---- */
.pf-sheet{position:fixed;inset:0;z-index:60;display:none;padding:clamp(.8rem,4vw,2.4rem);overflow:auto;
  background:${pfRgba("#3B0A21", .34)};backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px)}
.pf-sheet.pf-open{display:block}
.pf-panel{background:var(--card);border:1px solid var(--line);border-radius:28px;
  width:min(680px,100%);margin:auto;padding:clamp(1.4rem,4vw,2.4rem);
  box-shadow:0 40px 90px ${pfRgba("#3B0A21", .3)};position:relative}
.pf-panel h3{font-size:clamp(1.35rem,3.4vw,1.9rem);font-weight:800;letter-spacing:-.035em;margin:.6rem 0 .1rem}
.pf-panel p{color:var(--muted);margin:.7rem 0}
.pf-panel ul{display:grid;gap:.45rem;margin:.7rem 0}
.pf-panel li{position:relative;padding-left:1.4rem;color:var(--muted);font-size:.94rem}
.pf-panel li::before{content:"";position:absolute;left:.1rem;top:.55em;width:9px;height:9px;
  border-radius:60% 40% 45% 55%;background:linear-gradient(140deg,var(--acc),var(--a3))}
.pf-panel .pf-thumb{height:132px}
.pf-x{position:absolute;right:1rem;top:1rem;width:38px;height:38px;border-radius:50%;cursor:pointer;
  background:var(--sink);border:none;color:var(--muted);display:grid;place-items:center;font-size:1.2rem;
  line-height:1;transition:.22s}
.pf-x:hover{background:var(--acc);color:#fff;transform:rotate(90deg)}
.pf-links{display:flex;gap:.7rem;flex-wrap:wrap;margin-top:1.1rem}
.pf-links a{display:inline-flex;align-items:center;gap:.4rem;font-size:.83rem;font-weight:700;color:#fff;
  background:var(--acc);padding:.5rem 1rem;border-radius:999px;text-decoration:none;transition:.22s}
.pf-links a:hover{transform:translateY(-2px);box-shadow:0 10px 22px ${pfRgba(c.accent, .35)}}
.pf-links a svg{width:14px;height:14px}

.pf-rows{display:grid;gap:.9rem}
.pf-row{padding:1.4rem;transition:.3s}
.pf-row:hover{border-color:${pfRgba(c.accent, .45)};transform:translateX(4px)}
.pf-row-top{display:flex;flex-wrap:wrap;align-items:baseline;gap:.6rem;justify-content:space-between}
.pf-row h3{font-size:1.05rem;font-weight:800;letter-spacing:-.02em}
.pf-when{font-size:.75rem;font-weight:700;color:var(--acc);background:${pfRgba(c.accent, .11)};
  padding:.2rem .65rem;border-radius:999px;white-space:nowrap}
.pf-org{font-size:.85rem;font-weight:600;color:var(--faint);margin:.15rem 0 .5rem}
.pf-row p{color:var(--muted);font-size:.94rem;margin-bottom:.5rem}
.pf-row ul{display:grid;gap:.4rem}
.pf-row li{position:relative;padding-left:1.3rem;color:var(--muted);font-size:.9rem}
.pf-row li::before{content:"";position:absolute;left:.15rem;top:.58em;width:8px;height:8px;
  border-radius:60% 40% 45% 55%;background:linear-gradient(140deg,var(--acc),var(--a3))}

.pf-contact{padding:clamp(1.8rem,4.6vw,2.8rem);text-align:center}
.pf-contact h2{font-size:clamp(1.5rem,3.8vw,2.2rem);font-weight:800;letter-spacing:-.035em}
.pf-contact p{color:var(--muted);max-width:46ch;margin:.6rem auto 0}
.pf-clist{display:flex;flex-wrap:wrap;gap:.5rem;justify-content:center;margin-top:1.5rem}
.pf-clist a,.pf-clist span{display:inline-flex;align-items:center;gap:.45rem;padding:.44rem .95rem;border-radius:999px;
  font-size:.83rem;font-weight:600;background:var(--sink);color:var(--muted);text-decoration:none;transition:.22s}
.pf-clist a:hover{background:var(--acc);color:#fff}
.pf-clist svg{width:14px;height:14px}
footer{padding:2.4rem 0 3rem;text-align:center;font-size:.83rem;color:var(--faint);
  border-top:1px solid var(--line);margin-top:1.6rem}

/* ---- view transitions ----------------------------------------------------
   The grid cards each own a stable name so the filter reflow is matched
   card-for-card; the shared morph name is applied inline, only for the length
   of one transition, because two visible elements may never share a name. */
::view-transition-group(*){animation-duration:.42s}
::view-transition-old(root),::view-transition-new(root){animation-duration:.34s}
.pf-morphing{view-transition-name:pf-morph!important}
${d.projects.map((x, i) => `.pf-proj[data-i="${i}"]{view-transition-name:pf-c${i}}`).join("")}

@media (max-width:640px){.pf-nav-links{display:none}}
@media (prefers-reduced-motion:reduce){
  .pf-blobs i,.pf-portrait .pf-avatar,.pf-brand i,.pf-badge i{animation:none!important}
  .pf-proj:hover,.pf-row:hover,.pf-btn:hover,.pf-chip:hover,.pf-socials a:hover,.pf-stat:hover{transform:none!important}
  ::view-transition-group(*){animation-duration:.01ms!important}
}`;

  const projCard = (x, i) => `
    <article class="pf-card pf-proj" data-i="${i}" role="button" tabindex="0" aria-haspopup="dialog"
             data-tags="${pfEsc((x.tags || []).join("|"))}">
      <div class="pf-thumb" data-n="${String(i + 1).padStart(2, "0")}" aria-hidden="true"><i></i><i></i></div>
      <h3>${pfEsc(x.name || "")}</h3>
      ${pfJoin([x.role, x.period]) ? `<div class="pf-role">${pfJoin([x.role, x.period])}</div>` : ""}
      ${x.description ? `<p>${pfEsc(x.description)}</p>` : ""}
      ${(x.tags || []).length ? `<div class="pf-tags">${x.tags.map(t => `<span class="pf-tag">${pfEsc(t)}</span>`).join("")}</div>` : ""}
      <span class="pf-more">Open${PF_ICONS.arrow}</span>
    </article>`;

  // Detail bodies live in <template> elements: not rendered, not in the
  // accessibility tree, and cloned into the panel on open — so the same markup
  // never exists twice on screen and there is no HTML built from strings at
  // runtime.
  const detail = (x, i) => `
    <template data-detail="${i}">
      <div class="pf-thumb" data-n="${String(i + 1).padStart(2, "0")}" aria-hidden="true"><i></i><i></i></div>
      ${pfJoin([x.role, x.period]) ? `<div class="pf-role" style="margin-top:.9rem">${pfJoin([x.role, x.period])}</div>` : ""}
      <h3 data-panel-title>${pfEsc(x.name || "")}</h3>
      ${x.description ? `<p>${pfEsc(x.description)}</p>` : ""}
      ${(x.bullets || []).length ? `<ul>${x.bullets.map(b => `<li>${pfEsc(b)}</li>`).join("")}</ul>` : ""}
      ${(x.tags || []).length ? `<div class="pf-tags">${x.tags.map(t => `<span class="pf-tag">${pfEsc(t)}</span>`).join("")}</div>` : ""}
      ${pfProjectLinks(x) ? `<div class="pf-links">${pfProjectLinks(x)}</div>` : ""}
    </template>`;

  const body = `
<div class="pf-blobs" aria-hidden="true"><i></i><i></i><i></i></div>
<nav class="pf-nav pf-noprint"><div class="pf-shell"><div class="pf-nav-in">
  <a class="pf-brand" href="#top"><i>${pfEsc(c.initials)}</i>${pfEsc(c.name)}</a>
  ${nav ? `<div class="pf-nav-links">${nav}</div>` : ""}
</div></div></nav>

<main id="main"><div class="pf-shell">
  <section class="pf-hero" id="top"><div class="pf-hero-in">
    <div>
      ${d.available ? `<div class="pf-badge"><i></i>${pfEsc(d.available)}</div>` : ""}
      <h1>${pfEsc(c.name)}</h1>
      ${c.title ? `<h2>${pfEsc(c.title)}</h2>` : ""}
      ${c.tagline ? `<p>${pfEsc(c.tagline)}</p>` : ""}
      <div class="pf-actions">
        ${d.email ? `<a class="pf-btn pf-btn-primary" href="mailto:${pfEsc(d.email)}">${PF_ICONS.mail}${pfEsc(d.cta_text || "Get in touch")}</a>` : ""}
        ${c.hasResume ? `<a class="pf-btn pf-btn-ghost" ${pfResumeAttrs(c)}>${PF_ICONS.download}${pfEsc(c.resumeLabel)}</a>` : ""}
        ${pfSocialRow(c)}
      </div>
    </div>
    <div class="pf-portrait">${pfAvatar(c)}</div>
  </div></section>

  ${c.has("stats") ? `<section class="pf-sec"><div class="pf-stats">
    ${d.stats.map((x, i) => `<div class="pf-card pf-stat" data-reveal data-reveal-delay="${i * 70}">
      <b>${pfEsc(x.value)}</b><span>${pfEsc(x.label)}</span></div>`).join("")}</div></section>` : ""}

  ${c.has("about") ? `<section class="pf-sec" id="about"><div class="pf-kicker">About</div>
    <h2 class="pf-h2">The short version</h2>
    <div class="pf-card pf-about" data-reveal>${pfEsc(d.about)}</div></section>` : ""}

  ${c.has("skills") ? `<section class="pf-sec" id="skills"><div class="pf-kicker">Toolkit</div>
    <h2 class="pf-h2">What I work with</h2>
    <div class="pf-chips" data-reveal>${d.skills.map(x => `<span class="pf-chip">${pfEsc(x)}</span>`).join("")}</div></section>` : ""}

  ${c.has("projects") ? `<section class="pf-sec" id="projects"><div class="pf-kicker">Work</div>
    <h2 class="pf-h2">Selected projects</h2>
    ${showFilter ? `<div class="pf-filters" data-filters role="group" aria-label="Filter projects by tag">
      <button type="button" data-tag="" aria-pressed="true">All</button>
      ${tags.map(t => `<button type="button" data-tag="${pfEsc(t)}" aria-pressed="false">${pfEsc(t)}</button>`).join("")}
    </div>` : ""}
    <div class="pf-grid" data-grid>${d.projects.map(projCard).join("")}</div>
    ${d.projects.map(detail).join("")}
  </section>` : ""}

  ${c.has("experience") ? `<section class="pf-sec" id="experience"><div class="pf-kicker">Experience</div>
    <h2 class="pf-h2">Where I have worked</h2>
    <div class="pf-rows">${d.experience.map((x, i) => `
      <article class="pf-card pf-row" data-reveal data-reveal-delay="${Math.min(i, 5) * 70}">
        <div class="pf-row-top"><h3>${pfEsc(x.role || "")}</h3>
          ${x.period ? `<span class="pf-when">${pfEsc(x.period)}</span>` : ""}</div>
        ${x.org ? `<div class="pf-org">${pfJoin([x.org, x.location])}</div>` : ""}
        ${x.summary ? `<p>${pfEsc(x.summary)}</p>` : ""}
        ${(x.bullets || []).length ? `<ul>${x.bullets.map(b => `<li>${pfEsc(b)}</li>`).join("")}</ul>` : ""}
      </article>`).join("")}</div></section>` : ""}

  ${c.has("education") ? `<section class="pf-sec" id="education"><div class="pf-kicker">Education</div>
    <h2 class="pf-h2">Where I studied</h2>
    <div class="pf-rows">${d.education.map(x => `
      <article class="pf-card pf-row" data-reveal>
        <div class="pf-row-top"><h3>${pfEsc(x.degree || "")}</h3>
          ${x.period ? `<span class="pf-when">${pfEsc(x.period)}</span>` : ""}</div>
        ${x.school ? `<div class="pf-org">${pfEsc(x.school)}</div>` : ""}
        ${x.detail ? `<p>${pfEsc(x.detail)}</p>` : ""}
      </article>`).join("")}</div></section>` : ""}

  ${c.has("certifications") ? `<section class="pf-sec" id="certifications"><div class="pf-kicker">Credentials</div>
    <h2 class="pf-h2">Certifications</h2>
    <div class="pf-chips" data-reveal>${d.certifications.map(x => `<span class="pf-chip">${pfEsc(x)}</span>`).join("")}</div></section>` : ""}

  ${c.has("contact") ? `<section class="pf-sec" id="contact"><div class="pf-card pf-contact" data-reveal>
    <h2>Let's shape something</h2>
    <p>${pfEsc(d.cta_text || "Tell me what you are building and where it is stuck.")}</p>
    <div class="pf-actions" style="justify-content:center;margin-top:1.4rem">
      ${d.email ? `<a class="pf-btn pf-btn-primary" href="mailto:${pfEsc(d.email)}">${PF_ICONS.mail}${pfEsc(d.email)}</a>` : ""}
      ${c.hasResume ? `<a class="pf-btn pf-btn-ghost" ${pfResumeAttrs(c)}>${PF_ICONS.download}Résumé</a>` : ""}
    </div>
    <div class="pf-clist">${c.links.map(x => x.url
      ? `<a href="${pfEsc(x.url)}"${/^https?:/i.test(x.url) ? ` target="_blank" rel="noopener"` : ""}>${x.icon}${pfEsc(x.handle)}</a>`
      : `<span>${x.icon}${pfEsc(x.handle)}</span>`).join("")}</div>
  </div></section>` : ""}

  <footer>© <span data-year>${c.year}</span> ${pfEsc(c.name)}${d.footer_note ? " · " + pfEsc(d.footer_note) : ""}</footer>
</div></main>

<div class="pf-sheet" data-sheet aria-hidden="true">
  <div class="pf-panel" role="dialog" aria-modal="true" aria-label="Project detail" data-panel>
    <button class="pf-x" type="button" data-close aria-label="Close">&times;</button>
    <div data-panel-body></div>
  </div>
</div>`;

  const js = `
(function(){
  var grid = document.querySelector('[data-grid]');
  var sheet = document.querySelector('[data-sheet]');
  var panel = sheet && sheet.querySelector('[data-panel]');
  var pbody = sheet && sheet.querySelector('[data-panel-body]');
  var closeBtn = sheet && sheet.querySelector('[data-close]');
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* One wrapper for the whole file: run the DOM change inside a view
     transition when the browser has one, and plainly when it does not. Every
     caller below is written as if the morph always happens. */
  function swap(fn, after){
    if (reduce || !document.startViewTransition) {
      fn();
      if (after) after();
      return;
    }
    var vt = document.startViewTransition(fn);
    if (after) vt.finished.then(after, after);
  }

  /* ---------------- filter ---------------- */
  var filters = document.querySelector('[data-filters]');
  if (filters && grid) {
    filters.addEventListener('click', function(e){
      var btn = e.target.closest('button[data-tag]');
      if (!btn) return;
      var tag = btn.getAttribute('data-tag');
      Array.prototype.forEach.call(filters.querySelectorAll('button'), function(b){
        b.setAttribute('aria-pressed', b === btn ? 'true' : 'false');
      });
      /* The only thing this callback does is set [hidden] on some cards. The
         browser works out that the survivors moved and tweens them, because
         each card owns a view-transition-name that persists across the swap. */
      swap(function(){
        Array.prototype.forEach.call(grid.querySelectorAll('.pf-proj'), function(card){
          var list = (card.getAttribute('data-tags') || '').split('|');
          card.hidden = !!tag && list.indexOf(tag) === -1;
        });
      });
    });
  }

  /* ---------------- open / close ---------------- */
  if (grid && sheet && panel && pbody) {
    var opener = null;

    function fill(i){
      var tpl = document.querySelector('[data-detail="' + i + '"]');
      pbody.replaceChildren();
      if (tpl) pbody.appendChild(tpl.content.cloneNode(true));
      var h = pbody.querySelector('[data-panel-title]');
      panel.setAttribute('aria-label', h ? h.textContent : 'Project detail');
    }

    function open(card){
      var i = card.getAttribute('data-i');
      opener = card;
      fill(i);
      /* The card wears the shared name going in, the panel wears it coming
         out: old(pf-morph) is the card, new(pf-morph) is the panel, and the
         browser matches them into one growing box. */
      card.classList.add('pf-morphing');
      swap(function(){
        card.classList.remove('pf-morphing');
        panel.classList.add('pf-morphing');
        sheet.classList.add('pf-open');
        sheet.setAttribute('aria-hidden', 'false');
        document.body.style.overflow = 'hidden';
      }, function(){
        panel.classList.remove('pf-morphing');
        if (closeBtn) closeBtn.focus();
      });
    }

    function close(){
      if (!sheet.classList.contains('pf-open')) return;
      var card = opener;
      panel.classList.add('pf-morphing');
      swap(function(){
        panel.classList.remove('pf-morphing');
        if (card) card.classList.add('pf-morphing');
        sheet.classList.remove('pf-open');
        sheet.setAttribute('aria-hidden', 'true');
        document.body.style.overflow = '';
      }, function(){
        if (card) { card.classList.remove('pf-morphing'); card.focus(); }
        opener = null;
      });
    }

    grid.addEventListener('click', function(e){
      var card = e.target.closest('.pf-proj');
      /* A link inside a card keeps its own behaviour. */
      if (!card || e.target.closest('a')) return;
      open(card);
    });
    grid.addEventListener('keydown', function(e){
      if (e.key !== 'Enter' && e.key !== ' ') return;
      var card = e.target.closest('.pf-proj');
      if (!card || e.target !== card) return;
      e.preventDefault();
      open(card);
    });

    if (closeBtn) closeBtn.addEventListener('click', close);
    sheet.addEventListener('click', function(e){ if (e.target === sheet) close(); });
    document.addEventListener('keydown', function(e){
      if (e.key === 'Escape') { close(); return; }
      if (e.key !== 'Tab' || !sheet.classList.contains('pf-open')) return;
      /* Keep Tab inside the panel while it is modal. */
      var f = panel.querySelectorAll('a[href],button:not([disabled]),[tabindex]:not([tabindex="-1"])');
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
  }

  /* ---------------- nav ---------------- */
  var nav = document.querySelector('.pf-nav');
  var links = Array.prototype.slice.call(document.querySelectorAll('.pf-nav-links a'));
  var top = document.getElementById('top');
  if (nav && top) {
    new IntersectionObserver(function(es){
      nav.classList.toggle('pf-stuck', !es[0].isIntersecting);
    }, { rootMargin: '-60px 0px 0px 0px' }).observe(top);
  }
  var targets = links.map(function(a){ return document.querySelector(a.getAttribute('href')); }).filter(Boolean);
  if (targets.length) {
    var seen = {};
    var spy = new IntersectionObserver(function(entries){
      entries.forEach(function(en){ seen[en.target.id] = en.intersectionRatio; });
      var best = '', bestR = 0;
      Object.keys(seen).forEach(function(id){ if (seen[id] > bestR) { bestR = seen[id]; best = id; } });
      links.forEach(function(a){ a.classList.toggle('pf-active', a.getAttribute('href') === '#' + best && bestR > 0); });
    }, { threshold: [0, .18, .5, .85], rootMargin: '-25% 0px -45% 0px' });
    targets.forEach(function(x){ spy.observe(x); });
  }
})();`;

  return { fonts: [c.googleFont ? null : "Inter:wght@400;600;700;800"].filter(Boolean),
           css, body, js, themeColor: "#FFF5F9" };
};

// ---------------------------------------------------------------------------
// Aperture — a real iris, and focus racked by the scroll position
// ---------------------------------------------------------------------------
// Two mechanics, both of which had no cheap way to exist until recently:
//
//   1. The iris. Six blades on rotate+translate, over a portrait clipped by a
//      six-point polygon. clip-path interpolates point-for-point when both
//      polygons have the same vertex count, so the opening is one keyframe —
//      no canvas, no SVG animation, no per-frame JS.
//
//   2. The focus rack. Cards enter blurred and desaturated and resolve as they
//      reach the middle of the viewport. Where the browser has scroll-driven
//      animations this is animation-timeline:view() — the whole thing runs off
//      the main thread and tracks the scrubber exactly. Everywhere else an
//      IntersectionObserver toggles one class and a transition covers it.
PF_RENDERERS.aperture = (c) => {
  const d = c.d;
  const a2 = pfHueShift(c.accent, 30);
  const a3 = pfHueShift(c.accent, -40);
  const nav = c.navItems.map(n => `<a href="#${n.id}">${pfEsc(n.label)}</a>`).join("");
  const mono = `'JetBrains Mono','SFMono-Regular',Consolas,'Liberation Mono',monospace`;

  const css = `
:root{
  --acc:${c.accent}; --a2:${a2}; --a3:${a3};
  --ink:#2E1065; --muted:#6B4B8F; --faint:#A78BC4;
  --bg:#FAF5FF; --card:#FFFFFF; --line:#EADDF8; --sink:#F4EBFE;
  --font:${c.fontStack || `'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif`};
  --mono:${mono};
}
body{background:var(--bg);color:var(--ink);font-family:var(--font);font-size:16px;line-height:1.7;overflow-x:hidden}
.pf-skip{background:var(--acc);color:#fff}
.pf-shell{width:min(1120px,92vw);margin:0 auto}
.pf-vig{position:fixed;inset:0;z-index:0;pointer-events:none;
  background:radial-gradient(58% 44% at 50% 8%,${pfRgba(c.accent, .16)},transparent 68%),
             radial-gradient(42% 38% at 90% 70%,${pfRgba(a2, .13)},transparent 72%),
             radial-gradient(40% 36% at 6% 52%,${pfRgba(a3, .12)},transparent 74%)}
/* Film grain, as a repeating radial rather than an image — no request, and it
   sits under the content so text never sits on top of noise. */
.pf-grain{position:fixed;inset:0;z-index:1;pointer-events:none;opacity:.42;
  background-image:radial-gradient(${pfRgba(c.accent, .16)} .5px,transparent .5px);
  background-size:3px 3px}
main{position:relative;z-index:3}

/* Focus ring at the very top: the read-progress indicator, drawn as a lens
   scale rather than a plain bar. */
.pf-meter{position:fixed;left:0;top:0;height:3px;z-index:40;width:100%;transform-origin:0 50%;transform:scaleX(0);
  background:linear-gradient(90deg,var(--a3),var(--acc),var(--a2))}

.pf-nav{position:sticky;top:0;z-index:20;background:${pfRgba("#FAF5FF", .9)};
  backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);border-bottom:1px solid transparent;transition:.28s}
.pf-nav.pf-stuck{border-bottom-color:var(--line);box-shadow:0 6px 22px ${pfRgba("#2E1065", .07)}}
.pf-nav-in{display:flex;align-items:center;gap:1.1rem;padding:.8rem 0}
.pf-brand{display:flex;align-items:center;gap:.6rem;font-weight:800;letter-spacing:-.025em;text-decoration:none;font-size:1rem}
.pf-brand i{position:relative;width:30px;height:30px;display:grid;place-items:center;font-size:.62rem;font-weight:800;
  font-style:normal;color:#fff;border-radius:50%;background:conic-gradient(var(--acc),var(--a2),var(--a3),var(--acc))}
.pf-brand i::after{content:"";position:absolute;inset:4px;border-radius:50%;border:1.5px dashed ${pfRgba("#FFFFFF", .55)}}
.pf-nav-links{display:flex;gap:.15rem;margin-left:auto;flex-wrap:wrap}
.pf-nav-links a{padding:.42rem .85rem;border-radius:999px;font-size:.85rem;font-weight:600;color:var(--muted);
  text-decoration:none;transition:.22s}
.pf-nav-links a:hover,.pf-nav-links a.pf-active{color:#fff;background:var(--acc)}

/* ---- hero + iris ---- */
.pf-hero{padding:clamp(2.4rem,7vw,4.2rem) 0 clamp(1.4rem,3.4vw,2.2rem)}
.pf-hero-in{display:grid;grid-template-columns:minmax(0,1.28fr) minmax(0,.72fr);gap:clamp(1.4rem,4vw,3rem);align-items:center}
@media (max-width:880px){.pf-hero-in{grid-template-columns:1fr}.pf-lens{order:-1}}
.pf-badge{display:inline-flex;align-items:center;gap:.5rem;padding:.32rem .9rem;border-radius:999px;background:#fff;
  border:1px solid ${pfRgba(c.accent, .25)};color:var(--acc);font-size:.76rem;font-weight:700;margin-bottom:1.1rem;
  font-family:var(--mono);letter-spacing:.04em}
.pf-hero h1{font-size:clamp(2.2rem,6.6vw,4.2rem);font-weight:800;letter-spacing:-.048em;line-height:1.02;
  background:linear-gradient(102deg,var(--ink) 10%,var(--acc) 56%,var(--a2) 92%);
  -webkit-background-clip:text;background-clip:text;color:transparent}
.pf-hero h2{font-size:clamp(1rem,2.3vw,1.22rem);font-weight:600;color:var(--muted);margin:.85rem 0 .7rem}
.pf-hero p{color:var(--muted);max-width:54ch}

.pf-lens{position:relative;justify-self:center;width:clamp(200px,30vw,290px);aspect-ratio:1;isolation:isolate}
/* Barrel: two rings of tick marks, the outer one turning slowly. */
.pf-lens::before{content:"";position:absolute;inset:-14px;border-radius:50%;
  background:repeating-conic-gradient(${pfRgba(c.accent, .5)} 0deg 1.2deg,transparent 1.2deg 7.5deg);
  -webkit-mask:radial-gradient(farthest-side,transparent calc(100% - 9px),#000 calc(100% - 9px));
          mask:radial-gradient(farthest-side,transparent calc(100% - 9px),#000 calc(100% - 9px));
  animation:pf-barrel 44s linear infinite}
@keyframes pf-barrel{to{transform:rotate(360deg)}}
.pf-lens::after{content:"";position:absolute;inset:-2px;border-radius:50%;pointer-events:none;
  border:2px solid ${pfRgba(c.accent, .35)}}
.pf-iris{position:absolute;inset:0;border-radius:50%;overflow:hidden;background:var(--ink)}
.pf-iris .pf-avatar{width:100%;height:100%;object-fit:cover;
  /* Six points, closed to open — same vertex count, so it interpolates. */
  clip-path:polygon(50% 46%,54% 48%,54% 52%,50% 54%,46% 52%,46% 48%);
  animation:pf-open 1.5s cubic-bezier(.16,1,.3,1) .25s both}
@keyframes pf-open{to{clip-path:polygon(50% -12%,112% 26%,112% 74%,50% 112%,-12% 74%,-12% 26%)}}
.pf-avatar-initials{display:grid;place-items:center;font-weight:800;color:#fff;font-size:clamp(1.9rem,5.4vw,2.7rem);
  background:linear-gradient(150deg,var(--acc),var(--a3))}
/* Six blades, each rotated into place and swung out of frame as it opens.
   They live in their own wrapper so nth-child counts blades and nothing else —
   pfAvatar returns an <img> or a <div> depending on the data, which makes
   nth-of-type useless here. */
.pf-blades{position:absolute;inset:0;pointer-events:none}
.pf-blades i{position:absolute;inset:0;display:block;
  background:linear-gradient(150deg,${pfShade(c.accent, -0.55)},${pfShade(a3, -0.35)});
  clip-path:polygon(50% 50%,120% 6%,120% 120%,50% 120%);
  transform-origin:50% 50%;
  animation:pf-blade 1.5s cubic-bezier(.16,1,.3,1) .25s both}
.pf-blades i:nth-child(1){--a:0deg}.pf-blades i:nth-child(2){--a:60deg}.pf-blades i:nth-child(3){--a:120deg}
.pf-blades i:nth-child(4){--a:180deg}.pf-blades i:nth-child(5){--a:240deg}.pf-blades i:nth-child(6){--a:300deg}
@keyframes pf-blade{
  from{transform:rotate(var(--a)) translate(0,0);opacity:1}
  to{transform:rotate(calc(var(--a) + 34deg)) translate(64%,-64%);opacity:0}}
.pf-fstop{position:absolute;left:50%;bottom:-2.1rem;transform:translateX(-50%);font-family:var(--mono);
  font-size:.72rem;font-weight:700;letter-spacing:.12em;color:var(--faint);white-space:nowrap}

.pf-actions{display:flex;flex-wrap:wrap;gap:.65rem;align-items:center;margin-top:1.6rem}
.pf-btn{display:inline-flex;align-items:center;gap:.5rem;padding:.78rem 1.45rem;border-radius:10px;font-weight:700;
  font-size:.9rem;text-decoration:none;border:1px solid transparent;transition:.24s;cursor:pointer}
.pf-btn svg{width:16px;height:16px}
.pf-btn-primary{background:linear-gradient(120deg,var(--acc),var(--a3));color:#fff;
  box-shadow:0 10px 26px ${pfRgba(c.accent, .32)}}
.pf-btn-primary:hover{transform:translateY(-3px);box-shadow:0 16px 36px ${pfRgba(c.accent, .44)}}
.pf-btn-ghost{background:#fff;border-color:var(--line);color:var(--ink)}
.pf-btn-ghost:hover{border-color:var(--acc);color:var(--acc);transform:translateY(-3px)}
.pf-socials{display:flex;gap:.45rem}
.pf-socials a{display:grid;place-items:center;width:40px;height:40px;border-radius:50%;background:#fff;
  border:1px solid var(--line);color:var(--muted);transition:.24s}
.pf-socials a svg{width:16px;height:16px}
.pf-socials a:hover{color:#fff;background:var(--acc);border-color:var(--acc);transform:translateY(-3px)}

/* ---- sections ---- */
.pf-sec{padding:clamp(2.2rem,5.5vw,3.4rem) 0}
.pf-kicker{display:inline-flex;align-items:center;gap:.5rem;font-family:var(--mono);font-size:.72rem;font-weight:700;
  letter-spacing:.16em;text-transform:uppercase;color:var(--acc)}
.pf-kicker::before{content:"";width:9px;height:9px;border-radius:50%;border:2px solid var(--acc)}
.pf-h2{font-size:clamp(1.5rem,3.6vw,2.2rem);font-weight:800;letter-spacing:-.035em;margin:.45rem 0 1.4rem}
.pf-card{background:var(--card);border:1px solid var(--line);border-radius:16px}

.pf-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:.9rem}
.pf-stat{padding:1.35rem 1.1rem;text-align:center;position:relative}
.pf-stat::before{content:"";position:absolute;inset:6px;border-radius:11px;border:1px dashed ${pfRgba(c.accent, .22)};
  pointer-events:none}
.pf-stat b{display:block;font-family:var(--mono);font-size:clamp(1.6rem,4.2vw,2.2rem);font-weight:700;
  letter-spacing:-.03em;line-height:1;color:var(--acc)}
.pf-stat span{display:block;margin-top:.4rem;font-size:.78rem;font-weight:600;color:var(--muted)}
.pf-about{padding:clamp(1.4rem,3.4vw,2.1rem);white-space:pre-wrap;color:var(--muted);font-size:1.02rem}
.pf-chips{display:flex;flex-wrap:wrap;gap:.5rem}
.pf-chip{padding:.48rem 1rem;border-radius:8px;font-size:.85rem;font-weight:600;background:#fff;
  border:1px solid var(--line);font-family:var(--mono);transition:.22s}
.pf-chip:hover{border-color:var(--acc);color:var(--acc);transform:translateY(-3px)}

.pf-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:1.1rem}
.pf-proj{padding:1.5rem 1.4rem;display:flex;flex-direction:column;gap:.55rem;position:relative;
  transition:box-shadow .3s,border-color .3s}
.pf-proj:hover{border-color:${pfRgba(c.accent, .5)};box-shadow:0 20px 44px ${pfRgba("#2E1065", .13)}}
.pf-plate{height:8px;border-radius:99px;margin-bottom:.5rem;
  background:linear-gradient(90deg,var(--acc),var(--a2),var(--a3))}
.pf-proj h3{font-size:1.13rem;font-weight:800;letter-spacing:-.02em}
.pf-exif{font-family:var(--mono);font-size:.72rem;font-weight:700;letter-spacing:.06em;color:var(--acc)}
.pf-proj p{color:var(--muted);font-size:.93rem}
.pf-proj ul,.pf-row ul{display:grid;gap:.4rem}
.pf-proj li,.pf-row li{position:relative;padding-left:1.3rem;color:var(--muted);font-size:.9rem}
.pf-proj li::before,.pf-row li::before{content:"";position:absolute;left:.25rem;top:.6em;width:7px;height:7px;
  border-radius:50%;border:2px solid var(--acc)}
.pf-tags{display:flex;flex-wrap:wrap;gap:.35rem;margin-top:auto;padding-top:.4rem}
.pf-tag{padding:.22rem .62rem;border-radius:5px;font-size:.7rem;font-weight:700;font-family:var(--mono);
  color:var(--acc);background:${pfRgba(c.accent, .1)}}
.pf-links{display:flex;gap:.9rem;flex-wrap:wrap;padding-top:.25rem}
.pf-links a{display:inline-flex;align-items:center;gap:.35rem;font-size:.82rem;font-weight:700;color:var(--acc);
  text-decoration:none}
.pf-links a svg{width:14px;height:14px}
.pf-links a:hover{text-decoration:underline}

.pf-rows{display:grid;gap:.9rem}
.pf-row{padding:1.4rem;transition:.3s}
.pf-row:hover{border-color:${pfRgba(c.accent, .45)}}
.pf-row-top{display:flex;flex-wrap:wrap;align-items:baseline;gap:.6rem;justify-content:space-between}
.pf-row h3{font-size:1.05rem;font-weight:800;letter-spacing:-.02em}
.pf-when{font-family:var(--mono);font-size:.72rem;font-weight:700;color:var(--acc);
  background:${pfRgba(c.accent, .1)};padding:.2rem .6rem;border-radius:5px;white-space:nowrap}
.pf-org{font-size:.85rem;font-weight:600;color:var(--faint);margin:.15rem 0 .5rem}
.pf-row p{color:var(--muted);font-size:.94rem;margin-bottom:.5rem}

.pf-contact{padding:clamp(1.8rem,4.6vw,2.8rem);text-align:center;position:relative;overflow:hidden}
.pf-contact::before{content:"";position:absolute;left:50%;top:-46%;width:120%;aspect-ratio:1;transform:translateX(-50%);
  border-radius:50%;background:radial-gradient(closest-side,${pfRgba(c.accent, .13)},transparent);pointer-events:none}
.pf-contact h2{font-size:clamp(1.5rem,3.8vw,2.2rem);font-weight:800;letter-spacing:-.035em}
.pf-contact p{color:var(--muted);max-width:46ch;margin:.6rem auto 0}
.pf-clist{display:flex;flex-wrap:wrap;gap:.5rem;justify-content:center;margin-top:1.5rem}
.pf-clist a,.pf-clist span{display:inline-flex;align-items:center;gap:.45rem;padding:.44rem .95rem;border-radius:8px;
  font-size:.83rem;font-weight:600;background:var(--sink);color:var(--muted);text-decoration:none;transition:.22s}
.pf-clist a:hover{background:var(--acc);color:#fff}
.pf-clist svg{width:14px;height:14px}
footer{padding:2.4rem 0 3rem;text-align:center;font-family:var(--mono);font-size:.76rem;letter-spacing:.06em;
  color:var(--faint);border-top:1px solid var(--line);margin-top:1.6rem}

/* ---- the focus rack ------------------------------------------------------
   Default state is the JS path: [data-focus] starts soft and .pf-sharp clears
   it. Where the browser has scroll-driven animations the @supports block below
   takes over completely and scrubs it against the element's own view timeline,
   which is both smoother and free of the main thread. */
[data-focus]{filter:blur(7px) saturate(.4);opacity:.5;transform:scale(.972);
  transition:filter .75s cubic-bezier(.16,1,.3,1),opacity .75s,transform .75s cubic-bezier(.16,1,.3,1)}
[data-focus].pf-sharp{filter:blur(0) saturate(1);opacity:1;transform:none}

@supports (animation-timeline:view()){
  /* Sharp by the time the element has fully entered the viewport. Ending the
     range at 'cover 42%' looked better in isolation but left the top of the
     page blurred on first paint, which is a readability problem, not a
     flourish. */
  [data-focus]{animation:pf-rack linear both;animation-timeline:view();animation-range:entry 0% entry 96%;
    transition:none}
  [data-focus].pf-sharp{filter:none}
  @keyframes pf-rack{
    from{filter:blur(8px) saturate(.38);opacity:.46;transform:scale(.968)}
    to{filter:blur(0) saturate(1);opacity:1;transform:none}}
}

@media (max-width:640px){.pf-nav-links{display:none}}
@media (prefers-reduced-motion:reduce){
  .pf-lens::before,.pf-iris .pf-avatar,.pf-blades i{animation:none!important}
  .pf-iris .pf-avatar{clip-path:none!important}
  .pf-blades{display:none!important}
  [data-focus]{filter:none!important;opacity:1!important;transform:none!important;animation:none!important}
  .pf-btn:hover,.pf-chip:hover,.pf-socials a:hover{transform:none!important}
}`;

  const body = `
<div class="pf-vig" aria-hidden="true"></div>
<div class="pf-grain" aria-hidden="true"></div>
<div class="pf-meter" data-meter aria-hidden="true"></div>
<nav class="pf-nav pf-noprint"><div class="pf-shell pf-nav-in">
  <a class="pf-brand" href="#top"><i>${pfEsc(c.initials)}</i>${pfEsc(c.name)}</a>
  ${nav ? `<div class="pf-nav-links">${nav}</div>` : ""}
</div></nav>

<main id="main"><div class="pf-shell">
  <section class="pf-hero" id="top"><div class="pf-hero-in">
    <div>
      ${d.available ? `<div class="pf-badge">${pfEsc(d.available)}</div>` : ""}
      <h1>${pfEsc(c.name)}</h1>
      ${c.title ? `<h2>${pfEsc(c.title)}</h2>` : ""}
      ${c.tagline ? `<p>${pfEsc(c.tagline)}</p>` : ""}
      <div class="pf-actions">
        ${d.email ? `<a class="pf-btn pf-btn-primary" href="mailto:${pfEsc(d.email)}">${PF_ICONS.mail}${pfEsc(d.cta_text || "Get in touch")}</a>` : ""}
        ${c.hasResume ? `<a class="pf-btn pf-btn-ghost" ${pfResumeAttrs(c)}>${PF_ICONS.download}${pfEsc(c.resumeLabel)}</a>` : ""}
        ${pfSocialRow(c)}
      </div>
    </div>
    <div class="pf-lens">
      <div class="pf-iris">
        ${pfAvatar(c)}
        <div class="pf-blades" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></div>
      </div>
      <div class="pf-fstop" aria-hidden="true">ƒ/1.4 &nbsp;·&nbsp; 1/250 &nbsp;·&nbsp; ISO 200</div>
    </div>
  </div></section>

  ${c.has("stats") ? `<section class="pf-sec"><div class="pf-stats">
    ${d.stats.map((x, i) => `<div class="pf-card pf-stat" data-focus data-reveal-delay="${i * 60}">
      <b>${pfEsc(x.value)}</b><span>${pfEsc(x.label)}</span></div>`).join("")}</div></section>` : ""}

  ${c.has("about") ? `<section class="pf-sec" id="about"><div class="pf-kicker">About</div>
    <h2 class="pf-h2">The short version</h2>
    <div class="pf-card pf-about" data-focus>${pfEsc(d.about)}</div></section>` : ""}

  ${c.has("skills") ? `<section class="pf-sec" id="skills"><div class="pf-kicker">Toolkit</div>
    <h2 class="pf-h2">What I work with</h2>
    <div class="pf-chips" data-focus>${d.skills.map(x => `<span class="pf-chip">${pfEsc(x)}</span>`).join("")}</div></section>` : ""}

  ${c.has("projects") ? `<section class="pf-sec" id="projects"><div class="pf-kicker">Work</div>
    <h2 class="pf-h2">Selected projects</h2>
    <div class="pf-grid">${d.projects.map((x, i) => `
      <article class="pf-card pf-proj" data-focus>
        <div class="pf-plate" aria-hidden="true"></div>
        <h3>${pfEsc(x.name || "")}</h3>
        ${pfJoin([x.role, x.period]) ? `<div class="pf-exif">${pfJoin([x.role, x.period], " / ")}</div>` : ""}
        ${x.description ? `<p>${pfEsc(x.description)}</p>` : ""}
        ${(x.bullets || []).length ? `<ul>${x.bullets.map(b => `<li>${pfEsc(b)}</li>`).join("")}</ul>` : ""}
        ${(x.tags || []).length ? `<div class="pf-tags">${x.tags.map(t => `<span class="pf-tag">${pfEsc(t)}</span>`).join("")}</div>` : ""}
        ${pfProjectLinks(x) ? `<div class="pf-links">${pfProjectLinks(x)}</div>` : ""}
      </article>`).join("")}</div></section>` : ""}

  ${c.has("experience") ? `<section class="pf-sec" id="experience"><div class="pf-kicker">Experience</div>
    <h2 class="pf-h2">Where I have worked</h2>
    <div class="pf-rows">${d.experience.map(x => `
      <article class="pf-card pf-row" data-focus>
        <div class="pf-row-top"><h3>${pfEsc(x.role || "")}</h3>
          ${x.period ? `<span class="pf-when">${pfEsc(x.period)}</span>` : ""}</div>
        ${x.org ? `<div class="pf-org">${pfJoin([x.org, x.location])}</div>` : ""}
        ${x.summary ? `<p>${pfEsc(x.summary)}</p>` : ""}
        ${(x.bullets || []).length ? `<ul>${x.bullets.map(b => `<li>${pfEsc(b)}</li>`).join("")}</ul>` : ""}
      </article>`).join("")}</div></section>` : ""}

  ${c.has("education") ? `<section class="pf-sec" id="education"><div class="pf-kicker">Education</div>
    <h2 class="pf-h2">Where I studied</h2>
    <div class="pf-rows">${d.education.map(x => `
      <article class="pf-card pf-row" data-focus>
        <div class="pf-row-top"><h3>${pfEsc(x.degree || "")}</h3>
          ${x.period ? `<span class="pf-when">${pfEsc(x.period)}</span>` : ""}</div>
        ${x.school ? `<div class="pf-org">${pfEsc(x.school)}</div>` : ""}
        ${x.detail ? `<p>${pfEsc(x.detail)}</p>` : ""}
      </article>`).join("")}</div></section>` : ""}

  ${c.has("certifications") ? `<section class="pf-sec" id="certifications"><div class="pf-kicker">Credentials</div>
    <h2 class="pf-h2">Certifications</h2>
    <div class="pf-chips" data-focus>${d.certifications.map(x => `<span class="pf-chip">${pfEsc(x)}</span>`).join("")}</div></section>` : ""}

  ${c.has("contact") ? `<section class="pf-sec" id="contact"><div class="pf-card pf-contact" data-focus>
    <h2>Bring it into focus</h2>
    <p>${pfEsc(d.cta_text || "Tell me what you are building and where it is stuck.")}</p>
    <div class="pf-actions" style="justify-content:center;margin-top:1.4rem">
      ${d.email ? `<a class="pf-btn pf-btn-primary" href="mailto:${pfEsc(d.email)}">${PF_ICONS.mail}${pfEsc(d.email)}</a>` : ""}
      ${c.hasResume ? `<a class="pf-btn pf-btn-ghost" ${pfResumeAttrs(c)}>${PF_ICONS.download}Résumé</a>` : ""}
    </div>
    <div class="pf-clist">${c.links.map(x => x.url
      ? `<a href="${pfEsc(x.url)}"${/^https?:/i.test(x.url) ? ` target="_blank" rel="noopener"` : ""}>${x.icon}${pfEsc(x.handle)}</a>`
      : `<span>${x.icon}${pfEsc(x.handle)}</span>`).join("")}</div>
  </div></section>` : ""}

  <footer>© <span data-year>${c.year}</span> ${pfEsc(c.name)}${d.footer_note ? " · " + pfEsc(d.footer_note) : ""}</footer>
</div></main>`;

  const js = `
(function(){
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* Focus rack fallback. Where CSS scroll-driven animations exist they own the
     effect entirely; this observer still runs as a belt-and-braces pass, and
     adding a class twice costs nothing. */
  var racks = document.querySelectorAll('[data-focus]');
  if (racks.length) {
    if (reduce || !('IntersectionObserver' in window)) {
      Array.prototype.forEach.call(racks, function(el){ el.classList.add('pf-sharp'); });
    } else {
      var io = new IntersectionObserver(function(entries){
        entries.forEach(function(en){
          if (!en.isIntersecting) return;
          en.target.classList.add('pf-sharp');
          io.unobserve(en.target);
        });
      }, { rootMargin: '0px 0px -12% 0px', threshold: .12 });
      Array.prototype.forEach.call(racks, function(el){ io.observe(el); });
    }
  }

  /* Read-progress. transform:scaleX keeps it on the compositor — animating
     width here would relayout a fixed bar on every scroll event. */
  var meter = document.querySelector('[data-meter]');
  if (meter) {
    var qd = false;
    function paint(){
      qd = false;
      var h = document.documentElement.scrollHeight - window.innerHeight;
      var p = h > 0 ? (window.pageYOffset || 0) / h : 0;
      meter.style.transform = 'scaleX(' + Math.max(0, Math.min(1, p)).toFixed(4) + ')';
    }
    window.addEventListener('scroll', function(){
      if (!qd) { qd = true; requestAnimationFrame(paint); }
    }, { passive: true });
    window.addEventListener('resize', paint);
    paint();
  }

  /* Re-fire the iris on click — it is the one flourish worth being able to
     watch twice, and restarting an animation means removing it for a frame. */
  var lens = document.querySelector('.pf-lens');
  if (lens && !reduce) {
    lens.addEventListener('click', function(){
      var bits = lens.querySelectorAll('.pf-iris .pf-avatar, .pf-blades i');
      Array.prototype.forEach.call(bits, function(el){ el.style.animation = 'none'; });
      void lens.offsetWidth;
      Array.prototype.forEach.call(bits, function(el){ el.style.animation = ''; });
    });
  }

  var nav = document.querySelector('.pf-nav');
  var links = Array.prototype.slice.call(document.querySelectorAll('.pf-nav-links a'));
  var top = document.getElementById('top');
  if (nav && top) {
    new IntersectionObserver(function(es){
      nav.classList.toggle('pf-stuck', !es[0].isIntersecting);
    }, { rootMargin: '-60px 0px 0px 0px' }).observe(top);
  }
  var targets = links.map(function(a){ return document.querySelector(a.getAttribute('href')); }).filter(Boolean);
  if (targets.length) {
    var seen = {};
    var spy = new IntersectionObserver(function(entries){
      entries.forEach(function(en){ seen[en.target.id] = en.intersectionRatio; });
      var best = '', bestR = 0;
      Object.keys(seen).forEach(function(id){ if (seen[id] > bestR) { bestR = seen[id]; best = id; } });
      links.forEach(function(a){ a.classList.toggle('pf-active', a.getAttribute('href') === '#' + best && bestR > 0); });
    }, { threshold: [0, .18, .5, .85], rootMargin: '-25% 0px -45% 0px' });
    targets.forEach(function(x){ spy.observe(x); });
  }
})();`;

  return { fonts: [c.googleFont ? null : "Inter:wght@400;600;700;800", "JetBrains+Mono:wght@400;700"].filter(Boolean),
           css, body, js, themeColor: "#FAF5FF" };
};
