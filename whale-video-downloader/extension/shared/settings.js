// 설정 기본값과 읽기/쓰기 (서비스워커·팝업·폴더 선택 창에서 공용)
export const DEFAULT_SETTINGS = {
  subfolder: '', // 웨일 다운로드 폴더 안의 하위 폴더 (비우면 바로 저장)
  askEveryTime: false, // 다운로드마다 저장 위치 묻기
  imageButtons: true, // 사진에도 저장 버튼
  captionOnMedia: true, // 사진·영상 빈 공간에 피드 내용 요약 넣기(영상은 재인코딩)
  captionKeepOriginal: false,
  translateCaption: true, // 피드 글이 한국어가 아니면 한국어 번역을 캡처 아래에 붙임 // 요약 넣을 때 원본도 함께 저장
  captionCover: false, // [재인코딩 없음] 영상 표지(썸네일)에 피드 스크린샷 + 설명 정보에 피드 내용 + 같은 이름 PNG
  captionIntro: false, // 영상 맨 앞에 피드 스크린샷 3초(재인코딩)
  potPlayer: false, // 재생 버튼을 누르면 팟플레이어로 재생(업데이트 bat 이 연결을 등록해야 동작)
  noAutoplay: false, // 사이트가 스스로 영상을 트는 자동재생 막기(직접 누른 영상만 재생). X·블루스카이는 사이트별 기본값으로 켬
  siteSettings: {}, // 사이트별 기능 켜고 끄기 { x: { noAutoplay: true, … } } — 없으면 위의 전체 기본값
  captionAuthor: true, // 영상·사진 위 글자 첫 줄에 '작성자 이름 (@아이디) · 사이트'
  pauseOffscreen: true, // 재생 중인 영상이 스크롤로 화면에서 벗어나면 멈춤
  preventDuplicates: true, // 같은 파일 중복 다운로드 막기(파일이 지워졌으면 다시 받음)
  autoFollow: true, // 다운로드 누르면 그 게시물 작성자 자동 팔로우(팔로우 기능이 있는 사이트)
  aiLabel: true, // AI 영상·사진 표시 + 파일 이름 [AI]
  downloadedMark: true, // 받은 적 있는 영상·사진 버튼 초록 표시
  xPhotoTapClose: true, // X 사진 확대 보기에서 사진 누르면 닫기
  ytShortsStats: true, // 유튜브 쇼츠 오른쪽 위에 조회수·구독자 수
  xFollowButtons: true, // X 피드 작성자 옆 팔로우/팔로잉 버튼
  followAllButton: true, // 블루스카이·X 팔로우 목록 화면에 '이 목록 전부 팔로우' 버튼
  bskyFollowButtons: true, // 블루스카이 피드 게시물에 팔로우/팔로잉 버튼
  siteFolderMap: {}, // 사이트별 저장 폴더 이름(비우면 다운로드 폴더). 같은 이름이면 한 폴더로 합쳐짐
  siteFolders: false, // 가장 위에 사이트별 폴더(유튜브/블루스카이/X …)
  sortFolders: true,
  countryFolders: true, // 그 안에 나라별 하위 폴더(한국/미국/중국…/기타) // 사진 / 영상 1분30초 이하 / 영상 1분30초 초과 폴더로 자동 분류
  flagPrefix: true,
  flagStyle: 'name', // 'name' = [한국] (윈도우 권장), 'emoji' = 🇰🇷 (윈도우 탐색기에선 KR 글자로 보임) // 파일 이름 맨 앞에 영상 국적 깃발 이모지
  filenameTemplate: '{title} [{site}-{id}]',
  quality: 'best', // 'best' = 원본 최고화질, 'compat' = 호환성(H.264) 우선
  showButtons: true,
  alwaysShowButtons: true, // 사진·영상 저장 버튼을 마우스를 올리거나 재생하지 않아도 항상 표시
  buttonPosition: 'mid-right', // mid-right | bottom-right | bottom-center | bottom-left | top-right
  placements: {}, // 사이트별로 직접 배치한 영상 버튼 위치 { fx, fy } (영상 안 비율)
  imagePlacements: {}, // 사이트별로 직접 배치한 사진 버튼 위치
  genericButtons: true, // 지원 목록 밖 사이트에서도 버튼 표시
  disabledSites: [],
};

