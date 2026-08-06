"""The signed-in person's own profile: their photo and the lines that go with it.

The app knew a name and an email and nothing else, which is why the sidebar had
nothing to show and the résumé templates that expect a photo had to fall back to
an initials disc. This router owns that small amount of state.

The photo is deliberately handled like every other upload in this codebase: the
client filename is never trusted, the extension is re-derived and checked against
an allowlist, the byte length is capped while streaming, and the stored name is a
uuid. Avatars live in uploads/avatars, which is served by the same static mount —
and that mount forces `Content-Disposition: attachment` plus a null CSP, so even
a file that lies about its type can't execute against this origin.
"""

import os
import uuid

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy.orm import Session

from .. import models, schemas
from ..auth import get_current_user
from ..database import get_db

router = APIRouter(prefix="/api/profile", tags=["profile"])

AVATAR_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "..", "uploads", "avatars")
AVATAR_DIR = os.path.abspath(AVATAR_DIR)
os.makedirs(AVATAR_DIR, exist_ok=True)

# Raster formats only. SVG is a document that can carry script, and this file is
# served from the app's own origin — the static mount neutralises it, but an
# avatar has no reason to be one in the first place.
ALLOWED_IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp"}
MAX_AVATAR_BYTES = 4 * 1024 * 1024

# The first bytes of each format we accept. A file whose extension says PNG but
# whose body says something else is rejected: the extension is a claim, this is
# evidence.
_MAGIC = (
    (b"\x89PNG\r\n\x1a\n", "png"),
    (b"\xff\xd8\xff", "jpg"),
    (b"RIFF", "webp"),
)


# The photo is drawn into a circle a little under an inch across, but what
# arrives is whatever the camera produced — the avatars sitting on disk when
# this was written ran to 1.4MB and 2.2MB. ReportLab embeds the source bytes at
# full resolution on every render, so a single holiday snap made each preview
# slow to build, slow to send and slow for pdf.js to parse. It also pushed the
# rendered PDF past the 4MB ceiling the editor's byte cache refuses to hold,
# which is why photo templates were the only ones going back to the server for
# something as small as a font-size change.
AVATAR_MAX_PX = 1024                    # ceiling on the long edge
AVATAR_MIN_PX = 320                     # never shrink past a usable portrait
AVATAR_TARGET_BYTES = 500 * 1024        # the size budget an avatar has to meet


def _shrink_avatar(path: str) -> None:
    """Bring the stored avatar under the size budget, in place.

    Two separate limits, because either one alone leaves a bad case through: a
    dimension cap lets a large, noisy photo stay heavy, and a byte cap alone
    would accept a 6000px image that happens to compress well and then make
    ReportLab scale it on every render.

    Encoders don't let you ask for a byte count, so this steps down — quality
    first where the format has it, then dimensions — and stops at the first
    result inside budget. Best-effort on purpose: if it fails the photo is
    still perfectly usable, just larger than it needs to be, and that is not
    worth failing an upload over.
    """
    try:
        from PIL import Image
    except Exception:
        return
    try:
        with Image.open(path) as opened:
            opened.load()
            im = opened.copy()
            fmt = (opened.format or "").upper()

        if max(im.size) > AVATAR_MAX_PX:
            im.thumbnail((AVATAR_MAX_PX, AVATAR_MAX_PX), Image.LANCZOS)

        def write(img, quality=None):
            kw = {"optimize": True}
            if fmt in ("JPEG", "WEBP") and quality is not None:
                kw["quality"] = quality
            img.save(path, format=fmt or None, **kw)
            return os.path.getsize(path)

        # JPEG and WebP buy a lot from quality alone, and losing a little
        # chroma detail is far less visible than losing pixels.
        for quality in (85, 72, 60):
            if write(im, quality) <= AVATAR_TARGET_BYTES:
                return
            if fmt not in ("JPEG", "WEBP"):
                break   # PNG is lossless; quality is not a lever there

        # Still over: step the dimensions down until it fits or bottoms out.
        while max(im.size) > AVATAR_MIN_PX:
            side = max(int(max(im.size) * 0.8), AVATAR_MIN_PX)
            im.thumbnail((side, side), Image.LANCZOS)
            if write(im, 72) <= AVATAR_TARGET_BYTES:
                return
    except Exception:
        pass


def _avatar_url(user: models.User) -> str | None:
    return f"/uploads/avatars/{user.avatar_file}" if user.avatar_file else None


def _profile_payload(user: models.User) -> dict:
    return {
        "id": user.id,
        "name": user.name,
        "email": user.email,
        "headline": user.headline,
        "location": user.location,
        "phone": user.phone,
        "website": user.website,
        "linkedin": user.linkedin,
        "avatar_url": _avatar_url(user),
        "initials": "".join(p[0] for p in (user.name or "").split()[:2]).upper() or "?",
    }


@router.get("")
def read_profile(current_user: models.User = Depends(get_current_user)):
    return _profile_payload(current_user)


@router.put("")
def update_profile(payload: schemas.ProfileUpdate,
                   db: Session = Depends(get_db),
                   current_user: models.User = Depends(get_current_user)):
    data = payload.model_dump(exclude_unset=True)
    if "name" in data:
        name = (data["name"] or "").strip()
        if not name:
            raise HTTPException(400, "Name can't be empty")
        current_user.name = name[:150]
    for field, limit in (("headline", 200), ("location", 120), ("phone", 60),
                         ("website", 200), ("linkedin", 200)):
        if field in data:
            value = (data[field] or "").strip()
            setattr(current_user, field, value[:limit] or None)
    # No refresh: the object we were handed is the one we just updated, and
    # refreshing assumes it belongs to this session — which it need not.
    db.commit()
    return _profile_payload(current_user)


@router.post("/photo")
def upload_photo(file: UploadFile = File(...),
                 db: Session = Depends(get_db),
                 current_user: models.User = Depends(get_current_user)):
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext == ".jpeg":
        ext = ".jpg"
    if ext not in ALLOWED_IMAGE_EXTS:
        raise HTTPException(400, "Use a PNG, JPG or WebP image")

    stored = f"{uuid.uuid4().hex}{ext}"
    dest = os.path.join(AVATAR_DIR, stored)
    total, head = 0, b""
    try:
        with open(dest, "wb") as out:
            while True:
                chunk = file.file.read(64 * 1024)
                if not chunk:
                    break
                if not head:
                    head = chunk[:12]
                total += len(chunk)
                if total > MAX_AVATAR_BYTES:
                    raise HTTPException(413, "That image is over 4MB — try a smaller one")
                out.write(chunk)
        if not any(head.startswith(sig) for sig, _ in _MAGIC):
            raise HTTPException(400, "That file isn't a PNG, JPG or WebP image")
    except Exception:
        if os.path.exists(dest):
            try:
                os.remove(dest)
            except OSError:
                pass
        raise

    _shrink_avatar(dest)

    previous = current_user.avatar_file
    current_user.avatar_file = stored
    db.commit()
    # Only unlink the old file once the new one is committed, so a failed write
    # can never leave the account with no photo at all.
    if previous and previous != stored:
        try:
            os.remove(os.path.join(AVATAR_DIR, previous))
        except OSError:
            pass
    return _profile_payload(current_user)


@router.delete("/photo")
def delete_photo(db: Session = Depends(get_db),
                 current_user: models.User = Depends(get_current_user)):
    stored = current_user.avatar_file
    current_user.avatar_file = None
    db.commit()
    if stored:
        try:
            os.remove(os.path.join(AVATAR_DIR, stored))
        except OSError:
            pass
    return _profile_payload(current_user)
