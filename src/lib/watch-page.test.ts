import assert from "node:assert/strict";
import test from "node:test";
import { lookupProductPage, parseProductPage } from "./watch-page.ts";

const NOMOS_URL = "https://nomos-glashuette.com/en-us/tangente/tangente-sport-neomatik-42-date-580";

const NOMOS_HTML = `
<meta property="og:site_name" content="NOMOS Glashütte">
<meta property="og:title" content="Tangente Sport neomatik 42 date – NOMOS Glashütte | US Store">
<meta property="og:image" content="https://cdn.nomos-glashuette.com/img/logo.png">
<script type="application/ld+json">
{ "@context": "https://schema.org", "@type": "Organization", "name": "NOMOS Glashütte" }
</script>
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Product",
  "url": "${NOMOS_URL}",
  "name": "Tangente Sport neomatik 42 date",
  "sku": "580",
  "mpn": "580",
  "gtin13": "4037525005803",
  "brand": { "@type": "Brand", "name": "NOMOS Glashütte" },
  "description": "Water resistant to 1000 ft, with an extra-large date and the neomatik date caliber.",
  "material": "stainless steel",
  "size": "42.0 mm",
  "image": [
    "https://cdn.nomos-glashuette.com/img/0580-wristshot.jpg",
    "https://cdn.nomos-glashuette.com/img/0580-front-masked.png",
    "https://cdn.nomos-glashuette.com/img/logo.svg"
  ],
  "additionalProperty": [
    { "@type": "PropertyValue", "name": "Caliber", "value": "DUW 6101" },
    { "@type": "PropertyValue", "name": "Power reserve", "value": "up to 42 hours" }
  ],
  "offers": { "@type": "Offer", "price": 5900, "priceCurrency": "USD" }
}
</script>
`;

test("product json supplies the name, photo, usd price, and features", () => {
  const product = parseProductPage(NOMOS_HTML, NOMOS_URL);
  assert.equal(product?.manufacturer, "NOMOS Glashütte");
  assert.equal(product?.model, "Tangente Sport neomatik 42 date");
  assert.equal(product?.reference, "580");
  assert.equal(product?.priceCents, 5_900_00);
  assert.equal(product?.currency, "USD");
  assert.equal(product?.imageUrl, "https://cdn.nomos-glashuette.com/img/0580-front-masked.png");
  assert.equal(product?.material, "stainless steel");
  assert.equal(product?.size, "42.0 mm");
  assert.deepEqual(product?.complications, ["Power reserve", "Date"]);
});

test("a graph and a matching url beat a sibling variant", () => {
  const html = `
    <script type="application/ld+json">
    {
      "@graph": [
        {
          "@type": "Product",
          "name": "Tangente Sport neomatik 42 date marine black",
          "url": "https://brand.example/en-us/tangente-581",
          "sku": "581",
          "brand": "Example",
          "offers": { "price": "6100.00", "priceCurrency": "USD" },
          "image": "https://cdn.example/581-front.jpg"
        },
        {
          "@type": ["Product"],
          "name": "Tangente Sport neomatik 42 date",
          "url": "https://brand.example/en-us/tangente-580?utm=1",
          "sku": "580",
          "brand": { "name": "Example" },
          "offers": { "price": "5,900.00", "priceCurrency": "USD" },
          "image": [{ "url": "https://cdn.example/580-front.jpg" }]
        }
      ]
    }
    </script>
  `;
  const product = parseProductPage(html, "https://www.brand.example/en-us/tangente-580");
  assert.equal(product?.model, "Tangente Sport neomatik 42 date");
  assert.equal(product?.reference, "580");
  assert.equal(product?.priceCents, 5_900_00);
  assert.equal(product?.imageUrl, "https://cdn.example/580-front.jpg");
});

test("open graph product tags fill a page without json-ld", () => {
  const html = `
    <meta property="og:site_name" content="Habring² | Official">
    <meta property="og:title" content="Felix | Habring²">
    <meta property="product:brand" content="Habring²">
    <meta property="product:price:amount" content="5.900,00">
    <meta property="product:price:currency" content="EUR">
    <meta property="og:description" content="A manual wind chronograph.">
    <meta property="og:image" content="/photos/felix-front.jpg">
  `;
  const product = parseProductPage(html, "https://habring2.com/en/felix");
  assert.equal(product?.manufacturer, "Habring²");
  assert.equal(product?.model, "Felix");
  assert.equal(product?.currency, "EUR");
  assert.equal(product?.priceCents, 5_900_00);
  assert.equal(product?.imageUrl, "https://habring2.com/photos/felix-front.jpg");
  assert.deepEqual(product?.complications, ["Chronograph"]);
});

