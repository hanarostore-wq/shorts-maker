# Starts the MoneyOS desktop shell. It does not run a separate queue worker.
# The Blog department buttons launch the two complete upstream apps installed below desktop/apps.
# Run: powershell -NoProfile -ExecutionPolicy Bypass -File "$env:USERPROFILE\Desktop\Main\shorts-maker-social\desktop\start-social.ps1"
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$desktop = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not (Test-Path (Join-Path $desktop 'package-lock.json'))) { throw 'Run this script from a complete shorts-maker checkout.' }
if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) { throw 'Node.js and npm are required.' }
$legacyKeyFile = Join-Path $env:LOCALAPPDATA 'ShortsMakerControlRoom\social-key.dpapi'
if (Test-Path $legacyKeyFile) {
    Remove-Item -Force $legacyKeyFile
    Write-Host 'Removed the obsolete local social access-key file.'
}
$requiredApps = @(
    (Join-Path $desktop 'apps\naverblog-extention\package.json'),
    (Join-Path $desktop 'apps\threads-auto\package.json')
)
if (($requiredApps | Where-Object { -not (Test-Path $_) }).Count -gt 0) {
    Write-Host 'Installing the two complete upstream apps and the MoneyOS visual overlay once.'
    & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $desktop 'install-full-source.ps1')
    if ($LASTEXITCODE -ne 0) { throw 'Original application installation failed.' }
}
Push-Location $desktop
try {
    & npm.cmd ci --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw 'MoneyOS desktop shell installation failed.' }
    Write-Host 'Starting the MoneyOS control-room shell. No custom social queue worker is running.'
    Write-Host 'Open Blog department > Naver Blog or Threads > Original full app launch.'
    & npm.cmd start
    if ($LASTEXITCODE -ne 0) { throw 'MoneyOS desktop shell process failed.' }
} finally { Pop-Location }
