import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { jsonError } from "@/lib/api";
import { formatUploadError, putUpload } from "@/lib/object-store";

export const dynamic = "force-dynamic";

const ALLOWED_TYPES: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/gif": ".gif",
  "image/webp": ".webp",
};

const MAX_BYTES = 8 * 1024 * 1024;

export async function POST(request: NextRequest) {
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return jsonError("file is required", 400);
    }
    if (file.size > MAX_BYTES) {
      return jsonError("File is too large (max 8MB)", 400);
    }
    const ext = ALLOWED_TYPES[file.type];
    if (!ext) {
      return jsonError("Unsupported image type", 400);
    }

    const filename = `${crypto.randomUUID()}${ext}`;
    const buffer = Buffer.from(await file.arrayBuffer());
    await putUpload(filename, buffer, file.type);

    return NextResponse.json({ url: `/api/uploads/${filename}` });
  } catch (err) {
    console.error("[uploads] POST failed:", err);
    return jsonError(formatUploadError(err), 502);
  }
}
