"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { saveSaleAction } from "@/app/actions";
import { formatPeso } from "@/lib/money";
import type { ItemOption, ProductOption } from "@/lib/queries";
import { convertToBase, formatAmountInput, preferredInput } from "@/lib/units";
import { Field } from "./Field";
import { IngredientEditor, type IngredientDraft } from "./IngredientEditor";
import { Modal } from "./Modal";
import { ProductForm } from "./ProductForm";
import { Combobox } from "./Combobox";

type DraftLine = {
  key: string;
  id?: string;
  productId: string;
  quantityText: string;
  unitPriceText: string;
  basisQuantity: number;
  consumptions: IngredientDraft[];
};

export type SaleFormInitial = {
  id: string;
  soldAt: string;
  customerName: string;
  notes: string;
  lines: {
    id: string;
    productId: string;
    quantity: number;
    unitPrice: number;
    consumptions: { itemId: string; quantityBase: number }[];
  }[];
};

function blankLine(): DraftLine {
  return {
    key: crypto.randomUUID(),
    productId: "",
    quantityText: "1",
    unitPriceText: "",
    basisQuantity: 1,
    consumptions: [],
  };
}

function toDraft(itemId: string, quantityBase: number, items: ItemOption[]): IngredientDraft {
  const item = items.find((entry) => entry.id === itemId);
  const preferred = preferredInput(quantityBase, item?.baseUnit ?? "g");
  return {
    key: crypto.randomUUID(),
    itemId,
    unit: preferred.unit,
    amountText: formatAmountInput(preferred.amount),
  };
}

