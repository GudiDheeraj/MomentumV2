import os
import re

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.orm import Session

from .. import models, schemas
from ..ats_scorer import score_resume_against_job
from ..auth import get_current_user
from ..database import get_db
from ..ai.engine import generate_cover_letter
from ..doc_export import text_to_pdf_bytes, text_to_docx_bytes
from ..resume_text import extract_text_from_file

router = APIRouter(prefix="/api/cover-letter", tags=["cover-letter"])

UPLOAD_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "..", "uploads")
UPLOAD_DIR = os.path.abspath(UPLOAD_DIR)

DOCX_MEDIA = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"


def _safe_stem(*parts: str) -> str:
    base = " ".join(p for p in parts if p).strip()
    base = re.sub(r"[^\w\-. ]", "", base).strip().replace(" ", "_")
    return base or "cover-letter"


@router.post("/generate", response_model=schemas.CoverLetterResult)
def generate(payload: schemas.CoverLetterRequest, db: Session = Depends(get_db),
             current_user: models.User = Depends(get_current_user)):
    resume = db.query(models.Resume).filter(
        models.Resume.id == payload.resume_id, models.Resume.user_id == current_user.id
    ).first()
    if not resume:
        raise HTTPException(404, "Resume not found")

    if not payload.job_description or len(payload.job_description.strip()) < 20:
        raise HTTPException(400, "Please paste a fuller job description (at least a few sentences) so the letter can be tailored to it.")

    resume_text = resume.extracted_text
    if not resume_text and resume.filename:
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

    rule_based = score_resume_against_job(resume_text, payload.job_description)
    result = generate_cover_letter(
        resume_text, payload.job_description,
        applicant_name=current_user.name,
        company_name=payload.company_name or "",
        role_title=payload.role_title or "",
        rule_based=rule_based,
    )
    letter = result["cover_letter"]
    return schemas.CoverLetterResult(cover_letter=letter, word_count=len(letter.split()), mode=result["mode"])


@router.post("/download")
def download(payload: schemas.CoverLetterDownload,
             current_user: models.User = Depends(get_current_user)):
    """Turns cover-letter text into a downloadable PDF or Word (.docx) file."""
    text = (payload.text or "").strip()
    if not text:
        raise HTTPException(400, "There's no cover letter text to download yet.")
    fmt = (payload.format or "pdf").lower()
    stem = _safe_stem(payload.company_name or "", payload.role_title or "", "cover letter")
    if fmt == "docx":
        data = text_to_docx_bytes(text)
        media, ext = DOCX_MEDIA, "docx"
    else:
        data = text_to_pdf_bytes(text)
        media, ext = "application/pdf", "pdf"
    return Response(
        content=data, media_type=media,
        headers={"Content-Disposition": f'attachment; filename="{stem}.{ext}"'},
    )
