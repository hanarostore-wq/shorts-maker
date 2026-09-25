import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { ADSENSE_SCOPE } from "@/lib/adsenseApi";
import { saveAdsenseOAuthState } from "@/lib/adsenseCredentials";

export async function GET(request: Request) {
  const clientId = process.env.GOOGLE_ADSENSE_CLIENT_ID;
  const redirectUri = process.env.GOOGLE_ADSENSE_REDIRECT_URI || `${new URL(request.url).origin}/api/blog/adsense/oauth/callback`;
  if (!clientId) return NextResponse.json({ ok: false, code: "ADSENSE_OAUTH_CONFIG_MISSING", error: "GOOGLE_ADSENSE_CLIENT_ID 서버 환경변수가 없습니다." }, { status: 503 });
  const state = randomBytes(24).toString("base64url"); await saveAdsenseOAuthState(state);
  const params = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: "code", access_type: "offline", prompt: "consent", scope: ADSENSE_SCOPE, state });
  return NextResponse.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
}
