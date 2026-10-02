import Link from "next/link";
import { HistoryItemFilter } from "@/components/HistoryItemFilter";
import { MovementList } from "@/components/MovementList";
import { RangeBar } from "@/components/RangeBar";
import { isTransactionType, TRANSACTION_TYPES } from "@/lib/constants";
import { rangeLabel, resolveRange, todayISO } from "@/lib/dates";
import { listItemOptions, listTransactions } from "@/lib/queries";
import { one } from "@/lib/search";

const LABELS = { purchase: "Purchase", sale: "Sale", wastage: "Wastage", adjustment: "Adjustment" } as const;

export const metadata = { title: "History" };

export default async function HistoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const today = todayISO();
  const range = resolveRange(
    { range: one(params.range), from: one(params.from), to: one(params.to) },
    { defaultPreset: "all", today },
  );
  const requested = one(params.type);
  const type = requested && isTransactionType(requested) ? requested : "all";
  const itemId = one(params.item);
  const items = listItemOptions();
  const validItem = itemId && items.some((item) => item.id === itemId) ? itemId : undefined;
  const history = listTransactions({
    itemId: validItem,
    type,
    from: range.from,
    to: range.to,
  });
  const preserved = new URLSearchParams();
  if (range.preset !== "all") preserved.set("range", range.preset);
  if (range.preset === "custom" && range.from && range.to) {
    preserved.set("from", range.from);
    preserved.set("to", range.to);
  }
  if (type !== "all") preserved.set("type", type);
  if (validItem) preserved.set("item", validItem);
  const typeHref = (next: string) => {
    const query = new URLSearchParams(preserved);
    query.delete("type");
    if (next !== "all") query.set("type", next);
    const text = query.toString();
    return text ? `/history?${text}` : "/history";
  };

  return (
    <div className="page">
      <header className="page-header">
        <h1>History</h1>
      </header>
      <RangeBar
        path="/history"
        range={range}
        includeAll
        extra={{ type: type === "all" ? undefined : type, item: validItem }}
      />
      <div className="history-tools">
        <HistoryItemFilter items={items} itemId={validItem} preserved={preserved.toString()} />
        <div className="chips">
          <Link href={typeHref("all")} className={type === "all" ? "chip is-on" : "chip"}>
            All
          </Link>
          {TRANSACTION_TYPES.map((entry) => (
            <Link key={entry} href={typeHref(entry)} className={type === entry ? "chip is-on" : "chip"}>
              {LABELS[entry]}
            </Link>
          ))}
        </div>
      </div>
      <p className="muted">{rangeLabel(range, today)}</p>
      <MovementList rows={history.rows} />
      {history.truncated ? <p className="muted">Showing the latest 500 movements.</p> : null}
    </div>
  );
}
