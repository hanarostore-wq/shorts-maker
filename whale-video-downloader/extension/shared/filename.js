// 파일 이름 만들기: 윈도우에서 쓸 수 없는 문자 제거, 길이 제한, 예약어 회피
const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)$/i;

export function sanitizePart(s, max = 120) {
  let t = String(s ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/[<>:"/\\|?*‮​]/g, ' ')
    .replace(/[#%]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[.\s]+|[.\s]+$/g, '');
  if ([...t].length > max) t = [...t].slice(0, max).join('').trim();
  if (RESERVED.test(t)) t = `_${t}`;
  return t;
}

export function sanitizeFolder(path) {
  return String(path || '')
    .split(/[\\/]+/)
    .map((p) => sanitizePart(p, 60))
    .filter((p) => p && p !== '..' && p !== '.')
    .slice(0, 4)
    .join('/');
}

const pad = (n) => String(n).padStart(2, '0');

// 제목·작성자 글자로 영상 국적을 추정해 국기 이모지를 고른다. (사이트가 국적 정보를 따로 주지 않음)
const FLAG = (cc) => String.fromCodePoint(...[...cc].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
const SITE_COUNTRY = { douyin: 'CN', kuaishou: 'CN', bilibili: 'CN', weibo: 'CN', xiaohongshu: 'CN', naver: 'KR' };
export function countryCode(text, site) {
  const t = String(text || '');
  const count = (re) => (t.match(re) || []).length;
  const scores = [
    ['KR', count(/[\uac00-\ud7a3\u3131-\u318e]/g) * 3],
    ['JP', count(/[\u3040-\u30ff]/g) * 3],
    ['TH', count(/[\u0e00-\u0e7f]/g) * 3],
    ['RU', count(/[\u0400-\u04ff]/g) * 2],
    ['SA', count(/[\u0600-\u06ff]/g) * 2],
    ['IN', count(/[\u0900-\u097f]/g) * 2],
    ['VN', count(/[ăâđêôơưạảấầẩẫậắằẳẵặẹẻẽếềểễệịỉọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/gi) * 3],
    ['CN', count(/[\u4e00-\u9fff]/g)],
  ].sort((a, b) => b[1] - a[1]);
  if (scores[0][1] > 0) {
    // 한자만 있고 사이트가 한국/일본 계열이 아니면 중국
    return scores[0][0] === 'CN' && SITE_COUNTRY[site] === 'KR' ? 'KR' : scores[0][0];
  }
  if (SITE_COUNTRY[site]) return SITE_COUNTRY[site];
  if (/[a-z]{3,}/i.test(t)) {
    if (/[ñ¿¡]/i.test(t)) return 'ES';
    if (/[ãõ]/i.test(t)) return 'BR';
    if (/[äöüß]/i.test(t)) return 'DE';
    if (/[àâçèéêëîïôûù]/i.test(t)) return 'FR';
    return 'US';
  }
  return '';
}

// 윈도우 탐색기는 국기 이모지를 그리지 못하고 'KR' 같은 글자로 보여 준다 → 기본은 한글 국가명
const COUNTRY_KO = { KR: '한국', JP: '일본', CN: '중국', TH: '태국', RU: '러시아', SA: '아랍', IN: '인도', VN: '베트남', ES: '스페인', BR: '브라질', DE: '독일', FR: '프랑스', US: '미국' };
export const countryFlag = (text, site) => {
  const c = countryCode(text, site);
  return c ? FLAG(c) : '';
};
export const countryName = (text, site) => COUNTRY_KO[countryCode(text, site)] || '';
// 나라별 하위 폴더 이름(판단이 안 되면 '기타')
export const countryFolder = (text, site) => countryName(text, site) || '기타';

export function buildFilename(template, data, ext = 'mp4') {
  const d = new Date();
  const date = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  const title = sanitizePart(data.title, 90) || `${data.siteName || data.site || '영상'} 영상`;
  const map = {
    title,
    site: data.site || 'video',
    siteName: data.siteName || data.site || '',
    id: sanitizePart(data.id, 40) || date,
    author: sanitizePart(data.author, 40),
    quality: data.quality || '',
    date,
  };
  let name = String(template || '{title} [{site}-{id}]').replace(/\{(\w+)\}/g, (_, k) => map[k] ?? '');
  name = name
    .replace(/\[\s*-\s*\]|\[\s*\]|\(\s*\)/g, '')
    .replace(/_{2,}/g, '_')
    .replace(/\s+/g, ' ')
    .replace(/^[\s\-_]+|[\s\-_]+$/g, '');
  name = sanitizePart(name, 150) || title;
  let tag = '';
  if (data.flag !== false) {
    const src = `${data.title || ''} ${data.author || ''}`;
    // data.flag: 'emoji' = 국기 이모지(맥·휴대폰), 그 밖(기본) = [한국] 같은 국가명(윈도우에서도 그대로 보임)
    if (data.flag === 'emoji') tag = countryFlag(src, data.site);
    else if (countryName(src, data.site)) tag = `[${countryName(src, data.site)}]`;
  }
  if (data.ai) tag += '[AI]';
  if (tag) name = `${tag} ${name}`;
  const e = String(ext || 'mp4').replace(/[^a-z0-9]/gi, '').toLowerCase() || 'mp4';
  return `${name}.${e}`;
}
