import { randomUUID } from "node:crypto";
import { getDb, rememberItem, rememberedItem, withTransaction } from "./db";
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

async function loadRecipe(productId: string): Promise<RecipeLineRecord[]> {
  return (await (await getDb())
    .prepare(
      `SELECT inventory_item_id AS itemId, quantity_base AS quantityBase
       FROM recipe_lines WHERE product_id = ? ORDER BY rowid`,
    )
    .all(productId)) as RecipeLineRecord[];
}

function productMemoryKey(id: string): string {
  return `product:${id}`;
}

export function rememberProduct(product: ProductRecord): void {
  rememberItem(productMemoryKey(product.id), product);
}

export async function getProduct(id: string): Promise<ProductRecord | null> {
  const cached = rememberedItem<ProductRecord>(productMemoryKey(id));
  if (cached) return cached;
  const row = (await (await getDb()).prepare("SELECT * FROM products WHERE id = ?").get(id)) as ProductRow | undefined;
  if (!row) return null;
  return mapProduct(row, await loadRecipe(id));
}

export async function listProducts(): Promise<ProductRecord[]> {
  const rows = (await (await getDb()).prepare("SELECT * FROM products ORDER BY name COLLATE NOCASE").all()) as ProductRow[];
  const lines = (await (await getDb())
    .prepare(
      `SELECT product_id AS productId, inventory_item_id AS itemId, quantity_base AS quantityBase
       FROM recipe_lines ORDER BY rowid`,
    )
    .all()) as { productId: string; itemId: string; quantityBase: number }[];
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

export async function saveProduct(input: ProductInput & { id?: string }): Promise<ProductRecord> {
  return withTransaction(async () => {
    const name = cleanName(input.name, "Product name");
    const icon = cleanIcon(input.icon, "🎂");
    const defaultPrice =
      input.defaultPrice === null || input.defaultPrice === undefined || Number.isNaN(input.defaultPrice)
        ? null
        : cleanMoney(input.defaultPrice, "Default price", true);
    const active = input.active === false ? 0 : 1;
    const timestamp = nowIso();
    let id = input.id;
    let createdAt = timestamp;
    let recipe: RecipeLineRecord[] = [];
    if (id) {
      const existing = await getProduct(id);
      if (!existing) throw new DomainError("That product no longer exists.");
      createdAt = existing.createdAt;
      recipe = existing.recipe;
      await assertUniqueProductName(name, id);
      await (await getDb())
        .prepare(
          `UPDATE products
           SET name = ?, icon = ?, default_price = ?, active = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(name, icon, defaultPrice, active, timestamp, id);
    } else {
      await assertUniqueProductName(name);
      id = randomUUID();
      await (await getDb())
        .prepare(
          `INSERT INTO products (id, name, icon, default_price, active, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(id, name, icon, defaultPrice, active, timestamp, timestamp);
    }
    if (input.recipe) recipe = await replaceRecipe(id, input.recipe, timestamp);
    const saved: ProductRecord = {
      id,
      name,
      icon,
      defaultPrice,
      active: active === 1,
      createdAt,
      updatedAt: timestamp,
      recipe,
    };
    rememberProduct(saved);
    return saved;
  });
}

export async function saveRecipe(
  productId: string,
  lines: { itemId: string; quantityBase: number }[],
): Promise<ProductRecord> {
  return withTransaction(async () => {
    const existing = await getProduct(productId);
    if (!existing) throw new DomainError("That product no longer exists.");
    const timestamp = nowIso();
    const recipe = await replaceRecipe(productId, lines, timestamp);
    await (await getDb()).prepare("UPDATE products SET updated_at = ? WHERE id = ?").run(timestamp, productId);
    const saved = { ...existing, updatedAt: timestamp, recipe };
    rememberProduct(saved);
    return saved;
  });
}

async function replaceRecipe(
  productId: string,
  lines: { itemId: string; quantityBase: number }[],
  timestamp: string,
): Promise<RecipeLineRecord[]> {
  const merged = new Map<string, number>();
  for (const line of lines) {
    const item = await requireItem(line.itemId);
    if (!Number.isFinite(line.quantityBase) || line.quantityBase <= 0) {
      throw new DomainError(`Enter a quantity for ${item.name}.`);
    }
    if (line.quantityBase > 1_000_000_000) throw new DomainError(`The quantity for ${item.name} is too large.`);
    merged.set(item.id, (merged.get(item.id) ?? 0) + line.quantityBase);
  }
  const db = await getDb();
  await db.prepare("DELETE FROM recipe_lines WHERE product_id = ?").run(productId);
  const saved: RecipeLineRecord[] = [];
  for (const [itemId, quantityBase] of merged) {
    await db
      .prepare(
        `INSERT INTO recipe_lines (id, product_id, inventory_item_id, quantity_base, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(randomUUID(), productId, itemId, quantityBase, timestamp, timestamp);
    saved.push({ itemId, quantityBase });
  }
  return saved;
}

async function assertUniqueProductName(name: string, exceptId?: string): Promise<void> {
  const row = (await (await getDb()).prepare("SELECT id, active FROM products WHERE lower(name) = lower(?)").get(name)) as
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
