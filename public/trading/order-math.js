export function percentValue(base, percent) {
  if (
    !Number.isFinite(base) ||
    base < 0 ||
    ![10, 25, 50, 100].includes(percent)
  )
    return 0;
  return Math.floor((base * percent) / 100);
}
