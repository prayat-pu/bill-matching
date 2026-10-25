@echo off
rem Start the app using the Node inside .runtime - nothing from the system.
setlocal enabledelayedexpansion
cd /d "%~dp0..\.."
set PORT=40000

if not exist ".runtime\node\node.exe" (
  echo.
  echo   Not installed yet. Double-click deploy\portable\install.cmd first.
  echo.
  pause & exit /b 1
)

rem Point the renderer at the poppler that lives in this folder.
if exist "vendor\poppler\Library\bin\pdftoppm.exe" set PDFTOPPM=%CD%\vendor\poppler\Library\bin\pdftoppm.exe
if exist "vendor\poppler\bin\pdftoppm.exe" set PDFTOPPM=%CD%\vendor\poppler\bin\pdftoppm.exe

set HOST=0.0.0.0
set NODE_ENV=production
set WEB_DIST=%CD%\apps\web\dist

echo.
echo   ========================================================
echo    READY - open this in Chrome
echo   ========================================================
echo.
echo    this computer:
echo      http://localhost:%PORT%
echo.
echo    other computers in the office:
powershell -NoProfile -Command ^
  "$a=Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -ne '127.0.0.1' -and $_.InterfaceAlias -notmatch 'Docker|WSL|Loopback|vEthernet' }; if($a){ $a | ForEach-Object { '     http://' + $_.IPAddress + ':%PORT%' } } else { '     ask IT for this computer''s address, then add :%PORT%' }"
echo.
echo   ========================================================
echo    Keep this window open. Closing it stops the app.
echo   ========================================================
echo.
start "" "http://localhost:%PORT%"
".runtime\node\node.exe" --env-file-if-exists=.env --experimental-strip-types apps\server\src\main.ts
pause
