from datetime import datetime, date, timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from .. import models, schemas
from ..auth import require_admin
from ..database import get_db

router = APIRouter(prefix="/api/admin", tags=["admin"])

# Every table an admin can browse in the Database Explorer, plus a sensible
# default ordering column.
DB_TABLES = {
    "users": (models.User, "id"),
    "habits": (models.Habit, "id"),
    "habit_entries": (models.HabitEntry, "id"),
    "tasks": (models.Task, "id"),
    "study_blocks": (models.StudyBlock, "id"),
    "weekly_notes": (models.WeeklyNote, "id"),
    "resumes": (models.Resume, "id"),
    "job_applications": (models.JobApplication, "id"),
}

# Never expose these raw values through the DB explorer, even to admins.
REDACTED_COLUMNS = {"password_hash"}
# Truncate very long text fields in the table view (full value still fetchable via the normal API).
TRUNCATE_COLUMNS = {"extracted_text", "builder_data", "notes", "job_description", "cover_letter", "ats_breakdown"}
TRUNCATE_LENGTH = 200


def _serialize_row(row) -> dict:
    result = {}
    for col in row.__table__.columns:
        val = getattr(row, col.name)
        if col.name in REDACTED_COLUMNS:
            result[col.name] = "••••••••" if val else None
            continue
        if isinstance(val, (datetime, date)):
            val = val.isoformat()
        elif hasattr(val, "value"):  # Enum columns
            val = val.value
        if isinstance(val, str) and col.name in TRUNCATE_COLUMNS and len(val) > TRUNCATE_LENGTH:
            val = val[:TRUNCATE_LENGTH] + "…"
        result[col.name] = val
    return result


@router.get("/db/tables")
def list_db_tables(db: Session = Depends(get_db), admin: models.User = Depends(require_admin)):
    return [{"name": name, "row_count": db.query(model).count()} for name, (model, _) in DB_TABLES.items()]


@router.get("/db/tables/{table_name}")
def get_db_table_rows(table_name: str, page: int = 1, page_size: int = 50,
                       db: Session = Depends(get_db), admin: models.User = Depends(require_admin)):
    if table_name not in DB_TABLES:
        raise HTTPException(404, f"Unknown table. Choose one of: {', '.join(DB_TABLES)}")
    model, order_col = DB_TABLES[table_name]
    page = max(1, page)
    page_size = max(1, min(page_size, 200))
    total = db.query(model).count()
    rows = db.query(model).order_by(getattr(model, order_col).desc()) \
        .offset((page - 1) * page_size).limit(page_size).all()
    columns = [c.name for c in model.__table__.columns]
    return {
        "table": table_name, "total": total, "page": page, "page_size": page_size,
        "columns": columns, "rows": [_serialize_row(r) for r in rows],
    }


@router.get("/users")
def list_users(db: Session = Depends(get_db), admin: models.User = Depends(require_admin)):
    users = db.query(models.User).order_by(models.User.created_at.desc()).all()
    result = []
    for u in users:
        result.append({
            "id": u.id,
            "name": u.name,
            "email": u.email,
            "role": u.role,
            "is_active": u.is_active,
            "created_at": u.created_at,
            "habit_count": db.query(models.Habit).filter(models.Habit.user_id == u.id).count(),
            "task_count": db.query(models.Task).filter(models.Task.user_id == u.id).count(),
            "job_count": db.query(models.JobApplication).filter(models.JobApplication.user_id == u.id).count(),
        })
    return result


@router.patch("/users/{user_id}", response_model=schemas.UserOut)
def update_user(user_id: int, payload: schemas.UserAdminUpdate, db: Session = Depends(get_db),
                 admin: models.User = Depends(require_admin)):
    user = db.query(models.User).get(user_id)
    if not user:
        raise HTTPException(404, "User not found")
    if user.id == admin.id and payload.is_active is False:
        raise HTTPException(400, "You can't deactivate your own account")
    if user.id == admin.id and payload.role == models.UserRole.user:
        raise HTTPException(400, "You can't demote your own account")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(user, field, value)
    db.commit()
    db.refresh(user)
    return user


@router.delete("/users/{user_id}")
def delete_user(user_id: int, db: Session = Depends(get_db), admin: models.User = Depends(require_admin)):
    if user_id == admin.id:
        raise HTTPException(400, "You can't delete your own account")
    user = db.query(models.User).get(user_id)
    if not user:
        raise HTTPException(404, "User not found")
    db.delete(user)
    db.commit()
    return {"ok": True}


@router.get("/stats")
def admin_stats(db: Session = Depends(get_db), admin: models.User = Depends(require_admin)):
    total_users = db.query(models.User).count()
    active_users = db.query(models.User).filter(models.User.is_active == True).count()  # noqa: E712
    total_habits = db.query(models.Habit).count()
    total_tasks = db.query(models.Task).count()
    total_jobs = db.query(models.JobApplication).count()
    total_study_blocks = db.query(models.StudyBlock).count()
    total_resumes = db.query(models.Resume).count()
    admin_count = db.query(models.User).filter(models.User.role == models.UserRole.admin).count()

    today = datetime.utcnow().date()
    signups_last_8_weeks = []
    for i in range(7, -1, -1):
        w_start = today - timedelta(days=today.weekday() + i * 7)
        w_end = w_start + timedelta(days=6)
        count = db.query(models.User).filter(
            models.User.created_at >= datetime.combine(w_start, datetime.min.time()),
            models.User.created_at <= datetime.combine(w_end, datetime.max.time()),
        ).count()
        signups_last_8_weeks.append({"week_start": str(w_start), "count": count})

    # Job status distribution across the whole platform — a real "insight",
    # not just a per-user table row.
    job_status_counts = {}
    for status, count in db.query(models.JobApplication.status, func.count(models.JobApplication.id)) \
            .group_by(models.JobApplication.status).all():
        key = status.value if hasattr(status, "value") else status
        job_status_counts[key] = count

    # Top 5 most active users by total content created — surfaces real
    # engagement instead of just a flat user list.
    users = db.query(models.User).all()
    leaderboard = []
    for u in users:
        h = db.query(models.Habit).filter(models.Habit.user_id == u.id).count()
        t = db.query(models.Task).filter(models.Task.user_id == u.id).count()
        j = db.query(models.JobApplication).filter(models.JobApplication.user_id == u.id).count()
        leaderboard.append({"name": u.name, "email": u.email, "habits": h, "tasks": t, "jobs": j, "total": h + t + j})
    leaderboard.sort(key=lambda x: -x["total"])
    top_active_users = leaderboard[:5]

    engagement_rate = round(active_users / total_users * 100, 1) if total_users else 0.0
    avg_habits = round(total_habits / total_users, 1) if total_users else 0.0
    avg_tasks = round(total_tasks / total_users, 1) if total_users else 0.0
    avg_jobs = round(total_jobs / total_users, 1) if total_users else 0.0

    return {
        "total_users": total_users,
        "active_users": active_users,
        "inactive_users": total_users - active_users,
        "admin_count": admin_count,
        "engagement_rate": engagement_rate,
        "total_habits": total_habits,
        "total_tasks": total_tasks,
        "total_jobs": total_jobs,
        "total_study_blocks": total_study_blocks,
        "total_resumes": total_resumes,
        "avg_habits_per_user": avg_habits,
        "avg_tasks_per_user": avg_tasks,
        "avg_jobs_per_user": avg_jobs,
        "signups_last_8_weeks": signups_last_8_weeks,
        "job_status_counts": job_status_counts,
        "top_active_users": top_active_users,
    }
