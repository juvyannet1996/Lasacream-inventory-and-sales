export const BAKERY_TIMEZONE = "Asia/Manila";

export type RangePreset = "today" | "week" | "month" | "custom" | "all";
export type ChartGrain = "day" | "week" | "month";

export function todayISO(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: BAKERY_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function isIsoDate(value: string | undefined | null): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function assertIsoDate(value: string, label = "Date"): string {
  if (!isIsoDate(value)) throw new Error(`Enter a valid ${label.toLowerCase()}.`);
  const year = Number(value.slice(0, 4));
  if (year < 2000 || year > 2100) throw new Error(`${label} is out of range.`);
  return value;
}

function parseISODate(iso: string): Date {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function formatISODate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function addDays(iso: string, days: number): string {
  const date = parseISODate(iso);
  date.setUTCDate(date.getUTCDate() + days);
  return formatISODate(date);
}

export function startOfWeek(iso: string): string {
  const date = parseISODate(iso);
  const day = date.getUTCDay();
  const diff = day === 0 ? 6 : day - 1;
  date.setUTCDate(date.getUTCDate() - diff);
  return formatISODate(date);
}

export function endOfWeek(iso: string): string {
  return addDays(startOfWeek(iso), 6);
}

export function startOfMonth(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}

export function endOfMonth(iso: string): string {
  const date = parseISODate(startOfMonth(iso));
  date.setUTCMonth(date.getUTCMonth() + 1);
  date.setUTCDate(0);
  return formatISODate(date);
}

export function eachDate(from: string, to: string, limit = 400): string[] {
  const dates: string[] = [];
  let cursor = from;
  while (cursor <= to && dates.length < limit) {
    dates.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return dates;
}

export function formatDate(iso: string, today = todayISO()): string {
  const date = parseISODate(iso);
  const sameYear = iso.slice(0, 4) === today.slice(0, 4);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: sameYear ? undefined : "numeric",
    timeZone: "UTC",
  }).format(date);
}

export function formatDateWithYear(iso: string): string {
  const date = parseISODate(iso);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

export function monthLabel(iso: string): string {
  const date = parseISODate(`${iso.slice(0, 7)}-01`);
  return new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" }).format(date);
}

export function monthShort(iso: string): string {
  const date = parseISODate(`${iso.slice(0, 7)}-01`);
  return new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" }).format(date);
}

export type ResolvedRange = {
  preset: RangePreset;
  from: string | null;
  to: string | null;
};

export function resolveRange(
  input: { range?: string; from?: string; to?: string },
  options: { defaultPreset: RangePreset; today?: string },
): ResolvedRange {
  const today = options.today ?? todayISO();
  const range = input.range;
  if (range === "all") return { preset: "all", from: null, to: null };
  if (range === "today") return { preset: "today", from: today, to: today };
  if (range === "week") return { preset: "week", from: startOfWeek(today), to: endOfWeek(today) };
  if (range === "custom" && isIsoDate(input.from) && isIsoDate(input.to)) {
    const from = input.from <= input.to ? input.from : input.to;
    const to = input.from <= input.to ? input.to : input.from;
    return { preset: "custom", from, to };
  }
  if (range === "month" || options.defaultPreset === "month") {
    return { preset: "month", from: startOfMonth(today), to: endOfMonth(today) };
  }
  if (options.defaultPreset === "today") return { preset: "today", from: today, to: today };
  if (options.defaultPreset === "week") return { preset: "week", from: startOfWeek(today), to: endOfWeek(today) };
  return { preset: "all", from: null, to: null };
}

export function rangeLabel(range: ResolvedRange, today = todayISO()): string {
  if (range.preset === "all" || !range.from || !range.to) return "All dates";
  if (range.from === range.to) return formatDateWithYear(range.from);
  const from = formatDate(range.from, today);
  const to = formatDateWithYear(range.to);
  return `${from} – ${to}`;
}
