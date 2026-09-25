# 매매분석 저장소

코드의 data 폴더를 실제 저장소로 쓰지 않습니다. Windows 실행 서버의 TRADING_DATA_DIR/analytics/analytics.sqlite에 SQLite WAL + 압축 시세를 저장합니다. 현재 설치 위치는 %LOCALAPPDATA%/MoneyOS/trading/data/analytics 입니다. API/계좌 인증 원문은 수집하지 않습니다. 거래 데이터 자체도 비공개이며 인증된 사용자만 조회합니다.

- [SCHEMA](SCHEMA.md), [INDEX](INDEX.md)
- 종목·매매 모드·기간·직원·근거 ID/버전·손익·청산 원인으로 범위를 제한합니다.
- 운영본부 매매분석 직원에서 조회/리포트/JSON 저장. 공개 Git에는 문서/소스만 올립니다.
- 과거 장부는 근거가 없던 기록으로 구분합니다. 과거 시장/판단을 생성해 채우지 않습니다.
- 초기 60초 전후, 1초 간격. 겹치는 symbol/second는 공용 샘플. 시세 5단계 호가와 전략에서 이미 쓰는 수치만 저장합니다. 시작 직후/중단 구간은 누락으로 표시합니다. 종목 전환 후에도 완료 전 구간은 주문 기능 없는 시세 연결로 수집합니다.
- SQLite 512MiB 초과 시 새 시계열 쓰기를 제한하고 이상 표시. 거래 장부/기존 데이터 삭제 없음. 체결 원장과 분석 DB는 별도: 분석 실패가 실제 체결을 취소했다고 처리하지 않으며 다음 저장/재시작 시 ID 기준 재수집합니다.
- 재시작/이동 전 엔진 OFF 확인 및 제한된 로컬 백업. SQLite 실행 중 백업은 SQLite backup API 또는 프로세스 정상 종료 후 DB/WAL/SHM 전체 복사. 원본 파일 임의 삭제 금지.
- 테스트: node --test tests/terminal/*.test.mjs. SQLite는 Node 24 실행본에서 검증.
