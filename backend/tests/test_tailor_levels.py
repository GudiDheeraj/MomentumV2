"""Regression tests for the three tailoring strengths.

Each of these is a bug that reached the user's résumé:
  - Projects went from three entries to one (532 chars -> 178) because the
    shared entry parser drops any line that is not a bullet.
  - "AWS (Redshift, S3, Glue)" was split on its inner commas and reordered
    into fragments.
  - The match percentage went DOWN after tailoring, at the level that promises
    to change nothing.

Run from anywhere:  python3 backend/tests/test_tailor_levels.py
"""
import json, pathlib, sys
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from app.ai import tailor_levels as tl
from app.ats_scorer import score_resume_against_job

# Anchored on this file, not on the shell's working directory — the other three
# suites can be run from the repository root and this one could not.
HERE = pathlib.Path(__file__).parent
RESUME = json.loads((HERE / "fixtures" / "resume.json").read_text())
JD_ENGINEER = (HERE / "fixtures" / "jd_data_engineer.txt").read_text()
JD_ANALYST = """We are hiring a Senior Data Analyst to join our analytics team.
You will write complex SQL, build Power BI dashboards with DAX, and automate reporting pipelines in Python.
You will work with AWS Redshift and S3, and partner with stakeholders across finance.
Requirements: strong SQL, Python, Power BI and DAX; cloud data platforms; stakeholder communication; Tableau a plus."""
JD_UNRELATED = """We are hiring a Pastry Chef for our bakery. You will prepare laminated doughs,
manage the morning bake, and train junior bakers. Requirements: patisserie experience, food hygiene certification."""

failures = 0
def check(label, ok, detail=""):
    global failures
    if not ok: failures += 1
    print(f"  {'PASS' if ok else 'FAIL'}  {label}{'' if ok else '  — ' + str(detail)}")

def apply_all(data, jd, level):
    d = dict(data)
    r = tl.propose(d, jd, level, use_llm=False)
    for sec in r["sections"]:
        d[sec["field"]] = sec["after"]
    return d, r

print("\n== the match never goes down ==")
for jd_name, jd in (("data engineer ad", JD_ENGINEER), ("data analyst ad", JD_ANALYST), ("unrelated ad", JD_UNRELATED)):
    base = score_resume_against_job(tl.resume_text(RESUME), jd)["score"]
    for level in tl.LEVELS:
        after_data, r = apply_all(RESUME, jd, level)
        after = score_resume_against_job(tl.resume_text(after_data), jd)["score"]
        check(f"{jd_name} / {level}: {base} -> {after}", after >= base)
        check(f"{jd_name} / {level}: projected matches reality", r["match"]["projected"] == after,
              f"projected {r['match']['projected']}, actual {after}")

print("\n== no content is lost ==")
for level in tl.LEVELS:
    after_data, _ = apply_all(RESUME, JD_ENGINEER, level)
    for field in ("projects", "experience", "education", "publications", "certifications"):
        before_lines = {l.strip() for l in (RESUME.get(field) or "").split("\n") if l.strip() and l.strip() != "---"}
        after_lines = {l.strip() for l in (after_data.get(field) or "").split("\n") if l.strip() and l.strip() != "---"}
        if level == "aggressive" and field in ("experience", "projects"):
            # Aggressive may trim, but only lines whose keywords survive elsewhere.
            check(f"{level}/{field}: nothing invented", after_lines <= before_lines,
                  after_lines - before_lines)
        else:
            check(f"{level}/{field}: every line survives", after_lines == before_lines,
                  f"lost {before_lines - after_lines}, added {after_lines - before_lines}")

print("\n== the three-project Projects section (the reported bug) ==")
for level in tl.LEVELS:
    after_data, _ = apply_all(RESUME, JD_ENGINEER, level)
    n_before = len([l for l in RESUME["projects"].split("\n") if l.strip()])
    n_after = len([l for l in after_data["projects"].split("\n") if l.strip()])
    check(f"{level}: all {n_before} projects still there", n_after == n_before, f"only {n_after} left")

print("\n== bracketed skills are never split ==")
check("splitter keeps brackets together",
      tl._split_items("AWS (Redshift, S3, Glue), Google Cloud Platform") ==
      ["AWS (Redshift, S3, Glue)", "Google Cloud Platform"])
for level in tl.LEVELS:
    after_data, _ = apply_all(RESUME, JD_ANALYST, level)
    check(f"{level}: AWS group intact", "AWS (Redshift, S3, Glue)" in after_data["skills"],
          after_data["skills"])

print("\n== 'Regular' really does only reorder ==")
after_data, _ = apply_all(RESUME, JD_ANALYST, "regular")
for field in ("summary", "skills", "experience", "projects"):
    before_words = sorted((RESUME.get(field) or "").split())
    after_words = sorted((after_data.get(field) or "").split())
    check(f"regular/{field}: same words, different order", before_words == after_words,
          f"delta {set(after_words) ^ set(before_words)}")

print("\n== a field it cannot rebuild is left alone ==")
odd = dict(RESUME)
odd["projects"] = "Project A\n\n  weird   indentation\n\t- tabbed bullet\n---\nProject B"
check("odd formatting still round-trips", tl._roundtrips(odd["projects"]))
after_odd, _ = apply_all(odd, JD_ANALYST, "aggressive")
check("odd field is preserved exactly or reordered losslessly",
      {l.strip() for l in after_odd["projects"].split("\n") if l.strip()} ==
      {l.strip() for l in odd["projects"].split("\n") if l.strip()})

print("\n== an empty or tiny résumé does not explode ==")
for data in ({}, {"summary": "Hi."}, {"skills": ""}, {"experience": "---"}):
    for level in tl.LEVELS:
        try:
            tl.propose(data, JD_ANALYST, level, use_llm=False)
        except Exception as e:
            check(f"{level} on {data!r}", False, e)
        else:
            check(f"{level} on {list(data) or 'empty'}", True)

print(f"\n{failures} failure(s)" if failures else "\nAll checks passed")
sys.exit(1 if failures else 0)
