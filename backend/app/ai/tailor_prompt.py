"""How *this person* wants their CV tailored, read off their own sentence.

Three strength buttons are a blunt instrument. They encode one person's idea
of what "medium" means and apply it to everybody: Medium used to rewrite the
summary *and* delete bullets, so someone who wanted a sharper opening
paragraph lost two lines of employment history they never asked to lose. The
strength now decides how much rewriting happens; this module decides
everything else, from a sentence the person types in their own words:

    "Keep every bullet. Lead with Azure and dbt. UK spelling, no buzzwords."

Two things fall out of parsing it here rather than passing the whole sentence
to a model.

First, it works with no model at all. "At most four bullets a role" is a
number, and a number can be honoured by a loop. Only the wording of prose is
worth a model's time, and when there is one the raw sentence goes to it as
well — the parse never gets in the way of the instruction.

Second, it can be shown back. Everything understood here becomes a line in
`notes`, printed under the box, so the person can see that "keep every bullet"
was read as *keep every bullet* before they apply anything. An instruction
silently ignored is worse than one refused.

What no instruction can do is add anything that is not already in the résumé.
"Say I know Kubernetes" is not a tailoring instruction, it is a request to lie,
and the rules downstream — every term must already appear in the person's own
text — do not have an override.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

# The four fields tailoring may touch, and the words people use for them.
SECTION_WORDS = {
    "summary": ("summary", "profile", "personal statement", "objective", "intro",
                "introduction", "opening", "about me"),
    "skills": ("skills", "skill", "technical skills", "key skills", "competencies",
               "tech stack", "toolset"),
    "experience": ("experience", "employment", "employment history", "work history",
                   "job history", "roles", "jobs", "career", "work experience",
                   "professional experience", "positions"),
    "projects": ("projects", "project", "portfolio", "side projects"),
}

_NUM_WORDS = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6,
              "seven": 7, "eight": 8, "nine": 9, "ten": 10, "eleven": 11, "twelve": 12}
_NUM = r"\d{1,2}|" + "|".join(_NUM_WORDS)

# "no more than 4 bullets", "keep it to three points", "max 5 lines per role"
_CAP_LIMIT = re.compile(
    rf"\b(?:max(?:imum)?(?: of)?|no more than|not more than|at most|up to|limit(?:ed)?(?: it)?(?: to)?|"
    rf"keep(?: it)?(?: to)?|only|just)\s+(?:about\s+)?({_NUM})\s*"
    rf"(?:short\s+|key\s+|top\s+)?(?:bullet|point|line|item)s?\b", re.I)
# "4 bullets per role", "five points each"
_CAP_PER = re.compile(
    rf"\b({_NUM})\s*(?:short\s+|key\s+|top\s+)?(?:bullet|point|line|item)s?\s+"
    rf"(?:per|for each|each|an?)\b", re.I)

# Wanting it shorter, without naming a number.
_SHORTEN = re.compile(
    r"\b(shorten|shorter|trim|condense|concise|conciser|tighten|cut it down|cut down|"
    r"one[- ]page|1[- ]page|single[- ]page|fit (?:it )?on(?:to)? one page|"
    r"make it brief|briefer|less wordy|reduce the length|drop the weakest|"
    r"drop the least relevant|remove the irrelevant)\b", re.I)

# Wanting it left whole. Checked last and wins, because "shorten the summary
# but keep every bullet" is one sentence with both signals in it and the
# explicit one is the one that means what it says.
_KEEP_ALL = re.compile(
    r"\b(?:keep|retain|leave)\s+(?:all|every|each|the)\b[^.;\n]{0,30}"
    r"\b(bullet|point|line|item|responsibilit|achievement|detail)"
    r"|\b(?:do not|don'?t|never|no need to|no)\s+(?:remove|delete|drop|cut|trim|lose|shorten)"
    r"|\bno (?:trimming|cutting|deleting|shortening)\b"
    r"|\bkeep (?:everything|it all|them all|all of it)\b"
    r"|\bnothing (?:removed|deleted|dropped|cut)\b", re.I)

_FOCUS = re.compile(
    r"\b(?:focus(?:ing|ed)?(?: it)? on|emphasi[sz]e|emphasis on|highlight|lead with|"
    r"leading with|prioriti[sz]e|play up|foreground|make more of|bring out|push)\s+"
    r"([^.;\n]{2,120})", re.I)

_AVOID = re.compile(
    r"\b(?:avoid|leave out|steer clear of|stay away from|cut the|lose the|"
    r"(?:do not|don'?t|never)\s+(?:use|mention|say|include|write))\s+"
    r"([^.;\n]{2,80})", re.I)
_AVOID_FLAT = re.compile(r"\bno (buzzwords?|jargon|fluff|clich[ée]s?|waffle|filler|padding)\b", re.I)

_CHANGE_VERB = r"(?:touch|change|rewrite|rewriting|alter|edit|modify|rework|reword|update|tailor)"
_NEGATED = re.compile(
    rf"\b(?:do not|don'?t|never|avoid|without)\s+{_CHANGE_VERB}|"
    rf"\bleave\s+(?:my|the)?\s*[a-z ]{{0,24}}\balone\b|"
    rf"\bkeep\s+(?:my|the)?\s*[a-z ]{{0,24}}\b(?:as is|as it is|as they are|unchanged|untouched)\b|"
    rf"\b(?:hands off|no changes to|skip)\b", re.I)
_ONLY = re.compile(rf"\b(?:only|just|nothing but)\b(?:\s+{_CHANGE_VERB})?", re.I)

_VOICE = ((re.compile(r"\bfirst[- ]person\b", re.I), "first"),
          (re.compile(r"\bthird[- ]person\b", re.I), "third"))
_SPELLING = ((re.compile(r"\b(?:uk|british|en-?gb)\s*(?:english|spelling|conventions?)?\b", re.I), "uk"),
             (re.compile(r"\b(?:us|american|en-?us)\s*(?:english|spelling|conventions?)?\b", re.I), "us"))

_TONES = ("formal", "informal", "plain", "direct", "punchy", "confident", "humble",
          "technical", "commercial", "executive", "academic", "friendly", "factual",
          "conversational", "understated", "senior")

_METRICS = re.compile(r"\b(quantif\w+|lead with (?:the )?(?:numbers|metrics|figures)|"
                      r"more (?:numbers|metrics|figures)|show(?: the)? impact|results[- ]first)\b", re.I)

# Bare fragments a focus/avoid capture is not worth keeping as a term.
_STOP_ITEM = {"it", "them", "that", "this", "these", "those", "my", "the", "a", "an",
              "more", "less", "stuff", "things", "anything", "everything", "role", "job"}


def _to_int(word: str) -> int | None:
    word = (word or "").strip().lower()
    if word.isdigit():
        return int(word)
    return _NUM_WORDS.get(word)


def _items(tail: str) -> list[str]:
    """Split "Azure, dbt and Airflow" into three terms.

    Deliberately shallow. A capture that runs into a clause ("Azure and make
    sure the summary reads well") would otherwise become a "keyword" and get
    pushed to the top of somebody's employment history.
    """
    parts = re.split(r",|\band\b|\balso\b|&|/|\+", tail or "")
    out = []
    for part in parts:
        term = part.strip().strip(".;:\"'()").strip()
        term = re.sub(r"^(?:my|the|our|on|any|some|more)\s+", "", term, flags=re.I).strip()
        term = re.sub(r"^(?:words?|phrases?|terms?|expressions?)\s+", "", term, flags=re.I).strip()
        if not term or len(term) > 40 or term.lower() in _STOP_ITEM:
            continue
        # A clause, not a term.
        if len(term.split()) > 4 or re.search(r"\b(?:is|are|was|were|should|would|make|so)\b", term, re.I):
            continue
        if term.lower() not in {t.lower() for t in out}:
            out.append(term)
        if len(out) >= 6:
            break
    return out


def _sections_in(clause: str) -> set[str]:
    found = set()
    low = clause.lower()
    for field_name, words in SECTION_WORDS.items():
        for word in words:
            if re.search(rf"(?<![a-z]){re.escape(word)}(?![a-z])", low):
                found.add(field_name)
                break
    return found


# A comma only starts a new instruction when what follows reads like one.
# Splitting on every comma would tear "focus on Azure, dbt and Airflow" into
# three clauses; not splitting at all read "only rewrite the summary, don't
# touch my employment history" as a single negated clause and left both alone.
_CLAUSE_SPLIT = re.compile(
    r"[.;\n]|\bbut\b|\bthough\b|"
    r",\s*(?=(?:and\s+|also\s+)?(?:only|just|but|do not|don'?t|never|leave|keep|avoid|"
    r"skip|no changes|hands off|rewrite|change|touch|edit|update|tailor)\b)", re.I)


def _clauses(text: str) -> list[str]:
    return [c for c in _CLAUSE_SPLIT.split(text or "") if c and c.strip()]


@dataclass
class Directives:
    """A parsed instruction. Every field has a do-nothing default."""

    raw: str = ""
    trim: bool = False
    keep_all: bool = False
    max_bullets: int | None = None
    focus: list[str] = field(default_factory=list)
    avoid: list[str] = field(default_factory=list)
    only: set = field(default_factory=set)
    skip: set = field(default_factory=set)
    voice: str = ""
    spelling: str = ""
    tones: list[str] = field(default_factory=list)
    metrics: bool = False
    # `focus` as the person typed it; `resolved` is the subset their résumé
    # actually contains, filled in by the caller. Ordering by a term nobody's
    # CV mentions is ordering by nothing.
    resolved: list = field(default_factory=list)

    @property
    def is_empty(self) -> bool:
        return not (self.raw or "").strip()

    def allows(self, field_name: str) -> bool:
        """May this section be changed at all?"""
        if self.only:
            return field_name in self.only
        return field_name not in self.skip

    @property
    def cap(self) -> int | None:
        """Bullets per entry, or None for keep-them-all.

        The default is None on every strength. Trimming happens because it was
        asked for, never because a strength was chosen.
        """
        if self.keep_all or not self.trim:
            return None
        return self.max_bullets or 5

    def brief(self, limit: int = 600) -> str:
        """The person's own words, for the model to follow where it writes prose."""
        text = " ".join((self.raw or "").split())
        return text[:limit]

    def notes(self) -> list[str]:
        """Plain sentences saying what was understood. Shown under the box."""
        out = []
        if self.keep_all:
            out.append("Every bullet is kept — nothing is removed.")
        elif self.max_bullets:
            out.append(f"Entries are trimmed to at most {self.max_bullets} bullets, "
                       "and only where the keywords survive elsewhere.")
        elif self.trim:
            out.append("Long entries may be trimmed, keeping the bullets this job asks about.")
        if self.focus:
            out.append("Leading with " + ", ".join(self.focus) + " wherever your CV already shows it.")
        if self.avoid:
            out.append("Avoiding " + ", ".join(self.avoid) + ".")
        if self.only:
            out.append("Only " + _phrase(sorted(self.only)) + " will change.")
        elif self.skip:
            out.append(_phrase(sorted(self.skip)).capitalize() + " left exactly as written.")
        if self.voice:
            out.append(f"Written in the {self.voice} person.")
        if self.spelling:
            out.append(("British" if self.spelling == "uk" else "American") + " spelling.")
        if self.tones:
            out.append("Tone: " + ", ".join(self.tones) + ".")
        if self.metrics:
            out.append("Numbers you already have are pulled to the front of the line.")
        return out


_LABELS = {"summary": "the summary", "skills": "skills",
           "experience": "employment history", "projects": "projects"}


def _phrase(fields: list[str]) -> str:
    names = [_LABELS.get(f, f) for f in fields]
    if len(names) <= 1:
        return names[0] if names else ""
    return ", ".join(names[:-1]) + " and " + names[-1]


def parse(text: str) -> Directives:
    """Read an instruction. Never raises — an unparseable sentence is a no-op."""
    d = Directives(raw=(text or "").strip())
    if d.is_empty:
        return d
    raw = d.raw

    m = _CAP_LIMIT.search(raw) or _CAP_PER.search(raw)
    if m:
        n = _to_int(m.group(1))
        if n and 1 <= n <= 12:
            d.max_bullets, d.trim = n, True
    if _SHORTEN.search(raw):
        d.trim = True
    if _KEEP_ALL.search(raw):
        d.keep_all, d.trim, d.max_bullets = True, False, None

    for m in _FOCUS.finditer(raw):
        for term in _items(m.group(1)):
            if term.lower() not in {t.lower() for t in d.focus}:
                d.focus.append(term)
    for m in _AVOID.finditer(raw):
        for term in _items(m.group(1)):
            if term.lower() not in {t.lower() for t in d.avoid}:
                d.avoid.append(term)
    for m in _AVOID_FLAT.finditer(raw):
        word = m.group(1).lower()
        if word not in {t.lower() for t in d.avoid}:
            d.avoid.append(word)

    # Section scope is decided clause by clause: "rewrite the summary, don't
    # touch my employment history" holds two opposite instructions and both
    # have to survive.
    for clause in _clauses(raw):
        sections = _sections_in(clause)
        if not sections:
            continue
        if _NEGATED.search(clause):
            d.skip |= sections
        elif _ONLY.search(clause) and not _CAP_LIMIT.search(clause):
            d.only |= sections
    d.only -= d.skip

    for pattern, value in _VOICE:
        if pattern.search(raw):
            d.voice = value
    for pattern, value in _SPELLING:
        if pattern.search(raw):
            d.spelling = value
    low = raw.lower()
    d.tones = [t for t in _TONES if re.search(rf"(?<![a-z]){t}(?![a-z])", low)][:3]
    d.metrics = bool(_METRICS.search(raw))
    return d


def style_brief(d: Directives) -> str:
    """The instruction as extra rules for a model, on top of the hard rules.

    Returned as text the caller fences before sending. The wording is
    deliberately additive — it asks for emphasis and phrasing, never for new
    facts, so an instruction like "say I led the migration" still cannot get
    past the rule that every claim must already appear in the person's text.
    """
    if d.is_empty:
        return ""
    lines = [f'The person asked for this, in their words: "{d.brief()}"',
             "Follow it for emphasis, ordering and phrasing only. It does not "
             "license any claim their résumé does not already make."]
    if d.focus:
        lines.append("Lead with: " + ", ".join(d.focus) + " — but only where their text already shows it.")
    if d.avoid:
        lines.append("Avoid the words: " + ", ".join(d.avoid) + ".")
    if d.voice:
        lines.append(f"Write in the {d.voice} person.")
    if d.spelling:
        lines.append("Use " + ("British" if d.spelling == "uk" else "American") + " spelling.")
    if d.tones:
        lines.append("Tone: " + ", ".join(d.tones) + ".")
    if d.metrics:
        lines.append("Where a figure already exists in the original, put it early in the line.")
    if d.keep_all:
        lines.append("Do not drop anything. Return the same number of lines you were given.")
    return "\n".join(lines)
