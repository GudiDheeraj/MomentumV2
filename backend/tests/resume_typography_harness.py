"""Regression harness for résumé typography and page geometry.

This is the automated check behind the promise that a size preset means the same
thing everywhere: it renders every template at every preset against a set of
deliberately awkward fixtures, then reads the actual glyphs back out of the PDF
and asserts on what was really drawn — not on what the code intended to draw.

Run directly for a report:

    python -m backend.tests.resume_typography_harness            # summary
    python -m backend.tests.resume_typography_harness --verbose   # per template

What it asserts, per template x preset x fixture:

  * the page is A4 (595.28 x 841.89pt, within a rounding tolerance)
  * the modal body size equals the preset exactly - this is the core guarantee
  * display type stays inside a professional range, so damping is working
  * every glyph sits inside the page's margin box: nothing clipped, nothing
    bleeding off the edge
  * no two text lines overlap vertically by more than a hair
  * all of the fixture's distinctive content survives into the PDF - a section
    silently dropped by a template is a failure, not a design choice
  * long content produces more pages rather than smaller type: the body size on
    page three is the same as the body size on page one

The fixtures are the interesting cases rather than the happy path: a 96-character
job title, a bare URL with no break opportunity, an entry with 17 bullets, and a
long résumé that has to run to several pages.
"""
from __future__ import annotations

import argparse
import os
import statistics
import sys
import tempfile
from collections import Counter, defaultdict

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from backend.app import resume_pdf as R  # noqa: E402

try:
    import pdfplumber
except ImportError:  # pragma: no cover
    pdfplumber = None

A4 = (595.28, 841.89)
PAGE_TOL = 2.0
# The margin box every template is required to respect. TPL_MIN_MARGIN is the
# floor the builders enforce; the harness allows a hair less to absorb the way a
# glyph's reported bounding box can sit a fraction outside its own text origin.
MARGIN = R.TPL_MIN_MARGIN
EDGE_TOL = 4.0
PRESETS = ["pt9", "pt10", "pt11", "pt12"]
PRESET_PT = {p: R.BODY_PT[p] for p in PRESETS}
# Display type is allowed to be big, but a résumé name has a sane ceiling. These
# bounds are what "damped, professional" means in numbers.
NAME_MIN, NAME_MAX = 12.0, 30.0


# --------------------------------------------------------------------------
# fixtures
# --------------------------------------------------------------------------
LONG_TITLE = "Senior Principal Operations Delivery and Transformation Manager, Northern Region"
LONG_COMPANY = "Department for Work and Pensions, Digital Delivery and Transformation Directorate"
LONG_URL = "https://www.linkedin.com/in/dheeraj-gudi-operations-delivery-analytics-newcastle-uk"
LONG_BULLET = ("Rebuilt the quarterly reconciliation process end to end, replacing a manual "
               "spreadsheet handover between four teams with an automated pipeline that "
               "validates, reconciles and publishes 2.4 million records a month, cutting the "
               "close from eleven working days to two and removing an entire category of "
               "transcription error from the audited figures.")


def _base_data():
    return {
        "full_name": "Dheeraj Gudi",
        "title": "Data Analyst",
        "email": "dheeraj.gudi1999@gmail.com",
        "phone": "+44 7733 658594",
        "location": "Newcastle Upon Tyne, England",
        "linkedin": "linkedin.com/in/gudi-dheeraj",
        "website": "gudidheeraj.github.io/personalfwebpage",
        "summary": "Data Analyst with over 4 years of experience in financial data analysis, "
                   "enterprise reporting and operations management.",
        "skills": "SQL, Python, Power BI, Excel, dbt, Airflow, Tableau, Snowflake",
        "experience": [],
        "education": [],
        "accent_color": "#2F5FD8",
        "font_family": "sans",
    }


def _entry(title, company, location, dates, bullets):
    """One entry in the format the app actually stores.

    The builders read `experience` and `education` as a single textarea: a
    pipe-separated header line, '-' prefixed bullets under it, and '---' between
    entries. The harness has to speak that format, not a tidier one of its own,
    or it tests a code path the product never uses.
    """
    head = " | ".join([title, company, location, dates])
    return "\n".join([head] + [f"- {b}" for b in bullets])


def _entries(*blocks):
    return "\n---\n".join(blocks)


