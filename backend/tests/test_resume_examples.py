"""The worked example CVs shown in the role picker.

Somebody who has just chosen "Data Scientist" knows which template we suggest
and still does not know what to put in it. These examples are the answer to the
second half, and they are **invented people** — see app/resume_examples.py for
why that is a decision rather than a shortcut.

Two kinds of check here, and the first kind is the important one.

The contact details are the risk. Every example prints a name, an email, a
phone number and a LinkedIn address, and if any of those happened to resolve to
a real person we would be publishing a stranger's details on the strength of a
coincidence. So they are all drawn from ranges reserved for fiction, and these
checks fail if a single record ever drifts out of them — including one written
next year by somebody who never read this file.

The second kind is that every example actually renders. An example that throws
in the PDF builder is worse than no example at all: the picker offers it, the
preview panel breaks, and the person concludes the tool is broken rather than
the sample.

Run from anywhere:  python3 backend/tests/test_resume_examples.py
"""
import os
import pathlib
import sys
import tempfile

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from app import resume_examples as ex
from app.job_templates import role_template_fields
from app.resume_pdf import build_resume_pdf

failures = 0


def check(label, ok, detail=""):
    global failures
    if not ok:
        failures += 1
    print(f"  {'PASS' if ok else 'FAIL'}  {label}{'' if ok else '  — ' + str(detail)}")


ALL = ex.all_examples()
FLAT = [(role, e) for role in sorted(ALL) for e in ex.examples_for(role)]

print("\n== the corpus holds together ==")
check("there are examples at all", len(FLAT) > 30, len(FLAT))
# Everything the loader promises about shape, names and reserved contact ranges.
problems = ex.validate()
check("nothing the validator objects to", not problems, problems[:8])
check("every role that has any has exactly three",
      all(len(ex.examples_for(r)) in (0, 3) for r in ALL),
      {r: len(ex.examples_for(r)) for r in ALL if len(ex.examples_for(r)) not in (0, 3)})

print("\n== every example belongs to a role the picker offers ==")
known = {r["id"] for f in role_template_fields() for r in f["roles"]}
orphans = sorted(set(ALL) - known)
check("no examples for a role nobody can pick", not orphans, orphans)
# Not every role has to have examples yet — the picker only offers the block for
# roles that do — but the ones written must line up with the recommendations.
covered = sorted(ex.roles_with_examples())
print(f"    {len(covered)} of {len(known)} roles covered")
missing = sorted(known - set(covered))
if missing:
    print(f"    still to write: {', '.join(missing)}")

print("\n== the template each one is shown in is one recommended for that role ==")
picks = {r["id"]: {p["template_id"] for p in r["picks"]}
         for f in role_template_fields() for r in f["roles"]}
odd = [(role, e["data"]["full_name"], e["template_id"])
       for role, e in FLAT if e["template_id"] not in picks.get(role, set())]
check("no example is shown in a template we do not recommend for it", not odd, odd[:5])

print("\n== nothing reaches a real person ==")
# Belt and braces over the validator: these are spelled out again here because
# they are the checks whose failure matters most, and a future edit to
# resume_examples.py must not be able to quietly relax them.
bad_mail = [(r, e["data"]["full_name"], e["data"].get("email"))
            for r, e in FLAT if e["data"].get("email")
            and not e["data"]["email"].endswith(("@example.com", "@example.org", "@example.net"))]
check("every email is an example.com address", not bad_mail, bad_mail[:5])
bad_phone = [(r, e["data"]["full_name"], e["data"].get("phone"))
             for r, e in FLAT if e["data"].get("phone")
             and not (e["data"]["phone"].startswith("+44 7700 900")
                      or "555-01" in e["data"]["phone"])]
check("every phone is in a range reserved for fiction", not bad_phone, bad_phone[:5])
bad_li = [(r, e["data"]["full_name"], e["data"].get("linkedin"))
          for r, e in FLAT if e["data"].get("linkedin")
          and not e["data"]["linkedin"].endswith("-example")]
check("every LinkedIn address is marked as an example", not bad_li, bad_li[:5])
names = [e["data"]["full_name"] for _, e in FLAT]
check("no invented person holds two different careers",
      len(names) == len(set(names)),
      sorted({n for n in names if names.count(n) > 1}))

print("\n== each set of three teaches the contrast ==")
for role in sorted(ALL):
    got = ex.examples_for(role)
    if not got:
        continue
    levels = sorted(e["level"] for e in got)
    if levels != ["early", "mid", "senior"]:
        check(f"{role}: one of each career stage", False, levels)
whys = [e["why"] for _, e in FLAT]
check("every example says what it demonstrates", all(len(w) > 40 for w in whys),
      [w for w in whys if len(w) <= 40][:3])
check("and no two say the same thing", len(set(whys)) == len(whys),
      sorted({w[:50] for w in whys if whys.count(w) > 1})[:3])

print("\n== and every one of them renders ==")
broken, thin = [], []
for role, e in FLAT:
    path = None
    try:
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as f:
            path = f.name
        build_resume_pdf(e["template_id"], dict(e["data"]), path)
        if os.path.getsize(path) < 1200:
            thin.append((role, e["data"]["full_name"], os.path.getsize(path)))
    except Exception as err:                                  # noqa: BLE001
        broken.append((role, e["data"]["full_name"], f"{type(err).__name__}: {err}"))
    finally:
        if path and os.path.exists(path):
            os.unlink(path)
check(f"all {len(FLAT)} render without error", not broken, broken[:5])
check("and none comes out near-empty", not thin, thin[:5])

print(f"\n{failures} failure(s)" if failures else "\nAll checks passed")
sys.exit(1 if failures else 0)
