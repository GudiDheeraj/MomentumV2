#!/usr/bin/env python3
"""Link a Telegram chat to an account from the command line.

    python telegram_link.py                          # demo account
    python telegram_link.py you@example.com yourpw   # any account

The web app has no Telegram page yet — the API and the bot are both finished,
but the UI that calls them was never built, so there's no button to press. This
does what that page would do: log in, ask the backend for a one-time link code,
and print the deep link that hands it to the bot.

Requires the backend to be running (it talks to it over HTTP, exactly as the
browser would), so the same run also proves the API half works.
"""

import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT_ENV = Path(__file__).resolve().parent.parent / ".env"
DEFAULT_BASE = "http://localhost:8000"


def backend_url() -> str:
    """Same value the frontend uses, read from the one place it's defined."""
    url = (os.getenv("BACKEND_URL") or "").strip()
    if not url and ROOT_ENV.exists():
        for line in ROOT_ENV.read_text(encoding="utf-8").splitlines():
            if line.strip().startswith("BACKEND_URL="):
                url = line.partition("=")[2].strip()
                break
    return (url or DEFAULT_BASE).rstrip("/")


def request(url: str, payload=None, token: str = "", method: str = "") -> dict:
    data = json.dumps(payload).encode() if payload is not None else None
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(
        url, data=data, headers=headers, method=method or ("POST" if data else "GET"))
    with urllib.request.urlopen(req, timeout=20) as resp:
        body = resp.read()
        return json.loads(body) if body else {}


def main() -> int:
    email = sys.argv[1] if len(sys.argv) > 1 else "demo@momentum.app"
    password = sys.argv[2] if len(sys.argv) > 2 else "demo123"
    base = backend_url()

    print(f"\nLinking {email} via {base}\n" + "=" * 60)

    try:
        auth = request(f"{base}/api/auth/login", {"email": email, "password": password})
    except urllib.error.HTTPError as e:
        if e.code == 401:
            print(f"  [FAIL] Wrong email or password for {email}")
            print("         Default demo account: demo@momentum.app / demo123")
            print("         Run `python seed.py` if you haven't created it yet.")
        else:
            print(f"  [FAIL] Login failed: HTTP {e.code} {e.read().decode()[:200]}")
        return 1
    except urllib.error.URLError as e:
        print(f"  [FAIL] Can't reach the backend at {base} ({e.reason})")
        print("         Start it first:  python -m uvicorn app.main:app --port 8000")
        return 1

    token = auth["access_token"]
    print(f"  [ok]   Logged in as {auth.get('user', {}).get('name') or email}")

    try:
        res = request(f"{base}/api/telegram/link-code", {}, token=token)
    except urllib.error.HTTPError as e:
        print(f"  [FAIL] Couldn't get a link code: HTTP {e.code} {e.read().decode()[:200]}")
        return 1

    code = res["code"]
    bot = res.get("bot_username")
    mins = max(1, res.get("expires_in_seconds", 900) // 60)

    print(f"  [ok]   Link code: {code}")
    print(f"  [ok]   Valid for about {mins} minute(s) — single use\n")
    print("=" * 60)
    if res.get("deep_link"):
        print("Open this link on the device running Telegram:\n")
        print(f"    {res['deep_link']}\n")
        print("It opens the chat with the code pre-filled — just tap Start.")
    else:
        # No bot_username means the backend's getMe hasn't resolved: usually the
        # token is missing or the poller never started.
        print("The backend doesn't know the bot's username, so it couldn't build")
        print("a deep link. Check TELEGRAM_BOT_TOKEN, then send this to the bot")
        print("by hand:\n")
        print(f"    /start {code}\n")
    print("=" * 60)
    print("The bot replies with today's card once linked. If nothing arrives,")
    print("the poller isn't running — check the backend log for")
    print('"telegram: enabled — starting poller and scheduler".\n')
    return 0


if __name__ == "__main__":
    sys.exit(main())
