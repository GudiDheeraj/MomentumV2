"""Turning an uploaded résumé back into structured builder data.

Why this exists
---------------
"Tailor to a job" could only work on résumés built in the Resume Builder,
because tailoring regenerates a PDF from structured fields and an uploaded file
has none. Everyone who uploads a PDF — which is most people, since that is the
file they already have — hit a wall telling them to retype their whole résumé
into the builder first. The feature was effectively off for its main audience.

The extracted text was already sitting in `resume.extracted_text` for ATS
scoring. This reads that text back into the builder's own field shape, so an
uploaded résumé becomes tailorable exactly like a built one.

The output format is the builder's, not a new one
-------------------------------------------------
`builder_data` is a flat dict of the Resume Builder's form fields, where the
three list sections are *text*, in a format resume_pdf.parse_entries() reads:

    Job Title | Company | Location | 2021-2024
    - A bullet describing what you did.
    - Another bullet.
    ---
    Previous Title | Company | Location | 2019-2021
    - A bullet.

Producing that rather than inventing a JSON schema means the parsed résumé
flows through the same renderer, the same tailoring function and the same
templates as everything else, with no second code path to keep in step.

Nothing is invented
-------------------
The prompt forbids adding employers, dates, degrees or skills that aren't in
the text, and `_sanity_check` rejects a parse whose name or employers don't
appear in the source. A résumé that quietly gains a job is far worse than one
that fails to parse.
"""

from __future__ import annotations

import json
import logging
import re

log = logging.getLogger("momentum.ai")

# Fields the builder renders. Anything outside this set is dropped rather than
# passed to the PDF renderer, which would ignore it anyway.
BUILDER_FIELDS = (
    "full_name", "title", "location", "phone", "email", "linkedin", "website",
    "summary", "skills", "experience", "education", "projects",
    "certifications", "publications", "languages",
)

SYSTEM = (
    "You convert a résumé's plain text into the exact JSON structure a résumé "
    "builder uses. You transcribe; you never invent. If something is not in the "
    "text, leave the field empty."
)

PROMPT = """Convert this résumé into JSON with exactly these keys:

  full_name, title, location, phone, email, linkedin, website,
  summary, skills, experience, education, projects,
  certifications, publications, languages

Rules for the values — all are plain strings:

- "title" is the person's professional headline (e.g. "Data Engineer"), not a job entry.
- "summary" is their profile/objective paragraph. If there isn't one, use "".
- "skills": one line per category, formatted "Category: item, item, item".
  If the résumé lists skills without categories, use a single line "Skills: a, b, c".
- "experience", "education", "projects": entries separated by a line containing
  exactly ---
  Each entry starts with a header line of pipe-separated parts, then bullet
  lines each starting with "- ".
    experience header: Job Title | Company | Location | Dates
    education header:  Degree | Institution | Dates
    projects header:   Project name — one-line description
  Keep every bullet from the original, reworded only for grammar. Do not
  summarise several bullets into one, and do not add bullets.
- "certifications", "publications", "languages": one item per line, or "".

Absolute rules:
- Never invent an employer, job title, date, degree, certification or skill
  that does not appear in the text below.
- Never change dates, company names or job titles.
- If the text is too garbled to parse a field, use "" for it.

Return only the JSON object.

RÉSUMÉ TEXT:
{text}
"""


# Models answer the same question in several shapes. Rather than insist on one
# and fail on the rest, every plausible spelling is accepted — the cost of a
# missed alias is the whole feature refusing, which is what happened in
# practice: a model that answered {"name": …} produced "no name could be read
# from the file" for a résumé whose name was right there in line one.
ALIASES = {
    "full_name": ("full_name", "fullName", "name", "candidate_name", "person_name"),
    "title": ("title", "headline", "professional_title", "job_title", "role"),
    "location": ("location", "address", "city"),
    "phone": ("phone", "phone_number", "mobile", "telephone"),
    "email": ("email", "email_address", "e_mail"),
    "linkedin": ("linkedin", "linkedin_url", "linked_in"),
    "website": ("website", "portfolio", "url", "github"),
    "summary": ("summary", "profile", "objective", "about", "professional_summary"),
    "skills": ("skills", "skill_categories", "technical_skills"),
    "experience": ("experience", "work_experience", "employment", "work_history"),
    "education": ("education", "academics", "qualifications"),
    "projects": ("projects", "personal_projects", "key_projects"),
    "certifications": ("certifications", "certificates", "licenses"),
    "publications": ("publications", "papers"),
    "languages": ("languages", "spoken_languages"),
}


