@echo off
rem SI/AI disclosure: written with Claude Code (Anthropic), an AI assistant, working with team Paween_and_Kpunn. See README.md.
rem FireLine: starts the local server and opens the app in your browser.
rem Needs Python 3.8 or newer (https://www.python.org/downloads/). Close this window to stop FireLine.
title FireLine
cd /d "%~dp0"

set PY=
where python >nul 2>nul && set PY=python
if not defined PY ( where py >nul 2>nul && set PY=py -3 )
if not defined PY (
  echo Python was not found.
  echo Install it from https://www.python.org/downloads/ and tick "Add python.exe to PATH", then run start.bat again.
  pause
  exit /b 1
)

set PORT=8765
if not "%~1"=="" set PORT=%~1

echo Starting FireLine at http://localhost:%PORT%
echo Keep this window open while you use it. Close it to stop.
echo.
rem open the browser a moment after the server starts
start "" /b cmd /c "ping -n 3 127.0.0.1 >nul & start http://localhost:%PORT%"
%PY% app\serve.py %PORT%

echo.
echo FireLine stopped. If you see an error above, read README.md.
pause
