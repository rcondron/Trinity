# Trinity Windows Build Script
# Produces TrinitySetup.exe
#
# Prerequisites:
#   - Go 1.22+
#   - Inno Setup 6 (iscc.exe in PATH)
#
# Usage:
#   .\scripts\build-windows.ps1

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$AppDir = Split-Path -Parent $ScriptDir
$ProjectRoot = Split-Path -Parent $AppDir
$DistDir = Join-Path $AppDir "dist\windows"

Write-Host ""
Write-Host "  === Building Trinity for Windows ==="
Write-Host ""

# Clean.
if (Test-Path $DistDir) { Remove-Item -Recurse -Force $DistDir }
New-Item -ItemType Directory -Force -Path $DistDir | Out-Null

# Build trinity-bridge.exe
Write-Host "Building trinity-bridge.exe..."
Push-Location (Join-Path $ProjectRoot "Trinity-Bridge")
$env:GOOS = "windows"; $env:GOARCH = "amd64"
go build -o (Join-Path $DistDir "trinity-bridge.exe") ./cmd/bridge
Pop-Location

# Build trinity app.exe (GUI mode — no console window).
Write-Host "Building 'trinity app.exe'..."
Push-Location $AppDir
$env:GOOS = "windows"; $env:GOARCH = "amd64"
go build -ldflags "-H windowsgui" -o (Join-Path $DistDir "trinity app.exe") ./cmd/app
Pop-Location

# Create installer.
$IssFile = Join-Path $AppDir "installer\trinity.iss"
if (Get-Command iscc.exe -ErrorAction SilentlyContinue) {
    Write-Host "Building TrinitySetup.exe with Inno Setup..."
    iscc.exe $IssFile /O"$DistDir" /F"TrinitySetup"
    Write-Host ""
    Write-Host "  TrinitySetup.exe: $DistDir\TrinitySetup.exe"
} else {
    Write-Host ""
    Write-Host "  WARNING: Inno Setup not found. Install it from https://jrsoftware.org/isinfo.php"
    Write-Host "  Binaries built to: $DistDir"
}

Write-Host ""
Write-Host "  === Done ==="
Write-Host ""
