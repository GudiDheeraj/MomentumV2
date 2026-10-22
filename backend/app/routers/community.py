"""Community — a shared, public feed.

The rest of this API is single-tenant by construction: every query filters on
current_user.id, and a missing filter is a bug that shows you someone else's
data. This router inverts that. Posts, comments and votes are global, and
current_user.id appears only to record who wrote a thing or to answer "did I
already vote on this". Any `.filter(user_id == current_user.id)` copied in
here from a neighbouring file would quietly turn the community into a private
notebook, which is the one failure mode that would look like it works.

Shape of it: topics behave like subreddits, posts carry a score and a comment
count, comments nest, and a vote is one row per person per target that toggles
rather than accumulates.

Identity is the account — name, photo and headline straight off the users row.
There is no handle to claim, so nothing stands between signing in and saying
something. The trade that buys is deliberate and worth stating plainly:
everyone here sees everyone else's real name. Email is never sent to this
surface, which is the one field on that row that would be a real leak rather
than the intended behaviour.
"""

import os
import uuid
from datetime import datetime, timedelta
from math import log10
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from fastapi.responses import FileResponse
from sqlalchemy import func
from sqlalchemy.orm import Session

from .. import models, schemas
from ..auth import get_current_user
from ..database import get_db

router = APIRouter(prefix="/api/community", tags=["community"])


# ---------------------------------------------------------------------------
# Seed topics
# ---------------------------------------------------------------------------
# Created on first read rather than in a migration: the community is inert
# until someone opens it, and a table of topics nobody can see is not worth a
# startup cost on every boot. The insert is guarded on slug, so running it on
# every list call is a no-op after the first.
SEED_TOPICS = [
    ("general", "General", "Anything that doesn't fit the other rooms", "#6366f1", "💬", 10),
    ("job-hunt", "Job Hunt", "Applications, rejections, offers and the wait in between", "#0ea5e9", "💼", 20),
    ("interviews", "Interviews", "Prep, questions you were asked, how it went", "#f59e0b", "🎤", 30),
    ("resumes", "Resumes & CVs", "Feedback, formats, what got you a callback", "#10b981", "📄", 40),
    ("study", "Study & Skills", "What you're learning and how it's going", "#8b5cf6", "📚", 50),
    ("wins", "Wins", "Offers, milestones, small victories. Post them here", "#ec4899", "🎉", 60),
    ("vent", "Vent", "The hard days. No advice unless asked", "#64748b", "🌧️", 70),
]


def _ensure_topics(db: Session) -> None:
    existing = {row[0] for row in db.query(models.CommunityTopic.slug).all()}
    added = False
    for slug, name, desc, color, icon, order in SEED_TOPICS:
        if slug in existing:
            continue
        db.add(models.CommunityTopic(slug=slug, name=name, description=desc,
                                     color=color, icon=icon, sort_order=order))
        added = True
    if added:
        db.commit()


# ---------------------------------------------------------------------------
# Identity
# ---------------------------------------------------------------------------
def _users_by_id(db: Session, user_ids) -> dict:
    """One lookup for a whole page of rows.

    The obvious version resolves the author inside the serialiser, which is a
    query per post and then a query per comment — the classic N+1 that only
    shows up once the feed has real traffic on it.
    """
    ids = [i for i in set(user_ids) if i]
    if not ids:
        return {}
    return {u.id: u for u in db.query(models.User).filter(models.User.id.in_(ids)).all()}


def _author_block(user: Optional[models.User]) -> dict:
    """What the world sees of a person: the same name, photo and headline the
    rest of the app shows, and nothing else."""
    if not user:
        return {"id": None, "name": "Deleted account", "avatar_url": None, "headline": None}
    return {
        "id": user.id,
        "name": user.name or "Someone",
        "avatar_url": f"/uploads/avatars/{user.avatar_file}" if user.avatar_file else None,
        "headline": user.headline or None,
    }


def _karma_for(db: Session, user_id: int) -> int:
    """Points earned, totalled on demand.

    Two aggregates over indexed columns are cheap, and unlike a stored counter
    they cannot drift away from the votes they describe the moment anything
    touches a score outside the one code path that remembered to update it.
    """
    posts = db.query(func.coalesce(func.sum(models.CommunityPost.score), 0)).filter(
        models.CommunityPost.user_id == user_id,
        models.CommunityPost.deleted == False,  # noqa: E712
    ).scalar() or 0
    comments = db.query(func.coalesce(func.sum(models.CommunityComment.score), 0)).filter(
        models.CommunityComment.user_id == user_id,
        models.CommunityComment.deleted == False,  # noqa: E712
    ).scalar() or 0
    return int(posts) + int(comments)


