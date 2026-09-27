import { NextRequest, NextResponse } from "next/server";
import { jsonError, parseId } from "@/lib/api";
import { dbReady } from "@/lib/db";
import { isPriceSource, parseIsoDate, parseMoneyToCents, todayIso } from "@/lib/money";
import { addPricePoint } from "@/lib/queries";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  await dbReady;
  const { id: raw } = await params;
  const id = parseId(raw);
  if (!id) return jsonError("Not found", 404);
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return jsonError("Invalid JSON", 400);
  if (!isPriceSource(body.source)) return jsonError("Price source is required", 400);
  try {
    const amountCents = parseMoneyToCents(body.amount);
    if (amountCents == null) return jsonError("Price is required", 400);
    const watch = await addPricePoint(id, body.source, amountCents, parseIsoDate(body.recordedOn, todayIso()));
    if (!watch) return jsonError("Not found", 404);
    return NextResponse.json(watch, { status: 201 });
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : "Could not record price", 400);
  }
}
