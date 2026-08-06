"""
Momentum Resume Review
----------------------
A deterministic, offline resume analyser. Given a resume — either the
structured form data from the Resume Builder or the extracted text of an
uploaded file — it produces a transparent 0-100 score, per-category
breakdowns, and a prioritised list of specific, resume-derived fixes.

Design constraints, and why:

  * Deterministic. The same resume always produces the same score. No LLM
    sits in this path: scores that move between runs can't be trusted, can't
    be cached, and can't be explained to a user asking "why 74?". The AI
    layer in app/ai/engine.py is deliberately NOT called from here.

  * No new dependencies. Everything is stdlib regex and counting. The one
    external signal — PDF page count — is passed in by the caller, which
    already has pypdf open.

  * Honest about what it can see. A resume built here is rendered by
    resume_pdf.py, so its layout is known to be single-column and
    table-free; asserting that is fair. An uploaded PDF arrives as flat
    extracted text with the layout thrown away, so column and table checks
    are reported as *suspected* and the analysis says which checks could not
    be run. Nothing claims a resume "is ATS-compatible" — every surface
    here is phrased as an estimate.

  * Keyword/JD matching is delegated. ats_scorer.score_resume_against_job
    already does phrase extraction, alias normalisation, JD-section
    weighting and hard/soft skill separation. This module composes with it
    rather than reimplementing a weaker matcher alongside it.

Scoring is configurable — see SCORING_PROFILES at the bottom of the
constants block. Weights are data, not scattered magic numbers, so the
balance can be retuned without touching any analysis logic.
"""
import re
from collections import Counter

from .ats_scorer import (
    HARD_SKILL_ALIASES,
    SOFT_SKILL_TERMS,
    extract_phrases,
    score_resume_against_job,
)
from .cache import TTL_ATS, get_json, make_key, set_json

# ---------------------------------------------------------------------------
# Lexicons
# ---------------------------------------------------------------------------

# Verbs that open a strong, ownership-signalling bullet. Adapted from the
# ATS Screener project (MIT, sunnypatell/ats-screener), whose action-verb and
# quantification research is the most directly reusable part of that codebase.
STRONG_ACTION_VERBS = set("""
accelerated achieved administered advanced analyzed analysed architected automated
built centralized centralised championed collaborated conceptualized consolidated
converted coordinated created cut decreased delivered designed developed devised
directed doubled drove eliminated enabled engineered established exceeded executed
expanded facilitated forecast founded generated grew halved headed identified
implemented improved increased influenced initiated innovated instituted integrated
introduced launched led leveraged managed maximized maximised mentored migrated
modernized modernised negotiated onboarded operated optimized optimised orchestrated
organized organised outperformed overhauled oversaw pioneered planned presented
prioritized prioritised produced programmed proposed prototyped published raised
rearchitected rebuilt recommended redesigned reduced refactored reorganized replaced
researched resolved restructured revamped scaled secured shipped simplified slashed
spearheaded standardized standardised streamlined strengthened supervised surpassed
sustained trained transformed translated tripled unified upgraded validated won
""".split())

# Openers that describe a job description rather than an accomplishment.
# These are the single highest-signal weakness in most resumes.
WEAK_OPENERS = [
    ("responsible for", "states a duty rather than an outcome"),
    ("was responsible for", "states a duty rather than an outcome"),
    ("duties included", "reads as a job description, not an achievement"),
    ("tasked with", "frames the work as assigned rather than owned"),
    ("worked on", "gives no indication of your contribution or its effect"),
    ("worked with", "gives no indication of your contribution or its effect"),
    ("helped with", "understates ownership and hides the result"),
    ("helped to", "understates ownership and hides the result"),
    ("assisted with", "understates ownership and hides the result"),
    ("assisted in", "understates ownership and hides the result"),
    ("involved in", "describes proximity to work, not the work itself"),
    ("participated in", "describes attendance rather than contribution"),
    ("part of a team that", "attributes the result to the team, not to you"),
    ("in charge of", "states a duty rather than an outcome"),
]

# Suggested replacements, keyed by weak opener. Deliberately conservative —
# these rewrite the *frame* of the sentence and leave the user's own facts
# intact, because inventing achievements would be worse than a weak bullet.
OPENER_REWRITES = {
    "responsible for": "Owned",
    "was responsible for": "Owned",
    "duties included": "Delivered",
    "tasked with": "Led",
    "worked on": "Built",
    "worked with": "Partnered with",
    "helped with": "Contributed to",
    "helped to": "Contributed to",
    "assisted with": "Supported",
    "assisted in": "Supported",
    "involved in": "Drove",
    "participated in": "Contributed to",
    "part of a team that": "Worked in a team of N to",
    "in charge of": "Led",
}

# Phrases that survive on resumes purely by inertia. Every one of these is a
# claim with no evidence attached; recruiters discount them entirely.
BUZZWORDS = [
    "team player", "hard worker", "hard working", "detail oriented",
    "detail-oriented", "self starter", "self-starter", "go getter",
    "go-getter", "results driven", "results-driven", "results oriented",
    "think outside the box", "outside the box", "synergy", "synergies",
    "value add", "value-add", "best of breed", "wheelhouse", "guru",
    "ninja", "rockstar", "rock star", "thought leader", "dynamic individual",
    "proven track record", "excellent communication skills",
    "strong work ethic", "highly motivated", "passionate about",
    "wear many hats", "hit the ground running", "move the needle",
]

# Words that promise a number and then don't deliver one.
VAGUE_QUANTIFIERS = [
    "various", "several", "numerous", "many", "multiple", "a number of",
    "some", "lots of", "a lot of", "significant", "substantial",
    "considerable", "large amounts", "wide range", "wide variety",
]

# Quantification patterns — a bullet matching any of these carries a
# measurable result. Adapted from the ATS Screener, widened for currency
# symbols outside USD and for latency/throughput units common in engineering
# resumes, which the original set missed entirely.
QUANTIFICATION_PATTERNS = [
    re.compile(r"\d+(?:\.\d+)?\s*%"),                                  # 30%, 12.5%
    re.compile(r"[$£€¥₹]\s?[\d,]+(?:\.\d+)?\s*[kmb]?\b", re.I),        # $1.2M, £40k
    re.compile(r"\b\d+(?:\.\d+)?\s*x\b", re.I),                        # 3x
    re.compile(r"\b\d+\s*(?:times|fold)\b", re.I),                     # 3 times, tenfold
    re.compile(r"\b\d[\d,]*\+?\s*(?:users?|customers?|clients?|employees?|"
               r"members?|people|engineers?|developers?|students?|"
               r"stakeholders?|merchants?|subscribers?)\b", re.I),
    re.compile(r"\b\d[\d,]*\+?\s*(?:projects?|products?|applications?|apps?|"
               r"systems?|services?|endpoints?|repos?|repositories|"
               r"microservices?|models?|reports?|dashboards?|campaigns?)\b", re.I),
    re.compile(r"\b(?:top|first|#)\s*\d+", re.I),                      # top 5, #1
    re.compile(r"\b\d+(?:\.\d+)?\s*(?:ms|milliseconds?|seconds?|secs?|minutes?|"
               r"mins?|hours?|hrs?|days?|weeks?|months?|years?)\b", re.I),
    re.compile(r"\b\d{1,3}(?:,\d{3})+\b"),                             # 100,000
    re.compile(r"\b\d+(?:\.\d+)?\s*(?:million|billion|thousand|[kmb])\b", re.I),
    re.compile(r"\b\d+(?:\.\d+)?\s*(?:qps|rps|tps|req/s|gb|tb|mb|pb)\b", re.I),
    re.compile(r"\bfrom\s+\d[\d,.]*\s+to\s+\d[\d,.]*", re.I),          # from 5 to 40
]

