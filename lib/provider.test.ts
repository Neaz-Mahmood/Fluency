import { describe, expect, it } from "vitest";

import { resolveProvider } from "@/lib/provider";

describe("resolveProvider", () => {
  it("uses the only key that is set", () => {
    expect(resolveProvider({ CLAUDE_API_KEY: "c" })).toEqual({ provider: "claude", apiKey: "c" });
    expect(resolveProvider({ GOOGLE_API_KEY: "g" })).toEqual({ provider: "google", apiKey: "g" });
  });

  it("accepts the alternate key names", () => {
    expect(resolveProvider({ ANTHROPIC_API_KEY: "a" })).toEqual({
      provider: "claude",
      apiKey: "a",
    });
    expect(resolveProvider({ GEMINI_API_KEY: "m" })).toEqual({ provider: "google", apiKey: "m" });
  });

  it("prefers CLAUDE_API_KEY over ANTHROPIC_API_KEY and GOOGLE_API_KEY over GEMINI_API_KEY", () => {
    expect(resolveProvider({ CLAUDE_API_KEY: "c", ANTHROPIC_API_KEY: "a" })).toEqual({
      provider: "claude",
      apiKey: "c",
    });
    expect(resolveProvider({ GOOGLE_API_KEY: "g", GEMINI_API_KEY: "m" })).toEqual({
      provider: "google",
      apiKey: "g",
    });
  });

  it("trims keys and treats blank keys as unset", () => {
    expect(resolveProvider({ CLAUDE_API_KEY: "  c  " })).toEqual({
      provider: "claude",
      apiKey: "c",
    });
    expect(resolveProvider({ CLAUDE_API_KEY: "   ", GOOGLE_API_KEY: "g" })).toEqual({
      provider: "google",
      apiKey: "g",
    });
  });

  it("follows AI_PROVIDER when both keys are set, ignoring case and spaces", () => {
    const env = { CLAUDE_API_KEY: "c", GOOGLE_API_KEY: "g" };
    expect(resolveProvider({ ...env, AI_PROVIDER: "claude" })).toEqual({
      provider: "claude",
      apiKey: "c",
    });
    expect(resolveProvider({ ...env, AI_PROVIDER: " Google " })).toEqual({
      provider: "google",
      apiKey: "g",
    });
  });

  it("rejects an unknown AI_PROVIDER", () => {
    expect(resolveProvider({ AI_PROVIDER: "openai", CLAUDE_API_KEY: "c" })).toEqual({
      error: "AI_PROVIDER must be claude or google.",
    });
  });

  it("rejects AI_PROVIDER when its key is missing", () => {
    expect(resolveProvider({ AI_PROVIDER: "claude", GOOGLE_API_KEY: "g" })).toEqual({
      error: "AI_PROVIDER is claude, but CLAUDE_API_KEY is not set.",
    });
    expect(resolveProvider({ AI_PROVIDER: "google", CLAUDE_API_KEY: "c" })).toEqual({
      error: "AI_PROVIDER is google, but GOOGLE_API_KEY is not set.",
    });
  });

  it("asks to disambiguate when both keys are set without AI_PROVIDER", () => {
    expect(resolveProvider({ CLAUDE_API_KEY: "c", GOOGLE_API_KEY: "g" })).toEqual({
      error: "Both CLAUDE_API_KEY and GOOGLE_API_KEY are set. Set AI_PROVIDER to claude or google.",
    });
  });

  it("errors when no key is set", () => {
    expect(resolveProvider({})).toEqual({ error: "Set CLAUDE_API_KEY or GOOGLE_API_KEY." });
  });
});
