import { NextResponse } from "next/server";
import { getState, isSharedStorageConfigured } from "@/lib/store";

export async function GET() {
  return NextResponse.json({
    ...(await getState()),
    sharedStorageConfigured: isSharedStorageConfigured(),
  });
}
