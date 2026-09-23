import { NextResponse } from "next/server";
import { fetchViaFixedIp } from "@/lib/proxyFetch";

export const dynamic = "force-dynamic";

type UpbitMarket = { market: string; korean_name: string; english_name: string };
type Ticker = { market: string; trade_price: number; signed_change_rate: number; acc_trade_price_24h: number };

export async function GET() {
  try {
    const allResponse = await fetchViaFixedIp("https://api.upbit.com/v1/market/all?isDetails=false", { cache: "no-store" });
    const all = await allResponse.json() as UpbitMarket[];
    if (!allResponse.ok || !Array.isArray(all)) return NextResponse.json({ ok: false, error: `[MARKET_LIST_API_ERROR] 업비트 마켓 목록 조회 단계에서 HTTP ${allResponse.status} 응답을 받았습니다` }, { status: 502 });
    const markets = all.filter((item) => item.market.startsWith("KRW-")).slice(0, 40);
    const tickerResponse = await fetchViaFixedIp(`https://api.upbit.com/v1/ticker?markets=${markets.map((m) => m.market).join(",")}`, { cache: "no-store" });
    const tickers = await tickerResponse.json() as Ticker[];
    if (!tickerResponse.ok || !Array.isArray(tickers)) return NextResponse.json({ ok: false, error: `[MARKET_TICKER_API_ERROR] 업비트 코인 목록의 현재가·변동률 조회 단계에서 HTTP ${tickerResponse.status} 응답을 받았습니다` }, { status: 502 });
    const byCode = new Map(tickers.map((ticker) => [ticker.market, ticker]));
    return NextResponse.json({ ok: true, markets: markets.map((market) => { const ticker = byCode.get(market.market); return { market: market.market, korean_name: market.korean_name, price: ticker?.trade_price ?? null, change: ticker?.signed_change_rate ?? null, volume: ticker?.acc_trade_price_24h ?? null }; }) });
  } catch (error) {
    return NextResponse.json({ ok: false, error: `[MARKET_LIST_NETWORK_ERROR] 업비트 코인 목록·거래대금 조회 단계의 고정IP 네트워크 연결에 실패했습니다: ${error instanceof Error ? error.message : "원인 미상"}` }, { status: 502 });
  }
}
