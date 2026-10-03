import { AsyncLocalStorage } from "node:async_hooks";
import path from "node:path";

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

CREATE TABLE IF NOT EXISTS purchase_receipts (
  id TEXT PRIMARY KEY,
  supplier TEXT,
  notes TEXT,
  purchased_at TEXT NOT NULL,
  total_cost REAL NOT NULL CHECK (total_cost >= 0),
  created_at TEXT NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS idx_receipts_date ON purchase_receipts(purchased_at);

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

export type SqlValue = string | number | null | bigint;

export type Statement = {
  get<T = unknown>(...params: SqlValue[]): Promise<T | undefined>;
  all<T = unknown>(...params: SqlValue[]): Promise<T[]>;
  run(...params: SqlValue[]): Promise<void>;
};

export type Sql = {
  prepare(sql: string): Statement;
  exec(sql: string): Promise<void>;
};

type D1Prepared = {
  bind(...values: unknown[]): D1Prepared;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<{ results?: T[] }>;
  run(): Promise<unknown>;
};

type D1Like = {
  prepare(sql: string): D1Prepared;
  batch(statements: D1Prepared[]): Promise<unknown>;
  exec(sql: string): Promise<unknown>;
};

export type SqliteDatabase = {
  exec(sql: string): void;
  prepare(sql: string): {
    get(...params: SqlValue[]): unknown;
    all(...params: SqlValue[]): unknown[];
    run(...params: SqlValue[]): unknown;
  };
};

type TxState = {
  depth: number;
  overlay: Map<string, unknown>;
  buffer: { sql: string; params: SqlValue[] }[] | null;
};

const txState = new AsyncLocalStorage<TxState>();
let testDb: SqliteDatabase | null = null;
let fileDb: SqliteDatabase | null = null;
let simulatedD1: D1Like | null = null;
let d1Schema: Promise<void> | null = null;
let readyPromise: Promise<void> | null = null;
let readyDone = false;

export function defaultDatabasePath(): string {
  return path.join(process.cwd(), "data", "lasacream.db");
}

export function migrate(db: SqliteDatabase): void {
  db.exec(SCHEMA);
  ensureReceiptColumnSync(db);
}

function ensureReceiptColumnSync(db: SqliteDatabase): void {
  const columns = db.prepare("PRAGMA table_info(purchases)").all() as { name: string }[];
  if (!columns.some((column) => column.name === "receipt_id")) {
    db.exec("ALTER TABLE purchases ADD COLUMN receipt_id TEXT");
  }
  db.exec("CREATE INDEX IF NOT EXISTS idx_purchases_receipt ON purchases(receipt_id)");
}

export async function openDatabase(filename: string): Promise<SqliteDatabase> {
  const { DatabaseSync } = await loadSqlite();
  const db = new DatabaseSync(filename);
  db.exec("PRAGMA foreign_keys = ON");
  migrate(db);
  return db;
}

/** Test hook. Uses a real SQLite transaction for each saved change. */
export function useDatabase(db: SqliteDatabase): void {
  testDb = db;
  simulatedD1 = null;
  readyDone = false;
  readyPromise = null;
}

/**
 * Test hook. Saves behave like Cloudflare D1: writes inside a change are
 * stored together at the end, and reads of stock use the in-memory copy.
 */
export function useD1Simulator(db: SqliteDatabase): void {
  testDb = null;
  simulatedD1 = sqliteBackedD1(db);
  d1Schema = Promise.resolve();
  readyDone = false;
  readyPromise = null;
}

/** Test hook. Drops the open connection. */
export function resetDatabaseForTests(): void {
  testDb = null;
  simulatedD1 = null;
  d1Schema = null;
  readyDone = false;
  readyPromise = null;
}

export function rememberedItem<T>(id: string): T | undefined {
  return txState.getStore()?.overlay.get(id) as T | undefined;
}

export function rememberItem(id: string, value: unknown): void {
  txState.getStore()?.overlay.set(id, value);
}

export async function getDb(): Promise<Sql> {
  await whenReady();
  const d1 = await activeD1();
  if (d1) {
    const buffer = txState.getStore()?.buffer ?? null;
    return d1Adapter(d1, buffer);
  }
  return sqliteAdapter(await sqliteHandle());
}

async function whenReady(): Promise<void> {
  if (readyDone) return;
  if (!readyPromise) {
    readyPromise = (async () => {
      await openSchema();
      readyDone = true;
      if (shouldSeed()) {
        const { seedIfEmpty } = await import("./seed");
        await seedIfEmpty();
      }
    })().catch((error: unknown) => {
      readyDone = false;
      readyPromise = null;
      throw error;
    });
  }
  await readyPromise;
}

async function openSchema(): Promise<void> {
  const d1 = await activeD1();
  if (d1) {
    await ensureD1Schema(d1);
    await ensureReceiptColumn(d1Adapter(d1, null));
    return;
  }
  await sqliteHandle();
}

async function ensureReceiptColumn(db: Sql): Promise<void> {
  const columns = (await db.prepare("PRAGMA table_info(purchases)").all()) as { name: string }[];
  if (!columns.some((column) => column.name === "receipt_id")) {
    await db.exec("ALTER TABLE purchases ADD COLUMN receipt_id TEXT");
  }
  await db.exec("CREATE INDEX IF NOT EXISTS idx_purchases_receipt ON purchases(receipt_id)");
}

function shouldSeed(): boolean {
  if (process.env.BAKESHOP_SEED === "0") return false;
  if (testDb || simulatedD1) return false;
  return true;
}

export async function withTransaction<T>(fn: () => Promise<T>): Promise<T> {
  const current = txState.getStore();
  if (current && current.depth > 0) {
    current.depth += 1;
    try {
      return await fn();
    } finally {
      current.depth -= 1;
    }
  }

  const d1 = await activeD1();
  if (d1) {
    await ensureD1Schema(d1);
    const state: TxState = { depth: 1, overlay: new Map(), buffer: [] };
    return txState.run(state, async () => {
      const result = await fn();
      const statements = state.buffer ?? [];
      if (statements.length > 0) {
        await d1.batch([
          d1.prepare("PRAGMA foreign_keys = ON"),
          ...statements.map(({ sql, params }) => {
            const prepared = d1.prepare(sql);
            return params.length > 0 ? prepared.bind(...params) : prepared;
          }),
        ]);
      }
      return result;
    });
  }

  const db = await sqliteHandle();
  const state: TxState = { depth: 1, overlay: new Map(), buffer: null };
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = await txState.run(state, fn);
    db.exec("COMMIT");
    return result;
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // The connection may already be outside a transaction.
    }
    throw error;
  }
}

