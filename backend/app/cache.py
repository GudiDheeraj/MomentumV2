"""
Cache layer — Redis when it's there, in-process when it isn't.
==============================================================

What this is for
----------------
Not everything benefits from caching. A SELECT that SQLite answers from its
page cache in 200 microseconds is *slower* through Redis, because the round
trip and the serialisation cost more than the query did. So this is used
deliberately, for work that is genuinely expensive to redo:

  * rendered résumé PDFs — the Design tab asks for 37 of them to fill its
    template grid, and asks again whenever the résumé is edited
  * ATS scoring — text analysis over a résumé and a job description
  * AI / LLM responses — by far the most expensive thing this app does; a
    local llama.cpp model takes seconds, and the same prompt gives the same
    answer

Static catalogues (the template list, the role picker's data) are deliberately
*not* here. They're a few KB of constants that never change during a process's
life, so a module-level dict answers them faster than any network cache could,
and `memoize_static` below is all they need.

Why it degrades instead of requiring Redis
------------------------------------------
Running this app locally should not require standing up Redis. If REDIS_URL
isn't set, or the redis package isn't installed, or Redis is configured but
unreachable, everything below silently falls back to a bounded in-process
dictionary. The app is never slower than it was before this file existed, and
it never fails because a cache is missing — a cache that can take the service
down with it is a liability, not an optimisation.

The tradeoff of the fallback is honest: an in-process cache is per-worker and
dies on restart. That's fine for one container. The moment you run more than
one replica, set REDIS_URL and they share a cache instead of each warming
their own.
"""

import hashlib
import json
import os

from .env import env_int, env_str
import threading
import time
from typing import Any, Callable, Optional

# --------------------------------------------------------------------------
# Configuration
# --------------------------------------------------------------------------
REDIS_URL = os.getenv("REDIS_URL", "").strip()
CACHE_PREFIX = env_str("CACHE_PREFIX", "momentum")

# How long each kind of work stays cached. These are upper bounds on staleness,
# and each is chosen against what invalidates the entry in practice:
#   PDFs and ATS scores are keyed by a hash of their full input, so a changed
#   input is a different key and the TTL only bounds memory, not correctness.
TTL_PDF = env_int("CACHE_TTL_PDF", 3600)       # 1 hour
TTL_ATS = env_int("CACHE_TTL_ATS", 86400)      # 1 day
TTL_AI = env_int("CACHE_TTL_AI", 604800)       # 1 week — LLM output is the priciest thing here

# Bound for the in-process fallback. Entries are mostly small (a résumé PDF is
# 3-5KB), but the bound is in bytes rather than entries so one large value
# can't quietly consume the process.
MEMORY_MAX_BYTES = env_int("CACHE_MEMORY_MAX_BYTES", 64 * 1024 * 1024)


# --------------------------------------------------------------------------
# Backends
# --------------------------------------------------------------------------
class MemoryCache:
    """LRU + TTL dictionary. Thread-safe, because FastAPI serves sync endpoints
    from a threadpool and several of them will touch this at once."""

    def __init__(self, max_bytes: int = MEMORY_MAX_BYTES):
        self._data: "dict[str, tuple[bytes, float]]" = {}
        self._max = max_bytes
        self._held = 0
        self._lock = threading.Lock()

    def get(self, key: str) -> Optional[bytes]:
        with self._lock:
            hit = self._data.get(key)
            if hit is None:
                return None
            value, expires = hit
            if expires and expires < time.time():
                del self._data[key]
                self._held -= len(value)
                return None
            # Re-insert to mark recently used: dicts iterate in insertion order,
            # so the oldest key is simply the first one.
            del self._data[key]
            self._data[key] = (value, expires)
            return value

    def set(self, key: str, value: bytes, ttl: int) -> None:
        if len(value) > self._max // 4:
            return                       # one value must not evict everything else
        with self._lock:
            old = self._data.pop(key, None)
            if old:
                self._held -= len(old[0])
            self._data[key] = (value, time.time() + ttl if ttl else 0)
            self._held += len(value)
            while self._held > self._max and self._data:
                oldest = next(iter(self._data))
                self._held -= len(self._data.pop(oldest)[0])

    def delete_prefix(self, prefix: str) -> int:
        with self._lock:
            doomed = [k for k in self._data if k.startswith(prefix)]
            for k in doomed:
                self._held -= len(self._data.pop(k)[0])
            return len(doomed)

    def stats(self) -> dict:
        with self._lock:
            return {"backend": "memory", "entries": len(self._data), "bytes": self._held}


class RedisCache:
    """Thin wrapper over redis-py.

    Every method swallows connection errors and reports a miss. A cache is an
    optimisation: if it's unavailable the correct behaviour is to do the work
    again, not to fail the request. Losing Redis should make the app slower,
    never broken.
    """

    def __init__(self, client, fallback: MemoryCache):
        self._r = client
        self._fallback = fallback
        self._degraded_until = 0.0

    def _ok(self) -> bool:
        # After a failure, stop hammering a dead Redis on every single request —
        # serve from the fallback for a few seconds, then try again.
        return time.time() >= self._degraded_until

    def _degrade(self, err: Exception) -> None:
        if self._degraded_until < time.time():
            print(f"[cache] Redis unavailable, using in-process cache: {err}")
        self._degraded_until = time.time() + 10

    def get(self, key: str) -> Optional[bytes]:
        if self._ok():
            try:
                return self._r.get(key)
            except Exception as e:
                self._degrade(e)
        return self._fallback.get(key)

    def set(self, key: str, value: bytes, ttl: int) -> None:
        self._fallback.set(key, value, ttl)   # also local: a local hit beats a network hop
        if self._ok():
            try:
                self._r.set(key, value, ex=ttl or None)
            except Exception as e:
                self._degrade(e)

    def delete_prefix(self, prefix: str) -> int:
        self._fallback.delete_prefix(prefix)
        if not self._ok():
            return 0
        try:
            # scan_iter, not keys(): KEYS blocks the whole Redis server while it
            # walks the keyspace, which on a shared instance is a self-inflicted
            # outage waiting to happen.
            n = 0
            for key in self._r.scan_iter(match=prefix + "*", count=500):
                self._r.delete(key)
                n += 1
            return n
        except Exception as e:
            self._degrade(e)
            return 0

    def stats(self) -> dict:
        out = {"backend": "redis", "degraded": not self._ok()}
        try:
            info = self._r.info("memory")
            out["used_memory_human"] = info.get("used_memory_human")
            out["keys"] = self._r.dbsize()
        except Exception:
            out["reachable"] = False
        return out


