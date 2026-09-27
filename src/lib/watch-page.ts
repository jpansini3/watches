import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import { chrono24SearchUrl, complicationsFromText, WatchLookupError, type WatchLookupResult } from "./watch-lookup.ts";

const PAGE_BYTES = 2_000_000;
const MAX_REDIRECTS = 5;

type HostLookup = (hostname: string) => Promise<{ address: string }[]>;

export type ParsedProduct = {
  manufacturer: string | null;
  model: string;
  imageUrl: string | null;
  priceCents: number | null;
  currency: string | null;
  reference: string | null;
  complications: string[];
  material: string | null;
  size: string | null;
};

type OfferPrice = {
  cents: number;
  currency: string | null;
};

export async function lookupProductPage(
  pageUrl: string,
  fetchImpl: typeof fetch = fetch,
  lookupHost: HostLookup = dnsAddresses,
): Promise<WatchLookupResult> {
  const { html, finalUrl } = await fetchProductPage(pageUrl, fetchImpl, lookupHost);
  const product = parseProductPage(html, finalUrl);
  if (!product) {
    if (/just a moment|cf-browser-verification|captcha/i.test(html.slice(0, 1_500))) {
      throw new WatchLookupError("That site blocked the request. Copy the details from the page.", 502);
    }
    throw new WatchLookupError("That page did not include a product name", 404);
  }
  const host = new URL(finalUrl).hostname.replace(/^www\./, "");
  const retailPrice = product.currency === "USD" && product.priceCents != null ? formatDollars(product.priceCents) : null;
  const manufacturer = product.manufacturer ?? "";
  const model = modelWithReference(product.model, product.reference);
  return {
    manufacturer,
    model,
    imageUrl: product.imageUrl,
    retailPrice,
    chrono24Price: null,
    chrono24Url: model ? chrono24SearchUrl(manufacturer, model) : "",
    complications: product.complications.join(", "),
    note: pageNote(host, product),
  };
}

export function parseProductPage(html: string, pageUrl: string): ParsedProduct | null {
  const meta = readMeta(html);
  const product = pickProduct(collectProducts(html), pageUrl);
  const micro = product ? null : readMicrodata(html);

  const brand =
    (product ? readBrand(product) : null) ??
    meta.brand ??
    micro?.brand ??
    cleanSiteName(meta.siteName);
  const rawName =
    (product ? stringField(product.name) : null) ??
    meta.title ??
    micro?.name ??
    readTitle(html);
  const model = rawName ? cleanModel(rawName, brand) : "";
  if (!model) return null;

  const description = [product ? stringField(product.description) : null, micro?.description, meta.description]
    .filter((item): item is string => !!item)
    .map(plainText)
    .join(" ");
  const properties = product ? propertyBlob(product) : "";
  const productImages = product ? readImages(product.image) : [];
  const fallbackImages = [meta.image, micro?.image].filter((item): item is string => !!item);
  const offer = chooseOffer(product ? readOffers(product.offers) : [], pageUrl) ?? metaOffer(meta, pageUrl) ?? microOffer(micro, pageUrl);

  return {
    manufacturer: brand,
    model,
    imageUrl: chooseImage(productImages, pageUrl) ?? chooseImage(fallbackImages, pageUrl),
    priceCents: offer?.cents ?? null,
    currency: offer?.currency ?? null,
    reference: (product ? readReference(product) : null) ?? micro?.sku ?? null,
    complications: complicationsFromText(`${model} ${description} ${properties}`),
    material: product ? shortFact(stringField(product.material)) : null,
    size: product ? shortFact(stringField(product.size)) : null,
  };
}

