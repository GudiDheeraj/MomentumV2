"""Adapters for the public job-board APIs the big applicant tracking systems
expose.

Why this and not a scraper
--------------------------
The well-known job scrapers (JobSpy and friends) work by reverse-engineering
LinkedIn's, Indeed's and Glassdoor's private endpoints. They break whenever
those sites change markup — LinkedIn changed three times in 2025 — they get
IP-blocked, and they breach those sites' terms.

Almost every company using Greenhouse, Lever, Ashby, Workable, SmartRecruiters
or Recruitee has a *public, documented, unauthenticated* JSON endpoint, because
the ATS needs one to render the careers page on the company's own marketing
site. Those endpoints are meant to be read by third parties. No auth, no
anti-bot, no scraping, structured data, and they don't move.

The trade-off is honest: this covers companies on those six platforms, which is
a large share of tech and startup employers but not "every company on earth".
A company on Workday or a bespoke careers page won't appear.

Schema drift
------------
Each `_normalize_*` reads its fields through `_first()`, which takes the first
key that exists. A provider renaming `published_at` to `publishedAt` therefore
costs a missing date on some rows rather than a 500 for everybody, and the
`raw` payload is kept so the difference is diagnosable afterwards.
"""

from __future__ import annotations

import json
import re
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from typing import Any, Callable, Iterable

USER_AGENT = "MomentumTracker/1.0 (+job board reader)"
TIMEOUT = 20


class BoardError(Exception):
    """A board that could not be read. `permanent` separates "this company is
    gone" from "the network hiccuped" — only the former should retire a board
    from the registry."""

    def __init__(self, message: str, permanent: bool = False):
        super().__init__(message)
        self.permanent = permanent


# ---------------------------------------------------------------------------
# HTTP
# ---------------------------------------------------------------------------

def _get_json(url: str) -> Any:
    req = urllib.request.Request(url, headers={
        "User-Agent": USER_AGENT,
        "Accept": "application/json",
    })
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            body = resp.read()
    except urllib.error.HTTPError as e:
        # 404/410 mean the board token is wrong or the company left the
        # platform; 403 usually means the board was made private. All three are
        # permanent in the sense that retrying tomorrow won't help.
        raise BoardError(f"HTTP {e.code}", permanent=e.code in (401, 403, 404, 410)) from e
    except (urllib.error.URLError, OSError, TimeoutError) as e:
        raise BoardError(f"unreachable: {e}") from e
    try:
        return json.loads(body)
    except ValueError as e:
        raise BoardError("response was not JSON") from e


def _first(d: dict, *keys, default=None):
    for k in keys:
        if isinstance(d, dict) and d.get(k) not in (None, ""):
            return d[k]
    return default


_TAGS = re.compile(r"<[^>]+>")
_WS = re.compile(r"\s+")


def _plain(html: str | None, limit: int = 600) -> str:
    """Descriptions arrive as HTML from some providers and plain text from
    others. The card only ever shows a snippet, and storing the full HTML of
    every posting would balloon the database for text nobody reads in full."""
    if not html:
        return ""
    text = _TAGS.sub(" ", str(html))
    text = (text.replace("&nbsp;", " ").replace("&amp;", "&")
                .replace("&lt;", "<").replace("&gt;", ">").replace("&#39;", "'")
                .replace("&quot;", '"'))
    return _WS.sub(" ", text).strip()[:limit]


def _parse_date(value: Any) -> datetime | None:
    """Providers date things four different ways: ISO with a Z, ISO with an
    offset, plain YYYY-MM-DD, and epoch milliseconds (Lever). All become naive
    UTC, which is what the rest of the app stores."""
    if value in (None, ""):
        return None
    if isinstance(value, (int, float)):
        seconds = value / 1000 if value > 10_000_000_000 else value
        try:
            return datetime.fromtimestamp(seconds, tz=timezone.utc).replace(tzinfo=None)
        except (OverflowError, OSError, ValueError):
            return None
    text = str(value).strip()
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        dt = datetime.fromisoformat(text)
    except ValueError:
        for fmt in ("%Y-%m-%d", "%Y/%m/%d", "%d-%m-%Y"):
            try:
                dt = datetime.strptime(text, fmt)
                break
            except ValueError:
                continue
        else:
            return None
    if dt.tzinfo is not None:
        dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt


def _job(company: str, provider: str, external_id: Any, title: str, url: str,
         location: str = "", department: str = "", employment_type: str = "",
         remote: bool | None = None, posted_at: datetime | None = None,
         description: str = "") -> dict:
    return {
        "company": company,
        "provider": provider,
        "external_id": str(external_id or "")[:120],
        "title": (title or "").strip()[:300],
        "url": (url or "").strip()[:600],
        "location": (location or "").strip()[:200],
        "department": (department or "").strip()[:160],
        "employment_type": (employment_type or "").strip()[:60],
        "remote": remote,
        "posted_at": posted_at,
        "description": description,
    }


# ---------------------------------------------------------------------------
# Greenhouse — https://boards-api.greenhouse.io/v1/boards/{token}/jobs
# ---------------------------------------------------------------------------

