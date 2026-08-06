// ============================================================================
// Momentum Tracker extension — content script
// ============================================================================
// Runs on every page. Does nothing until asked (via chrome.runtime message)
// to scrape the current page for job-posting details. Never sends anything
// anywhere on its own — purely extraction, triggered on demand from the
// popup via the background service worker.

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Generic "find the real content" extraction — works on any job site, not
// just the handful with hardcoded CSS classes below. Scores block-level
// elements by text length minus link-density (nav bars, "related jobs"
// lists, and footers are link-heavy; the actual job description is not)
// and picks the best one. This is what gets sent to the backend for
// AI-assisted field extraction, since CSS selectors alone can't keep up
// with every ATS platform and company career page's markup.
function scoreElementForContent(el) {
  const t = el.innerText || "";
  if (t.length < 200) return -1;
  let linkTextLen = 0;
  const links = el.querySelectorAll("a");
  for (const a of links) linkTextLen += (a.innerText || "").length;
  const linkDensity = t.length ? linkTextLen / t.length : 1;
  if (linkDensity > 0.5) return -1; // too link-heavy: nav, job list, footer
  return t.length * (1 - linkDensity);
}

function extractMainContentText() {
  const candidates = document.querySelectorAll("article, main, [role='main'], section, div");
  let best = null;
  let bestScore = 0;
  for (const el of candidates) {
    const score = scoreElementForContent(el);
    if (score > bestScore) { bestScore = score; best = el; }
  }
  const text = (best || document.body).innerText || "";
  return text.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, 8000);
}

function text(el) {
  return el ? el.textContent.replace(/\s+/g, " ").trim() : "";
}

function firstMatch(selectors, accept) {
  for (const sel of selectors) {
    try {
      const el = document.querySelector(sel);
      const t = el ? text(el) : "";
      // A validator lets a selector that matched the wrong element fall
      // through to the next candidate instead of winning by being first.
      if (t && (!accept || accept(t))) return t;
    } catch { /* invalid selector on this page — skip it */ }
  }
  return "";
}

// Headings that belong to the site's own furniture rather than the posting.
// On a signed-in Indeed search page the page-level <h1> is "Welcome, Dheeraj",
// and the generic "h1" fallback took it as the job title.
const CHROME_HEADINGS = [
  /^welcome\b/i, /^hi\b/i, /^hello\b/i, /^good (morning|afternoon|evening)\b/i,
  /^jobs? (for you|search|results)\b/i, /^search results\b/i, /^my jobs\b/i,
  /^sign ?in\b/i, /^log ?in\b/i, /^create (an )?account\b/i, /^saved jobs\b/i,
  /^recommended\b/i, /^find jobs\b/i, /^dashboard\b/i, /^notifications?\b/i,
];
// Boards append their own noun to the heading — Indeed renders the title as
// "Customer Experience Insights Manager - job post". It is not part of the
// role and would be carried into the saved application and the tailoring
// prompt, so it comes off here rather than being left for the user to delete.
const ROLE_SUFFIXES = /\s*[-–—|]\s*(job post(ing)?|job|vacancy|career|apply now|full[- ]time|part[- ]time)\s*$/i;
function cleanRoleTitle(t) {
  let v = (t || "").trim();
  for (let i = 0; i < 3; i++) {
    const next = v.replace(ROLE_SUFFIXES, "").trim();
    if (next === v) break;
    v = next;
  }
  return v;
}

function looksLikeRole(t) {
  const v = (t || "").trim();
  if (v.length < 2 || v.length > 160) return false;
  return !CHROME_HEADINGS.some(re => re.test(v));
}

function metaContent(names) {
  for (const name of names) {
    const el = document.querySelector(`meta[property="${name}"], meta[name="${name}"]`);
    if (el && el.content) return el.content.trim();
  }
  return "";
}

