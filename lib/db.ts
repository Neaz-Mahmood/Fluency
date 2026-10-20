import "server-only";

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "@/lib/db/schema";

function createDb() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set.");
  }
  return drizzle(postgres(url, { max: 10 }), { schema });
}

type Db = ReturnType<typeof createDb>;

// Reuse one connection pool across hot reloads in development.
const globalForDb = globalThis as typeof globalThis & { fluencyDb?: Db };

export function getDb(): Db {
  globalForDb.fluencyDb ??= createDb();
  return globalForDb.fluencyDb;
}
