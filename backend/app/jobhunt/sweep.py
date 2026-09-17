"""The scheduled sweep that keeps the local posting cache in step with the
company boards.

Why this module exists
----------------------
Searching used to fetch every board live, on every run. That is a sound design
at sixty boards and an impossible one at two thousand: two thousand outbound
requests behind a button press, several minutes before the page can answer, and
a level of traffic that would rightly get the app blocked by the very free
public endpoints it depends on.

So the network work moves here. A sweep reads every active board once, writes
what it finds into `job_postings`, and searching becomes a query against that
table. The sweep runs on a schedule with nobody watching, which is the only
context in which taking four minutes is fine.

Three things a sweep does, in order
-----------------------------------
1. **Upsert.** Every posting seen gets its row created or refreshed, and
   `last_seen_at` stamped with this run's start time.

2. **Close.** Any posting belonging to a board that answered successfully, but
   which this run did not see, has been taken down. It is stamped `closed_at`
   rather than deleted, so a hit already shown to somebody can be reconciled
   before the row disappears. Boards that *failed* are skipped here on purpose:
   a timeout is not evidence that a company withdrew every job it had.

3. **Purge.** Postings past the retention window, and closed postings past a
   short grace period, are deleted, along with the hits that pointed at them.

Retention
---------
`JOBHUNT_RETENTION_DAYS` (default 7) is the age at which a posting leaves the
app whether or not it is still on the board. A listing you were shown a week
ago and did not act on is not news any more, and keeping it makes the list
grow without bound.

Hits a person acted on are exempt. A saved posting, or one turned into a
tracked application, is theirs rather than the sweep's, and deleting it would
destroy work. Dismissed hits are kept too, as tombstones: they are already
invisible, they cost one row each, and removing them would let a job somebody
deliberately hid reappear on the next sweep.
"""

from __future__ import annotations

import logging
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta

from sqlalchemy import and_, or_
from sqlalchemy.orm import Session

from .. import models
from ..env import env_int
from . import registry
from .providers import BoardError, fetch_board

log = logging.getLogger("momentum.jobhunt")

# One sweep at a time, process wide. Two overlapping sweeps would each see the
# other's half-written rows as postings the board no longer lists, and would
# close them. Non-blocking: a second caller is told no rather than queued,
# because a queued sweep is just the same sweep again five minutes later.
_running = threading.Lock()


class SweepBusy(RuntimeError):
    """Raised when a sweep is asked for while one is already in progress."""


def is_running() -> bool:
    return _running.locked()


def retention_days() -> int:
    return max(1, env_int("JOBHUNT_RETENTION_DAYS", 7))


def closed_grace_hours() -> int:
    """How long a withdrawn posting stays in the table after being marked
    closed. Not zero: a hit shown this morning should be reconcilable against
    its posting, and a row deleted the instant it vanished from the board would
    leave the hit orphaned with nothing to explain it."""
    return max(0, env_int("JOBHUNT_CLOSED_GRACE_HOURS", 24))


def sweep_workers() -> int:
    """Eight was polite at sixty boards. Two thousand boards at eight workers
    is roughly seven minutes, which is fine for something nobody is waiting on,
    so the default only moves to twelve. Raising it further is how a free
    public endpoint stops being free and public."""
    return max(1, min(32, env_int("JOBHUNT_SWEEP_WORKERS", 12)))


def max_postings_per_board() -> int:
    """A handful of boards on the Global 2000 list carry several thousand
    openings. Storing all of them would let three companies dominate the table
    and slow every query for the sake of postings nobody scrolls to."""
    return max(50, env_int("JOBHUNT_MAX_POSTINGS_PER_BOARD", 800))


# ---------------------------------------------------------------------------
# Identity
# ---------------------------------------------------------------------------

def fingerprint(job: dict) -> str:
    """Kept identical to search._fingerprint on purpose.

    A hit and the posting it came from have to carry the same identity, or
    reconciling "this job was taken down" against "this is the row you were
    shown" needs a join that does not exist.
    """
    from .search import _fingerprint
    return _fingerprint(job)


