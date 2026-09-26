import type { NextRequest, NextResponse } from "next/server";

export type HttpAccessLog = {
  method: string;
  path: string;
  status: number;
  durationMs: number;
};

const SKIP_PATHS = new Set(["/api/health", "/favicon.ico", "/favicon.svg", "/favicon.png"]);

export function shouldSkipAccessLog(pathname: string): boolean {
  if (SKIP_PATHS.has(pathname)) return true;
  return pathname.startsWith("/_next/");
}

export function logHttpAccess(entry: HttpAccessLog): void {
  console.log(
    JSON.stringify({
      level: "info",
      msg: "http_access",
      method: entry.method,
      path: entry.path,
      status: entry.status,
      durationMs: entry.durationMs,
    }),
  );
}

export function finishAccessLog(
  request: NextRequest,
  response: NextResponse,
  start: number,
): NextResponse {
  const path = request.nextUrl.pathname;
  if (!shouldSkipAccessLog(path)) {
    logHttpAccess({
      method: request.method,
      path,
      status: response.status,
      durationMs: Date.now() - start,
    });
  }
  return response;
}
