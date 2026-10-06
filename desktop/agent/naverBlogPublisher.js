const writeUrl = (blogId) => `https://blog.naver.com/${encodeURIComponent(blogId)}/postwrite`;
function isExpectedBlog(url, blogId) {
  try {
    const u = new URL(url);
    if (u.hostname !== "blog.naver.com") return false;
    return u.pathname.split("/")[1]?.toLowerCase() === blogId.toLowerCase() || u.searchParams.get("blogId")?.toLowerCase() === blogId.toLowerCase();
  } catch { return false; }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function extract(instruction, key) {
  const line = String(instruction || "").split("\n").find((x) => x.startsWith(key + ":"));
  return line ? line.slice(key.length + 1).trim() : "";
}
function extractBody(instruction) {
  const text = String(instruction || "");
  const a = text.indexOf("BODY_START\n");
  const b = text.indexOf("\nBODY_END");
  return a >= 0 && b > a ? text.slice(a + 11, b) : "";
}

async function fillEditor(view, title, body) {
  const wc = view.webContents;
  const script = `(() => {
    const visible = (el) => !!(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length));
    const all = [...document.querySelectorAll('[contenteditable="true"], textarea, input')].filter(visible);
    const titleEl = document.querySelector('.se-documentTitle [contenteditable="true"], .se-title-text [contenteditable="true"], [placeholder*="제목"]') || all[0];
    const bodyCandidates = [...document.querySelectorAll('.se-main-container [contenteditable="true"], .se-component-content [contenteditable="true"], [contenteditable="true"]')].filter(visible);
    const bodyEl = bodyCandidates.find((el) => el !== titleEl) || bodyCandidates[0];
    if (!titleEl || !bodyEl) {
      return {ok:false, reason:'SmartEditor 제목/본문 입력 영역을 찾지 못했습니다.', url:location.href};
    }
    const setText = (el, value) => {
      el.focus();
      if ('value' in el) {
        el.value = value;
        el.dispatchEvent(new Event('input', {bubbles:true}));
        el.dispatchEvent(new Event('change', {bubbles:true}));
      } else {
        const sel = window.getSelection(); const range = document.createRange();
        range.selectNodeContents(el); sel.removeAllRanges(); sel.addRange(range);
        document.execCommand('insertText', false, value);
        el.dispatchEvent(new InputEvent('input', {bubbles:true, inputType:'insertText', data:value}));
      }
    };
    setText(titleEl, ${JSON.stringify(title)});
    setText(bodyEl, ${JSON.stringify(body)});
    return {ok:true, titleText:(titleEl.innerText||titleEl.value||'').trim(), bodyText:(bodyEl.innerText||bodyEl.value||'').trim(), url:location.href};
  })()`;
  return wc.mainFrame.executeJavaScript(script, true);
}

async function clickPublish(view) {
  const wc = view.webContents;
  const first = await wc.mainFrame.executeJavaScript(`(() => {
    const visible=(el)=>!!(el&&(el.offsetWidth||el.offsetHeight||el.getClientRects().length));
    const buttons=[...document.querySelectorAll('button')].filter(visible);
    const b=buttons.find(x => (x.innerText||'').trim()==='발행' || (x.getAttribute('aria-label')||'').includes('발행'));
    if(!b) return {ok:false,reason:'발행 버튼을 찾지 못했습니다.'};
    b.click(); return {ok:true};
  })()`, true);
  if (!first.ok) return first;
  await sleep(1200);
  return wc.mainFrame.executeJavaScript(`(() => {
    const visible=(el)=>!!(el&&(el.offsetWidth||el.offsetHeight||el.getClientRects().length));
    const buttons=[...document.querySelectorAll('button')].filter(visible);
    const candidates=buttons.filter(x => /발행|등록/.test((x.innerText||'').trim()));
    const b=candidates.find(x => /발행/.test((x.innerText||'').trim())) || candidates[0];
    if(!b) return {ok:false,reason:'최종 발행 확인 버튼을 찾지 못했습니다.'};
    b.click(); return {ok:true};
  })()`, true);
}

async function publishNaverBlog({ view, instruction, log }) {
  const id = extract(instruction, "CONTENT_ID");
  const blogId = extract(instruction, "BLOG_ID");
  const title = extract(instruction, "TITLE");
  const body = extractBody(instruction);
  if (!id || !/^[a-zA-Z0-9_-]{2,50}$/.test(blogId) || !title || !body) throw new Error("블로그 작업 데이터가 불완전합니다.");

  await view.webContents.loadURL(writeUrl(blogId));
  await sleep(3500);
  const url = view.webContents.getURL();
  if (/nid\.naver\.com|login/i.test(url)) {
    return { status:"needs_human", message:"네이버 로그인이 필요합니다. 운영본부 브라우저에서 로그인한 뒤 다시 실행하세요.", contentId:id };
  }
  if (!isExpectedBlog(url, blogId)) return { status:"needs_human", message:"현재 글쓰기 화면의 블로그 ID를 확인할 수 없습니다. 다른 계정 발행을 막기 위해 중단했습니다.", contentId:id };

  const filled = await fillEditor(view, title, body);
  if (!filled.ok) return { status:"failed", message:filled.reason, contentId:id };
  if (!filled.titleText.includes(title) || !filled.bodyText.includes(body.slice(0, Math.min(20, body.length)))) {
    return { status:"failed", message:"SmartEditor 입력 후 내용 검증에 실패했습니다.", contentId:id };
  }
  log(`네이버 블로그 입력 확인: ${id}`);

  const clicked = await clickPublish(view);
  if (!clicked.ok) return { status:"failed", message:clicked.reason, contentId:id };
  await sleep(5000);

  const publishedUrl = view.webContents.getURL();
  if (/GoBlogWrite|PostWriteForm|postwrite/i.test(publishedUrl) || !isExpectedBlog(publishedUrl, blogId)) {
    return { status:"needs_human", message:"발행 클릭 후 공개 글 URL을 확인하지 못했습니다. 실제 게시 여부를 직접 확인하고 중복 발행하지 마세요.", contentId:id };
  }
  return { status:"done", message:"네이버 블로그 즉시 발행 후 공개 글 화면 이동 확인", contentId:id, publishedUrl };
}

module.exports = { publishNaverBlog };