# ---------------------------------------------------------------------------
# Attachments
# ---------------------------------------------------------------------------
# Images are uploaded before the post or comment exists, so the composer can
# show a thumbnail while you are still typing. An upload returns an id; the
# create call binds the ids it is given. Anything never submitted stays unbound
# and is never shown.
COMMUNITY_UPLOAD_DIR = os.path.abspath(os.path.join(
    os.path.dirname(os.path.dirname(__file__)), "..", "uploads", "community"))
os.makedirs(COMMUNITY_UPLOAD_DIR, exist_ok=True)

# Raster formats only, and the same reasoning as the avatar upload next door:
# SVG is a document that can carry script and this is served from the app's own
# origin. The static mount neutralises active content, but a picture in a forum
# post has no reason to be a document in the first place.
ALLOWED_IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".gif"}
ALLOWED_DOC_EXTS = {".pdf"}
MAX_IMAGE_BYTES = 8 * 1024 * 1024
# A CV or a job spec is routinely heavier than a screenshot, and unlike an
# image a PDF cannot be re-compressed on the way in, so it gets its own,
# larger ceiling rather than being squeezed into the image one.
MAX_DOC_BYTES = 20 * 1024 * 1024
MAX_ATTACHMENTS = 4

# The first bytes of each format accepted. An extension is a claim; this is
# evidence. A .png that begins "<?xml" or "<!DOCTYPE" is exactly the file this
# check exists to refuse — and so is a .pdf that is really an HTML page.
_MAGIC = (
    (b"\x89PNG\r\n\x1a\n", ".png", "image/png"),
    (b"\xff\xd8\xff", ".jpg", "image/jpeg"),
    (b"GIF87a", ".gif", "image/gif"),
    (b"GIF89a", ".gif", "image/gif"),
    (b"RIFF", ".webp", "image/webp"),
    (b"%PDF-", ".pdf", "application/pdf"),
)

IMAGE_MAX_PX = 1600          # ceiling on the long edge
IMAGE_TARGET_BYTES = 900 * 1024


def _sniff(head: bytes):
    for sig, ext, mime in _MAGIC:
        if head.startswith(sig):
            # "RIFF" alone is any RIFF container; WEBP is the part that matters.
            if sig == b"RIFF" and head[8:12] != b"WEBP":
                continue
            return ext, mime
    return None, None


def _shrink_image(path: str) -> tuple:
    """Bring a posted image under budget and report its dimensions.

    A feed of phone screenshots is otherwise several megabytes per screen.
    Best-effort on purpose: if Pillow is missing or the file resists, the image
    is still perfectly usable, just heavier than it needs to be, and that is
    not worth failing an upload over. Animated GIFs are measured but never
    re-encoded — saving one frame-by-frame through Pillow is how an animation
    silently becomes a still.
    """
    try:
        from PIL import Image
    except Exception:
        return (None, None)
    try:
        with Image.open(path) as opened:
            opened.load()
            fmt = (opened.format or "").upper()
            animated = getattr(opened, "n_frames", 1) > 1
            im = opened.copy()
        size = im.size
        if animated:
            return size
        if max(im.size) > IMAGE_MAX_PX:
            im.thumbnail((IMAGE_MAX_PX, IMAGE_MAX_PX), Image.LANCZOS)

        def write(img, quality=None):
            kw = {"optimize": True}
            if fmt in ("JPEG", "WEBP") and quality is not None:
                kw["quality"] = quality
            img.save(path, format=fmt or None, **kw)
            return os.path.getsize(path)

        for quality in (85, 72, 60):
            if write(im, quality) <= IMAGE_TARGET_BYTES:
                return im.size
            if fmt not in ("JPEG", "WEBP"):
                break   # PNG is lossless; quality is not a lever there
        return im.size
    except Exception:
        return (None, None)


def _is_pdf(a: models.CommunityAttachment) -> bool:
    return (a.content_type or "") == "application/pdf"


def _attachment_out(a: models.CommunityAttachment) -> dict:
    return {
        "id": a.id,
        "url": f"/uploads/community/{a.stored_file}",
        # Same bytes, but served with the name the person actually uploaded.
        # The static mount stores files under a uuid and has no idea what they
        # were called, so a download from there lands in someone's Downloads
        # folder as "5f02808d….pdf". The link on a document uses this instead.
        "download_url": f"/api/community/files/{a.stored_file}",
        "name": a.original_name,
        # An image goes in the picture grid, a document gets a row with its
        # name and size. The client should not have to infer that from a file
        # extension it may not recognise.
        "kind": "pdf" if _is_pdf(a) else "image",
        "content_type": a.content_type,
        "size": a.byte_size,
        "width": a.width,
        "height": a.height,
    }


