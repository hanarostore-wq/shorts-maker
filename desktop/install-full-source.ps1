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
    # MoneyOS only appends a renderer CSS file and a stylesheet link. Preserve every
    # upstream behavior file and refuse to touch user edits outside those visual files.
    $themeHtml = if ($name -eq 'naver') { 'src/renderer/index.html' } else { 'index.html' }
    $allowedThemeFiles = @($themeHtml, 'src/renderer/moneyos.css', '.moneyos-theme.json')
    $changes = @(& git -C $directory status --porcelain)
    $unexpected = @()
    foreach ($change in $changes) {
        $changedPath = $change.Substring(3).Trim()
        if ($changedPath -notin $allowedThemeFiles) { $unexpected += $changedPath }
    }
    if ($unexpected.Count -gt 0) { throw "Local functional edits found in $directory. Refusing to overwrite: $($unexpected -join ', ')" }
    if ($changes.Count -gt 0) {
        & git -C $directory restore --staged --worktree -- $themeHtml
        if ($LASTEXITCODE -ne 0) { throw "Unable to reset prior MoneyOS CSS link: $name" }
        Remove-Item -Force -ErrorAction SilentlyContinue (Join-Path $directory 'src/renderer/moneyos.css'), (Join-Path $directory '.moneyos-theme.json')
    }
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
    & node (Join-Path $desktop 'moneyos-theme/apply-moneyos-theme.js') --root $directory --kind $name
    if ($LASTEXITCODE -ne 0) { throw "MoneyOS visual overlay failed: $name" }
    Write-Host "$name complete original source installed at $actual with MoneyOS visual overlay"
}
Write-Host 'Both original programs are installed. Only renderer CSS and a stylesheet link were changed; original automation behavior remains intact.'
