@echo off
REM ===========================================================================
REM Momentum Tracker - resolve the Forbes Global 2000 to company job boards
REM ===========================================================================
REM From the VS Code terminal:  .\resolve-boards.bat
REM
REM Works out which applicant tracking system each of the 2000 companies uses,
REM by probing the six public APIs the app already speaks. Takes the better
REM part of an hour and makes roughly twelve thousand requests, so it is a
REM script you run rather than something the app does on a schedule.
REM
REM Safe to interrupt with Ctrl+C. Progress is written to
REM backend\app\jobhunt\data\resolve_checkpoint.jsonl as it goes, and running
REM this again picks up where it stopped.
REM
REM Useful variants, run by hand from backend\ with the venv active:
REM   python resolve_boards.py --country "United Kingdom"
REM   python resolve_boards.py --limit 100
REM   python resolve_boards.py --no-site
REM   python resolve_boards.py --retry-misses
REM   python resolve_boards.py --report
REM
REM When it finishes, restart the backend. It seeds the new boards on startup.
REM ===========================================================================
setlocal
cd /d "%~dp0backend"
set PYDANTIC_DISABLE_PLUGINS=1

if not exist .venv (
  echo.
  echo   No virtual environment yet. Run start-backend.bat once first,
  echo   so the dependencies are installed.
  echo.
  pause
  exit /b 1
)

call .venv\Scripts\activate.bat
python resolve_boards.py %*

echo.
echo   Done. Restart the backend to load the new boards.
echo.
pause