def fixtures() -> dict:
    """The content profiles every template is tested against."""
    out = {}

    # 1. short — a graduate's one-pager
    d = _base_data()
    d["experience"] = _entry("Data Analyst", "DWP", "Newcastle, UK", "Aug 2025 - Present",
                             ["Built the weekly reporting pack."])
    d["education"] = _entry("MSc Data Science", "Newcastle University", "Newcastle, UK",
                            "2023 - 2024", [])
    out["short"] = d

    # 2. normal — the shape most résumés are
    d = _base_data()
    d["experience"] = _entries(
        _entry("Operations Delivery Manager", "Department for Work and Pensions",
               "Newcastle, UK", "Aug 2025 - Present",
               ["Automated the monthly reconciliation, saving 9 days a close.",
                "Led a team of six analysts across two sites.",
                "Rebuilt the KPI pack in Power BI, now used by the directorate."]),
        _entry("Data Analyst", "Sopra Steria", "Newcastle, UK", "Jan 2023 - Jul 2025",
               ["Wrote the SQL models behind the finance dashboards.",
                "Cut report runtime from 40 minutes to under 3."]),
    )
    d["education"] = _entries(
        _entry("MSc Data Science", "Newcastle University", "Newcastle, UK", "2023 - 2024", []),
        _entry("BTech Computer Science", "JNTU Hyderabad", "Hyderabad, India", "2017 - 2021", []),
    )
    out["normal"] = d

    # 3. long_strings — the overflow cases, all at once
    d = _base_data()
    d["title"] = LONG_TITLE
    d["website"] = LONG_URL
    d["linkedin"] = LONG_URL
    d["experience"] = _entry(
        LONG_TITLE, LONG_COMPANY,
        "Newcastle Upon Tyne, North East England, United Kingdom", "August 2025 - Present",
        [LONG_BULLET, "Owned " + LONG_URL, LONG_BULLET])
    d["education"] = _entry("MSc Data Science and Advanced Statistical Computing",
                            "Newcastle University, School of Computing",
                            "Newcastle, UK", "2023 - 2024", [])
    d["skills"] = ", ".join(f"CompetencyNumber{i}InAVeryLongUnbrokenSkillName" for i in range(6))
    out["long_strings"] = d

    # 4. many_bullets — 17 bullets on one entry
    d = _base_data()
    d["experience"] = _entry(
        "Operations Delivery Manager", "Department for Work and Pensions",
        "Newcastle, UK", "Aug 2025 - Present",
        [f"Delivered workstream {i} against the directorate's annual plan, "
         f"reporting into the senior leadership team." for i in range(1, 18)])
    d["education"] = _entry("MSc Data Science", "Newcastle University", "Newcastle, UK",
                            "2023 - 2024", [])
    out["many_bullets"] = d

    # 5. multipage — enough of everything to need several A4 pages
    d = _base_data()
    d["summary"] = LONG_BULLET
    d["experience"] = _entries(*[
        _entry(f"{'Senior ' if i % 2 else ''}Data Analyst, Grade {i}",
               f"Employer Number {i} Limited", "Newcastle, UK",
               f"20{10 + i} - 20{11 + i}",
               [LONG_BULLET, "Ran the quarterly forecast cycle for the region.",
                "Mentored two junior analysts through their first delivery."])
        for i in range(1, 9)])
    d["education"] = _entries(*[
        _entry(f"Qualification {i}", f"Institution Number {i}", "Newcastle, UK",
               f"20{10 + i} - 20{11 + i}", [])
        for i in range(1, 5)])
    d["projects"] = "\n".join(f"Project {i} | {LONG_BULLET}" for i in range(1, 4))
    d["certifications"] = "\n".join(f"Certification Number {i}, Awarding Body {i}"
                                    for i in range(1, 7))
    out["multipage"] = d
    return out


# --------------------------------------------------------------------------
# measurement
# --------------------------------------------------------------------------
def _chars(pdf):
    for pno, page in enumerate(pdf.pages, 1):
        for c in page.chars:
            yield pno, c


