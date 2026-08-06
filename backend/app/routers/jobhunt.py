"""/api/job-hunt/* — the Job Hunt tab's API.

Searching is slow by nature (dozens of HTTPS round-trips), so /run is the only
endpoint here that takes seconds. Everything else reads what the last run
stored, which is what keeps the tab itself instant.
"""

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from .. import models, schemas
from ..auth import get_current_user
from ..database import get_db
from ..jobhunt import registry, search as search_engine

router = APIRouter(prefix="/api/job-hunt", tags=["job-hunt"])


def _get_or_create_search(db: Session, user_id: int) -> models.JobSearch:
    row = db.query(models.JobSearch).filter(models.JobSearch.user_id == user_id).first()
    if row:
        return row
    row = models.JobSearch(user_id=user_id, since_days=30, notify_telegram=True,
                           auto_daily=True)
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


# ---------------------------------------------------------------------------
# The saved search
# ---------------------------------------------------------------------------

@router.get("/search", response_model=schemas.JobSearchOut)
def get_search(db: Session = Depends(get_db),
               current_user: models.User = Depends(get_current_user)):
    return _get_or_create_search(db, current_user.id)


@router.put("/search", response_model=schemas.JobSearchOut)
def update_search(payload: schemas.JobSearchUpdate, db: Session = Depends(get_db),
                  current_user: models.User = Depends(get_current_user)):
    row = _get_or_create_search(db, current_user.id)
    data = payload.model_dump(exclude_unset=True)
    if "since_days" in data and data["since_days"] is not None:
        # 0 would mean "posted before the epoch" and quietly return nothing;
        # 365 is already well past the point where a listing is live.
        data["since_days"] = max(1, min(365, int(data["since_days"])))
    for field, value in data.items():
        setattr(row, field, value)
    db.commit()
    db.refresh(row)
    return row


# ---------------------------------------------------------------------------
# Running it
# ---------------------------------------------------------------------------

@router.post("/run", response_model=schemas.JobHuntRunResult)
def run_now(db: Session = Depends(get_db),
            current_user: models.User = Depends(get_current_user)):
    row = _get_or_create_search(db, current_user.id)
    if not (row.roles or "").strip():
        raise HTTPException(422, "Tell me what role you're looking for first.")
    return search_engine.run_search(db, current_user.id, row)


# ---------------------------------------------------------------------------
# Results
# ---------------------------------------------------------------------------

@router.get("/hits", response_model=list[schemas.JobHitOut])
def list_hits(status: Optional[str] = None, limit: int = Query(200, le=500),
              db: Session = Depends(get_db),
              current_user: models.User = Depends(get_current_user)):
    q = db.query(models.JobHit).filter(models.JobHit.user_id == current_user.id)
    if status:
        q = q.filter(models.JobHit.status == status)
    else:
        # Dismissed hits stay in the table so they are never re-offered, but
        # they are not what anyone opens this tab to look at.
        q = q.filter(models.JobHit.status != "dismissed")
    hits = q.order_by(models.JobHit.first_seen_at.desc(),
                      models.JobHit.posted_at.desc()).limit(limit).all()

    referrals = search_engine.referral_map(db, current_user.id)
    out = []
    for h in hits:
        item = schemas.JobHitOut.model_validate(h, from_attributes=True).model_dump()
        item["referrals"] = referrals.get((h.company or "").strip().lower(), [])
        out.append(item)
    return out


@router.patch("/hits/{hit_id}", response_model=schemas.JobHitOut)
def update_hit(hit_id: int, payload: schemas.JobHitUpdate,
               db: Session = Depends(get_db),
               current_user: models.User = Depends(get_current_user)):
    hit = db.query(models.JobHit).filter(
        models.JobHit.id == hit_id, models.JobHit.user_id == current_user.id
    ).first()
    if not hit:
        raise HTTPException(404, "No such result.")
    if payload.status is not None:
        if payload.status not in ("new", "saved", "dismissed", "applied"):
            raise HTTPException(422, "Unknown status.")
        hit.status = payload.status
    db.commit()
    db.refresh(hit)
    return hit


