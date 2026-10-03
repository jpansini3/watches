import { lookup as dnsLookup } from "node:dns/promises";
import https from "node:https";
import { isIP, type LookupFunction } from "node:net";
import { WatchLookupError } from "./lookup-error.ts";

const PAGE_BYTES = 2_000_000;
const MAX_REDIRECTS = 5;

export type HostLookup = (hostname: string) => Promise<{ address: string }[]>;

const BROWSER_HEADERS = {
  Accept: "text/html,application/xhtml+xml,application/json,text/plain;q=0.9",
  "Accept-Language": "en-US,en;q=0.9",
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
};

export async function fetchHtml(
  pageUrl: string,
  fetchImpl: typeof fetch = fetch,
  lookupHost: HostLookup = dnsAddresses,
  timeoutMs = 15_000,
): Promise<{ html: string; finalUrl: string }> {
  let current = await checkPageUrl(pageUrl, lookupHost);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    let response: Response;
    try {
      response = await requestPage(current, fetchImpl, timeoutMs);
    } catch (err) {
      if (err instanceof WatchLookupError) throw err;
      throw new WatchLookupError("Could not reach that manufacturer page", 502);
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location) throw new WatchLookupError("The manufacturer page redirected without a destination", 502);
      if (hop === MAX_REDIRECTS) throw new WatchLookupError("The manufacturer page redirected too many times", 502);
      current = await checkPageUrl(new URL(location, current.url).toString(), lookupHost);
      continue;
    }
    if (response.status === 401 || response.status === 403 || response.status === 429) {
      await response.body?.cancel();
      throw new WatchLookupError("That site refused an automated request. Copy the details from the page.", 502);
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new WatchLookupError(`The manufacturer page returned ${response.status}`, 502);
    }
    const type = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (/^(image|audio|video|application\/pdf|application\/zip|application\/octet-stream)$/.test(type)) {
      await response.body?.cancel();
      throw new WatchLookupError("That URL is not a product page", 400);
    }
    return { html: await readLimited(response), finalUrl: current.url.toString() };
  }
  throw new WatchLookupError("The manufacturer page redirected too many times", 502);
}

async function requestPage(target: CheckedUrl, fetchImpl: typeof fetch, timeoutMs: number): Promise<Response> {
  const init = {
    redirect: "manual" as const,
    headers: BROWSER_HEADERS,
    signal: AbortSignal.timeout(timeoutMs),
  };
  if (fetchImpl !== fetch) return fetchImpl(target.url, init);
  return pinnedHttpsGet(target.url, target.addresses, init.signal);
}

type CheckedUrl = { url: URL; addresses: string[] };

async function checkPageUrl(value: string, lookupHost: HostLookup): Promise<CheckedUrl> {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new WatchLookupError("Enter an https product page URL", 400);
  }
  if (url.protocol !== "https:") throw new WatchLookupError("Enter an https product page URL", 400);
  if (url.username || url.password) throw new WatchLookupError("That URL can't be fetched", 400);
  const hostname = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!hostname || isBlockedHostname(hostname)) throw new WatchLookupError("That URL can't be fetched", 400);
  const addresses = isIP(hostname) ? [hostname] : await lookupAddresses(hostname, lookupHost);
  if (addresses.length === 0 || addresses.some(isBlockedAddress)) {
    throw new WatchLookupError("That URL can't be fetched", 400);
  }
  return { url, addresses };
}

async function lookupAddresses(hostname: string, lookupHost: HostLookup): Promise<string[]> {
  try {
    const records = await lookupHost(hostname);
    return records.map((record) => record.address);
  } catch (err) {
    if (err instanceof WatchLookupError) throw err;
    throw new WatchLookupError("Could not reach that manufacturer page", 502);
  }
}

async function dnsAddresses(hostname: string): Promise<{ address: string }[]> {
  return dnsLookup(hostname, { all: true, verbatim: true });
}

