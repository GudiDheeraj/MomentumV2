import os

# Loading the root .env is app/env.py's job, and importing it here is what
# guarantees it happens before database.py, auth.py and app/ai/engine.py read
# os.getenv() at module load time.
#
# It used to be done inline right here. The problem with that was everything
# that isn't uvicorn: seed.py, migrations and one-off scripts import
# app.database directly, never touch main.py, and so ran against
# sqlite:///./momentum.db no matter what DATABASE_URL said. Now the modules
# that read config import the loader themselves, so there is no import order
# left to get wrong.
from . import env as _env  # noqa: F401  (imported for its side effect)

from fastapi import FastAPI, Request
from fastapi.responses import Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.staticfiles import StaticFiles

from . import models
from .database import engine
from .routers import habits, tasks, summary, weekly_notes, resumes, jobs, auth, admin, study, export, ats, resume_builder, chat, search, cover_letter, extension, boards, profile, review, docs, jobhunt, telegram as telegram_router

models.Base.metadata.create_all(bind=engine)


def _run_lightweight_migrations():
    """create_all() only creates brand-new tables — it never alters an
    existing one. New tables (job_boards, job_activities, job_contacts) are
    created automatically; new *columns* on the pre-existing
    job_applications table need to be added by hand for anyone upgrading
    with data already in their database. Safe to run every startup: it
    checks first and no-ops if a column already exists."""
    # (column_name, SQL type) pairs to ensure on job_applications
    wanted = [
        ("board_id", "INTEGER"),
        ("color", "VARCHAR(20)"),
        ("deadline", "DATE"),
        ("pipeline_stage", "VARCHAR(60)"),
        ("updated_at", "DATETIME"),
    ]
    # (table, column, type) for tables other than job_applications
    wanted_other = [
        ("resumes", "tailored_for_job_id", "INTEGER"),
        ("resumes", "updated_at", "DATETIME"),
        ("users", "avatar_file", "VARCHAR(300)"),
        ("users", "headline", "VARCHAR(200)"),
        ("users", "location", "VARCHAR(120)"),
        ("users", "website", "VARCHAR(200)"),
        ("users", "linkedin", "VARCHAR(200)"),
        ("users", "phone", "VARCHAR(60)"),
        ("users", "plan", "VARCHAR(20)"),
        ("users", "plan_since", "DATETIME"),
        # Telegram delivery preferences. telegram_links is created by
        # create_all() on a fresh database, but anyone upgrading an existing
        # install with the table already present needs these added by hand —
        # same rule as job_applications above.
        ("telegram_links", "carry_over_tasks", "BOOLEAN"),
        ("telegram_links", "active_message_id", "VARCHAR(40)"),
        ("telegram_links", "active_message_date", "DATE"),
        ("telegram_links", "last_morning_date", "DATE"),
        ("telegram_links", "last_evening_date", "DATE"),
        ("telegram_links", "last_interaction_at", "DATETIME"),
        ("telegram_links", "close_when_done", "BOOLEAN"),
    ]
    with engine.connect() as conn:
        for col_name, col_type in wanted:
            try:
                if engine.dialect.name == "sqlite":
                    cols = [row[1] for row in conn.exec_driver_sql("PRAGMA table_info(job_applications)")]
                    if col_name not in cols:
                        conn.exec_driver_sql(f"ALTER TABLE job_applications ADD COLUMN {col_name} {col_type}")
                        conn.commit()
                else:
                    exists = conn.exec_driver_sql(
                        "SELECT column_name FROM information_schema.columns "
                        f"WHERE table_name='job_applications' AND column_name='{col_name}'"
                    ).fetchone()
                    if not exists:
                        conn.exec_driver_sql(f"ALTER TABLE job_applications ADD COLUMN {col_name} {col_type}")
                        conn.commit()
            except Exception as e:
                # Never block startup over a migration hiccup.
                print(f"[migration] {col_name} column check/add skipped: {e}")

        for table, col_name, col_type in wanted_other:
            try:
                if engine.dialect.name == "sqlite":
                    cols = [row[1] for row in conn.exec_driver_sql(f"PRAGMA table_info({table})")]
                    if col_name not in cols:
                        conn.exec_driver_sql(f"ALTER TABLE {table} ADD COLUMN {col_name} {col_type}")
                        conn.commit()
                else:
                    exists = conn.exec_driver_sql(
                        "SELECT column_name FROM information_schema.columns "
                        f"WHERE table_name='{table}' AND column_name='{col_name}'"
                    ).fetchone()
                    if not exists:
                        conn.exec_driver_sql(f"ALTER TABLE {table} ADD COLUMN {col_name} {col_type}")
                        conn.commit()
            except Exception as e:
                print(f"[migration] {table}.{col_name} check/add skipped: {e}")

        # ALTER TABLE ADD COLUMN leaves every existing row NULL, and a column's
        # SQLAlchemy default only applies to rows inserted through the ORM.
        # `plan` is read on every login, so a NULL there broke sign-in for every
        # account created before billing existed. Runs after the add loop above,
        # because on a fresh upgrade the column does not exist until then.
        for table, col_name, default_sql in [
            ("users", "plan", "'free'"),
            # Same trap: an existing link would read NULL here, which is falsy,
            # so the feature would silently be off for exactly the people who
            # had already connected.
            ("telegram_links", "close_when_done", "1"),
        ]:
            try:
                conn.exec_driver_sql(
                    f"UPDATE {table} SET {col_name} = {default_sql} WHERE {col_name} IS NULL")
                conn.commit()
            except Exception as e:
                print(f"[migration] {table}.{col_name} backfill skipped: {e}")