// LinkedIn's job page <title> is generated server-side and reliably follows
// one of a couple of patterns regardless of which UI redesign is live, so
// it's a sturdier source of truth than any single CSS class:
//   "Company Name hiring Job Title in Location | LinkedIn"
//   "Job Title hiring at Company Name | LinkedIn"
//   "(2) Company Name hiring Job Title in Location | LinkedIn"
function parseLinkedInTitle(title) {
  const cleaned = title.replace(/^\(\d+\)\s*/, "").replace(/\s*\|\s*LinkedIn\s*$/i, "").trim();
  let m = cleaned.match(/^(.+?)\s+hiring\s+(.+?)\s+in\s+(.+)$/i);
  if (m) return { company: m[1].trim(), role: m[2].trim(), location: m[3].trim() };
  m = cleaned.match(/^(.+?)\s+hiring\s+at\s+(.+)$/i);
  if (m) return { role: m[1].trim(), company: m[2].trim(), location: "" };
  // The signed-in SPA uses pipes, not "hiring": "Data Scientist | The AA".
  // Without this the whole string fell through to the document.title fallback,
  // which is why the role came back as "Data Scientist | The AA | LinkedIn"
  // with company and location empty.
  const parts = cleaned.split("|").map(s => s.trim()).filter(Boolean);
  if (parts.length >= 2) {
    return { role: parts[0], company: parts[1], location: parts[2] || "" };
  }
  return null;
}

// ---------------------------------------------------------------------------
// schema.org JobPosting (JSON-LD)
// ---------------------------------------------------------------------------
// The only extraction route that is not a guess. LinkedIn, Indeed, Glassdoor,
// Greenhouse, Lever, Workday, SmartRecruiters, Ashby and most company career
// pages all embed a JobPosting block because Google for Jobs requires it, and
// unlike CSS classes it does not change when a site is redesigned. Tried
// first; the selectors below stay as the fallback for pages that have none.
function stripTags(html) {
  if (!html) return "";
  const d = document.createElement("div");
  d.innerHTML = html;
  return (d.textContent || "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

function flattenJsonLd(node, out) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) { node.forEach(n => flattenJsonLd(n, out)); return; }
  out.push(node);
  if (node["@graph"]) flattenJsonLd(node["@graph"], out);
}

function jsonLdText(v) {
  // Fields arrive as a string, an object with a name, or an array of either.
  if (!v) return "";
  if (typeof v === "string") return v.trim();
  if (Array.isArray(v)) return jsonLdText(v[0]);
  if (typeof v === "object") return jsonLdText(v.name || v.title || v.value || "");
  return String(v);
}

function jsonLdLocation(v) {
  if (!v) return "";
  if (Array.isArray(v)) return jsonLdLocation(v[0]);
  if (typeof v === "string") return v.trim();
  const a = v.address || v;
  if (typeof a === "string") return a.trim();
  const bits = [a.addressLocality, a.addressRegion, a.addressCountry]
    .map(x => jsonLdText(x)).filter(Boolean);
  return bits.join(", ");
}

function jsonLdSalary(v) {
  if (!v) return "";
  const val = v.value || v;
  const cur = jsonLdText(v.currency || val.currency || "");
  const min = val.minValue, max = val.maxValue, one = val.value;
  const unit = jsonLdText(val.unitText || "");
  const nums = [min, max].filter(n => n !== undefined && n !== null && n !== "");
  let out = nums.length === 2 ? `${nums[0]} - ${nums[1]}` : (one ? String(one) : "");
  if (!out) return "";
  if (cur) out = `${cur} ${out}`;
  return unit ? `${out} / ${unit.toLowerCase()}` : out;
}

function extractJobPostingJsonLd() {
  const blocks = [];
  for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
    try { flattenJsonLd(JSON.parse(s.textContent), blocks); } catch { /* malformed block */ }
  }
  const posting = blocks.find(b => {
    const t = b && b["@type"];
    return t === "JobPosting" || (Array.isArray(t) && t.includes("JobPosting"));
  });
  if (!posting) return null;
  return {
    role: jsonLdText(posting.title),
    company: jsonLdText(posting.hiringOrganization),
    location: posting.jobLocationType && !posting.jobLocation
      ? "Remote"
      : jsonLdLocation(posting.jobLocation),
    description: stripTags(posting.description),
    salary: jsonLdSalary(posting.baseSalary || posting.estimatedSalary),
  };
}

