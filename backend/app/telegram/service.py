"""Database work behind the Telegram card.

Everything in here is deliberately plain SQLAlchemy against the tables the web
app already uses — there is no Telegram-specific copy of a habit or a task.
A tap in Telegram and a click in the browser land on the same row, which is
what makes "ticked on my phone this morning" still true when the dashboard is
opened that evening.

All functions take an explicit `day` (a date in the *user's* timezone) rather
than calling date.today() themselves. The server's idea of "today" is the wrong
one for anyone not sitting in the server's timezone, and it changes at the
wrong moment — 5:30am local for an Indian user on a UTC host.
"""

from __future__ import annotations

import re
import secrets
from datetime import date, datetime, timedelta
from typing import Optional

from sqlalchemy.orm import Session

from .. import models
from .config import default_timezone, link_code_ttl_minutes

try:  # Python 3.9+
    from zoneinfo import ZoneInfo
except ImportError:  # pragma: no cover - the app targets 3.11
    ZoneInfo = None  # type: ignore


# ---------------------------------------------------------------------------
# Timezone helpers
# ---------------------------------------------------------------------------

def tzinfo_for(name: str):
    """Never raises. An unknown or uninstalled timezone falls back to UTC —
    a reminder an hour off is a far better failure than a scheduler that dies
    on one bad row and stops sending to everybody."""
    if not name or ZoneInfo is None:
        return None
    try:
        return ZoneInfo(name)
    except Exception:
        return None


def now_local(link: "models.TelegramLink") -> datetime:
    tz = tzinfo_for(link.timezone or default_timezone())
    return datetime.now(tz) if tz else datetime.utcnow()


def today_local(link: "models.TelegramLink") -> date:
    return now_local(link).date()


def valid_timezone(name: str) -> bool:
    return tzinfo_for(name) is not None


def valid_hhmm(value: str) -> bool:
    return bool(re.fullmatch(r"([01]\d|2[0-3]):[0-5]\d", (value or "").strip()))


# ---------------------------------------------------------------------------
# Linking
# ---------------------------------------------------------------------------

