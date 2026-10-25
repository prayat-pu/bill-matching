@echo off
rem Stop the app if it is running in the background.
setlocal
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":40000" ^| findstr LISTENING') do (
  echo stopping pid %%p
  taskkill /pid %%p /f >nul 2>&1
)
echo stopped.
pause
