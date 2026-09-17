"""What the advert asks for, what the CV already says, and the gap between.

The Tailor pane could reorder a résumé but it could not answer the question
people actually open it with: *which words from this advert are missing from
my CV, and can you put the true ones in?* This module answers exactly that.

Three things it produces:

    keywords      every term the advert leans on, each marked with whether the
                  CV uses it and, if so, in which sections
    requirements  the advert's own bullet lines, each marked met or unmet with
                  the evidence from the CV that met it
    summary       a short read on the fit, written by the configured model when
                  there is one and by rule otherwise

And one thing it does: weaves keywords the person SELECTS into the sections
they choose. Selection is the safeguard. Nothing here decides on its own that
somebody has a skill — the list of missing terms is presented as a list of
missing terms, the person ticks the ones that are true of them, and only those
are woven in. A model is used to work the word into a sentence that already
describes that work; it is never asked to invent the work.

Model routing is not this module's business: ai/llm.py already prefers a
configured hosted key, falls back to a local GGUF, and returns None when there
is neither, so every call here is `result or <deterministic version>`.
"""

from __future__ import annotations

import logging
import re

from ..ats_scorer import (HARD_SKILL_ALIASES, SOFT_SKILL_TERMS, STOPWORDS,
                          score_resume_against_job)
from . import llm

log = logging.getLogger("momentum.ai")

MAX_KEYWORDS = 32
MAX_REQUIREMENTS = 14

# Sections a keyword can be reported against, in the order a reader scans them.
CV_SECTIONS = [
    ("summary", "Summary"),
    ("skills", "Skills"),
    ("experience", "Experience"),
    ("projects", "Projects"),
    ("education", "Education"),
    ("certifications", "Certifications"),
    ("publications", "Publications"),
]

# Words that appear in every advert ever written and mean nothing about the
# job. Extracting these as "keywords" is what makes a keyword list useless.
BOILERPLATE = set("""
role position candidate applicant company team teams work working works job
responsibilities requirements required requirement essential desirable summary
additional information skills skill experience experienced years year minimum
ability able strong good excellent understanding knowledge familiarity
proficiency expected participation contribution discussions solutions solution
provide providing support supporting deliver delivering ensure ensuring
maintain maintaining perform performing include including includes involves
typical day daily activities part integral various across different other
opportunity opportunities looking seeking hiring join joining apply
""".split())


def _words(text: str) -> list[str]:
    """Tokens with trailing punctuation stripped.

    The obvious character class lets a full stop inside it, which is how
    "Proficiency in Data Engineering." produced the keyword "data
    engineering." — the same term as "data engineering" but ranked and
    displayed separately, and never matching anything in the CV.
    """
    raw = re.findall(r"[a-z][a-z0-9+#./-]{1,}", (text or "").lower())
    return [t.strip(".-/") for t in raw if t.strip(".-/")]


def _has_term(haystack: str, term: str) -> bool:
    """Whole-term containment, so "r" does not match "reporting"."""
    t = re.escape(term.strip().lower())
    if not t:
        return False
    return re.search(rf"(?<![a-z0-9]){t}(?![a-z0-9])", (haystack or "").lower()) is not None


# ---------------------------------------------------------------------------
# Extracting what the advert is actually about
# ---------------------------------------------------------------------------
# Words that make a phrase worth keeping even if the advert only said it once
# — they are what the job is *about*, as opposed to how the advert is written.
DOMAIN_WORDS = set("""
data pipeline pipelines etl elt warehouse warehousing lake modelling modeling
schema quality validation governance ingestion migration deployment automation
reporting dashboard dashboards analytics analysis engineering database
databases storage cloud platform platforms workflow workflows dataset datasets
sql python spark airflow kafka snowflake redshift bigquery databricks azure aws
gcp docker kubernetes terraform api apis testing monitoring troubleshooting
stakeholder stakeholders documentation mentoring
""".split())


def _domain_phrase(term: str) -> bool:
    return any(w in DOMAIN_WORDS for w in term.split())


def _as_advert_writes_it(jd: str, term: str) -> str:
    """The advert's own capitalisation, so the chip reads like the advert."""
    m = re.search(rf"(?<![A-Za-z0-9])({re.escape(term)})(?![A-Za-z0-9])", jd or "", re.I)
    return m.group(1) if m else term


