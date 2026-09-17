@echo off
REM ===========================================================================
REM Momentum Tracker - API server (no Docker)
REM ===========================================================================
REM From the VS Code terminal:  .\start-backend.bat
REM
REM First launch creates backend\.venv and installs dependencies, which takes
REM a few minutes. Every launch after that starts in seconds.
REM
REM Config comes from the .env in this folder - the backend reads it from the
REM project root automatically. Note FRONTEND_URL in there: it is the origin
REM CORS allows, so it has to match the address you actually open the app at.
REM ===========================================================================
setlocal
cd /d "%~dp0backend"

REM ---------------------------------------------------------------------------
REM Why this is here: on the first model FastAPI builds, pydantic scans EVERY
REM installed distribution and opens each one's entry_points.txt looking for
REM plugins. This project sits in OneDrive, so those ~60 opens go through the
REM sync layer and can block for minutes on a dehydrated placeholder - which is
REM exactly where startup was hanging (pydantic/plugin/_loader.py, get_plugins).
REM Nothing here ships a pydantic plugin, so skip the scan entirely.
REM The real fix is to move .venv out of OneDrive; this makes it start either way.
REM ---------------------------------------------------------------------------
set PYDANTIC_DISABLE_PLUGINS=1

if not exist .venv (
  echo.
  echo   Creating virtual environment ^(first run only^)...
  python -m venv .venv
  if errorlevel 1 goto :nopython
)

call .venv\Scripts\activate.bat

REM A marker file, so dependencies install once rather than on every launch.
REM Delete backend\.venv\.deps-installed to force a reinstall.
if not exist .venv\.deps-installed (
  echo.
  echo   Installing dependencies ^(first run only, a few minutes^)...
  echo.
  python -m pip install --upgrade pip --quiet

  REM llama-cpp-python is excluded on purpose: it compiles from source and
  REM commonly fails to build on Windows. It powers only the local AI model,
  REM which reports itself as not configured without it - the remote AI
  REM providers on the AI Model page are unaffected. To include it, install
  REM from requirements.txt directly instead.
  findstr /v /b "llama-cpp-python" requirements.txt > .venv\requirements-nollm.txt
  pip install -r .venv\requirements-nollm.txt
  if errorlevel 1 goto :depsfailed
  type nul > .venv\.deps-installed
)

echo.
echo   ============================================================
echo     API      http://localhost:8000
echo     Docs     http://localhost:8000/docs
echo.
echo     Leave this window running. Ctrl+C stops it.
echo.
echo     Editing backend code? Start it with:  .\start-backend.bat --dev
echo   ============================================================
echo.
REM ===========================================================================
REM Auto-reload is OFF unless you ask for it:  .\start-backend.bat --dev
REM
REM This is the fix for "the backend closes by itself". It was not closing, it
REM was restarting, over and over, and each restart took long enough that the
REM page reported the backend as unreachable.
REM
REM Why --reload was doing that here. uvicorn's reloader watches the CURRENT
REM DIRECTORY, which is backend\. It always does - passing --reload-dir does
REM NOT narrow it, because WatchFilesReload appends Path.cwd() to the watch
REM list unconditionally and drops any directory you name that lives under cwd
REM (uvicorn/supervisors/watchfilesreload.py). So the reloader was watching:
REM
REM     .venv\        ~8000 files, thousands of them .py
REM     momentum.db   plus -wal and -shm, rewritten on every single save
REM     uploads\      a new PDF on every resume export
REM
REM This project lives in OneDrive. A restart fires on any .py change, and
REM .venv is nothing but .py - so every time OneDrive touched a file in there
REM it looked exactly like you had edited source, and the server restarted.
REM On top of that, watching 8000 files through the OneDrive sync filter is
REM expensive even when nothing changes.
REM
REM Every restart re-runs create_all, the column migrations and the board seed
REM against a 16MB database over that same sync layer. That is the gap where
REM the frontend says "Couldn't reach the backend".
REM
REM Running without the reloader removes the whole failure: no watcher, no
REM 8000-file OneDrive watch, no restart loop. You restart the server yourself
REM after a code change, which for this project is a fair trade.
REM
REM --dev turns reloading back on for when you are editing backend code, with
REM .venv and uploads excluded so an OneDrive sync can't masquerade as an edit.
REM (The excludes stop the restart; they cannot stop the watching - uvicorn
REM 0.30 gives no way to do that - which is the other reason off is the default.)
REM
REM --timeout-graceful-shutdown caps how long a stop waits on the Telegram
REM long-poll, so Ctrl+C is immediate instead of appearing to hang.
REM ===========================================================================
if /i "%~1"=="--dev" goto :dev
if /i "%~1"=="--reload" goto :dev

python -m uvicorn app.main:app --port 8000 --timeout-graceful-shutdown 10
set "STOPCODE=%ERRORLEVEL%"
goto :stopped

:dev
echo   Auto-reload ON - watching backend\ for .py changes ^(.venv and uploads excluded^).
echo.
python -m uvicorn app.main:app --port 8000 --timeout-graceful-shutdown 10 --reload --reload-exclude "%~dp0backend\.venv" --reload-exclude "%~dp0backend\uploads" --reload-exclude "%~dp0backend\evals"
set "STOPCODE=%ERRORLEVEL%"
goto :stopped

:stopped
REM ---------------------------------------------------------------------------
REM Everything below exists so a crash is readable.
REM
REM The uvicorn line used to be followed by "goto :eof" and nothing else, so
REM when the server died the batch file ended and the console window closed
REM with it - taking the traceback with it. A backend that stops for a reason
REM you can read is a different problem from one that vanishes.
REM ---------------------------------------------------------------------------
echo.
echo   ============================================================
if "%STOPCODE%"=="0" (
  echo     Server stopped normally.
) else (
  echo     Server stopped with exit code %STOPCODE%.
  echo.
  echo     The reason is in the output above. If all you can see is
  echo     "Error loading ASGI app", run  check-backend.bat  - it
  echo     starts the same app without the reloader, so the real
  echo     traceback stays on screen.
)
echo   ============================================================
echo.
pause
goto :eof

:nopython
echo.
echo   Could not run Python. Install it from python.org and make sure
echo   "Add python.exe to PATH" is ticked during setup.
pause
goto :eof

:depsfailed
echo.
echo   Dependency install failed - the error is above. Nothing was marked
echo   as installed, so fixing it and re-running picks up where it stopped.
pause
