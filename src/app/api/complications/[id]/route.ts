import { NextRequest, NextResponse } from "next/server";
import { jsonError, optionalString, parseId } from "@/lib/api";
import { dbReady } from "@/lib/db";
import { deleteComplication, getWatch, updateComplication } from "@/lib/queries";

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
  const name = optionalString(body.name);
  try {
    const watch = await updateComplication(id, name ?? "");
    if (!watch) return jsonError("Not found", 404);
    return NextResponse.json(watch);
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : "Could not update complication", 400);
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
  const watchId = await deleteComplication(id);
  if (!watchId) return jsonError("Not found", 404);
  const watch = await getWatch(watchId);
  if (!watch) return jsonError("Not found", 404);
  return NextResponse.json(watch);
}
