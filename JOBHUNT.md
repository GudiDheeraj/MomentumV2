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

Companies **not** on those six platforms — Workday, Taleo, a hand-built careers
page — are covered by a third provider, `site`, which reads the page's
schema.org `JobPosting` structured data. That isn't a heuristic: Google for Jobs
requires it, so any careers page that wants to appear in Google's job results
already publishes clean, structured job data. Parsing that survives a redesign,
because it isn't reading the design. robots.txt is checked before each fetch.

If a page builds its listings in JavaScript there is nothing in the HTML to
read. Set `FIRECRAWL_API_URL` to a self-hosted
[Firecrawl](https://github.com/firecrawl/firecrawl) (AGPL-3.0, `docker compose
up` in its repo, default port 3002) and those pages become readable too. It is
entirely optional — unset, everything else still works and the app depends on
no external service.

## Applying

The **Application profile** tab stores the answers every form asks for, once:
contact details, work eligibility, visa status, sponsorship, notice period,
salary expectation, experience. With the Chrome extension installed, open any
application form and press **Fill this application**. It fills what it can,
outlines those fields in blue, and outlines in amber anything required that it
couldn't answer — then stops.

It does not submit, and that is a decision rather than an unfinished feature.
An application form is a set of statements *you* are making: that you are
authorised to work somewhere, that a visa claim is accurate, that everything
entered is true. A script that submits those has made a declaration you never
saw. Auto-submission also means defeating the page's bot detection, and
mass-submitted applications are the easiest thing in the world for a recruiter
to spot and filter out. Filling takes the three minutes of typing away; the
three seconds of review are the part worth keeping.

Gender, ethnicity, disability and veteran status are deliberately not stored.
On a real application those are voluntary EEO self-identification, legally
separated from the hiring decision, and special-category data under UK GDPR.
Answer them on the form, or leave them blank — which is always allowed.

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

### The Forbes Global 2000

`backend/app/jobhunt/data/forbes_global_2000_2026.csv` is the 2026 Global 2000:
rank, company, domain, country, industry, for the two thousand largest listed
companies in the world. It is a list of companies, not of job boards, and
nothing maps one to the other, so each company has to be probed:

```
.\resolve-boards.bat                       # or, from backend\ with the venv active:
python resolve_boards.py                   # the whole list, resumable
python resolve_boards.py --country "United Kingdom"
python resolve_boards.py --limit 100       # a taste before committing an hour
python resolve_boards.py --report          # rebuild outputs from the checkpoint
```

It derives plausible slugs from each company's name and domain, tries them
against the six ATS APIs, and keeps the ones that answer **with at least one
live posting** *and* **check out as the right company**.

Both conditions are load bearing. Every one of these APIs returns 200 and an
empty list for a token that exists but belongs to nobody, so a successful
request proves nothing. And a slug that answers is not the same as a slug that
belongs to you: a first pass without the second check resolved London Stock
Exchange to `greenhouse/london`, which is a clothing brand called Aimé Leon
Dore; General Dynamics to `greenhouse/general`, a generic "General Interest"
page; and Industrial Bank to `greenhouse/industrial`, the Industrial Door
Company. Five of seven matches in a fifty-six company sample were wrong.

So candidates are split in two. A **strong** candidate is the company's own
name run together, or its domain stem: if a board answers to that, it is the
company. Everything else — a first word, a two word prefix, a three letter
domain — is **weak** and has to be confirmed. Greenhouse, Workable,
SmartRecruiters and Recruitee all publish the board's own display name, which
is compared against the company name head first, since company names are built
head first and "Punjab" carries the identity that "National Bank" does not.
Lever and Ashby publish no name at all, so on those two only a strong candidate
is ever accepted.

`data/resolve_report.csv` records the board name and how each match was
confirmed, so the whole thing is auditable rather than trusted.

Companies that match no ATS get one careers page check, using the same
schema.org reader the `site` provider uses at search time. If the page
publishes structured job data the company is registered as a `site` board. If
it does not, it is recorded as unresolved and skipped, because registering it
would buy a daily fetch that can never return anything.

Output lands in `companies_global2000.json`, which the registry seeds from on
startup alongside the hand checked `companies.json`. Two files rather than one
so that regenerating two thousand machine resolved rows can never clobber the
sixty that were verified by hand. `data/resolve_report.csv` has the full
per company detail, including the misses and what was tried.

### What to actually expect

Measured, not estimated. A random 56 company sample of the Global 2000 probed
against all six platforms resolved **2 companies**, both genuine, for a rate of
about 3.6 percent. Extrapolated, that is somewhere near 70 to 100 boards out of
2000, before the careers page fallback adds whatever it adds.

That is the honest shape of this list. Greenhouse, Lever and Ashby are where
technology companies and startups hire. The Global 2000 is a ranking by revenue
and assets, so it is overwhelmingly banks, insurers, utilities, miners and
industrials, and those run Workday, Taleo or SuccessFactors, none of which
publish anything readable. Being enormous and being reachable through an open
JSON endpoint turn out to be close to unrelated.

The list is still worth having, and the ones it does find are real. But if the
goal is volume of relevant openings rather than coverage of famous names, a
curated list of employers who actually use these six platforms will beat the
Global 2000 by a wide margin.

## The daily sweep

Searching used to fetch every board live, on every run. That is sound at sixty
boards and impossible at two thousand: two thousand outbound requests behind a
button press, minutes before the page can answer, and a level of traffic that
would rightly get the app blocked by the free public endpoints it depends on.

So the network work moved to a scheduled sweep. Once a day at **12:00 UTC**
(`JOBHUNT_SWEEP_UTC`) every active board is read once and everything found is
written to `job_postings`. Searching then queries that table, which is instant.
The Job Hunt tab shows when the cache was last refreshed, because otherwise
"no new jobs" and "nothing has been fetched since Tuesday" look identical.

UTC rather than local time because the sweep serves every user at once and
there is no one person's timezone to follow. In Britain that is noon in winter
and 13:00 in summer, since UK clocks move and UTC does not.

A sweep does three things, in this order:

1. **Upsert.** Every posting seen gets created or refreshed and stamped with
   this run's time.
2. **Close.** Any posting on a board that answered successfully, but which this
   run did not see, has been taken down. It is stamped `closed_at` and stops
   appearing. Boards that *failed* are skipped here on purpose: a timeout is
   not evidence that a company withdrew every job it had.
3. **Purge.** Postings past the retention window, and closed ones past a short
   grace period, are deleted, and so are the hits that pointed at them.

### Retention

`JOBHUNT_RETENTION_DAYS` (default 7) is the age at which a posting leaves the
app whether or not it is still on the board. A listing you were shown a week
ago and did not act on is not news any more, and keeping it makes the list grow
without bound.

Hits you acted on are exempt. A saved posting, or one turned into a tracked
application, is yours rather than the sweep's, and deleting it would destroy
work. Dismissed hits are kept too, as tombstones: they are already invisible,
they cost one row each, and removing them would let a job you deliberately hid
reappear on the next sweep.

### If you cannot wait for noon

**Refresh now** on the Job Hunt tab starts a sweep immediately and returns
straight away, because a request held open for the several minutes a full sweep
takes is a request the browser gives up on. One sweep runs at a time, process
wide: two overlapping sweeps would each read the other's half written rows as
postings the board no longer lists, and would close them.

## How the pieces fit

| File | Responsibility |
| --- | --- |
| `app/jobhunt/providers.py` | One adapter per ATS: fetch public JSON, normalise to one job shape, tolerate schema drift |
| `app/jobhunt/pagescrape.py` | The `site` provider: robots check, schema.org JobPosting extraction, optional Firecrawl |
| `extension/autofill.js` | Fills an application form from the profile; never submits |
| `app/jobhunt/registry.py` | Which boards get searched; add-by-URL; retiring dead boards |
| `app/jobhunt/sweep.py` | The scheduled read of every board: upsert, close what vanished, purge what expired |
| `app/jobhunt/scheduler.py` | The 12:00 UTC clock behind the sweep, and the cold start on a fresh install |
| `app/jobhunt/search.py` | Matching against the cache: role/location/date, fingerprint + dedupe, new-vs-seen |
| `app/jobhunt/daily.py` | The per person daily search and the Telegram message |
| `app/routers/jobhunt.py` | `/api/job-hunt/*`, including `/sweep` |
| `backend/resolve_boards.py` | Resolves the Forbes Global 2000 to ATS boards |
| `backend/verify_boards.py` | Checks every registry entry against its live API |

New tables: `company_boards`, `job_postings`, `board_sweeps`, `job_searches`,
`job_hits`, `referral_contacts`, `application_profiles`.

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
