export type PriceSource = "retail" | "chrono24";

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

export function latestPriceCents(prices: PriceRow[], source: PriceSource): number | null {
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
  return latest?.amountCents ?? null;
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
