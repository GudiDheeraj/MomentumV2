import os
import re
import uuid

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from fastapi.responses import FileResponse, Response
from sqlalchemy.orm import Session

from .. import models, schemas
from ..auth import get_current_user
from ..database import get_db
from ..doc_export import text_to_pdf_bytes, text_to_docx_bytes
from ..resume_text import extract_text_from_file

router = APIRouter(prefix="/api/resumes", tags=["resumes"])

DOCX_MEDIA = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"

UPLOAD_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "..", "uploads")
UPLOAD_DIR = os.path.abspath(UPLOAD_DIR)
os.makedirs(UPLOAD_DIR, exist_ok=True)


# Only document formats a résumé can plausibly be. This is an allowlist, not
# a denylist, and it is security-critical: uploads are served from the
# /uploads static mount on the SAME ORIGIN as the app, so permitting .html
# or .svg would let any user store a page that executes JavaScript in that
# origin and reads another user's auth token out of localStorage. The
# extension is also re-derived here rather than trusted from the client.
ALLOWED_RESUME_EXTS = {".pdf", ".doc", ".docx", ".odp"}
MAX_RESUME_BYTES = 1 * 1024 * 1024  # 1 MB


def _safe_resume_extension(client_filename: str) -> str:
    """Returns a vetted, lowercased extension, or raises 400.

    Only the final extension is considered, and it must be on the allowlist.
    Note the stored name is always `<uuid4><ext>`, so the client filename
    never reaches the filesystem — this guards content type, not traversal.
    """
    ext = os.path.splitext(client_filename or "")[1].lower()
    if ext not in ALLOWED_RESUME_EXTS:
        allowed = ", ".join(sorted(ALLOWED_RESUME_EXTS))
        raise HTTPException(400, f"Unsupported file type '{ext or 'none'}'. Allowed: {allowed}")
    return ext


def _save_upload_capped(upload: UploadFile, dest_path: str) -> None:
    """Streams an upload to disk, aborting past MAX_RESUME_BYTES.

    Written in chunks with a running total rather than reading the whole
    body: an unbounded copyfileobj lets one request exhaust disk or memory.
    A rejected upload is removed so partial files don't accumulate.
    """
    total = 0
    try:
        with open(dest_path, "wb") as buffer:
            while True:
                chunk = upload.file.read(1024 * 64)
                if not chunk:
                    break
                total += len(chunk)
                if total > MAX_RESUME_BYTES:
                    raise HTTPException(413, f"File is too large. Maximum size is {MAX_RESUME_BYTES // (1024 * 1024)}MB.")
                buffer.write(chunk)
    except Exception:
        if os.path.exists(dest_path):
            try:
                os.remove(dest_path)
            except OSError:
                pass
        raise


@router.post("", response_model=schemas.ResumeOut)
def create_resume(
    name: str = Form(...),
    notes: str = Form(None),
    file: UploadFile = File(None),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    filename = None
    extracted_text = None
    if file is not None:
        ext = _safe_resume_extension(file.filename)
        filename = f"{uuid.uuid4().hex}{ext}"
        dest_path = os.path.join(UPLOAD_DIR, filename)
        _save_upload_capped(file, dest_path)
        extracted_text = extract_text_from_file(dest_path)

    resume = models.Resume(user_id=current_user.id, name=name, filename=filename, notes=notes,
                            extracted_text=extracted_text)
    db.add(resume)
    db.commit()
    db.refresh(resume)
    return resume


@router.get("", response_model=list[schemas.ResumeOut])
def list_resumes(db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    return db.query(models.Resume).filter(models.Resume.user_id == current_user.id).order_by(
        models.Resume.created_at.desc()).all()


@router.patch("/{resume_id}", response_model=schemas.ResumeOut)
def update_resume_meta(resume_id: int, payload: schemas.ResumeUpdate,
                       db: Session = Depends(get_db),
                       current_user: models.User = Depends(get_current_user)):
    """Updates a resume's label metadata (name, notes) without touching the
    file or its structured builder data — renaming shouldn't require
    regenerating the PDF."""
    resume = db.query(models.Resume).filter(models.Resume.id == resume_id,
                                            models.Resume.user_id == current_user.id).first()
    if not resume:
        raise HTTPException(404, "Resume not found")
    updates = payload.model_dump(exclude_unset=True)
    if "name" in updates:
        name = (updates["name"] or "").strip()
        if not name:
            raise HTTPException(400, "Resume name can't be empty")
        resume.name = name[:200]
    if "notes" in updates:
        resume.notes = updates["notes"]
    db.commit()
    db.refresh(resume)
    return resume


@router.get("/{resume_id}/download")
def download_resume(resume_id: int, format: str = "pdf",
                    db: Session = Depends(get_db),
                    current_user: models.User = Depends(get_current_user)):
    """Downloads a résumé as PDF or Word (.docx).

    When the stored file is already in the requested format it's served as-is
    (keeping the designed layout). Otherwise a clean document is generated from
    the résumé's extracted text so the user still gets the format they asked
    for."""
    resume = db.query(models.Resume).filter(models.Resume.id == resume_id,
                                            models.Resume.user_id == current_user.id).first()
    if not resume:
        raise HTTPException(404, "Resume not found")

    fmt = (format or "pdf").lower()
    if fmt not in ("pdf", "docx"):
        fmt = "pdf"
    stem = re.sub(r"[^\w\-. ]", "", resume.name or "resume").strip().replace(" ", "_") or "resume"
    media = "application/pdf" if fmt == "pdf" else DOCX_MEDIA

    path = os.path.join(UPLOAD_DIR, resume.filename) if resume.filename else None
    stored_ext = os.path.splitext(resume.filename or "")[1].lower().lstrip(".")

    # Original file already in the requested format → serve it untouched.
    if path and os.path.exists(path) and stored_ext == fmt:
        return FileResponse(path, media_type=media, filename=f"{stem}.{fmt}")

    # Otherwise build one from the résumé's text.
    text = resume.extracted_text
    if not text and path and os.path.exists(path):
        text = extract_text_from_file(path)
    if not text or not text.strip():
        raise HTTPException(
            400,
            "This résumé has no readable text to convert to that format. "
            "Download it from the Resume Library in its original format instead.",
        )
    data = text_to_docx_bytes(text, title=resume.name) if fmt == "docx" else text_to_pdf_bytes(text, title=resume.name)
    return Response(content=data, media_type=media,
                    headers={"Content-Disposition": f'attachment; filename="{stem}.{fmt}"'})


@router.delete("/{resume_id}")
def delete_resume(resume_id: int, db: Session = Depends(get_db),
                   current_user: models.User = Depends(get_current_user)):
    resume = db.query(models.Resume).filter(models.Resume.id == resume_id,
                                             models.Resume.user_id == current_user.id).first()
    if not resume:
        raise HTTPException(404, "Resume not found")
    if resume.filename:
        path = os.path.join(UPLOAD_DIR, resume.filename)
        if os.path.exists(path):
            os.remove(path)
    db.delete(resume)
    db.commit()
    return {"ok": True}