def _attachments_for(db: Session, post_ids=None, comment_ids=None) -> dict:
    """All images for a page of rows in one query, keyed by owner."""
    out = {"post": {}, "comment": {}}
    if post_ids:
        for a in db.query(models.CommunityAttachment).filter(
                models.CommunityAttachment.post_id.in_(list(set(post_ids)))).all():
            out["post"].setdefault(a.post_id, []).append(_attachment_out(a))
    if comment_ids:
        for a in db.query(models.CommunityAttachment).filter(
                models.CommunityAttachment.comment_id.in_(list(set(comment_ids)))).all():
            out["comment"].setdefault(a.comment_id, []).append(_attachment_out(a))
    return out


def _bind_attachments(db: Session, ids, user: models.User, *, post=None, comment=None) -> None:
    """Claim uploaded images for the thing just created.

    Ownership and unbound-ness are both conditions of the query rather than
    checks after the fact, so an id belonging to someone else — or already
    stapled to another post — simply matches nothing. That is what stops a
    guessed id from attaching one account's picture to another account's post.
    """
    ids = [int(i) for i in (ids or [])][:MAX_ATTACHMENTS]
    if not ids:
        return
    rows = db.query(models.CommunityAttachment).filter(
        models.CommunityAttachment.id.in_(ids),
        models.CommunityAttachment.user_id == user.id,
        models.CommunityAttachment.post_id.is_(None),
        models.CommunityAttachment.comment_id.is_(None),
    ).all()
    for a in rows:
        if post is not None:
            a.post_id = post.id
        else:
            a.comment_id = comment.id


@router.get("/files/{stored}")
def download_attachment(stored: str, db: Session = Depends(get_db)):
    """Serve an upload under the name it was uploaded with.

    Addressed by the stored uuid rather than the row id, deliberately: the id
    is sequential, and a sequential public URL is an invitation to walk every
    attachment on the forum. The uuid is the same unguessable handle the
    static mount already uses, so this adds a filename and nothing else.

    The path is never built from the request. `stored` is only ever used to
    look up a row, and the row's own value builds the path, so a name like
    "../../.env" simply matches nothing.
    """
    row = db.query(models.CommunityAttachment).filter(
        models.CommunityAttachment.stored_file == stored).first()
    if not row:
        raise HTTPException(status_code=404, detail="Not found")
    path = os.path.join(COMMUNITY_UPLOAD_DIR, row.stored_file)
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="Not found")
    # The same hardening the static mount applies, for the same reason: this
    # is served from the app's own origin, so nothing here may render in-page.
    return FileResponse(
        path,
        media_type=row.content_type or "application/octet-stream",
        filename=row.original_name or row.stored_file,
        headers={
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": "default-src 'none'; sandbox",
            "Cache-Control": "private, max-age=300",
        },
    )


