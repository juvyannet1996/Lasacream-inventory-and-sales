"use client";

import { useRouter } from "next/navigation";
import type { ItemOption } from "@/lib/queries";
import { Combobox } from "./Combobox";

export function HistoryItemFilter({
  items,
  itemId,
  preserved,
}: {
  items: ItemOption[];
  itemId?: string;
  preserved: string;
}) {
  const router = useRouter();
  return (
    <div className="history-item">
      <Combobox
        ariaLabel="Filter by item"
        placeholder="All items"
        options={items.map((item) => ({ id: item.id, label: item.name, icon: item.icon }))}
        value={itemId ?? null}
        onChange={(id) => {
          const params = new URLSearchParams(preserved);
          params.set("item", id);
          router.push(`/history?${params.toString()}`);
        }}
      />
      {itemId ? (
        <button
          type="button"
          className="btn"
          onClick={() => {
            const params = new URLSearchParams(preserved);
            params.delete("item");
            const query = params.toString();
            router.push(query ? `/history?${query}` : "/history");
          }}
        >
          Clear
        </button>
      ) : null}
    </div>
  );
}
