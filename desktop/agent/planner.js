// 관제실에서 내려온 한국어 지시를 실행 가능한 단계로 바꾼다.
//
// 지금은 언어모델을 붙이지 않고 키워드로만 해석한다. 해석하지 못한 지시는
// 조용히 넘기지 않고 실패로 돌려보낸다 — 엉뚱하게 동작하는 것보다
// "무슨 말인지 모르겠다"고 말하는 편이 낫다.

const URL_PATTERN = /https?:\/\/[^\s,]+/g;

const COLLECT_WORDS = /수집|소싱|긁어|가져와|모아|스크랩|등록할|후보/;
const PRICE_WORDS = /가격|시세|얼마|최저가|경쟁사/;

/**
 * @returns {{ ok: true, steps: Array<object> } | { ok: false, reason: string }}
 */
function planTask(instruction) {
  const text = String(instruction || "");
  const urls = text.match(URL_PATTERN) ?? [];

  if (urls.length === 0) {
    return {
      ok: false,
      reason:
        "수집할 페이지 주소가 지시에 없습니다. 상품 목록이나 상세페이지 주소를 함께 적어주세요.",
    };
  }

  // 가격 추적과 수집은 지금 같은 동작(페이지를 읽어 서버에 넘김)을 한다.
  // 서버가 가격을 포함해 저장하므로, 구분은 기록에 남기는 용도다.
  const isPriceWatch = PRICE_WORDS.test(text) && !COLLECT_WORDS.test(text);
  const kind = isPriceWatch ? "watch_price" : "scrape";

  return {
    ok: true,
    steps: urls.map((url) => ({
      kind,
      url,
      summary: `${isPriceWatch ? "가격 확인" : "상품 수집"} — ${shorten(url)}`,
    })),
  };
}

function shorten(url) {
  try {
    const u = new URL(url);
    const path = u.pathname.length > 30 ? `${u.pathname.slice(0, 30)}…` : u.pathname;
    return `${u.hostname}${path}`;
  } catch {
    return url.slice(0, 50);
  }
}

/** 사이트 이름을 호스트에서 뽑아낸다 (승인 대기함에 표시할 용도). */
function siteOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "unknown";
  }
}

module.exports = { planTask, siteOf };
