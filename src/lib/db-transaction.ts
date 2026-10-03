import { db, dbReady } from "@/lib/db";

/** Drizzle transaction client. postgres.js reserves the connection for the callback. */
export type DbTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function withDbTransaction<T>(fn: (tx: DbTx) => Promise<T>): Promise<T> {
  await dbReady;
  return db.transaction(fn);
}
