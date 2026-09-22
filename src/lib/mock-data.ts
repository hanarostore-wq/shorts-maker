import type { Department, Project } from "./types";

export const departments: Department[] = [
  {
    id: "ops",
    name: "운영부서",
    icon: "⚙️",
    agents: [
      { id: "o4", name: "Vercel파견직원", task: "Vercel 배포/빌드 전반 관리 - 아직 연동 안 됨", status: "offline" },
      { id: "o1", name: "정산담당", task: "채널별 수익 집계 - 아직 연동 안 됨", status: "offline" },
      { id: "o2", name: "보고서작성원", task: "일일 리포트 생성 - 아직 연동 안 됨", status: "offline" },
      { id: "o3", name: "이상감지원", task: "이상 감지/알림 - 아직 연동 안 됨", status: "offline" },
      { id: "o5", name: "공유저장소", task: "Upstash Redis 공유 상태 관리", status: "active" },
    ],
  },
  {
    id: "store",
    name: "스토어부서",
    icon: "🛒",
    agents: [
      { id: "s1", name: "상품소싱이", task: "확장프로그램 수동·자동 상품소싱 대기", status: "offline" },
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
    id: "shorts",
    name: "쇼츠부서",
    icon: "🎬",
    agents: [
      { id: "v1", name: "대본작가", task: "쇼츠 대본 초안 - 아직 연동 안 됨", status: "offline" },
      { id: "v2", name: "영상감독", task: "영상 컷 구성 - 아직 연동 안 됨", status: "offline" },
      { id: "v3", name: "썸네일디자이너", task: "썸네일 생성 - 아직 연동 안 됨", status: "offline" },
      { id: "v4", name: "업로드담당", task: "업로드 예약 - 아직 연동 안 됨", status: "offline" },
      { id: "v5", name: "수익집계원", task: "조회수/수익 집계 - 아직 연동 안 됨", status: "offline" },
    ],
  },
  {
    id: "blog",
    name: "블로그부서",
    icon: "✍️",
    agents: [
      { id: "b1", name: "키워드조사원", task: "키워드 리서치 - 아직 연동 안 됨", status: "offline" },
      { id: "b2", name: "글쓰기작가", task: "포스트 작성 - 아직 연동 안 됨", status: "offline" },
      { id: "b3", name: "SEO점검원", task: "검색최적화 점검 - 아직 연동 안 됨", status: "offline" },
      { id: "b4", name: "발행담당", task: "발행/스케줄링 - 아직 연동 안 됨", status: "offline" },
    ],
  },
];

export const projects: Project[] = [
  { id: "p0", name: "배포 관제", departmentId: "ops", agentCount: 1, leadAgent: "Vercel파견직원" },
  { id: "p1", name: "스마트스토어 자동화", departmentId: "store", agentCount: 5, leadAgent: "상품소싱이" },
  { id: "p2", name: "쿠팡 자동화", departmentId: "store", agentCount: 4, leadAgent: "가격감시자" },
  { id: "p3", name: "쇼츠 팩토리", departmentId: "shorts", agentCount: 6, leadAgent: "영상감독" },
  { id: "p4", name: "블로그 팩토리", departmentId: "blog", agentCount: 4, leadAgent: "글쓰기작가" },
];
