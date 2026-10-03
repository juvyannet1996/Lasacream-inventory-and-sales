import { randomUUID } from "node:crypto";
import { getDb, withTransaction } from "./db";
import { nowIso, todayISO } from "./dates";
import { DomainError } from "./errors";
import { postMovement, requireItem, type ItemRecord } from "./inventory";
import { getProduct, rememberProduct } from "./products";
import { cleanDate, cleanMoney, cleanOptional } from "./validate";
import type { BaseUnit } from "./constants";

export type SaleConsumptionRecord = {
  id: string;
  saleLineId: string;
  itemId: string;
  itemName: string;
  itemIcon: string;
  baseUnit: BaseUnit;
  quantityBase: number;
  unitCostPerBase: number;
  totalCost: number;
};

export type SaleLineRecord = {
  id: string;
  productId: string | null;
  productName: string;
  productIcon: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  estimatedCost: number;
  consumptions: SaleConsumptionRecord[];
};

export type SaleRecord = {
  id: string;
  soldAt: string;
  customerName: string | null;
  notes: string | null;
  status: "completed" | "voided";
  totalPrice: number;
  estimatedCost: number;
  estimatedProfit: number;
  createdAt: string;
  updatedAt: string;
  lines: SaleLineRecord[];
};

type SaleRow = {
  id: string;
  sold_at: string;
  customer_name: string | null;
  notes: string | null;
  status: "completed" | "voided";
  total_price: number;
  estimated_cost: number;
  estimated_profit: number;
  created_at: string;
  updated_at: string;
};

type LineRow = {
  id: string;
  sale_id: string;
  product_id: string | null;
  product_name: string;
  product_icon: string;
  quantity: number;
  unit_price: number;
  line_total: number;
  estimated_cost: number;
};

type ConsumptionRow = {
  id: string;
  sale_id: string;
  sale_line_id: string;
  inventory_item_id: string;
  item_name: string;
  item_icon: string;
  base_unit: BaseUnit;
  quantity_base: number;
  unit_cost_per_base: number;
  total_cost: number;
};

type TxnRow = {
  id: string;
  item_id: string;
  quantity_base: number;
  unit_cost_per_base: number;
  total_cost: number;
  reference_line_id: string | null;
  notes: string | null;
};

export type SaleLineInput = {
  id?: string;
  productId: string;
  quantity: number;
  unitPrice: number;
  consumptions: { itemId: string; quantityBase: number }[];
};

export type SaleInput = {
  id?: string;
  soldAt: string;
  customerName?: string;
  notes?: string;
  lines: SaleLineInput[];
};

type ParsedLine = {
  id?: string;
  productId: string;
  productName: string;
  productIcon: string;
  quantity: number;
  unitPrice: number;
  consumptions: { itemId: string; quantityBase: number; item: ItemRecord }[];
};

function mapConsumption(row: ConsumptionRow): SaleConsumptionRecord {
  return {
    id: row.id,
    saleLineId: row.sale_line_id,
    itemId: row.inventory_item_id,
    itemName: row.item_name,
    itemIcon: row.item_icon,
    baseUnit: row.base_unit,
    quantityBase: row.quantity_base,
    unitCostPerBase: row.unit_cost_per_base,
    totalCost: row.total_cost,
  };
}

export async function getSale(id: string): Promise<SaleRecord | null> {
  const row = (await (await getDb()).prepare("SELECT * FROM sales WHERE id = ?").get(id)) as SaleRow | undefined;
  if (!row) return null;
  return hydrate(row);
}

