@echo off
chcp 65001 >nul
rem 웨일 영상 다운로더 - 설치·업데이트 (더블클릭할 때만 동작, 자동 실행 등록 없음)
powershell -NoProfile -ExecutionPolicy Bypass -Command "$s=[IO.File]::ReadAllText('%~f0',[Text.Encoding]::UTF8); $i=$s.IndexOf([char]10+'#PS-START'); Invoke-Expression $s.Substring($i+1)" "%~f0"
pause
exit /b
#PS-START
$ErrorActionPreference = 'Stop'
$Root = 'C:\WhaleVideoDownloader'
$Ext  = Join-Path $Root 'whale-video-downloader\extension'
$Url  = 'https://codeload.github.com/hanarostore-wq/shorts-maker/zip/refs/heads/claude/charming-lamport-ad829a'

function Fail($step, $reason, $action) {
  Write-Host ''
  Write-Host "[실패] 단계: $step" -ForegroundColor Red
  Write-Host "       원인: $reason" -ForegroundColor Red
  Write-Host "       해결: $action" -ForegroundColor Yellow
  exit 1
}
function VerOf($dir) {
  try { return (Get-Content -Raw -Encoding UTF8 (Join-Path $dir 'manifest.json') | ConvertFrom-Json).version } catch { return '' }
}

Write-Host '웨일 영상 다운로더 설치·업데이트를 시작합니다...'
$before = VerOf $Ext

if (Test-Path (Join-Path $Root '.git')) {
  # git 으로 받아 둔 폴더면 그대로 최신으로 갱신
  if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Fail '최신 버전 받기' 'git 이 설치되어 있지 않습니다' 'https://git-scm.com 에서 Git 을 설치하거나, C:\WhaleVideoDownloader 폴더를 지운 뒤 이 파일을 다시 실행하세요.' }
  git -C $Root fetch --quiet origin claude/charming-lamport-ad829a
  if ($LASTEXITCODE -ne 0) { Fail '최신 버전 받기' 'GitHub 에 연결하지 못했습니다' '인터넷 연결을 확인한 뒤 다시 실행하세요.' }
  git -C $Root reset --hard --quiet origin/claude/charming-lamport-ad829a
  if ($LASTEXITCODE -ne 0) { Fail '파일 덮어쓰기' 'git 으로 파일을 바꾸지 못했습니다' '웨일을 잠시 닫거나 폴더를 연 프로그램을 닫고 다시 실행하세요.' }
} else {
  # git 없이: GitHub 에서 압축 파일을 받아 확장 폴더에 덮어쓰기
  $tmp = Join-Path $env:TEMP ('wvd-' + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Force -Path $tmp | Out-Null
  $zip = Join-Path $tmp 'latest.zip'
  try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -Uri $Url -OutFile $zip -UseBasicParsing -TimeoutSec 180
  } catch { Fail '최신 버전 받기' "GitHub 에 연결하지 못했습니다 ($($_.Exception.Message))" '인터넷 연결을 확인한 뒤 다시 실행하세요.' }
  try { Expand-Archive -Path $zip -DestinationPath $tmp -Force } catch { Fail '압축 풀기' "받은 파일을 풀지 못했습니다 ($($_.Exception.Message))" '잠시 후 다시 실행하세요. 계속되면 백신 프로그램이 막는지 확인하세요.' }
  $src = Get-ChildItem -Path $tmp -Recurse -Filter manifest.json | Where-Object { $_.Directory.Name -eq 'extension' -and $_.Directory.Parent.Name -eq 'whale-video-downloader' } | Select-Object -First 1
  if (-not $src) { Fail '파일 찾기' '받은 파일 안에 확장 프로그램 폴더가 없습니다' '제작자에게 알려 주세요.' }
  New-Item -ItemType Directory -Force -Path $Ext | Out-Null
  robocopy $src.Directory.FullName $Ext /MIR /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -ge 8) { Fail '파일 덮어쓰기' "확장 폴더에 쓰지 못했습니다 (robocopy 코드 $LASTEXITCODE)" '웨일을 잠시 닫고 다시 실행하세요.' }
  Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}

$after = VerOf $Ext
if (-not $after) { Fail '설치 확인' '확장 폴더에 manifest.json 이 없습니다' 'C:\WhaleVideoDownloader 폴더를 지운 뒤 이 파일을 다시 실행하세요.' }

# 이 업데이트 파일을 설치 폴더에도 두어 다음에 거기서 실행할 수 있게
$self = $args[0]
$copy = Join-Path $Root '업데이트.bat'
if ($self -and (Test-Path $self) -and ((Resolve-Path $self).Path -ne $copy)) { Copy-Item -Force $self $copy -ErrorAction SilentlyContinue }

Write-Host ''
if (-not $before) {
  Write-Host "설치 완료: v$after" -ForegroundColor Green
  Write-Host ''
  Write-Host '=== 처음 한 번만 해 주세요 ==='
  Write-Host '1) 웨일 주소창에 whale://extensions 입력 → 기존 "웨일 영상 다운로더"가 있으면 모두 삭제'
  Write-Host '2) 오른쪽 위 [개발자 모드] 켜기 → [압축해제된 확장 프로그램을 로드합니다] 누르기'
  Write-Host "3) 이 폴더 선택: $Ext"
  Set-Clipboard -Value $Ext -ErrorAction SilentlyContinue
  Write-Host '   (폴더 경로를 클립보드에 복사해 두었습니다. 폴더 선택 창 주소칸에 붙여 넣으세요)'
  Write-Host ''
  Write-Host "다음부터는 $copy 를 더블클릭한 뒤, 확장 팝업 위쪽의 [업데이트] 단추만 누르면 됩니다."
} elseif ($before -ne $after) {
  Write-Host "업데이트 완료: v$before → v$after" -ForegroundColor Green
  Write-Host '웨일에서 확장 팝업을 열고 위쪽의 [업데이트] 단추를 누르면 적용됩니다.'
} else {
  Write-Host "이미 최신 버전입니다: v$after" -ForegroundColor Green
}
