import { getDb } from "./db";
import { seedIfEmpty } from "./seed";

export function ensureReady(): void {
  getDb();
  if (process.env.BAKESHOP_SEED !== "0") seedIfEmpty();
}
