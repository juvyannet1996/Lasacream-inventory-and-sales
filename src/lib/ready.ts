import { getDb } from "./db";

export async function ensureReady(): Promise<void> {
  await getDb();
}