export async function getSettings() {
  const r = await chrome.storage.local.get('settings');
  const s = { ...DEFAULT_SETTINGS, ...(r.settings || {}) };
  // v1.0.0 의 "폴더 직접 선택" 방식은 없앴다(권한 재요청·시스템 폴더 오류 때문) → 웨일 다운로드 폴더로 통일
  if (s.saveMode || s.folderName !== undefined || s.v1Subfolder !== false) {
    if (s.subfolder === '영상 다운로드' && s.v1Subfolder !== false) s.subfolder = '';
    delete s.saveMode;
    delete s.folderName;
    s.v1Subfolder = false;
  }
  // v1.2.0: 하단 버튼이 제목 글자에 가려지는 문제로 기본 위치를 오른쪽 가운데로 변경
  if (s.posVersion !== 2) {
    if (!s.buttonPosition || s.buttonPosition === 'right') s.buttonPosition = 'mid-right';
    s.posVersion = 2;
  }
  // v1.25.0: 사이트별 폴더 나누기는 기본으로 끈다(사용자 요청). 한 번만 바꾸고 이후에는 사용자가 켠 값을 따른다.
  if (s.siteFolderV !== 2) {
    s.siteFolders = false;
    s.siteFolderV = 2;
  }
  // v1.25.0: 기능을 사이트마다 켜고 끌 수 있게 됨. X·블루스카이는 자동재생 끄기를 처음부터 켬
  if (s.siteSettingsV !== 1) {
    const ss = { ...(s.siteSettings || {}) };
    for (const id of ['x', 'bluesky']) ss[id] = { noAutoplay: true, ...(ss[id] || {}) };
    s.siteSettings = ss;
    s.siteSettingsV = 1;
  }
  // 삭제한 기능의 설정은 지운다(광고 차단, 마우스 올리면 재생, 소리 자동 켜기, 영상 정지 막기)
  for (const k of ['adBlock', 'hoverPlay', 'xHoverPlay', 'bskyAutoSound', 'xAutoSound', 'xAutoPlay', 'keepScroll', 'noClickPause', 'xWideLayout', 'xKeepControls', 'xThickBar', 'xHighQuality', 'playLock']) delete s[k];
  // 바뀐 기본값(마이그레이션)은 바로 저장해 둔다 — 페이지 쪽 스크립트는 저장된 값을 그대로 읽기 때문
  const stored = r.settings || {};
  if (stored.siteFolderV !== s.siteFolderV || stored.siteSettingsV !== s.siteSettingsV || stored.posVersion !== s.posVersion) {
    await chrome.storage.local.set({ settings: s }).catch(() => {});
  }
  return s;
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

// 사이트 하나에 실제로 적용되는 설정 = 전체 기본값 위에 그 사이트에서 따로 바꾼 값
export function effectiveSettings(s, site) {
  return { ...(s || {}), ...(((s || {}).siteSettings || {})[site] || {}) };
}

// 팝업 '이 사이트' 화면에 보이는 기능(사이트마다 켜고 끄기). sites 가 있으면 그 사이트에서만 보인다.
export const SITE_FEATURES = [
  { key: 'alwaysShowButtons', group: '버튼', name: '저장 버튼 항상 표시', desc: '마우스를 올리거나 재생하지 않아도 저장 버튼이 떠 있습니다' },
  { key: 'imageButtons', group: '버튼', name: '사진에도 저장 버튼', desc: '사진에도 원본 저장 버튼을 띄웁니다' },
  { key: 'downloadedMark', group: '버튼', name: '받은 적 있는 영상·사진 초록 표시', desc: '이미 받은 것은 버튼이 초록 체크로 바뀝니다' },
  { key: 'aiLabel', group: '버튼', name: 'AI 영상·사진 표시', desc: 'AI 생성으로 표시된 것에 표시를 붙이고 파일 이름에 [AI]' },
  { key: 'preventDuplicates', group: '저장', name: '같은 파일 중복 다운로드 막기', desc: '이미 받은 것은 다시 받지 않고 위치를 알려 줍니다' },
  { key: 'captionOnMedia', group: '글자 넣기', name: '영상·사진에 본문 글자 넣기', desc: '게시물 본문을 왼쪽 위에 넣습니다' },
  { key: 'captionAuthor', group: '글자 넣기', name: '글자 첫 줄에 작성자 줄', desc: "'작성자 이름 (@아이디) · 사이트'" },
  { key: 'translateCaption', group: '글자 넣기', name: '한국어가 아니면 번역해서 넣기', desc: '원문 대신 한국어 번역을 넣습니다' },
  { key: 'captionCover', group: '글자 넣기', name: '영상 표지에 피드 화면', desc: '영상 표지(썸네일)에 게시물 화면을 넣습니다' },
  { key: 'captionIntro', group: '글자 넣기', name: '영상 앞 3초에 피드 화면', desc: '영상 맨 앞에 게시물 화면을 3초 붙입니다' },
  { key: 'noAutoplay', group: '재생', name: '자동재생 끄기', desc: '사이트가 스스로 영상을 틀지 못하게 합니다. 직접 누른 영상만 재생 (바꾼 뒤 새로고침)' },
  { key: 'potPlayer', group: '재생', name: '재생 버튼 → 팟플레이어로 재생', desc: '재생을 누르면 웨일 대신 팟플레이어로 원본을 엽니다 (업데이트 bat 1회 실행 필요 · 바꾼 뒤 새로고침)' },
  { key: 'pauseOffscreen', group: '재생', name: '화면 밖 영상 정지', desc: '스크롤로 화면에서 벗어난 영상은 멈춥니다' },
  { key: 'autoFollow', group: '팔로우', name: '다운로드하면 작성자 자동 팔로우', desc: '저장 버튼을 누른 게시물의 작성자를 팔로우합니다', sites: ['x', 'bluesky', 'instagram', 'tiktok', 'youtube', 'threads', 'douyin', 'weibo', 'bilibili', 'xiaohongshu', 'pinterest', 'kuaishou', 'facebook', 'generic'] },
  { key: 'followAllButton', group: '팔로우', name: '팔로우 목록 전부 팔로우 버튼', desc: '팔로워·팔로잉 목록 화면에 버튼을 띄웁니다', sites: ['x', 'bluesky', 'instagram', 'threads', 'tiktok', 'douyin', 'weibo', 'bilibili', 'xiaohongshu', 'pinterest', 'kuaishou'] },
  { key: 'xFollowButtons', group: '팔로우', name: '피드 작성자 옆 팔로우 버튼', desc: '피드 게시물에 팔로우/팔로잉 상태 버튼', sites: ['x'] },
  { key: 'bskyFollowButtons', group: '팔로우', name: '피드 게시물 팔로우 버튼', desc: '피드 게시물에 팔로우/팔로잉 상태 버튼', sites: ['bluesky'] },
  { key: 'xPhotoTapClose', group: '보기', name: '사진 확대 보기에서 누르면 닫기', desc: '크게 본 사진을 누르면 닫힙니다', sites: ['x'] },
  { key: 'ytShortsStats', group: '보기', name: '쇼츠 조회수·구독자 표시', desc: '쇼츠 오른쪽 위에 조회수·구독자 수', sites: ['youtube'] },
];