def create_link_code(db: Session, user_id: int) -> models.TelegramLinkCode:
    """Issues a fresh single-use code and invalidates that user's outstanding
    ones, so a code left visible in an old browser tab stops working the moment
    a new one is generated."""
    db.query(models.TelegramLinkCode).filter(
        models.TelegramLinkCode.user_id == user_id,
        models.TelegramLinkCode.used_at.is_(None),
    ).update({"used_at": datetime.utcnow()}, synchronize_session=False)

    # token_urlsafe, not a 6-digit number: this code is the *only* thing
    # proving the Telegram chat belongs to the logged-in account, and a short
    # numeric code is guessable by anyone willing to message the bot in a loop.
    code = secrets.token_urlsafe(9).replace("-", "_")
    row = models.TelegramLinkCode(
        code=code,
        user_id=user_id,
        expires_at=datetime.utcnow() + timedelta(minutes=link_code_ttl_minutes()),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def redeem_link_code(db: Session, code: str, chat: dict, from_user: dict) -> Optional[models.TelegramLink]:
    """Binds a chat to the account that generated `code`. Returns None if the
    code is unknown, expired or already spent."""
    row = db.query(models.TelegramLinkCode).filter(
        models.TelegramLinkCode.code == (code or "").strip()
    ).first()
    if not row or row.used_at is not None or row.expires_at < datetime.utcnow():
        return None

    chat_id = str(chat.get("id"))

    # A chat can only ever point at one account. Re-linking the same chat to a
    # different account replaces the old binding rather than creating a second
    # row that would violate the unique constraint at flush time.
    existing_for_chat = db.query(models.TelegramLink).filter(
        models.TelegramLink.chat_id == chat_id
    ).first()
    link = db.query(models.TelegramLink).filter(
        models.TelegramLink.user_id == row.user_id
    ).first()
    if existing_for_chat and existing_for_chat is not link:
        db.delete(existing_for_chat)
        db.flush()

    if link is None:
        link = models.TelegramLink(user_id=row.user_id, chat_id=chat_id,
                                    timezone=default_timezone())
        db.add(link)
    link.chat_id = chat_id
    link.telegram_user_id = str(from_user.get("id") or "")
    link.username = from_user.get("username")
    link.first_name = from_user.get("first_name")
    link.paused = False
    link.linked_at = datetime.utcnow()
    link.last_interaction_at = datetime.utcnow()
    _stamp_schedule_on_link(link)

    row.used_at = datetime.utcnow()
    db.commit()
    db.refresh(link)
    return link


def _stamp_schedule_on_link(link: models.TelegramLink) -> None:
    """Mark the sends that are already in the past at the moment of linking.

    A new link starts with last_morning_date / last_evening_date unset, which
    the scheduler reads as "never sent, so it's owed one". Link up at 22:20 with
    the recap set to 22:00 and the very next tick closes out a day the link
    wasn't present for: the card is frozen and a summary arrives seconds after
    connecting, which reads as the integration breaking rather than working.

    Stamping only the sends whose time has already passed keeps the useful half
    of the behaviour. Connect at 06:00 with a 07:30 card and today's card still
    arrives on time, because 07:30 hasn't happened yet.

    Imported lazily: scheduler imports this module, so a module-level import
    here would be a cycle.
    """
    from .scheduler import _minutes_since, evening_day_for

    now = now_local(link)
    if _minutes_since(now, link.daily_time or "08:00") is not None:
        # /start already replies with today's card, so today's morning send is
        # accounted for either way.
        link.last_morning_date = now.date()

    evening = link.evening_time or "00:00"
    if _minutes_since(now, evening) is not None:
        # Stamp the day that the *already-passed* close-out would have covered,
        # which is not always the day it is now. With the default 00:00 close,
        # linking at 17:52 means today's midnight tick has passed — but that
        # tick closed yesterday. Stamping today's date instead would mark today
        # as already closed and silently swallow tonight's recap.
        hh, mm = evening.split(":")
        target = now.replace(hour=int(hh), minute=int(mm), second=0, microsecond=0)
        link.last_evening_date = evening_day_for(target)


def link_for_chat(db: Session, chat_id: str | int) -> Optional[models.TelegramLink]:
    return db.query(models.TelegramLink).filter(
        models.TelegramLink.chat_id == str(chat_id)
    ).first()


def link_for_user(db: Session, user_id: int) -> Optional[models.TelegramLink]:
    return db.query(models.TelegramLink).filter(
        models.TelegramLink.user_id == user_id
    ).first()


def unlink(db: Session, link: models.TelegramLink) -> None:
    db.delete(link)
    db.commit()


# ---------------------------------------------------------------------------
# Reading the day
# ---------------------------------------------------------------------------

def _minutes_between(start: str, end: str) -> int:
    def to_min(hhmm: str) -> int:
        try:
            h, m = (hhmm or "0:0").split(":")
            return int(h) * 60 + int(m)
        except (ValueError, AttributeError):
            return 0
    return max(0, to_min(end) - to_min(start))


def build_snapshot(db: Session, user_id: int, day: date) -> dict:
    """Everything the card needs for one date, in three queries.

    Rendering and the callback handler both go through here, so the message
    that gets edited after a tap is built from exactly the same shape as the
    one that was sent that morning — the two can't drift apart.
    """
    habits = db.query(models.Habit).filter(
        models.Habit.user_id == user_id,
        models.Habit.active == True,  # noqa: E712 — SQLAlchemy needs the comparison
    ).order_by(models.Habit.id).all()

    entries = {}
    if habits:
        rows = db.query(models.HabitEntry).filter(
            models.HabitEntry.habit_id.in_([h.id for h in habits]),
            models.HabitEntry.date == day,
        ).all()
        entries = {r.habit_id: bool(r.completed) for r in rows}

    tasks = db.query(models.Task).filter(
        models.Task.user_id == user_id,
        models.Task.date == day,
    ).order_by(models.Task.id).all()

    blocks = db.query(models.StudyBlock).filter(
        models.StudyBlock.user_id == user_id,
        models.StudyBlock.date == day,
    ).order_by(models.StudyBlock.start_time).all()

    sessions = db.query(models.StudySession).filter(
        models.StudySession.user_id == user_id,
        models.StudySession.date == day,
    ).all()

    habit_rows = [{"id": h.id, "title": h.title, "done": entries.get(h.id, False)} for h in habits]
    task_rows = [{"id": t.id, "title": t.title, "done": bool(t.completed)} for t in tasks]
    block_rows = [{
        "id": b.id,
        "subject": b.subject,
        "start": b.start_time,
        "end": b.end_time,
        "minutes": _minutes_between(b.start_time, b.end_time),
        "done": bool(b.completed),
    } for b in blocks]

    return {
        "date": day,
        "habits": habit_rows,
        "tasks": task_rows,
        "blocks": block_rows,
        "habits_done": sum(1 for h in habit_rows if h["done"]),
        "tasks_done": sum(1 for t in task_rows if t["done"]),
        "blocks_done": sum(1 for b in block_rows if b["done"]),
        "planned_minutes": sum(b["minutes"] for b in block_rows),
        "logged_minutes": sum(s.minutes or 0 for s in sessions),
        "streak": compute_streak(db, user_id, day),
        "timer": timer_state(db, user_id),
    }


# ---------------------------------------------------------------------------
# Study timer
# ---------------------------------------------------------------------------
# Elapsed minutes are computed from started_at on every read rather than
# counted up and stored. A stored counter has to be advanced by something, and
# whatever that something is — a tick, a request, a tap — will at some point
# not run, or run twice, and the number silently stops matching the clock.

def timer_state(db: Session, user_id: int) -> Optional[dict]:
    """The running timer as plain data, or None. Safe to call on every render."""
    row = db.query(models.StudyTimer).filter(
        models.StudyTimer.user_id == user_id
    ).first()
    if not row:
        return None
    return {
        "id": row.id,
        "block_id": row.block_id,
        "subject": row.subject,
        "started_at": row.started_at,
        "elapsed_minutes": elapsed_minutes(row),
        "source": row.source,
    }


def elapsed_minutes(row: "models.StudyTimer") -> int:
    seconds = (datetime.utcnow() - row.started_at).total_seconds()
    return max(0, int(seconds // 60))


def start_timer(db: Session, user_id: int, block_id: int | None = None,
                subject: str | None = None, source: str = "app",
                chat_id: str | None = None) -> dict:
    """Starts a timer, stopping any already-running one first.

    Stopping rather than refusing: someone who taps start on a second subject
    has moved on to it, and an error message telling them to go and stop the
    old one first is a worse answer than doing the obvious thing. The minutes
    up to that point are still logged, so nothing is lost.
    """
    # Validate before stopping anything. The other order looks harmless but
    # means a start that fails — a stale block id from a card left open since
    # yesterday — silently ends the timer that was already running, and the
    # error message says nothing about the hour you just lost.
    if block_id is not None:
        block = db.query(models.StudyBlock).filter(
            models.StudyBlock.id == block_id,
            models.StudyBlock.user_id == user_id,
        ).first()
        if not block:
            raise ValueError("That study block doesn't exist.")
        subject = subject or block.subject

    previous = db.query(models.StudyTimer).filter(
        models.StudyTimer.user_id == user_id
    ).first()
    if previous:
        stop_timer(db, user_id)

    row = models.StudyTimer(
        user_id=user_id, block_id=block_id,
        subject=(subject or "").strip()[:200] or None,
        started_at=datetime.utcnow(), source=source, chat_id=chat_id,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return timer_state(db, user_id)


def stop_timer(db: Session, user_id: int, day: date | None = None,
               discard: bool = False) -> Optional[dict]:
    """Stops the timer and writes the elapsed minutes as a real session.

    Returns what was logged, or None if nothing was running — a stop with no
    timer is a duplicate tap, not an error.

    `discard` throws the elapsed time away instead of logging it, for the timer
    you left running through lunch. It is a separate argument rather than a
    separate function so there is exactly one place that knows how to end a
    timer, and no way to end one while forgetting to delete the row.
    """
    row = db.query(models.StudyTimer).filter(
        models.StudyTimer.user_id == user_id
    ).first()
    if not row:
        return None

    minutes = elapsed_minutes(row)
    subject, block_id, started = row.subject, row.block_id, row.started_at

    if discard:
        db.delete(row)
        db.commit()
        return {"minutes": 0, "subject": subject, "block_id": block_id,
                "logged": False, "discarded": True}

    # The day a session belongs to is the day it *started*, not the day it
    # ended. A stretch from 23:40 to 00:20 is one late night, and splitting it
    # across two dates would break the streak of whichever side lost.
    if day is None:
        day = started.date()

    db.delete(row)

    if minutes < 1:
        # Under a minute is a mis-tap, not a study session. Deleting the timer
        # without logging keeps the total honest.
        db.commit()
        return {"minutes": 0, "subject": subject, "block_id": block_id, "logged": False}

    if block_id is not None:
        block = db.query(models.StudyBlock).filter(models.StudyBlock.id == block_id).first()
        if block:
            day = block.date
            block.completed = True
            # One session per block, same rule toggle_study_block follows, so
            # timing a block twice corrects the figure instead of doubling it.
            existing = db.query(models.StudySession).filter(
                models.StudySession.block_id == block.id
            ).first()
            if existing:
                existing.minutes = minutes
                existing.date = day
                existing.source = "timer"
                db.commit()
                return {"minutes": minutes, "subject": subject, "block_id": block_id, "logged": True}

    db.add(models.StudySession(
        user_id=user_id, date=day, minutes=minutes,
        subject=subject, block_id=block_id, source="timer",
    ))
    db.commit()
    return {"minutes": minutes, "subject": subject, "block_id": block_id, "logged": True}


def compute_streak(db: Session, user_id: int, day: date, max_days: int = 400) -> int:
    """Consecutive days, counting back from `day`, on which at least one habit
    was ticked.

    Today is allowed to be empty without breaking the streak — the card is sent
    in the morning, and a counter that reads zero until the first tick would
    punish people for the crime of having just woken up. It simply doesn't
    count yet.
    """
    rows = db.query(models.HabitEntry.date).join(
        models.Habit, models.Habit.id == models.HabitEntry.habit_id
    ).filter(
        models.Habit.user_id == user_id,
        models.HabitEntry.completed == True,  # noqa: E712
        models.HabitEntry.date <= day,
        models.HabitEntry.date > day - timedelta(days=max_days),
    ).distinct().all()
    done_days = {r[0] for r in rows}

    streak = 0
    cursor = day
    if cursor not in done_days:      # nothing ticked yet today — start from yesterday
        cursor -= timedelta(days=1)
    while cursor in done_days:
        streak += 1
        cursor -= timedelta(days=1)
    return streak


def week_stats(db: Session, user_id: int, day: date) -> dict:
    """Rolling seven days ending on `day` — habit ticks, tasks finished and
    minutes studied."""
    start = day - timedelta(days=6)
    habit_done = db.query(models.HabitEntry).join(
        models.Habit, models.Habit.id == models.HabitEntry.habit_id
    ).filter(
        models.Habit.user_id == user_id,
        models.HabitEntry.completed == True,  # noqa: E712
        models.HabitEntry.date >= start, models.HabitEntry.date <= day,
    ).count()
    active_habits = db.query(models.Habit).filter(
        models.Habit.user_id == user_id, models.Habit.active == True,  # noqa: E712
    ).count()
    tasks_total = db.query(models.Task).filter(
        models.Task.user_id == user_id,
        models.Task.date >= start, models.Task.date <= day,
    ).count()
    tasks_done = db.query(models.Task).filter(
        models.Task.user_id == user_id, models.Task.completed == True,  # noqa: E712
        models.Task.date >= start, models.Task.date <= day,
    ).count()
    minutes = sum(s.minutes or 0 for s in db.query(models.StudySession).filter(
        models.StudySession.user_id == user_id,
        models.StudySession.date >= start, models.StudySession.date <= day,
    ).all())
    possible = active_habits * 7
    return {
        "start": start, "end": day,
        "habit_done": habit_done,
        "habit_possible": possible,
        "habit_pct": round(habit_done / possible * 100) if possible else 0,
        "tasks_done": tasks_done, "tasks_total": tasks_total,
        "minutes": minutes,
        "streak": compute_streak(db, user_id, day),
    }


# ---------------------------------------------------------------------------
# Writing the day
# ---------------------------------------------------------------------------

def toggle_habit(db: Session, user_id: int, habit_id: int, day: date) -> Optional[bool]:
    habit = db.query(models.Habit).filter(
        models.Habit.id == habit_id, models.Habit.user_id == user_id
    ).first()
    if not habit:
        return None
    entry = db.query(models.HabitEntry).filter(
        models.HabitEntry.habit_id == habit.id, models.HabitEntry.date == day
    ).first()
    if entry:
        entry.completed = not entry.completed
        entry.completed_at = datetime.utcnow() if entry.completed else None
    else:
        entry = models.HabitEntry(habit_id=habit.id, date=day, completed=True,
                                   completed_at=datetime.utcnow())
        db.add(entry)
    db.commit()
    return bool(entry.completed)


def toggle_task(db: Session, user_id: int, task_id: int) -> Optional[bool]:
    task = db.query(models.Task).filter(
        models.Task.id == task_id, models.Task.user_id == user_id
    ).first()
    if not task:
        return None
    task.completed = not task.completed
    task.completed_at = datetime.utcnow() if task.completed else None
    db.commit()
    return bool(task.completed)


def toggle_study_block(db: Session, user_id: int, block_id: int, day: date,
                        source: str = "telegram") -> Optional[bool]:
    """Marking a block done also logs its planned length as studied minutes;
    un-marking it removes that log entry.

    Keeping the two in step here rather than at each call site is what stops
    the daily total from creeping upward every time somebody taps a checkbox
    twice.
    """
    block = db.query(models.StudyBlock).filter(
        models.StudyBlock.id == block_id, models.StudyBlock.user_id == user_id
    ).first()
    if not block:
        return None
    block.completed = not block.completed

    existing = db.query(models.StudySession).filter(
        models.StudySession.block_id == block.id
    ).first()
    if block.completed:
        minutes = _minutes_between(block.start_time, block.end_time)
        if existing:
            existing.minutes = minutes
            existing.date = block.date
        else:
            db.add(models.StudySession(
                user_id=user_id, date=block.date, minutes=minutes,
                subject=block.subject, block_id=block.id, source=source,
            ))
    elif existing:
        db.delete(existing)
    db.commit()
    return bool(block.completed)


def log_study_minutes(db: Session, user_id: int, day: date, minutes: int,
                       subject: str | None = None, source: str = "telegram") -> models.StudySession:
    row = models.StudySession(user_id=user_id, date=day, minutes=max(0, int(minutes)),
                               subject=(subject or "").strip() or None, source=source)
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def add_task(db: Session, user_id: int, day: date, title: str) -> Optional[models.Task]:
    title = (title or "").strip()
    if not title:
        return None
    task = models.Task(user_id=user_id, date=day, title=title[:300])
    db.add(task)
    db.commit()
    db.refresh(task)
    return task


def complete_day(db: Session, user_id: int, day: date) -> dict:
    """The "Complete for Today" button: ticks everything still outstanding."""
    snap = build_snapshot(db, user_id, day)
    for h in snap["habits"]:
        if not h["done"]:
            toggle_habit(db, user_id, h["id"], day)
    for t in snap["tasks"]:
        if not t["done"]:
            toggle_task(db, user_id, t["id"])
    for b in snap["blocks"]:
        if not b["done"]:
            toggle_study_block(db, user_id, b["id"], day)
    return build_snapshot(db, user_id, day)


def carry_over_tasks(db: Session, user_id: int, from_day: date, to_day: date) -> int:
    """Moves unfinished tasks forward a day at close of business.

    Copies rather than re-dates, so yesterday genuinely records what was left
    undone — re-dating the row would quietly rewrite history and make every
    past day look complete. Titles already present on the target day are
    skipped, since tasks are unique per (user, day, title).
    """
    leftovers = db.query(models.Task).filter(
        models.Task.user_id == user_id,
        models.Task.date == from_day,
        models.Task.completed == False,  # noqa: E712
    ).all()
    if not leftovers:
        return 0
    existing = {
        (t.title or "").strip().lower()
        for t in db.query(models.Task).filter(
            models.Task.user_id == user_id, models.Task.date == to_day
        ).all()
    }
    moved = 0
    for t in leftovers:
        key = (t.title or "").strip().lower()
        if key in existing:
            continue
        db.add(models.Task(user_id=user_id, date=to_day, title=t.title,
                            notes=t.notes, tags=t.tags))
        existing.add(key)
        moved += 1
    if moved:
        db.commit()
    return moved
