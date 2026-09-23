import { NextResponse } from "next/server";

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

export async function GET(request: Request) {
  const market = new URL(request.url).searchParams.get("market") || "KRW-BTC";
  if (!/^KRW-[A-Z0-9-]+$/.test(market)) {
    return NextResponse.json({ ok: false, error: "시세 조회 오류: KRW 마켓 코드만 허용됩니다" }, { status: 400 });
  }
  try {
    const response = await fetch(`https://api.upbit.com/v1/candles/minutes/1?market=${market}&count=200`, { cache: "no-store" });
    const data = await response.json();
    if (!response.ok || !Array.isArray(data)) {
      return NextResponse.json({ ok: false, error: `업비트 공개 시세 API 오류 ${response.status}: ${data?.error?.message || "캔들 데이터를 받지 못했습니다"}` }, { status: 502 });
    }
    const closes = data.map((candle) => Number(candle.trade_price)).reverse();
    const last = closes.at(-1) ?? null;
    return NextResponse.json({ ok: true, market, candleCount: closes.length, price: last, indicators: { sma5: sma(closes, 5), sma20: sma(closes, 20), rsi14: rsi(closes) }, candles: data.slice(0, 60) });
  } catch (error) {
    return NextResponse.json({ ok: false, error: `업비트 공개 시세 연결 오류: ${error instanceof Error ? error.message : "알 수 없는 네트워크 오류"}` }, { status: 502 });
  }
}

export const dynamic = "force-dynamic";

// 공개 API는 읽기 전용이다. 주문 키를 이 라우트에서 사용하지 않는다.
// 출처: https://api.upbit.com/v1/candles/minutes/1
