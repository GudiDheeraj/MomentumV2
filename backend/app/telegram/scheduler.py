"""The per-minute scheduler that sends the morning card and closes out the day.

Why a one-minute tick rather than a cron entry or a job queue: every person
picks their own send time in their own timezone, so the set of "who is due
right now" changes with each minute and with each daylight-saving transition.
A tick that asks "whose local clock reads their chosen time?" answers that
correctly by construction, needs no external process, and costs one indexed
query a minute.

Two properties this loop is built around:

  * Idempotence. `last_morning_date` / `last_evening_date` record which local
    day each message has already been sent for, so a restart, a slow tick or a
    clock that jumps backwards can't produce two cards for one day.

  * Catch-up, not replay. If the backend was down at 08:00 and comes back at
    09:30, the card is still sent — a reminder that arrives late is useful.
    But only within a window (default 3 hours); waking someone at 23:50 with
    their 08:00 list is not.
"""

from __future__ import annotations

import asyncio
import logging
import os
from datetime import date, datetime, timedelta

from .. import models
from . import config, service
from .delivery import close_out_day, refresh_card, run_db, send_daily_card

log = logging.getLogger("momentum.telegram")

TICK_SECONDS = 60


def _catch_up_minutes() -> int:
    try:
        return max(0, int(os.getenv("TELEGRAM_CATCHUP_MINUTES", "180")))
    except ValueError:
        return 180


