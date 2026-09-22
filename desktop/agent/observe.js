// 화면 구조를 AI가 읽을 수 있는 형태로 뽑아낸다.
//
// HTML 원본을 통째로 넘기면 토큰이 너무 크고 정작 중요한 게 묻힌다. 대신
// "지금 이 화면에서 사람이 조작할 수 있는 것들"을 번호 붙인 목록으로 만든다.
//
// 뽑아낸 요소는 페이지 안 배열(window.__unyoungEls)에 그대로 남겨 둔다.
// 그래서 실행할 때 셀렉터로 다시 찾을 필요 없이 번호로 바로 집는다 —
// 셀렉터를 추측하다 엉뚱한 걸 누르는 일이 없다.

const OBSERVE_SOURCE = `(() => {
  const MAX_ELEMENTS = 120;
  const MAX_TEXT = 80;

  const clean = (s) => (s || "").replace(/\\s+/g, " ").trim().slice(0, MAX_TEXT);

  const isVisible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    if (r.bottom < -200 || r.top > window.innerHeight + 2000) return false;
    const s = getComputedStyle(el);
    return s.visibility !== "hidden" && s.display !== "none" && s.opacity !== "0";
  };

  // 사람이 조작할 수 있는 것들만 모은다.
  const SELECTOR = [
    "a[href]", "button", "input", "select", "textarea",
    "[role=button]", "[role=link]", "[role=tab]", "[role=checkbox]",
    "[onclick]", "[contenteditable=true]",
  ].join(",");

  const els = [];
  const listed = [];

  for (const el of document.querySelectorAll(SELECTOR)) {
    if (els.length >= MAX_ELEMENTS) break;
    if (!isVisible(el)) continue;
    if (el.disabled) continue;

    const tag = el.tagName.toLowerCase();
    const type = (el.getAttribute("type") || "").toLowerCase();

    // 비밀번호 칸은 목록에만 올리고 값은 절대 읽지 않는다.
    // 로그인은 사람이 직접 하고 에이전트는 그 세션에 얹혀 일한다.
    const isPassword = type === "password";

    let label = clean(
      el.getAttribute("aria-label") ||
      el.getAttribute("placeholder") ||
      el.innerText ||
      el.value ||
      el.getAttribute("title") ||
      el.getAttribute("name") ||
      ""
    );
    if (isPassword) label = "(비밀번호 입력칸)";

    // 글자도 없고 이름도 없는 건 AI가 판단할 근거가 없으니 뺀다.
    if (!label && tag !== "input" && tag !== "select") continue;

    const idx = els.length;
    els.push(el);

    // role=button 같은 것도 실제로는 누르면 동작하는 요소다. 태그만으로는
    // 구분되지 않으므로 role을 함께 내보낸다.
    const role = el.getAttribute("role") || "";
    let desc = "[" + idx + "] <" + tag + (type ? " " + type : "") +
      (role ? " role=" + role : "") + "> " + JSON.stringify(label);

    if (tag === "input" && !isPassword && el.value) {
      desc += " 현재값=" + JSON.stringify(clean(el.value));
    }
    if (type === "checkbox" || type === "radio") {
      desc += el.checked ? " [선택됨]" : " [선택안됨]";
    }
    if (tag === "select") {
      const opts = Array.from(el.options).slice(0, 12).map((o) => o.text.trim());
      desc += " 선택지=" + JSON.stringify(opts);
      if (el.value) desc += " 현재=" + JSON.stringify(el.selectedOptions[0]?.text?.trim() || "");
    }
    listed.push(desc);
  }

  window.__unyoungEls = els;

  // 화면에 보이는 글도 조금 준다. 버튼 목록만으로는 "지금 무슨 화면인지",
  // 주문 건수·금액 같은 맥락을 알 수 없기 때문이다.
  const bodyText = (document.body ? document.body.innerText : "")
    .replace(/\\n{3,}/g, "\\n\\n")
    .replace(/[ \\t]+/g, " ")
    .trim();

  return {
    url: location.href,
    title: document.title,
    elements: listed,
    text: bodyText.slice(0, 4000),
    scrollY: Math.round(window.scrollY),
    scrollHeight: Math.round(document.documentElement.scrollHeight),
  };
})()`;

/**
 * 관찰 때 붙인 번호로 요소를 조작한다.
 * 번호는 같은 화면 안에서만 유효하므로, 실행 후에는 반드시 다시 관찰한다.
 */
function buildActSource(action) {
  const payload = JSON.stringify(action);

  return `(async () => {
  const a = ${payload};
  const els = window.__unyoungEls || [];
  const el = els[a.index];
  if (!el) return { ok: false, error: "[" + a.index + "]번 요소가 화면에 없습니다. 화면이 바뀐 것 같습니다." };
  if (!document.contains(el)) return { ok: false, error: "[" + a.index + "]번 요소가 화면에서 사라졌습니다." };

  const label = ((el.innerText || el.value || el.getAttribute("aria-label") || "") + "").replace(/\\s+/g, " ").trim().slice(0, 60);
  el.scrollIntoView({ block: "center" });
  await new Promise((r) => setTimeout(r, 150));

  try {
    if (a.type === "click") {
      el.click();
    } else if (a.type === "type") {
      // 프레임워크(React 등)가 값 변경을 알아채도록 네이티브 setter를 쓴다.
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
      el.focus();
      if (setter) setter.call(el, a.text); else el.value = a.text;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    } else if (a.type === "select") {
      const opt = Array.from(el.options).find((o) => o.text.trim() === a.text || o.value === a.text);
      if (!opt) return { ok: false, error: "선택지에 " + JSON.stringify(a.text) + " 가 없습니다." };
      el.value = opt.value;
      el.dispatchEvent(new Event("change", { bubbles: true }));
    } else {
      return { ok: false, error: "알 수 없는 동작: " + a.type };
    }
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) };
  }

  return { ok: true, label };
})()`;
}

module.exports = { OBSERVE_SOURCE, buildActSource };
