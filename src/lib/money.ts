export type PriceSource = "retail" | "chrono24";

export function isPriceSource(value: unknown): value is PriceSource {
  return value === "retail" || value === "chrono24";
}

export function parseMoneyToCents(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const raw = typeof value === "number" ? String(value) : typeof value === "string" ? value : "";
  if (!raw) throw new Error("Enter a price like 12500 or 12500.00");
  const cleaned = raw.trim().replace(/[$,\s]/g, "");
  if (!cleaned) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) {
    throw new Error("Enter a price like 12500 or 12500.00");
  }
  const cents = Math.round(Number(cleaned) * 100);
  if (!Number.isFinite(cents) || cents < 0) {
    throw new Error("Enter a price like 12500 or 12500.00");
  }
  return cents;
}

export function formatMoney(cents: number | null | undefined): string {
  if (cents == null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

/** Dollar text for an editable price field. Whole dollars omit the decimal. */
export function centsToDollarsInput(cents: number | null | undefined): string {
  if (cents == null) return "";
  const dollars = cents / 100;
  return Number.isInteger(dollars) ? String(dollars) : dollars.toFixed(2);
}

export function todayIso(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function parseIsoDate(value: unknown, fallback?: string): string {
  if (value === undefined || value === null || value === "") {
    if (fallback) return fallback;
    throw new Error("Date is required");
  }
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("Date must be YYYY-MM-DD");
  }
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new Error("Date must be YYYY-MM-DD");
  }
  return value;
}

export type PriceRow = {
  id: number;
  source: PriceSource;
  amountCents: number;
  recordedOn: string;
};

export function latestPriceRow(prices: PriceRow[], source: PriceSource): PriceRow | null {
  let latest: PriceRow | null = null;
  for (const price of prices) {
    if (price.source !== source) continue;
    if (
      !latest ||
      price.recordedOn > latest.recordedOn ||
      (price.recordedOn === latest.recordedOn && price.id > latest.id)
    ) {
      latest = price;
    }
  }
  return latest;
}

export function latestPriceCents(prices: PriceRow[], source: PriceSource): number | null {
  return latestPriceRow(prices, source)?.amountCents ?? null;
}

export type LatestPriceAction =
  | { type: "keep" }
  | { type: "insert"; amountCents: number; recordedOn: string }
  | { type: "update"; id: number; amountCents: number }
  | { type: "delete"; id: number };

/**
 * How a change to the current price should land in history.
 * A same-day correction updates that quote. A later change adds a new day.
 * Clearing the field removes only the latest quote.
 */
export function latestPriceAction(
  prices: PriceRow[],
  source: PriceSource,
  nextCents: number | null,
  today: string,
): LatestPriceAction {
  const latest = latestPriceRow(prices, source);
  if (nextCents == null) {
    return latest ? { type: "delete", id: latest.id } : { type: "keep" };
  }
  if (!latest) return { type: "insert", amountCents: nextCents, recordedOn: today };
  if (latest.amountCents === nextCents) return { type: "keep" };
  if (latest.recordedOn === today) return { type: "update", id: latest.id, amountCents: nextCents };
  return { type: "insert", amountCents: nextCents, recordedOn: today };
}

export type ChartPoint = { date: string; cents: number };

/** One point per day: the latest quote recorded that day. */
export function chartSeries(prices: PriceRow[], source: PriceSource): ChartPoint[] {
  const byDay = new Map<string, { cents: number; id: number }>();
  for (const price of prices) {
    if (price.source !== source) continue;
    const prev = byDay.get(price.recordedOn);
    if (!prev || price.id > prev.id) {
      byDay.set(price.recordedOn, { cents: price.amountCents, id: price.id });
    }
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, value]) => ({ date, cents: value.cents }));
}
