"""Serves the project's own markdown documentation to the Welcome page.

The README lives at the repository root, but nginx's web root is frontend/,
so the browser cannot reach it. Copying it into frontend/ would work and then
quietly rot: two copies of the same instructions, one of which is the real
one. This reads the actual file instead, so the Welcome page's help links can
never drift from what's committed.

Deliberately unauthenticated: this is the project's own public documentation,
and the Welcome page is the first thing a new account sees.
"""
import os
import re

from fastapi import APIRouter, HTTPException

router = APIRouter(prefix="/api/docs", tags=["docs"])

# backend/app/routers/docs.py -> repository root
ROOT = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "..", "..")
)

# An allow-list, not a path parameter. Accepting a filename from the client
# and joining it onto a directory is how directory traversal happens; a fixed
# map of key -> relative path makes that class of bug unrepresentable.
DOCS = {
    "readme": ("README.md", "Momentum Tracker — README"),
    "ai-setup": (os.path.join("backend", "AI_SETUP.md"), "Local AI assistant setup"),
}


def _read(rel_path: str) -> str:
    full = os.path.abspath(os.path.join(ROOT, rel_path))
    # Belt and braces: even with the allow-list, refuse anything that resolved
    # outside the repository.
    if not full.startswith(ROOT + os.sep) or not os.path.isfile(full):
        raise HTTPException(404, "Document not found")
    try:
        with open(full, "r", encoding="utf-8", errors="replace") as fh:
            return fh.read()
    except OSError:
        raise HTTPException(500, "Could not read that document")


def _headings(markdown: str):
    """Every heading, with the slug the frontend uses to deep-link to it.

    The Welcome page's help links point at specific sections ("Running the
    App", "Configuration"), so it needs to know what sections exist rather
    than hard-coding line numbers that break the moment the README is edited.
    """
    out, in_fence = [], False
    for line in markdown.split("\n"):
        if line.lstrip().startswith("```"):
            in_fence = not in_fence
            continue
        if in_fence:
            continue
        m = re.match(r"^(#{1,4})\s+(.*)$", line)
        if not m:
            continue
        text = m.group(2).strip().rstrip("#").strip()
        # Strip inline code/emphasis so the slug matches the rendered text.
        plain = re.sub(r"[`*_]", "", text)
        slug = re.sub(r"[^a-z0-9]+", "-", plain.lower()).strip("-")
        out.append({"level": len(m.group(1)), "text": plain, "slug": slug})
    return out


@router.get("")
def list_docs():
    """Which documents are available, so the UI doesn't offer a dead link."""
    available = []
    for key, (rel, title) in DOCS.items():
        full = os.path.abspath(os.path.join(ROOT, rel))
        if os.path.isfile(full):
            available.append({"key": key, "title": title, "path": rel})
    return {"docs": available}


@router.get("/{key}")
def get_doc(key: str):
    entry = DOCS.get(key)
    if not entry:
        raise HTTPException(404, "Unknown document")
    rel, title = entry
    markdown = _read(rel)
    return {
        "key": key,
        "title": title,
        "path": rel,
        "markdown": markdown,
        "headings": _headings(markdown),
    }
