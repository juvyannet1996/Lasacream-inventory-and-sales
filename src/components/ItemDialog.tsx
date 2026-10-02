"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createAdjustmentAction, createItemAction, createPurchaseAction, updateItemAction } from "@/app/actions";
import {
  ADJUSTMENT_REASONS,
  CATEGORIES,
  CATEGORY_LABELS,
  REASON_LABELS,
  type AdjustmentReason,
  type BaseUnit,
  type Category,
  type InputUnit,
} from "@/lib/constants";
import { applyInbound, applyOutbound, currentAverage } from "@/lib/costing";
import type { ItemOption } from "@/lib/queries";
import { stockLabel, stockStatus } from "@/lib/stock";
import {
  convertToBase,
  defaultInputUnit,
  formatAmountInput,
  formatQuantity,
  fromBase,
  measurementLabel,
  preferredInput,
  unitsForBase,
} from "@/lib/units";
import { formatUnitCost } from "@/lib/money";
import { Combobox } from "./Combobox";
import { Field } from "./Field";
import { IconPicker } from "./IconPicker";
import { Modal } from "./Modal";

export type ItemDialogState =
  | { kind: "create" }
  | { kind: "edit"; itemId: string }
  | { kind: "purchase"; itemId?: string }
  | { kind: "adjust"; itemId?: string; reason?: AdjustmentReason };

export function ItemDialog({
  dialog,
  items,
  today,
  onClose,
}: {
  dialog: ItemDialogState;
  items: ItemOption[];
  today: string;
  onClose: () => void;
}) {
  const title =
    dialog.kind === "create"
      ? "New inventory item"
      : dialog.kind === "edit"
        ? "Edit item"
        : dialog.kind === "purchase"
          ? "Purchase stock"
          : dialog.reason === "wastage"
            ? "Record wastage"
            : "Stock adjustment";
  return (
    <Modal title={title} onClose={onClose}>
      {dialog.kind === "create" || dialog.kind === "edit" ? (
        <ItemForm
          item={dialog.kind === "edit" ? items.find((entry) => entry.id === dialog.itemId) : undefined}
          onClose={onClose}
        />
      ) : null}
      {dialog.kind === "purchase" ? (
        <PurchaseForm items={items} itemId={dialog.itemId} today={today} onClose={onClose} />
      ) : null}
      {dialog.kind === "adjust" ? (
        <AdjustmentForm
          items={items}
          itemId={dialog.itemId}
          today={today}
          initialReason={dialog.reason ?? "count_correction"}
          onClose={onClose}
        />
      ) : null}
    </Modal>
  );
}

function useRefreshClose(onClose: () => void) {
  const router = useRouter();
  return () => {
    router.refresh();
    onClose();
  };
}