def _unwrap(raw: dict) -> dict:
    """Some models wrap the answer in an envelope: {"resume": {...}}."""
    if not isinstance(raw, dict):
        return {}
    for key in ("resume", "data", "result", "output", "cv", "parsed"):
        inner = raw.get(key)
        if isinstance(inner, dict) and len(inner) > 2:
            return inner
    return raw


def _pick(raw: dict, field: str):
    """First alias present, searched case-insensitively."""
    lowered = {str(k).lower().replace(" ", "_"): v for k, v in raw.items()}
    for alias in ALIASES.get(field, (field,)):
        if lowered.get(alias.lower()) not in (None, "", [], {}):
            return lowered[alias.lower()]
    return ""


def _name_from_text(text: str) -> str:
    """Best guess at the person's name from the top of the résumé.

    A last resort, and a decent one: essentially every résumé opens with the
    name on its own line. Used only when the model didn't return one.
    """
    for line in (text or "").strip().split("\n")[:6]:
        line = line.strip(" \t|-–—•·")
        if not (2 <= len(line.split()) <= 5) or len(line) > 60:
            continue
        if any(ch.isdigit() for ch in line) or "@" in line:
            continue
        low = line.lower()
        if any(w in low for w in ("resume", "curriculum", "cv", "profile", "summary")):
            continue
        words = line.split()
        if all(w[:1].isupper() or w.isupper() for w in words if w):
            return " ".join(w if w.isupper() and len(w) <= 3 else w.title() for w in words)
    return ""


# How a model's structured entry maps onto the header line's pipe-separated
# parts. Order matters — it is the order they are printed in.
ENTRY_KEYS = {
    "experience": (("job_title", "title", "position", "role"),
                   ("company", "employer", "organisation", "organization"),
                   ("location", "city", "place"),
                   ("dates", "date", "duration", "period", "years", "when")),
    "education": (("degree", "qualification", "course", "programme", "program", "title"),
                  ("institution", "school", "university", "college"),
                  ("dates", "date", "duration", "period", "years")),
    "projects": (("name", "project", "title"), ("description", "summary", "subtitle")),
}
BULLET_KEYS = ("responsibilities", "bullets", "achievements", "highlights",
               "details", "description", "duties", "points")


def _entry_from_dict(item: dict, kind: str) -> str:
    """One structured entry -> "A | B | C" plus "- bullet" lines.

    Models ignore "return a string" for these sections constantly and answer
    with objects instead. Stringifying that with str() is what put a literal
    Python dict — {'Job Title': 'Backend Engineer', 'Company': …} — into a
    rendered PDF. Reading the object properly is the only correct response;
    refusing it would fail on a perfectly good answer.
    """
    lowered = {str(k).lower().replace(" ", "_"): v for k, v in item.items()}

    def take(names):
        for n in names:
            v = lowered.get(n)
            if v not in (None, "", [], {}):
                return " ".join(str(v).split())
        return ""

    parts = [take(group) for group in ENTRY_KEYS.get(kind, ENTRY_KEYS["experience"])]
    while parts and not parts[-1]:
        parts.pop()
    header = " | ".join(parts) if parts else ""

    bullets = []
    for key in BULLET_KEYS:
        raw = lowered.get(key)
        if not raw:
            continue
        if isinstance(raw, str):
            # A single string here may still hold several bullets, separated
            # by newlines or literal "\n" the model wrote as characters.
            for piece in raw.replace("\\n", "\n").split("\n"):
                piece = piece.strip(" \t-•*")
                if piece:
                    bullets.append(piece)
        elif isinstance(raw, (list, tuple)):
            for piece in raw:
                if isinstance(piece, dict):
                    piece = " ".join(str(v) for v in piece.values())
                piece = str(piece).strip(" \t-•*")
                if piece:
                    bullets.append(piece)
        if bullets:
            break

    lines = [header] if header else []
    lines += [f"- {b}" for b in bullets]
    return "\n".join(lines)


def _clean(value, kind: str = "") -> str:
    if value is None:
        return ""
    if isinstance(value, dict):
        return _entry_from_dict(value, kind) if kind else " ".join(
            str(v) for v in value.values() if v)
    if isinstance(value, (list, tuple)):
        chunks = []
        for item in value:
            if isinstance(item, dict):
                chunks.append(_entry_from_dict(item, kind) if kind
                              else " ".join(str(v) for v in item.values() if v))
            elif str(item).strip():
                chunks.append(str(item).strip())
        # Entry sections are separated by the marker parse_entries() splits on;
        # flat lists (skills, languages) are just lines.
        sep = "\n---\n" if kind else "\n"
        return sep.join(c for c in chunks if c)
    return str(value).strip()


