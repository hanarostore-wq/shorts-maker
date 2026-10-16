@echo off
chcp 65001 >nul
setlocal EnableExtensions
title 웨일 영상 다운로더 업데이트
rem 웨일 영상 다운로더 업데이트 - 더블클릭할 때만 동작합니다. 자동 실행 등록은 하지 않습니다.
rem 마지막에 이 bat 파일도 최신으로 바꿉니다.
rem 윈도우 기본 도구(curl, tar, robocopy)만 씁니다.

set "ROOT=C:\whale-video-downloader"
set "URL=https://codeload.github.com/hanarostore-wq/shorts-maker/zip/refs/heads/claude/charming-lamport-ad829a"
set "WORK=%TEMP%\wvd-update"
set "NEWBAT=%TEMP%\wvd-update-new.bat"

rem 확장 폴더: C:\whale-video-downloader 바로 안, 또는 압축 풀 때 한 겹 더 생긴 안쪽 폴더
set "EXT=%ROOT%"
if not exist "%ROOT%\manifest.json" if exist "%ROOT%\whale-video-downloader\manifest.json" set "EXT=%ROOT%\whale-video-downloader"

echo.
echo 웨일 영상 다운로더 업데이트를 시작합니다.
echo 확장 폴더: %EXT%
call :readver "%EXT%\manifest.json"
set "OLDVER=%VER%"
if defined OLDVER echo 지금 버전: v%OLDVER%

where curl.exe >nul 2>nul
if errorlevel 1 goto :no_curl
where tar.exe >nul 2>nul
if errorlevel 1 goto :no_tar

if exist "%WORK%" rd /s /q "%WORK%"
mkdir "%WORK%" 2>nul
if not exist "%WORK%" goto :fail_tmp

echo.
echo [1/3] 최신 버전 받는 중...
curl.exe -L --fail --silent --show-error --retry 2 -o "%WORK%\latest.zip" "%URL%"
if errorlevel 1 goto :fail_download

echo [2/3] 압축 푸는 중...
tar.exe -xf "%WORK%\latest.zip" -C "%WORK%"
if errorlevel 1 goto :fail_unzip

set "SRC="
set "TOOLS="
for /d %%D in ("%WORK%\*") do if exist "%%D\whale-video-downloader\extension\manifest.json" (
  set "SRC=%%D\whale-video-downloader\extension"
  set "TOOLS=%%D\whale-video-downloader\tools\windows"
)
if not defined SRC goto :fail_find

rem 새 bat 은 맨 끝에 덮어씀(실행 중인 bat 을 바로 덮으면 다음 줄을 잘못 읽음)
if exist "%NEWBAT%" del "%NEWBAT%" >nul 2>nul
if exist "%TOOLS%\웨일영상다운로더-업데이트.bat" copy /y "%TOOLS%\웨일영상다운로더-업데이트.bat" "%NEWBAT%" >nul 2>nul


call :readver "%SRC%\manifest.json"
set "NEWVER=%VER%"
if defined OLDVER if "%OLDVER%"=="%NEWVER%" goto :already

echo [3/3] 확장 폴더에 덮어쓰는 중...
if not exist "%EXT%" mkdir "%EXT%"
robocopy "%SRC%" "%EXT%" /MIR /XF *.bat /NFL /NDL /NJH /NJS /NP >nul
if errorlevel 8 goto :fail_copy
rd /s /q "%WORK%" 2>nul

call :readver "%EXT%\manifest.json"
if not defined VER goto :fail_check
echo.
if defined OLDVER (
  echo 업데이트 완료: v%OLDVER% 에서 v%VER% 으로
  echo 크롬[또는 웨일]에서 확장 팝업을 열고 위쪽의 [업데이트] 단추를 누른 뒤, 열려 있던 사이트를 새로고침[F5]하세요.
) else (
  echo 설치 완료: v%VER%
  echo 크롬 주소창에 chrome://extensions 입력[웨일은 whale://extensions] - 개발자 모드 켜기 - [압축해제된 확장 프로그램을 로드합니다] - %EXT% 폴더 선택
)
echo.
call :potreg
goto :finish

:already
rd /s /q "%WORK%" 2>nul
echo.
echo 이미 최신 버전입니다: v%OLDVER%
echo.
call :potreg
goto :finish

:finish
rem 한 덩어리로 읽힌 뒤 실행되므로 이 안에서 bat 자신을 덮어써도 안전합니다
(
  pause
  if exist "%NEWBAT%" copy /y "%NEWBAT%" "%~f0" >nul 2>nul
  if exist "%NEWBAT%" del "%NEWBAT%" >nul 2>nul
  exit /b 0
)

