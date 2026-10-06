# Run this from the repository's desktop folder using Windows PowerShell 5.1+.
# Installs the complete upstream source at reviewed revisions. Does not copy keys.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$desktop = Split-Path -Parent $MyInvocation.MyCommand.Path
$apps = Join-Path $desktop 'apps'
$manifest = Get-Content -Raw -Encoding UTF8 (Join-Path $desktop 'source-apps.json') | ConvertFrom-Json
foreach ($tool in @('git', 'node', 'npm.cmd')) {
    if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { throw "$tool is required." }
}
$nodeVersion = [version]((node --version).TrimStart('v'))
if (($nodeVersion.Major -eq 24 -and $nodeVersion -lt [version]'24.15.0') -or ($nodeVersion.Major -ne 24 -and $nodeVersion.Major -lt 26)) {
    throw "Threads Auto requires Node.js >=24.15.0 <25 or >=26. Current: $nodeVersion. Install a compatible Node.js version and retry."
}
if (-not (Test-Path $apps)) { New-Item -ItemType Directory -Force -Path $apps | Out-Null }
foreach ($name in @('naver', 'threads')) {
    $spec = $manifest.$name
    $directory = Join-Path $desktop $spec.localDirectory
    if (-not (Test-Path $directory)) {
        & git clone $spec.repository $directory
        if ($LASTEXITCODE -ne 0) { throw "Clone failed: $name" }
    } elseif (-not (Test-Path (Join-Path $directory '.git'))) {
        throw "Not a Git checkout, refusing to overwrite: $directory"
    }
    $origin = (& git -C $directory remote get-url origin).Trim()
    if ($origin -ne $spec.repository) { throw "Unexpected source repository for $name. Refusing to run it." }
    $changes = & git -C $directory status --porcelain
    if ($changes) { throw "Local edits found in $directory. Refusing to overwrite them." }
    & git -C $directory fetch origin
    if ($LASTEXITCODE -ne 0) { throw "Fetch failed: $name" }
    & git -C $directory checkout --detach $spec.commit
    if ($LASTEXITCODE -ne 0) { throw "Unable to checkout verified commit: $name" }
    $actual = (& git -C $directory rev-parse HEAD).Trim()
    if ($actual -ne $spec.commit) { throw "Source commit did not match manifest: $name" }
    Push-Location $directory
    try {
        if ($name -eq 'naver') { & npm.cmd ci --no-audit --no-fund }
        else { & npm.cmd run setup }
        if ($LASTEXITCODE -ne 0) { throw "Dependency setup failed: $name" }
    } finally { Pop-Location }
    Write-Host "$name complete source installed at $actual"
}
Write-Host 'Both original programs are installed. Restart the control-room desktop browser and use the full-program launch buttons in the Blog department.'