async function hydrate(row: SaleRow): Promise<SaleRecord> {
  const db = await getDb();
  const lines = (await db.prepare("SELECT * FROM sale_lines WHERE sale_id = ? ORDER BY rowid").all(row.id)) as LineRow[];
  const consumptions = (await db
    .prepare("SELECT * FROM sale_consumptions WHERE sale_id = ? ORDER BY rowid")
    .all(row.id)) as ConsumptionRow[];
  return {
    id: row.id,
    soldAt: row.sold_at,
    customerName: row.customer_name,
    notes: row.notes,
    status: row.status,
    totalPrice: row.total_price,
    estimatedCost: row.estimated_cost,
    estimatedProfit: row.estimated_profit,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lines: lines.map((line) => ({
      id: line.id,
      productId: line.product_id,
      productName: line.product_name,
      productIcon: line.product_icon,
      quantity: line.quantity,
      unitPrice: line.unit_price,
      lineTotal: line.line_total,
      estimatedCost: line.estimated_cost,
      consumptions: consumptions.filter((c) => c.sale_line_id === line.id).map(mapConsumption),
    })),
  };
}

export async function saveSale(input: SaleInput): Promise<string> {
  return withTransaction(async () => {
    const soldAt = cleanDate(input.soldAt, "Sale date");
    const customerName = cleanOptional(input.customerName, 80, "Customer name");
    const notes = cleanOptional(input.notes, 400, "Notes");
    const parsed = await parseLines(input.lines);
    if (input.id) {
      const existing = await getSale(input.id);
      if (!existing) throw new DomainError("That sale no longer exists.");
      if (existing.status === "voided") throw new DomainError("Voided sales can't be edited.");
      if (sameLineConsumption(existing.lines, parsed)) {
        await updateSaleInPlace(existing, { soldAt, customerName, notes, lines: parsed });
        return existing.id;
      }
      await reversePostedSaleMovements(existing.id);
      await rewriteSale(existing.id, { soldAt, customerName, notes, lines: parsed });
      return existing.id;
    }
    const id = randomUUID();
    const timestamp = nowIso();
    await (await getDb())
      .prepare(
        `INSERT INTO sales (
          id, sold_at, customer_name, notes, status, total_price, estimated_cost, estimated_profit, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'completed', 0, 0, 0, ?, ?)`,
      )
      .run(id, soldAt, customerName, notes, timestamp, timestamp);
    await applyLines(id, soldAt, parsed);
    return id;
  });
}

export async function voidSale(id: string): Promise<void> {
  await withTransaction(async () => {
    const existing = await getSale(id);
    if (!existing) throw new DomainError("That sale no longer exists.");
    if (existing.status === "voided") throw new DomainError("This sale is already voided.");
    await reversePostedSaleMovements(id);
    await (await getDb()).prepare("UPDATE sales SET status = 'voided', updated_at = ? WHERE id = ?").run(nowIso(), id);
  });
}

