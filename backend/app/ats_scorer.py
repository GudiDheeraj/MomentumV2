"""
Momentum ATS Scorer v2
--------------------
A self-contained ATS (Applicant Tracking System) match scorer. No external
API calls or ML libraries — everything runs locally so it works offline and
keeps resume/JD text private, while still going well beyond a naive
"does the word appear anywhere" bag-of-words check.

What changed vs v1:
  1. Multi-word phrase matching. Real ATS keyword filters (and real job
     descriptions) care about phrases like "machine learning" or "project
     management", not just the words "machine" and "learning" separately.
     We extract unigrams AND multi-word aliases from a curated skill
     lexicon, so "React Native" is matched as one skill, not two unrelated
     hits.
  2. Synonym/alias normalization. "JS" == "JavaScript", "Postgres" ==
     "PostgreSQL", "ML" == "Machine Learning", etc. A resume that says
     "Node.js" now correctly matches a JD asking for "NodeJS".
  3. Section-aware weighting. A requirement's importance is boosted if it
     appears in a JD's "requirements/must have/qualifications" section, and
     a resume hit gets a small bonus if it appears in the resume's own
     skills section — mirroring how recruiters and real ATS keyword filters
     weigh things.
  4. Hard-skill vs. soft-skill separation. Hard skills (tools, languages,
     frameworks, certifications) drive the keyword-coverage score since
     that's what ATS filters gate on; soft skills are reported separately
     as informational context, not scored.
  5. Title / seniority match. A lightweight signal comparing the resume's
     apparent seniority against the JD's seniority terms (e.g. "Senior",
     "Lead", "Manager") — mismatches here are a common reason resumes get
     filtered even with good keyword coverage.
  6. Clearer, more actionable output: matched/missing keywords are split
     into hard-skill / soft-skill buckets, and a short list of plain-
     English recommendations is generated.
"""
import math
import re
from collections import Counter

from .cache import TTL_ATS, get_json, make_key, set_json

# ---------------------------------------------------------------------------
# Stopwords — generic words that carry no matching signal.
# ---------------------------------------------------------------------------
STOPWORDS = set("""
a an the and or but if while is are was were be been being have has had do does did
will would shall should may might must can could of to in on for with at by from up
about into over after under again further then once here there when where why how
all any both each few more most other some such no nor not only own same so than too
very s t just don now i me my myself we our ours ourselves you your yours yourself
yourselves he him his himself she her hers herself it its itself they them their
theirs themselves what which who whom this that these those am as until below between
during before out off above through during ll re ve ain aren couldn didn doesn hadn
hasn haven isn ma mightn mustn needn shan shouldn wasn weren won wouldn etc via per
using use used work working experience years year strong excellent good ability
skills including preferred required requirements responsibilities role team teams
join company looking candidate candidates ideal within across also new plus etc
opportunity opportunities environment fast paced growing help make sure ensure
knowledge familiarity familiar understanding solid demonstrated proven track
record passion passionate motivated self starter driven bonus nice have
""".split())