// ---------------------------------------------------------------------------
// schema.org JobPosting (microdata)
// ---------------------------------------------------------------------------
// The older sibling of JSON-LD, still what many European and Asian portals
// emit. Same vocabulary, expressed as itemprop attributes. Like JSON-LD it is
// language-neutral, which matters far more than selectors here: a CSS class
// list written against English-language markup tells you nothing about a
// Polish, Czech, Japanese or Arabic page, but itemprop="title" is itemprop
// ="title" everywhere.
function microdataJobPosting() {
  const scope = document.querySelector('[itemtype$="JobPosting" i]');
  if (!scope) return null;
  const prop = (name) => {
    const el = scope.querySelector(`[itemprop="${name}" i]`);
    if (!el) return "";
    return (el.getAttribute("content") || el.textContent || "").replace(/\s+/g, " ").trim();
  };
  const org = scope.querySelector('[itemprop="hiringOrganization" i]');
  const company = org
    ? ((org.querySelector('[itemprop="name" i]')?.textContent
        || org.getAttribute("content") || org.textContent || "").replace(/\s+/g, " ").trim())
    : "";
  const locEl = scope.querySelector('[itemprop="jobLocation" i]');
  const location = locEl
    ? (locEl.querySelector('[itemprop="addressLocality" i]')?.textContent
       || locEl.textContent || "").replace(/\s+/g, " ").trim()
    : "";
  const role = prop("title");
  if (!role && !company) return null;
  return { role, company, location, description: prop("description"), salary: "" };
}

// Page titles almost always carry the site's own brand as the last segment —
// "Senior Developer | TinyCo", "Data Scientist - Indeed.com". When the title is
// the last resort for the role, that suffix comes along with it and ends up in
// the Role field. Only a trailing segment that matches the site's own domain
// or a known board is dropped, so a title like "Acme - Backend Engineer", where
// the brand leads, is left alone rather than guessed at.
function cleanDocumentTitle(title, host) {
  const brand = (host || "").replace(/^www\./, "").split(".")[0].toLowerCase();
  const parts = String(title || "").split(/\s+[|–—-]\s+/).map(s => s.trim()).filter(Boolean);
  while (parts.length > 1) {
    const last = parts[parts.length - 1].toLowerCase().replace(/[^a-z0-9]/g, "");
    const isBrand = brand && (last === brand || last.startsWith(brand) || brand.startsWith(last));
    if (isBrand || /^(linkedin|indeed|glassdoor|greenhouse|lever|workday|monster|ziprecruiter|totaljobs|reed|seek)$/.test(last)) {
      parts.pop();
    } else break;
  }
  return parts.join(" - ");
}


// ---------------------------------------------------------------------------
// Job portal registry
// ---------------------------------------------------------------------------
// Hostname fragment -> the name a capture is filed under. Used for two things:
// labelling the "source" of a saved application, and deciding where the
// in-page launcher appears. Being absent from this list does not stop
// extraction — any page carrying JobPosting structured data is handled — it
// only means the capture is filed under the bare domain.
const JOB_PORTALS = [
  ["linkedin.", "LinkedIn"], ["indeed.", "Indeed"], ["glassdoor.", "Glassdoor"],
  ["ziprecruiter.", "ZipRecruiter"], ["jobbank.gc.ca", "Job Bank"], ["reed.co.uk", "Reed"],
  ["irishjobs.", "IrishJobs"], ["seek.com", "SEEK"], ["trademe.co.nz", "Trade Me Jobs"],
  ["stepstone.", "StepStone"], ["francetravail.", "France Travail"], ["pole-emploi.", "France Travail"],
  ["apec.fr", "APEC"], ["nationalevacaturebank.", "Nationale Vacaturebank"],
  ["jobs.ch", "jobs.ch"], ["karriere.at", "karriere.at"], ["infojobs.", "InfoJobs"],
  ["pracuj.pl", "Pracuj.pl"], ["jobs.cz", "Jobs.cz"], ["arbetsformedlingen.se", "Arbetsförmedlingen"],
  ["finn.no", "FINN.no"], ["jobindex.dk", "Jobindex"], ["duunitori.fi", "Duunitori"],
  ["naukri.", "Naukri"], ["jobstreet.", "JobStreet"], ["jobsdb.", "JobsDB"],
  ["jobthai.", "JobThai"], ["doda.jp", "doda"], ["jobkorea.", "JobKorea"],
  ["saramin.", "Saramin"], ["104.com", "104 Job Bank"], ["zhipin.", "BOSS Zhipin"],
  ["liepin.", "Liepin"], ["zhaopin.", "Zhaopin"], ["bayt.", "Bayt"],
  ["pnet.co.za", "PNet"], ["jobberman.", "Jobberman"], ["brightermonday.", "BrighterMonday"],
  ["myjobmag.", "MyJobMag"], ["wuzzuf.", "Wuzzuf"], ["computrabajo.", "Computrabajo"],
  ["bumeran.", "Bumeran"], ["laborum.", "Laborum"], ["kariyer.net", "Kariyer.net"],
  ["alljobs.co.il", "AllJobs"], ["work.ua", "Work.ua"], ["robota.ua", "Robota.ua"],
  ["hh.ru", "HeadHunter"], ["headhunter.", "HeadHunter"], ["superjob.", "SuperJob"],
  ["rabota.ru", "Rabota.ru"],
  // ATS platforms — company career pages are usually one of these underneath
  ["greenhouse.", "Greenhouse"], ["lever.co", "Lever"], ["myworkdayjobs.", "Workday"],
  ["workday.", "Workday"], ["smartrecruiters.", "SmartRecruiters"], ["ashbyhq.", "Ashby"],
  ["totaljobs.", "Totaljobs"], ["monster.", "Monster"], ["recruitee.", "Recruitee"],
  ["personio.", "Personio"], ["teamtailor.", "Teamtailor"], ["workable.", "Workable"],
];

