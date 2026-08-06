"""Resume Review endpoint.

Sits alongside routers/ats.py rather than inside it, because the two answer
different questions. /api/ats/check asks "how well does this saved resume
match this specific job?" and requires both. /api/review/analyze asks "how
good is this resume?" — it works on an unsaved builder draft, and a job
description is optional rather than required.
"""
import json
import os

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import models, schemas
from ..auth import get_current_user
from ..database import get_db
from ..resume_review import review_resume
from ..resume_text import extract_text_from_file

router = APIRouter(prefix="/api/review", tags=["review"])

UPLOAD_DIR = os.path.abspath(
    os.path.join(os.path.dirname(os.path.dirname(__file__)), "..", "uploads")
)


def _page_count(filepath: str):
    """Page count for an uploaded PDF, or None when it can't be determined.

    Kept out of resume_review.py deliberately: the analyser is pure and
    stdlib-only, so anything that touches the filesystem or pypdf is resolved
    here and passed in as a plain number.
    """
    if not filepath or not filepath.lower().endswith(".pdf"):
        return None
    try:
        from pypdf import PdfReader
        return len(PdfReader(filepath).pages)
    except Exception:
        return None


@router.post("/analyze", response_model=schemas.ResumeReviewResult)
def analyze(payload: schemas.ResumeReviewRequest,
            db: Session = Depends(get_db),
            current_user: models.User = Depends(get_current_user)):
    resume_text, builder_data, page_count = None, None, None

    # An unsaved draft sends its form values inline. This is what lets the
    # Review tab work on a resume the user has been editing but hasn't saved.
    if payload.builder_data:
        builder_data = payload.builder_data

    elif payload.resume_id:
        resume = db.query(models.Resume).filter(
            models.Resume.id == payload.resume_id,
            models.Resume.user_id == current_user.id,
        ).first()
        if not resume:
            raise HTTPException(404, "Resume not found")

        if resume.builder_data:
            # Built here: the structured form data is strictly richer than the
            # rendered text — it keeps roles, bullets and sections separated,
            # so bullet-level analysis doesn't have to re-derive them.
            try:
                builder_data = json.loads(resume.builder_data)
            except (ValueError, TypeError):
                builder_data = None

        if builder_data is None:
            resume_text = resume.extracted_text
            filepath = os.path.join(UPLOAD_DIR, resume.filename) if resume.filename else None
            if not resume_text and filepath:
                # Same lazy backfill as /api/ats/check, for resumes uploaded
                # before text extraction was stored.
                resume_text = extract_text_from_file(filepath)
                if resume_text:
                    resume.extracted_text = resume_text
                    db.commit()
            page_count = _page_count(filepath)

        if not builder_data and not resume_text:
            raise HTTPException(
                400,
                "Couldn't read any text from this resume file (it may be a scanned image "
                "with no text layer). Try a text-based PDF/DOCX, or build one in the "
                "Resume Builder.",
            )
    else:
        raise HTTPException(400, "Provide either a resume_id or builder_data to review.")

    # A job description can be pasted directly or pulled from a saved
    # application, so reviewing against a job already in the pipeline doesn't
    # mean copying its description back out by hand.
    job_description = payload.job_description
    if not job_description and payload.job_id:
        job = db.query(models.JobApplication).filter(
            models.JobApplication.id == payload.job_id,
            models.JobApplication.user_id == current_user.id,
        ).first()
        if job:
            job_description = job.job_description

    # Too little to match against is worse than nothing: it produces a
    # confident-looking match score built on three words. Below the threshold
    # the review silently runs in general mode instead.
    if job_description and len(job_description.strip()) < 40:
        job_description = None

    try:
        result = review_resume(
            resume_text=resume_text,
            builder_data=builder_data,
            job_description=job_description,
            page_count=page_count,
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc))

    return schemas.ResumeReviewResult(**result)
