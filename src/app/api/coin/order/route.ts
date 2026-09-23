import { createHash, createHmac, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { evaluateCoinOrder, type CoinMode, type CoinSide } from "@/lib/coinRisk";
import { loadUpbitCredentials } from "@/lib/coinCredentials";
import { fetchViaFixedIp } from "@/lib/proxyFetch";

const UPBIT_API = "https://api.upbit.com";
const LIVE_CONFIRMATION = "BLACK_LIVE_TRADING_ENABLE";
const SMP_TYPES = new Set(["cancel_taker", "cancel_maker", "reduce"]);

function base64url(value: string) { return Buffer.from(value).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_"); }
async function signUpbit(query: URLSearchParams) {
  const saved = await loadUpbitCredentials();
  const accessKey = process.env.UPBIT_ACCESS_KEY || saved?.accessKey;
  const secretKey = process.env.UPBIT_SECRET_KEY || saved?.secretKey;
  if (!accessKey || !secretKey) throw new Error("업비트 거래 API 인증 오류: UPBIT_ACCESS_KEY 또는 UPBIT_SECRET_KEY가 서버 환경변수에 없습니다");
  const queryHash = createHash("sha512").update(query.toString()).digest("hex");
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64url(JSON.stringify({ access_key: accessKey, nonce: randomUUID(), query_hash: queryHash, query_hash_alg: "SHA512" }));
  const signature = createHmac("sha256", secretKey).update(`${header}.${payload}`).digest("base64url");
  return `Bearer ${header}.${payload}.${signature}`;
}

async function upbit(path: string, query: URLSearchParams) {
  const response = await fetchViaFixedIp(`${UPBIT_API}${path}?${query.toString()}`, { headers: { Authorization: await signUpbit(query) }, cache: "no-store" });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`업비트 거래 API 오류 ${response.status}: ${data?.error?.message || "응답을 확인하지 못했습니다"}`);
  return data;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const mode = (body.mode || "paper") as CoinMode;
    const side = body.side as CoinSide;
    const market = String(body.market || "").toUpperCase();
    const price = Number(body.price || 0);
    const orderKrw = Number(body.orderKrw || 0);
    const volume = Number(body.volume || 0);
    const dailyPnl = Number(body.dailyPnl || 0);
    const risk = evaluateCoinOrder({ mode, side, market, krwBalance: Number(body.krwBalance || 0), coinBalance: Number(body.coinBalance || 0), orderKrw: side === "sell" ? price * volume : orderKrw, price, dailyPnl, dailyLossLimit: Number(process.env.COIN_DAILY_LOSS_LIMIT_KRW || 20000), maxPositionKrw: Number(process.env.COIN_MAX_POSITION_KRW || 50000), spreadBps: Number(body.spreadBps || 0), hasOpenOrder: Boolean(body.hasOpenOrder), websocketHealthy: body.websocketHealthy !== false, liveEnabled: process.env.COIN_LIVE_TRADING_ENABLED === "true", liveConfirmation: body.liveConfirmation, expectedSlippageBps: Number(body.expectedSlippageBps || 0), maxSlippageBps: Number(process.env.COIN_MAX_SLIPPAGE_BPS || 30), networkLatencyMs: Number(body.networkLatencyMs || 0), maxNetworkLatencyMs: Number(process.env.COIN_MAX_NETWORK_LATENCY_MS || 1500), dataAgeMs: Number(body.dataAgeMs || 0), maxDataAgeMs: Number(process.env.COIN_MAX_DATA_AGE_MS || 3000) });
    if (!risk.allowed) return NextResponse.json({ ok: false, stage: "risk_gate", error: `주문 차단 [${risk.reasonCode}]: ${risk.message}`, checks: risk.checks }, { status: 409 });
    if (mode === "paper") return NextResponse.json({ ok: true, mode, stage: "paper_execution", order: { id: `paper-${randomUUID()}`, market, side, orderKrw, volume, price, status: "simulated" }, message: "모의 현물 주문을 체결 시뮬레이션했습니다" });
    if (body.liveConfirmation !== LIVE_CONFIRMATION) return NextResponse.json({ ok: false, stage: "live_gate", error: `실거래 차단 [COIN_LIVE_CONFIRMATION_REQUIRED]: ${LIVE_CONFIRMATION} 승인 토큰이 필요합니다` }, { status: 403 });
    const smpType = String(body.smpType || process.env.UPBIT_SMP_TYPE || "cancel_taker");
    if (!SMP_TYPES.has(smpType)) return NextResponse.json({ ok: false, stage: "order_input", code: "UPBIT_SMP_TYPE_INVALID", error: `업비트 주문 차단 [UPBIT_SMP_TYPE_INVALID]: smp_type은 cancel_taker, cancel_maker, reduce 중 하나여야 합니다` }, { status: 400 });
    const query = new URLSearchParams({ market, side: side === "buy" ? "bid" : "ask", ord_type: side === "buy" ? "price" : "market", identifier: `moneyos-${randomUUID()}`, smp_type: smpType });
    if (side === "buy") query.set("price", String(orderKrw)); else query.set("volume", String(volume));
    const order = await upbit("/v1/orders", query);
    return NextResponse.json({ ok: true, mode, stage: "live_execution", order, message: "업비트 현물 주문을 전송했습니다" });
  } catch (error) {
    return NextResponse.json({ ok: false, stage: "order_api", error: error instanceof Error ? error.message : "업비트 주문 처리 중 알 수 없는 오류" }, { status: 502 });
  }
}

export const dynamic = "force-dynamic";
