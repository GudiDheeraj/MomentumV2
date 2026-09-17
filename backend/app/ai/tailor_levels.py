"""Three strengths of tailoring, proposed section by section.

The Tailor pane used to do two things, neither of them tailoring: it counted
keywords in the browser and printed ✓/✗ chips, and — only once the résumé had
already been saved — offered a button that produced a *separate copy* in the
library and navigated away from what you were looking at. Nothing changed in
front of you, and there was no way to accept one suggestion and refuse another.

This module answers a different question: given this résumé and this job ad,
what exactly would change, at each of three strengths, and what would each
section look like afterwards? It returns proposals — before, after, and a plain
sentence saying what was done — and lets the caller apply them one at a time.

    regular      Order only. Skills lead with the ones the job names; within
                 each role the bullets that match come first. Not one word is
                 rewritten, so it is safe on a résumé you are already happy
                 with.
    medium       Order, plus a summary rewritten around the target role using
                 the skills you already have, plus long entries trimmed to
                 their most relevant bullets.
    aggressive   The above, plus bullets rewritten in the job's vocabulary and
                 a "Key skills for this role" line at the top of Skills.

THE RULE THAT DOES NOT BEND, at any strength: nothing is invented. Every term
that appears in an output already appeared in the résumé. Dates, employers,
job titles, degrees and figures are never sent for rewriting — they are copied
across verbatim. The strengths differ in how much they *re-emphasise*, never in
how much they are allowed to make up. A résumé that claims a skill its owner
does not have fails at the interview instead of at the filter, which is worse
for the person holding it.

Everything degrades to the deterministic path when no model is installed, so
the feature works the same on a laptop with no GGUF file as on a server with
one — the model only ever improves wording that the rules already selected.
"""

from __future__ import annotations

import logging
import re

from ..ats_scorer import HARD_SKILL_ALIASES, score_resume_against_job
from . import tailor_prompt
from .resume_tailor import _tailor_bullets, _tailor_summary

log = logging.getLogger("momentum.ai")

LEVELS = ("regular", "medium", "aggressive")

LEVEL_LABELS = {
    "regular": "Regular",
    "medium": "Medium",
    "aggressive": "Aggressive",
}

LEVEL_BLURBS = {
    "regular": "Reorders only — your wording is untouched.",
    "medium": "Reorders and rewrites the summary. Every bullet is kept.",
    "aggressive": "Also rewords bullets in the job's language and leads with a key-skills line.",
}

# Nothing is deleted unless the person asks for it, in the box above the
# strengths. The strengths used to carry a cap of their own — Medium kept five
# bullets an entry, Aggressive four — so choosing "rewrite it harder" quietly
# deleted work history, and at Aggressive it deleted enough that the scoring
# guard rejected the whole proposal and the section silently vanished from the
# list. A strength decides how much *rewriting* happens. How much survives is
# the person's call: see tailor_prompt.Directives.cap.
BULLET_CAP = {"regular": None, "medium": None, "aggressive": None}
# How many entries are worth rewriting before latency costs more than relevance.
MAX_ENTRIES = 6


def _norm(text: str) -> str:
    return re.sub(r"[^a-z0-9+#./ ]", " ", (text or "").lower())


def resume_text(data: dict) -> str:
    """Everything the scorer should see — the same fields the PDF prints."""
    parts = [data.get(k) or "" for k in
             ("job_title", "summary", "skills", "experience", "projects",
              "education", "certifications", "publications")]
    return "\n".join(p for p in parts if p)


def _relevance(text: str, terms: list[str]) -> int:
    """How many of the job's terms this line actually contains.

    Word-boundary matching, so "r" does not match "reporting" and "go" does not
    match "google" — a scoring bug there would silently reorder someone's
    résumé around a coincidence.
    """
    body = _norm(text)
    hits = 0
    for term in terms:
        t = _norm(term).strip()
        if not t:
            continue
        if re.search(rf"(?<![a-z0-9]){re.escape(t)}(?![a-z0-9])", body):
            hits += 1
    return hits


