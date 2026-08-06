from datetime import date
from typing import List, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from .. import models
from ..auth import get_current_user
from ..database import get_db
from ..ai.engine import assistant_status, generate_reply

router = APIRouter(prefix="/api/chat", tags=["assistant"])


class ChatMessage(BaseModel):
    role: str  # "user" | "assistant"
    content: str


class ChatRequest(BaseModel):
    message: str
    history: Optional[List[ChatMessage]] = None


class ChatResponse(BaseModel):
    reply: Optional[str] = None
    error: Optional[str] = None
    mode: Optional[str] = None


@router.get("/status")
def chat_status():
    """Lets the frontend know whether the local model is ready before it
    shows the chat widget as usable, without triggering a (potentially
    slow) model load just to check."""
    return assistant_status()


def _build_context_note(db: Session, user: models.User) -> str:
    """A short, live snapshot of the person's own data so the assistant's
    replies are grounded in their actual habits/jobs rather than generic —
    built from local DB queries, never sent anywhere external."""
    today = date.today()
    active_habits = db.query(models.Habit).filter(models.Habit.user_id == user.id, models.Habit.active == True).all()  # noqa: E712
    today_tasks = db.query(models.Task).filter(models.Task.user_id == user.id, models.Task.date == today).all()
    jobs = db.query(models.JobApplication).filter(models.JobApplication.user_id == user.id).all()
    resumes_count = db.query(models.Resume).filter(models.Resume.user_id == user.id).count()

    status_counts = {}
    for j in jobs:
        key = j.status.value if hasattr(j.status, "value") else j.status
        status_counts[key] = status_counts.get(key, 0) + 1

    lines = [
        f"- Name: {user.name}",
        f"- Active habits ({len(active_habits)}): {', '.join(h.title for h in active_habits[:10]) or 'none yet'}",
        f"- Tasks today: {len(today_tasks)} ({sum(1 for t in today_tasks if t.completed)} completed)",
        f"- Job applications: {len(jobs)} total — " + (", ".join(f"{v} {k}" for k, v in status_counts.items()) or "none yet"),
        f"- Resumes saved: {resumes_count}",
    ]
    return "\n".join(lines)


@router.post("", response_model=ChatResponse)
def chat(payload: ChatRequest, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    context_note = _build_context_note(db, current_user)
    history = [h.model_dump() for h in (payload.history or [])]
    result = generate_reply(payload.message, history=history, context_note=context_note)
    return ChatResponse(**result)
