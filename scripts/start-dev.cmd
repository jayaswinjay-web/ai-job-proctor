@echo off
REM Starts the API, kiosk and admin dev servers detached from this shell.
REM
REM Each server is launched with `start` so it is not a child of the calling process and
REM survives the terminal that ran this script. Without that, closing the shell kills all
REM three servers and every page appears unreachable.
REM
REM Deliberately does no waiting: `timeout` refuses to run with redirected stdin, which is
REM how automation invokes this, and embedding the readiness poll here made the quoting
REM unreadable. `wait-dev.ps1` polls instead.

cd /d "%~dp0.."

start "proctor-api"   /min cmd /c "npm run dev:api   > api.log   2>&1"
start "proctor-kiosk" /min cmd /c "npm run dev:kiosk > kiosk.log 2>&1"
start "proctor-admin" /min cmd /c "npm run dev:admin > admin.log 2>&1"

REM Local face-presence sidecar (OpenCV + webcam). The kiosk stays silent until it reports a
REM person at the camera. Skipped silently if Python or OpenCV is missing — the kiosk then
REM shows "camera check is unavailable".
where python >nul 2>nul && start "proctor-face" /min cmd /c "python scripts\face-presence.py > face.log 2>&1"

echo Started: API :4000, kiosk :5173, admin :5174, face :8090
