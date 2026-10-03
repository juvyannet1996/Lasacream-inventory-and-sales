"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createPurchaseReceiptAction } from "@/app/actions";
import type { InputUnit } from "@/lib/constants";
import { formatPeso, formatUnitCost } from "@/lib/money";
import type { ItemOption } from "@/lib/queries";
import { applyInbound } from "@/lib/costing";
import { convertToBase, defaultInputUnit, formatQuantity, unitsForBase } from "@/lib/units";
import { Combobox } from "./Combobox";
import { Field } from "./Field";

type DraftLine = {
  key: string;
  itemId: string;
  amountText: string;
  unit: InputUnit;
  costText: string;
};

function blankLine(item?: ItemOption): DraftLine {
  return {
    key: crypto.randomUUID(),
    itemId: item?.id ?? "",
    amountText: "",
    unit: item ? defaultInputUnit(item.baseUnit, "purchase") : "kg",
    costText: "",
  };
}

export function PurchaseReceiptForm({
  items,
  today,
  initialItemId,
}: {
  items: ItemOption[];
  today: string;
  initialItemId?: string;
}) {
  const router = useRouter();
  const initialItem = items.find((item) => item.id === initialItemId);
  const [date, setDate] = useState(today);
  const [supplier, setSupplier] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<DraftLine[]>(() => [blankLine(initialItem)]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const options = items
    .filter((item) => item.active)
    .map((item) => ({
      id: item.id,
      label: item.name,
      icon: item.icon,
      hint: formatQuantity(item.quantityBase, item.baseUnit),
    }));

  const total = useMemo(() => {
    return lines.reduce((sum, line) => {
      const cost = Number(line.costText);
      return Number.isFinite(cost) && cost >= 0 && line.costText.trim() ? sum + cost : sum;
    }, 0);
  }, [lines]);

  function chooseItem(key: string, itemId: string) {
    const item = items.find((entry) => entry.id === itemId);
    setLines((current) =>
      current.map((line) =>
        line.key === key
          ? { ...line, itemId, unit: item ? defaultInputUnit(item.baseUnit, "purchase") : line.unit }
          : line,
      ),
    );
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    const filled = lines.filter((line) => line.itemId || line.amountText.trim() || line.costText.trim());
    if (!filled.length) {
      setError("Add an item to this purchase.");
      return;
    }
    setPending(true);
    setError(null);
    const result = await createPurchaseReceiptAction({
      date,
      supplier,
      notes,
      lines: filled.map((line) => ({
        itemId: line.itemId,
        amount: Number(line.amountText),
        unit: line.unit,
        cost: Number(line.costText),
      })),
    });
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    router.push("/history?type=purchase");
    router.refresh();
  }

  return (
    <form className="stack" onSubmit={onSubmit}>
      {error ? <p className="error">{error}</p> : null}
      <div className="grid-2">
        <Field label="Date">
          <input type="date" value={date} onChange={(event) => setDate(event.target.value)} required />
        </Field>
        <Field label="Supplier">
          <input value={supplier} onChange={(event) => setSupplier(event.target.value)} placeholder="Optional" />
        </Field>
      </div>
      {lines.map((line, index) => {
        const item = items.find((entry) => entry.id === line.itemId);
        const amount = Number(line.amountText);
        const cost = Number(line.costText);
        let preview: string | null = null;
        if (item && line.amountText.trim() && line.costText.trim() && amount > 0 && Number.isFinite(cost) && cost >= 0) {
          try {
            const quantityBase = convertToBase(amount, line.unit, item.baseUnit);
            const earlier = lines.slice(0, index).reduce(
              (state, previous) => {
                if (previous.itemId !== item.id) return state;
                const previousAmount = Number(previous.amountText);
                const previousCost = Number(previous.costText);
                if (!(previousAmount > 0) || !(previousCost >= 0)) return state;
                const added = convertToBase(previousAmount, previous.unit, item.baseUnit);
                return applyInbound(state, added, previousCost);
              },
              {
                quantityBase: item.quantityBase,
                inventoryValue: item.inventoryValue,
                averageCostPerBaseUnit: item.averageCostPerBaseUnit,
              },
            );
            const next = applyInbound(earlier, quantityBase, cost);
            preview = `Stock becomes ${formatQuantity(next.quantityBase, item.baseUnit)} at ${formatUnitCost(next.averageCostPerBaseUnit, item.baseUnit)} average.`;
          } catch {
            preview = null;
          }
        }
        return (
          <section key={line.key} className="sale-block">
            <Field label={lines.length > 1 ? `Item ${index + 1}` : "Item"}>
              <Combobox
                ariaLabel="Inventory item"
                placeholder="Search inventory"
                options={options}
                value={line.itemId || null}
                onChange={(id) => chooseItem(line.key, id)}
              />
            </Field>
            <Field label="Quantity">
              <div className="qty-line">
                <input
                  inputMode="decimal"
                  value={line.amountText}
                  onChange={(event) =>
                    setLines((current) =>
                      current.map((entry) => (entry.key === line.key ? { ...entry, amountText: event.target.value } : entry)),
                    )
                  }
                  required
                />
                <select
                  aria-label="Purchase unit"
                  value={line.unit}
                  onChange={(event) =>
                    setLines((current) =>
                      current.map((entry) =>
                        entry.key === line.key ? { ...entry, unit: event.target.value as InputUnit } : entry,
                      ),
                    )
                  }
                  disabled={!item}
                >
                  {(item ? unitsForBase(item.baseUnit) : [line.unit]).map((entry) => (
                    <option key={entry} value={entry}>
                      {entry}
                    </option>
                  ))}
                </select>
              </div>
            </Field>
            <Field label="Cost (₱)" hint="Total paid for this item">
              <input
                inputMode="decimal"
                value={line.costText}
                onChange={(event) =>
                  setLines((current) =>
                    current.map((entry) => (entry.key === line.key ? { ...entry, costText: event.target.value } : entry)),
                  )
                }
                required
              />
            </Field>
            {preview ? <p className="preview">{preview}</p> : null}
            {lines.length > 1 ? (
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setLines((current) => current.filter((entry) => entry.key !== line.key))}
              >
                Remove item
              </button>
            ) : null}
          </section>
        );
      })}
      <button type="button" className="btn" onClick={() => setLines((current) => [...current, blankLine()])}>
        Add another item
      </button>
      <Field label="Notes">
        <textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Optional" rows={2} />
      </Field>
      <p className="preview">Receipt total {formatPeso(total)}. Stock updates when you save.</p>
      <div className="button-row">
        <button className="btn btn-primary" type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save purchase"}
        </button>
        <button className="btn" type="button" onClick={() => router.push("/inventory")}>
          Cancel
        </button>
      </div>
    </form>
  );
}
