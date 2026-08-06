"""Telegram delivery for the daily habit / task / study card.

The design in one paragraph: a background long-polling loop (bot.py) and a
per-minute scheduler (scheduler.py) run inside the FastAPI process. The
scheduler sends each linked person one message a morning — their habits, tasks
and study blocks for that date, rendered as inline-keyboard buttons. Tapping a
button writes the toggle straight to the database and rewrites that same
message in place, so the chat holds exactly one live card per day rather than a
running commentary. At close of day the card's buttons are stripped, a recap is
sent, unfinished tasks optionally roll forward, and the next morning a fresh
card arrives.

Nothing here adds a dependency: the Bot API is plain HTTPS + JSON, so it is
called with urllib from a worker thread rather than pulling in an HTTP client
or a bot framework.
"""

from .config import is_configured, bot_token, bot_username  # noqa: F401
