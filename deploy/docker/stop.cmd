@echo off
rem Stop the app. Nothing is lost - the workbook is only held in memory, so a
rem run in flight has to be started again.
setlocal
cd /d "%~dp0..\.."

echo.
echo === stopping ===
docker version >nul 2>&1
if errorlevel 1 (
  echo   Docker is not running, so the app is already stopped.
  echo.
  pause & exit /b 0
)

docker compose down
if errorlevel 1 (
  echo.
  echo   Could not stop it. Try running this file as Administrator.
  pause & exit /b 1
)
echo.
echo   stopped.
echo.
pause
