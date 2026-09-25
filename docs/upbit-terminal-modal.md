# 업비트 모달 직접 이식 · 메인 PC 실행

UPBIT-WEB-PORT-20260925. 사용자 최신 확정: 별도 유료 서버 구매 없이 항상 켜두는 메인 PC를 실행 서버로 사용. 브라우저/운영본부 탭 종료는 매매 종료 명령이 아니다.

## 구현 경계
- UI·차트·지표·금액 입력은 운영본부 public/trading에 직접 이식. 같은 출처 iframe은 스타일 분리용이며 localhost 화면을 불러오지 않는다.
- services/trading은 독립 Node 실행부. 서버가 계좌·판단·자동매매 상태를 보유하고 창이 없는 상태로 실행한다.
- public/trading/runtime.js는 상태 조회와 명령 전달만 수행. unload/pagehide/visibility에서 stop 요청을 보내지 않는다.
- 자동매매 종료만 사용자 실행 의도를 off로 저장. 주문 상태 불명/계좌 불일치 등의 안전 보류는 예외이며 자동 재시작으로 우회하지 않는다.
- PC 프로세스의 정상 재시작은 저장된 실행 의도와 자료 준비를 확인하고 재개. 비정상 종료 잠금은 실제 프로세스 부재를 확인한 뒤 복구해야 한다.
- Vercel 서버와 PC 간 연결키, 별도 운영자 인증이 필요하며 거래소/Jev 키는 브라우저에 보내지 않는다.
- 실제 주문은 승인 체계 연결 전 잠금. 현재 PC 서버는 PAPER 명령만 허용. 원본 jev-upbit/data와 키는 복사·변경하지 않았다.

## 아직 미완료
인증된 인터넷 연결, Windows 백그라운드 자동 시작 등록, Production 배포와 실제 탭 종료 후 자동매매 지속 확인은 아직 미완료다. Tailscale Funnel 같은 무료 연결의 계정·설치·허용 범위를 검토 중이며 설치/공개 연결을 실행하지 않았다. 과거 브라우저 실행 시제품은 최신 요구사항의 완성본이 아니다.

## 검증
PC 독립 실행부의 별도300000원 PAPER에서 공개289개종목·모의10000원 매수·전량 매도·수량0·무인증401·클라이언트 요청 없는 기간 후 상태 보존 확인. 실제 주문0, 유료Jev 호출0. 자동 판단으로 실시간 매매까지 검증한 것으로 확대하지 않는다.


## 2026-09-25 PC 서버 연결 및 실전 기능

- UI는 운영본부의 동일 출처 /trading 정적 파일로 이식. 별도 localhost 화면을 iframe으로 로드하지 않음.
- 인증된 Vercel worker API → Tailscale HTTPS → 메인 PC loopback18780. 모의/실전 엔진과 저장 디렉터리 분리. 브라우저 종료는 stop을 전송하지 않음.
- Windows 로그인 시작 작업 MoneyOS-TradingWorker, AppData/Local/MoneyOS/trading 실행본. 제어키/연결키/Jev 및 재사용 업비트 키는 Windows CurrentUser DPAPI 보관. 원래 jev-upbit 데이터 보존.
- 실전 운용금 설정에서 수동 주문 준비 또는 자동매매 시작 선택. 시작 전에 저장 키 검증·잔액·주문 테스트·한도·보유분 대사. 실제 주문 없는 테스트 API: https://docs.upbit.com/kr/reference/order-test
- Production dpl_9okTeaxZrYyKiMYLQb4avbGGZShB Ready, 구현 commit a485459. 인증 없이401, 인증 후 모의/실전 각각200·289종목·Jev 키 로드 확인. 자동검사59개, 빌드/타입검사 통과.
- 실제 업비트 개인 API 검사: no_authorization_ip. PC 공인 IP 허용 등록 필요. 실제 주문 테스트 통과/실제 거래 체결로 보고하지 않음. 실주문0, 유료Jev 호출0.
- 사용자 접속: 바탕화면 운영본부 매매 인증키 복사.cmd 실행 → 모달 제어 비밀번호에 붙여넣기. 이 값은 거래소 API 키가 아니며 채팅/문서에 노출하지 않음.
- 정전·절전·로그아웃·비정상 종료의 지속 실행은 별도. crash worker.lock은 프로세스/장부 확인 후 처리, 무조건 삭제/재주문 금지.

후속 확인: 사용자가 PC 허용 IP를 추가한 뒤 Production live/test HTTP200, 거래소 인증 true·주문 테스트 true·자동매매 false 확인. 이전 no_authorization_ip 차단은 해소. Production PAPER analyze HTTP200, Jev verified true·판단 존재·호출1·자동매매 false 확인. 유료 API는 시장 판단1회만 사용했고 외부 코드 검토 호출은 없음. 실제 원화 주문은 여전히0.
