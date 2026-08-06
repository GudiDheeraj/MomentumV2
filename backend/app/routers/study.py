from datetime import date, datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import models, schemas
from ..auth import get_current_user
from ..database import get_db

router = APIRouter(prefix="/api/study-blocks", tags=["study-plan"])


@router.post("", response_model=schemas.StudyBlockOut)
def create_block(payload: schemas.StudyBlockCreate, db: Session = Depends(get_db),
                  current_user: models.User = Depends(get_current_user)):
    block = models.StudyBlock(user_id=current_user.id, **payload.model_dump())
    db.add(block)
    db.commit()
    db.refresh(block)
    return block


@router.get("", response_model=list[schemas.StudyBlockOut])
def list_blocks(for_date: Optional[date] = None, start: Optional[date] = None, end: Optional[date] = None,
                 db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    q = db.query(models.StudyBlock).filter(models.StudyBlock.user_id == current_user.id)
    if for_date:
        q = q.filter(models.StudyBlock.date == for_date)
    if start and end:
        q = q.filter(models.StudyBlock.date >= start, models.StudyBlock.date <= end)
    return q.order_by(models.StudyBlock.date, models.StudyBlock.start_time).all()


@router.patch("/{block_id}", response_model=schemas.StudyBlockOut)
def update_block(block_id: int, payload: schemas.StudyBlockUpdate, db: Session = Depends(get_db),
                  current_user: models.User = Depends(get_current_user)):
    block = db.query(models.StudyBlock).filter(models.StudyBlock.id == block_id,
                                                models.StudyBlock.user_id == current_user.id).first()
    if not block:
        raise HTTPException(404, "Study block not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(block, field, value)
    db.commit()
    db.refresh(block)
    return block


@router.delete("/{block_id}")
def delete_block(block_id: int, db: Session = Depends(get_db),
                  current_user: models.User = Depends(get_current_user)):
    block = db.query(models.StudyBlock).filter(models.StudyBlock.id == block_id,
                                                models.StudyBlock.user_id == current_user.id).first()
    if not block:
        raise HTTPException(404, "Study block not found")
    db.delete(block)
    db.commit()
    return {"ok": True}


# ---------------------------------------------------------------------------
# Study timer
# ---------------------------------------------------------------------------
# A second router on its own prefix, because /api/study-blocks/{id} already
# owns a path parameter — "timer" would be ambiguous with a block id.
#
# The timer itself lives in app/telegram/service.py rather than here. It was
# written for the bot first, but nothing about it is Telegram-specific, and
# duplicating the start/stop rules for the web would guarantee the two drift:
# one of them would eventually double-log a session or forget to tick the
# block. One implementation, two front doors.

timer_router = APIRouter(prefix="/api/study-timer", tags=["study-plan"])


@timer_router.get("", response_model=Optional[schemas.StudyTimerOut])
def get_timer(db: Session = Depends(get_db),
              current_user: models.User = Depends(get_current_user)):
    """The running timer, or null. Polled by the Study Plan page."""
    from ..telegram import service as tg_service
    return tg_service.timer_state(db, current_user.id)


@timer_router.post("/start", response_model=schemas.StudyTimerOut)
def start_timer(payload: schemas.StudyTimerStart, db: Session = Depends(get_db),
                current_user: models.User = Depends(get_current_user)):
    from ..telegram import service as tg_service
    try:
        return tg_service.start_timer(
            db, current_user.id, block_id=payload.block_id,
            subject=payload.subject, source="app",
        )
    except ValueError as e:
        raise HTTPException(404, str(e))


@timer_router.post("/stop", response_model=schemas.StudyTimerStopped)
def stop_timer(discard: bool = False, db: Session = Depends(get_db),
               current_user: models.User = Depends(get_current_user)):
    """Stops and logs. A stop with nothing running is a duplicate click rather
    than an error, so it answers 200 with logged=false instead of a 404 the UI
    would have to special-case."""
    from ..telegram import service as tg_service
    result = tg_service.stop_timer(db, current_user.id, discard=discard)
    if not result:
        return {"minutes": 0, "subject": None, "block_id": None, "logged": False}
    return result
