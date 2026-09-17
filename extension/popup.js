// ============================================================================
// Momentum Tracker extension — popup logic
// ============================================================================

function send(msg) {
  return new Promise((resolve) => chrome.runtime.sendMessage(msg, resolve));
}

const els = {
  login: document.getElementById("view-login"),
  main: document.getElementById("view-main"),
  settingsBtn: document.getElementById("settings-btn"),
  loginEmail: document.getElementById("login-email"),
  loginPassword: document.getElementById("login-password"),
  loginBtn: document.getElementById("login-btn"),
  loginStatus: document.getElementById("login-status"),
  userEmail: document.getElementById("user-email"),
  logoutBtn: document.getElementById("logout-btn"),
  previewRole: document.getElementById("preview-role"),
  previewCompany: document.getElementById("preview-company"),
  previewLocation: document.getElementById("preview-location"),
  scrapeWarning: document.getElementById("scrape-warning"),
  previewUrl: document.getElementById("preview-url"),
  previewUrlOpen: document.getElementById("preview-url-open"),
  jobDescription: document.getElementById("job-description"),
  keywordList: document.getElementById("keyword-list"),
  boardSelect: document.getElementById("board-select"),
  hdrRole: document.getElementById("hdr-role"),
  hdrSub: document.getElementById("hdr-sub"),
  jobLogo: document.getElementById("job-logo"),
  atsCheckBtn: document.getElementById("ats-check-btn"),
  atsResult: document.getElementById("ats-result"),
  atsScoreVal: document.getElementById("ats-score-val"),
  atsVerdict: document.getElementById("ats-verdict"),
  atsBarFill: document.getElementById("ats-bar-fill"),
  atsMissing: document.getElementById("ats-missing"),
  sponBadge: document.getElementById("spon-badge"),
  sponEnabled: document.getElementById("spon-enabled"),
  sponMode: document.getElementById("spon-mode"),
  sponHint: document.getElementById("spon-hint"),
  sponRegister: document.getElementById("spon-register"),
  sponRefresh: document.getElementById("spon-refresh"),
  quotaPill: document.getElementById("quota-pill"),
  upgradeVeil: document.getElementById("upgrade-veil"),
  upgradeTitle: document.getElementById("upgrade-title"),
  upgradeReset: document.getElementById("upgrade-reset"),
  upgradeBtn: document.getElementById("upgrade-btn"),
  upgradeDismiss: document.getElementById("upgrade-dismiss"),
  aiRefineStatus: document.getElementById("ai-refine-status"),
  resumeSelect: document.getElementById("resume-select"),
  resumeRefreshBtn: document.getElementById("resume-refresh-btn"),
  resumeStatus: document.getElementById("resume-status"),
  autofillBtn: document.getElementById("autofill-btn"),
  generateResumeBtn: document.getElementById("generate-resume-btn"),
  generateCoverLetterBtn: document.getElementById("generate-cover-letter-btn"),
  chkTailor: document.getElementById("chk-tailor"),
  chkCover: document.getElementById("chk-cover"),
  captureBtn: document.getElementById("capture-btn"),
  captureStatus: document.getElementById("capture-status"),
  resultsSection: document.getElementById("results-section"),
  resumeResult: document.getElementById("resume-result"),
  resumeDownloadBtn: document.getElementById("resume-download-btn"),
  resumeDlName: document.getElementById("resume-dl-name"),
  coverLetterResult: document.getElementById("cover-letter-result"),
  coverLetterText: document.getElementById("cover-letter-text"),
  copyCoverLetterBtn: document.getElementById("copy-cover-letter-btn"),
  downloadCoverLetterBtn: document.getElementById("download-cover-letter-btn"),
};

function showOnly(view) {
  [els.login, els.main].forEach(v => v.classList.add("hidden"));
  view.classList.remove("hidden");
}

let scrapedJob = null;
let resumesById = {};
let currentApiBase = "http://localhost:8000";

function currentJobFields() {
  return {
    role_title: els.previewRole.value.trim(),
    company_name: els.previewCompany.value.trim(),
    location: els.previewLocation.value.trim(),
    job_description: descriptionText(),
  };
}

function selectedResumeId() {
  return els.resumeSelect.value ? Number(els.resumeSelect.value) : null;
}

async function loadResumes() {
  els.resumeStatus.classList.add("hidden");
  els.resumeSelect.innerHTML = `<option value="">Loading...</option>`;
  const res = await send({ type: "MOMENTUM_LIST_RESUMES" });

  if (res?.ok) {
    resumesById = {};
    if (res.data.length) {
      els.resumeSelect.innerHTML =
        `<option value="">No resume linked</option>` +
        res.data.map(r => {
          resumesById[r.id] = r;
          return `<option value="${r.id}">${r.name}${r.template_id ? "" : " (uploaded file)"}</option>`;
        }).join("");
    } else {
      els.resumeSelect.innerHTML = `<option value="">No resume linked</option>`;
      els.resumeStatus.textContent = "No resumes found on your account yet — add one on the Resumes or Resume Builder page.";
      els.resumeStatus.className = "status info";
      els.resumeStatus.classList.remove("hidden");
    }
    updateGenerateButtonsState();
    return;
  }

  els.resumeSelect.innerHTML = `<option value="">No resume linked</option>`;
  if (res?.status === 401) {
    await chrome.storage.local.remove(["token", "user"]);
    showOnly(els.login);
    return;
  }
  els.resumeStatus.textContent = `Couldn't load resumes: ${res?.error || "unknown error"}`;
  els.resumeStatus.className = "status err";
  els.resumeStatus.classList.remove("hidden");
}

