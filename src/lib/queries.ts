import { asc, eq, inArray, sql } from "drizzle-orm";
import {
  complications,
  manufacturers,
  pricePoints,
  watches,
  type PriceSource,
} from "@drizzle/schema";
import { db } from "@/lib/db";
import { withDbTransaction } from "@/lib/db-transaction";
import { latestPriceCents, todayIso, type PriceRow } from "@/lib/money";

export type ComplicationItem = { id: number; name: string };

export type WatchSummary = {
  id: number;
  manufacturer: string;
  model: string;
  imageUrl: string | null;
  chrono24Url: string | null;
  retailPriceCents: number | null;
  chrono24PriceCents: number | null;
};

export type WatchDetail = WatchSummary & {
  complications: ComplicationItem[];
  prices: PriceRow[];
};

export type WatchInput = {
  manufacturer: string;
  model: string;
  imageUrl?: string | null;
  chrono24Url?: string | null;
  retailPriceCents?: number | null;
  chrono24PriceCents?: number | null;
  complications?: string[];
  recordedOn?: string;
};

export type WatchPatch = {
  manufacturer?: string;
  model?: string;
  imageUrl?: string | null;
  chrono24Url?: string | null;
};

function summaryFrom(
  row: {
    id: number;
    manufacturer: string;
    model: string;
    imageUrl: string | null;
    chrono24Url: string | null;
  },
  prices: PriceRow[],
): WatchSummary {
  return {
    ...row,
    retailPriceCents: latestPriceCents(prices, "retail"),
    chrono24PriceCents: latestPriceCents(prices, "chrono24"),
  };
}

async function pricesFor(watchIds: number[]): Promise<Map<number, PriceRow[]>> {
  const grouped = new Map<number, PriceRow[]>();
  if (watchIds.length === 0) return grouped;
  const rows = await db
    .select({
      id: pricePoints.id,
      watchId: pricePoints.watchId,
      source: pricePoints.source,
      amountCents: pricePoints.amountCents,
      recordedOn: pricePoints.recordedOn,
    })
    .from(pricePoints)
    .where(inArray(pricePoints.watchId, watchIds));
  for (const row of rows) {
    const list = grouped.get(row.watchId) ?? [];
    list.push({
      id: row.id,
      source: row.source,
      amountCents: row.amountCents,
      recordedOn: row.recordedOn,
    });
    grouped.set(row.watchId, list);
  }
  return grouped;
}

export async function listWatches(): Promise<WatchSummary[]> {
  const rows = await db
    .select({
      id: watches.id,
      manufacturer: manufacturers.name,
      model: watches.model,
      imageUrl: watches.imageUrl,
      chrono24Url: watches.chrono24Url,
    })
    .from(watches)
    .innerJoin(manufacturers, eq(watches.manufacturerId, manufacturers.id))
    .orderBy(asc(manufacturers.name), asc(watches.model), asc(watches.id));
  const prices = await pricesFor(rows.map((row) => row.id));
  return rows.map((row) => summaryFrom(row, prices.get(row.id) ?? []));
}

export async function getWatch(id: number): Promise<WatchDetail | null> {
  const [row] = await db
    .select({
      id: watches.id,
      manufacturerId: watches.manufacturerId,
      manufacturer: manufacturers.name,
      model: watches.model,
      imageUrl: watches.imageUrl,
      chrono24Url: watches.chrono24Url,
    })
    .from(watches)
    .innerJoin(manufacturers, eq(watches.manufacturerId, manufacturers.id))
    .where(eq(watches.id, id));
  if (!row) return null;
  const complicationRows = await db
    .select({ id: complications.id, name: complications.name })
    .from(complications)
    .where(eq(complications.watchId, id))
    .orderBy(asc(complications.rank), asc(complications.id));
  const prices = (await pricesFor([id])).get(id) ?? [];
  prices.sort((a, b) => a.recordedOn.localeCompare(b.recordedOn) || a.id - b.id);
  return {
    ...summaryFrom(row, prices),
    complications: complicationRows,
    prices,
  };
}

async function findOrCreateManufacturer(name: string): Promise<number> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Manufacturer is required");
  const [existing] = await db
    .select({ id: manufacturers.id })
    .from(manufacturers)
    .where(sql`lower(${manufacturers.name}) = ${trimmed.toLowerCase()}`);
  if (existing) return existing.id;
  const [created] = await db.insert(manufacturers).values({ name: trimmed }).returning({ id: manufacturers.id });
  return created.id;
}

async function deleteManufacturerIfUnused(id: number) {
  const [used] = await db
    .select({ id: watches.id })
    .from(watches)
    .where(eq(watches.manufacturerId, id))
    .limit(1);
  if (!used) {
    await db.delete(manufacturers).where(eq(manufacturers.id, id));
  }
}

