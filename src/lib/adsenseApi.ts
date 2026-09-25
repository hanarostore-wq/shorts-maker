import { hasAdsenseCredentials, loadAdsenseCredentials, saveAdsenseCredentials } from "./adsenseCredentials";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const ADSENSE_API = "https://adsense.googleapis.com/v2";
export const ADSENSE_SCOPE = "https://www.googleapis.com/auth/adsense.readonly";
function env(name: string) { return process.env[name] || ""; }
function dateValue(value: string | null, fallback: Date) {
  const match = value?.match(/^(\d{4})-(\d{2})-(\d{2})$/); return match ? { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) } : { year: fallback.getUTCFullYear(), month: fallback.getUTCMonth() + 1, day: fallback.getUTCDate() };
}
export function reportDates(from: string | null, to: string | null) {
  const end = new Date(); const start = new Date(end); start.setUTCDate(start.getUTCDate() - 30);
  return { startDate: dateValue(from, start), endDate: dateValue(to, end) };
}
async function refreshIfNeeded() {
  const credentials = await loadAdsenseCredentials();
  if (!credentials) return null;
  if (credentials.expiryDate && credentials.expiryDate > Date.now() + 60_000) return credentials.accessToken;
  if (!credentials.refreshToken || !env("GOOGLE_ADSENSE_CLIENT_ID") || !env("GOOGLE_ADSENSE_CLIENT_SECRET")) return credentials.accessToken;
  const response = await fetch(TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: env("GOOGLE_ADSENSE_CLIENT_ID"), client_secret: env("GOOGLE_ADSENSE_CLIENT_SECRET"), refresh_token: credentials.refreshToken, grant_type: "refresh_token" }), cache: "no-store" });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.access_token) throw new Error(`ADSENSE_TOKEN_${response.status}: ${body.error_description || "OAuth 토큰 갱신 실패"}`);
  await saveAdsenseCredentials({ ...credentials, accessToken: body.access_token, expiryDate: Date.now() + Number(body.expires_in || 3600) * 1000 });
  return body.access_token as string;
}
export async function adsenseFetch(path: string, init?: RequestInit) {
  const token = await refreshIfNeeded(); if (!token) throw new Error("ADSENSE_NOT_CONNECTED: 먼저 Google OAuth 연결을 완료하세요.");
  const response = await fetch(`${ADSENSE_API}${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init?.headers || {}) }, cache: "no-store" });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`ADSENSE_API_${response.status}: ${body?.error?.message || "AdSense API 요청 실패"}`);
  return body;
}
export async function getAdsenseDashboard(from: string | null, to: string | null) {
  if (!(await hasAdsenseCredentials())) return { configured: false, account: null, rows: [], totals: null };
  const accounts = await adsenseFetch("/accounts"); const account = accounts.accounts?.[0];
  if (!account?.name) return { configured: true, account: null, rows: [], totals: null };
  const { startDate, endDate } = reportDates(from, to);
  const report = await adsenseFetch(`/${account.name}/reports:generate`, { method: "POST", body: JSON.stringify({ reportingTimeZone: "ACCOUNT_TIME_ZONE", dateRange: { startDate, endDate }, dimensions: ["DATE"], metrics: ["ESTIMATED_EARNINGS", "PAGE_VIEWS", "IMPRESSIONS", "CLICKS", "PAGE_VIEWS_CTR", "PAGE_VIEWS_RPM"], orderBy: [{ dimension: "DATE", order: "DESCENDING" }] }) });
  const rows = (report.rows || []).map((row: { cells?: Array<{ value?: string }> }) => { const values = (row.cells || []).map((cell) => cell.value || "0"); return { date: values[0], estimatedEarnings: values[1], pageViews: values[2], impressions: values[3], clicks: values[4], ctr: values[5], rpm: values[6] }; });
  const totals = (report.totals?.[0]?.cells || []).map((cell: { value?: string }) => cell.value || "0");
  return { configured: true, account: { name: account.name, displayName: account.displayName || account.name }, rows, totals: { estimatedEarnings: totals[1] || "0", pageViews: totals[2] || "0", impressions: totals[3] || "0", clicks: totals[4] || "0", ctr: totals[5] || "0", rpm: totals[6] || "0" } };
}
