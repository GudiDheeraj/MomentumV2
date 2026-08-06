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
- `POST /api/extension/extract` — AI-assisted field extraction from a
  scraped page
- `POST /api/extension/capture` — the one-click capture + auto-tailor +
  auto-cover-letter pipeline
- `POST /api/resume-builder/tailor-for-job` and `POST /api/cover-letter/generate`
  — called directly for the standalone popup buttons


## Local AI assistant & AI-enhanced features

The chat assistant, the "AI Insight" on the ATS checker, the cover letter
generator, and the ATS-tailored resume regenerator all run **entirely
locally** — no external AI API calls. They work out of the box in a
lightweight "lite" mode (rule/template based, grounded in your real data)
and automatically upgrade to full local-LLM generation the moment you drop
a GGUF model file in `backend/models/`. See `backend/models/README.md` for
exact steps — it's genuinely just "drop the file in, nothing else."

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
│       ├── resume_pdf.py      # the 7 resume templates (reportlab)
│       ├── resume_text.py     # text extraction from uploaded resumes
│       ├── report_pdf.py      # full-account PDF export
│       ├── ai/                 # local AI: chat, ATS insight, cover letters, tailoring
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
    ├── popup.html / popup.js    # main UI: login, resume picker, capture button
    ├── options.html / options.js # backend URL override
    └── icons/

```
