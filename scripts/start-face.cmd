@echo off
REM Starts the local face-presence sidecar that the kiosk polls.
REM
REM It owns the webcam with OpenCV and answers GET /presence so the kiosk knows when a
REM candidate is standing in front of the camera. Requires Python with opencv-python.
REM
REM Detached with `start` for the same reason as the dev servers: it must outlive this shell.

cd /d "%~dp0.."

start "proctor-face" /min cmd /c "python scripts\face-presence.py > face.log 2>&1"

echo Started: face-presence :8090
