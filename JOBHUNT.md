# Job Hunt

Searches company job boards directly and tells you what's new, once a day.

## Why not a scraper

The well-known job scrapers ([JobSpy](https://github.com/speedyapply/JobSpy) and
friends) reverse-engineer LinkedIn's, Indeed's and Glassdoor's private
endpoints. They break whenever those sites change markup — LinkedIn changed
three times in 2025 — they get IP-blocked, and they breach those sites' terms.

Almost every company on **Greenhouse, Lever, Ashby, Workable, SmartRecruiters
or Recruitee** has a public, unauthenticated JSON endpoint, because the ATS
needs one to draw the careers page on the company's own marketing site. Those
endpoints are meant to be read by third parties: no auth, no anti-bot,
structured data, and they don't move.

The honest limitation: a company on Workday, Taleo or a bespoke careers page
won't appear. This is not "every company on the internet" — it is most tech and
startup employers, read reliably, rather than everything read unreliably.

## Using it

**Job Hunt** in the sidebar.

1. **Role** — words that must appear in the job title. Comma-separated, any one
   matches: `data engineer, analytics engineer, python`.
2. **Country or city** — matched against the posting's location text. Country
   names, ISO codes and common synonyms are treated as the same place, so
   `Ireland` finds `Dublin, ie` and `UK` finds `Manchester, United Kingdom`.
   Blank means anywhere. Remote postings always pass a location filter.
3. **Exclude** — words that disqualify a title, e.g. `intern, principal`.
4. **Posted within** — the most useful filter in a job hunt. A three-month-old
   listing is usually filled.
5. **Referral contacts** — people who could refer you, by company. A match at
   one of those companies is flagged in the list *and* in the Telegram alert,
   because that job is a different proposition to a cold application.

**Search now** runs immediately. With `Search every day automatically` on, it
also runs once a day at your Telegram morning-card time, and messages you only
what you haven't already been shown.

**Track** copies a posting into Job Applications, so found work lands in the
pipeline you already manage.

## Companies

The Companies tab lists every board being searched, grouped by platform. Add
one by pasting any careers URL — `boards.greenhouse.io/acme`,
`jobs.lever.co/acme`, `jobs.ashbyhq.com/acme`, `apply.workable.com/acme`,
`jobs.smartrecruiters.com/Acme`, `acme.recruitee.com` — and the platform and
company id are worked out from it.

`backend/app/jobhunt/companies.json` seeds a shared starter registry on first
startup. **Those tokens were compiled from public careers pages and companies
move between platforms**, so check them against the live APIs:

```
cd backend
python verify_boards.py          # report which are real and how many jobs each has
python verify_boards.py --fix    # deactivate the dead ones
```

The registry also heals itself: a board that returns 404/403 on three
consecutive runs deactivates automatically, so a stale seed list stops costing
requests rather than silently rotting.

## How the pieces fit

| File | Responsibility |
| --- | --- |
| `app/jobhunt/providers.py` | One adapter per ATS: fetch public JSON, normalise to one job shape, tolerate schema drift |
| `app/jobhunt/registry.py` | Which boards get searched; add-by-URL; retiring dead boards |
| `app/jobhunt/search.py` | Concurrent fetch, role/location/date matching, fingerprint + dedupe, new-vs-seen |
| `app/jobhunt/daily.py` | The once-a-day sweep and the Telegram message |
| `app/routers/jobhunt.py` | `/api/job-hunt/*` |
| `backend/verify_boards.py` | Checks every registry entry against its live API |

New tables: `company_boards`, `job_searches`, `job_hits`, `referral_contacts`.

## Design notes

- **A hit is stored, not just displayed.** Without a record of what was shown
  there is no way to tell a fresh opening from one you saw yesterday, which is
  the entire value of a daily run — the alternative is a message every morning
  listing the same forty jobs.
- **Fingerprints exclude the date.** Some providers bump `updated_at` on every
  edit, and an identity that moved with it would report the same job as new
  every morning.
- **Dismissing is permanent.** A dismissed hit stays in the table precisely so
  it is never offered again; only its visibility changes.
- **Alerts are marked sent before the send.** A message that fails to deliver
  costs one morning's alert. A crash between sending and marking would repeat
  the same jobs daily until somebody noticed.
- **Eight workers, not sixty.** These endpoints are free and public. Hammering
  them all at once is how that stops being true.
