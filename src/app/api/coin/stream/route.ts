import { WebSocket } from "undici";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const COMMON_MARKETS = [
  "KRW-BTC", "KRW-ETH", "KRW-XRP", "KRW-SOL", "KRW-DOGE",
  "KRW-ADA", "KRW-AVAX", "KRW-LINK", "KRW-DOT", "KRW-TRX",
];

function asText(data: unknown): Promise<string> {
  if (typeof data === "string") return Promise.resolve(data);
  if (data instanceof ArrayBuffer) return Promise.resolve(new TextDecoder().decode(data));
  if (ArrayBuffer.isView(data)) return Promise.resolve(new TextDecoder().decode(data.buffer));
  if (data && typeof (data as Blob).arrayBuffer === "function") {
    return (data as Blob).arrayBuffer().then((buffer) => new TextDecoder().decode(buffer));
  }
  return Promise.reject(new Error("[UPBIT_RELAY_DATA_ERROR] 업비트 중계 데이터 형식을 해석할 수 없습니다"));
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const market = url.searchParams.get("market") || "KRW-BTC";
  const requested = (url.searchParams.get("codes") || "").split(",").filter((code) => /^KRW-[A-Z0-9]+$/.test(code));
  const codes = Array.from(new Set([market, ...requested, ...COMMON_MARKETS])).slice(0, 30);
  const encoder = new TextEncoder();
  let upstream: WebSocket | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (value: unknown) => {
        if (!closed) controller.enqueue(encoder.encode(`data: ${JSON.stringify(value)}\n\n`));
      };
      const fail = (code: string, message: string) => send({ type: "relay_error", code, message });
      heartbeat = setInterval(() => send({ type: "relay_heartbeat", ts: Date.now() }), 15000);
      upstream = new WebSocket("wss://api.upbit.com/websocket/v1");
      upstream.addEventListener("open", () => {
        send({ type: "relay_open" });
        upstream?.send(JSON.stringify([
          { ticket: "moneyos-server-relay" },
          { type: "ticker", codes },
          { type: "orderbook", codes: [market] },
        ]));
      });
      upstream.addEventListener("message", async (event) => {
        try {
          const text = await asText(event.data);
          send(JSON.parse(text));
        } catch {
          fail("[UPBIT_RELAY_PARSE_ERROR]", "서버 중계 데이터 해석에 실패했습니다");
        }
      });
      upstream.addEventListener("error", () => fail("[UPBIT_RELAY_CONNECTION_ERROR]", "서버에서 업비트 WebSocket 연결에 실패했습니다"));
      upstream.addEventListener("close", () => {
        send({ type: "relay_close" });
        if (!closed) controller.close();
      });
      request.signal.addEventListener("abort", () => {
        closed = true;
        if (heartbeat) clearInterval(heartbeat);
        try { upstream?.close(); } catch { /* 이미 닫힌 연결 */ }
        try { controller.close(); } catch { /* 클라이언트가 먼저 종료 */ }
      });
    },
    cancel() {
      closed = true;
      if (heartbeat) clearInterval(heartbeat);
      try { upstream?.close(); } catch { /* 이미 닫힌 연결 */ }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