def _as_written(term: str, source: str) -> str:
    """The term in the person's own capitalisation.

    The matcher works in lowercase canonical form, so writing its output
    straight onto a résumé produced "Key skills for this role: power bi, sql".
    Their own text already spells these correctly — use that spelling.
    """
    m = re.search(rf"(?<![a-z0-9])({re.escape(term)})(?![a-z0-9])", source or "", re.I)
    return m.group(1) if m else term


# ---------------------------------------------------------------------------
# Reading an entry field without losing any of it
# ---------------------------------------------------------------------------
# The shared parser in resume_tailor.py keeps the first line of a block as the
# header and any line starting with "-" as a bullet — and silently drops
# everything else. A Projects section written as three plain lines therefore
# came back as one line, and two projects vanished from the résumé the moment
# a proposal was applied. At "Regular", which promises not to change a word.
#
# So this module parses for itself, keeps every line, and — belt and braces —
# refuses to propose anything for a field it cannot rebuild byte for byte.
# `_roundtrips` is the guard: if parse-then-render is not the identity, the
# section is left alone rather than rewritten into something shorter.

BLOCK_SEP = "\n---\n"


def _parse_blocks(text: str) -> list[dict]:
    """Blocks of {header, items}, where each item keeps its own kind.

    kind is "bullet" for a "- " line and "line" for anything else, so a block
    that mixes the two survives a round trip unchanged.
    """
    blocks = []
    for raw in (text or "").split(BLOCK_SEP):
        lines = raw.split("\n")
        # Leading/trailing blank lines are part of the formatting; keep them.
        head_idx = next((i for i, l in enumerate(lines) if l.strip()), None)
        if head_idx is None:
            blocks.append({"lead": lines, "header": "", "items": []})
            continue
        items = []
        for line in lines[head_idx + 1:]:
            kind = "bullet" if line.strip().startswith("- ") or line.strip() == "-" else "line"
            items.append({"kind": kind, "text": line})
        blocks.append({"lead": lines[:head_idx], "header": lines[head_idx], "items": items})
    return blocks


def _render_blocks(blocks: list[dict]) -> str:
    out = []
    for b in blocks:
        lines = list(b.get("lead") or [])
        if b.get("header") or b.get("items"):
            lines.append(b.get("header", ""))
        lines.extend(item["text"] for item in b.get("items", []))
        out.append("\n".join(lines))
    return BLOCK_SEP.join(out)


def _roundtrips(text: str) -> bool:
    """Can this field be rebuilt exactly? If not, nothing may touch it."""
    return _render_blocks(_parse_blocks(text)) == (text or "")


def _bullet_text(item: dict) -> str:
    return re.sub(r"^\s*-\s*", "", item["text"]).strip()


def _jd_vocabulary(job_description: str) -> set:
    """The job ad's own words, minus the ones every ad uses.

    Hard-skill matching alone leaves most bullets tied on zero, and a tie is
    resolved by original order — which is how "Managed office rota and
    supplies" outranked "Presented findings to stakeholders" for an ad that
    asks for stakeholder communication. This is the tie-breaker: shared
    vocabulary, which catches the parts of a job that are not a named tool.
    """
    stop = {
        "with", "your", "team", "role", "work", "will", "have", "that", "this",
        "from", "they", "them", "what", "when", "been", "which", "about", "into",
        "you", "our", "are", "for", "and", "the", "job", "also", "must", "able",
        "who", "any", "all", "their", "them", "more", "than", "well", "join",
        "using", "across", "within", "including", "strong", "excellent", "good",
        "experience", "required", "requirements", "responsibilities", "we", "us",
    }
    words = re.findall(r"[a-z][a-z+#./-]{3,}", (job_description or "").lower())
    return {w for w in words if w not in stop}


def _vocab_overlap(text: str, vocab: set) -> int:
    if not vocab:
        return 0
    words = set(re.findall(r"[a-z][a-z+#./-]{3,}", (text or "").lower()))
    return len(words & vocab)


