"""The clock behind the daily board sweep.

Deliberately not hung off the Telegram scheduler, which is where the per user
daily search lives. That loop only runs when a bot token is configured, and the
posting cache has to stay current whether or not anybody wired up Telegram: the
Job Hunt tab in the browser depends on it just as much as the alert does.

Schedule
--------
Once a day at `JOBHUNT_SWEEP_UTC` (default 12:00 UTC). UTC rather than local
time because the sweep serves every user at once and there is no one person's
timezone to follow. In Britain that is 12:00 in winter and 13:00 in summer,
since UK clocks move and UTC does not.

Idempotence and catch up
------------------------
A `BoardSweep` row records the UTC date each daily run covered, so a restart
cannot produce a second sweep for the same day. If the backend was down at
noon, the next tick after it comes back runs the sweep late rather than
skipping the day: a cache refreshed at 16:00 is worth far more than one not
refreshed at all.

The first ever sweep does not wait for noon. On a new install the cache is
empty and the Job Hunt tab has nothing to show, so a sweep starts a minute
after boot instead of the tab looking broken until the next lunchtime.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import date, datetime

from ..env import env_bool, env_str

log = logging.getLogger("momentum.jobhunt")

TICK_SECONDS = 60
# A minute of quiet after boot. Startup is already busy with create_all, the
# migrations and the first page load, and a two thousand board sweep competing
# with those for the same SQLite file is how a restart turns into a stall.
FIRST_RUN_DELAY_SECONDS = 60


def is_enabled() -> bool:
    return env_bool("JOBHUNT_SWEEP_ENABLED", True)


def sweep_time_utc() -> tuple[int, int]:
    """(hour, minute) from JOBHUNT_SWEEP_UTC. Falls back to noon on anything
    unparseable, because a malformed .env line should cost the default
    schedule rather than the whole feature."""
    raw = (env_str("JOBHUNT_SWEEP_UTC", "12:00") or "12:00").strip()
    try:
        hh, mm = raw.split(":")
        hour, minute = int(hh), int(mm)
        if 0 <= hour <= 23 and 0 <= minute <= 59:
            return hour, minute
    except ValueError:
        pass
    log.warning("jobhunt: JOBHUNT_SWEEP_UTC=%r is not HH:MM, using 12:00", raw)
    return 12, 0


def _last_daily_run_date() -> date | None:
    from ..database import SessionLocal
    from .. import models

    db = SessionLocal()
    try:
        row = (db.query(models.BoardSweep)
                 .filter(models.BoardSweep.kind == "daily")
                 .order_by(models.BoardSweep.started_at.desc()).first())
        return row.run_date if row else None
    finally:
        db.close()


def _any_sweep_recorded() -> bool:
    from ..database import SessionLocal
    from .. import models

    db = SessionLocal()
    try:
        return db.query(models.BoardSweep.id).first() is not None
    finally:
        db.close()


def _due(now: datetime) -> bool:
    hour, minute = sweep_time_utc()
    target = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
    if now < target:
        return False
    return _last_daily_run_date() != now.date()


def run_sweep_now(kind: str = "daily") -> dict | None:
    """Blocking. Runs on a worker thread so the event loop keeps serving.

    Returns None when a sweep is already in progress, which happens when
    somebody pressed Refresh now a few minutes before noon. The scheduler
    treats that as "not done yet" and tries again on the next tick rather than
    marking the day complete on the strength of a run it did not do.
    """
    from ..database import SessionLocal
    from . import sweep as sweep_engine

    db = SessionLocal()
    try:
        return sweep_engine.sweep(db, kind=kind)
    except sweep_engine.SweepBusy:
        log.info("jobhunt: a sweep is already running, leaving it to finish")
        return None
    finally:
        db.close()


async def run_scheduler(stop: asyncio.Event) -> None:
    if not is_enabled():
        log.info("jobhunt: sweep scheduler OFF (JOBHUNT_SWEEP_ENABLED is false)")
        return

    hour, minute = sweep_time_utc()
    log.info("jobhunt: sweep scheduler started, daily at %02d:%02d UTC", hour, minute)

    try:
        await asyncio.wait_for(stop.wait(), timeout=FIRST_RUN_DELAY_SECONDS)
        return
    except asyncio.TimeoutError:
        pass

    # Cold start. Nothing has ever been swept, so the cache is empty and the
    # tab has nothing to show; do not make somebody wait until tomorrow noon.
    try:
        if not await asyncio.to_thread(_any_sweep_recorded):
            log.info("jobhunt: no sweep on record, running the first one now")
            await asyncio.to_thread(run_sweep_now, "daily")
    except Exception:                                        # noqa: BLE001
        log.exception("jobhunt: first sweep failed")

    while not stop.is_set():
        try:
            if await asyncio.to_thread(_due, datetime.utcnow()):
                log.info("jobhunt: daily sweep due, starting")
                await asyncio.to_thread(run_sweep_now, "daily")
        except asyncio.CancelledError:
            raise
        except Exception:                                    # noqa: BLE001
            # A failed sweep leaves the previous cache in place, which is a far
            # smaller problem than a scheduler that stops ticking.
            log.exception("jobhunt: sweep tick failed")

        try:
            await asyncio.wait_for(stop.wait(), timeout=TICK_SECONDS)
        except asyncio.TimeoutError:
            pass

    log.info("jobhunt: sweep scheduler stopped")
