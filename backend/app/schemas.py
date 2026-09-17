from datetime import date, datetime
from typing import Optional, List
from pydantic import BaseModel, ConfigDict, EmailStr, field_validator
from .models import JobStatus, UserRole


# ---------- Auth / Users ----------
class UserCreate(BaseModel):
    name: str
    email: EmailStr
    password: str


class UserLogin(BaseModel):
    email: EmailStr
    password: str


class GoogleAuthRequest(BaseModel):
    credential: str  # Google ID token (JWT) from Google Identity Services


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    email: EmailStr
    role: UserRole
    is_active: bool
    auth_provider: str
    created_at: datetime
    # Optional, not str: ALTER TABLE adds the column as NULL on existing rows,
    # and a bare `str` turns that into a validation error on every login for
    # anyone who signed up before billing existed.
    plan: Optional[str] = "free"

    @field_validator("plan", mode="before")
    @classmethod
    def _plan_default(cls, v):
        return v or "free"


class UserAdminUpdate(BaseModel):
    role: Optional[UserRole] = None
    is_active: Optional[bool] = None


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


# ---------- Study Plan ----------
class StudyBlockCreate(BaseModel):
    date: date
    subject: str
    start_time: str
    end_time: str
    notes: Optional[str] = None


class StudyBlockUpdate(BaseModel):
    subject: Optional[str] = None
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    notes: Optional[str] = None
    completed: Optional[bool] = None


class StudyBlockOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    date: date
    subject: str
    start_time: str
    end_time: str
    notes: Optional[str] = None
    completed: bool


# ---------- Habits ----------
class HabitCreate(BaseModel):
    title: str
    category: Optional[str] = None


class HabitUpdate(BaseModel):
    title: Optional[str] = None
    category: Optional[str] = None
    active: Optional[bool] = None


class HabitOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    title: str
    category: Optional[str] = None
    active: bool
    created_at: datetime


class HabitEntryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    habit_id: int
    date: date
    completed: bool


class HabitWithProgress(BaseModel):
    id: int
    title: str
    category: Optional[str] = None
    active: bool
    week: dict  # {"Mon": true, "Tue": false, ...}
    progress_pct: float


# ---------- Tasks ----------
class TaskCreate(BaseModel):
    date: date
    title: str
    notes: Optional[str] = None
    tags: Optional[str] = None  # comma-separated


class TaskUpdate(BaseModel):
    title: Optional[str] = None
    completed: Optional[bool] = None
    notes: Optional[str] = None
    tags: Optional[str] = None


class TaskOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    date: date
    title: str
    completed: bool
    notes: Optional[str] = None
    tags: Optional[str] = None


# ---------- Weekly Notes ----------
class WeeklyNoteUpdate(BaseModel):
    focus_text: Optional[str] = None
    reward_text: Optional[str] = None
    affirmation_text: Optional[str] = None


class WeeklyNoteOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    week_start_date: date
    focus_text: str
    reward_text: str
    affirmation_text: str


# ---------- Resumes ----------
class ResumeUpdate(BaseModel):
    """Label-only edits — renaming or re-noting a resume shouldn't require
    regenerating its PDF or touching its builder data."""
    name: Optional[str] = None
    notes: Optional[str] = None


class ResumeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    filename: Optional[str] = None
    notes: Optional[str] = None
    has_text: bool = False
    template_id: Optional[str] = None
    board_id: Optional[int] = None   # which board the captured job lands on
    # True when this resume was made in the Resume Builder and so has
    # structured data behind it — i.e. it can be reopened and edited,
    # unlike an uploaded PDF which is only a file.
    has_builder_data: bool = False
    tailored_for_job_id: Optional[int] = None
    created_at: datetime
    updated_at: Optional[datetime] = None


# ---------- ATS Checker ----------
class ATSCheckRequest(BaseModel):
    resume_id: int
    job_description: str


class ATSCheckResult(BaseModel):
    score: int
    keyword_coverage_percent: float
    term_similarity_percent: float
    matched_keywords: List[str]
    missing_keywords: List[str]
    matched_hard_skills: List[str] = []
    missing_hard_skills: List[str] = []
    matched_soft_skills: List[str] = []
    title_seniority_match: Optional[bool] = None
    recommendations: List[str] = []
    ai_summary: Optional[str] = None
    ai_mode: Optional[str] = None