# Adjectives every advert reaches for. They modify the noun without telling
# anyone anything about the job: "efficient data", "comprehensive data" and
# "smooth data" are not skills, and a keyword list containing them is a list
# nobody can act on.
ADJ_GENERIC = set("""
smooth efficient comprehensive scalable seamless organizational various
different daily integral additional strong excellent good best minimum full
new great key core relevant related overall specific appropriate
""".split())

# A phrase ending on one of these is a sentence fragment, not a term.
TAIL_FUNCTION = set("""
throughout across within into onto about between during before after via per
their your our its this that these those such other another
""".split())


VERBISH = set("""
creating enabling facilitate optimize optimise understand document load monitor
troubleshoot implementing designing developing maintaining support supporting
collaborate assist deliver delivering perform ensure ensuring include including
work working use using build building manage managing require requires
requiring provide providing become contribute
""".split())


def extract_keywords(jd: str, limit: int = MAX_KEYWORDS) -> list[dict]:
    """The advert's terms, most-used first.

    Two passes, because the two kinds of term matter for different reasons: a
    named tool ("Power BI") is what an ATS filter keys on, and a phrase ("data
    pipelines", "ETL processes") is what a human reader looks for.

    Phrases are taken inside clauses, never across them. Without that, an
    n-gram walker slices straight through punctuation and produces "load data
    enabling", "performance document data" and "facilitate smooth data" — each
    of them a keyword that appears in no CV ever written, presented to
    somebody as a thing to add to theirs.
    """
    low = (jd or "").lower()
    counts: dict[str, dict] = {}

    def add(term: str, kind: str, weight: int = 1):
        term = term.strip()
        if not term:
            return
        row = counts.setdefault(term.lower(), {"term": term, "kind": kind, "count": 0})
        row["count"] += weight
        if kind == "skill":                      # a named tool outranks a phrase
            row["kind"] = "skill"

    # 1. named tools and technologies from the shared lexicon
    for canonical, aliases in HARD_SKILL_ALIASES.items():
        hits = sum(len(re.findall(rf"(?<![a-z0-9]){re.escape(a)}(?![a-z0-9])", low)) for a in aliases)
        if hits:
            add(canonical, "skill", hits * 3)

    # 2. noun phrases, clause by clause
    for clause in re.split(r"[.;:,\n()!?]+", low):
        tokens = [t for t in _words(clause)]
        for size in (3, 2):
            for i in range(len(tokens) - size + 1):
                gram = tokens[i:i + size]
                if any(t in STOPWORDS or t in BOILERPLATE or len(t) < 3 for t in gram):
                    continue
                # A phrase that opens or closes on a verb is a fragment of a
                # sentence, not a thing the job is about.
                if gram[0] in VERBISH or gram[-1] in VERBISH:
                    continue
                if gram[0] in ADJ_GENERIC or gram[-1] in TAIL_FUNCTION:
                    continue
                if not any(t in DOMAIN_WORDS for t in gram):
                    continue
                add(" ".join(gram), "phrase")

    # 3. single words used repeatedly
    single: dict[str, int] = {}
    for t in _words(jd):
        if t in STOPWORDS or t in BOILERPLATE or t in VERBISH or len(t) < 4:
            continue
        single[t] = single.get(t, 0) + 1
    for t, n in single.items():
        if n >= 2:
            add(t, "soft" if t in SOFT_SKILL_TERMS else "word", n - 1)

    rows = [r for r in counts.values()
            if r["kind"] == "skill"
            or (r["kind"] == "phrase" and (r["count"] >= 2 or _domain_phrase(r["term"])))
            or r["count"] >= 3]
    rows.sort(key=lambda r: (-r["count"], len(r["term"])))

    rows.sort(key=lambda r: (-r["count"], -len(r["term"].split()), r["term"]))
    return rows[:limit * 3]


