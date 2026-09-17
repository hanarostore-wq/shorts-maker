const colorByTone: Record<string, string> = {
  green: "text-emerald-400",
  blue: "text-sky-400",
  gray: "text-zinc-400",
  red: "text-rose-400",
};

export function StatCounter({
  label,
  value,
  tone = "gray",
}: {
  label: string;
  value: number;
  tone?: keyof typeof colorByTone;
}) {
  return (
    <div className="flex items-center gap-2 border-2 border-zinc-700 bg-zinc-900 px-3 py-1.5">
      <span className="text-[11px] font-bold tracking-wide text-zinc-500">
        {label}
      </span>
      <span className={`font-mono text-sm font-bold ${colorByTone[tone]}`}>
        {String(value).padStart(3, "0")}
      </span>
    </div>
  );
}
