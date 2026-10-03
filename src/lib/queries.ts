import { asc, eq, inArray, sql } from "drizzle-orm";
import {
  complications,
  manufacturers,
  pricePoints,
  watches,
  type PriceSource,
} from "@drizzle/schema";
import { db } from "@/lib/db";
import { withDbTransaction, type DbTx } from "@/lib/db-transaction";
import { latestPriceAction, latestPriceCents, todayIso, type PriceRow } from "@/lib/money";
import { deleteUpload } from "@/lib/object-store";

export type ComplicationItem = { id: number; name: string };

export type WatchSummary = {
  id: number;
  manufacturer: string;
  model: string;
  referenceNumber: string | null;
  imageUrl: string | null;
  pageUrl: string | null;
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
  referenceNumber?: string | null;
  imageUrl?: string | null;
  pageUrl?: string | null;
  chrono24Url?: string | null;
  retailPriceCents?: number | null;
  chrono24PriceCents?: number | null;
  complications?: string[];
  recordedOn?: string;
};

export type WatchPatch = {
  manufacturer?: string;
  model?: string;
  referenceNumber?: string | null;
  imageUrl?: string | null;
  pageUrl?: string | null;
  chrono24Url?: string | null;
  retailPriceCents?: number | null;
  chrono24PriceCents?: number | null;
};

export type PricePatch = {
  source?: PriceSource;
  amountCents?: number;
  recordedOn?: string;
};

function blankToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

function summaryFrom(
  row: {
    id: number;
    manufacturer: string;
    model: string;
    referenceNumber: string | null;
    imageUrl: string | null;
    pageUrl: string | null;
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
      referenceNumber: watches.referenceNumber,
      imageUrl: watches.imageUrl,
      pageUrl: watches.pageUrl,
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
      referenceNumber: watches.referenceNumber,
      imageUrl: watches.imageUrl,
      pageUrl: watches.pageUrl,
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

function isUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code = (err as { code?: string }).code ?? (err as { cause?: { code?: string } }).cause?.code;
  return code === "23505";
}

async function findManufacturerId(tx: DbTx, name: string): Promise<number | null> {
  const [existing] = await tx
    .select({ id: manufacturers.id })
    .from(manufacturers)
    .where(sql`lower(${manufacturers.name}) = ${name.toLowerCase()}`)
    .orderBy(asc(manufacturers.id))
    .limit(1);
  return existing?.id ?? null;
}

async function findOrCreateManufacturer(tx: DbTx, name: string): Promise<number> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Manufacturer is required");
  const existing = await findManufacturerId(tx, trimmed);
  if (existing) return existing;
  try {
    return await tx.transaction(async (inner) => {
      const [created] = await inner
        .insert(manufacturers)
        .values({ name: trimmed })
        .returning({ id: manufacturers.id });
      return created.id;
    });
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    const raced = await findManufacturerId(tx, trimmed);
    if (raced) return raced;
    throw err;
  }
}

async function deleteManufacturerIfUnused(tx: DbTx, id: number) {
  const [used] = await tx
    .select({ id: watches.id })
    .from(watches)
    .where(eq(watches.manufacturerId, id))
    .limit(1);
  if (!used) {
    await tx.delete(manufacturers).where(eq(manufacturers.id, id));
  }
}

async function insertPrice(
  tx: DbTx,
  watchId: number,
  source: PriceSource,
  amountCents: number,
  recordedOn: string,
) {
  await tx.insert(pricePoints).values({ watchId, source, amountCents, recordedOn });
}

async function insertComplications(tx: DbTx, watchId: number, names: string[]) {
  const seen = new Set<string>();
  let rank = 0;
  for (const raw of names) {
    const name = raw.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    await tx.insert(complications).values({ watchId, name, rank });
    rank += 1;
  }
}

export async function createWatch(input: WatchInput): Promise<WatchDetail> {
  const model = input.model.trim();
  if (!model) throw new Error("Model is required");
  const recordedOn = input.recordedOn ?? todayIso();
  const id = await withDbTransaction(async (tx) => {
    const manufacturerId = await findOrCreateManufacturer(tx, input.manufacturer);
    const [created] = await tx
      .insert(watches)
      .values({
        manufacturerId,
        model,
        referenceNumber: blankToNull(input.referenceNumber),
        imageUrl: input.imageUrl ?? null,
        pageUrl: input.pageUrl ?? null,
        chrono24Url: input.chrono24Url ?? null,
      })
      .returning({ id: watches.id });
    if (input.retailPriceCents != null) {
      await insertPrice(tx, created.id, "retail", input.retailPriceCents, recordedOn);
    }
    if (input.chrono24PriceCents != null) {
      await insertPrice(tx, created.id, "chrono24", input.chrono24PriceCents, recordedOn);
    }
    if (input.complications?.length) {
      await insertComplications(tx, created.id, input.complications);
    }
    return created.id;
  });
  const watch = await getWatch(id);
  if (!watch) throw new Error("Could not create watch");
  return watch;
}

