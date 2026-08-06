"""Plans, limits, and the quota check the extension runs into.

There is deliberately no payment processor here. Wiring Stripe needs keys, a
webhook endpoint and a decision about currency and price, none of which belong
in a guess — so this layer owns the part that has to exist first: what a plan
is, what it allows, and how the app answers when someone runs out. Swapping the
`upgrade_url` for a real checkout session is then a one-line change.

The quota is counted, never stored as a running total. A counter column drifts
the moment anything deletes a row or a request fails halfway; counting rows in
the current period is always right and cheap enough at this scale.
"""

from __future__ import annotations

from datetime import date, datetime

from sqlalchemy.orm import Session

from . import models

FREE = "free"
PRO = "pro"

# What each plan allows. `None` means unlimited.
PLANS: dict[str, dict] = {
    FREE: {
        "name": "Free",
        "captures_per_month": 15,
        "boards": 1,
        "tailored_resumes_per_month": 3,
    },
    PRO: {
        "name": "Pro",
        "captures_per_month": None,
        "boards": None,
        "tailored_resumes_per_month": None,
    },
}


def plan_of(user: models.User) -> str:
    """The user's plan, defaulting to free.

    Read defensively: the column is added by a startup migration, so an object
    loaded from an older row can legitimately have it unset.
    """
    value = (getattr(user, "plan", None) or FREE).lower()
    return value if value in PLANS else FREE


def limits_for(user: models.User) -> dict:
    return PLANS[plan_of(user)]


def period_start(today: date | None = None) -> datetime:
    """Quotas run on calendar months — the same boundary a subscription
    renews on, so 'resets on the 1st' is a thing that can be said plainly."""
    d = today or date.today()
    return datetime(d.year, d.month, 1)


def captures_this_period(db: Session, user: models.User) -> int:
    """Applications created this month. Every capture makes exactly one, and
    an application added by hand in the app costs the same as one captured by
    the extension — otherwise the limit is trivially avoidable."""
    return (
        db.query(models.JobApplication)
        .filter(
            models.JobApplication.user_id == user.id,
            models.JobApplication.created_at >= period_start(),
        )
        .count()
    )


def capture_quota(db: Session, user: models.User) -> dict:
    """Everything a client needs to render a quota state in one call."""
    limit = limits_for(user)["captures_per_month"]
    used = captures_this_period(db, user)
    return {
        "plan": plan_of(user),
        "plan_name": limits_for(user)["name"],
        "used": used,
        "limit": limit,
        "remaining": None if limit is None else max(0, limit - used),
        "exhausted": limit is not None and used >= limit,
        # Warn before the wall rather than at it — running out mid-application
        # is the worst moment to discover a limit exists.
        "warn": limit is not None and limit - used <= 3 and used < limit,
        "period_resets": period_start().replace(
            month=1 if period_start().month == 12 else period_start().month + 1,
            year=period_start().year + 1 if period_start().month == 12 else period_start().year,
        ).date().isoformat(),
    }