def fetch_greenhouse(token: str, company: str) -> list[dict]:
    data = _get_json(
        f"https://boards-api.greenhouse.io/v1/boards/{urllib.parse.quote(token)}/jobs?content=true")
    out = []
    for j in (data or {}).get("jobs", []) or []:
        loc = j.get("location") or {}
        departments = j.get("departments") or []
        out.append(_job(
            company, "greenhouse", j.get("id"),
            _first(j, "title", default=""),
            _first(j, "absolute_url", "url", default=""),
            location=loc.get("name") if isinstance(loc, dict) else str(loc or ""),
            department=(departments[0] or {}).get("name", "") if departments else "",
            posted_at=_parse_date(_first(j, "first_published", "updated_at")),
            description=_plain(j.get("content")),
        ))
    return out


# ---------------------------------------------------------------------------
# Lever — https://api.lever.co/v0/postings/{token}?mode=json
# ---------------------------------------------------------------------------

def fetch_lever(token: str, company: str) -> list[dict]:
    data = _get_json(
        f"https://api.lever.co/v0/postings/{urllib.parse.quote(token)}?mode=json")
    out = []
    for j in data or []:
        cats = j.get("categories") or {}
        workplace = (j.get("workplaceType") or "").lower()
        out.append(_job(
            company, "lever", j.get("id"),
            _first(j, "text", "title", default=""),
            _first(j, "hostedUrl", "applyUrl", default=""),
            location=_first(cats, "location", "allLocations", default="") if isinstance(cats, dict) else "",
            department=_first(cats, "team", "department", default="") if isinstance(cats, dict) else "",
            employment_type=_first(cats, "commitment", default="") if isinstance(cats, dict) else "",
            remote=True if workplace == "remote" else (False if workplace else None),
            # createdAt is epoch milliseconds here, which _parse_date handles.
            posted_at=_parse_date(_first(j, "createdAt", "updatedAt")),
            description=_plain(_first(j, "descriptionPlain", "description")),
        ))
    return out


# ---------------------------------------------------------------------------
# Ashby — https://api.ashbyhq.com/posting-api/job-board/{token}
# ---------------------------------------------------------------------------

def fetch_ashby(token: str, company: str) -> list[dict]:
    data = _get_json(
        f"https://api.ashbyhq.com/posting-api/job-board/{urllib.parse.quote(token)}")
    out = []
    for j in (data or {}).get("jobs", []) or []:
        out.append(_job(
            company, "ashby", _first(j, "id", "jobId"),
            _first(j, "title", default=""),
            _first(j, "jobUrl", "applyUrl", default=""),
            location=_first(j, "location", "locationName", default=""),
            department=_first(j, "department", "team", default=""),
            employment_type=_first(j, "employmentType", default=""),
            remote=j.get("isRemote"),
            posted_at=_parse_date(_first(j, "publishedAt", "updatedAt")),
            description=_plain(_first(j, "descriptionPlain", "descriptionHtml")),
        ))
    return out


# ---------------------------------------------------------------------------
# Workable — https://apply.workable.com/api/v1/widget/accounts/{token}
# ---------------------------------------------------------------------------

def fetch_workable(token: str, company: str) -> list[dict]:
    data = _get_json(
        f"https://apply.workable.com/api/v1/widget/accounts/{urllib.parse.quote(token)}?details=true")
    out = []
    for j in (data or {}).get("jobs", []) or []:
        city = _first(j, "city", "location", default="")
        country = _first(j, "country", "country_code", default="")
        location = ", ".join(x for x in [city, country] if x)
        out.append(_job(
            company, "workable", _first(j, "shortcode", "id"),
            _first(j, "title", default=""),
            _first(j, "url", "application_url", "shortlink", default=""),
            location=location,
            department=_first(j, "department", default=""),
            employment_type=_first(j, "employment_type", default=""),
            remote=j.get("telecommuting"),
            posted_at=_parse_date(_first(j, "published_on", "created_at", "published")),
            description=_plain(_first(j, "description", "requirements")),
        ))
    return out


# ---------------------------------------------------------------------------
# SmartRecruiters — https://api.smartrecruiters.com/v1/companies/{token}/postings
# ---------------------------------------------------------------------------

def fetch_smartrecruiters(token: str, company: str) -> list[dict]:
    data = _get_json(
        f"https://api.smartrecruiters.com/v1/companies/{urllib.parse.quote(token)}/postings?limit=100")
    out = []
    for j in (data or {}).get("content", []) or []:
        loc = j.get("location") or {}
        parts = [loc.get("city"), loc.get("region"), loc.get("country")]
        dept = j.get("department") or {}
        emp = j.get("typeOfEmployment") or {}
        job_id = j.get("id")
        out.append(_job(
            company, "smartrecruiters", job_id,
            _first(j, "name", "title", default=""),
            # The API's own `ref` is a JSON URL, not something a human applies
            # through, so the public posting URL is built instead.
            f"https://jobs.smartrecruiters.com/{token}/{job_id}",
            location=", ".join(str(p) for p in parts if p),
            department=dept.get("label", "") if isinstance(dept, dict) else "",
            employment_type=emp.get("label", "") if isinstance(emp, dict) else "",
            remote=loc.get("remote") if isinstance(loc, dict) else None,
            posted_at=_parse_date(_first(j, "releasedDate", "createdOn")),
        ))
    return out


