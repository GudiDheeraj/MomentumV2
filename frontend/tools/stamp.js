#!/usr/bin/env node
/**
 * Stamp index.html's asset versions from the contents of the assets.
 *
 * index.html loads styles.css, app.js, tailwind.css and env.js with a `?v=`
 * token, because browsers cache all four hard and a stale copy is
 * indistinguishable from a bug that was never fixed. The token was written by
 * hand, and the comment beside it in index.html asks whoever edits those files
 * to remember to bump it.
 *
 * Nobody remembers. It has now happened three times, and each time the symptom
 * was the same and cost a round trip: a fix shipped, the browser kept serving
 * the old file, and the fix "didn't work". A rule that is only enforced by
 * remembering is not enforced.
 *
 * So the token is no longer a date somebody types. It is the first eight
 * characters of a SHA-256 of the file it points at: it changes exactly when
 * the file changes, never when it doesn't, and each asset moves on its own so
 * editing app.js does not force a re-download of Tailwind.
 *
 *   node frontend/tools/stamp.js            rewrite the tokens
 *   node frontend/tools/stamp.js --check    exit 1 if any is stale, change nothing
 *
 * The --check form is the one worth wiring into anything that runs before a
 * deploy; it needs no browser and no server and takes a few milliseconds.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const HERE = path.resolve(__dirname, "..");
const INDEX = path.join(HERE, "index.html");
const check = process.argv.includes("--check");

const hash = (file) =>
  crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex").slice(0, 8);

let html = fs.readFileSync(INDEX, "utf8");
const stale = [];
const seen = [];

// Every local asset in index.html that carries a token. The icons are left
// alone: they are stamped by hand when the brand changes, which is rare and
// deliberate, and re-stamping them on every edit would make browsers re-fetch
// the favicon for no reason.
const ASSETS = ["styles.css", "app.js", "tailwind.css", "env.js",
                "portfolio.css", "portfolio-templates.js", "portfolio-blocks.js",
                "portfolio-designer.js", "portfolio.js"];

for (const asset of ASSETS) {
  const file = path.join(HERE, asset);
  if (!fs.existsSync(file)) continue;
  const want = hash(file);
  // href="app.js?v=..." / src="app.js?v=..."
  const re = new RegExp(`((?:href|src)=")${asset.replace(/\./g, "\\.")}\\?v=([^"]*)(")`, "g");
  let found = false;
  html = html.replace(re, (_, before, had, after) => {
    found = true;
    seen.push({ asset, had, want });
    if (had !== want) stale.push(`${asset}: ${had} -> ${want}`);
    return `${before}${asset}?v=${want}${after}`;
  });
  if (!found) console.warn(`  note: ${asset} is not loaded with a ?v= token in index.html`);
}

// One combined stamp, printed to the console at startup, so it is possible to
// tell at a glance whether a browser is running current files.
const build = crypto.createHash("sha256")
  .update(seen.map((s) => s.asset + ":" + s.want).join("|")).digest("hex").slice(0, 8);
html = html.replace(/(<meta name="app-build" content=")([^"]*)(">)/, (_, a, had, c) => {
  if (had !== build) stale.push(`app-build: ${had} -> ${build}`);
  return `${a}${build}${c}`;
});

if (check) {
  if (stale.length) {
    console.error("index.html is stamped for files that have since changed:");
    stale.forEach((s) => console.error("  " + s));
    console.error("\nRun:  node frontend/tools/stamp.js");
    process.exit(1);
  }
  console.log(`asset stamps are current (${seen.map((s) => s.asset).join(", ")})`);
  process.exit(0);
}

if (!stale.length) {
  console.log("nothing to do — every stamp already matches its file");
} else {
  fs.writeFileSync(INDEX, html);
  console.log("stamped index.html:");
  stale.forEach((s) => console.log("  " + s));
}