def _normalise_entries(text: str) -> str:
    """Tidy the separator and bullet characters a model may drift on.

    parse_entries() splits on a line that is exactly "---" and treats only
    lines starting with "-" as bullets. Models reliably produce the right
    shape but not always the right characters — an em dash instead of three
    hyphens, or a bullet glyph instead of a hyphen — and the difference is
    invisible in the output while quietly costing every bullet in the entry.
    """
    if not text:
        return ""
    out = []
    for line in text.replace("\r\n", "\n").split("\n"):
        stripped = line.strip()
        if re.fullmatch(r"[-–—_*=]{3,}", stripped):
            out.append("---")
            continue
        if stripped[:1] in ("•", "·", "▪", "‣", "–", "—", "*"):
            out.append("- " + stripped[1:].strip())
            continue
        out.append(line.rstrip())
    return "\n".join(out).strip()


def _sanity_check(data: dict, source_text: str) -> tuple[bool, str]:
    """Reject a parse that contradicts the source.

    Cheap and worth it: an LLM that hallucinates an employer produces a résumé
    the person might actually send. Checking that the name and at least one
    company appear verbatim in the original catches the failure that matters,
    without trying to be a general fact-checker.
    """
    low = source_text.lower()

    name = _clean(data.get("full_name"))
    if not name:
        # No longer fatal: the caller fills this from the account, and a header
        # that didn't survive PDF extraction is not a reason to refuse a résumé
        # whose experience section parsed perfectly well.
        return False, "no name could be found in the file or on your account"
    # A name taken from the account legitimately may not appear in the file, so
    # only a name the *model* claimed to have read is checked against the text.
    if data.get("_name_from_model") and not any(
            part.lower() in low for part in name.split() if len(part) > 2):
        return False, f"the name it read ({name!r}) does not appear in the file"

    companies = []
    for entry in _clean(data.get("experience")).split("\n---\n"):
        header = entry.strip().split("\n")[0] if entry.strip() else ""
        parts = [p.strip() for p in header.split("|")]
        if len(parts) > 1 and parts[1]:
            companies.append(parts[1])
    if companies:
        seen = sum(1 for c in companies if c.lower()[:12] in low)
        if seen == 0:
            return False, "the employers it listed do not appear in the file"
    return True, ""


def parse_resume_text(text: str, account: dict | None = None) -> dict:
    """Résumé text -> builder fields. Raises ValueError with a readable reason.

    `account` supplies the fallbacks the app already knows — name, email, phone,
    location — so a model that misses the header doesn't sink the whole parse.

    Callers should treat failure as "couldn't read this file", not as an error
    worth a stack trace: a scanned PDF with no text layer will land here and
    there is nothing to fix in the code.
    """
    from . import llm

    text = (text or "").strip()
    if len(text) < 120:
        raise ValueError(
            "There isn't enough text in this résumé to work from. If it is a "
            "scanned PDF, the file has no text layer to read.")

    # Long résumés are truncated rather than refused: the first ~12k characters
    # cover several pages, and the tail of a long CV is usually references and
    # hobbies rather than the experience being tailored.
    prompt = PROMPT.format(text=text[:12000])

    raw = llm.complete_json(prompt, max_tokens=3000, temperature=0.1)
    if raw is None:
        # complete_json returns None when no model is configured at all.
        raise ValueError(
            "Reading an uploaded résumé needs an AI model. Set one up under "
            "Tools → AI Model, then try again.")
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except json.JSONDecodeError:
            raise ValueError("The model's reply wasn't valid JSON. Try again, "
                             "or use a stronger model.")
    if not isinstance(raw, dict):
        raise ValueError("The model returned something unexpected. Try again.")

    raw = _unwrap(raw)
    ENTRY_SECTIONS = {"experience", "education", "projects"}
    data = {k: _clean(_pick(raw, k), k if k in ENTRY_SECTIONS else "")
            for k in BUILDER_FIELDS}
    for key in ("experience", "education", "projects"):
        data[key] = _normalise_entries(data[key])

    # The account already knows who this is. Making the model's ability to find
    # a name a hard requirement was the wrong dependency — a header rendered as
    # an image, an unusual layout, or a model that used a different key all
    # produced "no name could be read from the file" for a perfectly good CV.
    data["_name_from_model"] = bool(data["full_name"])
    if not data["full_name"]:
        data["full_name"] = _name_from_text(text) or (account or {}).get("name", "")
    for field in ("email", "phone", "location"):
        if not data[field] and (account or {}).get(field):
            data[field] = account[field]

    ok, why = _sanity_check(data, text)
    data.pop("_name_from_model", None)
    if not ok:
        raise ValueError(
            f"The parsed résumé didn't match the file — {why}. Nothing was "
            "saved. This usually means the PDF's text came out scrambled.")

    return data
