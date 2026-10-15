// '이 사이트 제외' 표시 — 서비스워커가 제외한 사이트에만 문서 시작 때 넣는다(manifest 에는 없음).
//  이 표시가 있으면 확장프로그램의 다른 콘텐츠 스크립트는 아무 일도 하지 않는다(자동재생 끄기·저장 버튼·재생바·제스처 등 전부)
globalThis.__SMD_OFF = true;
try {
  document.documentElement.setAttribute('data-smd-off', '1');
} catch {}
