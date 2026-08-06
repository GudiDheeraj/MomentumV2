#!/usr/bin/env python3
"""Check every company board in the registry against its live API.

    python verify_boards.py            # report only
    python verify_boards.py --fix      # also deactivate the dead ones
    python verify_boards.py --only greenhouse

The bundled companies.json is a starting point compiled from public careers
pages, and companies move between ATS platforms without telling anybody. This
says which entries are real, how many openings each has, and which are wrong,
so the registry can be trusted rather than hoped at.
"""

import sys
from concurrent.futures import ThreadPoolExecutor, as_completed

sys.path.insert(0, ".")

from app.database import SessionLocal          # noqa: E402  (needs the path set first)
from app import models                          # noqa: E402
from app.jobhunt.providers import BoardError, fetch_board  # noqa: E402
from app.jobhunt.registry import seed_shared_registry      # noqa: E402


def check(row):
    try:
        jobs = fetch_board(row["provider"], row["token"], row["name"])
        return row, len(jobs), None
    except BoardError as e:
        return row, None, e
    except Exception as e:
        return row, None, BoardError(f"{type(e).__name__}: {e}")


def main():
    fix = "--fix" in sys.argv
    only = None
    if "--only" in sys.argv:
        only = sys.argv[sys.argv.index("--only") + 1].lower()

    db = SessionLocal()
    seed_shared_registry(db)
    q = db.query(models.CompanyBoard)
    if only:
        q = q.filter(models.CompanyBoard.provider == only)
    boards = q.order_by(models.CompanyBoard.provider, models.CompanyBoard.name).all()
    rows = [{"id": b.id, "name": b.name, "provider": b.provider, "token": b.token}
            for b in boards]
    print(f"\nChecking {len(rows)} boards...\n" + "=" * 66)

    ok, dead, flaky = [], [], []
    with ThreadPoolExecutor(max_workers=8) as pool:
        futures = [pool.submit(check, r) for r in rows]
        for fut in as_completed(futures):
            row, count, err = fut.result()
            if err is None:
                ok.append((row, count))
                print(f"  OK    {row['provider']:16} {row['name']:24} {count:>4} jobs")
            elif err.permanent:
                dead.append((row, err))
                print(f"  DEAD  {row['provider']:16} {row['name']:24} {err}")
            else:
                flaky.append((row, err))
                print(f"  ERR   {row['provider']:16} {row['name']:24} {err}")

    print("=" * 66)
    print(f"  {len(ok)} working · {len(dead)} wrong token or gone · {len(flaky)} network trouble")
    total = sum(c for _, c in ok)
    print(f"  {total} open positions reachable right now")

    if dead and fix:
        for row, _ in dead:
            board = db.query(models.CompanyBoard).get(row["id"])
            if board:
                board.active = False
                board.last_error = "verify_boards: not found"
        db.commit()
        print(f"\n  Deactivated {len(dead)} boards.")
    elif dead:
        print("\n  Re-run with --fix to deactivate those, or fix the token by")
        print("  pasting the company's real careers URL into the Job Hunt tab.")
    db.close()


if __name__ == "__main__":
    main()
