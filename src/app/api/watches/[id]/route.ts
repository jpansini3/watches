import { NextRequest, NextResponse } from "next/server";
import { jsonError, optionalHttpUrl, optionalImageUrl, optionalString, parseId } from "@/lib/api";
import { dbReady } from "@/lib/db";
import { parseMoneyToCents } from "@/lib/money";
import { deleteWatch, getWatch, updateWatch } from "@/lib/queries";

export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  await dbReady;
  const { id: raw } = await params;
  const id = parseId(raw);
  if (!id) return jsonError("Not found", 404);
  const watch = await getWatch(id);
  if (!watch) return jsonError("Not found", 404);
  return NextResponse.json(watch);
}

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
    const manufacturer = optionalString(body.manufacturer);
    const model = optionalString(body.model);
    const referenceNumber = optionalString(body.referenceNumber);
    const watch = await updateWatch(id, {
      manufacturer: manufacturer === undefined ? undefined : (manufacturer ?? ""),
      model: model === undefined ? undefined : (model ?? ""),
      referenceNumber: referenceNumber === undefined ? undefined : referenceNumber,
      imageUrl: optionalImageUrl(body.imageUrl),
      chrono24Url: optionalHttpUrl(body.chrono24Url),
      retailPriceCents: optionalMoney(body, "retailPrice"),
      chrono24PriceCents: optionalMoney(body, "chrono24Price"),
    });
    if (!watch) return jsonError("Not found", 404);
    return NextResponse.json(watch);
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : "Could not update watch", 400);
  }
}

function optionalMoney(body: Record<string, unknown>, key: string): number | null | undefined {
  if (!Object.prototype.hasOwnProperty.call(body, key)) return undefined;
  return parseMoneyToCents(body[key]);
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  await dbReady;
  const { id: raw } = await params;
  const id = parseId(raw);
  if (!id) return jsonError("Not found", 404);
  const deleted = await deleteWatch(id);
  if (!deleted) return jsonError("Not found", 404);
  return new NextResponse(null, { status: 204 });
}
