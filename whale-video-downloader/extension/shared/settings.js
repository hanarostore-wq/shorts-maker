// 설정 기본값과 읽기/쓰기 (서비스워커·팝업·폴더 선택 창에서 공용)
export const DEFAULT_SETTINGS = {
  subfolder: '', // 웨일 다운로드 폴더 안의 하위 폴더 (비우면 바로 저장)
  askEveryTime: false, // 다운로드마다 저장 위치 묻기
  imageButtons: true, // 사진에도 저장 버튼
  captionOnMedia: true, // 사진·영상 빈 공간에 피드 내용 요약 넣기(영상은 재인코딩)
  captionKeepOriginal: false, // 요약 넣을 때 원본도 함께 저장
  captionCover: false, // [재인코딩 없음] 영상 표지(썸네일)에 피드 스크린샷 + 설명 정보에 피드 내용 + 같은 이름 PNG
  captionIntro: false, // 영상 맨 앞에 피드 스크린샷 3초(재인코딩)
  autoFollow: true, // 다운로드 누르면 그 게시물 작성자 자동 팔로우(팔로우 기능이 있는 사이트)
  aiLabel: true, // AI 영상·사진 표시 + 파일 이름 [AI]
  downloadedMark: true, // 받은 적 있는 영상·사진 버튼 초록 표시
  xPhotoTapClose: true, // X 사진 확대 보기에서 사진 누르면 닫기
  noClickPause: true, // 모든 사이트: 영상 공간을 눌러도 재생이 멈추지 않게
  ytShortsStats: true, // 유튜브 쇼츠 오른쪽 위에 조회수·구독자 수
  adBlock: true, // 지원 사이트 광고 차단(피드 광고 숨김·유튜브 광고 건너뛰기·광고 서버 차단)
  xKeepControls: true, // X 재생바 항상 표시
  xThickBar: true, // X 진행 막대 두껍게
  xHighQuality: true, // X 재생 화질 항상 최고
  xFollowButtons: true, // X 피드 작성자 옆 팔로우/팔로잉 버튼
  xAutoSound: true, // X 영상 재생 시 소리 자동 켜기
  xHoverPlay: true, // X 영상: 마우스를 올리면 재생, 떠나면 멈춤
  bskyAutoSound: true, // 블루스카이 영상 재생 시 소리 자동 켜기
  bskyFollowButtons: true, // 블루스카이 피드 게시물에 팔로우/팔로잉 버튼
  xWideLayout: true, // X 오른쪽 사이드바 숨기고 가운데 피드 크게 // X 영상 재생 시 소리 자동 켜기
  sortFolders: true,
  countryFolders: true, // 그 안에 나라별 하위 폴더(한국/미국/중국…/기타) // 사진 / 영상 1분30초 이하 / 영상 1분30초 초과 폴더로 자동 분류
  flagPrefix: true,
  flagStyle: 'name', // 'name' = [한국] (윈도우 권장), 'emoji' = 🇰🇷 (윈도우 탐색기에선 KR 글자로 보임) // 파일 이름 맨 앞에 영상 국적 깃발 이모지
  filenameTemplate: '{title} [{site}-{id}]',
  quality: 'best', // 'best' = 원본 최고화질, 'compat' = 호환성(H.264) 우선
  showButtons: true,
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
