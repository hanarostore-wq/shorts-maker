const truncateKrw = (value) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return NaN;
  return Math.floor(number / 10) * 10;
};

export function parseMoney(value) {
  const text = String(value).trim();
  if (!/^\d+(?:,\d{3})*$/.test(text) && !/^\d+$/.test(text)) return NaN;
  const number = truncateKrw(text.replaceAll(',', ''));
  return Number.isSafeInteger(number) ? number : NaN;
}

export function groupedMoneyInput(value) {
  const text = String(value);
  if (!text) return '';
  if (!/^[\d,]+$/.test(text)) return text;
  const digits = text.replaceAll(',', '').replace(/^0+(?=\d)/, '');
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function money(value, decimals = 0) {
  if (value === null || value === undefined || value === '' || !Number.isFinite(Number(value))) return '—';
  const number = truncateKrw(value);
  return number.toLocaleString('ko-KR', { maximumFractionDigits: decimals });
}

export function formatMoneyField(input) {
  const raw = input.value;
  const cursor = input.selectionStart;
  const beforeDigits = cursor === null ? null : raw.slice(0, cursor).replace(/\D/g, '').length;
  const valid = raw === '' || /^[\d,]+$/.test(raw);
  input.setCustomValidity(valid ? '' : '금액은 숫자로 입력하세요. 예: 10,000');
  if (!valid) return;
  // Editing must not round/truncate digits; execution parsing is separate.
  input.value = groupedMoneyInput(raw);
  if (beforeDigits !== null && document.activeElement === input) {
    let pos = 0, seen = 0;
    while (pos < input.value.length && seen < Math.min(beforeDigits, input.value.replace(/\D/g, '').length)) {
      if (/\d/.test(input.value[pos])) seen++;
      pos++;
    }
    input.setSelectionRange(pos, pos);
  }
}

export function moneyLabel(value) {
  if (value === null || value === undefined || value === '' || !Number.isFinite(Number(value))) return '—';
  return money(value, 0) + '원';
}

export function koreanMoney(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  const integer = Math.floor(Math.abs(number));
  if (!Number.isSafeInteger(integer)) return '표시 범위 초과';
  const units = ['', '만', '억', '조', '경'];
  const parts = [];
  let rest = integer;
  let index = 0;
  while (rest > 0) {
    const group = rest % 10000;
    if (group) parts.unshift(String(group) + units[index]);
    rest = Math.floor(rest / 10000);
    index += 1;
  }
  return (number < 0 ? '-' : '') + (parts.join(' ') || '0') + '원';
}
