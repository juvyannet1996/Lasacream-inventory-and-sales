export const CATEGORIES = ["ingredient", "packaging", "finished_good", "other"] as const;
export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABELS: Record<Category, string> = {
  ingredient: "Ingredient",
  packaging: "Packaging",
  finished_good: "Finished Good",
  other: "Other",
};

export const BASE_UNITS = ["g", "ml", "pcs"] as const;
export type BaseUnit = (typeof BASE_UNITS)[number];

export const INPUT_UNITS = ["g", "kg", "ml", "L", "pcs"] as const;
export type InputUnit = (typeof INPUT_UNITS)[number];

export const ADJUSTMENT_REASONS = [
  "wastage",
  "damaged",
  "expired",
  "personal_use",
  "count_correction",
  "other",
] as const;
export type AdjustmentReason = (typeof ADJUSTMENT_REASONS)[number];

export const REASON_LABELS: Record<AdjustmentReason, string> = {
  wastage: "Wastage",
  damaged: "Damaged",
  expired: "Expired",
  personal_use: "Personal Use",
  count_correction: "Count Correction",
  other: "Other",
};

export const TRANSACTION_TYPES = ["purchase", "sale", "wastage", "adjustment"] as const;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];

const LOSS_REASONS = new Set<AdjustmentReason>(["wastage", "damaged", "expired"]);

export function transactionTypeForReason(reason: AdjustmentReason): "wastage" | "adjustment" {
  return LOSS_REASONS.has(reason) ? "wastage" : "adjustment";
}

export function isCategory(value: string): value is Category {
  return (CATEGORIES as readonly string[]).includes(value);
}

export function isBaseUnit(value: string): value is BaseUnit {
  return (BASE_UNITS as readonly string[]).includes(value);
}

export function isInputUnit(value: string): value is InputUnit {
  return (INPUT_UNITS as readonly string[]).includes(value);
}

export function isAdjustmentReason(value: string): value is AdjustmentReason {
  return (ADJUSTMENT_REASONS as readonly string[]).includes(value);
}

export function isTransactionType(value: string): value is TransactionType {
  return (TRANSACTION_TYPES as readonly string[]).includes(value);
}
