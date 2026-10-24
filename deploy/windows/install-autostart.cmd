@echo off
rem Run the app at logon, without a visible console window.
rem Run this file as Administrator.
setlocal
cd /d "%~dp0"
set TASK=BillMatching

schtasks /query /tn %TASK% >nul 2>&1 && schtasks /delete /tn %TASK% /f >nul

rem wscript hides the console; start-hidden.vbs launches start.cmd behind it.
schtasks /create /tn %TASK% /sc onlogon /rl highest /f ^
  /tr "wscript.exe \"%~dp0start-hidden.vbs\""
if errorlevel 1 (echo could not create the task - run this as Administrator & pause & exit /b 1)

echo.
echo === opening the firewall for port 40000 ===
netsh advfirewall firewall delete rule name="Bill Matching" >nul 2>&1
netsh advfirewall firewall add rule name="Bill Matching" dir=in action=allow protocol=TCP localport=40000
echo.
echo Done. The app starts at the next logon, or run start.cmd now.
echo Remove it later with:  schtasks /delete /tn %TASK% /f
pause
