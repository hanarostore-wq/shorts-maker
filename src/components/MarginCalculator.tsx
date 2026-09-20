"use client";

import { useState } from "react";
import {
  CHANNEL_PRESETS,
  calcMargin,
  formatKRW,
  formatPercent,
  parsePriceToNumber,
  sellPriceForTargetMargin,
  unitsForGoal,
} from "@/lib/margin";

interface Props {
  /** 소싱 페이지에서 긁어온 가격 문자열 (매입가 기본값으로 사용) */
  priceText: string | null;
  /** 달성하고 싶은 순이익 목표 금액 */
  goal: number;
}

function NumberField({
  label,
  value,
  onChange,
  suffix = "원",
  step = 100,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  suffix?: string;
  step?: number;
}) {
  return (
    <label className="flex flex-col gap-0.5">
      <span className="text-[10px] text-zinc-500">{label}</span>
      <span className="flex items-center gap-1">
        <input
          type="number"
          value={Number.isFinite(value) ? value : 0}
          step={step}
          min={0}
          onChange={(e) => onChange(Math.max(0, Number(e.target.value)))}
          className="w-full min-w-0 border border-zinc-700 bg-zinc-950 px-1.5 py-1 text-[11px] text-zinc-200 outline-none focus:border-zinc-500"
        />
        <span className="shrink-0 text-[10px] text-zinc-600">{suffix}</span>
      </span>
    </label>
  );
}

export function MarginCalculator({ priceText, goal }: Props) {
  const scrapedPrice = parsePriceToNumber(priceText);

  const [channelId, setChannelId] = useState(CHANNEL_PRESETS[0].id);
  const [feePercent, setFeePercent] = useState(CHANNEL_PRESETS[0].feeRate * 100);
  const [cost, setCost] = useState(scrapedPrice ?? 0);
  const [extraCost, setExtraCost] = useState(0);
  const [outboundShipping, setOutboundShipping] = useState(3000);
  const [targetPercent, setTargetPercent] = useState(20);
  const [sellPrice, setSellPrice] = useState(() => {
    const suggested = sellPriceForTargetMargin(
      {
        cost: scrapedPrice ?? 0,
        extraCost: 0,
        outboundShipping: 3000,
        feeRate: CHANNEL_PRESETS[0].feeRate,
      },
      0.2,
    );
    return suggested ?? 0;
  });

  const feeRate = feePercent / 100;
  const costs = { cost, extraCost, outboundShipping, feeRate };

  const result = calcMargin({ ...costs, sellPrice });

  const suggestedPrice = sellPriceForTargetMargin(costs, targetPercent / 100);
  const units = unitsForGoal(result.profit, goal);
  const channel = CHANNEL_PRESETS.find((c) => c.id === channelId) ?? CHANNEL_PRESETS[0];

  const handleChannel = (id: string) => {
    setChannelId(id);
    const preset = CHANNEL_PRESETS.find((c) => c.id === id);
    if (preset && preset.id !== "custom") setFeePercent(preset.feeRate * 100);
  };

  return (
    <div className="flex flex-col gap-2 border border-zinc-800 bg-zinc-950 p-2">
      <div className="flex flex-wrap items-center gap-1">
        <span className="mr-1 text-[10px] font-bold text-zinc-400">마진 계산</span>
        {CHANNEL_PRESETS.map((preset) => (
          <button
            key={preset.id}
            onClick={() => handleChannel(preset.id)}
            className={`border px-1.5 py-0.5 text-[10px] ${
              channelId === preset.id
                ? "border-emerald-500 text-emerald-400"
                : "border-zinc-700 text-zinc-500 hover:text-zinc-300"
            }`}
          >
            {preset.name}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
        <NumberField label="매입가" value={cost} onChange={setCost} />
        <NumberField label="부대비용(포장 등)" value={extraCost} onChange={setExtraCost} />
        <NumberField label="내가 내는 택배비" value={outboundShipping} onChange={setOutboundShipping} />
        <NumberField
          label="채널 수수료"
          value={Number(feePercent.toFixed(2))}
          onChange={(v) => {
            setFeePercent(Math.min(100, v));
            setChannelId("custom");
          }}
          suffix="%"
          step={0.1}
        />
        <NumberField label="판매가" value={sellPrice} onChange={setSellPrice} />
        <NumberField
          label="목표 마진율"
          value={targetPercent}
          onChange={(v) => setTargetPercent(Math.min(99, v))}
          suffix="%"
          step={1}
        />
      </div>

      <p className="text-[10px] text-zinc-600">{channel.note} · 실제 정산서와 한 번 대조해보세요</p>

      <div className="flex flex-wrap items-center gap-2 border-t border-zinc-800 pt-2 text-[11px]">
        <span className="text-zinc-500">
          수수료 <span className="text-zinc-300">{formatKRW(result.fee)}</span>
        </span>
        <span className="text-zinc-500">
          총원가 <span className="text-zinc-300">{formatKRW(result.totalCost)}</span>
        </span>
        <span className="text-zinc-500">
          건당 순이익{" "}
          <span className={result.profit > 0 ? "font-bold text-emerald-400" : "font-bold text-rose-400"}>
            {formatKRW(result.profit)}
          </span>
        </span>
        <span className="text-zinc-500">
          마진율{" "}
          <span className={result.marginRate > 0 ? "text-emerald-400" : "text-rose-400"}>
            {formatPercent(result.marginRate)}
          </span>
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        {suggestedPrice !== null ? (
          <button
            onClick={() => setSellPrice(suggestedPrice)}
            className="border border-zinc-700 px-1.5 py-0.5 text-[10px] text-zinc-300 hover:border-emerald-500 hover:text-emerald-400"
          >
            마진 {targetPercent}% 판매가 {formatKRW(suggestedPrice)} 적용
          </button>
        ) : (
          <span className="text-[10px] text-rose-400">
            수수료 {formatPercent(feeRate)}로는 마진 {targetPercent}%가 불가능합니다
          </span>
        )}
        {units !== null ? (
          <span className="text-zinc-500">
            목표 {formatKRW(goal)} 달성까지{" "}
            <span className="font-bold text-zinc-100">{units.toLocaleString("ko-KR")}개</span> 판매
          </span>
        ) : (
          <span className="text-rose-400">지금 판매가로는 팔수록 손해입니다</span>
        )}
      </div>
    </div>
  );
}
