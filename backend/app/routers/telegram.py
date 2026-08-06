"""REST surface for the Telegram integration.

The browser never talks to Telegram directly — it asks this router for a
one-time link code and shows the resulting `t.me` deep link. That keeps the bot
token server-side (a token in a frontend bundle is a token anyone can use to
read every linked chat) and makes the account binding provable: the code is
issued to an authenticated session and can only be spent once.
"""

from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import models, schemas
from ..auth import get_current_user
from ..database import get_db
from ..telegram import config as tg_config
from ..telegram import delivery, service

router = APIRouter(prefix="/api/telegram", tags=["telegram"])


def _status_payload(db: Session, user: models.User) -> dict:
    link = service.link_for_user(db, user.id)
    payload = {
        "configured": tg_config.is_configured(),
        "enabled": tg_config.is_enabled(),
        "bot_username": tg_config.bot_username(),
        "linked": link is not None,
        "default_timezone": tg_config.default_timezone(),
    }
    if link:
        now = service.now_local(link)
        payload.update({
            "username": link.username,
            "first_name": link.first_name,
            "chat_id": link.chat_id,
            "timezone": link.timezone,
            "daily_time": link.daily_time,
            "evening_time": link.evening_time,
            "send_evening": bool(link.send_evening),
            "carry_over_tasks": bool(link.carry_over_tasks),
            "close_when_done": bool(link.close_when_done),
            "paused": bool(link.paused),
            "linked_at": link.linked_at,
            "last_morning_date": link.last_morning_date,
            "local_time": now.strftime("%H:%M"),
            "local_date": now.date(),
        })
    return payload


@router.get("/status", response_model=schemas.TelegramStatus)
def status(db: Session = Depends(get_db),
           current_user: models.User = Depends(get_current_user)):
    return _status_payload(db, current_user)


@router.post("/link-code", response_model=schemas.TelegramLinkCodeOut)
def create_link_code(db: Session = Depends(get_db),
                     current_user: models.User = Depends(get_current_user)):
    if not tg_config.is_configured():
        raise HTTPException(
            503,
            "Telegram isn't set up on this server yet. Add TELEGRAM_BOT_TOKEN to "
            "your .env and restart the backend.",
        )
    row = service.create_link_code(db, current_user.id)
    bot = tg_config.bot_username()
    return {
        "code": row.code,
        "expires_at": row.expires_at,
        "expires_in_seconds": max(0, int((row.expires_at - datetime.utcnow()).total_seconds())),
        "bot_username": bot,
        # The deep link is the whole point: tapping it opens Telegram with the
        # code already in the message box, so nobody has to copy a token
        # between two apps on a phone.
        "deep_link": f"https://t.me/{bot}?start={row.code}" if bot else None,
    }


@router.delete("/link")
def unlink(db: Session = Depends(get_db),
           current_user: models.User = Depends(get_current_user)):
    link = service.link_for_user(db, current_user.id)
    if not link:
        raise HTTPException(404, "No Telegram chat is connected to this account.")
    service.unlink(db, link)
    return {"ok": True}


@router.put("/settings", response_model=schemas.TelegramStatus)
def update_settings(payload: schemas.TelegramSettingsUpdate,
                    db: Session = Depends(get_db),
                    current_user: models.User = Depends(get_current_user)):
    link = service.link_for_user(db, current_user.id)
    if not link:
        raise HTTPException(404, "Connect a Telegram chat first.")

    data = payload.model_dump(exclude_unset=True)

    for field in ("daily_time", "evening_time"):
        if field in data and not service.valid_hhmm(data[field]):
            raise HTTPException(422, f"{field.replace('_', ' ')} must look like 07:30.")
    if "timezone" in data and not service.valid_timezone(data["timezone"]):
        raise HTTPException(422, f"'{data['timezone']}' isn't a timezone I recognise. "
                                  "Use an IANA name such as Asia/Kolkata.")

    for field, value in data.items():
        setattr(link, field, value)
    db.commit()
    db.refresh(link)
    return _status_payload(db, current_user)


@router.post("/send-now")
async def send_now(db: Session = Depends(get_db),
                   current_user: models.User = Depends(get_current_user)):
    """Sends today's card immediately — the "does this actually work" button.

    It deliberately does *not* set last_morning_date, so using it at 3pm
    doesn't cancel tomorrow morning's scheduled send.
    """
    link = service.link_for_user(db, current_user.id)
    if not link:
        raise HTTPException(404, "Connect a Telegram chat first.")
    if not tg_config.is_enabled():
        raise HTTPException(503, "Telegram delivery is switched off on this server.")

    link_id, day = link.id, service.today_local(link)
    db.close()  # the send spans network calls; don't hold this request's session open

    ok = await delivery.send_daily_card(link_id, day)
    if not ok:
        raise HTTPException(
            502,
            "Telegram wouldn't accept the message. If you blocked the bot, unblock "
            "it and send /start in the chat, then try again.",
        )
    return {"ok": True, "date": day}


@router.post("/close-day")
async def close_day(db: Session = Depends(get_db),
                    current_user: models.User = Depends(get_current_user)):
    """Runs the end-of-day step now: freezes today's card, sends the recap and
    rolls unfinished tasks forward. Mostly here so the behaviour can be seen
    without waiting until 22:00."""
    link = service.link_for_user(db, current_user.id)
    if not link:
        raise HTTPException(404, "Connect a Telegram chat first.")
    link_id, day = link.id, service.today_local(link)
    db.close()
    await delivery.close_out_day(link_id, day)
    return {"ok": True, "date": day}


@router.get("/preview", response_model=schemas.TelegramPreview)
def preview(db: Session = Depends(get_db),
            current_user: models.User = Depends(get_current_user)):
    """What the card would say right now, as text — so the settings page can
    show a live preview before anyone connects a chat."""
    from ..telegram import render

    link = service.link_for_user(db, current_user.id)
    day = service.today_local(link) if link else datetime.utcnow().date()
    snap = service.build_snapshot(db, current_user.id, day)
    text, keyboard = render.daily_card(snap, current_user.name, delivery.app_url())
    return {
        "date": day,
        "text": text,
        "buttons": [[b["text"] for b in row] for row in keyboard],
        "totals": {
            "habits": len(snap["habits"]), "habits_done": snap["habits_done"],
            "tasks": len(snap["tasks"]), "tasks_done": snap["tasks_done"],
            "blocks": len(snap["blocks"]), "blocks_done": snap["blocks_done"],
            "logged_minutes": snap["logged_minutes"],
            "planned_minutes": snap["planned_minutes"],
            "streak": snap["streak"],
        },
    }
