import os

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import models, schemas
from ..ats_scorer import score_resume_against_job
from ..auth import get_current_user
from ..database import get_db
from ..ai.engine import analyze_resume_match
from ..resume_text import extract_text_from_file

router = APIRouter(prefix="/api/ats", tags=["ats"])

UPLOAD_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "..", "uploads")
UPLOAD_DIR = os.path.abspath(UPLOAD_DIR)


@router.post("/check", response_model=schemas.ATSCheckResult)
def check_ats(payload: schemas.ATSCheckRequest, db: Session = Depends(get_db),
              current_user: models.User = Depends(get_current_user)):
    resume = db.query(models.Resume).filter(
        models.Resume.id == payload.resume_id, models.Resume.user_id == current_user.id
    ).first()
    if not resume:
        raise HTTPException(404, "Resume not found")

    if not payload.job_description or len(payload.job_description.strip()) < 20:
        raise HTTPException(400, "Please paste a fuller job description (at least a few sentences) for an accurate score.")

    resume_text = resume.extracted_text
    if not resume_text and resume.filename:
        # Lazy extraction for resumes uploaded before ATS-checking existed
        filepath = os.path.join(UPLOAD_DIR, resume.filename)
        resume_text = extract_text_from_file(filepath)
        if resume_text:
            resume.extracted_text = resume_text
            db.commit()

    if not resume_text:
        raise HTTPException(
            400,
            "Couldn't read any text from this resume file (it may be a scanned image with no text layer). "
            "Try a text-based PDF/DOCX, or generate one with the Resume Builder.",
        )

    result = score_resume_against_job(resume_text, payload.job_description)

    # AI-enhanced layer: a natural-language assessment on top of the
    # deterministic score, generated locally (real local-LLM reasoning if a
    # model is configured, a still-genuinely-useful synthesized summary if
    # not — see app/ai/engine.py). No external AI API is called.
    ai = analyze_resume_match(resume_text, payload.job_description, result)
    result["ai_summary"] = ai.get("summary")
    result["ai_mode"] = ai.get("mode")

    return schemas.ATSCheckResult(**result)