async function fetchProductPage(
  pageUrl: string,
  fetchImpl: typeof fetch,
  lookupHost: HostLookup,
): Promise<{ html: string; finalUrl: string }> {
  let current = await checkPageUrl(pageUrl, lookupHost);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    let response: Response;
    try {
      response = await fetchImpl(current, {
        redirect: "manual",
        headers: {
          Accept: "text/html,application/xhtml+xml;q=0.9",
          "Accept-Language": "en-US,en;q=0.9",
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
        },
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new WatchLookupError("Could not reach that manufacturer page", 502);
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new WatchLookupError("The manufacturer page redirected without a destination", 502);
      if (hop === MAX_REDIRECTS) throw new WatchLookupError("The manufacturer page redirected too many times", 502);
      current = await checkPageUrl(new URL(location, current).toString(), lookupHost);
      continue;
    }
    if (response.status === 401 || response.status === 403 || response.status === 429) {
      throw new WatchLookupError("That site refused an automated request. Copy the details from the page.", 502);
    }
    if (!response.ok) throw new WatchLookupError(`The manufacturer page returned ${response.status}`, 502);
    const type = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (/^(image|audio|video|application\/pdf|application\/zip|application\/octet-stream)$/.test(type)) {
      throw new WatchLookupError("That URL is not a product page", 400);
    }
    return { html: await readLimited(response), finalUrl: current.toString() };
  }
  throw new WatchLookupError("The manufacturer page redirected too many times", 502);
}

async function checkPageUrl(value: string, lookupHost: HostLookup): Promise<URL> {
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
  if (addresses.length === 0 || addresses.some(isPrivateIp)) {
    throw new WatchLookupError("That URL can't be fetched", 400);
  }
  return url;
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

function isPrivateIp(address: string): boolean {
  const mapped = address.toLowerCase().startsWith("::ffff:") ? address.slice(7) : address;
  if (mapped.includes(":")) {
    const ip = mapped.toLowerCase();
    if (ip === "::" || ip === "::1") return true;
    return ip.startsWith("fe80:") || ip.startsWith("fc") || ip.startsWith("fd");
  }
  const parts = mapped.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127 || a === 255) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
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

function collectProducts(html: string): Record<string, unknown>[] {
  const products: Record<string, unknown>[] = [];
  const seen = new Set<unknown>();
  for (const block of jsonBlocks(html)) {
    const parsed = parseJson(block);
    if (parsed) walkProducts(parsed, products, seen);
  }
  const trimmed = html.trim().replace(/^\uFEFF/, "");
  if (products.length === 0 && (trimmed.startsWith("{") || trimmed.startsWith("["))) {
    const parsed = parseJson(trimmed);
    if (parsed) walkProducts(parsed, products, seen);
  }
  return products;
}

function jsonBlocks(html: string): string[] {
  const pattern = /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  return [...html.matchAll(pattern)].map((match) => match[1]);
}

function walkProducts(data: unknown, products: Record<string, unknown>[], seen: Set<unknown>): void {
  if (!data || typeof data !== "object" || seen.has(data)) return;
  seen.add(data);
  if (Array.isArray(data)) {
    for (const item of data) walkProducts(item, products, seen);
    return;
  }
  const record = data as Record<string, unknown>;
  if (isProductType(record["@type"])) products.push(record);
  for (const value of Object.values(record)) walkProducts(value, products, seen);
}

function isProductType(value: unknown): boolean {
  const types = Array.isArray(value) ? value : [value];
  return types.some((type) => {
    if (typeof type !== "string") return false;
    const name = type.split("/").pop()?.trim().toLowerCase() ?? "";
    return name === "product" || name === "individualproduct" || name === "productmodel";
  });
}

function pickProduct(products: Record<string, unknown>[], pageUrl: string): Record<string, unknown> | null {
  if (products.length === 0) return null;
  const key = pageKey(pageUrl);
  const matched = products.filter((product) => {
    const url = stringField(product.url);
    return !!key && !!url && pageKey(url) === key;
  });
  const pool = matched.length > 0 ? matched : products;
  return [...pool].sort((a, b) => scoreProduct(b) - scoreProduct(a)).find((product) => stringField(product.name)) ?? null;
}

function scoreProduct(product: Record<string, unknown>): number {
  let score = 0;
  if (product.offers) score += 4;
  if (product.image) score += 2;
  if (product.brand || product.manufacturer) score += 1;
  return score;
}

function readBrand(product: Record<string, unknown>): string | null {
  return brandName(product.brand) ?? brandName(product.manufacturer);
}

function brandName(value: unknown): string | null {
  if (typeof value === "string") return cleanSiteName(value);
  if (Array.isArray(value)) return brandName(value[0]);
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  return stringField(record.name);
}

function readImages(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(readImages);
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  return readImages(record.url ?? record.contentUrl ?? record.image);
}

function readOffers(value: unknown): OfferPrice[] {
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap(readOffers);
  const record = value as Record<string, unknown>;
  const offers = [...readOffers(record.offers), ...readOffers(record.priceSpecification)];
  const cents = parsePrice(record.price ?? record.lowPrice);
  if (cents == null) return offers;
  const currency = stringField(record.priceCurrency)?.toUpperCase() ?? null;
  return [{ cents, currency }, ...offers];
}

function chooseOffer(offers: OfferPrice[], pageUrl: string): OfferPrice | null {
  if (offers.length === 0) return null;
  const usd = offers.find((offer) => offer.currency === "USD");
  if (usd) return usd;
  const unspecified = offers.find((offer) => offer.currency == null);
  if (unspecified && pageLooksAmerican(pageUrl)) return { cents: unspecified.cents, currency: "USD" };
  return offers[0];
}

function readReference(product: Record<string, unknown>): string | null {
  for (const key of ["mpn", "sku"]) {
    const value = stringField(product[key]);
    if (value && !/^\d{12,14}$/.test(value)) return value;
  }
  return null;
}

function propertyBlob(product: Record<string, unknown>): string {
  if (!Array.isArray(product.additionalProperty)) return "";
  return product.additionalProperty
    .map((prop) => {
      if (!prop || typeof prop !== "object") return "";
      const record = prop as Record<string, unknown>;
      return [stringField(record.name), stringField(record.value)].filter(Boolean).join(" ");
    })
    .filter(Boolean)
    .join(". ");
}

type MetaTags = {
  title: string | null;
  description: string | null;
  image: string | null;
  siteName: string | null;
  brand: string | null;
  price: string | null;
  currency: string | null;
};

function readMeta(html: string): MetaTags {
  const tags = html.match(/<meta\b[^>]*>/gi) ?? [];
  const values = new Map<string, string>();
  for (const tag of tags) {
    const key = attr(tag, "property") ?? attr(tag, "name") ?? attr(tag, "itemprop");
    const content = attr(tag, "content");
    if (!key || !content || values.has(key.toLowerCase())) continue;
    values.set(key.toLowerCase(), decodeEntities(content));
  }
  return {
    title: values.get("og:title") ?? values.get("twitter:title") ?? null,
    description: values.get("og:description") ?? values.get("twitter:description") ?? null,
    image: values.get("og:image") ?? values.get("twitter:image") ?? null,
    siteName: values.get("og:site_name") ?? null,
    brand: values.get("product:brand") ?? null,
    price: values.get("product:price:amount") ?? null,
    currency: values.get("product:price:currency") ?? null,
  };
}

function metaOffer(meta: MetaTags, pageUrl: string): OfferPrice | null {
  return offerFromStrings(meta.price, meta.currency, pageUrl);
}

type Microdata = {
  name: string | null;
  brand: string | null;
  image: string | null;
  description: string | null;
  price: string | null;
  currency: string | null;
  sku: string | null;
};

function readMicrodata(html: string): Microdata | null {
  if (!/schema\.org\/(?:Product|IndividualProduct)\b/i.test(html)) return null;
  return {
    name: itemValue(html, "name"),
    brand: itemValue(html, "brand"),
    image: itemValue(html, "image"),
    description: itemValue(html, "description"),
    price: itemValue(html, "price"),
    currency: itemValue(html, "priceCurrency"),
    sku: itemValue(html, "sku") ?? itemValue(html, "mpn"),
  };
}

function microOffer(micro: Microdata | null, pageUrl: string): OfferPrice | null {
  if (!micro) return null;
  return offerFromStrings(micro.price, micro.currency, pageUrl);
}

function offerFromStrings(price: string | null, currency: string | null, pageUrl: string): OfferPrice | null {
  const cents = parsePrice(price);
  if (cents == null) return null;
  const code = currency?.trim().toUpperCase() || null;
  if (code == null && pageLooksAmerican(pageUrl)) return { cents, currency: "USD" };
  return { cents, currency: code };
}

function itemValue(html: string, name: string): string | null {
  const pattern = new RegExp(`<([a-z0-9]+)\\b[^>]*\\bitemprop\\s*=\\s*["']${name}["'][^>]*>`, "i");
  const match = pattern.exec(html);
  if (!match) return null;
  const tag = match[1].toLowerCase();
  const content = attr(match[0], "content");
  if (content) return decodeEntities(content);
  if (tag === "img" || tag === "source") return attr(match[0], "src") ?? attr(match[0], "href");
  if (tag === "a" || tag === "link") return attr(match[0], "href");
  const close = html.indexOf(`</${tag}>`, match.index + match[0].length);
  if (close < 0) return null;
  const text = plainText(html.slice(match.index + match[0].length, close));
  return text || null;
}

function readTitle(html: string): string | null {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? plainText(match[1]) : null;
}

function chooseImage(candidates: string[], pageUrl: string): string | null {
  let bestUrl: string | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < candidates.length; index += 1) {
    const resolved = resolveHttps(candidates[index], pageUrl);
    if (!resolved) continue;
    const score = imageScore(resolved, index);
    if (score == null || score <= bestScore) continue;
    bestUrl = resolved;
    bestScore = score;
  }
  return bestUrl;
}

function imageScore(url: string, index: number): number | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase();
  if (/(^|\.)doubleclick\.net$|(^|\.)facebook\.com$|(^|\.)googletagmanager\.com$/.test(host)) return null;
  const path = `${parsed.pathname} ${parsed.search}`.toLowerCase();
  if (/\.(svg|gif|ico)(?:$|\?)/i.test(parsed.pathname)) return null;
  if (/\b(logo|icon|sprite|favicon|placeholder|pixel|spinner|badge)\b/.test(path)) return null;
  let score = 10 - Math.min(index, 9);
  if (path.includes("front")) score += 8;
  if (/\b(wrist|wristshot|back|detail|lifestyle|banner|campaign|lookbook)\b/.test(path)) score -= 6;
  return score;
}

