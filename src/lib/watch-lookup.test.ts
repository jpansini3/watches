import assert from "node:assert/strict";
import test from "node:test";
import {
  chooseListing,
  complicationsFromText,
  lookupWatch,
  manufacturerPages,
  parseCatalogProduct,
  parseSearchCards,
  type ListingCard,
} from "./watch-lookup.ts";

const SEARCH_HTML = `
<a href="/watches/rolex-submariner-date-example/" style="display: block;">
  <div class="product_box catalog">
    <figure><img loading="lazy" src="https://cdn.swisswatchexpo.com/date.jpg" alt="Rolex"></figure>
    <h5>Rolex Submariner Date 126610LN</h5>
    <div class="info available"><span class="price"> <span class="price">$11,050</span></span></div>
  </div>
</a>
<a href="/watches/rolex-submariner-nodate/" style="display: block;">
  <div class="product_box catalog">
    <figure><img src="https://cdn.swisswatchexpo.com/nodate.jpg" alt="Rolex"></figure>
    <h5>Rolex Submariner No Date 14060</h5>
    <span class="price"><span class="price">$9,100</span></span>
  </div>
</a>
<a href="/watches/omega-speedmaster/" style="display: block;">
  <div class="product_box catalog">
    <figure><img src="https://cdn.swisswatchexpo.com/omega.jpg" alt="Omega"></figure>
    <h5>Omega Speedmaster Moonwatch</h5>
    <span class="price"><span class="price">$6,500</span></span>
  </div>
</a>
<a href="https://evil.example/watches/rolex-submariner-date/">
  <div class="product_box catalog">
    <img src="https://cdn.swisswatchexpo.com/evil.jpg">
    <h5>Rolex Submariner Date</h5>
    <span class="price">$1</span>
  </div>
</a>
`;

test("complications prefer the more specific calendar feature", () => {
  assert.deepEqual(
    complicationsFromText("Day-Date with a chronograph and a date window"),
    ["Day-date", "Chronograph"],
  );
  assert.deepEqual(complicationsFromText("Date calendar at 3 o'clock and a cyclops. Certified chronometer."), ["Date"]);
});

test("search cards keep on-site listings and the lowest full match", () => {
  const cards = parseSearchCards(SEARCH_HTML);
  assert.equal(cards.length, 3);
  const chosen = chooseListing(cards, "Rolex", "Submariner Date");
  assert.equal(chosen?.path, "/watches/rolex-submariner-date-example/");
  assert.equal(chosen?.priceCents, 1_105_000);
});

test("a broader model can use the cheaper sibling", () => {
  const cards = parseSearchCards(SEARCH_HTML);
  const chosen = chooseListing(cards, "rolex", "submariner");
  assert.equal(chosen?.priceCents, 910_000);
});

test("catalog product json supplies the photo, description, and ask", () => {
  const html = `
    <script type="application/ld&#x2B;json">
      {
        "@context": "https://schema.org",
        "@type": "Product",
        "name": "Rolex Submariner Date",
        "description": "Date calendar at the 3 o&#x27;clock aperture. Certified chronometer.",
        "image": ["https://cdn.swisswatchexpo.com/small_sm.jpg", "https://cdn.swisswatchexpo.com/large.jpg"],
        "brand": { "@type": "Brand", "name": "Rolex" },
        "offers": { "@type": "Offer", "price": "11050.00", "priceCurrency": "USD" }
      }
    </script>
  `;
  const product = parseCatalogProduct(html);
  assert.equal(product?.brand, "Rolex");
  assert.equal(product?.imageUrl, "https://cdn.swisswatchexpo.com/large.jpg");
  assert.equal(product?.priceCents, 1_105_000);
  assert.match(product?.description ?? "", /3 o'clock/);
});

test("brand pages stay on that manufacturer's families", () => {
  assert.equal(
    manufacturerPages("Tudor", "Black Bay GMT")[0],
    "https://www.tudorwatch.com/en/watches/black-bay",
  );
  assert.equal(
    manufacturerPages("Omega", "Speedmaster Moonwatch")[0],
    "https://www.omegawatches.com/en-us/watches/speedmaster",
  );
  assert.equal(
    manufacturerPages("Rolex", "GMT-Master II")[0],
    "https://www.rolex.com/en-us/watches/gmt-master-ii/all-models",
  );
});

const ROLEX_PAGE = `
<script type="application/ld+json">
{
  "@graph": [
    {
      "@type": "Product",
      "name": "Submariner Date",
      "sku": "126613LB",
      "material": "Oystersteel and yellow gold",
      "image": "https://media.rolex.com/m126613lb-front.jpg",
      "offers": { "price": "19450", "priceCurrency": "USD" }
    },
    {
      "@type": "Product",
      "name": "Submariner Date",
      "sku": "126610LN",
      "material": "Oystersteel",
      "image": "https://media.rolex.com/m126610ln-front.jpg",
      "offers": { "price": "11350", "priceCurrency": "USD" }
    },
    {
      "@type": "Product",
      "name": "Submariner Date",
      "sku": "126610LV",
      "material": "Oystersteel",
      "description": "Green bezel",
      "image": "https://media.rolex.com/m126610lv-front.jpg",
      "offers": { "price": "11900", "priceCurrency": "USD" }
    }
  ]
}
</script>
`;

test("a catalog ask is not stored as the Chrono24 price", async () => {
  const lookupHost = async () => [{ address: "93.184.216.34" }];
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    if (url.includes("swisswatchexpo.com/search")) return htmlResponse(SEARCH_HTML);
    if (url.includes("swisswatchexpo.com/watches/")) {
      return htmlResponse(`
        <script type="application/ld+json">
          { "@type": "Product", "name": "Rolex Submariner Date", "description": "Date calendar.", "brand": { "name": "Rolex" }, "offers": { "price": "11050.00" }, "image": ["https://cdn.swisswatchexpo.com/large.jpg"] }
        </script>
      `);
    }
    if (url.includes("rolex.com")) return htmlResponse(ROLEX_PAGE);
    return new Response("missing", { status: 404 });
  };
  const result = await lookupWatch("Rolex", "Submariner Date", fetchImpl, lookupHost);
  assert.equal(result.chrono24Price, null);
  assert.match(result.chrono24Url, /chrono24\.com/);
  assert.equal(result.retailPrice, "11350");
  assert.equal(result.referenceNumber, "126610LN");
  assert.equal(result.imageUrl, "https://media.rolex.com/m126610ln-front.jpg");
  assert.match(result.note, /search link/);
});

test("chooseListing ignores a brand that does not match", () => {
  const cards: ListingCard[] = [
    { path: "/watches/omega/", title: "Omega Speedmaster", imageUrl: null, priceCents: 100 },
  ];
  assert.equal(chooseListing(cards, "Rolex", "Submariner"), null);
});

function htmlResponse(html: string): Response {
  return new Response(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
}
