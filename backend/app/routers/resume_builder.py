import os
import uuid
import json
import shutil
import tempfile

from fastapi import APIRouter, Depends, HTTPException, Response, UploadFile, File
from sqlalchemy.orm import Session

from .. import models, schemas
from ..ats_scorer import score_resume_against_job
from ..cache import TTL_PDF, get_bytes, make_key, memoize_static, set_bytes
from ..auth import get_current_user
from ..database import get_db
from ..ai.engine import tailor_resume_for_job, write_resume_section, parse_resume_document
from ..job_templates import role_template_fields
from ..resume_pdf import TEMPLATES, build_resume_pdf, build_plain_text, resolve_template, template_name
from ..resume_text import extract_text_from_file
from .resumes import _safe_resume_extension, MAX_RESUME_BYTES

router = APIRouter(prefix="/api/resume-builder", tags=["resume-builder"])

UPLOAD_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "..", "uploads")
UPLOAD_DIR = os.path.abspath(UPLOAD_DIR)
AVATAR_DIR = os.path.join(UPLOAD_DIR, "avatars")
os.makedirs(UPLOAD_DIR, exist_ok=True)


@router.post("/parse-upload")
def parse_uploaded_resume(file: UploadFile = File(...),
                          current_user: models.User = Depends(get_current_user)):
    """Reads an uploaded résumé (PDF/DOC/DOCX/TXT/RTF/ODT) and returns it as
    structured Resume Builder fields, so it can be dropped straight into the
    editor instead of just sitting on disk as a static file. Nothing is
    saved here — the file is written to a throwaway temp dir purely to
    extract its text, then deleted; the resume itself is only persisted
    when the user hits Save from the builder, same as a resume built from
    scratch.
    """
    ext = _safe_resume_extension(file.filename)
    tmp_dir = tempfile.mkdtemp(prefix="resume_parse_")
    tmp_path = os.path.join(tmp_dir, f"upload{ext}")
    try:
        total = 0
        with open(tmp_path, "wb") as buffer:
            while True:
                chunk = file.file.read(1024 * 64)
                if not chunk:
                    break
                total += len(chunk)
                if total > MAX_RESUME_BYTES:
                    raise HTTPException(413, f"File is too large. Maximum size is {MAX_RESUME_BYTES // (1024 * 1024)}MB.")
                buffer.write(chunk)

        text = extract_text_from_file(tmp_path)
        if not text.strip():
            raise HTTPException(
                422,
                "Couldn't read any text from that file — it may be a scanned image with no "
                "text layer, password-protected, or empty. Try a text-based PDF or DOCX.",
            )
        data = parse_resume_document(text)
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)

    fallback_name = os.path.splitext(file.filename or "Uploaded Resume")[0]
    resume_name = f"{data['full_name']}'s Resume" if data.get("full_name") else fallback_name
    return {"data": data, "resume_name": resume_name[:200], "mode": data.get("mode", "lite")}



# The photo is never taken from the request: a client could otherwise name any
# path on the server and have it drawn into a PDF. It is looked up from the
# signed-in account, and only for templates that actually have a picture slot.
def _with_account_photo(data: dict, template_id: str, user: models.User) -> dict:
    tpl = resolve_template(template_id)[1] or {}
    data = dict(data)
    data.pop("photo_path", None)
    if tpl.get("photo") and getattr(user, "avatar_file", None):
        path = os.path.join(AVATAR_DIR, user.avatar_file)
        if os.path.exists(path):
            data["photo_path"] = path
    return data


# The catalogue is built from module-level constants, so it is identical for
# every caller and for the whole life of the process. It was being rebuilt from
# scratch on every request — 37 dict comprehensions to return the same bytes.
@memoize_static
def _templates_payload():
    out = []
    for tid, t in TEMPLATES.items():
        # Preset-driven templates carry their look in "_preset"; templates with
        # a hand-written builder declare the same descriptors on themselves, so
        # the Design tab can draw an accurate thumbnail either way.
        p = t.get("_preset") or t
        out.append({
            "id": tid, "name": t["name"], "description": t["description"],
            "accent": p.get("accent"), "family": p.get("family", "single"),
            "header": p.get("header", "left"), "sec": p.get("sec", "rule"),
            "skills": p.get("skills", "cat"), "mode": p.get("mode"), "side": p.get("side"),
            "border": bool(p.get("border")), "timeline": bool(p.get("timeline")),
            # True when the layout has a picture slot — the builder only offers
            # the photo control for these.
            "photo": bool(t.get("photo")),
            "font": p.get("font"),
        })
    return out


