"""Environment-driven configuration for the Telegram integration.

Read lazily rather than at import time: main.py loads the .env file before it
imports anything else, but tests and scripts import this module directly, and a
module-level os.getenv() would freeze whatever the environment happened to be
at first import.
"""

import os
from functools import lru_cache


def bot_token() -> str:
    """The token from @BotFather. Empty string means "not configured", which
    every caller treats as "stay switched off" rather than as an error."""
    return (os.getenv("TELEGRAM_BOT_TOKEN") or "").strip()


def is_configured() -> bool:
    return bool(bot_token())


def is_enabled() -> bool:
    """TELEGRAM_ENABLED=0 keeps the integration switched off even with a token
    present — useful when running a second copy of the backend locally, since
    two pollers on one token steal each other's updates."""
    flag = (os.getenv("TELEGRAM_ENABLED", "1") or "").strip().lower()
    return is_configured() and flag not in ("0", "false", "no", "off")


def poll_timeout() -> int:
    """Long-poll seconds. Telegram holds the request open this long when there
    is nothing to report, so a high value means fewer requests, not slower
    delivery."""
    try:
        return max(1, min(50, int(os.getenv("TELEGRAM_POLL_TIMEOUT", "25"))))
    except ValueError:
        return 25


def default_timezone() -> str:
    return (os.getenv("TELEGRAM_DEFAULT_TZ") or "UTC").strip() or "UTC"


def link_code_ttl_minutes() -> int:
    try:
        return max(1, int(os.getenv("TELEGRAM_LINK_CODE_TTL_MIN", "15")))
    except ValueError:
        return 15


@lru_cache(maxsize=4)
def _cached_username(token: str) -> str:
    """getMe once per token per process — the bot's @handle never changes
    within a run, and the deep link that the settings page shows needs it on
    every page load."""
    from .client import call_sync
    try:
        me = call_sync("getMe", {}, token=token)
        return (me or {}).get("username", "") or ""
    except Exception:
        return ""


def bot_username() -> str:
    """The bot's @handle, used to build the `https://t.me/<bot>?start=<code>`
    deep link. Falls back to TELEGRAM_BOT_USERNAME when the network call
    fails, so the settings page still renders something usable offline."""
    env = (os.getenv("TELEGRAM_BOT_USERNAME") or "").strip().lstrip("@")
    if env:
        return env
    token = bot_token()
    if not token:
        return ""
    return _cached_username(token)
