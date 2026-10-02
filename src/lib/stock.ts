export type StockLevel = "ok" | "low" | "out";

export function stockStatus(quantityBase: number, minimumStock: number): StockLevel {
  if (quantityBase <= 0) return "out";
  if (minimumStock > 0 && quantityBase <= minimumStock) return "low";
  return "ok";
}

export function stockLabel(level: StockLevel): string | null {
  if (level === "out") return "Out of stock";
  if (level === "low") return "Low stock";
  return null;
}