function updateGenerateButtonsState() {
  const id = selectedResumeId();
  const resume = id ? resumesById[id] : null;
  els.generateCoverLetterBtn.disabled = !resume;
  els.generateResumeBtn.disabled = !resume || !resume.template_id;
  els.generateResumeBtn.title = (resume && !resume.template_id)
    ? "This resume was uploaded as a file — tailoring only works on resumes made with the Resume Builder."
    : "";
}

async function refineWithAI() {
  if (!scrapedJob?.raw_text) return;
  els.aiRefineStatus.textContent = "✨ AI refining...";
  const res = await send({
    type: "MOMENTUM_EXTRACT",
    payload: {
      raw_text: scrapedJob.raw_text,
      title: scrapedJob.page_title || "",
      url: scrapedJob.page_url || "",
      hint_role: els.previewRole.value.trim(),
      hint_company: els.previewCompany.value.trim(),
      hint_location: els.previewLocation.value.trim(),
    },
  });
  if (!res?.ok) {
    els.aiRefineStatus.textContent = "";
    return; // silent — the quick client-side guess is still in the fields
  }
  const d = res.data;
  // Only overwrite a field if the AI actually found something for it —
  // never blank out a field the quick guess already filled correctly.
  if (d.role_title) els.previewRole.value = d.role_title;
  if (d.company_name) els.previewCompany.value = d.company_name;
  if (d.location) els.previewLocation.value = d.location;
  if (d.job_description && d.job_description.length > (scrapedJob.job_description || "").length) {
    scrapedJob.job_description = d.job_description;
  }
  if (d.salary_range) scrapedJob.salary_range = d.salary_range;
  if (d.job_description) setDescription(scrapedJob.job_description);
  renderHeader();
  renderKeywords(descriptionText());
  els.aiRefineStatus.textContent = d.mode === "llm" ? "✨ AI-refined" : "✨ Refined";
  setTimeout(() => { els.aiRefineStatus.textContent = ""; }, 4000);

  if (els.previewCompany.value && els.previewRole.value) {
    els.scrapeWarning.classList.add("hidden");
  }
}

async function init() {
  const { apiBase, token, user } = await chrome.storage.local.get(["apiBase", "token", "user"]);
  currentApiBase = apiBase || (typeof MOMENTUM_DEFAULT_API_BASE !== "undefined" ? MOMENTUM_DEFAULT_API_BASE : "") || "http://localhost:8000";

  if (!token) {
    showOnly(els.login);
    els.loginStatus.textContent = `Backend: ${currentApiBase}`;
    els.loginStatus.className = "status info";
    return;
  }

  showOnly(els.main);
  els.userEmail.textContent = user?.email || "Logged in";
  els.resultsSection.classList.add("hidden");
  els.captureStatus.textContent = "";
  els.aiRefineStatus.textContent = "";
  // Needs the token, so it belongs here rather than at file scope — this also
  // means it re-reads after a login rather than staying stuck on "unavailable".
  loadSponsorRegisterStatus();

  const scrapePromise = send({ type: "MOMENTUM_SCRAPE_ACTIVE_TAB" });
  const resumesPromise = loadResumes();

  const scrapeRes = await scrapePromise;
  // Re-read the page when the host tells us the posting changed. Guarded so a
  // capture in progress, or fields the user has started editing, are not
  // overwritten underneath them.
  if (scrapeRes?.ok) {
    scrapedJob = scrapeRes.data;
    els.previewRole.value = scrapedJob.role_title || "";
    els.previewCompany.value = scrapedJob.company_name || "";
    els.previewLocation.value = scrapedJob.location || "";
    els.previewUrl.value = scrapedJob.job_link || scrapedJob.page_url || "";
    els.previewUrlOpen.href = els.previewUrl.value || "#";
    setDescription(scrapedJob.job_description || "");
    renderHeader();
    renderKeywords(descriptionText());
    els.scrapeWarning.classList.add("hidden");
    if (!scrapedJob.company_name || !scrapedJob.job_description) {
      els.scrapeWarning.textContent = "Some fields couldn't be read automatically — AI refinement is running, or fill them in above.";
      els.scrapeWarning.classList.remove("hidden");
    }
    // Don't block the UI on this — quick guesses are already in the
    // fields, AI refinement just improves them a moment later.
    refineWithAI();
  } else {
    scrapedJob = { role_title: "", company_name: "", location: "", job_description: "", job_link: "", source: "" };
    els.previewRole.value = "";
    els.previewCompany.value = "";
    els.previewLocation.value = "";
    els.scrapeWarning.textContent = scrapeRes?.error || "Couldn't read this page — fill in the fields manually.";
    els.scrapeWarning.classList.remove("hidden");
  }

  await resumesPromise;
}

