import Link from "next/link";
import { formatDate } from "@/lib/dates";
import { movementTitle, reasonText } from "@/lib/labels";
import { formatPeso, formatUnitCost } from "@/lib/money";
import type { TransactionView } from "@/lib/queries";
import { formatQuantity } from "@/lib/units";

export function MovementList({ rows }: { rows: TransactionView[] }) {
  if (!rows.length) return <p className="muted">No movements in this view.</p>;
  return (
    <ol className="movements">
      {rows.map((row) => {
        const saleLink =
          row.referenceId && (row.referenceType === "sale" || row.referenceType === "sale_reversal")
            ? `/sales/${row.referenceId}`
            : null;
        const reason = reasonText(row.reason);
        return (
          <li key={row.id} className={row.status === "reversed" ? "movement is-reversed" : "movement"}>
            <div className="movement-top">
              <time dateTime={row.occurredAt}>{formatDate(row.occurredAt)}</time>
              <span>{movementTitle(row.type, row.referenceType)}</span>
              {row.status === "reversed" ? <span className="muted">Reversed</span> : null}
            </div>
            <Link href={`/inventory/${row.itemId}`} className="item-name">
              <span aria-hidden="true">{row.itemIcon}</span> {row.itemName}
            </Link>
            <p className="item-qty">{formatQuantity(row.quantityBase, row.baseUnit, { signed: true })}</p>
            {row.type === "purchase" && row.purchaseCost !== null ? (
              <p className="muted">
                {formatPeso(row.purchaseCost)}
                {row.purchaseUnitCost !== null ? ` · ${formatUnitCost(row.purchaseUnitCost, row.baseUnit)}` : ""}
                {row.supplier ? ` · ${row.supplier}` : ""}
              </p>
            ) : null}
            {row.notes ? (
              <p className="muted">{saleLink ? <Link href={saleLink}>{row.notes}</Link> : row.notes}</p>
            ) : null}
            {reason ? <p className="muted">{reason}</p> : null}
          </li>
        );
      })}
    </ol>
  );
}
