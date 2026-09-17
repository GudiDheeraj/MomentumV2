@echo off
REM ===========================================================================
REM Momentum Tracker - web app (no Docker)
REM ===========================================================================
REM From a SECOND VS Code terminal:  .\start-frontend.bat
REM The backend needs to be running too - see start-backend.bat.
REM ===========================================================================
setlocal
cd /d "%~dp0"

REM Regenerates frontend\env.js from .env, which is what the frontend
REM container does on every start. Keeps the two in sync after an .env edit.
python generate_frontend_env.py
if errorlevel 1 echo   ^(could not sync env.js - carrying on with the existing one^)

REM Re-stamp the ?v= tokens so the browser cannot serve a cached app.js or
REM portfolio.js after an edit. No-ops when nothing changed.
node frontend\tools\stamp.js
if errorlevel 1 echo   ^(could not stamp assets - is node installed?^)

cd frontend
echo.
echo   ============================================================
echo     App      http://localhost:5173
echo.
echo     Leave this window running. Ctrl+C stops it.
echo   ============================================================
echo.
python -m http.server 5173