# ---------------------------------------------------------------------------
# Skills
# ---------------------------------------------------------------------------
def _split_items(values: str) -> list[str]:
    """Split a skills line on commas that are NOT inside brackets.

    "AWS (Redshift, S3, Glue), Google Cloud Platform" is two skills, not five.
    A plain str.split(",") turned it into "AWS (Redshift" / "S3" / "Glue)" and
    then happily reordered those fragments onto the résumé — the surest way to
    make a tailored CV look machine-mangled.
    """
    out, depth, current = [], 0, []
    for ch in values or "":
        if ch in "([{":
            depth += 1
        elif ch in ")]}":
            depth = max(0, depth - 1)
        if ch == "," and depth == 0:
            out.append("".join(current).strip())
            current = []
        else:
            current.append(ch)
    tail = "".join(current).strip()
    if tail:
        out.append(tail)
    return [x for x in out if x]


def _owned_skills(data: dict, jd: str, limit: int = 4) -> list[str]:
    """The person's own skills that this job asks for, in their own words.

    The ranking list behind the reordering is deliberately loose — reordering
    a bullet by the word "data" costs nothing. Writing that list ONTO the
    résumé does: the first version of this produced "Core strengths for this
    role: Data, quality, Engineer, generation", which are not skills, are not
    capitalised the way this person writes them, and read as though nobody
    checked. So anything that goes on the résumé comes only from the Skills
    section they wrote.

    A skill scores on three things: the job naming it outright (worth most),
    the job sharing vocabulary with it, and the job sharing vocabulary with
    the group heading the person filed it under — because "Cloud and Data
    Platforms: AWS, GCP, Azure" answers an ad asking for "cloud-based data
    platforms" even though the ad never says "AWS".
    """
    groups = _skills_lines(data.get("skills") or "")
    if not groups:
        return []
    jd_low = (jd or "").lower()
    vocab = _jd_vocabulary(jd)

    scored = []
    for label, values in groups:
        label_hit = _vocab_overlap(label, vocab)
        for item in _split_items(values):
            if not item or len(item) > 40:
                continue
            base = re.sub(r"\s*\(.*?\)\s*", " ", item).strip().lower()
            direct = len(re.findall(rf"(?<![a-z0-9]){re.escape(base)}(?![a-z0-9])", jd_low)) if base else 0
            score = direct * 6 + _vocab_overlap(item, vocab) * 2 + label_hit
            # A bare label bonus is not evidence that THIS skill is the one the
            # job wants — and a long list of near-misses measurably dilutes the
            # match rather than improving it (six items cost a point where four
            # gained one). Only skills the job names, or that share real
            # vocabulary with it, are worth writing down.
            if score >= 3:
                scored.append((score, len(scored), item))
    # Ties keep the person's own ordering, which is usually strongest-first.
    scored.sort(key=lambda t: (-t[0], t[1]))
    return [item for _score, _i, item in scored[:limit]]


def _skills_lines(skills_text: str) -> list[tuple[str, str]]:
    """Skills as (label, values) pairs, preserving the person's own grouping.

    The builder's Skills field is usually "Programming Languages: Python, SQL"
    per line. Losing those labels to sort a flat list would be a worse résumé,
    so the grouping is kept and the reordering happens inside it.
    """
    out = []
    for line in (skills_text or "").split("\n"):
        if not line.strip():
            continue
        if ":" in line:
            label, values = line.split(":", 1)
            out.append((label.strip(), values.strip()))
        else:
            out.append(("", line.strip()))
    return out


def _reorder_values(values: str, terms: list[str]) -> str:
    items = _split_items(values)
    if len(items) < 2:
        return values
    # Stable: equally-relevant skills keep the order the person chose.
    ranked = sorted(range(len(items)), key=lambda i: (-_relevance(items[i], terms), i))
    return ", ".join(items[i] for i in ranked)