@router.post("/uploads", status_code=201)
def upload_attachment(file: UploadFile = File(...),
                      db: Session = Depends(get_db),
                      current_user: models.User = Depends(get_current_user)):
    """Take one image or one PDF.

    The two differ in three ways and in nothing else: the size they are
    allowed, whether the bytes get re-compressed on the way in, and whether a
    type swap is tolerated. A JPEG named .png is still a picture and is simply
    renamed; a PDF named .png is a different kind of thing arriving under a
    picture's name, and is refused rather than quietly reclassified.
    """
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext == ".jpeg":
        ext = ".jpg"
    is_doc = ext in ALLOWED_DOC_EXTS
    if not is_doc and ext not in ALLOWED_IMAGE_EXTS:
        raise HTTPException(400, "Images (PNG, JPG, GIF, WebP) or a PDF")

    cap = MAX_DOC_BYTES if is_doc else MAX_IMAGE_BYTES
    too_big = ("That PDF is over 20MB — try a smaller one"
               if is_doc else "That image is over 8MB — try a smaller one")

    stored = f"{uuid.uuid4().hex}{ext}"
    dest = os.path.join(COMMUNITY_UPLOAD_DIR, stored)
    total, head = 0, b""
    try:
        with open(dest, "wb") as out:
            while True:
                chunk = file.file.read(64 * 1024)
                if not chunk:
                    break
                if not head:
                    head = chunk[:16]
                total += len(chunk)
                if total > cap:
                    raise HTTPException(413, too_big)
                out.write(chunk)
        real_ext, mime = _sniff(head)
        if not real_ext:
            raise HTTPException(400, "That file isn't a PNG, JPG, GIF, WebP or PDF")
        # Crossing between a picture and a document is never a rename — an
        # HTML page saved as .pdf, or a PDF uploaded as .png, both land here.
        if (real_ext in ALLOWED_DOC_EXTS) != is_doc:
            raise HTTPException(400, "That file's contents don't match its name")
        # Within a kind the body decides, not the name: a .png that is really
        # a JPEG is fine and just gets the right extension.
        if real_ext != ext:
            new_stored = f"{os.path.splitext(stored)[0]}{real_ext}"
            os.replace(dest, os.path.join(COMMUNITY_UPLOAD_DIR, new_stored))
            stored, dest = new_stored, os.path.join(COMMUNITY_UPLOAD_DIR, new_stored)
    except Exception:
        if os.path.exists(dest):
            try:
                os.remove(dest)
            except OSError:
                pass
        raise

    # A PDF has no pixels to resize and re-encoding one would be a good way to
    # corrupt it, so only pictures go through the shrink.
    width, height = (None, None) if is_doc else _shrink_image(dest)
    row = models.CommunityAttachment(
        user_id=current_user.id,
        stored_file=stored,
        original_name=(file.filename or "")[:255] or None,
        content_type=mime,
        byte_size=os.path.getsize(dest),
        width=width, height=height,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _attachment_out(row)


# ---------------------------------------------------------------------------
# Votes
# ---------------------------------------------------------------------------
def _my_votes(db: Session, user_id: int, target_type: str, target_ids) -> dict:
    ids = [i for i in set(target_ids) if i]
    if not ids:
        return {}
    rows = db.query(models.CommunityVote).filter(
        models.CommunityVote.user_id == user_id,
        models.CommunityVote.target_type == target_type,
        models.CommunityVote.target_id.in_(ids),
    ).all()
    return {r.target_id: r.value for r in rows}


def _hot_rank(score: int, created_at: datetime) -> float:
    """Reddit's ordering, near enough.

    A post's rank is its score on a log scale plus its age on a linear one, so
    a new post with three votes can sit above an old one with thirty, and
    nothing has to be recomputed on a schedule — the ordering falls out of the
    two numbers already on the row.

    log10 flattens the score so the tenth vote matters much less than the
    second; dividing the age by 45000 seconds means roughly half a day buys
    about one order of magnitude of score.
    """
    s = score or 0
    order = log10(max(abs(s), 1))
    sign = 1 if s > 0 else (-1 if s < 0 else 0)
    created = created_at or datetime.utcnow()
    seconds = (created - datetime(2024, 1, 1)).total_seconds()
    return round(sign * order + seconds / 45000, 7)


def _can_modify(row, viewer: models.User) -> bool:
    if not viewer:
        return False
    if row.deleted or row.removed_by_admin:
        return False
    if row.user_id == viewer.id:
        return True
    return viewer.role == models.UserRole.admin


# ---------------------------------------------------------------------------
# Serialisers
# ---------------------------------------------------------------------------
def _post_out(post, author, my_vote, viewer, topic_map, attachments=None) -> dict:
    gone = post.deleted or post.removed_by_admin
    topic = topic_map.get(post.topic_id)
    return {
        "id": post.id,
        "title": "[removed]" if post.removed_by_admin else ("[deleted]" if post.deleted else post.title),
        # A withdrawn post keeps its place in the thread so replies still make
        # sense, but the text does not come back over the wire — a client-side
        # blank would still have shipped it to the browser.
        "body": None if gone else post.body,
        "link_url": None if gone else post.link_url,
        "topic_id": post.topic_id,
        "topic": {"slug": topic.slug, "name": topic.name, "color": topic.color,
                  "icon": topic.icon} if topic else None,
        "author": _author_block(author),
        "is_mine": bool(viewer and post.user_id == viewer.id) and not gone,
        "score": post.score or 0,
        "my_vote": my_vote or 0,
        "comment_count": post.comment_count or 0,
        "deleted": bool(post.deleted),
        "removed_by_admin": bool(post.removed_by_admin),
        "can_delete": _can_modify(post, viewer),
        "attachments": [] if gone else (attachments or []),
        "edited_at": post.edited_at,
        "created_at": post.created_at,
    }


def _comment_out(c, author, my_vote, viewer, attachments=None) -> dict:
    gone = c.deleted or c.removed_by_admin
    return {
        "id": c.id,
        "parent_id": c.parent_id,
        "body": ("[removed by a moderator]" if c.removed_by_admin
                 else ("[deleted]" if c.deleted else c.body)),
        "author": _author_block(None) if gone else _author_block(author),
        "is_mine": bool(viewer and c.user_id == viewer.id) and not gone,
        "score": c.score or 0,
        "my_vote": my_vote or 0,
        "deleted": bool(gone),
        "can_delete": _can_modify(c, viewer),
        "attachments": [] if gone else (attachments or []),
        "edited_at": c.edited_at,
        "created_at": c.created_at,
        "replies": [],
    }


# ---------------------------------------------------------------------------
# Me
# ---------------------------------------------------------------------------
@router.get("/me")
def my_community_profile(db: Session = Depends(get_db),
                         current_user: models.User = Depends(get_current_user)):
    """Everything the sidebar needs. There is no gate here any more — an
    account can post the moment it exists — so this is display only."""
    posts = db.query(func.count(models.CommunityPost.id)).filter(
        models.CommunityPost.user_id == current_user.id,
        models.CommunityPost.deleted == False,  # noqa: E712
    ).scalar() or 0
    comments = db.query(func.count(models.CommunityComment.id)).filter(
        models.CommunityComment.user_id == current_user.id,
        models.CommunityComment.deleted == False,  # noqa: E712
    ).scalar() or 0
    return {
        "is_admin": current_user.role == models.UserRole.admin,
        "me": _author_block(current_user),
        "karma": _karma_for(db, current_user.id),
        "post_count": posts,
        "comment_count": comments,
    }


# ---------------------------------------------------------------------------
# Topics
# ---------------------------------------------------------------------------
@router.get("/topics")
def list_topics(db: Session = Depends(get_db),
                current_user: models.User = Depends(get_current_user)):
    _ensure_topics(db)
    counts = dict(
        db.query(models.CommunityPost.topic_id, func.count(models.CommunityPost.id))
        .filter(models.CommunityPost.deleted == False)  # noqa: E712
        .group_by(models.CommunityPost.topic_id).all()
    )
    topics = db.query(models.CommunityTopic).order_by(
        models.CommunityTopic.sort_order, models.CommunityTopic.name).all()
    return [{
        "id": t.id, "slug": t.slug, "name": t.name, "description": t.description,
        "color": t.color, "icon": t.icon, "post_count": counts.get(t.id, 0),
    } for t in topics]


# ---------------------------------------------------------------------------
# Feed
# ---------------------------------------------------------------------------
@router.get("/posts")
def list_posts(
    topic: Optional[str] = Query(None, description="topic slug, or omitted for everything"),
    sort: str = Query("hot", pattern="^(hot|new|top)$"),
    window: str = Query("all", pattern="^(day|week|month|year|all)$"),
    q: Optional[str] = Query(None),
    author_id: Optional[int] = Query(None, description="filter to one account"),
    limit: int = Query(25, ge=1, le=50),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    _ensure_topics(db)
    # No user filter. This is the whole point of the feature — see the module
    # docstring before adding one.
    query = db.query(models.CommunityPost)

    if topic:
        t = db.query(models.CommunityTopic).filter(
            models.CommunityTopic.slug == topic).first()
        if not t:
            raise HTTPException(status_code=404, detail="No such topic")
        query = query.filter(models.CommunityPost.topic_id == t.id)

    if author_id:
        query = query.filter(models.CommunityPost.user_id == author_id)

    if q:
        like = f"%{q.strip()}%"
        query = query.filter(
            (models.CommunityPost.title.ilike(like)) | (models.CommunityPost.body.ilike(like)))

    # Deleted posts stay out of the feed entirely. They are only rendered as
    # tombstones on a permalink, where a reply chain still needs its anchor.
    query = query.filter(models.CommunityPost.deleted == False)  # noqa: E712

    if sort == "top" and window != "all":
        days = {"day": 1, "week": 7, "month": 30, "year": 365}[window]
        query = query.filter(
            models.CommunityPost.created_at >= datetime.utcnow() - timedelta(days=days))

    if sort == "new":
        query = query.order_by(models.CommunityPost.created_at.desc())
    elif sort == "top":
        query = query.order_by(models.CommunityPost.score.desc(),
                               models.CommunityPost.created_at.desc())
    else:
        query = query.order_by(models.CommunityPost.created_at.desc())

    if sort == "hot":
        # Hot cannot be expressed in SQL without a stored rank column, and a
        # stored one needs a job to keep it current. Instead: take a recent
        # slab by date — which the index covers — and rank that in Python. The
        # slab is generous enough that nothing a person would call "hot" can
        # fall outside it, and it is bounded, so this does not become a full
        # table sort as the forum grows.
        slab = query.limit(400).all()
        slab.sort(key=lambda p: _hot_rank(p.score or 0, p.created_at), reverse=True)
        rows = slab[offset:offset + limit + 1]
    else:
        rows = query.offset(offset).limit(limit + 1).all()

    has_more = len(rows) > limit
    rows = rows[:limit]

    authors = _users_by_id(db, [p.user_id for p in rows])
    votes = _my_votes(db, current_user.id, "post", [p.id for p in rows])
    atts = _attachments_for(db, post_ids=[p.id for p in rows])["post"]
    topic_map = {t.id: t for t in db.query(models.CommunityTopic).all()}

    return {
        "posts": [_post_out(p, authors.get(p.user_id), votes.get(p.id, 0),
                            current_user, topic_map, atts.get(p.id)) for p in rows],
        "has_more": has_more,
    }


@router.post("/posts", status_code=201)
def create_post(payload: schemas.CommunityPostCreate, db: Session = Depends(get_db),
                current_user: models.User = Depends(get_current_user)):
    _ensure_topics(db)

    topic_id = payload.topic_id
    if topic_id:
        t = db.query(models.CommunityTopic).filter(
            models.CommunityTopic.id == topic_id).first()
        if not t:
            raise HTTPException(status_code=400, detail="No such topic")
    else:
        t = db.query(models.CommunityTopic).filter(
            models.CommunityTopic.slug == "general").first()
        topic_id = t.id if t else None

    link = (payload.link_url or "").strip() or None
    if link and not link.lower().startswith(("http://", "https://")):
        # Anything else — javascript:, data:, a bare word the browser resolves
        # relative to this origin — is either an XSS vector or a broken link.
        # Rejected rather than repaired, so a typo is visible instead of
        # silently becoming a different URL.
        raise HTTPException(status_code=400, detail="Links must start with http:// or https://")

    body = (payload.body or "").strip()[:20000] or None
    if not body and not link and not payload.attachment_ids:
        # A bare title is a fine post; this only catches the empty submit.
        pass

    post = models.CommunityPost(
        user_id=current_user.id,
        topic_id=topic_id,
        title=payload.title.strip()[:300],
        body=body,
        link_url=link[:600] if link else None,
        # Your own post starts at one point, from you. The vote row below is
        # what makes that true rather than cosmetic, so un-voting your own post
        # actually takes it back to zero.
        score=1,
        comment_count=0,
    )
    db.add(post)
    db.flush()   # assigns post.id, which the self-vote and the images need
    db.add(models.CommunityVote(user_id=current_user.id, target_type="post",
                                target_id=post.id, value=1))
    _bind_attachments(db, payload.attachment_ids, current_user, post=post)
    db.commit()
    db.refresh(post)

    topic_map = {t2.id: t2 for t2 in db.query(models.CommunityTopic).all()}
    atts = _attachments_for(db, post_ids=[post.id])["post"].get(post.id)
    return _post_out(post, current_user, 1, current_user, topic_map, atts)


@router.get("/posts/{post_id}")
def get_post(post_id: int, sort: str = Query("top", pattern="^(top|new|old)$"),
             db: Session = Depends(get_db),
             current_user: models.User = Depends(get_current_user)):
    post = db.query(models.CommunityPost).filter(
        models.CommunityPost.id == post_id).first()
    if not post:
        raise HTTPException(status_code=404, detail="That post is gone")

    topic_map = {t.id: t for t in db.query(models.CommunityTopic).all()}

    # The entire thread in one query, assembled into a tree here. The
    # alternative — fetching children level by level — is a query per level of
    # nesting, which is unbounded by definition.
    comments = db.query(models.CommunityComment).filter(
        models.CommunityComment.post_id == post_id).all()

    authors = _users_by_id(db, [post.user_id] + [c.user_id for c in comments])
    my_post_vote = _my_votes(db, current_user.id, "post", [post.id]).get(post.id, 0)
    cvotes = _my_votes(db, current_user.id, "comment", [c.id for c in comments])
    atts = _attachments_for(db, post_ids=[post.id], comment_ids=[c.id for c in comments])

    nodes = {c.id: _comment_out(c, authors.get(c.user_id), cvotes.get(c.id, 0),
                                current_user, atts["comment"].get(c.id))
             for c in comments}
    roots = []
    for c in comments:
        node = nodes[c.id]
        parent = nodes.get(c.parent_id) if c.parent_id else None
        # A reply whose parent was hard-deleted would otherwise vanish with it.
        # Promoting it to the top level keeps it readable instead.
        (parent["replies"] if parent else roots).append(node)

    def order(items):
        if sort == "new":
            items.sort(key=lambda n: n["created_at"], reverse=True)
        elif sort == "old":
            items.sort(key=lambda n: n["created_at"])
        else:
            items.sort(key=lambda n: (n["score"], n["created_at"]), reverse=True)
        for n in items:
            order(n["replies"])

    order(roots)

    return {
        "post": _post_out(post, authors.get(post.user_id), my_post_vote,
                          current_user, topic_map, atts["post"].get(post.id)),
        "comments": roots,
    }


@router.patch("/posts/{post_id}")
def edit_post(post_id: int, payload: schemas.CommunityPostUpdate,
              db: Session = Depends(get_db),
              current_user: models.User = Depends(get_current_user)):
    post = db.query(models.CommunityPost).filter(
        models.CommunityPost.id == post_id).first()
    if not post:
        raise HTTPException(status_code=404, detail="That post is gone")
    # Editing is the author's alone. An admin can remove a post but cannot
    # rewrite it into something the author never said.
    if post.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="You can only edit your own posts")
    if post.deleted or post.removed_by_admin:
        raise HTTPException(status_code=400, detail="That post has been removed")

    data = payload.model_dump(exclude_unset=True)
    if "title" in data and data["title"] is not None:
        title = data["title"].strip()
        if not title:
            raise HTTPException(status_code=400, detail="A post needs a title")
        post.title = title[:300]
    if "body" in data:
        post.body = (data["body"] or "").strip()[:20000] or None
    if "link_url" in data:
        link = (data["link_url"] or "").strip() or None
        if link and not link.lower().startswith(("http://", "https://")):
            raise HTTPException(status_code=400, detail="Links must start with http:// or https://")
        post.link_url = link[:600] if link else None
    if "topic_id" in data and data["topic_id"]:
        t = db.query(models.CommunityTopic).filter(
            models.CommunityTopic.id == data["topic_id"]).first()
        if not t:
            raise HTTPException(status_code=400, detail="No such topic")
        post.topic_id = t.id
    if data.get("attachment_ids"):
        _bind_attachments(db, data["attachment_ids"], current_user, post=post)

    post.edited_at = datetime.utcnow()
    db.commit()
    db.refresh(post)
    topic_map = {t.id: t for t in db.query(models.CommunityTopic).all()}
    my_vote = _my_votes(db, current_user.id, "post", [post.id]).get(post.id, 0)
    atts = _attachments_for(db, post_ids=[post.id])["post"].get(post.id)
    return _post_out(post, current_user, my_vote, current_user, topic_map, atts)


@router.delete("/posts/{post_id}", status_code=204)
def delete_post(post_id: int, db: Session = Depends(get_db),
                current_user: models.User = Depends(get_current_user)):
    post = db.query(models.CommunityPost).filter(
        models.CommunityPost.id == post_id).first()
    if not post:
        raise HTTPException(status_code=404, detail="That post is gone")
    is_admin = current_user.role == models.UserRole.admin
    if post.user_id != current_user.id and not is_admin:
        raise HTTPException(status_code=403, detail="That isn't yours to delete")

    # Soft delete, always. The comment thread under a post is other people's
    # writing, and a hard delete would take all of it with the post.
    post.deleted = True
    if post.user_id != current_user.id:
        post.removed_by_admin = True
    db.commit()
    return None


# ---------------------------------------------------------------------------
# Comments
# ---------------------------------------------------------------------------
@router.post("/posts/{post_id}/comments", status_code=201)
def add_comment(post_id: int, payload: schemas.CommunityCommentCreate,
                db: Session = Depends(get_db),
                current_user: models.User = Depends(get_current_user)):
    post = db.query(models.CommunityPost).filter(
        models.CommunityPost.id == post_id).first()
    if not post:
        raise HTTPException(status_code=404, detail="That post is gone")
    if post.deleted or post.removed_by_admin:
        raise HTTPException(status_code=400, detail="That post has been removed")

    parent_id = payload.parent_id
    if parent_id:
        parent = db.query(models.CommunityComment).filter(
            models.CommunityComment.id == parent_id).first()
        # Checking the parent belongs to THIS post, not just that it exists —
        # otherwise a crafted parent_id grafts a reply from one thread onto
        # another, where it renders with no context.
        if not parent or parent.post_id != post_id:
            raise HTTPException(status_code=400, detail="That comment isn't on this post")

    body = (payload.body or "").strip()
    if not body and not payload.attachment_ids:
        raise HTTPException(status_code=400, detail="Write something, or attach a file")

    c = models.CommunityComment(
        post_id=post_id, user_id=current_user.id, parent_id=parent_id,
        body=body[:10000], score=1)
    db.add(c)
    # Counter and row move together in one transaction, so the number under a
    # post cannot end up describing a comment that failed to save.
    post.comment_count = (post.comment_count or 0) + 1
    db.flush()   # assigns c.id, which the self-vote and the images need
    db.add(models.CommunityVote(user_id=current_user.id, target_type="comment",
                                target_id=c.id, value=1))
    _bind_attachments(db, payload.attachment_ids, current_user, comment=c)
    db.commit()
    db.refresh(c)
    atts = _attachments_for(db, comment_ids=[c.id])["comment"].get(c.id)
    return _comment_out(c, current_user, 1, current_user, atts)


@router.patch("/comments/{comment_id}")
def edit_comment(comment_id: int, payload: schemas.CommunityCommentUpdate,
                 db: Session = Depends(get_db),
                 current_user: models.User = Depends(get_current_user)):
    c = db.query(models.CommunityComment).filter(
        models.CommunityComment.id == comment_id).first()
    if not c:
        raise HTTPException(status_code=404, detail="That comment is gone")
    if c.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="You can only edit your own comments")
    if c.deleted or c.removed_by_admin:
        raise HTTPException(status_code=400, detail="That comment has been removed")
    body = (payload.body or "").strip()
    has_files = db.query(models.CommunityAttachment).filter(
        models.CommunityAttachment.comment_id == c.id).count() > 0
    if not body and not has_files:
        raise HTTPException(status_code=400, detail="A comment needs some text")
    c.body = body[:10000]
    c.edited_at = datetime.utcnow()
    db.commit()
    db.refresh(c)
    my_vote = _my_votes(db, current_user.id, "comment", [c.id]).get(c.id, 0)
    atts = _attachments_for(db, comment_ids=[c.id])["comment"].get(c.id)
    return _comment_out(c, current_user, my_vote, current_user, atts)


