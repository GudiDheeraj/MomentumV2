"""Encrypting the user's API key at rest.

The key is written to the same SQLite file as everything else, which gets
copied into backups, synced to cloud drives and opened in DB browsers. A
provider key in there in plain text is a live credential sitting in every one
of those copies — so it is encrypted with a key derived from
MOMENTUM_SECRET_KEY, which the app already requires and already keeps out of
the database.

The honest limit: anyone who can read both the database *and* the secret can
decrypt it. This is a self-hosted app on your own machine, so that is the
person who owns it anyway. What it defends against is the accidental exposure —
a shared backup, a screen-share of a table, a repo that swallowed the .db file.
"""

from __future__ import annotations

import base64
import hashlib
import logging
import os

log = logging.getLogger("momentum.ai")


def _fernet():
    try:
        from cryptography.fernet import Fernet
    except ImportError:
        return None
    secret = (os.getenv("MOMENTUM_SECRET_KEY") or "").strip()
    if not secret:
        # No stable secret means no stable encryption key: a value encrypted
        # today would be undecryptable after the next restart, which is worse
        # than declining to encrypt.
        return None
    digest = hashlib.sha256(("momentum-llm-key::" + secret).encode()).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def encrypt(value: str) -> str:
    """Ciphertext, or the plain value prefixed so decrypt() can tell them apart.

    Falling back to plaintext rather than refusing: a self-hosted install
    without `cryptography` should still be able to use the feature, and the
    prefix means a database written before/after the library arrived stays
    readable either way.
    """
    if not value:
        return ""
    f = _fernet()
    if f is None:
        log.warning("LLM key stored unencrypted — set MOMENTUM_SECRET_KEY and "
                    "install `cryptography` to encrypt it at rest.")
        return "plain:" + value
    return "enc:" + f.encrypt(value.encode()).decode()


def decrypt(stored: str) -> str:
    if not stored:
        return ""
    if stored.startswith("plain:"):
        return stored[6:]
    if stored.startswith("enc:"):
        f = _fernet()
        if f is None:
            return ""
        try:
            return f.decrypt(stored[4:].encode()).decode()
        except Exception:
            # Almost always MOMENTUM_SECRET_KEY changed. Returning "" makes the
            # feature report "key rejected" and prompt for a new one, which is
            # recoverable; raising here would 500 every AI request.
            log.warning("Could not decrypt the stored LLM key — has "
                        "MOMENTUM_SECRET_KEY changed? Re-enter the key.")
            return ""
    return stored   # written before this module existed


def hint(value: str) -> str:
    """A recognisable fragment: sk-…a91f. Enough to tell two keys apart,
    useless to anyone who finds it."""
    if not value:
        return ""
    value = value.strip()
    if len(value) <= 8:
        return "…" + value[-2:]
    return f"{value[:3]}…{value[-4:]}"
