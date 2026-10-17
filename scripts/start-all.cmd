@echo off
setlocal EnableExtensions
title AI Job Proctor - Start All

REM One-click start for the whole stack: Postgres, API, kiosk, admin, camera and the voice agent.
REM
REM Everything is detached with `start` so the services survive this window - closing it only
REM stops nothing. Each service is skipped when it is already answering, so double-clicking
REM the icon twice is safe.
REM
REM Env switches:
REM   KIOSK_AUTO_OPEN=0   start the services without opening the kiosk page

cd /d "%~dp0.."
set "LIB=scripts\start-all-lib.ps1"

echo ============================================================
echo    AI Job Proctor - starting all services
echo    %CD%
echo ============================================================
echo.

echo [1/6] Postgres (Docker)
call :ensure_docker
if errorlevel 1 (
  echo       [!] Skipped Postgres - the API keeps retrying and the kiosk cannot save results.
) else (
  echo       bringing the postgres container up
  docker compose up -d postgres
  echo       waiting for Postgres on :5432 ...
  powershell -NoProfile -ExecutionPolicy Bypass -File "%LIB%" -Mode WaitPort -Port 5432 -TimeoutSeconds 120 >nul 2>&1
  if errorlevel 1 echo       [!] Postgres never answered on :5432 - see the output above.
)
echo.

echo [2/6] API  :4000
powershell -NoProfile -ExecutionPolicy Bypass -File "%LIB%" -Mode PortUp -Port 4000 >nul 2>&1
if errorlevel 1 (
  start "proctor-api" /min cmd /c "npm run dev:api > api.log 2>&1"
  echo       starting - http://localhost:4000/api/v1
) else (
  echo       already running - http://localhost:4000/api/v1
)
echo.

echo [3/6] Admin  :5174
powershell -NoProfile -ExecutionPolicy Bypass -File "%LIB%" -Mode PortUp -Port 5174 >nul 2>&1
if errorlevel 1 (
  start "proctor-admin" /min cmd /c "npm run dev:admin > admin.log 2>&1"
  echo       starting - http://localhost:5174
) else (
  echo       already running - http://localhost:5174
)
echo.

echo [4/6] Kiosk  :5173
powershell -NoProfile -ExecutionPolicy Bypass -File "%LIB%" -Mode PortUp -Port 5173 >nul 2>&1
if errorlevel 1 (
  start "proctor-kiosk" /min cmd /c "npm run dev:kiosk > kiosk.log 2>&1"
  echo       starting - http://localhost:5173
) else (
  echo       already running - http://localhost:5173
)
echo.

echo [5/6] Camera  :8090
powershell -NoProfile -ExecutionPolicy Bypass -File "%LIB%" -Mode PortUp -Port 8090 >nul 2>&1
if errorlevel 1 (
  where python >nul 2>nul
  if errorlevel 1 (
    echo       [!] Python was not found - the kiosk will report "camera check is unavailable".
  ) else (
    start "proctor-face" /min cmd /c "python scripts\face-presence.py > face.log 2>&1"
    echo       starting - the agent stays silent until a face is detected.
  )
) else (
  echo       already running - face detection is live.
)
echo.

echo [6/6] Voice agent (LiveKit Cloud)
powershell -NoProfile -ExecutionPolicy Bypass -File "%LIB%" -Mode ProcRunning -Match "voice-agent.src.index" >nul 2>&1
if errorlevel 1 (
  start "proctor-agent" /min cmd /c "npm run dev -w @proctor/voice-agent > agent.log 2>&1"
  echo       starting - registering with LiveKit Cloud.
) else (
  echo       already running - registered with LiveKit Cloud.
)
echo.

echo Waiting for the servers to answer ...
powershell -NoProfile -ExecutionPolicy Bypass -File "%LIB%" -Mode WaitPort -Port 4000 -TimeoutSeconds 150 >nul 2>&1
if errorlevel 1 echo       [!] API :4000 never came up - read api.log
powershell -NoProfile -ExecutionPolicy Bypass -File "%LIB%" -Mode WaitPort -Port 5174 -TimeoutSeconds 150 >nul 2>&1
if errorlevel 1 echo       [!] Admin :5174 never came up - read admin.log
powershell -NoProfile -ExecutionPolicy Bypass -File "%LIB%" -Mode WaitPort -Port 5173 -TimeoutSeconds 150 >nul 2>&1
if errorlevel 1 echo       [!] Kiosk :5173 never came up - read kiosk.log

echo.
echo ============================================================
echo    All services started
echo ============================================================
echo    Kiosk  http://localhost:5173   candidate interview
echo    Admin  http://localhost:5174   recruiter console
echo    API    http://localhost:4000/api/v1
echo.
echo    Logs: api.log  kiosk.log  admin.log  face.log  agent.log
echo    To stop: close the minimized "proctor-*" windows in the taskbar.
echo ============================================================

if /i not "%KIOSK_AUTO_OPEN%"=="0" (
  echo.
  echo Opening the kiosk ...
  start "" "http://localhost:5173"
)

echo.
pause
goto :eof

REM --- subroutines -----------------------------------------------------------

:ensure_docker
REM Polls instead of a fixed sleep: Docker Desktop's engine can take half a minute after
REM launching the app, and a fixed sleep either wastes time or gives up too early.
docker version >nul 2>&1 && exit /b 0
if not exist "%ProgramFiles%\Docker\Docker\Docker Desktop.exe" (
  echo       [!] Docker Desktop was not found at its default location.
  exit /b 1
)
echo       Docker engine is down - starting Docker Desktop. This can take a minute.
start "" "%ProgramFiles%\Docker\Docker\Docker Desktop.exe"
for /l %%i in (1,1,40) do (
  ping 127.0.0.1 -n 4 >nul
  docker version >nul 2>&1 && exit /b 0
)
echo       [!] Docker Desktop never became ready.
exit /b 1
