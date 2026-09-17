from collections import Counter
from datetime import date, datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import job_enrich, models, schemas
from ..auth import get_current_user
from ..database import get_db
from ..ai.engine import generate_job_document
from .boards import ensure_default_board

router = APIRouter(prefix="/api/jobs", tags=["jobs"])


def _get_owned_job(db: Session, user: models.User, job_id: int) -> models.JobApplication:
    job = db.query(models.JobApplication).filter(
        models.JobApplication.id == job_id,
        models.JobApplication.user_id == user.id,
    ).first()
    if not job:
        raise HTTPException(404, "Job not found")
    return job


SORTABLE_JOB_FIELDS = {
    "date_applied", "company_name", "role_title", "status",
    "created_at", "updated_at", "next_action_date", "deadline",
}


def _validate_board_and_resume(db: Session, user: models.User, data: dict):
    """board_id and resume_id are client-supplied foreign keys — make sure
    they actually belong to the current user before attaching them to a job,
    otherwise one tenant's job could be made to reference another tenant's
    board/resume."""
    board_id = data.get("board_id")
    if board_id:
        board = db.query(models.JobBoard).filter(
            models.JobBoard.id == board_id, models.JobBoard.user_id == user.id,
        ).first()
        if not board:
            raise HTTPException(400, "Invalid board")
    resume_id = data.get("resume_id")
    if resume_id:
        resume = db.query(models.Resume).filter(
            models.Resume.id == resume_id, models.Resume.user_id == user.id,
        ).first()
        if not resume:
            raise HTTPException(400, "Invalid resume")


def _log_activity(db: Session, user_id: int, job_id: int, kind: str, title: str = None, body: str = None):
    act = models.JobActivity(user_id=user_id, job_id=job_id, kind=kind, title=title, body=body,
                             occurred_at=datetime.utcnow())
    db.add(act)


STATUS_ACTIVITY = {
    "applied": ("applied", "Applied"),
    "oa_test": ("other", "Moved to OA / Test"),
    "phone_screen": ("interview", "Phone screen"),
    "interview": ("interview", "Interview"),
    "offer": ("offer_received", "Offer received"),
    "rejected": ("other", "Marked rejected"),
    "ghosted": ("other", "Marked ghosted"),
    "withdrawn": ("other", "Withdrew application"),
}


@router.post("", response_model=schemas.JobOut)
def create_job(payload: schemas.JobCreate, db: Session = Depends(get_db),
                current_user: models.User = Depends(get_current_user)):
    data = payload.model_dump()
    _validate_board_and_resume(db, current_user, data)
    if not data.get("board_id"):
        data["board_id"] = ensure_default_board(db, current_user).id
    # Fill the columns the board sorts and filters by — location, skills,
    # salary, tags — from the description, when the person adding the job left
    # them blank. Anything they typed is untouched (see job_enrich.apply_to).
    job_enrich.apply_to(data)
    job = models.JobApplication(user_id=current_user.id, **data)
    db.add(job)
    db.commit()
    db.refresh(job)
    # seed the timeline with the initial application event
    _log_activity(db, current_user.id, job.id, "applied", "Application created")
    db.commit()
    db.refresh(job)
    return job


@router.post("/enrich")
def enrich_preview(payload: schemas.JobEnrichIn,
                   current_user: models.User = Depends(get_current_user)):
    """What could be filled in from this description, without saving anything.

    The Add Application form calls this as the description is pasted so the
    fields populate in front of the user, who can then correct them — which is
    the difference between a helpful guess and a silent one.
    """
    return job_enrich.analyse(payload.job_description or "", payload.role_title or "")


