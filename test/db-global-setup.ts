import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { TEST_DATABASE_URL } from "./db-url";

// Creates the test database if needed and applies every migration in drizzle/.
export default async function setup() {
  const url = new URL(TEST_DATABASE_URL);
  const name = url.pathname.slice(1);
  if (!/^[a-z0-9_]+$/.test(name)) {
    throw new Error(`Unexpected test database name: ${name}`);
  }

  const admin = postgres({ ...connection(url), database: "postgres", max: 1, onnotice: () => {} });
  try {
    const [existing] = await admin`SELECT 1 FROM pg_database WHERE datname = ${name}`;
    if (!existing) {
      await admin.unsafe(`CREATE DATABASE "${name}"`);
    }
  } catch (error) {
    throw new Error(
      `Can't reach Postgres at ${url.host}. Start it with \`pnpm db:up\`.\n${String(error)}`,
    );
  } finally {
    await admin.end();
  }

  const client = postgres(TEST_DATABASE_URL, { max: 1, onnotice: () => {} });
  try {
    await migrate(drizzle(client), { migrationsFolder: "./drizzle" });
  } finally {
    await client.end();
  }
}

function connection(url: URL) {
  return {
    host: url.hostname,
    port: Number(url.port || 5432),
    username: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
  };
}
