import { isBaseUnit, isCategory, isInputUnit, type BaseUnit, type Category, type InputUnit } from "./constants";
import { assertIsoDate } from "./dates";
import { DomainError } from "./errors";
import { convertToBase } from "./units";

const MAX_BASE = 1_000_000_000;
const MAX_MONEY = 100_000_000;

export function cleanName(input: string, label = "Name"): string {
  const name = input.trim().replace(/\s+/g, " ");
  if (!name) throw new DomainError(`Enter a ${label.toLowerCase()}.`);
  if (name.length > 80) throw new DomainError(`${label} must be 80 characters or fewer.`);
  return name;
}

export function cleanIcon(input: string | undefined, fallback: string): string {
  const trimmed = (input ?? "").trim();
  if (!trimmed) return fallback;
  const chars = Array.from(trimmed);
  if (chars.length > 4) throw new DomainError("Use a short emoji for the icon.");
  return chars.join("");
}

export function cleanOptional(input: string | undefined | null, max: number, label: string): string | null {
  const value = (input ?? "").trim();
  if (!value) return null;
  if (value.length > max) throw new DomainError(`${label} must be ${max} characters or fewer.`);
  return value;
}

export function cleanCategory(input: string): Category {
  if (!isCategory(input)) throw new DomainError("Choose a category.");
  return input;
}

export function cleanBaseUnit(input: string): BaseUnit {
  if (!isBaseUnit(input)) throw new DomainError("Choose how this item is measured.");
  return input;
}

export function cleanDate(input: string, label = "Date"): string {
  try {
    return assertIsoDate(input, label);
  } catch (error) {
    throw new DomainError(error instanceof Error ? error.message : `Enter a valid ${label.toLowerCase()}.`);
  }
}

export function cleanMoney(input: number, label: string, allowZero = true): number {
  if (!Number.isFinite(input)) throw new DomainError(`Enter a valid ${label.toLowerCase()}.`);
  if (input < 0) throw new DomainError(`${label} can't be negative.`);
  if (!allowZero && input === 0) throw new DomainError(`Enter a ${label.toLowerCase()}.`);
  if (input > MAX_MONEY) throw new DomainError(`${label} is too large.`);
  return input;
}

export function quantityToBase(amount: number, unit: string, base: BaseUnit): number {
  if (!Number.isFinite(amount) || amount <= 0) throw new DomainError("Enter a quantity greater than zero.");
  if (!isInputUnit(unit)) throw new DomainError("Choose a unit.");
  const quantityBase = convertToBase(amount, unit, base);
  if (quantityBase > MAX_BASE) throw new DomainError("That quantity is too large.");
  return quantityBase;
}

export function parseDecimal(input: unknown): number {
  if (typeof input === "number") return input;
  if (typeof input !== "string") return Number.NaN;
  const cleaned = input.replace(/,/g, "").trim();
  if (!cleaned) return Number.NaN;
  return Number(cleaned);
}
