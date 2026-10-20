import "server-only";

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "@/lib/db/schema";

export function createDb(url: string) {
  return drizzle(postgres(url, { max: 10 }), { schema });
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
