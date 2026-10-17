<#
  Readiness checks shared by scripts\start-all.cmd.

  Kept in its own file so the batch launcher can call one testable helper instead of
  embedding PowerShell inside cmd's quoting. Every mode reports through the exit code so
  the batch file can branch with `if errorlevel 1`:

    PortUp      0 = a TCP connection to -Port was accepted
    WaitPort    0 = the port came up within -TimeoutSeconds, 1 = it timed out
    ProcRunning 0 = a node.exe process whose command line matches -Match is alive

  Usage from cmd:
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts\start-all-lib.ps1 -Mode PortUp -Port 4000
#>
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('PortUp', 'WaitPort', 'ProcRunning')]
  [string]$Mode,

  [int]$Port = 0,
  [int]$TimeoutSeconds = 60,
  [string]$Match = ''
)

$ErrorActionPreference = 'Stop'

function Test-TcpPort([int]$Port) {
  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $client.Connect('127.0.0.1', $Port)
    return $client.Connected
  } catch {
    return $false
  } finally {
    $client.Dispose()
  }
}

function Wait-TcpPort([int]$Port, [int]$TimeoutSeconds) {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    if (Test-TcpPort $Port) { return $true }
    Start-Sleep -Milliseconds 500
  }
  # One last check: the deadline may have slipped a few hundred milliseconds.
  return (Test-TcpPort $Port)
}

function Test-NodeProcess([string]$Pattern) {
  $processes = Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue
  foreach ($process in $processes) {
    if ($process.CommandLine -and $process.CommandLine -match $Pattern) { return $true }
  }
  return $false
}

switch ($Mode) {
  'PortUp' { if (Test-TcpPort $Port) { exit 0 } else { exit 1 } }
  'WaitPort' { if (Wait-TcpPort $Port $TimeoutSeconds) { exit 0 } else { exit 1 } }
  'ProcRunning' { if (Test-NodeProcess $Match) { exit 0 } else { exit 1 } }
}