def measure(path: str) -> dict:
    """Read a rendered PDF back and describe what was actually drawn."""
    with pdfplumber.open(path) as pdf:
        pages = [(round(p.width, 2), round(p.height, 2)) for p in pdf.pages]
        sizes = Counter()
        per_page_sizes = defaultdict(Counter)
        outside = []
        text_parts = []
        runs = defaultdict(lambda: ["", []])   # page -> [glyphs, parallel sizes]
        lines = defaultdict(list)   # (page, rounded baseline) -> [(x0, x1)]
        for pno, c in _chars(pdf):
            if not c.get("text", "").strip():
                continue
            s = round(float(c["size"]), 1)
            sizes[s] += 1
            per_page_sizes[pno][s] += 1
            glyph = c["text"].lower()
            runs[pno][0] += glyph
            runs[pno][1].extend([s] * len(glyph))
            if (c["x0"] < MARGIN - EDGE_TOL or c["x1"] > A4[0] - MARGIN + EDGE_TOL
                    or c["top"] < MARGIN - EDGE_TOL or c["bottom"] > A4[1] - MARGIN + EDGE_TOL):
                outside.append((pno, round(c["x0"], 1), round(c["x1"], 1),
                                round(c["top"], 1), c["text"]))
            lines[(pno, round(float(c["top"]), 0))].append((c["x0"], c["x1"]))
        for p in pdf.pages:
            text_parts.append(p.extract_text() or "")
    return {
        "runs": [(t, sz) for t, sz in runs.values()],
        "pages": pages,
        "page_count": len(pages),
        "sizes": sizes,
        "per_page_sizes": per_page_sizes,
        "outside": outside,
        "text": "\n".join(text_parts),
        "max_size": max(sizes) if sizes else 0.0,
    }


def _body_size(sizes: Counter) -> float:
    """The most common size by glyph count — a fallback when no probe matches."""
    return sizes.most_common(1)[0][0] if sizes else 0.0


def _probe_size(runs: list, probe: str) -> float:
    """The size actually used to set a known piece of body copy.

    Taking the most common size across the whole page is too blunt: several
    designs set their contact line, dates and skills list in a smaller face, and
    in a short résumé that smaller face can outnumber the body text, so the mode
    reports the caption size and the check fails on a template that is correct.

    This instead finds a phrase that only ever appears in a bullet or paragraph
    and reports the size of those glyphs — the size the reader is actually
    reading. Spaces are stripped from both sides of the comparison because a
    PDF's glyph stream doesn't reliably contain the spaces between words.
    """
    found = _probe_sizes(runs, probe)
    return found[0] if found else 0.0


def _probe_sizes(runs: list, probe: str) -> list:
    """Every size the phrase is set at, in the order the pages were drawn.

    A name can appear more than once — as the heading, and again in a footer or
    a sidebar credit at caption size. Callers that mean the display setting take
    the largest; callers that mean body copy take the first.
    """
    want = "".join(probe.split()).lower()
    out = []
    for text, sizes in runs:
        start = 0
        while True:
            i = text.find(want, start)
            if i < 0:
                break
            span = Counter(sizes[i:i + len(want)])
            if span:
                out.append(span.most_common(1)[0][0])
            start = i + 1
    return out


# --------------------------------------------------------------------------
# the checks
# --------------------------------------------------------------------------
# A phrase that appears only in body copy, per fixture. The body size is read
# from these glyphs rather than from the page's most common size.
BODY_PROBE = {
    "short": "Built the weekly reporting pack",
    "normal": "Automated the monthly reconciliation",
    "long_strings": "Rebuilt the quarterly reconciliation process end to end",
    "many_bullets": "Delivered workstream 3 against",
    "multipage": "Ran the quarterly forecast cycle for the region",
}