async function activeD1(): Promise<D1Like | null> {
  if (testDb) return null;
  if (simulatedD1) return simulatedD1;
  return cloudflareD1();
}

async function sqliteHandle(): Promise<SqliteDatabase> {
  if (testDb) return testDb;
  if (!fileDb) {
    const { mkdirSync } = await loadFs();
    const filename = process.env.BAKESHOP_DB ?? defaultDatabasePath();
    mkdirSync(path.dirname(filename), { recursive: true });
    fileDb = await openDatabase(filename);
    fileDb.exec("PRAGMA journal_mode = WAL");
  }
  return fileDb;
}

function sqliteAdapter(db: SqliteDatabase): Sql {
  return {
    async exec(sql: string) {
      db.exec(sql);
    },
    prepare(sql: string) {
      const statement = db.prepare(sql);
      return {
        async get<T>(...params: SqlValue[]) {
          return statement.get(...params) as T | undefined;
        },
        async all<T>(...params: SqlValue[]) {
          return statement.all(...params) as T[];
        },
        async run(...params: SqlValue[]) {
          statement.run(...params);
        },
      };
    },
  };
}

function d1Adapter(d1: D1Like, buffer: { sql: string; params: SqlValue[] }[] | null): Sql {
  return {
    async exec(sql: string) {
      if (buffer) throw new Error("Schema changes belong outside a saved change.");
      await d1.exec(sql);
    },
    prepare(sql: string) {
      return {
        async get<T>(...params: SqlValue[]) {
          const prepared = d1.prepare(sql);
          const bound = params.length > 0 ? prepared.bind(...params) : prepared;
          const row = await bound.first<T>();
          return row ?? undefined;
        },
        async all<T>(...params: SqlValue[]) {
          const prepared = d1.prepare(sql);
          const bound = params.length > 0 ? prepared.bind(...params) : prepared;
          const result = await bound.all<T>();
          return result.results ?? [];
        },
        async run(...params: SqlValue[]) {
          if (buffer) {
            buffer.push({ sql, params });
            return;
          }
          const prepared = d1.prepare(sql);
          if (params.length > 0) await prepared.bind(...params).run();
          else await prepared.run();
        },
      };
    },
  };
}

