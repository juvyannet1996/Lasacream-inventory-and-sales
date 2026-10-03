import Link from "next/link";
import { notFound } from "next/navigation";
import { ProductForm } from "@/components/ProductForm";
import { listItemOptions, listProductOptions } from "@/lib/queries";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const product = (await listProductOptions()).find((entry) => entry.id === id);
  return { title: product?.name ?? "Product" };
}

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const products = await listProductOptions();
  const product = products.find((entry) => entry.id === id);
  if (!product) notFound();
  return (
    <div className="page">
      <p className="muted">
        <Link href="/products">Products</Link>
      </p>
      <header className="page-header">
        <h1>
          {product.icon} {product.name}
        </h1>
      </header>
      <ProductForm items={await listItemOptions()} initial={product} />
    </div>
  );
}
