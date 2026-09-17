# Momentum Tracker

A personal habit, task, study, and job-application tracker with a built-in
resume builder, ATS scorer, cover letter generator, and local AI assistant.

## Configuration — everything lives in ONE file: `.env`

All connection settings — database, CORS, auth secret, Google Sign-In, local
AI model settings, and where the frontend finds the backend — are now in a
single root-level `.env` file. A template with the same fields is at
`.env.example`.

**Two variables define every URL in the system:**

| Variable | Default | Everything derived from it |
|---|---|---|
| `BACKEND_URL` | `http://localhost:8000` | `window.MOMENTUM_API_BASE` (frontend/env.js), the extension's default API base, and the host port docker publishes for the backend |
| `FRONTEND_URL` | `http://localhost:5173` | CORS allowed origin, the Telegram card's "Open app" button (https only), and the host port docker publishes for the frontend |

Change a port or move to a real domain by editing those two lines and running
`python generate_frontend_env.py` — nothing else references a URL.

Everything else:

| Variable | Used by | What it configures |
|---|---|---|
| `DATABASE_URL` | backend | SQLite (default) or PostgreSQL connection string |
| `MOMENTUM_SECRET_KEY` | backend | Signs login tokens |
| `GOOGLE_CLIENT_ID` | frontend + backend | Google Sign-In (shared, one value for both) |
| `TELEGRAM_*` | backend | Daily card bot — see [TELEGRAM.md](TELEGRAM.md) |
| `TUTORIAL_VIDEO_URL` | frontend | The walkthrough on the Home page and in Helpful resources. Any YouTube URL form works; blank hides the card |
| `MOMENTUM_LLM_*` | backend | Local AI model tuning (optional) |
| `MOMENTUM_API_BASE`, `FRONTEND_ORIGINS`, `APP_PUBLIC_URL` | both | Optional overrides, for when the browser reaches a service at a different address than the one it's served on (tunnels, proxies, multiple origins) |

`BACKEND_PORT` / `FRONTEND_PORT` also appear in `.env`, because docker-compose
reads that file directly and can't parse a URL. They are rewritten from the two
URLs by `generate_frontend_env.py`, so don't edit them by hand.

**Why there are still two physical files:** browsers can't read `.env`
files directly, so the frontend's config still has to exist as a real JS
file, `frontend/env.js`, that sets `window.*` globals. You never edit that
file by hand though — it's auto-generated from the root `.env`:

```
python generate_frontend_env.py
```

Run that after editing `.env` (if you're not using Docker — see below,
Docker does this automatically on every container start).

## Running it

**With Docker (recommended — one env file, one command):**
```
docker compose up --build
```
This builds and runs both frontend and backend, both reading from the root
`.env`. The frontend container regenerates `frontend/env.js` on every
startup, so editing `.env` and running `docker compose up` again is all you
need — no manual sync step.

**Without Docker:**

Backend (FastAPI):
```
cd backend
pip install -r requirements.txt --break-system-packages
python seed.py   # creates momentum.db with demo data (optional but recommended)
uvicorn app.main:app --reload
```
It reads `.env` from the project root automatically.

Frontend — sync its config, then serve it as static files:
```
python generate_frontend_env.py
cd frontend
python -m http.server 5173
```
Then open `index.html` in the browser.

`http.server` is fine for poking at the app locally, but it is single-threaded
and sends everything uncompressed — about 850KB of JavaScript and CSS that
gzips to roughly 210KB. **Use `docker compose up` for anything you actually
measure or deploy**: the frontend container runs nginx with compression and
cache headers (see `frontend/nginx.conf`).

### Optional: Redis

Rendered résumé PDFs, ATS scores and local-LLM responses are cached. With
`REDIS_URL` set they go to Redis; without it they go to a bounded in-process
cache. Nothing requires Redis — the app runs, and keeps running if Redis goes
down, either way. `docker compose up` starts one and wires it up for you.
It becomes worth having when you run more than one backend replica, since an
in-process cache is per-worker and each replica would otherwise warm its own.

Demo login: `demo@momentum.app` / `demo123`
Admin login: `admin@momentum.app` / `admin123`

## Deploying (frontend and backend on different hosts, or dev tunnels)

**If the app loads but shows a red "backend not connecting" banner**, this
is almost always the cause: the frontend and backend are running on
different domains/ports (very common with dev tunnels, e.g. VS Code
devtunnels or GitHub Codespaces, where each forwarded port gets its own
URL), and the frontend doesn't know where to find the backend.