# No ETag handling here on purpose. app/main.py already runs a `conditional_get`
# middleware that hashes the body of every GET /api/ response and answers a
# matching If-None-Match with a 304 — adding a second ETag at the endpoint
# emitted the header twice, and a client echoing back the joined value matched
# neither, so conditional requests silently stopped working. The middleware is
# the right layer for this; what these endpoints needed was only to stop
# *rebuilding* an unchanging payload on every call.
@router.get("/templates")
def list_templates():
    return _templates_payload()


@memoize_static
def _role_templates_payload():
    return {"fields": role_template_fields()}


@router.get("/role-templates")
def list_role_templates():
    """Which templates suit which job, for the Design tab's role picker.

    Unauthenticated like /templates: it is static curated data with nothing
    user-specific in it, and the picker is rendered before a customer has
    necessarily signed in.
    """
    return _role_templates_payload()


@router.post("/generate", response_model=schemas.ResumeOut)
def generate_resume(payload: schemas.ResumeBuilderRequest, db: Session = Depends(get_db),
                     current_user: models.User = Depends(get_current_user)):
    if resolve_template(payload.template_id)[1] is None:
        raise HTTPException(400, f"Unknown template_id: {payload.template_id!r}. No resume templates are available yet.")
    if not payload.full_name or not payload.full_name.strip():
        raise HTTPException(400, "Full name is required")

    data = _with_account_photo(payload.model_dump(exclude={"template_id", "resume_name"}),
                               payload.template_id, current_user)
    filename = f"{uuid.uuid4().hex}.pdf"
    output_path = os.path.join(UPLOAD_DIR, filename)

    try:
        build_resume_pdf(payload.template_id, data, output_path)
    except Exception as e:
        raise HTTPException(500, f"Couldn't generate the PDF: {e}")

    plain_text = build_plain_text(data)
    resume = models.Resume(
        user_id=current_user.id,
        name=payload.resume_name or f"{payload.full_name} - {template_name(payload.template_id)}",
        filename=filename,
        notes=f"Generated with the Resume Builder ({template_name(payload.template_id)} template)",
        extracted_text=plain_text,
        template_id=payload.template_id,
        # The photo path is server state, not the customer's document — it is
        # re-derived from the account on every render, so it isn't persisted.
        builder_data=json.dumps({k: v for k, v in data.items() if k != "photo_path"}),
    )
    db.add(resume)
    db.commit()
    db.refresh(resume)
    return resume


@router.get("/{resume_id}/data")
def get_builder_data(resume_id: int, db: Session = Depends(get_db),
                      current_user: models.User = Depends(get_current_user)):
    """Fetch a previously-generated resume's form data back out, so it can be re-edited."""
    resume = db.query(models.Resume).filter(models.Resume.id == resume_id,
                                             models.Resume.user_id == current_user.id).first()
    if not resume or not resume.builder_data:
        raise HTTPException(404, "No editable builder data found for this resume")
    return {"template_id": resume.template_id, "resume_name": resume.name, "data": json.loads(resume.builder_data)}


@router.put("/{resume_id}", response_model=schemas.ResumeOut)
def update_resume(resume_id: int, payload: schemas.ResumeBuilderRequest,
                  db: Session = Depends(get_db),
                  current_user: models.User = Depends(get_current_user)):
    """Re-renders an existing builder resume in place.

    Without this, saving an edit meant POSTing to /generate, which creates a
    brand-new resume — so revising a CV three times left four near-identical
    entries behind, and any job application pointing at the original kept
    referencing the stale version. Updating in place keeps resume_id stable,
    so every linked application follows the edit automatically.
    """
    resume = db.query(models.Resume).filter(models.Resume.id == resume_id,
                                            models.Resume.user_id == current_user.id).first()
    if not resume:
        raise HTTPException(404, "Resume not found")
    if resolve_template(payload.template_id)[1] is None:
        raise HTTPException(400, f"Unknown template_id: {payload.template_id!r}. No resume templates are available yet.")
    if not payload.full_name or not payload.full_name.strip():
        raise HTTPException(400, "Full name is required")

    data = _with_account_photo(payload.model_dump(exclude={"template_id", "resume_name"}),
                               payload.template_id, current_user)
    new_filename = f"{uuid.uuid4().hex}.pdf"
    output_path = os.path.join(UPLOAD_DIR, new_filename)
    try:
        build_resume_pdf(payload.template_id, data, output_path)
    except Exception as e:
        raise HTTPException(500, f"Couldn't regenerate the PDF: {e}")

    old_filename = resume.filename
    resume.name = payload.resume_name or resume.name
    resume.filename = new_filename
    resume.extracted_text = build_plain_text(data)
    resume.template_id = payload.template_id
    resume.builder_data = json.dumps({k: v for k, v in data.items() if k != "photo_path"})
    db.commit()
    db.refresh(resume)

    # Remove the superseded PDF only after the row commits, so a failure
    # above can never leave the resume pointing at a file we deleted.
    if old_filename and old_filename != new_filename:
        try:
            os.remove(os.path.join(UPLOAD_DIR, old_filename))
        except OSError:
            pass  # already gone, or not removable — harmless either way

    return resume


