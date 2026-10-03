import { ProductForm } from "@/components/ProductForm";
import { listItemOptions } from "@/lib/queries";

export const metadata = { title: "New product" };

export default async function NewProductPage() {
  const items = await listItemOptions();
  return (
    <div className="page">
      <header className="page-header">
        <h1>New product</h1>
      </header>
      <ProductForm items={items} />
    </div>
  );
}
