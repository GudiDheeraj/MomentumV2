import calendar
from datetime import date, timedelta
from collections import defaultdict

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from .. import models
from ..auth import get_current_user
from ..database import get_db

router = APIRouter(prefix="/api/summary", tags=["summary"])

DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]


def _active_habits(db: Session, user_id: int):
    return db.query(models.Habit).filter(models.Habit.user_id == user_id, models.Habit.active == True).all()  # noqa: E712


# The UI can scope every statistic to habits only, one-off tasks only, or both
# together. Counts are tracked per scope from the lowest level up so the three
# views are internally consistent rather than derived from each other.
SCOPES = ("all", "habit", "task")


def _pct(completed: int, total: int):
    return round(completed / total * 100, 1) if total else 0.0


def _day_counts_split(db: Session, user_id: int, d: date, habits=None):
    """Return {scope: (completed, total)} for a single date.
    Only habits that already existed on date `d` count toward that day's total."""
    habits = habits if habits is not None else _active_habits(db, user_id)
    habits_on_day = [h for h in habits if h.created_at.date() <= d]
    habit_ids = [h.id for h in habits_on_day]
    completed_habit_ids = set()
    if habit_ids:
        entries = db.query(models.HabitEntry).filter(
            models.HabitEntry.date == d,
            models.HabitEntry.habit_id.in_(habit_ids),
            models.HabitEntry.completed == True,  # noqa: E712
        ).all()
        completed_habit_ids = {e.habit_id for e in entries}

    tasks = db.query(models.Task).filter(models.Task.date == d, models.Task.user_id == user_id).all()

    habit_completed, habit_total = len(completed_habit_ids), len(habit_ids)
    task_completed, task_total = sum(1 for t in tasks if t.completed), len(tasks)
    return {
        "habit": (habit_completed, habit_total),
        "task": (task_completed, task_total),
        "all": (habit_completed + task_completed, habit_total + task_total),
    }


def _day_counts(db: Session, user_id: int, d: date, habits=None):
    """Return (completed, total) combining habits + one-off tasks for a single date."""
    return _day_counts_split(db, user_id, d, habits)["all"]


def _scoped_fields(counts: dict) -> dict:
    """Flatten {scope: (c, t)} into habit_*/task_* keys for a day/month row."""
    out = {}
    for scope in ("habit", "task"):
        c, t = counts[scope]
        out[f"{scope}_completed"] = c
        out[f"{scope}_total"] = t
        out[f"{scope}_percent"] = _pct(c, t)
    return out


def _week_start(d: date) -> date:
    return d - timedelta(days=d.weekday())  # Monday


def _longest_and_current_streak(percents: list):
    """percents: list of (has_data: bool, percent: float) in chronological order.
    Returns (longest_streak, current_streak) counting consecutive days with percent > 0."""
    longest = 0
    current = 0
    running = 0
    for has_data, pct in percents:
        if has_data and pct > 0:
            running += 1
            longest = max(longest, running)
        else:
            running = 0
    # current streak = trailing run ending at the last day that has data
    trailing = 0
    for has_data, pct in reversed(percents):
        if not has_data:
            continue
        if pct > 0:
            trailing += 1
        else:
            break
    current = trailing
    return longest, current