@router.get("", response_model=list[schemas.JobOut])
def list_jobs(
    status: Optional[str] = None,
    company: Optional[str] = None,
    skill: Optional[str] = None,
    tag: Optional[str] = None,
    board_id: Optional[int] = None,
    sort: Optional[str] = "-date_applied",
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    ensure_default_board(db, current_user)  # backfills legacy jobs with no board onto the default board
    q = db.query(models.JobApplication).filter(models.JobApplication.user_id == current_user.id)
    if board_id:
        q = q.filter(models.JobApplication.board_id == board_id)
    if status:
        q = q.filter(models.JobApplication.status == status)
    if company:
        q = q.filter(models.JobApplication.company_name.ilike(f"%{company}%"))
    if skill:
        q = q.filter(models.JobApplication.skills_required.ilike(f"%{skill}%"))
    if tag:
        q = q.filter(models.JobApplication.tags.ilike(f"%{tag}%"))

    sort_field = sort.lstrip("-") if sort else "date_applied"
    if sort_field not in SORTABLE_JOB_FIELDS:
        sort_field = "date_applied"
    col = getattr(models.JobApplication, sort_field)
    if sort and sort.startswith("-"):
        col = col.desc()
    q = q.order_by(col)
    return q.all()


@router.patch("/{job_id}", response_model=schemas.JobOut)
def update_job(job_id: int, payload: schemas.JobUpdate, db: Session = Depends(get_db),
                current_user: models.User = Depends(get_current_user)):
    job = db.query(models.JobApplication).filter(models.JobApplication.id == job_id,
                                                  models.JobApplication.user_id == current_user.id).first()
    if not job:
        raise HTTPException(404, "Job not found")
    updates = payload.model_dump(exclude_unset=True)
    _validate_board_and_resume(db, current_user, updates)
    old_status = job.status.value if hasattr(job.status, "value") else job.status
    for field, value in updates.items():
        setattr(job, field, value)
    # auto-log a timeline entry when the status changes (so moving a card
    # across the Kanban board records itself)
    if "status" in updates:
        new_status = updates["status"]
        new_status = new_status.value if hasattr(new_status, "value") else new_status
        if new_status != old_status:
            kind, label = STATUS_ACTIVITY.get(str(new_status), ("status_change", f"Status → {new_status}"))
            _log_activity(db, current_user.id, job.id, kind, label)
    db.commit()
    db.refresh(job)
    return job


@router.delete("/{job_id}")
def delete_job(job_id: int, db: Session = Depends(get_db),
                current_user: models.User = Depends(get_current_user)):
    job = db.query(models.JobApplication).filter(models.JobApplication.id == job_id,
                                                  models.JobApplication.user_id == current_user.id).first()
    if not job:
        raise HTTPException(404, "Job not found")
    db.delete(job)
    db.commit()
    return {"ok": True}


@router.get("/stats/overview")
def job_stats(board_id: Optional[int] = None, db: Session = Depends(get_db),
              current_user: models.User = Depends(get_current_user)):
    ensure_default_board(db, current_user)
    q = db.query(models.JobApplication).filter(models.JobApplication.user_id == current_user.id)
    if board_id:
        q = q.filter(models.JobApplication.board_id == board_id)
    jobs = q.all()
    total = len(jobs)
    status_counts = Counter(j.status.value if hasattr(j.status, "value") else j.status for j in jobs)

    responded = total - status_counts.get("applied", 0) - status_counts.get("ghosted", 0)
    response_rate = round(responded / total * 100, 1) if total else 0.0
    interviews = status_counts.get("interview", 0) + status_counts.get("offer", 0)
    interview_rate = round(interviews / total * 100, 1) if total else 0.0
    offers = status_counts.get("offer", 0)

    # Funnel: every application counts as "Saved", everything past the
    # applied/ghosted stage counts as further down the funnel, so each
    # stage is a strict subset of the one before it (never grows partway
    # through, which is what makes a funnel chart make sense).
    oa_plus = sum(1 for j in jobs if j.status not in (models.JobStatus.applied, models.JobStatus.ghosted, models.JobStatus.withdrawn))
    interview_plus = sum(1 for j in jobs if j.status in (models.JobStatus.interview, models.JobStatus.offer))
    funnel = [
        {"stage": "Saved", "count": total},
        {"stage": "Applied", "count": total - status_counts.get("ghosted", 0)},
        {"stage": "Interview", "count": interview_plus},
        {"stage": "Offer", "count": offers},
    ]

    today = date.today()
    weekly = []
    for i in range(7, -1, -1):
        w_start = today - timedelta(days=today.weekday() + i * 7)
        w_end = w_start + timedelta(days=6)
        week_jobs = [j for j in jobs if w_start <= j.date_applied <= w_end]
        weekly.append({
            "week_start": str(w_start),
            "count": len(week_jobs),
            "interviews": sum(1 for j in week_jobs if j.status in (models.JobStatus.interview, models.JobStatus.offer)),
            "offers": sum(1 for j in week_jobs if j.status == models.JobStatus.offer),
        })

    skill_counter = Counter()
    for j in jobs:
        if j.skills_required:
            for s in j.skills_required.split(","):
                s = s.strip()
                if s:
                    skill_counter[s] += 1
    top_skills = [{"skill": s, "count": c} for s, c in skill_counter.most_common(15)]

    upcoming = [
        schemas.JobOut.model_validate(j)
        for j in jobs
        if j.next_action_date and today <= j.next_action_date <= today + timedelta(days=7)
    ]

    return {
        "total": total,
        "status_counts": status_counts,
        "response_rate": response_rate,
        "interview_rate": interview_rate,
        "offers": offers,
        "funnel": funnel,
        "applications_per_week": weekly,
        "top_skills": top_skills,
        "upcoming_follow_ups": upcoming,
    }


# ---------------------------------------------------------------------------
# AI Tools — generate a stage-based job-search document for an application
# (cover letter, follow-ups, interview prep, thank-you, offer emails, …)
# ---------------------------------------------------------------------------
@router.post("/ai/document", response_model=schemas.JobDocResult)
def generate_document(payload: schemas.JobDocRequest, db: Session = Depends(get_db),
                      current_user: models.User = Depends(get_current_user)):
    company = payload.company_name or ""
    role = payload.role_title or ""
    jd = payload.job_description or ""
    job = None
    if payload.job_id:
        job = _get_owned_job(db, current_user, payload.job_id)
        company = company or job.company_name
        role = role or job.role_title
        jd = jd or (job.job_description or "")
    result = generate_job_document(
        payload.doc_type, company=company, role=role,
        applicant_name=current_user.name or "", job_description=jd, notes=payload.notes or "",
    )
    if job is not None and result.get("text"):
        _log_activity(db, current_user.id, job.id, "other", f"Generated: {result.get('title', payload.doc_type)}")
        db.commit()
    return schemas.JobDocResult(title=result.get("title", payload.doc_type), text=result.get("text", ""), mode=result.get("mode", "lite"))


# ---------------------------------------------------------------------------
# Aggregate activity feed across ALL applications (powers the global
# "Activities" timeline). Defined before /{job_id} routes so the literal
# path segment isn't captured as a job id.
# ---------------------------------------------------------------------------
@router.get("/activities/feed", response_model=list[schemas.JobActivityFeedItem])
def activity_feed(limit: int = 100, db: Session = Depends(get_db),
                  current_user: models.User = Depends(get_current_user)):
    rows = (
        db.query(models.JobActivity, models.JobApplication)
        .join(models.JobApplication, models.JobActivity.job_id == models.JobApplication.id)
        .filter(models.JobActivity.user_id == current_user.id)
        .order_by(models.JobActivity.occurred_at.desc())
        .limit(min(limit, 500))
        .all()
    )
    out = []
    for act, job in rows:
        base = schemas.JobActivityOut.model_validate(act, from_attributes=True).model_dump()
        out.append(schemas.JobActivityFeedItem(
            **base, company_name=job.company_name, role_title=job.role_title,
        ))
    return out


# ---------------------------------------------------------------------------
# Full detail for one application (job fields + activities + contacts)
# ---------------------------------------------------------------------------
@router.get("/{job_id}/detail", response_model=schemas.JobDetailOut)
def job_detail(job_id: int, db: Session = Depends(get_db),
               current_user: models.User = Depends(get_current_user)):
    job = _get_owned_job(db, current_user, job_id)
    detail = schemas.JobDetailOut.model_validate(job, from_attributes=True)
    detail.activities = sorted(
        [schemas.JobActivityOut.model_validate(a, from_attributes=True) for a in job.activities],
        key=lambda a: a.occurred_at, reverse=True,
    )
    detail.contacts = [schemas.JobContactOut.model_validate(c, from_attributes=True) for c in job.contacts]
    return detail


# ---------------------------------------------------------------------------
# Activities on a single application
# ---------------------------------------------------------------------------
@router.get("/{job_id}/activities", response_model=list[schemas.JobActivityOut])
def list_activities(job_id: int, db: Session = Depends(get_db),
                    current_user: models.User = Depends(get_current_user)):
    _get_owned_job(db, current_user, job_id)
    acts = (
        db.query(models.JobActivity)
        .filter(models.JobActivity.job_id == job_id, models.JobActivity.user_id == current_user.id)
        .order_by(models.JobActivity.occurred_at.desc())
        .all()
    )
    return acts


@router.post("/{job_id}/activities", response_model=schemas.JobActivityOut)
def create_activity(job_id: int, payload: schemas.JobActivityCreate, db: Session = Depends(get_db),
                    current_user: models.User = Depends(get_current_user)):
    _get_owned_job(db, current_user, job_id)
    data = payload.model_dump(exclude_unset=True)
    if not data.get("occurred_at"):
        data["occurred_at"] = datetime.utcnow()
    act = models.JobActivity(user_id=current_user.id, job_id=job_id, **data)
    db.add(act)
    db.commit()
    db.refresh(act)
    return act


@router.patch("/{job_id}/activities/{activity_id}", response_model=schemas.JobActivityOut)
def update_activity(job_id: int, activity_id: int, payload: schemas.JobActivityUpdate,
                    db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    act = db.query(models.JobActivity).filter(
        models.JobActivity.id == activity_id, models.JobActivity.job_id == job_id,
        models.JobActivity.user_id == current_user.id,
    ).first()
    if not act:
        raise HTTPException(404, "Activity not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(act, field, value)
    db.commit()
    db.refresh(act)
    return act


@router.delete("/{job_id}/activities/{activity_id}")
def delete_activity(job_id: int, activity_id: int, db: Session = Depends(get_db),
                    current_user: models.User = Depends(get_current_user)):
    act = db.query(models.JobActivity).filter(
        models.JobActivity.id == activity_id, models.JobActivity.job_id == job_id,
        models.JobActivity.user_id == current_user.id,
    ).first()
    if not act:
        raise HTTPException(404, "Activity not found")
    db.delete(act)
    db.commit()
    return {"ok": True}


# ---------------------------------------------------------------------------
# Contacts on a single application
# ---------------------------------------------------------------------------
@router.get("/{job_id}/contacts", response_model=list[schemas.JobContactOut])
def list_contacts(job_id: int, db: Session = Depends(get_db),
                  current_user: models.User = Depends(get_current_user)):
    _get_owned_job(db, current_user, job_id)
    return db.query(models.JobContact).filter(
        models.JobContact.job_id == job_id, models.JobContact.user_id == current_user.id
    ).order_by(models.JobContact.created_at.desc()).all()


@router.post("/{job_id}/contacts", response_model=schemas.JobContactOut)
def create_contact(job_id: int, payload: schemas.JobContactCreate, db: Session = Depends(get_db),
                   current_user: models.User = Depends(get_current_user)):
    _get_owned_job(db, current_user, job_id)
    contact = models.JobContact(user_id=current_user.id, job_id=job_id, **payload.model_dump())
    db.add(contact)
    _log_activity(db, current_user.id, job_id, "contact", f"Added contact: {payload.name}")
    db.commit()
    db.refresh(contact)
    return contact


@router.patch("/{job_id}/contacts/{contact_id}", response_model=schemas.JobContactOut)
def update_contact(job_id: int, contact_id: int, payload: schemas.JobContactUpdate,
                   db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    contact = db.query(models.JobContact).filter(
        models.JobContact.id == contact_id, models.JobContact.job_id == job_id,
        models.JobContact.user_id == current_user.id,
    ).first()
    if not contact:
        raise HTTPException(404, "Contact not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(contact, field, value)
    db.commit()
    db.refresh(contact)
    return contact


@router.delete("/{job_id}/contacts/{contact_id}")
def delete_contact(job_id: int, contact_id: int, db: Session = Depends(get_db),
                   current_user: models.User = Depends(get_current_user)):
    contact = db.query(models.JobContact).filter(
        models.JobContact.id == contact_id, models.JobContact.job_id == job_id,
        models.JobContact.user_id == current_user.id,
    ).first()
    if not contact:
        raise HTTPException(404, "Contact not found")
    db.delete(contact)
    db.commit()
    return {"ok": True}