# Canonical resume sections. `aliases` are the header spellings seen in the
# wild; `weight` is how much its absence costs the structure score.
SECTION_SPECS = [
    {"key": "contact",       "label": "Contact information", "weight": 16, "required": True,
     "aliases": []},  # detected from content (email/phone), not a header
    {"key": "summary",       "label": "Professional summary", "weight": 12, "required": False,
     "aliases": ["summary", "professional summary", "profile", "about me", "about",
                 "objective", "career objective", "personal statement", "overview"]},
    {"key": "experience",    "label": "Work experience", "weight": 26, "required": True,
     "aliases": ["experience", "work experience", "professional experience",
                 "employment", "employment history", "work history", "career history",
                 "relevant experience", "professional background"]},
    {"key": "education",     "label": "Education", "weight": 16, "required": True,
     "aliases": ["education", "academic background", "qualifications",
                 "academic qualifications", "academics"]},
    {"key": "skills",        "label": "Skills", "weight": 18, "required": True,
     "aliases": ["skills", "technical skills", "core skills", "key skills",
                 "competencies", "core competencies", "expertise", "technologies",
                 "technical proficiencies", "tools"]},
    {"key": "projects",      "label": "Projects", "weight": 6, "required": False,
     "aliases": ["projects", "personal projects", "side projects", "selected projects",
                 "portfolio", "open source"]},
    {"key": "certifications", "label": "Certifications", "weight": 4, "required": False,
     "aliases": ["certifications", "certificates", "licenses", "licences",
                 "accreditations", "training"]},
    {"key": "awards",        "label": "Awards", "weight": 2, "required": False,
     "aliases": ["awards", "honors", "honours", "achievements", "recognition"]},
]

SECTION_BY_KEY = {s["key"]: s for s in SECTION_SPECS}

# Header spellings ATS parsers reliably recognise. A creative header
# ("Where I've Made an Impact") may read beautifully and still cause a parser
# to file the whole block under nothing.
STANDARD_HEADERS = {
    "summary", "professional summary", "profile", "objective",
    "experience", "work experience", "professional experience", "employment history",
    "education", "skills", "technical skills", "projects", "certifications",
    "awards", "publications", "languages", "interests", "volunteering",
}

EMAIL_RE = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")
PHONE_RE = re.compile(r"(?:\+?\d{1,3}[\s.-]?)?(?:\(\d{2,4}\)[\s.-]?)?\d{3,4}[\s.-]?\d{3,4}(?:[\s.-]?\d{0,4})?")
URL_RE = re.compile(r"(?:https?://|www\.)[^\s,;]+|(?:linkedin\.com|github\.com)/[^\s,;]+", re.I)
BULLET_GLYPH_RE = re.compile(r"^\s*([-–—•*·▪►➤○●◦‣])\s+")
DATE_RANGE_RE = re.compile(
    r"\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s*'?\d{2,4}"
    r"|\b(?:19|20)\d{2}\b|\bpresent\b|\bcurrent\b|\bongoing\b", re.I)
PAST_TENSE_RE = re.compile(r"\b\w+(?:ed|ded|led|ted)\b", re.I)
PRESENT_TENSE_RE = re.compile(r"\b\w+(?<!ss)(?<!us)(?<!is)s\b")

# ---------------------------------------------------------------------------
# Scoring configuration
# ---------------------------------------------------------------------------
# Two profiles because a resume reviewed without a target job cannot be scored
# on job alignment — and scoring an unanswerable category as zero would punish
# the user for not pasting a job description. The weight is redistributed
# instead, so both profiles sum to 1.0 and both produce a genuine 0-100.
SCORING_PROFILES = {
    "general": {
        "ats_compatibility": 0.22,
        "experience_quality": 0.26,
        "content_quality": 0.18,
        "structure": 0.18,
        "skills_relevance": 0.16,
    },
    "targeted": {
        "ats_compatibility": 0.18,
        "experience_quality": 0.21,
        "content_quality": 0.13,
        "structure": 0.13,
        "skills_relevance": 0.10,
        "job_alignment": 0.25,
    },
}

CATEGORY_LABELS = {
    "ats_compatibility": "ATS compatibility",
    "experience_quality": "Experience quality",
    "content_quality": "Content quality",
    "structure": "Resume structure",
    "skills_relevance": "Skills coverage",
    "job_alignment": "Job description alignment",
}

# Severity ordering used to sort the recommendation list.
SEVERITY_RANK = {"critical": 0, "high": 1, "medium": 2, "optional": 3}


# ---------------------------------------------------------------------------
# Document normalisation
# ---------------------------------------------------------------------------
class ReviewDoc:
    """One resume, normalised into the shape every analyser below expects.

    Builder resumes and uploaded resumes arrive completely differently — one
    as structured form fields, the other as a flat blob of extracted text.
    Normalising once here is what lets every check downstream be written a
    single time instead of twice.
    """

    __slots__ = ("text", "source", "sections", "bullets", "contact",
                 "word_count", "page_count", "lines", "headers_found",
                 "experience_blocks", "skill_entries", "education_count")

    def __init__(self, text, source, sections, bullets, contact,
                 page_count=None, headers_found=None, experience_blocks=None,
                 skill_entries=None, education_count=0):
        self.text = text
        self.source = source              # "builder" | "upload"
        self.sections = sections          # key -> text (present sections only)
        self.bullets = bullets            # list of dicts
        self.contact = contact            # dict of detected contact fields
        self.page_count = page_count
        self.headers_found = headers_found or []
        self.experience_blocks = experience_blocks or []
        # Skills exactly as the user wrote them, not as a lexicon recognises
        # them. "Power BI (DAX)" and "Beautiful Soup" are real entries on real
        # resumes that no fixed alias table will ever contain, and reporting
        # only the recognised subset makes the review look like it can't read.
        self.skill_entries = skill_entries or []
        self.education_count = education_count
        self.lines = [l for l in text.split("\n")]
        self.word_count = len(re.findall(r"\b[\w'-]+\b", text))


def _split_blocks(raw):
    """Builder experience/education/projects fields store one entry per block,
    blocks separated by a '---' line, first line the heading and the rest the
    bullets. Mirrors rbParseBlocks() on the frontend."""
    blocks = []
    for chunk in re.split(r"\n-{3,}\n", str(raw or "")):
        lines = [l.strip() for l in chunk.split("\n") if l.strip()]
        if not lines:
            continue
        blocks.append({"head": lines[0], "body": lines[1:]})
    return blocks


def _clean_bullet(line):
    return BULLET_GLYPH_RE.sub("", line).strip()


def _extract_skill_entries(skills_text):
    """Every skill the user actually listed, verbatim.

    The builder stores skills as "Category: a, b, c" per line; uploaded
    resumes use commas, pipes, bullets or semicolons. Splitting on all of
    them and keeping the surface form means a skill is reported the way it
    was written — parenthetical qualifiers ("Power BI (DAX)") and all —
    rather than being silently dropped for not matching an alias table.
    """
    entries = []
    for raw_line in str(skills_text or "").split("\n"):
        line = raw_line.strip()
        if not line:
            continue
        line = BULLET_GLYPH_RE.sub("", line)
        # Drop a leading "Category:" label, but only when it reads like one —
        # a colon inside "Tools: X" is a label, a colon inside a URL is not.
        if ":" in line:
            head, _, tail = line.partition(":")
            if len(head.split()) <= 4 and tail.strip():
                line = tail
        for part in re.split(r"[,;|•·]|\s{3,}", line):
            item = part.strip(" .\t")
            if not item or len(item) > 40 or item.lower().startswith("http"):
                continue
            # Single-character entries are kept here, unlike in the skill
            # lexicon. R and C are real languages, and inside the user's own
            # skills block a bare "R" between two commas is unambiguous —
            # the false-positive risk that rules them out of prose matching
            # simply doesn't exist in this context.
            if len(item) == 1 and not item.isalnum():
                continue
            entries.append(item)
    seen, out = set(), []
    for e in entries:
        k = e.lower()
        if k not in seen:
            seen.add(k)
            out.append(e)
    return out


# Date-format families. ATS parsers key on a consistent shape; mixing them is
# a common cause of a role landing with an empty or wrong date field.
DATE_FORMATS = [
    ("MM/YYYY",     re.compile(r"^\d{1,2}[/-]\d{4}$")),
    ("YYYY-MM",     re.compile(r"^\d{4}-\d{1,2}$")),
    ("Mon YYYY",    re.compile(r"^(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)\.?\s+\d{4}$", re.I)),
    ("Month YYYY",  re.compile(r"^(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{4}$", re.I)),
    ("Mon 'YY",     re.compile(r"^(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)\.?\s*'\d{2}$", re.I)),
    ("YYYY only",   re.compile(r"^\d{4}$")),
    ("Present",     re.compile(r"^(?:present|current|ongoing|now|to date)$", re.I)),
]


def _classify_date(token):
    for name, rx in DATE_FORMATS:
        if rx.match(token.strip()):
            return name
    return None


def _dates_in(text):
    """Pull the individual date tokens out of a role heading."""
    found = []
    for part in re.split(r"\s*(?:[-–—]|\bto\b|,)\s*", str(text or "")):
        part = part.strip()
        if part and _classify_date(part):
            found.append(part)
    return found


