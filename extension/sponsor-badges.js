// ============================================================================
// Momentum Tracker extension — in-page visa-sponsorship tags
// ============================================================================
// The popup already answers "can this employer sponsor?" for the one posting
// you have open. That answer arrives too late to be useful: by the time you
// open a job you have already spent the click. This puts the same answer on
// the cards themselves, so a results list can be read for sponsorship at a
// glance, and adds the two ways of acting on it that people actually want —
// fade the non-sponsors, or take them off the page entirely.
//
// Three things shape the code below:
//
// 1. IT MUST NOT BREAK THE HOST PAGE. Everything injected carries an
//    mt-spon-* class, every rule is scoped to those classes, and the only
//    property ever written to a site's own element is `position: relative`
//    on a card that was static (an absolutely-positioned tag needs a
//    containing block, and cards are self-contained boxes where this is
//    invisible). Dim and hide are classes, so switching modes puts the page
//    back exactly as it was.
//
// 2. ONE REQUEST PER SCREEN, NOT ONE PER CARD. Names are de-duplicated,
//    cached for the life of the tab, and sent in a single batch.
//
// 3. IT SHARES A SCOPE WITH content.js. Chrome runs every content script from
//    one extension in the same isolated world, so a top-level `const` here
//    would collide with the same name there and kill both files. Hence the
//    IIFE — nothing in this file exists outside it.