export async function saveRecipeFromSaleLine(saleId: string, lineId: string): Promise<string> {
  return withTransaction(async () => {
    const sale = await getSale(saleId);
    if (!sale || sale.status === "voided") throw new DomainError("That sale can't be used for a recipe.");
    const line = sale.lines.find((entry) => entry.id === lineId);
    if (!line || !line.productId) throw new DomainError("Choose a product line to save as a recipe.");
    if (line.consumptions.length === 0) throw new DomainError("Add the items used before saving a recipe.");
    const perUnit = line.consumptions.map((consumption) => ({
      itemId: consumption.itemId,
      quantityBase: consumption.quantityBase / line.quantity,
    }));
    const timestamp = nowIso();
    const db = await getDb();
    await db.prepare("DELETE FROM recipe_lines WHERE product_id = ?").run(line.productId);
    for (const recipeLine of perUnit) {
      if (!(recipeLine.quantityBase > 0)) throw new DomainError("Recipe quantities must be greater than zero.");
      await db
        .prepare(
          `INSERT INTO recipe_lines (id, product_id, inventory_item_id, quantity_base, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(randomUUID(), line.productId, recipeLine.itemId, recipeLine.quantityBase, timestamp, timestamp);
    }
    await db.prepare("UPDATE products SET updated_at = ? WHERE id = ?").run(timestamp, line.productId);
    const product = await getProduct(line.productId);
    if (product) rememberProduct({ ...product, updatedAt: timestamp, recipe: perUnit });
    return line.productId;
  });
}

async function parseLines(lines: SaleLineInput[]): Promise<ParsedLine[]> {
  if (!lines.length) throw new DomainError("Add a product to this sale.");
  if (lines.length > 30) throw new DomainError("A sale can include up to 30 products.");
  const parsed: ParsedLine[] = [];
  for (const line of lines) {
    const product = await getProduct(line.productId);
    if (!product) throw new DomainError("Choose a product that exists.");
    if (!Number.isFinite(line.quantity) || line.quantity <= 0) {
      throw new DomainError(`Enter a quantity for ${product.name}.`);
    }
    if (line.quantity > 100_000) throw new DomainError(`The quantity for ${product.name} is too large.`);
    const unitPrice = cleanMoney(line.unitPrice, `Selling price for ${product.name}`, true);
    if (line.consumptions.length > 40) throw new DomainError(`Too many items on ${product.name}.`);
    const merged = new Map<string, { quantityBase: number; item: ItemRecord }>();
    for (const consumption of line.consumptions) {
      if (!consumption.itemId) continue;
      const item = await requireItem(consumption.itemId);
      if (!Number.isFinite(consumption.quantityBase) || consumption.quantityBase <= 0) {
        throw new DomainError(`Enter a quantity for ${item.name}.`);
      }
      if (consumption.quantityBase > 1_000_000_000) throw new DomainError(`The quantity for ${item.name} is too large.`);
      const current = merged.get(item.id);
      if (current) current.quantityBase += consumption.quantityBase;
      else merged.set(item.id, { quantityBase: consumption.quantityBase, item });
    }
    parsed.push({
      id: line.id,
      productId: product.id,
      productName: product.name,
      productIcon: product.icon,
      quantity: line.quantity,
      unitPrice,
      consumptions: [...merged.values()].map((entry) => ({
        itemId: entry.item.id,
        quantityBase: entry.quantityBase,
        item: entry.item,
      })),
    });
  }
  return parsed;
}

function sameLineConsumption(existing: SaleLineRecord[], parsed: ParsedLine[]): boolean {
  if (existing.length !== parsed.length) return false;
  for (const line of parsed) {
    if (!line.id) return false;
    const previous = existing.find((entry) => entry.id === line.id);
    if (!previous) return false;
    if (previous.productId !== line.productId) return false;
    if (!close(previous.quantity, line.quantity)) return false;
    if (previous.consumptions.length !== line.consumptions.length) return false;
    const previousItems = [...previous.consumptions].sort((a, b) => a.itemId.localeCompare(b.itemId));
    const nextItems = [...line.consumptions].sort((a, b) => a.itemId.localeCompare(b.itemId));
    for (let index = 0; index < previousItems.length; index += 1) {
      if (previousItems[index].itemId !== nextItems[index].itemId) return false;
      if (!close(previousItems[index].quantityBase, nextItems[index].quantityBase)) return false;
    }
  }
  return true;
}

function close(a: number, b: number): boolean {
  return Math.abs(a - b) < 1e-6;
}

async function updateSaleInPlace(
  existing: SaleRecord,
  input: { soldAt: string; customerName: string | null; notes: string | null; lines: ParsedLine[] },
): Promise<void> {
  const db = await getDb();
  let totalPrice = 0;
  for (const line of input.lines) {
    if (!line.id) throw new DomainError("Couldn't match this sale line.");
    const lineTotal = line.quantity * line.unitPrice;
    totalPrice += lineTotal;
    await db.prepare("UPDATE sale_lines SET unit_price = ?, line_total = ? WHERE id = ?").run(
      line.unitPrice,
      lineTotal,
      line.id,
    );
    await db.prepare(
      `UPDATE inventory_transactions
       SET occurred_at = ?
       WHERE reference_id = ? AND reference_line_id = ? AND reference_type = 'sale' AND status = 'posted'`,
    ).run(input.soldAt, existing.id, line.id);
  }
  const estimatedCost = existing.estimatedCost;
  await db.prepare(
    `UPDATE sales
     SET sold_at = ?, customer_name = ?, notes = ?, total_price = ?, estimated_cost = ?, estimated_profit = ?, updated_at = ?
     WHERE id = ?`,
  ).run(
    input.soldAt,
    input.customerName,
    input.notes,
    totalPrice,
    estimatedCost,
    totalPrice - estimatedCost,
    nowIso(),
    existing.id,
  );
}

async function rewriteSale(
  id: string,
  input: { soldAt: string; customerName: string | null; notes: string | null; lines: ParsedLine[] },
): Promise<void> {
  const db = await getDb();
  await db.prepare("DELETE FROM sale_consumptions WHERE sale_id = ?").run(id);
  await db.prepare("DELETE FROM sale_lines WHERE sale_id = ?").run(id);
  await db.prepare(
    `UPDATE sales
     SET sold_at = ?, customer_name = ?, notes = ?, status = 'completed', updated_at = ?
     WHERE id = ?`,
  ).run(input.soldAt, input.customerName, input.notes, nowIso(), id);
  await applyLines(id, input.soldAt, input.lines);
}

async function applyLines(saleId: string, soldAt: string, lines: ParsedLine[]): Promise<void> {
  const db = await getDb();
  let totalPrice = 0;
  let estimatedCost = 0;
  for (const line of lines) {
    const lineId = randomUUID();
    let lineCost = 0;
    const priced: { item: ItemRecord; quantityBase: number; unitCost: number; totalCost: number }[] = [];
    for (const consumption of line.consumptions) {
      const moved = await postMovement({
        itemId: consumption.itemId,
        type: "sale",
        quantityBase: -consumption.quantityBase,
        occurredAt: soldAt,
        referenceType: "sale",
        referenceId: saleId,
        referenceLineId: lineId,
        notes: line.productName,
      });
      lineCost += moved.totalCost;
      priced.push({
        item: consumption.item,
        quantityBase: consumption.quantityBase,
        unitCost: moved.unitCost,
        totalCost: moved.totalCost,
      });
    }
    const lineTotal = line.quantity * line.unitPrice;
    totalPrice += lineTotal;
    estimatedCost += lineCost;
    await db.prepare(
      `INSERT INTO sale_lines (
        id, sale_id, product_id, product_name, product_icon, quantity, unit_price, line_total, estimated_cost
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(lineId, saleId, line.productId, line.productName, line.productIcon, line.quantity, line.unitPrice, lineTotal, lineCost);
    for (const consumption of priced) {
      await db.prepare(
        `INSERT INTO sale_consumptions (
          id, sale_id, sale_line_id, inventory_item_id, item_name, item_icon, base_unit,
          quantity_base, unit_cost_per_base, total_cost
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        randomUUID(),
        saleId,
        lineId,
        consumption.item.id,
        consumption.item.name,
        consumption.item.icon,
        consumption.item.baseUnit,
        consumption.quantityBase,
        consumption.unitCost,
        consumption.totalCost,
      );
    }
  }
  await db.prepare(
    "UPDATE sales SET total_price = ?, estimated_cost = ?, estimated_profit = ?, updated_at = ? WHERE id = ?",
  ).run(totalPrice, estimatedCost, totalPrice - estimatedCost, nowIso(), saleId);
}

async function reversePostedSaleMovements(saleId: string): Promise<void> {
  const db = await getDb();
  const rows = (await db
    .prepare(
      `SELECT * FROM inventory_transactions
       WHERE reference_id = ? AND reference_type = 'sale' AND status = 'posted' AND quantity_base < 0
       ORDER BY created_at`,
    )
    .all(saleId)) as TxnRow[];
  for (const row of rows) {
    await postMovement({
      itemId: row.item_id,
      type: "sale",
      quantityBase: -row.quantity_base,
      inboundValue: -row.total_cost,
      unitCostPerBase: row.unit_cost_per_base,
      occurredAt: todayISO(),
      referenceType: "sale_reversal",
      referenceId: saleId,
      referenceLineId: row.reference_line_id,
      notes: row.notes ? `Reversal · ${row.notes}` : "Reversal of sale",
    });
    await db.prepare("UPDATE inventory_transactions SET status = 'reversed' WHERE id = ?").run(row.id);
  }
}
