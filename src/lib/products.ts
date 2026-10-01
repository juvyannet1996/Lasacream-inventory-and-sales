import { randomUUID } from "node:crypto";
import { getDb, withTransaction } from "./db";
import { nowIso } from "./dates";
import { DomainError } from "./errors";
import { requireItem } from "./inventory";
import { cleanIcon, cleanMoney, cleanName } from "./validate";

export type RecipeLineRecord = {
  itemId: string;
  quantityBase: number;
};

export type ProductRecord = {
  id: string;
  name: string;
  icon: string;
  defaultPrice: number | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  recipe: RecipeLineRecord[];
};

type ProductRow = {
  id: string;
  name: string;
  icon: string;
  default_price: number | null;
  active: number;
  created_at: string;
  updated_at: string;
};

function mapProduct(row: ProductRow, recipe: RecipeLineRecord[]): ProductRecord {
  return {
    id: row.id,
    name: row.name,
    icon: row.icon,
    defaultPrice: row.default_price,
    active: row.active === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    recipe,
  };
}

function loadRecipe(productId: string): RecipeLineRecord[] {
  const rows = getDb()
    .prepare(
      `SELECT inventory_item_id AS itemId, quantity_base AS quantityBase
       FROM recipe_lines WHERE product_id = ? ORDER BY rowid`,
    )
    .all(productId) as RecipeLineRecord[];
  return rows;
}

export function getProduct(id: string): ProductRecord | null {
  const row = getDb().prepare("SELECT * FROM products WHERE id = ?").get(id) as ProductRow | undefined;
  if (!row) return null;
  return mapProduct(row, loadRecipe(id));
}

export function listProducts(): ProductRecord[] {
  const rows = getDb().prepare("SELECT * FROM products ORDER BY name COLLATE NOCASE").all() as ProductRow[];
  const lines = getDb()
    .prepare(
      `SELECT product_id AS productId, inventory_item_id AS itemId, quantity_base AS quantityBase
       FROM recipe_lines ORDER BY rowid`,
    )
    .all() as { productId: string; itemId: string; quantityBase: number }[];
  const byProduct = new Map<string, RecipeLineRecord[]>();
  for (const line of lines) {
    const list = byProduct.get(line.productId) ?? [];
    list.push({ itemId: line.itemId, quantityBase: line.quantityBase });
    byProduct.set(line.productId, list);
  }
  return rows.map((row) => mapProduct(row, byProduct.get(row.id) ?? []));
}

export type ProductInput = {
  name: string;
  icon?: string;
  defaultPrice?: number | null;
  active?: boolean;
  recipe?: { itemId: string; quantityBase: number }[];
};

export function saveProduct(input: ProductInput & { id?: string }): ProductRecord {
  return withTransaction(() => {
    const name = cleanName(input.name, "Product name");
    const icon = cleanIcon(input.icon, "🎂");
    const defaultPrice =
      input.defaultPrice === null || input.defaultPrice === undefined || Number.isNaN(input.defaultPrice)
        ? null
        : cleanMoney(input.defaultPrice, "Default price", true);
    const active = input.active === false ? 0 : 1;
    const timestamp = nowIso();
    let id = input.id;
    if (id) {
      const existing = getProduct(id);
      if (!existing) throw new DomainError("That product no longer exists.");
      assertUniqueProductName(name, id);
      getDb()
        .prepare(
          `UPDATE products
           SET name = ?, icon = ?, default_price = ?, active = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(name, icon, defaultPrice, active, timestamp, id);
    } else {
      assertUniqueProductName(name);
      id = randomUUID();
      getDb()
        .prepare(
          `INSERT INTO products (id, name, icon, default_price, active, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(id, name, icon, defaultPrice, active, timestamp, timestamp);
    }
    if (input.recipe) {
      replaceRecipe(id, input.recipe, timestamp);
    }
    const saved = getProduct(id);
    if (!saved) throw new DomainError("Couldn't save that product.");
    return saved;
  });
}

export function saveRecipe(productId: string, lines: { itemId: string; quantityBase: number }[]): ProductRecord {
  return withTransaction(() => {
    const existing = getProduct(productId);
    if (!existing) throw new DomainError("That product no longer exists.");
    replaceRecipe(productId, lines, nowIso());
    getDb().prepare("UPDATE products SET updated_at = ? WHERE id = ?").run(nowIso(), productId);
    return getProduct(productId)!;
  });
}

function replaceRecipe(productId: string, lines: { itemId: string; quantityBase: number }[], timestamp: string): void {
  const merged = new Map<string, number>();
  for (const line of lines) {
    const item = requireItem(line.itemId);
    if (!Number.isFinite(line.quantityBase) || line.quantityBase <= 0) {
      throw new DomainError(`Enter a quantity for ${item.name}.`);
    }
    if (line.quantityBase > 1_000_000_000) throw new DomainError(`The quantity for ${item.name} is too large.`);
    merged.set(item.id, (merged.get(item.id) ?? 0) + line.quantityBase);
  }
  const db = getDb();
  db.prepare("DELETE FROM recipe_lines WHERE product_id = ?").run(productId);
  const insert = db.prepare(
    `INSERT INTO recipe_lines (id, product_id, inventory_item_id, quantity_base, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  for (const [itemId, quantityBase] of merged) {
    insert.run(randomUUID(), productId, itemId, quantityBase, timestamp, timestamp);
  }
}

function assertUniqueProductName(name: string, exceptId?: string): void {
  const row = getDb().prepare("SELECT id, active FROM products WHERE lower(name) = lower(?)").get(name) as
    | { id: string; active: number }
    | undefined;
  if (row && row.id !== exceptId) {
    throw new DomainError(
      row.active
        ? `"${name}" is already a product.`
        : `"${name}" is an inactive product. Reactivate it instead of adding a duplicate.`,
    );
  }
}