export async function updateWatch(id: number, patch: WatchPatch): Promise<WatchDetail | null> {
  const current = await db
    .select({ manufacturerId: watches.manufacturerId, imageUrl: watches.imageUrl })
    .from(watches)
    .where(eq(watches.id, id));
  if (!current[0]) return null;
  const previousManufacturerId = current[0].manufacturerId;
  const previousImage = current[0].imageUrl;
  await withDbTransaction(async (tx) => {
    const values: {
      manufacturerId?: number;
      model?: string;
      referenceNumber?: string | null;
      imageUrl?: string | null;
      pageUrl?: string | null;
      chrono24Url?: string | null;
    } = {};
    if (patch.manufacturer !== undefined) {
      values.manufacturerId = await findOrCreateManufacturer(tx, patch.manufacturer);
    }
    if (patch.model !== undefined) {
      const model = patch.model.trim();
      if (!model) throw new Error("Model is required");
      values.model = model;
    }
    if (patch.referenceNumber !== undefined) values.referenceNumber = blankToNull(patch.referenceNumber);
    if (patch.imageUrl !== undefined) values.imageUrl = patch.imageUrl;
    if (patch.pageUrl !== undefined) values.pageUrl = patch.pageUrl;
    if (patch.chrono24Url !== undefined) values.chrono24Url = patch.chrono24Url;
    if (Object.keys(values).length > 0) {
      await tx.update(watches).set(values).where(eq(watches.id, id));
    }
    if (patch.retailPriceCents !== undefined) {
      await applyLatestPrice(tx, id, "retail", patch.retailPriceCents);
    }
    if (patch.chrono24PriceCents !== undefined) {
      await applyLatestPrice(tx, id, "chrono24", patch.chrono24PriceCents);
    }
    if (values.manufacturerId && values.manufacturerId !== previousManufacturerId) {
      await deleteManufacturerIfUnused(tx, previousManufacturerId);
    }
  });
  if (patch.imageUrl !== undefined && patch.imageUrl !== previousImage) {
    await releaseUpload(previousImage);
  }
  return getWatch(id);
}

async function applyLatestPrice(tx: DbTx, watchId: number, source: PriceSource, amountCents: number | null) {
  const rows = await tx
    .select({
      id: pricePoints.id,
      source: pricePoints.source,
      amountCents: pricePoints.amountCents,
      recordedOn: pricePoints.recordedOn,
    })
    .from(pricePoints)
    .where(eq(pricePoints.watchId, watchId));
  const action = latestPriceAction(rows, source, amountCents, todayIso());
  if (action.type === "insert") {
    await insertPrice(tx, watchId, source, action.amountCents, action.recordedOn);
  } else if (action.type === "update") {
    await tx.update(pricePoints).set({ amountCents: action.amountCents }).where(eq(pricePoints.id, action.id));
  } else if (action.type === "delete") {
    await tx.delete(pricePoints).where(eq(pricePoints.id, action.id));
  }
}

export async function deleteWatch(id: number): Promise<boolean> {
  const [row] = await db
    .select({ manufacturerId: watches.manufacturerId, imageUrl: watches.imageUrl })
    .from(watches)
    .where(eq(watches.id, id));
  if (!row) return false;
  await withDbTransaction(async (tx) => {
    await tx.delete(watches).where(eq(watches.id, id));
    await deleteManufacturerIfUnused(tx, row.manufacturerId);
  });
  await releaseUpload(row.imageUrl);
  return true;
}

function uploadFilename(imageUrl: string | null): string | null {
  if (!imageUrl?.startsWith("/api/uploads/")) return null;
  const filename = imageUrl.slice("/api/uploads/".length);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(filename) || filename.includes("..")) return null;
  return filename;
}

async function releaseUpload(imageUrl: string | null) {
  if (!imageUrl) return;
  const filename = uploadFilename(imageUrl);
  if (!filename) return;
  const [stillUsed] = await db
    .select({ id: watches.id })
    .from(watches)
    .where(eq(watches.imageUrl, imageUrl))
    .limit(1);
  if (stillUsed) return;
  try {
    await deleteUpload(filename);
  } catch (err) {
    console.error("[uploads] delete failed:", err);
  }
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

export async function updatePricePoint(id: number, patch: PricePatch): Promise<WatchDetail | null> {
  const [row] = await db.select({ watchId: pricePoints.watchId }).from(pricePoints).where(eq(pricePoints.id, id));
  if (!row) return null;
  const values: { source?: PriceSource; amountCents?: number; recordedOn?: string } = {};
  if (patch.source !== undefined) values.source = patch.source;
  if (patch.amountCents !== undefined) values.amountCents = patch.amountCents;
  if (patch.recordedOn !== undefined) values.recordedOn = patch.recordedOn;
  if (Object.keys(values).length > 0) {
    await db.update(pricePoints).set(values).where(eq(pricePoints.id, id));
  }
  return getWatch(row.watchId);
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

export async function updateComplication(id: number, name: string): Promise<WatchDetail | null> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Complication name is required");
  const [row] = await db
    .select({ watchId: complications.watchId })
    .from(complications)
    .where(eq(complications.id, id));
  if (!row) return null;
  const existing = await db
    .select({ id: complications.id, name: complications.name })
    .from(complications)
    .where(eq(complications.watchId, row.watchId));
  if (existing.some((item) => item.id !== id && item.name.toLowerCase() === trimmed.toLowerCase())) {
    throw new Error("That complication is already listed");
  }
  await db.update(complications).set({ name: trimmed }).where(eq(complications.id, id));
  return getWatch(row.watchId);
}

export async function deleteComplication(id: number): Promise<number | null> {
  const [row] = await db
    .delete(complications)
    .where(eq(complications.id, id))
    .returning({ watchId: complications.watchId });
  return row?.watchId ?? null;
}
