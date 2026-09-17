"""UK register of licensed worker sponsors — sync, normalisation and matching.

The Home Office publishes the list of organisations licensed to sponsor workers
as a CSV on GOV.UK, republished most weekdays. This module keeps a local copy
and answers "is this employer on it?".

Three things are worth knowing before reading the code:

1. THE CSV URL CHANGES EVERY PUBLICATION. The file lives at a content-addressed
   assets.publishing.service.gov.uk path that is different each time. Hard-coding
   it would work until the next publication and then quietly serve stale data
   forever. So the URL is resolved through the GOV.UK Content API, which is a
   stable, documented JSON endpoint listing the publication's current
   attachments.

2. NAMES NEVER MATCH EXACTLY. A posting says "ASOS.com"; the register says
   "ASOS.com Limited". "BT" is registered as "British Telecommunications plc".
   Matching therefore normalises away legal suffixes and punctuation first, then
   falls back to a similarity score, and reports which of the two happened so
   the UI can be honest about its confidence.

3. THE ANSWER IS ADVISORY. A licence means the organisation *can* sponsor. It
   does not mean this vacancy is open to sponsorship, and large employers often
   register under a parent or subsidiary name that no job ad ever mentions.
   Nothing here should be phrased as a guarantee.
"""

from __future__ import annotations

import csv
import io
import json
import logging
import re
import urllib.request
from datetime import datetime, timezone
from difflib import SequenceMatcher

from sqlalchemy.orm import Session

from . import models

log = logging.getLogger("momentum.sponsors")

CONTENT_API = (
    "https://www.gov.uk/api/content/government/publications/"
    "register-of-licensed-sponsors-workers"
)
USER_AGENT = "MomentumTracker/1.0 (+sponsor-register-sync)"
HTTP_TIMEOUT = 60

# Confidence floor for reporting a near-miss at all. Below this the answer is
# "not found" — a 55%-similar name is noise, and showing it as a "possible
# sponsor" would be worse than showing nothing.
POSSIBLE_THRESHOLD = 0.82
# At or above this, a normalised-but-inexact match is reported as licensed.
CONFIDENT_THRESHOLD = 0.94

# Legal-form suffixes stripped before comparison. Order matters: longer forms
# first, so "co uk limited" doesn't lose "limited" and keep a dangling "co".
_SUFFIXES = [
    "public limited company", "limited liability partnership",
    "incorporated", "corporation", "limited", "holdings", "group",
    "company", "partners", "partnership", "services", "solutions",
    "international", "worldwide", "global", "and co", "llp", "ltd",
    "plc", "llc", "inc", "corp", "co", "uk", "gb",
]
_SUFFIX_RE = re.compile(
    r"\s+(?:" + "|".join(re.escape(s) for s in _SUFFIXES) + r")$", re.IGNORECASE
)


