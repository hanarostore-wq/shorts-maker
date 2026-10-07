import type { NextRequest } from "next/server";

/** 브라우저 UI의 변경 요청만 허용해 타 사이트의 CSRF 요청을 막는다. */
export function isTrustedConcatBrowserRequest(request: NextRequest) {
  const origin = request.headers.get("origin");
  return Boolean(origin && origin === request.nextUrl.origin);
}
