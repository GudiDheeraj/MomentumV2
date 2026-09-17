"""Sponsor-register endpoints: check one employer or a page of them, see status,
force a refresh."""

import logging

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from .. import models, sponsors
from ..auth import get_current_user
from ..database import get_db

log = logging.getLogger("momentum.sponsors")

router = APIRouter(prefix="/api/sponsors", tags=["sponsors"])

# A first page of job cards is ~25 employers, an infinite-scrolled one a few
# hundred. The extension de-duplicates and caches before it asks, so this cap
# only ever trims a runaway caller.
MAX_BULK = 60


class BulkCheckIn(BaseModel):
    companies: list[str] = []


@router.get("/check")
def check(company: str = Query(..., min_length=1, max_length=300),
          db: Session = Depends(get_db),
          current_user: models.User = Depends(get_current_user)):
    """Is this employer on the register?

    Deliberately never 500s. This is called automatically every time a job
    posting is opened in the extension, and a lookup that can't be answered
    should show no badge — not an error banner over someone's job search.
    """
    try:
        return sponsors.check_company(db, company)
    except Exception as exc:                       # noqa: BLE001
        log.warning("sponsors: lookup failed for %r: %s", company, exc)
        return {"status": "unknown", "detail": "Lookup failed.", "synced_at": None}


@router.post("/check-bulk")
def check_bulk(payload: BulkCheckIn,
               db: Session = Depends(get_db),
               current_user: models.User = Depends(get_current_user)):
    """Same question as /check, asked about a screenful of job cards at once.

    Never 500s, for the same reason /check doesn't: this fires while someone is
    scrolling a results list, and a failed lookup should mean no tags, not an
    error. An unanswerable batch comes back as an empty map and the caller
    simply paints nothing.
    """
    names: list[str] = []
    seen: set[str] = set()
    for raw in payload.companies or []:
        name = (raw or "").strip()[:300]
        if not name:
            continue
        # Case-only duplicates are the common shape here ("Spotify" in the card
        # list, "SPOTIFY" in the header); the register match itself normalises
        # far harder than this, server-side.
        key = name.lower()
        if key in seen:
            continue
        seen.add(key)
        names.append(name)
        if len(names) >= MAX_BULK:
            break
    if not names:
        return {"results": {}}
    try:
        return {"results": sponsors.check_many(db, names)}
    except Exception as exc:                       # noqa: BLE001
        log.warning("sponsors: bulk lookup failed for %s names: %s", len(names), exc)
        return {"results": {}}


@router.get("/status")
def status(db: Session = Depends(get_db),
           current_user: models.User = Depends(get_current_user)):
    meta = db.query(models.SponsorRegisterMeta).first()
    return {
        "synced_at": meta.synced_at.isoformat() if meta and meta.synced_at else None,
        "org_count": meta.org_count if meta else 0,
        "source_url": meta.source_url if meta else None,
    }


@router.post("/refresh")
def refresh(db: Session = Depends(get_db),
            current_user: models.User = Depends(get_current_user)):
    """Pull the latest register now.

    Unlike /check this one does report failures — someone pressed a button and
    is waiting for an answer, so "it didn't work and here's why" is the useful
    response.
    """
    try:
        result = sponsors.sync_register(db)
    except Exception as exc:                       # noqa: BLE001
        log.exception("sponsors: manual refresh failed")
        raise HTTPException(502, f"Couldn't refresh the sponsor register: {exc}")
    return {
        "org_count": result["org_count"],
        "source_url": result["source_url"],
        "synced_at": result["synced_at"].isoformat() if result["synced_at"] else None,
    }
