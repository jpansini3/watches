const CATALOG_ORIGIN = "https://www.swisswatchexpo.com";
const USER_AGENT = "watches/1.0 (personal want list)";

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

export type RetailOffer = {
  label: string;
  reference: string | null;
  priceCents: number;
  imageUrl: string | null;
};

export type ProductShot = {
  url: string;
  alt: string;
  caption: string;
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

export class WatchLookupError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

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

export function parseRetailOffers(text: string): RetailOffer[] {
  const rolex = parseRolexGrid(text);
  if (rolex.length > 0) return rolex;
  return parseNearbyPrices(text);
}

export function chooseRetailOffer(offers: RetailOffer[], model: string): RetailOffer | null {
  const ranked = offers
    .map((offer) => ({ offer, score: retailScore(offer, model) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.offer.priceCents - b.offer.priceCents);
  return ranked[0]?.offer ?? null;
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
): Promise<WatchLookupResult> {
  const manufacturer = manufacturerInput.trim();
  const model = modelInput.trim();
  if (!manufacturer || !model) {
    throw new WatchLookupError("Manufacturer and model are required", 400);
  }

  const chrono24Url = chrono24SearchUrl(manufacturer, model);
  const [catalog, brand] = await Promise.all([
    lookupCatalog(manufacturer, model, fetchImpl),
    lookupManufacturer(manufacturer, model, fetchImpl),
  ]);
  let imageUrl = brand?.imageUrl ?? null;
  let imageSource: "manufacturer" | "chrono24" | null = imageUrl ? "manufacturer" : null;
  if (!imageUrl) {
    imageUrl = await lookupChrono24Image(manufacturer, model, fetchImpl);
    if (imageUrl) imageSource = "chrono24";
  }
  const retail = brand?.offer ? { ...brand.offer, host: brand.host ?? "the manufacturer site" } : null;
  if (catalog || retail || imageUrl) {
    const displayManufacturer = catalog?.brand && sameName(catalog.brand, manufacturer) ? catalog.brand : manufacturer;
    const complications = catalog ? complicationsFromText(`${catalog.name} ${catalog.description}`) : [];
    const marketCents = catalog?.priceCents ?? null;
    return {
      manufacturer: displayManufacturer,
      model,
      referenceNumber: retail?.reference ?? null,
      imageUrl,
      retailPrice: retail ? formatDollars(retail.priceCents) : null,
      chrono24Price: marketCents == null ? null : formatDollars(marketCents),
      chrono24Url,
      complications: complications.join(", "),
      note: lookupNote(marketCents, retail, imageSource ? { source: imageSource, host: brand?.host ?? null } : null),
    };
  }

  const wiki = await lookupWikipedia(manufacturer, model, fetchImpl);
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
      note: "Filled the features from Wikipedia. No product photo was listed on the manufacturer site, and Chrono24 blocks automated photo lookups.",
    };
  }

  throw new WatchLookupError("No matching watch found for that manufacturer and model", 404);
}

const BRAND_SITES: { names: string[]; pages: (model: string) => string[] }[] = [
  {
    names: ["rolex"],
    pages: (model) => [`https://www.rolex.com/en-us/watches/${familySlug(model)}/all-models`],
  },
  {
    names: ["omega"],
    pages: (model) => [`https://www.omegawatches.com/en-us/watches/${familySlug(model)}`],
  },
  {
    names: ["tudor"],
    pages: (model) => [`https://www.tudorwatch.com/en/watches/${familySlug(model)}`],
  },
  {
    names: ["nomos"],
    pages: (model) => [`https://nomos-glashuette.com/en/search?q=${encodeURIComponent(model)}`],
  },
];

async function lookupManufacturer(manufacturer: string, model: string, fetchImpl: typeof fetch) {
  const pages = manufacturerPages(manufacturer, model);
  const discovered = pages.length > 0 ? [] : await discoverManufacturerPages(manufacturer, model, fetchImpl);
  let imageUrl: string | null = null;
  let host: string | null = null;
  for (const page of [...pages, ...discovered]) {
    const text = await readManufacturerPage(page, fetchImpl);
    if (!text) continue;
    const pageHost = new URL(page).hostname.replace(/^www\./, "");
    const shot = chooseProductImage(parseMarkdownImages(text), manufacturer, model);
    const offer = chooseRetailOffer(parseRetailOffers(text), model);
    if (!imageUrl && (offer?.imageUrl || shot)) {
      imageUrl = offer?.imageUrl ?? shot;
      host = pageHost;
    }
    if (!offer) continue;
    return { offer, imageUrl: offer.imageUrl ?? shot ?? imageUrl, host: pageHost };
  }
  if (!imageUrl) return null;
  return { offer: null, imageUrl, host };
}

async function lookupChrono24Image(manufacturer: string, model: string, fetchImpl: typeof fetch) {
  const text = await readManufacturerPage(chrono24SearchUrl(manufacturer, model), fetchImpl);
  if (!text || /just a moment|captcha|cf-browser-verification/i.test(text.slice(0, 800))) return null;
  return chooseProductImage(parseMarkdownImages(text), manufacturer, model);
}

function manufacturerPages(manufacturer: string, model: string): string[] {
  const name = normalize(manufacturer);
  const brand = BRAND_SITES.find((site) => site.names.some((candidate) => name === candidate || name.includes(candidate)));
  return brand ? brand.pages(model) : [];
}

function familySlug(model: string): string {
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
  if (name.includes("speedmaster")) return "speedmaster";
  if (name.includes("seamaster")) return "seamaster";
  if (name.includes("black bay")) return "black-bay";
  const drop = new Set(["date", "no", "professional", "moonwatch", "oyster", "the", "watch", "watches", "mm"]);
  const kept = tokens(model).filter((token) => !drop.has(token) && !/^\d+$/.test(token));
  return kept.join("-") || "watches";
}

async function discoverManufacturerPages(manufacturer: string, model: string, fetchImpl: typeof fetch): Promise<string[]> {
  const origin = await discoverBrandOrigin(manufacturer, fetchImpl);
  if (!origin) return [];
  const query = encodeURIComponent(model.trim());
  return [new URL(`/en/search?q=${query}`, origin).toString(), new URL(`/search?q=${query}`, origin).toString()];
}

async function discoverBrandOrigin(manufacturer: string, fetchImpl: typeof fetch): Promise<string | null> {
  const query = new URL("https://www.bing.com/search");
  query.searchParams.set("format", "rss");
  query.searchParams.set("q", `${manufacturer} official website`);
  const rss = await fetchText(query, fetchImpl);
  if (!rss) return null;
  const links = [...rss.matchAll(/<link>(https:[^<]+)<\/link>/g)].map((match) => match[1]);
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

async function readManufacturerPage(page: string, fetchImpl: typeof fetch): Promise<string | null> {
  let target: URL;
  try {
    target = new URL(page);
  } catch {
    return null;
  }
  if (target.protocol !== "https:") return null;
  const reader = new URL(`https://r.jina.ai/${target.toString()}`);
  return fetchText(reader, fetchImpl, 20_000);
}

function parseRolexGrid(text: string): RetailOffer[] {
  const pattern =
    /!\[([^\]]*)\]\((https:\/\/[^)\s]+\/m(\d{5,6}[a-z0-9]*)-\d{4})\)([\s\S]{0,700}?)##\s*([^\n]+)([\s\S]{0,280}?)\$([0-9,]+)\s*USD/g;
  const offers: RetailOffer[] = [];
  for (const match of text.matchAll(pattern)) {
    const priceCents = dollarsToCents(match[7]);
    if (priceCents == null) continue;
    const name = match[5].trim();
    const detail = match[6]
      .split("\n")
      .map((line) => line.replace(/\s+/g, " ").trim())
      .find((line) => line.length > 2 && !line.startsWith("$") && !line.startsWith("*") && !line.startsWith("["));
    const dial = match[1].match(/Dial\s*:\s*([^,\]]+)/i)?.[1]?.trim();
    offers.push({
      label: [name, detail, dial ? `Dial: ${dial}` : null].filter(Boolean).join(", "),
      reference: match[3].toUpperCase(),
      priceCents,
      imageUrl: match[2],
    });
  }
  return offers;
}

