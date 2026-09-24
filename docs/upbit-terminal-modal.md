# 업비트 직원 전체 화면 모달

2026-09-25 / UPBIT-HQ-MODAL-20260924. 로컬 구현·검증 완료. 2026-09-25 사용자 요청으로 Production 배포 진행. 실제 배포 결과는 중앙 AI-TEAM/VALIDATION/UPBIT-HQ-DEPLOY-20260925.md와 Git/Vercel에서 확인한다.

코인 c7(모의매매원), c13(실제매매원)은 UpbitTerminalModal을 연다. 주식과 다른 직원의 기존 화면은 유지한다. 모달은 100vw × 100dvh이며 닫기 버튼과 연결 상태를 상단에 유지한다. 내부는 기존 외부 정본 Desktop/codex/jev-upbit의 차트·주문·판단 화면을 사용한다. 화면 복제본을 이 저장소에 보관하지 않는다.

## 현재 연결 범위

- 이 PC에서 실행 중인 프로그램 `http://127.0.0.1:18770`에 연결한다. 프로그램을 먼저 실행해야 한다. 휴대폰/다른 PC에서 동일 엔진에 연결하는 원격 서비스는 미구현이다.
- `/workspace/paper/`, `/workspace/live/`는 다크테마 고정이며 직원 안에서 다른 모드로 바꾸는 버튼을 숨긴다. 기존 단독 프로그램의 테마 선택은 유지한다.
- 두 직원은 같은 엔진을 공유한다. 직원과 실제 모드가 다르면 화면을 가리고 명시적인 모드 전환을 요구한다. 실행/미처리 주문 등 기존 setMode 보호를 그대로 적용한다.
- 모달을 열거나 닫는 것으로 매매를 시작/중지하지 않는다. 실행 중 닫아도 계속된다는 안내를 표시한다. 중지는 내부의 매매 종료 버튼을 사용한다. Electron 프로그램 자체를 종료하면 기존 종료 로직을 따른다.
- 연결 응답이 12초 넘게 없으면 원인 후보와 재연결 방법을 표시한다. iframe load 이벤트만으로 성공 처리하지 않고, 정확한 frame source/origin/protocol/mode의 상태 메시지를 확인한다.

## 실전 범위

운영본부의 기존 승인관리·리스크관리·최종통제 절차를 새 엔진에 연결하지 않았다. 따라서 **실전 직원은 시세·계좌 조회 및 매매 종료만 제공**한다. `/workspace/live/api/`의 주문·자동 시작·설정 변경·Jev 신규 호출은 서버에서 차단한다. 기존 단독 프로그램의 실전 보호 절차나 원래 API를 변경하지 않는다. 실전 주문 연결 완료로 해석하지 않는다.

## 접근 경계

엔진은 계속 loopback에만 바인딩한다. CORS·공개 서버·키 전달은 추가하지 않는다. 기존 CSRF/Origin/Host 검사를 유지한다. 삽입 HTML만 허용한 운영본부 출처로 frame-ancestors를 설정하고, 일반 단독 화면은 DENY를 유지한다.

기본 허용 출처는 기존 Production `https://shorts-maker-omega.vercel.app`와 개발용 `http://localhost:3000`, `http://127.0.0.1:3000`이다. 주소가 바뀌면 프로그램의 `JEV_HQ_ORIGINS` 환경변수에 정확한 출처를 쉼표로 지정한다. wildcard, 인증정보, 경로, 검색어, fragment, 원격 평문 HTTP는 거절한다.

Production HTTPS에서 loopback iframe을 여는 것은 브라우저의 로컬 네트워크 정책/허용에 영향을 받는다. 로컬 HTTP에서만 검증했으며 Production 검증은 배포 후 별도 필요하다. 원격 어디서나 사용하려면 인증된 상시 실행 엔진과 안전한 연결 경로를 따로 설계해야 한다. Vercel 요청 함수에 현 엔진을 그대로 넣지 않는다.

## 검증

- Next.js 16.3.5 내장 use-client 문서 확인. next typegen, TypeScript, 변경 컴포넌트 ESLint, Production build PASS. 첫 빌드는 Google Fonts 네트워크 제한으로 실패했고 접근 허용 후 통과.
- 엔진 기존92 + 경계4 = 96/96 PASS. 원본 data 최상위5개 SHA256 동일. 새 유료 Jev 요청·실거래 주문 없음.
- 빈 키/분리 계좌: 공개 실시간 시세, 123456원 시작금, 10000원 모의 매수와 전량매도 후 잔량0. 허용 iframe200/거절403/CSRF거절/실전명령차단/모드혼동차단 확인.
- 모달 열기/닫기, 1920×1080·800×900·390×844에서 가로 넘침 없음, 다크 고정, 실전 잠금 표시, 끊김 안내/재시도 확인.
- 현재 브라우저 도구는 iframe 내부 버튼에서 target/focus root unavailable을 반환했다. 그 클릭은 검증 완료로 쓰지 않는다. 동일 HTTP 명령 흐름과 DOM 반영을 별도로 검증했다.
- 근거: 외부 정본 reports/hq-modal-baseline.json, hq-modal-validation.json, hq-modal-smoke.json, hq-modal-tests.txt. tools/hq-modal-preview.cjs는 기존 데이터 대신 분리된 테스트 경로를 쓰며 검사 후 종료했다.

## 복구와 다음 검증

HQ 기능 변경은 AgentDetailModal과 신규 모달 TSX/CSS, 이 문서다. 공통 AGENTS/CLAUDE 참조와 함께 선택 commit/push하여 기존 main 자동배포를 사용한다. 외부 정본 기존3파일은 reports/hq-modal-baseline.json에 백업 위치와 해시가 있다. 원래 data/를 되돌리거나 복사하지 않는다. 다음은 실제 사용자 브라우저의 내부 버튼, Production 경로, 필요한 경우 원격 엔진과 실전 승인 연결 검증이다. 이전 모달 검증 단계에서는 commit/push/새 배포를 실행하지 않았다. 배포 작업의 실제 결과는 위 중앙 검증 기록을 따른다.