els.settingsBtn.addEventListener("click", () => chrome.runtime.openOptionsPage());
// The logged-in main view has its own Settings button (separate from the
// login view's), which never got wired up.
document.getElementById("settings-btn-main")?.addEventListener("click", () => chrome.runtime.openOptionsPage());
els.resumeRefreshBtn.addEventListener("click", loadResumes);
els.resumeSelect.addEventListener("change", updateGenerateButtonsState);

els.loginBtn.addEventListener("click", async () => {
  const email = els.loginEmail.value.trim();
  const password = els.loginPassword.value;
  if (!email || !password) {
    els.loginStatus.textContent = "Enter your email and password.";
    els.loginStatus.className = "status err";
    return;
  }
  els.loginBtn.disabled = true;
  els.loginStatus.textContent = "Logging in...";
  els.loginStatus.className = "status info";
  const res = await send({ type: "MOMENTUM_LOGIN", email, password });
  els.loginBtn.disabled = false;
  if (res?.ok) {
    init();
  } else {
    els.loginStatus.textContent = res?.error || "Login failed.";
    els.loginStatus.className = "status err";
  }
});

els.logoutBtn.addEventListener("click", async () => {
  await send({ type: "MOMENTUM_LOGOUT" });
  init();
});

function requireJobDescription() {
  const fields = currentJobFields();
  if (!fields.job_description || fields.job_description.trim().length < 20) {
    els.captureStatus.textContent = "Not enough job description text was captured to do this — try Refresh, or check the page has a visible description.";
    els.captureStatus.className = "status err";
    return null;
  }
  if (!fields.role_title || !fields.company_name) {
    els.captureStatus.textContent = "Role title and company are required — fill them in above.";
    els.captureStatus.className = "status err";
    return null;
  }
  return fields;
}

// Restores innerHTML, not textContent.
//
// The action buttons are three elements — icon, a title/subtitle pair, and a
// chevron. Saving textContent flattened all of that into one string, so after
// the first click the button permanently read "📄Generate Tailored CVA CV
// matched to this job›": every child gone, both lines run together. It only
// looked like a CSS bug because the two buttons nobody had clicked yet still
// rendered correctly.
async function withButtonBusy(btn, label, fn) {
  const original = btn.innerHTML;
  btn.disabled = true;
  btn.dataset.busy = "1";
  btn.innerHTML = `<span class="act-busy"><span class="spinner"></span>${label}</span>`;
  try {
    await fn();
  } finally {
    btn.disabled = false;
    delete btn.dataset.busy;
    btn.innerHTML = original;
    updateGenerateButtonsState();
  }
}

// Autofill deliberately reports what it *couldn't* fill as prominently as what
// it could. The failure mode of form autofill isn't a blank box you notice —
// it's a required question you scroll past because the page looks complete.
els.autofillBtn?.addEventListener("click", async () => {
  const btn = els.autofillBtn;
  btn.disabled = true;
  els.captureStatus.textContent = "Filling the form…";
  els.captureStatus.className = "status";
  try {
    const res = await chrome.runtime.sendMessage({ type: "MOMENTUM_AUTOFILL_FORM" });
    if (!res || res.error) throw new Error(res?.error || "Autofill didn't respond.");
    const gaps = res.unfilled || [];
    els.captureStatus.textContent = gaps.length
      ? `Filled ${res.filled} fields. ${gaps.length} still need you: ${gaps.slice(0, 3).join("; ")}${gaps.length > 3 ? "…" : ""}`
      : `Filled ${res.filled} fields. Check it over, then submit.`;
    els.captureStatus.className = gaps.length ? "status warn" : "status ok";
  } catch (e) {
    els.captureStatus.textContent = e.message || "Couldn't fill this form.";
    els.captureStatus.className = "status err";
  } finally {
    btn.disabled = false;
  }
});

els.generateResumeBtn.addEventListener("click", async () => {
  const fields = requireJobDescription();
  const resumeId = selectedResumeId();
  if (!fields || !resumeId) return;

  await withButtonBusy(els.generateResumeBtn, "Tailoring...", async () => {
    const res = await send({
      type: "MOMENTUM_GENERATE_RESUME",
      payload: {
        resume_id: resumeId,
        job_description: fields.job_description,
        company_name: fields.company_name,
        role_title: fields.role_title,
      },
    });
    if (res?.ok) {
      showResumeDownload(res.data.filename, res.data.name);
      els.captureStatus.textContent = `✅ Tailored resume created: ${res.data.name}`;
      els.captureStatus.className = "status ok";
    } else if (res?.status === 401) {
      await chrome.storage.local.remove(["token", "user"]);
      showOnly(els.login);
    } else {
      els.captureStatus.textContent = res?.error || "Couldn't generate a tailored resume.";
      els.captureStatus.className = "status err";
    }
  });
});

