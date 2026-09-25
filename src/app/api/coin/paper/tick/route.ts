import {tradingAccessError} from '@/lib/terminal/device-auth.mjs';
import { NextResponse } from "next/server";
import { runLoopTick, type LoopInput, type LoopState } from "@/lib/jevLoopEngine";
import { askJev } from "@/lib/typesafeJev";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type TickBody = {
  market?: string;
  input?: LoopInput;
  state?: LoopState;
};

export async function POST(request: Request) {
  const denied=tradingAccessError(request);if(denied)return denied;
  try {
    const body = await request.json() as TickBody;
    const market = String(body.market || "KRW-BTC");
    const input = body.input;
    if (!input || !Number.isFinite(Number(input.price))) {
      return NextResponse.json({ ok: false, code: "JEV_TICK_INPUT_INVALID", error: "현재가와 시장 입력이 없어 자동 판단을 실행하지 않았습니다" }, { status: 400 });
    }
    const state = body.state || { cash: 100000, asset: 0, averageCost: 0, realizedPnl: 0, resting: [], fills: [], tick: 0 };
    const jev = await askJev({
      market,
      price: input.price,
      bestBid: input.bestBid,
      bestAsk: input.bestAsk,
      bidSize: input.bidSize,
      askSize: input.askSize,
      prices: input.prices.slice(-30),
      dataAgeMs: input.dataAgeMs ?? 0,
      websocketHealthy: input.websocketHealthy !== false,
      cash: state.cash,
      asset: state.asset,
      realizedPnl: state.realizedPnl,
      purpose: "PAPER_ONLY",
    });
    const jevInput = { ...input, jevAction: jev.action, jevProbabilities: jev.probabilities, jevConfidence: jev.confidence, jevProvider: jev.provider };
    const result = runLoopTick(state, jevInput);
    result.battery.provider = jev.provider;
    result.battery.buyConfidence = jev.probabilities.BUY;
    result.battery.sellConfidence = jev.probabilities.SELL;
    result.battery.latencyMs = jev.latencyMs;
    result.battery.direction = jev.action === "BUY" || jev.action === "SELL" ? jev.action : result.battery.direction;
    return NextResponse.json({ ok: true, mode: "paper", jev, result, message: jev.errorCode ? `[${jev.errorCode}] ${jev.errorMessage}` : "JEV 판단과 PAPER 지정가 체결 루프를 실행했습니다" });
  } catch (error) {
    return NextResponse.json({ ok: false, code: "JEV_PAPER_TICK_ERROR", error: error instanceof Error ? error.message : "JEV PAPER 틱 처리 중 알 수 없는 오류가 발생했습니다" }, { status: 500 });
  }
}
