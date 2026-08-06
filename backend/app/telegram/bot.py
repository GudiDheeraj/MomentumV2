"""The long-polling bot loop and its command / button handlers.

Long polling rather than a webhook because it needs no public HTTPS URL, no
tunnel and no reverse-proxy route — the backend can be running on a laptop
behind NAT and the bot still works. The trade-off is that exactly one process
may poll a given token: two pollers steal each other's updates and each sees
half the taps. That is why `TELEGRAM_ENABLED=0` exists, and why the loop logs
loudly on 409 Conflict instead of retrying silently.

Handler contract: every handler is given an already-resolved link (or None for
an unlinked chat), does its database work through `delivery.run_db`, and
answers. Nothing here holds a session across an await.
"""

from __future__ import annotations

import asyncio
import logging
import re
from datetime import date

from .. import models
from . import client, config, render, service
from .delivery import close_out_day, refresh_card, run_db, send_daily_card

log = logging.getLogger("momentum.telegram")

_UNLINKED_HELP = (
    "👋 <b>Momentum</b>\n\n"
    "This chat isn't connected to an account yet.\n\n"
    "Open Momentum in your browser → <b>Telegram</b> in the sidebar → "
    "<b>Connect Telegram</b>, and tap the link it gives you. "
    "It'll bring you straight back here.\n\n"
    "<i>Already have a code? Send</i> <code>/start YOUR_CODE</code>"
)


# ---------------------------------------------------------------------------
# Message handlers
# ---------------------------------------------------------------------------

async def _handle_start(chat: dict, from_user: dict, arg: str) -> None:
    chat_id = str(chat.get("id"))
    code = (arg or "").strip()

    if not code:
        link = await run_db(lambda db: service.link_for_chat(db, chat_id))
        if link:
            await client.send_message(chat_id, "You're already connected. Here's today:")
            await send_daily_card(link.id)
        else:
            await client.send_message(chat_id, _UNLINKED_HELP)
        return

    def _redeem(db):
        link = service.redeem_link_code(db, code, chat, from_user)
        if not link:
            return None
        return {"id": link.id, "name": link.owner.name, "time": link.daily_time,
                "tz": link.timezone}

    result = await run_db(_redeem)
    if not result:
        await client.send_message(
            chat_id,
            "❌ That link code is invalid or has expired.\n\n"
            "Codes last a few minutes. Generate a fresh one from the Telegram "
            "page in the app and try again.",
        )
        return

    await client.send_message(
        chat_id,
        f"✅ <b>Connected.</b> This chat is now linked to "
        f"<b>{render._esc(result['name'])}</b>'s Momentum account.\n\n"
        f"You'll get your list every morning at <b>{result['time']}</b> "
        f"({render._esc(result['tz'])}).\n"
        f"Change it any time with <code>/time 07:30</code> and "
        f"<code>/tz Asia/Kolkata</code>.\n\n"
        "Here's today to get started 👇",
    )
    await send_daily_card(result["id"])


async def _handle_today(link: models.TelegramLink) -> None:
    await send_daily_card(link.id)


async def _handle_stats(link: models.TelegramLink) -> None:
    day = service.today_local(link)
    stats = await run_db(lambda db: service.week_stats(db, link.user_id, day))
    await client.send_message(link.chat_id, render.stats_message(stats))


async def _handle_add(link: models.TelegramLink, text: str) -> None:
    title = text.strip()
    if not title:
        await client.send_message(link.chat_id,
                                   "Add what? Try <code>/add Finish the report</code>")
        return
    day = service.today_local(link)
    task = await run_db(lambda db: service.add_task(db, link.user_id, day, title))
    if not task:
        await client.send_message(link.chat_id, "Couldn't add that one.")
        return
    await client.send_message(link.chat_id, f"➕ Added <b>{render._esc(title)}</b> to today.")
    # The card is now out of date, so it is re-rendered rather than left
    # showing a list that is missing the thing just added.
    if link.active_message_id and link.active_message_date == day:
        await refresh_card(link.chat_id, link.active_message_id, link.user_id, day)
    else:
        await send_daily_card(link.id)


