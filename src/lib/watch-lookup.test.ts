import assert from "node:assert/strict";
import test from "node:test";
import {
  chooseListing,
  chooseRetailOffer,
  complicationsFromText,
  parseCatalogProduct,
  parseRetailOffers,
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

const ROLEX_GRID = `
![Image 2: Submariner Date, Oyster, 41 mm, Oystersteel and yellow gold, Dial : Black, Rolex](https://media.rolex.com/m126613lb-0002)## Submariner Date

Oyster, 41 mm, Oystersteel and yellow gold

$19,450 USD
![Image 3: Submariner Date, Oyster, 41 mm, Oystersteel, Dial : Black, Rolex](https://media.rolex.com/m126610ln-0001)## Submariner Date

Oyster, 41 mm, Oystersteel

$11,350 USD
![Image 4: Submariner Date, Oyster, 41 mm, Oystersteel, Dial : Black, Rolex](https://media.rolex.com/m126610lv-0002)## Submariner Date

Oyster, 41 mm, Oystersteel

$11,900 USD
![Image 5: Submariner, Oyster, 41 mm, Oystersteel, Dial : Black, Rolex](https://media.rolex.com/m124060-0001)## Submariner

Oyster, 41 mm, Oystersteel

$10,050 USD
`;

const OMEGA_LIST = `
Speedmaster Moonwatch Professional
42 mm, steel on rubber strap
$8,700
Speedmaster Moonwatch Professional
42 mm, steel on steel
$9,100
`;

test("manufacturer grid prefers the steel Submariner Date over gold, green, and no-date", () => {
  const offers = parseRetailOffers(ROLEX_GRID);
  const chosen = chooseRetailOffer(offers, "Submariner Date");
  assert.equal(chosen?.priceCents, 1_135_000);
  assert.equal(chosen?.reference, "126610LN");
});

test("a green Submariner Date prefers the LV reference", () => {
  const chosen = chooseRetailOffer(parseRetailOffers(ROLEX_GRID), "Submariner Date green");
  assert.equal(chosen?.reference, "126610LV");
});

test("nearby prices prefer a steel bracelet when the model does not ask for a strap", () => {
  const chosen = chooseRetailOffer(parseRetailOffers(OMEGA_LIST), "Speedmaster");
  assert.equal(chosen?.priceCents, 910_000);
});

test("chooseListing ignores a brand that does not match", () => {
  const cards: ListingCard[] = [
    { path: "/watches/omega/", title: "Omega Speedmaster", imageUrl: null, priceCents: 100 },
  ];
  assert.equal(chooseListing(cards, "Rolex", "Submariner"), null);
});
