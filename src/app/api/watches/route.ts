import { NextRequest, NextResponse } from "next/server";
import { jsonError, optionalHttpUrl, optionalImageUrl, optionalString, stringList } from "@/lib/api";
import { dbReady } from "@/lib/db";
import { parseIsoDate, parseMoneyToCents, todayIso } from "@/lib/money";
import { createWatch, listWatches } from "@/lib/queries";

export const dynamic = "force-dynamic";

export async function GET() {
  await dbReady;
  return NextResponse.json(await listWatches());
}

export async function POST(request: NextRequest) {
  await dbReady;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return jsonError("Invalid JSON", 400);
  const manufacturer = optionalString(body.manufacturer);
  const model = optionalString(body.model);
  if (!manufacturer?.trim()) return jsonError("Manufacturer is required", 400);
  if (!model?.trim()) return jsonError("Model is required", 400);
  try {
    const watch = await createWatch({
      manufacturer,
      model,
      imageUrl: optionalImageUrl(body.imageUrl) ?? null,
      chrono24Url: optionalHttpUrl(body.chrono24Url) ?? null,
      retailPriceCents: parseMoneyToCents(body.retailPrice),
      chrono24PriceCents: parseMoneyToCents(body.chrono24Price),
      complications: stringList(body.complications),
      recordedOn: parseIsoDate(body.recordedOn, todayIso()),
    });
    return NextResponse.json(watch, { status: 201 });
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : "Could not create watch", 400);
  }
}
