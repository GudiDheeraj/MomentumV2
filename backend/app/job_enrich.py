"""Fill a job application's fields from the text of its description.

A capture arrives with a role, a company and a wall of prose. Everything else
the board sorts, filters and charts by — location, skills, salary, tags — was
left for the user to type by hand, so in practice it stayed empty and the
Skills column, the tag filters and the "Top Skills Required" chart had nothing
to show.

Everything here is deterministic: regular expressions and the ATS scorer's own
skill lexicon, no model and no network. Three reasons that matters more than
cleverness would:

1. It runs on every save, including the extension's one-click capture, so it
   has to be fast and it has to work when no GGUF model is installed.
2. A wrong guess is worse than a blank field, because it is saved silently.
   Every rule below is written to abstain rather than reach: `_first` returns
   the first match of a *specific* pattern, not the most likely candidate.
3. The same answer for the same text, every time, is what makes the results
   explainable when someone asks why a job got tagged "no-sponsorship".

Callers pass the description plus whatever fields are already known, and get
back only the fields they are missing — this module never overwrites anything
a human typed.
"""

from __future__ import annotations

import re
from typing import Iterable

from .ats_scorer import HARD_SKILL_ALIASES, extract_phrases

MAX_SKILLS = 12
MAX_TAGS = 6

# ---------------------------------------------------------------------------
# Salary
# ---------------------------------------------------------------------------
# Ranges first, single figures second, and a unit ("per year", "/hr") kept when
# it is stated — "£45,000" and "£45,000 per hour" are not the same offer.
_CUR = r"(?:£|\$|€|₹|USD|GBP|EUR|INR|AUD|CAD)\s?"
_AMOUNT = r"\d{1,3}(?:[,.\s]\d{3})*(?:\.\d+)?\s?[kK]?"
_UNIT = (r"(?:\s*(?:per|/|a)\s*(?:year|annum|yr|month|mo|week|wk|day|hour|hr)"
         r"|\s*(?:pa|p\.a\.|per annum))")

_SALARY_PATTERNS = [
    # £75,000 - £95,000 per year   |   $120k–$150k
    re.compile(rf"{_CUR}{_AMOUNT}\s*(?:-|–|—|to)\s*{_CUR}?{_AMOUNT}(?:{_UNIT})?", re.I),
    # "salary: £75,000"  /  "compensation is £75,000 per annum"
    re.compile(rf"(?:salary|compensation|pay|package)\D{{0,20}}{_CUR}{_AMOUNT}(?:{_UNIT})?", re.I),
    # a bare figure with a unit attached is unambiguous enough on its own
    re.compile(rf"{_CUR}{_AMOUNT}{_UNIT}", re.I),
]


def find_salary(text: str) -> str:
    for pattern in _SALARY_PATTERNS:
        m = pattern.search(text or "")
        if m:
            found = re.sub(r"\s+", " ", m.group(0)).strip(" .,;:")
            # Strip a leading label the second pattern may have swallowed.
            found = re.sub(r"^(salary|compensation|pay|package)\W*", "", found, flags=re.I)
            if len(found) <= 100:
                return found
    return ""


# ---------------------------------------------------------------------------
# Work mode, employment type, seniority
# ---------------------------------------------------------------------------
# Negations are checked before positives: "this role is not remote" and
# "no visa sponsorship" both read as their opposite to a naive keyword match.
_REMOTE_NEG = re.compile(r"\b(not|non|no)[- ]remote\b|\bremote\s+(?:work\s+)?is\s+not\b", re.I)
_REMOTE = re.compile(r"\b(fully|100%|entirely)?\s?remote\b|\bwork from home\b|\bremote[- ]first\b", re.I)
_HYBRID = re.compile(r"\bhybrid\b|\d\s*days?\s*(?:a|per)\s*week\s*in\s*(?:the\s*)?office", re.I)
_ONSITE = re.compile(r"\bon[- ]?site\b|\bin[- ]office\b|\boffice[- ]based\b", re.I)