_STUDY_RE = re.compile(r"^\s*(\d{1,4})\s*(?:m|min|mins|minutes)?\s*(.*)$", re.I)


async def _handle_study(link: models.TelegramLink, text: str) -> None:
    m = _STUDY_RE.match(text or "")
    if not m:
        await client.send_message(
            link.chat_id,
            "Log study time like this:\n<code>/study 45</code>\n"
            "<code>/study 90 Linear Algebra</code>",
        )
        return
    minutes = int(m.group(1))
    if minutes <= 0 or minutes > 24 * 60:
        await client.send_message(link.chat_id, "That has to be between 1 and 1440 minutes.")
        return
    subject = m.group(2).strip() or None
    day = service.today_local(link)
    await run_db(lambda db: service.log_study_minutes(db, link.user_id, day, minutes, subject))
    snap = await run_db(lambda db: service.build_snapshot(db, link.user_id, day))
    total = snap["logged_minutes"]
    label = f" of {render._esc(subject)}" if subject else ""
    await client.send_message(
        link.chat_id,
        f"📚 Logged <b>{minutes} min</b>{label}. Today's total: <b>{total} min</b>.",
    )
    if link.active_message_id and link.active_message_date == day:
        await refresh_card(link.chat_id, link.active_message_id, link.user_id, day)


async def _handle_settings(link: models.TelegramLink) -> None:
    local = service.now_local(link)
    lines = [
        "<b>Your settings</b>",
        "",
        f"🕗 Morning list · <b>{link.daily_time}</b>",
        f"🌙 Evening recap · <b>{'on at ' + link.evening_time if link.send_evening else 'off'}</b>",
        f"🌍 Timezone · <b>{render._esc(link.timezone)}</b> (now {local.strftime('%H:%M')})",
        f"↪️ Carry unfinished tasks over · <b>{'on' if link.carry_over_tasks else 'off'}</b>",
        f"🔔 Reminders · <b>{'paused' if link.paused else 'active'}</b>",
        "",
        "<code>/time 07:30</code> · <code>/tz Europe/London</code> · "
        "<code>/evening off</code> · <code>/carry off</code>",
    ]
    await client.send_message(link.chat_id, "\n".join(lines))


async def _set_field(link: models.TelegramLink, **fields) -> None:
    def _apply(db):
        row = db.query(models.TelegramLink).get(link.id)
        if not row:
            return
        for k, v in fields.items():
            setattr(row, k, v)
        db.commit()
    await run_db(_apply)


async def _handle_time(link: models.TelegramLink, arg: str) -> None:
    value = (arg or "").strip()
    if not service.valid_hhmm(value):
        await client.send_message(link.chat_id,
                                   "Give me a 24-hour time, e.g. <code>/time 07:30</code>")
        return
    await _set_field(link, daily_time=value)
    await client.send_message(link.chat_id, f"🕗 Morning list moved to <b>{value}</b>.")


async def _handle_tz(link: models.TelegramLink, arg: str) -> None:
    value = (arg or "").strip()
    if not service.valid_timezone(value):
        await client.send_message(
            link.chat_id,
            "I don't know that timezone. Use an IANA name like "
            "<code>Asia/Kolkata</code>, <code>Europe/London</code> or "
            "<code>America/New_York</code>.",
        )
        return
    await _set_field(link, timezone=value)
    await client.send_message(link.chat_id, f"🌍 Timezone set to <b>{render._esc(value)}</b>.")


def _onoff(arg: str) -> bool | None:
    a = (arg or "").strip().lower()
    if a in ("on", "yes", "1", "true", "enable"):
        return True
    if a in ("off", "no", "0", "false", "disable"):
        return False
    return None