# ---------- Resume Builder ----------
class ResumeBuilderRequest(BaseModel):
    # Optional while the Design tab has no templates listed — the builder
    # resolves an empty/unknown id to a renderable fallback (see
    # resume_pdf.resolve_template) so previews and saves keep working.
    template_id: Optional[str] = None
    board_id: Optional[int] = None   # which board the captured job lands on
    resume_name: str
    full_name: str
    title: Optional[str] = None
    location: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    linkedin: Optional[str] = None
    website: Optional[str] = None
    summary: Optional[str] = None
    skills: Optional[str] = None          # one "Category: item, item, item" per line
    experience: Optional[str] = None      # blocks separated by a line of "---"
    education: Optional[str] = None       # blocks separated by a line of "---"
    projects: Optional[str] = None        # blocks separated by a line of "---"
    # --- customer styling choices (override the template's own defaults) ---
    accent_color: Optional[str] = None    # hex, e.g. "#2C9CDB"
    font_family: Optional[str] = None     # "sans" | "serif" | "mono"
    font_size: Optional[str] = None       # "xs" | "small" | "standard" | "large" | "xl" (or a scale number as string)
    # Absolute path to the photo the picture templates draw. Set by the server
    # from the signed-in account, never accepted from the client.
    photo_path: Optional[str] = None
    # --- user-defined sections: [{title, items:[{heading,meta,subheading,text,bullets:[]}]}] ---
    custom_sections: Optional[list] = None
    publications: Optional[str] = None    # one per line
    certifications: Optional[str] = None  # one per line

    # ---- Regional fields (only used by the templates that call for them;
    #      harmless no-ops for templates that don't) ----
    photo_initials: Optional[str] = None      # e.g. "JD" -> drawn as an avatar circle
    date_of_birth: Optional[str] = None       # used by EU / India templates
    nationality: Optional[str] = None         # used by EU / India templates
    gender: Optional[str] = None              # used by India template (optional, candidate's choice)
    marital_status: Optional[str] = None      # used by India template (optional, candidate's choice)
    father_name: Optional[str] = None         # conventional on Indian resumes
    visa_status: Optional[str] = None         # e.g. "Tier 2 / Skilled Worker", "OPT", "Not required (EU citizen)"
    driving_license: Optional[str] = None      # common on UK/EU CVs
    languages: Optional[str] = None           # "Language — Proficiency" one per line
    references_note: Optional[str] = None     # e.g. "References available on request"
    declaration: Optional[str] = None         # India CVs traditionally close with a signed declaration
    expected_salary: Optional[str] = None     # common field on Singapore/APAC resumes
    notice_period: Optional[str] = None       # common field on Singapore/APAC resumes
    passport_status: Optional[str] = None     # e.g. "Valid, transferable" — common on Gulf/Middle East CVs


# ---------- Portfolio Builder ----------
class PortfolioBase(BaseModel):
    name: str
    template_id: Optional[str] = None
    # Free-form content bag. It is deliberately untyped: the templates share
    # one shape, but every new field a template needs would otherwise mean a
    # schema change *and* a migration, and old saved portfolios would fail
    # validation the moment the shape moved on.
    data: Optional[dict] = None
    resume_id: Optional[int] = None


class PortfolioCreate(PortfolioBase):
    pass


class PortfolioUpdate(BaseModel):
    name: Optional[str] = None
    template_id: Optional[str] = None
    data: Optional[dict] = None
    # 0 clears the link (JSON has no "unset"; None already means "leave alone").
    resume_id: Optional[int] = None


class PortfolioOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    template_id: str
    resume_id: Optional[int] = None
    data: Optional[dict] = None
    last_exported_at: Optional[datetime] = None
    created_at: datetime
    updated_at: Optional[datetime] = None


class PortfolioSummary(BaseModel):
    """List view — everything the library grid draws, without shipping every
    portfolio's full content down the wire for a page of thumbnails."""
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    template_id: str
    resume_id: Optional[int] = None
    headline: Optional[str] = None       # data.full_name — drawn on the card
    subheading: Optional[str] = None     # data.title
    section_count: int = 0
    last_exported_at: Optional[datetime] = None
    created_at: datetime
    updated_at: Optional[datetime] = None


# ---------- Cover Letter Generator ----------
class CoverLetterRequest(BaseModel):
    resume_id: int
    job_description: str
    company_name: Optional[str] = None
    role_title: Optional[str] = None