_run_lightweight_migrations()


def _seed_job_boards():
    """Load the bundled company list into the shared job-board registry.

    Idempotent — it skips anything already present — so it can run on every
    startup, and a board that retired itself stays retired.
    """
    try:
        from .database import SessionLocal
        from .jobhunt.registry import seed_shared_registry
        db = SessionLocal()
        try:
            seed_shared_registry(db)
        finally:
            db.close()
    except Exception as e:
        # A registry that failed to seed is a much smaller problem than a
        # backend that won't boot.
        print(f"[jobhunt] seed skipped: {e}")


_seed_job_boards()

app = FastAPI(title="Momentum Tracker API", version="1.0.0")

# CORS origins come from ONE place in .env: FRONTEND_URL, the address the app
# is actually served from. FRONTEND_ORIGINS only needs setting for the cases
# a single URL can't express — several origins at once (comma-separated), or
# "*" to allow any, which is development-only.
#
# The wildcard is deliberately not the default any more: with FRONTEND_URL
# always present, defaulting to "*" would mean a deployment that never touched
# CORS silently accepted requests from every origin on the internet.
#
# allow_credentials stays off for "*" because combining a wildcard origin with
# credentials is invalid per the CORS spec and browsers reject it outright.
# This app authenticates with a Bearer token in the Authorization header rather
# than cookies, so nothing depends on it locally.
origins_env = (os.getenv("FRONTEND_ORIGINS") or "").strip()
if not origins_env:
    origins_env = (os.getenv("FRONTEND_URL") or "").strip().rstrip("/") or "*"
origins = [o.strip().rstrip("/") for o in origins_env.split(",") if o.strip()]
allow_credentials = origins_env != "*"
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=allow_credentials,
    allow_methods=["*"],
    allow_headers=["*"],
)

# JSON compresses extremely well — the dashboard and job-list payloads are
# repetitive object arrays that gzip to a fraction of their size — and this
# API was sending all of it uncompressed. 700 bytes is roughly where the
# compression header stops paying for itself on a local network.
#
# Deliberately NOT applied to the résumé PDFs: they are 3-5KB of already
# compressed streams, so gzip would burn CPU on every preview render (which
# happens on a debounce while typing) to save almost nothing. Starlette skips
# responses under minimum_size, and PDFs land close enough to that line that
# it is worth knowing this was considered rather than overlooked.
app.add_middleware(GZipMiddleware, minimum_size=700, compresslevel=6)

@app.middleware("http")
async def security_headers(request, call_next):
    """Baseline security headers on every response.

    Not a substitute for the per-route controls above — these just close off
    cheap, generic attack classes:
      X-Frame-Options   - can't be framed, so it can't be clickjacked
      nosniff           - browser won't re-interpret a response's type
      Referrer-Policy   - URLs (which can carry ids) don't leak cross-origin
      Permissions-Policy- explicitly drops APIs this app never uses
    HSTS is deliberately omitted: it would be wrong on plain-HTTP local
    development, and belongs on the TLS-terminating proxy in production.
    """
    response = await call_next(request)
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    response.headers.setdefault("Permissions-Policy", "geolocation=(), microphone=(), camera=()")
    return response


UPLOAD_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)


class _SafeUploadStatic(StaticFiles):
    """Serves user uploads as downloads instead of rendering them.

    Uploads live on the same origin as the app, so anything the browser is
    willing to render in-page runs with access to this origin's localStorage
    — including the auth token. The upload allowlist already blocks the
    obvious vectors (.html, .svg), but that is one check away from a
    same-origin account-takeover, so these headers are the second layer:

      Content-Disposition: attachment  -> download, never render in-page
      X-Content-Type-Options: nosniff  -> don't second-guess the type
      Content-Security-Policy          -> neutralise any active content
    """

    async def get_response(self, path, scope):
        response = await super().get_response(path, scope)
        response.headers["Content-Disposition"] = "attachment"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Content-Security-Policy"] = "default-src 'none'; sandbox"
        return response


app.mount("/uploads", _SafeUploadStatic(directory=UPLOAD_DIR), name="uploads")

# ---------------------------------------------------------------------------
# Conditional GETs.
#
# The read endpoints return the same bytes on most requests — a board that
# hasn't changed, a habit list nobody edited. Hashing the body and answering a
# matching If-None-Match with 304 turns those into a few hundred bytes on the
# wire and no JSON parsing in the browser, without any endpoint knowing about
# it. Writes are never cached, and the ETag is content-derived, so it can't go
# stale the way a time-based cache does.
# ---------------------------------------------------------------------------
import hashlib