function parseNearbyPrices(text: string): RetailOffer[] {
  const offers: RetailOffer[] = [];
  const pattern = /\$([0-9]{1,3}(?:,[0-9]{3})+)(?:\s*USD)?/g;
  for (const match of text.matchAll(pattern)) {
    const priceCents = dollarsToCents(match[1]);
    if (priceCents == null || match.index == null) continue;
    const before = text.slice(Math.max(0, match.index - 700), match.index);
    const previousPrice = before.lastIndexOf("$");
    const slice = previousPrice >= 0 ? before.slice(previousPrice + 1) : before;
    if (/(?:under|over|to|from)\s*$/i.test(slice.trim())) continue;
    const lines = slice
      .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
      .replace(/\[[^\]]*\]\([^)]*\)/g, " ")
      .split("\n")
      .map((line) => line.replace(/^[#>*\s]+/, "").replace(/^\d+\.\s*/, "").replace(/\s+/g, " ").trim())
      .filter((line) => line.length > 2 && line.length < 160 && !/^https?:/i.test(line) && !line.includes("$"));
    const label = lines.slice(-3).join(", ");
    if (!label) continue;
    const reference = slice.match(/\b[mM]?\d{5,}[a-z0-9]*\b/g)?.at(-1) ?? null;
    offers.push({ label, reference: reference?.toUpperCase() ?? null, priceCents, imageUrl: null });
  }
  return offers;
}

function retailScore(offer: RetailOffer, model: string): number {
  const query = normalize(model);
  const label = normalize(`${offer.label} ${offer.reference ?? ""}`);
  const labelTokens = new Set(tokens(label));
  const wantsDate = tokens(model).includes("date") && !query.includes("no date");
  if (wantsDate && label.includes("no date")) return 0;
  let score = tokens(model).filter((token) => labelTokens.has(token)).length;
  if (score === 0) return 0;
  const mentions = (words: string[]) => words.some((word) => query.includes(word));
  if (mentions(["gold", "yellow", "rose", "everose", "platinum"])) {
    if (/\bgold\b|\bplatinum\b|\beverose\b/.test(label)) score += 3;
  } else if (/\bgold\b|\bplatinum\b|\beverose\b/.test(label)) {
    score -= 4;
  }
  if (!mentions(["rubber", "leather", "strap", "nato", "nylon", "fabric"]) && /\brubber\b|\bleather\b|\bnylon\b|\bfabric\b|\bstrap\b/.test(label)) {
    score -= 2;
  }
  if (mentions(["green", "starbucks", "kermit", "lv"])) {
    if (label.includes("lv")) score += 3;
  } else if (label.includes("126610lv")) {
    score -= 3;
  }
  return score;
}

export function parseMarkdownImages(text: string): ProductShot[] {
  const pattern = /!\[([^\]]*)\]\((https:\/\/[^)\s]+)\)/g;
  const matches = [...text.matchAll(pattern)];
  return matches.flatMap((match, index) => {
    const url = match[2];
    if (!usableImageUrl(url)) return [];
    const start = (match.index ?? 0) + match[0].length;
    const end = matches[index + 1]?.index ?? Math.min(text.length, start + 600);
    return [{ url, alt: match[1], caption: text.slice(start, end) }];
  });
}

