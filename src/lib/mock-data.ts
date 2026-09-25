import type { Department, Project } from "./types";

export const departments: Department[] = [
  {
    id: "ops",
    name: "운영부서",
    icon: "⚙️",
    agents: [
      { id: "o4", name: "Vercel파견직원", task: "Vercel 배포/빌드 전반 관리 - 아직 연동 안 됨", status: "offline" },
      { id: "o5", name: "공유저장소", task: "Upstash Redis 공유 상태 관리", status: "active" },
    ],
  },
  {
    id: "store",
    name: "스토어부서",
    icon: "🛒",
    agents: [
      { id: "s1", name: "상품소싱이", task: "확장프로그램 수동·자동 상품소싱 대기", status: "offline" },
      { id: "s11", name: "소싱관리", task: "소싱 상품 관리 대기", status: "offline" },
      { id: "s2", name: "상세페이지작가", task: "상세페이지 작성 - 아직 연동 안 됨", status: "offline" },
      { id: "s3", name: "가격감시자", task: "경쟁가 모니터링 - 아직 연동 안 됨", status: "offline" },
      { id: "s4", name: "주문관리자", task: "주문/재고 동기화 - 아직 연동 안 됨", status: "offline" },
      { id: "s5", name: "고객응대원", task: "고객문의 정리 - 아직 연동 안 됨", status: "offline" },
      { id: "s6", name: "쿠팡파견", task: "쿠팡 API 연동 관리 (클릭해서 조회)", status: "offline" },
      { id: "s7", name: "승인관리", task: "승인 대기 없음", status: "offline" },
      { id: "s8", name: "업무지시", task: "실행 중인 지시 없음", status: "offline" },
      { id: "s9", name: "승인정책", task: "변경 작업 없음", status: "offline" },
      { id: "s10", name: "네이버파견", task: "네이버 API 연동 관리 (클릭해서 조회)", status: "offline" },
    ],
  },
  {
    id: "coin",
    name: "코인매매부서",
    icon: "₿",
    agents: [
      { id: "c8", name: "업비트파견", task: "업비트 공개 시세·거래 API 연결 대기", status: "offline" },
      { id: "c_selection", name: "종목선정", task: "종목선정 근거 추가·삭제 · 모의/실전 공통", status: "active" },
      { id: "c_entry", name: "Jev 매수근거", task: "Jev 매수근거 근거 추가·삭제 · 모의/실전 공통", status: "active" },
      { id: "c_exit", name: "Jev 매도근거", task: "Jev 매도근거 근거 추가·삭제 · 모의/실전 공통", status: "active" },
      { id: "c_trend", name: "가격흐름", task: "가격흐름 근거 추가·삭제 · 모의/실전 공통", status: "active" },
      { id: "c_flow", name: "거래량·매수세", task: "거래량·매수세 근거 추가·삭제 · 모의/실전 공통", status: "active" },
      { id: "c_liquidity", name: "호가·체결", task: "호가·체결 근거 추가·삭제 · 모의/실전 공통", status: "active" },
      { id: "c_sizing", name: "투자비용", task: "투자비용 근거 추가·삭제 · 모의/실전 공통", status: "active" },
      { id: "c_risk", name: "위험관리", task: "위험관리 근거 추가·삭제 · 모의/실전 공통", status: "active" },
      { id: "c_analytics", name: "매매분석", task: "거래 근거·시장 자료·손익 분석 대기", status: "standby" },
      { id: "c13", name: "실전매매원", task: "승인된 업비트 실거래 실행", status: "offline" },
      { id: "c7", name: "모의매매원", task: "실제 주문 없는 체결 시뮬레이션 대기", status: "offline" },
    ],
  },
  {
    id: "stock",
    name: "주식매매부서",
    icon: "📈",
    agents: [
      { id: "t8", name: "나무플러그파견", task: "나무플러그 시세·주문 API 연결 대기", status: "offline" },
      { id: "t_selection", name: "종목선정", task: "종목선정 근거 추가·삭제 · 모의/실전 공통", status: "active" },
      { id: "t_entry", name: "Jev 매수근거", task: "Jev 매수근거 근거 추가·삭제 · 모의/실전 공통", status: "active" },
      { id: "t_exit", name: "Jev 매도근거", task: "Jev 매도근거 근거 추가·삭제 · 모의/실전 공통", status: "active" },
      { id: "t_trend", name: "가격흐름", task: "가격흐름 근거 추가·삭제 · 모의/실전 공통", status: "active" },
      { id: "t_flow", name: "거래량·매수세", task: "거래량·매수세 근거 추가·삭제 · 모의/실전 공통", status: "active" },
      { id: "t_liquidity", name: "호가·체결", task: "호가·체결 근거 추가·삭제 · 모의/실전 공통", status: "active" },
      { id: "t_sizing", name: "투자비용", task: "투자비용 근거 추가·삭제 · 모의/실전 공통", status: "active" },
      { id: "t_risk", name: "위험관리", task: "위험관리 근거 추가·삭제 · 모의/실전 공통", status: "active" },
      { id: "t_analytics", name: "매매분석", task: "거래 근거·시장 자료·손익 분석 대기", status: "standby" },
      { id: "t13", name: "실전매매원", task: "승인된 나무플러그 실거래 실행", status: "offline" },
      { id: "t7", name: "모의매매원", task: "실제 주문 없는 체결 시뮬레이션 대기", status: "offline" },
    ],
  },
  {
    id: "shorts",
    name: "쇼츠부서",
    icon: "🎬",
    agents: [
      { id: "v5", name: "트렌드분석원", task: "01. Search · 유튜브 검색 & 바이럴 지표 산출", status: "active" },
      { id: "v2", name: "영상감독", task: "02. Analyze · 11대 바이럴 공식 & 시각 DNA 역설계", status: "active" },
      { id: "v4", name: "소재기획자", task: "03. Ideate · 6대 떡상 소재 발굴 & 기획", status: "active" },
      { id: "v6", name: "전략디렉터", task: "04. Select Topic · 구간별 스토리텔링 로드맵 확정", status: "active" },
      { id: "v1", name: "대본작가", task: "05. Script · 1문장 완청 최적화 쇼츠 대본 집필", status: "active" },
      { id: "v3", name: "비주얼디자이너", task: "06. Visual Prompts · 미드저니 v6 & Suno BGM 생성", status: "active" },
    ],
  },
  {
    id: "blog",
    name: "블로그부서",
    icon: "✍️",
    agents: [

      { id: "b_research", name: "소재 조사원", task: "네이버 DataLab/Search 분석·중복 제거·블로그 적합도·Opportunity Score·MASTER TOPIC·상위 100개 주제 저장", status: "standby" },
      { id: "b_ready", name: "READY 관리자", task: "GPT 완성글 적재·필드 검증·블로그 배정·READY 수량·체크 선택 관리", status: "standby" },

      { id: "b_naver", name: "네이버 블로거", task: "READY 콘텐츠를 일정에 맞춰 네이버 블로그에 배포·결과 기록", status: "standby" },
      { id: "b_adsense", name: "애드센스 분석관", task: "Google OAuth 연결·AdSense 수익·페이지뷰·CTR·RPM·블로그별 성과 분석", status: "standby" },
    ],
  },
];

export const projects: Project[] = [
  { id: "p0", name: "배포 관제", departmentId: "ops", agentCount: 1, leadAgent: "Vercel파견직원" },
  { id: "p1", name: "스마트스토어 자동화", departmentId: "store", agentCount: 5, leadAgent: "상품소싱이" },
  { id: "p2", name: "쿠팡 자동화", departmentId: "store", agentCount: 4, leadAgent: "가격감시자" },
  { id: "p3", name: "쇼츠 팩토리", departmentId: "shorts", agentCount: 6, leadAgent: "영상감독" },

  { id: "p4", name: "블로그 팩토리", departmentId: "blog", agentCount: 4, leadAgent: "READY 관리자" },
  { id: "p5", name: "업비트 현물 단타", departmentId: "coin", agentCount: 12, leadAgent: "Jev 매수근거" },

];
