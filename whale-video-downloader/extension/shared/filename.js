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

// 게시물 원문 언어로 국적을 추정한다. (사이트가 국적 정보를 따로 주지 않음)
const FLAG = (cc) => String.fromCodePoint(...[...cc].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
const SITE_COUNTRY = { douyin: 'CN', kuaishou: 'CN', bilibili: 'CN', weibo: 'CN', xiaohongshu: 'CN', naver: 'KR' };
// 게시물 원문(본문) 언어로 나라를 정한다. 링크·@아이디·해시태그 기호는 빼고 본다.
//  1) 글자 체계: 한글 → 한국, 가나 → 일본, 한자만 → 중국(번체 많으면 대만), 태국·러시아·아랍·히브리·인도 계열 등
//  2) 로마자: 언어별 자주 쓰는 낱말 + 특수 글자로 언어를 고른다(영어 → 미국, 포르투갈어 → 브라질 …)
const SCRIPTS = [
  ['KR', /[가-힣ㄱ-ㆎ]/g],
  ['TH', /[฀-๿]/g],
  ['IL', /[֐-׿]/g],
  ['IN', /[ऀ-ॿ਀-੿઀-૿஀-௿ఀ-౿ಀ-೿ഀ-ൿ]/g],
  ['BD', /[ঀ-৿]/g],
  ['GR', /[Ͱ-Ͽ]/g],
  ['GE', /[Ⴀ-ჿ]/g],
  ['AM', /[԰-֏]/g],
  ['KH', /[ក-៿]/g],
  ['LA', /[຀-໿]/g],
  ['MM', /[က-႟]/g],
  ['LK', /[඀-෿]/g],
  ['ET', /[ሀ-፿]/g],
];
const CYRILLIC = /[Ѐ-ӿ]/g;
const ARABIC = /[؀-ۿݐ-ݿ]/g;
const HAN = /[一-鿿㐀-䶿]/g;
const KANA = /[぀-ヿ]/g;
// 번체에만 쓰는 흔한 글자(대만·홍콩)
const TRAD = /[們這說個來時會為國學過還對開關點頭見車電話體樣業務實際發長門問聽讀寫錢買賣樂愛藝灣臺氣園東書歡遊飯後館從讓網紅線現經種應該號飛風鳥魚馬鳳歲衛鐘陽陰無雙邊親]/g;
// 로마자 언어: [나라, 자주 쓰는 낱말, 특수 글자]
const LATIN = [
  ['US', 'the and is are you to of in it that this with for on was have my i me so just what not but be at your all we they he she', ''],
  ['BR', 'não que de e o a os as um uma é com para por mais muito eu você meu minha está são também mas isso aqui hoje obrigado tudo bem', 'ãõç'],
  ['ES', 'que de el la los las y en un una es con para por más muy yo tú mi está son también pero esto aquí hoy gracias todo bien hola', 'ñ¿¡'],
  ['FR', 'le la les et est des un une je tu il elle nous vous avec pour pas que qui dans sur ce cette mais très aujourd merci bonjour', 'àâçèéêëîïôûùœ'],
  ['DE', 'der die das und ist ich du nicht ein eine mit für auf auch sehr heute danke ja nein mein dein wir sie', 'äöüß'],
  ['IT', 'il la le di che e è un una per con non sono mi ti molto oggi grazie ciao anche questo questa del della', 'àèéìòù'],
  ['NL', 'de het een en is van ik je niet met op voor zijn dat dit ook maar heel vandaag bedankt hallo', 'ĳ'],
  ['TR', 've bir bu da de için ben sen çok ne var yok ile gibi ama daha bugün teşekkür merhaba', 'ğşıİçöü'],
  ['ID', 'yang dan di ini itu dengan untuk tidak ada aku saya kamu ke dari juga sudah akan bisa hari terima kasih', ''],
  ['PH', 'ang ng sa na mga ako ikaw ko mo siya ito iyan hindi po salamat ganda talaga', ''],
  ['VN', 'và của là có không một những cho với người này được tôi bạn rất hôm nay cảm ơn', 'ăâđêôơưạảấầẩẫậắằẳẵặẹẻẽếềểễệịỉọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ'],
  ['PL', 'i w nie na się z jest że to do jak ale mnie bardzo dziś dzięki cześć', 'ąćęłńóśźż'],
  ['CZ', 'a je v na se že to s jsem není ale jak velmi dnes děkuji ahoj', 'ěščřžýáíéůú'],
  ['SE', 'och att det är en som på jag du inte med för har så men mycket idag tack hej', 'åäö'],
  ['NO', 'og det er en som på jeg du ikke med for har så men veldig i dag takk hei', 'åæø'],
  ['DK', 'og det er en som på jeg du ikke med for har så men meget i dag tak hej', 'åæø'],
  ['FI', 'ja on ei se että minä sinä hän me te he tämä kiitos moi hyvä tänään', 'äö'],
  ['HU', 'és a az egy hogy nem van én te ez az is de nagyon ma köszönöm szia', 'őűáéíóöúü'],
  ['RO', 'și de la în cu pe nu este un o eu tu foarte azi mulțumesc bună', 'ăâîșț'],
  ['KE', 'na ya wa ni kwa la za katika hii huo mimi wewe sana leo asante habari', ''],
];
const LATIN_SETS = LATIN.map(([cc, words, chars]) => [cc, new Set(words.split(' ')), chars]);

export function countryCode(text, site) {
  const t = String(text || '').replace(/https?:\/\/\S+/g, ' ').replace(/@[\w.]+/g, ' ').replace(/[#＃]/g, ' ');
  const count = (re) => (t.match(re) || []).length;
  const kana = count(KANA);
  const hangul = count(SCRIPTS[0][1]);
  // 일본어는 한자가 많아도 히라가나·가타카나가 섞인다 → 가나가 한글 이상이면 일본
  if (kana > 0 && kana >= hangul) return 'JP';
  const scores = SCRIPTS.map(([cc, re]) => [cc, count(re)]);
  const cyr = count(CYRILLIC);
  // 우크라이나어 글자(і ї є ґ)가 있으면 우크라이나, 아니면 러시아
  scores.push([/[іїєґ]/i.test(t) ? 'UA' : 'RU', cyr]);
  const ar = count(ARABIC);
  // 페르시아어(پ چ ژ گ) → 이란, 우르두어(ٹ ڈ ڑ ں ے) → 파키스탄, 그 밖 → 사우디아라비아
  scores.push([/[ٹڈڑںے]/.test(t) ? 'PK' : /[پچژگ]/.test(t) ? 'IR' : 'SA', ar]);
  const han = count(HAN);
  scores.push([count(TRAD) >= Math.max(1, han * 0.1) ? 'TW' : 'CN', Math.ceil(han / 3)]);
  scores.sort((a, b) => b[1] - a[1]);
  if (scores[0][1] > 0) {
    // 한자만 있고 한국 사이트면 한국
    if ((scores[0][0] === 'CN' || scores[0][0] === 'TW') && SITE_COUNTRY[site] === 'KR') return 'KR';
    return scores[0][0];
  }
  // 로마자
  // 한 글자 낱말(a, e, o, y …)은 여러 언어에 겹쳐 판단에 쓰지 않는다
  const words = (t.toLowerCase().match(/[\p{L}']+/gu) || []).filter((w) => w.length >= 2).slice(0, 200);
  if (words.length) {
    const best = LATIN_SETS.map(([cc, set, chars]) => {
      let sc = 0;
      for (const w of words) if (set.has(w)) sc += 1;
      if (chars) for (const ch of t.toLowerCase()) if (chars.includes(ch)) sc += 0.6;
      return [cc, sc];
    }).sort((a, b) => b[1] - a[1]);
    if (best[0][1] > 0) return best[0][0];
    if (SITE_COUNTRY[site]) return SITE_COUNTRY[site];
    return /[a-z]{3,}/i.test(t) ? 'US' : '';
  }
  return SITE_COUNTRY[site] || '';
}

// 윈도우 탐색기는 국기 이모지를 그리지 못하고 'KR' 같은 글자로 보여 준다 → 기본은 한글 국가명
const COUNTRY_KO = {
  KR: '한국', JP: '일본', CN: '중국', TW: '대만', TH: '태국', RU: '러시아', UA: '우크라이나', SA: '사우디아라비아', IR: '이란', PK: '파키스탄',
  IL: '이스라엘', IN: '인도', BD: '방글라데시', GR: '그리스', GE: '조지아', AM: '아르메니아', KH: '캄보디아', LA: '라오스', MM: '미얀마', LK: '스리랑카', ET: '에티오피아',
  US: '미국', BR: '브라질', ES: '스페인', FR: '프랑스', DE: '독일', IT: '이탈리아', NL: '네덜란드', TR: '튀르키예', ID: '인도네시아', PH: '필리핀', VN: '베트남',
  PL: '폴란드', CZ: '체코', SE: '스웨덴', NO: '노르웨이', DK: '덴마크', FI: '핀란드', HU: '헝가리', RO: '루마니아', KE: '케냐',
};
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
    // 원문 본문이 있으면 그것으로만 판단(탭 제목·화면 글자·작성자 이름이 섞이면 틀림)
    const src = data.countryText || `${data.title || ''} ${data.author || ''}`;
    // data.flag: 'emoji' = 국기 이모지(맥·휴대폰), 그 밖(기본) = [한국] 같은 국가명(윈도우에서도 그대로 보임)
    if (data.flag === 'emoji') tag = countryFlag(src, data.site);
    else if (countryName(src, data.site)) tag = `[${countryName(src, data.site)}]`;
  }
  if (data.ai) tag += '[AI]';
  if (tag) name = `${tag} ${name}`;
  const e = String(ext || 'mp4').replace(/[^a-z0-9]/gi, '').toLowerCase() || 'mp4';
  return `${name}.${e}`;
}
