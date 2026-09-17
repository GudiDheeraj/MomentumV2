"""The server's template catalogue against the front end's.

`portfolios.py` keeps a list of template ids so a hand-edited API call can't
save a portfolio wearing something that will never render. That list is only
useful while it agrees with `PF_TEMPLATES` in portfolio-templates.js, and
nothing forces it to: the two files are in different languages, edited for
different reasons, and neither import fails when they disagree.

They did disagree. The front end grew from ten templates to thirty-eight and
this list stayed at ten, so `_resolve_template` treated the twenty-eight newer
ones as unknown and quietly rewrote them to the default. Choosing one of those
templates and pressing Save appeared to work and lost the choice — the worst
shape a bug can have, because there is nothing to see.

So the agreement is asserted rather than remembered.
"""

import re
from pathlib import Path

import pytest

from app.routers.portfolios import (
    TEMPLATES, TEMPLATE_IDS, DEFAULT_TEMPLATE, _resolve_template,
)

FRONTEND = Path(__file__).resolve().parents[2] / "frontend" / "portfolio-templates.js"


def _frontend_template_ids() -> list[str]:
    src = FRONTEND.read_text(encoding="utf-8")
    start = src.index("const PF_TEMPLATES = [")
    end = src.index("const PF_TEMPLATE_BY_ID")
    # Only the `id:` that opens each entry, not the ones nested in `variants`.
    return re.findall(r'\{\s*id:\s*"([^"]+)"', src[start:end])


@pytest.mark.skipif(not FRONTEND.exists(), reason="front end not checked out")
def test_catalogue_matches_the_front_end():
    frontend = _frontend_template_ids()
    assert frontend, "no templates found in portfolio-templates.js — parser out of date"

    missing = [t for t in frontend if t not in TEMPLATE_IDS]
    extra = [t for t in TEMPLATE_IDS if t not in frontend]

    assert not missing, (
        "these templates exist in the front end but not in portfolios.py, so "
        f"saving a portfolio with one silently reverts it to '{DEFAULT_TEMPLATE}': {missing}"
    )
    assert not extra, (
        "portfolios.py accepts template ids the front end cannot draw: " f"{extra}"
    )


def test_catalogue_entries_are_complete():
    for t in TEMPLATES:
        for field in ("id", "name", "description", "accent", "tone", "best_for"):
            assert t.get(field), f"template {t.get('id')!r} is missing {field}"
        assert re.fullmatch(r"#[0-9A-Fa-f]{6}", t["accent"]), t["id"]
        assert t["tone"] in {"light", "dark", "auto"}, t["id"]


def test_ids_are_unique():
    ids = [t["id"] for t in TEMPLATES]
    assert len(ids) == len(set(ids))


def test_unknown_template_falls_back_to_the_default():
    assert _resolve_template("no-such-template") == DEFAULT_TEMPLATE
    assert _resolve_template(None) == DEFAULT_TEMPLATE
    assert _resolve_template("") == DEFAULT_TEMPLATE


def test_a_known_template_is_kept():
    assert _resolve_template("aurora") == "aurora"
    assert _resolve_template("aperture") == "aperture"


def test_a_custom_design_reference_survives():
    """A design the customer built is stored as "custom:<id>".

    It must pass through untouched even though the server has no way to
    confirm the design exists: the front end resolves it, and a design that
    has since been deleted is handled there by falling back. Rewriting the id
    here instead would mean deleting one design silently detached every
    portfolio that wore it, with no record of what they used to point at.
    """
    assert _resolve_template("custom:12") == "custom:12"
    assert _resolve_template("custom:1") == "custom:1"


@pytest.mark.parametrize("bad", [
    "custom:",            # no id
    "custom:abc",         # not a number
    "custom:-1",
    "custom:12x",
    "custom:1 2",
    "custom:99999999999999",   # past the length cap
    "CUSTOM:12",          # the front end only ever writes lower case
])
def test_a_malformed_custom_reference_does_not_pass(bad):
    assert _resolve_template(bad) == DEFAULT_TEMPLATE
