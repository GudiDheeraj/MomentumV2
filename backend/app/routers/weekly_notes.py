from datetime import date

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from .. import models, schemas
from ..auth import get_current_user
from ..database import get_db

router = APIRouter(prefix="/api/weekly-notes", tags=["weekly-notes"])


@router.get("/{week_start_date}", response_model=schemas.WeeklyNoteOut)
def get_weekly_note(week_start_date: date, db: Session = Depends(get_db),
                     current_user: models.User = Depends(get_current_user)):
    note = db.query(models.WeeklyNote).filter(
        models.WeeklyNote.week_start_date == week_start_date,
        models.WeeklyNote.user_id == current_user.id,
    ).first()
    if not note:
        note = models.WeeklyNote(user_id=current_user.id, week_start_date=week_start_date,
                                  focus_text="", reward_text="", affirmation_text="")
        db.add(note)
        db.commit()
        db.refresh(note)
    return note


@router.put("/{week_start_date}", response_model=schemas.WeeklyNoteOut)
def upsert_weekly_note(week_start_date: date, payload: schemas.WeeklyNoteUpdate, db: Session = Depends(get_db),
                        current_user: models.User = Depends(get_current_user)):
    note = db.query(models.WeeklyNote).filter(
        models.WeeklyNote.week_start_date == week_start_date,
        models.WeeklyNote.user_id == current_user.id,
    ).first()
    if not note:
        note = models.WeeklyNote(user_id=current_user.id, week_start_date=week_start_date,
                                  focus_text="", reward_text="", affirmation_text="")
        db.add(note)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(note, field, value)
    db.commit()
    db.refresh(note)
    return note
