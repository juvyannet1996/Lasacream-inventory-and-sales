import Link from "next/link";
import { formatDate } from "@/lib/dates";
import { formatPeso } from "@/lib/money";
import type { PurchaseReceiptView } from "@/lib/queries";
import { formatNumber } from "@/lib/units";

export function PurchaseReceiptList({ receipts }: { receipts: PurchaseReceiptView[] }) {
  if (!receipts.length) return <p className="muted">No purchases in this view.</p>;
  return (
    <ol className="movements">
      {receipts.map((receipt) => (
        <li key={receipt.id} className="movement">
          <div className="movement-top">
            <time dateTime={receipt.purchasedAt}>{formatDate(receipt.purchasedAt)}</time>
            <span>Purchase</span>
            <strong>{formatPeso(receipt.totalCost)}</strong>
          </div>
          {receipt.supplier ? <p className="item-name">{receipt.supplier}</p> : null}
          {receipt.notes ? <p className="muted">{receipt.notes}</p> : null}
          <ul className="plain-list">
            {receipt.lines.map((line) => (
              <li key={line.id}>
                <Link href={`/inventory/${line.itemId}`}>
                  <span aria-hidden="true">{line.itemIcon}</span> {line.itemName}
                </Link>
                <span className="muted">
                  {formatNumber(line.quantityInput)} {line.inputUnit} · {formatPeso(line.purchaseCost)}
                </span>
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ol>
  );
}
