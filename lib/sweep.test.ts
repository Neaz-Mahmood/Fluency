import { describe, expect, it } from "vitest";

import { cronAuthorization } from "@/lib/sweep";

describe("cronAuthorization", () => {
  it("returns disabled when the secret is missing or empty", () => {
    expect(cronAuthorization("Bearer token", undefined)).toBe("disabled");
    expect(cronAuthorization("Bearer token", "")).toBe("disabled");
  });

  it("returns unauthorized when the header is missing, wrong, or of different length", () => {
    expect(cronAuthorization(null, "secret123")).toBe("unauthorized");
    expect(cronAuthorization("Bearer wrongsecret", "secret123")).toBe("unauthorized");
    expect(cronAuthorization("Bearer short", "secret123")).toBe("unauthorized");
    expect(cronAuthorization("Bearer secret123toolong", "secret123")).toBe("unauthorized");
    expect(cronAuthorization("Basic secret123", "secret123")).toBe("unauthorized");
  });

  it("returns ok for the exact bearer token", () => {
    expect(cronAuthorization("Bearer secret123", "secret123")).toBe("ok");
  });
});
