# Start the desktop control-room browser and its scheduling worker.
# Run: powershell -NoProfile -ExecutionPolicy Bypass -File "$env:USERPROFILE\Desktop\Main\shorts-maker-social\desktop\start-social.ps1"
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$desktop = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not (Test-Path (Join-Path $desktop 'package-lock.json'))) { throw 'Run this script from a complete shorts-maker checkout.' }
if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) { throw 'Node.js and npm are required.' }
$settingsDir = Join-Path $env:LOCALAPPDATA 'ShortsMakerControlRoom'
$keyFile = Join-Path $settingsDir 'social-key.dpapi'
$secureKey = $null
if (Test-Path $keyFile) {
    try {
        $secureKey = Get-Content -Raw -Encoding UTF8 $keyFile | ConvertTo-SecureString
        Write-Host 'Using the saved social access key for this Windows account.'
    } catch {
        Write-Warning 'The saved key cannot be opened. A new key is needed.'
    }
}
if ($null -eq $secureKey) {
    Write-Host 'Enter the social access key shown in the private Manus key file. It will not appear on screen.'
    $secureKey = Read-Host 'Social access key' -AsSecureString
    if ($secureKey.Length -eq 0) { throw 'Social access key cannot be empty.' }
    if (-not (Test-Path $settingsDir)) { New-Item -ItemType Directory -Force -Path $settingsDir | Out-Null }
    # ConvertFrom-SecureString uses Windows DPAPI for the current user, not plaintext.
    $secureKey | ConvertFrom-SecureString | Set-Content -Encoding UTF8 $keyFile
}
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureKey)
try {
    $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
    if ([string]::IsNullOrWhiteSpace($plain)) { throw 'Social access key cannot be empty.' }
    $env:SOCIAL_CONTROL_KEY = $plain
    $plain = $null
    Push-Location $desktop
    try {
        & npm.cmd ci --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) { throw 'npm ci failed.' }
        Write-Host 'Starting the control-room browser and worker. Keep this window open.'
        & npm.cmd start
        if ($LASTEXITCODE -ne 0) { throw 'Desktop browser process failed.' }
    } finally { Pop-Location }
} finally {
    $env:SOCIAL_CONTROL_KEY = $null
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
}