class CoverLetterResult(BaseModel):
    cover_letter: str
    word_count: int
    mode: str  # "llm" or "lite"


class CoverLetterDownload(BaseModel):
    text: str
    format: str = "pdf"  # "pdf" | "docx"
    company_name: Optional[str] = None
    role_title: Optional[str] = None


# ---------- Stage-based job-search document generation (AI Tools) ----------
class JobDocRequest(BaseModel):
    doc_type: str
    job_id: Optional[int] = None
    company_name: Optional[str] = None
    role_title: Optional[str] = None
    job_description: Optional[str] = None
    notes: Optional[str] = None


class JobDocResult(BaseModel):
    title: str
    text: str
    mode: str  # "llm" or "lite"


# ---------- ATS-Tailored Resume Regeneration ----------
class ResumeAiAssistRequest(BaseModel):
    kind: str                       # summary | bullets | role | skills
    title: Optional[str] = None
    existing: Optional[str] = None
    company: Optional[str] = None
    skills: Optional[str] = None


class TailorAnalyseRequest(BaseModel):
    """The advert plus the résumé on screen — the keyword and requirement read."""
    job_description: str
    values: dict = {}


class TailorKeywordsRequest(BaseModel):
    """Weave the keywords the person ticked into the sections they chose."""
    job_description: str = ""
    values: dict = {}
    keywords: list[str] = []
    targets: list[str] = ["skills"]


class TailorPreviewRequest(BaseModel):
    """A live tailoring proposal: what would change, at one of three strengths.

    Carries the résumé's fields rather than its id, because the builder asks
    for this while you are still editing — the version on screen is the one to
    tailor, saved or not. That is also why nothing here is persisted.
    """
    job_description: str
    level: str = "regular"
    values: dict = {}
    resume_id: Optional[int] = None   # only used to load values when none are sent
    # The person's own instruction — "keep every bullet, lead with Azure, UK
    # spelling". Empty means the safe default: reorder, never remove.
    prompt: str = ""


class TailorPromptIn(BaseModel):
    """A named instruction to keep. Both fields are the person's own words."""
    name: str
    body: str


class TailorPromptOut(BaseModel):
    id: int
    name: str
    body: str
    use_count: int = 0
    # What the parser makes of it, so a saved prompt can be checked without
    # running a tailoring pass first.
    notes: List[str] = []

    class Config:
        from_attributes = True


class TailorResumeRequest(BaseModel):
    resume_id: int
    job_description: str
    company_name: Optional[str] = None
    role_title: Optional[str] = None
    job_id: Optional[int] = None  # if given, that job's resume_id is updated to point at the new tailored resume


# ---------- Job Applications ----------
class JobEnrichIn(BaseModel):
    """Just enough for the enricher: the text, and the title that sharpens it."""
    job_description: str = ""
    role_title: str = ""


class JobCreate(BaseModel):
    company_name: str
    role_title: str
    job_link: Optional[str] = None
    date_applied: date
    status: JobStatus = JobStatus.applied
    resume_id: Optional[int] = None
    board_id: Optional[int] = None
    skills_required: Optional[str] = None
    tags: Optional[str] = None
    salary_range: Optional[str] = None
    location: Optional[str] = None
    source: Optional[str] = None
    notes: Optional[str] = None
    next_action_date: Optional[date] = None
    job_description: Optional[str] = None
    cover_letter: Optional[str] = None
    color: Optional[str] = None
    deadline: Optional[date] = None
    pipeline_stage: Optional[str] = None


class JobUpdate(BaseModel):
    company_name: Optional[str] = None
    role_title: Optional[str] = None
    job_link: Optional[str] = None
    date_applied: Optional[date] = None
    status: Optional[JobStatus] = None
    resume_id: Optional[int] = None
    board_id: Optional[int] = None
    skills_required: Optional[str] = None
    tags: Optional[str] = None
    salary_range: Optional[str] = None
    location: Optional[str] = None
    source: Optional[str] = None
    notes: Optional[str] = None
    next_action_date: Optional[date] = None
    job_description: Optional[str] = None
    cover_letter: Optional[str] = None
    ats_score: Optional[int] = None
    ats_breakdown: Optional[str] = None
    color: Optional[str] = None
    deadline: Optional[date] = None
    pipeline_stage: Optional[str] = None