function ItemForm({ item, onClose }: { item?: ItemOption; onClose: () => void }) {
  const done = useRefreshClose(onClose);
  const [name, setName] = useState(item?.name ?? "");
  const [icon, setIcon] = useState(item?.icon ?? "📦");
  const [category, setCategory] = useState<Category>(item?.category ?? "ingredient");
  const [baseUnit, setBaseUnit] = useState<BaseUnit>(item?.baseUnit ?? "g");
  const initialMin = item ? preferredInput(item.minimumStock, item.baseUnit) : { amount: 0, unit: defaultInputUnit(baseUnit, "purchase") };
  const [minText, setMinText] = useState(item ? formatAmountInput(initialMin.amount) : "");
  const [minUnit, setMinUnit] = useState<InputUnit>(initialMin.unit);
  const [active, setActive] = useState(item?.active ?? true);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const locked = Boolean(item?.hasMovements);

  function changeBase(next: BaseUnit) {
    setBaseUnit(next);
    setMinUnit(defaultInputUnit(next, "purchase"));
    setMinText("");
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    let minimumStock = 0;
    if (minText.trim()) {
      try {
        minimumStock = convertToBase(Number(minText), minUnit, baseUnit);
      } catch (caught) {
        setPending(false);
        setError(caught instanceof Error ? caught.message : "Enter a valid minimum.");
        return;
      }
      if (!Number.isFinite(minimumStock) || minimumStock < 0) {
        setPending(false);
        setError("Enter a valid minimum.");
        return;
      }
    }
    const input = { name, icon, category, baseUnit, minimumStock, active };
    const result = item ? await updateItemAction(item.id, input) : await createItemAction(input);
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    done();
  }

  return (
    <form className="stack" onSubmit={onSubmit}>
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
      <fieldset className="choices" disabled={locked}>
        <legend>Measured by</legend>
        {(
          [
            ["g", "Weight (grams)"],
            ["ml", "Volume (milliliters)"],
            ["pcs", "Count (pieces)"],
          ] as const
        ).map(([unit, label]) => (
          <label key={unit}>
            <input type="radio" name="base-unit" checked={baseUnit === unit} onChange={() => changeBase(unit)} />
            {label}
          </label>
        ))}
      </fieldset>
      {locked ? <p className="muted">Unit type stays fixed once stock has been recorded.</p> : null}
      <Field label="Minimum stock" hint={measurementLabel(baseUnit)}>
        <div className="qty-line">
          <input inputMode="decimal" value={minText} placeholder="0" onChange={(event) => setMinText(event.target.value)} />
          <select aria-label="Minimum unit" value={minUnit} onChange={(event) => setMinUnit(event.target.value as InputUnit)}>
            {unitsForBase(baseUnit).map((unit) => (
              <option key={unit} value={unit}>
                {unit}
              </option>
            ))}
          </select>
        </div>
      </Field>
      {item ? (
        <label className="checkline">
          <input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} />
          Active
        </label>
      ) : null}
      <div className="button-row">
        <button className="btn btn-primary" type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save item"}
        </button>
        <button className="btn" type="button" onClick={onClose}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function PurchaseForm({
  items,
  itemId,
  today,
  onClose,
}: {
  items: ItemOption[];
  itemId?: string;
  today: string;
  onClose: () => void;
}) {
  const done = useRefreshClose(onClose);
  const [selectedId, setSelectedId] = useState(itemId ?? "");
  const item = items.find((entry) => entry.id === selectedId);
  const [amountText, setAmountText] = useState("");
  const [unit, setUnit] = useState<InputUnit>(item ? defaultInputUnit(item.baseUnit, "purchase") : "kg");
  const [costText, setCostText] = useState("");
  const [date, setDate] = useState(today);
  const [supplier, setSupplier] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function chooseItem(id: string) {
    const next = items.find((entry) => entry.id === id);
    setSelectedId(id);
    if (next) setUnit(defaultInputUnit(next.baseUnit, "purchase"));
  }

  const preview = useMemo(() => {
    if (!item) return null;
    const amount = Number(amountText);
    const cost = Number(costText);
    if (!amountText.trim() || !costText.trim() || !Number.isFinite(amount) || amount <= 0 || !Number.isFinite(cost) || cost < 0) {
      return null;
    }
    try {
      const quantityBase = convertToBase(amount, unit, item.baseUnit);
      const next = applyInbound(
        {
          quantityBase: item.quantityBase,
          inventoryValue: item.inventoryValue,
          averageCostPerBaseUnit: item.averageCostPerBaseUnit,
        },
        quantityBase,
        cost,
      );
      return { quantityBase, unitCost: cost / quantityBase, next };
    } catch {
      return null;
    }
  }, [amountText, costText, item, unit]);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!item) {
      setError("Choose an inventory item.");
      return;
    }
    setPending(true);
    setError(null);
    const result = await createPurchaseAction({
      itemId: item.id,
      amount: Number(amountText),
      unit,
      cost: Number(costText),
      date,
      supplier,
      notes,
    });
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    done();
  }

  const options = items
    .filter((entry) => entry.active || entry.id === selectedId)
    .map((entry) => ({
      id: entry.id,
      label: entry.name,
      icon: entry.icon,
      hint: formatQuantity(entry.quantityBase, entry.baseUnit),
    }));

  return (
    <form className="stack" onSubmit={onSubmit}>
      {error ? <p className="error">{error}</p> : null}
      <Field label="Item">
        <Combobox ariaLabel="Inventory item" placeholder="Search inventory" options={options} value={selectedId || null} onChange={chooseItem} />
      </Field>
      <Field label="Quantity">
        <div className="qty-line">
          <input inputMode="decimal" value={amountText} onChange={(event) => setAmountText(event.target.value)} required />
          <select
            aria-label="Purchase unit"
            value={unit}
            onChange={(event) => setUnit(event.target.value as InputUnit)}
            disabled={!item}
          >
            {(item ? unitsForBase(item.baseUnit) : ["kg" as InputUnit]).map((entry) => (
              <option key={entry} value={entry}>
                {entry}
              </option>
            ))}
          </select>
        </div>
      </Field>
      <Field label="Purchase cost (₱)" hint="Total paid for this quantity">
        <input inputMode="decimal" value={costText} onChange={(event) => setCostText(event.target.value)} required />
      </Field>
      <div className="grid-2">
        <Field label="Date">
          <input type="date" value={date} onChange={(event) => setDate(event.target.value)} required />
        </Field>
        <Field label="Supplier">
          <input value={supplier} onChange={(event) => setSupplier(event.target.value)} placeholder="Optional" />
        </Field>
      </div>
      <Field label="Notes">
        <textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Optional" rows={2} />
      </Field>
      {preview && item ? (
        <p className="preview">
          Adds {formatQuantity(preview.quantityBase, item.baseUnit)} at {formatUnitCost(preview.unitCost, item.baseUnit)}. Stock
          becomes {formatQuantity(preview.next.quantityBase, item.baseUnit)} at {formatUnitCost(preview.next.averageCostPerBaseUnit, item.baseUnit)}{" "}
          average.
        </p>
      ) : null}
      <div className="button-row">
        <button className="btn btn-primary" type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save purchase"}
        </button>
        <button className="btn" type="button" onClick={onClose}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function AdjustmentForm({
  items,
  itemId,
  today,
  initialReason,
  onClose,
}: {
  items: ItemOption[];
  itemId?: string;
  today: string;
  initialReason: AdjustmentReason;
  onClose: () => void;
}) {
  const done = useRefreshClose(onClose);
  const [selectedId, setSelectedId] = useState(itemId ?? "");
  const item = items.find((entry) => entry.id === selectedId);
  const [amountText, setAmountText] = useState("");
  const [unit, setUnit] = useState<InputUnit>(item ? defaultInputUnit(item.baseUnit, "recipe") : "g");
  const [direction, setDirection] = useState<"add" | "remove">(initialReason === "count_correction" || initialReason === "other" ? "remove" : "remove");
  const [reason, setReason] = useState<AdjustmentReason>(initialReason);
  const [note, setNote] = useState("");
  const [date, setDate] = useState(today);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const removalOnly = reason === "wastage" || reason === "damaged" || reason === "expired" || reason === "personal_use";

  function chooseReason(next: AdjustmentReason) {
    setReason(next);
    if (next === "wastage" || next === "damaged" || next === "expired" || next === "personal_use") setDirection("remove");
  }

  const preview = useMemo(() => {
    if (!item) return null;
    const amount = Number(amountText);
    if (!amountText.trim() || !Number.isFinite(amount) || amount <= 0) return null;
    try {
      const quantityBase = convertToBase(amount, unit, item.baseUnit);
      const state = {
        quantityBase: item.quantityBase,
        inventoryValue: item.inventoryValue,
        averageCostPerBaseUnit: item.averageCostPerBaseUnit,
      };
      if (direction === "remove") return applyOutbound(state, quantityBase).state;
      const average = currentAverage(state);
      return applyInbound(state, quantityBase, quantityBase * average);
    } catch {
      return null;
    }
  }, [amountText, direction, item, unit]);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!item) {
      setError("Choose an inventory item.");
      return;
    }
    setPending(true);
    setError(null);
    const result = await createAdjustmentAction({
      itemId: item.id,
      amount: Number(amountText),
      unit,
      direction: removalOnly ? "remove" : direction,
      reason,
      note,
      date,
    });
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    done();
  }

  const level = item ? stockStatus(item.quantityBase, item.minimumStock) : "ok";

  return (
    <form className="stack" onSubmit={onSubmit}>
      {error ? <p className="error">{error}</p> : null}
      <Field label="Item">
        <Combobox
          ariaLabel="Inventory item"
          placeholder="Search inventory"
          options={items
            .filter((entry) => entry.active || entry.id === selectedId)
            .map((entry) => ({
              id: entry.id,
              label: entry.name,
              icon: entry.icon,
              hint: formatQuantity(entry.quantityBase, entry.baseUnit),
            }))}
          value={selectedId || null}
          onChange={(id) => {
            const next = items.find((entry) => entry.id === id);
            setSelectedId(id);
            if (next && !unitsForBase(next.baseUnit).includes(unit)) setUnit(defaultInputUnit(next.baseUnit, "recipe"));
          }}
        />
      </Field>
      {item ? (
        <p className="muted">
          On hand {formatQuantity(item.quantityBase, item.baseUnit)}
          {stockLabel(level) ? ` · ${stockLabel(level)}` : ""}
        </p>
      ) : null}
      <Field label="Quantity">
        <div className="qty-line">
          <input inputMode="decimal" value={amountText} onChange={(event) => setAmountText(event.target.value)} required />
          <select aria-label="Unit" value={unit} disabled={!item} onChange={(event) => setUnit(event.target.value as InputUnit)}>
            {(item ? unitsForBase(item.baseUnit) : ["g" as InputUnit]).map((entry) => (
              <option key={entry} value={entry}>
                {entry}
              </option>
            ))}
          </select>
        </div>
      </Field>
      <Field label="Effect">
        <select
          value={removalOnly ? "remove" : direction}
          disabled={removalOnly}
          onChange={(event) => setDirection(event.target.value as "add" | "remove")}
        >
          <option value="remove">Remove from stock</option>
          <option value="add">Add to stock</option>
        </select>
      </Field>
      <Field label="Reason">
        <select value={reason} onChange={(event) => chooseReason(event.target.value as AdjustmentReason)}>
          {ADJUSTMENT_REASONS.map((entry) => (
            <option key={entry} value={entry}>
              {REASON_LABELS[entry]}
            </option>
          ))}
        </select>
      </Field>
      <div className="grid-2">
        <Field label="Date">
          <input type="date" value={date} onChange={(event) => setDate(event.target.value)} required />
        </Field>
        <Field label="Note">
          <input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Optional" />
        </Field>
      </div>
      {preview && item ? <p className="preview">Stock will be {formatQuantity(preview.quantityBase, item.baseUnit)}.</p> : null}
      <div className="button-row">
        <button className="btn btn-primary" type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save adjustment"}
        </button>
        <button className="btn" type="button" onClick={onClose}>
          Cancel
        </button>
      </div>
    </form>
  );
}

export function formatStockLine(item: ItemOption): string {
  return `${formatQuantity(item.quantityBase, item.baseUnit)} · ${formatUnitCost(item.averageCostPerBaseUnit, item.baseUnit)} avg`;
}

export function ItemToolbar({ items, itemId, today }: { items: ItemOption[]; itemId: string; today: string }) {
  const [dialog, setDialog] = useState<ItemDialogState | null>(null);
  return (
    <>
      <div className="button-row">
        <button className="btn" type="button" onClick={() => setDialog({ kind: "purchase", itemId })}>
          Purchase
        </button>
        <button className="btn" type="button" onClick={() => setDialog({ kind: "adjust", itemId, reason: "wastage" })}>
          Record wastage
        </button>
        <button className="btn" type="button" onClick={() => setDialog({ kind: "adjust", itemId })}>
          Adjust
        </button>
        <button className="btn" type="button" onClick={() => setDialog({ kind: "edit", itemId })}>
          Edit
        </button>
      </div>
      {dialog ? <ItemDialog dialog={dialog} items={items} today={today} onClose={() => setDialog(null)} /> : null}
    </>
  );
}
