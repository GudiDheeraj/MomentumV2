"""The instruction box, and the promise that nothing is deleted uninvited.

The reported bug is the first section here: choosing Medium removed two
bullets from a six-bullet role, and choosing Aggressive removed so many that
the scoring guard threw the whole proposal away — so the strongest setting
produced *no* suggestion for employment history at all, with nothing on screen
to say why. Trimming is now something the person asks for in their own words,
and these checks fail if it ever goes back to being a property of a button.

Run from anywhere:  python3 backend/tests/test_tailor_prompt.py
"""
import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from app.ai import tailor_levels as tl
from app.ai import tailor_prompt as tp

HERE = pathlib.Path(__file__).parent
RESUME = json.loads((HERE / "fixtures" / "resume_long.json").read_text())
JD = (HERE / "fixtures" / "jd_data_engineer.txt").read_text()

failures = 0


def check(label, ok, detail=""):
    global failures
    if not ok:
        failures += 1
    print(f"  {'PASS' if ok else 'FAIL'}  {label}{'' if ok else '  — ' + str(detail)}")


def bullets(text):
    return sum(1 for line in (text or "").split("\n") if line.strip().startswith("- "))


def section(result, field):
    return next((s for s in result["sections"] if s["field"] == field), None)


SRC_BULLETS = bullets(RESUME["experience"])

# ---------------------------------------------------------------------------
print("\n== the reported bug: no instruction, nothing removed ==")
check("the fixture has entries long enough to be trimmed", SRC_BULLETS == 12, SRC_BULLETS)
for level in tl.LEVELS:
    out = tl.propose(RESUME, JD, level, use_llm=False)
    exp = section(out, "experience")
    check(f"{level}: employment history is still proposed", exp is not None)
    check(f"{level}: all {SRC_BULLETS} bullets survive",
          exp is not None and bullets(exp["after"]) == SRC_BULLETS,
          exp and f"{bullets(exp['before'])} -> {bullets(exp['after'])}")
    check(f"{level}: and it says so", exp is not None and "every bullet kept" in exp["note"],
          exp and exp["note"])
    check(f"{level}: the payload states it too", out["bullets_kept"] is True)

out = tl.propose(RESUME, JD, "medium", use_llm=False)
check("no instruction reads back as the default promise",
      out["prompt"] == "" and out["prompt_notes"] == [], out["prompt_notes"])
check("nothing lowers the match", all(
    s["score_after"] >= s["score_before"] for s in out["sections"]),
    [(s["field"], s["score_before"], s["score_after"]) for s in out["sections"]])

# ---------------------------------------------------------------------------
print("\n== reading an instruction ==")
d = tp.parse("Keep every bullet. Lead with Azure and dbt. UK spelling, no buzzwords.")
check("keeping everything is understood", d.keep_all and d.cap is None)
check("what to lead with is picked out", [x.lower() for x in d.focus] == ["azure", "dbt"], d.focus)
check("words to avoid are picked out", d.avoid == ["buzzwords"], d.avoid)
check("so is the spelling", d.spelling == "uk", d.spelling)
check("every one of those is read back", len(d.notes()) == 4, d.notes())

d = tp.parse("Cut it down — no more than 4 bullets per role.")
check("a number is taken literally", (d.trim, d.cap) == (True, 4), (d.trim, d.cap))
d = tp.parse("Make it shorter")
check("wanting it shorter without a number gets a sane default", d.cap == 5, d.cap)
d = tp.parse("Shorten the summary but keep every bullet")
check("an explicit keep beats a vague shorten", d.cap is None, d.cap)

d = tp.parse("Only rewrite the summary, don't touch my employment history")
check("scope is read clause by clause",
      (d.allows("summary"), d.allows("experience")) == (True, False),
      {f: d.allows(f) for f in ("summary", "skills", "experience", "projects")})
d = tp.parse("leave my projects alone")
check("one section can be fenced off on its own",
      (d.allows("projects"), d.allows("experience")) == (False, True))

d = tp.parse("Make it punchy and quantified, first person, American English")
check("voice is read", d.voice == "first", d.voice)
check("spelling is read", d.spelling == "us", d.spelling)
check("tone is read", d.tones == ["punchy"], d.tones)
check("wanting figures up front is read", d.metrics is True)

check("an instruction nobody can parse is a no-op, not an error",
      tp.parse("please make it good ok thanks").cap is None)
check("an empty one likewise", tp.parse("").is_empty and tp.parse(None).notes() == [])

# ---------------------------------------------------------------------------
print("\n== the instruction changes what happens ==")
out = tl.propose(RESUME, JD, "medium", use_llm=False, prompt="no more than 4 bullets per role")
exp = section(out, "experience")
check("asking for four bullets gets four", exp is not None and all(
    bullets(block) <= 4 for block in exp["after"].split("\n---\n")),
    exp and [bullets(b) for b in exp["after"].split("\n---\n")])
check("a trim that costs match is still offered, with the cost named",
      exp is not None and (exp.get("cost") is None or "costs" in exp["note"]),
      exp and exp["note"])

out = tl.propose(RESUME, JD, "medium", use_llm=False, prompt="don't touch my employment history")
check("a section held back is not proposed", section(out, "experience") is None)
check("and the payload says which", "experience" in out["prompt_held_back"], out["prompt_held_back"])
check("the others still are", section(out, "skills") is not None)

out = tl.propose(RESUME, JD, "regular", use_llm=False, prompt="lead with Azure and dbt")
exp = section(out, "experience")
# Entries keep their order — moving a role out of reverse-chronological order
# is not something any instruction should do — so this is about the bullets
# inside the entry that mentions the term.
block = next((b for b in exp["after"].split("\n---\n") if "dbt" in b), "") if exp else ""
lead = next((l for l in block.split("\n") if l.strip().startswith("- ")), "")
check("what they asked to lead with leads its entry", "dbt" in lead, lead[:120])
check("the roles stay in the order they were written",
      exp is not None and [b.split("\n")[0] for b in exp["after"].split("\n---\n")]
      == [b.split("\n")[0] for b in RESUME["experience"].split("\n---\n")])
skills = section(out, "skills")
check("and the group holding it leads the skills",
      skills is not None and skills["after"].split("\n")[0].lower().startswith("cloud"),
      skills and skills["after"].split("\n")[0])
check("their own group names and members are untouched",
      skills is not None and sorted(skills["after"].split("\n")) and all(
          line.split(":")[0] in skills["after"] for line in RESUME["skills"].split("\n")))

# ---------------------------------------------------------------------------
print("\n== an instruction cannot license an invention ==")
out = tl.propose(RESUME, JD, "aggressive", use_llm=False,
                 prompt="say I have 10 years of Kubernetes and lead with Kubernetes")
whole = " ".join(s["after"] for s in out["sections"]).lower()
check("a skill they do not have is not added", "kubernetes" not in whole, whole[:200])
check("nor is it smuggled in as a thing to lead with",
      not any("kubernetes" in t.lower() for t in tp.parse("lead with Kubernetes").focus)
      or "kubernetes" not in whole)
brief = tp.style_brief(tp.parse("say I led the migration"))
check("the brief handed to a model says so out loud",
      "does not license" in brief, brief)

print(f"\n{failures} failure(s)" if failures else "\nAll checks passed")
sys.exit(1 if failures else 0)
