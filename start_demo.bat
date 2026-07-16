@echo off
REM ============================================================
REM  VisionGuard AI — one-click public demo
REM  Starts the engine + a Cloudflare Tunnel with a public URL.
REM ============================================================

echo Starting VisionGuard engine (window 1)...
start "VisionGuard Engine" cmd /k "cd /d %~dp0backend && .venv\Scripts\python -m uvicorn app.main:app --host 0.0.0.0 --port 8000"

echo Starting Cloudflare Tunnel (window 2)...
start "Cloudflare Tunnel" cmd /k ""C:\Program Files (x86)\cloudflared\cloudflared.exe" tunnel --url http://localhost:8000"

echo.
echo ============================================================
echo  Two windows opened:
echo   1) VisionGuard Engine  - the AI backend
echo   2) Cloudflare Tunnel   - shows your PUBLIC URL, e.g.
echo        https://something-random.trycloudflare.com
echo.
echo  NEXT STEP:
echo   Open your dashboard (https://visionguard-eta.vercel.app),
echo   click the "Engine" button (top right), paste the public
echo   URL from window 2, and hit Save.
echo.
echo  To stop the demo: close both windows.
echo ============================================================
pause
