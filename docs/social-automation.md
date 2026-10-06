# 운영본부 소셜 자동화 통합

## 분석한 원본

- [복사장 네이버 블로그 자동화 영상](https://www.youtube.com/watch?v=kLNGbVIIbeg): 수동 Chrome 로그인, 계정별 프로필, 확장 프로그램 연결 코드, 자료 조사 → 원고 검수 → 브라우저 편집기 게시 흐름을 확인했다. 영상 내 버전과 리포지토리 최신 버전은 다를 수 있다.
- [네이버 BlogAuto 원본 저장소](https://github.com/boksajang/naverblog-extention): Electron + 로컬 Chrome 확장 프로그램 + Codex CLI. 웹사이트에 Electron 앱을 그대로 탑재할 수 없고, 원본 코드를 복사하지 않았다. 소스 구조와 세션 분리·발행 결과 검증 원칙만 참고했다.
- [쓰레드 자동화 설명 영상](https://www.youtube.com/watch?v=MGm4M3eEQWA&t=3646s): 장기 토큰, Meta API 권한, 다중 계정별 운영 조건, 교차 일정 생성, 본문 생성/검수/발행 과정을 확인했다.
- [Threads Auto 원본 저장소](https://github.com/boksajang/threads-auto): Electron/로컬 DB 기반. `/src/main/providers/threads.ts`에서 Graph API `me/threads` 생성, `me/threads_publish` 확정, 게시 ID 확인, 확인 불가 시 재시도 금지 규칙을 조사했다. 저장소 코드를 복사하지 않고 필요한 웹 경로만 다시 작성했다.

## 현재 구현 범위

1. 공유 상태 이전: **블로그부서는 유지**하고 종전 소재 조사원·READY 관리자·애드센스 분석관 자리만 정리한다. 블로그부서에 네이버블로그·쓰레드 직원을 각각 1명씩 배치한다. 기존 Redis 원고/예약/발행 결과는 보존한다.
2. 네이버: 계정의 블로그 ID, 검토된 제목/본문, 게시시간 등록 → Redis READY 원고 → 기존 데스크톱 관제 브라우저의 네이버 게시 워커에 전달 → 공개 URL 기록. 네이버 비밀번호와 세션은 서버에 저장하지 않는다.
3. 쓰레드: 사용자가 Meta 장기 Access Token을 직접 입력하고 `/me`로 검증 → 서버의 AES-256-GCM 암호화 Redis 보관 → 검토된 500자 이하 원고의 즉시/예약 게시 → 공개 게시물 ID와 permalink 확인. 계정 여러 개를 연결할 수 있다. 게시가 불확실하면 `needs_review`로 멈추고 자동 재시도하지 않는다.
4. 예약: 데스크톱 앱이 켜져 있으면 5초마다 기한이 지난 원고를 확인한다. 서버는 Vercel Hobby 플랜의 하루 1회 cron으로 09:00~09:59 KST에 밀린 작업을 보조 처리한다. Hobby cron은 분 단위 정확성을 보장하지 않는다. 컴퓨터가 꺼져 있으면 네이버의 실제 브라우저 게시를 수행할 수 없다.
5. 보호: `SOCIAL_CONTROL_KEY`를 서버와 데스크톱 작업자에 설정한다. 브라우저의 관제실 직원 카드에서도 같은 키가 필요하며 `sessionStorage`에만 저장한다. `CRON_SECRET`로 서버 예약 엔드포인트를 보호한다. Git에 접근키를 넣지 않는다.

## 설정 및 실행

1. 블로그부서의 두 직원 카드를 열고 별도 전달된 관제실 소셜 접근키를 입력한다.
2. 쓰레드: Meta for Developers에서 `threads_basic`, `threads_content_publish` 권한의 사용자 장기 토큰을 준비해 연결한다. 앱 로그인/OAuth 발급과 토큰 갱신은 현재 웹판에 포함되지 않아 사용자가 발급 및 갱신해야 한다. 먼저 비공개 테스트 계정으로 문구 하나를 게시해 연결 상태를 확인한다.
3. 네이버: 운영본부 `desktop` 앱을 사용자 PC에서 실행하고 앱의 Chrome 파티션에 해당 블로그 계정으로 직접 로그인한다. `SOCIAL_CONTROL_KEY`를 앱 프로세스 환경변수로 지정한다. 앱이 꺼져 있으면 블로그는 READY/대기 상태에 남는다.
4. 네이버 예약: 원고와 대상 블로그 ID를 입력해 READY로 저장한 뒤 게시 시각을 설정한다. 웹 콘솔은 다단계 AI 조사/이미지 생성을 수행하지 않지만, 아래의 원본 전체 프로그램에서는 해당 원본 기능을 사용할 수 있다.
5. 데스크톱 앱이 실행 중인 경우 두 직원 카드의 `PC 작업자 연결됨` 배지를 확인한다. 게시 성공은 공개 글 URL로 확인한다.

## 원본 프로그램 전체 소스 연결

`desktop/install-full-source.ps1`은 제공된 두 GitHub 저장소의 **전체 소스 트리**를 `desktop/apps/`에 복제하고 `desktop/source-apps.json`에 기록한 커밋으로 고정한다. 네이버 원본은 `npm ci`, Threads 원본은 저장소 자체의 `npm run setup`으로 설치한다. 실행 버튼은 PC 관제 브라우저의 블로그부서 직원 카드에 있으며 Electron 앱을 별도 창으로 연다. 원본 프로그램의 기능을 잘라내거나 재작성한 것이 아니라 PC에서 그대로 실행한다.

원본 앱의 계정·Chrome 확장프로그램·로컬 일정과 웹 콘솔의 원고·Meta 토큰은 서로 자동 동기화되지 않는다. **두 기능을 하나의 웹 프로세스로 합친 것은 아니다.** 원본 앱의 Chrome 전용 로그인/확장프로그램 요구는 웨일 로그인만으로 충족되지 않는다. 웨일은 관제실 웹 화면 열기에 사용할 수 있다.

PC 작업자의 `fetch failed` 로그에 대응하기 위해 서버 통신을 [Electron 공식 `net.fetch`](https://www.electronjs.org/docs/latest/api/net#netfetchinput-init)로 변경했다. 이 API는 Chromium 네트워크와 시스템 프록시를 사용한다. PC에서 실제 네트워크 재시험은 아직 필요하다.

2026-10-06 Windows 재시험에서는 `net::ERR_CONNECTION_CLOSED`와 `net::ERR_HTTP2_PROTOCOL_ERROR`가 발생했지만 동일 PC의 `curl.exe`는 인증 없는 API에서 HTTP 401을 정상 수신했다. 따라서 Electron 경로가 실패한 경우 `curl.exe`를 표준입력 설정으로 호출하는 대체 경로를 추가했다. 실제 PC 재시험 결과는 아직 확인되지 않았다. 접근키는 명령행 인자나 임시 파일에 기록하지 않으며 PC 재실행 시 키는 사용자별 DPAPI 암호화 파일로만 유지한다.

## 차이와 확인 필요

- **현재 웹판은 원본 Electron 프로그램의 기능 전체 복제품이 아니다.** Codex CLI 원고 자동 생성, PDF/HWP OCR, 이미지 생성, 다중 프로필 분리, Threads의 RSS/상품 수집/자동 댓글·분석 및 Meta 토큰 자동 갱신은 원본 전체 프로그램에서 제공되며 웹 콘솔에는 옮기지 않았다. 사용자는 블로그부서 카드에서 PC용 원본 앱을 별도 창으로 실행할 수 있다.
- 네이버 웹판은 저장소에 이미 있던 `desktop/agent/naverBlogPublisher.js`의 SmartEditor DOM 발행기를 사용한다. 원본 확장 프로그램 수준의 신뢰성이나 본 계정과 블로그 ID 대조를 보장하지 않는다. 본 계정 발행 전에 별도 테스트 계정으로 실제 글쓰기·발행·URL 검증을 완료해야 한다.
- 접근키 없이는 신규 소셜 API에 접근할 수 없다. 기존 관제실의 다른 API 보안 문제까지 해결한 것은 아니다.
- [Vercel 공식 문서](https://vercel.com/docs/cron-jobs/usage-and-pricing)에 따라 Hobby cron은 각 작업이 1일 1회 이하이며 예정 시각으로부터 최대 59분 늦을 수 있다. 데스크톱 앱이 꺼져 있을 때 지정 시각 정밀 발행을 보장하지 않는다.
