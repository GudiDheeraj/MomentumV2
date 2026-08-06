"""The set of company boards that get searched.

Two sources, one table. `companies.json` seeds a shared registry on first
startup (rows with user_id NULL, searched by everybody); anything added by
pasting a careers URL belongs to the person who added it.

Self-healing is the point of `record_failure`. A seed list of company slugs
starts out partly wrong and rots further as companies change platform — hard-
coding it and hoping is how these features end up quietly searching forty dead
URLs. A board that fails *permanently* (404/403 — the token is wrong or the
board is private) a few runs in a row deactivates itself and stops costing a
request. A network blip doesn't count, because tomorrow it will work again.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime
from pathlib import Path

from sqlalchemy.orm import Session

from .. import models
from .providers import PROVIDERS, detect_board

log = logging.getLogger("momentum.jobhunt")

SEED_FILE = Path(__file__).with_name("companies.json")
# Retire a board after this many consecutive permanent failures. Three rather
# than one: a provider having a bad afternoon and answering 403 to everything
# would otherwise wipe the entire registry in a single run.
MAX_FAILURES = 3


def seed_shared_registry(db: Session) -> int:
    """Loads companies.json into the shared registry, skipping any already
    present. Idempotent, so it can run on every startup."""
    if not SEED_FILE.exists():
        return 0
    try:
        payload = json.loads(SEED_FILE.read_text(encoding="utf-8"))
    except ValueError:
        log.warning("jobhunt: companies.json is not valid JSON — skipping seed")
        return 0

    existing = {
        (p, t) for (p, t) in db.query(models.CompanyBoard.provider,
                                      models.CompanyBoard.token)
        .filter(models.CompanyBoard.user_id.is_(None)).all()
    }
    added = 0
    for row in payload.get("companies", []):
        provider = (row.get("provider") or "").lower().strip()
        token = (row.get("token") or "").strip()
        if provider not in PROVIDERS or not token or (provider, token) in existing:
            continue
        db.add(models.CompanyBoard(
            user_id=None, name=(row.get("name") or token).strip(),
            provider=provider, token=token, active=True,
        ))
        existing.add((provider, token))
        added += 1
    if added:
        db.commit()
        log.info("jobhunt: seeded %s company boards", added)
    return added


def boards_for_user(db: Session, user_id: int, include_inactive: bool = False):
    """Shared registry plus this person's own additions."""
    q = db.query(models.CompanyBoard).filter(
        (models.CompanyBoard.user_id.is_(None)) | (models.CompanyBoard.user_id == user_id)
    )
    if not include_inactive:
        q = q.filter(models.CompanyBoard.active == True)  # noqa: E712
    return q.order_by(models.CompanyBoard.name).all()


def add_board(db: Session, user_id: int, url_or_token: str,
              name: str | None = None, provider: str | None = None) -> models.CompanyBoard:
    """Adds a company from a pasted careers URL, or an explicit provider+token.

    Raises ValueError with something a person can act on — "that isn't a board
    I recognise" is a more useful answer than a 500.
    """
    text = (url_or_token or "").strip()
    if not text:
        raise ValueError("Paste a careers page URL.")

    if provider:
        provider = provider.lower().strip()
        if provider not in PROVIDERS:
            raise ValueError(f"Unknown provider '{provider}'.")
        token = text
    else:
        found = detect_board(text)
        if not found:
            raise ValueError(
                "That doesn't look like a Greenhouse, Lever, Ashby, Workable, "
                "SmartRecruiters or Recruitee careers page. Open the company's "
                "job listings and copy the URL from there — the one that has "
                "the ATS name in it."
            )
        provider, token = found

    existing = db.query(models.CompanyBoard).filter(
        models.CompanyBoard.provider == provider,
        models.CompanyBoard.token == token,
        (models.CompanyBoard.user_id.is_(None)) | (models.CompanyBoard.user_id == user_id),
    ).first()
    if existing:
        # Re-adding is how someone revives a board that retired itself, so it
        # clears the failure state rather than reporting a duplicate.
        existing.active = True
        existing.fail_count = 0
        existing.last_error = None
        if name:
            existing.name = name.strip()[:200]
        db.commit()
        db.refresh(existing)
        return existing

    board = models.CompanyBoard(
        user_id=user_id, provider=provider, token=token,
        name=(name or token).strip()[:200], active=True,
    )
    db.add(board)
    db.commit()
    db.refresh(board)
    return board


def record_success(db: Session, board_id: int, job_count: int) -> None:
    board = db.query(models.CompanyBoard).get(board_id)
    if not board:
        return
    board.fail_count = 0
    board.last_error = None
    board.last_ok_at = datetime.utcnow()
    board.job_count = job_count
    db.commit()


def record_failure(db: Session, board_id: int, message: str, permanent: bool) -> None:
    board = db.query(models.CompanyBoard).get(board_id)
    if not board:
        return
    board.last_error = str(message)[:200]
    if not permanent:
        # Timeouts and DNS failures say nothing about whether the board exists.
        db.commit()
        return
    board.fail_count = (board.fail_count or 0) + 1
    if board.fail_count >= MAX_FAILURES:
        board.active = False
        log.info("jobhunt: deactivated %s (%s) after %s failures — %s",
                 board.name, board.provider, board.fail_count, message)
    db.commit()