function resolveHttps(value: string, pageUrl: string): string | null {
  try {
    const url = new URL(value, pageUrl);
    if (url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

function modelWithReference(model: string, reference: string | null): string {
  if (!reference || reference.length > 40 || !/\d/.test(reference)) return model;
  if (normalize(model).includes(normalize(reference))) return model;
  return `${model} ${reference}`;
}

function cleanModel(name: string, manufacturer: string | null): string {
  let model = plainText(name);
  const brand = normalize(manufacturer ?? "");
  for (let pass = 0; pass < 3; pass += 1) {
    const match = /^(.*?)\s+(?:\||–|—|-)\s+(.*)$/.exec(model);
    if (!match) break;
    const head = match[1].trim();
    const tail = normalize(match[2]);
    const tailIsSite = !brand || tail.includes(brand) || /\b(store|shop|boutique|official|watches)\b/.test(tail);
    if (!head || !tailIsSite) break;
    model = head;
  }
  if (manufacturer && model.toLowerCase().startsWith(manufacturer.toLowerCase())) {
    const rest = model.slice(manufacturer.length).replace(/^[\s,:–—|-]+/, "").trim();
    if (rest.length >= 2) model = rest;
  }
  return model;
}

function cleanSiteName(value: string | null): string | null {
  if (!value) return null;
  const name = plainText(value).split(/\s+[|–—]\s+/)[0]?.trim() ?? "";
  return name || null;
}

function pageLooksAmerican(pageUrl: string): boolean {
  try {
    const url = new URL(pageUrl);
    const host = url.hostname.toLowerCase();
    if (host.startsWith("us.") || host.endsWith(".us")) return true;
    return /\/(?:en-us|en_us|us-en|us)(?:\/|$)/.test(url.pathname.toLowerCase());
  } catch {
    return false;
  }
}

function pageKey(value: string): string | null {
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/^www\./, "").toLowerCase();
    const path = url.pathname.replace(/\/+$/, "") || "/";
    return `${host}${path}`;
  } catch {
    return null;
  }
}

function pageNote(host: string, product: ParsedProduct): string {
  const parts = [`Filled from ${host}.`];
  if (product.reference) parts.push(`Reference ${product.reference}.`);
  const facts = [product.material, product.size].filter((item): item is string => !!item);
  if (facts.length > 0) parts.push(`${facts.join(", ")}.`);
  if (product.priceCents != null && product.currency === "USD") {
    parts.push(`New price is ${formatAsk(product.priceCents, "USD")}.`);
  } else if (product.priceCents != null && product.currency) {
    parts.push(`The page lists ${formatAsk(product.priceCents, product.currency)} ${product.currency}.`);
  } else if (product.priceCents != null) {
    parts.push(`The page lists ${formatDollars(product.priceCents)} without a currency.`);
  } else {
    parts.push("The page did not list a price.");
  }
  if (!product.imageUrl) parts.push("The page did not include a product photo.");
  parts.push("Chrono24 price is not on the manufacturer page.");
  return parts.join(" ");
}

function parsePrice(value: unknown): number | null {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value <= 0) return null;
    return Math.round(value * 100);
  }
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  let normalized = trimmed.replace(/[^\d.,]/g, "");
  if (!normalized) return null;
  if (/^\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?$/.test(normalized)) normalized = normalized.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?$/.test(normalized)) normalized = normalized.replace(/,/g, "");
  else if (/^\d+,\d{1,2}$/.test(normalized)) normalized = normalized.replace(",", ".");
  else normalized = normalized.replace(/,/g, "");
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const amount = Number(normalized);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return Math.round(amount * 100);
}

function parseJson(text: string): unknown | null {
  const cleaned = text.replace(/<!--[\s\S]*?-->/g, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    try {
      return JSON.parse(decodeEntities(cleaned));
    } catch {
      return null;
    }
  }
}

function stringField(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = plainText(value);
  return text || null;
}

function shortFact(value: string | null): string | null {
  if (!value || value.length > 80) return null;
  return value;
}

function plainText(value: string): string {
  return decodeEntities(value)
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function attr(tag: string, name: string): string | null {
  const match = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i").exec(tag);
  const value = match?.[1] ?? match?.[2];
  return value ? value.trim() : null;
}

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/&amp;/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function formatDollars(cents: number): string {
  if (cents % 100 === 0) return String(cents / 100);
  return (cents / 100).toFixed(2);
}

function formatAsk(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
    }).format(cents / 100);
  } catch {
    const amount = cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2);
    return `${amount} ${currency}`;
  }
}

function decodeEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, digits: string) => String.fromCodePoint(Number(digits)))
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}
