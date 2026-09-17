import type { Department, Project } from "./types";

export const departments: Department[] = [
  {
    id: "store",
    name: "스토어부서",
    icon: "🛒",
    agents: [
      { id: "s1", name: "product-sourcer", task: "신상품 후보 스캔", status: "active" },
      { id: "s2", name: "listing-writer", task: "상세페이지 작성", status: "active" },
      { id: "s3", name: "price-tracker", task: "경쟁가 모니터링", status: "active" },
      { id: "s4", name: "order-manager", task: "주문/재고 동기화", status: "standby" },
      { id: "s5", name: "cs-responder", task: "고객문의 정리", status: "idle" },
    ],
  },
  {
    id: "shorts",
    name: "쇼츠부서",
    icon: "🎬",
    agents: [
      { id: "v1", name: "script-writer", task: "쇼츠 대본 초안", status: "active" },
      { id: "v2", name: "video-director", task: "영상 컷 구성", status: "active" },
      { id: "v3", name: "thumbnail-gen", task: "썸네일 생성", status: "active" },
      { id: "v4", name: "upload-scheduler", task: "업로드 예약", status: "standby" },
      { id: "v5", name: "revenue-tracker", task: "조회수/수익 집계", status: "idle" },
    ],
  },
  {
    id: "blog",
    name: "블로그부서",
    icon: "✍️",
    agents: [
      { id: "b1", name: "topic-researcher", task: "키워드 리서치", status: "active" },
      { id: "b2", name: "blog-writer", task: "포스트 작성", status: "active" },
      { id: "b3", name: "seo-optimizer", task: "SEO 점검", status: "standby" },
      { id: "b4", name: "publisher", task: "발행/스케줄링", status: "idle" },
    ],
  },
  {
    id: "ops",
    name: "운영부서",
    icon: "⚙️",
    agents: [
      { id: "o1", name: "finance-tracker", task: "채널별 수익 집계", status: "active" },
      { id: "o2", name: "report-builder", task: "일일 리포트 생성", status: "standby" },
      { id: "o3", name: "alert-monitor", task: "이상 감지/알림", status: "idle" },
    ],
  },
];

export const projects: Project[] = [
  { id: "p1", name: "smartstore-auto", departmentId: "store", agentCount: 5, leadAgent: "product-sourcer" },
  { id: "p2", name: "coupang-auto", departmentId: "store", agentCount: 4, leadAgent: "price-tracker" },
  { id: "p3", name: "shorts-factory", departmentId: "shorts", agentCount: 6, leadAgent: "video-director" },
  { id: "p4", name: "blog-factory", departmentId: "blog", agentCount: 4, leadAgent: "blog-writer" },
  { id: "p5", name: "revenue-hq", departmentId: "ops", agentCount: 3, leadAgent: "finance-tracker" },
];
