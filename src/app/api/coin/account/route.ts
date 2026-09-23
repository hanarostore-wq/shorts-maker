import { createHmac, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { loadUpbitCredentials } from "@/lib/coinCredentials";
import { fetchViaFixedIp } from "@/lib/proxyFetch";

const b64 = (value: string) => Buffer.from(value).toString("base64url");
async function auth() {
  const saved = await loadUpbitCredentials();
  const access = process.env.UPBIT_ACCESS_KEY || saved?.accessKey;
  const secret = process.env.UPBIT_SECRET_KEY || saved?.secretKey;
  if (!access || !secret) throw new Error("업비트 자산 조회 오류: 저장된 API 키가 없습니다");
  const header = b64(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64(JSON.stringify({ access_key: access, nonce: randomUUID() }));
  const signature = createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");
  return `Bearer ${header}.${payload}.${signature}`;
}

export async function GET() {
  try {
    const response = await fetchViaFixedIp("https://api.upbit.com/v1/accounts", { headers: { Authorization: await auth() }, cache: "no-store" });
    const accounts = await response.json();
    if (!response.ok || !Array.isArray(accounts)) throw new Error(`업비트 잔고 API 오류 ${response.status}: ${accounts?.error?.message || "잔고를 받지 못했습니다"}`);
    const assets = accounts.filter((account) => account.currency !== "KRW" && Number(account.balance) + Number(account.locked) > 0);
    const markets = assets.map((account) => `KRW-${account.currency}`).join(",");
    const tickerResponse = markets ? await fetchViaFixedIp(`https://api.upbit.com/v1/ticker?markets=${markets}`, { cache: "no-store" }) : null;
    const tickers = tickerResponse ? await tickerResponse.json() : [];
    const priceByMarket = new Map((Array.isArray(tickers) ? tickers : []).map((ticker) => [ticker.market, Number(ticker.trade_price)]));
    const cash = accounts.filter((account) => account.currency === "KRW").reduce((sum, account) => sum + Number(account.balance) + Number(account.locked), 0);
    const portfolio = assets.map((account) => {
      const quantity = Number(account.balance) + Number(account.locked);
      const currentPrice = priceByMarket.get(`KRW-${account.currency}`) || Number(account.avg_buy_price);
      const cost = quantity * Number(account.avg_buy_price);
      const value = quantity * currentPrice;
      return { currency: account.currency, quantity, avgBuyPrice: Number(account.avg_buy_price), currentPrice, cost, value, pnl: value - cost };
    });
    const tradingValue = portfolio.reduce((sum, asset) => sum + asset.value, 0);
    return NextResponse.json({ ok: true, source: "upbit_private_balance", updatedAt: new Date().toISOString(), liveTradingEnabled: process.env.COIN_LIVE_TRADING_ENABLED === "true", cash, tradingValue, totalValue: cash + tradingValue, pnl: portfolio.reduce((sum, asset) => sum + asset.pnl, 0), portfolio });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "업비트 자산 조회 중 알 수 없는 오류" }, { status: 502 });
  }
}

export const dynamic = "force-dynamic";