class JobContactCreate(BaseModel):
    name: str
    role: Optional[str] = None
    email: Optional[str] = None
    linkedin_url: Optional[str] = None
    notes: Optional[str] = None


class JobContactUpdate(BaseModel):
    name: Optional[str] = None
    role: Optional[str] = None
    email: Optional[str] = None
    linkedin_url: Optional[str] = None
    notes: Optional[str] = None


class JobContactOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    job_id: int
    name: str
    role: Optional[str] = None
    email: Optional[str] = None
    linkedin_url: Optional[str] = None
    notes: Optional[str] = None
    created_at: datetime


class JobActivityCreate(BaseModel):
    kind: str
    title: Optional[str] = None
    body: Optional[str] = None
    occurred_at: Optional[datetime] = None


class JobActivityUpdate(BaseModel):
    kind: Optional[str] = None
    title: Optional[str] = None
    body: Optional[str] = None
    occurred_at: Optional[datetime] = None


class JobActivityOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    job_id: int
    kind: str
    title: Optional[str] = None
    body: Optional[str] = None
    occurred_at: datetime
    created_at: datetime


class JobActivityFeedItem(JobActivityOut):
    company_name: str
    role_title: str


class JobOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    board_id: Optional[int] = None
    company_name: str
    role_title: str
    job_link: Optional[str] = None
    date_applied: date
    status: JobStatus
    resume_id: Optional[int] = None
    skills_required: Optional[str] = None
    tags: Optional[str] = None
    salary_range: Optional[str] = None
    location: Optional[str] = None
    source: Optional[str] = None
    notes: Optional[str] = None
    next_action_date: Optional[date] = None
    job_description: Optional[str] = None
    cover_letter: Optional[str] = None
    ats_score: Optional[int] = None
    ats_breakdown: Optional[str] = None
    color: Optional[str] = None
    deadline: Optional[date] = None
    pipeline_stage: Optional[str] = None
    created_at: datetime
    updated_at: datetime


class JobDetailOut(JobOut):
    activities: list[JobActivityOut] = []
    contacts: list[JobContactOut] = []


# ---------- Job Boards ----------
class JobBoardCreate(BaseModel):
    name: str


class JobBoardUpdate(BaseModel):
    name: Optional[str] = None
    position: Optional[int] = None


class JobBoardOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    is_default: bool
    position: int
    created_at: datetime
    job_count: int = 0



# ---------- Chrome Extension: one-click capture ----------
# ---------- Chrome Extension: AI-assisted field extraction ----------
class ExtensionExtractRequest(BaseModel):
    """What the extension sends for AI-assisted parsing: a large raw text
    dump of the page plus whatever quick CSS-selector guesses it already
    made (as hints — used as a fallback and as a steer, not overridden
    lightly)."""
    raw_text: str
    title: Optional[str] = ""
    url: Optional[str] = ""
    hint_role: Optional[str] = ""
    hint_company: Optional[str] = ""
    hint_location: Optional[str] = ""


class ExtensionExtractResult(BaseModel):
    role_title: str
    company_name: str
    location: str
    salary_range: str
    job_description: str
    mode: str  # "llm" or "lite" — which extraction path produced this


class ExtensionCaptureRequest(BaseModel):
    """What the Chrome extension sends after scraping a job posting page."""
    company_name: str
    role_title: str
    job_link: Optional[str] = None
    location: Optional[str] = None
    salary_range: Optional[str] = None
    source: Optional[str] = None          # e.g. "LinkedIn", "Indeed" — captured automatically from the page's domain
    job_description: Optional[str] = None
    date_applied: Optional[date] = None
    status: JobStatus = JobStatus.applied
    resume_id: Optional[int] = None       # which saved resume to tailor / base the cover letter on
    auto_tailor_resume: bool = True       # regenerate a job-tailored resume (Resume Builder resumes only)
    auto_cover_letter: bool = True        # auto-generate a cover letter
    # Which design the tailored resume comes out in. Set from the extension's
    # own settings, so a capture doesn't silently inherit whatever template the
    # source resume happened to use. None keeps the source resume's template.
    template_id: Optional[str] = None
    board_id: Optional[int] = None   # which board the captured job lands on


class ExtensionCaptureResult(BaseModel):
    job: JobOut
    tailored_resume: Optional[ResumeOut] = None
    cover_letter: Optional[str] = None
    cover_letter_mode: Optional[str] = None
    ats_score: Optional[int] = None
    notes: List[str] = []   # human-readable status lines, e.g. skipped steps and why


