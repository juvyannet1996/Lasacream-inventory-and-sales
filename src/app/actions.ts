"use server";

import { revalidatePath } from "next/cache";
import { isDomainError } from "@/lib/errors";
import { createAdjustment, createItem, createPurchase, createPurchaseReceipt, updateItem, type ItemInput } from "@/lib/inventory";
import { saveProduct, type ProductInput } from "@/lib/products";
import { saveRecipeFromSaleLine, saveSale, voidSale, type SaleInput } from "@/lib/sales";
import { ensureReady } from "@/lib/ready";

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

async function finish<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    await ensureReady();
    const data = await fn();
    revalidatePath("/", "layout");
    return { ok: true, data };
  } catch (error) {
    if (isDomainError(error)) return { ok: false, error: error.message };
    console.error(error);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}

export async function createItemAction(input: ItemInput): Promise<ActionResult<Awaited<ReturnType<typeof createItem>>>> {
  return finish(() => createItem(input));
}

export async function updateItemAction(
  id: string,
  input: ItemInput,
): Promise<ActionResult<Awaited<ReturnType<typeof updateItem>>>> {
  return finish(() => updateItem(id, input));
}

export async function createPurchaseAction(
  input: Parameters<typeof createPurchase>[0],
): Promise<ActionResult<{ id: string }>> {
  return finish(async () => ({ id: await createPurchase(input) }));
}

export async function createPurchaseReceiptAction(
  input: Parameters<typeof createPurchaseReceipt>[0],
): Promise<ActionResult<{ id: string }>> {
  return finish(async () => ({ id: await createPurchaseReceipt(input) }));
}

export async function createAdjustmentAction(
  input: Parameters<typeof createAdjustment>[0],
): Promise<ActionResult<{ ok: true }>> {
  return finish(async () => {
    await createAdjustment(input);
    return { ok: true as const };
  });
}

export async function saveProductAction(
  input: ProductInput & { id?: string },
): Promise<ActionResult<Awaited<ReturnType<typeof saveProduct>>>> {
  return finish(() => saveProduct(input));
}

export async function saveSaleAction(input: SaleInput): Promise<ActionResult<{ id: string }>> {
  return finish(async () => ({ id: await saveSale(input) }));
}

export async function voidSaleAction(id: string): Promise<ActionResult<{ ok: true }>> {
  return finish(async () => {
    await voidSale(id);
    return { ok: true as const };
  });
}

export async function saveRecipeFromSaleAction(
  saleId: string,
  lineId: string,
): Promise<ActionResult<{ productId: string }>> {
  return finish(async () => ({ productId: await saveRecipeFromSaleLine(saleId, lineId) }));
}
