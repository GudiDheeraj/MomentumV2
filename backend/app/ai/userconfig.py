"""Loading a user's LLM config, and making it visible to app/ai/*.

Lives here rather than in the router so `auth.py` can import it without a
cycle: the router imports auth, so auth cannot import the router.
"""

from __future__ import annotations

import logging

from sqlalchemy.orm import Session

from .. import models
from . import keystore, remote

log = logging.getLogger("momentum.ai")


def config_for_user(db: Session, user_id: int) -> remote.LLMConfig | None:
    row = db.query(models.LLMSettings).filter(
        models.LLMSettings.user_id == user_id
    ).first()
    if not row:
        return None
    key = keystore.decrypt(row.api_key_enc or "")
    try:
        temperature = float(row.temperature) if row.temperature else 0.7
    except (TypeError, ValueError):
        temperature = 0.7
    cfg = remote.LLMConfig(
        provider=(row.provider or "openai"), api_key=key, model=row.model or "",
        base_url=row.base_url or "", tone=row.tone or "", length=row.length or "",
        instructions=row.instructions or "", temperature=temperature,
    )
    return cfg if cfg.is_usable() else None


def bind_for_request(db: Session, user_id: int) -> None:
    """Put this user's model configuration where app/ai/* will find it.

    Called from get_current_user, which is the single choke point every
    authenticated request passes through — including the six AI routers that
    have no idea any of this exists.

    Always sets, even to None: a ContextVar in a thread-pool worker outlives
    the request that set it, so leaving a previous value in place would hand
    the next request whichever key happened to run there last.
    """
    try:
        remote.set_current(config_for_user(db, user_id))
    except Exception as e:
        log.warning("could not load LLM settings for user %s: %s", user_id, e)
        remote.set_current(None)
