// 페이지 안에서 실행되는 수집 스크립트.
//
// 확장프로그램(extension/popup.js)의 captureFrame과 같은 일을 한다. 사이트별
// 파싱 규칙은 여기 두지 않고 서버(src/lib/siteProfiles.ts)가 담당한다 —
// 규칙을 고칠 때 데스크톱 앱을 다시 배포하지 않아도 되도록.
//
// executeJavaScript로 프레임마다 문자열째 주입되므로, 바깥 스코프의 어떤
// 것도 참조할 수 없는 자체 완결형이어야 한다.
const CAPTURE_SOURCE = `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // 스크롤해야 불러와지는(lazy-load) 사진을 실제로 다 불러오게 만든다.
  const startY = window.scrollY;
  let lastHeight = -1;
  for (let i = 0; i < 30; i++) {
    window.scrollTo(0, document.documentElement.scrollHeight);
    await sleep(300);
    const height = document.documentElement.scrollHeight;
    if (height === lastHeight) break;
    lastHeight = height;
  }
  await sleep(400);
  window.scrollTo(0, startY);

  // img.currentSrc는 브라우저가 실제로 불러온 주소라서, lazy-load 때문에
  // HTML의 src가 빈 값/임시 이미지여도 정확한 주소를 얻을 수 있다.
  const renderedImages = [];
  for (const img of document.images) {
    const src = img.currentSrc || img.src;
    if (!src || src.startsWith("data:")) continue;
    const rect = img.getBoundingClientRect();
    const width = img.naturalWidth || rect.width;
    const height = img.naturalHeight || rect.height;
    if (width < 200 && height < 200) continue;

    const areaNames = [];
    let node = img.parentElement;
    for (let depth = 0; depth < 8 && node; depth++) {
      const name = ((node.className || "") + " " + (node.id || "")).trim();
      if (name) areaNames.push(name.slice(0, 120));
      node = node.parentElement;
    }

    renderedImages.push({
      src,
      width: Math.round(width),
      height: Math.round(height),
      alt: (img.alt || "").slice(0, 200),
      areaNames,
    });
    if (renderedImages.length >= 300) break;
  }

  // 분석에 필요 없는 부분은 빼서 용량을 줄인다.
  const clone = document.documentElement.cloneNode(true);
  clone
    .querySelectorAll("script, style, noscript, link[rel='stylesheet'], svg")
    .forEach((el) => el.remove());

  const MAX_HTML = 400000;
  let html = clone.outerHTML;
  if (html.length > MAX_HTML) html = html.slice(0, MAX_HTML);

  return {
    url: location.href,
    isTopFrame: window.top === window.self,
    html,
    renderedImages,
  };
})()`;

module.exports = { CAPTURE_SOURCE };