class ProfileUpdate(BaseModel):
    """Every field optional: the profile page saves whatever the person edited."""
    name: Optional[str] = None
    headline: Optional[str] = None
    location: Optional[str] = None
    phone: Optional[str] = None
    website: Optional[str] = None
    linkedin: Optional[str] = None


# ---------- Resume Review ----------
# The review analyses either a saved resume (by id) or an unsaved Resume
# Builder draft (by passing its form values straight through), so the Review
# tab works before the user has ever hit Save.
class ResumeReviewRequest(BaseModel):
    resume_id: Optional[int] = None
    builder_data: Optional[dict] = None
    # A job description makes the review "targeted": keyword matching and a
    # job-alignment category are added and the weighting shifts. Either paste
    # it directly or point at a saved application via job_id.
    job_description: Optional[str] = None
    job_id: Optional[int] = None


class ReviewCategoryScore(BaseModel):
    key: str
    label: str
    score: int
    weight: int          # percent of the overall score this category carries
    contribution: float  # score * weight, i.e. points contributed to the total


class ReviewCheck(BaseModel):
    label: str
    status: str          # pass | fail | skip
    impact: int          # points deducted when failed


class ReviewFinding(BaseModel):
    severity: str        # critical | high | medium | optional
    category: str
    title: str           # what is wrong
    why: str             # why it matters
    fix: str             # how to fix it
    example: Optional[str] = None
    section: Optional[str] = None   # builder section id, for deep-linking "Fix this"
    items: List[str] = []


class ReviewBulletIssue(BaseModel):
    type: str
    detail: str


class ReviewBullet(BaseModel):
    text: str
    context: str = ""
    section: str
    quantified: bool
    action_led: bool
    weak: bool
    issues: List[ReviewBulletIssue] = []
    suggestion: Optional[str] = None


class ReviewATS(BaseModel):
    score: int
    checks: List[ReviewCheck] = []


class ReviewStructure(BaseModel):
    score: int
    present: List[str] = []
    missing: List[str] = []


class ReviewExperience(BaseModel):
    score: int
    total: int
    quantified: int
    action_led: int
    weak: int
    bullets: List[ReviewBullet] = []


class ReviewContent(BaseModel):
    score: int


class ReviewSkills(BaseModel):
    score: int
    hard_skills: List[str] = []      # recognised against the skill lexicon
    soft_skills: List[str] = []
    in_skills_section: List[str] = []
    missing_for_role: List[str] = []
    listed: List[str] = []           # every skill as the user actually wrote it
    unevidenced: List[str] = []      # listed, but never shown in experience


class ReviewJobMatch(BaseModel):
    score: int
    keyword_coverage_percent: Optional[float] = None
    term_similarity_percent: Optional[float] = None
    matched_keywords: List[str] = []
    missing_keywords: List[str] = []
    matched_hard_skills: List[str] = []
    missing_hard_skills: List[str] = []
    title_seniority_match: Optional[bool] = None
    term_frequency: dict = {}        # term -> times named in the job description


class ReviewOverview(BaseModel):
    """At-a-glance facts about the document itself, so the reader can sanity
    check what the analyser actually managed to read out of their resume."""
    words: int = 0
    pages: Optional[int] = None
    sections: int = 0
    skills_found: int = 0
    positions: int = 0
    education: int = 0
    bullets: int = 0


class ReviewCounts(BaseModel):
    critical: int = 0
    high: int = 0
    medium: int = 0
    optional: int = 0


class ResumeReviewResult(BaseModel):
    overall_score: int
    band: str                    # excellent | strong | needs work | weak
    mode: str                    # general | targeted
    source: str                  # builder | upload
    categories: List[ReviewCategoryScore]
    weights: dict
    ats: ReviewATS
    structure: ReviewStructure
    experience: ReviewExperience
    content: ReviewContent
    skills: ReviewSkills
    job_match: Optional[ReviewJobMatch] = None
    strengths: List[str] = []
    findings: List[ReviewFinding] = []
    counts: ReviewCounts
    overview: ReviewOverview
    word_count: int
    # Explicit statements of what this analysis could not verify. Surfaced in
    # the UI so a score is never mistaken for a guarantee of ATS compatibility.
    caveats: List[str] = []