def _doc_from_builder(data):
    """Build a ReviewDoc from Resume Builder form values."""
    g = lambda k: str(data.get(k) or "").strip()

    sections, parts = {}, []

    contact_bits = [g("full_name"), g("title"), g("location"), g("phone"),
                    g("email"), g("linkedin"), g("website")]
    contact_text = "\n".join(b for b in contact_bits if b)
    if contact_text:
        sections["contact"] = contact_text
        parts.append(contact_text)

    for key, field in (("summary", "summary"), ("skills", "skills")):
        val = g(field)
        if val:
            sections[key] = val
            parts.append(f"{SECTION_BY_KEY[key]['label']}\n{val}")

    bullets, experience_blocks, education_count = [], [], 0
    for key in ("experience", "education", "projects"):
        val = g(key)
        if not val:
            continue
        sections[key] = val
        parts.append(f"{SECTION_BY_KEY[key]['label']}\n{val}")
        blocks = _split_blocks(val)
        if key == "education":
            education_count = len(blocks)
        for idx, block in enumerate(blocks):
            head_parts = [p.strip() for p in block["head"].split("|") if p.strip()]
            role = head_parts[0] if head_parts else ""
            company = head_parts[1] if len(head_parts) > 1 else ""
            if key == "experience":
                experience_blocks.append({
                    "head": block["head"],
                    "role": role,
                    "company": company,
                    "dates": head_parts[-1] if len(head_parts) > 2 else "",
                    "bullets": [_clean_bullet(b) for b in block["body"]],
                    "bullet_count": len(block["body"]),
                })
            if key in ("experience", "projects"):
                for b_idx, line in enumerate(block["body"]):
                    text = _clean_bullet(line)
                    if len(text) < 3:
                        continue
                    bullets.append({
                        "text": text,
                        "section": key,
                        "block": idx,
                        "index": b_idx,
                        "context": role,
                        "company": company,
                    })

    # Free-text sections the builder exposes but doesn't structure.
    for key in ("certifications", "awards"):
        val = g(key)
        if val:
            sections[key] = val
            parts.append(val)

    return ReviewDoc(
        text="\n\n".join(parts),
        source="builder",
        sections=sections,
        bullets=bullets,
        contact=_detect_contact(contact_text or "\n".join(parts)),
        headers_found=sorted(sections.keys()),
        experience_blocks=experience_blocks,
        skill_entries=_extract_skill_entries(sections.get("skills", "")),
        education_count=education_count,
    )


def _doc_from_text(text, page_count=None):
    """Build a ReviewDoc from the flat extracted text of an uploaded file.

    Section boundaries are recovered by looking for short standalone lines
    that match a known header alias. This is genuinely lossy — a resume whose
    headers are images, or set in a two-column layout the extractor
    interleaved, will under-report. The ATS analysis below treats a low
    header count as its own finding rather than pretending the sections
    simply aren't there.
    """
    lines = [l.rstrip() for l in str(text or "").split("\n")]

    alias_to_key = {}
    for spec in SECTION_SPECS:
        for alias in spec["aliases"]:
            alias_to_key[alias] = spec["key"]

    marks = []  # (line_index, section_key, raw_header)
    for i, line in enumerate(lines):
        probe = re.sub(r"[^a-z\s]", "", line.strip().lower()).strip()
        if not probe or len(probe) > 40:
            continue
        # A header is a short line that is *only* the header — a sentence
        # beginning with "Experience building..." must not match.
        if probe in alias_to_key and len(line.strip()) <= 40:
            marks.append((i, alias_to_key[probe], line.strip()))

    sections = {}
    for n, (start, key, _raw) in enumerate(marks):
        end = marks[n + 1][0] if n + 1 < len(marks) else len(lines)
        body = "\n".join(lines[start + 1:end]).strip()
        if body and key not in sections:
            sections[key] = body

    contact = _detect_contact("\n".join(lines[:12]) or text)
    if contact.get("email") or contact.get("phone"):
        sections.setdefault("contact", "\n".join(lines[:8]))

    # Walk the body recovering both bullets and the role headings they sit
    # under. Inside an experience block, a non-empty line that isn't a bullet
    # is the start of a new role — which is what lets a finding say "your
    # Azure Data Engineer role at Tata Consultancy Services" instead of
    # "some of your roles".
    bullets, experience_blocks, education_count = [], [], 0
    exp_keys = {"experience", "projects"}
    active, current = None, None
    mark_at = {m[0]: m[1] for m in marks}

    def close_block():
        if current and current["bullets"]:
            current["bullet_count"] = len(current["bullets"])
            experience_blocks.append(current)

    for i, line in enumerate(lines):
        if i in mark_at:
            close_block()
            current = None
            active = mark_at[i]
            continue
        stripped = line.strip()
        if not stripped:
            continue
        if active == "education":
            # One education entry per line that carries a year or a degree word.
            if DATE_RANGE_RE.search(stripped) or re.search(
                    r"\b(bsc|ba|bs|beng|msc|ma|mba|meng|phd|diploma|degree|bachelor|master)\b",
                    stripped, re.I):
                education_count += 1
            continue
        if active not in exp_keys:
            continue
        if BULLET_GLYPH_RE.match(line):
            if current is None:
                current = {"head": "", "role": "", "company": "", "dates": "",
                           "bullets": [], "bullet_count": 0}
            # Not `text` — that's the function's own parameter, and rebinding
            # it here silently reduced the whole document to the last bullet.
            bullet_text = _clean_bullet(line)
            current["bullets"].append(bullet_text)
            bullets.append({
                "text": bullet_text, "section": active,
                "block": len(experience_blocks), "index": len(bullets),
                "context": current["role"], "company": current["company"],
            })
        else:
            close_block()
            # "Marketing Manager, Globex, 2020 - Present" — role, company and
            # dates in one line is the near-universal convention.
            segs = [s.strip() for s in re.split(r"\s*[,|·]\s*|\s+[-–—]\s+", stripped) if s.strip()]
            dates = _dates_in(stripped)
            named = [s for s in segs if not _classify_date(s)]
            current = {
                "head": stripped,
                "role": named[0] if named else stripped,
                "company": named[1] if len(named) > 1 else "",
                "dates": " - ".join(dates),
                "bullets": [], "bullet_count": 0,
            }
    close_block()

    return ReviewDoc(
        text=str(text or ""),
        source="upload",
        sections=sections,
        bullets=bullets,
        contact=contact,
        page_count=page_count,
        headers_found=[m[2] for m in marks],
        experience_blocks=experience_blocks,
        skill_entries=_extract_skill_entries(sections.get("skills", "")),
        education_count=education_count,
    )


def _detect_contact(text):
    email = EMAIL_RE.search(text or "")
    urls = URL_RE.findall(text or "")
    phone = None
    for candidate in PHONE_RE.findall(text or ""):
        digits = re.sub(r"\D", "", candidate)
        if 7 <= len(digits) <= 15:
            phone = candidate.strip()
            break
    return {
        "email": email.group(0) if email else None,
        "phone": phone,
        "linkedin": next((u for u in urls if "linkedin" in u.lower()), None),
        "website": next((u for u in urls if "linkedin" not in u.lower()), None),
    }


# ---------------------------------------------------------------------------
# Finding helper
# ---------------------------------------------------------------------------
def _finding(severity, category, title, why, fix, example=None, section=None, items=None):
    """One actionable item. Every finding answers the same four questions the
    brief asks for: what is wrong, why it matters, how to fix it, and — where
    a generic example would actually help — what good looks like."""
    return {
        "severity": severity,          # critical | high | medium | optional
        "category": category,
        "title": title,
        "why": why,
        "fix": fix,
        "example": example,
        "section": section,            # builder section id, for "Fix this" deep links
        "items": items or [],
    }


