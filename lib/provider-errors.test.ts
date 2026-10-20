import { describe, expect, it } from "vitest";

import {
  kindForStatus,
  ProviderError,
  providerErrorResponse,
  toProviderError,
} from "@/lib/provider-errors";

describe("kindForStatus", () => {
  it.each([
    [429, "busy"],
    [503, "busy"],
    [529, "busy"],
    [408, "timeout"],
    [504, "timeout"],
    [400, "failed"],
    [401, "failed"],
    [500, "failed"],
  ] as const)("maps HTTP %i to %s", (status, kind) => {
    expect(kindForStatus(status)).toEqual(kind);
  });
});

describe("toProviderError", () => {
  it("returns a ProviderError unchanged", () => {
    const error = new ProviderError("failed", "nope", { status: 500 });
    expect(error.name).toEqual("ProviderError");
    expect(toProviderError(error)).toBe(error);
  });

  it("maps an error with a numeric status", () => {
    const error = Object.assign(new Error("overloaded"), { status: 529 });
    const mapped = toProviderError(error);
    expect(mapped.kind).toEqual("busy");
    expect(mapped.status).toEqual(529);
    expect(mapped.message).toEqual("overloaded");
    expect(mapped.cause).toBe(error);
  });

  it("maps TimeoutError to timeout", () => {
    const error = new Error("timed out");
    error.name = "TimeoutError";
    const mapped = toProviderError(error);
    expect(mapped.kind).toEqual("timeout");
    expect(mapped.message).toEqual("timed out");
    expect(mapped.cause).toBe(error);
  });

  it("maps a TimeoutError DOMException to timeout", () => {
    const error = new DOMException("timed out", "TimeoutError");
    expect(toProviderError(error).kind).toEqual("timeout");
  });

  it("maps a plain Error to failed and keeps the message and cause", () => {
    const error = new Error("boom");
    const mapped = toProviderError(error);
    expect(mapped.kind).toEqual("failed");
    expect(mapped.message).toEqual("boom");
    expect(mapped.cause).toBe(error);
  });

  it("maps a thrown string to failed", () => {
    const mapped = toProviderError("nope");
    expect(mapped.kind).toEqual("failed");
    expect(mapped.cause).toEqual("nope");
  });
});

describe("providerErrorResponse", () => {
  it.each([
    ["busy", 503, "The AI partner is busy right now. Try again in a moment."],
    ["timeout", 504, "The AI partner took too long to answer. Try again."],
    ["failed", 502, "The AI partner could not reply. Try again."],
  ] as const)("describes %s as HTTP %i", (kind, status, message) => {
    expect(providerErrorResponse(new ProviderError(kind, "internal"))).toEqual({
      status,
      message,
    });
  });
});
