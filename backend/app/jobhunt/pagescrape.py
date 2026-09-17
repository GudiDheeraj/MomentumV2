"""Reading careers pages that have no public API.

The six ATS adapters in providers.py cover most tech employers, but not a
company on Workday, Taleo, or a hand-built careers page. This is the fallback
for those, in two tiers:

  1. **Built in, no dependencies.** Fetch the HTML and read the `JobPosting`
     JSON-LD out of it. This is not a heuristic: schema.org JobPosting is what
     Google for Jobs requires, so any careers page that wants to appear in
     Google's job results already publishes clean structured data — title,
     location, salary, date posted, employment type. Parsing that is both more
     reliable and far cheaper than parsing markup, and it never breaks on a
     redesign because it isn't reading the design.

  2. **Firecrawl, if you're running it.** Set FIRECRAWL_API_URL and pages that
     build their listings in JavaScript become readable too, because Firecrawl
     runs a real browser. Entirely optional: unset, tier 1 still works, and the
     app has no external service to depend on.

Politeness is not optional here. Unlike the ATS endpoints — which exist to be
read by third parties — a company's own careers page is just a website, so this
checks robots.txt before fetching and identifies itself honestly in the
User-Agent. A disallowed path is skipped rather than worked around.
"""

from __future__ import annotations

import json
import logging
import os
import re
import urllib.error
import urllib.parse
import urllib.request
import urllib.robotparser
from datetime import datetime
from functools import lru_cache

from .providers import BoardError, _job, _parse_date, _plain, USER_AGENT

log = logging.getLogger("momentum.jobhunt")

TIMEOUT = 25
MAX_BYTES = 3_000_000        # a careers page that large is a download, not a page


def firecrawl_url() -> str:
    """Base URL of a Firecrawl instance, or "" when none is configured.

    Deliberately a URL and not an API key: this is meant to point at a
    self-hosted Firecrawl (`docker compose up` in its repo, default port 3002),
    so the app needs no third-party account and no per-page billing to work.
    """
    return (os.getenv("FIRECRAWL_API_URL") or "").strip().rstrip("/")


# ---------------------------------------------------------------------------
# Tier 0: may we?
# ---------------------------------------------------------------------------

@lru_cache(maxsize=256)
def _robots_for(origin: str) -> urllib.robotparser.RobotFileParser | None:
    rp = urllib.robotparser.RobotFileParser()
    rp.set_url(f"{origin}/robots.txt")
    try:
        rp.read()
        return rp
    except Exception:
        # No robots.txt, or unreadable. Absence is permission — that is what
        # the standard says — so this proceeds rather than blocking.
        return None


def allowed_by_robots(url: str) -> bool:
    try:
        parts = urllib.parse.urlsplit(url)
        origin = f"{parts.scheme}://{parts.netloc}"
        rp = _robots_for(origin)
        return True if rp is None else rp.can_fetch(USER_AGENT, url)
    except Exception:
        return True


# ---------------------------------------------------------------------------
# Tier 1: HTML + JSON-LD
# ---------------------------------------------------------------------------

def _get_html(url: str) -> str:
    req = urllib.request.Request(url, headers={
        "User-Agent": USER_AGENT,
        "Accept": "text/html,application/xhtml+xml",
    })
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            raw = resp.read(MAX_BYTES)
            charset = resp.headers.get_content_charset() or "utf-8"
    except urllib.error.HTTPError as e:
        raise BoardError(f"HTTP {e.code}", permanent=e.code in (401, 403, 404, 410)) from e
    except (urllib.error.URLError, OSError, TimeoutError) as e:
        raise BoardError(f"unreachable: {e}") from e
    return raw.decode(charset, errors="replace")


_LD_BLOCK = re.compile(
    r'<script[^>]+type=["\']application/ld\+json["\'][^>]*>(.*?)</script>',
    re.I | re.S)


def _iter_ld_objects(html: str):
    """Every JSON-LD object on the page, flattened.

    Pages nest these three different ways — a bare object, an array, or an
    @graph — and a parser that handles only one of them silently returns
    nothing on two thirds of the web.
    """
    for block in _LD_BLOCK.findall(html or ""):
        text = block.strip()
        if not text:
            continue
        try:
            data = json.loads(text)
        except ValueError:
            # Trailing commas and stray HTML comments are common enough in
            # hand-rolled JSON-LD to be worth one repair attempt.
            try:
                data = json.loads(re.sub(r",\s*([}\]])", r"\1", text))
            except ValueError:
                continue
        stack = [data]
        while stack:
            node = stack.pop()
            if isinstance(node, list):
                stack.extend(node)
            elif isinstance(node, dict):
                if "@graph" in node:
                    stack.append(node["@graph"])
                yield node


