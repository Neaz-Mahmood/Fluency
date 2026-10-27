import { describe, expect, it } from "vitest";

import { connectionOptions } from "@/lib/db";

const SESSION_POOLER =
  "postgresql://u.ref:p%40ss@aws-0-ap-south-1.pooler.supabase.com:5432/postgres";
const TRANSACTION_POOLER =
  "postgresql://u.ref:p%40ss@aws-0-ap-south-1.pooler.supabase.com:6543/postgres";

describe("connectionOptions", () => {
  it("keeps prepared statements and 10 connections by default", () => {
    expect(connectionOptions(SESSION_POOLER, {})).toEqual({ max: 10, prepare: true });
    expect(connectionOptions("postgres://fluency:fluency@localhost/fluency", {})).toEqual({
      max: 10,
      prepare: true,
    });
  });

  it("turns prepared statements off on the transaction pooler", () => {
    expect(connectionOptions(TRANSACTION_POOLER, {}).prepare).toBe(false);
  });

  it("takes the pool size from DATABASE_POOL_MAX, ignoring bad values", () => {
    expect(connectionOptions(TRANSACTION_POOLER, { DATABASE_POOL_MAX: "1" }).max).toBe(1);
    expect(connectionOptions(SESSION_POOLER, { DATABASE_POOL_MAX: "0" }).max).toBe(10);
    expect(connectionOptions(SESSION_POOLER, { DATABASE_POOL_MAX: "many" }).max).toBe(10);
  });
});