def dedupe_keywords(rows: list[dict], protect: set, limit: int = MAX_KEYWORDS) -> list[dict]:
    """Overlapping phrases: keep the one that carries information.

    "cloud-based data platforms" beats "cloud-based data" — the longer one says
    what kind of platforms. But a shorter phrase that the CV actually uses is
    never dropped: absorbing "data quality" into "data quality assurance"
    turned three genuine matches into one and told the person their CV shared
    a single word with the advert, which was false.
    """
    dropped: set = set()
    for a in rows:
        for b in rows:
            if a is b:
                continue
            at, bt = a["term"].lower(), b["term"].lower()
            if at in dropped or bt in dropped:
                continue
            if at in bt and len(bt) > len(at) and a["count"] <= b["count"]:
                if at in protect:                # evidence of a real match
                    continue
                dropped.add(at)
    return [r for r in rows if r["term"].lower() not in dropped][:limit]


def locate(values: dict, term: str) -> list[str]:
    """Which CV sections use this term."""
    return [label for key, label in CV_SECTIONS if _has_term(values.get(key) or "", term)]


def extract_requirements(jd: str, limit: int = MAX_REQUIREMENTS) -> list[str]:
    """The advert's own bullet lines — its list of what it wants."""
    out = []
    for raw in (jd or "").split("\n"):
        line = raw.strip()
        if not line:
            continue
        if not re.match(r"^([*\-•·▪‣]|\d+[.)])\s+", line):
            continue
        line = re.sub(r"^([*\-•·▪‣]|\d+[.)])\s+", "", line).strip(" .;")
        line = re.sub(r"^(must to have skills|good to have skills)\s*:\s*", "", line, flags=re.I)
        if 12 <= len(line) <= 220:
            out.append(line)
        if len(out) >= limit:
            break
    return out


