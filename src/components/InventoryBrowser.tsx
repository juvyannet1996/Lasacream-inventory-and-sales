"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { CATEGORY_LABELS, type Category } from "@/lib/constants";
import { formatUnitCost } from "@/lib/money";
import type { ItemOption } from "@/lib/queries";
import { stockLabel, stockStatus } from "@/lib/stock";
import { formatQuantity } from "@/lib/units";
import { ItemDialog, type ItemDialogState } from "./ItemDialog";

const CATEGORY_ORDER: Category[] = ["ingredient", "packaging", "finished_good", "other"];

export function InventoryBrowser({ items, today }: { items: ItemOption[]; today: string }) {
  const [query, setQuery] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [dialog, setDialog] = useState<ItemDialogState | null>(null);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return items.filter((item) => {
      if (!showInactive && !item.active) return false;
      if (!needle) return true;
      return (
        item.name.toLowerCase().includes(needle) ||
        CATEGORY_LABELS[item.category].toLowerCase().includes(needle)
      );
    });
  }, [items, query, showInactive]);

  return (
    <div className="stack">
      <div className="toolbar">
        <input
          className="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search inventory"
          aria-label="Search inventory"
        />
        <button className="btn btn-primary" type="button" onClick={() => setDialog({ kind: "create" })}>
          Add item
        </button>
      </div>
      <label className="checkline">
        <input type="checkbox" checked={showInactive} onChange={(event) => setShowInactive(event.target.checked)} />
        Show inactive
      </label>
      {filtered.length === 0 ? <p className="muted">No inventory items match.</p> : null}
      {CATEGORY_ORDER.map((category) => {
        const group = filtered.filter((item) => item.category === category);
        if (!group.length) return null;
        return (
          <section key={category}>
            <h2 className="group-label">{CATEGORY_LABELS[category]}</h2>
            <ul className="item-list">
              {group.map((item) => {
                const level = stockStatus(item.quantityBase, item.minimumStock);
                const label = stockLabel(level);
                return (
                  <li key={item.id} className={item.active ? "item-row" : "item-row is-inactive"}>
                    <Link href={`/inventory/${item.id}`} className="item-main">
                      <span className="item-icon" aria-hidden="true">
                        {item.icon}
                      </span>
                      <span>
                        <span className="item-name">{item.name}</span>
                        <span className="item-qty">{formatQuantity(item.quantityBase, item.baseUnit)}</span>
                        <span className="item-meta">{formatUnitCost(item.averageCostPerBaseUnit, item.baseUnit)} avg</span>
                      </span>
                    </Link>
                    <div className="item-side">
                      {label ? <span className={level === "out" ? "stock-out" : "stock-low"}>{label}</span> : null}
                      {!item.active ? <span className="muted">Inactive</span> : null}
                      <div className="button-row">
                        <Link className="btn" href={`/purchases/new?item=${item.id}`}>
                          Purchase
                        </Link>
                        <button
                          type="button"
                          className="btn"
                          onClick={() => setDialog({ kind: "adjust", itemId: item.id, reason: "wastage" })}
                        >
                          Wastage
                        </button>
                        <button type="button" className="btn" onClick={() => setDialog({ kind: "adjust", itemId: item.id })}>
                          Adjust
                        </button>
                        <button type="button" className="btn" onClick={() => setDialog({ kind: "edit", itemId: item.id })}>
                          Edit
                        </button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
      {dialog ? <ItemDialog dialog={dialog} items={items} today={today} onClose={() => setDialog(null)} /> : null}
    </div>
  );
}