:potreg
rem 팟플레이어 연결(potplayer://) 자동 확인·등록: 이미 연결돼 있으면 아무것도 안 함. 없으면 설치된 PotPlayer64.exe 를 찾아 현재 사용자(HKCU)에만 등록한다(관리자 불필요).
reg query "HKCR\potplayer\shell\open\command" /ve >nul 2>nul
if not errorlevel 1 (
  echo 팟플레이어 연결: 이미 등록돼 있어 그대로 둡니다.
  exit /b 0
)
set "PEXE="
for %%P in (
  "%ProgramFiles%\DAUM\PotPlayer\PotPlayer64.exe"
  "%ProgramFiles%\PotPlayer\PotPlayer64.exe"
  "%ProgramFiles(x86)%\DAUM\PotPlayer\PotPlayer.exe"
  "%ProgramFiles(x86)%\PotPlayer\PotPlayer.exe"
  "%ProgramFiles%\DAUM\PotPlayer\PotPlayer.exe"
  "%LOCALAPPDATA%\Programs\PotPlayer\PotPlayer64.exe"
  "C:\PotPlayer\PotPlayer64.exe"
  "%ProgramFiles%\DAUM\PotPlayer\PotPlayerMini64.exe"
  "%ProgramFiles%\PotPlayer\PotPlayerMini64.exe"
) do if not defined PEXE if exist %%P set "PEXE=%%~P"
if not defined PEXE (
  echo 팟플레이어 연결: 연결이 없고 팟플레이어도 못 찾았습니다. 팟플레이어를 설치한 뒤 이 파일을 다시 실행하세요.
  exit /b 0
)
reg add "HKCU\Software\Classes\potplayer" /ve /d "URL:PotPlayer Protocol" /f >nul 2>nul
reg add "HKCU\Software\Classes\potplayer" /v "URL Protocol" /d "" /f >nul 2>nul
reg add "HKCU\Software\Classes\potplayer\shell\open\command" /ve /d "\"%PEXE%\" \"%%1\"" /f >nul 2>nul
if errorlevel 1 (
  echo [실패] 단계: 팟플레이어 연결 등록 / 원인: 현재 사용자 레지스트리에 쓰지 못했습니다 / 해결: 보안 프로그램을 확인하거나 팟플레이어-연결-등록.bat 을 따로 실행하세요.
  exit /b 0
)
echo 팟플레이어 연결: 등록했습니다 - %PEXE%
echo 크롬을 완전히 껐다 켜면 적용됩니다.
exit /b 0

:readver
set "VER="
for /f "tokens=2 delims=:," %%V in ('findstr /c:"\"version\"" "%~1" 2^>nul') do set "VER=%%V"
if defined VER set "VER=%VER: =%"
if defined VER set VER=%VER:"=%
exit /b 0

:no_curl
call :fail "도구 확인" "이 PC에 curl.exe 가 없습니다 - 윈도우 10 1803 이전 버전" "윈도우 업데이트를 한 뒤 다시 실행하세요."
goto :eof
:no_tar
call :fail "도구 확인" "이 PC에 tar.exe 가 없습니다 - 윈도우 10 1803 이전 버전" "윈도우 업데이트를 한 뒤 다시 실행하세요."
goto :eof
:fail_tmp
call :fail "임시 폴더 만들기" "%WORK% 폴더를 만들지 못했습니다" "PC를 다시 시작한 뒤 다시 실행하세요."
goto :eof
:fail_download
call :fail "최신 버전 받기" "GitHub 에서 파일을 받지 못했습니다" "인터넷 연결을 확인한 뒤 다시 실행하세요."
goto :eof
:fail_unzip
call :fail "압축 풀기" "받은 파일을 풀지 못했습니다" "잠시 후 다시 실행하세요. 계속되면 백신 프로그램이 막는지 확인하세요."
goto :eof
:fail_find
call :fail "파일 찾기" "받은 파일 안에 확장 프로그램 폴더가 없습니다" "제작자에게 이 화면을 보내 주세요."
goto :eof
:fail_copy
call :fail "파일 덮어쓰기" "확장 폴더에 쓰지 못했습니다 - robocopy 오류" "웨일을 잠시 닫고 다시 실행하세요."
goto :eof
:fail_check
call :fail "설치 확인" "확장 폴더에 manifest.json 이 없습니다" "%ROOT% 폴더를 확인한 뒤 다시 실행하세요."
goto :eof

:fail
echo.
echo [실패] 단계: %~1
echo        원인: %~2
echo        해결: %~3
echo.
pause
exit /b 1
