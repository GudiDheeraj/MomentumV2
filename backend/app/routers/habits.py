from datetime import date, datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from .. import models, schemas
from ..auth import get_current_user
from ..database import get_db

router = APIRouter(prefix="/api/habits", tags=["habits"])

DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]


def _find_duplicate_habit(db: Session, user_id: int, title: str, exclude_id: int | None = None):
    """A habit is a duplicate if the same user already has one with the same
    title, compared case-insensitively and ignoring surrounding whitespace so
    'Gym', 'gym ' and ' GYM' all count as the same habit."""
    q = db.query(models.Habit).filter(
        models.Habit.user_id == user_id,
        func.lower(func.trim(models.Habit.title)) == title.strip().lower(),
    )
    if exclude_id is not None:
        q = q.filter(models.Habit.id != exclude_id)
    return q.first()


@router.post("", response_model=schemas.HabitOut)
def create_habit(payload: schemas.HabitCreate, db: Session = Depends(get_db),
                  current_user: models.User = Depends(get_current_user)):
    title = (payload.title or "").strip()
    if not title:
        raise HTTPException(422, "Habit name can't be empty.")
    existing = _find_duplicate_habit(db, current_user.id, title)
    if existing:
        raise HTTPException(409, f'You already have a habit called "{existing.title}".')
    habit = models.Habit(user_id=current_user.id, title=title, category=payload.category)
    db.add(habit)
    db.commit()
    db.refresh(habit)
    return habit


@router.get("")
def list_habits(active: Optional[bool] = None, week_start: Optional[date] = None, db: Session = Depends(get_db),
                 current_user: models.User = Depends(get_current_user)):
    q = db.query(models.Habit).filter(models.Habit.user_id == current_user.id)
    if active is not None:
        q = q.filter(models.Habit.active == active)
    habits = q.order_by(models.Habit.id).all()

    if week_start is None:
        return [schemas.HabitOut.model_validate(h) for h in habits]

    week_end = week_start + timedelta(days=6)

    # One query for every habit's week, not one query per habit. This loop used
    # to issue a round trip per habit, so the cost of loading the habits page
    # grew linearly with how many habits someone tracks — the customers with
    # the most in here were the ones waiting longest, which is exactly backwards.
    # A week of entries for every habit is a few dozen rows; fetching them
    # together and grouping in memory is one query regardless of habit count.
    all_entries = db.query(models.HabitEntry).filter(
        models.HabitEntry.habit_id.in_([h.id for h in habits]),
        models.HabitEntry.date >= week_start,
        models.HabitEntry.date <= week_end,
    ).all() if habits else []
    by_habit: dict[int, dict] = {}
    for e in all_entries:
        by_habit.setdefault(e.habit_id, {})[e.date] = e.completed

    result = []
    for h in habits:
        entry_map = by_habit.get(h.id, {})
        week = {}
        completed_count = 0
        for i, label in enumerate(DAY_LABELS):
            d = week_start + timedelta(days=i)
            done = entry_map.get(d, False)
            week[label] = done
            if done:
                completed_count += 1
        result.append(schemas.HabitWithProgress(
            id=h.id, title=h.title, category=h.category, active=h.active,
            week=week, progress_pct=round(completed_count / 7 * 100, 1)
        ))
    return result


def _get_owned_habit(db: Session, habit_id: int, user_id: int) -> models.Habit:
    habit = db.query(models.Habit).filter(models.Habit.id == habit_id, models.Habit.user_id == user_id).first()
    if not habit:
        raise HTTPException(404, "Habit not found")
    return habit


@router.patch("/{habit_id}", response_model=schemas.HabitOut)
def update_habit(habit_id: int, payload: schemas.HabitUpdate, db: Session = Depends(get_db),
                  current_user: models.User = Depends(get_current_user)):
    habit = _get_owned_habit(db, habit_id, current_user.id)
    data = payload.model_dump(exclude_unset=True)
    if "title" in data:
        new_title = (data["title"] or "").strip()
        if not new_title:
            raise HTTPException(422, "Habit name can't be empty.")
        dup = _find_duplicate_habit(db, current_user.id, new_title, exclude_id=habit_id)
        if dup:
            raise HTTPException(409, f'Another habit is already called "{dup.title}".')
        data["title"] = new_title
    for field, value in data.items():
        setattr(habit, field, value)
    db.commit()
    db.refresh(habit)
    return habit


@router.delete("/{habit_id}")
def delete_habit(habit_id: int, db: Session = Depends(get_db),
                  current_user: models.User = Depends(get_current_user)):
    habit = _get_owned_habit(db, habit_id, current_user.id)
    db.delete(habit)
    db.commit()
    return {"ok": True}


@router.post("/{habit_id}/toggle")
def toggle_habit(habit_id: int, for_date: date, db: Session = Depends(get_db),
                  current_user: models.User = Depends(get_current_user)):
    habit = _get_owned_habit(db, habit_id, current_user.id)
    entry = db.query(models.HabitEntry).filter(
        models.HabitEntry.habit_id == habit.id,
        models.HabitEntry.date == for_date,
    ).first()
    if entry:
        entry.completed = not entry.completed
        entry.completed_at = datetime.utcnow() if entry.completed else None
    else:
        entry = models.HabitEntry(habit_id=habit.id, date=for_date, completed=True, completed_at=datetime.utcnow())
        db.add(entry)
    db.commit()
    db.refresh(entry)
    return schemas.HabitEntryOut.model_validate(entry)