(() => {
  "use strict";

  // A second injection (chrome.scripting.executeScript on a tab that already
  // has the script) would start a second observer and double every tag.
  if (window.__momentumSponsorBadges) return;
  window.__momentumSponsorBadges = true;

  const TAG_CLASS = "mt-spon-tag";
  const STYLE_ID = "mt-spon-style";
  const SETTINGS_KEY = "sponsorBadges";
  const DEFAULTS = { enabled: true, mode: "badge" };   // badge | dim | hide

  let settings = { ...DEFAULTS };
  let stopped = false;          // signed out, backend unreachable, or switched off
  let failures = 0;             // consecutive failed batches
  let scanTimer = null;
  let observer = null;
  let sweeper = null;

  // ---------------------------------------------------------------------------
  // Where the cards are
  // ---------------------------------------------------------------------------
  // `cards` finds the row containers, `company` finds the employer inside one,
  // and `detail` is the single header on a job's own page. `requires` is a
  // sanity check for sites whose list markup is shared with unrelated lists
  // (LinkedIn uses the same <li> class for messaging threads).
  const SITES = [
    {
      host: /(^|\.)linkedin\./,
      cards: [
        "li.scaffold-layout__list-item",
        "li.jobs-search-results__list-item",
        "div.job-card-job-posting-card-wrapper",
        "div.job-card-container",
        "li.discovery-templates-entity-item",
      ],
      requires: "a[href*='/jobs/view/'], a[href*='/jobs/collections/'], [data-job-id]",
      company: [
        ".artdeco-entity-lockup__subtitle",
        ".job-card-container__primary-description",
        ".job-card-container__company-name",
        ".job-card-list__company-name",
        ".job-card-square__subtitle",
        "[class*='company-name']",
        "[class*='subtitle']",
      ],
      detail: [
        ".job-details-jobs-unified-top-card__company-name a",
        ".job-details-jobs-unified-top-card__company-name",
        ".jobs-unified-top-card__company-name a",
        ".jobs-unified-top-card__company-name",
        "a.topcard__org-name-link",
        "a[data-tracking-control-name='public_jobs_topcard-org-name']",
      ],
    },
    {
      host: /(^|\.)indeed\./,
      cards: [
        "div.job_seen_beacon",
        "[data-testid='slider_item']",
        "ul.jobsearch-ResultsList > li",
        "td.resultContent",
      ],
      company: [
        "[data-testid='company-name']",
        "span.companyName",
        "[class*='companyName']",
      ],
      detail: [
        "[data-testid='inlineHeader-companyName'] a",
        "[data-testid='inlineHeader-companyName']",
        "[data-testid='jobsearch-CompanyInfoContainer'] a",
        "div.jobsearch-InlineCompanyRating a",
      ],
    },
    {
      host: /(^|\.)glassdoor\./,
      cards: ["li[data-test='jobListing']", "li.react-job-listing", "[class*='JobCard_jobCardWrapper']"],
      company: ["[class*='EmployerProfile_compactEmployerName']", "[data-test='employer-short-name']",
                "[class*='employer-name']", "[class*='EmployerName']"],
      detail: ["[data-test='employerName']", "[class*='EmployerProfile_employerName']"],
    },
    {
      host: /(^|\.)reed\.co\.uk/,
      cards: ["article.job-card_jobCard__MkcJD", "article[class*='job-card']", "div.job-result-card"],
      company: ["[class*='job-card_jobResultHeading__postedBy']", "[class*='posted-by']", ".gtmJobListingPostedBy"],
      detail: ["[class*='job-header_jobHeaderCompanyName']", "span[itemprop='hiringOrganization']", ".company-name"],
    },
    {
      host: /(^|\.)totaljobs\.|(^|\.)cv-library\.|(^|\.)jobsite\./,
      cards: ["article[data-genesys-element*='job']", "div[data-at='job-item']", "article.job", "li.job"],
      company: ["[data-at='job-item-company-name']", "[class*='company']", ".job__company"],
      detail: ["[data-at='metadata-company-name']", "[class*='company-name']", "[itemprop='hiringOrganization']"],
    },
  ];

  // Boards with no entry above still get the header tag, and card tags through
  // the generic selectors, as long as the page is recognisably a job board.
  const GENERIC = {
    cards: [
      "[class*='job-card']", "[class*='jobCard']", "[data-testid*='job-card']",
      "article[class*='job']", "li[class*='job-result']", "li[class*='search-result']",
    ],
    company: [
      "[itemprop='hiringOrganization']", "[data-testid*='company']",
      "[class*='company-name']", "[class*='companyName']", "[class*='employer']",
    ],
    detail: [
      "[itemprop='hiringOrganization']", "[data-testid*='company-name']",
      "[class*='company-name']", "[class*='CompanyName']",
    ],
  };

  const GENERIC_HOSTS = /(^|\.)(ziprecruiter\.|monster\.|jobserve\.|adzuna\.|otta\.|welcometothejungle\.|seek\.com|irishjobs\.|greenhouse\.|lever\.co|ashbyhq\.|smartrecruiters\.|workable\.|teamtailor\.|myworkdayjobs\.)/;

  function siteConfig() {
    const host = location.hostname.toLowerCase();
    for (const site of SITES) if (site.host.test(host)) return site;
    if (GENERIC_HOSTS.test(host)) return GENERIC;
    // Anything else is only worth touching if the page says it is a job
    // posting — the same JobPosting test content.js uses for its launcher.
    for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
      if ((s.textContent || "").includes("JobPosting")) return GENERIC;
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Reading a company name off a card
  // ---------------------------------------------------------------------------
  // LinkedIn renders the same text twice — once for sighted users, once for
  // screen readers — so textContent on a subtitle comes back as
  // "SpotifySpotify". The aria-hidden copy is the visible one; prefer it, then
  // undouble whatever is left as a belt-and-braces measure.
  function elementText(el) {
    if (!el) return "";
    const visible = el.querySelector("[aria-hidden='true']");
    const raw = (visible && visible.textContent) || el.textContent || "";
    return undouble(raw.replace(/\s+/g, " ").trim());
  }

  function undouble(s) {
    if (s.length > 3 && s.length % 2 === 0) {
      const half = s.length / 2;
      if (s.slice(0, half) === s.slice(half)) return s.slice(0, half);
    }
    // "Spotify Spotify" — the same trick with a space between the halves.
    const spaced = s.match(/^(.+) \1$/);
    return spaced ? spaced[1] : s;
  }

  // Cards pack the employer in with everything else: "Spotify · London,
  // England (Hybrid)", "Bloomberg — 4.1★". Only unambiguous separators are
  // split on; a hyphen is left alone because plenty of firms have one in their
  // registered name.
  function cleanCompany(raw) {
    let s = (raw || "").replace(/\s+/g, " ").trim();
    if (!s) return "";
    s = s.split(/\s*[·•|]\s*/)[0];
    s = s.split(/\s+\d[\d.,]*\s*(?:★|out of 5)/)[0];
    s = s.replace(/^(?:at|by|company|employer|posted by)\s+/i, "");
    s = s.replace(/\s*\((?:hybrid|remote|on-?site)\)\s*$/i, "");
    s = s.replace(/[·•|,;]+$/, "").trim();
    // A subtitle that turned out to be a sentence, a location, or a stray
    // aria-label is not a company name and must not be looked up.
    if (s.length < 2 || s.length > 90) return "";
    if (/^(remote|hybrid|on-?site|full[- ]time|part[- ]time|contract|internship)$/i.test(s)) return "";
    return s;
  }

  function findIn(root, selectors) {
    for (const sel of selectors) {
      let el;
      try { el = root.querySelector(sel); } catch { continue; }
      const name = cleanCompany(elementText(el));
      if (name) return { el, name };
    }
    return null;
  }

  // A card matched by two selectors at once (LinkedIn's <li> and the
  // .job-card-container inside it) must be tagged once. The outermost wins:
  // it is the row, so hide mode removes the whole row rather than leaving an
  // empty frame behind.
  function collectCards(config) {
    const found = [];
    for (const sel of config.cards) {
      let list;
      try { list = document.querySelectorAll(sel); } catch { continue; }
      for (const el of list) found.push(el);
    }
    const set = new Set(found);
    return found.filter((el, i) => {
      if (found.indexOf(el) !== i) return false;           // same node, two selectors
      if (config.requires && !el.querySelector(config.requires)) return false;
      for (let p = el.parentElement; p; p = p.parentElement) if (set.has(p)) return false;
      return true;
    });
  }

  // ---------------------------------------------------------------------------
  // Lookups
  // ---------------------------------------------------------------------------
  // Cached for the tab's lifetime. The register changes at most daily and a
  // results list revisits the same employers constantly as it re-renders.
  const cache = new Map();          // lookup key -> result object
  const inFlight = new Set();
  let queue = new Set();
  let queueTimer = null;

  const keyFor = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

  function request(name) {
    const key = keyFor(name);
    if (!key || cache.has(key) || inFlight.has(key)) return;
    queue.add(name);
    clearTimeout(queueTimer);
    // Long enough to collect a whole screen of cards as they render, short
    // enough that tags feel like part of the page loading.
    queueTimer = setTimeout(flushQueue, 220);
  }

  async function flushQueue() {
    if (stopped || !queue.size) return;
    const names = Array.from(queue).slice(0, 40);
    queue = new Set(Array.from(queue).slice(40));
    names.forEach(n => inFlight.add(keyFor(n)));

    let res;
    try {
      res = await chrome.runtime.sendMessage({
        type: "MOMENTUM_SPONSOR_CHECK_BULK",
        payload: { companies: names },
      });
    } catch {
      // Extension reloaded/updated under this tab — the old context is dead
      // and every later call would throw too.
      halt({ clean: true });
      return;
    } finally {
      names.forEach(n => inFlight.delete(keyFor(n)));
    }

    if (!res?.ok) {
      // 401 is "not signed in": no amount of retrying fixes it, and the tags
      // already on the page were fetched with a token that is gone, so they
      // come off. A backend that is simply down or slow gets a few tries and
      // is then left alone — the sweeper would otherwise poll it forever —
      // and whatever is already painted stays, because it was true when it
      // was fetched.
      if (res?.status === 401) halt({ clean: true });
      else if (++failures >= 3) halt({ clean: false });
      return;
    }
    failures = 0;

    const results = res.data?.results || {};
    for (const name of names) {
      const answer = results[name];
      // Remember misses too, so a name the register can't answer isn't asked
      // about again every time the list re-renders.
      cache.set(keyFor(name), answer || { status: "unknown" });
    }
    if (queue.size) setTimeout(flushQueue, 60);
    scan();
  }

  // ---------------------------------------------------------------------------
  // Painting
  // ---------------------------------------------------------------------------
  function verdictOf(answer) {
    const s = answer?.status;
    if (s === "licensed") return "yes";
    if (s === "possible") return "maybe";
    if (s === "not_found") return "no";
    return "unknown";                                    // register not synced
  }

  function tagText(verdict) {
    return verdict === "yes" ? "UK Visa Sponsor" : "Likely Visa Sponsor";
  }

  function tagTitle(answer, verdict) {
    const matched = answer?.matched_name ? `Register entry: ${answer.matched_name}` : "";
    const routes = answer?.routes ? `\nRoutes: ${answer.routes}` : "";
    const hedge = verdict === "maybe"
      ? `\nName is a ${answer?.confidence ?? ""}% match — worth confirming.`
      : "";
    return `${matched}${routes}${hedge}\n\nFrom the Home Office register of licensed worker `
      + `sponsors. A licence means the employer can sponsor, not that this role does.`;
  }

  function makeTag(answer, verdict, inline) {
    const tag = document.createElement("span");
    tag.className = `${TAG_CLASS} mt-spon-${verdict}${inline ? " mt-spon-inline" : ""}`;
    tag.textContent = tagText(verdict);
    tag.title = tagTitle(answer, verdict);
    return tag;
  }

  function clearTag(host) {
    const old = host.querySelector(`:scope > .${TAG_CLASS}`);
    if (old) old.remove();
  }

  function paintCard(card, name, answer) {
    const verdict = verdictOf(answer);
    card.dataset.mtSponCompany = name;
    card.dataset.mtSpon = verdict;

    clearTag(card);
    card.classList.remove("mt-spon-dim", "mt-spon-off");

    // Only a positive answer earns a tag. A grey "not on the register" pill on
    // every other card is noise, and the dim/hide modes below already say it
    // more usefully for anyone who wants that distinction.
    if (verdict === "yes" || verdict === "maybe") {
      if (getComputedStyle(card).position === "static") card.style.position = "relative";
      card.appendChild(makeTag(answer, verdict, false));
    } else if (verdict === "no") {
      if (settings.mode === "dim") card.classList.add("mt-spon-dim");
      if (settings.mode === "hide") card.classList.add("mt-spon-off");
    }
  }

  function paintHeader(el, name, answer) {
    const verdict = verdictOf(answer);
    const host = el.parentElement;
    if (!host) return;
    const existing = host.querySelector(`:scope > .${TAG_CLASS}`);
    // The sweeper comes back every couple of seconds; re-inserting an
    // identical tag each time would flicker for no reason.
    if (host.dataset.mtSponCompany === name
        && !!existing === (verdict === "yes" || verdict === "maybe")
        && (!existing || existing.classList.contains(`mt-spon-${verdict}`))) return;
    host.dataset.mtSponCompany = name;
    if (existing) existing.remove();
    if (verdict !== "yes" && verdict !== "maybe") return;
    el.insertAdjacentElement("afterend", makeTag(answer, verdict, true));
  }

  // ---------------------------------------------------------------------------
  // The scan
  // ---------------------------------------------------------------------------
  function scan() {
    if (stopped || !settings.enabled) return;
    const config = siteConfig();
    if (!config) return;

    for (const card of collectCards(config)) {
      const hit = findIn(card, config.company);
      if (!hit) continue;
      const answer = cache.get(keyFor(hit.name));
      if (!answer) {
        // A virtualised list recycles card nodes: the same <li> that showed
        // Spotify a moment ago now shows a different employer, and its old tag
        // would be a lie until the new answer lands. Clear it, then ask.
        if (card.dataset.mtSponCompany && card.dataset.mtSponCompany !== hit.name) {
          clearTag(card);
          card.classList.remove("mt-spon-dim", "mt-spon-off");
          delete card.dataset.mtSpon;
          delete card.dataset.mtSponCompany;
        }
        request(hit.name);
        continue;
      }
      const painted = card.dataset.mtSponCompany === hit.name && card.dataset.mtSpon;
      if (painted && painted === verdictOf(answer) && modeApplied(card, painted)) continue;
      paintCard(card, hit.name, answer);
    }

    const header = findIn(document, config.detail);
    if (header) {
      const answer = cache.get(keyFor(header.name));
      if (!answer) request(header.name);
      else paintHeader(header.el, header.name, answer);
    }
  }

  // Has the current display mode actually been applied to this card? Switching
  // modes has to repaint even though the verdict itself hasn't changed.
  function modeApplied(card, verdict) {
    if (verdict !== "no") return true;
    const dim = card.classList.contains("mt-spon-dim");
    const off = card.classList.contains("mt-spon-off");
    return (settings.mode === "dim") === dim && (settings.mode === "hide") === off;
  }

  function scheduleScan(delay = 350) {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(scan, delay);
  }

  // Undo everything: used when the feature is switched off, and when the
  // extension context dies. The page has to come back exactly as it was.
  function removeAll() {
    document.querySelectorAll(`.${TAG_CLASS}`).forEach(el => el.remove());
    document.querySelectorAll("[data-mt-spon], [data-mt-spon-company]").forEach(el => {
      el.classList.remove("mt-spon-dim", "mt-spon-off");
      delete el.dataset.mtSpon;
      delete el.dataset.mtSponCompany;
    });
  }

  // Stop working. `clean` decides whether the page is also put back as it
  // was: switching the feature off or losing the session means the tags must
  // go, while giving up on an unreachable backend does not invalidate tags
  // that were correct when they were drawn.
  function halt({ clean }) {
    stopped = true;
    clearTimeout(scanTimer);
    clearTimeout(queueTimer);
    queue = new Set();
    if (observer) { observer.disconnect(); observer = null; }
    if (sweeper) { clearInterval(sweeper); sweeper = null; }
    if (clean) removeAll();
  }

  // ---------------------------------------------------------------------------
  // Styles
  // ---------------------------------------------------------------------------
  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    // !important throughout: these rules land in the middle of a job board's
    // own stylesheet, and a card list will happily restyle a bare <span>.
    style.textContent = `
      .${TAG_CLASS} {
        position: absolute !important; top: 4px !important; left: 4px !important;
        z-index: 20 !important; pointer-events: auto !important;
        display: inline-block !important; max-width: calc(100% - 8px) !important;
        padding: 2px 7px !important; border-radius: 5px !important;
        font: 700 10.5px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif !important;
        letter-spacing: .01em !important; white-space: nowrap !important;
        overflow: hidden !important; text-overflow: ellipsis !important;
        text-transform: none !important; text-decoration: none !important;
        box-shadow: 0 1px 3px rgba(16,20,40,.22) !important;
      }
      .${TAG_CLASS}.mt-spon-yes { background: #16A34A !important; color: #fff !important; }
      .${TAG_CLASS}.mt-spon-maybe { background: #D97706 !important; color: #fff !important; }
      .${TAG_CLASS}.mt-spon-inline {
        position: static !important; margin: 0 0 0 8px !important;
        vertical-align: middle !important; box-shadow: none !important;
      }
      .mt-spon-dim {
        opacity: .42 !important; filter: grayscale(.55) !important;
        transition: opacity .15s ease !important;
      }
      .mt-spon-dim:hover { opacity: .9 !important; }
      .mt-spon-off { display: none !important; }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  // ---------------------------------------------------------------------------
  // Wiring
  // ---------------------------------------------------------------------------
  function isOurNode(n) {
    return n.nodeType === 1 && n.classList && n.classList.contains(TAG_CLASS);
  }

  // Our own insertions mutate the page, which would wake the observer, which
  // would scan, which would insert… Records that only concern our own tags
  // are ignored, which breaks that loop at the source.
  function mutationsMatter(records) {
    for (const r of records) {
      const added = Array.from(r.addedNodes);
      const removed = Array.from(r.removedNodes);
      if (!added.length && !removed.length) continue;
      if (added.every(isOurNode) && removed.every(isOurNode)) continue;
      return true;
    }
    return false;
  }

  function start() {
    if (stopped || !settings.enabled) return;
    if (!siteConfig()) return;
    injectStyle();
    scan();
    if (!observer) {
      observer = new MutationObserver(records => {
        if (mutationsMatter(records)) scheduleScan();
      });
      observer.observe(document.body || document.documentElement,
        { childList: true, subtree: true });
    }
    // Backstop for the things an observer misses: a virtualised list that
    // recycles nodes in place, and a tab that was in the background while its
    // results loaded.
    if (!sweeper) {
      sweeper = setInterval(() => {
        if (document.visibilityState === "visible") scan();
      }, 2500);
    }
  }

  function applySettings(next) {
    const was = settings;
    settings = { ...DEFAULTS, ...(next || {}) };
    if (!settings.enabled) { halt({ clean: true }); return; }
    if (settings.mode !== was.mode) {
      // A mode change only affects how non-sponsors are drawn, and every
      // verdict is already cached — repaint from memory, no new requests.
      document.querySelectorAll("[data-mt-spon]").forEach(el => {
        el.classList.remove("mt-spon-dim", "mt-spon-off");
      });
    }
    // Touching the setting is also the way back from a halt: a backend that
    // was down when the tab loaded gets another chance without a reload.
    stopped = false;
    failures = 0;
    start();
  }

  chrome.storage.local.get([SETTINGS_KEY], (stored) => {
    applySettings(stored?.[SETTINGS_KEY]);
  });

  // The popup writes the setting and every open tab picks it up here — no
  // message plumbing, and tabs opened later read the same value on load.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes[SETTINGS_KEY]) applySettings(changes[SETTINGS_KEY].newValue);
    // Signing in or out changes whether lookups can be answered at all — and
    // a sign-out will have halted everything, so this restarts rather than
    // just scheduling a scan into a torn-down observer.
    if (changes.token) {
      cache.clear();
      failures = 0;
      stopped = false;
      if (settings.enabled) start();
    }
  });

  // Job boards are single-page apps: the results list is replaced without a
  // navigation, and a card recycled for a different job keeps its old tag
  // until the next scan.
  for (const evt of ["popstate", "hashchange"]) {
    window.addEventListener(evt, () => scheduleScan(600));
  }
})();
