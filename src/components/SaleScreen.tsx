import { notFound } from "next/navigation";
import { todayISO } from "@/lib/dates";
import { listItemOptions, listProductOptions } from "@/lib/queries";
import { getSale } from "@/lib/sales";
import { SaleForm, type SaleFormInitial } from "./SaleForm";

export function SaleScreen({ saleId }: { saleId?: string }) {
  const items = listItemOptions();
  const products = listProductOptions();
  const today = todayISO();
  const sale = saleId ? getSale(saleId) : null;
  if (saleId && !sale) notFound();
  if (sale?.status === "voided") {
    return (
      <div className="empty">
        <h1>This sale is voided</h1>
        <p className="muted">Voided sales stay on record, but they can’t be edited.</p>
        <a className="btn" href={`/sales/${sale.id}`}>
          Back to sale
        </a>
      </div>
    );
  }

  const initial: SaleFormInitial | null = sale
    ? {
        id: sale.id,
        soldAt: sale.soldAt,
        customerName: sale.customerName ?? "",
        notes: sale.notes ?? "",
        lines: sale.lines.map((line) => ({
          id: line.id,
          productId: line.productId ?? "",
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          consumptions: line.consumptions.map((consumption) => ({
            itemId: consumption.itemId,
            quantityBase: consumption.quantityBase,
          })),
        })),
      }
    : null;

  return (
    <div className="page">
      <header className="page-header">
        <h1>{sale ? "Edit sale" : "New sale"}</h1>
      </header>
      <SaleForm items={items} products={products} today={today} initial={initial} />
    </div>
  );
}