async def _handle_evening(link: models.TelegramLink, arg: str) -> None:
    val = _onoff(arg)
    if val is None:
        await client.send_message(link.chat_id, "Say <code>/evening on</code> or <code>/evening off</code>.")
        return
    await _set_field(link, send_evening=val)
    await client.send_message(link.chat_id,
                               f"🌙 Evening recap {'on' if val else 'off'}.")


async def _handle_carry(link: models.TelegramLink, arg: str) -> None:
    val = _onoff(arg)
    if val is None:
        await client.send_message(link.chat_id, "Say <code>/carry on</code> or <code>/carry off</code>.")
        return
    await _set_field(link, carry_over_tasks=val)
    await client.send_message(
        link.chat_id,
        "↪️ Unfinished tasks will roll over to the next day."
        if val else "↪️ Unfinished tasks will stay where they are.",
    )


async def _handle_pause(link: models.TelegramLink, paused: bool) -> None:
    await _set_field(link, paused=paused)
    await client.send_message(
        link.chat_id,
        "🔕 Reminders paused. Send /resume when you want them back."
        if paused else "🔔 Reminders back on. See you in the morning.",
    )


async def _handle_unlink(link: models.TelegramLink) -> None:
    def _drop(db):
        row = db.query(models.TelegramLink).get(link.id)
        if row:
            service.unlink(db, row)
    await run_db(_drop)
    await client.send_message(
        link.chat_id,
        "👋 Disconnected. Your habits and history are untouched — they're all "
        "still in the app. Reconnect any time from the Telegram page.",
    )


async def _handle_timer(link: models.TelegramLink, arg: str) -> None:
    """/timer [subject] — start the stopwatch. No subject is fine; plenty of
    study doesn't have a name until afterwards."""
    subject = (arg or "").strip() or None
    state = await run_db(lambda db: service.start_timer(
        db, link.user_id, subject=subject, source="telegram", chat_id=link.chat_id))
    label = render._esc(state.get("subject") or "study")
    await client.send_message(
        link.chat_id,
        f"⏱️ Timing <b>{label}</b>. Send /stoptimer when you're done, "
        f"or tap Stop on today's card.",
    )


async def _handle_stop_timer(link: models.TelegramLink, arg: str) -> None:
    day = service.today_local(link)
    result = await run_db(lambda db: service.stop_timer(db, link.user_id, day))
    if not result:
        await client.send_message(link.chat_id, "No timer is running.")
        return
    if not result["logged"]:
        await client.send_message(link.chat_id, "That was under a minute — nothing logged.")
        return
    label = f" of {render._esc(result['subject'])}" if result.get("subject") else ""
    await client.send_message(
        link.chat_id, f"📚 Logged <b>{result['minutes']} min</b>{label}.")
    await _handle_today(link)


_COMMANDS = {
    "today": lambda link, arg: _handle_today(link),
    "list": lambda link, arg: _handle_today(link),
    "stats": lambda link, arg: _handle_stats(link),
    "add": _handle_add,
    "study": _handle_study,
    "settings": lambda link, arg: _handle_settings(link),
    "time": _handle_time,
    "tz": _handle_tz,
    "timezone": _handle_tz,
    "evening": _handle_evening,
    "carry": _handle_carry,
    "pause": lambda link, arg: _handle_pause(link, True),
    "resume": lambda link, arg: _handle_pause(link, False),
    "unlink": lambda link, arg: _handle_unlink(link),
    "timer": _handle_timer,
    "stoptimer": _handle_stop_timer,
    # /stop pauses reminders — a long-standing meaning that predates the
    # stopwatch, so the timer gets the longer name rather than quietly
    # changing what /stop does for anyone already using it.
    "stop": lambda link, arg: _handle_pause(link, True),
}