async function insertPrice(watchId: number, source: PriceSource, amountCents: number, recordedOn: string) {
  await db.insert(pricePoints).values({ watchId, source, amountCents, recordedOn });
}

async function insertComplications(watchId: number, names: string[]) {
  const seen = new Set<string>();
  let rank = 0;
  for (const raw of names) {
    const name = raw.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    await db.insert(complications).values({ watchId, name, rank });
    rank += 1;
  }
}

export async function createWatch(input: WatchInput): Promise<WatchDetail> {
  const model = input.model.trim();
  if (!model) throw new Error("Model is required");
  const recordedOn = input.recordedOn ?? todayIso();
  const id = await withDbTransaction(async () => {
    const manufacturerId = await findOrCreateManufacturer(input.manufacturer);
    const [created] = await db
      .insert(watches)
      .values({
        manufacturerId,
        model,
        imageUrl: input.imageUrl ?? null,
        chrono24Url: input.chrono24Url ?? null,
      })
      .returning({ id: watches.id });
    if (input.retailPriceCents != null) {
      await insertPrice(created.id, "retail", input.retailPriceCents, recordedOn);
    }
    if (input.chrono24PriceCents != null) {
      await insertPrice(created.id, "chrono24", input.chrono24PriceCents, recordedOn);
    }
    if (input.complications?.length) {
      await insertComplications(created.id, input.complications);
    }
    return created.id;
  });
  const watch = await getWatch(id);
  if (!watch) throw new Error("Could not create watch");
  return watch;
}

export async function updateWatch(id: number, patch: WatchPatch): Promise<WatchDetail | null> {
  const current = await db
    .select({ manufacturerId: watches.manufacturerId })
    .from(watches)
    .where(eq(watches.id, id));
  if (!current[0]) return null;
  const previousManufacturerId = current[0].manufacturerId;
  await withDbTransaction(async () => {
    const values: {
      manufacturerId?: number;
      model?: string;
      imageUrl?: string | null;
      chrono24Url?: string | null;
    } = {};
    if (patch.manufacturer !== undefined) {
      values.manufacturerId = await findOrCreateManufacturer(patch.manufacturer);
    }
    if (patch.model !== undefined) {
      const model = patch.model.trim();
      if (!model) throw new Error("Model is required");
      values.model = model;
    }
    if (patch.imageUrl !== undefined) values.imageUrl = patch.imageUrl;
    if (patch.chrono24Url !== undefined) values.chrono24Url = patch.chrono24Url;
    if (Object.keys(values).length > 0) {
      await db.update(watches).set(values).where(eq(watches.id, id));
    }
    if (values.manufacturerId && values.manufacturerId !== previousManufacturerId) {
      await deleteManufacturerIfUnused(previousManufacturerId);
    }
  });
  return getWatch(id);
}

export async function deleteWatch(id: number): Promise<boolean> {
  const [row] = await db
    .select({ manufacturerId: watches.manufacturerId })
    .from(watches)
    .where(eq(watches.id, id));
  if (!row) return false;
  await withDbTransaction(async () => {
    await db.delete(watches).where(eq(watches.id, id));
    await deleteManufacturerIfUnused(row.manufacturerId);
  });
  return true;
}

export async function addPricePoint(
  watchId: number,
  source: PriceSource,
  amountCents: number,
  recordedOn: string,
): Promise<WatchDetail | null> {
  const [watch] = await db.select({ id: watches.id }).from(watches).where(eq(watches.id, watchId));
  if (!watch) return null;
  await db.insert(pricePoints).values({ watchId, source, amountCents, recordedOn });
  return getWatch(watchId);
}

export async function deletePricePoint(id: number): Promise<number | null> {
  const [row] = await db
    .delete(pricePoints)
    .where(eq(pricePoints.id, id))
    .returning({ watchId: pricePoints.watchId });
  return row?.watchId ?? null;
}

export async function addComplication(watchId: number, name: string): Promise<WatchDetail | null> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Complication name is required");
  const [watch] = await db.select({ id: watches.id }).from(watches).where(eq(watches.id, watchId));
  if (!watch) return null;
  const existing = await db
    .select({ id: complications.id, name: complications.name, rank: complications.rank })
    .from(complications)
    .where(eq(complications.watchId, watchId));
  if (existing.some((row) => row.name.toLowerCase() === trimmed.toLowerCase())) {
    throw new Error("That complication is already listed");
  }
  const rank = existing.reduce((max, row) => Math.max(max, row.rank), -1) + 1;
  await db.insert(complications).values({ watchId, name: trimmed, rank });
  return getWatch(watchId);
}

export async function deleteComplication(id: number): Promise<number | null> {
  const [row] = await db
    .delete(complications)
    .where(eq(complications.id, id))
    .returning({ watchId: complications.watchId });
  return row?.watchId ?? null;
}
