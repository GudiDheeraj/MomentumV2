import os

# Importing this also loads the root .env, so scripts that import database.py
# directly (seed.py, migrations) read the same DATABASE_URL the app does.
from .env import env_str

from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker, declarative_base
from sqlalchemy.pool import QueuePool

DATABASE_URL = env_str("DATABASE_URL", "sqlite:///./momentum.db")
IS_SQLITE = DATABASE_URL.startswith("sqlite")

# ---------------------------------------------------------------------------
# Engine
# ---------------------------------------------------------------------------
# check_same_thread=False is required because FastAPI runs sync endpoints in a
# threadpool, so a connection is opened on one thread and used on another.
#
# timeout raises SQLite's default 5s lock wait to 30s. Under the default
# journal mode a writer locks the whole database, and a request arriving
# mid-write gives up after five seconds with "database is locked" — which gets
# reported as a random failure rather than as contention, because that is
# exactly what it looks like from the outside.
if IS_SQLITE:
    engine = create_engine(
        DATABASE_URL,
        connect_args={"check_same_thread": False, "timeout": 30},
        poolclass=QueuePool,
        pool_size=10,
        max_overflow=20,
        pool_pre_ping=True,     # a connection dropped underneath us is reopened, not raised
        pool_recycle=3600,
        future=True,
    )
else:
    # Postgres/MySQL: same pool settings, minus the SQLite-only connect args.
    # The app is written against SQLAlchemy rather than sqlite3, so moving to a
    # server database is a DATABASE_URL change and nothing else.
    engine = create_engine(
        DATABASE_URL,
        pool_size=10,
        max_overflow=20,
        pool_pre_ping=True,
        pool_recycle=3600,
        future=True,
    )


# ---------------------------------------------------------------------------
# SQLite pragmas
# ---------------------------------------------------------------------------
# Pragmas are per-connection, not per-database, so they have to be set on every
# connect rather than once at startup — hence the event listener.
#
# WAL is the important one. In SQLite's default rollback-journal mode a single
# writer blocks *every* reader for the duration of the write, so one person
# saving a résumé stalls every other request in flight. Write-Ahead Logging
# lets readers continue against the last committed state while a write is in
# progress, which for a read-heavy app like this one is the difference between
# occasional unexplained stalls and consistent responsiveness. WAL is a
# persistent property of the database file, but setting it here applies it to
# an existing momentum.db on first connect, with no migration step.
if IS_SQLITE:
    @event.listens_for(engine, "connect")
    def _sqlite_pragmas(dbapi_connection, _connection_record):
        cur = dbapi_connection.cursor()
        try:
            cur.execute("PRAGMA journal_mode=WAL")       # readers no longer block on writers
            cur.execute("PRAGMA synchronous=NORMAL")     # WAL makes an fsync per commit unnecessary
            cur.execute("PRAGMA foreign_keys=ON")        # SQLite ignores FK constraints unless asked
            cur.execute("PRAGMA busy_timeout=30000")     # wait for a lock rather than failing at once
            cur.execute("PRAGMA cache_size=-64000")      # 64MB page cache (negative value = KB, not pages)
            cur.execute("PRAGMA temp_store=MEMORY")      # sorts and temp tables stay off disk
            cur.execute("PRAGMA mmap_size=134217728")    # 128MB of memory-mapped reads
        finally:
            cur.close()


SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
