@echo off
rem One-click install: Node, poppler, the key, the packages, the page.
rem Asks for administrator rights, then hands over to install.ps1.

net session >nul 2>&1
if errorlevel 1 (
  echo asking for administrator rights...
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -Verb RunAs -FilePath '%~f0'"
  exit /b
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1"
if errorlevel 1 (
  echo.
  echo Install did not finish. The message above says why.
)
pause
