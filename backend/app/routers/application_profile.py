"""/api/application-profile — the answers every job application asks for.

Stored once so they never have to be retyped. The Chrome extension reads this
to fill a live application form, and the app has a page for editing it.

This used to live under /api/job-hunt/profile. It moved when the Job Hunt
feature was removed: the profile has nothing to do with searching job boards,
it is the autofill data, and the extension needs it regardless.

It is a plain authenticated GET rather than anything cleverer, because the
extension already holds the user's token for the capture feature it has always
had.
"""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from .. import models, schemas
from ..auth import get_current_user
from ..database import get_db

router = APIRouter(prefix="/api/application-profile", tags=["application-profile"])


@router.get("", response_model=schemas.ApplicationProfileOut)
def get_profile(db: Session = Depends(get_db),
                current_user: models.User = Depends(get_current_user)):
    row = db.query(models.ApplicationProfile).filter(
        models.ApplicationProfile.user_id == current_user.id
    ).first()
    if not row:
        # Seeded from the account so the form starts half-filled rather than
        # empty — the name and email are already known.
        row = models.ApplicationProfile(
            user_id=current_user.id,
            full_name=current_user.name,
            email=current_user.email,
            phone=getattr(current_user, "phone", None),
            city=getattr(current_user, "location", None),
            linkedin=getattr(current_user, "linkedin", None),
            website=getattr(current_user, "website", None),
        )
        db.add(row)
        db.commit()
        db.refresh(row)
    return row


@router.put("", response_model=schemas.ApplicationProfileOut)
def update_profile(payload: schemas.ApplicationProfileIn, db: Session = Depends(get_db),
                   current_user: models.User = Depends(get_current_user)):
    row = db.query(models.ApplicationProfile).filter(
        models.ApplicationProfile.user_id == current_user.id
    ).first()
    if not row:
        row = models.ApplicationProfile(user_id=current_user.id)
        db.add(row)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(row, field, value)
    db.commit()
    db.refresh(row)
    return row
