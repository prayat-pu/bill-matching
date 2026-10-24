@echo off
setlocal
rem One-time setup on the Windows host. Run it from this folder.
cd /d "%~dp0..\.."

echo === checking Node ===
node -v >nul 2>&1 || (
  echo Node is not installed. Get the 64-bit Windows MSI from https://nodejs.org (version 24 or newer^).
  pause & exit /b 1
)
for /f "tokens=1 delims=." %%v in ('node -p "process.versions.node"') do set MAJOR=%%v
if %MAJOR% LSS 24 (
  echo Node %MAJOR% is too old. Install Node 24 or newer from https://nodejs.org
  pause & exit /b 1
)
node -v

echo.
echo === checking poppler ===
if not exist "vendor\poppler\Library\bin\pdftoppm.exe" (
  if not exist "vendor\poppler\bin\pdftoppm.exe" (
    echo pdftoppm.exe was not found.
    echo Download Release-xx.xx.x-0.zip from
    echo   https://github.com/oschwartz10612/poppler-windows/releases
    echo and unzip it so that one of these exists:
    echo   vendor\poppler\Library\bin\pdftoppm.exe
    echo   vendor\poppler\bin\pdftoppm.exe
    pause & exit /b 1
  )
)
echo found.

echo.
echo === checking the API key ===
if not exist ".env" (
  echo .env is missing. Create it next to package.json with one line:
  echo   GEMINI_API_KEY=your-key-here
  pause & exit /b 1
)

echo.
echo === installing packages (needs internet, takes a few minutes^) ===
call npm ci || (echo npm ci failed & pause & exit /b 1)

echo.
echo === building the web page ===
call npm run build || (echo build failed & pause & exit /b 1)

echo.
echo Setup finished. Start the app with start.cmd
pause