def _types_of(node: dict) -> set[str]:
    t = node.get("@type") or node.get("type") or ""
    if isinstance(t, list):
        return {str(x).lower() for x in t}
    return {str(t).lower()}


def _location_from(node: dict) -> tuple[str, bool | None]:
    remote = None
    if str(node.get("jobLocationType") or "").lower() == "telecommute":
        remote = True
    loc = node.get("jobLocation")
    if isinstance(loc, list):
        loc = loc[0] if loc else None
    parts: list[str] = []
    if isinstance(loc, dict):
        addr = loc.get("address")
        if isinstance(addr, list):
            addr = addr[0] if addr else None
        if isinstance(addr, dict):
            for key in ("addressLocality", "addressRegion", "addressCountry"):
                value = addr.get(key)
                if isinstance(value, dict):
                    value = value.get("name")
                if value:
                    parts.append(str(value))
        elif isinstance(addr, str):
            parts.append(addr)
        if not parts and loc.get("name"):
            parts.append(str(loc["name"]))
    elif isinstance(loc, str):
        parts.append(loc)
    if not parts and remote:
        parts.append("Remote")
    return ", ".join(dict.fromkeys(parts)), remote


def jobs_from_html(html: str, company: str, page_url: str) -> list[dict]:
    """JobPosting entries found in a page's structured data."""
    out: list[dict] = []
    for node in _iter_ld_objects(html):
        if "jobposting" not in _types_of(node):
            continue
        location, remote = _location_from(node)
        org = node.get("hiringOrganization")
        org_name = org.get("name") if isinstance(org, dict) else (org if isinstance(org, str) else None)
        emp = node.get("employmentType")
        if isinstance(emp, list):
            emp = ", ".join(str(e) for e in emp)
        url = node.get("url") or node.get("sameAs") or page_url
        identifier = node.get("identifier")
        if isinstance(identifier, dict):
            identifier = identifier.get("value")
        out.append(_job(
            org_name or company, "site",
            identifier or url,
            node.get("title") or "",
            urllib.parse.urljoin(page_url, str(url)),
            location=location,
            department=str(node.get("occupationalCategory") or "")[:160],
            employment_type=str(emp or "")[:60],
            remote=remote,
            posted_at=_parse_date(node.get("datePosted")),
            description=_plain(node.get("description")),
        ))
    return out


# ---------------------------------------------------------------------------
# Tier 2: Firecrawl, when one is running
# ---------------------------------------------------------------------------

def _firecrawl_html(url: str) -> str | None:
    """Rendered HTML via a self-hosted Firecrawl, or None if unavailable.

    Asks for `rawHtml` rather than Firecrawl's markdown: the JSON-LD parser
    above is the reliable path, and markdown would throw away the <script>
    tags that hold the structured data.
    """
    base = firecrawl_url()
    if not base:
        return None
    payload = json.dumps({"url": url, "formats": ["rawHtml"], "onlyMainContent": False}).encode()
    headers = {"Content-Type": "application/json", "User-Agent": USER_AGENT}
    # A self-hosted instance needs no key; one is sent only if given, so the
    # same code works against Firecrawl's cloud for anyone who wants that.
    key = (os.getenv("FIRECRAWL_API_KEY") or "").strip()
    if key:
        headers["Authorization"] = f"Bearer {key}"
    req = urllib.request.Request(f"{base}/v1/scrape", data=payload, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            data = json.loads(resp.read())
    except Exception as e:
        log.debug("firecrawl unavailable for %s: %s", url, e)
        return None
    body = (data or {}).get("data") or {}
    return body.get("rawHtml") or body.get("html")


# ---------------------------------------------------------------------------
# The provider entry point
# ---------------------------------------------------------------------------

def fetch_site(url: str, company: str) -> list[dict]:
    """Read a careers page. `url` is the full page address, not a token."""
    if not url.lower().startswith(("http://", "https://")):
        url = "https://" + url
    if not allowed_by_robots(url):
        raise BoardError("blocked by robots.txt", permanent=True)

    html = _get_html(url)
    jobs = jobs_from_html(html, company, url)
    if jobs:
        return jobs

    # Nothing in the raw HTML usually means the listings are drawn by
    # JavaScript. That is exactly what Firecrawl is for, and the only case
    # where it earns its keep.
    rendered = _firecrawl_html(url)
    if rendered:
        jobs = jobs_from_html(rendered, company, url)
        if jobs:
            return jobs
        raise BoardError(
            "rendered the page but found no JobPosting structured data", permanent=False)

    raise BoardError(
        "no JobPosting data in the page — it likely needs JavaScript. "
        "Set FIRECRAWL_API_URL to read pages like this.", permanent=False)
