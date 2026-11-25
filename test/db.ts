import { sql } from "drizzle-orm";

import { createDb, type Db } from "@/lib/db";

import { TEST_DATABASE_URL } from "./db-url";

export function createTestDb(): Db {
  return createDb(TEST_DATABASE_URL);
}

// Every learner table cascades from learner_profiles.
export async function resetTestDb(db: Db): Promise<void> {
  await db.execute(sql`TRUNCATE learner_profiles CASCADE`);
}