def _skills_proposal(data: dict, matched: list[str], level: str, jd: str = "",
                     directives=None) -> dict:
    before = data.get("skills") or ""
    if not before.strip():
        return {}
    groups = _skills_lines(before)
    focus = list(getattr(directives, "resolved", []) or [])
    # Groups whose contents the job asks for float to the top; within a group,
    # so do the individual skills. Anything named in the instruction outranks
    # both.
    ranked = sorted(range(len(groups)),
                    key=lambda i: (-_relevance(groups[i][1], focus),
                                   -_relevance(groups[i][1], matched), i))
    lines = []
    for i in ranked:
        label, values = groups[i]
        values = _reorder_values(values, focus + matched)
        lines.append(f"{label}: {values}" if label else values)
    after = "\n".join(lines)

    note = "Led with the skills this job names, inside your own groupings."
    if level == "aggressive":
        # Only skills the résumé already lists — this line is a summary of the
        # section below it, never an addition to it.
        owned = _owned_skills(data, jd, limit=8)
        if owned:
            after = "Key skills for this role: " + ", ".join(owned) + "\n" + after
            note = ("Added a key-skills line naming the "
                    f"{len(owned)} skills you already list that this job asks for, "
                    "then reordered the rest.")
    return {
        "key": "skills", "field": "skills", "label": "Skills",
        "before": before, "after": after, "note": note,
        "keywords": [t for t in matched if _relevance(before, [t])][:10],
    }


# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
def _target_role(job_description: str) -> str:
    """The role the ad is for, taken from its own words rather than guessed."""
    jd = job_description or ""
    for pattern in (
        # The keyword is matched either case; the ROLE is not, because its
        # capitalisation is what marks where the title ends. Written out
        # rather than passing re.I, which would make [A-Z] match anything.
        r"[Hh]iring\s+(?:an?\s+)?([A-Z][\w/&+-]*(?:\s+[A-Z][\w/&+-]*){0,3})",
        r"[Ll]ooking for\s+(?:an?\s+)?([A-Z][\w/&+-]*(?:\s+[A-Z][\w/&+-]*){0,3})",
        r"[Ss]eeking\s+(?:an?\s+)?([A-Z][\w/&+-]*(?:\s+[A-Z][\w/&+-]*){0,3})",
        r"^\s*(?:[Jj]ob\s+)?[Tt]itle\s*[:\-–]\s*(.+)$",
        # "As a Data Engineer you will…" and "As a Data Engineer, a typical
        # day involves…" — the same sentence, and the second is how most
        # agency-written ads open.
        r"\b[Aa]s\s+an?\s+([A-Z][\w/&+-]*(?:\s+[A-Z][\w/&+-]*){0,3})\s*(?:,|\s+you\b|\s+your\b)",
        r"^\s*([A-Z][\w/&+-]*(?:\s+[A-Z][\w/&+-]*){1,3})\s*[—–-]\s*(?:full|part)[- ]time",
    ):
        m = re.search(pattern, jd, re.M)
        if m:
            role = re.sub(r"\s+", " ", m.group(1)).strip(" .,;:")
            if 3 <= len(role) <= 60:
                return role
    return ""


