import { randomUUID } from "node:crypto";
import type { AdjustmentReason, BaseUnit, Category, TransactionType } from "./constants";
import { isAdjustmentReason, transactionTypeForReason } from "./constants";
import { applyInbound, applyOutbound, currentAverage, type StockCostState } from "./costing";
import { getDb, rememberItem, rememberedItem, withTransaction } from "./db";
import { nowIso } from "./dates";
import { DomainError } from "./errors";
import {
  cleanBaseUnit,
  cleanCategory,
  cleanDate,
  cleanIcon,
  cleanMoney,
  cleanName,
  cleanOptional,
  quantityToBase,
} from "./validate";

export type ItemRecord = {
  id: string;
  name: string;
  category: Category;
  icon: string;
  baseUnit: BaseUnit;
  minimumStock: number;
  quantityBase: number;
  inventoryValue: number;
  averageCostPerBaseUnit: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

type ItemRow = {
  id: string;
  name: string;
  category: Category;
  icon: string;
  base_unit: BaseUnit;
  minimum_stock: number;
  quantity_base: number;
  inventory_value: number;
  average_cost_per_base_unit: number;
  active: number;
  created_at: string;
  updated_at: string;
};

export type MovementResult = {
  unitCost: number;
  totalCost: number;
};

type MovementInput = {
  itemId: string;
  type: TransactionType;
  quantityBase: number;
  occurredAt: string;
  inboundValue?: number;
  unitCostPerBase?: number;
  reason?: string | null;
  referenceType?: string | null;
  referenceId?: string | null;
  referenceLineId?: string | null;
  notes?: string | null;
};

function mapItem(row: ItemRow): ItemRecord {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    icon: row.icon,
    baseUnit: row.base_unit,
    minimumStock: row.minimum_stock,
    quantityBase: row.quantity_base,
    inventoryValue: row.inventory_value,
    averageCostPerBaseUnit: row.average_cost_per_base_unit,
    active: row.active === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getItem(id: string): Promise<ItemRecord | null> {
  const cached = rememberedItem<ItemRecord>(id);
  if (cached) return cached;
  const row = (await (await getDb()).prepare("SELECT * FROM inventory_items WHERE id = ?").get(id)) as ItemRow | undefined;
  return row ? mapItem(row) : null;
}

export async function requireItem(id: string): Promise<ItemRecord> {
  const item = await getItem(id);
  if (!item) throw new DomainError("That inventory item no longer exists.");
  return item;
}

function stateOf(item: ItemRecord): StockCostState {
  return {
    quantityBase: item.quantityBase,
    inventoryValue: item.inventoryValue,
    averageCostPerBaseUnit: item.averageCostPerBaseUnit,
  };
}

/**
 * The only writer of on-hand quantity and average cost.
 * Must be called inside withTransaction by the caller when grouped with other writes.
 */
export async function postMovement(input: MovementInput): Promise<MovementResult> {
  const db = await getDb();
  const item = await requireItem(input.itemId);
  const state = stateOf(item);
  let next: StockCostState;
  let unitCost: number;
  let signedValue: number;
  let consumedCost = 0;

  if (input.quantityBase > 0) {
    if (input.inboundValue === undefined || !Number.isFinite(input.inboundValue)) {
      throw new DomainError("Incoming stock needs a cost.");
    }
    next = applyInbound(state, input.quantityBase, input.inboundValue);
    unitCost = input.unitCostPerBase ?? input.inboundValue / input.quantityBase;
    signedValue = input.inboundValue;
  } else if (input.quantityBase < 0) {
    const outbound = applyOutbound(state, -input.quantityBase);
    next = outbound.state;
    unitCost = outbound.unitCost;
    signedValue = -outbound.totalCost;
    consumedCost = outbound.totalCost;
  } else {
    throw new DomainError("Enter a quantity other than zero.");
  }

  const timestamp = nowIso();
  await db.prepare(
    `UPDATE inventory_items
     SET quantity_base = ?, inventory_value = ?, average_cost_per_base_unit = ?, updated_at = ?
     WHERE id = ?`,
  ).run(next.quantityBase, next.inventoryValue, next.averageCostPerBaseUnit, timestamp, item.id);

  rememberItem(item.id, {
    ...item,
    quantityBase: next.quantityBase,
    inventoryValue: next.inventoryValue,
    averageCostPerBaseUnit: next.averageCostPerBaseUnit,
    updatedAt: timestamp,
  });

  await db.prepare(
    `INSERT INTO inventory_transactions (
      id, item_id, type, quantity_base, unit_cost_per_base, total_cost, reason,
      reference_type, reference_id, reference_line_id, notes, status, occurred_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'posted', ?, ?)`,
  ).run(
    randomUUID(),
    item.id,
    input.type,
    input.quantityBase,
    unitCost,
    signedValue,
    input.reason ?? null,
    input.referenceType ?? null,
    input.referenceId ?? null,
    input.referenceLineId ?? null,
    input.notes ?? null,
    input.occurredAt,
    timestamp,
  );

  return { unitCost, totalCost: input.quantityBase < 0 ? consumedCost : input.inboundValue ?? 0 };
}

export async function listItems(): Promise<ItemRecord[]> {
  const rows = (await (await getDb()).prepare("SELECT * FROM inventory_items ORDER BY name COLLATE NOCASE").all()) as ItemRow[];
  return rows.map(mapItem);
}

export type ItemInput = {
  name: string;
  category: string;
  icon?: string;
  baseUnit: string;
  minimumStock?: number;
  active?: boolean;
};

export async function createItem(input: ItemInput): Promise<ItemRecord> {
  return withTransaction(async () => {
    const name = cleanName(input.name, "Item name");
    await assertUniqueItemName(name);
    const category = cleanCategory(input.category);
    const baseUnit = cleanBaseUnit(input.baseUnit);
    const minimumStock = cleanMinimum(input.minimumStock ?? 0);
    const icon = cleanIcon(input.icon, "📦");
    const id = randomUUID();
    const timestamp = nowIso();
    const active = input.active === false ? 0 : 1;
    await (await getDb())
      .prepare(
        `INSERT INTO inventory_items (
          id, name, category, icon, base_unit, minimum_stock, quantity_base, inventory_value,
          average_cost_per_base_unit, active, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 0, 0, 0, ?, ?, ?)`,
      )
      .run(id, name, category, icon, baseUnit, minimumStock, active, timestamp, timestamp);
    const created: ItemRecord = {
      id,
      name,
      category,
      icon,
      baseUnit,
      minimumStock,
      quantityBase: 0,
      inventoryValue: 0,
      averageCostPerBaseUnit: 0,
      active: active === 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    rememberItem(id, created);
    return created;
  });
}

export async function updateItem(id: string, input: ItemInput): Promise<ItemRecord> {
  return withTransaction(async () => {
    const existing = await requireItem(id);
    const name = cleanName(input.name, "Item name");
    await assertUniqueItemName(name, id);
    const category = cleanCategory(input.category);
    const baseUnit = cleanBaseUnit(input.baseUnit);
    const minimumStock = cleanMinimum(input.minimumStock ?? 0);
    const icon = cleanIcon(input.icon, existing.icon);
    if (baseUnit !== existing.baseUnit) {
      const moves = (await (await getDb())
        .prepare("SELECT COUNT(*) AS c FROM inventory_transactions WHERE item_id = ?")
        .get(id)) as { c: number };
      if (moves.c > 0) {
        throw new DomainError("The unit type can't be changed after stock has been recorded.");
      }
    }
    const active = input.active === false ? 0 : 1;
    const timestamp = nowIso();
    await (await getDb())
      .prepare(
        `UPDATE inventory_items
         SET name = ?, category = ?, icon = ?, base_unit = ?, minimum_stock = ?, active = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(name, category, icon, baseUnit, minimumStock, active, timestamp, id);
    const updated: ItemRecord = {
      ...existing,
      name,
      category,
      icon,
      baseUnit,
      minimumStock,
      active: active === 1,
      updatedAt: timestamp,
    };
    rememberItem(id, updated);
    return updated;
  });
}

function cleanMinimum(value: number): number {
  if (!Number.isFinite(value) || value < 0) throw new DomainError("Minimum stock can't be negative.");
  if (value > 1_000_000_000) throw new DomainError("Minimum stock is too large.");
  return value;
}

async function assertUniqueItemName(name: string, exceptId?: string): Promise<void> {
  const row = (await (await getDb())
    .prepare("SELECT id, active FROM inventory_items WHERE lower(name) = lower(?)")
    .get(name)) as { id: string; active: number } | undefined;
  if (row && row.id !== exceptId) {
    throw new DomainError(
      row.active
        ? `"${name}" is already in inventory.`
        : `"${name}" is already in inventory, marked inactive. Reactivate it instead of adding a duplicate.`,
    );
  }
}

export type PurchaseInput = {
  itemId: string;
  amount: number;
  unit: string;
  cost: number;
  date: string;
  supplier?: string;
  notes?: string;
};

export async function createPurchase(input: PurchaseInput): Promise<string> {
  return createPurchaseReceipt({
    date: input.date,
    supplier: input.supplier,
    notes: input.notes,
    lines: [{ itemId: input.itemId, amount: input.amount, unit: input.unit, cost: input.cost }],
  });
}

export type PurchaseLineInput = {
  itemId: string;
  amount: number;
  unit: string;
  cost: number;
};

export async function createPurchaseReceipt(input: {
  date: string;
  supplier?: string;
  notes?: string;
  lines: PurchaseLineInput[];
}): Promise<string> {
  return withTransaction(async () => {
    if (!input.lines.length) throw new DomainError("Add an item to this purchase.");
    if (input.lines.length > 40) throw new DomainError("A purchase can include up to 40 items.");
    const date = cleanDate(input.date, "Purchase date");
    const supplier = cleanOptional(input.supplier, 80, "Supplier");
    const notes = cleanOptional(input.notes, 400, "Notes");
    const prepared: {
      item: ItemRecord;
      amount: number;
      unit: string;
      quantityBase: number;
      cost: number;
      unitCost: number;
    }[] = [];
    for (const line of input.lines) {
      const item = await requireItem(line.itemId);
      if (!item.active) throw new DomainError(`${item.name} is inactive. Reactivate it before purchasing.`);
      const quantityBase = quantityToBase(line.amount, line.unit, item.baseUnit);
      const cost = cleanMoney(line.cost, `Purchase cost for ${item.name}`, true);
      prepared.push({ item, amount: line.amount, unit: line.unit, quantityBase, cost, unitCost: cost / quantityBase });
    }
    const id = randomUUID();
    const timestamp = nowIso();
    const total = prepared.reduce((sum, line) => sum + line.cost, 0);
    const db = await getDb();
    await db
      .prepare(
        `INSERT INTO purchase_receipts (id, supplier, notes, purchased_at, total_cost, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(id, supplier, notes, date, total, timestamp);
    for (const line of prepared) {
      const lineId = randomUUID();
      await db
        .prepare(
          `INSERT INTO purchases (
            id, item_id, quantity_input, input_unit, quantity_base, purchase_cost, unit_cost_per_base,
            supplier, notes, purchased_at, created_at, receipt_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          lineId,
          line.item.id,
          line.amount,
          line.unit,
          line.quantityBase,
          line.cost,
          line.unitCost,
          supplier,
          notes,
          date,
          timestamp,
          id,
        );
      await postMovement({
        itemId: line.item.id,
        type: "purchase",
        quantityBase: line.quantityBase,
        inboundValue: line.cost,
        unitCostPerBase: line.unitCost,
        occurredAt: date,
        referenceType: "purchase",
        referenceId: lineId,
        notes,
      });
    }
    return id;
  });
}

export type AdjustmentInput = {
  itemId: string;
  amount: number;
  unit: string;
  direction: "add" | "remove";
  reason: string;
  note?: string;
  date: string;
};

export async function createAdjustment(input: AdjustmentInput): Promise<string> {
  return withTransaction(async () => {
    const item = await requireItem(input.itemId);
    if (!isAdjustmentReason(input.reason)) throw new DomainError("Choose a reason.");
    const reason: AdjustmentReason = input.reason;
    const quantityBase = quantityToBase(input.amount, input.unit, item.baseUnit);
    const signed = input.direction === "add" ? quantityBase : -quantityBase;
    const removalOnly =
      reason === "wastage" || reason === "damaged" || reason === "expired" || reason === "personal_use";
    if (input.direction !== "add" && input.direction !== "remove") {
      throw new DomainError("Choose whether to add or remove stock.");
    }
    if (removalOnly && signed > 0) {
      throw new DomainError(`${reasonLabel(reason)} removes stock. Switch to remove, or use Count Correction to add stock.`);
    }
    const date = cleanDate(input.date);
    const note = cleanOptional(input.note, 400, "Note");
    const type = transactionTypeForReason(reason);
    const average = currentAverage(stateOf(item));
    if (signed > 0) {
      await postMovement({
        itemId: item.id,
        type,
        quantityBase: signed,
        inboundValue: signed * average,
        unitCostPerBase: average,
        occurredAt: date,
        reason,
        referenceType: "adjustment",
        notes: note,
      });
    } else {
      await postMovement({
        itemId: item.id,
        type,
        quantityBase: signed,
        occurredAt: date,
        reason,
        referenceType: "adjustment",
        notes: note,
      });
    }
    return item.id;
  });
}

function reasonLabel(reason: AdjustmentReason): string {
  const labels: Record<AdjustmentReason, string> = {
    wastage: "Wastage",
    damaged: "Damaged",
    expired: "Expired",
    personal_use: "Personal use",
    count_correction: "Count correction",
    other: "Other",
  };
  return labels[reason];
}
