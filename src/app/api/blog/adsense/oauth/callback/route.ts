import { NextResponse } from "next/server";
import { consumeAdsenseOAuthState, saveAdsenseCredentials } from "@/lib/adsenseCredentials";

export async function GET(request: Request) {
  const url = new URL(request.url); const code = url.searchParams.get("code"); const state = url.searchParams.get("state");
  if (!code || !state || !(await consumeAdsenseOAuthState(state))) return NextResponse.json({ ok: false, error: "OAuth state가 유효하지 않거나 만료되었습니다." }, { status: 400 });
  const clientId = process.env.GOOGLE_ADSENSE_CLIENT_ID; const clientSecret = process.env.GOOGLE_ADSENSE_CLIENT_SECRET; const redirectUri = process.env.GOOGLE_ADSENSE_REDIRECT_URI || `${url.origin}/api/blog/adsense/oauth/callback`;
  if (!clientId || !clientSecret) return NextResponse.json({ ok: false, error: "Google OAuth 서버 환경변수가 설정되지 않았습니다." }, { status: 503 });
  const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: "authorization_code" }), cache: "no-store" });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.access_token) return NextResponse.json({ ok: false, error: `Google OAuth 실패: ${body.error_description || "토큰 발급 실패"}` }, { status: 502 });
  await saveAdsenseCredentials({ accessToken: body.access_token, refreshToken: body.refresh_token, expiryDate: Date.now() + Number(body.expires_in || 3600) * 1000, scope: body.scope });
  return NextResponse.redirect(`${url.origin}/?adsense=connected`);
}
