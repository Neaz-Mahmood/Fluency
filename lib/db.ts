import "server-only";

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "@/lib/db/schema";

// Connection settings for a database URL (FLU-100).
// - Supabase's transaction pooler (port 6543) gives each transaction to whichever server
//   connection is free, so prepared statements can't be reused there.
// - DATABASE_POOL_MAX caps connections per process. Serverless functions set it to 1, because
//   every instance holds its own pool and the pooler's connection limit is shared.
export function connectionOptions(
  url: string,
  env: Record<string, string | undefined> = process.env,
) {
  const max = Number.parseInt(env.DATABASE_POOL_MAX ?? "", 10);
  return {
    max: Number.isInteger(max) && max > 0 ? max : 10,
    prepare: new URL(url).port !== "6543",
  };
}

export function createDb(url: string) {
  return drizzle(postgres(url, connectionOptions(url)), { schema });
}

export type Db = ReturnType<typeof createDb>;

// Reuse one connection pool across hot reloads in development.
const globalForDb = globalThis as typeof globalThis & { fluencyDb?: Db };

export function getDb(): Db {
  if (!globalForDb.fluencyDb) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error("DATABASE_URL is not set.");
    }
    globalForDb.fluencyDb = createDb(url);
  }
  return globalForDb.fluencyDb;
}
