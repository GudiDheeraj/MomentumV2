"""Environment loading and typed reads — imported before anything that calls
os.getenv() at module level.

Two problems this solves, both of which surface as a crash at import time or,
worse, as the app quietly using the wrong database.

1. **A blank value means "unset", not "empty string".**

   `MOMENTUM_LLM_THREADS=` in a .env file is the ordinary way to write "leave
   this alone" — a commented-out line with the name still visible. But
   os.getenv("K", default) returns the default only when the key is *absent*;
   a key present and empty returns "", and `int("")` raises

       ValueError: invalid literal for int() with base 10: ''

   at import time, which uvicorn reports as a reloader subprocess dying with a
   traceback ending somewhere unrelated to the config that caused it.

2. **The .env file has to be loaded before those reads happen.**

   Loading it in main.py works for `uvicorn app.main:app`, but not for
   seed.py, alembic, or any script that imports app.database directly — those
   silently fall back to sqlite:///./momentum.db even with DATABASE_URL set,
   and seed a different database than the one the app serves. Doing the load
   here, on import, means anything that reads config necessarily triggers it
   first.
"""

import os
from pathlib import Path

# backend/app/env.py -> backend/app -> backend -> project root
ROOT_ENV = Path(__file__).resolve().parents[2] / ".env"


def _load_env_files() -> None:
    """Root .env first, then any backend/.env or cwd .env as a fallback.

    load_dotenv never overrides a variable already present in the real
    environment, so docker-compose's env_file and `KEY=x python ...` both keep
    winning over the file.
    """
    try:
        from dotenv import load_dotenv
    except ImportError:  # python-dotenv absent: rely on the real environment
        return
    load_dotenv(ROOT_ENV)
    load_dotenv()


_load_env_files()


def env_str(key: str, default: str = "") -> str:
    """Trimmed value, or the default when unset OR blank."""
    raw = os.getenv(key)
    if raw is None:
        return default
    return raw.strip() or default


def env_int(key: str, default: int) -> int:
    """Integer value, falling back to the default when unset, blank, or not a
    number.

    A malformed number is a warning rather than a crash on purpose: these are
    all tuning knobs — thread counts, cache TTLs, token lifetimes — and none is
    worth refusing to start the process over. The default is a working value in
    every case, so the app runs and says what it ignored.
    """
    raw = os.getenv(key)
    if raw is None or not raw.strip():
        return default
    try:
        return int(raw.strip())
    except ValueError:
        print(f"[config] {key}={raw!r} is not a number — using {default}")
        return default


def env_bool(key: str, default: bool = False) -> bool:
    """Accepts 1/0, true/false, yes/no, on/off. Blank means unset."""
    raw = os.getenv(key)
    if raw is None or not raw.strip():
        return default
    return raw.strip().lower() in ("1", "true", "yes", "on")
