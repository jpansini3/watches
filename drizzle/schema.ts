import { sql } from "drizzle-orm";
import { bigint, index, integer, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";

export const priceSources = ["retail", "chrono24"] as const;
export type PriceSource = (typeof priceSources)[number];

function idColumn() {
  return integer("id").primaryKey().generatedByDefaultAsIdentity();
}

export const manufacturers = pgTable(
  "manufacturers",
  {
    id: idColumn(),
    name: text("name").notNull(),
  },
  (table) => [uniqueIndex("manufacturers_name_lower_idx").on(sql`lower(${table.name})`)],
);

export const watches = pgTable("watches", {
  id: idColumn(),
  manufacturerId: integer("manufacturer_id")
    .notNull()
    .references(() => manufacturers.id),
  model: text("model").notNull(),
  referenceNumber: text("reference_number"),
  imageUrl: text("image_url"),
  pageUrl: text("page_url"),
  chrono24Url: text("chrono24_url"),
});

export const complications = pgTable(
  "complications",
  {
    id: idColumn(),
    watchId: integer("watch_id")
      .notNull()
      .references(() => watches.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    rank: integer("rank").notNull().default(0),
  },
  (table) => [index("complications_watch_id_idx").on(table.watchId)],
);

export const pricePoints = pgTable(
  "price_points",
  {
    id: idColumn(),
    watchId: integer("watch_id")
      .notNull()
      .references(() => watches.id, { onDelete: "cascade" }),
    source: text("source", { enum: priceSources }).notNull(),
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    recordedOn: text("recorded_on").notNull(),
  },
  (table) => [index("price_points_watch_id_idx").on(table.watchId)],
);

export type Manufacturer = typeof manufacturers.$inferSelect;
export type Watch = typeof watches.$inferSelect;
export type Complication = typeof complications.$inferSelect;
export type PricePoint = typeof pricePoints.$inferSelect;
