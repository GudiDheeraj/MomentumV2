import io
from collections import Counter
from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from .. import models
from ..auth import get_current_user
from ..database import get_db
from ..report_pdf import build_account_report_pdf, build_applied_jobs_pdf
from ..dashboard_pdf import build_dashboard_pdf

router = APIRouter(prefix="/api/export", tags=["export"])


@router.get("/pdf")
def export_pdf(db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    """Full-account export as a navy/mint dashboard-style PDF report that
    mirrors the web app's own look."""
    habits = db.query(models.Habit).filter(models.Habit.user_id == current_user.id, models.Habit.active == True).all()  # noqa: E712
    tasks = db.query(models.Task).filter(models.Task.user_id == current_user.id).order_by(models.Task.date.desc()).all()
    blocks = db.query(models.StudyBlock).filter(models.StudyBlock.user_id == current_user.id).order_by(
        models.StudyBlock.date.desc()).all()
    jobs = db.query(models.JobApplication).filter(models.JobApplication.user_id == current_user.id).order_by(
        models.JobApplication.date_applied.desc()).all()
    resumes = db.query(models.Resume).filter(models.Resume.user_id == current_user.id).order_by(
        models.Resume.created_at.desc()).all()

    today = date.today()
    today_habits = db.query(models.HabitEntry).filter(
        models.HabitEntry.date == today,
        models.HabitEntry.habit_id.in_([h.id for h in habits]) if habits else False,
        models.HabitEntry.completed == True,  # noqa: E712
    ).count() if habits else 0
    today_tasks = [t for t in tasks if t.date == today]
    today_total = len(habits) + len(today_tasks)
    today_completed = today_habits + sum(1 for t in today_tasks if t.completed)
    summary_today = {"percent": round(today_completed / today_total * 100, 1) if today_total else 0.0}

    total = len(jobs)
    responded = total - sum(1 for j in jobs if j.status.value in ("applied", "ghosted"))
    response_rate = round(responded / total * 100, 1) if total else 0.0
    interviews = sum(1 for j in jobs if j.status.value in ("interview", "offer"))
    interview_rate = round(interviews / total * 100, 1) if total else 0.0
    job_stats = {"total": total, "response_rate": response_rate, "interview_rate": interview_rate}

    pdf_bytes = build_account_report_pdf(current_user, summary_today, habits, tasks, blocks, jobs, job_stats, resumes)
    filename = f"momentum-tracker-report-{datetime.utcnow().date()}.pdf"
    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


def _job_stats(jobs):
    """One place computes the numbers, so both exports agree with each other."""
    total = len(jobs)
    statuses = [j.status.value for j in jobs]
    responded = total - sum(1 for s in statuses if s in ("applied", "ghosted"))
    interviews = sum(1 for s in statuses if s in ("interview", "offer"))
    offers = sum(1 for s in statuses if s == "offer")
    active = sum(1 for s in statuses if s in ("applied", "oa_test", "phone_screen", "interview"))
    by_status = Counter(statuses)
    order = ["applied", "oa_test", "phone_screen", "interview", "offer", "rejected", "ghosted", "withdrawn"]
    months = Counter(j.date_applied.strftime("%Y-%m") for j in jobs if j.date_applied)
    # Last six months, oldest first — a run of months reads as a trend; an
    # unordered dict of whatever happens to have data does not.
    today = date.today()
    seq = []
    for back in range(5, -1, -1):
        m = (today.month - back - 1) % 12 + 1
        y = today.year + ((today.month - back - 1) // 12)
        key = f"{y:04d}-{m:02d}"
        seq.append((date(y, m, 1).strftime("%b"), months.get(key, 0)))
    return {
        "total": total,
        "response_rate": round(responded / total * 100, 1) if total else 0.0,
        "interview_rate": round(interviews / total * 100, 1) if total else 0.0,
        "offers": offers,
        "active": active,
        "interviews": interviews,
        "by_status": [(s, by_status[s]) for s in order if by_status.get(s)],
        "by_month": seq,
        "top_companies": Counter((j.company_name or "—") for j in jobs).most_common(6),
    }


@router.get("/statistics.pdf")
def export_dashboard(db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    """The account dashboard as a three-page PDF.

    Everything is aggregated here and drawn in dashboard_pdf.py — no browser
    involved, so this cannot fail on a CSS feature or a blocked CDN the way the
    screen-capture version did.
    """
    uid = current_user.id
    habits = db.query(models.Habit).filter(models.Habit.user_id == uid, models.Habit.active == True).all()  # noqa: E712
    tasks = db.query(models.Task).filter(models.Task.user_id == uid).all()
    blocks = db.query(models.StudyBlock).filter(models.StudyBlock.user_id == uid).all()
    jobs = db.query(models.JobApplication).filter(models.JobApplication.user_id == uid).order_by(
        models.JobApplication.date_applied.desc()).all()

    today = date.today()
    habit_ids = [h.id for h in habits]
    entries = db.query(models.HabitEntry).filter(
        models.HabitEntry.habit_id.in_(habit_ids),
        models.HabitEntry.date >= today - timedelta(days=90),
        models.HabitEntry.completed == True,  # noqa: E712
    ).all() if habit_ids else []

    last30 = [e for e in entries if e.date >= today - timedelta(days=30)]
    done_by_habit = Counter(e.habit_id for e in last30)
    done_today = sum(1 for e in entries if e.date == today)

    today_tasks = [t for t in tasks if t.date == today]
    today_total = len(habits) + len(today_tasks)
    today_done = done_today + sum(1 for t in today_tasks if t.completed)

    def hours(b):
        try:
            sh, sm = (int(x) for x in b.start_time.split(":")[:2])
            eh, em = (int(x) for x in b.end_time.split(":")[:2])
            return max(0.0, ((eh * 60 + em) - (sh * 60 + sm)) / 60.0)
        except Exception:
            return 0.0

    # Twelve weeks of activity, oldest first — a trend needs an axis in order.
    week_starts = [today - timedelta(days=today.weekday() + 7 * i) for i in range(11, -1, -1)]
    def in_week(d, start):
        return start <= d < start + timedelta(days=7)
    weeks = [w.strftime("%d %b") if i % 2 == 0 else "" for i, w in enumerate(week_starts)]
    week_habits = [sum(1 for e in entries if in_week(e.date, w)) for w in week_starts]
    week_tasks = [sum(1 for t in tasks if t.completed and in_week(t.date, w)) for w in week_starts]
    week_apps = [sum(1 for j in jobs if j.date_applied and in_week(j.date_applied, w)) for w in week_starts]

    study_by_subject = Counter()
    study_by_week = Counter()
    for b in blocks:
        study_by_subject[b.subject or "—"] += hours(b)
        for w in week_starts[-6:]:
            if b.date and in_week(b.date, w):
                study_by_week[w.strftime("%d %b")] += hours(b)

    statuses = [j.status.value for j in jobs]
    total = len(jobs)
    responded = total - sum(1 for s in statuses if s in ("applied", "ghosted"))
    interviews = sum(1 for s in statuses if s in ("interview", "offer"))
    order = ["applied", "oa_test", "phone_screen", "interview", "offer", "rejected", "ghosted", "withdrawn"]
    by_status_c = Counter(statuses)
    months = Counter(j.date_applied.strftime("%Y-%m") for j in jobs if j.date_applied)
    month_seq = []
    for back in range(5, -1, -1):
        m = (today.month - back - 1) % 12 + 1
        y = today.year + ((today.month - back - 1) // 12)
        month_seq.append((date(y, m, 1).strftime("%b"), months.get(f"{y:04d}-{m:02d}", 0)))

    payload = {
        "today_percent": round(today_done / today_total * 100, 1) if today_total else 0.0,
        "habit_count": len(habits),
        "habit_done_today": done_today,
        "habit_checkins": len(last30),
        "task_count": len(tasks),
        "task_done": sum(1 for t in tasks if t.completed),
        "study_blocks": len(blocks),
        "study_hours": round(sum(study_by_subject.values()), 1),
        "study_by_subject": [(s, round(v, 1)) for s, v in study_by_subject.most_common(7)],
        "study_by_week": [(k, round(v, 1)) for k, v in study_by_week.items()],
        "habit_rates": [(h.title[:14], done_by_habit.get(h.id, 0)) for h in habits],
        "weeks": weeks,
        "week_habits": week_habits,
        "week_tasks": week_tasks,
        "week_apps": week_apps,
        "jobs_total": total,
        "jobs_active": sum(1 for s in statuses if s in ("applied", "oa_test", "phone_screen", "interview")),
        "interviews": interviews,
        "offers": sum(1 for s in statuses if s == "offer"),
        "response_rate": round(responded / total * 100, 1) if total else 0.0,
        "interview_rate": round(interviews / total * 100, 1) if total else 0.0,
        "by_status": [(s, by_status_c[s]) for s in order if by_status_c.get(s)],
        "by_month": month_seq,
        "by_job_type": Counter((j.role_title or "—").strip()[:18] for j in jobs).most_common(6),
        "by_source": Counter((j.source or "Direct").strip()[:16] for j in jobs).most_common(6),
        "top_companies": Counter((j.company_name or "—").strip()[:14] for j in jobs).most_common(6),
        # The whole log goes in the same file now — the reader gets the summary
        # and the evidence behind it without choosing between two downloads.
        "all_jobs": [
            [j.date_applied.strftime("%d %b %Y") if j.date_applied else "—",
             (j.company_name or "—")[:26], (j.role_title or "—")[:34],
             (j.location or j.source or "—")[:18], j.status.value]
            for j in jobs
        ],
        "recent_jobs": [
            [j.date_applied.strftime("%d %b %Y") if j.date_applied else "—",
             (j.company_name or "—")[:26], (j.role_title or "—")[:38], j.status.value]
            for j in jobs[:6]
        ],
    }
    pdf = build_dashboard_pdf(current_user, payload)
    filename = f"momentum-dashboard-{datetime.utcnow().date()}.pdf"
    return StreamingResponse(io.BytesIO(pdf), media_type="application/pdf",
                             headers={"Content-Disposition": f'attachment; filename="{filename}"'})


@router.get("/jobs.pdf")
def export_applied_jobs(db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    """Every application logged, newest first."""
    jobs = db.query(models.JobApplication).filter(
        models.JobApplication.user_id == current_user.id).order_by(
        models.JobApplication.date_applied.desc()).all()
    pdf = build_applied_jobs_pdf(current_user, jobs, _job_stats(jobs))
    filename = f"momentum-applied-jobs-{datetime.utcnow().date()}.pdf"
    return StreamingResponse(io.BytesIO(pdf), media_type="application/pdf",
                             headers={"Content-Disposition": f'attachment; filename="{filename}"'})
