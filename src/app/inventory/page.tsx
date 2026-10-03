import Link from "next/link";
import { InventoryBrowser } from "@/components/InventoryBrowser";
import { todayISO } from "@/lib/dates";
import { listItemOptions } from "@/lib/queries";

export const metadata = { title: "Inventory" };

export default async function InventoryPage() {
  const items = await listItemOptions();
  return (
    <div className="page">
      <header className="page-header">
        <h1>Inventory</h1>
        <Link className="btn btn-primary" href="/purchases/new">
          Record purchase
        </Link>
      </header>
      <InventoryBrowser items={items} today={todayISO()} />
    </div>
  );
}
