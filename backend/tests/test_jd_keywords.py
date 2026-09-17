"""What the advert asks for, and what gets added when the person ticks a term.

The bugs these pin down all reached the screen: n-grams sliced across clause
boundaries ("load data enabling"), generic adjectives presented as keywords
("smooth data"), a phrase absorbing a shorter one the CV actually used (three
real matches shown as one), and punctuation glued to a term so "data
engineering." never matched "data engineering".
"""
import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from app.ai import jd_keywords as jk

HERE = pathlib.Path(__file__).parent
RESUME = json.loads((HERE / "fixtures" / "resume.json").read_text())
JD = (HERE / "fixtures" / "jd_data_engineer.txt").read_text()

failures = 0


def check(label, ok, detail=""):
    global failures
    if not ok:
        failures += 1
    print(f"  {'PASS' if ok else 'FAIL'}  {label}{'' if ok else '  — ' + str(detail)}")


analysis = jk.analyse(RESUME, JD)
terms = [k["term"] for k in analysis["keywords"]]
lower = [t.lower() for t in terms]

print("\n== the keyword read ==")
check("the advert's real subject is found", "data engineering" in lower, terms)
check("multi-word terms are kept whole", "data pipelines" in lower, terms)
check("no clause-spanning fragments", not any(
    t in lower for t in ("load data enabling", "performance document data", "facilitate smooth data")), terms)
check("no generic adjective phrases", not any(
    t.startswith(("smooth ", "efficient ", "comprehensive ", "scalable ")) for t in lower), terms)
check("no punctuation glued to a term", not any(t.endswith((".", ",")) for t in lower), terms)
check("terms the CV uses are reported as used", analysis["present_count"] >= 2, analysis["present_count"])
check("a shorter term the CV uses is not absorbed by a longer one",
      "data quality" in lower, terms)
check("every term says where it was found", all(
    (k["where"] and k["in_cv"]) or (not k["where"] and not k["in_cv"]) for k in analysis["keywords"]))

print("\n== requirements ==")
reqs = analysis["requirements"]
check("the advert's bullets are read as requirements", len(reqs) >= 10, len(reqs))
check("some are evidenced", analysis["requirements_met"] > 0, analysis["requirements_met"])
check("an evidenced one names the section", all(
    r["evidence"] for r in reqs if r["met"]))

print("\n== adding chosen keywords ==")
picked = ["ETL", "data pipelines"]
res = jk.weave(RESUME, picked, ["skills"], JD)
sec = res["sections"][0]
check("skills are updated without a model", sec["field"] == "skills")
check("both chosen terms land", all(t.lower() in sec["after"].lower() for t in picked), sec["after"])
check("nothing else in the section is lost", all(
    line.split(":")[0] in sec["after"] for line in RESUME["skills"].split("\n")))
check("the person's own groups are kept", sec["after"].count("\n") == RESUME["skills"].count("\n"))

res2 = jk.weave(RESUME, picked, ["experience"], JD)
check("prose sections say why they were skipped with no model",
      bool(res2["skipped"]) or bool(res2["sections"]),
      res2)

print("\n== nothing is added that was not asked for ==")
# A skills section is a list, so compare it as one: whitespace tokens would
# report "Excel" as new merely because re-joining a group put a comma after it.
from app.ai.tailor_levels import _skills_lines, _split_items


def skill_items(text):
    return {i.strip().lower() for _label, values in _skills_lines(text or "")
            for i in _split_items(values) if i.strip()}


added = skill_items(sec["after"]) - skill_items(RESUME["skills"])
check("only the ticked words appear",
      added == {t.lower() for t in picked}, added)
check("no existing skill is dropped or reworded",
      not (skill_items(RESUME["skills"]) - skill_items(sec["after"])),
      skill_items(RESUME["skills"]) - skill_items(sec["after"]))

print(f"\n{failures} failure(s)" if failures else "\nAll checks passed")
sys.exit(1 if failures else 0)
