"""Tailoring a résumé section by section, then putting it back together.

What was wrong with doing it in one pass
----------------------------------------
The previous tailoring sent the model the old summary and the job ad, and asked
for a better summary. It never saw the person's actual experience — so it wrote
from the only material it had, the advert, and produced things like "As a
Machine Learning Engineer eager to contribute strong foundations in PyTorch/JAX"
for a backend engineer who had never touched either. Confident, fluent, and
about somebody else.

Asking for a whole résumé in one call is worse still: the model rewrites the
parts it was told to leave alone, drops entries to save tokens, and quietly
changes dates.

So: split, rewrite each piece against its own evidence, reassemble
--------------------------------------------------------------------
    summary      rewritten with the real experience as the source material
    experience   one call per job, rewriting only that job's bullets
    skills       reordered, and only terms the person already has
    education    untouched
    projects     bullets only, same rules as experience
    dates,       never sent for rewriting at all — they are copied across
    companies,   verbatim from the parsed entry, so there is no path by which
    job titles   a model can alter them

Each call gets the job description for direction and one section for material.
A model cannot invent a fifth job if it is only ever shown one job at a time and
its output is written back into that job's slot.

The structure of the original survives because only the *text inside* entries
is replaced. Entry count, order, headers and the template are all untouched, so
a tailored résumé looks like the résumé it came from.
"""

from __future__ import annotations

import logging
import re

log = logging.getLogger("momentum.ai")

MAX_ENTRIES_REWRITTEN = 6   # beyond this, older roles matter less than latency


def _entries(text: str) -> list[dict]:
    """The builder's entry format -> [{header, bullets}]. Mirrors
    resume_pdf.parse_entries(), kept local so this module has no import cycle
    with the renderer."""
    out = []
    for block in (text or "").split("\n---\n"):
        lines = [l for l in block.split("\n") if l.strip()]
        if not lines:
            continue
        out.append({
            "header": lines[0].strip(),
            "bullets": [l.strip()[1:].strip() for l in lines[1:] if l.strip().startswith("-")],
        })
    return out


def _render(entries: list[dict]) -> str:
    blocks = []
    for e in entries:
        lines = [e["header"]] + [f"- {b}" for b in e["bullets"] if b.strip()]
        blocks.append("\n".join(lines))
    return "\n---\n".join(blocks)


def _bullets_from_reply(reply: str, fallback: list[str]) -> list[str]:
    """Read bullets back, tolerating however the model formatted them."""
    if not reply:
        return fallback
    lines = []
    for line in reply.replace("\r\n", "\n").split("\n"):
        line = line.strip()
        if not line:
            continue
        # Strip any leading marker: "-", "•", "1.", "*"
        line = re.sub(r"^([-•*·▪‣]|\d+[.)])\s*", "", line).strip()
        # A model that preambles ("Here are the rewritten bullets:") gets that
        # line dropped rather than printed onto somebody's résumé.
        if line.lower().rstrip(":").endswith(("bullets", "bullet points", "as follows",
                                              "rewritten", "here they are")):
            continue
        if line:
            lines.append(line)
    return lines or fallback


def _tailor_bullets(header: str, bullets: list[str], job_description: str,
                    matched: list[str], kind: str = "role",
                    style: str = "") -> list[str]:
    """Rewrite one entry's bullets. Returns the originals on any failure.

    `style` is what the person typed into "How should it be tailored?", already
    turned into instructions by tailor_prompt.style_brief. It goes in *after*
    the hard rules and cannot override them: the count check below still runs,
    and a rewrite that loses or gains bullets is discarded whatever the
    instruction said.
    """
    from . import llm

    if not bullets:
        return bullets
    keywords = ", ".join(matched[:14]) if matched else ""
    numbered = "\n".join(f"- {b}" for b in bullets)
    prompt = (
        f"Rewrite the bullet points of this {kind} so the work most relevant to the "
        f"target job stands out. This is a real person's résumé.\n\n"
        f"HARD RULES:\n"
        f"- Return exactly {len(bullets)} bullets, one per line, each starting with '- '.\n"
        f"- Every bullet must describe something already stated in the originals. "
        f"Do not add technologies, metrics, employers or responsibilities.\n"
        f"- Keep all numbers exactly as written. Never invent a figure.\n"
        f"- Where an original bullet already covers something the job asks for, "
        f"lead with it and use the job's own vocabulary for it.\n"
        f"- If an original bullet has nothing to do with the target job, keep it, "
        f"just make it shorter.\n"
        f"- No preamble, no commentary, no headings. Bullets only.\n\n"
        f"{kind.upper()}: {header}\n\n"
        f"ORIGINAL BULLETS:\n{numbered}\n\n"
        f"TARGET JOB:\n{job_description[:1500]}\n"
        + (f"\nTERMS THE JOB USES THAT THIS PERSON GENUINELY HAS: {keywords}\n" if keywords else "")
        + (f"\nHOW THEY ASKED FOR IT TO BE WRITTEN:\n{style}\n" if style else "")
        + "\nREWRITTEN BULLETS:\n"
    )
    try:
        reply = llm.complete(prompt, max_tokens=700, temperature=0.35,
                             stop=["ORIGINAL BULLETS:", "TARGET JOB:"])
    except Exception:
        log.exception("bullet rewrite failed for %r", header[:60])
        return bullets
    if not reply:
        return bullets

    new = _bullets_from_reply(reply, bullets)
    # A rewrite that changes the bullet count has either merged or invented
    # them; the original is the safer answer in both cases.
    if not (len(bullets) <= len(new) <= len(bullets) + 1):
        log.info("bullet count changed (%s -> %s) for %r; keeping originals",
                 len(bullets), len(new), header[:60])
        return bullets
    return new[:len(bullets)]