# ---------------------------------------------------------------------------
# Recruitee — https://{token}.recruitee.com/api/offers/
# ---------------------------------------------------------------------------

def fetch_recruitee(token: str, company: str) -> list[dict]:
    data = _get_json(f"https://{urllib.parse.quote(token)}.recruitee.com/api/offers/")
    out = []
    for j in (data or {}).get("offers", []) or []:
        parts = [j.get("city"), j.get("country")]
        out.append(_job(
            company, "recruitee", j.get("id"),
            _first(j, "title", default=""),
            _first(j, "careers_url", "careers_apply_url", default=""),
            location=", ".join(str(p) for p in parts if p) or _first(j, "location", default=""),
            department=_first(j, "department", default=""),
            employment_type=_first(j, "employment_type_code", default=""),
            remote=(j.get("remote") if j.get("remote") is not None
                    else ("remote" in str(j.get("location", "")).lower() or None)),
            posted_at=_parse_date(_first(j, "published_at", "created_at")),
            description=_plain(_first(j, "description", "requirements")),
        ))
    return out


def fetch_site(token: str, company: str) -> list[dict]:
    """Any careers page, read from its schema.org structured data.

    Imported lazily because pagescrape imports helpers from this module, and a
    module-level import either way round would be a cycle.
    """
    from .pagescrape import fetch_site as _fetch
    return _fetch(token, company)


PROVIDERS: dict[str, Callable[[str, str], list[dict]]] = {
    "greenhouse": fetch_greenhouse,
    "lever": fetch_lever,
    "ashby": fetch_ashby,
    "workable": fetch_workable,
    "smartrecruiters": fetch_smartrecruiters,
    "recruitee": fetch_recruitee,
    # The catch-all: token is a full careers-page URL rather than a slug.
    "site": fetch_site,
}


def fetch_board(provider: str, token: str, company: str) -> list[dict]:
    fn = PROVIDERS.get((provider or "").lower())
    if not fn:
        raise BoardError(f"unknown provider '{provider}'", permanent=True)
    return fn(token, company or token)


# ---------------------------------------------------------------------------
# Careers-URL detection
# ---------------------------------------------------------------------------
# Adding a company by pasting the careers page is the only interaction that
# doesn't require knowing what an "ATS board token" is, so it has to work on
# the messy URLs people actually copy: with query strings, trailing slashes,
# a specific job id on the end, or the company's own vanity domain in front.

_URL_PATTERNS: list[tuple[str, re.Pattern]] = [
    ("greenhouse", re.compile(r"(?:boards|job-boards)\.greenhouse\.io/(?:embed/job_board\?for=)?([\w-]+)", re.I)),
    ("greenhouse", re.compile(r"boards-api\.greenhouse\.io/v1/boards/([\w-]+)", re.I)),
    ("lever", re.compile(r"jobs\.(?:eu\.)?lever\.co/([\w-]+)", re.I)),
    ("lever", re.compile(r"api\.lever\.co/v0/postings/([\w-]+)", re.I)),
    ("ashby", re.compile(r"jobs\.ashbyhq\.com/([\w.-]+)", re.I)),
    ("ashby", re.compile(r"api\.ashbyhq\.com/posting-api/job-board/([\w.-]+)", re.I)),
    ("workable", re.compile(r"apply\.workable\.com/(?:api/v1/widget/accounts/)?([\w-]+)", re.I)),
    ("workable", re.compile(r"([\w-]+)\.workable\.com", re.I)),
    ("smartrecruiters", re.compile(r"jobs\.smartrecruiters\.com/([\w-]+)", re.I)),
    ("smartrecruiters", re.compile(r"api\.smartrecruiters\.com/v1/companies/([\w-]+)", re.I)),
    ("recruitee", re.compile(r"([\w-]+)\.recruitee\.com", re.I)),
]

_NOT_TOKENS = {"embed", "api", "www", "job_board", "jobs", "careers", "v1", "v0"}


def detect_board(url: str) -> tuple[str, str] | None:
    """(provider, token) from a careers URL, or None if it isn't one we know."""
    text = (url or "").strip()
    if not text:
        return None
    for provider, pattern in _URL_PATTERNS:
        m = pattern.search(text)
        if m:
            token = m.group(1)
            if token.lower() in _NOT_TOKENS:
                continue
            return provider, token
    # Not one of the six ATS platforms. If it is a URL at all, it can still be
    # read from its structured data — that is what the "site" provider is for,
    # and it is what makes "any company careers page" true rather than
    # "any company on a platform we happen to support".
    if re.match(r"^(https?://)?[\w.-]+\.[a-z]{2,}(/|$)", text, re.I):
        if not text.lower().startswith(("http://", "https://")):
            text = "https://" + text
        return "site", text
    return None