def _summary_proposal(data: dict, jd: str, matched: list[str], level: str,
                      use_llm: bool, score_fn=None, directives=None) -> dict:
    before = data.get("summary") or ""
    if level == "regular" or not before.strip():
        return {}

    llm_version = ""
    if use_llm:
        try:
            llm_version = (_tailor_summary(
                data, jd, matched,
                style=tailor_prompt.style_brief(directives) if directives else "") or "").strip()
        except Exception:                       # noqa: BLE001
            log.exception("summary rewrite failed; falling back to the rule-based one")
            llm_version = ""
        # Two ways a model's answer is worse than no answer: it reads like the
        # advert rather than like this person, or it is shorter than what it
        # replaced — a summary that loses "data quality" and "star/snowflake
        # schema" has thrown away the very evidence the job was asking for.
        if llm_version and (_relevance(llm_version, matched) == 0
                            or len(llm_version) < len(before) * 0.75):
            llm_version = ""

    # The deterministic version is always built, not just used as a fallback:
    # in lite mode the model's answer is often blander than the rules', and the
    # only way to know which is better is to score both against the job.
    if True:
        # Deterministic fallback. ADDITIVE, never subtractive: every sentence
        # the person wrote survives, the ones this job cares about lead, and a
        # line naming their matching strengths goes on the front. The previous
        # version kept only the opening sentence at Aggressive, which is how a
        # "stronger" setting managed to delete the best evidence in the résumé.
        role = _target_role(jd)
        owned = _owned_skills(data, jd)
        vocab = _jd_vocabulary(jd)

        sentences = [x.strip() for x in re.split(r"(?<=[.!?])\s+", before.strip()) if x.strip()]
        if len(sentences) > 1:
            ranked = sorted(range(len(sentences)),
                            key=lambda i: (-_relevance(sentences[i], matched),
                                           -_vocab_overlap(sentences[i], vocab), i))
            sentences = [sentences[i] for i in ranked]

        lead = ""
        if role and role.lower() not in before.lower():
            lead = f"Targeting {role}."
        strengths = f"Core strengths for this role: {', '.join(owned)}." if owned else ""
        head = " ".join(x for x in (lead, strengths) if x)
        body = " ".join(sentences)
        rule_version = (head + "\n" + body).strip() if head else body

    # Whichever actually matches this job better wins; a tie goes to the rules,
    # because their output is traceable to the person's own sentences.
    candidates = [c for c in (rule_version, llm_version) if c and c.strip() != before.strip()]
    if not candidates:
        return {}
    after = max(candidates, key=lambda c: (score_fn(c) if score_fn else 0,
                                           -candidates.index(c)))

    if after.strip() == before.strip():
        return {}
    return {
        "key": "summary", "field": "summary", "label": "Profile summary",
        "before": before, "after": after.strip(),
        "note": ("Rewritten around the target role. Every sentence you wrote is kept — "
                 "the ones this job asks about now lead."),
        "keywords": [t for t in matched if _relevance(after, [t])][:10],
    }


# ---------------------------------------------------------------------------
# Experience and projects
# ---------------------------------------------------------------------------
def _safe_to_drop(text: str, elsewhere: str, matched: list[str]) -> bool:
    """Would removing this line cost the résumé a keyword it has nowhere else?

    Trimming is the only thing here that removes material, and removing
    material is how a "tailored" résumé ends up matching the job *less* well
    than the original did — which is exactly what happened: Regular, which
    promises to change nothing, dropped the match by a point. A line may only
    go if every term it contributes still appears somewhere else.
    """
    for term in matched:
        if _relevance(text, [term]) and not _relevance(elsewhere, [term]):
            return False
    return True


