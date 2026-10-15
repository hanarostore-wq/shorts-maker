// '이 사이트 제외': 사이트(호스트 이름)를 정해 두면 그 사이트에서는 확장프로그램의 모든 기능을 끈다.
//  - 호스트 이름 그대로(앞의 www. 만 뺌). youtube.com 을 제외해도 m.youtube.com 은 따로 — 사이트를 정확히 정하게
//  - 서비스워커가 content/off.js 를 이 사이트에만 문서 시작 때 넣고, 그 표시를 본 다른 스크립트들이 아무것도 하지 않는다
export const siteKey = (host) => String(host || '').trim().toLowerCase().replace(/^www\./, '');

// 주소에서 제외 대상이 될 수 있는 호스트(웹 페이지가 아니면 빈 글자)
export function hostOfUrl(url) {
  try {
    const u = new URL(url);
    return /^https?:$/.test(u.protocol) ? u.hostname : '';
  } catch {
    return '';
  }
}

export const isExcluded = (list, host) => {
  const k = siteKey(host);
  return !!k && (list || []).some((x) => siteKey(x) === k);
};

// 크롬 콘텐츠 스크립트 matches 주소: 호스트 그대로와 www. 붙은 것
export const excludePatterns = (list) => [...new Set((list || []).map(siteKey).filter(Boolean))].flatMap((k) => [`*://${k}/*`, `*://www.${k}/*`]);
