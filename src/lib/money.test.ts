import assert from "node:assert/strict";
import test from "node:test";
import {
  centsToDollarsInput,
  chartSeries,
  formatMoney,
  latestPriceAction,
  latestPriceCents,
  parseIsoDate,
  parseMoneyToCents,
  type PriceRow,
} from "./money.ts";

test("parseMoneyToCents accepts dollars and currency text", () => {
  assert.equal(parseMoneyToCents("12500"), 1_250_000);
  assert.equal(parseMoneyToCents("$12,500.50"), 1_250_050);
  assert.equal(parseMoneyToCents(99.9), 9990);
  assert.equal(parseMoneyToCents(""), null);
  assert.equal(parseMoneyToCents(null), null);
  assert.equal(parseMoneyToCents("30000000"), 3_000_000_000);
});

test("parseMoneyToCents rejects junk", () => {
  assert.throws(() => parseMoneyToCents("-5"), /price/i);
  assert.throws(() => parseMoneyToCents("12.345"), /price/i);
  assert.throws(() => parseMoneyToCents("free"), /price/i);
});

test("parseIsoDate checks calendar dates", () => {
  assert.equal(parseIsoDate("2026-09-26"), "2026-09-26");
  assert.equal(parseIsoDate("", "2026-01-01"), "2026-01-01");
  assert.throws(() => parseIsoDate("2026-02-31"), /date/i);
});

test("latest price is the newest day, then the highest id", () => {
  const prices: PriceRow[] = [
    { id: 1, source: "retail", amountCents: 100, recordedOn: "2026-01-01" },
    { id: 2, source: "retail", amountCents: 200, recordedOn: "2026-02-01" },
    { id: 3, source: "retail", amountCents: 250, recordedOn: "2026-02-01" },
    { id: 4, source: "chrono24", amountCents: 180, recordedOn: "2026-03-01" },
  ];
  assert.equal(latestPriceCents(prices, "retail"), 250);
  assert.equal(latestPriceCents(prices, "chrono24"), 180);
  assert.equal(latestPriceCents([], "retail"), null);
});

test("editing the current price updates today or appends a later day", () => {
  const prices: PriceRow[] = [
    { id: 1, source: "retail", amountCents: 100_00, recordedOn: "2026-09-01" },
    { id: 2, source: "chrono24", amountCents: 90_00, recordedOn: "2026-09-26" },
  ];
  assert.deepEqual(latestPriceAction(prices, "retail", 100_00, "2026-09-26"), { type: "keep" });
  assert.deepEqual(latestPriceAction(prices, "retail", 110_00, "2026-09-26"), {
    type: "insert",
    amountCents: 110_00,
    recordedOn: "2026-09-26",
  });
  assert.deepEqual(latestPriceAction(prices, "chrono24", 80_00, "2026-09-26"), {
    type: "update",
    id: 2,
    amountCents: 80_00,
  });
  assert.deepEqual(latestPriceAction(prices, "retail", null, "2026-09-26"), { type: "delete", id: 1 });
  assert.deepEqual(latestPriceAction([], "retail", null, "2026-09-26"), { type: "keep" });
  assert.equal(centsToDollarsInput(1_250_000), "12500");
  assert.equal(centsToDollarsInput(1_250_050), "12500.50");
  assert.equal(centsToDollarsInput(null), "");
});

test("chart series keeps the latest quote per day", () => {
  const prices: PriceRow[] = [
    { id: 1, source: "chrono24", amountCents: 900, recordedOn: "2026-01-02" },
    { id: 2, source: "chrono24", amountCents: 800, recordedOn: "2026-01-02" },
    { id: 3, source: "chrono24", amountCents: 850, recordedOn: "2026-02-01" },
    { id: 4, source: "retail", amountCents: 1000, recordedOn: "2026-01-02" },
  ];
  assert.deepEqual(chartSeries(prices, "chrono24"), [
    { date: "2026-01-02", cents: 800 },
    { date: "2026-02-01", cents: 850 },
  ]);
  assert.equal(formatMoney(800), "$8.00");
});
