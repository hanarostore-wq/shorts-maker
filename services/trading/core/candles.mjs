export const candlePeriods = [
  1 / 60,
  1,
  3,
  5,
  15,
  30,
  60,
  240,
  1440,
  43200,
  525600,
];
export function candlePath(units) {
  if (!candlePeriods.includes(units))
    throw Error("지원하지 않는 차트 시간입니다.");
  if (units === 1 / 60) return "/v1/candles/seconds";
  if (units === 1440) return "/v1/candles/days";
  if (units === 43200) return "/v1/candles/months";
  if (units === 525600) return "/v1/candles/years";
  return "/v1/candles/minutes/" + units;
}
export function candleStart(ms, units) {
  if (units === 43200 || units === 525600) {
    const d = new Date(ms);
    return Date.UTC(
      d.getUTCFullYear(),
      units === 525600 ? 0 : d.getUTCMonth(),
      1,
    );
  }
  const duration = Math.round(units * 60000);
  return Math.floor(ms / duration) * duration;
}
export function updateCandles(list, trade, units) {
  const ms = trade.sourceTradeTimestamp ?? trade.trade_timestamp;
  const time = candleStart(ms, units),
    last = list.at(-1);
  if (last && time < last.time) return;
  if (!last || time > last.time) {
    list.push({
      time,
      open: trade.trade_price,
      high: trade.trade_price,
      low: trade.trade_price,
      close: trade.trade_price,
      volume: trade.trade_volume,
      lastTradeAt: ms,
      restCutoff: 0,
    });
    if (list.length > 500) list.shift();
    return;
  }
  // REST's accumulated volume already includes trades through its last timestamp.
  if (ms <= (last.restCutoff || 0)) return;
  last.high = Math.max(last.high, trade.trade_price);
  last.low = Math.min(last.low, trade.trade_price);
  if (ms >= (last.lastTradeAt || 0)) {
    last.close = trade.trade_price;
    last.lastTradeAt = ms;
  }
  last.volume += trade.trade_volume;
}
export function fromRest(data, trades, units) {
  const list = data
    .slice()
    .reverse()
    .map((c) => ({
      time: Date.parse(c.candle_date_time_utc + "Z"),
      open: c.opening_price,
      high: c.high_price,
      low: c.low_price,
      close: c.trade_price,
      volume: c.candle_acc_trade_volume,
      restCutoff: c.timestamp,
      lastTradeAt: c.timestamp,
    }));
  for (const t of trades
    .slice()
    .sort(
      (a, b) =>
        (a.sourceTradeTimestamp ?? a.trade_timestamp) -
        (b.sourceTradeTimestamp ?? b.trade_timestamp),
    ))
    updateCandles(list, t, units);
  return list;
}