@router.delete("/comments/{comment_id}", status_code=204)
def delete_comment(comment_id: int, db: Session = Depends(get_db),
                   current_user: models.User = Depends(get_current_user)):
    c = db.query(models.CommunityComment).filter(
        models.CommunityComment.id == comment_id).first()
    if not c:
        raise HTTPException(status_code=404, detail="That comment is gone")
    is_admin = current_user.role == models.UserRole.admin
    if c.user_id != current_user.id and not is_admin:
        raise HTTPException(status_code=403, detail="That isn't yours to delete")
    if c.deleted or c.removed_by_admin:
        return None

    c.deleted = True
    if c.user_id != current_user.id:
        c.removed_by_admin = True
    # A tombstone is still a node in the tree, so the post's count stays as it
    # is — decrementing it would make "12 comments" open onto a thread with
    # thirteen visible rows.
    db.commit()
    return None


# ---------------------------------------------------------------------------
# Voting
# ---------------------------------------------------------------------------
@router.post("/vote/{target_type}/{target_id}")
def cast_vote(target_type: str, target_id: int, payload: schemas.CommunityVoteIn,
              db: Session = Depends(get_db),
              current_user: models.User = Depends(get_current_user)):
    if target_type not in ("post", "comment"):
        raise HTTPException(status_code=400, detail="Can only vote on posts and comments")

    model = models.CommunityPost if target_type == "post" else models.CommunityComment
    row = db.query(model).filter(model.id == target_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="That's gone")
    if row.deleted or row.removed_by_admin:
        raise HTTPException(status_code=400, detail="That has been removed")

    existing = db.query(models.CommunityVote).filter(
        models.CommunityVote.user_id == current_user.id,
        models.CommunityVote.target_type == target_type,
        models.CommunityVote.target_id == target_id,
    ).first()

    old = existing.value if existing else 0
    new = payload.value
    # Clicking the arrow you already chose clears it. The client sends the
    # arrow that was pressed and the toggle is decided here, so two tabs open
    # on the same post cannot disagree about which state they are in.
    if new == old:
        new = 0

    # The score moves by the difference, never by recount. Going from -1 to +1
    # is a swing of two, which is the bug you get for free if you add the new
    # value without subtracting the old one.
    delta = new - old
    if delta:
        row.score = (row.score or 0) + delta

    if new == 0:
        if existing:
            db.delete(existing)
    elif existing:
        existing.value = new
    else:
        db.add(models.CommunityVote(user_id=current_user.id, target_type=target_type,
                                    target_id=target_id, value=new))

    db.commit()
    db.refresh(row)
    return {"score": row.score or 0, "my_vote": new}


