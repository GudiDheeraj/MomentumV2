#!/usr/bin/env python3
"""
Regenerates frontend/env.js AND extension/config.js from the single root
.env file, and keeps the docker port variables in that .env in sync with it.

Browsers and extensions can't read .env files directly, so both the frontend
and the Chrome extension still need real JS files that set config values —
this script is the bridge: it reads the root .env (the ONE file you edit) and
writes both from it, so you never edit either by hand.

Run it any time you change .env:
    python generate_frontend_env.py

The frontend Docker container also runs this automatically on startup.

# ---------------------------------------------------------------------------
# The single source of truth is BACKEND_URL and FRONTEND_URL
# ---------------------------------------------------------------------------
# Everything else is derived:
#
#   BACKEND_URL   -> window.MOMENTUM_API_BASE        (frontend/env.js)
#                 -> self.MOMENTUM_DEFAULT_API_BASE  (extension/config.js)
#                 -> BACKEND_PORT                    (docker-compose publish)
#   FRONTEND_URL  -> FRONTEND_ORIGINS fallback       (backend CORS, app/main.py)
#                 -> APP_PUBLIC_URL fallback         (Telegram "Open app")
#                 -> FRONTEND_PORT                   (docker-compose publish)
#
# The two *_PORT lines exist only because docker-compose reads .env directly
# and can't parse a URL. They are rewritten here rather than maintained by
# hand, so changing a URL and re-running this script is genuinely all it takes
# — a stale port mapping would otherwise publish 8000 while the app talks to
# 9000, which fails as a connection refused with no clue why.
#
# MOMENTUM_API_BASE is still honoured when set, for the case where the browser
# reaches the backend at a different address than the backend binds (dev
# tunnels, reverse proxies).
"""
import os
import re
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent
ENV_FILE = ROOT / ".env"
FRONTEND_OUT = ROOT / "frontend" / "env.js"
EXTENSION_OUT = ROOT / "extension" / "config.js"

BACKEND_URL_DEFAULT = "http://localhost:8000"
FRONTEND_URL_DEFAULT = "http://localhost:5173"
DEFAULT_PORTS = {"http": 80, "https": 443}


def read_env_file() -> dict:
    try:
        from dotenv import dotenv_values
        return dict(dotenv_values(ENV_FILE)) if ENV_FILE.exists() else {}
    except ImportError:
        # Minimal fallback parser: the frontend container ships python3 but no
        # pip packages, and this script must work there.
        values = {}
        if ENV_FILE.exists():
            for line in ENV_FILE.read_text().splitlines():
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, _, val = line.partition("=")
                values[key.strip()] = val.strip()
        return values


def setting(values: dict, key: str, default: str = "") -> str:
    """Real environment wins over the file, so docker-compose's env_file and
    `KEY=... python generate_frontend_env.py` both behave as expected."""
    raw = os.environ.get(key)
    if raw is None:
        raw = values.get(key)
    return (raw or "").strip() or default


def port_of(url: str, fallback: str) -> str:
    """Host port named by a URL. https://app.example.com -> 443, so the derived
    docker mapping stays valid even for a URL with no explicit port."""
    try:
        parts = urlsplit(url)
        if parts.port:
            return str(parts.port)
        return str(DEFAULT_PORTS.get(parts.scheme, fallback))
    except ValueError:
        return fallback


def sync_port_lines(pairs: dict) -> list:
    """Rewrite BACKEND_PORT / FRONTEND_PORT in .env to match the URLs.

    Only touches those exact lines — comments, ordering and every other value
    are left byte-for-byte alone, since this file is hand-maintained and
    reformatting someone's config as a side effect of a config sync would be
    its own kind of bug.
    """
    if not ENV_FILE.exists():
        return []
    text = ENV_FILE.read_text()
    changed = []
    for key, value in pairs.items():
        pattern = re.compile(rf"^{key}=.*$", re.MULTILINE)
        replacement = f"{key}={value}"
        if pattern.search(text):
            current = pattern.search(text).group(0)
            if current != replacement:
                text = pattern.sub(replacement, text, count=1)
                changed.append(f"{key}: {current.split('=', 1)[1]} -> {value}")
        else:
            text = text.rstrip("\n") + f"\n{replacement}\n"
            changed.append(f"{key}: (added) {value}")
    if changed:
        try:
            ENV_FILE.write_text(text)
        except OSError:
            # Inside the frontend container .env is mounted read-only, and the
            # port mapping was already resolved by docker-compose before this
            # ran anyway. Nothing to fix at this point, so say so and carry on
            # rather than failing the container's startup command.
            return [f"could not update .env (read-only): {', '.join(changed)}"]
    return changed


values = read_env_file()

backend_url = setting(values, "BACKEND_URL", BACKEND_URL_DEFAULT).rstrip("/")
frontend_url = setting(values, "FRONTEND_URL", FRONTEND_URL_DEFAULT).rstrip("/")

# Explicit override first, otherwise the canonical backend URL.
api_base = setting(values, "MOMENTUM_API_BASE") or backend_url
google_client_id = setting(values, "GOOGLE_CLIENT_ID")

# --- frontend/env.js -----------------------------------------------------
frontend_content = f"""// ============================================================================
// Momentum Tracker — frontend environment config
// ============================================================================
// AUTO-GENERATED from the root .env file — do not edit by hand, your changes
// will be overwritten. Edit ../.env (BACKEND_URL) instead, then re-run
// `python generate_frontend_env.py` (or just restart the frontend container,
// which does this automatically).

window.MOMENTUM_API_BASE = "{api_base}";
window.GOOGLE_CLIENT_ID = "{google_client_id}";
"""
FRONTEND_OUT.write_text(frontend_content)
print(f"Wrote {FRONTEND_OUT} (API base: {api_base})")

# --- extension/config.js --------------------------------------------------
# This is only the DEFAULT the extension ships with — whatever's set on the
# extension's Settings page (chrome.storage) always wins, so one installed
# copy can point at a different backend without regenerating anything.
if EXTENSION_OUT.parent.exists():
    extension_content = f"""// ============================================================================
// Momentum Tracker extension — default config
// ============================================================================
// AUTO-GENERATED from the root .env file — do not edit by hand. Edit ../.env
// (BACKEND_URL) instead, then re-run `python generate_frontend_env.py`.
//
// Whatever's set on the extension's own Settings page (chrome.storage) takes
// precedence over this default.

self.MOMENTUM_DEFAULT_API_BASE = "{api_base}";
"""
    EXTENSION_OUT.write_text(extension_content)
    print(f"Wrote {EXTENSION_OUT} (default: {api_base})")
else:
    print(f"Skipped {EXTENSION_OUT} (extension/ folder not found)")

# --- .env port lines, for docker-compose ----------------------------------
for note in sync_port_lines({
    "BACKEND_PORT": port_of(backend_url, "8000"),
    "FRONTEND_PORT": port_of(frontend_url, "5173"),
}):
    print(f"Synced .env  {note}")

print(f"Backend URL:  {backend_url}")
print(f"Frontend URL: {frontend_url}")
