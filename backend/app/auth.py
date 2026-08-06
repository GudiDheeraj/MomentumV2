import secrets
import os

from .env import env_int, env_str
import time
from collections import defaultdict, deque
from datetime import datetime, timedelta
from typing import Optional

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from passlib.context import CryptContext
from sqlalchemy.orm import Session

from . import models
from .database import get_db

# ---------------------------------------------------------------------------
# JWT signing key.
#
# This previously defaulted to a fixed literal. That value is in the public
# source, so any deployment that forgot to set MOMENTUM_SECRET_KEY was signing
# tokens with a key an attacker already has — they could mint a valid token
# for ANY user id and read every account. A comment saying "set this in
# production" is not a control, so the default is now removed entirely:
#
#   * production (MOMENTUM_ENV=production): refuse to start without a secret.
#   * development: generate a random one per process. Tokens stop working
#     across restarts, which is mildly annoying and exactly the right
#     incentive — it can never be mistaken for a usable production default.
# ---------------------------------------------------------------------------
_ENV = os.getenv("MOMENTUM_ENV", "development").strip().lower()
SECRET_KEY = os.getenv("MOMENTUM_SECRET_KEY", "").strip()
if not SECRET_KEY:
    if _ENV == "production":
        raise RuntimeError(
            "MOMENTUM_SECRET_KEY must be set when MOMENTUM_ENV=production.\n"
            "Generate one with:  python -c \"import secrets; print(secrets.token_urlsafe(64))\""
        )
    # Previously this generated a brand-new random key every process start,
    # which meant every backend restart (a redeploy, a crash, a host that
    # sleeps/cold-starts an idle container, --reload picking up a file save)
    # silently invalidated every logged-in user's token. The client then got
    # a 401 on its next request — often the very next thing the user did,
    # like clicking a tab — and was bounced to the login screen with no
    # explanation. That looked like "clicking tabs logs me out."
    #
    # Persist the generated key to a local file instead, so it survives
    # restarts on the same machine/volume. It's still per-deployment (a
    # fresh clone/volume gets its own key) and still not fit for a real
    # multi-replica production deployment — that's what MOMENTUM_SECRET_KEY
    # is for — but it stops routine restarts from logging everyone out
    # during development or a simple single-instance deployment.
    _key_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".dev_secret_key")
    try:
        if os.path.exists(_key_path):
            with open(_key_path, "r") as f:
                SECRET_KEY = f.read().strip()
    except OSError:
        SECRET_KEY = ""
    if not SECRET_KEY:
        SECRET_KEY = secrets.token_urlsafe(64)
        try:
            with open(_key_path, "w") as f:
                f.write(SECRET_KEY)
        except OSError:
            pass  # read-only filesystem — falls back to the old per-process behavior
    print(f"[auth] No MOMENTUM_SECRET_KEY set — using a development key persisted at "
          f"{_key_path}. Set MOMENTUM_SECRET_KEY for a stable key in production.")
elif len(SECRET_KEY) < 32 and _ENV == "production":
    raise RuntimeError("MOMENTUM_SECRET_KEY is too short — use at least 32 characters.")

ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = env_int("MOMENTUM_TOKEN_TTL_MINUTES", 60 * 24 * 7)

# Google OAuth: set this to your Google Cloud OAuth 2.0 Client ID to enable "Sign in with Google".
GOOGLE_CLIENT_ID = env_str("GOOGLE_CLIENT_ID")

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login", auto_error=False)


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    if not hashed:
        return False
    return pwd_context.verify(plain, hashed)


def create_access_token(user_id: int) -> str:
    expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    payload = {"sub": str(user_id), "exp": expire}
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def decode_token(token: str) -> Optional[int]:
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id = payload.get("sub")
        return int(user_id) if user_id is not None else None
    except JWTError:
        return None


def verify_google_id_token(credential: str) -> dict:
    """Verify a Google Identity Services ID token and return its claims.
    Raises HTTPException on any failure (invalid signature, wrong audience, expired, etc.)."""
    if not GOOGLE_CLIENT_ID:
        raise HTTPException(500, "Google sign-in isn't configured on this server (missing GOOGLE_CLIENT_ID).")
    try:
        from google.oauth2 import id_token as google_id_token
        from google.auth.transport import requests as google_requests
        claims = google_id_token.verify_oauth2_token(credential, google_requests.Request(), GOOGLE_CLIENT_ID)
    except Exception:
        raise HTTPException(401, "Invalid Google sign-in token.")
    if not claims.get("email_verified", False):
        raise HTTPException(401, "Google account email is not verified.")
    return claims


def get_current_user(
    token: Optional[str] = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> models.User:
    credentials_error = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    if not token:
        raise credentials_error
    user_id = decode_token(token)
    if user_id is None:
        raise credentials_error
    user = db.query(models.User).get(user_id)
    if user is None or not user.is_active:
        raise credentials_error
    return user


def require_admin(current_user: models.User = Depends(get_current_user)) -> models.User:
    if current_user.role != models.UserRole.admin:
        raise HTTPException(status_code=403, detail="Admin access required")
    return current_user


# ---------------------------------------------------------------------------
# Lightweight in-memory rate limiting & login lockout.
#
# This protects the demo/single-process deployment from brute-force login and
# signup spam without adding infra dependencies. For a multi-worker or
# production deployment, replace this with a shared store (e.g. Redis) behind
# your reverse proxy / API gateway.
# ---------------------------------------------------------------------------
_rate_buckets: dict[str, deque] = defaultdict(deque)
_failed_logins: dict[str, list] = defaultdict(list)

RATE_LIMIT_WINDOW_SECONDS = 60
RATE_LIMIT_MAX_REQUESTS = 15          # per IP, per endpoint, per window
LOGIN_LOCKOUT_WINDOW_SECONDS = 15 * 60
LOGIN_LOCKOUT_MAX_FAILURES = 6         # per email, per window


def _client_ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def rate_limit(request: Request):
    """Dependency: throttles repeated hits to auth endpoints per client IP."""
    key = f"{_client_ip(request)}:{request.url.path}"
    now = time.time()
    bucket = _rate_buckets[key]
    while bucket and now - bucket[0] > RATE_LIMIT_WINDOW_SECONDS:
        bucket.popleft()
    if len(bucket) >= RATE_LIMIT_MAX_REQUESTS:
        raise HTTPException(429, "Too many requests. Please wait a moment and try again.")
    bucket.append(now)


def check_login_lockout(email: str):
    now = time.time()
    attempts = _failed_logins[email]
    attempts[:] = [t for t in attempts if now - t < LOGIN_LOCKOUT_WINDOW_SECONDS]
    if len(attempts) >= LOGIN_LOCKOUT_MAX_FAILURES:
        raise HTTPException(429, "Too many failed login attempts for this account. Please try again in 15 minutes.")


def record_failed_login(email: str):
    _failed_logins[email].append(time.time())


def clear_failed_logins(email: str):
    _failed_logins[email] = []
