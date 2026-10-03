import { fetchHtml, type HostLookup } from "./safe-fetch.ts";
import { WatchLookupError } from "./lookup-error.ts";

const CATALOG_ORIGIN = "https://www.swisswatchexpo.com";

export { WatchLookupError };

const COMPLICATION_RULES: { name: string; pattern: RegExp }[] = [
  { name: "Perpetual calendar", pattern: /perpetual calendar/i },
  { name: "Annual calendar", pattern: /annual calendar/i },
  { name: "Day-date", pattern: /day[-\s]?date|day and date/i },
  { name: "Chronograph", pattern: /chronograph/i },
  { name: "GMT", pattern: /\bgmt\b|dual time|second time zone/i },
  { name: "Moon phase", pattern: /moon\s?phase/i },
  { name: "Power reserve", pattern: /power reserve/i },
  { name: "World time", pattern: /world\s?time/i },
  { name: "Tourbillon", pattern: /tourbillon/i },
  { name: "Small seconds", pattern: /small seconds/i },
  { name: "Alarm", pattern: /\balarm\b/i },
  { name: "Date", pattern: /\bdate\b|cyclops/i },
];

export type ListingCard = {
  path: string;
  title: string;
  imageUrl: string | null;
  priceCents: number;
};

export type WatchLookupResult = {
  manufacturer: string;
  model: string;
  referenceNumber: string | null;
  imageUrl: string | null;
  retailPrice: string | null;
  chrono24Price: string | null;
  chrono24Url: string;
  complications: string;
  note: string;
};

export function complicationsFromText(text: string): string[] {
  const found = COMPLICATION_RULES.filter((rule) => rule.pattern.test(text)).map((rule) => rule.name);
  const richer = found.some((name) => name !== "Date" && /calendar|day-date/i.test(name));
  return richer ? found.filter((name) => name !== "Date") : found;
}

