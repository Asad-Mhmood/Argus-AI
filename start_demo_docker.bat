@echo off
REM ============================================================
REM  VisionGuard AI — one-click public demo (DOCKER edition)
REM  All 4 modules incl. face recognition. Needs Docker Desktop.
REM
REM  WARNING: needs a machine with 8+ GB RAM. On smaller machines
REM  the engine gets killed mid-analysis — use start_demo.bat there.
REM ============================================================

echo Checking Docker...
docker info >nul 2>&1
if errorlevel 1 (
    echo.
    echo [ERROR] Docker Desktop is not running. Start it first, then re-run this script.
    pause
    exit /b 1
)

echo Starting VisionGuard engine container (first start takes ~1 min)...
docker compose -f "%~dp0docker-compose.yml" up -d backend
if errorlevel 1 (
    echo [ERROR] Could not start the container. Is port 8000 already in use?
    echo         Close any "VisionGuard Engine" window from start_demo.bat and retry.
    pause
    exit /b 1
)

echo Starting Cloudflare Tunnel (window 2)...
start "Cloudflare Tunnel" cmd /k ""C:\Program Files (x86)\cloudflared\cloudflared.exe" tunnel --url http://localhost:8000"

echo.
echo ============================================================
echo  Engine is starting in Docker (background).
echo  The "Cloudflare Tunnel" window shows your PUBLIC URL:
echo        https://something-random.trycloudflare.com
echo.
echo  NEXT STEP:
echo   Open https://visionguard-eta.vercel.app , click "Engine"
echo   (top right), paste the public URL, and Save.
echo.
echo  TO STOP:  close the tunnel window, then run:
echo        docker compose stop backend
echo ============================================================
pause