def _build_backend():
    memory = MemoryCache()
    if not REDIS_URL:
        return memory
    try:
        import redis  # imported lazily: it is an optional dependency
        client = redis.Redis.from_url(
            REDIS_URL,
            socket_connect_timeout=2,
            socket_timeout=2,
            health_check_interval=30,
            retry_on_timeout=True,
        )
        client.ping()                       # fail fast at startup rather than on first use
        print(f"[cache] Redis connected at {REDIS_URL}")
        return RedisCache(client, memory)
    except ImportError:
        print("[cache] REDIS_URL is set but the redis package isn't installed "
              "(`pip install redis`) — using the in-process cache.")
    except Exception as e:
        print(f"[cache] REDIS_URL is set but Redis isn't reachable ({e}) — "
              "using the in-process cache.")
    return memory


cache = _build_backend()


# --------------------------------------------------------------------------
# Keys
# --------------------------------------------------------------------------
def make_key(namespace: str, *parts: Any) -> str:
    """Build a stable cache key from arbitrary arguments.

    Everything that affects the output must go into the key. Dicts are dumped
    with sort_keys so that two equal dicts hash identically regardless of the
    order they happened to be built in — without that, an identical résumé
    submitted twice would miss the cache purely because of key ordering.
    """
    blob = json.dumps(parts, sort_keys=True, default=str, separators=(",", ":"))
    digest = hashlib.sha256(blob.encode("utf-8")).hexdigest()[:32]
    return f"{CACHE_PREFIX}:{namespace}:{digest}"


def get_bytes(key: str) -> Optional[bytes]:
    try:
        return cache.get(key)
    except Exception:
        return None


def set_bytes(key: str, value: bytes, ttl: int) -> None:
    try:
        cache.set(key, value, ttl)
    except Exception:
        pass          # a cache write that fails must never fail the request


def get_json(key: str) -> Optional[Any]:
    raw = get_bytes(key)
    if raw is None:
        return None
    try:
        return json.loads(raw)
    except Exception:
        return None   # a corrupt or format-changed entry is just a miss


def set_json(key: str, value: Any, ttl: int) -> None:
    try:
        set_bytes(key, json.dumps(value, default=str).encode("utf-8"), ttl)
    except (TypeError, ValueError):
        pass          # not serialisable: skip the cache rather than raise


def invalidate(namespace: str) -> int:
    """Drop everything in a namespace. Used after a write that could change
    what a cached computation would produce."""
    try:
        return cache.delete_prefix(f"{CACHE_PREFIX}:{namespace}:")
    except Exception:
        return 0


def stats() -> dict:
    try:
        return cache.stats()
    except Exception:
        return {"backend": "unknown"}


# --------------------------------------------------------------------------
# Decorators
# --------------------------------------------------------------------------
def cached_json(namespace: str, ttl: int, key_args: Optional[Callable] = None):
    """Cache a function returning JSON-serialisable data.

    `key_args` maps the call's arguments to the parts that actually affect the
    result — worth supplying when an argument is a database session or a user
    object that would otherwise make every key unique and every lookup a miss.
    """
    def decorator(fn):
        def wrapper(*args, **kwargs):
            parts = key_args(*args, **kwargs) if key_args else (args, kwargs)
            key = make_key(namespace, fn.__name__, parts)
            hit = get_json(key)
            if hit is not None:
                return hit
            result = fn(*args, **kwargs)
            set_json(key, result, ttl)
            return result
        wrapper.__name__ = fn.__name__
        wrapper.__doc__ = fn.__doc__
        wrapper.cache_namespace = namespace
        return wrapper
    return decorator


def memoize_static(fn):
    """For values that are constant for the life of the process — the template
    catalogue, the role-picker data. A module-level dict beats any network
    cache here: there is nothing to invalidate and nothing to serialise.

    Not thread-safe by design. The worst case under a race is computing the
    same constant twice, which costs microseconds; a lock on every read of a
    hot constant would cost more than it saves.
    """
    sentinel = object()
    box = {"v": sentinel}

    def wrapper():
        if box["v"] is sentinel:
            box["v"] = fn()
        return box["v"]

    wrapper.__name__ = fn.__name__
    wrapper.__doc__ = fn.__doc__
    wrapper.cache_clear = lambda: box.update(v=sentinel)
    return wrapper


# --------------------------------------------------------------------------
# HTTP caching
# --------------------------------------------------------------------------
def etag_for(payload: Any) -> str:
    """A strong ETag over a JSON-serialisable payload."""
    blob = json.dumps(payload, sort_keys=True, default=str, separators=(",", ":"))
    return '"' + hashlib.sha256(blob.encode("utf-8")).hexdigest()[:32] + '"'
