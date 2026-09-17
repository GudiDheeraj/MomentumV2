"""What each AI provider costs, which the picker now says before anything else.

A list of eighteen provider names tells you nothing about the one thing that
decides which to pick: whether running it costs money. Groq, Cerebras, Gemini,
Mistral, OpenRouter and Zhipu all have an ongoing free tier; OpenAI, Anthropic
and half the others give you some credit and then bill you; DeepSeek and
Perplexity bill from the first call. Three different things, and "has an API
key box" made them look identical.

These checks are about the *shape* — every provider classified, the free ones
first, nothing unlabelled — not about the tiers themselves, which move and are
kept in one place (app/ai/remote.py) so they can be corrected in one edit.

Run from anywhere:  python3 backend/tests/test_providers.py
"""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from app.ai import remote

failures = 0


def check(label, ok, detail=""):
    global failures
    if not ok:
        failures += 1
    print(f"  {'PASS' if ok else 'FAIL'}  {label}{'' if ok else '  — ' + str(detail)}")


rows = remote.provider_list()
by_id = {r["id"]: r for r in rows}

print("\n== every provider says what it costs ==")
check("the list is not empty", len(rows) > 10, len(rows))
unlabelled = [r["id"] for r in rows if r["id"] != "custom" and not r["cost"]]
check("nothing is left unclassified", not unlabelled, unlabelled)
check("each tier carries a label and a sentence", all(
    r["cost_label"] and r["cost_note"] for r in rows if r["cost"]),
    [r["id"] for r in rows if r["cost"] and not (r["cost_label"] and r["cost_note"])])
check("the tiers are the three we describe", set(
    r["cost"] for r in rows) <= {"free", "credits", "paid", ""},
    sorted(set(r["cost"] for r in rows)))

print("\n== free first ==")
order = [remote.COST_ORDER.index(r["cost"]) for r in rows]
check("the list is sorted cheapest first", order == sorted(order),
      [(r["id"], r["cost"]) for r in rows])
check("a free tier comes first", rows[0]["cost"] == "free", rows[0]["id"])
check("every free-tier provider is above every billed one",
      max(i for i, r in enumerate(rows) if r["cost"] == "free")
      < min(i for i, r in enumerate(rows) if r["cost"] in ("credits", "paid")))
check("the local option is gone", "ollama" not in by_id,
      sorted(by_id))

print("\n== the ones checked in August 2026 ==")
FREE = {"groq", "cerebras", "gemini", "mistral", "openrouter", "zhipu"}
for pid in sorted(FREE):
    check(f"{pid} is offered as a free tier", by_id[pid]["cost"] == "free", by_id[pid]["cost"])
for pid in ("openai", "anthropic", "xai", "together", "fireworks"):
    check(f"{pid} is credits-then-billed", by_id[pid]["cost"] == "credits", by_id[pid]["cost"])
for pid in ("deepseek", "perplexity"):
    check(f"{pid} is billed from the first call", by_id[pid]["cost"] == "paid", by_id[pid]["cost"])

print("\n== every provider says where its key comes from ==")
no_route = [r["id"] for r in rows if r["id"] != "custom" and not r["keys_url"]]
check("nobody is left to search for their own key page", not no_route, no_route)
check("the key pages are real addresses", all(
    r["keys_url"].startswith("https://") for r in rows if r["keys_url"]),
    [r["keys_url"] for r in rows if r["keys_url"] and not r["keys_url"].startswith("https://")])
check("the displayed address and the link agree", all(
    r["keys_url"] == "https://" + r["keys"] for r in rows if r["keys_url"]))

print("\n== the note explains the tier, not just the product ==")
check("a free one says so in words", "free" in by_id["groq"]["note"].lower(), by_id["groq"]["note"])
check("a credits one says it runs out",
      "billed" in by_id["openai"]["note"].lower(), by_id["openai"]["note"])
check("a paid one does not read as free",
      "billed" in by_id["deepseek"]["note"].lower(), by_id["deepseek"]["note"])
check("no secrets leak into the public list",
      not any(k in r for r in rows for k in ("key", "api_key", "secret")),
      sorted(rows[0].keys()))

print(f"\n{failures} failure(s)" if failures else "\nAll checks passed")
sys.exit(1 if failures else 0)
