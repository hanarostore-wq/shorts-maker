// 글만 있는 피드 숨기기: SNS 피드에서 사진·영상이 없는 게시물을 가린다(사이트마다 켜고 끄기, hideTextPosts)
//  - 대상: X·블루스카이·스레드·페이스북·웨이보 피드 게시물, 유튜브 커뮤니티 게시물
//  - 게시물 하나를 여는 화면(상세·답글)은 그대로 둔다
//  - 사진이 늦게 뜨는 경우가 있어 게시물이 화면에 생기고 1.2초 지난 뒤에 판단하고, 나중에 사진·영상이 생기면 다시 보인다
(() => {
  'use strict';
  if (globalThis.__SMD_TEXTFILTER || window.top !== window || !globalThis.__SMD_SITES) return;
  globalThis.__SMD_TEXTFILTER = true;
  const site = globalThis.__SMD_SITE_ID || globalThis.__SMD_SITES.pick(location.hostname).id;
  const H = location.hostname;
  // 사이트별: 게시물 묶음, 가릴 칸, 상세 화면 주소
  const RULES = {
    x: { item: 'article[data-testid="tweet"]', hide: (a) => a.closest('[data-testid="cellInnerDiv"]') || a, detail: /\/status\/\d+/ },
    bluesky: { item: '[data-testid^="feedItem-by-"]', hide: (a) => a, detail: /\/post\// },
    facebook: { item: '[role="article"]', hide: (a) => a, detail: /\/(posts|permalink|photo|videos|watch|reel)\b/, skip: (a) => !!a.parentElement?.closest('[role="article"]') || /댓글|comment|답글|reply/i.test(a.getAttribute('aria-label') || '') },
    weibo: { item: 'article', hide: (a) => a, detail: /\/\d+\/\w{8,}|\/detail\// },
    youtube: { item: 'ytd-backstage-post-thread-renderer, ytd-post-renderer', hide: (a) => a, detail: /\/post\// },
  };
  const threads = /(^|\.)threads\.(net|com)$/.test(H);
  if (threads) RULES.threads = { item: 'div[data-pressable-container="true"]', hide: (a) => a, detail: /\/post\// };
  const rule = RULES[threads ? 'threads' : site];
  if (!rule) return;
  const sid = threads ? 'threads' : site;

  const effOf = (s, id) => ({ ...(s || {}), ...(((s || {}).siteSettings || {})[id] || {}) });
  let on = false;
  const MARK = 'data-smd-textonly';
  const style = document.createElement('style');
  style.textContent = `[${MARK}]{display:none!important}`;
  (document.head || document.documentElement).appendChild(style);
  const showAll = () => document.querySelectorAll(`[${MARK}]`).forEach((el) => el.removeAttribute(MARK));
  const apply = (s) => {
    on = effOf(s, sid).hideTextPosts !== false;
    if (!on) showAll();
    else scan();
  };
  chrome.storage.local.get('settings').then((r) => apply(r.settings), () => {});
  chrome.storage.onChanged.addListener((c, area) => area === 'local' && c.settings && apply(c.settings.newValue));

  // 사진·영상이 있는가: 영상, 사이트의 사진·영상 칸, 또는 프로필 사진·이모지보다 큰 그림
  const MEDIA_SEL = 'video, [data-testid="tweetPhoto"], [data-testid="videoPlayer"], [data-testid="videoComponent"], [data-testid="card.layoutLarge.media"], [data-testid="playButton"], img[src*="/img/feed_"], img[src*="feed_thumbnail"], img[src*="feed_fullsize"]';
  function hasMedia(item) {
    if (item.querySelector(MEDIA_SEL)) return true;
    for (const img of item.querySelectorAll('img')) {
      const src = img.currentSrc || img.src || '';
      if (/avatar|profile_images|emoji|\/hashflags\//i.test(src)) continue;
      // 가려진 게시물 안의 그림은 화면 크기가 0 이므로 원본 크기로 본다
      const r = img.getBoundingClientRect();
      const w = r.width || img.naturalWidth || 0;
      const h = r.height || img.naturalHeight || 0;
      if (w >= 100 && h >= 80) return true;
    }
    // 배경 그림으로 그린 사진(일부 사이트)
    for (const el of item.querySelectorAll('[style*="background-image"]')) {
      const r = el.getBoundingClientRect();
      if (r.width >= 120 && r.height >= 90 && !/avatar|profile/i.test(el.getAttribute('style') || '')) return true;
    }
    return false;
  }
  const seen = new WeakMap(); // 게시물 → 처음 본 시각
  function scan() {
    if (!on || document.hidden) return;
    if (rule.detail.test(location.pathname)) return showAll();
    const now = performance.now();
    for (const item of document.querySelectorAll(rule.item)) {
      if (rule.skip?.(item)) continue;
      const box = rule.hide(item);
      if (!box) continue;
      if (!seen.has(item)) seen.set(item, now);
      if (hasMedia(item)) {
        if (box.hasAttribute(MARK)) box.removeAttribute(MARK);
        continue;
      }
      // 사진이 아직 안 그려졌을 수 있어 조금 기다린 뒤에 가린다
      if (now - seen.get(item) >= 1200 && !box.hasAttribute(MARK)) box.setAttribute(MARK, '');
    }
  }
  const run = () => {
    const P = globalThis.__SMD_PERF;
    if (P?.navigating()) return;
    P ? P.time('글만 있는 피드 숨기기', scan) : scan();
  };
  setInterval(run, 700);
  addEventListener('popstate', () => setTimeout(run, 300));
})();