function isBlockedHostname(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    return true;
  }
  return host === "metadata.google.internal" || host === "metadata.google.com";
}

/** True for private, loopback, link-local, and IPv4-mapped forms of those addresses. */
export function isBlockedAddress(address: string): boolean {
  const ipv4 = embeddedIpv4(address);
  if (ipv4) return isPrivateIpv4(ipv4);
  if (address.includes(":")) return isPrivateIpv6(address);
  return isPrivateIpv4(address);
}

function embeddedIpv4(address: string): string | null {
  const ip = address.toLowerCase();
  const dotted = ip.match(/(?:^|:)ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (dotted && (ip.startsWith("::ffff:") || ip.startsWith("0:0:0:0:0:ffff:"))) return dotted[1];
  const hex = ip.match(/^(?:::ffff:|(?:0:){5}ffff:)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (!hex) return null;
  const hi = Number.parseInt(hex[1], 16);
  const lo = Number.parseInt(hex[2], 16);
  if (hi > 0xffff || lo > 0xffff) return null;
  return `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
}

function isPrivateIpv4(address: string): boolean {
  const parts = address.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127 || a === 255) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

function isPrivateIpv6(address: string): boolean {
  const ip = address.toLowerCase();
  if (ip === "::" || ip === "::1") return true;
  return ip.startsWith("fe80:") || ip.startsWith("fc") || ip.startsWith("fd");
}

/**
 * Connect to the addresses already checked, and keep the original hostname for SNI.
 * A later DNS answer cannot move this request onto a private address.
 */
function pinnedHttpsGet(url: URL, addresses: string[], signal: AbortSignal): Promise<Response> {
  const lookup = pinnedLookup(addresses);
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || 443,
        path: `${url.pathname}${url.search}`,
        servername: url.hostname,
        method: "GET",
        headers: { ...BROWSER_HEADERS, host: url.host },
        lookup,
        signal,
      },
      (res) => {
        resolve(responseFromIncoming(res));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

function pinnedLookup(addresses: string[]): LookupFunction {
  return (_hostname, options, callback) => {
    const familyOf = (address: string) => (address.includes(":") ? 6 : 4) as 4 | 6;
    if (typeof options === "object" && options.all) {
      callback(
        null,
        addresses.map((address) => ({ address, family: familyOf(address) })),
      );
      return;
    }
    const address = addresses[0] ?? "0.0.0.0";
    callback(null, address, familyOf(address));
  };
}

function responseFromIncoming(res: import("node:http").IncomingMessage): Response {
  let total = 0;
  let closed = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const finish = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          // The reader already cancelled.
        }
      };
      res.on("data", (chunk: Buffer) => {
        if (closed) return;
        const room = PAGE_BYTES - total;
        if (room <= 0) {
          finish();
          res.destroy();
          return;
        }
        const slice = chunk.byteLength > room ? chunk.subarray(0, room) : chunk;
        controller.enqueue(new Uint8Array(slice));
        total += slice.byteLength;
        if (total >= PAGE_BYTES) {
          finish();
          res.destroy();
        }
      });
      res.on("end", finish);
      res.on("error", (err) => {
        if (closed) return;
        closed = true;
        try {
          controller.error(err);
        } catch {
          // The reader already stopped.
        }
      });
    },
    cancel() {
      closed = true;
      res.destroy();
    },
  });
  const headers = new Headers();
  for (const [key, value] of Object.entries(res.headers)) {
    if (value == null) continue;
    if (Array.isArray(value)) {
      for (const item of value) headers.append(key, item);
    } else {
      headers.set(key, value);
    }
  }
  return new Response(stream, { status: res.statusCode ?? 500, headers });
}

async function readLimited(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < PAGE_BYTES) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    const room = PAGE_BYTES - total;
    chunks.push(value.byteLength > room ? value.slice(0, room) : value);
    total += Math.min(value.byteLength, room);
    if (value.byteLength > room) {
      await reader.cancel();
      break;
    }
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}
