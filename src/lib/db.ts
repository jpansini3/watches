import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import fs from "fs";
import os from "os";
import path from "path";
import postgres from "postgres";

const isBuild = process.env.NEXT_PHASE === "phase-production-build";
const MIGRATION_LOCK = 87423041;

function resolveDatabaseUrl(): string {
  if (isBuild) {
    return "postgres://127.0.0.1:1/build";
  }
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    throw new Error(
      "DATABASE_URL is required (shared Homebrew Postgres on 127.0.0.1:5432, then set it in .env.local)",
    );
  }
  return url;
}

function resolveUploadsPath(): string {
  if (isBuild) {
    return path.join(os.tmpdir(), `watches-uploads-build-${process.pid}`);
  }
  const fromEnv = process.env.UPLOADS_PATH?.trim();
  if (fromEnv) {
    return path.isAbsolute(fromEnv) ? fromEnv : path.resolve(process.cwd(), fromEnv);
  }
  return path.join(process.cwd(), "uploads");
}

const uploadsPath = resolveUploadsPath();
fs.mkdirSync(uploadsPath, { recursive: true });

const sql = postgres(resolveDatabaseUrl(), {
  max: 10,
  idle_timeout: 20,
  connect_timeout: isBuild ? 1 : 30,
});

export const db = drizzle({ client: sql });

/**
 * Migrations take their own connection. An advisory lock is session-scoped, so
 * the lock, the migration queries, and the unlock have to share that session.
 */
async function applyMigrations() {
  const migrationSql = postgres(resolveDatabaseUrl(), {
    max: 1,
    connect_timeout: 30,
  });
  const migrationDb = drizzle({ client: migrationSql });
  await migrationSql`SELECT pg_advisory_lock(${MIGRATION_LOCK})`;
  try {
    await migrate(migrationDb, {
      migrationsFolder: path.join(process.cwd(), "drizzle", "migrations"),
    });
  } finally {
    try {
      await migrationSql`SELECT pg_advisory_unlock(${MIGRATION_LOCK})`;
    } finally {
      await migrationSql.end({ timeout: 5 });
    }
  }
}

export const dbReady: Promise<void> = isBuild
  ? Promise.resolve()
  : applyMigrations().catch((err) => {
      console.error("[db] migration failed:", err);
      throw err;
    });

export function getUploadsPath() {
  return uploadsPath;
}