@router.post("/preview")
def preview_resume(payload: schemas.ResumeBuilderRequest,
                   current_user: models.User = Depends(get_current_user)):
    """Renders the resume PDF and streams it straight back WITHOUT saving.

    This backs the editor's live preview and its Download button. Reusing
    /generate would create a database row and a stored file on every keystroke,
    so the preview renders to a temp file, streams it, and deletes it. Nothing
    is persisted — the library only changes when the customer saves.

    PDF only. A Word export was offered here briefly, built from the résumé's
    plain text because the templates use absolute positioning Word has no
    equivalent for. That threw away the template the customer had just chosen,
    which made it a worse copy of their own document rather than a second
    useful format.
    """
    if resolve_template(payload.template_id)[1] is None:
        raise HTTPException(400, f"Unknown template_id: {payload.template_id!r}. No resume templates are available yet.")

    data = _with_account_photo(payload.model_dump(exclude={"template_id", "resume_name"}),
                               payload.template_id, current_user)

    # This endpoint is called far more than its name suggests: the Design tab
    # fires it 37 times to fill the template grid, and again for the live
    # preview on a debounce while the customer types. The same résumé in the
    # same template with the same design settings produces byte-identical
    # output every time, so it is worth keeping.
    #
    # The key is a hash of `data` *after* the account photo has been resolved
    # into it, plus the template id. That matters: photo templates embed the
    # user's picture, so keying on the request body alone would let one
    # customer's preview be served to another. Hashing the fully-resolved
    # render input makes the key describe exactly what goes into the PDF, and
    # two users with identical content and no photo genuinely can share it.
    key = make_key("pdf", payload.template_id, data)
    cached_pdf = get_bytes(key)
    if cached_pdf:
        return _pdf_response(cached_pdf, cached=True)

    tmp_dir = tempfile.mkdtemp(prefix="resume_preview_")
    tmp_path = os.path.join(tmp_dir, "preview.pdf")
    try:
        build_resume_pdf(payload.template_id, data, tmp_path)
        with open(tmp_path, "rb") as fh:
            pdf_bytes = fh.read()
    except Exception as e:
        raise HTTPException(500, f"Couldn't render the preview: {e}")
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)

    set_bytes(key, pdf_bytes, TTL_PDF)
    return _pdf_response(pdf_bytes, cached=False)


def _pdf_response(pdf_bytes: bytes, cached: bool) -> Response:
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": "inline; filename=preview.pdf",
            # Still no-store for the *browser*: a résumé preview is personal
            # data and shouldn't sit in a shared or on-disk HTTP cache. The
            # server-side cache above is keyed by content and never leaves the
            # backend, which is a different thing entirely.
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
            "X-Render-Cache": "hit" if cached else "miss",
        },
    )


@router.post("/{resume_id}/duplicate", response_model=schemas.ResumeOut)
def duplicate_resume(resume_id: int, db: Session = Depends(get_db),
                     current_user: models.User = Depends(get_current_user)):
    """Copies a builder resume so a variant can be made without touching the
    original — the safe way to produce a role-specific version."""
    src = db.query(models.Resume).filter(models.Resume.id == resume_id,
                                         models.Resume.user_id == current_user.id).first()
    if not src:
        raise HTTPException(404, "Resume not found")
    if not src.builder_data:
        raise HTTPException(400, "Only resumes created in the Resume Builder can be duplicated.")

    data = json.loads(src.builder_data)
    filename = f"{uuid.uuid4().hex}.pdf"
    try:
        build_resume_pdf(src.template_id, data, os.path.join(UPLOAD_DIR, filename))
    except Exception as e:
        raise HTTPException(500, f"Couldn't generate the PDF: {e}")

    copy = models.Resume(
        user_id=current_user.id,
        name=f"{src.name} (copy)",
        filename=filename,
        notes=src.notes,
        extracted_text=src.extracted_text,
        template_id=src.template_id,
        builder_data=src.builder_data,
    )
    db.add(copy)
    db.commit()
    db.refresh(copy)
    return copy