els.generateCoverLetterBtn.addEventListener("click", async () => {
  const fields = requireJobDescription();
  const resumeId = selectedResumeId();
  if (!fields || !resumeId) return;

  await withButtonBusy(els.generateCoverLetterBtn, "Writing...", async () => {
    const res = await send({
      type: "MOMENTUM_GENERATE_COVER_LETTER",
      payload: {
        resume_id: resumeId,
        job_description: fields.job_description,
        company_name: fields.company_name,
        role_title: fields.role_title,
      },
    });
    if (res?.ok) {
      showCoverLetter(res.data.cover_letter);
      els.captureStatus.textContent = `✅ Cover letter generated (${res.data.mode} mode).`;
      els.captureStatus.className = "status ok";
    } else if (res?.status === 401) {
      await chrome.storage.local.remove(["token", "user"]);
      showOnly(els.login);
    } else {
      els.captureStatus.textContent = res?.error || "Couldn't generate a cover letter.";
      els.captureStatus.className = "status err";
    }
  });
});

els.captureBtn.addEventListener("click", async () => {
  if (!scrapedJob) return;

  const roleTitle = els.previewRole.value.trim();
  const companyName = els.previewCompany.value.trim();
  if (!roleTitle || !companyName) {
    els.captureStatus.textContent = "Role title and company are required — fill them in above.";
    els.captureStatus.className = "status err";
    return;
  }

  els.captureBtn.disabled = true;
  els.captureBtn.innerHTML = `<span class="spinner"></span>Capturing...`;
  els.captureStatus.textContent = "";
  els.resultsSection.classList.add("hidden");
  els.resumeResult.classList.add("hidden");
  els.coverLetterResult.classList.add("hidden");

  const payload = {
    ...scrapedJob,
    role_title: roleTitle,
    company_name: companyName,
    location: els.previewLocation.value.trim(),
    // The description box and URL field are both editable — read their live
    // values rather than the original scrape, otherwise any edits the user
    // makes there (fixing a garbled scrape, pasting the real description)
    // get silently discarded on save.
    job_description: descriptionText(),
    job_link: els.previewUrl.value.trim(),
    resume_id: selectedResumeId(),
    auto_tailor_resume: els.chkTailor.checked,
    // Read at capture time, not at popup load, so changing the setting takes
    // effect immediately. Falls back to Compact if it was never set.
    template_id: (await chrome.storage.local.get(["templateId"])).templateId || "compact_onepage",
    auto_cover_letter: els.chkCover.checked,
    board_id: Number(els.boardSelect.value) || null,
  };

  const res = await send({ type: "MOMENTUM_CAPTURE", payload });
  els.captureBtn.disabled = false;
  els.captureBtn.textContent = "🔖 Save to Board";

  // 402 is the quota gate, not a failure — show the upgrade panel rather than
  // a red error, and keep the captured fields intact so nothing is retyped.
  if (!res?.ok && res?.status === 402) {
    const d = res.detail || {};
    renderQuota(d);
    showUpgrade(d);
    els.captureStatus.textContent = "";
    return;
  }

  if (res?.ok) {
    const lines = [`✅ Saved "${res.data.job.role_title}" at ${res.data.job.company_name}.`];
    if (res.data.ats_score != null) lines.push(`🎯 ATS match score: ${res.data.ats_score}%`);
    if (res.data.notes?.length) lines.push(...res.data.notes.map(n => `ℹ️ ${n}`));
    // role_title/company_name are page-scraped text (JSON-LD, meta tags, DOM
    // text) that can contain markup; build this with text nodes rather than
    // innerHTML so a crafted job posting can't run script in the popup.
    els.captureStatus.textContent = "";
    lines.forEach((line, i) => {
      if (i) els.captureStatus.appendChild(document.createElement("br"));
      els.captureStatus.appendChild(document.createTextNode(line));
    });
    els.captureStatus.className = "status ok";
    loadQuota();   // one fewer left; show it immediately

    let anyResult = false;
    if (res.data.tailored_resume?.filename) {
      showResumeDownload(res.data.tailored_resume.filename, res.data.tailored_resume.name);
      anyResult = true;
    }
    if (res.data.cover_letter) {
      showCoverLetter(res.data.cover_letter);
      anyResult = true;
    }
    els.resultsSection.classList.toggle("hidden", !anyResult);
  } else if (res?.status === 401) {
    await chrome.storage.local.remove(["token", "user"]);
    showOnly(els.login);
  } else {
    els.captureStatus.textContent = res?.error || "Something went wrong.";
    els.captureStatus.className = "status err";
  }
});

els.copyCoverLetterBtn.addEventListener("click", async () => {
  await navigator.clipboard.writeText(els.coverLetterText.value);
  els.copyCoverLetterBtn.textContent = "✅ Copied";
  setTimeout(() => { els.copyCoverLetterBtn.textContent = "📋 Copy"; }, 1500);
});

