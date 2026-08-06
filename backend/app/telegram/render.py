"""Turning a day's snapshot into a Telegram message.

Two decisions worth stating, because both were the other way round first:

1. The items live in the *buttons*, not in the message body. Listing every
   habit as text and then repeating it as a row of buttons doubles the length
   of the card and makes the tappable copy look like a duplicate of the real
   one. A button already carries its own checkbox, so it is the list.
   The end-of-day recap is the exception — nothing is tappable by then, so it
   is rendered as plain text.

2. Callback payloads are terse (`mt|h|41|739468`). Telegram caps callback_data
   at 64 bytes, and a JSON blob with field names spends most of that budget on
   punctuation. The date travels inside the payload rather than being read from
   the link at handling time, so a button tapped just after midnight still
   applies to the day it was printed for, not to the new one.
"""

from __future__ import annotations

from datetime import date

# Keyword -> emoji. Cosmetic, but a column of identical bullets is much harder
# to scan than a column of distinct glyphs, and this is a list people read at a
# glance while half awake.
_HABIT_ICONS = [
    (("water", "hydrat", "drink"), "💧"),
    (("gym", "exercise", "workout", "train", "lift"), "💪"),
    (("run", "jog", "cardio"), "🏃"),
    (("walk", "steps", "10,000", "10000"), "🚶"),
    (("meditat", "mindful", "breath"), "🧘"),
    (("read", "book"), "📖"),
    (("sleep", "bed", "wake"), "🌙"),
    (("journal", "gratitude", "write", "diary"), "📝"),
    (("sugar", "junk", "diet", "eat", "meal"), "🥗"),
    (("vitamin", "supplement", "medicine", "pill"), "💊"),
    (("social", "phone", "screen", "instagram", "scroll"), "📵"),
    (("code", "leetcode", "program", "dsa"), "💻"),
    (("study", "revis", "learn", "class", "lecture"), "📚"),
    (("apply", "job", "applicat", "resume"), "💼"),
    (("water plant", "plant", "clean", "tidy", "chore"), "🧹"),
    (("pray", "quran", "bible", "temple"), "🙏"),
    (("money", "budget", "save", "expense"), "💰"),
    (("language", "spanish", "french", "german", "duolingo"), "🗣️"),
]
_DEFAULT_HABIT_ICON = "🎯"


def habit_icon(title: str) -> str:
    t = (title or "").lower()
    for keys, icon in _HABIT_ICONS:
        if any(k in t for k in keys):
            return icon
    return _DEFAULT_HABIT_ICON


