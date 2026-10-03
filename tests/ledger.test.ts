import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { applyInbound, applyOutbound } from "../src/lib/costing";
import { getDb, migrate, useD1Simulator, useDatabase } from "../src/lib/db";
import { formatPeso, formatUnitCost } from "../src/lib/money";
import { formatQuantity, convertToBase } from "../src/lib/units";
import { createAdjustment, createItem, createPurchase, createPurchaseReceipt, getItem } from "../src/lib/inventory";
import { getProduct, saveProduct, saveRecipe } from "../src/lib/products";
import { getSale, saveSale, voidSale } from "../src/lib/sales";
import { seedIfEmpty } from "../src/lib/seed";
import { DomainError } from "../src/lib/errors";

function setup(mode: "sqlite" | "d1") {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  migrate(db);
  if (mode === "d1") useD1Simulator(db);
  else useDatabase(db);
}

describe("units and money", () => {
  it("converts purchases into base units and displays practical quantities", () => {
    assert.equal(convertToBase(25, "kg", "g"), 25000);
    assert.equal(convertToBase(500, "g", "g"), 500);
    assert.equal(formatQuantity(25000, "g"), "25 kg");
    assert.equal(formatQuantity(24500, "g"), "24.5 kg");
    assert.equal(formatQuantity(500, "g"), "500 g");
    assert.equal(formatQuantity(184, "pcs"), "184 pcs");
    assert.equal(formatQuantity(-250, "g", { signed: true }), "−250 g");
    assert.equal(formatQuantity(25000, "g", { signed: true }), "+25 kg");
  });

  it("rejects incompatible units", () => {
    assert.throws(() => convertToBase(1, "L", "g"), DomainError);
    assert.throws(() => convertToBase(1, "kg", "pcs"), DomainError);
  });

  it("rounds money only for display", () => {
    assert.equal(formatPeso(57), "₱57");
    assert.equal(formatPeso(57.14), "₱57.14");
    assert.equal(formatPeso(8.25), "₱8.25");
    assert.equal(formatPeso(0.057), "₱0.057");
    assert.equal(formatUnitCost(0.057, "g"), "₱57/kg");
    assert.equal(formatUnitCost(0.057142857, "g"), "₱57.14/kg");
    assert.equal(formatUnitCost(8.25, "pcs"), "₱8.25/pc");
  });
});

describe("weighted average", () => {
  it("blends purchase cost instead of replacing it", () => {
    let state = { quantityBase: 0, inventoryValue: 0, averageCostPerBaseUnit: 0 };
    state = applyInbound(state, 10000, 500);
    assert.equal(state.averageCostPerBaseUnit, 0.05);
    state = applyInbound(state, 25000, 1500);
    assert.equal(state.quantityBase, 35000);
    assert.equal(state.inventoryValue, 2000);
    assert.ok(Math.abs(state.averageCostPerBaseUnit - 2000 / 35000) < 1e-12);
  });

  it("leaves the average unchanged when stock is consumed", () => {
    const start = applyInbound(
      { quantityBase: 0, inventoryValue: 0, averageCostPerBaseUnit: 0 },
      35000,
      2000,
    );
    const moved = applyOutbound(start, 500);
    assert.ok(Math.abs(moved.unitCost - 2000 / 35000) < 1e-12);
    assert.equal(moved.state.quantityBase, 34500);
    assert.ok(Math.abs(moved.state.averageCostPerBaseUnit - start.averageCostPerBaseUnit) < 1e-12);
  });
});