export function SaleForm({
  items,
  products,
  today,
  initial,
}: {
  items: ItemOption[];
  products: ProductOption[];
  today: string;
  initial: SaleFormInitial | null;
}) {
  const router = useRouter();
  const [catalogItems, setCatalogItems] = useState(items);
  const [catalogProducts, setCatalogProducts] = useState(products);
  const [recipes, setRecipes] = useState<Record<string, { itemId: string; quantityBase: number }[]>>(() =>
    Object.fromEntries(products.map((product) => [product.id, product.recipe])),
  );
  const [soldAt, setSoldAt] = useState(initial?.soldAt ?? today);
  const [customerName, setCustomerName] = useState(initial?.customerName ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [lines, setLines] = useState<DraftLine[]>(() =>
    initial
      ? initial.lines.map((line) => ({
          key: line.id,
          id: line.id,
          productId: line.productId,
          quantityText: formatAmountInput(line.quantity),
          unitPriceText: formatAmountInput(line.unitPrice),
          basisQuantity: line.quantity,
          consumptions: line.consumptions.map((consumption) => toDraft(consumption.itemId, consumption.quantityBase, items)),
        }))
      : [blankLine()],
  );
  const [adding, setAdding] = useState<{ lineKey: string; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function chooseProduct(lineKey: string, productId: string, productList = catalogProducts, recipeMap = recipes, itemList = catalogItems) {
    const product = productList.find((entry) => entry.id === productId);
    if (!product) return;
    setLines((current) =>
      current.map((line) => {
        if (line.key !== lineKey) return line;
        const qty = Number(line.quantityText);
        const basis = Number.isFinite(qty) && qty > 0 ? qty : 1;
        const recipe = recipeMap[productId] ?? product.recipe ?? [];
        return {
          ...line,
          productId,
          quantityText: Number.isFinite(qty) && qty > 0 ? line.quantityText : "1",
          unitPriceText: product.defaultPrice === null || product.defaultPrice === undefined ? "" : formatAmountInput(product.defaultPrice),
          basisQuantity: basis,
          consumptions: recipe.map((entry) => toDraft(entry.itemId, entry.quantityBase * basis, itemList)),
        };
      }),
    );
  }

  function changeQty(lineKey: string, quantityText: string) {
    setLines((current) =>
      current.map((line) => {
        if (line.key !== lineKey) return line;
        const next = Number(quantityText);
        if (!quantityText.trim() || !Number.isFinite(next) || next <= 0 || !(line.basisQuantity > 0)) {
          return { ...line, quantityText };
        }
        if (Math.abs(next - line.basisQuantity) < 1e-9) return { ...line, quantityText };
        const factor = next / line.basisQuantity;
        return {
          ...line,
          quantityText,
          basisQuantity: next,
          consumptions: line.consumptions.map((consumption) => ({
            ...consumption,
            amountText:
              consumption.amountText.trim() && Number.isFinite(Number(consumption.amountText))
                ? formatAmountInput(Number(consumption.amountText) * factor)
                : consumption.amountText,
          })),
        };
      }),
    );
  }

  const estimate = useMemo(() => {
    let price = 0;
    let cost = 0;
    for (const line of lines) {
      if (!line.productId || !line.unitPriceText.trim()) return null;
      const qty = Number(line.quantityText);
      const unitPrice = Number(line.unitPriceText);
      if (!Number.isFinite(qty) || qty <= 0 || !Number.isFinite(unitPrice) || unitPrice < 0) return null;
      price += qty * unitPrice;
      for (const consumption of line.consumptions) {
        if (!consumption.itemId || !consumption.amountText.trim()) continue;
        const item = catalogItems.find((entry) => entry.id === consumption.itemId);
        if (!item) return null;
        const amount = Number(consumption.amountText);
        if (!Number.isFinite(amount) || amount <= 0) return null;
        try {
          cost += convertToBase(amount, consumption.unit, item.baseUnit) * item.averageCostPerBaseUnit;
        } catch {
          return null;
        }
      }
    }
    return { price, cost, profit: price - cost };
  }, [catalogItems, lines]);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    const payloadLines = [];
    for (const line of lines) {
      if (!line.productId) {
        setError("Choose a product.");
        return;
      }
      const quantity = Number(line.quantityText);
      const unitPrice = Number(line.unitPriceText);
      if (!Number.isFinite(quantity) || quantity <= 0) {
        setError("Enter a quantity for each product.");
        return;
      }
      if (!line.unitPriceText.trim() || !Number.isFinite(unitPrice) || unitPrice < 0) {
        setError("Enter a selling price.");
        return;
      }
      const consumptions = [];
      for (const consumption of line.consumptions) {
        if (!consumption.itemId && !consumption.amountText.trim()) continue;
        const item = catalogItems.find((entry) => entry.id === consumption.itemId);
        if (!item) {
          setError("Choose an inventory item for each row.");
          return;
        }
        try {
          consumptions.push({
            itemId: item.id,
            quantityBase: convertToBase(Number(consumption.amountText), consumption.unit, item.baseUnit),
          });
        } catch (caught) {
          setError(caught instanceof Error ? caught.message : "Enter a valid quantity.");
          return;
        }
      }
      payloadLines.push({ id: line.id, productId: line.productId, quantity, unitPrice, consumptions });
    }
    setPending(true);
    const result = await saveSaleAction({
      id: initial?.id,
      soldAt,
      customerName,
      notes,
      lines: payloadLines,
    });
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    router.push(`/sales/${result.data.id}`);
    router.refresh();
  }

  return (
    <>
    <form className="stack" onSubmit={onSubmit}>
      {error ? <p className="error">{error}</p> : null}
      <div className="grid-2">
        <Field label="Date">
          <input type="date" value={soldAt} onChange={(event) => setSoldAt(event.target.value)} required />
        </Field>
        <Field label="Customer name">
          <input value={customerName} onChange={(event) => setCustomerName(event.target.value)} placeholder="Optional" />
        </Field>
      </div>
      {lines.map((line, index) => {
        const options = catalogProducts
          .filter((product) => product.active || product.id === line.productId)
          .map((product) => ({ id: product.id, label: product.name, icon: product.icon }));
        return (
          <section key={line.key} className="sale-block">
            <Field label={lines.length > 1 ? `Product ${index + 1}` : "Product"}>
              <Combobox
                ariaLabel="Product"
                placeholder="Search products"
                options={options}
                value={line.productId || null}
                onChange={(id) => chooseProduct(line.key, id)}
                onCreate={(query) => setAdding({ lineKey: line.key, name: query })}
                createLabel="+ Add Product"
              />
            </Field>
            <div className="grid-2">
              <Field label="Quantity">
                <input inputMode="decimal" value={line.quantityText} onChange={(event) => changeQty(line.key, event.target.value)} />
              </Field>
              <Field label="Selling price (₱)">
                <input
                  inputMode="decimal"
                  value={line.unitPriceText}
                  onChange={(event) =>
                    setLines((current) =>
                      current.map((entry) => (entry.key === line.key ? { ...entry, unitPriceText: event.target.value } : entry)),
                    )
                  }
                />
              </Field>
            </div>
            <h2 className="group-label">Ingredients / items used</h2>
            <IngredientEditor
              items={catalogItems}
              rows={line.consumptions}
              onChange={(consumptions) =>
                setLines((current) => current.map((entry) => (entry.key === line.key ? { ...entry, consumptions } : entry)))
              }
              onItemCreated={(item) => setCatalogItems((current) => [...current, item])}
              addLabel="Add item"
            />
            {lines.length > 1 ? (
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setLines((current) => current.filter((entry) => entry.key !== line.key))}
              >
                Remove product
              </button>
            ) : null}
          </section>
        );
      })}
      <button type="button" className="btn" onClick={() => setLines((current) => [...current, blankLine()])}>
        Add another product
      </button>
      <Field label="Notes">
        <textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Optional" rows={2} />
      </Field>
      {estimate ? (
        <p className="preview">
          Estimated ingredient cost {formatPeso(estimate.cost)} · profit {formatPeso(estimate.profit)}. Inventory updates when you
          save the sale.
        </p>
      ) : (
        <p className="muted">Inventory updates when you save the sale.</p>
      )}
      <div className="button-row">
        <button className="btn btn-primary" type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save sale"}
        </button>
        <button className="btn" type="button" onClick={() => router.push("/sales")}>
          Cancel
        </button>
      </div>
    </form>
    {adding ? (
      <Modal title="Add product" onClose={() => setAdding(null)}>
        <ProductForm
          compact
          items={catalogItems}
          initial={{ name: adding.name }}
          onCancel={() => setAdding(null)}
          onItemCreated={(item) => setCatalogItems((current) => [...current, item])}
          onSaved={(product) => {
            const lineKey = adding.lineKey;
            const nextProducts = [...catalogProducts, product];
            const nextRecipes = { ...recipes, [product.id]: product.recipe };
            setCatalogProducts(nextProducts);
            setRecipes(nextRecipes);
            setAdding(null);
            chooseProduct(lineKey, product.id, nextProducts, nextRecipes, catalogItems);
          }}
        />
      </Modal>
    ) : null}
    </>
  );
}
