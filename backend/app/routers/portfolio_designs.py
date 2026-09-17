"""Designs assembled in the portfolio designer.

A *design* is not a portfolio. It holds a theme and an ordered list of
blocks and no content at all — no name, no projects, not a word anybody
wrote. That separation is the point:

  * one design can dress several portfolios, each still drawing its own
    content, and
  * deleting a design can never cost somebody their writing. The
    portfolios that used it fall back to the default template and every
    field survives.

Portfolios reference a design as `custom:<id>` in their `template_id`.
The server never resolves that reference — the design is rendered in the
browser by portfolio-blocks.js, the same place the built-in templates are
drawn, which is what keeps the exported site a single self-contained file
with nothing to host and no build step.
"""

import json
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import models, schemas
from ..auth import get_current_user
from ..database import get_db

router = APIRouter(prefix="/api/portfolio-designs", tags=["portfolios"])

MAX_DESIGNS = 60
# A design is theme settings plus a list of block options — a few hundred
# bytes each. This ceiling is three orders of magnitude above a real one and
# exists only to stop a hand-written API call storing a novel in the column.
MAX_DESIGN_BYTES = 400_000


def _load(row: models.PortfolioTemplate) -> dict:
    try:
        return json.loads(row.design) if row.design else {}
    except (ValueError, TypeError):
        # A design that won't parse is not worth a 500. The front end
        # normalises whatever it is handed and will rebuild a blank one.
        return {}


def _usage(db: Session, user: models.User) -> dict[int, int]:
    """How many of this customer's portfolios wear each design.

    One query for the whole list rather than one per row — the library draws
    every design at once and N+1 here would be N+1 on every visit.
    """
    counts: dict[int, int] = {}
    rows = (db.query(models.Portfolio.template_id)
              .filter(models.Portfolio.user_id == user.id,
                      models.Portfolio.template_id.like("custom:%"))
              .all())
    for (tid,) in rows:
        try:
            key = int(str(tid).split(":", 1)[1])
        except (IndexError, ValueError):
            continue
        counts[key] = counts.get(key, 0) + 1
    return counts


def _out(row: models.PortfolioTemplate, used_by: int = 0) -> schemas.PortfolioDesignOut:
    return schemas.PortfolioDesignOut(
        id=row.id, name=row.name, design=_load(row), used_by=used_by,
        created_at=row.created_at, updated_at=row.updated_at,
    )


def _owned(design_id: int, db: Session, user: models.User) -> models.PortfolioTemplate:
    row = (db.query(models.PortfolioTemplate)
             .filter(models.PortfolioTemplate.id == design_id,
                     models.PortfolioTemplate.user_id == user.id)
             .first())
    if not row:
        raise HTTPException(404, "Design not found")
    return row


def _blob(design: dict | None) -> str | None:
    if design is None:
        return None
    blob = json.dumps(design)
    if len(blob.encode("utf-8")) > MAX_DESIGN_BYTES:
        raise HTTPException(413, "That design is too large to save.")
    return blob


def _cap(db: Session, user: models.User) -> None:
    count = (db.query(models.PortfolioTemplate)
               .filter(models.PortfolioTemplate.user_id == user.id).count())
    if count >= MAX_DESIGNS:
        raise HTTPException(
            400,
            f"You've reached the limit of {MAX_DESIGNS} saved designs. "
            "Delete one to make room.",
        )


@router.get("", response_model=list[schemas.PortfolioDesignOut])
def list_designs(db: Session = Depends(get_db),
                 current_user: models.User = Depends(get_current_user)):
    rows = (db.query(models.PortfolioTemplate)
              .filter(models.PortfolioTemplate.user_id == current_user.id)
              .order_by(models.PortfolioTemplate.updated_at.desc().nullslast(),
                        models.PortfolioTemplate.created_at.desc())
              .all())
    used = _usage(db, current_user)
    return [_out(r, used.get(r.id, 0)) for r in rows]


@router.post("", response_model=schemas.PortfolioDesignOut, status_code=201)
def create_design(payload: schemas.PortfolioDesignCreate,
                  db: Session = Depends(get_db),
                  current_user: models.User = Depends(get_current_user)):
    _cap(db, current_user)
    row = models.PortfolioTemplate(
        user_id=current_user.id,
        name=((payload.name or "").strip() or "Untitled design")[:120],
        design=_blob(payload.design or {}),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _out(row)


@router.get("/{design_id}", response_model=schemas.PortfolioDesignOut)
def get_design(design_id: int, db: Session = Depends(get_db),
               current_user: models.User = Depends(get_current_user)):
    row = _owned(design_id, db, current_user)
    return _out(row, _usage(db, current_user).get(row.id, 0))


@router.put("/{design_id}", response_model=schemas.PortfolioDesignOut)
def update_design(design_id: int, payload: schemas.PortfolioDesignUpdate,
                  db: Session = Depends(get_db),
                  current_user: models.User = Depends(get_current_user)):
    row = _owned(design_id, db, current_user)
    if payload.name is not None:
        row.name = (payload.name.strip() or "Untitled design")[:120]
    if payload.design is not None:
        row.design = _blob(payload.design)
    row.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(row)
    return _out(row, _usage(db, current_user).get(row.id, 0))


@router.delete("/{design_id}", status_code=204)
def delete_design(design_id: int, db: Session = Depends(get_db),
                  current_user: models.User = Depends(get_current_user)):
    """Deletes the design and leaves every portfolio that used it intact.

    The `custom:<id>` reference on those portfolios is deliberately not
    rewritten — see `_resolve_template` in portfolios.py. They render with
    the default template until the customer picks another, and not one
    word of their content is touched.
    """
    db.delete(_owned(design_id, db, current_user))
    db.commit()
    return None


@router.post("/{design_id}/duplicate", response_model=schemas.PortfolioDesignOut,
             status_code=201)
def duplicate_design(design_id: int, db: Session = Depends(get_db),
                     current_user: models.User = Depends(get_current_user)):
    """The safe way to try a variation — the design already in use stays
    exactly as the portfolios wearing it expect."""
    src = _owned(design_id, db, current_user)
    _cap(db, current_user)
    copy = models.PortfolioTemplate(
        user_id=current_user.id,
        name=f"{src.name} (copy)"[:120],
        design=src.design,
    )
    db.add(copy)
    db.commit()
    db.refresh(copy)
    return _out(copy)
