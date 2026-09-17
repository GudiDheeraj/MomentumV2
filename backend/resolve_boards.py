#!/usr/bin/env python3
"""Work out which ATS each company on the Forbes Global 2000 uses.

    python resolve_boards.py                  # the whole list, resumable
    python resolve_boards.py --country "United Kingdom"
    python resolve_boards.py --limit 100      # a taste before committing an hour
    python resolve_boards.py --no-site        # ATS platforms only, skip careers pages
    python resolve_boards.py --report         # summarise the checkpoint, probe nothing

What it does
------------
The company list gives a name, a domain and a country. None of that is a board
token, and there is no directory anywhere that maps one to the other. So each
company is probed: a set of plausible slugs is derived from its name and its
domain, and each is tried against the six ATS APIs the app already speaks.
A slug that answers with at least one live posting is the company's board.

Requiring at least one posting is the whole trick. Every one of these APIs
answers 200 with an empty list for tokens that exist but belong to nobody in
particular, so "the request succeeded" proves nothing and "there are jobs on
it" proves quite a lot.

Companies that match nothing get one careers page check, using the same
schema.org reader the app's `site` provider uses at search time. If the page
publishes structured job data the company is registered as a `site` board; if
it does not, it is recorded as unresolved and skipped, because registering it
would add a daily fetch that can never return anything.

Why this is a script you run and not something the app does
-----------------------------------------------------------
It is roughly twelve thousand requests. That is a one off cost paid once
against a list that changes annually, not something to repeat on a schedule.
The output is a JSON file the app seeds from at startup, so re-running it is
only ever needed after Forbes publishes a new list.

Resumability
------------
Every company's verdict is appended to resolve_checkpoint.jsonl as it lands.
Interrupt the run and start it again and it picks up where it stopped, which
matters for something that takes the better part of an hour.
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import sys
import threading
import time
import unicodedata
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

sys.path.insert(0, ".")

from app.jobhunt.providers import BoardError, fetch_board, _get_json  # noqa: E402
from app.jobhunt import pagescrape                              # noqa: E402

HERE = Path(__file__).parent
COMPANY_CSV = HERE / "app" / "jobhunt" / "data" / "forbes_global_2000_2026.csv"
CHECKPOINT = HERE / "app" / "jobhunt" / "data" / "resolve_checkpoint.jsonl"
OUT_JSON = HERE / "app" / "jobhunt" / "companies_global2000.json"
REPORT_CSV = HERE / "app" / "jobhunt" / "data" / "resolve_report.csv"

# Probe order matters. Greenhouse, Lever and Ashby carry the largest share of
# the companies that have a public board at all, so trying them first means
# most companies are settled in one or two requests instead of six.
PROVIDER_ORDER = ["greenhouse", "lever", "ashby", "workable", "smartrecruiters", "recruitee"]

# Careers paths tried, in order, when no ATS matched. Ordered by how often they
# are the real one rather than a redirect to a marketing page.
CAREERS_PATHS = ["/careers", "/careers/jobs", "/jobs", "/en/careers",
                 "/about/careers", "/company/careers", "/careers/search"]

# Legal form and filler words. Stripped because no company puts "plc" in its
# ATS slug, and leaving them in turns every British company into a miss.
_NOISE = {
    "plc", "inc", "incorporated", "corp", "corporation", "ltd", "limited",
    "llc", "lp", "llp", "co", "company", "companies", "group", "holdings",
    "holding", "international", "worldwide", "global", "the", "and",
    "sa", "ag", "nv", "bv", "ab", "as", "asa", "oyj", "oy", "spa", "srl",
    "gmbh", "kgaa", "kg", "se", "aps", "pte", "pty", "bhd", "tbk", "psc",
    "pjsc", "ojsc", "pcl", "sab", "cv", "nl", "financial", "bancorp",
}

_lock = threading.Lock()
_done: set[str] = set()


# ---------------------------------------------------------------------------
# Candidate slugs
# ---------------------------------------------------------------------------

def slug_candidates(name: str, domain: str) -> list[tuple[str, bool]]:
    """Plausible ATS slugs for one company, best guess first.

    The domain is tried before anything derived from the name. A company's
    second level domain is the single most reliable predictor of its slug,
    because both are chosen by the same people for the same reason: it is the
    short name the company actually goes by. "JPMorganChase" and
    "jpmorganchase.com" agree; "Saudi Arabian Oil Company (Saudi Aramco)" and
    "aramco.com" do not, and the domain is right.
    """
    out: list[tuple[str, bool]] = []
    taken: set[str] = set()

    def add(value: str, min_len: int = 4, strong: bool = False) -> None:
        value = re.sub(r"[^a-z0-9-]", "", (value or "").lower()).strip("-")
        if len(value) >= min_len and value not in taken:
            taken.add(value)
            out.append((value, strong))

    if domain:
        stem = domain.split(".")[0]
        if stem in ("www", "home", "about", "corporate", "jobs", "careers", "usa", "corp"):
            parts = domain.split(".")
            stem = parts[1] if len(parts) > 1 else stem
        # Two characters is allowed here and nowhere else. A short slug is
        # normally a collision waiting to happen, but "bp" taken from bp.com is
        # the company saying what it calls itself, and excluding it would drop
        # BP, BT, 3M and everyone else with a short name from the run entirely.
        # It is only ever *weak*, though: three letters match somebody else's
        # board far more often than they match this company's.
        add(stem, min_len=2, strong=len(stem) >= 5)

    clean = re.sub(r"[^\w\s()&.-]", " ", name or "")

    # Anything in brackets is usually the name the company is known by, and it
    # is a better slug than the formal one in front of it.
    for bracketed in re.findall(r"\(([^)]+)\)", clean):
        words = [w for w in re.split(r"[\s.\-]+", bracketed.lower()) if w and w not in _NOISE]
        if words:
            add("".join(words), strong=True)
            add("-".join(words), strong=True)
            add(words[0])

    base = re.sub(r"\([^)]*\)", " ", clean)
    words = [w for w in re.split(r"[\s.,\-/&]+", base.lower()) if w]
    words = [w for w in words if w not in _NOISE]
    if words:
        # The company's own full name, run together. If a board answers to
        # this, it is the company.
        add("".join(words), strong=True)
        add("-".join(words), strong=True)
        if len(words) > 1:
            # Everything below is a guess rather than a name. These are the
            # candidates that produced "London Stock Exchange" resolving to
            # greenhouse/london, which is a clothing brand, so they are never
            # accepted on their own: they have to be confirmed by the board
            # calling itself something recognisable.
            add(words[0], min_len=6)
            add("".join(words[:2]))
            add("-".join(words[:2]))
    return out[:8]


# ---------------------------------------------------------------------------
# Probing
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# Verification
# ---------------------------------------------------------------------------
# The reason this section exists. A first pass without it resolved "London
# Stock Exchange" to greenhouse/london, which turns out to be a clothing brand
# called Aimé Leon Dore; "General Dynamics" to greenhouse/general, a generic
# "General Interest" page; and "Industrial Bank" to greenhouse/industrial, the
# Industrial Door Company. Five of seven matches in a fifty-six company sample
# were wrong companies. Left in, that would have filled the registry with
# hundreds of boards belonging to somebody else and filed their openings under
# names they have nothing to do with.
#
# The fix is to stop trusting a slug that answers and start asking the board
# what it calls itself. Four of the six platforms will say. For the two that
# will not, only a slug that *is* the company's name or domain is accepted.

def board_name(provider: str, token: str) -> str | None:
    """What the board calls itself, or None when the platform does not say.

    Lever and Ashby publish jobs without ever naming the organisation, so
    there is nothing to check them against. That is not a gap to work around;
    it is the reason those two only ever accept a strong candidate.
    """
    try:
        if provider == "greenhouse":
            data = _get_json(f"https://boards-api.greenhouse.io/v1/boards/{token}")
            return (data or {}).get("name")
        if provider == "workable":
            data = _get_json(
                f"https://apply.workable.com/api/v1/widget/accounts/{token}?details=true")
            return (data or {}).get("name") or (data or {}).get("account_name")
        if provider == "smartrecruiters":
            data = _get_json(
                f"https://api.smartrecruiters.com/v1/companies/{token}/postings?limit=1")
            first = ((data or {}).get("content") or [{}])[0]
            return ((first.get("company") or {}).get("name"))
        if provider == "recruitee":
            data = _get_json(f"https://{token}.recruitee.com/api/offers/")
            first = ((data or {}).get("offers") or [{}])[0]
            return first.get("company_name")
    except Exception:                                        # noqa: BLE001
        return None
    return None


# Joining words. Dropped before comparing names, because they are shared by
# everybody and counting them as agreement is how "Bank of Ireland" and "Bank
# of America" come out as the same company.
_CONNECTIVES = {"of", "for", "at", "in", "on", "de", "del", "du", "da", "das",
                "der", "die", "den", "und", "et", "y", "e", "van", "von",
                "la", "le", "el", "al", "a", "an"}


def _words(text: str) -> list[str]:
    # Accents are folded rather than stripped as punctuation. Without this,
    # "Estée Lauder" splits into "est" and "e" and stops matching "Estee
    # Lauder", which is the same company spelled by somebody with a different
    # keyboard. The Global 2000 is full of them: L'Oréal, Nestlé, Danone.
    folded = unicodedata.normalize("NFKD", text or "")
    folded = "".join(c for c in folded if not unicodedata.combining(c))
    cleaned = re.sub(r"[^a-z0-9\s]", " ", folded.lower())
    return [w for w in cleaned.split()
            if w and w not in _NOISE and w not in _CONNECTIVES]


def names_agree(company: str, board: str) -> bool:
    """Whether a board's own name plausibly belongs to this company.

    Loose on formatting, strict on substance. "Tesco" and "Tesco PLC" are the
    same company; "General Dynamics" and "General Interest" are not, and nor
    are "Punjab National Bank" and "National Bank of Canada", which share two
    words out of three and nothing else.

    What separates them is the first distinctive word. Company names are built
    head first: the part that identifies the company comes at the front and the
    sector words follow, so "Punjab" carries the identity and "National Bank"
    carries almost none. Requiring the heads to match, and then most of the
    rest to overlap, is what makes a name check worth running at all.

    Companies that trade under a different name from their listing are missed
    rather than guessed at. A missing board is one you can paste in by hand; a
    wrong one is wrong every morning without ever saying so.
    """
    a, b = _words(company), _words(board)
    if not a or not b:
        return False
    ja, jb = "".join(a), "".join(b)
    if ja in jb or jb in ja:
        return True
    if a[0] != b[0]:
        return False
    overlap = len(set(a) & set(b))
    return overlap >= min(len(a), len(b)) * 0.6


# ---------------------------------------------------------------------------
# Probing
# ---------------------------------------------------------------------------

def probe_ats(name: str, candidates: list[tuple[str, bool]],
              providers: list[str]) -> dict | None:
    """First (provider, token) that answers with live postings *and* checks out.

    Two conditions, both necessary. At least one posting, because every one of
    these APIs answers 200 with an empty list for a token that exists but
    belongs to nobody, so a successful request on its own proves nothing. And
    then either the board names itself as this company, or the slug was the
    company's own name or domain to begin with.
    """
    for token, strong in candidates:
        for provider in providers:
            try:
                jobs = fetch_board(provider, token, name)
            except BoardError:
                continue
            except Exception:                                # noqa: BLE001
                continue
            if not jobs:
                # A 200 with an empty list. Could be the right company between
                # hiring rounds, could be a slug nobody owns. Not enough
                # either way, so keep going.
                continue

            found = board_name(provider, token)
            if found and names_agree(name, found):
                return {"provider": provider, "token": token, "jobs": len(jobs),
                        "board_name": found, "verified": "name"}
            if found:
                # The board said who it is and it is somebody else. This is the
                # case that matters: rejecting here is the difference between a
                # registry of real companies and a registry of coincidences.
                continue
            if strong:
                return {"provider": provider, "token": token, "jobs": len(jobs),
                        "board_name": None, "verified": "slug"}
    return None


def probe_site(name: str, domain: str) -> dict | None:
    """One careers page that publishes schema.org JobPosting data, if any.

    Checked once, here, rather than trusted at search time. Registering every
    unmatched company as a `site` board would add hundreds of daily fetches
    against pages that have nothing structured to read, which is precisely the
    kind of slow rot this script exists to prevent.
    """
    if not domain:
        return None
    for path in CAREERS_PATHS:
        url = f"https://{domain}{path}"
        try:
            jobs = pagescrape.fetch_site(url, name)
        except BoardError:
            continue
        except Exception:                                    # noqa: BLE001
            continue
        if jobs:
            # No name check here: the page was reached at the company's own
            # domain, so whose page it is was never in doubt.
            return {"provider": "site", "token": url, "jobs": len(jobs),
                    "board_name": None, "verified": "domain"}
    return None


def resolve(company: dict, providers: list[str], try_site: bool) -> dict:
    name, domain = company["company"], company["domain"]
    candidates = slug_candidates(name, domain)

    hit = probe_ats(name, candidates, providers)
    if hit is None and try_site:
        hit = probe_site(name, domain)

    result = {
        "rank": company["rank"], "name": name, "domain": domain,
        "country": company["country"], "industry": company["industry"],
        "candidates": [c for c, _strong in candidates],
    }
    result.update(hit or {"provider": None, "token": None, "jobs": 0,
                          "board_name": None, "verified": None})
    return result


# ---------------------------------------------------------------------------
# Checkpoint
# ---------------------------------------------------------------------------

def load_checkpoint() -> list[dict]:
    if not CHECKPOINT.exists():
        return []
    rows = []
    for line in CHECKPOINT.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            rows.append(json.loads(line))
        except ValueError:
            continue
    return rows


def append_checkpoint(result: dict) -> None:
    with _lock:
        CHECKPOINT.parent.mkdir(parents=True, exist_ok=True)
        with CHECKPOINT.open("a", encoding="utf-8") as f:
            f.write(json.dumps(result, ensure_ascii=False) + "\n")


# ---------------------------------------------------------------------------
# Output
# ---------------------------------------------------------------------------

def write_outputs(rows: list[dict]) -> tuple[int, int]:
    resolved = [r for r in rows if r.get("provider") and r.get("token")]
    # Deduplicated on (provider, token). Subsidiaries on the Global 2000 share
    # a parent's board more often than you would think, and registering the
    # same board twice would fetch it twice every single sweep.
    seen, companies = set(), []
    for r in sorted(resolved, key=lambda x: x["rank"]):
        key = (r["provider"], r["token"])
        if key in seen:
            continue
        seen.add(key)
        companies.append({
            "name": r["name"], "provider": r["provider"], "token": r["token"],
            "country": r.get("country"), "rank": r.get("rank"),
            # How this board was tied to this company: "name" means the board
            # said so itself, "slug" means the token was the company's own name
            # or domain, "domain" means the careers page was on that domain.
            "verified": r.get("verified"), "board_name": r.get("board_name"),
        })

    OUT_JSON.write_text(json.dumps({
        "_comment": [
            "Generated by backend/resolve_boards.py from the Forbes Global 2000.",
            "Every entry answered its ATS API with at least one live posting at",
            "the moment it was resolved. Companies move platforms, so this rots",
            "like any other seed list: the app retires a board after three",
            "consecutive permanent failures, and `python verify_boards.py --fix`",
            "prunes it on demand.",
            "Regenerate with: python resolve_boards.py",
        ],
        "companies": companies,
    }, indent=1, ensure_ascii=False), encoding="utf-8")

    REPORT_CSV.parent.mkdir(parents=True, exist_ok=True)
    with REPORT_CSV.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["rank", "company", "domain", "country", "industry",
                    "provider", "token", "jobs", "board_name", "verified_by",
                    "candidates_tried"])
        for r in sorted(rows, key=lambda x: x["rank"]):
            w.writerow([r["rank"], r["name"], r["domain"], r.get("country", ""),
                        r.get("industry", ""), r.get("provider") or "",
                        r.get("token") or "", r.get("jobs") or 0,
                        r.get("board_name") or "", r.get("verified") or "",
                        " ".join(r.get("candidates") or [])])
    return len(companies), len(rows)


def summarise(rows: list[dict]) -> None:
    from collections import Counter
    by_provider = Counter(r["provider"] for r in rows if r.get("provider"))
    by_check = Counter(r.get("verified") for r in rows if r.get("provider"))
    resolved = sum(by_provider.values())
    jobs = sum(r.get("jobs") or 0 for r in rows)
    print("=" * 68)
    print(f"  {resolved} of {len(rows)} companies resolved to a readable board")
    for provider, count in by_provider.most_common():
        print(f"    {provider:16} {count:>5}")
    print(f"  {jobs} open positions visible across them right now")
    print()
    print("  How each was tied to its company:")
    labels = {"name": "the board named itself as this company",
              "slug": "the token was the company's own name or domain",
              "domain": "the careers page was on the company's domain"}
    for check, count in by_check.most_common():
        print(f"    {count:>5}  {labels.get(check, check)}")
    print("=" * 68)


# ---------------------------------------------------------------------------

def main() -> None:
    ap = argparse.ArgumentParser(description="Resolve Global 2000 companies to ATS boards.")
    ap.add_argument("--limit", type=int, default=0, help="stop after this many companies")
    ap.add_argument("--country", default="", help="only companies in this country")
    ap.add_argument("--workers", type=int, default=8,
                    help="concurrent companies (default 8, be kind to free APIs)")
    ap.add_argument("--no-site", action="store_true",
                    help="skip the careers page fallback, ATS platforms only")
    ap.add_argument("--only", default="", help="comma separated providers to try")
    ap.add_argument("--restart", action="store_true", help="ignore the checkpoint and start over")
    ap.add_argument("--retry-misses", action="store_true",
                    help="keep the hits from the checkpoint, probe the misses again")
    ap.add_argument("--report", action="store_true",
                    help="rebuild the outputs from the checkpoint without probing")
    args = ap.parse_args()

    if not COMPANY_CSV.exists():
        sys.exit(f"Company list not found at {COMPANY_CSV}")

    if args.restart and CHECKPOINT.exists():
        CHECKPOINT.unlink()

    previous = load_checkpoint()
    if args.retry_misses:
        # A run that lost its connection halfway records a page of misses that
        # are not misses at all, and the checkpoint would then skip exactly the
        # companies worth retrying. This keeps what resolved and reopens the
        # rest, which is almost always what "run it again" was meant to mean.
        previous = [r for r in previous if r.get("provider")]
        CHECKPOINT.write_text(
            "".join(json.dumps(r, ensure_ascii=False) + "\n" for r in previous),
            encoding="utf-8")
        print(f"  keeping {len(previous)} resolved, reopening everything else")
    done = {r["name"] for r in previous}

    if args.report:
        written, total = write_outputs(previous)
        summarise(previous)
        print(f"  wrote {written} boards to {OUT_JSON.name}")
        return

    with COMPANY_CSV.open(encoding="utf-8") as f:
        companies = [dict(r, rank=int(r["rank"])) for r in csv.DictReader(f)]

    if args.country:
        wanted = args.country.strip().lower()
        companies = [c for c in companies if c["country"].lower() == wanted]
    todo = [c for c in companies if c["company"] not in done]
    if args.limit:
        todo = todo[:args.limit]

    providers = ([p.strip().lower() for p in args.only.split(",") if p.strip()]
                 if args.only else PROVIDER_ORDER)

    print(f"\n  {len(companies)} companies in scope, {len(done)} already done, "
          f"{len(todo)} to probe")
    print(f"  {args.workers} at a time, up to {len(providers)} platforms each"
          f"{'' if args.no_site else ', careers page as a fallback'}")
    print(f"  Interrupt any time. Progress is written to {CHECKPOINT.name} as it goes.\n")

    started = time.time()
    results = list(previous)
    completed = 0

    with ThreadPoolExecutor(max_workers=max(1, args.workers)) as pool:
        futures = {pool.submit(resolve, c, providers, not args.no_site): c for c in todo}
        try:
            for fut in as_completed(futures):
                company = futures[fut]
                try:
                    result = fut.result()
                except Exception as e:                       # noqa: BLE001
                    result = {"rank": int(company["rank"]), "name": company["company"],
                              "domain": company["domain"], "country": company["country"],
                              "industry": company["industry"], "provider": None,
                              "token": None, "jobs": 0, "error": f"{type(e).__name__}: {e}"}
                append_checkpoint(result)
                results.append(result)
                completed += 1
                if result.get("provider"):
                    print(f"  HIT   {result['name'][:32]:34} "
                          f"{result['provider']:16} {result['token'][:38]:40} "
                          f"{result['jobs']:>4} jobs")
                if completed % 25 == 0:
                    rate = completed / max(1e-6, time.time() - started)
                    left = (len(todo) - completed) / max(rate, 1e-6) / 60
                    print(f"  ... {completed}/{len(todo)} probed, "
                          f"about {left:.0f} min to go")
        except KeyboardInterrupt:
            print("\n  Stopped. Run the same command again to carry on.")

    written, total = write_outputs(results)
    summarise(results)
    print(f"  wrote {written} boards to {OUT_JSON.relative_to(HERE)}")
    print(f"  full detail in {REPORT_CSV.relative_to(HERE)}")
    print("\n  Restart the backend to load them, or run:  python verify_boards.py\n")


if __name__ == "__main__":
    main()
