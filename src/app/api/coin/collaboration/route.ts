import { NextResponse } from "next/server";
import { getCollaborationSnapshot } from "@/lib/trading-collaboration";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(getCollaborationSnapshot(), {
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}
