import { NextRequest, NextResponse } from "next/server";
import { jsonError } from "@/lib/api";
import { lookupProductPage } from "@/lib/watch-page";
import { lookupWatch, WatchLookupError } from "@/lib/watch-lookup";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const pageUrl = request.nextUrl.searchParams.get("url") ?? "";
  const manufacturer = request.nextUrl.searchParams.get("manufacturer") ?? "";
  const model = request.nextUrl.searchParams.get("model") ?? "";
  try {
    const result = pageUrl.trim()
      ? await lookupProductPage(pageUrl)
      : await lookupWatch(manufacturer, model);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof WatchLookupError) return jsonError(err.message, err.status);
    return jsonError("Could not look up that watch", 502);
  }
}
