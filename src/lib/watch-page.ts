import { chrono24SearchUrl, complicationsFromText, type WatchLookupResult } from "./watch-lookup.ts";
import { fetchHtml, type HostLookup } from "./safe-fetch.ts";
import { WatchLookupError } from "./lookup-error.ts";

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
  lookupHost?: HostLookup,
): Promise<WatchLookupResult> {
  const { html, finalUrl } = await fetchHtml(pageUrl, fetchImpl, lookupHost);
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
  const model = product.model;
  return {
    manufacturer,
    model,
    referenceNumber: product.reference,
    imageUrl: product.imageUrl,
    retailPrice,
    chrono24Price: null,
    chrono24Url: model ? chrono24SearchUrl(manufacturer, modelWithReference(model, product.reference)) : "",
    complications: product.complications.join(", "),
    note: pageNote(host, product),
  };
}

export function parseProductPage(html: string, pageUrl: string, modelQuery?: string): ParsedProduct | null {
  const meta = readMeta(html);
  const products = collectProducts(html);
  const product = modelQuery ? pickProductForModel(products, modelQuery) : pickProduct(products, pageUrl);
  if (modelQuery && !product) return null;
  const micro = product || modelQuery ? null : readMicrodata(html);

  const brand =
    (product ? readBrand(product) : null) ??
    (modelQuery ? null : meta.brand) ??
    micro?.brand ??
    (modelQuery ? null : cleanSiteName(meta.siteName));
  const rawName =
    (product ? stringField(product.name) : null) ??
    (modelQuery ? null : meta.title) ??
    micro?.name ??
    (modelQuery ? null : readTitle(html));
  const model = rawName ? cleanModel(rawName, brand) : "";
  if (!model) return null;

  const description = [
    product ? stringField(product.description) : null,
    modelQuery ? null : micro?.description,
    modelQuery ? null : meta.description,
  ]
    .filter((item): item is string => !!item)
    .map(plainText)
    .join(" ");
  const properties = product ? propertyBlob(product) : "";
  const productImages = product ? readImages(product.image) : [];
  const fallbackImages = modelQuery ? [] : [meta.image, micro?.image].filter((item): item is string => !!item);
  const offer =
    chooseOffer(product ? readOffers(product.offers) : [], pageUrl) ??
    (modelQuery ? null : metaOffer(meta, pageUrl) ?? microOffer(micro, pageUrl));

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

function pickProductForModel(products: Record<string, unknown>[], model: string): Record<string, unknown> | null {
  const ranked = products.flatMap((product) => {
    if (!stringField(product.name)) return [];
    const score = scoreProductForModel(product, model);
    if (score <= 0) return [];
    return [{ product, score, price: chooseOffer(readOffers(product.offers), "https://example.com/en-us")?.cents ?? Number.MAX_SAFE_INTEGER }];
  });
  ranked.sort((a, b) => b.score - a.score || a.price - b.price);
  return ranked[0]?.product ?? null;
}

function scoreProductForModel(product: Record<string, unknown>, model: string): number {
  const label = normalize(
    [stringField(product.name), readReference(product), stringField(product.material), stringField(product.size), stringField(product.description)]
      .filter(Boolean)
      .join(" "),
  );
  const query = normalize(model);
  const labelTokens = new Set(tokens(label));
  const queryTokens = tokens(model);
  const wantsDate = queryTokens.includes("date") && !query.includes("no date");
  if (wantsDate && label.includes("no date")) return 0;
  let score = queryTokens.filter((token) => labelTokens.has(token)).length;
  if (score === 0) return 0;
  const mentions = (words: string[]) => words.some((word) => query.includes(word));
  if (mentions(["gold", "yellow", "rose", "everose", "platinum"])) {
    if (/\bgold\b|\bplatinum\b|\beverose\b/.test(label)) score += 3;
  } else if (/\bgold\b|\bplatinum\b|\beverose\b/.test(label)) {
    score -= 4;
  }
  if (
    !mentions(["rubber", "leather", "strap", "nato", "nylon", "fabric"]) &&
    /\brubber\b|\bleather\b|\bnylon\b|\bfabric\b|\bstrap\b/.test(label)
  ) {
    score -= 2;
  }
  if (mentions(["green", "starbucks", "kermit", "lv"])) {
    if (label.includes("lv")) score += 3;
  } else if (label.includes("126610lv")) {
    score -= 3;
  }
  return score;
}

function tokens(value: string): string[] {
  return normalize(value)
    .split(" ")
    .filter((token) => token.length >= 2);
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
