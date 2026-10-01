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
  const e = String(ext || 'mp4').replace(/[^a-z0-9]/gi, '').toLowerCase() || 'mp4';
  return `${name}.${e}`;
}