Edit both values in the one root `.env` file — they need to agree with
each other:

```
MOMENTUM_API_BASE=https://your-backend-url.com     # no trailing slash
FRONTEND_ORIGINS=https://your-frontend-url.com
```

Then:
- Docker: `docker compose up --build` picks both up automatically.
- Manual: re-run `python generate_frontend_env.py` and restart the backend
  (env vars are only read on startup).

**Dev tunnel example** (VS Code "Ports" panel, or `gh codespace ports`):
if your frontend is forwarded on port 5173 giving you a URL like
`https://abc123-5173.uks1.devtunnels.ms`, forward your backend's port
(commonly 8000) too — **set its visibility to Public**, not just
"private to you" — and you'll get a matching URL like
`https://abc123-8000.uks1.devtunnels.ms`. That's what goes in
`MOMENTUM_API_BASE`. Put the frontend's URL in `FRONTEND_ORIGINS`.

The app actively checks the backend connection on load and shows a banner
with a troubleshooting checklist if it can't reach it, instead of failing
silently — covers the port-forwarding, CORS, and typo cases above.

If you're serving both frontend and backend from the exact same domain
(e.g. a reverse proxy routing `/api` to the backend), you can leave
`MOMENTUM_API_BASE` blank in `.env` and it'll default to same-origin
automatically.

## Setting up Google Sign-In

Google Sign-In is fully wired up in the code (frontend button + backend
token verification) but disabled by default — the button simply stays
hidden until you provide a Google OAuth Client ID. It's free and takes a
few minutes:

1. Go to the [Google Cloud Console](https://console.cloud.google.com/) and
   create a project (or use an existing one).
2. Go to **APIs & Services > Credentials**.
3. Click **Create Credentials > OAuth client ID**.
   - If prompted, configure the OAuth consent screen first (External is
     fine for testing; you don't need to submit it for verification while
     testing with your own Google account).
   - Application type: **Web application**.
   - Under **Authorized JavaScript origins**, add the URL(s) you'll serve
     the frontend from, e.g. `http://localhost:8080` and/or your production
     domain, or your dev tunnel's frontend URL. No path, no trailing slash.
4. Copy the generated **Client ID** (looks like
   `123456789-abc123.apps.googleusercontent.com`).
5. Set it once, in the root `.env`:
   ```
   GOOGLE_CLIENT_ID=your-client-id-here.apps.googleusercontent.com
   ```
   One value, used by both frontend and backend — no need to set it twice.
6. Docker: `docker compose up --build`. Manual: re-run
   `python generate_frontend_env.py` and restart the backend. The
   "Continue with Google" button appears on the login screen automatically —
   no other code changes needed.

If the Client ID isn't set, the app works exactly as before with email and
password; nothing else is affected.

## Phone, tablet and desktop

The app is one layout that takes three shapes. There is no separate mobile
build and no second set of templates — every screen below is the same markup
under a different set of rules, which is why the desktop rendering is
byte-for-byte what it was (verified: 0 of 94 measured elements move at 1440px).

What changes as the screen narrows:

- **The app bar** (every page). Below 900px the title keeps the first row and
  the view tabs drop to a line of their own that scrolls sideways and snaps to
  whole tabs. Before this, `#app > main` had `overflow-x: hidden`, so tabs that
  didn't fit were not merely cramped — they were cut off with no scrollbar and
  no way to reach them. On a 390px phone that was 148px of the Dashboard's tabs
  missing, 235px of the Tracker's and 383px of the Job Applications page's.
- **The applications table** becomes a stack of cards below 640px. Same
  renderer: the table carries `class="rt"` and each cell a `data-label`, and
  the stylesheet restacks it, promoting company and role to a heading pair and
  gathering the row's buttons at the foot of the card. The `<thead>` stays in
  the accessibility tree rather than being deleted.
- **The kanban board** gives each column `min(84vw, 300px)` with scroll-snap
  below 700px, so one column fills the screen with a sliver of the next
  showing — which is what tells you the board scrolls at all.
- **Grids that must stay grids** don't get restacked. The habit tracker is
  habit × weekday; turning that into cards would destroy the comparison it
  exists to make, so it keeps scrolling sideways and its first column sticks.
- **The job overlays** (Add Application, a job's own page) give the heading its
  own row below 560px instead of truncating it to "Add Ap…".
- **The drawer** (below 1024px) closes on Escape, on a left swipe, on
  navigation and on a resize back to desktop, and locks the page behind it.
- **Touch targets** grow under `(pointer: coarse)` rather than at a width
  breakpoint, so a touchscreen laptop gets them and a narrow desktop window
  doesn't.

It is checked, not eyeballed: `frontend`'s responsive behaviour was measured at
390 / 768 / 820 / 1024 / 1280 / 1440px across every page, every in-page tab,
both job overlays, the drawer, the signed-out landing page and the login
screen. Total content clipped off the right edge at 390px went from 567px to 0.

## Job Applications — multiple boards + visual analytics

The Job Applications page now supports multiple named boards (e.g. "Main
Search", "Backup Plan", "Summer Internships") — every account starts with
one default board, and existing applications from before this feature
landed automatically stay visible on it (nothing is lost on upgrade).
Switch boards with the tabs at the top of the page; **+ New Board** creates
another; deleting a board reassigns its applications to another board
rather than deleting them.

Each board has its own **Analytics** tab (separate from List/Kanban) with:
- **Job Search Funnel** — colorful Saved → Applied → Interview → Offer breakdown with conversion percentages.
- **Applications & Interviews Over Time** — a multi-series line chart.
- **Status Breakdown** — a donut chart across every pipeline stage.
- **Application Activity** — a GitHub-style contribution heatmap of applications per day.
- **Top Skills Required** — a gradient bar chart.

List and Kanban tabs stay focused on managing applications (the Add
Application form, filters, and the table/board itself), with all analytics
moved out of the way into their own tab.

**Color themes:** a swatch bar in the sidebar (visible on every tab, not
just Jobs) lets you pick an accent color — Blue, Purple, Green, Sunset,
Rose, or Slate — independent of the light/dark toggle. Charts, buttons,
and highlights across the whole app pick it up instantly.

Backend: `backend/app/routers/boards.py` (new) and the `board_id` field on
`JobApplication` (`backend/app/models.py`). A lightweight startup migration
in `main.py` adds the `board_id` column to any pre-existing database
automatically — no manual migration step needed.

## Chrome Extension — auto-capture job applications

The `extension/` folder holds a Chrome extension (also packaged for download
from inside the app, on the **Job Applications** page). It lets you capture
whatever job posting you're looking at with one click:

- **AI-assisted field mapping, not just CSS selectors.** The content script
  grabs a readability-style dump of the whole page (works on any job site,
  not just the handful with hardcoded selectors) and sends it to the
  backend, which uses the same local-AI pipeline as the rest of the app to
  pull out clean role/company/location/salary/description fields — filtering
  out nav menus, cookie banners, and "related jobs" clutter along the way.
  A fast CSS-selector guess fills the fields instantly, then the AI pass
  quietly improves on it a moment later.
- Every field is editable in the popup before you do anything with it, so
  you can always fix a wrong guess by hand.
- Saves it as a job application in your account.
- **Two standalone actions**, usable independent of saving the job:
  **🎯 Tailor Resume** (creates a customized, job-tailored resume from
  whichever Resume-Builder resume you pick, downloadable as a PDF right in
  the popup) and **✍️ Cover Letter** (generates one and shows it in the
  popup with Copy / Download buttons).
- The main **Capture This Job** button can also do both of those
  automatically as part of saving the application (the two checkboxes
  above it).

### Capture: the description only, and the rest of the row from it

**What gets captured as the description.** A job board's search page is mostly
not the job — filter chips, a results list, "people you can reach out to". The
old selector chain ended in `article, main`, which on a LinkedIn search page is
the whole screen, so a capture could arrive reading *"Date posted Easy Apply
Under 10 applicants … 99+ results · How promoted jobs are ranked"* — and every
keyword count, ATS score and tailored résumé downstream was computed from that.

The content script now works from the posting's own pane rather than the
document. The pane is found by climbing from the job title to the widest
ancestor that does **not** contain the results list, so it still resolves on the
day a board renames its description class — which is the failure that let the
page in. Two more guards sit behind it: a validator that recognises page
furniture and refuses it, and a cleanup pass that drops a repeated
title/company/metadata header. If nothing survives, the field is left empty and
the popup says so — a blank you can paste into beats wrong text saved silently.

Two fields improved alongside it: **Location** is parsed out of LinkedIn's
packed top-card line (`Deliveroo · London, England, United Kingdom · 2 weeks
ago · Over 100 applicants` → `London, England, United Kingdom`), and **Post
URL** is now the posting's own address (`/jobs/view/<id>/`) rather than the
search page you happened to read it from.

**The rest of the row fills itself.** Location, salary, skills and tags are all
stated inside the description and almost never typed by hand, so the board's own
columns — and the charts drawn from them — stayed empty. `backend/app/job_enrich.py`
reads them out with regular expressions and the ATS scorer's skill lexicon: no
model, no network, same answer every time, which is what makes a tag like
`no-sponsorship` explainable. It runs in three places:

- `POST /api/jobs` — fills blanks whenever an application is created.
- `POST /api/extension/capture` — so a one-click capture lands as a filled-in
  row, and says which fields it filled in its notes.
- `POST /api/jobs/enrich` — a preview that saves nothing, which the Add
  Application form calls as you paste, so the fields populate in front of you
  and can be corrected before saving.

It only ever writes to **blank** fields. Anything you typed is left exactly as
it is, on every path.

### Visa sponsorship, on the results list

The extension checks employers against the Home Office **register of licensed
worker sponsors** and puts the answer on the job cards themselves — not only
after you have opened a posting. A green **UK Visa Sponsor** tag sits in the
corner of every card whose employer holds a licence (amber **Likely Visa
Sponsor** when the name is a close but inexact match, e.g. the ad says "ASOS"
and the register says "ASOS.com Limited"). Hovering a tag shows the exact
register entry, the routes it covers, and the caveat below.

**You choose what happens to the rest of the list**, from the *Visa
sponsorship* section in the popup:

| Mode | What happens |
|---|---|
| **Tag only** | Sponsors get a tag; every other card is left exactly as it was. |
| **Dim rest** | Employers with no licence on the register fade back, so sponsors stand out. |
| **Hide rest** | Only sponsors stay on the page — non-sponsor cards are removed from the list. |

The switch above the modes turns the whole thing off, which puts every page
back as it was. Either setting takes effect immediately in every open job tab
(the content script watches `chrome.storage`), and the same section shows how
many employers the register holds and when it was last synced, with a
**Refresh** link that pulls the current CSV from GOV.UK.

Works on LinkedIn, Indeed, Glassdoor, Reed and Totaljobs/CV-Library with
per-site card selectors, and on the other boards and ATS platforms in the
portal list through generic ones.

- `extension/sponsor-badges.js` — finds the job cards, reads the employer off
  each one, batches the lookups, injects the tags. Everything it adds carries
  an `mt-spon-*` class and is removed completely when the feature is switched
  off.
- `POST /api/sponsors/check-bulk` — one request per screenful of cards instead
  of one per card. Answers are cached for an hour in the service worker and for
  the life of the tab in the page.
- **It is advisory.** A licence means the employer *can* sponsor, not that this
  vacancy is open to sponsorship, and large groups often register under a
  parent name that no job ad mentions. The wording in the UI says so, and
  nothing here should be read as a guarantee.

**Works with zero config, out of the box:** if you never touch `MOMENTUM_API_BASE`
in `.env`, both the frontend and the extension automatically fall back to
`http://localhost:8000` — nothing to set for plain local development. Set
`MOMENTUM_API_BASE` only when the backend is somewhere other than localhost
(a dev tunnel, a separate host, production).

**Installing it (not published to the Chrome Web Store):**
1. Download the zip from the Job Applications page (or zip the `extension/`
   folder yourself) and unzip it.
2. Open `chrome://extensions`, enable **Developer mode**, click **Load
   unpacked**, and select the unzipped folder.
3. That's it for local dev — it already defaults to `http://localhost:8000`.
   Only open the extension icon → **Settings** if your backend is somewhere
   else (a dev tunnel, a separate host); whatever you set there overrides
   the built-in default from `.env`, no rebuild needed.
4. Log in with your Momentum Tracker account, open a job posting, and click
   **Capture This Job** (or just **🎯 Tailor Resume** / **✍️ Cover Letter**
   if you don't want to save it yet).

It talks to four backend endpoints, all in `backend/app/routers/extension.py`
(the resume-tailor and cover-letter actions reuse the same endpoints the web
app itself uses):
- `GET /api/extension/ping` — health/auth check
- `GET /api/sponsors/check`, `POST /api/sponsors/check-bulk`, `GET /api/sponsors/status`,
  `POST /api/sponsors/refresh` — the sponsor register (see above)
- `POST /api/extension/extract` — AI-assisted field extraction from a
  scraped page
- `POST /api/extension/capture` — the one-click capture + auto-tailor +
  auto-cover-letter pipeline
- `POST /api/resume-builder/tailor-for-job` and `POST /api/cover-letter/generate`
  — called directly for the standalone popup buttons


## Analyse & tailor (one tab, one advert)

Review and Tailor used to be two tabs that each asked for the same job advert
and then answered half the question — one scored the CV, the other reordered
it, and neither said which of the advert's words the CV was missing. They are
now one tab with **two sections** over a single paste.

At the top, shared by both: the advert card — paste, or **Upload JD** (.txt and
.pdf are read in the browser; pdf.js is already loaded for the preview),
with **Clear**, a character count and **Analyse**. It folds to a line naming
the role once it has something in it. Under it, the score strip: the number,
what it means in words, and the vocabulary on each side of the gap.

**Tailor your CV** — one page, four numbered blocks. The first two share a row:

| Block | What it shows |
|---|---|
| **1. The match** | Two answering columns — what the advert asks for, and what in your CV answers it. Built from the advert's own bullet points, or from its leading terms when it is written as prose. |
| **2. Keywords & skills** | *Strong matches* and *Recommended to add* — the second set tickable, so the words you choose get woven in and nothing else does. |
| **3. How should it be tailored?** | Your instruction in your own words, the ones you saved, and how much rewriting to allow. |
| **4. Tailor your sections** | What each change would do to the match, then the section proposals — each with Edit, Apply and Undo. |

**CV Review** — the former AI Review tab, unchanged, scored against the same advert.

Analyse, Keywords and Changes were tabs of their own until the pane got wide
enough not to need them: three clicks to answer one question, and a column of
empty space in each. `rbTlStep("analyse" | "keywords" | "changes")` still
works — it opens the section and scrolls to the block.

On the right, the preview panel has a header of its own: what it is showing,
the match as an **ATS** badge, the CV/Advert/CV-text switcher and a download.

The right-hand pane gains a switcher: **Your CV preview**, **Job advert** or
**Your CV text**. The last two render the document with the shared keywords
highlighted, so the gap is something you can read rather than a number.

### The layout

The two halves used to be split 45/55 in the preview's favour, so the advert
box, the instruction and the proposals were all squeezed into the narrower
side while an 820px-capped page sat in the wider one with room to spare. The
pane you act in now takes the space, and:

- **The preview is scaled, not reflowed.** The sheet keeps its real width and
  is zoomed to fit its column, so the miniature is the document that prints
  rather than a narrower one that happens to contain the same words.
- **The divider drags.** Nobody's idea of the right split is the same as
  anybody else's, and it changes with what you are doing. Drag the edge of the
  preview, double-click to reset, and the choice is remembered per browser.
  The work surface keeps 420px whatever you do.
- **The advert folds.** A 200px textarea is right exactly once — the first
  time. Afterwards it collapses to a line naming the role and the word count,
  and reopens on click.
- **The steps stay put** while the pane scrolls, and the instruction and the
  strength sit side by side, because they are one decision in two halves.

One fix in the same pass, visible everywhere in the builder rather than only
here: the résumé's accent colour was being written onto the app's root
element, so choosing a template with a near-black accent turned every button,
tab and chip in the *interface* near-black too. The colour belongs to the
document — the preview is rendered server-side from `accent_color`, and the
template thumbnails set the variable on themselves.

### Adding keywords you actually have

Tick the missing terms that are true of you, choose which sections to put them
in, and press **Add to my CV**:

- **Skills** are added by rule — to the group whose heading fits each term —
  so this half works with no model at all.
- **Summary, Experience and Projects** are reworded by whichever model is
  configured (a hosted key, else a local GGUF — see the AI Model tab) with a
  narrow brief: use the word only where the existing text already describes
  that work, keep every entry, every header, every date and every figure. A
  rewrite that changes the section's structure, or that places no term
  honestly, is discarded and reported rather than shown.

**Ticking is the safeguard.** Nothing here decides that you have a skill — the
missing list is presented as a missing list, you choose, and only your choices
are woven in. The panel says as much on screen: a keyword you cannot back up in
an interview costs more than the filter it passes. With no model configured,
the Skills half still works and the other sections say plainly why they didn't.

- `POST /api/resume-builder/tailor-analyse` — keywords, requirements, summary.
- `POST /api/resume-builder/tailor-keywords` — weave the chosen terms in.

## Tailoring a résumé to a job

The Tailor pane in the Resume Builder proposes changes **section by section, at
three strengths**, and applies the ones you accept into the résumé you are
looking at — the preview on the right redraws as you accept them, and nothing
is saved until you press Save like any other edit.

| Strength | What it does |
|---|---|
| **Regular** | Order only. Skills lead with the ones the job names; within each role, the bullets that match come first. Not one word is rewritten. |
| **Medium** | The above, plus a summary rewritten around the target role. |
| **Aggressive** | The above, plus bullets reworded in the job's vocabulary and a "Key skills for this role" line at the top of Skills. |

Each proposal is a card: what changed, in one sentence; the terms it matched;
a before/after you can open; **Edit**; and its own **Apply**. **Apply all** and
**Undo** are there too, and undo restores the exact text that was there before.

### Say how you want it tailored

Above the strengths is a box for one sentence in your own words, and a row of
the ones you saved:

> Keep every bullet. Lead with Azure and dbt. UK spelling, no buzzwords.

What the parser (`backend/app/ai/tailor_prompt.py`) acts on deterministically:

| You write | What happens |
|---|---|
| *keep every bullet*, *don't cut anything* | Nothing is removed. This is also the default. |
| *no more than 4 bullets per role*, *cut it down*, *one page* | Entries are trimmed to that many, and only where each dropped line's keywords survive elsewhere. |
| *lead with Azure and dbt* | Those terms outrank the rest of the overlap when ordering bullets, skills and skill groups — wherever your CV already contains them. |
| *only rewrite the summary*, *leave my projects alone* | Sections are scoped in or out, clause by clause, so one sentence can do both. |
| *UK spelling*, *first person*, *punchy*, *quantified*, *no buzzwords* | Passed to the model as writing rules where it rewrites prose. |

Everything understood is **printed back under the box** before you apply
anything, so an instruction that was misread is a thing you can see and reword
rather than something you discover by diffing your own CV. Whatever the parser
does not act on is still handed to the model verbatim, and the panel says which
half is which.

**Trimming is opt-in, and that is the fix for a real bug.** Medium used to keep
five bullets an entry and Aggressive four, so choosing a stronger rewrite
silently deleted work history nobody asked to delete — and at Aggressive it
deleted enough that the scoring guard rejected the whole proposal, so
Employment history vanished from the list with nothing on screen to explain it.
The strength now decides how much *rewriting* happens; how much *survives* is
your call. When you do ask for a shorter CV, the trim is offered even though it
costs match, with the cost named on the card — refusing silently would be its
own bug.

Instructions are saved per person, named by you, and applied by pressing the
name (`POST/GET/PUT/DELETE /api/resume-builder/tailor-prompts`). Pressing the
same chip again takes it off. They are stored verbatim and parsed at use time,
so a saved instruction gets any later improvement to the parser.

### Editing a proposal before you take it

Every card has **Edit**. It opens the proposed text in a box, you change
whatever you like, and **Apply my version** writes exactly what you typed —
no reformatting, no second opinion. **Back to the proposal** restores the
suggestion. An edit survives the panel being redrawn (the proposal refreshes
whenever the advert, instruction, strength or CV changes), *Apply all* prefers
your version over the one it replaced, and Undo still puts back the text that
was there before you started.

**No suggestion is ever offered that would lower your match.** Every proposal
is scored against the job before it is shown, and one that would move the
number down is dropped rather than displayed — which is what "Regular", the
level that promises to change nothing, was doing when it trimmed a section it
should never have touched. The pane shows both numbers (`17% → 18%`) so a flat
result reads as flat instead of being dressed up, and when an ad names no tool
your résumé lists it says so, because that is the honest explanation for a low
score that no amount of reordering can lift.

**Nothing is ever lost.** Entry fields are parsed and rebuilt by a round-trip
that keeps every line, and a field that cannot be rebuilt byte for byte is left
alone. The same repair was needed one layer down, in the PDF renderer:
`resume_pdf.parse_entries()` used to keep the first line of a block plus any
line starting with `-` and silently discard the rest, so a Projects section
typed as three plain lines printed as one project. It now reads a block with no
bullets as a list of entries and a loose line inside a bulleted block as a
bullet — either way the text reaches the page. Bracketed skills survive too:
`AWS (Redshift, S3, Glue)` is one skill, not three, and the splitter knows it.

**The rule that does not bend, at any strength or instruction: nothing is
invented.** "Say I know Kubernetes" is not a tailoring instruction, it is a
request to lie, and there is no override for it — the brief the model receives
says as much in those words, and the deterministic paths can only reorder text
that already exists. Every
term in an output already appeared in the résumé. Dates, employers, job titles,
degrees and figures are never sent for rewriting — they are copied across
verbatim. The strengths differ in how much they *re-emphasise*, never in how
much they may make up; a résumé that claims a skill its owner does not have
fails at the interview instead of at the filter, which is worse for the person
holding it. The pane says so on screen, and lists what the job asked for that
you do **not** have rather than quietly adding it.

It works with no model installed — the ordering, trimming and key-skills line
are deterministic (`backend/app/ai/tailor_levels.py`). A local GGUF model only
improves the wording of the summary and bullets that the rules already
selected, and any failure there falls back to the deterministic text.

Three suites cover this area; each runs standalone, with no pytest and no
running server:

```bash
python3 backend/tests/test_tailor_levels.py   # the strengths, losslessly
python3 backend/tests/test_tailor_prompt.py   # instructions, and bullets surviving
python3 backend/tests/test_jd_keywords.py     # the keyword read and weaving
```

- `POST /api/resume-builder/tailor-preview` — the proposal. Takes the fields
  currently on screen (so an unsaved résumé tailors fine — the old flow needed
  it saved first, which is why the button never appeared) plus your `prompt`,
  and returns per-section before/after alongside `prompt_notes` (the
  instruction read back) and `bullets_kept`. Saves nothing.
- `GET|POST /api/resume-builder/tailor-prompts`,
  `PUT|DELETE /api/resume-builder/tailor-prompts/{id}` — the saved
  instructions, ordered by how often each is used.
- `POST /api/resume-builder/tailor-for-job` — unchanged: the older one-shot
  route that writes a tailored *copy* into your library, still used by the
  Chrome extension's capture.

## Local AI assistant & AI-enhanced features

The chat assistant, the "AI Insight" on the ATS checker, the cover letter
generator, and the ATS-tailored resume regenerator all run **entirely
locally** — no external AI API calls. They work out of the box in a
lightweight "lite" mode (rule/template based, grounded in your real data)
and automatically upgrade to full local-LLM generation the moment you drop
a GGUF model file in `backend/models/`. See `backend/models/README.md` for
exact steps — it's genuinely just "drop the file in, nothing else."

### Picking a provider: what it costs, before anything else

The AI Model tab lists eighteen providers. A list of names says nothing about
the one thing that decides which to pick, so the picker is grouped by cost and
each provider carries a badge:

| Group | Means | Who is in it (checked August 2026) |
|---|---|---|
| **Free tier — no card needed** | An account and a key; rate-limited, not billed | Groq, Cerebras, Google Gemini, Mistral, OpenRouter (`:free` models), Zhipu/Z.ai (GLM Flash) |
| **Free credits to start, then billed** | Some credit on signup, then it runs out | OpenAI, Anthropic, xAI, Together, Fireworks, DeepInfra, Moonshot, Qwen |
| **Paid from the first call** | Billed per token, though some are very cheap | DeepSeek, Perplexity |

Three states rather than two, because *free credits* is neither free nor quite
paid, and reading it as either is how people end up surprised by a bill or by a
dead key. **There is no local-model option** — running one was offered and
removed: it asked people to install a runtime, pull several gigabytes and keep
a process alive, all to be slower than a free tier that takes a minute to set
up. The transport for it stays in `remote.py` so an account already pointed at
one keeps working, but nothing offers it. Each provider's note says what its own free tier covers — Gemini's
applies to the Flash models, Mistral's is for evaluation rather than commercial
work, OpenRouter's to model names ending `:free`.

### Getting a key, and running it without one

Beside the provider is a **Get a key** button that opens that provider's own
key page — the page where the key is created, not their pricing or their docs.
Every provider that needs a key has one; `test_providers.py` fails if any is
left without.

Under the fields, folded, is **How to add a key — three minutes, once**: the
three steps, then what the common failures actually mean (`401` is a mistyped
key, `404` on the model is a name that has moved on — clear it and press Fetch
models, `429` is the free tier's rate limit), then what happens to the key
(encrypted at rest, never displayed again, only ever sent to the provider you
chose, removable at any time — after which everything falls back to template
mode rather than breaking).

**Free tiers move.** The panel says so and links each provider's own page,
which is the last word. The classification lives in one place —
`backend/app/ai/remote.py`, a `cost` field per provider — so correcting it is
one edit, and `backend/tests/test_providers.py` checks that nothing is left
unclassified and that the free ones sort to the top.

## Brand

The mark is the ribbon **M**; the full lockup adds the wordmark and *move
forward*. Both ship as artwork rather than as a drawn path, so every surface
shows the same thing:

| File | Used by |
|---|---|
| `frontend/assets/momentum-mark.png` | Sidebar, landing nav, in-page illustrations |
| `frontend/assets/momentum-mark-light.png` | The knockout, for the navy footer |
| `frontend/assets/momentum-logo.png` | The full lockup, on the sign-in screen |
| `frontend/favicon.png`, `frontend/assets/apple-touch-icon.png` | Browser tab and home screen — linked with a `?v=` token, because a favicon otherwise survives reloads, restarts and a hard refresh |
| `extension/icons/icon{16,48,128}.png` | The Chrome toolbar. Chrome caches these against the installed version, so the manifest version is bumped with the artwork — and an already-loaded unpacked extension needs **Reload** on `chrome://extensions` before the new icon shows |
| `extension/icons/mark.png`, `mark-light.png` | The popup, the options page, and the capture button injected onto job pages |
| `backend/app/brand/mark.png`, `mark-light.png` | The header bar of every PDF export |

Two rules the files encode. **The icons are a solid teal tile with a white
knockout mark**, because at 16px in a tab strip the mark on its own is a few
hairlines of dark teal — legible on paper, invisible on browser chrome. A
white tile was tried first and was worse: white on Chrome's light toolbar is
no tile at all. **Anything on a dark ground uses the
knockout**, which is why there is a `-light` of each: dark teal on navy is a
smudge. The PDF export header used to read "⚡ Momentum" — an emoji standing in
for a logo, rendering differently on every machine and as a hollow box on some;
it draws the real mark now, and falls back to the wordmark alone if the file is
ever missing, because a logo is never a reason for a download to fail.

## Project structure

```
momentum/
├── .gitignore
├── README.md
├── .env                        # ← edit THIS for every connection setting (see above)
├── .env.example
├── docker-compose.yml          # ← `docker compose up --build` runs both services from .env
├── generate_frontend_env.py    # syncs frontend/env.js from .env (manual/non-Docker runs)
├── backend/
│   ├── requirements.txt
│   ├── seed.py                # demo data generator
│   ├── momentum.db            # SQLite database (created by seed.py)
│   ├── models/                # ← drop a .gguf file here for local AI
│   │   └── README.md
│   └── app/
│       ├── main.py            # FastAPI app entrypoint (loads root .env)
│       ├── models.py          # SQLAlchemy database models
│       ├── schemas.py         # Pydantic request/response schemas
│       ├── database.py
│       ├── auth.py            # JWT auth, rate limiting, Google token verification
│       ├── ats_scorer.py      # rule-based ATS keyword/skill matching
│       ├── job_enrich.py      # location/salary/skills/tags read out of a job description
│       ├── resume_pdf.py      # the 7 resume templates (reportlab)
│       ├── resume_text.py     # text extraction from uploaded resumes
│       ├── report_pdf.py      # full-account PDF export
│       ├── ai/                 # local AI: chat, ATS insight, cover letters, tailoring
│       │   ├── tailor_levels.py  # regular / medium / aggressive tailoring proposals
│       │   ├── tailor_prompt.py  # "keep every bullet, lead with Azure" -> directives
│       │   └── jd_keywords.py    # advert keywords, requirements met, weaving chosen terms in
│       │   ├── engine.py      # inference (model loading, lite-mode fallbacks)
│       │   └── prompts.py     # prompt templates, kept separate from inference logic
│       └── routers/            # one file per API area (habits, jobs, resumes, admin, extension, etc.)
├── frontend/
│   ├── env.js                 # AUTO-GENERATED from .env — don't edit by hand
│   ├── index.html
│   ├── styles.css
│   ├── app.js                 # the whole frontend — vanilla JS, no build step
│   └── downloads/
│       └── momentum-tracker-extension.zip   # packaged copy of extension/, served for download
└── extension/                  # Chrome extension (MV3) — see "Chrome Extension" above
    ├── manifest.json
    ├── config.js               # AUTO-GENERATED from .env — don't edit by hand
    ├── background.js           # all API calls happen here (CORS-exempt extension context)
    ├── content.js               # scrapes the job posting off the current page
    ├── sponsor-badges.js        # UK visa-sponsor tags on the cards in a results list
    ├── popup.html / popup.js    # main UI: login, resume picker, capture button
    ├── options.html / options.js # backend URL override
    └── icons/

```