test("microdata fills a page that only has itemprops", () => {
  const html = `
    <div itemscope itemtype="https://schema.org/Product">
      <span itemprop="brand">Baltic</span>
      <span itemprop="name">HMS 002</span>
      <img itemprop="image" src="https://cdn.baltic.example/hms-front.jpg">
      <meta itemprop="price" content="620">
      <meta itemprop="priceCurrency" content="USD">
      <span itemprop="sku">HMS-002</span>
      <p itemprop="description">Bicolor dial with a date window.</p>
    </div>
  `;
  const product = parseProductPage(html, "https://baltic-watches.com/us/hms-002");
  assert.equal(product?.manufacturer, "Baltic");
  assert.equal(product?.model, "HMS 002");
  assert.equal(product?.reference, "HMS-002");
  assert.equal(product?.priceCents, 62_000);
  assert.equal(product?.currency, "USD");
  assert.equal(product?.imageUrl, "https://cdn.baltic.example/hms-front.jpg");
  assert.deepEqual(product?.complications, ["Date"]);
});

test("encoded json-ld and an aggregate offer still yield a price", () => {
  const html = `
    <script type="application/ld+json">
    {
      "@type": "Product",
      "name": "Khaki Field &quot;Mechanical&quot;",
      "brand": { "name": "Hamilton" },
      "offers": { "@type": "AggregateOffer", "lowPrice": "595.00", "priceCurrency": "USD" }
    }
    </script>
  `;
  const product = parseProductPage(html, "https://shop.example/en-us/khaki");
  assert.equal(product?.manufacturer, "Hamilton");
  assert.equal(product?.model, 'Khaki Field "Mechanical"');
  assert.equal(product?.priceCents, 59_500);
});

test("a us page without a currency treats the price as dollars", () => {
  const html = `
    <meta property="og:title" content="Railmaster">
    <meta property="product:brand" content="Omega">
    <meta property="product:price:amount" content="8200">
    <meta property="og:image" content="https://cdn.example/railmaster-front.jpg">
  `;
  const product = parseProductPage(html, "https://shop.example/en-us/railmaster");
  assert.equal(product?.currency, "USD");
  assert.equal(product?.priceCents, 820_000);
});

test("lookup keeps a foreign price out of the dollar field", async () => {
  const html = `
    <meta property="og:title" content="Club Campus">
    <meta property="product:brand" content="Nomos">
    <meta property="product:price:amount" content="1500">
    <meta property="product:price:currency" content="EUR">
    <meta property="og:image" content="https://cdn.example/club-front.jpg">
  `;
  const result = await lookupProductPage("https://shop.example/en/club", async () => htmlResponse(html), async () => [
    { address: "93.184.216.34" },
  ]);
  assert.equal(result.manufacturer, "Nomos");
  assert.equal(result.model, "Club Campus");
  assert.equal(result.retailPrice, null);
  assert.match(result.note, /EUR/);
  assert.match(result.note, /shop\.example/);
  assert.match(result.chrono24Url, /Club\+Campus|Club%20Campus/);
});

test("lookup reads a usd product page", async () => {
  const result = await lookupProductPage(NOMOS_URL, async () => htmlResponse(NOMOS_HTML), async () => [
    { address: "93.184.216.34" },
  ]);
  assert.equal(result.manufacturer, "NOMOS Glashütte");
  assert.equal(result.model, "Tangente Sport neomatik 42 date 580");
  assert.equal(result.retailPrice, "5900");
  assert.equal(result.chrono24Price, null);
  assert.match(result.note, /Reference 580/);
  assert.match(result.complications, /Date/);
});

test("lookup refuses local, credentialed, and non-https urls before fetching", async () => {
  const fetched: string[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    fetched.push(String(input));
    return htmlResponse("<title>nope</title>");
  };
  await assert.rejects(() => lookupProductPage("http://shop.example/watch", fetchImpl), /https/);
  await assert.rejects(() => lookupProductPage("https://user:pass@shop.example/watch", fetchImpl), /can't be fetched/);
  await assert.rejects(() => lookupProductPage("https://127.0.0.1/watch", fetchImpl), /can't be fetched/);
  await assert.rejects(() => lookupProductPage("https://localhost/watch", fetchImpl), /can't be fetched/);
  await assert.rejects(() => lookupProductPage("https://169.254.169.254/latest", fetchImpl), /can't be fetched/);
  await assert.rejects(
    () => lookupProductPage("https://rebind.example/watch", fetchImpl, async () => [{ address: "10.1.2.3" }]),
    /can't be fetched/,
  );
  assert.deepEqual(fetched, []);
});

test("lookup does not follow a redirect to a private address", async () => {
  let calls = 0;
  await assert.rejects(
    () =>
      lookupProductPage(
        "https://shop.example/go",
        async () => {
          calls += 1;
          return new Response(null, { status: 302, headers: { location: "https://127.0.0.1/secret" } });
        },
        async () => [{ address: "93.184.216.34" }],
      ),
    /can't be fetched/,
  );
  assert.equal(calls, 1);
});

test("lookup reports a refused manufacturer page", async () => {
  await assert.rejects(
    () =>
      lookupProductPage(
        "https://shop.example/watch",
        async () => new Response("no", { status: 403 }),
        async () => [{ address: "93.184.216.34" }],
      ),
    /refused an automated request/,
  );
});

function htmlResponse(html: string): Response {
  return new Response(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
}