def _esc(s: str) -> str:
    """HTML-escape for parse_mode=HTML. A habit called "Read <book>" would
    otherwise be silently swallowed as an unknown tag, or reject the whole
    message."""
    return (s or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def _clip(s: str, n: int) -> str:
    s = (s or "").strip()
    return s if len(s) <= n else s[: n - 1].rstrip() + "…"


def _bar(done: int, total: int, width: int = 10) -> str:
    if total <= 0:
        return "▱" * width
    filled = round(done / total * width)
    return "▰" * filled + "▱" * (width - filled)


def _pct(done: int, total: int) -> int:
    return round(done / total * 100) if total else 0


# ---------------------------------------------------------------------------
# Callback payloads
# ---------------------------------------------------------------------------
CB_PREFIX = "mt"


def _hm(minutes: int) -> str:
    """52 min / 1h 04m. Past an hour, a bare minute count stops being something
    you can read at a glance, which is the entire job of this line."""
    minutes = max(0, int(minutes))
    if minutes < 60:
        return f"{minutes} min"
    return f"{minutes // 60}h {minutes % 60:02d}m"


def cb(action: str, day: date, item_id: int | str = "") -> str:
    return f"{CB_PREFIX}|{action}|{item_id}|{day.toordinal()}"


def parse_cb(data: str) -> dict | None:
    parts = (data or "").split("|")
    if len(parts) != 4 or parts[0] != CB_PREFIX:
        return None
    action, item_id, ordinal = parts[1], parts[2], parts[3]
    try:
        day = date.fromordinal(int(ordinal))
    except (ValueError, OverflowError):
        return None
    return {
        "action": action,
        "id": int(item_id) if item_id.isdigit() else None,
        "day": day,
    }


# ---------------------------------------------------------------------------
# The daily card
# ---------------------------------------------------------------------------

def daily_card(snap: dict, name: str | None = None, app_url: str | None = None) -> tuple[str, list]:
    """Returns (html_text, inline_keyboard) for the live card."""
    day: date = snap["date"]
    habits, tasks, blocks = snap["habits"], snap["tasks"], snap["blocks"]
    h_done, t_done, b_done = snap["habits_done"], snap["tasks_done"], snap["blocks_done"]
    logged, planned = snap["logged_minutes"], snap["planned_minutes"]
    timer = snap.get("timer")

    total_items = len(habits) + len(tasks) + len(blocks)
    total_done = h_done + t_done + b_done
    all_done = total_items > 0 and total_done == total_items

    streak = snap["streak"]
    streak_line = f"🔥 <b>{streak}</b> day streak" if streak else "🌱 Day one — let's start a streak"

    head = [
        f"<b>{day.strftime('%A, %d %B')}</b>",
        streak_line,
        "",
    ]
    if total_items == 0:
        head += [
            "Nothing scheduled for today.",
            "",
            "Add habits, tasks or study blocks in the app and they'll show up here tomorrow morning.",
        ]
        keyboard = [[{"text": "➕ Add a task", "callback_data": cb("addhint", day)}]]
        if app_url:
            keyboard.append([{"text": "Open Momentum", "url": app_url}])
        return "\n".join(head), keyboard

    head.append(f"{_bar(total_done, total_items)}  <b>{total_done}/{total_items}</b> · {_pct(total_done, total_items)}%")
    if planned or logged:
        head.append(f"📚 Study · <b>{logged}</b> of {planned} min logged" if planned
                    else f"📚 Study · <b>{logged}</b> min logged")
    if timer:
        # Named the "running" line rather than folded into the study total,
        # because these minutes are not banked yet — they only join the total
        # when the timer stops.
        label = timer.get("subject") or "Studying"
        head.append(f"⏱️ <b>{_hm(timer['elapsed_minutes'])}</b> · {label} — running")
    head.append("")
    head.append("<i>Tap an item to tick it. Saved instantly to your account.</i>")

    keyboard: list[list[dict]] = []

    if habits:
        keyboard.append([{"text": f"— Habits {h_done}/{len(habits)} —",
                          "callback_data": cb("noop", day)}])
        for h in habits:
            mark = "✅" if h["done"] else "⬜"
            keyboard.append([{
                "text": f"{mark} {habit_icon(h['title'])} {_clip(h['title'], 30)}",
                "callback_data": cb("h", day, h["id"]),
            }])

    if tasks:
        keyboard.append([{"text": f"— Tasks {t_done}/{len(tasks)} —",
                          "callback_data": cb("noop", day)}])
        for t in tasks:
            mark = "✅" if t["done"] else "⬜"
            keyboard.append([{
                "text": f"{mark} {_clip(t['title'], 32)}",
                "callback_data": cb("t", day, t["id"]),
            }])

    if blocks:
        keyboard.append([{"text": f"— Study {b_done}/{len(blocks)} —",
                          "callback_data": cb("noop", day)}])
        for b in blocks:
            mark = "✅" if b["done"] else "⬜"
            row = [{
                "text": f"{mark} {b['start']} {_clip(b['subject'], 18)} ({b['minutes']}m)",
                "callback_data": cb("b", day, b["id"]),
            }]
            # The stopwatch shares the row with the checkbox rather than taking
            # one of its own: a block already costs a line, and a second line
            # each would push the study section past the point where the card
            # fits on a phone screen.
            if timer and timer.get("block_id") == b["id"]:
                row.append({"text": "⏹ Stop", "callback_data": cb("tx", day, b["id"])})
            elif not b["done"]:
                row.append({"text": "▶️", "callback_data": cb("ts", day, b["id"])})
            keyboard.append(row)

    # Ad-hoc study, for the reading that wasn't on the plan. The free timer
    # lives here because that is the same thing measured rather than estimated.
    if timer and timer.get("block_id") is None:
        keyboard.append([{"text": f"⏹ Stop timer · {_hm(timer['elapsed_minutes'])}",
                          "callback_data": cb("tx", day)}])
    else:
        keyboard.append([{"text": "⏱ Start a timer", "callback_data": cb("ts", day)}])
    keyboard.append([
        {"text": "＋15 min", "callback_data": cb("m15", day)},
        {"text": "＋30 min", "callback_data": cb("m30", day)},
        {"text": "＋60 min", "callback_data": cb("m60", day)},
    ])

    bottom = []
    if not all_done:
        bottom.append({"text": "✅ Complete for Today", "callback_data": cb("all", day)})
    else:
        bottom.append({"text": "🎉 All done — nice work", "callback_data": cb("noop", day)})
    keyboard.append(bottom)

    last_row = [{"text": "🔄 Refresh", "callback_data": cb("ref", day)}]
    if app_url:
        last_row.append({"text": "Open app", "url": app_url})
    keyboard.append(last_row)

    return "\n".join(head), keyboard


def frozen_card(snap: dict) -> str:
    """Yesterday's card once the day is over: the same information as plain
    text, with nothing left to tap."""
    day: date = snap["date"]
    lines = [f"<b>{day.strftime('%A, %d %B')}</b> — closed", ""]

    def section(label: str, rows: list[dict], key: str, done_count: int) -> None:
        if not rows:
            return
        lines.append(f"<b>{label}</b> {done_count}/{len(rows)}")
        for r in rows:
            mark = "✅" if r["done"] else "⬜"
            lines.append(f"{mark} {_esc(_clip(r[key], 40))}")
        lines.append("")

    section("Habits", snap["habits"], "title", snap["habits_done"])
    section("Tasks", snap["tasks"], "title", snap["tasks_done"])
    section("Study", snap["blocks"], "subject", snap["blocks_done"])
    if snap["logged_minutes"]:
        lines.append(f"📚 {snap['logged_minutes']} minutes studied")
    return "\n".join(lines).strip()


def evening_recap(snap: dict, carried: int = 0, app_url: str | None = None) -> tuple[str, list]:
    """The close-of-day message: what landed, what didn't, what moves forward."""
    day: date = snap["date"]
    habits, tasks, blocks = snap["habits"], snap["tasks"], snap["blocks"]
    total = len(habits) + len(tasks) + len(blocks)
    done = snap["habits_done"] + snap["tasks_done"] + snap["blocks_done"]
    pct = _pct(done, total)

    if pct == 100 and total:
        opener = "🎉 <b>Perfect day.</b> Everything on the list is done."
    elif pct >= 70:
        opener = "👏 <b>Strong day.</b>"
    elif pct >= 30:
        opener = "🙂 <b>Partial day.</b> Progress counts."
    elif total:
        opener = "🌙 <b>Quiet day.</b> Tomorrow is a fresh list."
    else:
        opener = "🌙 <b>Nothing was scheduled today.</b>"

    lines = [opener, "", f"<b>{day.strftime('%A, %d %B')}</b>"]
    if total:
        lines.append(f"{_bar(done, total)}  {done}/{total} · {pct}%")
        lines.append("")
        if habits:
            lines.append(f"🎯 Habits · {snap['habits_done']}/{len(habits)}")
        if tasks:
            lines.append(f"✓ Tasks · {snap['tasks_done']}/{len(tasks)}")
        if blocks or snap["logged_minutes"]:
            lines.append(f"📚 Study · {snap['logged_minutes']} min")

    missed = [h["title"] for h in habits if not h["done"]][:5]
    if missed:
        lines += ["", "<b>Missed today</b>", *(f"⬜ {_esc(_clip(m, 40))}" for m in missed)]

    if snap["streak"]:
        lines += ["", f"🔥 Streak: <b>{snap['streak']}</b> days"]
    if carried:
        lines += ["", f"↪️ {carried} unfinished task{'s' if carried != 1 else ''} moved to tomorrow."]

    lines += ["", "<i>Your list for tomorrow arrives in the morning.</i>"]

    keyboard = [[{"text": "Open app", "url": app_url}]] if app_url else []
    return "\n".join(lines), keyboard


def stats_message(stats: dict) -> str:
    lines = [
        "<b>Last 7 days</b>",
        f"{stats['start'].strftime('%d %b')} – {stats['end'].strftime('%d %b')}",
        "",
        f"🎯 Habits · {stats['habit_done']}/{stats['habit_possible']} ticks "
        f"({stats['habit_pct']}%)",
        f"{_bar(stats['habit_done'], stats['habit_possible'])}",
        "",
        f"✓ Tasks · {stats['tasks_done']}/{stats['tasks_total']} completed",
        f"📚 Study · {stats['minutes']} minutes ({round(stats['minutes'] / 60, 1)} h)",
        "",
        f"🔥 Current streak · <b>{stats['streak']}</b> days",
    ]
    return "\n".join(lines)


HELP_TEXT = (
    "<b>Momentum</b> — your day, in one message.\n\n"
    "Every morning I send your habits, tasks and study blocks as tappable "
    "checkboxes. Tapping one saves it to your account immediately and rewrites "
    "this card, so the list you see is always the real state — in Telegram and "
    "in the app.\n\n"
    "<b>Commands</b>\n"
    "/today — show today's card again\n"
    "/add Finish report — add a task to today\n"
    "/study 45 Linear Algebra — log 45 minutes\n"
    "/stats — the last seven days\n"
    "/settings — see your reminder time\n"
    "/time 07:30 — change the morning reminder\n"
    "/tz Asia/Kolkata — set your timezone\n"
    "/evening off — turn the end-of-day recap off\n"
    "/pause and /resume — mute or unmute reminders\n"
    "/unlink — disconnect this chat"
)
