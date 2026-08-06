"""A very small Telegram Bot API client.

The Bot API is HTTPS POST with a JSON body and a JSON reply, so it is called
with the standard library rather than adding an HTTP client or a bot framework
to requirements.txt. Blocking urllib calls are pushed onto a worker thread
(`asyncio.to_thread`) so the polling loop and the scheduler never block the
event loop that is also serving HTTP requests.

Two failure modes are handled explicitly because they are normal operation
rather than exceptions:

  * 429 Too Many Requests — Telegram tells you how long to wait; the caller
    sleeps that long and retries once. Ignoring this gets a bot rate-limited
    for progressively longer periods.
  * "message is not modified" — editing a message to its current contents is
    an error in the Bot API but a no-op in intent (two taps racing on the same
    checkbox). It is swallowed rather than logged as a failure.
"""

from __future__ import annotations

import asyncio
import json
import logging
import urllib.error
import urllib.request
from typing import Any, Optional

from .config import bot_token

log = logging.getLogger("momentum.telegram")

API_ROOT = "https://api.telegram.org"
_TIMEOUT_MARGIN = 10  # seconds added to a long-poll timeout before urllib gives up


class TelegramError(RuntimeError):
    def __init__(self, method: str, description: str, error_code: int | None = None,
                 retry_after: int | None = None):
        super().__init__(f"{method}: {description}")
        self.method = method
        self.description = description
        self.error_code = error_code
        self.retry_after = retry_after

    @property
    def is_not_modified(self) -> bool:
        return "message is not modified" in self.description.lower()

    @property
    def is_blocked_by_user(self) -> bool:
        """The person blocked the bot or deleted the chat. Their link should be
        paused rather than retried forever."""
        d = self.description.lower()
        return "bot was blocked" in d or "chat not found" in d or "user is deactivated" in d


def call_sync(method: str, payload: dict[str, Any], token: str | None = None,
              timeout: int = 30) -> Any:
    """One Bot API call, blocking. Returns the `result` field on success."""
    token = token or bot_token()
    if not token:
        raise TelegramError(method, "TELEGRAM_BOT_TOKEN is not set")

    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        f"{API_ROOT}/bot{token}/{method}",
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout + _TIMEOUT_MARGIN) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        # Telegram puts the useful part in the *body* of a 4xx, not the status
        # line, so the body is parsed before the error is raised.
        try:
            data = json.loads(e.read().decode("utf-8"))
        except Exception:
            raise TelegramError(method, f"HTTP {e.code}", error_code=e.code) from e
        raise TelegramError(
            method,
            data.get("description", f"HTTP {e.code}"),
            error_code=data.get("error_code", e.code),
            retry_after=(data.get("parameters") or {}).get("retry_after"),
        ) from e
    except urllib.error.URLError as e:
        raise TelegramError(method, f"network error: {e.reason}") from e

    if not data.get("ok"):
        raise TelegramError(
            method,
            data.get("description", "unknown error"),
            error_code=data.get("error_code"),
            retry_after=(data.get("parameters") or {}).get("retry_after"),
        )
    return data.get("result")


async def call(method: str, payload: dict[str, Any], timeout: int = 30,
               retry_on_flood: bool = True) -> Any:
    """Async wrapper around call_sync with one automatic retry on 429."""
    try:
        return await asyncio.to_thread(call_sync, method, payload, None, timeout)
    except TelegramError as e:
        if retry_on_flood and e.retry_after:
            log.warning("telegram flood control on %s — waiting %ss", method, e.retry_after)
            await asyncio.sleep(e.retry_after + 1)
            return await asyncio.to_thread(call_sync, method, payload, None, timeout)
        raise


# ---------------------------------------------------------------------------
# Convenience wrappers
# ---------------------------------------------------------------------------

async def send_message(chat_id: str | int, text: str, keyboard: Optional[list] = None,
                       disable_notification: bool = False) -> Optional[dict]:
    payload: dict[str, Any] = {
        "chat_id": chat_id,
        "text": text,
        "parse_mode": "HTML",
        "disable_web_page_preview": True,
        "disable_notification": disable_notification,
    }
    if keyboard is not None:
        payload["reply_markup"] = {"inline_keyboard": keyboard}
    return await call("sendMessage", payload)


async def edit_message(chat_id: str | int, message_id: str | int, text: str,
                       keyboard: Optional[list] = None) -> Optional[dict]:
    """Rewrite an existing message. Returns None when the new contents are
    identical to the old — a race between two taps, not a failure."""
    payload: dict[str, Any] = {
        "chat_id": chat_id,
        "message_id": int(message_id),
        "text": text,
        "parse_mode": "HTML",
        "disable_web_page_preview": True,
    }
    payload["reply_markup"] = {"inline_keyboard": keyboard or []}
    try:
        return await call("editMessageText", payload)
    except TelegramError as e:
        if e.is_not_modified:
            return None
        raise


async def answer_callback(callback_id: str, text: str = "", show_alert: bool = False) -> None:
    """Every callback query must be answered or the client shows a spinner on
    the button until it times out. Failures here are deliberately swallowed:
    the toggle has already been written, and telling the user "something went
    wrong" because the toast failed would be a lie."""
    try:
        await call("answerCallbackQuery", {
            "callback_query_id": callback_id,
            "text": text[:200],
            "show_alert": show_alert,
        }, retry_on_flood=False)
    except TelegramError as e:
        log.debug("answerCallbackQuery ignored: %s", e)


async def get_updates(offset: int, timeout: int) -> list[dict]:
    return await call("getUpdates", {
        "offset": offset,
        "timeout": timeout,
        # Only the two update kinds this bot acts on. Narrowing it means
        # Telegram doesn't wake the loop for channel posts, edits, polls, etc.
        "allowed_updates": ["message", "callback_query"],
    }, timeout=timeout) or []


async def set_my_commands() -> None:
    """Populates the "/" menu in the Telegram client so the commands are
    discoverable instead of documented only in a README."""
    await call("setMyCommands", {"commands": [
        {"command": "today", "description": "Show today's habits, tasks and study"},
        {"command": "study", "description": "Log study minutes, e.g. /study 45 Linear Algebra"},
        {"command": "timer", "description": "Start a study stopwatch, e.g. /timer Linear Algebra"},
        {"command": "stoptimer", "description": "Stop the stopwatch and log the minutes"},
        {"command": "add", "description": "Add a task for today, e.g. /add Finish report"},
        {"command": "stats", "description": "This week's completion and streak"},
        {"command": "settings", "description": "Reminder time and timezone"},
        {"command": "pause", "description": "Stop daily reminders"},
        {"command": "resume", "description": "Start daily reminders again"},
        {"command": "unlink", "description": "Disconnect this chat from your account"},
        {"command": "help", "description": "What this bot can do"},
    ]})