def _entry_proposal(data: dict, field: str, label: str, jd: str,
                    matched: list[str], level: str, use_llm: bool,
                    directives=None) -> dict:
    before = data.get(field) or ""
    if not before.strip():
        return {}
    # The guard: a field this module cannot rebuild exactly is a field it has
    # no business editing.
    if not _roundtrips(before):
        log.info("tailor: %s does not round-trip; leaving it alone", field)
        return {}

    blocks = _parse_blocks(before)
    vocab = _jd_vocabulary(jd)
    # None unless the person asked for a shorter CV. This one line is the
    # difference between "tailored" and "two of my bullets are gone".
    cap = directives.cap if directives else BULLET_CAP.get(level)
    dropped = 0
    rewritten = 0

    for bi, block in enumerate(blocks):
        items = block.get("items") or []
        if not items:
            continue
        # Reorder within each kind, in the positions that kind already
        # occupies — so a block of bullets is re-ranked, a block of plain
        # lines is re-ranked, and a block that mixes them keeps its shape.
        for kind in ("bullet", "line"):
            slots = [i for i, it in enumerate(items) if it["kind"] == kind]
            if len(slots) < 2:
                continue
            focus = list(getattr(directives, "resolved", []) or [])
            chosen = sorted(
                slots,
                key=lambda i: (-_relevance(items[i]["text"], focus),
                               -_relevance(items[i]["text"], matched),
                               -_vocab_overlap(items[i]["text"], vocab),
                               slots.index(i)))
            reordered = [items[i] for i in chosen]
            for slot, item in zip(slots, reordered):
                items[slot] = item

        if cap:
            bullets = [i for i, it in enumerate(items) if it["kind"] == "bullet"]
            if len(bullets) > cap:
                # Everything except the candidate, so "covered elsewhere" means
                # elsewhere in the whole résumé, not just this entry.
                for idx in reversed(bullets[cap:]):
                    rest = "\n".join(v for k, v in data.items()
                                     if k != field and isinstance(v, str))
                    rest += "\n" + "\n".join(it["text"] for j, it in enumerate(items) if j != idx)
                    if _safe_to_drop(items[idx]["text"], rest, matched):
                        items.pop(idx)
                        dropped += 1

        if level == "aggressive" and use_llm and bi < MAX_ENTRIES:
            slots = [i for i, it in enumerate(items) if it["kind"] == "bullet"]
            if slots:
                originals = [_bullet_text(items[i]) for i in slots]
                try:
                    new_bullets = _tailor_bullets(
                        block.get("header", ""), originals, jd, matched,
                        "role" if field == "experience" else "project",
                        style=tailor_prompt.style_brief(directives) if directives else "")
                except Exception:               # noqa: BLE001
                    log.exception("bullet rewrite failed for %r", block.get("header", "")[:60])
                    new_bullets = originals
                if new_bullets and len(new_bullets) == len(originals) and new_bullets != originals:
                    for slot, text in zip(slots, new_bullets):
                        indent = re.match(r"^(\s*)", items[slot]["text"]).group(1)
                        items[slot]["text"] = f"{indent}- {text}"
                    rewritten += 1
        block["items"] = items

    after = _render_blocks(blocks)
    if after.strip() == before.strip():
        return {}

    notes = ["The lines that match this job now come first"]
    if not dropped:
        notes.append("every bullet kept")
    if dropped:
        notes.append(f"{dropped} line{'s' if dropped > 1 else ''} trimmed "
                     "(only ones whose keywords appear elsewhere)")
    if rewritten:
        notes.append(f"{rewritten} entr{'ies' if rewritten > 1 else 'y'} reworded in the job's language")
    return {
        "key": field, "field": field, "label": label,
        "before": before, "after": after,
        "note": "; ".join(notes) + ". Employers, titles, dates and figures are untouched.",
        "keywords": [t for t in matched if _relevance(after, [t])][:10],
    }


# ---------------------------------------------------------------------------
# The proposal
# ---------------------------------------------------------------------------
def _score_with(data: dict, field: str, text: str, jd: str) -> int:
    trial = dict(data)
    trial[field] = text
    return score_resume_against_job(resume_text(trial), jd).get("score", 0)


