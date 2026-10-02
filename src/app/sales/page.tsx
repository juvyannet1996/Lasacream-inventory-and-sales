import Link from "next/link";
import { RangeBar } from "@/components/RangeBar";
import { formatDate, rangeLabel, resolveRange, todayISO } from "@/lib/dates";
import { formatPeso } from "@/lib/money";
import { listSales } from "@/lib/queries";
import { one } from "@/lib/search";
import { formatNumber } from "@/lib/units";

export const metadata = { title: "Sales" };

export default async function SalesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const today = todayISO();
  const range = resolveRange(
    { range: one(params.range), from: one(params.from), to: one(params.to) },
    { defaultPreset: "month", today },
  );
  const sales = listSales(range);
  return (
    <div className="page">
      <header className="page-header">
        <h1>Sales</h1>
        <Link className="btn btn-primary" href="/sales/new">
          New sale
        </Link>
      </header>
      <RangeBar path="/sales" range={range} includeAll />
      <p className="muted">{rangeLabel(range, today)}</p>
      {sales.length === 0 ? <p className="muted">No sales in this range.</p> : null}
      <ul className="item-list">
        {sales.map((sale) => (
          <li key={sale.id}>
            <Link href={`/sales/${sale.id}`} className={sale.status === "voided" ? "sale-row is-inactive" : "sale-row"}>
              <span>
                <span className="muted">
                  {formatDate(sale.soldAt, today)}
                  {sale.status === "voided" ? " · Voided" : ""}
                </span>
                <span className="item-name">
                  {sale.lines.map((line) => `${line.productIcon} ${line.productName} × ${formatNumber(line.quantity)}`).join(", ")}
                </span>
                {sale.notes ? <span className="item-meta">{sale.notes}</span> : null}
              </span>
              <span className="sale-figures">
                <strong>{formatPeso(sale.totalPrice)}</strong>
                <span className="muted">Cost {formatPeso(sale.estimatedCost)}</span>
                <span className="muted">Profit {formatPeso(sale.estimatedProfit)}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
