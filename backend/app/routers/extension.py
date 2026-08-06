from datetime import date as date_cls

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import models, schemas
from ..ai.engine import extract_job_posting
from ..ats_scorer import score_resume_against_job
from ..auth import get_current_user
from ..database import get_db
from .. import billing
from ..resume_pdf import resolve_template
from .resume_builder import tailor_for_job
from .cover_letter import generate as generate_cover_letter_endpoint

router = APIRouter(prefix="/api/extension", tags=["extension"])


@router.get("/ping")
def ping(current_user: models.User = Depends(get_current_user)):
    """Used by the extension to verify the stored token/backend URL are still valid."""
    return {"ok": True, "user": current_user.email}


@router.post("/extract", response_model=schemas.ExtensionExtractResult)
def extract(payload: schemas.ExtensionExtractRequest, current_user: models.User = Depends(get_current_user)):
    """
    AI-assisted field mapping for the Chrome extension. The content script
    can't reliably target every job board's markup with CSS selectors (they
    change constantly, and plenty of sites — ATS platforms, small company
    career pages — have no common structure at all), so it also sends a
    large raw text dump of the page. This reads that dump (real generative
    extraction in "llm" mode, a noise-filtering + title-parsing heuristic
    in "lite" mode) and returns clean fields that work on any job site, not
    just the handful with hardcoded selectors.
    """
    result = extract_job_posting(
        raw_text=payload.raw_text,
        title=payload.title or "",
        url=payload.url or "",
        hint_role=payload.hint_role or "",
        hint_company=payload.hint_company or "",
        hint_location=payload.hint_location or "",
    )
    return schemas.ExtensionExtractResult(**result)


@router.post("/capture", response_model=schemas.ExtensionCaptureResult)
def capture_job(payload: schemas.ExtensionCaptureRequest, db: Session = Depends(get_db),
                 current_user: models.User = Depends(get_current_user)):
    """
    One-click entry point for the Chrome extension. Given what it scraped off
    a job posting page, this:
      1. Creates the job application entry.
      2. If a resume is selected and it's a Resume-Builder resume, generates
         a tailored copy for this job and links it.
      3. Generates a cover letter from the (tailored, if available, else
         original) resume and this job description.
      4. Scores the resume against the job description (ATS match).
    Any step that can't run (no resume selected, no job description, etc.)
    is skipped rather than failing the whole request — the job entry is
    always created either way, and `notes` explains what was skipped.
    """
    notes: list[str] = []

    # The quota gate. 402 rather than 403: this is not "you may not", it is
    # "you may, once you pay", and the extension keys its upgrade panel off
    # exactly this status. The payload carries the numbers so the client can
    # say "15 of 15" without a second round trip.
    quota = billing.capture_quota(db, current_user)
    if quota["exhausted"]:
        raise HTTPException(
            status_code=402,
            detail={
                "error": "capture_limit_reached",
                "message": (
                    f"You have used all {quota['limit']} captures on the "
                    f"{quota['plan_name']} plan this month."
                ),
                **quota,
            },
        )

    # board_id/resume_id are client-supplied foreign keys — verify they
    # actually belong to this user before attaching them to the new job,
    # otherwise a crafted payload could point a job at another tenant's
    # board or resume.
    board_id = payload.board_id
    if board_id and not db.query(models.JobBoard).filter(
        models.JobBoard.id == board_id, models.JobBoard.user_id == current_user.id,
    ).first():
        board_id = None
        notes.append("Selected board wasn't found — saved to your default board instead.")

    resume = None
    if payload.resume_id:
        resume = db.query(models.Resume).filter(
            models.Resume.id == payload.resume_id, models.Resume.user_id == current_user.id
        ).first()
        if not resume:
            notes.append("Selected resume wasn't found — skipped tailoring and cover letter.")

    job = models.JobApplication(
        user_id=current_user.id,
        company_name=payload.company_name,
        role_title=payload.role_title,
        job_link=payload.job_link,
        date_applied=payload.date_applied or date_cls.today(),
        status=payload.status,
        location=payload.location,
        salary_range=payload.salary_range,
        source=payload.source or "Chrome Extension",
        job_description=payload.job_description,
        resume_id=resume.id if resume else None,
        # Which board the capture lands on, chosen in the popup's footer.
        # None means the account's default board, same as before.
        board_id=board_id,
    )
    db.add(job)
    db.commit()
    db.refresh(job)

    has_jd = bool(payload.job_description and len(payload.job_description.strip()) >= 20)
    if not has_jd:
        notes.append("Job description was too short (or missing) to tailor a resume or write a cover letter — "
                      "the application was still saved, add a fuller description on the site to unlock those.")

    tailored_resume = None
    active_resume = resume
    if resume and has_jd and payload.auto_tailor_resume:
        if resume.builder_data and resume.template_id:
            tailor_payload = schemas.TailorResumeRequest(
                resume_id=resume.id,
                job_description=payload.job_description,
                company_name=payload.company_name,
                role_title=payload.role_title,
                job_id=job.id,
            )
            tailored_resume = tailor_for_job(tailor_payload, db, current_user)
            # Honour the template chosen in the extension's settings. Without
            # this the tailored copy always inherited the source resume's
            # design, so the setting would have had no visible effect.
            if payload.template_id and resolve_template(payload.template_id)[1] is not None:
                tailored_resume.template_id = payload.template_id
                db.commit()
                db.refresh(tailored_resume)
            active_resume = tailored_resume
            db.refresh(job)
        else:
            notes.append("Selected resume wasn't made with the Resume Builder, so it can't be auto-tailored — "
                          "used it as-is for the cover letter instead.")

    cover_letter_text = None
    cover_letter_mode = None
    if active_resume and has_jd and payload.auto_cover_letter:
        cl_payload = schemas.CoverLetterRequest(
            resume_id=active_resume.id,
            job_description=payload.job_description,
            company_name=payload.company_name,
            role_title=payload.role_title,
        )
        cl_result = generate_cover_letter_endpoint(cl_payload, db, current_user)
        cover_letter_text = cl_result.cover_letter
        cover_letter_mode = cl_result.mode
        job.cover_letter = cover_letter_text

    ats_score = None
    if active_resume and active_resume.extracted_text and has_jd:
        breakdown = score_resume_against_job(active_resume.extracted_text, payload.job_description)
        ats_score = breakdown.get("score")
        job.ats_score = ats_score

    db.commit()
    db.refresh(job)

    return schemas.ExtensionCaptureResult(
        job=job,
        tailored_resume=tailored_resume,
        cover_letter=cover_letter_text,
        cover_letter_mode=cover_letter_mode,
        ats_score=ats_score,
        notes=notes,
    )


@router.get("/quota")
def capture_quota(db: Session = Depends(get_db),
                  current_user: models.User = Depends(get_current_user)):
    """What is left this month. Read by the extension on open so the counter
    is visible before the last capture rather than after it."""
    return billing.capture_quota(db, current_user)