# ---------------------------------------------------------------------------
# Skill lexicon: canonical skill -> list of surface forms (aliases), including
# multi-word phrases. Intentionally broad-but-shallow; unknown terms still
# fall back to plain unigram matching so nothing is "missed" just because
# it isn't in the list.
# ---------------------------------------------------------------------------
HARD_SKILL_ALIASES = {
    "javascript": ["javascript", "js"],
    "typescript": ["typescript", "ts"],
    "python": ["python"],
    "java": ["java"],
    "c++": ["c++", "cpp"],
    "c#": ["c#", "csharp"],
    "golang": ["golang", "go lang", "go"],
    "sql": ["sql"],
    "nosql": ["nosql"],
    "postgresql": ["postgresql", "postgres", "psql"],
    "mysql": ["mysql"],
    "mongodb": ["mongodb", "mongo"],
    "react": ["react", "react.js", "reactjs"],
    "react native": ["react native"],
    "vue": ["vue", "vue.js", "vuejs"],
    "angular": ["angular", "angular.js", "angularjs"],
    "node.js": ["node.js", "nodejs", "node"],
    "next.js": ["next.js", "nextjs"],
    "graphql": ["graphql"],
    "rest api": ["rest api", "restful api", "rest", "restful"],
    "fastapi": ["fastapi"],
    "django": ["django"],
    "flask": ["flask"],
    "spring boot": ["spring boot", "spring"],
    "docker": ["docker"],
    "kubernetes": ["kubernetes", "k8s"],
    "aws": ["aws", "amazon web services"],
    "azure": ["azure", "microsoft azure"],
    "gcp": ["gcp", "google cloud platform", "google cloud"],
    "terraform": ["terraform"],
    "ci/cd": ["ci/cd", "cicd", "continuous integration", "continuous deployment"],
    "git": ["git"],
    "linux": ["linux"],
    "machine learning": ["machine learning", "ml"],
    "deep learning": ["deep learning"],
    "natural language processing": ["natural language processing", "nlp"],
    "data analysis": ["data analysis", "data analytics"],
    "data engineering": ["data engineering"],
    "data science": ["data science"],
    "pandas": ["pandas"],
    "numpy": ["numpy"],
    "tensorflow": ["tensorflow"],
    "pytorch": ["pytorch"],
    "power bi": ["power bi", "powerbi"],
    "tableau": ["tableau"],
    "excel": ["excel", "microsoft excel"],
    "microservices": ["microservices", "microservice"],
    "distributed systems": ["distributed systems"],
    "system design": ["system design"],
    "agile": ["agile", "scrum"],
    "project management": ["project management"],
    "product management": ["product management"],
    "html": ["html", "html5"],
    "css": ["css", "css3"],
    "tailwind": ["tailwind", "tailwindcss"],
    "redux": ["redux"],
    "webpack": ["webpack"],
    "graphic design": ["graphic design"],
    "figma": ["figma"],
    "salesforce": ["salesforce"],
    "sap": ["sap"],
    "jira": ["jira"],
    "linear algebra": ["linear algebra"],
    "statistics": ["statistics"],
    "a/b testing": ["a/b testing", "ab testing"],
    "seo": ["seo", "search engine optimization"],
    "google analytics": ["google analytics"],
    "cybersecurity": ["cybersecurity", "cyber security", "infosec"],
    "networking": ["networking"],
    "devops": ["devops"],
    # --- v3 additions ---------------------------------------------------
    # The original 70 entries skewed heavily to web development, so common
    # requirements like Kafka, Terraform-adjacent tooling, and anything
    # outside engineering fell through to plain unigram matching — matched
    # correctly, but never classified as a *hard* skill, which is the bucket
    # the coverage score and the "missing skills" list are both built from.
    # Single-letter language names (C, R) are deliberately excluded: the
    # false-positive rate on ordinary prose is far worse than missing them.
    "kafka": ["kafka", "apache kafka"],
    "rabbitmq": ["rabbitmq"],
    "redis": ["redis"],
    "elasticsearch": ["elasticsearch", "elastic search", "opensearch"],
    "grpc": ["grpc"],
    "websockets": ["websockets", "websocket"],
    "rust": ["rust"],
    "scala": ["scala"],
    "kotlin": ["kotlin"],
    "swift": ["swift", "swiftui"],
    "objective-c": ["objective-c", "objective c"],
    "php": ["php"],
    "ruby": ["ruby"],
    "ruby on rails": ["ruby on rails", "rails"],
    "laravel": ["laravel"],
    "express": ["express.js", "expressjs", "express"],
    "svelte": ["svelte", "sveltekit"],
    ".net": [".net", "dotnet", "asp.net"],
    "spark": ["spark", "apache spark", "pyspark"],
    "hadoop": ["hadoop"],
    "airflow": ["airflow", "apache airflow"],
    "dbt": ["dbt"],
    "snowflake": ["snowflake"],
    "databricks": ["databricks"],
    "bigquery": ["bigquery", "big query"],
    "redshift": ["redshift"],
    "looker": ["looker"],
    "jenkins": ["jenkins"],
    "github actions": ["github actions"],
    "gitlab ci": ["gitlab ci", "gitlab-ci"],
    "ansible": ["ansible"],
    "prometheus": ["prometheus"],
    "grafana": ["grafana"],
    "observability": ["observability"],
    "unit testing": ["unit testing", "unit tests"],
    "test automation": ["test automation", "automated testing"],
    "playwright": ["playwright"],
    "cypress": ["cypress"],
    "selenium": ["selenium"],
    "accessibility": ["accessibility", "wcag", "a11y"],
    "ux design": ["ux design", "user experience design", "ux"],
    "ui design": ["ui design", "user interface design"],
    "user research": ["user research", "usability testing"],
    "adobe photoshop": ["photoshop", "adobe photoshop"],
    "adobe illustrator": ["illustrator", "adobe illustrator"],
    "sketch": ["sketch"],
    "content marketing": ["content marketing"],
    "copywriting": ["copywriting", "copy writing"],
    "email marketing": ["email marketing"],
    "social media marketing": ["social media marketing", "social media management"],
    "hubspot": ["hubspot"],
    "google ads": ["google ads", "adwords", "google adwords"],
    "crm": ["crm"],
    "financial modeling": ["financial modeling", "financial modelling"],
    "forecasting": ["forecasting"],
    "budgeting": ["budgeting"],
    "accounting": ["accounting"],
    "quickbooks": ["quickbooks"],
    "xero": ["xero"],
    "risk management": ["risk management"],
    "compliance": ["compliance"],
    "gdpr": ["gdpr"],
    "supply chain": ["supply chain"],
    "logistics": ["logistics"],
    "lean": ["lean", "lean manufacturing"],
    "six sigma": ["six sigma"],
    "kanban": ["kanban"],
    "confluence": ["confluence"],
    "notion": ["notion"],
    "asana": ["asana"],
    "roadmapping": ["roadmapping", "roadmap"],
    "stakeholder management": ["stakeholder management"],
    "technical writing": ["technical writing"],
    "matlab": ["matlab"],
    "sas": ["sas"],
    "stata": ["stata"],
    "spss": ["spss"],
    "etl": ["etl", "elt"],
    "data modeling": ["data modeling", "data modelling"],
    "data visualization": ["data visualization", "data visualisation"],
    "computer vision": ["computer vision"],
    "llm": ["llm", "large language model", "large language models"],
    "prompt engineering": ["prompt engineering"],
}

