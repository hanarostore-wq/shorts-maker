@echo off
cd /d "%~dp0"
echo 최신 코드를 받아오는 중...
git pull origin main
echo.
echo 완료! 이 창을 닫고 chrome://extensions 에서 새로고침 버튼을 눌러주세요.
pause
