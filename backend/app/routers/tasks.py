from datetime import date, datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from .. import models, schemas
from ..auth import get_current_user
from ..database import get_db

router = APIRouter(prefix="/api/tasks", tags=["tasks"])


@router.post("", response_model=schemas.TaskOut)
def create_task(payload: schemas.TaskCreate, db: Session = Depends(get_db),
                 current_user: models.User = Depends(get_current_user)):
    title = (payload.title or "").strip()
    if not title:
        raise HTTPException(422, "Task name can't be empty.")
    # A task is a duplicate only within the same day: the same to-do can
    # legitimately recur on different dates, but not twice on one day.
    existing = db.query(models.Task).filter(
        models.Task.user_id == current_user.id,
        models.Task.date == payload.date,
        func.lower(func.trim(models.Task.title)) == title.lower(),
    ).first()
    if existing:
        raise HTTPException(409, f'You already have a task "{existing.title}" on this day.')
    task = models.Task(user_id=current_user.id, date=payload.date, title=title,
                        notes=payload.notes, tags=payload.tags)
    db.add(task)
    db.commit()
    db.refresh(task)
    return task


@router.get("", response_model=list[schemas.TaskOut])
def list_tasks(
    for_date: Optional[date] = None,
    start: Optional[date] = None,
    end: Optional[date] = None,
    tag: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    q = db.query(models.Task).filter(models.Task.user_id == current_user.id)
    if for_date:
        q = q.filter(models.Task.date == for_date)
    if start and end:
        q = q.filter(models.Task.date >= start, models.Task.date <= end)
    if tag:
        q = q.filter(models.Task.tags.ilike(f"%{tag}%"))
    return q.order_by(models.Task.date, models.Task.id).all()


@router.patch("/{task_id}", response_model=schemas.TaskOut)
def update_task(task_id: int, payload: schemas.TaskUpdate, db: Session = Depends(get_db),
                 current_user: models.User = Depends(get_current_user)):
    task = db.query(models.Task).filter(models.Task.id == task_id, models.Task.user_id == current_user.id).first()
    if not task:
        raise HTTPException(404, "Task not found")
    data = payload.model_dump(exclude_unset=True)
    for field, value in data.items():
        setattr(task, field, value)
    if "completed" in data:
        task.completed_at = datetime.utcnow() if task.completed else None
    db.commit()
    db.refresh(task)
    return task


@router.delete("/{task_id}")
def delete_task(task_id: int, db: Session = Depends(get_db),
                 current_user: models.User = Depends(get_current_user)):
    task = db.query(models.Task).filter(models.Task.id == task_id, models.Task.user_id == current_user.id).first()
    if not task:
        raise HTTPException(404, "Task not found")
    db.delete(task)
    db.commit()
    return {"ok": True}
