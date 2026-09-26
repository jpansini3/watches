import { NextRequest, NextResponse } from "next/server";
import { jsonError, parseId } from "@/lib/api";
import { dbReady } from "@/lib/db";
import { deletePricePoint, getWatch } from "@/lib/queries";

export const dynamic = "force-dynamic";

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
