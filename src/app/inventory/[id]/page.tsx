import Link from "next/link";
import { notFound } from "next/navigation";
import { ItemToolbar } from "@/components/ItemDialog";
import { MovementList } from "@/components/MovementList";
import { isTransactionType, TRANSACTION_TYPES } from "@/lib/constants";
import { formatDateWithYear, todayISO } from "@/lib/dates";
import { formatPeso, formatUnitCost } from "@/lib/money";
import { getItemOption, listItemOptions, listTransactions } from "@/lib/queries";
import { one } from "@/lib/search";
import { stockLabel, stockStatus } from "@/lib/stock";
import { formatQuantity } from "@/lib/units";

const LABELS = { purchase: "Purchases", sale: "Sales", wastage: "Wastage", adjustment: "Adjustments" } as const;

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const item = getItemOption(id);
  return { title: item?.name ?? "Inventory" };
}

export default async function InventoryItemPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const item = getItemOption(id);
  if (!item) notFound();
  const requested = one(query.type);
  const type = requested && isTransactionType(requested) ? requested : "all";
  const history = listTransactions({ itemId: id, type, limit: 300 });
  const level = stockStatus(item.quantityBase, item.minimumStock);
  const label = stockLabel(level);
  const items = listItemOptions();

  return (
    <div className="page">
      <p className="muted">
        <Link href="/inventory">Inventory</Link>
      </p>
      <header className="detail-head">
        <span className="item-icon" aria-hidden="true">
          {item.icon}
        </span>
        <div>
          <h1>{item.name}</h1>
          <p className="item-qty">{formatQuantity(item.quantityBase, item.baseUnit)}</p>
          <p className="item-meta">
            {formatUnitCost(item.averageCostPerBaseUnit, item.baseUnit)} avg · stock value {formatPeso(item.inventoryValue)}
          </p>
          <p className="muted">
            Minimum {formatQuantity(item.minimumStock, item.baseUnit)}
            {label ? <span className={level === "out" ? "stock-out" : "stock-low"}> · {label}</span> : null}
            {!item.active ? " · Inactive" : ""}
          </p>
          <p className="muted">Added {formatDateWithYear(item.createdAt.slice(0, 10))}</p>
        </div>
      </header>
      <ItemToolbar items={items} itemId={item.id} today={todayISO()} />
      <div className="chips">
        <Link href={`/inventory/${id}`} className={type === "all" ? "chip is-on" : "chip"}>
          All
        </Link>
        {TRANSACTION_TYPES.map((entry) => (
          <Link key={entry} href={`/inventory/${id}?type=${entry}`} className={type === entry ? "chip is-on" : "chip"}>
            {LABELS[entry]}
          </Link>
        ))}
      </div>
      <MovementList rows={history.rows} />
      {history.truncated ? <p className="muted">Showing the latest 300 movements.</p> : null}
    </div>
  );
}
