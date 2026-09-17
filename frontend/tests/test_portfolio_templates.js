/**
 * Regression harness for the portfolio templates.
 *
 * The promise this feature makes is narrow and testable: whatever somebody
 * types, every one of the ten templates produces ONE valid, self-contained
 * HTML file that is safe to host. This asserts exactly that, against three
 * payloads chosen to break it — a full portfolio, an almost-empty one, and one
 * where every field is an XSS attempt.
 *
 * No framework and no dependencies: node is already needed for the Tailwind
 * build, so this runs anywhere the project builds.
 *
 *     node frontend/tests/test_portfolio_templates.js
 *     node frontend/tests/test_portfolio_templates.js --verbose
 *
 * It cannot judge what a page LOOKS like — that needs a browser. What it
 * catches is the class of bug that ships silently: a template that stops
 * escaping a field, forgets the résumé's download attribute, renders a
 * section the customer switched off, or grows a reference to a file that
 * won't exist on the customer's host.
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const VERBOSE = process.argv.includes("--verbose");
const ctx = { console };
vm.createContext(ctx);
vm.runInContext(
  fs.readFileSync(path.join(__dirname, "..", "portfolio-templates.js"), "utf8") +
    "\n;globalThis.__api = { pfRenderSite, PF_TEMPLATES, pfNormalize, PF_SECTIONS };",
  ctx
);
const { pfRenderSite, PF_TEMPLATES, PF_SECTIONS } = ctx.__api;

// --------------------------------------------------------------------------
// Fixtures
// --------------------------------------------------------------------------
const ALL_ON = Object.fromEntries(PF_SECTIONS.map(s => [s.id, true]));

const FULL = {
  full_name: "Ada Lovelace", title: "Principal Engineer", available: "Open to work",
  tagline: "I make slow systems fast and complicated ones obvious.",
  location: "London, UK", email: "ada@example.com", phone: "+44 7700 900123",
  website: "ada.dev", linkedin: "linkedin.com/in/ada", github: "github.com/ada", twitter: "x.com/ada",
  about: "First paragraph.\n\nSecond paragraph, which some templates lift a pull quote from.",
  skills: ["Python", "Go", "TypeScript", "Postgres", "Kubernetes"],
  stats: [{ value: "12", label: "Years" }, { value: "99.98%", label: "Uptime" }],
  projects: [{
    name: "Analytical Engine", role: "Lead", period: "1843",
    description: "A general-purpose computing machine.",
    bullets: ["Wrote the first algorithm"], tags: ["Mathematics", "Engineering"],
    link: "example.com/engine", repo: "github.com/ada/engine",
  }],
  experience: [{
    role: "Principal Engineer", org: "Analytical Society", period: "1840 — 1852",
    location: "London", summary: "Owned the engine.", bullets: ["Published the notes"],
  }],
  education: [{ degree: "Mathematics", school: "Private tuition", period: "1830", detail: "Under De Morgan" }],
  certifications: ["Fellow of the Royal Society"],
  cta_text: "Get in touch", footer_note: "Made in London",
  sections: ALL_ON,
  resume: { mode: "embed", filename: "ada.pdf", data_url: "data:application/pdf;base64,JVBERi0xLjQK", label: "Download résumé" },
};

// Everything optional removed. A template that assumes a field exists blows up
// here rather than on a customer's first save.
const SPARSE = {
  full_name: "A", email: "a@example.com",
  sections: Object.fromEntries(PF_SECTIONS.map(s => [s.id, false])),
};

const PAYLOAD = '"><script>window.PWNED=1<\/script><img src=x onerror="window.PWNED=1">';
const HOSTILE = {
  ...FULL,
  full_name: PAYLOAD, title: PAYLOAD, tagline: PAYLOAD, about: PAYLOAD, location: PAYLOAD,
  email: PAYLOAD, phone: PAYLOAD, website: PAYLOAD, linkedin: PAYLOAD, github: PAYLOAD,
  available: PAYLOAD, cta_text: PAYLOAD, footer_note: PAYLOAD, seo_title: PAYLOAD, seo_description: PAYLOAD,
  skills: [PAYLOAD], certifications: [PAYLOAD],
  stats: [{ value: PAYLOAD, label: PAYLOAD }],
  projects: [{ name: PAYLOAD, role: PAYLOAD, period: PAYLOAD, description: PAYLOAD,
               bullets: [PAYLOAD], tags: [PAYLOAD], link: PAYLOAD, repo: PAYLOAD }],
  experience: [{ role: PAYLOAD, org: PAYLOAD, period: PAYLOAD, location: PAYLOAD,
                 summary: PAYLOAD, bullets: [PAYLOAD] }],
  education: [{ degree: PAYLOAD, school: PAYLOAD, period: PAYLOAD, detail: PAYLOAD }],
  resume: { mode: "link", url: PAYLOAD, label: PAYLOAD },
};

// --------------------------------------------------------------------------
// Checks
// --------------------------------------------------------------------------
let failures = [];
function check(template, fixture, label, condition, detail) {
  if (!condition) failures.push(`${template} / ${fixture}: ${label}${detail ? " — " + detail : ""}`);
  else if (VERBOSE) console.log(`    ok  ${label}`);
}

// How many <script> blocks a page is allowed is not a fixed number: the
// document emits the JSON-LD record and the shared behaviour separately, and
// a template that has its own script adds a third. Hard-coding the count made
// this assertion fire on every template the moment the renderer split its
// tags — thirty-six red lines that said nothing, and hid a real injection in
// the one template that had one.
//
// The invariant that actually matters has no constant in it: hostile content
// must not produce MORE script blocks than the same template produces from
// ordinary content. So the benign render is the expected value.
const scriptCount = (html) => (html.match(/<script/gi) || []).length;
const benignScripts = {};

for (const t of PF_TEMPLATES) {
  if (VERBOSE) console.log(`\n${t.name} (${t.id})`);

  for (const [fixture, data] of [["full", FULL], ["sparse", SPARSE], ["hostile", HOSTILE]]) {
    let html;
    try {
      html = pfRenderSite(t.id, data);
    } catch (err) {
      failures.push(`${t.id} / ${fixture}: threw — ${err.message}`);
      continue;
    }

    // --- a single, valid, complete document -----------------------------
    check(t.id, fixture, "starts with a doctype", html.startsWith("<!DOCTYPE html>"));
    check(t.id, fixture, "has one <html> and one </html>",
      (html.match(/<html/g) || []).length === 1 && (html.match(/<\/html>/g) || []).length === 1);
    check(t.id, fixture, "has a <title>", /<title>[^<]/.test(html));
    check(t.id, fixture, "declares a viewport", html.includes('name="viewport"'));
    check(t.id, fixture, "has a skip link", html.includes('class="pf-skip"'));
    check(t.id, fixture, "has the #main landmark", html.includes('id="main"'));

    // --- self-contained: nothing to upload but this file -----------------
    // Google Fonts is the one allowed outbound request, and every font
    // declaration carries a system fallback, so an offline page still reads.
    const externalScripts = (html.match(/<script[^>]+src=/gi) || []).length;
    check(t.id, fixture, "no external <script src>", externalScripts === 0, `${externalScripts} found`);
    const links = html.match(/<link[^>]+href="https?:\/\/[^"]+"/gi) || [];
    const nonFont = links.filter(l => !/fonts\.(googleapis|gstatic)\.com/.test(l));
    check(t.id, fixture, "no external stylesheets besides Google Fonts", nonFont.length === 0, nonFont.join(" "));
    const imgs = html.match(/<img[^>]+src="(?!data:)[^"]*"/gi) || [];
    check(t.id, fixture, "no images loaded from another host", imgs.length === 0, imgs.join(" "));

    if (fixture === "full") benignScripts[t.id] = scriptCount(html);

    // --- hostile input stays inert ---------------------------------------
    if (fixture === "hostile") {
      const scripts = scriptCount(html);
      const want = benignScripts[t.id];
      check(t.id, fixture, "hostile content adds no script block",
        scripts === want, `${scripts} with the payload vs ${want} without it`);

      // The payload must survive only in escaped form.
      check(t.id, fixture, "no unescaped closing script tag from content", !/<\/script>\s*<script>window\.PWNED/.test(html));
      check(t.id, fixture, "payload appears escaped", html.includes("&lt;script&gt;"));

      // Anything the browser would actually run lives inside a <script>
      // element, and the only way content in one escapes is a literal "<":
      // an inline script ends at the first "</script>" in its text whatever
      // the surrounding JavaScript quoting says, and everything after it is
      // parsed as markup. So the check is for an unescaped tag delimiter,
      // not for the word "onerror" — which appears, harmlessly escaped, in
      // the JSON-LD record of every one of these pages.
      //
      // (This is not hypothetical: it is exactly how a template that wrote
      // an address into an inline script with JSON.stringify — which escapes
      // for JavaScript but not for HTML — became injectable.)
      const blocks = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]);
      const leaked = blocks.filter(b => /<\s*\/?\s*script/i.test(b));
      check(t.id, fixture, "no unescaped script tag inside a script block", leaked.length === 0,
        leaked.map(b => (b.match(/.{0,60}<\s*\/?\s*script.{0,30}/i) || [""])[0].trim()).join(" | "));

      // And nothing unescaped in an event-handler attribute in the markup.
      check(t.id, fixture, "no live onerror attribute",
        !/<img(?:[^>]*\s)onerror=(?!&quot;)/i.test(html));
    }

    // --- the résumé link means what it says -------------------------------
    const anchors = html.match(/<a[^>]*data-resume[^>]*>/g) || [];
    if (fixture === "full") {
      check(t.id, fixture, "offers the résumé at least once", anchors.length > 0);
      check(t.id, fixture, "every résumé link downloads the embedded file",
        anchors.every(a => a.includes("href=\"data:application/pdf") && a.includes("download=")),
        anchors.find(a => !a.includes("download=")) || "");
    }
    if (fixture === "sparse") {
      check(t.id, fixture, "no résumé link when none is attached", anchors.length === 0);
    }
    if (fixture === "hostile") {
      // "link" mode points at somebody else's server, so it opens rather than
      // downloading, and must not carry a download filename.
      check(t.id, fixture, "linked résumé opens in a new tab, never as a download",
        anchors.every(a => a.includes('target="_blank"') && a.includes('rel="noopener"') && !a.includes("download=")));
    }

    // --- switched-off sections really are absent --------------------------
    if (fixture === "sparse") {
      for (const s of PF_SECTIONS) {
        if (s.id === "stats") continue;                       // never gets its own anchor
        check(t.id, fixture, `#${s.id} section omitted`, !html.includes(`id="${s.id}"`));
      }
      check(t.id, fixture, "still renders the person's name", html.includes("A"));
    }

    // --- size stays deployable -------------------------------------------
    const kb = Buffer.byteLength(html, "utf8") / 1024;
    check(t.id, fixture, "under 400KB before the résumé/photo", kb < 400, `${kb.toFixed(0)}KB`);
    if (VERBOSE) console.log(`    ${fixture.padEnd(8)} ${kb.toFixed(1)}KB`);
  }
}

// --------------------------------------------------------------------------
// Content survives a template switch — the whole point of one shared shape.
// --------------------------------------------------------------------------
for (const t of PF_TEMPLATES) {
  const html = pfRenderSite(t.id, FULL);
  for (const needle of ["Ada Lovelace", "Principal Engineer", "Analytical Engine", "Kubernetes", "Fellow of the Royal Society"]) {
    check(t.id, "full", `carries "${needle}" across the switch`, html.includes(needle));
  }
}

// --------------------------------------------------------------------------
console.log("");
if (failures.length) {
  console.error(`FAILED — ${failures.length} assertion(s):\n`);
  failures.forEach(f => console.error("  • " + f));
  process.exit(1);
}
console.log(`PASS — ${PF_TEMPLATES.length} templates x 3 fixtures: every page is one valid, self-contained,`);
console.log("       escape-safe file, and no template loses content when you switch to it.");