async def handle_message(msg: dict) -> None:
    chat = msg.get("chat") or {}
    chat_id = str(chat.get("id"))
    text = (msg.get("text") or "").strip()
    from_user = msg.get("from") or {}
    if not chat_id or not text:
        return

    # /command@BotName is what Telegram sends in groups; the suffix is stripped
    # so the same handler serves both.
    command, _, arg = text.partition(" ")
    command = command.lower()
    if command.startswith("/"):
        command = command[1:].split("@", 1)[0]
    else:
        command, arg = "", text

    if command == "start":
        await _handle_start(chat, from_user, arg)
        return

    link = await run_db(lambda db: service.link_for_chat(db, chat_id))
    if not link:
        await client.send_message(chat_id, _UNLINKED_HELP)
        return

    await run_db(lambda db: _touch(db, link.id))

    if command in ("help", "?"):
        await client.send_message(chat_id, render.HELP_TEXT)
        return

    handler = _COMMANDS.get(command)
    if handler:
        await handler(link, arg)
        return

    # Not a command. Treated as a quick task rather than an error: typing
    # "buy milk" at the bot and getting "unknown command" back is a worse
    # answer than just adding it.
    if command:
        await client.send_message(
            chat_id,
            "I don't know that command. Send /help to see what I can do.",
        )
    else:
        await _handle_add(link, text)


def _touch(db, link_id: int) -> None:
    from datetime import datetime
    row = db.query(models.TelegramLink).get(link_id)
    if row:
        row.last_interaction_at = datetime.utcnow()
        db.commit()


# ---------------------------------------------------------------------------
# Button handler
# ---------------------------------------------------------------------------

_QUICK_MINUTES = {"m15": 15, "m30": 30, "m60": 60}


async def handle_callback(query: dict) -> None:
    query_id = query.get("id")
    message = query.get("message") or {}
    chat_id = str((message.get("chat") or {}).get("id") or "")
    message_id = message.get("message_id")
    parsed = render.parse_cb(query.get("data") or "")

    if not parsed or not chat_id:
        await client.answer_callback(query_id, "That button has expired.")
        return
    if parsed["action"] == "noop":
        await client.answer_callback(query_id)
        return

    link = await run_db(lambda db: service.link_for_chat(db, chat_id))
    if not link:
        await client.answer_callback(query_id, "This chat isn't linked to an account.", True)
        return

    user_id = link.user_id
    day: date = parsed["day"]
    action = parsed["action"]
    item_id = parsed["id"]
    toast = ""

    if action == "h" and item_id:
        state = await run_db(lambda db: service.toggle_habit(db, user_id, item_id, day))
        toast = "" if state is None else ("✅ Done" if state else "Unticked")
    elif action == "t" and item_id:
        state = await run_db(lambda db: service.toggle_task(db, user_id, item_id))
        toast = "" if state is None else ("✅ Done" if state else "Unticked")
    elif action == "b" and item_id:
        state = await run_db(lambda db: service.toggle_study_block(db, user_id, item_id, day))
        toast = "" if state is None else ("📚 Logged" if state else "Removed from today's total")
    elif action == "ts":
        # item_id present -> timing a planned block; absent -> free timer.
        def _start(db):
            return service.start_timer(db, user_id, block_id=item_id,
                                       source="telegram", chat_id=chat_id)
        try:
            t = await run_db(_start)
        except ValueError as e:
            await client.answer_callback(query_id, str(e), True)
            return
        toast = f"⏱️ Timing {t.get('subject') or 'study'}"
    elif action == "tx":
        result = await run_db(lambda db: service.stop_timer(db, user_id, day))
        if not result:
            toast = "No timer was running"
        elif not result["logged"]:
            toast = "Less than a minute — nothing logged"
        else:
            toast = f"📚 Logged {result['minutes']} min"
    elif action in _QUICK_MINUTES:
        mins = _QUICK_MINUTES[action]
        await run_db(lambda db: service.log_study_minutes(db, user_id, day, mins))
        toast = f"📚 +{mins} min"
    elif action == "all":
        await run_db(lambda db: service.complete_day(db, user_id, day))
        toast = "🎉 All set for today"
    elif action == "ref":
        toast = "Up to date"
    elif action == "addhint":
        await client.answer_callback(query_id)
        await client.send_message(
            chat_id,
            "Send me a task and I'll add it to today — either "
            "<code>/add Finish the report</code> or just type it.",
        )
        return
    else:
        await client.answer_callback(query_id, "That button has expired.")
        return

    # Answer first, redraw second. The client shows a spinner on the button
    # until the callback is answered, and the redraw is the slower of the two
    # calls — doing it the other way round makes every tap feel laggy.
    await client.answer_callback(query_id, toast)
    snap = await refresh_card(chat_id, message_id, user_id, day)
    await run_db(lambda db: _touch(db, link.id))
    await _maybe_close_early(link.id, day, snap)


