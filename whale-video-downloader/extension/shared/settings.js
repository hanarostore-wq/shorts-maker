// 설정 기본값과 읽기/쓰기 (서비스워커·팝업·폴더 선택 창에서 공용)
export const DEFAULT_SETTINGS = {
  saveMode: 'downloads', // 'downloads' = 브라우저 기본 다운로드 폴더(+하위 폴더), 'folder' = 직접 선택한 폴더
  subfolder: '영상 다운로드',
  askEveryTime: false, // 다운로드마다 저장 위치 묻기 (saveMode = downloads 일 때)
  folderName: '', // 직접 선택한 폴더 이름(표시용)
  filenameTemplate: '{title} [{site}-{id}]',
  quality: 'best', // 'best' = 원본 최고화질, 'compat' = 호환성(H.264) 우선
  showButtons: true,
  buttonPosition: 'right', // left | center | right
  genericButtons: true, // 지원 목록 밖 사이트에서도 버튼 표시
  disabledSites: [],
};

export async function getSettings() {
  const r = await chrome.storage.local.get('settings');
  return { ...DEFAULT_SETTINGS, ...(r.settings || {}) };
}

export async function saveSettings(patch) {
  const cur = await getSettings();
  const next = { ...cur, ...patch };
  await chrome.storage.local.set({ settings: next });
  return next;
}

export const SITE_LIST = [
  { id: 'youtube', name: '유튜브 · 쇼츠', color: '#FF0033' },
  { id: 'tiktok', name: '틱톡', color: '#25F4EE' },
  { id: 'instagram', name: '인스타그램', color: '#E1306C' },
  { id: 'facebook', name: '페이스북 릴스', color: '#1877F2' },
  { id: 'x', name: 'X (트위터)', color: '#A1A1AA' },
  { id: 'bluesky', name: '블루스카이', color: '#1185FE' },
  { id: 'xiaohongshu', name: '샤오홍슈', color: '#FF2442' },
  { id: 'douyin', name: '도우인', color: '#FE2C55' },
  { id: 'kuaishou', name: '콰이쇼우', color: '#FF7A00' },
  { id: 'bilibili', name: '빌리빌리', color: '#00AEEC' },
  { id: 'weibo', name: '웨이보', color: '#E6162D' },
  { id: 'snapchat', name: '스냅챗', color: '#FFFC00' },
  { id: 'pinterest', name: '핀터레스트', color: '#E60023' },
  { id: 'naver', name: '네이버 TV · 클립', color: '#03C75A' },
  { id: 'vimeo', name: '비메오', color: '#1AB7EA' },
  { id: 'dailymotion', name: '데일리모션', color: '#0066DC' },
  { id: 'generic', name: '그 밖의 사이트', color: '#8B5CF6' },
];