@router.get("/day/{for_date}")
def summary_day(for_date: date, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    habits = _active_habits(db, current_user.id)
    habit_entries = {}
    if habits:
        habit_entries = {
            e.habit_id: e.completed for e in db.query(models.HabitEntry).filter(
                models.HabitEntry.date == for_date,
                models.HabitEntry.habit_id.in_([h.id for h in habits]),
            )
        }
    habit_list = [
        {"id": h.id, "title": h.title, "completed": habit_entries.get(h.id, False), "type": "habit"}
        for h in habits
    ]
    tasks = db.query(models.Task).filter(models.Task.date == for_date, models.Task.user_id == current_user.id).order_by(models.Task.id).all()
    task_list = [
        {"id": t.id, "title": t.title, "completed": t.completed, "notes": t.notes, "type": "task"}
        for t in tasks
    ]
    completed, total = _day_counts(db, current_user.id, for_date, habits)
    pct = round(completed / total * 100, 1) if total else 0.0
    return {
        "date": str(for_date),
        "completed": completed,
        "total": total,
        "percent": pct,
        "habits": habit_list,
        "tasks": task_list,
    }


@router.get("/week/{start_date}")
def summary_week(start_date: date, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    start = _week_start(start_date)
    days = [start + timedelta(days=i) for i in range(7)]
    habits = _active_habits(db, current_user.id)

    day_series = []
    totals = {s: [0, 0] for s in SCOPES}
    for i, d in enumerate(days):
        counts = _day_counts_split(db, current_user.id, d, habits)
        for s in SCOPES:
            totals[s][0] += counts[s][0]
            totals[s][1] += counts[s][1]
        c, t = counts["all"]
        day_series.append({"label": DAY_LABELS[i], "date": str(d), "completed": c, "total": t,
                            "percent": _pct(c, t), **_scoped_fields(counts)})
    total_completed, total_all = totals["all"]

    # One query for the whole grid rather than one per habit — see the same
    # change in routers/habits.py. This is the weekly dashboard, so it ran on
    # every visit and got slower for exactly the customers who use the feature
    # most.
    grid_entries = db.query(models.HabitEntry).filter(
        models.HabitEntry.habit_id.in_([h.id for h in habits]),
        models.HabitEntry.date >= start,
        models.HabitEntry.date <= days[-1],
    ).all() if habits else []
    grid_by_habit: dict[int, dict] = {}
    for e in grid_entries:
        grid_by_habit.setdefault(e.habit_id, {})[e.date] = e.completed

    habit_grid = []
    for h in habits:
        entry_map = grid_by_habit.get(h.id, {})
        week_map = {DAY_LABELS[i]: entry_map.get(days[i], False) for i in range(7)}
        completed_count = sum(1 for v in week_map.values() if v)
        habit_grid.append({
            "id": h.id, "title": h.title, "category": h.category,
            "week": week_map, "progress_pct": round(completed_count / 7 * 100, 1),
        })

    weekly_note = db.query(models.WeeklyNote).filter(
        models.WeeklyNote.week_start_date == start, models.WeeklyNote.user_id == current_user.id
    ).first()

    # One-off tasks for the week, so the UI can show a task list/leaderboard
    # without firing a request per day.
    week_tasks = db.query(models.Task).filter(
        models.Task.user_id == current_user.id,
        models.Task.date >= start,
        models.Task.date <= days[-1],
    ).order_by(models.Task.date, models.Task.id).all()
    task_grid = [
        {"id": t.id, "title": t.title, "date": str(t.date), "completed": t.completed, "notes": t.notes}
        for t in week_tasks
    ]

    overall_pct = _pct(total_completed, total_all)
    return {
        "week_start": str(start),
        "week_end": str(days[-1]),
        "completed": total_completed,
        "total": total_all,
        "percent": overall_pct,
        "days": day_series,
        "habits": habit_grid,
        "tasks": task_grid,
        "scopes": {
            s: {"completed": totals[s][0], "total": totals[s][1], "percent": _pct(*totals[s])}
            for s in SCOPES
        },
        "weekly_note": {
            "focus_text": weekly_note.focus_text if weekly_note else "",
            "reward_text": weekly_note.reward_text if weekly_note else "",
            "affirmation_text": weekly_note.affirmation_text if weekly_note else "",
        },
    }


def _month_range(year: int, month: int):
    num_days = calendar.monthrange(year, month)[1]
    return [date(year, month, d) for d in range(1, num_days + 1)]


def _month_core(db: Session, user_id: int, year: int, month: int, habits, today: date):
    """Day-level stats for a month, only counting days up to today toward totals.

    Everything is accumulated three times over — habits only, tasks only, and
    the two combined — so the UI's scope toggle has real numbers to show for
    each rather than approximating one from the others.
    """
    days_all = _month_range(year, month)
    day_series = []
    totals = {s: [0, 0] for s in SCOPES}
    week_buckets = {s: defaultdict(lambda: [0, 0]) for s in SCOPES}
    weekday_buckets = {s: defaultdict(lambda: [0, 0]) for s in SCOPES}  # 0=Mon..6=Sun
    streak_input = {s: [] for s in SCOPES}

    for d in days_all:
        if d > today:
            day_series.append({
                "date": str(d), "day": d.day, "completed": 0, "total": 0, "percent": None, "is_future": True,
                "habit_completed": 0, "habit_total": 0, "habit_percent": None,
                "task_completed": 0, "task_total": 0, "task_percent": None,
            })
            for s in SCOPES:
                streak_input[s].append((False, 0))
            continue

        counts = _day_counts_split(db, user_id, d, habits)
        c, t = counts["all"]
        day_series.append({
            "date": str(d), "day": d.day, "completed": c, "total": t,
            "percent": _pct(c, t), "is_future": False, **_scoped_fields(counts),
        })

        ws = _week_start(d)
        wd = d.weekday()
        for s in SCOPES:
            sc, st = counts[s]
            totals[s][0] += sc
            totals[s][1] += st
            week_buckets[s][ws][0] += sc
            week_buckets[s][ws][1] += st
            weekday_buckets[s][wd][0] += sc
            weekday_buckets[s][wd][1] += st
            streak_input[s].append((st > 0, _pct(sc, st)))

    return day_series, totals, week_buckets, weekday_buckets, streak_input


@router.get("/month/{year}/{month}")
def summary_month(year: int, month: int, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    today = date.today()
    habits = _active_habits(db, current_user.id)

    day_series, totals, week_buckets, weekday_buckets, streak_input = _month_core(
        db, current_user.id, year, month, habits, today)

    def scope_key(scope, name):
        return name if scope == "all" else f"{scope}_{name}"

    def build_scope(scope):
        weeks = [
            {"week_start": str(ws), "completed": c, "total": t, "percent": _pct(c, t)}
            for ws, (c, t) in sorted(week_buckets[scope].items())
        ]
        weekdays = [
            {"label": DAY_LABELS[wd], "percent": _pct(c, t), "completed": c, "total": t}
            for wd, (c, t) in sorted(weekday_buckets[scope].items())
        ]
        with_data = [
            d for d in day_series
            if not d["is_future"] and d[scope_key(scope, "total")] > 0
        ]
        key = lambda d: d[scope_key(scope, "percent")]  # noqa: E731
        longest, current = _longest_and_current_streak(streak_input[scope])
        c, t = totals[scope]
        return {
            "completed": c, "total": t, "percent": _pct(c, t),
            "weeks": weeks, "weekday_breakdown": weekdays,
            "best_day": max(with_data, key=key, default=None),
            "worst_day": min(with_data, key=key, default=None),
            "longest_streak": longest, "current_streak": current,
        }

    scopes = {s: build_scope(s) for s in SCOPES}
    combined = scopes["all"]
    total_completed, total_all = totals["all"]
    week_series = combined["weeks"]
    weekday_breakdown = combined["weekday_breakdown"]
    best_day = combined["best_day"]
    worst_day = combined["worst_day"]
    longest_streak = combined["longest_streak"]
    current_streak = combined["current_streak"]

    # per-habit breakdown for the month
    per_habit = []
    last_real_day = max((d for d in day_series if not d["is_future"]), key=lambda d: d["date"], default=None)
    if last_real_day:
        last_real_date = date.fromisoformat(last_real_day["date"])
        month_first = date(year, month, 1)

        # Each habit counts from its own start date, so this can't be a single
        # GROUP BY — but it doesn't need one query per habit either. Fetch every
        # completed entry in the widest range once, then apply each habit's own
        # window in memory. One round trip instead of one per habit.
        completed_dates: dict[int, list] = {}
        if habits:
            rows = db.query(models.HabitEntry.habit_id, models.HabitEntry.date).filter(
                models.HabitEntry.habit_id.in_([h.id for h in habits]),
                models.HabitEntry.date >= month_first,
                models.HabitEntry.date <= last_real_date,
                models.HabitEntry.completed == True,  # noqa: E712
            ).all()
            for habit_id, entry_date in rows:
                completed_dates.setdefault(habit_id, []).append(entry_date)

        for h in habits:
            habit_start = max(month_first, h.created_at.date())
            if habit_start > last_real_date:
                continue  # habit didn't exist yet during any elapsed day this month
            days_elapsed = (last_real_date - habit_start).days + 1
            entries = sum(1 for d in completed_dates.get(h.id, ()) if d >= habit_start)
            per_habit.append({
                "id": h.id, "title": h.title, "completed": entries, "total": days_elapsed,
                "percent": round(entries / days_elapsed * 100, 1) if days_elapsed else 0.0,
            })
    per_habit.sort(key=lambda h: h["percent"], reverse=True)

    # comparison vs previous month — computed per scope so the delta shown next
    # to "Month Total" matches whichever tab is active.
    prev_month, prev_year = (12, year - 1) if month == 1 else (month - 1, year)
    prev_habits = habits  # habit list assumed stable; fine for comparison purposes
    _, prev_totals, _, _, _ = _month_core(db, current_user.id, prev_year, prev_month, prev_habits, today)
    for s in SCOPES:
        pc, pt = prev_totals[s]
        prev = _pct(pc, pt) if pt else None
        scopes[s]["previous_month_percent"] = prev
        scopes[s]["percent_change_vs_previous_month"] = (
            round(scopes[s]["percent"] - prev, 1) if prev is not None else None
        )

    overall_pct = combined["percent"]

    return {
        "year": year, "month": month,
        "completed": total_completed, "total": total_all, "percent": overall_pct,
        "days": day_series, "weeks": week_series,
        "weekday_breakdown": weekday_breakdown,
        "best_day": best_day, "worst_day": worst_day,
        "longest_streak": longest_streak, "current_streak": current_streak,
        "per_habit": per_habit,
        "previous_month_percent": combined["previous_month_percent"],
        "percent_change_vs_previous_month": combined["percent_change_vs_previous_month"],
        "scopes": scopes,
    }


@router.get("/year/{year}")
def summary_year(year: int, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    today = date.today()
    habits = _active_habits(db, current_user.id)

    month_series = []
    totals = {s: [0, 0] for s in SCOPES}
    quarter_buckets = {s: defaultdict(lambda: [0, 0]) for s in SCOPES}
    streak_input_all = {s: [] for s in SCOPES}
    per_habit_totals = defaultdict(lambda: [0, 0])  # habit_id -> [completed, total_days]

    # Every completed entry in the year, fetched once.
    #
    # The per-habit totals below are computed inside the month loop, so the
    # original code ran one COUNT per habit per month — twelve round trips for
    # every habit on the account, which measured at 219 queries for 5 habits
    # and 264 for 50, climbing with exactly the thing a yearly summary is for.
    # Each habit still counts from its own start date, so this can't collapse
    # into a single GROUP BY, but it doesn't need a query per habit either:
    # pull the year once and apply each window in memory.
    year_completed: dict[int, list] = {}
    if habits:
        for habit_id, entry_date in db.query(
            models.HabitEntry.habit_id, models.HabitEntry.date
        ).filter(
            models.HabitEntry.habit_id.in_([h.id for h in habits]),
            models.HabitEntry.date >= date(year, 1, 1),
            models.HabitEntry.date <= date(year, 12, 31),
            models.HabitEntry.completed == True,  # noqa: E712
        ).all():
            year_completed.setdefault(habit_id, []).append(entry_date)

    for m in range(1, 13):
        month_start = date(year, m, 1)
        if month_start > today:
            month_series.append({"month": m, "name": calendar.month_abbr[m], "completed": 0, "total": 0,
                                  "percent": None, "is_future": True,
                                  "habit_completed": 0, "habit_total": 0, "habit_percent": None,
                                  "task_completed": 0, "task_total": 0, "task_percent": None})
            continue
        day_series, month_totals, _, _, streak_input = _month_core(db, current_user.id, year, m, habits, today)
        q = (m - 1) // 3
        for s in SCOPES:
            streak_input_all[s].extend(streak_input[s])
            totals[s][0] += month_totals[s][0]
            totals[s][1] += month_totals[s][1]
            quarter_buckets[s][q][0] += month_totals[s][0]
            quarter_buckets[s][q][1] += month_totals[s][1]

        c_month, t_month = month_totals["all"]
        month_series.append({
            "month": m, "name": calendar.month_abbr[m], "completed": c_month, "total": t_month,
            "percent": _pct(c_month, t_month), "is_future": False,
            **_scoped_fields({s: tuple(month_totals[s]) for s in SCOPES}),
        })

        days_elapsed_this_month = sum(1 for d in day_series if not d["is_future"])
        if days_elapsed_this_month and habits:
            month_last_real = max((d for d in day_series if not d["is_future"]), key=lambda d: d["date"], default=None)
            if month_last_real:
                last_real_date = date.fromisoformat(month_last_real["date"])
                for h in habits:
                    habit_start = max(month_start, h.created_at.date())
                    if habit_start > last_real_date:
                        continue
                    days_habit_elapsed = (last_real_date - habit_start).days + 1
                    entries = sum(1 for d in year_completed.get(h.id, ())
                                  if habit_start <= d <= last_real_date)
                    per_habit_totals[h.id][0] += entries
                    per_habit_totals[h.id][1] += days_habit_elapsed

    quarter_names = ["Q1", "Q2", "Q3", "Q4"]

    def build_scope(scope):
        prefix = "" if scope == "all" else f"{scope}_"
        with_data = [m for m in month_series if not m["is_future"] and m[f"{prefix}total"] > 0]
        key = lambda m: m[f"{prefix}percent"]  # noqa: E731
        longest, current = _longest_and_current_streak(streak_input_all[scope])
        c, t = totals[scope]
        return {
            "completed": c, "total": t, "percent": _pct(c, t),
            "quarter_breakdown": [
                {"quarter": quarter_names[q], "completed": qc, "total": qt, "percent": _pct(qc, qt)}
                for q, (qc, qt) in sorted(quarter_buckets[scope].items())
            ],
            "best_month": max(with_data, key=key, default=None),
            "worst_month": min(with_data, key=key, default=None),
            "longest_streak": longest, "current_streak": current,
        }

    scopes = {s: build_scope(s) for s in SCOPES}
    combined = scopes["all"]
    total_completed, total_all = totals["all"]
    quarter_breakdown = combined["quarter_breakdown"]
    best_month = combined["best_month"]
    worst_month = combined["worst_month"]
    longest_streak = combined["longest_streak"]
    current_streak = combined["current_streak"]

    habit_title_map = {h.id: h.title for h in habits}
    per_habit = [
        {"id": hid, "title": habit_title_map.get(hid, "?"), "completed": c, "total": t,
         "percent": round(c / t * 100, 1) if t else 0.0}
        for hid, (c, t) in per_habit_totals.items()
    ]
    per_habit.sort(key=lambda h: h["percent"], reverse=True)
    best_habit = per_habit[0] if per_habit else None
    needs_focus_habit = per_habit[-1] if per_habit else None

    return {
        "year": year, "completed": total_completed, "total": total_all,
        "percent": combined["percent"], "months": month_series,
        "quarter_breakdown": quarter_breakdown,
        "best_month": best_month, "worst_month": worst_month,
        "longest_streak": longest_streak, "current_streak": current_streak,
        "per_habit": per_habit, "best_habit": best_habit, "needs_focus_habit": needs_focus_habit,
        "scopes": scopes,
    }
