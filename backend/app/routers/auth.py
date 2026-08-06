from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import models, schemas
from ..auth import (
    hash_password, verify_password, create_access_token, get_current_user,
    verify_google_id_token, rate_limit, check_login_lockout, record_failed_login,
    clear_failed_logins,
)
from ..database import get_db

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/signup", response_model=schemas.Token, dependencies=[Depends(rate_limit)])
def signup(payload: schemas.UserCreate, db: Session = Depends(get_db)):
    if len(payload.password) < 8:
        raise HTTPException(400, "Password must be at least 8 characters long")
    existing = db.query(models.User).filter(models.User.email == payload.email.lower()).first()
    if existing:
        raise HTTPException(400, "An account with this email already exists")

    is_first_user = db.query(models.User).count() == 0
    user = models.User(
        name=payload.name,
        email=payload.email.lower(),
        password_hash=hash_password(payload.password),
        auth_provider="password",
        role=models.UserRole.admin if is_first_user else models.UserRole.user,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    token = create_access_token(user.id)
    return schemas.Token(access_token=token, user=schemas.UserOut.model_validate(user))


@router.post("/login", response_model=schemas.Token, dependencies=[Depends(rate_limit)])
def login(payload: schemas.UserLogin, db: Session = Depends(get_db)):
    email = payload.email.lower()
    check_login_lockout(email)

    user = db.query(models.User).filter(models.User.email == email).first()
    if not user or not verify_password(payload.password, user.password_hash):
        record_failed_login(email)
        raise HTTPException(401, "Incorrect email or password")
    if not user.is_active:
        raise HTTPException(403, "This account has been deactivated")

    clear_failed_logins(email)
    token = create_access_token(user.id)
    return schemas.Token(access_token=token, user=schemas.UserOut.model_validate(user))


@router.post("/google", response_model=schemas.Token, dependencies=[Depends(rate_limit)])
def google_login(payload: schemas.GoogleAuthRequest, db: Session = Depends(get_db)):
    claims = verify_google_id_token(payload.credential)
    email = claims["email"].lower()
    google_sub = claims["sub"]
    name = claims.get("name") or email.split("@")[0]

    user = db.query(models.User).filter(
        (models.User.google_sub == google_sub) | (models.User.email == email)
    ).first()

    if user:
        if not user.google_sub:
            user.google_sub = google_sub
            if user.auth_provider == "password" and not user.password_hash:
                user.auth_provider = "google"
        if not user.is_active:
            raise HTTPException(403, "This account has been deactivated")
    else:
        is_first_user = db.query(models.User).count() == 0
        user = models.User(
            name=name, email=email, google_sub=google_sub, auth_provider="google",
            password_hash=None,
            role=models.UserRole.admin if is_first_user else models.UserRole.user,
        )
        db.add(user)

    db.commit()
    db.refresh(user)
    token = create_access_token(user.id)
    return schemas.Token(access_token=token, user=schemas.UserOut.model_validate(user))


@router.get("/me", response_model=schemas.UserOut)
def me(current_user: models.User = Depends(get_current_user)):
    return current_user
