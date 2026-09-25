const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function first(selectors) { for (const selector of selectors) { const node = document.querySelector(selector); if (node) return node; } return null; }
function setNativeValue(node, value) { const setter = Object.getOwnPropertyDescriptor(node.__proto__, 'value')?.set; if (setter) setter.call(node, value); else node.value = value; node.dispatchEvent(new Event('input', { bubbles: true })); node.dispatchEvent(new Event('change', { bubbles: true })); }
function titleNode() { return first(['input#subject', 'input[name="subject"]', 'input[placeholder*="제목"]', 'textarea[placeholder*="제목"]']); }
function editorFrame() { return first(['iframe#mainFrame', 'iframe[src*="PostWriteForm"]', 'iframe']); }
async function writeTitle(title) { const node = titleNode(); if (!node) throw new Error('NAVER_TITLE_INPUT_NOT_FOUND'); setNativeValue(node, title); return 'title'; }
async function writeContent(content) {
  const frame = editorFrame();
  if (frame?.contentDocument?.body) { const body = frame.contentDocument.body; body.innerHTML = content.split(/\n{2,}/).map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`).join(''); body.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: content })); return 'iframe-body'; }
  const editable = first(['[contenteditable="true"]', '.se2_inputarea', '[role="textbox"]']);
  if (!editable) throw new Error('NAVER_EDITOR_NOT_FOUND');
  editable.focus(); editable.innerHTML = content.split(/\n{2,}/).map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`).join(''); editable.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: content })); return 'contenteditable';
}
async function uploadImages(images) { if (!images?.length) return { count: 0, mode: 'none' }; const input = first(['input[type="file"][accept*="image"]', 'input[type="file"]']); if (!input) return { count: 0, mode: 'not-found', urls: images }; const files = []; for (const url of images) { const response = await fetch(url); if (!response.ok) throw new Error(`NAVER_IMAGE_FETCH_FAILED_${response.status}`); const blob = await response.blob(); files.push(new File([blob], `moneyos-${files.length + 1}.${(blob.type.split('/')[1] || 'jpg').replace('jpeg','jpg')}`, { type: blob.type })); } const transfer = new DataTransfer(); files.forEach((file) => transfer.items.add(file)); input.files = transfer.files; input.dispatchEvent(new Event('change', { bubbles: true })); await sleep(500); return { count: files.length, mode: 'file-input' }; }
function escapeHtml(value) { return String(value).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
async function insertPost(post) { await writeTitle(post.title); await writeContent(post.content); const imageResult = await uploadImages(post.images || []); return { ok: true, title: post.title, imageResult, editor: editorFrame() ? 'iframe' : 'contenteditable', note: '입력 완료. 발행 버튼은 자동 클릭하지 않습니다.' }; }
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => { if (message.type !== 'MONEYOS_INSERT_POST') return; insertPost(message.post).then(sendResponse).catch((error) => sendResponse({ ok: false, error: error.message })); return true; });