# ---------- Telegram ----------
# The daily card is delivered by the bot, but everything about *when* and
# *where* it goes is configured from the web app, so these mirror the columns
# on telegram_links. Every field on the update model is optional: the settings
# page saves one control at a time (a time picker, a toggle), and requiring the
# whole object back would make each save able to clobber a change made in the
# Telegram chat a second earlier.
class StudyTimerOut(BaseModel):
    id: int
    block_id: Optional[int] = None
    subject: Optional[str] = None
    started_at: datetime
    elapsed_minutes: int
    source: Optional[str] = None


class StudyTimerStart(BaseModel):
    block_id: Optional[int] = None
    subject: Optional[str] = None


class StudyTimerStopped(BaseModel):
    minutes: int
    subject: Optional[str] = None
    block_id: Optional[int] = None
    logged: bool
    discarded: bool = False


class TelegramStatus(BaseModel):
    configured: bool          # server has a bot token at all
    enabled: bool             # ...and delivery isn't switched off
    bot_username: Optional[str] = None
    linked: bool = False
    default_timezone: str = "UTC"

    username: Optional[str] = None
    first_name: Optional[str] = None
    chat_id: Optional[str] = None
    timezone: Optional[str] = None
    daily_time: Optional[str] = None
    evening_time: Optional[str] = None
    send_evening: Optional[bool] = None
    carry_over_tasks: Optional[bool] = None
    close_when_done: Optional[bool] = None
    paused: Optional[bool] = None
    linked_at: Optional[datetime] = None
    last_morning_date: Optional[date] = None
    local_time: Optional[str] = None
    local_date: Optional[date] = None


class TelegramSettingsUpdate(BaseModel):
    timezone: Optional[str] = None
    daily_time: Optional[str] = None
    evening_time: Optional[str] = None
    send_evening: Optional[bool] = None
    carry_over_tasks: Optional[bool] = None
    close_when_done: Optional[bool] = None
    paused: Optional[bool] = None


class TelegramLinkCodeOut(BaseModel):
    code: str
    expires_at: datetime
    expires_in_seconds: int
    bot_username: Optional[str] = None
    deep_link: Optional[str] = None


class TelegramPreview(BaseModel):
    date: date
    text: str
    buttons: List[List[str]]
    totals: dict


# ---------------------------------------------------------------------------
# Job hunt
# ---------------------------------------------------------------------------

class JobSearchUpdate(BaseModel):
    roles: Optional[str] = None
    locations: Optional[str] = None
    remote_only: Optional[bool] = None
    since_days: Optional[int] = None
    exclude: Optional[str] = None
    notify_telegram: Optional[bool] = None
    auto_daily: Optional[bool] = None


class JobSearchOut(BaseModel):
    id: int
    roles: Optional[str] = None
    locations: Optional[str] = None
    remote_only: bool = False
    since_days: int = 30
    exclude: Optional[str] = None
    notify_telegram: bool = True
    auto_daily: bool = True
    last_run_at: Optional[datetime] = None
    last_run_new: int = 0

    class Config:
        from_attributes = True


class JobHuntRunResult(BaseModel):
    boards_searched: int
    boards_ok: int
    boards_failed: int
    matched: int
    new: int
    ran_at: Optional[datetime] = None
    # "cache" once the daily sweep has run, "live" on the very first search of
    # a fresh install, when there is nothing cached yet to read.
    source: Optional[str] = None
    cached_postings: Optional[int] = None
    cache_updated_at: Optional[datetime] = None


class BoardSweepOut(BaseModel):
    """What the last sweep did. The Job Hunt tab shows this so "no new jobs"
    can be told apart from "nothing has been fetched since Tuesday"."""
    started_at: Optional[datetime] = None
    finished_at: Optional[datetime] = None
    kind: Optional[str] = None
    boards_total: int = 0
    boards_ok: int = 0
    boards_failed: int = 0
    postings_new: int = 0
    postings_closed: int = 0
    postings_purged: int = 0
    open_postings: int = 0
    next_run_utc: Optional[str] = None
    retention_days: int = 7


class ReferralBrief(BaseModel):
    id: int
    name: str
    role: Optional[str] = None
    contact: Optional[str] = None


class JobHitOut(BaseModel):
    id: int
    company: str
    provider: Optional[str] = None
    title: str
    url: Optional[str] = None
    location: Optional[str] = None
    department: Optional[str] = None
    employment_type: Optional[str] = None
    remote: Optional[bool] = None
    posted_at: Optional[datetime] = None
    description: Optional[str] = None
    first_seen_at: Optional[datetime] = None
    status: str = "new"
    application_id: Optional[int] = None
    referrals: list[ReferralBrief] = []

    class Config:
        from_attributes = True


