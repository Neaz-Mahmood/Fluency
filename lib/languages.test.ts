import { describe, expect, it } from "vitest";

import { isNativeLanguage, nativeLanguageName } from "@/lib/languages";

describe("isNativeLanguage", () => {
  it("recognizes supported native languages", () => {
    expect(isNativeLanguage("bn-BD")).toBe(true);
  });

  it("rejects unsupported languages and non-strings", () => {
    expect(isNativeLanguage("es-MX")).toBe(false);
    expect(isNativeLanguage("en-US")).toBe(false);
    expect(isNativeLanguage(null)).toBe(false);
    expect(isNativeLanguage(undefined)).toBe(false);
  });
});

describe("nativeLanguageName", () => {
  it("returns the English name for supported native languages", () => {
    expect(nativeLanguageName("bn-BD")).toBe("Bangla");
  });

  it("returns null when unknown or unset", () => {
    expect(nativeLanguageName(null)).toBe(null);
    expect(nativeLanguageName(undefined)).toBe(null);
    expect(nativeLanguageName("es-MX")).toBe(null);
  });
});