# ---------------------------------------------------------------------------
# Category: ATS compatibility
# ---------------------------------------------------------------------------
def _analyse_ats(doc):
    findings, checks, deductions = [], [], 0.0

    def deduct(points, label, status="fail"):
        nonlocal deductions
        deductions += points
        checks.append({"label": label, "status": status, "impact": round(points)})

    def ok(label):
        checks.append({"label": label, "status": "pass", "impact": 0})

    # --- contact parseability -------------------------------------------
    if not doc.contact.get("email"):
        deduct(14, "Machine-readable email address")
        findings.append(_finding(
            "critical", "ats_compatibility", "No email address detected",
            "An ATS builds your candidate record from parsed contact fields. With no "
            "readable email, the record may be created with no way to contact you.",
            "Add your email as plain text near the top of the resume — not inside a "
            "header, footer, text box, or image.",
            section="sec-details"))
    else:
        ok("Machine-readable email address")

    if not doc.contact.get("phone"):
        deduct(6, "Machine-readable phone number")
        findings.append(_finding(
            "high", "ats_compatibility", "No phone number detected",
            "Most ATS candidate records expect a phone field; recruiters filter on it.",
            "Add a phone number in plain text, digits grouped normally "
            "(e.g. +44 7700 900123).",
            section="sec-details"))
    else:
        ok("Machine-readable phone number")

    # --- length ----------------------------------------------------------
    wc = doc.word_count
    if wc < 150:
        deduct(16, "Sufficient extractable text")
        findings.append(_finding(
            "critical", "ats_compatibility",
            f"Only {wc} words of text could be read",
            "Either the resume is very short, or — if it was uploaded — most of its "
            "text is not machine-readable. A parser sees roughly what this analysis saw.",
            "If the file is a scan or the text sits inside images or text boxes, "
            "rebuild it as a text-based document. Otherwise expand the content."))
    elif wc < 300:
        deduct(6, "Sufficient extractable text")
        findings.append(_finding(
            "medium", "ats_compatibility", f"Resume is short at {wc} words",
            "Short resumes give keyword filters very little to match against.",
            "Aim for roughly 400-800 words for a one-page resume."))
    elif wc > 1200:
        deduct(4, "Length within typical range")
        findings.append(_finding(
            "medium", "ats_compatibility", f"Resume is long at {wc} words",
            "Long resumes get truncated by some parsers and skimmed by recruiters.",
            "Trim to the most relevant 400-800 words, dropping roles over ~10 years old."))
    else:
        ok("Length within typical range")

    if doc.page_count and doc.page_count > 2:
        deduct(6, "Page count of 2 or fewer")
        findings.append(_finding(
            "medium", "ats_compatibility", f"Resume runs to {doc.page_count} pages",
            "Some parsers only index the first pages, and most recruiters stop at two.",
            "Condense to 1-2 pages."))
    elif doc.page_count:
        ok("Page count of 2 or fewer")

    # --- layout ----------------------------------------------------------
    # What can honestly be said here depends entirely on where the resume came
    # from. A builder resume is rendered by resume_pdf.py, so its layout is
    # known. An uploaded resume arrives with its layout already discarded by
    # text extraction — so these are reported as suspicions, never findings of
    # fact, and the caveats list says so.
    caveats = []
    if doc.source == "builder":
        ok("Single-column, table-free layout")
        ok("No text trapped in images")
    else:
        text = doc.text
        # A run of 3+ spaces mid-line, on many lines, is the fingerprint left
        # behind when a PDF extractor flattens columns or a table into text.
        gappy = [l for l in doc.lines if len(l.strip()) > 20 and len(re.findall(r"\S {3,}\S", l)) >= 2]
        if len(gappy) >= 8:
            deduct(10, "No column or table artefacts in extracted text")
            findings.append(_finding(
                "high", "ats_compatibility",
                "Extracted text looks like it came from columns or tables",
                f"{len(gappy)} lines contain wide internal gaps, which is what a "
                "multi-column layout or a table looks like once a parser flattens it. "
                "Text read out of order can attach your skills to the wrong job.",
                "Rebuild in a single-column layout with no tables. Every ATS reads "
                "top-to-bottom, left-to-right.",
                items=[l.strip()[:110] for l in gappy[:3]]))
        else:
            ok("No column or table artefacts in extracted text")

        special = len(re.findall(r"[^\w\s.,;:!?@#$%&*()\-+=/\\'\"°£€¥•–—]", text))
        if text and special / max(len(text), 1) > 0.03:
            deduct(8, "Clean character encoding")
            findings.append(_finding(
                "high", "ats_compatibility", "Unusual characters found in the text",
                "A high density of unexpected glyphs usually means the font didn't map "
                "cleanly to text — the parser may be reading garbled words.",
                "Re-export the PDF with a standard font (Calibri, Arial, Helvetica, "
                "Georgia) and embedded text rather than outlines."))
        else:
            ok("Clean character encoding")

        caveats.append(
            "This resume was uploaded, so its original layout was discarded during text "
            "extraction. Column, table and image checks are inferred from the extracted "
            "text and are indicative only.")

    # --- headers ---------------------------------------------------------
    if doc.source == "upload":
        recognised = sum(1 for h in doc.headers_found
                         if re.sub(r"[^a-z\s]", "", h.lower()).strip() in STANDARD_HEADERS)
        if recognised < 3:
            deduct(10, "Recognisable section headers")
            findings.append(_finding(
                "high", "ats_compatibility",
                f"Only {recognised} standard section header(s) were recognised",
                "Parsers map content to fields by matching header text. Creative headings "
                "like 'Where I've Made an Impact' leave the block below them unfiled.",
                "Use plain headers: Summary, Experience, Education, Skills, Projects.",
                example="Experience   (not: 'My Journey So Far')"))
        else:
            ok("Recognisable section headers")

    # --- bullet consistency ---------------------------------------------
    glyphs = {m.group(1) for m in (BULLET_GLYPH_RE.match(l) for l in doc.lines) if m}
    if len(glyphs) > 2:
        deduct(3, "Consistent bullet characters")
        findings.append(_finding(
            "optional", "ats_compatibility",
            f"{len(glyphs)} different bullet characters are in use",
            "Mixed bullet glyphs read as inconsistent to a human and occasionally break "
            "list detection.",
            "Pick one bullet character and use it throughout.",
            items=sorted(glyphs)))
    else:
        ok("Consistent bullet characters")

    # --- all-caps --------------------------------------------------------
    caps = [l for l in doc.lines if len(l.strip()) > 30 and l == l.upper() and re.search(r"[A-Z]", l)]
    if len(caps) > 3:
        deduct(3, "No long all-caps passages")
        findings.append(_finding(
            "optional", "ats_compatibility", f"{len(caps)} long lines are entirely uppercase",
            "Long all-caps passages are harder to read and can defeat keyword matching "
            "in parsers that are case-sensitive on acronyms.",
            "Reserve capitals for section headers and genuine acronyms."))
    else:
        ok("No long all-caps passages")

    # --- date format consistency ----------------------------------------
    # Presence of dates is checked below; this is about their *shape*. A
    # resume mixing "Aug 2025" with "08/2021" gives the parser two different
    # patterns to recognise on the same field, and the one it doesn't handle
    # lands as an empty date — which silently drops the role out of every
    # recency-filtered search.
    date_shapes, shape_examples = Counter(), {}
    for blk in doc.experience_blocks:
        for token in _dates_in(blk.get("dates") or blk.get("head") or ""):
            shape = _classify_date(token)
            if not shape or shape == "Present":
                continue
            date_shapes[shape] += 1
            shape_examples.setdefault(shape, []).append(token)
    if len(date_shapes) > 1:
        deduct(9, "Consistent date formatting")
        examples = [f"\"{shape_examples[s][0]}\" ({s})" for s in date_shapes]
        findings.append(_finding(
            "high", "ats_compatibility",
            f"Employment dates use {len(date_shapes)} different formats",
            "Parsers match dates against a pattern. Two shapes on one resume means "
            "one of them is likely to be missed, leaving that role with no dates — "
            "and roles with no dates drop out of recency and tenure filters.",
            "Pick one format and use it for every role. MM/YYYY is the most reliably "
            "parsed; 'Mon YYYY' is the most readable. Whichever you pick, use it "
            "everywhere including the end date.",
            example="03/2021 - Present    (or: Mar 2021 - Present — but not both)",
            items=examples, section="sec-experience"))
    elif date_shapes:
        ok("Consistent date formatting")

    # A comma between the two ends of a range — "Aug 2025, Present" — is a
    # separate problem from format inconsistency and more likely to bite. A
    # dash is what every parser is written to split on; a comma reads as a
    # list, so the range can be captured as a single start date with no end,
    # or as one malformed field.
    comma_ranges = []
    for blk in doc.experience_blocks:
        field = blk.get("dates") or blk.get("head") or ""
        if re.search(r"(?:\d{4}|'\d{2})\s*,\s*(?:present|current|ongoing|"
                     r"[A-Za-z]{3,9}\.?\s*'?\d{2,4}|\d{1,2}[/-]\d{4})", field, re.I):
            comma_ranges.append(field.strip())
    if comma_ranges:
        deduct(7, "Date ranges use a dash separator")
        findings.append(_finding(
            "high", "ats_compatibility",
            f"{len(comma_ranges)} date range(s) are separated by a comma, not a dash",
            "Parsers split a date range on a dash or the word 'to'. A comma reads as a "
            "list separator, so the range can be captured as a start date with no end — "
            "which makes the role look either current or undated depending on the system.",
            "Use a dash between start and end: 'Aug 2025 - Present'. If you want the "
            "most reliably parsed form, numeric MM/YYYY is safest: '08/2025 - Present'.",
            example="Aug 2025 - Present    (not: Aug 2025, Present)",
            items=comma_ranges[:4], section="sec-experience"))
    elif doc.experience_blocks:
        ok("Date ranges use a dash separator")

    # --- dates present ---------------------------------------------------
    if not DATE_RANGE_RE.search(doc.sections.get("experience", "")):
        if doc.sections.get("experience"):
            deduct(8, "Dated work history")
            findings.append(_finding(
                "high", "ats_compatibility", "No dates found on your work experience",
                "ATS records compute tenure and recency from parsed dates. Undated roles "
                "often land with empty date fields and get filtered out of recency searches.",
                "Add a date range to every role, e.g. 'Mar 2021 - Present'.",
                section="sec-experience"))
        else:
            checks.append({"label": "Dated work history", "status": "skip", "impact": 0})
    else:
        ok("Dated work history")

    score = max(0, min(100, round(100 - deductions)))
    return score, findings, checks, caveats


