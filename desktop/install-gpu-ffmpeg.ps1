$ErrorActionPreference = "Stop"

function Get-FfmpegEncoders([string]$Exe) {
  try { return (& $Exe -hide_banner -encoders 2>$null | Out-String) } catch { return "" }
}

$existing = Get-Command ffmpeg -ErrorAction SilentlyContinue
if ($existing) {
  $encoders = Get-FfmpegEncoders $existing.Source
  if ($encoders -match "h264_(nvenc|qsv|amf)") {
    Write-Host "GPU 인코더가 있는 FFmpeg를 이미 찾았습니다: $($existing.Source)" -ForegroundColor Green
    exit 0
  }
  Write-Host "기존 FFmpeg에는 NVIDIA·Intel·AMD GPU 인코더가 없습니다. GPU 지원 빌드를 설치합니다." -ForegroundColor Yellow
}

$winget = Get-Command winget -ErrorAction SilentlyContinue
if (-not $winget) {
  throw "Windows Package Manager(winget)를 찾지 못했습니다. winget 설치 후 이 스크립트를 다시 실행하거나 GPU 지원 FFmpeg를 설치한 뒤 ffmpeg.exe를 PATH에 추가하세요."
}

Write-Host "GPU 인코더 지원 FFmpeg를 설치합니다..." -ForegroundColor Cyan
& $winget.Source install --id Gyan.FFmpeg.Shared --exact --source winget --accept-package-agreements --accept-source-agreements
if ($LASTEXITCODE -ne 0) { throw "FFmpeg 설치가 완료되지 않았습니다. winget 오류 코드: $LASTEXITCODE" }

Write-Host "설치가 끝났습니다. 운영본부 PC 브라우저와 PowerShell을 완전히 닫은 뒤 다시 실행하세요." -ForegroundColor Green
Write-Host "재실행 후 이어붙이기에서 '그래픽 가속 자동 선택'을 사용하면 NVENC·Quick Sync·AMF를 자동 검사합니다." -ForegroundColor Green