export function chooseProductImage(shots: ProductShot[], manufacturer: string, model: string): string | null {
  const ranked = shots
    .map((shot) => ({ shot, score: imageScore(shot, manufacturer, model) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);
  return ranked[0]?.shot.url ?? null;
}

function imageScore(shot: ProductShot, manufacturer: string, model: string): number {
  const queryTokens = tokens(model);
  if (queryTokens.length === 0) return 0;
  const title = shotTitle(shot);
  const titleTokens = tokens(title);
  const hay = normalize(`${title} ${shot.alt} ${shot.url}`);
  const hits = queryTokens.filter((token) => hay.includes(token));
  const named = queryTokens.some((token) => titleTokens.includes(token) || normalize(shot.url).includes(token));
  if (hits.length === 0 || !named) return 0;
  const ignored = new Set([
    ...tokens(manufacturer),
    "watch",
    "watches",
    "ref",
    "the",
    "and",
    "with",
    "front",
    "view",
    "dial",
    "mm",
  ]);
  const extras = titleTokens.filter((token) => !queryTokens.includes(token) && !ignored.has(token));
  let score = hits.length * 10 - extras.length * 3;
  if (hits.length === queryTokens.length) score += 4;
  const blob = normalize(`${shot.alt} ${shot.url}`);
  if (blob.includes("front")) score += 3;
  if (/\b(back|wrist|wristshot|detail|menu|logo|icon|banner)\b/.test(blob)) score -= 5;
  const query = normalize(model);
  const mentions = (words: string[]) => words.some((word) => query.includes(word));
  if (!mentions(["gold", "yellow", "rose", "everose", "platinum"]) && /\bgold\b|\bplatinum\b|\beverose\b/.test(hay)) {
    score -= 4;
  }
  return score > 0 ? score : 0;
}

function shotTitle(shot: ProductShot): string {
  const link = shot.caption.match(/\[([^\]\n]+)\]\(https?:\/\//);
  if (link && !/^image\s+\d+/i.test(link[1])) return link[1];
  const heading = shot.caption.match(/#{2,3}\s+([^\n]+)/);
  if (heading) return heading[1];
  return shot.alt.replace(/^image\s+\d+\s*:\s*/i, "");
}

function usableImageUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  const host = parsed.hostname.toLowerCase();
  if (/(^|\.)bing\.com$|(^|\.)doubleclick\.net$|(^|\.)facebook\.com$|(^|\.)clarity\.ms$/.test(host)) return false;
  if (/\.(svg|gif)(\?|$)/i.test(parsed.pathname)) return false;
  return true;
}

function lookupNote(
  marketCents: number | null,
  retail: { priceCents: number; host: string; label: string; reference: string | null } | null,
  image: { source: "manufacturer" | "chrono24"; host: string | null } | null,
): string {
  const parts: string[] = [];
  if (image?.source === "manufacturer" && image.host) {
    parts.push(`Photo is from ${image.host}.`);
  } else if (image?.source === "chrono24") {
    parts.push("Photo is from a Chrono24 listing.");
  } else {
    parts.push("No product photo was listed on the manufacturer site, and Chrono24 blocks automated photo lookups.");
  }
  if (retail) {
    const reference = retail.reference ? ` (${retail.reference})` : "";
    parts.push(`New price is ${formatAsk(retail.priceCents)} on ${retail.host} for ${retail.label}${reference}.`);
  } else {
    parts.push("The manufacturer's site did not list a new US retail price.");
  }
  if (marketCents != null) {
    parts.push(
      `${formatAsk(marketCents)} is a dealer listing's ask, placed in the Chrono24 price because Chrono24 blocks automated price lookups. Check the link and replace it if the cheapest listing differs.`,
    );
  }
  return parts.join(" ");
}

async function lookupCatalog(manufacturer: string, model: string, fetchImpl: typeof fetch) {
  const searchUrl = new URL("/search/", CATALOG_ORIGIN);
  searchUrl.searchParams.set("q", `${manufacturer} ${model}`);
  const searchHtml = await fetchText(searchUrl, fetchImpl);
  if (!searchHtml) return null;
  const chosen = chooseListing(parseSearchCards(searchHtml), manufacturer, model);
  if (!chosen) return null;
  const listingUrl = catalogUrl(chosen.path);
  if (!listingUrl) return null;
  const detailHtml = await fetchText(listingUrl, fetchImpl);
  const product = detailHtml ? parseCatalogProduct(detailHtml) : null;
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

async function lookupWikipedia(manufacturer: string, model: string, fetchImpl: typeof fetch) {
  const url = new URL("https://en.wikipedia.org/w/api.php");
  url.searchParams.set("action", "query");
  url.searchParams.set("generator", "search");
  url.searchParams.set("gsrsearch", `${manufacturer} ${model}`);
  url.searchParams.set("gsrlimit", "5");
  url.searchParams.set("prop", "extracts");
  url.searchParams.set("exintro", "1");
  url.searchParams.set("explaintext", "1");
  url.searchParams.set("format", "json");
  const response = await fetchText(url, fetchImpl);
  if (!response) return null;
  let payload: { query?: { pages?: Record<string, WikiPage> } };
  try {
    payload = JSON.parse(response) as { query?: { pages?: Record<string, WikiPage> } };
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

async function fetchText(url: URL, fetchImpl: typeof fetch, timeoutMs = 15_000): Promise<string | null> {
  try {
    const response = await fetchImpl(url, {
      headers: {
        Accept: "text/html,application/json,text/plain",
        "Accept-Language": "en-US,en;q=0.9",
        "User-Agent": USER_AGENT,
      },
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  }
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