def normalise(name: str) -> str:
    """Reduce a company name to a comparable key.

    Lowercase, strip accents-free punctuation, drop a trailing "t/a ..." trading
    name, collapse whitespace, then peel legal suffixes repeatedly — "Acme UK
    Holdings Limited" and "Acme" have to land on the same key for matching to be
    worth anything.
    """
    if not name:
        return ""
    s = name.lower().strip()
    # "Acme Ltd t/a Acme Digital" — the register uses the legal name, ads use
    # the trading one; keep the part before the split and let the alias table
    # handle the rest.
    s = re.split(r"\bt/?a\b|\btrading as\b", s)[0]
    s = s.replace("&", " and ")
    s = re.sub(r"[^a-z0-9\s]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    previous = None
    while s and s != previous:
        previous = s
        s = _SUFFIX_RE.sub("", s).strip()
    return s


def similarity(a: str, b: str) -> float:
    if not a or not b:
        return 0.0
    return SequenceMatcher(None, a, b).ratio()


def match_score(query: str, candidate: str) -> float:
    """How confident are we that these two normalised names are the same firm?

    Character similarity alone is not enough, because the commonest real case
    is a job ad using the brand and the register holding the legal entity:
    "stripe" vs "stripe payments" scores 57% by character ratio, and "monzo" vs
    "monzo bank" 67% — both would be thrown away, and both are correct.

    So a leading-token match is scored on its own terms. If every word of the
    query opens the candidate name, the remaining words are almost always the
    legal form ("payments", "bank", "group"), and the score degrades with how
    many of them there are: one extra word reads as the same company, three
    extra is a different one that happens to share a first word ("apple" vs
    "apple tree nursery"). That degradation is what keeps the check honest
    rather than eagerly matching every firm starting with the same word.
    """
    if not query or not candidate:
        return 0.0
    if query == candidate:
        return 1.0

    q_tokens = query.split()
    c_tokens = candidate.split()
    ratio = similarity(query, candidate)

    # A one- or two-letter first token ("bt", "ee", "aa") is far too weak a
    # hook for prefix matching — fall back to character similarity there.
    if q_tokens and len(q_tokens[0]) >= 3 and len(c_tokens) > len(q_tokens):
        if c_tokens[:len(q_tokens)] == q_tokens:
            extra = len(c_tokens) - len(q_tokens)
            prefix_score = {1: 0.96, 2: 0.90}.get(extra, 0.84)
            return max(ratio, prefix_score)

    # The reverse case: the ad carries more words than the register entry
    # ("acme digital" vs "acme"). Rarer, and weaker evidence, since the extra
    # words may be a different division entirely.
    if c_tokens and len(c_tokens[0]) >= 3 and len(q_tokens) > len(c_tokens):
        if q_tokens[:len(c_tokens)] == c_tokens:
            extra = len(q_tokens) - len(c_tokens)
            return max(ratio, 0.88 if extra == 1 else 0.83)

    return ratio


# ---------------------------------------------------------------------------
# Sync
# ---------------------------------------------------------------------------

def _http_get(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT) as resp:
        return resp.read()


def resolve_csv_url() -> str:
    """Ask the GOV.UK Content API for the publication's current CSV attachment."""
    payload = json.loads(_http_get(CONTENT_API).decode("utf-8"))
    attachments = (payload.get("details") or {}).get("attachments") or []
    for att in attachments:
        url = att.get("url") or ""
        if url.lower().endswith(".csv"):
            return url
    raise RuntimeError(
        "No CSV attachment found on the GOV.UK register publication — the page "
        "layout may have changed."
    )


def _pick(row: dict, *candidates: str) -> str:
    """Read a column by any of several header spellings.

    The CSV's headers have changed wording more than once ("Organisation Name"
    vs "Organisation name"), and a KeyError here would mean the sync silently
    stops working after a routine republication.
    """
    lowered = {(k or "").strip().lower(): (v or "").strip() for k, v in row.items()}
    for c in candidates:
        if c in lowered and lowered[c]:
            return lowered[c]
    return ""


def parse_csv(raw: bytes) -> list[dict]:
    """Rows -> {name, city, county, routes}, de-duplicated by normalised name.

    One organisation appears once per route it is licensed for (Skilled Worker,
    Global Business Mobility, and so on), so the raw file has far more rows than
    organisations. The routes are collected onto a single record.
    """
    text = raw.decode("utf-8-sig", errors="replace")
    reader = csv.DictReader(io.StringIO(text))
    by_key: dict[str, dict] = {}
    for row in reader:
        name = _pick(row, "organisation name", "organisation", "name")
        if not name:
            continue
        key = normalise(name)
        if not key:
            continue
        route = _pick(row, "route", "tier & rating", "tier and rating", "type & rating")
        entry = by_key.get(key)
        if entry is None:
            by_key[key] = {
                "name": name,
                "norm_name": key,
                "city": _pick(row, "town/city", "town or city", "town", "city"),
                "county": _pick(row, "county"),
                "routes": route,
            }
        elif route and route not in entry["routes"]:
            entry["routes"] = f"{entry['routes']}, {route}" if entry["routes"] else route
    return list(by_key.values())


def sync_register(db: Session, csv_url: str | None = None) -> dict:
    """Download the register and replace the local copy.

    Replace rather than merge: an organisation that loses its licence is simply
    absent from the next publication, and a merge would keep telling people it
    is licensed indefinitely. The swap happens in one transaction so a failed
    download can't leave an empty table behind.
    """
    url = csv_url or resolve_csv_url()
    log.info("sponsors: downloading register from %s", url)
    rows = parse_csv(_http_get(url))
    if len(rows) < 1000:
        # The real register holds ~100k organisations. A tiny result means we
        # fetched an error page or the wrong attachment; keeping the old copy
        # is strictly better than installing a broken one.
        raise RuntimeError(
            f"Register download looked wrong — only {len(rows)} organisations parsed."
        )

    db.query(models.SponsorOrg).delete(synchronize_session=False)
    db.bulk_insert_mappings(models.SponsorOrg, rows)

    meta = db.query(models.SponsorRegisterMeta).first()
    if meta is None:
        meta = models.SponsorRegisterMeta()
        db.add(meta)
    meta.synced_at = datetime.now(timezone.utc)
    meta.source_url = url
    meta.org_count = len(rows)
    db.commit()
    log.info("sponsors: stored %s organisations", len(rows))
    return {"org_count": len(rows), "source_url": url, "synced_at": meta.synced_at}


# ---------------------------------------------------------------------------
# Lookup
# ---------------------------------------------------------------------------

def _no_register() -> dict:
    return {
        "status": "unknown",
        "detail": "The sponsor register hasn't been downloaded yet.",
        "synced_at": None,
    }


def check_company(db: Session, company: str) -> dict:
    """Look one employer up. Never raises — an unanswerable check returns
    status "unknown" so the caller can stay quiet rather than show an error."""
    meta = db.query(models.SponsorRegisterMeta).first()
    if meta is None or not meta.org_count:
        return _no_register()
    synced = meta.synced_at.isoformat() if meta.synced_at else None
    return _lookup(db, company, synced)


def check_many(db: Session, companies: list[str]) -> dict[str, dict]:
    """Look a whole page of employers up in one go.

    The in-page badges check every card in a job list at once — twenty-five
    employers on a first LinkedIn page, more as it pages in — and one request
    per card would mean a round trip, a token decode and a register-meta read
    each. Names are collapsed by normalised key before matching, because
    "Amazon", "Amazon UK" and "Amazon.com Ltd" are one lookup, not three.

    Results are keyed by the caller's original spelling, so the caller can map
    them straight back onto the cards it asked about.
    """
    meta = db.query(models.SponsorRegisterMeta).first()
    if meta is None or not meta.org_count:
        blank = _no_register()
        return {c: blank for c in companies}

    synced = meta.synced_at.isoformat() if meta.synced_at else None
    out: dict[str, dict] = {}
    by_key: dict[str, dict] = {}
    for company in companies:
        key = normalise(company)
        answer = by_key.get(key)
        if answer is None:
            answer = _lookup(db, company, synced)
            by_key[key] = answer
        out[company] = answer
    return out


def _lookup(db: Session, company: str, synced: str | None) -> dict:
    """The matching itself, with the register-level checks already made."""
    key = normalise(company)
    if not key:
        return {"status": "unknown", "detail": "No company name to check.",
                "synced_at": synced}

    exact = db.query(models.SponsorOrg).filter(models.SponsorOrg.norm_name == key).first()
    if exact:
        return {
            "status": "licensed", "matched_name": exact.name, "confidence": 100,
            "routes": exact.routes or "", "city": exact.city or "", "synced_at": synced,
        }

    # No exact key. Narrow to plausible candidates with a prefix/contains query
    # before scoring — SequenceMatcher across 100k rows on every popup open
    # would be far too slow, and anything genuinely similar shares a leading
    # word with the query.
    head = key.split(" ")[0]
    if len(head) < 3:
        head = key[:3]
    candidates = (
        db.query(models.SponsorOrg)
        .filter(models.SponsorOrg.norm_name.like(f"{head}%"))
        .limit(400)
        .all()
    )
    if not candidates:
        candidates = (
            db.query(models.SponsorOrg)
            .filter(models.SponsorOrg.norm_name.like(f"%{key}%"))
            .limit(200)
            .all()
        )

    best, best_score = None, 0.0
    for c in candidates:
        score = match_score(key, c.norm_name)
        if score > best_score:
            best, best_score = c, score

    if best and best_score >= CONFIDENT_THRESHOLD:
        return {
            "status": "licensed", "matched_name": best.name,
            "confidence": round(best_score * 100), "routes": best.routes or "",
            "city": best.city or "", "synced_at": synced,
        }
    if best and best_score >= POSSIBLE_THRESHOLD:
        return {
            "status": "possible", "matched_name": best.name,
            "confidence": round(best_score * 100), "routes": best.routes or "",
            "city": best.city or "", "synced_at": synced,
        }
    return {"status": "not_found", "matched_name": None, "confidence": 0,
            "synced_at": synced}