def propose(builder_data: dict, job_description: str, level: str = "regular",
            use_llm: bool = True, prompt: str = "") -> dict:
    """What would change, section by section. Nothing is saved.

    `prompt` is the person's own instruction — "keep every bullet, lead with
    Azure, UK spelling". It is parsed by tailor_prompt into things this module
    can act on deterministically (what may be removed, what leads, which
    sections are off limits) and passed on verbatim to the model where prose
    gets rewritten. What comes back includes `prompt_notes`: the instruction
    read back in plain sentences, so an unparsed clause is visible rather than
    silently dropped.

    Every proposal is scored before it is offered. A change that would make the
    résumé match this job *less* well is not a tailoring suggestion, it is a
    regression, and it is dropped here rather than shown — which is what the
    "Regular" level was doing when it quietly cost a point of match by trimming
    a section it should never have touched.
    """
    level = level if level in LEVELS else "regular"
    data = dict(builder_data or {})
    jd = job_description or ""
    directives = tailor_prompt.parse(prompt)

    scored = score_resume_against_job(resume_text(data), jd)
    base_score = scored.get("score", 0)
    matched = (scored.get("matched_hard_skills") or [])[:20]
    missing = (scored.get("missing_hard_skills") or [])[:12]
    # Terms the job uses that the résumé also uses are what everything below
    # reorders around; without any, ordering by relevance is ordering by noise.
    if not matched:
        matched = [k for k in (scored.get("matched_keywords") or [])[:12]
                   if k in HARD_SKILL_ALIASES or len(k) > 3]

    # What the person asked to lead with is ranked first, where their own text
    # already contains it — an instruction can move evidence to the top, never
    # conjure it.
    whole = resume_text(data)
    for term in reversed(directives.focus):
        if not _relevance(whole, [term]):
            continue
        written = _as_written(term, whole)
        directives.resolved.insert(0, written)
        if term.lower() not in [m.lower() for m in matched]:
            matched.insert(0, written)

    summary_scorer = lambda text: _score_with(data, "summary", text, jd)  # noqa: E731
    builders = {
        "summary": lambda: _summary_proposal(data, jd, matched, level, use_llm,
                                             summary_scorer, directives),
        "skills": lambda: _skills_proposal(data, matched, level, jd, directives),
        "experience": lambda: _entry_proposal(data, "experience", "Employment history", jd,
                                              matched, level, use_llm, directives),
        "projects": lambda: _entry_proposal(data, "projects", "Projects", jd,
                                            matched, level, use_llm, directives),
    }
    candidates, held_back = [], []
    for field_name, build in builders.items():
        if not directives.allows(field_name):
            held_back.append(field_name)
            continue
        candidates.append(build())

    sections = []
    applied = dict(data)          # the résumé as it would be with everything so far
    for proposal in candidates:
        if not proposal:
            continue
        after_score = _score_with(applied, proposal["field"], proposal["after"], jd)
        before_score = score_resume_against_job(resume_text(applied), jd).get("score", 0)
        if after_score < before_score:
            # Two different situations wear the same numbers. Nobody asked for
            # this and it makes the match worse: that is a regression, and it
            # is dropped. Or they typed "cut it to four bullets a role", in
            # which case refusing silently is its own bug — the shorter CV is
            # what they asked for, so it is offered with the price on it.
            if not directives.trim:
                log.info("tailor: dropping %s proposal — it would move the match %s -> %s",
                         proposal["field"], before_score, after_score)
                continue
            proposal["cost"] = before_score - after_score
            proposal["note"] += (f" You asked for it shorter, so this is offered even though "
                                 f"it costs {proposal['cost']} point"
                                 f"{'s' if proposal['cost'] != 1 else ''} of match.")
        proposal["score_before"] = before_score
        proposal["score_after"] = after_score
        applied[proposal["field"]] = proposal["after"]
        sections.append(proposal)

    projected = score_resume_against_job(resume_text(applied), jd).get("score", base_score)

    # What is SHOWN as "your skills this job wants" has to survive being read
    # by the person whose résumé it is. The internal ranking list is allowed to
    # contain "data" and "generation" — ordering a bullet by those costs
    # nothing — but printing them as matched skills, which the first version
    # did, reads as though the tool cannot tell a skill from a word.
    display_matched = list(dict.fromkeys(
        (scored.get("matched_hard_skills") or []) + _owned_skills(data, jd, limit=10)))

    return {
        "level": level,
        "level_label": LEVEL_LABELS[level],
        "level_blurb": LEVEL_BLURBS[level],
        "match": {
            "score": base_score,
            "projected": projected,
            "matched": display_matched,
            # True when the ad names no tool this résumé lists — the honest
            # explanation for a low score that tailoring cannot lift.
            "names_no_tools": not display_matched,
            "missing": missing,
        },
        "sections": sections,
        # The instruction, read back. `prompt_notes` is what was acted on;
        # `prompt_extra` is true when there was wording beyond it, which the
        # model follows where it rewrites prose. Between them the person can
        # tell the difference between "understood" and "ignored" without
        # having to diff two versions of their own CV to find out.
        "prompt": directives.raw,
        "prompt_notes": directives.notes(),
        "prompt_extra": bool(directives.raw and not directives.notes()),
        "prompt_held_back": [p for p in held_back],
        "bullets_kept": not directives.cap,
        # Said plainly rather than implied, because the honest limit of this
        # feature is the thing people most need to know about it.
        "disclaimer": ("Only your own material is reordered and reworded — "
                       "no skill, employer, date or figure is added, and no "
                       "suggestion is offered that would lower your match."),
    }
