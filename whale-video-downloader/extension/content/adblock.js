// 지원 사이트 광고 숨기기 (ISOLATED world). 팝업 → 저장 설정 → '광고 차단'으로 켜고 끈다.
//  - 피드: '광고 / Sponsored / Promoted / 广告' 표시가 붙은 게시물을 숨김
//  - 유튜브: 광고 칸 숨김, 영상 광고는 건너뛰기
//  - 공통: 일반 광고 슬롯(애드센스·GPT) 숨김
// 광고 서버 요청 차단은 서비스워커의 declarativeNetRequest 규칙이 맡는다.
(() => {
  'use strict';
  if (globalThis.__SMD_ADBLOCK || !chrome?.runtime?.id) return;
  globalThis.__SMD_ADBLOCK = true;
  const host = location.hostname;
  let on = true;

  // 광고 표시로 쓰이는 짧은 라벨(이 글자 '하나만' 들어 있는 작은 요소를 찾는다 → 본문 오인 방지)
  const AD_LABELS = new Set(['광고', '프로모션', '스폰서', '스폰서 광고', 'Ad', 'Ads', 'Sponsored', 'Promoted', 'Promoted by', 'Paid partnership', '广告', '推广', '赞助', '廣告', '贊助', 'Реклама', 'Gesponsert', 'Sponsorisé', 'Patrocinado', 'Annonce', '広告', 'プロモーション']);

  // 사이트별: 숨길 CSS 선택자, 광고 라벨을 찾을 피드 아이템 단위
  const SITES = [
    { re: /(^|\.)youtube\.com$/, css: ['ytd-ad-slot-renderer', 'ytd-in-feed-ad-layout-renderer', 'ytd-promoted-sparkles-web-renderer', 'ytd-promoted-video-renderer', 'ytd-display-ad-renderer', 'ytd-banner-promo-renderer', 'ytd-statement-banner-renderer', 'ytd-companion-slot-renderer', 'ytd-action-companion-ad-renderer', 'ytd-player-legacy-desktop-watch-ads-renderer', '#player-ads', '#masthead-ad', '.ytp-ad-overlay-container', '.ytp-ad-image-overlay', 'ytd-rich-item-renderer:has(ytd-ad-slot-renderer)', 'ytd-rich-section-renderer:has(ytd-statement-banner-renderer)', 'ytd-reel-video-renderer:has(ytd-ad-slot-renderer)', 'ytd-search-pyv-renderer'], items: [] },
    { re: /(^|\.)(x|twitter)\.com$/, css: [], items: ['[data-testid="cellInnerDiv"]'], extra: (cell) => cell.querySelector('[data-testid="placementTracking"]') && cell.querySelector('article') },
    { re: /(^|\.)instagram\.com$/, css: [], items: ['article'] },
    { re: /(^|\.)facebook\.com$/, css: ['[data-pagelet*="RightRail"] [data-pagelet*="Ads"]'], items: ['[role="article"]', 'div[data-pagelet^="FeedUnit"]'], extra: (el) => el.querySelector('a[href*="/ads/about"], a[href*="ads/about/"]') },
    { re: /(^|\.)tiktok\.com$/, css: [], items: ['[data-e2e="recommend-list-item-container"]', 'article'], extra: (el) => el.querySelector('[data-e2e*="ad-tag"], [data-e2e*="ad-label"]') },
    { re: /(^|\.)pinterest\./, css: [], items: ['[data-test-id="pin"]', '[data-grid-item="true"]', '[role="listitem"]'] },
    { re: /(^|\.)bilibili\.com$/, css: ['.ad-report', '.video-card-ad-small', '.slide-ad-exp', '#slide_ad', '.activity-m-v1', '.bili-video-card__info--ad'], items: ['.bili-video-card', '.feed-card', '.video-page-card-small'] },
    { re: /(^|\.)weibo\.(com|cn)$/, css: [], items: ['article', '.wbpro-scroller-item', '.vue-recycle-scroller__item-view'] },
    { re: /(^|\.)xiaohongshu\.com$/, css: [], items: ['section.note-item'] },
    { re: /(^|\.)douyin\.com$/, css: [], items: ['[data-e2e="feed-item"]', 'li'] },
    { re: /(^|\.)kuaishou\.com$/, css: [], items: ['.video-card', '.feed-item'] },
    { re: /(^|\.)naver\.com$/, css: ['.ad_area', '.sp_ad', '[class*="ad_section"]', 'iframe[src*="veta.naver.com"]', 'div[id^="veta_"]'], items: [] },
    { re: /(^|\.)dailymotion\.com$/, css: ['[class*="AdBanner"]', '[data-testid*="ad-"]'], items: [] },
    { re: /(^|\.)vimeo\.com$/, css: [], items: [] },
    { re: /(^|\.)bsky\.app$/, css: [], items: [] },
    { re: /(^|\.)snapchat\.com$/, css: [], items: [] },
  ];
  const site = SITES.find((s) => s.re.test(host));
  if (!site) return;
  const COMMON_CSS = ['ins.adsbygoogle', 'iframe[src*="doubleclick.net"]', 'iframe[src*="googlesyndication.com"]', 'div[id^="google_ads_iframe"]', 'div[id^="div-gpt-ad"]', '[id^="taboola-"]', '.OUTBRAIN'];

  let style = null;
  function applyCss() {
    if (on && !style) {
      style = document.createElement('style');
      style.id = 'smd-adblock';
      style.textContent = `${[...site.css, ...COMMON_CSS].join(',\n')}{display:none !important}\n[data-smd-ad]{display:none !important}`;
      (document.head || document.documentElement).appendChild(style);
    } else if (!on && style) {
      style.remove();
      style = null;
      for (const el of document.querySelectorAll('[data-smd-ad]')) el.removeAttribute('data-smd-ad');
    }
  }

  function hasAdLabel(item) {
    for (const el of item.querySelectorAll('span, div, a, p')) {
      if (el.childElementCount > 1) continue;
      const t = (el.textContent || '').trim();
      if (t.length <= 20 && AD_LABELS.has(t)) return true;
    }
    return false;
  }

  function hideFeedAds() {
    if (!on || !site.items.length) return;
    for (const sel of site.items) {
      for (const item of document.querySelectorAll(`${sel}:not([data-smd-checked])`)) {
        // 게시물이 다 그려진 뒤 판단하도록, 내용이 있는 것만 표시
        if (!item.textContent || item.textContent.length < 2) continue;
        item.dataset.smdChecked = '1';
        if ((site.extra && site.extra(item)) || hasAdLabel(item)) item.setAttribute('data-smd-ad', '1');
      }
    }
  }

  // 유튜브 영상 광고 건너뛰기
  let mutedByUs = false;
  function skipYouTubeAds() {
    if (!on || !/(^|\.)youtube\.com$/.test(host)) return;
    const player = document.querySelector('.html5-video-player');
    const skip = document.querySelector('.ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-skip-ad-button, button[class*="skip-ad"]');
    if (skip) skip.click();
    const v = player?.querySelector('video');
    if (player?.classList.contains('ad-showing') && v) {
      if (!v.muted) {
        v.muted = true;
        mutedByUs = true;
      }
      if (Number.isFinite(v.duration) && v.duration > 0 && v.currentTime < v.duration - 0.2) v.currentTime = v.duration - 0.1;
    } else if (mutedByUs && v) {
      v.muted = false;
      mutedByUs = false;
    }
    document.querySelector('.ytp-ad-overlay-close-button')?.click();
  }

  chrome.storage.local.get('settings').then((r) => {
    on = r.settings?.adBlock !== false;
    applyCss();
    hideFeedAds();
  }, () => {});
  chrome.storage.onChanged.addListener((c, area) => {
    if (area !== 'local' || !c.settings) return;
    on = c.settings.newValue?.adBlock !== false;
    applyCss();
    if (on) {
      for (const el of document.querySelectorAll('[data-smd-checked]')) el.removeAttribute('data-smd-checked');
      hideFeedAds();
    }
  });

  let pending = 0;
  new MutationObserver(() => {
    if (pending) return;
    pending = setTimeout(() => {
      pending = 0;
      if (style && !style.isConnected) (document.head || document.documentElement).appendChild(style);
      hideFeedAds();
    }, 250);
  }).observe(document.documentElement, { childList: true, subtree: true });
  setInterval(() => {
    hideFeedAds();
    skipYouTubeAds();
  }, 500);
})();