function portalName(host) {
  const h = (host || "").toLowerCase();
  for (const [frag, name] of JOB_PORTALS) if (h.includes(frag)) return name;
  return "";
}

function scrapeJobPostingOnce() {
  const host = location.hostname.replace(/^www\./, "");
  const isLinkedIn = host.includes("linkedin");
  const titleGuess = isLinkedIn ? parseLinkedInTitle(document.title) : null;
  // Structured data first — it is the only source that is stated rather than
  // inferred, so anything it gives us outranks a CSS guess.
  const ld = extractJobPostingJsonLd() || microdataJobPosting() || {};

  const roleTitle = ld.role || firstMatch([
    // LinkedIn — current (2024+) unified top card, several known variants
    ".job-details-jobs-unified-top-card__job-title h1",
    ".job-details-jobs-unified-top-card__job-title",
    "h1.jobs-unified-top-card__job-title",
    "h1.t-24.job-details-jobs-unified-top-card__job-title",
    // LinkedIn — older / guest / shared-link view
    "h1.top-card-layout__title",
    "h1.topcard__title",
    // Indeed — the two-pane search view puts the posting in the right pane
    // while the page h1 is the account greeting, so the pane is searched
    // before anything page-level.
    "[data-testid='jobsearch-RightPane'] .jobsearch-JobInfoHeader-title",
    "[data-testid='jobsearch-RightPane'] h1, [data-testid='jobsearch-RightPane'] h2",
    ".jobsearch-RightPane .jobsearch-JobInfoHeader-title",
    ".jobsearch-JobInfoHeader-title-container h1, .jobsearch-JobInfoHeader-title-container h2",
    ".jobsearch-JobInfoHeader-title",
    "h1.jobsearch-JobInfoHeader-title",
    "[data-testid='jobsearch-JobInfoHeader-title']",
    "[data-testid='jobTitle']",
    // generic job boards (Greenhouse, Lever, Workday, company career pages)
    "h1[class*='job-title']",
    "h1[class*='JobTitle']",
    "h1",
  ], looksLikeRole) || titleGuess?.role || metaContent(["og:title"]) || cleanDocumentTitle(document.title, host);

  let companyName = ld.company || firstMatch([
    // LinkedIn — current
    ".job-details-jobs-unified-top-card__company-name a",
    ".job-details-jobs-unified-top-card__company-name",
    ".jobs-unified-top-card__company-name a",
    ".jobs-unified-top-card__company-name",
    "a[data-tracking-control-name='public_jobs_topcard-org-name']",
    // LinkedIn — older / guest view
    "a.topcard__org-name-link",
    "span.topcard__flavor",
    // Indeed
    "[data-testid='inlineHeader-companyName']",
    "[data-testid='company-name']",
    // generic
    "[class*='company-name']",
    "[class*='CompanyName']",
  ]);
  // og:site_name is almost always the job board's own name ("LinkedIn",
  // "Indeed"), not the employer — never treat it as the company. If nothing
  // above matched, prefer LinkedIn's title-parsed company over any fallback.
  if (!companyName && titleGuess?.company) companyName = titleGuess.company;
  if (!companyName) {
    const siteName = metaContent(["og:site_name"]);
    const looksLikeJobBoard = siteName && /linkedin|indeed|glassdoor/i.test(siteName);
    companyName = looksLikeJobBoard ? "" : siteName;
  }
  if (!companyName) companyName = "";

  const location_ = ld.location || firstMatch([
    ".job-details-jobs-unified-top-card__primary-description-container",
    ".jobs-unified-top-card__bullet",
    ".topcard__flavor--bullet",
    "[data-testid='jobsearch-JobInfoHeader-companyLocation']",
    "[class*='job-location']",
    "[class*='JobLocation']",
    "[data-testid='inlineHeader-companyLocation']",
  ]) || titleGuess?.location || "";

  const description = ld.description || firstMatch([
    "#job-details",
    ".jobs-description__content .jobs-box__html-content",
    ".jobs-description-content__text",
    ".jobs-description__content",
    ".jobsearch-jobDescriptionText",
    "[data-testid='jobDescriptionText']",
    "[class*='job-description']",
    "[class*='JobDescription']",
    "article",
    "main",
  ]) || metaContent(["og:description"]);

  // Indeed prefixes the description with its own profile-match blurb, which is
  // interface copy, not the employer's text — and it would otherwise be fed to
  // the keyword matcher and the ATS scorer as if it were part of the posting.
  const DESC_PREAMBLE = [
    /^here'?s how the job details align with your (profile|job preferences)\.?/i,
    /^pulled from the full job description\.?/i,
    /^job details\.?/i,
  ];
  let cleanedDescription = (description || "").trim();
  for (let i = 0; i < DESC_PREAMBLE.length + 2; i++) {
    const before = cleanedDescription;
    for (const re of DESC_PREAMBLE) cleanedDescription = cleanedDescription.replace(re, "").trim();
    if (cleanedDescription === before) break;
  }

  const salary = ld.salary || firstMatch([
    "[class*='salary']",
    "[class*='Salary']",
    "[data-testid='salary-snippet']",
  ]);

  const source = portalName(host) || host;

  return {
    role_title: cleanRoleTitle(roleTitle).slice(0, 200),
    company_name: companyName.slice(0, 200),
    location: location_.slice(0, 150),
    job_description: cleanedDescription.slice(0, 8000),
    salary_range: salary.slice(0, 100),
    job_link: location.href,
    source,
    // Extra context for backend AI-assisted extraction — a general-purpose
    // readability-style dump, not tied to this site's specific markup, so
    // the backend can double-check/improve on the guesses above for ANY
    // job site, including ones with no matching selectors at all.
    raw_text: extractMainContentText(),
    page_title: document.title,
    page_url: location.href,
  };
}

