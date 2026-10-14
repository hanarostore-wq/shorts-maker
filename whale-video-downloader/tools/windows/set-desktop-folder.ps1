# 웨일 다운로드 기본 폴더를 바탕화면으로 바꿉니다 (업데이트 bat 이 부릅니다).
# - 확장프로그램은 웨일 다운로드 폴더 안에만 저장할 수 있어서, 웨일 설정(Preferences)의 download.default_directory 를 바꿉니다.
# - 아직 기본값(비어 있음 또는 다운로드 폴더)인 프로필만 바꿉니다. 사용자가 직접 고른 다른 폴더는 그대로 둡니다.
# - 웨일이 켜져 있으면 끌 때 설정을 덮어쓰므로, 웨일을 닫을 때까지 기다립니다(S 로 건너뛰기).
# 종료 코드: 0 = 바꿈 또는 바꿀 것 없음, 2 = 사용자가 건너뜀, 1 = 실패
param(
  [string]$UserData,
  [string]$Desktop,
  [string]$Downloads,
  [string]$ProcessName = 'whale',
  [switch]$NoPrompt
)
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false } catch {}

function Fail([string]$step, [string]$reason, [string]$action) {
  Write-Host ''
  Write-Host "[저장 폴더 실패] 단계: $step"
  Write-Host "                원인: $reason"
  Write-Host "                해결: $action"
  exit 1
}

# ── JSON 안에서 한 객체의 바로 아래 항목 찾기 (전체를 다시 쓰지 않고 그 값만 바꾸려고) ──
$Tok = [regex]'"(?:[^"\\]|\\.)*"|[{}\[\]]'

function Get-ValueEnd([string]$t, [int]$s) {
  $c = $t[$s]
  if ($c -eq '"') { $m = $Tok.Match($t, $s); return $m.Index + $m.Length }
  if ($c -eq '{' -or $c -eq '[') {
    $depth = 0
    $m = $Tok.Match($t, $s)
    while ($m.Success) {
      $v = $m.Value
      if ($v -eq '{' -or $v -eq '[') { $depth++ }
      elseif ($v -eq '}' -or $v -eq ']') { $depth--; if ($depth -eq 0) { return $m.Index + 1 } }
      $m = $m.NextMatch()
    }
    throw '설정 파일의 괄호가 닫히지 않았습니다.'
  }
  $i = $s
  while ($i -lt $t.Length -and ',}] ' -notmatch [regex]::Escape([string]$t[$i]) -and -not [char]::IsWhiteSpace($t[$i])) { $i++ }
  return $i
}

# 반환: @(값 시작, 값 끝) 또는 $null
function Find-Member([string]$t, [int]$objStart, [string]$key) {
  $want = '"' + $key + '"'
  $depth = 0
  $m = $Tok.Match($t, $objStart)
  while ($m.Success) {
    $v = $m.Value
    if ($v -eq '{' -or $v -eq '[') { $depth++ }
    elseif ($v -eq '}' -or $v -eq ']') { $depth--; if ($depth -le 0) { return $null } }
    elseif ($depth -eq 1 -and $v -ceq $want) {
      $i = $m.Index + $m.Length
      while ($i -lt $t.Length -and [char]::IsWhiteSpace($t[$i])) { $i++ }
      if ($i -lt $t.Length -and $t[$i] -eq ':') {
        $s = $i + 1
        while ($s -lt $t.Length -and [char]::IsWhiteSpace($t[$s])) { $s++ }
        return @($s, (Get-ValueEnd $t $s))
      }
    }
    $m = $m.NextMatch()
  }
  return $null
}

function Get-RootStart([string]$t) {
  $i = 0
  while ($i -lt $t.Length -and [char]::IsWhiteSpace($t[$i])) { $i++ }
  if ($i -ge $t.Length -or $t[$i] -ne '{') { throw '설정 파일이 { 로 시작하지 않습니다.' }
  return $i
}

