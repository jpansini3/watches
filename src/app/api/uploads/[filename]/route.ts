import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { jsonError } from "@/lib/api";
import { getUpload } from "@/lib/object-store";

export const dynamic = "force-dynamic";

const CONTENT_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ filename: string }> },
) {
  const { filename } = await params;
  if (!/^[a-zA-Z0-9._-]+$/.test(filename)) {
    return jsonError("Invalid filename", 400);
  }
  const ext = path.extname(filename).toLowerCase();
  const contentType = CONTENT_TYPES[ext];
  if (!contentType) {
    return jsonError("Unsupported file", 400);
  }
  const stored = await getUpload(filename, contentType);
  if (!stored) {
    return jsonError("Not found", 404);
  }
  return new NextResponse(new Uint8Array(stored.body), {
    headers: {
      "Content-Type": stored.contentType,
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
