import { NextRequest, NextResponse } from "next/server";
import { jsonError, optionalString, parseId } from "@/lib/api";
import { dbReady } from "@/lib/db";
import { addComplication } from "@/lib/queries";

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
  const name = optionalString(body.name);
  try {
    const watch = await addComplication(id, name ?? "");
    if (!watch) return jsonError("Not found", 404);
    return NextResponse.json(watch, { status: 201 });
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : "Could not add complication", 400);
  }
}