els.downloadCoverLetterBtn.addEventListener("click", () => {
  const blob = new Blob([els.coverLetterText.value], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `cover-letter-${(els.previewCompany.value || "job").replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.txt`;
  a.click();
  URL.revokeObjectURL(url);
});

init();

// ===========================================================================
// UI added with the two-panel redesign
// ===========================================================================

// ---- description editor -------------------------------------------------
// contenteditable rather than a textarea so the formatting toolbar is real,
// but everything sent to the backend is plain text — the job description
// feeds keyword matching and the ATS scorer, and markup would be noise there.
function setDescription(text) {
  els.jobDescription.textContent = (text || "").trim();
}
function descriptionText() {
  return (els.jobDescription.innerText || "").replace(/ /g, " ").trim();
}
document.querySelectorAll(".desc-bar button[data-cmd]").forEach(b => {
  b.addEventListener("mousedown", e => e.preventDefault());  // keep the caret
  b.addEventListener("click", () => document.execCommand(b.dataset.cmd, false, null));
});
els.jobDescription.addEventListener("input", () => {
  clearTimeout(els.jobDescription._t);
  els.jobDescription._t = setTimeout(() => renderKeywords(descriptionText()), 400);
});

// ---- header -------------------------------------------------------------
function renderHeader() {
  const role = els.previewRole.value.trim();
  const company = els.previewCompany.value.trim();
  const loc = els.previewLocation.value.trim();
  els.hdrRole.textContent = role || "No job detected";
  els.hdrSub.textContent = [company, loc].filter(Boolean).join("  •  ")
    || "Open a job posting, then reopen this popup";
  // The favicon of the posting's own domain is a decent stand-in for a company
  // logo and costs no extra request beyond one the browser has already made.
  const url = els.previewUrl.value.trim();
  let host = "";
  try { host = new URL(url).hostname; } catch { /* not a URL yet */ }
  if (host) {
    els.jobLogo.innerHTML = `<img alt="" src="https://www.google.com/s2/favicons?sz=64&domain=${host}">`;
  } else {
    els.jobLogo.textContent = (company || "—").slice(0, 2).toUpperCase();
  }
  // The header is redrawn every time the company can have changed — scrape,
  // AI refine, SPA navigation — so it's the one place the sponsor check needs
  // hooking into. checkSponsorship() no-ops when the name hasn't changed.
  checkSponsorship();
}
["previewRole", "previewCompany", "previewLocation"].forEach(k =>
  els[k].addEventListener("input", renderHeader));
els.previewUrl.addEventListener("input", () => {
  els.previewUrlOpen.href = els.previewUrl.value.trim() || "#";
  renderHeader();
});

// ---- keywords -----------------------------------------------------------
// Plain term matching against a fixed vocabulary, counted by occurrence. No
// model involved: this is a word count, and it is honest about being one.
// Swapping in a real extractor later only means replacing this function.
const KEYWORD_VOCAB = [
  ["Machine learning", "📈", "#E7F8EF", "#16A34A", /\bmachine[ -]learning\b|\bML\b/gi],
  ["AI", "🧠", "#FDEEF4", "#DB2777", /\bA\.?I\.?\b|artificial intelligence/gi],
  ["LLM", "🔡", "#FEF3E2", "#D97706", /\bLLMs?\b|large language model/gi],
  ["Python", "🐍", "#EEF0FE", "#4F46E5", /\bpython\b/gi],
  ["SQL", "🗄️", "#EEF0FE", "#4F46E5", /\bsql\b|postgres|mysql|snowflake/gi],
  ["Forecasting", "📦", "#EAF2FE", "#2563EB", /forecast\w*|time[ -]series/gi],
  ["Cloud", "☁️", "#EAF6FE", "#0284C7", /\baws\b|\bazure\b|\bgcp\b|google cloud/gi],
  ["Platforms", "🧱", "#F1EEFE", "#7C3AED", /\bplatform\w*\b/gi],
  ["Statistics", "📊", "#EAF2FE", "#2563EB", /statistic\w*|regression|hypothesis/gi],
  ["Visualisation", "📉", "#E7F8EF", "#16A34A", /power ?bi|tableau|dashboard\w*|visuali[sz]/gi],
  ["Stakeholders", "🤝", "#FEF3E2", "#D97706", /stakeholder\w*/gi],
  ["Experimentation", "🧪", "#FDEEF4", "#DB2777", /\bA\/B\b|experiment\w*/gi],
];

function renderKeywords(text) {
  const body = (text || "").trim();
  if (body.length < 40) {
    els.keywordList.innerHTML =
      `<p class="kw-empty">Keywords appear once a job description has been read from the page.</p>`;
    return;
  }
  const found = [];
  for (const [name, icon, bg, fg, re] of KEYWORD_VOCAB) {
    const n = (body.match(re) || []).length;
    if (n) found.push({ name, icon, bg, fg, n });
  }
  if (!found.length) {
    els.keywordList.innerHTML =
      `<p class="kw-empty">No familiar skills matched in this description.</p>`;
    return;
  }
  found.sort((a, b) => b.n - a.n);
  els.keywordList.innerHTML = found.slice(0, 8).map(k => `
    <div class="kw" style="background:${k.bg}">
      <span class="kw-dot" style="background:#fff;color:${k.fg}">${k.icon}</span>
      <span class="kw-name">${k.name}</span>
      <span class="kw-n">${k.n}</span>
    </div>`).join("");
}

// ---- boards -------------------------------------------------------------
async function loadBoards() {
  const res = await send({ type: "MOMENTUM_BOARDS" });
  if (!res?.ok || !Array.isArray(res.data)) return;   // offline: keep the default option
  els.boardSelect.innerHTML = res.data
    .map(b => `<option value="${b.id}"${b.is_default ? " selected" : ""}>${b.name}</option>`)
    .join("") || `<option value="">Default board</option>`;
}

// ---------------------------------------------------------------------------
// ATS check
// ---------------------------------------------------------------------------
// The backend has scored resumes against job descriptions all along
// (/api/ats/check, app/ats_scorer.py); the extension button just never called
// it and apologised instead. It needs the same two things the tailoring
// actions need — a chosen resume and a real description — so it fails the same
// way when either is missing.
els.atsCheckBtn.addEventListener("click", async () => {
  const fields = requireJobDescription();
  const resumeId = selectedResumeId();
  if (!fields) return;
  if (!resumeId) {
    els.captureStatus.textContent = "Pick a resume in step 1 first — the score is that resume against this posting.";
    els.captureStatus.className = "status warn";
    els.resumeSelect.focus();
    return;
  }

  await withButtonBusy(els.atsCheckBtn, "Scoring…", async () => {
    const res = await send({
      type: "MOMENTUM_ATS_CHECK",
      payload: { resume_id: resumeId, job_description: fields.job_description },
    });
    if (res?.ok) {
      renderAtsResult(res.data);
      els.captureStatus.textContent = "";
      els.captureStatus.className = "status";
    } else if (res?.status === 401) {
      await chrome.storage.local.remove(["token", "user"]);
      showOnly(els.login);
    } else {
      els.atsResult.classList.add("hidden");
      els.captureStatus.textContent = res?.error || "Couldn't score this resume.";
      els.captureStatus.className = "status err";
    }
  });
});

function renderAtsResult(d) {
  const score = Math.max(0, Math.min(100, Math.round(d.score ?? 0)));
  els.atsScoreVal.textContent = score;
  els.atsBarFill.style.width = `${score}%`;

  // Thresholds match the app's own reading of the score, so the extension and
  // the ATS page never disagree about whether a resume is in good shape.
  const verdict = score >= 75 ? ["good", "Strong match"]
    : score >= 50 ? ["mid", "Worth tightening"]
    : ["low", "Needs work"];
  els.atsVerdict.className = `ats-verdict ${verdict[0]}`;
  els.atsVerdict.textContent = verdict[1];

  // Missing hard skills are the actionable part — they're the terms the
  // posting asks for by name. Plain keywords are noisier, so they only fill in
  // when there are no hard skills to report.
  const missing = (d.missing_hard_skills?.length ? d.missing_hard_skills : d.missing_keywords) || [];
  if (missing.length) {
    els.atsMissing.innerHTML = "";
    const heading = document.createElement("b");
    heading.textContent = d.missing_hard_skills?.length ? "Missing hard skills" : "Missing keywords";
    els.atsMissing.appendChild(heading);
    // Built as nodes, not innerHTML: these strings come from a scraped page.
    missing.slice(0, 12).forEach(term => {
      const chip = document.createElement("i");
      chip.textContent = term;
      els.atsMissing.appendChild(chip);
    });
  } else {
    els.atsMissing.textContent = "Nothing obvious missing — this resume covers the terms in the posting.";
  }
  els.atsResult.classList.remove("hidden");
}

// ---------------------------------------------------------------------------
// Downloads
// ---------------------------------------------------------------------------
// One place for everything generated, rather than a status line with a link
// buried in it. Both entries land in the same panel with the same affordance.
let tailoredResumeFile = null;

function showResumeDownload(filename, name) {
  tailoredResumeFile = filename || null;
  els.resumeDlName.textContent = name || filename || "Ready";
  els.resumeDownloadBtn.disabled = !filename;
  els.resumeResult.classList.remove("hidden");
  els.resultsSection.classList.remove("hidden");
}

function showCoverLetter(text) {
  els.coverLetterText.value = text || "";
  els.coverLetterResult.classList.remove("hidden");
  els.resultsSection.classList.remove("hidden");
}

function safeFileStem(prefix) {
  const company = (els.previewCompany.value || "job").replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  const role = (els.previewRole.value || "").replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  return [prefix, company, role].filter(Boolean).join("-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

// chrome.downloads rather than an <a download>: the file lives behind an
// authenticated API on another origin, and a popup that closes mid-click
// cancels an anchor navigation. The downloads API owns the transfer, so it
// survives the popup closing.
els.resumeDownloadBtn?.addEventListener("click", async () => {
  if (!tailoredResumeFile) return;
  const url = `${currentApiBase}/uploads/${encodeURIComponent(tailoredResumeFile)}`;
  const ext = (tailoredResumeFile.match(/\.[a-z0-9]+$/i) || [".docx"])[0];
  try {
    await chrome.downloads.download({ url, filename: `${safeFileStem("resume")}${ext}`, saveAs: false });
  } catch {
    // Older Chrome, or the permission was declined — a new tab still works.
    chrome.tabs.create({ url });
  }
});

els.downloadCoverLetterBtn.addEventListener("click", () => {
  const blob = new Blob([els.coverLetterText.value], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${safeFileStem("cover-letter")}.txt`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
});

// ---------------------------------------------------------------------------
// UK sponsor licence check
// ---------------------------------------------------------------------------
// Runs whenever the company changes. It's advisory: the register is a list of
// organisations licensed to sponsor, not a promise that this particular role
// carries sponsorship, and the wording says so.
let lastSponsorshipQuery = null;

async function checkSponsorship() {
  const company = els.previewCompany.value.trim();
  if (!company) { els.sponBadge.classList.add("hidden"); lastSponsorshipQuery = null; return; }
  if (company === lastSponsorshipQuery) return;
  lastSponsorshipQuery = company;

  setSponBadge("pending", "Checking sponsor register…", "");
  const res = await send({ type: "MOMENTUM_SPONSOR_CHECK", payload: { company } });
  // A later company change may have overtaken this request.
  if (els.previewCompany.value.trim() !== company) return;
  if (!res?.ok) { els.sponBadge.classList.add("hidden"); return; }

  const d = res.data || {};
  if (d.status === "licensed") {
    setSponBadge("yes", `Licensed sponsor — ${d.matched_name}`,
      `Matched "${d.matched_name}" in the Home Office register${d.routes ? ` · ${d.routes}` : ""}. ` +
      `A licence means the employer can sponsor, not that this role does.`);
  } else if (d.status === "possible") {
    setSponBadge("maybe", `Possible sponsor — ${d.matched_name}`,
      `Closest register entry is "${d.matched_name}" (${d.confidence}% name similarity). Worth confirming.`);
  } else if (d.status === "unknown") {
    setSponBadge("no", "Register unavailable", d.detail || "The sponsor register hasn't been downloaded yet.");
  } else {
    setSponBadge("no", "Not on the sponsor register",
      "No close match in the Home Office register of licensed worker sponsors. " +
      "Subsidiaries are often listed under a different legal name.");
  }
}

function setSponBadge(kind, label, title) {
  els.sponBadge.className = `spon ${kind}`;
  els.sponBadge.title = title || "";
  els.sponBadge.innerHTML = "";
  const dot = document.createElement("span");
  dot.textContent = kind === "yes" ? "✓" : kind === "maybe" ? "~" : kind === "pending" ? "…" : "·";
  const text = document.createElement("span");
  text.textContent = label;
  els.sponBadge.append(dot, text);
  els.sponBadge.classList.remove("hidden");
}

els.previewCompany.addEventListener("change", checkSponsorship);

// ---------------------------------------------------------------------------
// In-page sponsor tags — the switch and the three modes
// ---------------------------------------------------------------------------
// The badge above answers for the posting you already opened. These controls
// govern sponsor-badges.js, which answers the same question on the results
// list, before the click. The setting is written to chrome.storage and every
// open job tab picks the change up through storage.onChanged — nothing here
// has to know which tabs exist, and a tab opened later reads the same value.
const SPON_DEFAULTS = { enabled: true, mode: "badge" };
const SPON_HINTS = {
  badge: "Sponsors get a green tag. Everything else is left exactly as it is.",
  dim: "Sponsors get a tag; employers with no licence on the register fade back.",
  hide: "Only sponsors stay on the page. Cards with no licence are removed from the list.",
};
let sponSettings = { ...SPON_DEFAULTS };

function renderSponControls() {
  els.sponEnabled.checked = !!sponSettings.enabled;
  els.sponMode.classList.toggle("off", !sponSettings.enabled);
  els.sponMode.querySelectorAll("button").forEach(b => {
    b.classList.toggle("on", b.dataset.mode === sponSettings.mode);
  });
  els.sponHint.textContent = sponSettings.enabled
    ? (SPON_HINTS[sponSettings.mode] || "")
    : "Job lists are left untouched.";
}

async function saveSponSettings(patch) {
  sponSettings = { ...sponSettings, ...patch };
  renderSponControls();
  await chrome.storage.local.set({ sponsorBadges: sponSettings });
}

els.sponEnabled.addEventListener("change", () => {
  saveSponSettings({ enabled: els.sponEnabled.checked });
});
els.sponMode.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-mode]");
  if (btn) saveSponSettings({ mode: btn.dataset.mode });
});

// The register is a ~100k-row download that has to happen once before any of
// this can answer anything, so its state is shown rather than left to be
// inferred from tags that never appear.
async function loadSponsorRegisterStatus() {
  const res = await send({ type: "MOMENTUM_SPONSOR_STATUS" });
  if (!res?.ok) {
    els.sponRegister.textContent = "Register status unavailable — is the backend running?";
    return;
  }
  const { org_count: count, synced_at: synced } = res.data || {};
  if (!count) {
    els.sponRegister.textContent = "Register not downloaded yet — nothing can be checked until it is.";
    return;
  }
  const when = synced
    ? new Date(synced).toLocaleDateString(undefined, { day: "numeric", month: "short" })
    : "unknown date";
  els.sponRegister.textContent = `${count.toLocaleString()} licensed employers · synced ${when}`;
}

els.sponRefresh.addEventListener("click", async () => {
  els.sponRefresh.disabled = true;
  els.sponRegister.textContent = "Downloading the latest register from GOV.UK…";
  const res = await send({ type: "MOMENTUM_SPONSOR_REFRESH" });
  els.sponRefresh.disabled = false;
  if (res?.ok) {
    // A fresh register invalidates the badge above as well as the page tags.
    lastSponsorshipQuery = null;
    checkSponsorship();
    await loadSponsorRegisterStatus();
  } else {
    els.sponRegister.textContent = res?.error || "Couldn't refresh the register.";
  }
});

chrome.storage.local.get(["sponsorBadges"], (stored) => {
  sponSettings = { ...SPON_DEFAULTS, ...(stored?.sponsorBadges || {}) };
  renderSponControls();
});

loadBoards();

// ===========================================================================
// Live refresh on SPA navigation
// ===========================================================================
// On a two-pane board, clicking the next posting swaps the detail pane without
// a page load, so the panel kept showing whichever job it was opened on. The
// content script watches for that and posts a message here.
//
// Anything the user has typed is left alone: re-reading the page is only
// useful if it does not throw away an edit, so a field is refreshed only when
// it still holds exactly what the last scrape put there.
let lastScrapeSnapshot = null;

function snapshotScrape() {
  lastScrapeSnapshot = {
    role: els.previewRole.value,
    company: els.previewCompany.value,
    location: els.previewLocation.value,
    url: els.previewUrl.value,
    description: descriptionText(),
  };
}

async function rescrapeCurrentJob() {
  const res = await send({ type: "MOMENTUM_SCRAPE_ACTIVE_TAB" });
  if (!res?.ok || !res.data) return;
  const d = res.data;
  const s = lastScrapeSnapshot || {};
  const untouched = (el, was) => !el.value.trim() || el.value === was;

  if (untouched(els.previewRole, s.role)) els.previewRole.value = d.role_title || "";
  if (untouched(els.previewCompany, s.company)) els.previewCompany.value = d.company_name || "";
  if (untouched(els.previewLocation, s.location)) els.previewLocation.value = d.location || "";
  if (untouched(els.previewUrl, s.url)) {
    els.previewUrl.value = d.job_link || d.page_url || "";
    els.previewUrlOpen.href = els.previewUrl.value || "#";
  }
  const descNow = descriptionText();
  if (!descNow || descNow === (s.description || "")) setDescription(d.job_description || "");

  scrapedJob = d;
  snapshotScrape();
  renderHeader();
  renderKeywords(descriptionText());
  // A fresh posting invalidates whatever was generated for the previous one.
  els.resultsSection.classList.add("hidden");
  els.captureStatus.textContent = "";
  els.scrapeWarning.classList.add("hidden");
}

window.addEventListener("message", (e) => {
  if (e.data && e.data.type === "MOMENTUM_JOB_CHANGED") rescrapeCurrentJob();
});

// Record what the first scrape produced, once the fields have been filled.
setTimeout(snapshotScrape, 1200);

// ===========================================================================
// Plan limits
// ===========================================================================
// Two surfaces: a running count in the footer, and a panel over the job column
// when the month is spent. The panel deliberately does not replace the popup —
// the posting you were about to save stays visible behind it, because the
// argument for upgrading is the thing you are about to lose.
const APP_URL = (typeof MOMENTUM_DEFAULT_API_BASE !== "undefined" && MOMENTUM_DEFAULT_API_BASE)
  || "http://localhost:8000";

function renderQuota(q) {
  if (!q || q.limit === null) {            // unlimited plan: say nothing at all
    els.quotaPill.classList.add("hidden");
    return;
  }
  els.quotaPill.textContent = `${q.used}/${q.limit} captures`;
  els.quotaPill.className = "quota-pill" + (q.exhausted ? " out" : q.warn ? " low" : "");
  if (q.exhausted) showUpgrade(q);
}

function showUpgrade(q) {
  const limit = q?.limit ?? "your";
  els.upgradeTitle.textContent = `You have used all ${limit} captures this month`;
  els.upgradeReset.textContent = q?.period_resets
    ? `Your free captures reset on ${new Date(q.period_resets).toLocaleDateString(undefined, { day: "numeric", month: "long" })}.`
    : "";
  els.upgradeVeil.classList.remove("hidden");
  els.captureBtn.disabled = true;
}

async function loadQuota() {
  const res = await send({ type: "MOMENTUM_QUOTA" });
  if (res?.ok) renderQuota(res.data);
}

els.upgradeBtn.addEventListener("click", () => {
  // No checkout in the extension — the app owns the account and the payment
  // flow, and a popup is the wrong place to take card details.
  chrome.tabs.create({ url: `${APP_URL}/#pricing` });
});
els.upgradeDismiss.addEventListener("click", () => {
  els.upgradeVeil.classList.add("hidden");
});

loadQuota();