@router.post("/ai-assist")
def ai_assist(payload: schemas.ResumeAiAssistRequest,
              current_user: models.User = Depends(get_current_user)):
    """Backs the builder's 'write with AI' spark buttons. Returns drafted copy
    for a single section; runs locally (LLM if installed, lite otherwise)."""
    kind = (payload.kind or "").strip().lower()
    if kind not in {"summary", "bullets", "role", "skills"}:
        raise HTTPException(400, "kind must be one of: summary, bullets, role, skills")
    result = write_resume_section(kind, {
        "title": payload.title or "",
        "existing": payload.existing or "",
        "company": payload.company or "",
        "skills": payload.skills or "",
    })
    return result


@router.post("/tailor-for-job", response_model=schemas.ResumeOut)
def tailor_for_job(payload: schemas.TailorResumeRequest, db: Session = Depends(get_db),
                    current_user: models.User = Depends(get_current_user)):
    """Regenerates a Resume-Builder resume, in the exact same template, with
    its summary and skills ordering tailored to a specific job description
    (experience/education/projects are left untouched — nothing is
    invented). Saves the result as a new resume named after the company
    and role, and — if a job_id is given — points that application at the
    new tailored resume."""
    resume = db.query(models.Resume).filter(
        models.Resume.id == payload.resume_id, models.Resume.user_id == current_user.id
    ).first()
    if not resume:
        raise HTTPException(404, "Resume not found")
    if not resume.builder_data or not resume.template_id:
        raise HTTPException(
            400,
            "This feature works on resumes created with the Resume Builder, which have structured data "
            "to regenerate from. This resume was uploaded as a file, so it can't be automatically "
            "reformatted yet — try building one with the Resume Builder first, then tailor that.",
        )
    if not payload.job_description or len(payload.job_description.strip()) < 20:
        raise HTTPException(400, "Please paste a fuller job description (at least a few sentences) so the tailoring is meaningful.")

    job = None
    if payload.job_id is not None:
        job = db.query(models.JobApplication).filter(
            models.JobApplication.id == payload.job_id, models.JobApplication.user_id == current_user.id
        ).first()
        if not job:
            raise HTTPException(404, "Job application not found")

    original_data = json.loads(resume.builder_data)
    rule_based = score_resume_against_job(resume.extracted_text or "", payload.job_description)
    result = tailor_resume_for_job(original_data, payload.job_description, rule_based)
    new_data = result["data"]

    filename = f"{uuid.uuid4().hex}.pdf"
    output_path = os.path.join(UPLOAD_DIR, filename)
    try:
        build_resume_pdf(resume.template_id, new_data, output_path)
    except Exception as e:
        raise HTTPException(500, f"Couldn't generate the tailored PDF: {e}")

    company = payload.company_name or (job.company_name if job else None)
    role = payload.role_title or (job.role_title if job else None)
    if company and role:
        new_name = f"{company} - {role} (ATS Tailored)"
    elif company:
        new_name = f"{company} (ATS Tailored)"
    else:
        new_name = f"{resume.name} (ATS Tailored)"

    tailored = models.Resume(
        user_id=current_user.id,
        name=new_name,
        # Tags this as a job-tailored variant so the library can separate it
        # from base resumes, and records which application it targets.
        tailored_for_job_id=payload.job_id,
        filename=filename,
        notes=f"AI-tailored from '{resume.name}' for {role or 'this role'}"
              f"{f' at {company}' if company else ''} (ATS score {rule_based.get('score', '?')}% -> "
              f"regenerated with matched keywords emphasized).",
        extracted_text=build_plain_text(new_data),
        template_id=resume.template_id,
        builder_data=json.dumps(new_data),
    )
    db.add(tailored)
    db.commit()
    db.refresh(tailored)

    if job:
        job.resume_id = tailored.id
        db.commit()

    return tailored
