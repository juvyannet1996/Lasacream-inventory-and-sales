import type { BaseUnit } from "./constants";

function roundTo(amount: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(amount * factor) / factor;
}

export function formatPeso(amount: number): string {
  if (!Number.isFinite(amount)) return "₱0";
  const abs = Math.abs(amount);
  let maxFrac = 2;
  if (abs > 0 && abs < 0.1) maxFrac = 3;
  if (abs > 0 && abs < 0.01) maxFrac = 4;
  const rounded = roundTo(amount, maxFrac);
  const roundedAbs = Math.abs(rounded);
  const minFrac = Number.isInteger(rounded) ? 0 : Math.min(2, maxFrac);
  const body = roundedAbs.toLocaleString("en-US", {
    minimumFractionDigits: minFrac,
    maximumFractionDigits: maxFrac,
  });
  return `${rounded < 0 ? "−" : ""}₱${body}`;
}

/** Display average cost in the practical unit: per kg, per L, or per pc. */
export function formatUnitCost(costPerBase: number, base: BaseUnit): string {
  if (base === "g") return `${formatPeso(costPerBase * 1000)}/kg`;
  if (base === "ml") return `${formatPeso(costPerBase * 1000)}/L`;
  return `${formatPeso(costPerBase)}/pc`;
}
