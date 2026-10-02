import Link from "next/link";
import type { RangePreset, ResolvedRange } from "@/lib/dates";

export function RangeBar({
  path,
  range,
  includeAll = false,
  extra,
}: {
  path: string;
  range: ResolvedRange;
  includeAll?: boolean;
  extra?: Record<string, string | undefined>;
}) {
  function href(preset: RangePreset) {
    const params = new URLSearchParams();
    params.set("range", preset);
    for (const [key, value] of Object.entries(extra ?? {})) {
      if (value) params.set(key, value);
    }
    return `${path}?${params.toString()}`;
  }

  const presets: { id: RangePreset; label: string }[] = [
    ...(includeAll ? [{ id: "all" as const, label: "All" }] : []),
    { id: "today", label: "Today" },
    { id: "week", label: "This week" },
    { id: "month", label: "This month" },
  ];

  return (
    <div className="filters">
      <div className="chips" role="tablist" aria-label="Date range">
        {presets.map((preset) => (
          <Link key={preset.id} href={href(preset.id)} className={range.preset === preset.id ? "chip is-on" : "chip"}>
            {preset.label}
          </Link>
        ))}
      </div>
      <form className="date-form" method="get" action={path}>
        <input type="hidden" name="range" value="custom" />
        {Object.entries(extra ?? {}).map(([key, value]) =>
          value ? <input key={key} type="hidden" name={key} value={value} /> : null,
        )}
        <input type="date" name="from" defaultValue={range.from ?? ""} aria-label="From" />
        <input type="date" name="to" defaultValue={range.to ?? ""} aria-label="To" />
        <button className="btn" type="submit">
          Apply
        </button>
      </form>
    </div>
  );
}
