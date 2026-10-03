import type { BaseUnit, Category, TransactionType } from "./constants";
import { getDb } from "./db";
import {
  addDays,
  eachDate,
  endOfMonth,
  endOfWeek,
  monthLabel,
  monthShort,
  startOfMonth,
  startOfWeek,
  todayISO,
  type ChartGrain,
  type ResolvedRange,
} from "./dates";
import { stockStatus, type StockLevel } from "./stock";

export type ItemOption = {
  id: string;
  name: string;
  icon: string;
  category: Category;
  baseUnit: BaseUnit;
  minimumStock: number;
  quantityBase: number;
  inventoryValue: number;
  averageCostPerBaseUnit: number;
  active: boolean;
  hasMovements: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ProductOption = {
  id: string;
  name: string;
  icon: string;
  defaultPrice: number | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  recipe: { itemId: string; quantityBase: number }[];
};

export type TransactionView = {
  id: string;
  itemId: string;
  itemName: string;
  itemIcon: string;
  baseUnit: BaseUnit;
  type: TransactionType;
  quantityBase: number;
  unitCostPerBase: number;
  totalCost: number;
  reason: string | null;
  referenceType: string | null;
  referenceId: string | null;
  notes: string | null;
  occurredAt: string;
  createdAt: string;
  status: "posted" | "reversed";
  supplier: string | null;
  purchaseCost: number | null;
  purchaseUnitCost: number | null;
};

type ItemRow = {
  id: string;
  name: string;
  icon: string;
  category: Category;
  base_unit: BaseUnit;
  minimum_stock: number;
  quantity_base: number;
  inventory_value: number;
  average_cost_per_base_unit: number;
  active: number;
  movement_count: number;
  created_at: string;
  updated_at: string;
};

const ITEM_SELECT = `
  SELECT i.*, (
    SELECT COUNT(*) FROM inventory_transactions t WHERE t.item_id = i.id
  ) AS movement_count
  FROM inventory_items i
`;

function mapItem(row: ItemRow): ItemOption {
  return {
    id: row.id,
    name: row.name,
    icon: row.icon,
    category: row.category,
    baseUnit: row.base_unit,
    minimumStock: row.minimum_stock,
    quantityBase: row.quantity_base,
    inventoryValue: row.inventory_value,
    averageCostPerBaseUnit: row.average_cost_per_base_unit,
    active: row.active === 1,
    hasMovements: row.movement_count > 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listItemOptions(): Promise<ItemOption[]> {
  const rows = (await (await getDb())
    .prepare(
      `${ITEM_SELECT}
       ORDER BY CASE i.category
         WHEN 'ingredient' THEN 0
         WHEN 'packaging' THEN 1
         WHEN 'finished_good' THEN 2
         ELSE 3
       END, i.name COLLATE NOCASE`,
    )
    .all()) as ItemRow[];
  return rows.map(mapItem);
}

export async function getItemOption(id: string): Promise<ItemOption | null> {
  const row = (await (await getDb()).prepare(`${ITEM_SELECT} WHERE i.id = ?`).get(id)) as ItemRow | undefined;
  return row ? mapItem(row) : null;
}

export async function listProductOptions(): Promise<ProductOption[]> {
  const products = (await (await getDb())
    .prepare("SELECT * FROM products ORDER BY name COLLATE NOCASE")
    .all()) as {
    id: string;
    name: string;
    icon: string;
    default_price: number | null;
    active: number;
    created_at: string;
    updated_at: string;
  }[];
  const lines = (await (await getDb())
    .prepare(
      `SELECT product_id AS productId, inventory_item_id AS itemId, quantity_base AS quantityBase
       FROM recipe_lines ORDER BY rowid`,
    )
    .all()) as { productId: string; itemId: string; quantityBase: number }[];
  const recipes = new Map<string, { itemId: string; quantityBase: number }[]>();
  for (const line of lines) {
    const list = recipes.get(line.productId) ?? [];
    list.push({ itemId: line.itemId, quantityBase: line.quantityBase });
    recipes.set(line.productId, list);
  }
  return products.map((product) => ({
    id: product.id,
    name: product.name,
    icon: product.icon,
    defaultPrice: product.default_price,
    active: product.active === 1,
    createdAt: product.created_at,
    updatedAt: product.updated_at,
    recipe: recipes.get(product.id) ?? [],
  }));
}

const TRANSACTION_SELECT = `
  SELECT
    t.id, t.item_id AS itemId, i.name AS itemName, i.icon AS itemIcon, i.base_unit AS baseUnit,
    t.type, t.quantity_base AS quantityBase, t.unit_cost_per_base AS unitCostPerBase, t.total_cost AS totalCost,
    t.reason, t.reference_type AS referenceType, t.reference_id AS referenceId, t.notes,
    t.occurred_at AS occurredAt, t.created_at AS createdAt, t.status,
    p.supplier AS supplier, p.purchase_cost AS purchaseCost, p.unit_cost_per_base AS purchaseUnitCost
  FROM inventory_transactions t
  JOIN inventory_items i ON i.id = t.item_id
  LEFT JOIN purchases p ON t.reference_type = 'purchase' AND p.id = t.reference_id
`;

export async function listTransactions(filter: {
  itemId?: string;
  type?: TransactionType | "all";
  from?: string | null;
  to?: string | null;
  limit?: number;
}): Promise<{ rows: TransactionView[]; truncated: boolean }> {
  const clauses: string[] = [];
  const params: (string | number)[] = [];
  if (filter.itemId) {
    clauses.push("t.item_id = ?");
    params.push(filter.itemId);
  }
  if (filter.type && filter.type !== "all") {
    clauses.push("t.type = ?");
    params.push(filter.type);
  }
  if (filter.from) {
    clauses.push("t.occurred_at >= ?");
    params.push(filter.from);
  }
  if (filter.to) {
    clauses.push("t.occurred_at <= ?");
    params.push(filter.to);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const limit = filter.limit ?? 500;
  const rows = (await (await getDb())
    .prepare(
      `${TRANSACTION_SELECT} ${where} ORDER BY t.occurred_at DESC, t.created_at DESC LIMIT ?`,
    )
    .all(...params, limit + 1)) as TransactionView[];
  return { rows: rows.slice(0, limit), truncated: rows.length > limit };
}

export type PurchaseReceiptLine = {
  id: string;
  itemId: string;
  itemName: string;
  itemIcon: string;
  baseUnit: BaseUnit;
  quantityInput: number;
  inputUnit: string;
  purchaseCost: number;
};

export type PurchaseReceiptView = {
  id: string;
  purchasedAt: string;
  supplier: string | null;
  notes: string | null;
  totalCost: number;
  lines: PurchaseReceiptLine[];
};

export async function listPurchaseReceipts(filter: {
  from?: string | null;
  to?: string | null;
  itemId?: string;
}): Promise<PurchaseReceiptView[]> {
  const clauses: string[] = [];
  const params: string[] = [];
  if (filter.from) {
    clauses.push("p.purchased_at >= ?");
    params.push(filter.from);
  }
  if (filter.to) {
    clauses.push("p.purchased_at <= ?");
    params.push(filter.to);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = (await (await getDb())
    .prepare(
      `SELECT
         p.id, p.receipt_id AS receiptId, p.item_id AS itemId, i.name AS itemName, i.icon AS itemIcon,
         i.base_unit AS baseUnit, p.quantity_input AS quantityInput, p.input_unit AS inputUnit,
         p.purchase_cost AS purchaseCost, p.purchased_at AS purchasedAt, p.supplier, p.notes,
         r.supplier AS receiptSupplier, r.notes AS receiptNotes, r.total_cost AS receiptTotal,
         r.purchased_at AS receiptDate
       FROM purchases p
       JOIN inventory_items i ON i.id = p.item_id
       LEFT JOIN purchase_receipts r ON r.id = p.receipt_id
       ${where}
       ORDER BY p.purchased_at DESC, p.rowid DESC`,
    )
    .all(...params)) as {
    id: string;
    receiptId: string | null;
    itemId: string;
    itemName: string;
    itemIcon: string;
    baseUnit: BaseUnit;
    quantityInput: number;
    inputUnit: string;
    purchaseCost: number;
    purchasedAt: string;
    supplier: string | null;
    notes: string | null;
    receiptSupplier: string | null;
    receiptNotes: string | null;
    receiptTotal: number | null;
    receiptDate: string | null;
  }[];
  const groups = new Map<string, PurchaseReceiptView>();
  for (const row of rows) {
    const id = row.receiptId ?? row.id;
    const group = groups.get(id) ?? {
      id,
      purchasedAt: row.receiptDate ?? row.purchasedAt,
      supplier: row.receiptId ? row.receiptSupplier : row.supplier,
      notes: row.receiptId ? row.receiptNotes : row.notes,
      totalCost: row.receiptTotal ?? row.purchaseCost,
      lines: [],
    };
    group.lines.push({
      id: row.id,
      itemId: row.itemId,
      itemName: row.itemName,
      itemIcon: row.itemIcon,
      baseUnit: row.baseUnit,
      quantityInput: row.quantityInput,
      inputUnit: row.inputUnit,
      purchaseCost: row.purchaseCost,
    });
    groups.set(id, group);
  }
  const receipts = [...groups.values()];
  if (!filter.itemId) return receipts;
  return receipts.filter((receipt) => receipt.lines.some((line) => line.itemId === filter.itemId));
}

export type SaleSummary = {
  id: string;
  soldAt: string;
  customerName: string | null;
  notes: string | null;
  status: "completed" | "voided";
  totalPrice: number;
  estimatedCost: number;
  estimatedProfit: number;
  lines: { productName: string; productIcon: string; quantity: number; unitPrice: number; lineTotal: number }[];
};

export async function listSales(range: ResolvedRange): Promise<SaleSummary[]> {
  const clauses = ["1 = 1"];
  const params: string[] = [];
  if (range.from) {
    clauses.push("sold_at >= ?");
    params.push(range.from);
  }
  if (range.to) {
    clauses.push("sold_at <= ?");
    params.push(range.to);
  }
  const sales = (await (await getDb())
    .prepare(
      `SELECT id, sold_at AS soldAt, customer_name AS customerName, notes, status,
              total_price AS totalPrice, estimated_cost AS estimatedCost, estimated_profit AS estimatedProfit
       FROM sales
       WHERE ${clauses.join(" AND ")}
       ORDER BY sold_at DESC, created_at DESC`,
    )
    .all(...params)) as Omit<SaleSummary, "lines">[];
  if (!sales.length) return [];
  const ids = sales.map((sale) => sale.id);
  const lines = (await (await getDb())
    .prepare(
      `SELECT sale_id AS saleId, product_name AS productName, product_icon AS productIcon,
              quantity, unit_price AS unitPrice, line_total AS lineTotal
       FROM sale_lines
       WHERE sale_id IN (${ids.map(() => "?").join(",")})
       ORDER BY rowid`,
    )
    .all(...ids)) as {
    saleId: string;
    productName: string;
    productIcon: string;
    quantity: number;
    unitPrice: number;
    lineTotal: number;
  }[];
  const bySale = new Map<string, SaleSummary["lines"]>();
  for (const line of lines) {
    const list = bySale.get(line.saleId) ?? [];
    list.push({
      productName: line.productName,
      productIcon: line.productIcon,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      lineTotal: line.lineTotal,
    });
    bySale.set(line.saleId, list);
  }
  return sales.map((sale) => ({ ...sale, lines: bySale.get(sale.id) ?? [] }));
}

export type PeriodStats = {
  orders: number;
  revenue: number;
  cost: number;
  profit: number;
};

export async function periodStats(from: string, to: string): Promise<PeriodStats> {
  const row = (await (await getDb())
    .prepare(
      `SELECT COUNT(*) AS orders,
              COALESCE(SUM(total_price), 0) AS revenue,
              COALESCE(SUM(estimated_cost), 0) AS cost,
              COALESCE(SUM(estimated_profit), 0) AS profit
       FROM sales
       WHERE status = 'completed' AND sold_at >= ? AND sold_at <= ?`,
    )
    .get(from, to)) as PeriodStats;
  return row;
}

export type ChartPoint = {
  key: string;
  label: string;
  title: string;
  revenue: number;
};

export async function salesSeries(range: ResolvedRange, grain: ChartGrain): Promise<ChartPoint[]> {
  if (!range.from || !range.to) {
    const bounds = (await (await getDb())
      .prepare(
        `SELECT MIN(sold_at) AS minDate, MAX(sold_at) AS maxDate
         FROM sales WHERE status = 'completed'`,
      )
      .get()) as { minDate: string | null; maxDate: string | null };
    if (!bounds.minDate || !bounds.maxDate) return [];
    return salesSeries({ preset: "custom", from: bounds.minDate, to: bounds.maxDate }, grain);
  }
  const rows = (await (await getDb())
    .prepare(
      `SELECT sold_at AS soldAt, total_price AS totalPrice
       FROM sales
       WHERE status = 'completed' AND sold_at >= ? AND sold_at <= ?`,
    )
    .all(range.from, range.to)) as { soldAt: string; totalPrice: number }[];
  const totals = new Map<string, number>();
  for (const row of rows) {
    const key = bucketKey(row.soldAt, grain);
    totals.set(key, (totals.get(key) ?? 0) + row.totalPrice);
  }
  return buckets(range.from, range.to, grain).map((bucket) => ({
    key: bucket.key,
    label: bucket.label,
    title: bucket.title,
    revenue: totals.get(bucket.key) ?? 0,
  }));
}

function bucketKey(iso: string, grain: ChartGrain): string {
  if (grain === "month") return iso.slice(0, 7);
  if (grain === "week") return startOfWeek(iso);
  return iso;
}

function buckets(from: string, to: string, grain: ChartGrain): { key: string; label: string; title: string }[] {
  if (grain === "day") {
    return eachDate(from, to).map((iso) => ({
      key: iso,
      label: String(Number(iso.slice(8, 10))),
      title: iso,
    }));
  }
  if (grain === "week") {
    const points: { key: string; label: string; title: string }[] = [];
    let cursor = startOfWeek(from);
    while (cursor <= to && points.length < 80) {
      const end = endOfWeek(cursor);
      points.push({
        key: cursor,
        label: `${monthShort(cursor)} ${Number(cursor.slice(8, 10))}`,
        title: `${cursor} – ${end < to ? end : to}`,
      });
      cursor = addDays(cursor, 7);
    }
    return points;
  }
  const points: { key: string; label: string; title: string }[] = [];
  let cursor = startOfMonth(from);
  while (cursor <= to && points.length < 36) {
    points.push({
      key: cursor.slice(0, 7),
      label: monthShort(cursor),
      title: monthLabel(cursor),
    });
    cursor = addDays(endOfMonth(cursor), 1);
  }
  return points;
}

export type TopProduct = {
  productId: string | null;
  name: string;
  icon: string;
  quantity: number;
  revenue: number;
};

export async function topProducts(range: ResolvedRange): Promise<TopProduct[]> {
  const clauses = ["s.status = 'completed'"];
  const params: string[] = [];
  if (range.from) {
    clauses.push("s.sold_at >= ?");
    params.push(range.from);
  }
  if (range.to) {
    clauses.push("s.sold_at <= ?");
    params.push(range.to);
  }
  return (await (await getDb())
    .prepare(
      `SELECT l.product_id AS productId, l.product_name AS name, l.product_icon AS icon,
              SUM(l.quantity) AS quantity, SUM(l.line_total) AS revenue
       FROM sale_lines l
       JOIN sales s ON s.id = l.sale_id
       WHERE ${clauses.join(" AND ")}
       GROUP BY l.product_id
       ORDER BY quantity DESC, revenue DESC
       LIMIT 5`,
    )
    .all(...params)) as TopProduct[];
}

export async function lowStockItems(): Promise<(ItemOption & { level: StockLevel })[]> {
  return (await listItemOptions())
    .filter((item) => item.active)
    .map((item) => ({ ...item, level: stockStatus(item.quantityBase, item.minimumStock) }))
    .filter((item) => item.level !== "ok")
    .sort((a, b) => {
      if (a.level !== b.level) return a.level === "out" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
}

export async function dashboardPeriods(today = todayISO()) {
  return {
    today: await periodStats(today, today),
    week: await periodStats(startOfWeek(today), endOfWeek(today)),
    month: await periodStats(startOfMonth(today), endOfMonth(today)),
  };
}

export { stockStatus };