for (const mode of ["sqlite", "d1"] as const) {
  describe(`inventory ledger (${mode})`, () => {
    beforeEach(() => setup(mode));

    it("records a purchase, keeps its unit cost, and recalculates the average", async () => {
      const flour = await createItem({ name: "All-Purpose Flour", category: "ingredient", icon: "🌾", baseUnit: "g" });
      await createPurchase({ itemId: flour.id, amount: 10, unit: "kg", cost: 500, date: "2026-10-01" });
      await createPurchase({ itemId: flour.id, amount: 25, unit: "kg", cost: 1500, date: "2026-10-02" });
      const updated = (await getItem(flour.id))!;
      assert.equal(updated.quantityBase, 35000);
      assert.equal(updated.inventoryValue, 2000);
      assert.ok(Math.abs(updated.averageCostPerBaseUnit - 2000 / 35000) < 1e-12);

      const db = await getDb();
      const rows = (await db
        .prepare("SELECT quantity_base, purchase_cost, unit_cost_per_base FROM purchases ORDER BY purchased_at")
        .all()) as { quantity_base: number; purchase_cost: number; unit_cost_per_base: number }[];
      assert.equal(rows[0].unit_cost_per_base, 500 / 10000);
      assert.equal(rows[1].unit_cost_per_base, 1500 / 25000);
      assert.equal(rows[1].purchase_cost, 1500);
    });

    it("saves several items on one purchase receipt", async () => {
      const flour = await createItem({ name: "All-Purpose Flour", category: "ingredient", icon: "🌾", baseUnit: "g" });
      const sugar = await createItem({ name: "Sugar", category: "ingredient", icon: "🍬", baseUnit: "g" });
      await createPurchaseReceipt({
        date: "2026-10-01",
        supplier: "Market",
        lines: [
          { itemId: flour.id, amount: 1, unit: "kg", cost: 100 },
          { itemId: flour.id, amount: 1, unit: "kg", cost: 300 },
          { itemId: sugar.id, amount: 2, unit: "kg", cost: 80 },
        ],
      });
      const flourAfter = (await getItem(flour.id))!;
      assert.equal(flourAfter.quantityBase, 2000);
      assert.equal(flourAfter.inventoryValue, 400);
      assert.equal((await getItem(sugar.id))!.quantityBase, 2000);
      const db = await getDb();
      const receipts = (await db.prepare("SELECT COUNT(*) AS c FROM purchase_receipts").get()) as { c: number };
      const lines = (await db.prepare("SELECT COUNT(*) AS c FROM purchases WHERE receipt_id IS NOT NULL").get()) as { c: number };
      assert.equal(receipts.c, 1);
      assert.equal(lines.c, 3);
    });

    it("rejects incompatible purchase units and records wastage as a transaction", async () => {
      const flour = await createItem({ name: "All-Purpose Flour", category: "ingredient", icon: "🌾", baseUnit: "g" });
      await createPurchase({ itemId: flour.id, amount: 10, unit: "kg", cost: 500, date: "2026-10-01" });
      await assert.rejects(
        () => createPurchase({ itemId: flour.id, amount: 1, unit: "L", cost: 10, date: "2026-10-01" }),
        /can't be used/,
      );
      await createAdjustment({
        itemId: flour.id,
        amount: 2,
        unit: "kg",
        direction: "remove",
        reason: "damaged",
        note: "Bag tore during storage",
        date: "2026-10-02",
      });
      const updated = (await getItem(flour.id))!;
      assert.equal(updated.quantityBase, 8000);
      const db = await getDb();
      const txn = (await db
        .prepare("SELECT type, quantity_base, reason, notes FROM inventory_transactions WHERE type = 'wastage'")
        .get()) as { type: string; quantity_base: number; reason: string; notes: string };
      assert.equal(txn.type, "wastage");
      assert.equal(txn.quantity_base, -2000);
      assert.equal(txn.reason, "damaged");
      assert.equal(txn.notes, "Bag tore during storage");
      assert.equal(updated.averageCostPerBaseUnit, 0.05);
    });
  });

  describe(`sales (${mode})`, () => {
    beforeEach(() => setup(mode));

    async function stockedFlour() {
      const flour = await createItem({
        name: "All-Purpose Flour",
        category: "ingredient",
        icon: "🌾",
        baseUnit: "g",
        minimumStock: 5000,
      });
      await createPurchase({ itemId: flour.id, amount: 10, unit: "kg", cost: 500, date: "2026-10-01" });
      const sugar = await createItem({ name: "Sugar", category: "ingredient", icon: "🍬", baseUnit: "g" });
      await createPurchase({ itemId: sugar.id, amount: 5, unit: "kg", cost: 300, date: "2026-10-01" });
      return { flour, sugar };
    }

    it("deducts stock only when the sale is saved and keeps the consumption snapshot", async () => {
      const { flour, sugar } = await stockedFlour();
      const before = (await getItem(flour.id))!;
      const cake = await saveProduct({
        name: "Chocolate Cake",
        icon: "🎂",
        defaultPrice: 850,
        recipe: [
          { itemId: flour.id, quantityBase: 500 },
          { itemId: sugar.id, quantityBase: 300 },
        ],
      });
      assert.equal((await getItem(flour.id))!.quantityBase, before.quantityBase);

      const saleId = await saveSale({
        soldAt: "2026-10-01",
        lines: [
          {
            productId: cake.id,
            quantity: 1,
            unitPrice: 800,
            consumptions: [
              { itemId: flour.id, quantityBase: 500 },
              { itemId: sugar.id, quantityBase: 300 },
            ],
          },
        ],
      });
      assert.equal((await getItem(flour.id))!.quantityBase, 9500);
      const sale = (await getSale(saleId))!;
      assert.equal(sale.totalPrice, 800);
      assert.equal(sale.lines[0].consumptions[0].quantityBase, 500);
      assert.equal(sale.lines[0].consumptions[0].unitCostPerBase, 0.05);
      assert.ok(Math.abs(sale.lines[0].consumptions[0].totalCost - 25) < 1e-9);
      assert.ok(Math.abs(sale.estimatedProfit - (800 - sale.estimatedCost)) < 1e-9);

      await saveRecipe(cake.id, [{ itemId: flour.id, quantityBase: 450 }]);
      const reread = (await getSale(saleId))!;
      assert.equal(reread.lines[0].consumptions.find((line) => line.itemId === flour.id)?.quantityBase, 500);
      assert.equal((await getProduct(cake.id))!.recipe[0].quantityBase, 450);
      assert.equal((await getItem(flour.id))!.quantityBase, 9500);
    });

    it("keeps sale cost when only the price changes, and restores stock when voided", async () => {
      const { flour } = await stockedFlour();
      const cake = await saveProduct({
        name: "Chocolate Cake",
        icon: "🎂",
        defaultPrice: 850,
        recipe: [{ itemId: flour.id, quantityBase: 500 }],
      });
      const saleId = await saveSale({
        soldAt: "2026-10-01",
        lines: [{ productId: cake.id, quantity: 1, unitPrice: 850, consumptions: [{ itemId: flour.id, quantityBase: 500 }] }],
      });
      const originalCost = (await getSale(saleId))!.estimatedCost;
      await createPurchase({ itemId: flour.id, amount: 10, unit: "kg", cost: 1000, date: "2026-10-03" });
      const valueAfterPurchase = (await getItem(flour.id))!.inventoryValue;
      const lineId = (await getSale(saleId))!.lines[0].id;
      await saveSale({
        id: saleId,
        soldAt: "2026-10-01",
        lines: [{ id: lineId, productId: cake.id, quantity: 1, unitPrice: 800, consumptions: [{ itemId: flour.id, quantityBase: 500 }] }],
      });
      const edited = (await getSale(saleId))!;
      assert.equal(edited.totalPrice, 800);
      assert.ok(Math.abs(edited.estimatedCost - originalCost) < 1e-9);
      assert.ok(Math.abs((await getItem(flour.id))!.inventoryValue - valueAfterPurchase) < 1e-6);

      await voidSale(saleId);
      const flourAfter = (await getItem(flour.id))!;
      assert.equal(flourAfter.quantityBase, 20000);
      assert.equal((await getSale(saleId))!.status, "voided");
      assert.equal((await getSale(saleId))!.lines[0].consumptions[0].quantityBase, 500);
      await assert.rejects(() => voidSale(saleId), /already voided/);
    });

    it("reverses the old consumption and applies the edited quantity", async () => {
      const { flour } = await stockedFlour();
      const cake = await saveProduct({
        name: "Chocolate Cake",
        icon: "🎂",
        defaultPrice: 850,
        recipe: [{ itemId: flour.id, quantityBase: 500 }],
      });
      const saleId = await saveSale({
        soldAt: "2026-10-01",
        lines: [{ productId: cake.id, quantity: 1, unitPrice: 850, consumptions: [{ itemId: flour.id, quantityBase: 500 }] }],
      });
      const lineId = (await getSale(saleId))!.lines[0].id;
      await saveSale({
        id: saleId,
        soldAt: "2026-10-01",
        lines: [{ id: lineId, productId: cake.id, quantity: 2, unitPrice: 850, consumptions: [{ itemId: flour.id, quantityBase: 1000 }] }],
      });
      assert.equal((await getItem(flour.id))!.quantityBase, 9000);
      assert.equal((await getSale(saleId))!.lines[0].consumptions[0].quantityBase, 1000);
      const db = await getDb();
      const reversals = (await db
        .prepare("SELECT COUNT(*) AS c FROM inventory_transactions WHERE reference_type = 'sale_reversal'")
        .get()) as { c: number };
      assert.equal(reversals.c, 1);
    });

    it("subtracts the same item twice inside one saved sale", async () => {
      const flour = await createItem({ name: "All-Purpose Flour", category: "ingredient", icon: "🌾", baseUnit: "g" });
      await createPurchase({ itemId: flour.id, amount: 1, unit: "kg", cost: 100, date: "2026-10-01" });
      const cake = await saveProduct({ name: "Chocolate Cake", icon: "🎂", defaultPrice: 850, recipe: [] });
      await saveSale({
        soldAt: "2026-10-01",
        lines: [
          { productId: cake.id, quantity: 1, unitPrice: 400, consumptions: [{ itemId: flour.id, quantityBase: 600 }] },
          { productId: cake.id, quantity: 1, unitPrice: 400, consumptions: [{ itemId: flour.id, quantityBase: 600 }] },
        ],
      });
      const updated = (await getItem(flour.id))!;
      assert.equal(updated.quantityBase, -200);
      assert.ok(Math.abs(updated.inventoryValue - -20) < 1e-9);
    });
  });

  describe(`seed (${mode})`, () => {
    beforeEach(() => setup(mode));

    it("opens with the sample stock and one recorded sale", async () => {
      await seedIfEmpty();
      const db = await getDb();
      const flour = (await db
        .prepare("SELECT quantity_base, average_cost_per_base_unit FROM inventory_items WHERE name = ?")
        .get("All-Purpose Flour")) as {
        quantity_base: number;
        average_cost_per_base_unit: number;
      };
      const eggs = (await db
        .prepare("SELECT quantity_base, average_cost_per_base_unit FROM inventory_items WHERE name = ?")
        .get("Eggs")) as {
        quantity_base: number;
        average_cost_per_base_unit: number;
      };
      assert.equal(flour.quantity_base, 24500);
      assert.ok(Math.abs(flour.average_cost_per_base_unit - 0.057) < 1e-12);
      assert.equal(eggs.quantity_base, 184);
      assert.ok(Math.abs(eggs.average_cost_per_base_unit - 8.25) < 1e-12);
      const sales = (await db.prepare("SELECT COUNT(*) AS c FROM sales").get()) as { c: number };
      assert.equal(sales.c, 1);
      await seedIfEmpty();
      const items = (await db.prepare("SELECT COUNT(*) AS c FROM inventory_items").get()) as { c: number };
      assert.equal(items.c, 9);
    });
  });
}
