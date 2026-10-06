# MoneyOS 블로그부서 데스크톱 실행기

MoneyOS 관제실을 첫 고정 탭으로 열고, **제공된 원본 프로그램 전체를 별도 Electron 창으로 실행**합니다.

- 네이버블로그: [boksajang/naverblog-extention](https://github.com/boksajang/naverblog-extention)
- 쓰레드: [boksajang/threads-auto](https://github.com/boksajang/threads-auto)

두 앱의 생성·예약·발행·Chrome 확장·계정·로컬 데이터 기능을 웹 큐로 축소하거나 다시 만들지 않습니다. MoneyOS 변경 범위는 **실행 진입점과 CSS·창 크롬 디자인**뿐입니다.

## Windows 최초 실행

Node.js `24.15 이상 25 미만` 또는 `26 이상`, Git, npm을 준비합니다. 저장소를 받은 뒤 아래 하나만 실행합니다.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "$env:USERPROFILE\Desktop\Main\shorts-maker-social\desktop\start-social.ps1"
```

원본 두 앱이 아직 없으면 이 스크립트가 다음을 자동 실행합니다.

1. `desktop/apps/naverblog-extention`에 BlogAuto 원본 저장소 전체를 고정 커밋으로 복제
2. `desktop/apps/threads-auto`에 Threads Auto 원본 저장소 전체를 고정 커밋으로 복제
3. 각 원본이 요구하는 `npm ci` 또는 `npm run setup` 실행
4. 원본 화면에 MoneyOS CSS 파일과 stylesheet 링크만 적용
5. MoneyOS 관제실 데스크톱 셸 실행

관제실의 **블로그부서 → 네이버블로그 또는 쓰레드 → 전체 실행** 버튼을 누르면 각 원본 앱이 별도 창으로 열립니다. 시작 스크립트는 별도의 소셜 작업자나 접근키를 실행하지 않습니다.

## 원본 앱별 설정

| 앱 | 원본 안에서 직접 설정할 항목 |
| --- | --- |
| BlogAuto | 블로그 계정, 일반 Chrome 로그인, BlogAuto Chrome 확장 연결, Codex CLI |
| Threads Auto | Threads 장기 토큰, 계정 성격·운영 계획, Codex CLI, 필요 시 YouTube·쿠팡·네이버 브랜드커넥트 키와 Chrome 확장 |

Chrome 확장과 로그인 세션은 Chrome을 기준으로 합니다. 웨일은 MoneyOS 웹 관제실을 여는 용도로는 사용할 수 있지만, 원본 앱이 요구하는 Chrome 확장·네이티브 연결을 대신하지 않습니다.

## 소스 고정과 디자인 적용

`source-apps.json`에는 두 원본의 검증한 Git 커밋이 기록돼 있습니다. `install-full-source.ps1`은 기능 파일에 사용자가 수정한 흔적이 있으면 덮어쓰지 않습니다. 허용되는 변경은 아래 디자인 파일뿐입니다.

- `src/renderer/moneyos.css`
- 원본 HTML의 MoneyOS stylesheet 링크
- `.moneyos-theme.json`

따라서 MoneyOS 테마 갱신은 원본의 Electron main process, IPC, 데이터베이스, 발행·예약·Codex·확장프로그램 로직을 바꾸지 않습니다.

## 직접 원본 앱 실행

MoneyOS 셸 없이도 원본 앱을 실행할 수 있습니다.

```powershell
# BlogAuto
cd "$env:USERPROFILE\Desktop\Main\shorts-maker-social\desktop\apps\naverblog-extention"
npm.cmd start

# Threads Auto — 다른 PowerShell 창
cd "$env:USERPROFILE\Desktop\Main\shorts-maker-social\desktop\apps\threads-auto"
npm.cmd start
```
