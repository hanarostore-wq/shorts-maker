import type { Department, Project } from "./types";

export const departments: Department[] = [
  {
    id: "ops",
    name: "운영부서",
    icon: "⚙️",
    agents: [],
  },
  {
    id: "blog",
    name: "블로그부서",
    icon: "✍️",
    agents: [],
  },
  {
    id: "store",
    name: "스토어부서",
    icon: "🛒",
    agents: [],
  },
  {
    id: "coin",
    name: "코인매매부서",
    icon: "₿",
    agents: [
      { id: "c_yujin", name: "업비트", task: "YuJin Traders 자동매매 관제 · 클릭하면 전체 화면을 엽니다", status: "active" },
    ],
  },
  {
    id: "stock",
    name: "주식매매부서",
    icon: "📈",
    agents: [],
  },
  {
    id: "shorts",
    name: "쇼츠부서",
    icon: "🎬",
    agents: [],
  },
];

export const projects: Project[] = [
  { id: "p0", name: "배포 관제", departmentId: "ops", agentCount: 0, leadAgent: "미배정" },
  { id: "p1", name: "스마트스토어 자동화", departmentId: "store", agentCount: 0, leadAgent: "미배정" },
  { id: "p2", name: "쿠팡 자동화", departmentId: "store", agentCount: 0, leadAgent: "미배정" },
  { id: "p3", name: "쇼츠 팩토리", departmentId: "shorts", agentCount: 0, leadAgent: "미배정" },
  { id: "p4", name: "블로그 자동화", departmentId: "blog", agentCount: 0, leadAgent: "미배정" },
  { id: "p5", name: "업비트 현물 단타", departmentId: "coin", agentCount: 1, leadAgent: "업비트" },

];