_EMPLOYMENT = [
    ("internship", re.compile(r"\bintern(ship)?\b", re.I)),
    ("contract", re.compile(r"\bcontract(or)?\b|\bfixed[- ]term\b|\bfreelance\b|\bb2b\b", re.I)),
    ("part-time", re.compile(r"\bpart[- ]time\b", re.I)),
    ("full-time", re.compile(r"\bfull[- ]time\b|\bpermanent\b", re.I)),
]

# Ordered most senior first so "senior" wins over "mid" when a posting mentions
# both ("senior or mid-level").
_SENIORITY = [
    ("principal", re.compile(r"\bprincipal\b", re.I)),
    ("staff", re.compile(r"\bstaff\s+(engineer|scientist|designer)\b", re.I)),
    ("lead", re.compile(r"\blead\b|\bhead of\b", re.I)),
    ("senior", re.compile(r"\bsenior\b|\bsr\.?\b", re.I)),
    ("mid-level", re.compile(r"\bmid[- ](level|weight)\b", re.I)),
    ("junior", re.compile(r"\bjunior\b|\bjr\.?\b|\bentry[- ]level\b", re.I)),
    ("graduate", re.compile(r"\bgraduate\b|\bnew grad\b", re.I)),
    ("intern", re.compile(r"\bintern(ship)?\b", re.I)),
]

_SPONSOR_NO = re.compile(
    r"\b(?:not|unable|cannot|can't|do not|don't|no)\b[^.\n]{0,40}\b(?:sponsor(ship)?|visa)\b"
    r"|\bno\s+(?:visa\s+)?sponsorship\b"
    r"|\bsponsorship\s+is\s+not\b"
    r"|\bmust\s+(?:already\s+)?have\s+(?:the\s+)?right\s+to\s+work\b", re.I)
_SPONSOR_YES = re.compile(
    r"\b(?:visa\s+)?sponsorship\s+(?:is\s+)?(?:available|offered|provided)\b"
    r"|\bwe\s+(?:can\s+)?sponsor\b|\bwill\s+sponsor\b|\bsponsor(?:ship)?\s+eligible\b", re.I)

_YEARS = re.compile(r"\b(\d{1,2})\s*\+?\s*(?:-|–|to)?\s*(?:\d{1,2})?\s*\+?\s*years?\b[^.\n]{0,30}"
                    r"(?:experience|exp\b)", re.I)


def find_work_mode(text: str) -> str:
    body = text or ""
    if _HYBRID.search(body):
        return "hybrid"
    if _REMOTE.search(body) and not _REMOTE_NEG.search(body):
        return "remote"
    if _ONSITE.search(body):
        return "on-site"
    return ""


def _first_label(text: str, table: Iterable[tuple]) -> str:
    for label, pattern in table:
        if pattern.search(text or ""):
            return label
    return ""


# ---------------------------------------------------------------------------
# Location
# ---------------------------------------------------------------------------
# Only patterns that *state* a location are used. Guessing a city from a
# passing mention ("our New York office also uses this stack") is exactly the
# kind of confident-and-wrong that this module is written to avoid.
_LOC_LABEL = re.compile(
    r"^[ \t]*(?:job\s+)?location[s]?\s*[:\-–]\s*(.+)$", re.I | re.M)
# Case-sensitive on purpose. With re.IGNORECASE a `[A-Z]` class matches
# lowercase too, so "in our london office" captured "our london" — the
# capitalisation IS the signal that a proper noun follows.
# "Berlin, Germany" and "Newcastle Upon Tyne" are both one place; the comma
# needs its following space, which a single-character class silently refused.
_PLACE = r"([A-Z][\w'.-]*(?:(?:,\s*|\s)[A-Z][\w'.-]*){0,3})"
_LOC_PHRASES = [
    re.compile(rf"\b(?:based|located)\s+in\s+{_PLACE}"),
    re.compile(rf"\b(?:role|position|job)\s+is\s+based\s+in\s+{_PLACE}"),
    re.compile(rf"\boffices?\s+in\s+{_PLACE}"),
    # "three days a week in our London office", "in the Newcastle office"
    re.compile(rf"\bin\s+(?:our|the)\s+{_PLACE}\s+offices?\b"),
]
_LOC_NOISE = re.compile(r"^(the|our|a|an|this|your|we|us)$", re.I)


