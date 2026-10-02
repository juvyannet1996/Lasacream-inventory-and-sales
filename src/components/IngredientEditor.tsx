"use client";

import { useState } from "react";
import { createItemAction } from "@/app/actions";
import { CATEGORY_LABELS, CATEGORIES, type BaseUnit, type Category, type InputUnit } from "@/lib/constants";
import type { ItemOption } from "@/lib/queries";
import { convertToBase, defaultInputUnit, formatAmountInput, fromBase, unitsForBase } from "@/lib/units";
import { Combobox } from "./Combobox";
import { Field } from "./Field";
import { IconPicker } from "./IconPicker";

export type IngredientDraft = {
  key: string;
  itemId: string;
  unit: InputUnit;
  amountText: string;
};

export function IngredientEditor({
  items,
  rows,
  onChange,
  onItemCreated,
  addLabel = "Add item",
}: {
  items: ItemOption[];
  rows: IngredientDraft[];
  onChange: (rows: IngredientDraft[]) => void;
  onItemCreated?: (item: ItemOption) => void;
  addLabel?: string;
}) {
  const [creating, setCreating] = useState<{ rowKey: string; name: string } | null>(null);

  function update(key: string, patch: Partial<IngredientDraft>) {
    onChange(rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  function pickItem(row: IngredientDraft, itemId: string) {
    const item = items.find((entry) => entry.id === itemId);
    if (!item) return;
    const allowed = unitsForBase(item.baseUnit);
    const keepUnit = allowed.includes(row.unit);
    update(row.key, {
      itemId,
      unit: keepUnit ? row.unit : defaultInputUnit(item.baseUnit, "recipe"),
      amountText: keepUnit ? row.amountText : "",
    });
  }

  function changeUnit(row: IngredientDraft, unit: InputUnit) {
    const item = items.find((entry) => entry.id === row.itemId);
    const amount = Number(row.amountText);
    let amountText = row.amountText;
    if (item && row.amountText.trim() && Number.isFinite(amount)) {
      try {
        amountText = formatAmountInput(fromBase(convertToBase(amount, row.unit, item.baseUnit), unit));
      } catch {
        amountText = "";
      }
    }
    update(row.key, { unit, amountText });
  }

  return (
    <div className="stack">
      {rows.map((row) => {
        const item = items.find((entry) => entry.id === row.itemId);
        const used = new Set(rows.map((entry) => entry.itemId).filter((id) => id && id !== row.itemId));
        const options = items
          .filter((entry) => (entry.active || entry.id === row.itemId) && !used.has(entry.id))
          .map((entry) => ({ id: entry.id, label: entry.name, icon: entry.icon }));
        return (
          <div key={row.key} className="ingredient-row">
            <Combobox
              ariaLabel="Inventory item"
              placeholder="Search inventory"
              options={options}
              value={row.itemId || null}
              onChange={(id) => pickItem(row, id)}
              onCreate={(query) => setCreating({ rowKey: row.key, name: query })}
              createLabel="+ Add item"
            />
            <div className="qty-line">
              <input
                inputMode="decimal"
                aria-label="Quantity"
                value={row.amountText}
                placeholder="Qty"
                onChange={(event) => update(row.key, { amountText: event.target.value })}
              />
              <select
                aria-label="Unit"
                value={item ? row.unit : "g"}
                disabled={!item}
                onChange={(event) => changeUnit(row, event.target.value as InputUnit)}
              >
                {(item ? unitsForBase(item.baseUnit) : ["g" as InputUnit]).map((unit) => (
                  <option key={unit} value={unit}>
                    {unit}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="icon-btn"
                aria-label="Remove item"
                onClick={() => onChange(rows.filter((entry) => entry.key !== row.key))}
              >
                ×
              </button>
            </div>
          </div>
        );
      })}
      {creating ? (
        <QuickItemForm
          initialName={creating.name}
          onCancel={() => setCreating(null)}
          onCreated={(item) => {
            onItemCreated?.(item);
            onChange(
              rows.map((row) =>
                row.key === creating.rowKey
                  ? { ...row, itemId: item.id, unit: defaultInputUnit(item.baseUnit, "recipe"), amountText: "" }
                  : row,
              ),
            );
            setCreating(null);
          }}
        />
      ) : null}
      <button
        type="button"
        className="btn btn-ghost"
        onClick={() =>
          onChange([...rows, { key: crypto.randomUUID(), itemId: "", unit: "g", amountText: "" }])
        }
      >
        {addLabel}
      </button>
    </div>
  );
}

function QuickItemForm({
  initialName,
  onCreated,
  onCancel,
}: {
  initialName: string;
  onCreated: (item: ItemOption) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initialName);
  const [icon, setIcon] = useState("🥣");
  const [category, setCategory] = useState<Category>("ingredient");
  const [baseUnit, setBaseUnit] = useState<BaseUnit>("g");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit() {
    setPending(true);
    setError(null);
    const result = await createItemAction({ name, icon, category, baseUnit, minimumStock: 0 });
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onCreated({ ...result.data, hasMovements: false });
  }

  return (
    <div
      className="quick-form stack"
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          void onSubmit();
        }
      }}
    >
      <strong>New inventory item</strong>
      <p className="muted">Stock starts at zero until you record a purchase.</p>
      {error ? <p className="error">{error}</p> : null}
      <Field label="Name">
        <input value={name} onChange={(event) => setName(event.target.value)} required />
      </Field>
      <Field label="Icon">
        <IconPicker value={icon} onChange={setIcon} />
      </Field>
      <Field label="Category">
        <select value={category} onChange={(event) => setCategory(event.target.value as Category)}>
          {CATEGORIES.map((entry) => (
            <option key={entry} value={entry}>
              {CATEGORY_LABELS[entry]}
            </option>
          ))}
        </select>
      </Field>
      <fieldset className="choices">
        <legend>Measured by</legend>
        {(
          [
            ["g", "Weight"],
            ["ml", "Volume"],
            ["pcs", "Count"],
          ] as const
        ).map(([unit, label]) => (
          <label key={unit}>
            <input type="radio" name="quick-base" checked={baseUnit === unit} onChange={() => setBaseUnit(unit)} />
            {label}
          </label>
        ))}
      </fieldset>
      <div className="button-row">
        <button className="btn btn-primary" type="button" onClick={onSubmit} disabled={pending}>
          {pending ? "Saving…" : "Save item"}
        </button>
        <button className="btn" type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
