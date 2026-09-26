import { dbReady, sql } from "@/lib/db";

/** Run work inside a single transaction on the shared Postgres connection. */
export async function withDbTransaction<T>(fn: () => Promise<T>): Promise<T> {
  await dbReady;
  await sql`BEGIN`;
  try {
    const result = await fn();
    await sql`COMMIT`;
    return result;
  } catch (error) {
    try {
      await sql`ROLLBACK`;
    } catch {
      // Connection may already be rolled back.
    }
    throw error;
  }
}