def find_location(text: str) -> str:
    m = _LOC_LABEL.search(text or "")
    if m:
        value = re.sub(r"\s+", " ", m.group(1)).strip(" .,;")
        if 2 <= len(value) <= 120:
            return value
    for pattern in _LOC_PHRASES:
        m = pattern.search(text or "")
        if not m:
            continue
        value = re.sub(r"\s+", " ", m.group(1)).strip(" .,;")
        if 2 <= len(value) <= 80 and not _LOC_NOISE.match(value):
            return value
    return ""


# ---------------------------------------------------------------------------
# Skills
# ---------------------------------------------------------------------------
def find_skills(text: str, limit: int = MAX_SKILLS) -> list[str]:
    """The hard skills the posting actually names, most-mentioned first.

    Restricted to the ATS scorer's lexicon on purpose: its unigram fallback
    happily returns "team" and "delivery", which are words, not skills — and
    this list is what the Skills column, the tag filters and the "Top Skills
    Required" chart are drawn from.
    """
    if not (text or "").strip():
        return []
    counts = extract_phrases(text)
    known = [(term, n) for term, n in counts.items() if term in HARD_SKILL_ALIASES]
    known.sort(key=lambda pair: (-pair[1], pair[0]))
    return [term for term, _ in known[:limit]]


# ---------------------------------------------------------------------------
# The whole picture
# ---------------------------------------------------------------------------
def analyse(description: str, role_title: str = "", location_hint: str = "") -> dict:
    """Everything derivable from one posting, as plain values.

    Nothing here is written anywhere; `apply_to` below decides what a caller is
    allowed to fill in.
    """
    body = description or ""
    # The title carries seniority far more reliably than the body does
    # ("Senior ML Engineer" vs a body that mentions mentoring juniors).
    titled = f"{role_title or ''}\n{body}"

    work_mode = find_work_mode(f"{location_hint or ''}\n{body}")
    seniority = _first_label(role_title or "", _SENIORITY) or _first_label(body, _SENIORITY)
    employment = _first_label(titled, _EMPLOYMENT)

    sponsorship = ""
    if _SPONSOR_NO.search(body):
        sponsorship = "no-sponsorship"
    elif _SPONSOR_YES.search(body):
        sponsorship = "sponsorship"

    years = ""
    m = _YEARS.search(body)
    if m:
        years = f"{m.group(1)}+ yrs"

    location = find_location(body)
    if not location and work_mode == "remote":
        location = "Remote"

    tags = [t for t in (work_mode, seniority, employment, sponsorship, years) if t]
    # Tags are stored comma-separated and rendered as chips; keep them short,
    # lowercase and hyphenated so they match the ones people type by hand.
    tags = [re.sub(r"\s+", "-", t.strip().lower()) for t in tags][:MAX_TAGS]

    return {
        "location": location,
        "salary_range": find_salary(body),
        "skills_required": ", ".join(find_skills(body)),
        "tags": ",".join(dict.fromkeys(tags)),
        "work_mode": work_mode,
        "seniority": seniority,
        "employment_type": employment,
        "sponsorship": sponsorship,
    }


# Which columns this module is allowed to fill, and nothing else: it must never
# touch company, role, status, dates or the description itself.
FILLABLE = ("location", "salary_range", "skills_required", "tags")


def apply_to(data: dict, description: str = None, role_title: str = None) -> list[str]:
    """Fill blank fields on `data` in place. Returns the names it filled.

    A field counts as blank only if it is missing, None, or whitespace — a
    value the user typed, including one they deliberately cleared to a single
    space, is left exactly as it is. This is what makes the feature safe to run
    on every save rather than only on capture.
    """
    body = description if description is not None else (data.get("job_description") or "")
    if not (body or "").strip():
        return []
    facts = analyse(body, role_title if role_title is not None else (data.get("role_title") or ""),
                    data.get("location") or "")
    filled = []
    for field in FILLABLE:
        current = data.get(field)
        if current is not None and str(current).strip():
            continue
        value = facts.get(field)
        if value:
            data[field] = value
            filled.append(field)
    return filled