# ---------------------------------------------------------------------------
# Category: structure
# ---------------------------------------------------------------------------
def _analyse_structure(doc):
    findings = []
    present, missing, earned, possible = [], [], 0.0, 0.0

    for spec in SECTION_SPECS:
        possible += spec["weight"]
        body = doc.sections.get(spec["key"], "")
        has = bool(body and body.strip())
        if has:
            present.append(spec["label"])
            earned += spec["weight"]
        else:
            missing.append(spec["label"])
            if spec["required"]:
                findings.append(_finding(
                    "critical" if spec["key"] in ("experience", "contact") else "high",
                    "structure", f"Missing section: {spec['label']}",
                    "Recruiters and parsers both expect this section. Its absence is one of "
                    "the most common reasons a resume is filtered before a human reads it.",
                    f"Add a {spec['label']} section.",
                    section=f"sec-{spec['key']}"))
            elif spec["key"] in ("summary", "projects"):
                findings.append(_finding(
                    "medium" if spec["key"] == "summary" else "optional",
                    "structure", f"No {spec['label'].lower()}",
                    "A summary is the first thing read and the last thing written; without "
                    "one, the reader has to infer your positioning from your job titles."
                    if spec["key"] == "summary" else
                    "Projects are how candidates with thin work history demonstrate range.",
                    f"Add a {spec['label'].lower()} section.",
                    section=f"sec-{spec['key']}"))

    # Summary length is a structural property, not a content one.
    summary = doc.sections.get("summary", "")
    if summary:
        words = len(re.findall(r"\b[\w'-]+\b", summary))
        if words < 20:
            findings.append(_finding(
                "medium", "structure", f"Professional summary is very short ({words} words)",
                "A one-line summary can't establish your specialism, seniority and target "
                "role — which is the whole job of the section.",
                "Write 2-3 sentences: what you do, your depth in it, and what you're aiming at.",
                example="Backend engineer with 6 years building payment systems at scale. "
                        "Led the migration of a monolith serving 2M daily transactions to "
                        "event-driven services. Looking for staff-level platform work.",
                section="sec-profile"))
        elif words > 120:
            findings.append(_finding(
                "medium", "structure", f"Professional summary is long ({words} words)",
                "Summaries over ~80 words stop being scanned and start being skipped.",
                "Cut to 2-4 sentences and move the detail into your experience bullets.",
                section="sec-profile"))

    # Experience blocks with no bullets at all.
    if doc.experience_blocks:
        bare = [b for b in doc.experience_blocks if b["bullet_count"] == 0]
        if bare:
            findings.append(_finding(
                "high", "structure",
                f"{len(bare)} role(s) have no bullet points",
                "A role with a title and dates but no content tells the reader you held a "
                "job, not what you did in it.",
                "Add 2-4 achievement bullets to each role.",
                items=[b["head"] for b in bare[:4]], section="sec-experience"))
        thin = [b for b in doc.experience_blocks if 0 < b["bullet_count"] < 2]
        if thin:
            findings.append(_finding(
                "medium", "structure",
                f"{len(thin)} role(s) have only one bullet point",
                "One bullet rarely covers scope, action and result for a whole role.",
                "Expand to 2-4 bullets, one per distinct achievement.",
                items=[b["head"] for b in thin[:4]], section="sec-experience"))

    # Duplicate sections (uploaded resumes sometimes repeat a header).
    dupes = [h for h, n in Counter(
        re.sub(r"[^a-z\s]", "", h.lower()).strip() for h in doc.headers_found).items() if n > 1]
    if dupes:
        findings.append(_finding(
            "medium", "structure", "Duplicated section headers",
            "A repeated header splits one logical section into two records in the parsed "
            "output, and the second is often discarded.",
            "Merge the duplicated sections into one.", items=dupes[:4]))

    score = round((earned / possible) * 100) if possible else 0
    return score, findings, {"present": present, "missing": missing}


# ---------------------------------------------------------------------------
# Category: experience & bullet quality
# ---------------------------------------------------------------------------
def _quantified(text):
    return any(p.search(text) for p in QUANTIFICATION_PATTERNS)


def _first_word(text):
    m = re.match(r"\s*([A-Za-z][\w'-]*)", text or "")
    return m.group(1).lower() if m else ""


