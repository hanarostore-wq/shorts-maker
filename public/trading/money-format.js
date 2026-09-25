export function parseMoney(value) {
  const text = String(value).trim();
  if (!/^\d+(?:,\d{3})*$/.test(text) && !/^\d+$/.test(text)) return NaN;
  const number = Number(text.replaceAll(',', ''));
  return Number.isSafeInteger(number) ? number : NaN;
}
export function groupedMoneyInput(value) {
  const text = String(value);
  if (!text) return '';
  if (!/^[\d,]+$/.test(text)) return text;
  const digits = text.replaceAll(',', '').replace(/^0+(?=\d)/, '');
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
export function money(value, decimals = 2) {
  if (value === null || value === undefined || value === '' || !Number.isFinite(Number(value))) return '—';
  return Number(value).toLocaleString('ko-KR', {maximumFractionDigits: decimals});
}
export function formatMoneyField(input) {
  const raw = input.value;
  const cursor = input.selectionStart;
  const beforeDigits = cursor === null ? null : raw.slice(0, cursor).replace(/\D/g, '').length;
  const valid = raw === '' || /^[\d,]+$/.test(raw);
  input.setCustomValidity(valid ? '' : '금액은 숫자로 입력하세요. 예: 10,000');
  let hint = input.parentElement.querySelector('[data-money-hint]');
  if (!hint) { hint = document.createElement('small'); hint.dataset.moneyHint = ''; hint.className = 'money-hint'; input.insertAdjacentElement('afterend', hint); }
  hint.textContent = valid && raw ? '(' + koreanMoney(parseMoney(groupedMoneyInput(raw))) + ')' : '';
  if (!valid) return;
  input.value = groupedMoneyInput(raw);
  if (beforeDigits !== null && document.activeElement === input) {
    let pos = 0, seen = 0;
    while (pos < input.value.length && seen < beforeDigits) { if (/\d/.test(input.value[pos])) seen++; pos++; }
    input.setSelectionRange(pos, pos);
  }
}

export function koreanMoney(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  const negative = number < 0 ? '-' : '';
  const integer = Math.floor(Math.abs(number));
  if (!Number.isSafeInteger(integer)) return '표시 범위 초과';
  const units = ['', '만', '억', '조', '경'];
  const parts = [];
  let rest = integer, index = 0;
  while (rest > 0) {
    const group = rest % 10000;
    if (group) {
      const thousands = Math.floor(group / 1000), hundreds = Math.floor(group % 1000 / 100), below = group % 100;
      parts.unshift((index >= 2 ? String(group) : (thousands ? thousands + '천' : '') + (hundreds ? hundreds + '백' : '') + (below ? below : '')) + units[index]);
    }
    rest = Math.floor(rest / 10000); index++;
  }
  const fraction = (Math.abs(number) - integer).toFixed(8).slice(1).replace(/0+$/, '').replace(/\.$/, '');
  return negative + (parts.join(' ') || '0') + fraction + '원';
}
export function moneyLabel(value, decimals = 2) {
  if (value === null || value === undefined || value === '' || !Number.isFinite(Number(value))) return '—';
  const rounded = Number(Number(value).toFixed(decimals));
  return money(rounded, decimals) + '원 (' + koreanMoney(rounded) + ')';
}
