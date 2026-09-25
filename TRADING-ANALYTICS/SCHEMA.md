# Schema 1

- fills: 체결 ID(SHA256 내부 키), 익명 장부 식별자, 모드(paper/live), 종목, 시간, 방향, 수량/금액/수수료/실현손익(원장 decimal 문자열), 청산 원인, context, episode, window 범위. exchange 주문 UUID/계좌/키는 분석 DB에 저장하지 않음.
- context: 거래 당시 근거 전체 스냅샷(ID/version/staff/text/status/support/unknown), 정책 revision, Jev 식별자 해시/model/stateAsOf, 결정 side/score, 당시 주문 제한/위험 상태/투자금 계산/공개시장 관측. 수동·하드 손절에 Jev 근거를 억지로 붙이지 않음. 하드 손절의 실제 원인은 cause와 수치 limits에 기록.
- evidence: fill_id+rule_id 유일 인덱스, staff/rule/version 조회.
- samples: market+at 유일키, 1초 관측, gzip JSON BLOB. 수집 누락 및 stale 값을 완료로 표시하지 않음.
- episodes: 동일 장부·종목의 무포지션→보유→수량0 왕복. 부분매도는 한 episode. 실현손익은 원장 계산값 합계. 최초매수 없는 이전자료는 complete_basis=0. 가격은 funds/quantity로 복원 가능. 보고서 수익률=실현손익/(매수대금+매수수수료). 미청산 거래는 수익/손실 확정 집계에서 제외.
- reports: 범위와 사후 집계 결과. 근거별 연관 손익은 인과 기여도가 아니며 중복 합산하면 안 됨. 전략 자동 수정 없음.
- 근거 버전: 기존 안정 id 유지. 서버가 텍스트/분야 변경 때 version 증가, 삭제된 id도 ruleRegistry에 보존해 재등록 버전 회귀 방지. 과거 fill.context는 불변.

## 금액
헤더 이익/손실은 수수료 차감 후 완료 거래 기준. 비용은 그 금액에 이미 반영된 거래 수수료를 별도 표시. 총순익=이익-손실, 수수료를 두 번 빼지 않음. 원화 청구 내역이 없는 Jev/API 비용은 합계에서 제외한다고 표시. 모의/실전 구분.
