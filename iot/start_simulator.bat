@echo off
set ROOT=%~dp0..
set PY=%ROOT%backend\venv\Scripts\python.exe
if not exist "%PY%" (
  echo GreenSync backend venv not found.
  echo Start the backend setup first.
  pause
  exit /b 1
)
"%PY%" "%~dp0simulate_bin.py"
pause
