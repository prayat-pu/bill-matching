@echo off
rem Start the app with Docker and print the addresses to open.
rem Double-click this file. Written for someone who does not use a terminal.
rem Delayed expansion: %KEY% inside an if-block is expanded when the block is
rem parsed, i.e. before set /p has run, so it would always be empty.
setlocal enabledelayedexpansion
cd /d "%~dp0..\.."
set PORT=40000

echo.
echo === checking Docker ===
docker version >nul 2>&1
if errorlevel 1 (
  echo.
  echo   Docker is not installed, or Docker Desktop is not running.
  echo   Start Docker Desktop, wait until its icon stops animating, then run this again.
  echo.
  pause & exit /b 1
)
docker compose version >nul 2>&1
if errorlevel 1 (
  echo   This Docker has no "compose". Update Docker Desktop.
  pause & exit /b 1
)
echo   OK

echo.
echo === checking the API key ===
if not exist ".env" (
  echo   .env is missing. Paste the Gemini API key ^(nothing else is stored^):
  set /p KEY=  GEMINI_API_KEY: 
  if "!KEY!"=="" (
    echo   No key given. Create .env with GEMINI_API_KEY=... and run this again.
    pause & exit /b 1
  )
  > .env echo GEMINI_API_KEY=!KEY!
  echo   wrote .env
) else (
  echo   OK
)

echo.
echo === starting ^(the first run builds the image, a few minutes^) ===
docker compose up -d --build
if errorlevel 1 (
  echo.
  echo   Docker could not start the app. The message above says why.
  pause & exit /b 1
)

echo.
echo === waiting until it answers ===
powershell -NoProfile -Command ^
  "$ok=$false; for($i=0;$i -lt 60;$i++){ try { if((Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 ('http://127.0.0.1:%PORT%/api/health')).StatusCode -eq 200){$ok=$true;break} } catch {}; Write-Host -NoNewline '.'; Start-Sleep 2 }; Write-Host ''; if(-not $ok){exit 1}"
if errorlevel 1 (
  echo.
  echo   It did not answer in two minutes. See what happened with logs.cmd
  pause & exit /b 1
)

echo.
echo   ========================================================
echo    READY - open this in Chrome
echo   ========================================================
echo.
echo    this computer:
echo      http://localhost:%PORT%
echo.
echo    other computers in the office:
powershell -NoProfile -ExecutionPolicy Bypass -File "%CD%\deploy\lib\addresses.ps1" -Port %PORT%
echo.
echo   ========================================================
echo    to stop: double-click stop.cmd
echo   ========================================================
echo.
echo   Opening the page...
start "" "http://localhost:%PORT%"
echo.
pause
