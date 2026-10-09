# Binance Local Terminal · UI 기준

## 브랜드 자산과 참고

- 로고: Binance 공식 favicon을 `https://bin.bnbstatic.com/static/images/common/favicon.ico`에서 화면 헤더에 직접 사용한다.
- 화면 참고: Binance 현물·선물 데스크톱 거래 UI의 고밀도 다크 터미널 구조를 따르되, 원본 웹페이지 소스·인증·사용자 계정 화면을 복사하지 않는다.
- API: 공식 Spot/USDS-M 문서에 정의된 공개 WebSocket 및 API Key 기반 계좌·주문 API만 사용한다.

## 디자인 결정

- 시각 언어: Binance 거래소형 다크 터미널
- 정보 밀도: 9/10. 한 화면에서 마켓 목록, 실시간 캔들, 호가, 최근 체결, 주문창, 계좌·주문·거래 기록을 함께 표시한다.
- 색상: Binance gold `#f0b90b`, 상승 `#0ecb81`, 하락 `#f6465d`, 배경 `#0b0e11`.
- 타이포그래피: 시스템 산세리프 우선, 숫자 정렬은 tabular-like 간격을 사용한다.
- 모서리: 3~4px의 작은 반경, 거래소 화면처럼 조밀한 선 경계.
- 실시간성: 차트·호가·체결은 Binance WebSocket → BLACK PC 서버 → SSE로 전달한다. 화면 주기 폴링은 사용하지 않는다.
- 쉬운 설명: 펀딩비·미결제약정·레버리지는 물음표 도움말과 설정 설명을 함께 둔다.