// LinkedIn's job view is a single-page app — the details panel for a given
// job can still be finishing its own async render right when the popup asks
// for a scrape, so a single immediate read can catch it half-loaded (empty
// description, no company yet). Retry a few times with a short wait instead
// of accepting the first mostly-empty result.
async function scrapeJobPosting() {
  let result = scrapeJobPostingOnce();
  let attempts = 0;
  while (attempts < 4 && (!result.company_name || result.job_description.length < 40)) {
    await sleep(350);
    result = scrapeJobPostingOnce();
    attempts++;
  }
  return result;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "MOMENTUM_SCRAPE_JOB") {
    scrapeJobPosting()
      .then(data => sendResponse({ ok: true, data }))
      .catch(e => sendResponse({ ok: false, error: String(e) }));
    return true; // keep the message channel open for the async response
  }
});

// ===========================================================================
// In-page launcher
// ===========================================================================
// The toolbar popup closes the moment you click the page behind it, which
// makes editing a description next to the posting impossible. This injects a
// floating button on job pages that opens the same UI in an iframe pinned to
// the page, so it stays open while you read and scroll.
//
// The panel is popup.html loaded from the extension origin — the same markup
// and script, not a second copy to keep in step. Everything lives inside a
// shadow root so no site stylesheet can reach in and nothing here leaks out.

function mtLooksLikeJobPage() {
  if (portalName(location.hostname)) return true;
  // Any page carrying a JobPosting block is a job page regardless of domain —
  // this is what covers company career sites we have never seen.
  for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
    if ((s.textContent || "").includes("JobPosting")) return true;
  }
  return false;
}

