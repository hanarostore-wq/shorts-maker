import { createHash, createHmac, randomUUID } from "node:crypto";
export function jwt(access, secret, params = {}) {
  const payload = { access_key: access, nonce: randomUUID() };
  const query = decodeURIComponent(new URLSearchParams(params).toString());
  if (query) {
    payload.query_hash = createHash("sha512").update(query).digest("hex");
    payload.query_hash_alg = "SHA512";
  }
  const enc = (x) => Buffer.from(JSON.stringify(x)).toString("base64url");
  const body = enc({ alg: "HS512", typ: "JWT" }) + "." + enc(payload);
  return (
    body + "." + createHmac("sha512", secret).update(body).digest("base64url")
  );
}
export class UpbitBroker {
  constructor(fetcher = fetch) {
    this.fetcher = fetcher;
    this.access = "";
    this.secret = "";
    this.verified = false;
    this.blockedUntil = 0;
    this.queue = Promise.resolve();
    this.lastRequest = 0;
  }
  async request(method, path, params = {}, beforeSend = null) {
    const routes = {
      GET: ["/v1/accounts", "/v1/orders/chance", "/v1/order"],
      POST: ["/v1/orders", "/v1/orders/test"],
      DELETE: ["/v1/order"],
    };
    if (!routes[method]?.includes(path))
      throw Error("허용되지 않은 업비트 API");
    if (!this.access || !this.secret) throw Error("업비트 키 미연결");
    const job = this.queue.then(async () => {
      const wait = Math.max(
        0,
        this.lastRequest + 110 - Date.now(),
        this.blockedUntil - Date.now(),
      );
      if (wait > 5000) throw Error("업비트 요청 제한 대기");
      if (wait) await new Promise((r) => setTimeout(r, wait));
      if (beforeSend) {
        try {
          beforeSend();
        } catch (e) {
          e.notSent = true;
          throw e;
        }
      }
      this.lastRequest = Date.now();
      const r = await this.fetcher(
        "https://api.upbit.com" +
          path +
          (method === "POST"
            ? ""
            : Object.keys(params).length
              ? "?" + new URLSearchParams(params)
              : ""),
        {
          method,
          headers: {
            Authorization: "Bearer " + jwt(this.access, this.secret, params),
            "Content-Type": "application/json",
          },
          body: method === "POST" ? JSON.stringify(params) : undefined,
          signal: AbortSignal.timeout(6000),
        },
      );
      if ([429, 418].includes(r.status)) this.blockedUntil = Date.now() + 60000;
      const body = await r.json();
      if (!r.ok) {
        const reason=String(body.error?.name || "request_failed");
        const help={no_authorization_ip:"업비트 연결 거절: API 관리의 허용 IP에 현재 메인 PC의 공인 IP를 추가하세요. ",out_of_scope:"업비트 키 권한 부족: 자산조회·주문조회·주문하기 권한을 확인하세요. ",insufficient_funds_bid:"업비트 주문가능 원화가 부족합니다. 운용금과 주문금액을 확인하세요. "}[reason]||"";
        const e = new Error(
          help + "업비트 HTTP " +
            r.status +
            " / " +
            String(body.error?.name || "request_failed").replace(
              /[^a-zA-Z0-9_]/g,
              "",
            ),
        );
        e.status = r.status;
        throw e;
      }
      return body;
    });
    this.queue = job.catch(() => {});
    return job;
  }
  async verify(access, secret, market) {
    const old = {
      access: this.access,
      secret: this.secret,
      verified: this.verified,
    };
    this.access = access;
    this.secret = secret;
    this.verified = false;
    try {
      await this.request("GET", "/v1/accounts");
      const chance = await this.request("GET", "/v1/orders/chance", { market });
      this.verified = true;
      return chance;
    } catch (e) {
      Object.assign(this, old);
      throw e;
    }
  }
  chance(market) {
    return this.request("GET", "/v1/orders/chance", { market });
  }
  test(market, amount) {
    return this.request("POST", "/v1/orders/test", {
      market,
      side: "bid",
      ord_type: "price",
      price: String(amount),
      identifier: "jev-test-" + randomUUID(),
    });
  }
  send(params, beforeSend) {
    return this.request("POST", "/v1/orders", params, beforeSend);
  }
  find(identifier) {
    return this.request("GET", "/v1/order", { identifier });
  }
  cancel(identifier) {
    return this.request("DELETE", "/v1/order", { identifier });
  }
}
