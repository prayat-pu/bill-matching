@echo off
rem Install everything into this folder. No administrator rights, no reboot,
rem nothing added to PATH. Double-click this file.
setlocal
cd /d "%~dp0"

set PY=
py -3 --version >nul 2>&1 && set PY=py -3
if "%PY%"=="" (python --version >nul 2>&1 && set PY=python)
if "%PY%"=="" (
  echo.
  echo   Python was not found. Install Python 3.9 or newer from python.org
  echo   and tick "Add python.exe to PATH" in the installer.
  echo.
  pause & exit /b 1
)

%PY% install.py
if errorlevel 1 (
  echo.
  echo   Install did not finish. The message above says why.
)
pause