def _analyse_bullets(doc):
    """Per-bullet analysis. Every issue raised here points at a specific bullet
    the user actually wrote — the brief's hard rule is no generic feedback, so
    nothing in this function fires without a concrete line to attach it to."""
    bullets = doc.bullets
    if not bullets:
        return 0, [], [], {"total": 0, "quantified": 0, "action_led": 0, "weak": 0}

    reviewed, weak_count, quantified, action_led = [], 0, 0, 0
    opener_counts = Counter()

    for b in bullets:
        text = b["text"]
        issues, suggestion = [], None
        low = text.lower()
        words = re.findall(r"\b[\w'-]+\b", text)
        first = _first_word(text)
        opener_counts[first] += 1

        is_quant = _quantified(text)
        if is_quant:
            quantified += 1
        is_action = first in STRONG_ACTION_VERBS
        if is_action:
            action_led += 1

        # weak opener
        hit_opener = next((w for w, _ in WEAK_OPENERS if low.startswith(w)), None)
        if not hit_opener:
            hit_opener = next((w for w, _ in WEAK_OPENERS if w in low[:40]), None)
        if hit_opener:
            reason = dict(WEAK_OPENERS)[hit_opener]
            issues.append({"type": "weak_opener",
                           "detail": f"Opens with \"{hit_opener}\" — {reason}."})
            repl = OPENER_REWRITES.get(hit_opener)
            if repl:
                rest = re.sub(re.escape(hit_opener), "", text, count=1, flags=re.I).strip()
                rest = rest[0].lower() + rest[1:] if rest else rest
                suggestion = f"{repl} {rest}".strip()

        if not is_action and not hit_opener:
            issues.append({"type": "no_action_verb",
                           "detail": f"Starts with \"{first}\" rather than an action verb."})

        if not is_quant:
            issues.append({"type": "not_quantified",
                           "detail": "No measurable result — no number, percentage, "
                                     "amount, scale or timeframe."})

        vague = [v for v in VAGUE_QUANTIFIERS if re.search(rf"\b{re.escape(v)}\b", low)]
        if vague:
            issues.append({"type": "vague",
                           "detail": f"Uses \"{vague[0]}\" where a number would be stronger."})

        if len(words) > 42:
            issues.append({"type": "too_long",
                           "detail": f"{len(words)} words — long bullets get skimmed past."})
        elif len(words) < 6:
            issues.append({"type": "too_short",
                           "detail": f"Only {len(words)} words — too thin to carry an achievement."})

        if re.search(r"\b(i|my|me)\b", low):
            issues.append({"type": "first_person",
                           "detail": "Uses first person; resume bullets conventionally drop it."})

        # A bullet is "weak" if it fails on impact or ownership — the two
        # things a bullet exists to establish. Length and person are style.
        weak = any(i["type"] in ("weak_opener", "no_action_verb", "not_quantified")
                   for i in issues)
        if weak:
            weak_count += 1

        if issues:
            reviewed.append({
                "text": text,
                "context": b.get("context", ""),
                "section": b["section"],
                "quantified": is_quant,
                "action_led": is_action,
                "weak": weak,
                "issues": issues,
                "suggestion": suggestion,
            })

    total = len(bullets)
    quant_ratio = quantified / total
    action_ratio = action_led / total

    # 40% quantified and 70% action-led are the benchmarks, but they are
    # *floors* — the point where a resume stops being a problem, not where it
    # becomes excellent. Scoring them as the maximum meant a resume with one
    # fully-quantified role and one with no numbers at all still scored in the
    # nineties, which contradicted the high-severity findings sitting right
    # beside the number. The divisors sit above the benchmarks so that
    # clearing the floor reads as "adequate" and full marks require clearly
    # exceeding it.
    quant_score = min(1.0, quant_ratio / 0.55) * 45
    action_score = min(1.0, action_ratio / 0.80) * 30
    density = 25 if total >= 8 else 20 if total >= 5 else 14 if total >= 3 else 7

    # A single role with no measurable outcome anywhere in it is a bigger
    # problem than the same number of unquantified bullets spread evenly — it
    # leaves one whole job on the resume that a reader cannot size.
    quant_by_block_pre = {}
    for b in bullets:
        if b["section"] != "experience":
            continue
        slot = quant_by_block_pre.setdefault(b["block"], {"n": 0, "q": 0})
        slot["n"] += 1
        slot["q"] += 1 if _quantified(b["text"]) else 0
    bare_roles = sum(1 for s in quant_by_block_pre.values() if s["n"] >= 2 and not s["q"])
    role_penalty = min(24, bare_roles * 12)

    score = round(max(0, min(100, quant_score + action_score + density - role_penalty)))

    findings = []
    if quant_ratio < 0.40:
        unquantified = [r for r in reviewed if not r["quantified"]]
        findings.append(_finding(
            "critical" if quant_ratio < 0.15 else "high",
            "experience_quality",
            f"Only {round(quant_ratio * 100)}% of your bullets contain a measurable result",
            "Quantified bullets are the single strongest differentiator between resumes "
            "at the same experience level. Without numbers, a reader has no way to size "
            "your impact and defaults to assuming it was small.",
            "Aim for 40%+. For each bullet ask: how much, how many, how fast, how often, "
            "or compared to what?",
            example="Reduced p95 checkout latency from 1.8s to 420ms, lifting conversion 6%.",
            items=[r["text"][:120] for r in unquantified[:4]], section="sec-experience"))

    if action_ratio < 0.70:
        findings.append(_finding(
            "high" if action_ratio < 0.4 else "medium", "experience_quality",
            f"{round(action_ratio * 100)}% of bullets open with a strong action verb",
            "The first word sets whether the bullet reads as ownership or as a duty. "
            "Parsers also index the opening verb more heavily in relevance ranking.",
            "Open with a verb that names what you did: Led, Built, Reduced, Shipped, "
            "Migrated, Negotiated.",
            section="sec-experience"))

    # --- per-role findings ------------------------------------------------
    # An aggregate ("38% of bullets lack a metric") tells you there's a
    # problem; it doesn't tell you where to go. Naming the role and employer
    # turns the same fact into a task you can actually start.
    quant_by_block = {}
    for b in bullets:
        if b["section"] != "experience":
            continue
        slot = quant_by_block.setdefault(b["block"], {"n": 0, "q": 0})
        slot["n"] += 1
        slot["q"] += 1 if _quantified(b["text"]) else 0

    for idx, blk in enumerate(doc.experience_blocks):
        stats = quant_by_block.get(idx)
        if not stats or stats["n"] < 2 or stats["q"]:
            continue
        where = blk.get("role") or "this role"
        if blk.get("company"):
            where += f" at {blk['company']}"
        sample = next((b["text"] for b in bullets
                       if b["block"] == idx and b["section"] == "experience"
                       and not _quantified(b["text"])), "")
        findings.append(_finding(
            "high", "experience_quality",
            f"Quantify your {where} role",
            f"None of the {stats['n']} bullets under this role carry a number, so a "
            "reader has no way to judge the scale of what you did there. Roles with "
            "no measurable outcomes read as junior regardless of the title.",
            "Add scale, rate or delta to at least half these bullets — volume handled, "
            "time saved, percentage moved, people involved, money affected.",
            example=(f"\"{sample[:90]}\" → add the size: how many, how much faster, "
                     "what it moved.") if sample else None,
            items=[b["text"][:110] for b in bullets
                   if b["block"] == idx and b["section"] == "experience"][:4],
            section="sec-experience"))

    repeated = [(v, n) for v, n in opener_counts.most_common(3) if n >= 3 and v]
    if repeated:
        findings.append(_finding(
            "medium", "experience_quality",
            f"\"{repeated[0][0].title()}\" opens {repeated[0][1]} of your bullets",
            "Repeating the same opener flattens the writing and makes distinct "
            "achievements read as one undifferentiated block.",
            "Vary the opening verb; match it to what the bullet actually describes.",
            items=[f"{v} x{n}" for v, n in repeated], section="sec-experience"))

    if total < 5:
        findings.append(_finding(
            "high", "experience_quality", f"Only {total} experience bullet(s) in total",
            "There isn't enough material here for a recruiter to assess scope or depth.",
            "Aim for 2-4 bullets per recent role.", section="sec-experience"))

    stats = {"total": total, "quantified": quantified,
             "action_led": action_led, "weak": weak_count}
    # Weakest first — the list is a work queue, not a catalogue.
    reviewed.sort(key=lambda r: (not r["weak"], len(r["issues"]) * -1))
    return score, findings, reviewed, stats


# ---------------------------------------------------------------------------
# Category: content quality
# ---------------------------------------------------------------------------
def _analyse_content(doc):
    findings, deductions = [], 0.0
    text = doc.text
    low = text.lower()

    # --- buzzwords -------------------------------------------------------
    found_buzz = [b for b in BUZZWORDS if re.search(rf"\b{re.escape(b)}\b", low)]
    if found_buzz:
        deductions += min(18, 5 * len(found_buzz))
        findings.append(_finding(
            "medium", "content_quality",
            f"{len(found_buzz)} unsupported claim phrase(s) found",
            "These are assertions with no evidence attached. Recruiters discount them "
            "automatically, and they consume space that a demonstrated result could use.",
            "Delete each one, or replace it with the evidence that would have justified it.",
            example="\"Team player\" -> \"Ran the weekly design review for a team of 9.\"",
            items=found_buzz[:8]))

    # --- first person ----------------------------------------------------
    # Two or more is a habit worth naming. A summary that *opens* "I am…" is
    # flagged on its own regardless of count: it's the most-read line on the
    # resume and the most conspicuous place to break the convention.
    fp = len(re.findall(r"\b(i|me|my|mine|myself)\b", low))
    summary_opens_first_person = bool(
        re.match(r"\s*(i|my)\b", doc.sections.get("summary", ""), re.I))
    if fp >= 2 or summary_opens_first_person:
        deductions += 10
        title = (f"First-person pronouns used {fp} times" if fp >= 2
                 else "Summary is written in the first person")
        findings.append(_finding(
            "medium", "content_quality", title,
            "Resume convention is implied first person. Explicit pronouns read as "
            "informal and cost words on every line they appear.",
            "Remove I/me/my and start the sentence at the verb.",
            example="\"I am a backend engineer who led a team of 6\" -> "
                    "\"Backend engineer. Led a team of 6.\"",
            section="sec-profile" if summary_opens_first_person else None))

    # --- repeated words / doubled typos ---------------------------------
    doubles = re.findall(r"\b(\w{3,})\s+\1\b", low)
    if doubles:
        deductions += 6
        findings.append(_finding(
            "high", "content_quality", "Repeated words found",
            "A duplicated word is a proofreading miss, and proofreading misses on a "
            "resume are read as a signal about your work generally.",
            "Proofread the flagged phrases.",
            items=[f"\"{d} {d}\"" for d in list(dict.fromkeys(doubles))[:5]]))

    # --- spacing / punctuation ------------------------------------------
    spacing = len(re.findall(r"[a-z]{2}[.,;][A-Za-z]", text))
    if spacing >= 3:
        deductions += 5
        findings.append(_finding(
            "medium", "content_quality", f"{spacing} missing space(s) after punctuation",
            "Usually an artefact of editing, occasionally a sign the text was extracted "
            "badly. Either way it joins two words into one token for a keyword filter.",
            "Add a space after each comma, full stop and semicolon."))

    # --- tense consistency ----------------------------------------------
    # Only meaningful within a single role: past roles should read past tense
    # throughout. Mixed tense inside one block is the detectable, fixable case.
    mixed = 0
    for b in doc.experience_blocks:
        pass  # block bodies are analysed via doc.bullets below
    by_block = {}
    for b in doc.bullets:
        if b["section"] != "experience":
            continue
        by_block.setdefault(b["block"], []).append(b["text"])
    for _blk, texts in by_block.items():
        if len(texts) < 2:
            continue
        past = sum(1 for t in texts if PAST_TENSE_RE.match(t.strip()))
        present = sum(1 for t in texts
                      if not PAST_TENSE_RE.match(t.strip())
                      and PRESENT_TENSE_RE.match(t.strip()))
        if past and present:
            mixed += 1
    if mixed:
        deductions += 6
        findings.append(_finding(
            "medium", "content_quality",
            f"Mixed verb tense within {mixed} role(s)",
            "Switching tense inside a single role reads as careless. The convention is "
            "present tense for your current role, past tense for everything finished.",
            "Pick one tense per role and apply it to every bullet in that role.",
            section="sec-experience"))

    # --- vague quantifiers across the whole document --------------------
    vague_hits = [v for v in VAGUE_QUANTIFIERS if re.search(rf"\b{re.escape(v)}\b", low)]
    if len(vague_hits) >= 3:
        deductions += 8
        findings.append(_finding(
            "medium", "content_quality",
            f"{len(vague_hits)} vague quantifier(s) used instead of numbers",
            "\"Several projects\" and \"significant improvement\" gesture at a number "
            "without committing to one, which reads as either unmeasured or unimpressive.",
            "Replace each with the actual figure.",
            items=vague_hits[:6]))

    # --- sentence length -------------------------------------------------
    long_sentences = [s.strip() for s in re.split(r"(?<=[.!?])\s+", text)
                      if len(re.findall(r"\b[\w'-]+\b", s)) > 45]
    if len(long_sentences) >= 2:
        deductions += 5
        findings.append(_finding(
            "optional", "content_quality",
            f"{len(long_sentences)} very long sentence(s)",
            "Sentences past ~40 words lose the reader in a document that gets 7 seconds "
            "of attention.",
            "Split each into two.",
            items=[s[:110] + "…" for s in long_sentences[:3]]))

    # Honest boundary: no dictionary ships with this app, and adding one for
    # a single check would violate the no-unnecessary-dependencies rule. The
    # mechanical checks above catch the errors that are detectable without one.
    caveat = ("Spelling is not dictionary-checked — this analysis flags mechanical "
              "errors (repeated words, punctuation spacing) but will not catch a "
              "correctly-spelled wrong word. Proofread before sending.")

    score = max(0, min(100, round(100 - deductions)))
    return score, findings, caveat


