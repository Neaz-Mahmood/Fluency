// Separate from the dev database so tests never touch real data.
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://fluency:fluency@localhost:5432/fluency_test";
