import type { BaseUnit, InputUnit } from "./constants";
import { DomainError } from "./errors";

const FACTORS: Record<InputUnit, { base: BaseUnit; factor: number }> = {
  g: { base: "g", factor: 1 },
  kg: { base: "g", factor: 1000 },
  ml: { base: "ml", factor: 1 },
  L: { base: "ml", factor: 1000 },
  pcs: { base: "pcs", factor: 1 },
};

export function unitsForBase(base: BaseUnit): InputUnit[] {
  if (base === "g") return ["kg", "g"];
  if (base === "ml") return ["L", "ml"];
  return ["pcs"];
}

export function defaultInputUnit(base: BaseUnit, context: "purchase" | "recipe"): InputUnit {
  if (base === "pcs") return "pcs";
  if (base === "ml") return context === "purchase" ? "L" : "ml";
  return context === "purchase" ? "kg" : "g";
}

export function convertToBase(amount: number, unit: InputUnit, base: BaseUnit): number {
  const spec = FACTORS[unit];
  if (!spec || spec.base !== base) {
    throw new DomainError(`${unit} can't be used for an item measured in ${baseLabel(base)}.`);
  }
  if (!Number.isFinite(amount)) {
    throw new DomainError("Enter a valid quantity.");
  }
  return amount * spec.factor;
}

export function fromBase(quantityBase: number, unit: InputUnit): number {
  return quantityBase / FACTORS[unit].factor;
}

export function preferredInput(
  quantityBase: number,
  base: BaseUnit,
): { amount: number; unit: InputUnit } {
  if (base === "pcs") return { amount: quantityBase, unit: "pcs" };
  if (base === "ml") {
    if (Math.abs(quantityBase) >= 1000) return { amount: quantityBase / 1000, unit: "L" };
    return { amount: quantityBase, unit: "ml" };
  }
  if (Math.abs(quantityBase) >= 1000) return { amount: quantityBase / 1000, unit: "kg" };
  return { amount: quantityBase, unit: "g" };
}

export function formatAmountInput(amount: number): string {
  if (!Number.isFinite(amount)) return "";
  const rounded = Math.round(amount * 1000) / 1000;
  return String(rounded);
}

export function formatNumber(amount: number): string {
  const rounded = Math.round(amount * 1000) / 1000;
  return rounded.toLocaleString("en-US", { maximumFractionDigits: 3 });
}

export function formatQuantity(quantityBase: number, base: BaseUnit, options?: { signed?: boolean }): string {
  const negative = quantityBase < 0;
  const absolute = Math.abs(quantityBase);
  let amount = absolute;
  let unit = base === "g" ? "g" : base === "ml" ? "ml" : "pcs";
  if (base === "g" && absolute >= 1000) {
    amount = absolute / 1000;
    unit = "kg";
  } else if (base === "ml" && absolute >= 1000) {
    amount = absolute / 1000;
    unit = "L";
  }
  let sign = "";
  if (options?.signed) {
    if (negative) sign = "−";
    else if (quantityBase > 0) sign = "+";
  } else if (negative) {
    sign = "−";
  }
  return `${sign}${formatNumber(amount)} ${unit}`;
}

export function baseLabel(base: BaseUnit): string {
  if (base === "g") return "weight";
  if (base === "ml") return "volume";
  return "pieces";
}

export function measurementLabel(base: BaseUnit): string {
  if (base === "g") return "Weight (grams)";
  if (base === "ml") return "Volume (milliliters)";
  return "Count (pieces)";
}