function sqliteBackedD1(db: SqliteDatabase): D1Like {
  return {
    prepare(sql: string) {
      const build = (params: SqlValue[]): D1Prepared => ({
        bind(...values: unknown[]) {
          return build(values as SqlValue[]);
        },
        async first<T>() {
          return (db.prepare(sql).get(...params) as T | undefined) ?? null;
        },
        async all<T>() {
          return { results: db.prepare(sql).all(...params) as T[] };
        },
        async run() {
          if (/^\s*pragma/i.test(sql)) return;
          db.prepare(sql).run(...params);
        },
      });
      return build([]);
    },
    async batch(statements: D1Prepared[]) {
      db.exec("BEGIN IMMEDIATE");
      try {
        for (const statement of statements) await statement.run();
        db.exec("COMMIT");
      } catch (error) {
        try {
          db.exec("ROLLBACK");
        } catch {
          // The connection may already be outside a transaction.
        }
        throw error;
      }
    },
    async exec(sql: string) {
      db.exec(sql);
    },
  };
}

function schemaStatements(): string[] {
  return SCHEMA.split(";")
    .map((statement) => statement.replace(/\s+/g, " ").trim())
    .filter((statement) => statement.length > 0);
}

async function ensureD1Schema(d1: D1Like): Promise<void> {
  if (!d1Schema) {
    const statements = schemaStatements();
    d1Schema = d1
      .batch(statements.map((sql) => d1.prepare(sql)))
      .then(() => undefined)
      .catch((error: unknown) => {
        d1Schema = null;
        throw error;
      });
  }
  await d1Schema;
}

function runningOnCloudflare(): boolean {
  return typeof navigator !== "undefined" && navigator.userAgent === "Cloudflare-Workers";
}

async function cloudflareD1(): Promise<D1Like | null> {
  if (process.env.BAKESHOP_DB) return null;
  if (!runningOnCloudflare()) return null;
  try {
    const mod = (await import("@opennextjs/cloudflare")) as unknown as {
      getCloudflareContext: (options?: { async?: boolean }) => Promise<{ env?: { DB?: D1Like } }>;
    };
    const context = await mod.getCloudflareContext({ async: true });
    return context.env?.DB ?? null;
  } catch {
    return null;
  }
}

async function loadSqlite(): Promise<{ DatabaseSync: new (filename: string) => SqliteDatabase }> {
  const dynamicImport = new Function("specifier", "return import(specifier)") as (
    specifier: string,
  ) => Promise<{ DatabaseSync: new (filename: string) => SqliteDatabase }>;
  return dynamicImport("node:" + "sqlite");
}

async function loadFs(): Promise<{ mkdirSync: (directory: string, options: { recursive: boolean }) => void }> {
  const dynamicImport = new Function("specifier", "return import(specifier)") as (
    specifier: string,
  ) => Promise<{ mkdirSync: (directory: string, options: { recursive: boolean }) => void }>;
  return dynamicImport("node:" + "fs");
}
