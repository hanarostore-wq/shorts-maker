export function ema(values, n) {
  let v = null;
  return values.map((x, i) => {
    v = v === null ? x : (x * 2) / (n + 1) + v * (1 - 2 / (n + 1));
    return i >= n - 1 ? v : null;
  });
}
export function sma(values, n) {
  let sum = 0;
  return values.map((x, i) => {
    sum += x;
    if (i >= n) sum -= values[i - n];
    return i >= n - 1 ? sum / n : null;
  });
}
export function bands(values, n = 20, k = 2) {
  const mean = sma(values, n);
  return mean.map((v, i) => {
    if (v === null) return null;
    const sd = Math.sqrt(
      values.slice(i - n + 1, i + 1).reduce((s, x) => s + (x - v) ** 2, 0) / n,
    );
    return { middle: v, upper: v + k * sd, lower: v - k * sd };
  });
}
export function rsi(values, n = 14) {
  let gain = 0,
    loss = 0;
  return values.map((x, i) => {
    if (!i) return null;
    const d = x - values[i - 1],
      up = Math.max(0, d),
      down = Math.max(0, -d);
    if (i <= n) {
      gain += up / n;
      loss += down / n;
    } else {
      gain = (gain * (n - 1) + up) / n;
      loss = (loss * (n - 1) + down) / n;
    }
    if (i < n) return null;
    return gain + loss === 0
      ? 50
      : loss === 0
        ? 100
        : 100 - 100 / (1 + gain / loss);
  });
}
export function macd(values) {
  const fast = ema(values, 12),
    slow = ema(values, 26);
  const line = values.map((_, i) =>
    slow[i] === null ? null : fast[i] - slow[i],
  );
  const valid = line.filter((v) => v !== null),
    signal = ema(valid, 9);
  let j = 0;
  return line.map((value) => {
    if (value === null) return null;
    const s = signal[j++];
    return { value, signal: s, histogram: s === null ? null : value - s };
  });
}
export function periodLabel(units) {
  return (
    {
      [1 / 60]: "1초",
      1: "1분",
      3: "3분",
      5: "5분",
      15: "15분",
      30: "30분",
      60: "1시간",
      240: "4시간",
      1440: "1일",
      43200: "1개월",
      525600: "12개월",
    }[units] || units + "분"
  );
}
