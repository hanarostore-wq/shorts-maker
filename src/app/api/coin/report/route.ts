import { createHash, createHmac, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { loadUpbitCredentials } from "@/lib/coinCredentials";

function b64(value: string) { return Buffer.from(value).toString("base64url"); }
async function auth(query: URLSearchParams) {
  const saved = await loadUpbitCredentials();
  const access = process.env.UPBIT_ACCESS_KEY || saved?.accessKey;
  const secret = process.env.UPBIT_SECRET_KEY || saved?.secretKey;
  if (!access || !secret) throw new Error("일일 리포트 인증 오류: UPBIT_ACCESS_KEY 또는 UPBIT_SECRET_KEY가 없습니다");
  const header = b64(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64(JSON.stringify({ access_key: access, nonce: randomUUID(), query_hash: createHash("sha512").update(query.toString()).digest("hex"), query_hash_alg: "SHA512" }));
  const signature = createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");
  return `Bearer ${header}.${payload}.${signature}`;
}

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const supplied = request.headers.get("authorization")?.replace("Bearer ", "");
  if (cronSecret && supplied !== cronSecret) return NextResponse.json({ ok: false, error: "일일 리포트 권한 오류: CRON_SECRET이 일치하지 않습니다" }, { status: 401 });
  try {
    const query = new URLSearchParams({ state: "done", limit: "100" });
    const response = await fetch(`https://api.upbit.com/v1/orders?${query}`, { headers: { Authorization: await auth(query) }, cache: "no-store" });
    const orders = await response.json();
    if (!response.ok || !Array.isArray(orders)) return NextResponse.json({ ok: false, error: `업비트 체결내역 API 오류 ${response.status}: ${orders?.error?.message || "체결내역을 받지 못했습니다"}` }, { status: 502 });
    const filled = orders.filter((order) => order.state === "done");
    const buys = filled.filter((order) => order.side === "bid");
    const sells = filled.filter((order) => order.side === "ask");
    const report = { date: new Date().toISOString().slice(0, 10), mode: process.env.COIN_LIVE_TRADING_ENABLED === "true" ? "live" : "paper", filledOrders: filled.length, buys: buys.length, sells: sells.length, estimatedVolumeKrw: filled.reduce((sum, order) => sum + Number(order.executed_funds || 0), 0), dailyLossLimitKrw: Number(process.env.COIN_DAILY_LOSS_LIMIT_KRW || 20000), maxPositionKrw: Number(process.env.COIN_MAX_POSITION_KRW || 50000), liveTradingEnabled: process.env.COIN_LIVE_TRADING_ENABLED === "true" };
    return NextResponse.json({ ok: true, report, message: "업비트 일일 리스크·거래성과 리포트를 생성했습니다" });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "일일 리포트 생성 중 알 수 없는 오류" }, { status: 502 });
  }
}

export const dynamic = "force-dynamic";