@app.middleware("http")
async def conditional_get(request: Request, call_next):
    response = await call_next(request)
    if request.method != "GET" or response.status_code != 200:
        return response
    if not request.url.path.startswith("/api/"):
        return response
    body = b""
    async for chunk in response.body_iterator:
        body += chunk
    # A PDF or a large export gains nothing from this and costs memory to buffer.
    if len(body) > 2_000_000:
        return Response(content=body, status_code=200, headers=dict(response.headers),
                        media_type=response.media_type)
    etag = '"' + hashlib.blake2b(body, digest_size=16).hexdigest() + '"'
    headers = dict(response.headers)
    headers["ETag"] = etag
    headers["Cache-Control"] = "private, max-age=0, must-revalidate"
    headers.pop("content-length", None)
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=304, headers=headers)
    return Response(content=body, status_code=200, headers=headers,
                    media_type=response.media_type)


app.include_router(auth.router)
app.include_router(profile.router)
app.include_router(habits.router)
app.include_router(tasks.router)
app.include_router(summary.router)
app.include_router(weekly_notes.router)
app.include_router(resumes.router)
app.include_router(jobs.router)
app.include_router(boards.router)
app.include_router(study.router)
app.include_router(export.router)
app.include_router(ats.router)
app.include_router(review.router)
app.include_router(docs.router)
app.include_router(resume_builder.router)
app.include_router(chat.router)
app.include_router(search.router)
app.include_router(cover_letter.router)
app.include_router(admin.router)
app.include_router(extension.router)
app.include_router(study.timer_router)
app.include_router(jobhunt.router)
app.include_router(telegram_router.router)


# ---------------------------------------------------------------------------
# Telegram background workers.
#
# Two long-lived coroutines on the app's own event loop: the bot's long-poll
# loop (which handles every button tap) and the per-minute scheduler (which
# decides who is due a card). They live here rather than in a separate worker
# process because both are almost entirely idle — a poll waiting on Telegram
# and a timer waiting on the clock — and a second process to run two awaits
# would be infrastructure bought for nothing.
#
# Both are no-ops without TELEGRAM_BOT_TOKEN, so a clone of this repo starts
# exactly as it did before the integration existed.
#
# The one real constraint: only ONE process may long-poll a given bot token.
# Running multiple uvicorn workers or replicas will have them stealing each
# other's updates, so set TELEGRAM_ENABLED=0 on all but one.
# ---------------------------------------------------------------------------
import asyncio
import logging

from .telegram import bot as telegram_bot
from .telegram import config as telegram_config
from .telegram import scheduler as telegram_scheduler

_telegram_stop = asyncio.Event()
_telegram_tasks: list[asyncio.Task] = []

# Give the app's own loggers somewhere to go. Uvicorn configures handlers for
# its own loggers only; ours had none, so every log.info() in app/telegram/
# was written to a logger with no handler and silently discarded — including
# "starting poller and scheduler" and the reason it didn't start. A silent
# integration that is off looks exactly like one that is on and broken, which
# is the worst possible failure mode for something you interact with from
# another device entirely.
if not logging.getLogger().handlers:
    logging.basicConfig(
        level=logging.INFO,
        format="%(levelname)s:    %(name)s — %(message)s",
    )
logging.getLogger("momentum.telegram").setLevel(logging.INFO)


@app.on_event("startup")
async def _start_telegram_workers():
    tg_log = logging.getLogger("momentum.telegram")
    if not telegram_config.is_enabled():
        # Say why, out loud. These are the only two reasons, and both are a
        # one-line fix in .env that nobody can guess at from silence.
        if not telegram_config.is_configured():
            tg_log.warning(
                "telegram: OFF — TELEGRAM_BOT_TOKEN is empty in .env. "
                "Get a token from @BotFather (/newbot) and restart.")
        else:
            tg_log.warning(
                "telegram: OFF — TELEGRAM_ENABLED is set to a false value in .env.")
        return
    logging.getLogger("momentum.telegram").info(
        "telegram: enabled — starting poller and scheduler")
    _telegram_stop.clear()
    _telegram_tasks.append(asyncio.create_task(
        telegram_bot.run_polling(_telegram_stop), name="telegram-poller"))
    _telegram_tasks.append(asyncio.create_task(
        telegram_scheduler.run_scheduler(_telegram_stop), name="telegram-scheduler"))


@app.on_event("shutdown")
async def _stop_telegram_workers():
    if not _telegram_tasks:
        return
    _telegram_stop.set()
    for task in _telegram_tasks:
        task.cancel()
    # A cancelled long-poll is expected, not an error worth reporting — hence
    # return_exceptions rather than letting shutdown raise.
    await asyncio.gather(*_telegram_tasks, return_exceptions=True)
    _telegram_tasks.clear()


@app.get("/api/health")
def health():
    return {"status": "ok"}
