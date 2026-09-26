import { NextRequest, NextResponse } from "next/server";
import { finishAccessLog } from "@/lib/http-log";
import { mutationSecret, secretsMatch } from "@/lib/mutation-secret";

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const COOKIE_NAME = "watches_mutation_secret";
const HEADER_NAME = "x-api-mutation-secret";

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

function unavailable() {
  return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
}

export function middleware(request: NextRequest) {
  const start = Date.now();
  const secret = mutationSecret();
  const { pathname } = request.nextUrl;

  if (!pathname.startsWith("/api")) {
    const response = NextResponse.next();
    if (secret) {
      response.cookies.set(COOKIE_NAME, secret, {
        httpOnly: true,
        sameSite: "strict",
        secure: process.env.NODE_ENV === "production",
        path: "/",
      });
    } else if (request.cookies.has(COOKIE_NAME)) {
      response.cookies.delete(COOKIE_NAME);
    }
    return finishAccessLog(request, response, start);
  }

  if (!MUTATING.has(request.method)) {
    return finishAccessLog(request, NextResponse.next(), start);
  }

  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      return finishAccessLog(request, unavailable(), start);
    }
    return finishAccessLog(request, NextResponse.next(), start);
  }

  const header = request.headers.get(HEADER_NAME) ?? undefined;
  const cookie = request.cookies.get(COOKIE_NAME)?.value;
  if (secretsMatch(header, secret) || secretsMatch(cookie, secret)) {
    return finishAccessLog(request, NextResponse.next(), start);
  }

  return finishAccessLog(request, unauthorized(), start);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|favicon.svg|favicon.png|manifest.webmanifest|sw.js|icons/|apple-touch-icon.png).*)",
  ],
};
