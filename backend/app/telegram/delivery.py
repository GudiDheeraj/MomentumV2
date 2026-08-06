"""Sending, refreshing and closing out the daily card.

Shared by all three entry points — the polling loop, the scheduler, and the
"Send now" button in the web app — so there is exactly one definition of what a
card is and when it gets replaced.

Every database touch goes through `run_db`, which opens a session on a worker
thread. The bot and scheduler are coroutines living on the same event loop that
serves HTTP, and SQLAlchemy is synchronous; calling it inline would let one
slow query stall every in-flight request in the process.
"""

from __future__ import annotations

import asyncio
import logging
import os
from datetime import date, timedelta
from typing import Callable, TypeVar

from ..database import SessionLocal
from . import client, render, service
from .. import models

log = logging.getLogger("momentum.telegram")

T = TypeVar("T")


async def run_db(fn: Callable[..., T]) -> T:
    """Runs `fn(session)` on a worker thread with a fresh session."""
    def _work():
        db = SessionLocal()
        try:
            return fn(db)
        finally:
            db.close()
    return await asyncio.to_thread(_work)


def app_url() -> str | None:
    """Deep link back into the web app, shown as a button on the card.

    Falls back to FRONTEND_URL so the usual case needs no second variable;
    APP_PUBLIC_URL is only for when the public address differs from the one the
    frontend is served on (reverse proxy, separate domain).

    https is required, and not merely preferred: Telegram rejects a URL button
    pointing at plain http, and a localhost link is worse than no button at all
    on somebody's phone. So on a local setup this correctly returns None.
    """
    url = (os.getenv("APP_PUBLIC_URL") or "").strip().rstrip("/")
    if not url:
        url = (os.getenv("FRONTEND_URL") or "").strip().rstrip("/")
    return url if url.startswith("https://") else None


async def _strip_buttons(chat_id: str, message_id: str | int, snap: dict) -> None:
    """Turns a card that is no longer current into plain text.

    Without this, an old card stays tappable forever: someone scrolling up
    three days later taps a checkbox and silently rewrites Tuesday.
    """
    try:
        await client.edit_message(chat_id, message_id, render.frozen_card(snap), keyboard=[])
    except client.TelegramError as e:
        log.debug("couldn't freeze old card (%s) — ignoring", e)


async def send_daily_card(link_id: int, day: date | None = None,
                           silent: bool = False) -> bool:
    """Sends today's card, freezing whatever card was live before it.

    Takes a link *id* rather than an ORM object on purpose: the object would
    have been loaded on a different session, and this function spans several
    awaits during which that session must not be held open.
    """
    def _load(db):
        link = db.query(models.TelegramLink).get(link_id)
        if not link:
            return None
        target = day or service.today_local(link)
        return {
            "chat_id": link.chat_id,
            "day": target,
            "prev_id": link.active_message_id,
            "prev_day": link.active_message_date,
            "name": link.first_name,
            "snapshot": service.build_snapshot(db, link.user_id, target),
            "prev_snapshot": (
                service.build_snapshot(db, link.user_id, link.active_message_date)
                if link.active_message_id and link.active_message_date else None
            ),
        }

    ctx = await run_db(_load)
    if not ctx:
        return False

    if ctx["prev_id"] and ctx["prev_snapshot"] is not None and ctx["prev_day"] != ctx["day"]:
        await _strip_buttons(ctx["chat_id"], ctx["prev_id"], ctx["prev_snapshot"])

    text, keyboard = render.daily_card(ctx["snapshot"], ctx["name"], app_url())
    try:
        sent = await client.send_message(ctx["chat_id"], text, keyboard,
                                          disable_notification=silent)
    except client.TelegramError as e:
        if e.is_blocked_by_user:
            log.info("telegram link %s blocked the bot — pausing reminders", link_id)
            await run_db(lambda db: _pause(db, link_id))
            return False
        log.warning("failed to send daily card for link %s: %s", link_id, e)
        return False

    message_id = str((sent or {}).get("message_id") or "")

    def _record(db):
        link = db.query(models.TelegramLink).get(link_id)
        if not link:
            return
        link.active_message_id = message_id
        link.active_message_date = ctx["day"]
        if ctx["day"] == service.today_local(link):
            link.last_morning_date = ctx["day"]
        db.commit()

    await run_db(_record)
    return True


def _pause(db, link_id: int) -> None:
    link = db.query(models.TelegramLink).get(link_id)
    if link:
        link.paused = True
        db.commit()


async def refresh_card(chat_id: str, message_id: str | int, user_id: int, day: date) -> dict:
    """Re-renders a live card in place from current database state."""
    snap = await run_db(lambda db: service.build_snapshot(db, user_id, day))
    text, keyboard = render.daily_card(snap, None, app_url())
    try:
        await client.edit_message(chat_id, message_id, text, keyboard)
    except client.TelegramError as e:
        log.debug("card refresh skipped: %s", e)
    return snap


async def close_out_day(link_id: int, day: date) -> bool:
    """End of day: freeze the card, send the recap, roll unfinished tasks over.

    Ordered that way deliberately — the recap reports how many tasks moved, so
    the carry-over has to happen before the message is composed, and the card
    has to stop being tappable before either, so nothing can change underneath
    the summary that has just been sent.
    """
    def _prepare(db):
        link = db.query(models.TelegramLink).get(link_id)
        if not link:
            return None
        snap = service.build_snapshot(db, link.user_id, day)
        carried = 0
        if link.carry_over_tasks:
            carried = service.carry_over_tasks(db, link.user_id, day, day + timedelta(days=1))
        return {
            "chat_id": link.chat_id,
            "message_id": link.active_message_id,
            "message_date": link.active_message_date,
            "send_evening": bool(link.send_evening),
            "snapshot": snap,
            "carried": carried,
        }

    ctx = await run_db(_prepare)
    if not ctx:
        return False

    if ctx["message_id"] and ctx["message_date"] == day:
        await _strip_buttons(ctx["chat_id"], ctx["message_id"], ctx["snapshot"])

    if ctx["send_evening"]:
        text, keyboard = render.evening_recap(ctx["snapshot"], ctx["carried"], app_url())
        try:
            await client.send_message(ctx["chat_id"], text, keyboard or None)
        except client.TelegramError as e:
            log.warning("evening recap failed for link %s: %s", link_id, e)

    def _record(db):
        link = db.query(models.TelegramLink).get(link_id)
        if not link:
            return
        link.last_evening_date = day
        # The card for this day is finished with; a tap on it now would be a
        # tap on history, so it stops being "the live card".
        if link.active_message_date == day:
            link.active_message_id = None
            link.active_message_date = None
        db.commit()

    await run_db(_record)
    return True
