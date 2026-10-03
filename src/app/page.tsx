import Link from "next/link";
import { RangeBar } from "@/components/RangeBar";
import type { ChartGrain } from "@/lib/dates";
import { rangeLabel, resolveRange, todayISO } from "@/lib/dates";
import { formatPeso } from "@/lib/money";
import { dashboardPeriods, lowStockItems, salesSeries, topProducts } from "@/lib/queries";
import { one } from "@/lib/search";
import { stockLabel } from "@/lib/stock";
import { formatNumber, formatQuantity } from "@/lib/units";

export const metadata = { title: "Dashboard" };

export default async function DashboardPage({
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
  const grain = chartGrain(one(params.grain), range);
  const periods = await dashboardPeriods(today);
  const points = await salesSeries(range, grain);
  const max = Math.max(...points.map((point) => point.revenue), 0);
  const products = await topProducts(range);
  const low = await lowStockItems();

  return (
    <div className="page">
      <header className="page-header">
        <h1>Dashboard</h1>
      </header>
      <section className="stats">
        <Stat label="Today" stats={periods.today} />
        <Stat label="This week" stats={periods.week} />
        <Stat label="This month" stats={periods.month} />
      </section>

      <section className="card stack">
        <div className="section-head">
          <h2>Sales</h2>
          <div className="chips">
            {(["day", "week", "month"] as const).map((option) => (
              <Link key={option} href={chartHref(range, option)} className={grain === option ? "chip is-on" : "chip"}>
                {option === "day" ? "Daily" : option === "week" ? "Weekly" : "Monthly"}
              </Link>
            ))}
          </div>
        </div>
        <RangeBar path="/" range={range} includeAll extra={{ grain }} />
        <p className="muted">{rangeLabel(range, today)}</p>
        {points.length === 0 || max === 0 ? (
          <p className="muted">No sales in this range.</p>
        ) : (
          <div className="chart-scroll" role="img" aria-label={`Sales chart, ${rangeLabel(range, today)}`}>
            <div className="chart">
              {points.map((point) => (
                <div key={point.key} className="bar-col" title={`${point.title}: ${formatPeso(point.revenue)}`}>
                  <div className="bar-track">
                    <div className="bar" style={{ height: `${Math.max((point.revenue / max) * 100, point.revenue > 0 ? 4 : 0)}%` }} />
                  </div>
                  <span className="bar-label">{point.label}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      <div className="split">
        <section className="card stack">
          <h2>Top products</h2>
          {products.length === 0 ? <p className="muted">No sales in this range.</p> : null}
          <ul className="plain-list">
            {products.map((product) => (
              <li key={product.productId ?? product.name}>
                <span>
                  <span aria-hidden="true">{product.icon}</span> {product.name}
                </span>
                <span className="muted">
                  {formatNumber(product.quantity)} sold · {formatPeso(product.revenue)}
                </span>
              </li>
            ))}
          </ul>
        </section>
        <section className="card stack">
          <h2>Low stock</h2>
          {low.length === 0 ? <p className="muted">Nothing is low right now.</p> : null}
          <ul className="plain-list">
            {low.map((item) => (
              <li key={item.id}>
                <Link href={`/inventory/${item.id}`}>
                  <span aria-hidden="true">{item.icon}</span> {item.name}
                </Link>
                <span className={item.level === "out" ? "stock-out" : "stock-low"}>
                  {formatQuantity(item.quantityBase, item.baseUnit)} · {stockLabel(item.level)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}

function Stat({
  label,
  stats,
}: {
  label: string;
  stats: { orders: number; revenue: number; profit: number };
}) {
  const sales = stats.orders === 1 ? "1 sale" : `${stats.orders} sales`;
  return (
    <article className="stat">
      <p className="stat-label">{label}</p>
      <p className="stat-value">{formatPeso(stats.revenue)}</p>
      <p className="stat-meta">
        {sales} · est. profit {formatPeso(stats.profit)}
      </p>
    </article>
  );
}

function chartGrain(
  value: string | undefined,
  range: { from: string | null; to: string | null },
): ChartGrain {
  if (value === "day" || value === "week" || value === "month") return value;
  if (!range.from || !range.to) return "month";
  const from = Date.parse(`${range.from}T00:00:00Z`);
  const to = Date.parse(`${range.to}T00:00:00Z`);
  const days = Math.round((to - from) / 86400000) + 1;
  if (days > 120) return "month";
  if (days > 45) return "week";
  return "day";
}

function chartHref(range: { preset: string; from: string | null; to: string | null }, grain: ChartGrain) {
  const params = new URLSearchParams();
  params.set("range", range.preset);
  if (range.preset === "custom" && range.from && range.to) {
    params.set("from", range.from);
    params.set("to", range.to);
  }
  params.set("grain", grain);
  return `/?${params.toString()}`;
}
