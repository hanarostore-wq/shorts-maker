export type CoinMode = "paper" | "live";
export type CoinSide = "buy" | "sell";

export interface CoinRiskInput {
  mode: CoinMode;
  side: CoinSide;
  market: string;
  krwBalance: number;
  coinBalance: number;
  orderKrw: number;
  price: number;
  dailyPnl: number;
  dailyLossLimit: number;
  maxPositionKrw: number;
  spreadBps: number;
  minOrderKrw?: number;
  hasOpenOrder?: boolean;
  websocketHealthy?: boolean;
  liveEnabled?: boolean;
  liveConfirmation?: string;
}

export interface CoinRiskResult {
  allowed: boolean;
  reasonCode: string;
  message: string;
  checks: Record<string, boolean>;
}

export function evaluateCoinOrder(input: CoinRiskInput): CoinRiskResult {
  const checks: Record<string, boolean> = {
    market: /^KRW-[A-Z0-9-]+$/.test(input.market),
    positivePrice: input.price > 0,
    minimumOrder: input.orderKrw >= (input.minOrderKrw ?? 5000),
    balance: input.side === "buy" ? input.krwBalance >= input.orderKrw : input.coinBalance > 0,
    positionLimit: input.orderKrw <= input.maxPositionKrw,
    dailyLossLimit: input.dailyPnl > -Math.abs(input.dailyLossLimit),
    spread: input.spreadBps <= 50,
    noOpenOrder: !input.hasOpenOrder,
    websocket: input.websocketHealthy !== false,
    liveGate: input.mode === "paper" || (input.liveEnabled === true && input.liveConfirmation === "BLACK_LIVE_TRADING_ENABLE"),
  };
  const failed = Object.entries(checks).find(([, passed]) => !passed);
  if (failed) {
    const messages: Record<string, string> = {
      market: "KRW 현물 마켓 코드가 아닙니다",
      positivePrice: "현재가가 유효하지 않습니다",
      minimumOrder: "최소 주문 금액 미만입니다",
      balance: input.side === "buy" ? "원화 잔고가 부족합니다" : "매도 가능한 코인 잔고가 없습니다",
      positionLimit: "종목별 최대 포지션 금액을 초과했습니다",
      dailyLossLimit: "일일 손실한도를 초과해 주문을 차단했습니다",
      spread: "호가 스프레드가 과도해 주문을 차단했습니다",
      noOpenOrder: "미체결 주문이 있어 중복 주문을 차단했습니다",
      websocket: "실시간 시세 연결이 비정상이라 주문을 차단했습니다",
      liveGate: "실거래 활성화 플래그와 블랙 승인 토큰이 없어 실제 주문을 차단했습니다",
    };
    return { allowed: false, reasonCode: `COIN_${failed[0].toUpperCase()}_BLOCKED`, message: messages[failed[0]], checks };
  }
  return { allowed: true, reasonCode: "COIN_ORDER_ALLOWED", message: input.mode === "paper" ? "모의 현물 주문을 허용했습니다" : "리스크 관문을 통과해 실거래 주문을 허용했습니다", checks };
}
