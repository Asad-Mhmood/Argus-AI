@echo off
REM VisionGuard — deploy the backend to Modal (modal.com).
REM First time only:  deploy_modal.bat setup     (opens a browser to log in)
REM Deploy / update:  deploy_modal.bat
setlocal
set PY="%~dp0backend\.venv\Scripts\python.exe"
if /i "%~1"=="setup" (
  %PY% -m modal setup
) else (
  %PY% -m modal deploy "%~dp0backend\modal_app.py"
)
