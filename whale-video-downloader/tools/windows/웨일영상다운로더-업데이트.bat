@echo off
chcp 65001 >nul
rem 웨일 영상 다운로더 - 업데이트 (더블클릭할 때만 동작, 자동 실행 등록 없음)
powershell -NoProfile -ExecutionPolicy Bypass -Command "$s=[IO.File]::ReadAllText('%~f0',[Text.Encoding]::UTF8); $i=$s.IndexOf([char]10+'#PS-START'); Invoke-Expression $s.Substring($i+1)"
pause
exit /b
#PS-START
$ErrorActionPreference = 'Stop'
$Root = 'C:\whale-video-downloader'
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

# 확장 폴더 찾기: C:\whale-video-downloader 바로 안, 또는 압축 풀 때 한 겹 더 생긴 안쪽 폴더
$Ext = $Root
if (-not (Test-Path (Join-Path $Root 'manifest.json'))) {
  $inner = Join-Path $Root 'whale-video-downloader'
  if (Test-Path (Join-Path $inner 'manifest.json')) { $Ext = $inner }
}

# 0) 팟플레이어 연결 등록(확장 설정 'X·블루스카이 재생 버튼 → 팟플레이어로 재생'용)
#    smdplay: 주소를 열면 아래 스크립트가 http(s) 영상 주소만 꺼내 팟플레이어로 넘긴다. 현재 사용자 설정(HKCU)에만 쓰고 자동 실행은 없다.
try {
  $PotDir = Join-Path $env:LOCALAPPDATA 'WhaleVideoDownloader'
  New-Item -ItemType Directory -Force -Path $PotDir | Out-Null
  $PotPs1 = Join-Path $PotDir 'smdplay.ps1'
  $PotScript = @'
param([string]$u)
Add-Type -AssemblyName PresentationFramework
function Show($step, $reason, $action) {
  [System.Windows.MessageBox]::Show("팟플레이어로 재생 실패`n`n단계: $step`n원인: $reason`n조치: $action", '웨일 영상 다운로더') | Out-Null
  exit 1
}
$raw = [string]$u
if (-not $raw.StartsWith('smdplay:')) { Show '주소 확인' 'smdplay: 주소가 아닙니다' '웨일에서 영상 재생 버튼을 다시 누르세요.' }
try { $url = [Uri]::UnescapeDataString($raw.Substring(8)) } catch { Show '주소 확인' '영상 주소를 읽지 못했습니다' '웨일에서 영상 재생 버튼을 다시 누르세요.' }
if ($url -notmatch '^https?://[^\s"''`<>|]+$') { Show '주소 확인' 'http(s) 영상 주소가 아니어서 열지 않았습니다' '웨일에서 영상 재생 버튼을 다시 누르세요.' }
$exe = @('C:\Program Files\DAUM\PotPlayer\PotPlayerMini64.exe', 'C:\Program Files\DAUM\PotPlayer\PotPlayerMini.exe', 'C:\Program Files (x86)\DAUM\PotPlayer\PotPlayerMini.exe') | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $exe) { Show '팟플레이어 찾기' 'C:\Program Files\DAUM\PotPlayer 에 팟플레이어(PotPlayerMini64.exe)가 없습니다' '팟플레이어를 설치하거나 설치 경로를 제작자에게 알려 주세요.' }
try { Start-Process -FilePath $exe -ArgumentList ('"' + $url + '"') } catch { Show '팟플레이어 실행' $_.Exception.Message '팟플레이어를 직접 한 번 실행해 본 뒤 다시 시도하세요.' }
'@
  [IO.File]::WriteAllText($PotPs1, $PotScript, (New-Object Text.UTF8Encoding $true))
  $Key = 'HKCU:\Software\Classes\smdplay'
  New-Item -Path "$Key\shell\open\command" -Force | Out-Null
  Set-Item -Path $Key -Value 'URL:웨일 영상 다운로더 팟플레이어 재생'
  New-ItemProperty -Path $Key -Name 'URL Protocol' -Value '' -PropertyType String -Force | Out-Null
  Set-Item -Path "$Key\shell\open\command" -Value ('powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $PotPs1 + '" "%1"')
  if (-not (Test-Path 'C:\Program Files\DAUM\PotPlayer')) {
    Write-Host '[안내] 팟플레이어 연결은 등록했지만 C:\Program Files\DAUM\PotPlayer 폴더가 없습니다. 팟플레이어로 재생을 쓰려면 팟플레이어를 설치하세요.' -ForegroundColor Yellow
  } else { Write-Host '팟플레이어 연결 등록 완료' -ForegroundColor Green }
} catch {
  Write-Host "[안내] 팟플레이어 연결 등록 실패(업데이트는 계속): 단계 레지스트리 등록 / 원인 $($_.Exception.Message) / 조치 이 파일을 다시 실행하세요." -ForegroundColor Yellow
}

Write-Host "웨일 영상 다운로더 업데이트를 시작합니다 ($Ext)"
$before = VerOf $Ext

# 1) GitHub 에서 최신 버전 받기
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
$newVer = VerOf $src.Directory.FullName

# 2) 확장 폴더에 덮어쓰기(이 업데이트 파일은 지우지 않음)
if ($before -and $before -eq $newVer) {
  Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
  Write-Host ''
  Write-Host "이미 최신 버전입니다: v$before" -ForegroundColor Green
  exit 0
}
New-Item -ItemType Directory -Force -Path $Ext | Out-Null
robocopy $src.Directory.FullName $Ext /MIR /XF '*.bat' /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { Fail '파일 덮어쓰기' "확장 폴더에 쓰지 못했습니다 (robocopy 코드 $LASTEXITCODE)" '웨일을 잠시 닫고 다시 실행하세요.' }
Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue

$after = VerOf $Ext
if (-not $after) { Fail '설치 확인' '확장 폴더에 manifest.json 이 없습니다' "$Root 폴더를 확인한 뒤 다시 실행하세요." }
Write-Host ''
if ($before) {
  Write-Host "업데이트 완료: v$before → v$after" -ForegroundColor Green
  Write-Host '웨일에서 확장 팝업을 열고 위쪽의 [업데이트] 단추를 누르면 적용됩니다.'
} else {
  Write-Host "설치 완료: v$after" -ForegroundColor Green
  Write-Host "웨일 whale://extensions → [압축해제된 확장 프로그램을 로드합니다] → $Ext 폴더를 선택하세요."
}