async def _maybe_close_early(link_id: int, day: date, snap: dict) -> None:
    """Finish the day the moment the last item is ticked.

    Waiting until midnight to acknowledge a day that was finished at 6pm makes
    the card feel like it isn't paying attention. This runs the same close-out
    the scheduler would: freeze the card, send the recap, roll nothing over
    (there is nothing unfinished, by definition).

    Three guards, all necessary:
      * an empty day is not a finished day — otherwise a link with no habits
        yet gets a "perfect day" recap every time anything is tapped;
      * the day must not already be closed, or a tap on a stale card would send
        a second recap;
      * un-ticking and re-ticking the last item is a real thing people do, and
        last_evening_date is what stops that from sending the recap twice.
    """
    total = len(snap["habits"]) + len(snap["tasks"]) + len(snap["blocks"])
    done = snap["habits_done"] + snap["tasks_done"] + snap["blocks_done"]
    if total == 0 or done < total:
        return

    def _should_close(db):
        link = db.query(models.TelegramLink).get(link_id)
        if not link or not link.close_when_done:
            return False
        return link.last_evening_date != day

    if not await run_db(_should_close):
        return
    log.info("telegram: day complete for link %s — closing early", link_id)
    await close_out_day(link_id, day)


# ---------------------------------------------------------------------------
# The loop
# ---------------------------------------------------------------------------

async def _dispatch(update: dict) -> None:
    try:
        if "callback_query" in update:
            await handle_callback(update["callback_query"])
        elif "message" in update:
            await handle_message(update["message"])
    except Exception:
        # One malformed update must never take the poller down — it would stop
        # every other person's buttons from working too.
        log.exception("error handling telegram update %s", update.get("update_id"))


async def run_polling(stop_event: asyncio.Event) -> None:
    if not config.is_enabled():
        log.info("telegram: disabled (no TELEGRAM_BOT_TOKEN, or TELEGRAM_ENABLED=0)")
        return

    log.info("telegram: starting long-poll loop")
    try:
        await client.set_my_commands()
    except client.TelegramError as e:
        log.warning("telegram: couldn't register commands (%s)", e)

    offset = 0
    backoff = 1
    while not stop_event.is_set():
        try:
            updates = await client.get_updates(offset, config.poll_timeout())
            backoff = 1
            for update in updates:
                offset = max(offset, int(update.get("update_id", 0)) + 1)
                await _dispatch(update)
        except client.TelegramError as e:
            if e.error_code == 409:
                # Another poller (or a webhook) owns this token. Retrying
                # faster only makes both copies worse.
                log.error("telegram: 409 Conflict — another process is polling this "
                          "bot token, or a webhook is set. Sleeping 30s.")
                await asyncio.sleep(30)
                continue
            log.warning("telegram poll error: %s (retrying in %ss)", e, backoff)
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, 60)
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("telegram: unexpected poll failure")
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, 60)

    log.info("telegram: poll loop stopped")
