"""Worked example CVs, three for each role in the picker.

Somebody who has just chosen "Data Scientist" knows which template we suggest
and still does not know what to put in it. That is the harder half of the
problem, and the templates alone never answered it.

**These are invented people.** Not one of them is a real person's CV, and that
is a deliberate choice rather than a shortcut. A real CV is somebody's name,
address, phone number and complete employment history; it is not ours to
republish inside a product, whoever posted it and wherever. The collections
advertising "real resumes that got into Google" are résumé-coaching firms
publishing their own copyrighted marketing, and the claim attached to them
cannot be checked by anyone.

Written examples are also simply better teaching material. A scraped CV carries
one person's accidents — the odd job, the gap, the formatting habit — and every
line of these was chosen to show something: how a career changer makes a thin
history count, where the metric belongs in a bullet, what a senior CV drops
that a mid-level one keeps.

Each role gets three, and they differ by career stage rather than by decoration:

    early    first job, a graduate, or somebody arriving from another field
    mid      three to six years, doing the job rather than learning it
    senior   leading, or accountable for something that costs real money

For some roles that division is meaningless — every Student is early career and
every C-level is senior, and offering three of them under those three headings
would be nonsense on the card. Those roles keep the three slots, because three
contrasting examples is still the right shape, and set `stage` to say what the
contrast actually is: "No work experience yet" against "With a placement year",
or "Divisional MD" against "Group chief executive". `stage` is a label only; the
slot is still early/mid/senior underneath, so nothing else has to care.

Contact details are drawn from ranges reserved for fiction — @example.com
(RFC 2606), the Ofcom drama range +44 7700 900xxx, and the North American 555
0100-0199 block — so no example can print a number that reaches a real person.
`validate()` enforces that, and the tests fail if a record ever drifts out of
those ranges.
"""
from __future__ import annotations

import json
import pathlib
import re

from .resume_pdf import TEMPLATES

_DIR = pathlib.Path(__file__).parent / "data" / "resume_examples"

LEVELS = ("early", "mid", "senior")
LEVEL_LABEL = {
    "early": "Early career",
    "mid": "Mid-level",
    "senior": "Senior",
}

# Nothing here may reach a real person.
_EMAIL_OK = re.compile(r"^[^@\s]+@example\.(com|org|net)$")
_PHONE_OK = (
    re.compile(r"^\+44 7700 900\d{3}$"),          # Ofcom's drama range
    re.compile(r"^\+1 \(\d{3}\) 555-01\d{2}$"),   # North American fiction block
    re.compile(r"^\+1 555-01\d{2}$"),
)
_LINKEDIN_OK = re.compile(r"^linkedin\.com/in/[a-z0-9-]+-example$")
_SITE_OK = re.compile(r"^[a-z0-9.-]+\.example\.(com|org)$")

# The fields a builder document can carry. Anything else in an example's data
# is a typo, and a typo here means content that silently never renders.
_DATA_FIELDS = {
    "full_name", "title", "location", "phone", "email", "linkedin", "website",
    "summary", "skills", "experience", "education", "projects", "publications",
    "certifications", "custom_sections",
}
_META_FIELDS = {"level", "stage", "headline", "why", "template_id", "data", "source_file"}
_REQUIRED = ("full_name", "title", "summary", "experience")


def _load() -> dict[str, list[dict]]:
    """Every example, keyed by role id.

    One file per field group, so the roles of one field can be written or
    corrected without touching any other. A file that will not parse is a
    packaging fault, not a runtime condition — it raises rather than being
    swallowed, because a silently empty examples list looks exactly like a role
    nobody has written examples for yet.
    """
    out: dict[str, list[dict]] = {}
    for path in sorted(_DIR.glob("*.json")):
        blob = json.loads(path.read_text(encoding="utf-8"))
        for role_id, examples in blob.items():
            out.setdefault(role_id, []).extend(
                {**ex, "source_file": path.name} for ex in examples
            )
    return out


_EXAMPLES: dict[str, list[dict]] | None = None


def all_examples() -> dict[str, list[dict]]:
    global _EXAMPLES
    if _EXAMPLES is None:
        _EXAMPLES = _load()
    return _EXAMPLES