SOFT_SKILL_TERMS = set("""
leadership communication teamwork collaboration adaptability creativity
mentoring mentorship stakeholder stakeholders presentation negotiation
ownership initiative organization organizational proactive interpersonal
empathy coaching
""".split())

SENIORITY_TERMS = ["intern", "junior", "associate", "mid", "senior", "staff",
                    "principal", "lead", "manager", "director", "head", "vp",
                    "chief"]

REQUIREMENT_SECTION_HEADERS = re.compile(
    r"(requirements?|qualifications?|must[\s-]?have|what you.?ll need|"
    r"minimum qualifications|you have|about you|skills? (required|needed))",
    re.IGNORECASE,
)
SKILLS_SECTION_HEADERS = re.compile(
    r"(technical skills?|skills?( and| &)? (tools|technologies)?|"
    r"core competencies|proficienc(y|ies)|tech stack)",
    re.IGNORECASE,
)


def _normalize(text: str) -> str:
    return (text or "").lower()


def _canonical_for_alias(alias: str):
    for canonical, aliases in HARD_SKILL_ALIASES.items():
        if alias in aliases:
            return canonical
    return None


def extract_phrases(text: str) -> Counter:
    """Return a Counter of canonical hard-skill phrases found in text,
    matching multi-word aliases first, then falling back to unigrams for
    anything not in the lexicon (so novel/unusual terms still count)."""
    norm = _normalize(text)
    counts = Counter()

    # 1) multi-word alias phrases (so "react native" is consumed before the
    #    leftover "react" unigram pass double-counts it)
    all_aliases = sorted(
        ((alias, canonical) for canonical, aliases in HARD_SKILL_ALIASES.items() for alias in aliases),
        key=lambda pair: -len(pair[0]),
    )
    consumed_spans = []
    for alias, canonical in all_aliases:
        if " " not in alias and "/" not in alias and "." not in alias:
            continue  # handled by unigram pass below
        pattern = re.escape(alias)
        for m in re.finditer(rf"(?<![a-z0-9]){pattern}(?![a-z0-9])", norm):
            counts[canonical] += 1
            consumed_spans.append(m.span())

    if consumed_spans:
        chars = list(norm)
        for start, end in consumed_spans:
            for i in range(start, end):
                chars[i] = " "
        norm = "".join(chars)

    # 2) unigram pass over remaining text
    raw = re.findall(r"[a-z][a-z0-9+#./-]{1,}", norm)
    for tok in raw:
        tok = tok.strip(".-/")
        if not tok or tok in STOPWORDS or len(tok) <= 1:
            continue
        canonical = _canonical_for_alias(tok)
        counts[canonical or tok] += 1

    return counts


