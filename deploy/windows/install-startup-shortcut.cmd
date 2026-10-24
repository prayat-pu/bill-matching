@echo off
rem Easiest autostart: a shortcut in this user's Startup folder.
rem No administrator rights needed. Starts at logon, hidden.
cscript //nologo "%~dp0make-shortcut.vbs"
echo.
echo Shortcut created in your Startup folder.
echo Remove it later: press Win+R, type  shell:startup  and delete "Bill Matching".
echo.
echo Other PCs also need TCP %PORT% open. If they cannot connect, run this once
echo in an Administrator prompt:
echo   netsh advfirewall firewall add rule name="Bill Matching" dir=in action=allow protocol=TCP localport=40000
pause
