@echo off
rem Stop whatever is listening on port 40000.
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":40000" ^| findstr LISTENING') do (
  echo stopping pid %%p
  taskkill /pid %%p /f >nul 2>&1
)
echo stopped.
pause
