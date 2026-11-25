import { describe, expect, it } from "vitest";

import {
  AZURE_TO_CATALOG,
  BN_EN_PRONUNCIATION_PATTERNS,
  catalogCodeFor,
  findPattern,
} from "@/lib/pronunciation-patterns";

describe("BN_EN_PRONUNCIATION_PATTERNS", () => {
  it("contains exactly 16 patterns", () => {
    expect(BN_EN_PRONUNCIATION_PATTERNS).toHaveLength(16);
  });

  it("has unique codes, each at most 64 characters", () => {
    const codes = BN_EN_PRONUNCIATION_PATTERNS.map((p) => p.code);
    const uniqueCodes = new Set(codes);
    expect(uniqueCodes.size).toBe(codes.length);

    for (const pattern of BN_EN_PRONUNCIATION_PATTERNS) {
      expect(pattern.code.length).toBeGreaterThan(0);
      expect(pattern.code.length).toBeLessThanOrEqual(64);
    }
  });

  it("prefixes every code with IPA: or PROSODY:, matching its kind", () => {
    for (const pattern of BN_EN_PRONUNCIATION_PATTERNS) {
      if (pattern.kind === "phoneme") {
        expect(pattern.code.startsWith("IPA:")).toBe(true);
      } else if (pattern.kind === "prosody") {
        expect(pattern.code.startsWith("PROSODY:")).toBe(true);
      } else {
        expect.unreachable(`Unexpected pattern kind: ${pattern.kind}`);
      }
    }
  });

  it("has 2-4 non-empty examples and a non-empty tip of at most 160 characters for each pattern", () => {
    for (const pattern of BN_EN_PRONUNCIATION_PATTERNS) {
      expect(pattern.examples.length).toBeGreaterThanOrEqual(2);
      expect(pattern.examples.length).toBeLessThanOrEqual(4);
      for (const example of pattern.examples) {
        expect(example.trim().length).toBeGreaterThan(0);
      }

      expect(pattern.tip.trim().length).toBeGreaterThan(0);
      expect(pattern.tip.length).toBeLessThanOrEqual(160);
    }
  });

  it("has non-empty target and heard descriptions for every pattern", () => {
    for (const pattern of BN_EN_PRONUNCIATION_PATTERNS) {
      expect(pattern.target.trim().length).toBeGreaterThan(0);
      expect(pattern.heard.trim().length).toBeGreaterThan(0);
    }
  });
});

describe("findPattern", () => {
  it("finds a known pattern by code", () => {
    const pattern = findPattern("IPA:/v/_to_[b]");
    expect(pattern).toBeDefined();
    expect(pattern?.target).toBe("/v/");
    expect(pattern?.kind).toBe("phoneme");
  });

  it("finds prosody patterns by code", () => {
    const pattern = findPattern("PROSODY:word_stress");
    expect(pattern).toBeDefined();
    expect(pattern?.target).toBe("word stress");
    expect(pattern?.kind).toBe("prosody");
  });

  it("finds every pattern in the catalog by its code", () => {
    for (const pattern of BN_EN_PRONUNCIATION_PATTERNS) {
      expect(findPattern(pattern.code)).toBe(pattern);
    }
  });

  it("returns undefined for unknown or empty codes", () => {
    expect(findPattern("unknown_code")).toBeUndefined();
    expect(findPattern("IPA:/xyz/_to_[abc]")).toBeUndefined();
    expect(findPattern("PROSODY:unknown")).toBeUndefined();
    expect(findPattern("")).toBeUndefined();
  });
});

describe("catalogCodeFor", () => {
  it("maps 'w' and 'b' to IPA:/w/_to_[v]", () => {
    expect(catalogCodeFor("w", "b")).toBe("IPA:/w/_to_[v]");
  });

  it("maps 's' and 'i' to IPA:/sC/_to_[isC]", () => {
    expect(catalogCodeFor("s", "i")).toBe("IPA:/sC/_to_[isC]");
  });

  it("returns undefined for an unknown pair", () => {
    expect(catalogCodeFor("x", "y")).toBeUndefined();
  });

  it("maps every AZURE_TO_CATALOG value to an existing catalog pattern", () => {
    for (const code of Object.values(AZURE_TO_CATALOG)) {
      const pattern = findPattern(code);
      expect(pattern).toBeDefined();
      expect(pattern?.code).toBe(code);
    }
  });
});
