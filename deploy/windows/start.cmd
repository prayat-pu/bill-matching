@echo off
rem Start the app. Keep this window open; closing it stops the app.
cd /d "%~dp0..\.."

rem Point at the bundled poppler, whichever layout the zip used.
if exist "vendor\poppler\Library\bin\pdftoppm.exe" set PDFTOPPM=%CD%\vendor\poppler\Library\bin\pdftoppm.exe
if exist "vendor\poppler\bin\pdftoppm.exe" set PDFTOPPM=%CD%\vendor\poppler\bin\pdftoppm.exe

rem 0.0.0.0 so the Windows 7 machines on the LAN can reach it.
set HOST=0.0.0.0
set PORT=40000
set NODE_ENV=production
set WEB_DIST=%CD%\apps\web\dist

echo Bill Matching is starting on port %PORT%
echo   this PC:    http://localhost:%PORT%
echo   other PCs:
powershell -NoProfile -ExecutionPolicy Bypass -File "%CD%\deploy\lib\addresses.ps1" -Port %PORT%
echo.
node --env-file-if-exists=.env --experimental-strip-types apps\server\src\main.ts
pause
