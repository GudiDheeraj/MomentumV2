@echo off
REM ===========================================================================
REM Momentum Tracker - backend doctor
REM ===========================================================================
REM Run this when the app says it cannot reach the backend:
REM     .\check-backend.bat
REM
REM start-backend.bat runs uvicorn with --reload, and the reloader hides a
REM startup traceback behind a generic "Error loading ASGI app". This runs the
REM same app without the reloader, so whatever is actually wrong stays on screen.
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

echo.
echo   ============================================================
echo     Momentum backend doctor
echo   ============================================================

echo.
echo   [1/4] Virtual environment
if not exist .venv\Scripts\python.exe goto :novenv
.venv\Scripts\python.exe --version

echo.
echo   [2/4] Is anything listening on port 8000?
netstat -ano | findstr ":8000"
if errorlevel 1 echo         Nothing is listening on 8000 - the backend is NOT running.
if not errorlevel 1 echo         Something IS listening on 8000. If it is not this app, that
if not errorlevel 1 echo         port clash is why the backend cannot start.

echo.
echo   [3/4] Can the app be imported? A bad import shows up here.
.venv\Scripts\python.exe -c "from app.main import app; print('        imports OK -', len(app.routes), 'routes registered')"
if errorlevel 1 goto :importfailed

echo.
echo   [4/4] Starting uvicorn WITHOUT --reload so errors stay visible.
echo         Once it says "Application startup complete", open:
echo             http://localhost:8000/api/health
echo         It should print  {"status":"ok"}
echo.
echo         Leave this window running. Ctrl+C stops it.
echo.
.venv\Scripts\python.exe -m uvicorn app.main:app --port 8000
goto :done

:novenv
echo         No virtual environment at backend\.venv
echo         Run start-backend.bat once - it creates it and installs the deps.
goto :done

:importfailed
echo.
echo         The traceback above is why the backend will not start. It names
echo         the file and the line. Nothing else below matters until it is fixed.
goto :done

:done
echo.
pause
