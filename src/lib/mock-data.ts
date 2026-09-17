import type { Department, Project } from "./types";

export const departments: Department[] = [
  {
    id: "store",
    name: "스토어부서",
    icon: "🛒",
    agents: [
      { id: "s1", name: "상품소싱이", task: "신상품 후보 스캔", status: "active" },
      { id: "s2", name: "상세페이지작가", task: "상세페이지 작성", status: "active" },
      { id: "s3", name: "가격감시자", task: "경쟁가 모니터링", status: "active" },
      { id: "s4", name: "주문관리자", task: "주문/재고 동기화", status: "standby" },
      { id: "s5", name: "고객응대원", task: "고객문의 정리", status: "idle" },
    ],
  },
  {
    id: "shorts",
    name: "쇼츠부서",
    icon: "🎬",
    agents: [
      { id: "v1", name: "대본작가", task: "쇼츠 대본 초안", status: "active" },
      { id: "v2", name: "영상감독", task: "영상 컷 구성", status: "active" },
      { id: "v3", name: "썸네일디자이너", task: "썸네일 생성", status: "active" },
      { id: "v4", name: "업로드담당", task: "업로드 예약", status: "standby" },
      { id: "v5", name: "수익집계원", task: "조회수/수익 집계", status: "idle" },
    ],
  },
  {
    id: "blog",
    name: "블로그부서",
    icon: "✍️",
    agents: [
      { id: "b1", name: "키워드조사원", task: "키워드 리서치", status: "active" },
      { id: "b2", name: "글쓰기작가", task: "포스트 작성", status: "active" },
      { id: "b3", name: "SEO점검원", task: "검색최적화 점검", status: "standby" },
      { id: "b4", name: "발행담당", task: "발행/스케줄링", status: "idle" },
    ],
  },
  {
    id: "ops",
    name: "운영부서",
    icon: "⚙️",
    agents: [
      { id: "o1", name: "정산담당", task: "채널별 수익 집계", status: "active" },
      { id: "o2", name: "보고서작성원", task: "일일 리포트 생성", status: "standby" },
      { id: "o3", name: "이상감지원", task: "이상 감지/알림", status: "idle" },
    ],
  },
];

export const projects: Project[] = [
  { id: "p1", name: "스마트스토어 자동화", departmentId: "store", agentCount: 5, leadAgent: "상품소싱이" },
  { id: "p2", name: "쿠팡 자동화", departmentId: "store", agentCount: 4, leadAgent: "가격감시자" },
  { id: "p3", name: "쇼츠 팩토리", departmentId: "shorts", agentCount: 6, leadAgent: "영상감독" },
  { id: "p4", name: "블로그 팩토리", departmentId: "blog", agentCount: 4, leadAgent: "글쓰기작가" },
  { id: "p5", name: "수익 관제 센터", departmentId: "ops", agentCount: 3, leadAgent: "정산담당" },
];