def tokenize(text: str) -> list:
    """Plain unigram tokenizer for the cosine-similarity signal (broader
    topical overlap, not just lexicon-matched skills)."""
    if not text:
        return []
    raw = re.findall(r"[a-zA-Z][a-zA-Z0-9+#./-]{1,}", text.lower())
    return [t.strip(".-/") for t in raw if t.strip(".-/") and t not in STOPWORDS and len(t) > 1]


def term_frequencies(text: str) -> Counter:
    return Counter(tokenize(text))


def cosine_similarity(a: Counter, b: Counter) -> float:
    if not a or not b:
        return 0.0
    common = set(a) & set(b)
    dot = sum(a[t] * b[t] for t in common)
    mag_a = math.sqrt(sum(v * v for v in a.values()))
    mag_b = math.sqrt(sum(v * v for v in b.values()))
    if mag_a == 0 or mag_b == 0:
        return 0.0
    return dot / (mag_a * mag_b)


def _split_sections(text: str) -> list:
    return [p for p in re.split(r"\n\s*\n|\r\n\r\n", text or "") if p.strip()]


def _term_weight_in_jd(term: str, jd_sections: list) -> float:
    weight = 1.0
    for section in jd_sections:
        if REQUIREMENT_SECTION_HEADERS.search(section[:120]) and re.search(
            rf"(?<![a-z0-9]){re.escape(term)}(?![a-z0-9])", section.lower()
        ):
            weight = 1.6
            break
    return weight


def _resume_has_term_in_skills_section(term: str, resume_sections: list) -> bool:
    for section in resume_sections:
        if SKILLS_SECTION_HEADERS.search(section[:120]) and re.search(
            rf"(?<![a-z0-9]){re.escape(term)}(?![a-z0-9])", section.lower()
        ):
            return True
    return False


def _detect_seniority(text: str) -> set:
    norm = _normalize(text)
    found = set()
    for term in SENIORITY_TERMS:
        if re.search(rf"(?<![a-z]){re.escape(term)}(?![a-z])", norm):
            found.add(term)
    return found


def score_resume_against_job(resume_text: str, job_description: str, top_n: int = 30) -> dict:
    """Cached wrapper around the scorer.

    Scoring is pure: the same résumé text and the same job description always
    produce the same breakdown. It is also the most-repeated expensive call in
    the app — the jobs list scores every application, and re-scores them all on
    every visit, over text that rarely changes between visits.

    The key is a hash of both inputs, so a single edited character is a
    different key and there is nothing to invalidate: a changed input simply
    can't hit a stale entry.
    """
    if not resume_text and not job_description:
        return _score_resume_against_job(resume_text, job_description, top_n)
    key = make_key("ats", resume_text, job_description, top_n)
    hit = get_json(key)
    if hit is not None:
        return hit
    result = _score_resume_against_job(resume_text, job_description, top_n)
    set_json(key, result, TTL_ATS)
    return result