function Is-EmptyObject([string]$t, [int]$objStart) {
  $i = $objStart + 1
  while ($i -lt $t.Length -and [char]::IsWhiteSpace($t[$i])) { $i++ }
  return ($t[$i] -eq '}')
}

# 지금 값: $null(항목 없음) 또는 문자열
function Get-DownloadDir([string]$t) {
  $root = Get-RootStart $t
  $dl = Find-Member $t $root 'download'
  if (-not $dl -or $t[$dl[0]] -ne '{') { return $null }
  $dd = Find-Member $t $dl[0] 'default_directory'
  if (-not $dd -or $t[$dd[0]] -ne '"') { return $null }
  $raw = $t.Substring($dd[0] + 1, $dd[1] - $dd[0] - 2)
  return [regex]::Unescape($raw)
}

function Set-DownloadDir([string]$t, [string]$dir) {
  $json = '"' + ($dir -replace '\\', '\\' -replace '"', '\"') + '"'
  $root = Get-RootStart $t
  $dl = Find-Member $t $root 'download'
  if ($dl -and $t[$dl[0]] -eq '{') {
    $dd = Find-Member $t $dl[0] 'default_directory'
    if ($dd) { return $t.Substring(0, $dd[0]) + $json + $t.Substring($dd[1]) }
    $sep = if (Is-EmptyObject $t $dl[0]) { '' } else { ',' }
    return $t.Substring(0, $dl[0] + 1) + '"default_directory":' + $json + $sep + $t.Substring($dl[0] + 1)
  }
  if ($dl) { return $t.Substring(0, $dl[0]) + '{"default_directory":' + $json + '}' + $t.Substring($dl[1]) }
  $sep = if (Is-EmptyObject $t $root) { '' } else { ',' }
  return $t.Substring(0, $root + 1) + '"download":{"default_directory":' + $json + '}' + $sep + $t.Substring($root + 1)
}

