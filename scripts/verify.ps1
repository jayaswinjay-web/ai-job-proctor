<#
  Boots the API in the background, runs the acceptance suite against it, then shuts
  the API down. Keeping all three in one process group means the run is reproducible
  and never leaves a stray listener behind.

    powershell -ExecutionPolicy Bypass -File scripts/verify.ps1
    powershell -ExecutionPolicy Bypass -File scripts/verify.ps1 -SkipTypecheck
#>
param(
  [string]$BaseUrl = 'http://127.0.0.1:4000',
  [int]$TimeoutSeconds = 120,
  [switch]$SkipTypecheck,
  [switch]$SkipUnitTests
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

function Write-Step([string]$message) {
  Write-Host ''
  Write-Host "==> $message" -ForegroundColor Cyan
}

function Get-PortOwner([int]$port) {
  $connection = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
  if (-not $connection) { return $null }
  return $connection[0].OwningProcess
}

# ---------------------------------------------------------------- type check
if (-not $SkipTypecheck) {
  Write-Step 'Type-checking every workspace'
  # `npm run typecheck` covers the packages plus all three apps. Running the root project
  # alone would miss the frontends, which is where a stale shared type surfaces.
  npm run typecheck --silent
  if ($LASTEXITCODE -ne 0) { throw 'Type check failed.' }
}

# ------------------------------------------------------------------ unit tests
if (-not $SkipUnitTests) {
  Write-Step 'Running unit tests'
  # These need no database, so they run before Docker is touched and fail fast on a logic
  # regression rather than after a full boot.
  npm run test --silent
  if ($LASTEXITCODE -ne 0) { throw 'Unit tests failed.' }
}

# ------------------------------------------------------------------ database
Write-Step 'Ensuring PostgreSQL is running'
docker compose up -d postgres | Out-Null
$healthy = ''
for ($i = 0; $i -lt 40; $i++) {
  $healthy = docker inspect --format '{{.State.Health.Status}}' proctor-postgres 2>$null
  if ($healthy -eq 'healthy') { break }
  Start-Sleep -Seconds 2
}
if ($healthy -ne 'healthy') { throw "PostgreSQL is not healthy (status: $healthy)" }

Write-Step 'Applying migrations and seed data'
npm run db:migrate --silent | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Migrations failed.' }
npm run db:seed --silent | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Seed failed.' }

# ---------------------------------------------------------------- free port
# A stale listener here would silently answer the health check while the freshly built
# server failed to bind, so the suite would run against old code. Fail loudly instead.
$port = ([uri]$BaseUrl).Port
$owner = Get-PortOwner $port
if ($owner) {
  Write-Host "Port $port is already in use by PID $owner. Stopping it." -ForegroundColor Yellow
  Stop-Process -Id $owner -Force -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 2
  if (Get-PortOwner $port) { throw "Could not free port $port." }
}

# --------------------------------------------------------------------- API
Write-Step 'Starting the API'
$outLog = Join-Path $repoRoot 'api-verify.log'
$errLog = Join-Path $repoRoot 'api-verify.err'
Remove-Item $outLog, $errLog -ErrorAction SilentlyContinue

$api = Start-Process -FilePath 'npx.cmd' `
  -ArgumentList 'tsx', 'src/server.ts' `
  -WorkingDirectory (Join-Path $repoRoot 'apps/api') `
  -RedirectStandardOutput $outLog `
  -RedirectStandardError $errLog `
  -WindowStyle Hidden `
  -PassThru

$ready = $false
for ($i = 0; $i -lt $TimeoutSeconds; $i++) {
  Start-Sleep -Seconds 1
  if ($api.HasExited) { break }
  try {
    $health = Invoke-RestMethod -Uri "$BaseUrl/healthz" -TimeoutSec 2
    if ($health.status -eq 'ok') { $ready = $true; break }
  } catch {
    # not up yet
  }
}

if (-not $ready) {
  Write-Host ''
  Write-Host '--- api stdout (last 30) ---' -ForegroundColor Red
  Get-Content $outLog -ErrorAction SilentlyContinue | Select-Object -Last 30
  Write-Host '--- api stderr (last 30) ---' -ForegroundColor Red
  Get-Content $errLog -ErrorAction SilentlyContinue | Select-Object -Last 30
  if (-not $api.HasExited) { $api | Stop-Process -Force }
  throw "API did not become healthy within $TimeoutSeconds seconds."
}

# ----------------------------------------------------------- admin contract
# Run before the acceptance suite, not after. Both sign in and the login endpoint is
# rate limited per IP, so a probe that ran afterwards failed with a 429 that had nothing
# to do with the contract it was checking.
Write-Step 'Checking the admin API contract'
# Asserts the response envelopes the admin console reads, so a route changing shape fails
# here rather than as an undefined value in a recruiter's browser.
node scripts/probe-admin.mjs $BaseUrl
$contractExit = $LASTEXITCODE

# ------------------------------------------------------------------- suite
Write-Step 'Running the acceptance suite'
$acceptanceExit = 1
try {
  node scripts/acceptance.mjs $BaseUrl
  $acceptanceExit = $LASTEXITCODE
} finally {
  Write-Step 'Stopping the API'
  if (-not $api.HasExited) { $api | Stop-Process -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Seconds 1
  $leftover = Get-PortOwner $port
  if ($leftover) { Stop-Process -Id $leftover -Force -ErrorAction SilentlyContinue }
}

if ($acceptanceExit -ne 0) {
  Write-Host ''
  Write-Host 'Server-side errors during the run:' -ForegroundColor Red
  Get-Content $outLog -ErrorAction SilentlyContinue |
    Select-String -Pattern '"level":"error"' |
    Select-Object -Last 20 |
    ForEach-Object { Write-Host $_.Line }
  exit $acceptanceExit
}

if ($contractExit -ne 0) { exit $contractExit }

Write-Host ''
Write-Host 'Verification passed.' -ForegroundColor Green
