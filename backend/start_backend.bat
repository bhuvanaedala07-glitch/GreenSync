@echo off
setlocal
cd /d "%~dp0"
if not exist "venv\Scripts\python.exe" (
  echo Creating Python virtual environment...
  python -m venv venv
)
"venv\Scripts\python.exe" -m pip install -r requirements.txt
"venv\Scripts\python.exe" -m uvicorn main:app --reload --host 0.0.0.0 --port 8000
endlocal