def _minutes_since(now: datetime, hhmm: str) -> int | None:
    """How long ago today's `hhmm` was, in minutes. None if it hasn't
    happened yet today, or if the stored value is malformed."""
    try:
        hh, mm = hhmm.split(":")
        target = now.replace(hour=int(hh), minute=int(mm), second=0, microsecond=0)
    except (ValueError, AttributeError):
        return None
    if now < target:
        return None
    return int((now - target).total_seconds() // 60)


def evening_day_for(now: datetime) -> date:
    """The day an evening recap refers to. Stated once, here, because it is the
    one piece of date arithmetic in this module that isn't obvious: a recap
    firing before 04:00 local is closing out *yesterday*, not the four hours of
    today that have elapsed. Anyone who sets their recap to 00:30 means "at the
    end of my day", not "at the start of the next one"."""
    return now.date() - timedelta(days=1) if now.hour < 4 else now.date()


def _due_now() -> list[dict]:
    """Reads every active link and works out what each one is owed.

    Deliberately a single query returning plain dicts rather than ORM objects:
    the results are handed to coroutines that await network calls, and holding
    live ORM instances across those awaits is how sessions leak.
    """
    from ..database import SessionLocal
    db = SessionLocal()
    due: list[dict] = []
    window = _catch_up_minutes()
    try:
        links = db.query(models.TelegramLink).filter(
            models.TelegramLink.paused == False  # noqa: E712
        ).all()
        for link in links:
            now = service.now_local(link)
            today: date = now.date()

            # Close out the finishing day first, so the morning card that may
            # also be due in this same tick is built after any carry-over has
            # landed — otherwise a rolled-over task would be missing from the
            # list it was rolled over into.
            evening_age = _minutes_since(now, link.evening_time or "22:00")
            closing_day = evening_day_for(now)
            if (link.send_evening or link.carry_over_tasks) and evening_age is not None \
                    and evening_age <= window and link.last_evening_date != closing_day:
                due.append({"link_id": link.id, "kind": "evening", "day": closing_day})

            morning_age = _minutes_since(now, link.daily_time or "08:00")
            if morning_age is not None and morning_age <= window \
                    and link.last_morning_date != today:
                due.append({"link_id": link.id, "kind": "morning", "day": today})
    finally:
        db.close()
    return due


def _running_timer_cards() -> list[dict]:
    """Live cards that have a timer ticking on them.

    Only cards, not timers: a timer started in the browser has nothing to
    redraw, and a card that has already been closed out for the day must not be
    edited back to life. Both fall out of requiring an active_message_id.
    """
    from ..database import SessionLocal
    db = SessionLocal()
    try:
        rows = db.query(models.StudyTimer, models.TelegramLink).join(
            models.TelegramLink, models.TelegramLink.user_id == models.StudyTimer.user_id
        ).filter(
            models.TelegramLink.active_message_id.isnot(None),
            models.TelegramLink.paused == False,  # noqa: E712
        ).all()
        return [{
            "chat_id": link.chat_id,
            "message_id": link.active_message_id,
            "user_id": link.user_id,
            "day": link.active_message_date,
        } for _timer, link in rows if link.active_message_date]
    finally:
        db.close()


async def _tick_timers() -> None:
    """Redraw each card with a running timer, once a minute.

    Telegram rejects an edit whose content is identical to what is already
    there, but the elapsed line changes every minute by construction, so each
    of these is a real change. The client swallows that particular error
    anyway — see "message is not modified" in client.py.
    """
    for card in _running_timer_cards():
        try:
            await refresh_card(card["chat_id"], card["message_id"],
                               card["user_id"], card["day"])
        except Exception:
            log.debug("timer refresh failed for chat %s", card["chat_id"], exc_info=True)


def _job_hunt_due() -> dict:
    """user_id -> their local date, for everyone whose daily job search is due.

    Due means: their morning card time has passed today, and the search hasn't
    run for today's local date yet. Piggybacking on the morning time keeps new
    openings arriving with the rest of the day's list instead of at random.
    """
    from ..database import SessionLocal
    from ..jobhunt.daily import _due_searches

    db = SessionLocal()
    try:
        links = {l.user_id: l for l in db.query(models.TelegramLink).filter(
            models.TelegramLink.paused == False  # noqa: E712
        ).all()}
    finally:
        db.close()

    out: dict = {}
    for user_id, link in links.items():
        now = service.now_local(link)
        if _minutes_since(now, link.daily_time or "08:00") is None:
            continue
        out[user_id] = now.date()
    if not out:
        return {}
    # Filter to the ones that actually still owe a run, in one query.
    due_ids = set()
    for user_id, local_today in out.items():
        due_ids.update(uid for uid in _due_searches(local_today) if uid == user_id)
    return {uid: out[uid] for uid in due_ids}


async def _tick_job_hunt() -> None:
    try:
        due = await asyncio.to_thread(_job_hunt_due)
    except Exception:
        log.exception("telegram: job-hunt due check failed")
        return
    if not due:
        return
    from ..jobhunt import daily as job_hunt_daily
    await job_hunt_daily.tick(due)


async def _run_job(job: dict) -> None:
    try:
        if job["kind"] == "morning":
            await send_daily_card(job["link_id"], job["day"])
        else:
            await close_out_day(job["link_id"], job["day"])
    except Exception:
        log.exception("telegram: %s job failed for link %s", job["kind"], job["link_id"])


async def run_scheduler(stop_event: asyncio.Event) -> None:
    if not config.is_enabled():
        return

    log.info("telegram: scheduler started (tick %ss)", TICK_SECONDS)
    while not stop_event.is_set():
        try:
            await _tick_timers()
            jobs = await asyncio.to_thread(_due_now)
            for job in jobs:
                # Sequential rather than gathered: a burst of sends on the same
                # bot token is exactly what Telegram's flood control exists to
                # slow down, and the volume here is small enough that serial
                # delivery costs nothing.
                await _run_job(job)
                if stop_event.is_set():
                    break
            # After the cards, not before: the morning list is time-sensitive
            # and a job sweep can take half a minute of network waiting.
            await _tick_job_hunt()
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("telegram: scheduler tick failed")

        try:
            # Waiting on the stop event rather than sleeping flat means
            # shutdown is immediate instead of up to a minute late.
            await asyncio.wait_for(stop_event.wait(), timeout=TICK_SECONDS)
        except asyncio.TimeoutError:
            pass

    log.info("telegram: scheduler stopped")
