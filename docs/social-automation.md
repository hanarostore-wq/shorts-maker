# MoneyOS 블로그부서: 원본 앱 직접 실행

## 적용 원칙

블로그부서는 아래 두 원본 프로그램의 기능을 축소 웹 콘솔로 다시 구현하지 않는다.

| 직원 | 실행 프로그램 | 원본 저장소 | MoneyOS 변경 |
| --- | --- | --- | --- |
| 네이버블로그 | BlogAuto | https://github.com/boksajang/naverblog-extention | CSS·창 크롬·MoneyOS 실행 진입점 |
| 쓰레드 | Threads Auto | https://github.com/boksajang/threads-auto | CSS·창 크롬·MoneyOS 실행 진입점 |

원본의 Electron main process, IPC, Chrome 확장, Codex 호출, 데이터 저장, 예약·발행·댓글·성과 분석 코드는 그대로 유지한다. 웹 관제실은 **블로그부서 직원 카드와 원본 앱 실행 버튼**만 제공한다.

## PC 설치

Windows에서 다음을 실행한다.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "$env:USERPROFILE\Desktop\Main\shorts-maker-social\desktop\start-social.ps1"
```

최초 실행 시 `desktop/install-full-source.ps1`이 원본 두 저장소의 고정 커밋을 `desktop/apps/`에 복제하고 원본이 정의한 의존성 설치 명령을 수행한다.

- BlogAuto: `npm ci --no-audit --no-fund`
- Threads Auto: `npm run setup`

`desktop/moneyos-theme/apply-moneyos-theme.js`는 원본 스타일시트 뒤에 MoneyOS CSS를 추가할 뿐이다. 기능 자바스크립트·TypeScript·Electron main process·IPC·데이터베이스 파일은 변경하지 않는다.

## 실행 및 계정

MoneyOS PC 관제실에서 **블로그부서 → 네이버블로그/쓰레드 → 전체 실행**을 선택하면 해당 원본 Electron 앱이 별도 창으로 실행된다.

| 프로그램 | 사용자 설정 |
| --- | --- |
| BlogAuto | 블로그 계정, Chrome 로그인, BlogAuto 확장 연결, Codex CLI |
| Threads Auto | Threads 장기 토큰, 계정별 성격·운영계획, Codex CLI, 선택한 소스의 API 키·Chrome 확장 |

각 앱의 데이터와 인증정보는 원본 설계대로 해당 PC의 로컬 저장소에 보관한다. MoneyOS 웹 서버에는 원본 앱의 비밀번호, Chrome 쿠키, Meta 토큰을 전달하지 않는다.

## 제약

- 원본 Chrome 확장 연결은 웨일 로그인 세션으로 대체되지 않는다.
- 두 원본 앱의 로컬 데이터는 별도 저장소를 사용한다. 이를 MoneyOS Redis나 웹 API로 강제 동기화하지 않는다.
- 이전에 만든 네이버·Threads 웹 큐/PC 작업자는 이 구조에서 실행하지 않는다.
