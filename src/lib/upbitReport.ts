import { getSharedRedis } from "./store";

export type UpbitDailyReport = {
  date: string;
  generatedAt: string;
  mode: "paper" | "live";
  filledOrders: number;
  buys: number;
  sells: number;
  estimatedVolumeKrw: number;
  dailyLossLimitKrw: number;
  maxPositionKrw: number;
  liveTradingEnabled: boolean;
};

const REPORT_KEY = "moneyos:upbit:daily-reports:v1";

export async function saveUpbitDailyReport(report: UpbitDailyReport) {
  const redis = getSharedRedis();
  if (!redis) throw new Error("업비트 리포트 저장 오류: 공유 Redis가 연결되지 않았습니다");
  await redis.lpush(REPORT_KEY, JSON.stringify(report));
  await redis.ltrim(REPORT_KEY, 0, 29);
}

export async function listUpbitDailyReports(limit = 30): Promise<UpbitDailyReport[]> {
  const redis = getSharedRedis();
  if (!redis) return [];
  const rows = await redis.lrange<string>(REPORT_KEY, 0, Math.max(0, limit - 1));
  return rows.map((row) => typeof row === "string" ? JSON.parse(row) as UpbitDailyReport : row as unknown as UpbitDailyReport);
}
