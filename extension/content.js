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

function extractMainContentText(root) {
  // Scored inside the posting's own pane when there is one. Without this the
  // backend's AI pass was handed the entire search page — filter bar, results
  // list and all — and asked to find the posting in it, which is a harder
  // question than it needs to be and one it sometimes got wrong.
  const scope = root || document;
  const candidates = scope.querySelectorAll("article, main, [role='main'], section, div");
  let best = null;
  let bestScore = 0;
  for (const el of candidates) {
    const score = scoreElementForContent(el);
    if (score > bestScore) { bestScore = score; best = el; }
  }
  const text = (best || (root || document.body)).innerText || "";
  return text.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, 8000);
}

function text(el) {
  return el ? el.textContent.replace(/\s+/g, " ").trim() : "";
}

// The description is the one field where layout carries meaning. textContent
// welds every element together — a bullet list comes back as
// "Build modelsShip themMeasure impact", and a filter bar as
// "Date postedEasy ApplyUnder 10 applicants" — so paragraphs, bullets and
// headings are lost before the ATS scorer or the keyword matcher ever see the
// text. innerText respects rendered line breaks, which is exactly what a job
// description needs.
function blockText(el) {
  if (!el) return "";
  const raw = el.innerText || el.textContent || "";
  return raw
    .replace(/\r/g, "")
    .replace(/[ \t\u00a0]+/g, " ")
    .split("\n").map(l => l.trim()).join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function firstMatch(selectors, accept, root, reader) {
  const scope = root || document;
  const read = reader || text;
  for (const sel of selectors) {
    try {
      const el = scope.querySelector(sel);
      const t = el ? read(el) : "";
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

// Which part of a packed metadata line is the place. Applicant counts, "2
// weeks ago", "Easy Apply" and the company name all live in the same string.
function pickLocation(line) {
  const raw = (line || "").replace(/\s+/g, " ").trim();
  if (!raw) return "";
  const parts = raw.split(/\s*[·•|]\s*/).map(x => x.trim()).filter(Boolean);
  const NOT_A_PLACE = [
    /\bago\b/i, /\bapplicants?\b/i, /\beasy apply\b/i, /\bpromoted\b/i,
    /\bviewed\b/i, /\breposted\b/i, /^\d+$/, /\bfull[- ]time\b/i, /\bpart[- ]time\b/i,
    /\bcontract\b/i, /\binternship\b/i, /\d+\s*(applicants|people)/i,
  ];
  const candidates = parts.filter(p => !NOT_A_PLACE.some(re => re.test(p)));
  // A place usually carries a comma ("London, England, United Kingdom") or is
  // one of the work-mode words a board uses in place of a city.
  const withComma = candidates.find(p => p.includes(",") && p.length <= 90);
  if (withComma) return withComma;
  const workMode = candidates.find(p => /^(remote|hybrid|on-?site)$/i.test(p));
  const named = candidates.find(p => p.length >= 3 && p.length <= 60 && /[a-z]/i.test(p));
  // The first segment is normally the company on LinkedIn's top card, so it is
  // only accepted when nothing better is on the line.
  return withComma || (named && named !== parts[0] ? named : "") || workMode || "";
}

// The URL of the posting, not of the page it happened to be read from. On a
// two-pane search page location.href is ".../jobs/search-results/?keywords=…",
// which is a search, not a job: reopening it later lands on a different set of
// results, and nothing downstream can tell two captures apart.
function canonicalJobUrl() {
  const here = location.href;
  const host = location.hostname;
  try {
    const params = new URLSearchParams(location.search);
    if (/linkedin\./i.test(host)) {
      const id = params.get("currentJobId")
        || document.querySelector(".jobs-search-results-list__list-item--active [data-job-id],"
            + " .job-card-container--active[data-job-id], li.jobs-search-results-list__list-item--active")?.dataset?.jobId
        || (document.querySelector("a[href*='/jobs/view/']")?.getAttribute("href") || "")
            .match(/\/jobs\/view\/(\d+)/)?.[1];
      if (id && !/\/jobs\/view\//.test(location.pathname)) {
        return `https://www.linkedin.com/jobs/view/${id}/`;
      }
    }
    if (/indeed\./i.test(host)) {
      const jk = params.get("vjk") || params.get("jk");
      if (jk && !/\/viewjob/i.test(location.pathname)) {
        return `${location.origin}/viewjob?jk=${jk}`;
      }
    }
  } catch { /* malformed URL — fall through to the page's own address */ }
  // A canonical link is the site telling us the posting's real address; only
  // trusted when it still looks like a posting rather than the site's root.
  const canonical = document.querySelector("link[rel='canonical']")?.href || "";
  if (canonical && /job|vacanc|career|position/i.test(canonical)) return canonical;
  return here;
}

// ---------------------------------------------------------------------------
// Telling the posting apart from the page around it
// ---------------------------------------------------------------------------
// A job board's search page is mostly not the job: filter chips, a results
// list, "people you can reach out to", promoted-jobs explainers. The old
// selector chain ended in `article, main`, which on a LinkedIn search page is
// the entire screen — so the description saved for a Deliveroo ML role opened
// with "Date posted Easy Apply Under 10 applicants In my network Jobs based on
// your preferences … 99+ results · How promoted jobs are ranked", and every
// keyword, ATS score and tailored résumé downstream was computed from that.
//
// Two defences, because either alone fails: a validator that recognises page
// furniture and refuses it, and a search that is scoped to the pane holding
// the posting rather than to the document.

const PAGE_CHROME = [
  /how promoted jobs are ranked/i,
  /jobs based on your preferences/i,
  /people you can reach out to/i,
  /\bdate posted\b/i,
  /\beasy apply\b/i,
  /\bunder \d+ applicants?\b/i,
  /\bin my network\b/i,
  /\b\d+\+? results\b/i,
  /set alert|create (a )?job alert/i,
  /sort by:?\s*(most relevant|recent)/i,
  /experience level|job type|remote\b.*\bon-?site/i,
  /skip to (main )?content/i,
  /save this (job|search)/i,
  /^\s*(filters?|all filters)\b/i,
  /show more jobs|see more jobs/i,
];

// A description has to survive two questions: does it read like page
// furniture, and is there enough of it to be a description at all.
function looksLikeDescription(t) {
  const body = (t || "").trim();
  if (body.length < 120) return false;
  const head = body.slice(0, 400);
  let hits = 0;
  for (const re of PAGE_CHROME) {
    if (re.test(head)) hits += 2;          // chrome at the very top is decisive
    else if (re.test(body)) hits += 1;
    if (hits >= 2) return false;
  }
  // A results list is mostly short lines; a description is mostly prose. This
  // catches list markup no phrase list anticipated.
  const lines = body.split("\n").filter(l => l.trim());
  if (lines.length >= 12) {
    const shortLines = lines.filter(l => l.trim().length < 32).length;
    if (shortLines / lines.length > 0.75) return false;
  }
  return true;
}

// The pane that holds the posting you are actually looking at. Found by
// climbing from the job title — whose class LinkedIn has kept stable across
// several redesigns — to the nearest ancestor that also contains a description
// block. Anchoring on structure rather than on the description's own class
// means a renamed description container still resolves, and, more importantly,
// the search can never wander into the results list beside it.
function detailPaneRoot() {
  const ANCHORS = [
    ".job-details-jobs-unified-top-card__job-title",
    ".jobs-unified-top-card__job-title",
    ".job-details-jobs-unified-top-card__company-name",
    "[data-testid='jobsearch-RightPane']",
    ".jobsearch-RightPane",
    "[data-testid='jobsearch-JobComponent']",
  ];
  const DESC_IN_PANE = "#job-details, .jobs-description__content, .jobs-description-content__text,"
    + " [class*='jobs-description'], .jobsearch-jobDescriptionText, [data-testid='jobDescriptionText'],"
    + " [class*='job-description'], [class*='JobDescription']";
  // The results list. Climbing past it means we have left the pane and are
  // looking at the whole page again.
  const RESULTS_LIST = "li.scaffold-layout__list-item, li.jobs-search-results__list-item,"
    + " ul.jobs-search-results__list, div.job_seen_beacon, [data-testid='slider_item']";

  let anchor = null;
  for (const sel of ANCHORS) {
    try { anchor = document.querySelector(sel); } catch { continue; }
    if (anchor) break;
  }
  if (!anchor) return null;

  // Preferred: the nearest ancestor that holds both the title and a known
  // description block. Precise, and cheap when the board's markup is familiar.
  if (anchor.querySelector && anchor.querySelector(DESC_IN_PANE)) return anchor;
  for (let i = 0, p = anchor.parentElement; i < 10 && p; i++, p = p.parentElement) {
    if (p.querySelector(DESC_IN_PANE)) return p;
  }

  // Fallback: no description block we recognise — which is exactly the case
  // that used to send the entire search page into the field. Climb from the
  // title as far as possible WITHOUT swallowing the results list. Whatever
  // that is, it is the pane holding this posting and nothing else, whether or
  // not we know what its children are called.
  let widest = null;
  for (let p = anchor; p && p !== document.body; p = p.parentElement) {
    if (p.querySelector(RESULTS_LIST)) break;
    widest = p;
  }
  return widest;
}

// Is this a results list rather than one posting's own page? On a listing page
// the whole-document fallbacks (`article`, `main`) are guaranteed to be wrong,
// so they are simply not offered.
function isListingPage() {
  if (/\/jobs\/(search|search-results|collections)/i.test(location.pathname)) return true;
  if (/[?&](keywords|q)=/i.test(location.search) && !/\/jobs\/view\//i.test(location.pathname)) return true;
  return document.querySelectorAll(
    "li.scaffold-layout__list-item, li.jobs-search-results__list-item, div.job_seen_beacon"
  ).length > 3;
}

// When the description is read from the pane rather than from a known
// container, it opens with the top card: the role, the employer, the
// "· 2 weeks ago · Over 100 applicants" line. All three are already captured
// as their own fields, and repeating them at the top of the description skews
// every keyword count that follows.
function dropRepeatedHeader(body, known) {
  const lines = (body || "").split("\n");
  const same = (line, value) => {
    const a = line.trim().toLowerCase();
    const b = (value || "").trim().toLowerCase();
    return !!b && (a === b || (a.length < 90 && a.includes(b) && a.length - b.length < 40));
  };
  let start = 0;
  while (start < lines.length && start < 8) {
    const line = lines[start].trim();
    if (!line) { start++; continue; }
    const isHeader = same(line, known.role) || same(line, known.company) || same(line, known.location)
      || /·/.test(line) && /(ago|applicants?|promoted|viewed)/i.test(line);
    if (!isHeader) break;
    start++;
  }
  return lines.slice(start).join("\n").trim();
}

// Whatever the source, a description can still arrive with a band of interface
// copy welded to the front. Drop leading lines that are page furniture until a
// line looks like the posting itself.
function stripLeadingChrome(body) {
  const lines = (body || "").split("\n");
  let start = 0;
  while (start < lines.length && start < 12) {
    const line = lines[start].trim();
    if (!line) { start++; continue; }
    const isChrome = PAGE_CHROME.some(re => re.test(line))
      || /^(about the job|job description|full job description|the role|overview)\s*:?$/i.test(line);
    // A heading like "About the job" is furniture too, but a useful marker:
    // everything above it belongs to the page, not the posting.
    if (isChrome) { start++; continue; }
    break;
  }
  return lines.slice(start).join("\n").trim();
}

function scrapeJobPostingOnce() {
  const host = location.hostname.replace(/^www\./, "");
  const isLinkedIn = host.includes("linkedin");
  const titleGuess = isLinkedIn ? parseLinkedInTitle(document.title) : null;
  // Structured data first — it is the only source that is stated rather than
  // inferred, so anything it gives us outranks a CSS guess.
  const ld = extractJobPostingJsonLd() || microdataJobPosting() || {};
  // The pane holding the posting that is actually open. Every CSS guess below
  // is tried inside it first, so on a two-pane search page the results list
  // beside the posting can never answer for it.
  const pane = detailPaneRoot();

  const ROLE_SELECTORS = [
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
  ];
  const roleTitle = ld.role
    || firstMatch(ROLE_SELECTORS, looksLikeRole, pane, text)
    || firstMatch(ROLE_SELECTORS, looksLikeRole, document, text)
    || titleGuess?.role || metaContent(["og:title"]) || cleanDocumentTitle(document.title, host);

  const COMPANY_SELECTORS = [
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
  ];
  let companyName = ld.company
    || firstMatch(COMPANY_SELECTORS, null, pane, text)
    || firstMatch(COMPANY_SELECTORS, null, document, text);
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

  const LOC_SELECTORS = [
    ".job-details-jobs-unified-top-card__primary-description-container",
    ".jobs-unified-top-card__primary-description",
    ".jobs-unified-top-card__bullet",
    ".topcard__flavor--bullet",
    "[data-testid='jobsearch-JobInfoHeader-companyLocation']",
    "[data-testid='inlineHeader-companyLocation']",
    "[class*='job-location']",
    "[class*='JobLocation']",
  ];
  // LinkedIn's top card is one line holding several facts:
  //   "Deliveroo · London, England, United Kingdom · 2 weeks ago · Over 100 applicants"
  // Saving that whole string as the Location made the field useless for
  // filtering and for anything downstream that groups by place, so the parts
  // are separated and the one that is actually a place is kept.
  const location_ = ld.location
    || pickLocation(firstMatch(LOC_SELECTORS, null, pane, text))
    || pickLocation(firstMatch(LOC_SELECTORS, null, document, text))
    || titleGuess?.location || "";

  // Description selectors, most specific first. Tried inside the posting's own
  // pane before being tried against the document, so a results list next to the
  // posting can never win.
  const DESC_SELECTORS = [
    "#job-details",
    ".jobs-description__content .jobs-box__html-content",
    ".jobs-box__html-content",
    ".jobs-description-content__text--stretch",
    ".jobs-description-content__text",
    ".jobs-description__container",
    ".jobs-description__content",
    "[class*='jobs-description']",
    ".jobsearch-jobDescriptionText",
    "[data-testid='jobDescriptionText']",
    "[class*='job-description']",
    "[class*='JobDescription']",
    "[data-automation='jobAdDetails']",
    "[itemprop='description']",
  ];

  const description =
    ld.description
    // Scoped to the open posting. This is the path that matters on a job
    // board's two-pane search page, which is where most captures happen.
    || (pane ? firstMatch(DESC_SELECTORS, looksLikeDescription, pane, blockText) : "")
    || firstMatch(DESC_SELECTORS, looksLikeDescription, document, blockText)
    // No known container matched, but we do know which pane the posting lives
    // in — so read the pane itself. This is what keeps a capture working the
    // day a board renames its description class, which is the failure that
    // sent the whole search page into the field in the first place.
    || (pane && looksLikeDescription(blockText(pane)) ? blockText(pane) : "")
    // Whole-page fallbacks, for a company careers page that is one posting and
    // nothing else. Never offered on a results list, where they would return
    // the filter bar and every card on screen.
    || (isListingPage() ? "" : firstMatch(["article", "main"], looksLikeDescription, document, blockText))
    || metaContent(["og:description"]);

  // Indeed prefixes the description with its own profile-match blurb, which is
  // interface copy, not the employer's text — and it would otherwise be fed to
  // the keyword matcher and the ATS scorer as if it were part of the posting.
  const DESC_PREAMBLE = [
    /^here'?s how the job details align with your (profile|job preferences)\.?/i,
    /^pulled from the full job description\.?/i,
    /^job details\.?/i,
  ];
  // Whichever route the text arrived by — a pane read wholesale, a careers
  // page's <main>, a container that happened to include the top card — it can
  // open with the role, the employer and the posting's metadata line. Those
  // are already captured as their own fields, and repeating them at the top of
  // the description skews every keyword count drawn from it.
  let cleanedDescription = stripLeadingChrome(
    dropRepeatedHeader((description || "").trim(),
      { role: roleTitle, company: companyName, location: location_ }));
  for (let i = 0; i < DESC_PREAMBLE.length + 2; i++) {
    const before = cleanedDescription;
    for (const re of DESC_PREAMBLE) cleanedDescription = cleanedDescription.replace(re, "").trim();
    if (cleanedDescription === before) break;
  }
  // A last-ditch og:description or a stubborn pane can still be furniture; an
  // empty description is a better outcome than a wrong one, because the popup
  // says so and offers the field for editing, whereas wrong text is saved,
  // scored and tailored against in silence.
  if (cleanedDescription && !looksLikeDescription(cleanedDescription)) cleanedDescription = "";

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
    job_link: canonicalJobUrl(),
    source,
    // Extra context for backend AI-assisted extraction — a general-purpose
    // readability-style dump, not tied to this site's specific markup, so
    // the backend can double-check/improve on the guesses above for ANY
    // job site, including ones with no matching selectors at all.
    raw_text: extractMainContentText(pane),
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
        background: #0E9384; box-shadow: 0 6px 22px rgba(14,147,132,.38);
        display: flex; align-items: center; justify-content: center;
        transition: transform .14s ease, box-shadow .14s ease;
      }
      .fab:hover { transform: translateY(-2px); box-shadow: 0 10px 28px rgba(20,16,60,.44); }
      .fab img { width: 30px; height: auto; display: block; }
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
      <img src="${chrome.runtime.getURL("icons/mark-light.png")}" alt="" aria-hidden="true">
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
