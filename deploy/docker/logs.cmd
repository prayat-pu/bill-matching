@echo off
rem Watch what the app is doing. Close this window to stop watching -
rem it does not stop the app.
cd /d "%~dp0..\.."
echo Press Ctrl+C to stop watching. The app keeps running.
echo.
docker compose logs -f --tail=50
pause
