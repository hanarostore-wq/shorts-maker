/** 모의 계좌 시작 금액 입력을 안전한 정수 원화로 바꾼다. */
export function parseKrwAmount(value) {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value > 0 ? value : NaN;
  const text = String(value ?? '').trim();
  if (!text) return NaN;
  const normalized = text.replace(/[\s,]/g, '').replace(/원$/, '');
  if (/^\d+$/.test(normalized)) {
    const numeric = Number(normalized);
    return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : NaN;
  }
  const match = normalized.match(/^(?:(\d+(?:\.\d+)?)억)?(?:(\d+(?:\.\d+)?)만)?$/);
  if (!match || (!match[1] && !match[2])) return NaN;
  const eok = Number(match[1] || 0);
  const man = Number(match[2] || 0);
  const amount = Math.round(eok * 100000000 + man * 10000);
  return Number.isSafeInteger(amount) && amount > 0 ? amount : NaN;
}
