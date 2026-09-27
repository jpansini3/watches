import { NextRequest, NextResponse } from "next/server";
import { jsonError, parseId } from "@/lib/api";
import { dbReady } from "@/lib/db";
import { isPriceSource, parseIsoDate, parseMoneyToCents } from "@/lib/money";
import { deletePricePoint, getWatch, updatePricePoint } from "@/lib/queries";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  await dbReady;
  const { id: raw } = await params;
  const id = parseId(raw);
  if (!id) return jsonError("Not found", 404);
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return jsonError("Invalid JSON", 400);
  try {
    const patch: { source?: "retail" | "chrono24"; amountCents?: number; recordedOn?: string } = {};
    if (body.source !== undefined) {
      if (!isPriceSource(body.source)) return jsonError("Price source is required", 400);
      patch.source = body.source;
    }
    if (body.amount !== undefined) {
      const amountCents = parseMoneyToCents(body.amount);
      if (amountCents == null) return jsonError("Price is required", 400);
      patch.amountCents = amountCents;
    }
    if (body.recordedOn !== undefined) patch.recordedOn = parseIsoDate(body.recordedOn);
    if (Object.keys(patch).length === 0) return jsonError("Nothing to update", 400);
    const watch = await updatePricePoint(id, patch);
    if (!watch) return jsonError("Not found", 404);
    return NextResponse.json(watch);
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : "Could not update price", 400);
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  await dbReady;
  const { id: raw } = await params;
  const id = parseId(raw);
  if (!id) return jsonError("Not found", 404);
  const watchId = await deletePricePoint(id);
  if (!watchId) return jsonError("Not found", 404);
  const watch = await getWatch(watchId);
  if (!watch) return jsonError("Not found", 404);
  return NextResponse.json(watch);
}