def _score_resume_against_job(resume_text: str, job_description: str, top_n: int = 30) -> dict:
    """Returns a score breakdown dict. Score is 0-100.

    Backward-compatible keys (score, keyword_coverage_percent,
    term_similarity_percent, matched_keywords, missing_keywords) are always
    present; extra keys add the richer v2 breakdown without breaking any
    existing caller.
    """
    if not job_description or not job_description.strip():
        return {
            "score": 0, "keyword_coverage_percent": 0.0, "term_similarity_percent": 0.0,
            "matched_keywords": [], "missing_keywords": [],
            "matched_hard_skills": [], "missing_hard_skills": [],
            "matched_soft_skills": [], "title_seniority_match": None,
            "recommendations": ["Paste a job description to get a match score."],
        }

    jd_phrases = extract_phrases(job_description)
    resume_phrases = extract_phrases(resume_text)
    jd_sections = _split_sections(job_description)
    resume_sections = _split_sections(resume_text)

    seniority_set = set(SENIORITY_TERMS)
    hard_terms = {t: c for t, c in jd_phrases.items() if t in HARD_SKILL_ALIASES}
    other_terms = {t: c for t, c in jd_phrases.items()
                   if t not in HARD_SKILL_ALIASES and t not in SOFT_SKILL_TERMS and t not in seniority_set}
    soft_terms = {t: c for t, c in jd_phrases.items() if t in SOFT_SKILL_TERMS}

    ranked_hard = sorted(hard_terms.items(), key=lambda kv: -kv[1])
    ranked_other = sorted(other_terms.items(), key=lambda kv: -kv[1])
    keyword_pool = [t for t, _ in ranked_hard] + [t for t, _ in ranked_other]
    top_keywords = keyword_pool[:top_n] if keyword_pool else []

    matched, missing = [], []
    weighted_hit, weighted_total = 0.0, 0.0
    for term in top_keywords:
        w = _term_weight_in_jd(term, jd_sections)
        weighted_total += w
        hit = term in resume_phrases
        if hit and _resume_has_term_in_skills_section(term, resume_sections):
            w *= 1.15  # bonus: recruiters trust a listed skill more than an incidental mention
        if hit:
            matched.append(term)
            weighted_hit += w
        else:
            missing.append(term)

    coverage_pct = (weighted_hit / weighted_total * 100) if weighted_total else 0.0

    jd_freq = term_frequencies(job_description)
    resume_freq = term_frequencies(resume_text)
    similarity_pct = cosine_similarity(jd_freq, resume_freq) * 100

    jd_seniority = _detect_seniority(job_description)
    resume_seniority = _detect_seniority(resume_text)
    if jd_seniority:
        title_match = bool(jd_seniority & resume_seniority)
        title_bonus = 5 if title_match else -5
    else:
        title_match = None
        title_bonus = 0

    resume_tokens_set = set(tokenize(resume_text))
    matched_soft = sorted(t for t in soft_terms if t in resume_tokens_set)

    final_score = coverage_pct * 0.7 + similarity_pct * 0.3 + title_bonus
    final_score = round(max(0, min(100, final_score)))

    recommendations = []
    if missing[:5]:
        recommendations.append(
            "Consider adding these in-demand terms (if genuinely applicable): " + ", ".join(missing[:5])
        )
    if coverage_pct < 50:
        recommendations.append("Keyword coverage is low — mirror the job description's exact terminology where truthful.")
    if title_match is False:
        recommendations.append(
            f"The job description skews toward '{', '.join(sorted(jd_seniority))}' level — "
            "make sure your title/summary signals the right seniority."
        )
    matched_in_skills_section = any(_resume_has_term_in_skills_section(t, resume_sections) for t in matched)
    if matched and not matched_in_skills_section:
        recommendations.append("Add a dedicated Skills section listing your matching keywords explicitly — ATS filters weigh it heavily.")
    if not recommendations:
        recommendations.append("Strong match — this resume already mirrors the job description well.")

    return {
        # backward-compatible keys
        "score": final_score,
        "keyword_coverage_percent": round(coverage_pct, 1),
        "term_similarity_percent": round(similarity_pct, 1),
        "matched_keywords": matched,
        "missing_keywords": missing,
        # richer v2 breakdown
        "matched_hard_skills": [t for t in matched if t in HARD_SKILL_ALIASES],
        "missing_hard_skills": [t for t in missing if t in HARD_SKILL_ALIASES],
        "matched_soft_skills": matched_soft,
        "title_seniority_match": title_match,
        "recommendations": recommendations,
    }