# ---------------------------------------------------------------------------
# Category: skills
# ---------------------------------------------------------------------------
def _analyse_skills(doc, jd_result):
    """Categorises detected skills and — only when a job description is
    present — names the ones the target role asks for and the resume lacks.

    Without a JD there is deliberately no "missing skills" list. Guessing at
    skills a user should add, with no target role to justify them, is exactly
    the generic filler the brief rules out.
    """
    findings = []
    text_low = doc.text.lower()

    hard_found, soft_found = [], []
    for canonical, aliases in HARD_SKILL_ALIASES.items():
        for alias in aliases:
            if re.search(rf"(?<![\w+#.]){re.escape(alias)}(?![\w+#])", text_low):
                hard_found.append(canonical)
                break
    for term in SOFT_SKILL_TERMS:
        if re.search(rf"\b{re.escape(term)}\b", text_low):
            soft_found.append(term)

    hard_found = sorted(set(hard_found))
    soft_found = sorted(set(soft_found))

    skills_section = doc.sections.get("skills", "")
    in_section = []
    if skills_section:
        sec_low = skills_section.lower()
        in_section = [s for s in hard_found
                      if any(re.search(rf"(?<![\w+#.]){re.escape(a)}(?![\w+#])", sec_low)
                             for a in HARD_SKILL_ALIASES[s])]

    missing_for_role = jd_result.get("missing_hard_skills", []) if jd_result else []

    # --- skills claimed but never evidenced -------------------------------
    # A skill that appears only in the Skills list is an assertion; the same
    # skill named inside a bullet is a demonstration. Recruiters read the
    # second and discount the first, and this is the single most actionable
    # gap on an otherwise well-built resume.
    evidence_text = " ".join(
        [b["text"] for b in doc.bullets] +
        [doc.sections.get("summary", "")]).lower()
    unevidenced = [s for s in doc.skill_entries
                   if not re.search(rf"(?<![\w+#.]){re.escape(s.lower())}(?![\w+#])",
                                    evidence_text)]
    employers = [b.get("company") or b.get("role") for b in doc.experience_blocks]
    employers = [e for e in employers if e][:3]
    if len(unevidenced) >= 4 and doc.bullets:
        where = (" — your " + " and ".join(employers) + " bullets are the obvious home"
                 if employers else "")
        findings.append(_finding(
            "high", "skills_relevance",
            f"{len(unevidenced)} skills are listed but never shown in your experience",
            "These appear only in the skills list. A keyword filter counts them once; a "
            "recruiter reads them as a claim with nothing behind it. The same term "
            "inside a bullet, attached to an outcome, counts as evidence.",
            f"Work the most role-relevant of these into your experience bullets{where}. "
            "Not all of them — pick the ones the jobs you're targeting ask for.",
            example="\"Built the ingestion layer\" → \"Built the ingestion layer in "
                    "PySpark on Databricks, cutting load time 40%\"",
            items=unevidenced[:12], section="sec-experience"))

    if not skills_section:
        findings.append(_finding(
            "critical", "skills_relevance", "No skills section",
            "Keyword filters weight a dedicated skills block far more heavily than an "
            "incidental mention buried in a bullet. Without one, matching tools you "
            "genuinely use may not register at all.",
            "Add a Skills section grouped by category.",
            example="Languages: Python, TypeScript, Go\nCloud: AWS, Docker, Kubernetes",
            section="sec-skills"))
    elif len(hard_found) > 4 and len(in_section) < len(hard_found) * 0.5:
        outside = [s for s in hard_found if s not in in_section]
        findings.append(_finding(
            "medium", "skills_relevance",
            f"{len(outside)} skill(s) appear only in prose, not in your skills section",
            "A skill mentioned once inside a bullet is easy for a keyword filter to miss "
            "and easy for a skimming recruiter to overlook.",
            "Add the ones you'd want to be found for to the Skills section as well.",
            items=outside[:10], section="sec-skills"))

    if missing_for_role:
        findings.append(_finding(
            "high", "skills_relevance",
            f"{len(missing_for_role)} skill(s) in the job description aren't on your resume",
            "These are the concrete, filterable requirements the posting names. Each one "
            "absent is a search you won't appear in.",
            "Add the ones you genuinely have — and only those. A skill you can't discuss "
            "in an interview costs more than it gains.",
            items=missing_for_role[:12], section="sec-skills"))

    if len(hard_found) < 5:
        findings.append(_finding(
            "high" if len(hard_found) < 3 else "medium", "skills_relevance",
            f"Only {len(hard_found)} recognised technical skill(s) detected",
            "Keyword filters need concrete, named tools to match against; generic "
            "descriptions of work don't register.",
            "Name the specific languages, frameworks, platforms and tools you use.",
            section="sec-skills"))

    # Score: breadth of named hard skills, presence of a real skills section,
    # how much of that list is actually demonstrated, and — when targeted —
    # coverage of what the role asks for.
    #
    # The evidence term exists because breadth alone rewards padding: a list
    # of thirty tools none of which appear in any bullet used to score 100
    # while the review simultaneously raised a high-severity finding saying
    # exactly that. A score that disagrees with its own findings is worse
    # than no score.
    breadth = min(1.0, len(hard_found) / 12) * 40
    organised = 25 if skills_section else 0
    if doc.skill_entries:
        evidenced_ratio = 1 - (len(unevidenced) / len(doc.skill_entries))
        evidence = evidenced_ratio * 20
    else:
        evidence = 0 if skills_section else 10  # nothing listed to evidence
    if jd_result and (jd_result.get("matched_hard_skills") or missing_for_role):
        want = len(jd_result.get("matched_hard_skills", [])) + len(missing_for_role)
        coverage = len(jd_result.get("matched_hard_skills", [])) / want if want else 1.0
        relevance = coverage * 15
    else:
        relevance = 15 if len(hard_found) >= 6 else len(hard_found) / 6 * 15
    score = round(min(100, breadth + organised + evidence + relevance))

    return score, findings, {
        "hard_skills": hard_found,
        "soft_skills": soft_found,
        "in_skills_section": in_section,
        "missing_for_role": missing_for_role,
        "listed": doc.skill_entries,
        "unevidenced": unevidenced,
    }


