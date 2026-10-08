import fs from "fs";
import { collaborationWatchPaths, getCollaborationSnapshot } from "@/lib/trading-collaboration";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  const encoder = new TextEncoder();
  let cleanup = () => undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let scheduled = false;
      const send = () => {
        if (closed) return;
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(getCollaborationSnapshot())}\n\n`));
      };
      const schedule = () => {
        if (scheduled || closed) return;
        scheduled = true;
        setTimeout(() => { scheduled = false; send(); }, 80);
      };
      const watchers = collaborationWatchPaths.flatMap((target) => {
        try { return [fs.watch(target, { persistent: false }, schedule)]; }
        catch { return []; }
      });
      const heartbeat = setInterval(() => {
        if (!closed) controller.enqueue(encoder.encode(": heartbeat\n\n"));
      }, 15000);
      cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        watchers.forEach((watcher) => watcher.close());
        try { controller.close(); } catch { /* already closed */ }
      };
      request.signal.addEventListener("abort", cleanup, { once: true });
      send();
    },
    cancel() { cleanup(); },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
