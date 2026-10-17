<#
  Polls the three dev servers until each answers, then reports which log to read if one
  is still down.

  Kept separate from start-dev.cmd so the readiness check can be written in PowerShell
  without fighting cmd's quoting, and so it can be run on its own against already-started
  servers.

    powershell -NoProfile -ExecutionPolicy Bypass -File scripts/wait-dev.ps1
#>
param(
  [int]$TimeoutSeconds = 150,
  [int[]]$Ports = @(4000, 5173, 5174)
)

$ErrorActionPreference = 'Continue'

function Get-LogFor([int]$port) {
  switch ($port) {
    4000 { 'api.log' }
    5173 { 'kiosk.log' }
    5174 { 'admin.log' }
    default { '' }
  }
}

$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
$up = @{}

while ((Get-Date) -lt $deadline) {
  $up = @{}
  foreach ($port in $Ports) {
    try {
      $response = Invoke-WebRequest "http://localhost:$port" -UseBasicParsing -TimeoutSec 3
      if ($response.StatusCode -eq 200) { $up[$port] = $true }
    } catch {
      $up[$port] = $false
    }
  }
  if ($up.Values -notcontains $false) { break }
  Start-Sleep -Seconds 2
}

$failed = @()
foreach ($port in $Ports) {
  if ($up[$port]) {
    Write-Host "  $port -> up"
  } else {
    Write-Host "  $port -> DOWN  (see $(Get-LogFor $port))" -ForegroundColor Red
    $failed += $port
  }
}

if ($failed.Count -gt 0) {
  foreach ($port in $failed) {
    $log = Get-LogFor $port
    if ($log -and (Test-Path $log)) {
      Write-Host ''
      Write-Host "--- $log (last 15 lines) ---" -ForegroundColor Red
      Get-Content $log -Tail 15
    }
  }
  exit 1
}

Write-Host ''
Write-Host 'All dev servers are up. Kiosk :5173, admin :5174, API :4000.' -ForegroundColor Green
