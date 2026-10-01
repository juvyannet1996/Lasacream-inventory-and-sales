import Link from "next/link";
import { notFound } from "next/navigation";
import { SaveRecipeButton, VoidSaleButton } from "@/components/SaleActions";
import { formatDateWithYear } from "@/lib/dates";
import { formatPeso, formatUnitCost } from "@/lib/money";
import { listProductOptions } from "@/lib/queries";
import { getSale } from "@/lib/sales";
import { formatNumber, formatQuantity } from "@/lib/units";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sale = getSale(id);
  return { title: sale ? formatDateWithYear(sale.soldAt) : "Sale" };
}

export default async function SalePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sale = getSale(id);
  if (!sale) notFound();
  const recipes = new Map(listProductOptions().map((product) => [product.id, product.recipe.length > 0]));

  return (
    <div className="page">
      <p className="muted">
        <Link href="/sales">Sales</Link>
      </p>
      <header className="page-header">
        <div>
          <h1>{formatDateWithYear(sale.soldAt)}</h1>
          <p className="muted">
            {sale.customerName ? sale.customerName : "No customer name"}
            {sale.status === "voided" ? " · Voided" : ""}
          </p>
        </div>
        {sale.status === "completed" ? (
          <Link className="btn" href={`/sales/${sale.id}/edit`}>
            Edit
          </Link>
        ) : null}
      </header>
      {sale.notes ? <p>{sale.notes}</p> : null}
      <section className="stats">
        <article className="stat">
          <p className="stat-label">Total</p>
          <p className="stat-value">{formatPeso(sale.totalPrice)}</p>
        </article>
        <article className="stat">
          <p className="stat-label">Estimated cost</p>
          <p className="stat-value">{formatPeso(sale.estimatedCost)}</p>
        </article>
        <article className="stat">
          <p className="stat-label">Estimated profit</p>
          <p className="stat-value">{formatPeso(sale.estimatedProfit)}</p>
        </article>
      </section>
      {sale.lines.map((line) => (
        <section key={line.id} className="card stack">
          <h2>
            {line.productIcon} {line.productName} × {formatNumber(line.quantity)}
          </h2>
          <p className="muted">
            {formatPeso(line.unitPrice)} each · {formatPeso(line.lineTotal)} · cost {formatPeso(line.estimatedCost)}
          </p>
          {line.consumptions.length === 0 ? <p className="muted">No inventory items were recorded for this product.</p> : null}
          <ul className="plain-list">
            {line.consumptions.map((consumption) => (
              <li key={consumption.id}>
                <Link href={`/inventory/${consumption.itemId}`}>
                  <span aria-hidden="true">{consumption.itemIcon}</span> {consumption.itemName}
                </Link>
                <span className="muted">
                  {formatQuantity(consumption.quantityBase, consumption.baseUnit)} · {formatPeso(consumption.totalCost)} ·{" "}
                  {formatUnitCost(consumption.unitCostPerBase, consumption.baseUnit)}
                </span>
              </li>
            ))}
          </ul>
          {sale.status === "completed" && line.productId ? (
            <SaveRecipeButton saleId={sale.id} lineId={line.id} hasRecipe={recipes.get(line.productId) ?? false} />
          ) : null}
        </section>
      ))}
      {sale.status === "completed" ? <VoidSaleButton saleId={sale.id} /> : null}
    </div>
  );
}
