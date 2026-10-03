import Link from "next/link";
import { formatPeso } from "@/lib/money";
import { listProductOptions } from "@/lib/queries";

export const metadata = { title: "Products" };

export default async function ProductsPage() {
  const products = await listProductOptions();
  return (
    <div className="page">
      <header className="page-header">
        <h1>Products</h1>
        <Link className="btn btn-primary" href="/products/new">
          Add product
        </Link>
      </header>
      {products.length === 0 ? <p className="muted">No active products yet.</p> : null}
      <ul className="item-list">
        {products.map((product) => (
          <li key={product.id}>
            <Link href={`/products/${product.id}`} className={product.active ? "item-main" : "item-main is-inactive"}>
              <span className="item-icon" aria-hidden="true">
                {product.icon}
              </span>
              <span>
                <span className="item-name">{product.name}</span>
                <span className="item-meta">
                  {product.recipe.length === 0
                    ? "No default recipe"
                    : `${product.recipe.length} ingredient${product.recipe.length === 1 ? "" : "s"}`}
                  {product.defaultPrice !== null ? ` · ${formatPeso(product.defaultPrice)}` : ""}
                  {!product.active ? " · Inactive" : ""}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
