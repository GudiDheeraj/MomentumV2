#!/usr/bin/env python3
"""Check a Telegram bot setup end to end, without starting the app.

    python telegram_doctor.py

"Nothing happened" has half a dozen possible causes and the bot itself can't
tell you which — it never received your message, so it can't reply to say so.
This asks Telegram directly and reports which link in the chain is broken:

    .env token -> Telegram accepts it -> no webhook stealing updates
    -> your /start actually arrived -> the backend is running and polling

Read-only apart from --drain: it sends nothing and links nothing.
"""

import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT_ENV = Path(__file__).resolve().parent.parent / ".env"
API = "https://api.telegram.org/bot{token}/{method}"

OK, BAD, WARN, INFO = "  [ok]  ", "  [FAIL]", "  [warn]", "        "


def load_token() -> str:
    token = (os.getenv("TELEGRAM_BOT_TOKEN") or "").strip()
    if token:
        return token
    if ROOT_ENV.exists():
        for line in ROOT_ENV.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line.startswith("TELEGRAM_BOT_TOKEN="):
                return line.partition("=")[2].strip().strip('"').strip("'")
    return ""


def call(token: str, method: str, params: dict | None = None) -> dict:
    url = API.format(token=token, method=method)
    data = json.dumps(params or {}).encode()
    req = urllib.request.Request(
        url, data=data, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        # Telegram returns its errors as JSON with a 4xx status, so the body is
        # the useful part — {"ok": false, "error_code": 401, "description": ...}
        try:
            return json.loads(e.read())
        except (ValueError, OSError):
            return {"ok": False, "error_code": e.code, "description": str(e)}
    except (urllib.error.URLError, OSError) as e:
        # Can't reach Telegram at all: no internet, a corporate proxy, or a
        # firewall blocking api.telegram.org. Distinct from a bad token, and
        # worth saying so — the fix is somewhere else entirely.
        return {"ok": False, "error_code": 0, "unreachable": True,
                "description": f"could not reach api.telegram.org ({e})"}


def main() -> int:
    drain = "--drain" in sys.argv
    print("\nTelegram setup check\n" + "=" * 60)

    # 1. Token present -------------------------------------------------------
    token = load_token()
    if not token:
        print(BAD, "TELEGRAM_BOT_TOKEN is empty.")
        print(INFO, f"Add it to {ROOT_ENV} and restart the backend:")
        print(INFO, "    TELEGRAM_BOT_TOKEN=123456789:AA...")
        print(INFO, "Get one by messaging @BotFather -> /newbot")
        return 1
    if ":" not in token:
        print(BAD, "Token has no ':' — that isn't a bot token.")
        print(INFO, "It looks like 123456789:AAH_long_random_part")
        return 1
    print(OK, f"Token found ({token.split(':')[0]}:{'*' * 8}) from "
              f"{'environment' if os.getenv('TELEGRAM_BOT_TOKEN') else ROOT_ENV.name}")

    # 2. Telegram accepts it -------------------------------------------------
    me = call(token, "getMe")
    if me.get("unreachable"):
        print(BAD, me["description"])
        print(INFO, "The token may be fine — this machine just can't reach")
        print(INFO, "Telegram. Check your internet, VPN, or proxy. The backend")
        print(INFO, "will fail the same way until it can.")
        return 1
    if not me.get("ok"):
        print(BAD, f"Telegram rejected the token: {me.get('description')}")
        if me.get("error_code") == 401:
            print(INFO, "401 = wrong or revoked token. /mybots in @BotFather -> "
                        "API Token to re-copy it (watch for a missing character).")
        return 1
    bot = me["result"]
    print(OK, f"Bot is @{bot.get('username')} ({bot.get('first_name')})")

    # 3. Nothing else is taking the updates ----------------------------------
    # A webhook and long polling are mutually exclusive: with a webhook set,
    # getUpdates returns 409 forever and the app's poller can never see a
    # single message. This app polls, so any webhook here is wrong.
    hook = call(token, "getWebhookInfo").get("result", {})
    if hook.get("url"):
        print(BAD, f"A webhook is set: {hook['url']}")
        print(INFO, "This app uses long polling; a webhook silently swallows "
                    "every update. Clear it with:")
        print(INFO, f"    curl https://api.telegram.org/bot<token>/deleteWebhook")
        return 1
    print(OK, "No webhook set (correct — this app long-polls)")
    if hook.get("pending_update_count"):
        print(INFO, f"{hook['pending_update_count']} update(s) queued at Telegram")

    # 4. Did your message actually arrive? -----------------------------------
    # getUpdates here competes with a running backend for the same updates, so
    # this is deliberately non-destructive: offset=-1 peeks at the most recent
    # update without confirming it, leaving it for the app to process.
    res = call(token, "getUpdates", {"offset": -1, "timeout": 0, "limit": 1})
    if not res.get("ok"):
        if res.get("error_code") == 409:
            print(OK, "409 Conflict — something else is already polling this token.")
            print(INFO, "That is GOOD if it's your backend: it means the poller "
                        "is running and will receive your messages.")
            print(INFO, "It is BAD if you have two backends up — they steal each "
                        "other's updates and half the taps go missing.")
            return 0
        print(BAD, f"getUpdates failed: {res.get('description')}")
        return 1

    print(WARN, "Nothing is polling this token right now — so the backend is "
                "either not running, or started before the token was set.")
    updates = res.get("result", [])
    if not updates:
        print(INFO, "No recent messages. Open the chat and send /start, then "
                    "re-run this.")
        print(INFO, f"Direct link: https://t.me/{bot.get('username')}")
    else:
        u = updates[-1]
        msg = u.get("message") or u.get("edited_message") or {}
        chat = msg.get("chat", {})
        print(OK, f"Telegram has your message: {msg.get('text')!r} "
                  f"from chat_id {chat.get('id')} "
                  f"({chat.get('first_name') or chat.get('title')})")
        print(INFO, "So delivery to Telegram works. The gap is on your side: "
                    "start the backend with the token set and it will be "
                    "picked up.")

    if drain:
        last = call(token, "getUpdates", {"offset": -1, "timeout": 0, "limit": 1})
        ids = [x.get("update_id", 0) for x in last.get("result", [])]
        if ids:
            call(token, "getUpdates", {"offset": max(ids) + 1, "timeout": 0})
            print(OK, "Backlog cleared — old queued messages won't replay on start.")

    print("=" * 60)
    print("Next: set the token in .env, restart the backend, and look for")
    print('  "telegram: enabled — starting poller and scheduler" in the log.\n')
    return 0


if __name__ == "__main__":
    sys.exit(main())