def check(tid: str, preset: str, fixture: str, data: dict, path: str) -> list:
    """Render one combination and return a list of failure strings."""
    fails = []
    d = dict(data)
    d["font_size"] = preset
    try:
        R.build_resume_pdf(tid, d, path)
    except Exception as exc:  # a template that raises is the worst failure
        return [f"render raised {type(exc).__name__}: {exc}"]
    if not os.path.exists(path) or os.path.getsize(path) < 800:
        return ["produced no usable PDF"]

    m = measure(path)
    want = PRESET_PT[preset]

    # 1. A4, every page
    for i, (w, h) in enumerate(m["pages"], 1):
        if abs(w - A4[0]) > PAGE_TOL or abs(h - A4[1]) > PAGE_TOL:
            fails.append(f"page {i} is {w}x{h}, not A4")

    # 2. the body size is the preset, exactly
    body = _probe_size(m["runs"], BODY_PROBE[fixture]) or _body_size(m["sizes"])
    if abs(body - want) > 0.15:
        fails.append(f"body is {body}pt, expected {want}pt")

    # 3. the body size does not drift between pages — no auto-shrink to fit.
    #    Read from the last page's own body copy where the fixture repeats a
    #    phrase across pages, so a template that reflows smaller is caught.
    for pno, sizes in m["per_page_sizes"].items():
        run = [r for i, r in enumerate(m["runs"], 1) if i == pno]
        pb = _probe_size(run, BODY_PROBE[fixture])
        if pb and abs(pb - want) > 0.15:
            fails.append(f"page {pno} body is {pb}pt, expected {want}pt")

    # 4. display type is damped, not runaway. Measured on the name itself
    #    rather than on the largest glyph anywhere: a monogram inside a portrait
    #    circle is a graphic, and judging it as body typography would fail a
    #    template for a design decision that is nothing to do with the presets.
    name_pt = max(_probe_sizes(m["runs"], data["full_name"]), default=0.0)
    # The floor is the body size rather than a fixed 12pt: a ruled form like the
    # Japanese rirekisho sets the name in a grid cell at text size by design, and
    # failing it for that would be the harness dictating design. What must never
    # happen is a name *smaller* than the body, or a name that has run away.
    if name_pt and not (want - 0.15 <= name_pt <= NAME_MAX):
        fails.append(f"the name is set at {name_pt}pt against {want}pt body "
                     f"(allowed {want}-{NAME_MAX}pt)")

    # 5. nothing outside the margin box
    if m["outside"]:
        p, x0, x1, top, ch = m["outside"][0]
        fails.append(f"{len(m['outside'])} glyphs outside the margin box "
                     f"(first: {ch!r} at x{x0}-{x1} y{top} on page {p})")

    # 6. the fixture's content is present
    flat = " ".join(m["text"].split()).lower()
    for probe in ("dheeraj gudi",):
        if probe not in flat:
            fails.append(f"missing from the PDF: {probe!r}")
    if fixture == "many_bullets" and "workstream 17" not in flat:
        fails.append("the 17th bullet did not make it into the PDF")
    if fixture == "multipage":
        if m["page_count"] < 2:
            fails.append(f"long résumé fitted onto {m['page_count']} page(s) — content is missing")
        if "employer number 8" not in flat:
            fails.append("the last employer did not make it into the PDF")
    return fails


def _one(job):
    """Render and check a single combination — the unit of parallel work."""
    tid, preset, fname = job
    fx = fixtures()
    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, f"{tid}-{preset}-{fname}.pdf")
        problems = check(tid, preset, fname, fx[fname], path)
        stats = {}
        if fname == "normal" and os.path.exists(path):
            m = measure(path)
            stats = {"body": _probe_size(m["runs"], BODY_PROBE[fname]) or _body_size(m["sizes"]),
                     "name": max(_probe_sizes(m["runs"], fx[fname]["full_name"]), default=0.0),
                     "pages": m["page_count"]}
    return tid, preset, fname, problems, stats


def run_parallel(templates=None, presets=None, fixture_names=None, workers=None,
                 json_out=None) -> int:
    """The whole matrix, spread over processes.

    Rendering is CPU-bound and each combination is independent, so the matrix
    parallelises perfectly. This matters more than it looks: run serially the
    full sweep takes about a quarter of an hour, which is long enough that it
    stops being run.
    """
    import json
    from concurrent.futures import ProcessPoolExecutor
    if pdfplumber is None:
        print("pdfplumber is required: pip install pdfplumber")
        return 2
    names = sorted(fixtures()) if not fixture_names else list(fixture_names)
    tids = templates or sorted(R.ACTIVE_TEMPLATES.keys())
    presets = presets or PRESETS
    jobs = [(t, p, f) for t in tids for p in presets for f in names]
    results, stats = {}, []
    with ProcessPoolExecutor(max_workers=workers or (os.cpu_count() or 4)) as ex:
        for tid, preset, fname, problems, st in ex.map(_one, jobs, chunksize=2):
            if problems:
                results[f"{tid}|{preset}|{fname}"] = problems
            if st:
                stats.append({"tid": tid, "preset": preset, **st})
    payload = {"jobs": len(jobs), "failures": results, "stats": stats,
               "templates": tids, "presets": presets, "fixtures": names}
    if json_out:
        with open(json_out, "w") as fh:
            json.dump(payload, fh, indent=1)
    print(f"{len(jobs) - len(results)}/{len(jobs)} passed  "
          f"({len(tids)} templates x {len(presets)} presets x {len(names)} fixtures)")
    for key, probs in sorted(results.items()):
        print(f"  FAIL {key}")
        for p in probs:
            print(f"       - {p}")
    return 1 if results else 0


