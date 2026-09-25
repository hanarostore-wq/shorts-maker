# 조회 진입점

데이터 버전 1. 실제 기간과 마지막 수집/분석 시각은 인증 API 응답이 기준이며 Markdown에 고정하지 않습니다.

- GET /api/trading/analytics?action=status&asset=coin : 수집 상태/최근시각/저장량/모드별 집계
- GET /api/trading/analytics?asset=coin&from=유닉스밀리초&to=유닉스밀리초&mode=paper&outcome=loss : 범위 조회
- 추가 필터: market, staff, rule, version, buyReason, sellReason, cause, minReturn, maxReturn, limit(1~500), offset
- cause: jev / hard_stop / risk / strategy_exit / manual / system / legacy_unknown
- GET /api/trading/analytics?asset=coin&id=조회된episodeID : 체결별 판단과 중복 제거한 전후 샘플
- POST /api/trading/analytics : 같은 필터 JSON, 최대 500 episode 사후 리포트 저장. 주문이나 유료 AI 호출 없음.
- asset=stock : 실제 주식 엔진 미연결, 수집했다고 표시하지 않음.
- 인증: 기존 등록 브라우저 쿠키/서버 제어 인증. 키를 문서/URL/AI 프롬프트에 기록하지 않음. 다른 AI에는 필요한 범위의 JSON만 사용자가 선택해서 공유.

초기 사전 검증: 별도 PAPER 엔진 왕복·근거버전·전후121초·손실 필터·리포트 및 실전 fake broker 대사. 실제 사용자 실전 주문은 검사에 사용하지 않음. 최신 중앙 VALIDATION이 최종 검증 상태입니다.
