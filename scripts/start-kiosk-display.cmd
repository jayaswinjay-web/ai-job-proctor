@echo off
REM Opens the kiosk in full-screen kiosk mode with sound autoplay enabled.
REM
REM Browsers block autoplay WITH AUDIO until the page has been interacted with. The
REM `--autoplay-policy=no-user-gesture-required` flag removes that restriction, so the
REM Ramco Mills intro plays with sound immediately on a fresh kiosk.
REM
REM `--use-fake-ui-for-media-stream` auto-accepts the microphone prompt, which a kiosk
REM appliance cannot answer by hand. Run the dev servers first (scripts\start-dev.cmd),
REM or point KIOSK_URL at the deployed kiosk.

setlocal
set "KIOSK_URL=%KIOSK_URL%"
if "%KIOSK_URL%"=="" set "KIOSK_URL=http://localhost:5173"

set "FLAGS=--kiosk --autoplay-policy=no-user-gesture-required --use-fake-ui-for-media-stream --no-first-run --no-default-browser-check"

set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" set "CHROME=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"

set "EDGE=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" set "EDGE=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"

if exist "%CHROME%" (
  echo Opening kiosk in Chrome: %KIOSK_URL%
  start "" "%CHROME%" %FLAGS% "%KIOSK_URL%"
  goto :eof
)

if exist "%EDGE%" (
  echo Opening kiosk in Edge: %KIOSK_URL%
  start "" "%EDGE%" %FLAGS% "%KIOSK_URL%"
  goto :eof
)

echo Chrome or Edge was not found. Open %KIOSK_URL% manually with the flag:
echo   --autoplay-policy=no-user-gesture-required
