# Registers only the local ClipJoin worker. It does not start the control-room browser or install blog apps.
# Run once: powershell -NoProfile -ExecutionPolicy Bypass -File "$env:USERPROFILE\Desktop\Main\shorts-maker-social\desktop\install-concat-worker.ps1"
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$desktop = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not (Test-Path (Join-Path $desktop 'package-lock.json'))) { throw 'Run this script from a complete shorts-maker checkout.' }
if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) { throw 'Node.js and npm are required.' }

Push-Location $desktop
try {
    & npm.cmd ci --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw 'Local concatenate worker installation failed.' }
    & npm.cmd run register:concat
    if ($LASTEXITCODE -ne 0) { throw 'Local concatenate worker registration failed.' }
    Write-Host ''
    Write-Host 'ClipJoin local worker is ready.' -ForegroundColor Green
    Write-Host 'Open the Shorts department > Concatenate employee in the control room, then click the local start button.'
    Write-Host 'Videos are selected and processed only on this PC. The worker exits after every job.'
} finally { Pop-Location }
