<#
  Readiness checks shared by scripts\start-all.cmd.

  Kept in its own file so the batch launcher can call one testable helper instead of
  embedding PowerShell inside cmd's quoting. Every mode reports through the exit code so
  the batch file can branch with `if errorlevel 1`:

    PortUp      0 = a TCP connection to -Port was accepted (tries 127.0.0.1 then ::1)
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
  # Try both address families: Vite (5173/5174) binds ::1, the API (4000) binds 0.0.0.0.
  foreach ($family in @('InterNetwork', 'InterNetworkV6')) {
    $client = New-Object System.Net.Sockets.TcpClient($family)
    try {
      $address = if ($family -eq 'InterNetwork') { [System.Net.IPAddress]::Parse('127.0.0.1') } else { [System.Net.IPAddress]::Parse('::1') }
      $connect = $client.ConnectAsync($address, $Port)
      if ($connect.Wait(1500) -and $client.Connected) { return $true }
    } catch {
      # connection refused / unavailable - try the next family
    } finally {
      $client.Dispose()
    }
  }
  return $false
}

function Wait-TcpPort([int]$Port, [int]$TimeoutSeconds) {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    if (Test-TcpPort $Port) { return $true }
    Start-Sleep -Milliseconds 500
  }
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
