from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from .. import models
from ..auth import get_current_user
from ..database import get_db

router = APIRouter(prefix="/api/search", tags=["search"])

MAX_PER_CATEGORY = 8
EMPTY_RESULT_KEYS = ["tasks", "jobs", "habits", "resumes", "study_blocks", "weekly_notes"]


@router.get("")
def global_search(q: str = "", db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    """One search across the whole app — tasks, job applications, habits,
    resumes, study blocks, and weekly notes — so nothing requires searching
    page-by-page. The frontend renders these as grouped sections."""
    query = (q or "").strip()
    if len(query) < 2:
        return {"query": query, **{k: [] for k in EMPTY_RESULT_KEYS}}

    like = f"%{query}%"
    uid = current_user.id

    tasks = db.query(models.Task).filter(
        models.Task.user_id == uid,
        (models.Task.title.ilike(like)) | (models.Task.notes.ilike(like)) | (models.Task.tags.ilike(like)),
    ).order_by(models.Task.date.desc()).limit(MAX_PER_CATEGORY).all()

    jobs = db.query(models.JobApplication).filter(
        models.JobApplication.user_id == uid,
        (models.JobApplication.company_name.ilike(like)) |
        (models.JobApplication.role_title.ilike(like)) |
        (models.JobApplication.tags.ilike(like)) |
        (models.JobApplication.skills_required.ilike(like)) |
        (models.JobApplication.location.ilike(like)) |
        (models.JobApplication.source.ilike(like)) |
        (models.JobApplication.notes.ilike(like)) |
        (models.JobApplication.job_description.ilike(like)) |
        (models.JobApplication.cover_letter.ilike(like)),
    ).order_by(models.JobApplication.date_applied.desc()).limit(MAX_PER_CATEGORY).all()

    habits = db.query(models.Habit).filter(
        models.Habit.user_id == uid,
        (models.Habit.title.ilike(like)) | (models.Habit.category.ilike(like)),
    ).order_by(models.Habit.id).limit(MAX_PER_CATEGORY).all()

    resumes = db.query(models.Resume).filter(
        models.Resume.user_id == uid,
        (models.Resume.name.ilike(like)) | (models.Resume.notes.ilike(like)) | (models.Resume.extracted_text.ilike(like)),
    ).order_by(models.Resume.created_at.desc()).limit(MAX_PER_CATEGORY).all()

    study_blocks = db.query(models.StudyBlock).filter(
        models.StudyBlock.user_id == uid,
        (models.StudyBlock.subject.ilike(like)) | (models.StudyBlock.notes.ilike(like)),
    ).order_by(models.StudyBlock.date.desc()).limit(MAX_PER_CATEGORY).all()

    weekly_notes = db.query(models.WeeklyNote).filter(
        models.WeeklyNote.user_id == uid,
        (models.WeeklyNote.focus_text.ilike(like)) |
        (models.WeeklyNote.reward_text.ilike(like)) |
        (models.WeeklyNote.affirmation_text.ilike(like)),
    ).order_by(models.WeeklyNote.week_start_date.desc()).limit(MAX_PER_CATEGORY).all()

    return {
        "query": query,
        "tasks": [{"id": t.id, "title": t.title, "date": str(t.date), "completed": t.completed, "tags": t.tags} for t in tasks],
        "jobs": [{"id": j.id, "company_name": j.company_name, "role_title": j.role_title,
                  "status": j.status.value if hasattr(j.status, "value") else j.status, "tags": j.tags} for j in jobs],
        "habits": [{"id": h.id, "title": h.title, "category": h.category, "active": h.active} for h in habits],
        "resumes": [{"id": r.id, "name": r.name, "notes": r.notes} for r in resumes],
        "study_blocks": [{"id": s.id, "subject": s.subject, "date": str(s.date), "start_time": s.start_time,
                           "end_time": s.end_time, "completed": s.completed} for s in study_blocks],
        "weekly_notes": [{"week_start_date": str(w.week_start_date), "focus_text": w.focus_text,
                           "reward_text": w.reward_text, "affirmation_text": w.affirmation_text} for w in weekly_notes],
    }
