"""Running a saved search across every known board.

Shape of a run:

    boards -> threads fetch each board's JSON -> normalise -> match
           -> fingerprint -> compare against what this user has already seen
           -> persist, returning only what is genuinely new

Concurrency is threads rather than asyncio because the provider adapters use
urllib, and the work is entirely I/O wait — sixty boards at four at a time is
about four seconds, against a minute and a half serially. The cap exists to
stay a polite client: these endpoints are free and public, and hammering them
sixty-at-once is how that stops being true.
"""

from __future__ import annotations

import hashlib
import logging
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta

from sqlalchemy.orm import Session

from .. import models
from . import registry
from .providers import BoardError, fetch_board

log = logging.getLogger("momentum.jobhunt")

MAX_WORKERS = 8
# Nobody reads 2,000 postings. This bounds a single run's memory and the size
# of the response the tab has to render.
MAX_HITS_PER_RUN = 400


def _split(value: str | None) -> list[str]:
    return [p.strip().lower() for p in re.split(r"[,\n;]", value or "") if p.strip()]


# Providers write the same country four ways. SmartRecruiters returns
# "Dublin, ie", Workable "Berlin, Germany", Greenhouse "London, UK" — so a
# search for "Ireland" silently missed every Irish job until each spelling was
# treated as the same place. Each group is a set of interchangeable terms:
# typing any one of them matches a posting containing any other.
_LOCATION_ALIASES: list[set[str]] = [
    {"uk", "united kingdom", "gb", "gbr", "britain", "great britain", "england",
     "scotland", "wales", "northern ireland"},
    {"ireland", "ie", "irl", "republic of ireland", "eire"},
    {"usa", "us", "united states", "united states of america", "america", "u.s.", "u.s.a."},
    {"uae", "ae", "united arab emirates"},
    {"germany", "de", "deu", "deutschland"},
    {"netherlands", "nl", "nld", "holland", "the netherlands"},
    {"france", "fr", "fra"},
    {"spain", "es", "esp"},
    {"italy", "it", "ita"},
    {"portugal", "pt", "prt"},
    {"poland", "pl", "pol"},
    {"sweden", "se", "swe"},
    {"switzerland", "ch", "che"},
    {"canada", "ca", "can"},
    {"australia", "au", "aus"},
    {"india", "in", "ind"},
    {"singapore", "sg", "sgp"},
    {"japan", "jp", "jpn"},
    {"brazil", "br", "bra"},
    {"mexico", "mx", "mex"},
]


def expand_locations(terms: list[str]) -> list[str]:
    """Every equivalent spelling of each place asked for."""
    out: list[str] = []
    for term in terms:
        out.append(term)
        for group in _LOCATION_ALIASES:
            if term in group:
                out.extend(group)
    # Deduped, longest first: matching "united kingdom" before "uk" means the
    # reported reason for a match is the more specific one.
    return sorted(set(out), key=len, reverse=True)


def _location_matches(loc: str, terms: list[str]) -> bool:
    """Word-boundary matching, because a bare country code is two letters and
    substring matching would put every job in Vienna ("ie" inside "Vienna")
    into an Ireland search."""
    for term in terms:
        if len(term) <= 3:
            if re.search(rf"(?<![a-z]){re.escape(term)}(?![a-z])", loc):
                return True
        elif term in loc:
            return True
    return False


def _fingerprint(job: dict) -> str:
    """Stable identity for a posting across runs.

    Provider id when there is one. When there isn't, a hash of company + title
    + location — deliberately not including the date, since some providers
    bump `updated_at` on every edit and a fingerprint that moved with it would
    report the same job as new every morning.
    """
    if job.get("external_id"):
        return f"{job.get('provider')}:{job.get('external_id')}"[:120]
    raw = f"{job.get('company','')}|{job.get('title','')}|{job.get('location','')}".lower()
    return "h:" + hashlib.sha1(raw.encode("utf-8")).hexdigest()[:32]


def matches(job: dict, roles: list[str], locations: list[str],
            exclude: list[str], remote_only: bool, cutoff: datetime | None) -> bool:
    title = (job.get("title") or "").lower()
    dept = (job.get("department") or "").lower()
    loc = (job.get("location") or "").lower()

    if exclude and any(term in title for term in exclude):
        return False

    # Roles match the title first and the department second: "Data" as a
    # department shouldn't drag in every job at the company, but "engineering"
    # as a search term reasonably should.
    if roles and not any(r in title for r in roles) and not any(r in dept for r in roles):
        return False

    if remote_only and not (job.get("remote") or "remote" in loc or "anywhere" in loc):
        return False

    if locations:
        remote_ok = bool(job.get("remote")) or "remote" in loc
        if not _location_matches(loc, locations) and not remote_ok:
            return False

    if cutoff and job.get("posted_at") and job["posted_at"] < cutoff:
        return False
    # A posting with no date is kept. Some providers simply don't publish one,
    # and dropping those would silently hide entire companies.
    return True