# ---------------------------------------------------------------------------
# A person's public page
# ---------------------------------------------------------------------------
@router.get("/users/{user_id}")
def public_profile(user_id: int, db: Session = Depends(get_db),
                   current_user: models.User = Depends(get_current_user)):
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="No one here by that name")

    posts = db.query(models.CommunityPost).filter(
        models.CommunityPost.user_id == user.id,
        models.CommunityPost.deleted == False,  # noqa: E712
    ).order_by(models.CommunityPost.created_at.desc()).limit(25).all()

    topic_map = {t.id: t for t in db.query(models.CommunityTopic).all()}
    votes = _my_votes(db, current_user.id, "post", [p.id for p in posts])
    atts = _attachments_for(db, post_ids=[p.id for p in posts])["post"]

    comment_count = db.query(func.count(models.CommunityComment.id)).filter(
        models.CommunityComment.user_id == user.id,
        models.CommunityComment.deleted == False,  # noqa: E712
    ).scalar() or 0

    return {
        "author": _author_block(user),
        "karma": _karma_for(db, user.id),
        "joined_at": user.created_at,
        "post_count": len(posts),
        "comment_count": comment_count,
        "is_me": user.id == current_user.id,
        "posts": [_post_out(p, user, votes.get(p.id, 0), current_user,
                            topic_map, atts.get(p.id)) for p in posts],
    }