function Norm([string]$p) { if (-not $p) { return '' } return $p.Trim().TrimEnd('\', '/').ToLowerInvariant() }

# ── 경로 정하기 ──
if (-not $UserData) {
  if (-not $env:LOCALAPPDATA) { Fail '웨일 설정 찾기' 'LOCALAPPDATA 환경 변수가 없습니다' '윈도우에서 실행하세요.' }
  $UserData = Join-Path $env:LOCALAPPDATA 'Naver\Naver Whale\User Data'
}
if (-not $Desktop) { $Desktop = [Environment]::GetFolderPath('Desktop') }
if (-not $Downloads) {
  try { $Downloads = (New-Object -ComObject Shell.Application).NameSpace('shell:Downloads').Self.Path } catch {}
  if (-not $Downloads -and $env:USERPROFILE) { $Downloads = Join-Path $env:USERPROFILE 'Downloads' }
}
if (-not $Desktop -or -not (Test-Path -LiteralPath $Desktop -PathType Container)) {
  Fail '바탕화면 찾기' "바탕화면 폴더를 찾지 못했습니다 ($Desktop)" '웨일 설정(whale://settings/downloads)의 위치 → 변경에서 바탕화면을 직접 고르세요.'
}
if (-not (Test-Path -LiteralPath $UserData -PathType Container)) {
  Fail '웨일 설정 찾기' "웨일 사용자 폴더가 없습니다 ($UserData)" '웨일을 한 번 실행한 뒤 다시 실행하거나, whale://settings/downloads 에서 위치를 바탕화면으로 바꾸세요.'
}
$profiles = @(Get-ChildItem -LiteralPath $UserData -Directory | Where-Object { ($_.Name -eq 'Default' -or $_.Name -like 'Profile *') -and (Test-Path -LiteralPath (Join-Path $_.FullName 'Preferences') -PathType Leaf) })
if ($profiles.Count -eq 0) {
  Fail '웨일 설정 찾기' "웨일 프로필 설정 파일(Preferences)이 없습니다 ($UserData)" '웨일을 한 번 실행한 뒤 다시 실행하거나, whale://settings/downloads 에서 위치를 바탕화면으로 바꾸세요.'
}

# ── 바꿀 프로필 고르기 ──
$utf8 = New-Object System.Text.UTF8Encoding $false
$todo = @()
foreach ($p in $profiles) {
  $file = Join-Path $p.FullName 'Preferences'
  try { $text = [IO.File]::ReadAllText($file, $utf8) } catch { Fail '웨일 설정 읽기' "$file 을 읽지 못했습니다: $($_.Exception.Message)" '웨일을 닫고 다시 실행하세요.' }
  try { $cur = Get-DownloadDir $text } catch { Fail '웨일 설정 읽기' "$file 형식을 읽지 못했습니다: $($_.Exception.Message)" 'whale://settings/downloads 에서 위치를 바탕화면으로 직접 바꾸세요.' }
  if ((Norm $cur) -eq (Norm $Desktop)) { Write-Host "  [$($p.Name)] 이미 바탕화면에 저장합니다: $Desktop"; continue }
  if ($cur -and (Norm $cur) -ne (Norm $Downloads)) { Write-Host "  [$($p.Name)] 직접 고른 폴더를 그대로 둡니다: $cur  (바탕화면으로 하려면 whale://settings/downloads 에서 변경)"; continue }
  $todo += [pscustomobject]@{ Name = $p.Name; File = $file; From = $(if ($cur) { $cur } else { '다운로드 폴더(기본값)' }) }
}
if ($todo.Count -eq 0) { exit 0 }

# ── 웨일이 켜져 있으면 닫을 때까지 기다리기 ──
while (Get-Process -Name $ProcessName -ErrorAction SilentlyContinue) {
  if ($NoPrompt) { Fail '웨일 닫기 확인' '웨일이 켜져 있어 지금 바꾸면 웨일을 끌 때 되돌아갑니다' '웨일을 모두 닫고 다시 실행하세요.' }
  Write-Host ''
  Write-Host '  저장 폴더를 바탕화면으로 바꾸려면 웨일을 잠깐 닫아야 합니다.'
  Write-Host '  (켜진 채로 바꾸면 웨일을 끌 때 원래대로 돌아갑니다. 작업 표시줄 오른쪽 아이콘으로 남아 있으면 그것도 종료하세요.)'
  $ans = Read-Host '  웨일을 모두 닫은 뒤 Enter, 이번에는 건너뛰려면 S 입력 후 Enter'
  if ($ans -match '^\s*[sSㄴ]') {
    Write-Host '  저장 폴더 바꾸기를 건너뛰었습니다. 다음에 업데이트할 때 다시 묻습니다.'
    exit 2
  }
}

# ── 바꾸기 (백업 → 쓰기 → 다시 읽어 확인, 실패하면 되돌림) ──
foreach ($p in $todo) {
  $text = [IO.File]::ReadAllText($p.File, $utf8)
  $backup = $p.File + '.wvd-backup'
  try { [IO.File]::WriteAllText($backup, $text, $utf8) } catch { Fail '설정 백업' "$backup 을 만들지 못했습니다: $($_.Exception.Message)" '웨일 사용자 폴더 쓰기 권한을 확인하세요.' }
  try {
    $new = Set-DownloadDir $text $Desktop
    [IO.File]::WriteAllText($p.File, $new, $utf8)
    $check = Get-DownloadDir ([IO.File]::ReadAllText($p.File, $utf8))
    if ((Norm $check) -ne (Norm $Desktop)) { throw "다시 읽은 값이 다릅니다 ($check)" }
  } catch {
    $why = $_.Exception.Message
    try { [IO.File]::WriteAllText($p.File, $text, $utf8) } catch {}
    Fail '웨일 설정 쓰기' "[$($p.Name)] 저장 폴더를 바꾸지 못해 원래대로 되돌렸습니다: $why" 'whale://settings/downloads 의 위치 → 변경에서 바탕화면을 직접 고르세요.'
  }
  Write-Host "  [$($p.Name)] 저장 폴더를 바꿨습니다: $($p.From) → $Desktop"
}
exit 0