function mtInjectLauncher() {
  if (document.getElementById("momentum-launcher-root")) return;

  const host = document.createElement("div");
  host.id = "momentum-launcher-root";
  host.style.cssText = "position:fixed;z-index:2147483646;right:0;bottom:0;width:0;height:0;";
  (document.body || document.documentElement).appendChild(host);
  const root = host.attachShadow({ mode: "open" });

  root.innerHTML = `
    <style>
      :host { all: initial; }
      .fab {
        position: fixed; right: 22px; bottom: 22px; width: 54px; height: 54px;
        border: none; border-radius: 17px; cursor: pointer; padding: 0;
        background: #4F46E5; box-shadow: 0 6px 22px rgba(79,70,229,.38);
        display: flex; align-items: center; justify-content: center;
        transition: transform .14s ease, box-shadow .14s ease;
      }
      .fab:hover { transform: translateY(-2px); box-shadow: 0 10px 28px rgba(20,16,60,.44); }
      .fab svg { width: 30px; height: 30px; display: block; }
      .panel {
        position: fixed; right: 22px; bottom: 88px;
        width: 792px; height: 612px; max-width: calc(100vw - 44px); max-height: calc(100vh - 120px);
        border: none; border-radius: 18px; overflow: hidden; background: #F6F7FB;
        box-shadow: 0 18px 60px rgba(16,20,40,.30), 0 2px 8px rgba(16,20,40,.14);
        display: none;
      }
      .panel.open { display: block; }
      .panel iframe { width: 100%; height: 100%; border: 0; display: block; }
      /* Pinned to the panel's own top-right rather than a fixed page offset,
         so it stays put when the panel shrinks on a short window. */
      .close {
        position: fixed; right: 30px; top: calc(100vh - 88px - min(612px, 100vh - 120px) + 8px);
        width: 26px; height: 26px;
        border: none; border-radius: 50%; cursor: pointer; display: none;
        background: #fff; color: #6B6F85; font: 600 14px/1 system-ui;
        box-shadow: 0 2px 8px rgba(0,0,0,.18);
      }
      .close.open { display: block; }
    </style>
    <button class="fab" title="Momentum Tracker — capture this job" aria-label="Open Momentum Tracker">
      <svg viewBox="0 0 96 96" aria-hidden="true">
        <path d="M24 72V32L48 56L68 26" fill="none" stroke="#fff" stroke-width="11"
              stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M52 26H70V44" fill="none" stroke="#fff" stroke-width="11"
              stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </button>
    <button class="close" title="Close">✕</button>
    <div class="panel"><iframe title="Momentum Tracker"></iframe></div>`;

  const fab = root.querySelector(".fab");
  const panel = root.querySelector(".panel");
  const closeBtn = root.querySelector(".close");
  const frame = root.querySelector("iframe");

  const toggle = (open) => {
    panel.classList.toggle("open", open);
    closeBtn.classList.toggle("open", open);
    // The iframe is only given a src on first open, so a page you never
    // interact with costs nothing beyond the button itself.
    if (open && !frame.src) frame.src = chrome.runtime.getURL("popup.html");
  };
  fab.addEventListener("click", () => toggle(!panel.classList.contains("open")));
  closeBtn.addEventListener("click", () => toggle(false));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && panel.classList.contains("open")) toggle(false);
  });
}

// Job boards are single-page apps: clicking the next posting swaps the detail
// pane without a navigation, so the panel would keep showing the job you
// opened it on. Watch for the posting identity changing and tell the panel to
// re-read the page. The identity is the URL plus the detail heading, which
// covers both "?vjk=" style URL swaps and panes that change with no URL change
// at all.
function mtJobKey() {
  const h = document.querySelector(
    "[data-testid='jobsearch-RightPane'] .jobsearch-JobInfoHeader-title,"
    + ".jobsearch-JobInfoHeader-title,"
    + ".job-details-jobs-unified-top-card__job-title,"
    + "h1");
  return location.href + "::" + ((h && h.textContent) || "").replace(/\s+/g, " ").trim();
}

let mtLastKey = "";
let mtWatchTimer = null;
function mtWatchForJobChange() {
  if (mtWatchTimer) return;
  mtLastKey = mtJobKey();
  mtWatchTimer = setInterval(() => {
    const root = document.getElementById("momentum-launcher-root");
    const frame = root && root.shadowRoot && root.shadowRoot.querySelector("iframe");
    // Only worth polling while the panel is actually open and loaded.
    if (!frame || !frame.src) return;
    const key = mtJobKey();
    if (key === mtLastKey) return;
    mtLastKey = key;
    try { frame.contentWindow.postMessage({ type: "MOMENTUM_JOB_CHANGED" }, "*"); } catch { /* not ready */ }
  }, 900);
}

// Job boards are single-page apps: navigating between postings never reloads
// the document, so the launcher is re-checked on history changes as well.
function mtMaybeInject() {
  if (!mtLooksLikeJobPage()) return;
  mtInjectLauncher();
  mtWatchForJobChange();
}
mtMaybeInject();
setTimeout(mtMaybeInject, 1200);   // late-rendered JSON-LD on client-side apps
for (const evt of ["popstate", "hashchange"]) window.addEventListener(evt, mtMaybeInject);