def requirement_met(values: dict, requirement: str) -> tuple[bool, str]:
    """Is there evidence in the CV for this requirement, and where?

    Deliberately generous about *what* counts and strict about *claiming* it:
    a requirement counts as met when the CV shares at least half of its
    meaningful words, and the section that shares them is named so the person
    can judge the call themselves rather than trusting a tick.
    """
    terms = [t for t in _words(requirement)
             if t not in STOPWORDS and t not in BOILERPLATE and len(t) >= 4]
    if not terms:
        return False, ""
    best_section, best_hits = "", 0
    for key, label in CV_SECTIONS:
        text = values.get(key) or ""
        hits = sum(1 for t in set(terms) if _has_term(text, t))
        if hits > best_hits:
            best_section, best_hits = label, hits
    met = best_hits >= max(2, len(set(terms)) // 2)
    return met, (best_section if met else "")


# ---------------------------------------------------------------------------
# The summary
# ---------------------------------------------------------------------------
def _rule_summary(score: int, present: list[dict], absent: list[dict],
                  reqs_met: int, reqs_total: int) -> str:
    have = ", ".join(k["term"] for k in present[:5])
    lack = ", ".join(k["term"] for k in absent[:5])
    bits = [f"Your CV matches {score}% of this advert."]
    if have:
        bits.append(f"It already uses the advert's own words for {have}.")
    if reqs_total:
        bits.append(f"You show evidence for {reqs_met} of its {reqs_total} listed requirements.")
    if lack:
        bits.append(f"It never mentions {lack} — add whichever of those you genuinely have, "
                    f"in the words the advert uses.")
    return " ".join(bits)


def match_summary(values: dict, jd: str, score: int, present: list[dict],
                  absent: list[dict], reqs_met: int, reqs_total: int) -> tuple[str, str]:
    """A short read on the fit. Returns (text, mode)."""
    cv = "\n\n".join(f"{label}:\n{values.get(key)}" for key, label in CV_SECTIONS if values.get(key))
    prompt = (
        "Compare this CV with this job advert. Write 3 to 4 sentences for the person whose CV it "
        "is: what genuinely lines up, then the gaps, in plain language. Name specifics from the "
        "CV rather than generalities. Do not invent experience the CV does not state. Do not "
        "flatter. No headings, no bullet points, no preamble.\n\n"
        f"CV:\n{llm.fence(cv[:5000])}\n\n"
        f"JOB ADVERT:\n{llm.fence((jd or '')[:4000])}\n\n"
        "ASSESSMENT:\n"
    )
    try:
        out = llm.chat("You are a blunt, accurate careers adviser.", prompt,
                       max_tokens=320, temperature=0.3)
    except Exception:                            # noqa: BLE001
        log.exception("match summary failed")
        out = None
    text = (out or "").strip()
    # A model that answers with a heading, a list, or two words has not done
    # the job; the rule-based sentence is more useful than a broken one.
    if text and len(text) > 120 and not text.lstrip().startswith(("#", "-", "*")):
        return text, "llm"
    return _rule_summary(score, present, absent, reqs_met, reqs_total), "lite"


# ---------------------------------------------------------------------------
# The whole analysis
# ---------------------------------------------------------------------------
def analyse(values: dict, jd: str) -> dict:
    from .tailor_levels import resume_text          # local: avoids a cycle

    cv_text = resume_text(values)
    scored = score_resume_against_job(cv_text, jd)
    score = scored.get("score", 0)

    candidates = extract_keywords(jd)
    present_terms = {r["term"].lower() for r in candidates if locate(values, r["term"])}
    keywords = []
    for row in dedupe_keywords(candidates, present_terms):
        where = locate(values, row["term"])
        keywords.append({
            # Shown the way the advert writes it: "ETL", not "etl".
            "term": _as_advert_writes_it(jd, row["term"]),
            "kind": row["kind"],
            "jd_count": row["count"],
            "in_cv": bool(where),
            "where": where,
        })
    present = [k for k in keywords if k["in_cv"]]
    absent = [k for k in keywords if not k["in_cv"]]

    requirements = []
    for text in extract_requirements(jd):
        met, evidence = requirement_met(values, text)
        requirements.append({"text": text, "met": met, "evidence": evidence})
    reqs_met = sum(1 for r in requirements if r["met"])

    summary, mode = match_summary(values, jd, score, present, absent,
                                  reqs_met, len(requirements))

    return {
        "score": score,
        "summary": summary,
        "summary_mode": mode,
        "model": llm.status().get("mode", "lite"),
        "keywords": keywords,
        "present_count": len(present),
        "absent_count": len(absent),
        "requirements": requirements,
        "requirements_met": reqs_met,
    }


# ---------------------------------------------------------------------------
# Weaving chosen keywords in
# ---------------------------------------------------------------------------
SECTION_LABELS = {"summary": "Profile summary", "skills": "Skills",
                  "experience": "Employment history", "projects": "Projects"}


def _skills_with(skills_text: str, terms: list[str]) -> str:
    """Add terms to the Skills section, in the person's own grouping.

    Deterministic, and the only weave that needs no model: a skills list is a
    list, and appending to the group whose other members are most like the new
    term is a decision rules can make correctly.
    """
    from .tailor_levels import _skills_lines, _split_items

    groups = _skills_lines(skills_text or "")
    if not groups:
        return ", ".join(terms)
    to_add = [t for t in terms if not _has_term(skills_text, t)]
    if not to_add:
        return skills_text

    def best_group(term: str) -> int:
        """The group whose heading the term belongs under.

        The heading is worth more than the contents: "data pipelines" belongs
        under "Cloud and Data Platforms" because of the word in the heading,
        not because of anything it shares with "Microsoft Azure". With no
        overlap at all the last group wins — it is conventionally the most
        general one, and a wrong-but-plausible home beats inventing a heading.
        """
        tw = set(_words(term))
        best, best_score = len(groups) - 1, 0
        for i, (label, values) in enumerate(groups):
            score = 3 * len(tw & set(_words(label))) + len(tw & set(_words(values)))
            if score > best_score:
                best, best_score = i, score
        return best

    grouped = {i: list(_split_items(v)) for i, (_l, v) in enumerate(groups)}
    for term in to_add:
        grouped[best_group(term)].append(term)
    lines = []
    for i, (label, _values) in enumerate(groups):
        joined = ", ".join(grouped[i])
        lines.append(f"{label}: {joined}" if label else joined)
    return "\n".join(lines)


def _weave_prose(section_key: str, text: str, terms: list[str], jd: str) -> str | None:
    """Ask the model to work the terms into what is already written.

    The instructions are narrow on purpose. The failure this guards against is
    not a clumsy sentence, it is a fabricated one: a model told to "add ETL"
    to an employment history will happily add an ETL project that never
    happened. So it is told to reword what is there, keep every entry, and
    leave any term it cannot place truthfully alone — and the result is
    checked below before anyone sees it.
    """
    label = SECTION_LABELS.get(section_key, section_key)
    prompt = (
        f"Rewrite the {label} section of a CV so that it uses these words from a job advert: "
        f"{', '.join(terms)}.\n\n"
        "HARD RULES:\n"
        "- Only reword what is already there. Do not add a job, a project, a date, a number, "
        "an employer or a responsibility that is not in the original.\n"
        "- Keep exactly the same number of entries and bullet points, in the same order, with "
        "the same '---' separators and '- ' bullet markers.\n"
        "- Keep every header line (job title, employer, dates, project name) byte for byte.\n"
        "- Use a word from the list only where the original already describes that work. If it "
        "does not, leave that word out. Leaving a word out is correct and expected.\n"
        "- No commentary, no preamble, no explanation. Return the section only.\n\n"
        f"ORIGINAL {label.upper()}:\n{llm.fence(text[:4000])}\n\n"
        f"THE ADVERT, FOR CONTEXT ONLY:\n{llm.fence((jd or '')[:1500])}\n\n"
        f"REWRITTEN {label.upper()}:\n"
    )
    try:
        out = llm.complete(prompt, max_tokens=900, temperature=0.3)
    except Exception:                            # noqa: BLE001
        log.exception("keyword weave failed for %s", section_key)
        return None
    return (out or "").strip() or None


def _structure_ok(before: str, after: str) -> bool:
    """Did the rewrite keep the shape of the section?

    Entry count and bullet count are the two things a model silently changes,
    and both are load-bearing: a merged entry loses a job, an extra bullet is
    an invented one. Cheap to check, and the check is what makes it safe to
    offer the result at all.
    """
    if not after or len(after) < len(before) * 0.5:
        return False
    n_entries = lambda t: len([b for b in t.split("\n---\n") if b.strip()])          # noqa: E731
    n_bullets = lambda t: len([l for l in t.split("\n") if l.strip().startswith("-")])  # noqa: E731
    if n_entries(after) != n_entries(before):
        return False
    return abs(n_bullets(after) - n_bullets(before)) <= 1


def weave(values: dict, terms: list[str], targets: list[str], jd: str) -> dict:
    """Proposals that put the chosen terms into the chosen sections."""
    terms = [t.strip() for t in (terms or []) if t and t.strip()][:12]
    targets = [t for t in (targets or []) if t in SECTION_LABELS] or ["skills"]
    if not terms:
        return {"sections": [], "added": [], "skipped": [], "model": llm.status().get("mode", "lite")}

    sections, added, skipped = [], [], []

    if "skills" in targets:
        before = values.get("skills") or ""
        after = _skills_with(before, terms)
        if after.strip() != before.strip():
            placed = [t for t in terms if _has_term(after, t) and not _has_term(before, t)]
            sections.append({
                "key": "skills", "field": "skills", "label": SECTION_LABELS["skills"],
                "before": before, "after": after, "added": placed,
                "note": f"Added {', '.join(placed)} to the group each fits best.",
            })
            added.extend(placed)

    for key in [t for t in targets if t != "skills"]:
        before = values.get(key) or ""
        if not before.strip():
            continue
        out = _weave_prose(key, before, terms, jd)
        if not out:
            skipped.append({"section": SECTION_LABELS[key],
                            "why": "No AI model is configured, so only the Skills list could be "
                                   "updated. Add an API key or a local model in the AI Model tab "
                                   "to reword prose sections."})
            continue
        if not _structure_ok(before, out):
            skipped.append({"section": SECTION_LABELS[key],
                            "why": "The rewrite changed the section's structure, so it was "
                                   "discarded rather than shown."})
            continue
        placed = [t for t in terms if _has_term(out, t) and not _has_term(before, t)]
        if not placed:
            skipped.append({"section": SECTION_LABELS[key],
                            "why": "Nothing here honestly describes those words, so it was left "
                                   "as it is."})
            continue
        sections.append({
            "key": key, "field": key, "label": SECTION_LABELS[key],
            "before": before, "after": out, "added": placed,
            "note": f"Reworded to use {', '.join(placed)} where your existing text already "
                    f"describes that work.",
        })
        added.extend(placed)

    return {
        "sections": sections,
        "added": list(dict.fromkeys(added)),
        "not_placed": [t for t in terms if t not in added],
        "skipped": skipped,
        "model": llm.status().get("mode", "lite"),
    }
