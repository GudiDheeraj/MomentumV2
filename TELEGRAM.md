# Telegram daily card

Every morning the backend sends each linked account one message: their habits,
tasks and study blocks for that date, as tappable checkboxes. A tap writes
straight to the same rows the web app reads and rewrites the message in place,
so the chat holds one live card per day rather than a running commentary. At
close of day the buttons are stripped, a recap is sent, unfinished tasks roll
forward, and the next morning a fresh card arrives.

The day closes at **midnight** by default, or **as soon as every item is
ticked** — whichever comes first. Both are per-account settings on the Telegram
page in the app (`close_when_done`, `evening_time`).

## Setup

1. Message [@BotFather](https://t.me/BotFather) → `/newbot` → copy the token.
2. Add to the root `.env`:

   ```
   TELEGRAM_BOT_TOKEN=123456:ABC-your-token-here
   TELEGRAM_DEFAULT_TZ=Asia/Kolkata
   # Optional
   TELEGRAM_ENABLED=1              # 0 switches delivery off without removing the token
   TELEGRAM_BOT_USERNAME=my_bot    # skips a getMe call at startup
   TELEGRAM_CATCHUP_MINUTES=180    # how late a missed send may still be delivered
   APP_PUBLIC_URL=https://app.example.com   # adds an "Open app" button (https only)
   ```

3. `pip install -r backend/requirements.txt` (adds `tzdata`; the Bot API itself
   is called with `urllib`, no new HTTP dependency).
4. Restart the backend. The poller and scheduler start automatically and are a
   no-op when no token is set.
5. In the app: **Telegram** → **Connect Telegram** → tap the `t.me` link. The
   one-time code binds that chat to your account.

> **One poller per token.** Long polling means exactly one process may hold a
> given bot token. With multiple uvicorn workers or replicas, set
> `TELEGRAM_ENABLED=0` on all but one — otherwise they steal each other's
> updates and half the taps go missing. A 409 in the log is this.

## Commands

| Command | Does |
| --- | --- |
| `/today` | Send today's card again |
| `/add Finish report` | Add a task to today (bare text works too) |
| `/study 45 Linear Algebra` | Log 45 minutes after the fact |
| `/timer Linear Algebra` | Start a stopwatch (bare `/timer` works too) |
| `/stoptimer` | Stop it and log the real elapsed minutes |
| `/stats` | Last seven days + streak |
| `/settings` | Current reminder time, timezone, toggles |
| `/time 07:30`, `/tz Europe/London` | Change when it arrives |
| `/evening on\|off`, `/carry on\|off` | Recap and task roll-over |
| `/settings` | Includes when the day closes and whether ticking everything closes it early |
| `/pause`, `/resume`, `/unlink` | Mute, unmute, disconnect |

## How the pieces fit

| File | Responsibility |
| --- | --- |
| `app/telegram/config.py` | Environment reading; `is_enabled()` gates everything |
| `app/telegram/client.py` | Bot API over `urllib`, on a worker thread; handles 429 and "message is not modified" |
| `app/telegram/service.py` | All database work — snapshots, toggles, streak, carry-over, link codes |
| `app/telegram/render.py` | Snapshot → message text + inline keyboard; callback payload encoding |
| `app/telegram/delivery.py` | Send / refresh / close-out, shared by bot, scheduler and REST |
| `app/telegram/bot.py` | Long-poll loop, commands, button handling |
| `app/telegram/scheduler.py` | One-minute tick: who is due a card, and redrawing any card with a running timer |
| `app/routers/telegram.py` | `/api/telegram/*` — status, link-code, settings, send-now, preview |

New tables: `telegram_links`, `telegram_link_codes`, `study_sessions`
(minutes actually studied, as opposed to `study_blocks`, which is the plan) and
`study_timers` (the one stopwatch a person may have running).

## The study timer

Tap ▶️ beside a study block, or **⏱ Start a timer** for unplanned work. The card
grows a `⏱️ 1h 13m · Linear Algebra — running` line and redraws itself every
minute off the same scheduler tick that sends the cards. Stopping writes the
real elapsed minutes as a `study_session` and ticks the block off.

The same timer is on the Study Plan page in the app — start on your laptop,
stop from your phone, or the other way round. Elapsed time is always derived
from `started_at` rather than counted up anywhere, so a closed tab, a sleeping
laptop or a restarted backend can't make the figure drift.

## Design notes

- **Times are stored per user in their own IANA timezone.** The server's
  "today" is the wrong day for anyone not sitting in the server's timezone, and
  it changes at the wrong moment — 5:30am local for an Indian user on a UTC host.
- **Sends are idempotent.** `last_morning_date` / `last_evening_date` record
  which local day each message covered, so a restart or a backwards clock jump
  can't produce two cards for one day. A missed send is still delivered if the
  backend comes back within `TELEGRAM_CATCHUP_MINUTES`; past that it is dropped
  rather than waking someone at midnight with their 8am list.
- **Old cards stop being tappable.** Otherwise someone scrolling up three days
  later taps a checkbox and silently rewrites Tuesday.
- **Study minutes are derived, not duplicated.** Completing a block logs its
  planned length against `block_id`; un-completing it deletes that row, so
  tapping twice can't inflate the daily total.
- **The link code is `token_urlsafe`, not six digits.** It is the only thing
  proving the chat belongs to the logged-in account, and a short numeric code
  is guessable by anyone willing to message the bot in a loop.