def _search_text(job: dict) -> str:
    return f"{job.get('title') or ''} {job.get('department') or ''}".lower()[:500]


# ---------------------------------------------------------------------------
# One board
# ---------------------------------------------------------------------------

def _fetch_one(row: dict):
    try:
        jobs = fetch_board(row["provider"], row["token"], row["name"])
        return row, jobs, None
    except BoardError as e:
        return row, None, e
    except Exception as e:                                   # noqa: BLE001
        return row, None, BoardError(f"unexpected: {type(e).__name__}: {e}")


def _store_board(db: Session, board_id: int, company: str, jobs: list[dict],
                 run_at: datetime) -> tuple[int, int]:
    """Writes one board's postings. Returns (new, closed)."""
    jobs = jobs[:max_postings_per_board()]

    existing = {
        p.fingerprint: p for p in db.query(models.JobPosting).filter(
            models.JobPosting.board_id == board_id).all()
    }

    seen: set[str] = set()
    new_count = 0
    for job in jobs:
        fp = fingerprint(job)
        if fp in seen:
            # The same posting listed twice on one board. Happens on boards
            # that publish a role per location without a distinct id.
            continue
        seen.add(fp)
        row = existing.get(fp)
        if row is None:
            db.add(models.JobPosting(
                board_id=board_id, fingerprint=fp,
                company=job.get("company") or company,
                provider=job.get("provider"), title=job.get("title") or "",
                url=job.get("url"), location=job.get("location"),
                department=job.get("department"),
                employment_type=job.get("employment_type"),
                remote=job.get("remote"), posted_at=job.get("posted_at"),
                description=job.get("description"),
                search_text=_search_text(job),
                first_seen_at=run_at, last_seen_at=run_at, closed_at=None,
            ))
            new_count += 1
            continue
        # Refresh in place. Title and location genuinely change on live
        # postings, and a reopened posting has to lose its closed stamp.
        row.title = job.get("title") or row.title
        row.url = job.get("url") or row.url
        row.location = job.get("location")
        row.department = job.get("department")
        row.employment_type = job.get("employment_type")
        row.remote = job.get("remote")
        row.posted_at = job.get("posted_at") or row.posted_at
        row.description = job.get("description") or row.description
        row.search_text = _search_text(job)
        row.last_seen_at = run_at
        row.closed_at = None

    closed_count = 0
    for fp, row in existing.items():
        if fp in seen or row.closed_at is not None:
            continue
        row.closed_at = run_at
        closed_count += 1

    db.commit()
    return new_count, closed_count


# ---------------------------------------------------------------------------
# The sweep
# ---------------------------------------------------------------------------

def sweep(db: Session, kind: str = "daily", board_ids: list[int] | None = None,
          limit: int | None = None) -> dict:
    """Reads every active board and brings the cache up to date.

    The session is used before and after the network work, never during it: the
    fetches run on worker threads and a Session is not thread safe.
    """
    if not _running.acquire(blocking=False):
        raise SweepBusy("a sweep is already running")
    try:
        return _sweep(db, kind, board_ids, limit)
    finally:
        _running.release()