export function parseSearchCards(html: string): ListingCard[] {
  const pattern =
    /<a href="(\/watches\/[^"]+)"[^>]*>\s*<div class="product_box catalog">[\s\S]*?<img[^>]+src="(https:\/\/[^"]+)"[\s\S]*?<h5>([^<]+)<\/h5>[\s\S]*?<span class="price">[\s\S]*?\$([0-9][0-9,]*)/g;
  const cards: ListingCard[] = [];
  for (const match of html.matchAll(pattern)) {
    const priceCents = dollarsToCents(match[4]);
    if (priceCents == null) continue;
    cards.push({
      path: match[1],
      imageUrl: match[2],
      title: decodeEntities(match[3]).trim(),
      priceCents,
    });
  }
  return cards;
}

export function chooseListing(cards: ListingCard[], manufacturer: string, model: string): ListingCard | null {
  const brandTokens = tokens(manufacturer);
  const modelTokens = tokens(model);
  const wantsDate = modelTokens.includes("date") && !normalize(model).includes("no date");
  const scored = cards.flatMap((card) => {
    const title = normalize(card.title);
    const titleTokens = new Set(tokens(card.title));
    if (!brandTokens.every((token) => titleTokens.has(token))) return [];
    if (wantsDate && title.includes("no date")) return [];
    const hits = modelTokens.filter((token) => titleTokens.has(token)).length;
    if (modelTokens.length > 0 && hits === 0) return [];
    return [{ card, hits }];
  });
  if (scored.length === 0) return null;
  const best = Math.max(...scored.map((item) => item.hits));
  return scored
    .filter((item) => item.hits === best)
    .map((item) => item.card)
    .reduce((lowest, card) => (card.priceCents < lowest.priceCents ? card : lowest));
}

export function parseCatalogProduct(html: string): {
  name: string;
  description: string;
  imageUrl: string | null;
  priceCents: number | null;
  brand: string | null;
} | null {
  const block = html.match(/<script type="application\/ld(?:\+|&#x2B;)json">([\s\S]*?)<\/script>/i);
  if (!block) return null;
  let data: unknown;
  try {
    data = JSON.parse(block[1]);
  } catch {
    return null;
  }
  const product = findProduct(data);
  if (!product) return null;
  const name = stringField(product.name);
  const description = stringField(product.description);
  if (!name) return null;
  const images = Array.isArray(product.image) ? product.image.map(stringField).filter((item): item is string => !!item) : [];
  const offer = product.offers && typeof product.offers === "object" ? (product.offers as Record<string, unknown>) : null;
  const price = typeof offer?.price === "string" || typeof offer?.price === "number" ? dollarsToCents(String(offer.price)) : null;
  const brandRecord = product.brand && typeof product.brand === "object" ? (product.brand as Record<string, unknown>) : null;
  return {
    name,
    description: description ?? "",
    imageUrl: images.find((url) => url.startsWith("https://") && !/_sm\./.test(url)) ?? images.find((url) => url.startsWith("https://")) ?? null,
    priceCents: price,
    brand: brandRecord ? stringField(brandRecord.name) : null,
  };
}

export function chrono24SearchUrl(manufacturer: string, model: string): string {
  const query = `${manufacturer} ${model}`.trim();
  const url = new URL("https://www.chrono24.com/search/index.htm");
  url.searchParams.set("dosearch", "true");
  url.searchParams.set("query", query);
  url.searchParams.set("sortorder", "1");
  return url.toString();
}

export async function lookupWatch(
  manufacturerInput: string,
  modelInput: string,
  fetchImpl: typeof fetch = fetch,
  lookupHost?: HostLookup,
): Promise<WatchLookupResult> {
  const manufacturer = manufacturerInput.trim();
  const model = modelInput.trim();
  if (!manufacturer || !model) {
    throw new WatchLookupError("Manufacturer and model are required", 400);
  }

  const chrono24Url = chrono24SearchUrl(manufacturer, model);
  const [catalog, brand] = await Promise.all([
    lookupCatalog(manufacturer, model, fetchImpl, lookupHost),
    lookupManufacturer(manufacturer, model, fetchImpl, lookupHost),
  ]);
  const imageUrl = brand?.imageUrl ?? catalog?.imageUrl ?? null;
  const imageSource = brand?.imageUrl ? "manufacturer" : catalog?.imageUrl ? "catalog" : null;
  const retail = brand?.offer ? { ...brand.offer, host: brand.host ?? "the manufacturer site" } : null;
  if (catalog || retail || imageUrl) {
    const displayManufacturer = catalog?.brand && sameName(catalog.brand, manufacturer) ? catalog.brand : manufacturer;
    const complications = catalog ? complicationsFromText(`${catalog.name} ${catalog.description}`) : [];
    return {
      manufacturer: displayManufacturer,
      model,
      referenceNumber: retail?.reference ?? null,
      imageUrl,
      retailPrice: retail ? formatDollars(retail.priceCents) : null,
      chrono24Price: null,
      chrono24Url,
      complications: complications.join(", "),
      note: lookupNote(retail, imageSource ? { source: imageSource, host: brand?.host ?? null } : null),
    };
  }

  const wiki = await lookupWikipedia(manufacturer, model, fetchImpl, lookupHost);
  if (wiki) {
    return {
      manufacturer,
      model,
      referenceNumber: null,
      imageUrl: null,
      retailPrice: null,
      chrono24Price: null,
      chrono24Url,
      complications: wiki.complications.join(", "),
      note: "Filled the features from Wikipedia. No product photo or US retail price was listed.",
    };
  }

  throw new WatchLookupError("No matching watch found for that manufacturer and model", 404);
}

const BRAND_SITES: { names: string[]; pages: (model: string) => string[] }[] = [
  {
    names: ["rolex"],
    pages: (model) => [`https://www.rolex.com/en-us/watches/${rolexSlug(model)}/all-models`],
  },
  {
    names: ["omega"],
    pages: (model) => [`https://www.omegawatches.com/en-us/watches/${omegaSlug(model)}`],
  },
  {
    names: ["tudor"],
    pages: (model) => [`https://www.tudorwatch.com/en/watches/${tudorSlug(model)}`],
  },
  {
    names: ["nomos"],
    pages: (model) => [`https://nomos-glashuette.com/en/search?q=${encodeURIComponent(model)}`],
  },
];

export function manufacturerPages(manufacturer: string, model: string): string[] {
  const name = normalize(manufacturer);
  const brand = BRAND_SITES.find((site) => site.names.some((candidate) => name === candidate || name.includes(candidate)));
  return brand ? brand.pages(model) : [];
}

function rolexSlug(model: string): string {
  const name = normalize(model);
  if (/\bgmt\b/.test(name)) return "gmt-master-ii";
  if (name.includes("daytona")) return "cosmograph-daytona";
  if (name.includes("sky dweller")) return "sky-dweller";
  if (name.includes("sea dweller") || name.includes("deepsea")) return "sea-dweller";
  if (name.includes("yacht")) return "yacht-master";
  if (name.includes("day date")) return "day-date";
  if (name.includes("datejust")) return "datejust";
  if (name.includes("explorer 2") || name.includes("explorer ii")) return "explorer-ii";
  if (name.includes("submariner")) return "submariner";
  if (name.includes("explorer")) return "explorer";
  return genericSlug(model);
}

function omegaSlug(model: string): string {
  const name = normalize(model);
  if (name.includes("speedmaster")) return "speedmaster";
  if (name.includes("seamaster")) return "seamaster";
  if (name.includes("constellation")) return "constellation";
  if (name.includes("de ville")) return "de-ville";
  return genericSlug(model);
}

function tudorSlug(model: string): string {
  const name = normalize(model);
  if (name.includes("black bay")) return "black-bay";
  if (name.includes("pelagos")) return "pelagos";
  if (name.includes("ranger")) return "ranger";
  if (name.includes("royal")) return "royal";
  return genericSlug(model);
}

function genericSlug(model: string): string {
  const drop = new Set(["date", "no", "professional", "moonwatch", "oyster", "the", "watch", "watches", "mm", "gmt"]);
  const kept = tokens(model).filter((token) => !drop.has(token) && !/^\d+$/.test(token));
  return kept.join("-") || "watches";
}

async function lookupManufacturer(
  manufacturer: string,
  model: string,
  fetchImpl: typeof fetch,
  lookupHost?: HostLookup,
) {
  const pages = manufacturerPages(manufacturer, model);
  const discovered = pages.length > 0 ? [] : await discoverManufacturerPages(manufacturer, model, fetchImpl, lookupHost);
  let imageUrl: string | null = null;
  let host: string | null = null;
  const { parseProductPage } = await import("./watch-page.ts");
  for (const page of [...pages, ...discovered]) {
    const fetched = await readPage(page, fetchImpl, lookupHost);
    if (!fetched) continue;
    const product = parseProductPage(fetched.html, fetched.finalUrl, model);
    if (!product) continue;
    const pageHost = new URL(fetched.finalUrl).hostname.replace(/^www\./, "");
    const offer =
      product.currency === "USD" && product.priceCents != null
        ? {
            label: [product.model, product.material, product.size].filter(Boolean).join(", "),
            reference: product.reference,
            priceCents: product.priceCents,
            imageUrl: product.imageUrl,
          }
        : null;
    if (!imageUrl && product.imageUrl) {
      imageUrl = product.imageUrl;
      host = pageHost;
    }
    if (!offer) continue;
    return { offer, imageUrl: offer.imageUrl ?? imageUrl, host: pageHost };
  }
  if (!imageUrl) return null;
  return { offer: null, imageUrl, host };
}

async function discoverManufacturerPages(
  manufacturer: string,
  model: string,
  fetchImpl: typeof fetch,
  lookupHost?: HostLookup,
): Promise<string[]> {
  const origin = await discoverBrandOrigin(manufacturer, fetchImpl, lookupHost);
  if (!origin) return [];
  const query = encodeURIComponent(model.trim());
  return [new URL(`/en/search?q=${query}`, origin).toString(), new URL(`/search?q=${query}`, origin).toString()];
}

async function discoverBrandOrigin(
  manufacturer: string,
  fetchImpl: typeof fetch,
  lookupHost?: HostLookup,
): Promise<string | null> {
  const query = new URL("https://www.bing.com/search");
  query.searchParams.set("format", "rss");
  query.searchParams.set("q", `${manufacturer} official website`);
  const rss = await readPage(query.toString(), fetchImpl, lookupHost);
  if (!rss) return null;
  const links = [...rss.html.matchAll(/<link>(https:[^<]+)<\/link>/g)].map((match) => match[1]);
  for (const link of links) {
    let url: URL;
    try {
      url = new URL(link);
    } catch {
      continue;
    }
    if (!hostMatchesBrand(url.hostname, manufacturer)) continue;
    return url.origin;
  }
  return null;
}

function hostMatchesBrand(hostname: string, manufacturer: string): boolean {
  const host = hostname.replace(/^www\./, "").toLowerCase();
  if (host.endsWith("bing.com") || host.endsWith("microsoft.com")) return false;
  return tokens(manufacturer).some((token) => token.length >= 4 && host.includes(token));
}

async function readPage(
  page: string,
  fetchImpl: typeof fetch,
  lookupHost?: HostLookup,
): Promise<{ html: string; finalUrl: string } | null> {
  try {
    return await fetchHtml(page, fetchImpl, lookupHost);
  } catch {
    return null;
  }
}

function lookupNote(
  retail: { priceCents: number; host: string; label: string; reference: string | null } | null,
  image: { source: "manufacturer" | "catalog"; host: string | null } | null,
): string {
  const parts: string[] = [];
  if (image?.source === "manufacturer" && image.host) {
    parts.push(`Photo is from ${image.host}.`);
  } else if (image?.source === "catalog") {
    parts.push("Photo is from a dealer listing.");
  } else {
    parts.push("No product photo was listed.");
  }
  if (retail) {
    const reference = retail.reference ? ` (${retail.reference})` : "";
    parts.push(`New price is ${formatAsk(retail.priceCents)} on ${retail.host} for ${retail.label}${reference}.`);
  } else {
    parts.push("The manufacturer's site did not list a new US retail price.");
  }
  parts.push("Enter the Chrono24 price from the search link. That site blocks automated price lookups.");
  return parts.join(" ");
}

async function lookupCatalog(
  manufacturer: string,
  model: string,
  fetchImpl: typeof fetch,
  lookupHost?: HostLookup,
) {
  const searchUrl = new URL("/search/", CATALOG_ORIGIN);
  searchUrl.searchParams.set("q", `${manufacturer} ${model}`);
  const searchHtml = await readPage(searchUrl.toString(), fetchImpl, lookupHost);
  if (!searchHtml) return null;
  const chosen = chooseListing(parseSearchCards(searchHtml.html), manufacturer, model);
  if (!chosen) return null;
  const listingUrl = catalogUrl(chosen.path);
  if (!listingUrl) return null;
  const detailHtml = await readPage(listingUrl.toString(), fetchImpl, lookupHost);
  const product = detailHtml ? parseCatalogProduct(detailHtml.html) : null;
  return {
    brand: product?.brand ?? null,
    name: product?.name ?? chosen.title,
    description: product?.description ?? chosen.title,
    imageUrl: product?.imageUrl ?? chosen.imageUrl,
    priceCents: product?.priceCents ?? chosen.priceCents,
  };
}

type WikiPage = {
  title?: string;
  extract?: string;
};

async function lookupWikipedia(
  manufacturer: string,
  model: string,
  fetchImpl: typeof fetch,
  lookupHost?: HostLookup,
) {
  const url = new URL("https://en.wikipedia.org/w/api.php");
  url.searchParams.set("action", "query");
  url.searchParams.set("generator", "search");
  url.searchParams.set("gsrsearch", `${manufacturer} ${model}`);
  url.searchParams.set("gsrlimit", "5");
  url.searchParams.set("prop", "extracts");
  url.searchParams.set("exintro", "1");
  url.searchParams.set("explaintext", "1");
  url.searchParams.set("format", "json");
  const response = await readPage(url.toString(), fetchImpl, lookupHost);
  if (!response) return null;
  let payload: { query?: { pages?: Record<string, WikiPage> } };
  try {
    payload = JSON.parse(response.html) as { query?: { pages?: Record<string, WikiPage> } };
  } catch {
    return null;
  }
  const pages = Object.values(payload.query?.pages ?? {});
  const wanted = tokens(`${manufacturer} ${model}`);
  const ranked = pages
    .map((page) => ({
      page,
      hits: wanted.filter((token) => normalize(page.title ?? "").includes(token)).length,
    }))
    .filter((item) => item.hits >= Math.max(tokens(model).length, 1))
    .sort((a, b) => b.hits - a.hits);
  const best = ranked[0]?.page;
  if (!best) return null;
  return {
    complications: complicationsFromText(`${best.title ?? ""} ${best.extract ?? ""}`),
  };
}

function findProduct(data: unknown): Record<string, unknown> | null {
  if (!data || typeof data !== "object") return null;
  if (Array.isArray(data)) {
    for (const item of data) {
      const found = findProduct(item);
      if (found) return found;
    }
    return null;
  }
  const record = data as Record<string, unknown>;
  if (record["@type"] === "Product") return record;
  if (Array.isArray(record["@graph"])) return findProduct(record["@graph"]);
  return null;
}

function stringField(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const decoded = decodeEntities(value).trim();
  return decoded || null;
}

function catalogUrl(path: string): URL | null {
  if (!path.startsWith("/watches/") || path.includes("..")) return null;
  const url = new URL(path, CATALOG_ORIGIN);
  if (url.origin !== CATALOG_ORIGIN) return null;
  return url;
}

function tokens(value: string): string[] {
  return normalize(value)
    .split(" ")
    .filter((token) => token.length >= 2);
}

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/&amp;/g, " and ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function sameName(left: string, right: string): boolean {
  return normalize(left) === normalize(right);
}

function dollarsToCents(value: string): number | null {
  const cleaned = value.replace(/[$,]/g, "").trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(cleaned)) return null;
  const amount = Number(cleaned);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return Math.round(amount * 100);
}

function formatDollars(cents: number): string {
  if (cents % 100 === 0) return String(cents / 100);
  return (cents / 100).toFixed(2);
}

function formatAsk(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
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
