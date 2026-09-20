@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo 최신 코드를 받아오는 중...
echo.
git pull origin main
echo.
echo ── 현재 확장프로그램 버전 ──
findstr /C:"\"version\"" extension\manifest.json
echo.
echo 위 버전과 chrome://extensions 의 버전이 같아지면 정상입니다.
echo 이 창을 닫고 chrome://extensions 에서 새로고침 버튼을 눌러주세요.
pause
