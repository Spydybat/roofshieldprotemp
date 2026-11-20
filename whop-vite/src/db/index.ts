import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

/**
 * Optional PostgreSQL connection (lazy, build-safe, NO fake in-memory storage).
 *
 * - When DATABASE_URL is unset, `getOptionalDb()` returns `null` without
 *   throwing at module import time (so production builds never crash), and
 *   callers persist directly through verified Whop APIs instead.
 * - When DATABASE_URL is set, `getOptionalDb()` returns a real Drizzle + pg
 *   Pool instance for full PostgreSQL auditing alongside Whop.
 */

const globalForDb = globalThis as typeof globalThis & {
  __roofshieldPgPool?: Pool | null;
  __roofshieldPgUrl?: string;
  __roofshieldDrizzle?: NodePgDatabase | null;
};

export function isDatabaseConfigured(): boolean {
  return !!process.env.DATABASE_URL?.trim();
}

export function getOptionalDb(): NodePgDatabase | null {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    return null;
  }

  if (globalForDb.__roofshieldDrizzle && globalForDb.__roofshieldPgUrl === databaseUrl) {
    return globalForDb.__roofshieldDrizzle;
  }

  const pool = new Pool({ connectionString: databaseUrl });
  const instance = drizzle(pool);
  globalForDb.__roofshieldPgPool = pool;
  globalForDb.__roofshieldPgUrl = databaseUrl;
  globalForDb.__roofshieldDrizzle = instance;
  return instance;
}
