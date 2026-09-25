import { NextResponse } from "next/server";
import { assessCandidate, createShadowTrade, labelFuturePrices, type PredictiveSnapshot } from "@/lib/predictiveV4";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { snapshot?: PredictiveSnapshot; previousState?: PredictiveSnapshot["state"]; hasPosition?: boolean; hasPendingOrder?: boolean; futurePrices?: Record<string, number> };
    if (!body.snapshot?.market || !Number.isFinite(body.snapshot.price) || !Number.isFinite(body.snapshot.asOf)) {
      return NextResponse.json({ ok: false, code: "PREDICTIVE_V4_SNAPSHOT_INVALID", error: "시장 후보 snapshot의 market·price·asOf가 필요합니다" }, { status: 400 });
    }
    const assessment = assessCandidate(body.snapshot, { previousState: body.previousState, hasPosition: body.hasPosition, hasPendingOrder: body.hasPendingOrder });
    const shadowTrade = createShadowTrade(assessment);
    const futureLabels = shadowTrade && body.futurePrices ? labelFuturePrices(shadowTrade.shadowEntryPrice, body.futurePrices) : null;
    return NextResponse.json({ ok: true, scannerVersion: 4, strategyVersion: "predictive-v4", mode: "shadow", assessment, shadowTrade, futureLabels, liveOrderCreated: false });
  } catch (error) {
    return NextResponse.json({ ok: false, code: "PREDICTIVE_V4_SNAPSHOT_ERROR", error: error instanceof Error ? error.message : "V4 snapshot 평가에 실패했습니다" }, { status: 400 });
  }
}
