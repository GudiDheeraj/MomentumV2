"""/api/llm/* — the user's own model provider.

The one place an API key is entered, tested and applied. Reads never return the
key, only a hint of it: a settings page that renders your live provider
credential into the DOM is one screen-share away from leaking it, and nothing
in the UI needs the value back.
"""

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import models, schemas
from ..ai import keystore, remote
from ..ai.userconfig import config_for_user
from ..auth import get_current_user
from ..database import get_db

router = APIRouter(prefix="/api/llm", tags=["ai"])


def _out(row: models.LLMSettings | None) -> dict:
    if not row:
        return {"configured": False, "provider": "openai", "tone": "", "length": "medium",
                "instructions": "", "model": "", "base_url": "", "key_hint": "",
                "temperature": "0.7", "last_ok_at": None, "last_error": None}
    return {
        "configured": bool(row.api_key_enc) or row.provider == "ollama",
        "provider": row.provider or "openai",
        "model": row.model or "",
        "base_url": row.base_url or "",
        "key_hint": row.key_hint or "",
        "tone": row.tone or "",
        "length": row.length or "medium",
        "instructions": row.instructions or "",
        "temperature": row.temperature or "0.7",
        "last_ok_at": row.last_ok_at,
        "last_error": row.last_error,
    }


@router.get("/settings", response_model=schemas.LLMSettingsOut)
def get_settings(db: Session = Depends(get_db),
                 current_user: models.User = Depends(get_current_user)):
    row = db.query(models.LLMSettings).filter(
        models.LLMSettings.user_id == current_user.id).first()
    return _out(row)


@router.put("/settings", response_model=schemas.LLMSettingsOut)
def update_settings(payload: schemas.LLMSettingsIn, db: Session = Depends(get_db),
                    current_user: models.User = Depends(get_current_user)):
    row = db.query(models.LLMSettings).filter(
        models.LLMSettings.user_id == current_user.id).first()
    if not row:
        row = models.LLMSettings(user_id=current_user.id)
        db.add(row)

    data = payload.model_dump(exclude_unset=True)
    key = data.pop("api_key", None)
    if key is not None:
        stripped = key.strip()
        if stripped and not stripped.startswith("•"):
            # A masked value coming back from the form means "unchanged", not
            # "set my key to a row of dots".
            row.api_key_enc = keystore.encrypt(stripped)
            row.key_hint = keystore.hint(stripped)
            row.last_error = None
        elif stripped == "":
            row.api_key_enc = None
            row.key_hint = None

    for field, value in data.items():
        setattr(row, field, value)
    db.commit()
    db.refresh(row)
    return _out(row)


@router.post("/test", response_model=schemas.LLMTestResult)
def test_connection(db: Session = Depends(get_db),
                    current_user: models.User = Depends(get_current_user)):
    """One real round trip to the provider.

    Worth its own endpoint: a wrong key otherwise surfaces as a cover letter
    that quietly comes back as a template, which reads as the feature being
    broken rather than the key being wrong.
    """
    cfg = config_for_user(db, current_user.id)
    if cfg is None:
        raise HTTPException(422, "Add an API key first.")
    result = remote.test_config(cfg)

    row = db.query(models.LLMSettings).filter(
        models.LLMSettings.user_id == current_user.id).first()
    if row:
        if result.get("ok"):
            row.last_ok_at = datetime.utcnow()
            row.last_error = None
        else:
            row.last_error = str(result.get("error"))[:300]
        db.commit()
    return result


@router.get("/providers", response_model=list[schemas.LLMProviderOut])
def list_providers():
    """The provider registry. Public — it is a list of names and base URLs,
    and the settings page needs it before anyone has a key."""
    return remote.provider_list()


@router.post("/models", response_model=schemas.LLMModelsOut)
def list_models(db: Session = Depends(get_db),
                current_user: models.User = Depends(get_current_user)):
    """Ask the provider what it serves today.

    Bundled model names age badly — the ones shipped with this release were
    already a version behind for two providers within months. This is the
    escape hatch that makes that a non-issue.
    """
    cfg = config_for_user(db, current_user.id)
    if cfg is None:
        raise HTTPException(422, "Save an API key first.")
    try:
        return {"ok": True, "models": remote.list_models(cfg)}
    except remote.LLMError as e:
        return {"ok": False, "models": [], "error": str(e)}
