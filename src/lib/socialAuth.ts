import { timingSafeEqual } from "node:crypto";

/** The control key is never included in bundles or returned by the API. */
export function isSocialAuthorized(request: Request) {
  const expected = process.env.SOCIAL_CONTROL_KEY;
  const provided = request.headers.get("x-social-control-key") || "";
  if (!expected || !provided) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function isSocialCron(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const provided = request.headers.get("authorization") || "";
  const expected = `Bearer ${secret}`;
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  return a.length === b.length && timingSafeEqual(a, b);
}