def _fetch_one(board_row: dict) -> tuple[dict, list[dict] | None, BoardError | None]:
    try:
        jobs = fetch_board(board_row["provider"], board_row["token"], board_row["name"])
        return board_row, jobs, None
    except BoardError as e:
        return board_row, None, e
    except Exception as e:  # a provider returning something wild
        return board_row, None, BoardError(f"unexpected: {type(e).__name__}: {e}")


def run_search(db: Session, user_id: int, search: models.JobSearch,
               limit_boards: int | None = None) -> dict:
    """Executes the search and records the results. Returns a summary.

    The database session is used before and after the network work, never
    during: the fetches happen on worker threads, and a Session is not
    thread-safe.
    """
    boards = registry.boards_for_user(db, user_id)
    if limit_boards:
        boards = boards[:limit_boards]
    board_rows = [{"id": b.id, "name": b.name, "provider": b.provider, "token": b.token}
                  for b in boards]

    roles = _split(search.roles)
    locations = expand_locations(_split(search.locations))
    exclude = _split(search.exclude)
    cutoff = (datetime.utcnow() - timedelta(days=search.since_days)) if search.since_days else None

    found: list[dict] = []
    ok_boards = failed_boards = 0
    failures: list[tuple[int, BoardError]] = []
    successes: list[tuple[int, int]] = []

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
        futures = [pool.submit(_fetch_one, row) for row in board_rows]
        for fut in as_completed(futures):
            row, jobs, err = fut.result()
            if err is not None:
                failed_boards += 1
                failures.append((row["id"], err))
                continue
            ok_boards += 1
            successes.append((row["id"], len(jobs)))
            for job in jobs:
                if matches(job, roles, locations, exclude, bool(search.remote_only), cutoff):
                    found.append(job)

    for board_id, count in successes:
        registry.record_success(db, board_id, count)
    for board_id, err in failures:
        registry.record_failure(db, board_id, str(err), err.permanent)

    # Newest first, undated last — an undated posting is usually an old one.
    found.sort(key=lambda j: j.get("posted_at") or datetime.min, reverse=True)
    found = found[:MAX_HITS_PER_RUN]

    new_count = _persist(db, user_id, found)

    search.last_run_at = datetime.utcnow()
    search.last_run_new = new_count
    db.commit()

    return {
        "boards_searched": len(board_rows),
        "boards_ok": ok_boards,
        "boards_failed": failed_boards,
        "matched": len(found),
        "new": new_count,
        "ran_at": search.last_run_at,
    }


def _persist(db: Session, user_id: int, jobs: list[dict]) -> int:
    """Upserts hits, returning how many were seen for the first time.

    Existing hits get their last_seen_at bumped and nothing else — in
    particular not their status, so a job dismissed last week doesn't come back
    to the top of the list every day.
    """
    if not jobs:
        return 0
    fingerprints = [_fingerprint(j) for j in jobs]
    known = {
        h.fingerprint: h for h in db.query(models.JobHit).filter(
            models.JobHit.user_id == user_id,
            models.JobHit.fingerprint.in_(fingerprints),
        ).all()
    }
    now = datetime.utcnow()
    new_count = 0
    for job, fp in zip(jobs, fingerprints):
        hit = known.get(fp)
        if hit:
            hit.last_seen_at = now
            continue
        db.add(models.JobHit(
            user_id=user_id, fingerprint=fp,
            company=job["company"], provider=job.get("provider"),
            title=job["title"], url=job.get("url"),
            location=job.get("location"), department=job.get("department"),
            employment_type=job.get("employment_type"), remote=job.get("remote"),
            posted_at=job.get("posted_at"), description=job.get("description"),
            first_seen_at=now, last_seen_at=now, status="new",
        ))
        known[fp] = True  # guards duplicates inside this same batch
        new_count += 1
    db.commit()
    return new_count


def referral_map(db: Session, user_id: int) -> dict[str, list[dict]]:
    """Company name (lowercased) -> contacts who could refer you there.

    Looked up once per render rather than per hit: the whole point is to show
    "you know someone here" on the listing itself, and a query per row would
    be a hundred queries on a page.
    """
    rows = db.query(models.ReferralContact).filter(
        models.ReferralContact.user_id == user_id
    ).all()
    out: dict[str, list[dict]] = {}
    for r in rows:
        out.setdefault((r.company or "").strip().lower(), []).append({
            "id": r.id, "name": r.name, "role": r.role, "contact": r.contact,
        })
    return out
