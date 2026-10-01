import { NextResponse } from "next/server";

export function parseId(id: string): number | null {
  const parsed = parseInt(id, 10);
  if (!Number.isInteger(parsed) || parsed <= 0 || String(parsed) !== id) return null;
  return parsed;
}

export function optionalString(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  return value;
}

export function optionalImageUrl(value: unknown): string | null | undefined {
  const raw = optionalString(value);
  if (raw === undefined) return undefined;
  if (raw === null || raw.trim() === "") return null;
  const trimmed = raw.trim();
  if (trimmed.startsWith("/api/uploads/")) {
    if (!/^\/api\/uploads\/[a-zA-Z0-9._-]+$/.test(trimmed)) {
      throw new Error("Image must be an uploaded photo or an http(s) URL");
    }
    return trimmed;
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error("Image must be an uploaded photo or an http(s) URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Image must be an uploaded photo or an http(s) URL");
  }
  return url.toString();
}

export function optionalHttpUrl(value: unknown, label = "Link"): string | null | undefined {
  const raw = optionalString(value);
  if (raw === undefined) return undefined;
  if (raw === null || raw.trim() === "") return null;
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error(`${label} must be an http or https URL`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${label} must be an http or https URL`);
  }
  return url.toString();
}

export function stringList(value: unknown): string[] {
  if (value == null) return [];
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }
  if (typeof value === "string") {
    return value.split(/[\n,]/);
  }
  return [];
}

export function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}