def _sweep(db: Session, kind: str, board_ids: list[int] | None,
           limit: int | None) -> dict:
    run_at = datetime.utcnow()
    run = models.BoardSweep(started_at=run_at, run_date=run_at.date(), kind=kind)
    db.add(run)
    db.commit()

    q = db.query(models.CompanyBoard).filter(models.CompanyBoard.active == True)  # noqa: E712
    if board_ids:
        q = q.filter(models.CompanyBoard.id.in_(board_ids))
    boards = q.order_by(models.CompanyBoard.id).all()
    if limit:
        boards = boards[:limit]
    rows = [{"id": b.id, "name": b.name, "provider": b.provider, "token": b.token}
            for b in boards]

    ok = failed = new_total = closed_total = 0
    results: list[tuple[dict, list[dict] | None, BoardError | None]] = []

    with ThreadPoolExecutor(max_workers=sweep_workers()) as pool:
        futures = [pool.submit(_fetch_one, r) for r in rows]
        for fut in as_completed(futures):
            results.append(fut.result())

    # Database work back on this thread, one board at a time. Writing from the
    # worker threads would need a session each and would put two thousand
    # writers on one SQLite file.
    for row, jobs, err in results:
        if err is not None:
            failed += 1
            registry.record_failure(db, row["id"], str(err), err.permanent)
            continue
        ok += 1
        try:
            n, c = _store_board(db, row["id"], row["name"], jobs, run_at)
        except Exception:                                    # noqa: BLE001
            db.rollback()
            log.exception("jobhunt: storing %s failed", row["name"])
            continue
        new_total += n
        closed_total += c
        registry.record_success(db, row["id"], len(jobs))

    purged = purge_expired(db)
    reconcile_hits(db)

    run.finished_at = datetime.utcnow()
    run.boards_total = len(rows)
    run.boards_ok = ok
    run.boards_failed = failed
    run.postings_new = new_total
    run.postings_closed = closed_total
    run.postings_purged = purged
    db.commit()

    log.info("jobhunt sweep (%s): %s boards, %s ok, %s failed, %s new, "
             "%s closed, %s purged, %.0fs",
             kind, len(rows), ok, failed, new_total, closed_total, purged,
             (run.finished_at - run_at).total_seconds())

    return {
        "boards_total": len(rows), "boards_ok": ok, "boards_failed": failed,
        "postings_new": new_total, "postings_closed": closed_total,
        "postings_purged": purged,
        "started_at": run_at, "finished_at": run.finished_at,
        "seconds": (run.finished_at - run_at).total_seconds(),
    }


# ---------------------------------------------------------------------------
# Retention
# ---------------------------------------------------------------------------

def purge_expired(db: Session) -> int:
    """Deletes postings that are past the retention window, and closed ones
    past the grace period. Returns how many rows went."""
    now = datetime.utcnow()
    stale_before = now - timedelta(days=retention_days())
    closed_before = now - timedelta(hours=closed_grace_hours())

    victims = db.query(models.JobPosting.id, models.JobPosting.fingerprint).filter(
        or_(
            models.JobPosting.first_seen_at < stale_before,
            and_(models.JobPosting.closed_at.isnot(None),
                 models.JobPosting.closed_at < closed_before),
        )
    ).all()
    if not victims:
        return 0

    ids = [v[0] for v in victims]
    # Chunked because SQLite caps a statement at 999 bound parameters and a
    # two thousand board sweep can retire far more than that in one go.
    removed = 0
    for i in range(0, len(ids), 500):
        chunk = ids[i:i + 500]
        removed += db.query(models.JobPosting).filter(
            models.JobPosting.id.in_(chunk)).delete(synchronize_session=False)
    db.commit()
    return removed


def reconcile_hits(db: Session) -> int:
    """Removes the hits whose postings are gone or withdrawn.

    A hit somebody acted on is left alone. Saved and applied hits are their
    work; dismissed hits stay as tombstones so a job deliberately hidden does
    not come back on the next sweep. That leaves `new` hits, which are exactly
    the ones the list is showing as current, and those should not outlive the
    posting they point at.
    """
    now = datetime.utcnow()
    stale_before = now - timedelta(days=retention_days())

    open_fps = {
        fp for (fp,) in db.query(models.JobPosting.fingerprint).filter(
            models.JobPosting.closed_at.is_(None)).all()
    }

    candidates = db.query(models.JobHit).filter(
        models.JobHit.status == "new",
        models.JobHit.application_id.is_(None),
    ).all()

    removed = 0
    for hit in candidates:
        expired = hit.first_seen_at is not None and hit.first_seen_at < stale_before
        withdrawn = hit.fingerprint not in open_fps
        if expired or withdrawn:
            db.delete(hit)
            removed += 1
    if removed:
        db.commit()
        log.info("jobhunt: removed %s hits (expired or withdrawn)", removed)
    return removed