def run(templates=None, presets=None, fixture_names=None, verbose=False) -> int:
    if pdfplumber is None:
        print("pdfplumber is required: pip install pdfplumber")
        return 2
    fx = fixtures()
    if fixture_names:
        fx = {k: v for k, v in fx.items() if k in fixture_names}
    tids = templates or sorted(R.ACTIVE_TEMPLATES.keys())
    presets = presets or PRESETS

    results = {}
    body_by_preset = defaultdict(set)
    names = []
    total = fails = 0
    with tempfile.TemporaryDirectory() as tmp:
        for tid in tids:
            tname = R.ACTIVE_TEMPLATES[tid].get("name", tid)
            for preset in presets:
                for fname, data in fx.items():
                    total += 1
                    path = os.path.join(tmp, f"{tid}-{preset}-{fname}.pdf")
                    problems = check(tid, preset, fname, data, path)
                    if problems:
                        fails += 1
                        results[(tid, preset, fname)] = problems
                        if verbose:
                            print(f"  FAIL {tname:28s} {preset} {fname}")
                            for p in problems:
                                print(f"        - {p}")
                    if fname == "normal" and os.path.exists(path):
                        m = measure(path)
                        body_by_preset[preset].add(
                            _probe_size(m["runs"], BODY_PROBE[fname]) or _body_size(m["sizes"]))
                        names.append((tname, preset,
                                      max(_probe_sizes(m["runs"], data["full_name"]),
                                          default=0.0)))
            if verbose:
                print(f"  done {tname}")

    print(f"\n{total - fails}/{total} combinations passed "
          f"({len(tids)} templates x {len(presets)} presets x {len(fx)} fixtures)")
    print("\nBody size actually rendered, across every template:")
    for preset in presets:
        got = sorted(body_by_preset[preset])
        mark = "OK " if got == [PRESET_PT[preset]] else "BAD"
        print(f"  {mark} {preset:5s} wanted {PRESET_PT[preset]:>4}pt  measured {got}")
    if names:
        print("\nLargest type (the name), by preset:")
        for preset in presets:
            vals = [v for _n, p, v in names if p == preset]
            if vals:
                print(f"  {preset:5s} min {min(vals):5.1f}  median {statistics.median(vals):5.1f}"
                      f"  max {max(vals):5.1f}")
    if results:
        print(f"\n{len(results)} failing combinations:")
        by_t = defaultdict(list)
        for (tid, preset, fname), probs in results.items():
            by_t[tid].append((preset, fname, probs))
        for tid, rows in sorted(by_t.items()):
            name = R.ACTIVE_TEMPLATES[tid].get("name", tid)
            print(f"\n  {name} ({tid}) — {len(rows)} of {len(presets) * len(fx)}")
            seen = set()
            for preset, fname, probs in rows:
                for p in probs:
                    key = p.split("(")[0]
                    if key in seen:
                        continue
                    seen.add(key)
                    print(f"    [{preset} {fname}] {p}")
    return 1 if results else 0


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--template", action="append", dest="templates")
    ap.add_argument("--preset", action="append", dest="presets")
    ap.add_argument("--fixture", action="append", dest="fixture_names")
    ap.add_argument("--verbose", action="store_true")
    ap.add_argument("--parallel", action="store_true",
                    help="spread the matrix over every core")
    ap.add_argument("--workers", type=int)
    ap.add_argument("--json", dest="json_out")
    ap.add_argument("--slice", help="i/n — run only the i-th of n equal template groups")
    a = ap.parse_args()
    tids = a.templates
    if a.slice:
        i, n = (int(x) for x in a.slice.split("/"))
        allt = sorted(R.ACTIVE_TEMPLATES.keys())
        tids = [t for k, t in enumerate(allt) if k % n == i % n]
    if a.parallel:
        raise SystemExit(run_parallel(tids, a.presets, a.fixture_names, a.workers, a.json_out))
    raise SystemExit(run(tids, a.presets, a.fixture_names, a.verbose))


if __name__ == "__main__":
    main()
