import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { seedIfEmpty } from "./seed";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS inventory_items (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('ingredient', 'packaging', 'finished_good', 'other')),
  icon TEXT NOT NULL,
  base_unit TEXT NOT NULL CHECK (base_unit IN ('g', 'ml', 'pcs')),
  minimum_stock REAL NOT NULL DEFAULT 0 CHECK (minimum_stock >= 0),
  quantity_base REAL NOT NULL DEFAULT 0,
  inventory_value REAL NOT NULL DEFAULT 0,
  average_cost_per_base_unit REAL NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE UNIQUE INDEX IF NOT EXISTS inventory_items_name_unique ON inventory_items (lower(name));

CREATE TABLE IF NOT EXISTS inventory_transactions (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES inventory_items(id),
  type TEXT NOT NULL CHECK (type IN ('purchase', 'sale', 'wastage', 'adjustment')),
  quantity_base REAL NOT NULL CHECK (quantity_base != 0),
  unit_cost_per_base REAL NOT NULL,
  total_cost REAL NOT NULL,
  reason TEXT,
  reference_type TEXT,
  reference_id TEXT,
  reference_line_id TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'posted' CHECK (status IN ('posted', 'reversed')),
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS idx_txn_item ON inventory_transactions(item_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_txn_occurred ON inventory_transactions(occurred_at);
CREATE INDEX IF NOT EXISTS idx_txn_type ON inventory_transactions(type);
CREATE INDEX IF NOT EXISTS idx_txn_reference ON inventory_transactions(reference_id, reference_type);

CREATE TABLE IF NOT EXISTS purchases (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES inventory_items(id),
  quantity_input REAL NOT NULL CHECK (quantity_input > 0),
  input_unit TEXT NOT NULL,
  quantity_base REAL NOT NULL CHECK (quantity_base > 0),
  purchase_cost REAL NOT NULL CHECK (purchase_cost >= 0),
  unit_cost_per_base REAL NOT NULL,
  supplier TEXT,
  notes TEXT,
  purchased_at TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS idx_purchases_item ON purchases(item_id, purchased_at);

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  icon TEXT NOT NULL,
  default_price REAL CHECK (default_price IS NULL OR default_price >= 0),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE UNIQUE INDEX IF NOT EXISTS products_name_unique ON products (lower(name));

CREATE TABLE IF NOT EXISTS recipe_lines (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id),
  inventory_item_id TEXT NOT NULL REFERENCES inventory_items(id),
  quantity_base REAL NOT NULL CHECK (quantity_base > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (product_id, inventory_item_id)
) STRICT;

CREATE TABLE IF NOT EXISTS sales (
  id TEXT PRIMARY KEY,
  sold_at TEXT NOT NULL,
  customer_name TEXT,
  notes TEXT,
  status TEXT NOT NULL CHECK (status IN ('completed', 'voided')),
  total_price REAL NOT NULL,
  estimated_cost REAL NOT NULL,
  estimated_profit REAL NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS idx_sales_sold ON sales(sold_at, status);

CREATE TABLE IF NOT EXISTS sale_lines (
  id TEXT PRIMARY KEY,
  sale_id TEXT NOT NULL REFERENCES sales(id),
  product_id TEXT REFERENCES products(id),
  product_name TEXT NOT NULL,
  product_icon TEXT NOT NULL,
  quantity REAL NOT NULL CHECK (quantity > 0),
  unit_price REAL NOT NULL CHECK (unit_price >= 0),
  line_total REAL NOT NULL,
  estimated_cost REAL NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS idx_sale_lines_sale ON sale_lines(sale_id);

CREATE TABLE IF NOT EXISTS sale_consumptions (
  id TEXT PRIMARY KEY,
  sale_id TEXT NOT NULL REFERENCES sales(id),
  sale_line_id TEXT NOT NULL REFERENCES sale_lines(id),
  inventory_item_id TEXT NOT NULL REFERENCES inventory_items(id),
  item_name TEXT NOT NULL,
  item_icon TEXT NOT NULL,
  base_unit TEXT NOT NULL,
  quantity_base REAL NOT NULL CHECK (quantity_base > 0),
  unit_cost_per_base REAL NOT NULL,
  total_cost REAL NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS idx_consumptions_sale ON sale_consumptions(sale_id, sale_line_id);
`;

let database: DatabaseSync | null = null;
let txDepth = 0;

export function defaultDatabasePath(): string {
  return path.join(process.cwd(), "data", "bakeshop.db");
}

export function migrate(db: DatabaseSync): void {
  db.exec(SCHEMA);
}

export function openDatabase(filename: string): DatabaseSync {
  const db = new DatabaseSync(filename);
  db.exec("PRAGMA foreign_keys = ON");
  migrate(db);
  return db;
}

/** Test hook. Replaces the process-wide connection and does not seed. */
export function useDatabase(db: DatabaseSync): void {
  database = db;
  txDepth = 0;
}

export function getDb(): DatabaseSync {
  if (!database) {
    const filename = process.env.BAKESHOP_DB ?? defaultDatabasePath();
    mkdirSync(path.dirname(filename), { recursive: true });
    const db = new DatabaseSync(filename);
    db.exec("PRAGMA foreign_keys = ON");
    db.exec("PRAGMA journal_mode = WAL");
    migrate(db);
    database = db;
    if (process.env.BAKESHOP_SEED !== "0") seedIfEmpty();
  }
  return database;
}

export function withTransaction<T>(fn: () => T): T {
  const db = getDb();
  if (txDepth > 0) return fn();
  db.exec("BEGIN IMMEDIATE");
  txDepth += 1;
  try {
    const result = fn();
    txDepth -= 1;
    db.exec("COMMIT");
    return result;
  } catch (error) {
    txDepth -= 1;
    try {
      db.exec("ROLLBACK");
    } catch {
      // The connection may already be outside a transaction.
    }
    throw error;
  }
}
