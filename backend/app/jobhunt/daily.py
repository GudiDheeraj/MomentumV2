"""The once-a-day sweep of everyone's saved search.

Hangs off the Telegram scheduler's existing minute tick rather than adding a
second scheduler. The tick is already there, already knows each person's local
timezone, and already survives restarts; a second loop would be a second thing
to get the timezone wrong in.

Runs at the same local hour as the morning card, on the reasoning that new
openings are worth reading at the same moment as the rest of the day's list,
and that one message beats two.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import date, datetime

from .. import models
from . import search as search_engine

log = logging.getLogger("momentum.jobhunt")

# How many postings to name in the message. Past this it stops being something
# read on a phone and becomes something to open the app for.
MAX_IN_MESSAGE = 8


def _due_searches(today: date) -> list[int]:
    """User ids whose search hasn't run yet today.

    Date-based rather than "hours since last run" so a restart can't cause a
    second sweep, and so the run lands once per calendar day regardless of when
    the backend happened to be up.
    """
    from ..database import SessionLocal
    db = SessionLocal()
    try:
        rows = db.query(models.JobSearch).filter(
            models.JobSearch.auto_daily == True,  # noqa: E712
            models.JobSearch.roles.isnot(None),
        ).all()
        return [r.user_id for r in rows
                if (r.roles or "").strip()
                and (r.last_run_at is None or r.last_run_at.date() < today)]
    finally:
        db.close()


def _run_for_user(user_id: int) -> dict | None:
    """Blocking: HTTP fetches and database writes. Called via a thread."""
    from ..database import SessionLocal
    db = SessionLocal()
    try:
        search = db.query(models.JobSearch).filter(
            models.JobSearch.user_id == user_id
        ).first()
        if not search:
            return None
        summary = search_engine.run_search(db, user_id, search)
        if not summary["new"] or not search.notify_telegram:
            return None

        link = db.query(models.TelegramLink).filter(
            models.TelegramLink.user_id == user_id,
            models.TelegramLink.paused == False,  # noqa: E712
        ).first()
        if not link:
            return None

        hits = db.query(models.JobHit).filter(
            models.JobHit.user_id == user_id,
            models.JobHit.notified == False,  # noqa: E712
            models.JobHit.status == "new",
        ).order_by(models.JobHit.posted_at.desc()).all()
        if not hits:
            return None

        referrals = search_engine.referral_map(db, user_id)
        payload = {
            "chat_id": link.chat_id,
            "total": len(hits),
            "jobs": [{
                "company": h.company,
                "title": h.title,
                "location": h.location,
                "url": h.url,
                "referrals": referrals.get((h.company or "").strip().lower(), []),
            } for h in hits[:MAX_IN_MESSAGE]],
        }
        # Marked before the send rather than after. A message that fails to
        # deliver costs one morning's alert; a crash between send and mark
        # would repeat the same jobs every day until someone noticed.
        for h in hits:
            h.notified = True
        db.commit()
        return payload
    finally:
        db.close()


def render_message(payload: dict) -> str:
    lines = [f"💼 <b>{payload['total']} new job"
             f"{'' if payload['total'] == 1 else 's'}</b> matching your search", ""]
    for j in payload["jobs"]:
        title = j["title"]
        line = f"• <b>{_esc(j['company'])}</b> — {_esc(title)}"
        if j.get("location"):
            line += f"\n  📍 {_esc(j['location'])}"
        if j.get("url"):
            line += f"\n  <a href=\"{_esc(j['url'])}\">Open posting</a>"
        if j.get("referrals"):
            names = ", ".join(r["name"] for r in j["referrals"][:3])
            # The whole reason referral contacts exist: a job at a company
            # where you know somebody is a different proposition to a cold
            # application, and that has to be visible at the moment you read it.
            line += f"\n  🤝 You know {_esc(names)} here"
        lines.append(line)
    remaining = payload["total"] - len(payload["jobs"])
    if remaining > 0:
        lines.append(f"\n<i>+{remaining} more in the app.</i>")
    return "\n".join(lines)


def _esc(s) -> str:
    return (str(s or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"))


async def tick(today_by_user: dict[int, date]) -> None:
    """One sweep. `today_by_user` maps user id -> their local date, worked out
    by the caller, which is the part that knows about timezones."""
    from ..telegram import client

    for user_id, local_today in today_by_user.items():
        try:
            payload = await asyncio.to_thread(_run_for_user, user_id)
            if not payload:
                continue
            await client.send_message(payload["chat_id"], render_message(payload))
            log.info("jobhunt: told user %s about %s new jobs", user_id, payload["total"])
        except Exception:
            log.exception("jobhunt: daily run failed for user %s", user_id)
