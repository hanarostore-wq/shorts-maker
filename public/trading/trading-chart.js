import {
  createChart,
  CandlestickSeries,
  LineSeries,
  HistogramSeries,
  CrosshairMode,
  PriceScaleMode,
  LineStyle,
} from "./vendor/lightweight-charts.js";
import { ema, sma, bands, rsi, macd, periodLabel } from "./indicators.js";
const $ = (id) => document.getElementById(id),
  fmt = (x) => Number(x).toLocaleString("ko-KR", { maximumFractionDigits: 6 });
export class TradingChart {
  constructor() {
    this.key = "";
    this.data = [];
    this.lines = {};
    this.drawings = [];
    this.tool = "cursor";
    this.anchor = null;
    this.priceLines = [];
    this.log = false;
    this.percent = false;
    this.kind = "candles";
    this.chart = createChart($("chart"), {
      autoSize: true,
      layout: {
        background: { type: "solid", color: "#ffffff" },
        textColor: "#252a34",
        fontFamily: "Malgun Gothic, sans-serif",
        fontSize: 11,
        attributionLogo: true,
      },
      grid: {
        vertLines: { color: "#f0f1f4" },
        horzLines: { color: "#f0f1f4" },
      },
      rightPriceScale: {
        borderColor: "#eceef2",
        minimumWidth: 90,
        scaleMargins: { top: 0.1, bottom: 0.23 },
      },
      timeScale: {
        borderColor: "#eceef2",
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 6,
        barSpacing: 6,
        minBarSpacing: 1,
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: "#929aa8", width: 1, style: LineStyle.Dashed },
        horzLine: { color: "#929aa8", width: 1, style: LineStyle.Dashed },
      },
      localization: {
        locale: "ko-KR",
        priceFormatter: (p) => fmt(p),
        timeFormatter: (t) =>
          new Date(Number(t) * 1000).toLocaleString("ko-KR", {
            timeZone: "UTC",
            hour12: false,
          }),
      },
    });
    this.candles = this.chart.addSeries(CandlestickSeries, {
      upColor: "#f23645",
      downColor: "#1674ff",
      borderVisible: false,
      wickUpColor: "#f23645",
      wickDownColor: "#1674ff",
    });
    this.closeLine = this.chart.addSeries(LineSeries, {
      color: "#1674ff",
      lineWidth: 2,
      visible: false,
      lastValueVisible: false,
      priceLineVisible: false,
    });
    this.volume = this.chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "volume",
      lastValueVisible: false,
      priceLineVisible: false,
    });
    this.volume
      .priceScale()
      .applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    this.chart.subscribeCrosshairMove((p) => {
      const c = p.seriesData.get(this.candles);
      this.legend(c || this.data.at(-1), p.time);
    });
    this.chart.subscribeClick((p) => this.onClick(p));
    $("indicatorBtn").onclick = () => $("indicatorDialog").showModal();
    document
      .querySelectorAll("[data-indicator]")
      .forEach((x) => (x.onchange = () => this.refreshIndicators()));
    document
      .querySelectorAll("[data-draw]")
      .forEach((x) => (x.onclick = () => this.setTool(x.dataset.draw)));
    $("zoomIn").onclick = () => this.zoom(0.7);
    $("zoomOut").onclick = () => this.zoom(1.4);
    $("chartFit").onclick = () => this.chart.timeScale().fitContent();
    $("chartLive").onclick = () => {
      this.chart.timeScale().scrollToRealTime();
      this.chart.priceScale("right").applyOptions({ autoScale: true });
    };
    $("chartLog").onclick = () => {
      this.log = !this.log;
      this.percent = false;
      this.scale();
    };
    $("chartPercent").onclick = () => {
      this.percent = !this.percent;
      this.log = false;
      this.scale();
    };
    $("chartKind").onclick = () => {
      this.kind = this.kind === "candles" ? "line" : "candles";
      this.candles.applyOptions({ visible: this.kind === "candles" });
      this.closeLine.applyOptions({ visible: this.kind === "line" });
      $("chartKind").textContent =
        this.kind === "candles" ? "봉 차트" : "선 차트";
    };
    $("chartFullscreen").onclick = async () => {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await $("chartPanel").requestFullscreen();
    };
    $("chartCapture").onclick = () => {
      const a = document.createElement("a");
      a.download = "가격차트.png";
      a.href = this.chart.takeScreenshot(true, true).toDataURL("image/png");
      a.click();
    };
  }
  setTheme(theme) {
    const dark = theme === 'dark';
    this.chart.applyOptions({
      layout: { background: {type: 'solid', color: dark ? '#151d2b' : '#ffffff'}, textColor: dark ? '#cad5e6' : '#252a34' },
      grid: {vertLines: {color: dark ? '#253044' : '#f0f1f4'}, horzLines: {color: dark ? '#253044' : '#f0f1f4'}},
      rightPriceScale: {borderColor: dark ? '#334158' : '#eceef2'},
      timeScale: {borderColor: dark ? '#334158' : '#eceef2'},
      crosshair: {vertLine: {color: dark ? '#9aabc4' : '#929aa8', labelBackgroundColor: dark ? '#41536f' : '#4c525e'}, horzLine: {color: dark ? '#9aabc4' : '#929aa8', labelBackgroundColor: dark ? '#41536f' : '#4c525e'}}
    });
  }
  scale() {
    this.chart
      .priceScale("right")
      .applyOptions({
        mode: this.log
          ? PriceScaleMode.Logarithmic
          : this.percent
            ? PriceScaleMode.Percentage
            : PriceScaleMode.Normal,
      });
    $("chartLog").classList.toggle("active", this.log);
    $("chartPercent").classList.toggle("active", this.percent);
  }
  zoom(f) {
    const range = this.chart.timeScale().getVisibleLogicalRange();
    if (!range) return;
    const center = (range.from + range.to) / 2,
      half = ((range.to - range.from) * f) / 2;
    this.chart
      .timeScale()
      .setVisibleLogicalRange({ from: center - half, to: center + half });
  }
  legend(c, time) {
    if (!c) return;
    const symbol = this.market?.symbol?.replace("KRW-", "") + "/원";
    $("chartLegend").textContent =
      symbol +
      " · " +
      periodLabel(this.market.units) +
      " · 업비트  시작 " +
      fmt(c.open) +
      "  최고 " +
      fmt(c.high) +
      "  최저 " +
      fmt(c.low) +
      "  마지막 " +
      fmt(c.close);
    $("chartVolumeLegend").textContent =
      "거래량: " +
      fmt(c.volume ?? this.data.find((x) => x.time === time)?.volume ?? 0) +
      "개 · 봉 아래 막대";
  }
  update(m) {
    this.market = m;
    const key = m.symbol + "|" + m.units;
    const changed = key !== this.key;
    const points = m.candles.map((c) => ({
      ...c,
      time: Math.floor(c.time / 1000) + 9 * 3600,
    }));
    if (!points.length) return;
    const last = points.at(-1),
      old = this.data.at(-1);
    const altered =
      changed ||
      !old ||
      old.time !== last.time ||
      old.close !== last.close ||
      old.high !== last.high ||
      old.low !== last.low ||
      old.volume !== last.volume;
    if (!altered) return;
    const vol = (c) => ({
      time: c.time,
      value: c.volume,
      color: c.close >= c.open ? "#f6a2a7" : "#8db9ff",
    });
    if (
      changed ||
      this.data.length !== points.length ||
      old.time !== last.time
    ) {
      this.candles.setData(points);
      this.closeLine.setData(
        points.map((c) => ({ time: c.time, value: c.close })),
      );
      this.volume.setData(points.map(vol));
    } else {
      this.candles.update(last);
      this.closeLine.update({ time: last.time, value: last.close });
      this.volume.update(vol(last));
    }
    this.data = points;
    this.key = key;
    const minMove =
      last.close >= 100 ? 1 : last.close >= 1 ? 0.0001 : 0.00000001;
    this.candles.applyOptions({
      priceFormat: {
        type: "price",
        minMove,
        precision: minMove === 1 ? 0 : minMove === 0.0001 ? 4 : 8,
      },
    });
    this.closeLine.applyOptions({
      priceFormat: {
        type: "price",
        minMove,
        precision: minMove === 1 ? 0 : minMove === 0.0001 ? 4 : 8,
      },
    });
    this.chart.applyOptions({ timeScale: { secondsVisible: m.units < 1 } });
    if (changed) {
      this.clearDrawings();
      this.chart
        .timeScale()
        .setVisibleLogicalRange({
          from: Math.max(0, points.length - 140),
          to: points.length + 6,
        });
    }
    this.legend(last);
    this.refreshIndicators();
  }
  line(key, data, color, pane = 0) {
    if (!this.lines[key])
      this.lines[key] = this.chart.addSeries(
        LineSeries,
        {
          color,
          lineWidth: 1,
          lastValueVisible: false,
          priceLineVisible: false,
          crosshairMarkerVisible: false,
        },
        pane,
      );
    this.lines[key].setData(data);
  }
  refreshIndicators() {
    if (!this.data.length) return;
    const d = this.data,
      values = d.map((x) => x.close),
      selected = Object.fromEntries(
        [...document.querySelectorAll("[data-indicator]")].map((x) => [
          x.dataset.indicator,
          x.checked,
        ]),
      );
    const points = (a) =>
      a.flatMap((v, i) => (v === null ? [] : [{ time: d[i].time, value: v }]));
    const wanted = new Set();
    const add = (key, a, color, pane = 0) => {
      wanted.add(key);
      this.line(key, points(a), color, pane);
    };
    if (selected.ema) {
      add("ema9", ema(values, 9), "#e99516");
      add("ema21", ema(values, 21), "#9b59bd");
    }
    if (selected.sma) {
      add("sma5", sma(values, 5), "#00a09a");
      add("sma20", sma(values, 20), "#426de0");
      add("sma60", sma(values, 60), "#839443");
    }
    if (selected.bands) {
      const b = bands(values);
      add(
        "bandTop",
        b.map((x) => x?.upper ?? null),
        "#92a9cf",
      );
      add(
        "bandMid",
        b.map((x) => x?.middle ?? null),
        "#7897c7",
      );
      add(
        "bandBottom",
        b.map((x) => x?.lower ?? null),
        "#92a9cf",
      );
    }
    const paneKey = String(!!selected.rsi) + "|" + String(!!selected.macd);
    if (this.paneKey !== paneKey) {
      for (const key of Object.keys(this.lines))
        if (key.startsWith("rsi") || key.startsWith("macd")) {
          this.chart.removeSeries(this.lines[key]);
          delete this.lines[key];
        }
      this.paneKey = paneKey;
    }
    // Remove obsolete pane series before assigning new pane indices.
    for (const key of Object.keys(this.lines))
      if (
        (key.startsWith("rsi") && !selected.rsi) ||
        (key.startsWith("macd") && !selected.macd)
      ) {
        this.chart.removeSeries(this.lines[key]);
        delete this.lines[key];
      }
    let pane = 1;
    if (selected.rsi) {
      add("rsi", rsi(values), "#8d53c6", pane++);
    }
    if (selected.macd) {
      const v = macd(values);
      add(
        "macd",
        v.map((x) => x?.value ?? null),
        "#2979ff",
        pane,
      );
      add(
        "macdSignal",
        v.map((x) => x?.signal ?? null),
        "#e99225",
        pane++,
      );
    }
    for (const key of Object.keys(this.lines))
      if (!wanted.has(key)) {
        this.chart.removeSeries(this.lines[key]);
        delete this.lines[key];
      }
    this.volume.applyOptions({ visible: !!selected.volume });
    this.chart.panes().forEach((p, i) => {
      if (i > 0) p.setHeight(100);
    });
    $("activeIndicators").textContent =
      [
        selected.ema ? "빠른 평균선 9·21" : null,
        selected.sma ? "평균선 5·20·60" : null,
        selected.bands ? "평소 가격 범위" : null,
        selected.rsi ? "오름·내림 힘" : null,
        selected.macd ? "추세 변화" : null,
      ]
        .filter(Boolean)
        .join(" · ") || "지표 선택에서 보조선을 켤 수 있습니다";
  }
  setTool(tool) {
    if (tool === "clear") {
      this.clearDrawings();
      tool = "cursor";
    }
    this.tool = tool;
    this.anchor = null;
    document
      .querySelectorAll("[data-draw]")
      .forEach((x) => x.classList.toggle("active", x.dataset.draw === tool));
    $("drawingHint").textContent =
      {
        cursor: "드래그로 이동 · 휠로 확대·축소",
        trend: "두 곳을 클릭하면 추세선이 그려집니다",
        horizontal: "가격 위치를 클릭하면 가로선이 그려집니다",
        measure: "두 곳을 클릭하면 가격 차이를 계산합니다",
      }[tool] || "";
  }
  onClick(p) {
    if (this.tool === "cursor" || !p.point || !p.time) return;
    const price = this.candles.coordinateToPrice(p.point.y);
    if (price === null) return;
    if (this.tool === "horizontal") {
      this.priceLines.push(
        this.candles.createPriceLine({
          price,
          color: "#607d8b",
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: "내 기준 가격",
        }),
      );
      this.setTool("cursor");
      return;
    }
    const point = { time: p.time, value: price };
    if (!this.anchor) {
      this.anchor = point;
      return;
    }
    if (this.tool === "measure") {
      $("drawingHint").textContent =
        "가격 차이 " +
        fmt(price - this.anchor.value) +
        "원 (" +
        ((price / this.anchor.value - 1) * 100).toFixed(2) +
        "%)";
      this.tool = "cursor";
      this.anchor = null;
      return;
    }
    if (point.time === this.anchor.time) return;
    const line = this.chart.addSeries(LineSeries, {
      color: "#527fa4",
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      autoscaleInfoProvider: () => null,
    });
    line.setData([this.anchor, point].sort((a, b) => a.time - b.time));
    this.drawings.push(line);
    this.setTool("cursor");
  }
  clearDrawings() {
    for (const l of this.drawings) this.chart.removeSeries(l);
    for (const l of this.priceLines) this.candles.removePriceLine(l);
    this.drawings = [];
    this.priceLines = [];
    this.anchor = null;
  }
}
