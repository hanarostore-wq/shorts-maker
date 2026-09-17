const colorByTone: Record<string, string> = {
  green: "text-emerald-400",
  blue: "text-sky-400",
  gray: "text-zinc-400",
  red: "text-rose-400",
  amber: "text-amber-400",
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
    <div className="flex items-center gap-2 rounded-md border border-zinc-800 bg-zinc-900/60 px-3 py-1.5">
      <span className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
        {label}
      </span>
      <span className={`font-mono text-sm font-semibold ${colorByTone[tone]}`}>
        {String(value).padStart(3, "0")}
      </span>
    </div>
  );
}
