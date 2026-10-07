// 저장 버튼 클릭 보호(문서 시작 때 가장 먼저 실행)
//  사이트가 사진·영상 위에 투명 막을 덮거나(인스타그램·틱톡) 페이지 맨 바깥에서 클릭을 먼저 가로채면 저장 버튼이 반응하지 않는다.
//  사이트 스크립트보다 먼저 window 에 받는 자리를 걸어 두고, 누른 자리가 저장 버튼인지는 core.js 가 넘겨준 함수(__SMD_HIT)로 판단한다.
(() => {
  if (globalThis.__SMD_GUARD) return;
  globalThis.__SMD_GUARD = true;
  for (const t of ['pointerdown', 'mousedown', 'touchstart', 'pointerup', 'mouseup', 'touchend', 'click', 'dblclick', 'auxclick']) {
    window.addEventListener(t, (ev) => globalThis.__SMD_HIT?.(ev, t), { capture: true, passive: false });
  }
})();