def examples_for(role_id: str) -> list[dict]:
    """The examples for one role, ready for the picker.

    Drops any whose template has been retired from the catalogue rather than
    returning a dead id — the same rule the template recommendations follow.
    """
    out = []
    for i, ex in enumerate(all_examples().get(role_id, [])):
        tid = ex.get("template_id")
        if tid not in TEMPLATES:
            continue
        out.append({
            "id": f"{role_id}-{i + 1}",
            "level": ex.get("level", ""),
            # What the card calls this one. The role's own words where it has
            # them, the career stage where it does not.
            "level_label": ex.get("stage") or LEVEL_LABEL.get(ex.get("level", ""), ""),
            "headline": ex.get("headline", ""),
            "why": ex.get("why", ""),
            "template_id": tid,
            "template_name": TEMPLATES[tid]["name"],
            "data": ex.get("data", {}),
        })
    return out


def roles_with_examples() -> set[str]:
    return {r for r, v in all_examples().items() if v}


def validate() -> list[str]:
    """Every way one of these could be wrong, listed rather than raised.

    Used by the tests. The contact-detail checks are the ones that matter most:
    an example that printed a working phone number or a real LinkedIn profile
    would be publishing a stranger's details on the strength of a coincidence.
    """
    problems: list[str] = []
    seen_names: dict[str, str] = {}

    for role_id, examples in sorted(all_examples().items()):
        where = f"{role_id}"
        if len(examples) != 3:
            problems.append(f"{where}: {len(examples)} examples, expected 3")
        levels = [ex.get("level") for ex in examples]
        if sorted(levels) != sorted(LEVELS):
            problems.append(f"{where}: levels {levels}, expected one of each {LEVELS}")

        for ex in examples:
            name = (ex.get("data") or {}).get("full_name", "?")
            tag = f"{where}/{name}"
            if not ex.get("headline"):
                problems.append(f"{tag}: no headline")
            if len(ex.get("why", "")) < 40:
                problems.append(f"{tag}: the 'why' does not say enough")
            tid = ex.get("template_id")
            if tid not in TEMPLATES:
                problems.append(f"{tag}: template {tid!r} is not in the catalogue")

            for extra in sorted(set(ex) - _META_FIELDS):
                problems.append(f"{tag}: {extra!r} is not part of an example")
            stage = ex.get("stage")
            if stage is not None and (not stage or len(stage) > 28):
                problems.append(f"{tag}: stage {stage!r} must be short and non-empty")

            data = ex.get("data") or {}
            for extra in sorted(set(data) - _DATA_FIELDS):
                problems.append(f"{tag}: {extra!r} is not a builder field")
            for req in _REQUIRED:
                if not str(data.get(req, "")).strip():
                    problems.append(f"{tag}: {req} is empty")

            # One person appears once. Two roles sharing a name reads as the
            # same person holding two different careers.
            if name in seen_names and seen_names[name] != role_id:
                problems.append(f"{tag}: name also used in {seen_names[name]}")
            seen_names.setdefault(name, role_id)

            email = data.get("email", "")
            if email and not _EMAIL_OK.match(email):
                problems.append(f"{tag}: email {email!r} is not a reserved example address")
            phone = data.get("phone", "")
            if phone and not any(p.match(phone) for p in _PHONE_OK):
                problems.append(f"{tag}: phone {phone!r} is not in a range reserved for fiction")
            li = data.get("linkedin", "")
            if li and not _LINKEDIN_OK.match(li):
                problems.append(f"{tag}: linkedin {li!r} must end '-example'")
            site = data.get("website", "")
            if site and not _SITE_OK.match(site):
                problems.append(f"{tag}: website {site!r} must be under example.com")

            # An entry block the parser cannot read renders as one run-on line.
            for field in ("experience", "education"):
                for block in str(data.get(field, "")).split("\n---\n"):
                    if not block.strip():
                        continue
                    head = block.strip().split("\n")[0]
                    if "|" not in head:
                        problems.append(
                            f"{tag}: {field} entry {head[:44]!r} has no ' | ' separators")
            for line in str(data.get("summary", "")).split("\n"):
                if line.strip() and not line.strip().startswith("- "):
                    problems.append(f"{tag}: summary line {line[:40]!r} is not a bullet")
    return problems