# ---------------------------------------------------------------------------
# Category: job alignment
# ---------------------------------------------------------------------------
def _analyse_job_match(doc, jd_result):
    findings = []
    if not jd_result:
        return None, findings

    score = jd_result.get("score", 0)
    missing_hard = jd_result.get("missing_hard_skills", [])
    missing_any = jd_result.get("missing_keywords", [])
    coverage = jd_result.get("keyword_coverage_percent", 0)

    if missing_hard:
        findings.append(_finding(
            "critical" if coverage < 40 else "high", "job_alignment",
            f"{len(missing_hard)} required skill(s) from the posting are missing",
            "Hard skills are what keyword filters gate on. These are named in the job "
            "description and absent from your resume.",
            "Work the ones you genuinely have into your summary, skills section and the "
            "relevant experience bullets — using the posting's own wording.",
            items=missing_hard[:12], section="sec-skills"))

    other_missing = [k for k in missing_any if k not in missing_hard][:10]
    if other_missing:
        findings.append(_finding(
            "medium", "job_alignment",
            "Terminology from the posting doesn't appear on your resume",
            "Strict parsers match literally. Where you and the posting use different words "
            "for the same thing, the posting's word is the safer one.",
            "Mirror the posting's phrasing where it's truthful for you.",
            items=other_missing))

    if jd_result.get("title_seniority_match") is False:
        findings.append(_finding(
            "high", "job_alignment", "Seniority signals don't match the posting",
            "Level mismatch is a common filter, and it's usually a framing problem rather "
            "than a real gap.",
            "Align your headline title and summary with the level the posting describes.",
            section="sec-details"))

    if coverage >= 70 and not missing_hard:
        findings.append(_finding(
            "optional", "job_alignment", "Strong alignment with this posting",
            "Keyword coverage is high and no named hard requirement is missing.",
            "Focus remaining effort on quantifying your bullets rather than on keywords."))

    return score, findings


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------
def review_resume(resume_text=None, builder_data=None, job_description=None,
                  page_count=None):
    """Cached wrapper. See _review_resume for the analysis itself.

    Analysis is pure — identical inputs always give an identical report — so
    the key is just a hash of the inputs and there is nothing to invalidate:
    edited text is simply a different key.
    """
    key = make_key("review", resume_text or "", builder_data or {},
                   job_description or "", page_count or 0)
    hit = get_json(key)
    if hit is not None:
        return hit
    result = _review_resume(resume_text, builder_data, job_description, page_count)
    set_json(key, result, TTL_ATS)
    return result


def _review_resume(resume_text=None, builder_data=None, job_description=None,
                   page_count=None):
    doc = (_doc_from_builder(builder_data) if builder_data
           else _doc_from_text(resume_text or "", page_count))

    if doc.word_count < 25:
        raise ValueError(
            "There isn't enough readable text in this resume to analyse. If you uploaded "
            "a file, it may be a scan with no text layer — try a text-based PDF or DOCX, "
            "or build one in the Resume Builder."
        )

    targeted = bool(job_description and job_description.strip())
    jd_result = (score_resume_against_job(doc.text, job_description)
                 if targeted else None)
    jd_terms = extract_phrases(job_description) if targeted else {}

    ats_score, ats_findings, ats_checks, ats_caveats = _analyse_ats(doc)
    struct_score, struct_findings, sections_info = _analyse_structure(doc)
    exp_score, exp_findings, bullet_reviews, bullet_stats = _analyse_bullets(doc)
    content_score, content_findings, content_caveat = _analyse_content(doc)
    skills_score, skills_findings, skills_info = _analyse_skills(doc, jd_result)
    match_score, match_findings = _analyse_job_match(doc, jd_result)

    profile_name = "targeted" if targeted else "general"
    weights = SCORING_PROFILES[profile_name]
    raw = {
        "ats_compatibility": ats_score,
        "experience_quality": exp_score,
        "content_quality": content_score,
        "structure": struct_score,
        "skills_relevance": skills_score,
    }
    if targeted:
        raw["job_alignment"] = match_score or 0

    overall = round(sum(raw[k] * w for k, w in weights.items()))
    categories = [{
        "key": k,
        "label": CATEGORY_LABELS[k],
        "score": raw[k],
        "weight": round(weights[k] * 100),
        "contribution": round(raw[k] * weights[k], 1),
    } for k in weights]
    categories.sort(key=lambda c: c["score"])

    findings = (ats_findings + struct_findings + exp_findings
                + content_findings + skills_findings + match_findings)
    findings.sort(key=lambda f: (SEVERITY_RANK.get(f["severity"], 9), f["category"]))

    strengths = _collect_strengths(raw, bullet_stats, sections_info, skills_info, jd_result)

    caveats = ats_caveats + [content_caveat]
    if not targeted:
        caveats.append(
            "No job description was provided, so this is a general resume-quality review. "
            "Add a job description for keyword matching and a role-specific match score.")

    return {
        "overall_score": overall,
        "band": _band(overall),
        "mode": profile_name,
        "source": doc.source,
        "categories": categories,
        "weights": {k: round(v * 100) for k, v in weights.items()},
        "ats": {"score": ats_score, "checks": ats_checks},
        "structure": {"score": struct_score, **sections_info},
        "experience": {"score": exp_score, **bullet_stats, "bullets": bullet_reviews[:40]},
        "content": {"score": content_score},
        "skills": {"score": skills_score, **skills_info},
        "job_match": ({
            "score": match_score,
            "keyword_coverage_percent": jd_result.get("keyword_coverage_percent"),
            "term_similarity_percent": jd_result.get("term_similarity_percent"),
            "matched_keywords": jd_result.get("matched_keywords", [])[:40],
            "missing_keywords": jd_result.get("missing_keywords", [])[:40],
            "matched_hard_skills": jd_result.get("matched_hard_skills", []),
            "missing_hard_skills": jd_result.get("missing_hard_skills", []),
            "title_seniority_match": jd_result.get("title_seniority_match"),
            # How often the posting repeats each term. A requirement named
            # five times is not equal in weight to one named once, and that
            # ordering is the difference between fixing the right gap first
            # and fixing an incidental one.
            "term_frequency": {
                t: jd_terms[t] for t in
                (jd_result.get("matched_keywords", [])[:40]
                 + jd_result.get("missing_keywords", [])[:40])
                if jd_terms.get(t)
            },
        } if targeted else None),
        "strengths": strengths,
        "findings": findings,
        "counts": {
            "critical": sum(1 for f in findings if f["severity"] == "critical"),
            "high": sum(1 for f in findings if f["severity"] == "high"),
            "medium": sum(1 for f in findings if f["severity"] == "medium"),
            "optional": sum(1 for f in findings if f["severity"] == "optional"),
        },
        "word_count": doc.word_count,
        "overview": {
            "words": doc.word_count,
            "pages": doc.page_count,
            "sections": len(doc.sections),
            "skills_found": len(doc.skill_entries) or len(skills_info["hard_skills"]),
            "positions": len(doc.experience_blocks),
            "education": doc.education_count,
            "bullets": bullet_stats["total"],
        },
        "caveats": caveats,
    }


def _band(score):
    if score >= 85:
        return "excellent"
    if score >= 70:
        return "strong"
    if score >= 50:
        return "needs work"
    return "weak"


def _collect_strengths(raw, bullet_stats, sections_info, skills_info, jd_result):
    """Named strengths, each tied to a measured fact. A review that only lists
    problems is demoralising and, worse, gives no signal about what not to
    change while fixing everything else."""
    out = []
    if bullet_stats["total"]:
        q = bullet_stats["quantified"] / bullet_stats["total"]
        if q >= 0.4:
            out.append(f"{round(q * 100)}% of your bullets carry a measurable result — "
                       "above the 40% benchmark.")
        a = bullet_stats["action_led"] / bullet_stats["total"]
        if a >= 0.7:
            out.append(f"{round(a * 100)}% of bullets open with a strong action verb.")
    if raw["ats_compatibility"] >= 85:
        out.append("No significant ATS parsing risks were detected.")
    if raw["structure"] >= 85:
        out.append("Every section a recruiter expects is present and populated.")
    if len(skills_info["hard_skills"]) >= 12:
        out.append(f"{len(skills_info['hard_skills'])} distinct technical skills are "
                   "named explicitly.")
    if jd_result and jd_result.get("matched_hard_skills"):
        out.append(f"Matches {len(jd_result['matched_hard_skills'])} of the hard skills "
                   "named in the job description.")
    if raw["content_quality"] >= 90:
        out.append("Writing is clean — no buzzword padding or mechanical errors found.")
    return out
