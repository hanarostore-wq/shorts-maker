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
      { id: "c_binance_spot", name: "바이낸스 현물", task: "로컬 실시간 시세·호가·체결 수신 정상 · PAPER/실계좌 전환 대기", status: "active" },
      { id: "c_binance_futures", name: "바이낸스 선물", task: "로컬 실시간 선물 시세·펀딩·미결제약정 수신 정상 · PAPER/실계좌 전환 대기", status: "active" },
      { id: "c_trade_analyst", name: "체결분석가", task: "체결·차트·진입·매도·익절·손절 근거 내보내기 검증 대기", status: "standby" },
      { id: "c_gemini", name: "제미나이", task: "제미나이 슬롯 제안·추가·삭제·적용 이력 관리 대기", status: "standby" },
      { id: "c_claude", name: "클로드", task: "클로드 슬롯 제안·추가·삭제·적용 이력 관리 대기", status: "standby" },
      { id: "c_grok", name: "그록", task: "그록 슬롯 제안·추가·삭제·적용 이력 관리 대기", status: "standby" },
      { id: "c_manus", name: "마누스", task: "마누스 슬롯 제안·추가·삭제·적용 이력 관리 대기", status: "standby" },
      { id: "c_gpt", name: "지피티", task: "지피티 슬롯 제안·추가·삭제·적용 이력 관리 대기", status: "standby" },
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
  { id: "p6", name: "바이낸스 현물 로컬 터미널", departmentId: "coin", agentCount: 1, leadAgent: "바이낸스 현물" },
  { id: "p7", name: "바이낸스 선물 로컬 터미널", departmentId: "coin", agentCount: 1, leadAgent: "바이낸스 선물" },

];
