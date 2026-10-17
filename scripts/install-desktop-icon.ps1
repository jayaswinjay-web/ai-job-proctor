<#
  Creates the desktop shortcut that starts the whole stack, and builds its icon from the
  kiosk background.

  Run once after cloning (and again if the project moves, because the shortcut stores
  absolute paths):

    powershell -NoProfile -ExecutionPolicy Bypass -File scripts/install-desktop-icon.ps1

  Parameters let a multi-user PC install it elsewhere, e.g.
    -Desktop "C:\Users\Public\Desktop" -Name "Ramco Proctor"
#>
[CmdletBinding()]
param(
  [string]$Desktop = [Environment]::GetFolderPath('Desktop'),
  [string]$Name = 'AI Job Proctor'
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$launcher = Join-Path $repoRoot 'scripts/start-all.cmd'
$icon = Join-Path $PSScriptRoot 'assets/proctor-icon.ico'

if (-not (Test-Path -LiteralPath $launcher)) {
  throw "Launcher not found: $launcher"
}

$null = New-Item -ItemType Directory -Force -Path (Split-Path -Parent $icon)

# The only artwork in the repo is a portrait screenshot, so crop it to a centre square
# before downscaling - stretching a 16:9 screenshot into a square icon distorts the mill.
$sourceImage = Join-Path $repoRoot 'apps/kiosk/public/ramco-mills-bg.png'
if (-not (Test-Path -LiteralPath $sourceImage)) {
  throw "Icon source not found: $sourceImage"
}

Add-Type -AssemblyName System.Drawing

$source = [System.Drawing.Image]::FromFile($sourceImage)
try {
  $bitmap = New-Object System.Drawing.Bitmap 256, 256
  try {
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    try {
      $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
      $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality

      $side = [Math]::Min($source.Width, $source.Height)
      $sourceRect = New-Object System.Drawing.Rectangle ([int](($source.Width - $side) / 2)), ([int](($source.Height - $side) / 2)), $side, $side
      $targetRect = New-Object System.Drawing.Rectangle 0, 0, 256, 256
      $graphics.DrawImage($source, $targetRect, $sourceRect, [System.Drawing.GraphicsUnit]::Pixel)
    } finally {
      $graphics.Dispose()
    }

    $pngStream = New-Object System.IO.MemoryStream
    try {
      # Shell shortcuts read PNG-encoded frames, so a plain PNG in an ICO container is
      # enough and avoids needing a compressed BMP encoder.
      $bitmap.Save($pngStream, [System.Drawing.Imaging.ImageFormat]::Png)
      $png = $pngStream.ToArray()

      $fileStream = [System.IO.File]::Create($icon)
      try {
        $writer = New-Object System.IO.BinaryWriter($fileStream)
        try {
          # ICONDIR header (6 bytes) then one ICONDIRENTRY (16 bytes).
          $writer.Write([byte]0)      # reserved
          $writer.Write([byte]0)      # reserved
          $writer.Write([byte]1)      # resource type: 1 = icon
          $writer.Write([byte]0)      # resource type: high byte
          $writer.Write([byte]1)      # image count
          $writer.Write([byte]0)      # image count: high byte
          $writer.Write([byte]0)      # width 0 means 256
          $writer.Write([byte]0)      # height 0 means 256
          $writer.Write([byte]0)      # palette size (unused for truecolour)
          $writer.Write([byte]0)      # reserved
          $writer.Write([int16]1)     # colour planes
          $writer.Write([int16]32)   # bits per pixel
          $writer.Write([int32]$png.Length)   # image size
          $writer.Write([int32]22)            # offset: 6 header + 16 entry
          $writer.Write($png)
        } finally {
          $writer.Dispose()
        }
      } finally {
        $fileStream.Dispose()
      }
    } finally {
      $pngStream.Dispose()
    }
  } finally {
    $bitmap.Dispose()
  }
} finally {
  $source.Dispose()
}

$shortcutPath = Join-Path $Desktop "$Name.lnk"
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $launcher
$shortcut.WorkingDirectory = $repoRoot
$shortcut.IconLocation = "$icon,0"
$shortcut.Description = 'Start Postgres, API, kiosk, admin, camera and the voice agent'
$shortcut.Save()

Write-Host "Created: $shortcutPath"
Write-Host "Icon   : $icon"
Write-Host "Launcher: $launcher"
