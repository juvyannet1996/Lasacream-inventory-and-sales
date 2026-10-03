import Link from "next/link";
import { PurchaseReceiptForm } from "@/components/PurchaseReceiptForm";
import { todayISO } from "@/lib/dates";
import { listItemOptions } from "@/lib/queries";
import { one } from "@/lib/search";

export const metadata = { title: "Record purchase" };

export default async function NewPurchasePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const items = await listItemOptions();
  const requested = one(params.item);
  const initialItemId = requested && items.some((item) => item.id === requested) ? requested : undefined;
  return (
    <div className="page">
      <p className="muted">
        <Link href="/inventory">Inventory</Link>
      </p>
      <header className="page-header">
        <h1>Record purchase</h1>
      </header>
      <p className="muted">Add every item from the same trip. One save updates all of them.</p>
      <PurchaseReceiptForm items={items} today={todayISO()} initialItemId={initialItemId} />
    </div>
  );
}