@router.post("/hits/{hit_id}/track", response_model=schemas.JobOut)
def track_hit(hit_id: int, db: Session = Depends(get_db),
              current_user: models.User = Depends(get_current_user)):
    """Turns a result into a row in the application tracker.

    The point of the whole tab: finding a job is only useful if it lands in the
    pipeline you already manage, rather than in a list you have to copy across
    by hand.
    """
    hit = db.query(models.JobHit).filter(
        models.JobHit.id == hit_id, models.JobHit.user_id == current_user.id
    ).first()
    if not hit:
        raise HTTPException(404, "No such result.")
    if hit.application_id:
        existing = db.query(models.JobApplication).get(hit.application_id)
        if existing:
            return existing

    # date_applied is NOT NULL on JobApplication, and the tracker's kanban is
    # keyed off status. There is no "found but not yet applied" status in the
    # enum, so today's date plus a note is the honest representation — the row
    # is editable the moment it lands on the board.
    app_row = models.JobApplication(
        user_id=current_user.id,
        company_name=hit.company,
        role_title=hit.title,
        location=hit.location,
        job_link=hit.url,
        status=models.JobStatus.applied,
        date_applied=datetime.utcnow().date(),
        source=f"Job Hunt · {hit.provider or 'ATS'}",
        job_description=hit.description,
        notes=f"Found via Job Hunt on {datetime.utcnow():%Y-%m-%d}.",
    )
    db.add(app_row)
    db.flush()
    hit.application_id = app_row.id
    hit.status = "applied"
    db.commit()
    db.refresh(app_row)
    return app_row


# ---------------------------------------------------------------------------
# Companies
# ---------------------------------------------------------------------------

@router.get("/boards", response_model=list[schemas.CompanyBoardOut])
def list_boards(include_inactive: bool = False, db: Session = Depends(get_db),
                current_user: models.User = Depends(get_current_user)):
    return registry.boards_for_user(db, current_user.id, include_inactive=include_inactive)


@router.post("/boards", response_model=schemas.CompanyBoardOut)
def add_board(payload: schemas.CompanyBoardCreate, db: Session = Depends(get_db),
              current_user: models.User = Depends(get_current_user)):
    try:
        return registry.add_board(db, current_user.id, payload.url,
                                  name=payload.name, provider=payload.provider)
    except ValueError as e:
        raise HTTPException(422, str(e))


@router.delete("/boards/{board_id}")
def remove_board(board_id: int, db: Session = Depends(get_db),
                 current_user: models.User = Depends(get_current_user)):
    board = db.query(models.CompanyBoard).get(board_id)
    if not board:
        raise HTTPException(404, "No such company.")
    if board.user_id == current_user.id:
        db.delete(board)
    else:
        # Shared registry rows aren't anyone's to delete, so removing one just
        # takes it out of this person's searches.
        board.active = False
    db.commit()
    return {"ok": True}


# ---------------------------------------------------------------------------
# Referral contacts
# ---------------------------------------------------------------------------

@router.get("/referrals", response_model=list[schemas.ReferralContactOut])
def list_referrals(db: Session = Depends(get_db),
                   current_user: models.User = Depends(get_current_user)):
    return db.query(models.ReferralContact).filter(
        models.ReferralContact.user_id == current_user.id
    ).order_by(models.ReferralContact.company).all()


@router.post("/referrals", response_model=schemas.ReferralContactOut)
def add_referral(payload: schemas.ReferralContactCreate, db: Session = Depends(get_db),
                 current_user: models.User = Depends(get_current_user)):
    row = models.ReferralContact(user_id=current_user.id, **payload.model_dump())
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@router.delete("/referrals/{contact_id}")
def remove_referral(contact_id: int, db: Session = Depends(get_db),
                    current_user: models.User = Depends(get_current_user)):
    row = db.query(models.ReferralContact).filter(
        models.ReferralContact.id == contact_id,
        models.ReferralContact.user_id == current_user.id,
    ).first()
    if not row:
        raise HTTPException(404, "No such contact.")
    db.delete(row)
    db.commit()
    return {"ok": True}