class JobHitUpdate(BaseModel):
    status: Optional[str] = None


class CompanyBoardCreate(BaseModel):
    url: str
    name: Optional[str] = None
    provider: Optional[str] = None


class CompanyBoardOut(BaseModel):
    id: int
    name: str
    provider: str
    token: str
    active: bool
    job_count: Optional[int] = 0
    last_error: Optional[str] = None
    last_ok_at: Optional[datetime] = None
    user_id: Optional[int] = None

    class Config:
        from_attributes = True


class ReferralContactCreate(BaseModel):
    company: str
    name: str
    role: Optional[str] = None
    contact: Optional[str] = None
    notes: Optional[str] = None


class ReferralContactOut(ReferralContactCreate):
    id: int
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class ApplicationProfileIn(BaseModel):
    full_name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    city: Optional[str] = None
    country: Optional[str] = None
    linkedin: Optional[str] = None
    github: Optional[str] = None
    website: Optional[str] = None
    work_auth_country: Optional[str] = None
    right_to_work: Optional[bool] = None
    visa_status: Optional[str] = None
    needs_sponsorship: Optional[bool] = None
    sponsorship_notes: Optional[str] = None
    notice_period: Optional[str] = None
    earliest_start: Optional[date] = None
    salary_expectation: Optional[str] = None
    salary_currency: Optional[str] = None
    willing_to_relocate: Optional[bool] = None
    remote_preference: Optional[str] = None
    preferred_locations: Optional[str] = None
    current_title: Optional[str] = None
    current_company: Optional[str] = None
    years_experience: Optional[int] = None
    default_resume_id: Optional[int] = None
    how_did_you_hear: Optional[str] = None


class ApplicationProfileOut(ApplicationProfileIn):
    id: int
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class LLMSettingsIn(BaseModel):
    provider: Optional[str] = None
    api_key: Optional[str] = None
    model: Optional[str] = None
    base_url: Optional[str] = None
    tone: Optional[str] = None
    length: Optional[str] = None
    instructions: Optional[str] = None
    temperature: Optional[str] = None


class LLMSettingsOut(BaseModel):
    configured: bool = False
    provider: str = "openai"
    model: str = ""
    base_url: str = ""
    key_hint: str = ""
    tone: str = ""
    length: str = "medium"
    instructions: str = ""
    temperature: str = "0.7"
    last_ok_at: Optional[datetime] = None
    last_error: Optional[str] = None


class LLMTestResult(BaseModel):
    ok: bool
    reply: Optional[str] = None
    model: Optional[str] = None
    error: Optional[str] = None


class LLMProviderOut(BaseModel):
    id: str
    label: str
    api: str
    base: str = ""
    model: str = ""
    keys: str = ""
    # The same page as `keys`, with a scheme, so the panel can offer a button
    # instead of an address to retype.
    keys_url: str = ""
    # Newline-separated "thing|explanation" steps, for a provider that is set
    # up rather than keyed — Ollama, which has no key page at all.
    setup: str = ""
    note: str = ""
    # "free" | "credits" | "paid" | "local" | "" — what it costs to run, which
    # is the first thing anyone picking one wants to know.
    cost: str = ""
    cost_label: str = ""
    cost_note: str = ""


class LLMModelsOut(BaseModel):
    ok: bool
    models: List[str] = []
    error: Optional[str] = None


# ---------- Portfolio designer ----------
class PortfolioDesignBase(BaseModel):
    name: str
    # A design document: { v, name, theme, blocks }. Untyped for the same
    # reason Portfolio.data is — block types and their options are still
    # moving, and pinning the shape here would fail validation on every
    # design saved before the next block landed.
    design: Optional[dict] = None


class PortfolioDesignCreate(PortfolioDesignBase):
    pass


class PortfolioDesignUpdate(BaseModel):
    name: Optional[str] = None
    design: Optional[dict] = None


class PortfolioDesignOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    design: Optional[dict] = None
    # How many portfolios currently wear this design. The library shows it so
    # deleting one is an informed decision rather than a surprise.
    used_by: int = 0
    created_at: datetime
    updated_at: Optional[datetime] = None
