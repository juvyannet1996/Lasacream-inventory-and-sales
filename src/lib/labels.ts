import { REASON_LABELS, type AdjustmentReason } from "./constants";

export function movementTitle(type: string, referenceType: string | null): string {
  if (referenceType === "sale_reversal") return "Sale reversal";
  if (type === "purchase") return "Purchase";
  if (type === "sale") return "Sale";
  if (type === "wastage") return "Wastage";
  return "Adjustment";
}

export function reasonText(reason: string | null): string | null {
  if (!reason) return null;
  if (reason in REASON_LABELS) return REASON_LABELS[reason as AdjustmentReason];
  return reason;
}
