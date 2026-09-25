const START = '<<<MONEYOS_POST_START>>>';
const END = '<<<MONEYOS_POST_END>>>';
const fields = { postId: ['<<<POST_ID>>>','<<<POST_ID_END>>>'], targets: ['<<<BLOG_TARGET>>>','<<<BLOG_TARGET_END>>>'], title: ['<<<TITLE_START>>>','<<<TITLE_END>>>'], content: ['<<<CONTENT_START>>>','<<<CONTENT_END>>>'], images: ['<<<IMAGES_START>>>','<<<IMAGES_END>>>'], tags: ['<<<TAGS_START>>>','<<<TAGS_END>>>'] };
function field(text, [a,b]) { const i=text.indexOf(a), j=text.indexOf(b); if(i<0||j<0||j<i) return ''; return text.slice(i+a.length,j).trim(); }
function visibleText() { return document.body?.innerText || ''; }
function parse(text) {
  if (!text.includes(START) || !text.includes(END)) throw new Error('MONEYOS 시작·종료 코드가 없습니다.');
  const postId = field(text, fields.postId) || `MONEYOS-${Date.now()}`;
  const targets = field(text, fields.targets).split(/[\n,]/).map((v)=>v.trim()).filter(Boolean);
  const title = field(text, fields.title);
  const content = field(text, fields.content);
  const images = field(text, fields.images).split(/\n/).map((v)=>v.trim()).filter((v)=>/^https?:\/\//i.test(v));
  const tags = field(text, fields.tags).split(/[,\n]/).map((v)=>v.trim().replace(/^#/,'')).filter(Boolean);
  if (!targets.length) throw new Error('BLOG_TARGET가 없습니다.');
  if (!title) throw new Error('TITLE 블록이 비어 있습니다.');
  if (!content || content.length < 20) throw new Error('CONTENT 블록이 너무 짧습니다.');
  return { postId, targets, title, content, images, tags, raw: text };
}
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => { if (message.type !== 'MONEYOS_READ_GPT') return; try { sendResponse(parse(visibleText())); } catch (error) { sendResponse({ error: error.message }); } return true; });
