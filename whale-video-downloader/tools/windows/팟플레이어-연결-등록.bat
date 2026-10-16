@echo off
chcp 65001 >nul
setlocal EnableExtensions EnableDelayedExpansion
title 팟플레이어 potplayer:// 연결 등록·진단
rem 크롬이 potplayer:///clipboard 를 열 때 팟플레이어가 실행되도록 윈도우에 연결을 등록한다. 현재 사용자(HKCU)에만 적용되고 관리자 권한이 필요 없다.
rem 되돌리기: 이 파일을 "undo" 인자로 실행하면 이 파일이 만든 연결을 지운다.

if /I "%~1"=="undo" goto :undo

echo ==== 1) 지금 연결 상태 ====
reg query "HKCU\Software\Classes\potplayer\shell\open\command" /ve 2>nul
if errorlevel 1 (echo [현재 사용자] potplayer 연결 없음) else (echo ^^ 위가 현재 사용자 연결)
reg query "HKCR\potplayer\shell\open\command" /ve 2>nul
if errorlevel 1 (echo [시스템 전체] potplayer 연결 없음) else (echo ^^ 위가 시스템 연결)
echo.

echo ==== 2) 팟플레이어 찾기 ====
set "EXE="
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
  "%ProgramFiles(x86)%\DAUM\PotPlayer\PotPlayerMini.exe"
) do if not defined EXE if exist %%P set "EXE=%%~P"
if not defined EXE (
  echo 자동으로 못 찾았습니다. 팟플레이어 실행 파일 전체 경로를 붙여 넣고 엔터를 누르세요.
  echo 예: C:\Program Files\DAUM\PotPlayer\PotPlayer64.exe
  set /p "EXE=경로: "
set "EXE=!EXE:"=!"
)
if not exist "%EXE%" (
  echo [실패] 단계: 팟플레이어 찾기 / 원인: "%EXE%" 파일이 없습니다 / 조치: 팟플레이어가 설치된 폴더를 확인한 뒤 다시 실행하세요.
  pause
  exit /b 1
)
echo 찾은 팟플레이어: %EXE%
echo.

echo ==== 3) 등록 ====
echo 아래 연결을 현재 사용자에 등록합니다:  potplayer://  -^>  "%EXE%" "%%1"
set /p "OK=등록할까요? (Y/N): "
if /I not "%OK%"=="Y" (echo 취소했습니다. & pause & exit /b 0)
reg add "HKCU\Software\Classes\potplayer" /ve /d "URL:PotPlayer Protocol" /f >nul || goto :fail
reg add "HKCU\Software\Classes\potplayer" /v "URL Protocol" /d "" /f >nul || goto :fail
reg add "HKCU\Software\Classes\potplayer\shell\open\command" /ve /d "\"%EXE%\" \"%%1\"" /f >nul || goto :fail
echo.
echo [완료] 등록했습니다. 크롬을 완전히 껐다가 다시 켠 뒤, 클립보드에 영상 주소가 있는 상태에서
echo        크롬 주소창에 potplayer:///clipboard 를 입력해 팟플레이어가 열리는지 확인하세요.
echo        (크롬이 "외부 프로그램 열기"를 물으면 허용하세요)
pause
exit /b 0

:fail
echo [실패] 단계: 레지스트리 쓰기 / 원인: 현재 사용자 레지스트리에 쓰지 못했습니다 / 조치: 보안 프로그램이 막고 있지 않은지 확인하세요.
pause
exit /b 1

:undo
reg delete "HKCU\Software\Classes\potplayer" /f >nul 2>nul
echo 현재 사용자의 potplayer 연결을 지웠습니다(이 파일이 만든 것).
pause
exit /b 0
