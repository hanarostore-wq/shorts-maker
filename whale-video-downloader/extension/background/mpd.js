// 작은 DASH(MPD) 파서. 서비스워커에는 DOMParser 가 없어서 정규식으로 필요한 부분만 읽는다.
// 지원: Representation 의 BaseURL(전체 파일), SegmentTemplate($Number$/$Time$, SegmentTimeline), SegmentList.

const decodeXml = (s) =>
  String(s)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&');

export function attrs(tag) {
  const out = {};
  for (const m of String(tag).matchAll(/([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) {
    out[m[1]] = decodeXml(m[3] ?? m[4] ?? '');
  }
  return out;
}

export function isoDuration(s) {
  const m = /^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(String(s || '').trim());
  if (!m) return 0;
  return (Number(m[1] || 0) * 86400) + (Number(m[2] || 0) * 3600) + (Number(m[3] || 0) * 60) + Number(m[4] || 0);
}

const resolveUrl = (u, base) => {
  try {
    return new URL(u, base || undefined).href;
  } catch {
    return u;
  }
};

function firstBaseUrl(xml) {
  const m = /<BaseURL[^>]*>([\s\S]*?)<\/BaseURL>/.exec(xml);
  return m ? decodeXml(m[1].trim()) : '';
}

// 자식 요소를 제외한 "자기 영역" 텍스트에서 BaseURL 을 찾기 위해 하위 블록을 지운다.
function stripBlocks(xml, tag) {
  return xml.replace(new RegExp(`<${tag}\\b[\\s\\S]*?<\\/${tag}>`, 'g'), '');
}

function fillTemplate(t, rep, vars) {
  return t.replace(/\$(RepresentationID|Number|Time|Bandwidth)(?:%0(\d+)d)?\$/g, (_, name, pad) => {
    const v = name === 'RepresentationID' ? rep.id : name === 'Bandwidth' ? rep.bandwidth : vars[name];
    const s = String(v ?? '');
    return pad ? s.padStart(Number(pad), '0') : s;
  }).replace(/\$\$/g, '$');
}

function expandTemplate(tplAttrs, timelineXml, rep, base, periodDuration) {
  const timescale = Number(tplAttrs.timescale || 1);
  const startNumber = Number(tplAttrs.startNumber ?? 1);
  const init = tplAttrs.initialization ? resolveUrl(fillTemplate(tplAttrs.initialization, rep, {}), base) : '';
  const media = tplAttrs.media || '';
  const segments = [];
  if (timelineXml) {
    let t = 0;
    let n = startNumber;
    for (const s of timelineXml.matchAll(/<S\b([^>]*)\/?>/g)) {
      const a = attrs(s[1]);
      if (a.t != null) t = Number(a.t);
      const d = Number(a.d);
      let r = Number(a.r || 0);
      if (r < 0) r = periodDuration ? Math.ceil((periodDuration * timescale - t) / d) - 1 : 0;
      for (let i = 0; i <= r; i++) {
        segments.push(resolveUrl(fillTemplate(media, rep, { Number: n, Time: t }), base));
        t += d;
        n++;
      }
    }
  } else if (tplAttrs.duration) {
    const segDur = Number(tplAttrs.duration) / timescale;
    const count = periodDuration && segDur ? Math.ceil(periodDuration / segDur) : 0;
    for (let i = 0; i < count; i++) segments.push(resolveUrl(fillTemplate(media, rep, { Number: startNumber + i, Time: '' }), base));
  }
  return { init, segments };
}

export function parseMpd(xml, baseUrl = '') {
  const text = String(xml || '');
  const mpdTag = /<MPD\b([^>]*)>/.exec(text);
  const mpdAttrs = mpdTag ? attrs(mpdTag[1]) : {};
  const totalDuration = isoDuration(mpdAttrs.mediaPresentationDuration);
  const mpdBase = resolveUrl(firstBaseUrl(stripBlocks(text, 'Period')) || '', baseUrl) || baseUrl;
  const out = { video: [], audio: [], muxed: [], duration: totalDuration };

  const periods = [...text.matchAll(/<Period\b([^>]*)>([\s\S]*?)<\/Period>/g)];
  const periodList = periods.length ? periods : [[text, '', text]];
  for (const p of periodList.slice(0, 1)) {
    const pAttrs = attrs(p[1] || '');
    const pBody = p[2];
    const pDuration = isoDuration(pAttrs.duration) || totalDuration;
    const pBase = resolveUrl(firstBaseUrl(stripBlocks(pBody, 'AdaptationSet')) || '', mpdBase) || mpdBase;
    for (const as of pBody.matchAll(/<AdaptationSet\b([^>]*)>([\s\S]*?)<\/AdaptationSet>/g)) {
      const aAttrs = attrs(as[1]);
      const aBody = as[2];
      const aBase = resolveUrl(firstBaseUrl(stripBlocks(aBody, 'Representation')) || '', pBase) || pBase;
      const setTpl = /<SegmentTemplate\b([^>]*?)(\/>|>([\s\S]*?)<\/SegmentTemplate>)/.exec(stripBlocks(aBody, 'Representation'));
      for (const r of aBody.matchAll(/<Representation\b([^>]*?)(?:\/>|>([\s\S]*?)<\/Representation>)/g)) {
        const rAttrs = { ...aAttrs, ...attrs(r[1]) };
        const rBody = r[2] || '';
        const mime = rAttrs.mimeType || '';
        const ctype = rAttrs.contentType || mime.split('/')[0] || '';
        const codecs = rAttrs.codecs || '';
        const rep = {
          id: rAttrs.id || '',
          mime,
          codecs,
          bandwidth: Number(rAttrs.bandwidth) || 0,
          width: Number(rAttrs.width) || 0,
          height: Number(rAttrs.height) || 0,
          frameRate: rAttrs.frameRate || '',
          label: rAttrs.FBQualityLabel || rAttrs.label || '',
        };
        const own = firstBaseUrl(rBody);
        const base = own ? resolveUrl(own, aBase) : aBase;
        const tpl = /<SegmentTemplate\b([^>]*?)(\/>|>([\s\S]*?)<\/SegmentTemplate>)/.exec(rBody) || setTpl;
        const list = /<SegmentList\b[^>]*>([\s\S]*?)<\/SegmentList>/.exec(rBody);
        if (tpl) {
          const tplAttrs = attrs(tpl[1]);
          const timeline = /<SegmentTimeline>([\s\S]*?)<\/SegmentTimeline>/.exec(tpl[3] || '')?.[1] || '';
          const { init, segments } = expandTemplate(tplAttrs, timeline, rep, base, pDuration);
          if (!segments.length) continue;
          rep.init = init;
          rep.segments = segments;
        } else if (list) {
          const initM = /<Initialization\b([^>]*)\/?>/.exec(list[1]);
          rep.init = initM && attrs(initM[1]).sourceURL ? resolveUrl(attrs(initM[1]).sourceURL, base) : '';
          rep.segments = [...list[1].matchAll(/<SegmentURL\b([^>]*)\/?>/g)].map((m) => resolveUrl(attrs(m[1]).media, base));
          if (!rep.segments.length) continue;
        } else if (own) {
          rep.url = base;
        } else {
          continue;
        }
        const isVideo = ctype === 'video' || /^video\//.test(mime) || rep.width > 0;
        const isAudio = ctype === 'audio' || /^audio\//.test(mime);
        const hasAudioCodec = /mp4a|opus|ac-3|ec-3|vorbis/.test(codecs);
        const hasVideoCodec = /avc|hev|hvc|vp0?9|av01/.test(codecs);
        if (isVideo && hasAudioCodec && hasVideoCodec) out.muxed.push(rep);
        else if (isVideo) out.video.push(rep);
        else if (isAudio) out.audio.push(rep);
      }
    }
  }
  return out;
}