def _tailor_summary(data: dict, job_description: str, matched: list[str],
                    style: str = "") -> str:
    """Rewrite the summary using the person's real history as the source.

    The experience section is passed in deliberately. Given only an old summary
    and a job ad, a model writes a summary of the *advert* — which is how a
    backend engineer ended up described as a machine learning engineer.
    """
    from . import llm

    original = (data.get("summary") or "").strip()
    entries = _entries(data.get("experience") or "")
    if not entries and not original:
        return original

    history = "\n".join(
        f"- {e['header']}" + (f": {e['bullets'][0]}" if e["bullets"] else "")
        for e in entries[:5])
    prompt = (
        "Write a 2-3 sentence professional summary for the top of this person's "
        "résumé, aimed at the target job.\n\n"
        "HARD RULES:\n"
        "- Only claim experience, skills or seniority evidenced below. If they have "
        "never done something the job asks for, do not imply that they have.\n"
        "- Do not name technologies absent from their history.\n"
        "- Do not describe them as the job title in the advert unless their own "
        "history already supports it.\n"
        "- Third person or first person is fine, but no 'I am excited to' filler.\n"
        "- Return the summary only. No heading, no quotes.\n\n"
        f"THEIR CURRENT SUMMARY:\n{original or '(none)'}\n\n"
        f"THEIR ACTUAL EXPERIENCE:\n{history or '(none listed)'}\n\n"
        f"THEIR SKILLS:\n{(data.get('skills') or '(none listed)')[:600]}\n\n"
        f"TARGET JOB:\n{job_description[:1500]}\n"
        + (f"\nOVERLAP WORTH LEADING WITH: {', '.join(matched[:12])}\n" if matched else "")
        + (f"\nHOW THEY ASKED FOR IT TO BE WRITTEN:\n{style}\n" if style else "")
        + "\nSUMMARY:\n"
    )
    try:
        reply = llm.complete(prompt, max_tokens=260, temperature=0.4,
                             stop=["TARGET JOB:", "THEIR ACTUAL EXPERIENCE:"])
    except Exception:
        log.exception("summary rewrite failed")
        return original
    text = " ".join((reply or "").split()).strip().strip('"')
    # Too short to be a summary, or long enough that it has started inventing.
    if not (60 <= len(text) <= 900):
        return original
    return text


def _tailor_skills(skills_text: str, matched: list[str]) -> str:
    """Lead with the categories the job actually asks about.

    Reordering only. Adding a skill because the advert wants it is how people
    end up in an interview about a language they have never written.
    """
    lines = [l for l in (skills_text or "").split("\n") if l.strip()]
    if not lines or not matched:
        return skills_text
    low = [m.lower() for m in matched]
    return "\n".join(sorted(lines, key=lambda l: -sum(1 for m in low if m in l.lower())))


def tailor_sections(builder_data: dict, job_description: str, rule_based: dict) -> dict:
    """Section-by-section tailoring. Returns a new builder_data dict.

    Falls back to the original content for any section whose rewrite fails, so
    a flaky model degrades one bullet list rather than the document.
    """
    data = dict(builder_data)
    matched = (rule_based.get("matched_hard_skills")
               or rule_based.get("matched_keywords") or [])

    data["skills"] = _tailor_skills(data.get("skills") or "", matched)

    for section, kind in (("experience", "role"), ("projects", "project")):
        entries = _entries(data.get(section) or "")
        if not entries:
            continue
        for i, entry in enumerate(entries):
            if i >= MAX_ENTRIES_REWRITTEN:
                break
            entry["bullets"] = _tailor_bullets(
                entry["header"], entry["bullets"], job_description, matched, kind)
        data[section] = _render(entries)

    # Last, so it can be written against the freshly emphasised bullets.
    data["summary"] = _tailor_summary(data, job_description, matched)

    # Education, certifications, publications, languages and every entry header
    # are deliberately absent from this function. Nothing rewrites a date, a
    # degree or an employer.
    return data
