import { NextResponse } from "next/server";
import { fetchViaFixedIp } from "@/lib/proxyFetch";

function sma(values: number[], period: number) {
  if (values.length < period) return null;
  return values.slice(-period).reduce((sum, value) => sum + value, 0) / period;
}

function rsi(values: number[], period = 14) {
  if (values.length <= period) return null;
  const changes = values.slice(1).map((value, index) => value - values[index]);
  const recent = changes.slice(-period);
  const gains = recent.filter((value) => value > 0).reduce((sum, value) => sum + value, 0) / period;
  const losses = recent.filter((value) => value < 0).reduce((sum, value) => sum + Math.abs(value), 0) / period;
  if (losses === 0) return 100;
  return 100 - 100 / (1 + gains / losses);
}

function smaAt(values: number[], period: number, end: number) {
  if (end < period) return null;
  return values.slice(end - period, end).reduce((sum, value) => sum + value, 0) / period;
}

export async function GET(request: Request) {
  const market = new URL(request.url).searchParams.get("market") || "KRW-BTC";
  if (!/^KRW-[A-Z0-9-]+$/.test(market)) {
    return NextResponse.json({ ok: false, error: "시세 조회 오류: KRW 마켓 코드만 허용됩니다" }, { status: 400 });
  }
  try {
    const [candleResponse, orderbookResponse] = await Promise.all([
      fetchViaFixedIp(`https://api.upbit.com/v1/candles/minutes/1?market=${market}&count=200`, { cache: "no-store" }),
      fetchViaFixedIp(`https://api.upbit.com/v1/orderbook?markets=${market}`, { cache: "no-store" }),
    ]);
    const data = await candleResponse.json();
    const orderbook = await orderbookResponse.json();
    if (!candleResponse.ok || !Array.isArray(data)) {
      return NextResponse.json({ ok: false, error: `업비트 1분봉 API 오류 ${candleResponse.status}: ${data?.error?.message || "캔들 데이터를 받지 못했습니다"}` }, { status: 502 });
    }
    if (!orderbookResponse.ok || !Array.isArray(orderbook) || !orderbook[0]) {
      return NextResponse.json({ ok: false, error: `업비트 호가창 API 오류 ${orderbookResponse.status}: ${orderbook?.error?.message || "호가 데이터를 받지 못했습니다"}` }, { status: 502 });
    }
    const closes = data.map((candle) => Number(candle.trade_price)).reverse();
    const last = closes.at(-1) ?? null;
    const sma5 = sma(closes, 5);
    const sma20 = sma(closes, 20);
    const previousSma5 = smaAt(closes, 5, closes.length - 1);
    const previousSma20 = smaAt(closes, 20, closes.length - 1);
    const signal = previousSma5 !== null && previousSma5 <= (previousSma20 ?? Infinity) && (sma5 ?? 0) > (sma20 ?? Infinity)
      ? "golden_cross"
      : previousSma5 !== null && previousSma5 >= (previousSma20 ?? -Infinity) && (sma5 ?? 0) < (sma20 ?? -Infinity)
        ? "dead_cross"
        : "neutral";
    return NextResponse.json({ ok: true, market, candleCount: closes.length, price: last, indicators: { sma5, sma20, previousSma5, previousSma20, rsi14: rsi(closes), signal }, candles: data.slice(0, 60), orderbook: { totalAskSize: orderbook[0].total_ask_size, totalBidSize: orderbook[0].total_bid_size, units: orderbook[0].orderbook_units?.slice(0, 8) || [] } });
  } catch (error) {
    return NextResponse.json({ ok: false, error: `업비트 공개 시세 연결 오류: ${error instanceof Error ? error.message : "알 수 없는 네트워크 오류"}` }, { status: 502 });
  }
}

export const dynamic = "force-dynamic";

// 공개 API는 읽기 전용이다. 주문 키를 이 라우트에서 사용하지 않는다.
// 출처: https://api.upbit.com/v1/candles/minutes/1
