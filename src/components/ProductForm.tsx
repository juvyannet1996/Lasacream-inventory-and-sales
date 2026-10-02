"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { saveProductAction } from "@/app/actions";
import type { ItemOption, ProductOption } from "@/lib/queries";
import { convertToBase, formatAmountInput, preferredInput } from "@/lib/units";
import { Field } from "./Field";
import { IconPicker } from "./IconPicker";
import { IngredientEditor, type IngredientDraft } from "./IngredientEditor";

export function ProductForm({
  items,
  initial,
  compact = false,
  onSaved,
  onCancel,
  onItemCreated,
}: {
  items: ItemOption[];
  initial?: Partial<ProductOption> & { name?: string };
  compact?: boolean;
  onSaved?: (product: ProductOption) => void;
  onCancel?: () => void;
  onItemCreated?: (item: ItemOption) => void;
}) {
  const router = useRouter();
  const [catalog, setCatalog] = useState(items);
  const [name, setName] = useState(initial?.name ?? "");
  const [icon, setIcon] = useState(initial?.icon ?? "🎂");
  const [priceText, setPriceText] = useState(
    initial?.defaultPrice === null || initial?.defaultPrice === undefined ? "" : formatAmountInput(initial.defaultPrice),
  );
  const [active, setActive] = useState(initial?.active ?? true);
  const [rows, setRows] = useState<IngredientDraft[]>(() =>
    (initial?.recipe ?? []).map((line) => {
      const item = items.find((entry) => entry.id === line.itemId);
      const preferred = preferredInput(line.quantityBase, item?.baseUnit ?? "g");
      return {
        key: crypto.randomUUID(),
        itemId: line.itemId,
        unit: preferred.unit,
        amountText: formatAmountInput(preferred.amount),
      };
    }),
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setSaved(false);
    const recipe: { itemId: string; quantityBase: number }[] = [];
    for (const row of rows) {
      if (!row.itemId && !row.amountText.trim()) continue;
      const item = catalog.find((entry) => entry.id === row.itemId);
      if (!item) {
        setPending(false);
        setError("Choose an inventory item for each recipe row.");
        return;
      }
      try {
        recipe.push({ itemId: item.id, quantityBase: convertToBase(Number(row.amountText), row.unit, item.baseUnit) });
      } catch (caught) {
        setPending(false);
        setError(caught instanceof Error ? caught.message : "Enter a valid recipe quantity.");
        return;
      }
    }
    const defaultPrice = priceText.trim() ? Number(priceText) : null;
    const result = await saveProductAction({
      id: initial?.id,
      name,
      icon,
      defaultPrice,
      active,
      recipe,
    });
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    if (onSaved) onSaved(result.data);
    else {
      setSaved(true);
      router.refresh();
      if (!initial?.id) router.push(`/products/${result.data.id}`);
    }
  }

  return (
    <form className="stack" onSubmit={onSubmit}>
      {error ? <p className="error">{error}</p> : null}
      {saved ? <p className="preview">Saved.</p> : null}
      <Field label="Product name">
        <input value={name} onChange={(event) => setName(event.target.value)} required />
      </Field>
      <Field label="Icon">
        <IconPicker value={icon} onChange={setIcon} />
      </Field>
      <Field label="Default selling price (₱)" hint="Optional. Each sale can use a different price.">
        <input inputMode="decimal" value={priceText} onChange={(event) => setPriceText(event.target.value)} placeholder="Optional" />
      </Field>
      <section className="stack">
        <h2 className="group-label">{compact ? "Recipe (optional)" : "Recipe per item sold"}</h2>
        <IngredientEditor
          items={catalog}
          rows={rows}
          onChange={setRows}
          addLabel="Add ingredient"
          onItemCreated={(item) => {
            setCatalog((current) => [...current, item]);
            onItemCreated?.(item);
          }}
        />
      </section>
      {initial?.id ? (
        <label className="checkline">
          <input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} />
          Active
        </label>
      ) : null}
      <div className="button-row">
        <button className="btn btn-primary" type="submit" disabled={pending}>
          {pending ? "Saving…" : initial?.id ? "Save product" : "Create product"}
        </button>
        {onCancel ? (
          <button className="btn" type="button" onClick={onCancel}>
            Cancel
          </button>
        ) : null}
      </div>
    </form>
  );
}
