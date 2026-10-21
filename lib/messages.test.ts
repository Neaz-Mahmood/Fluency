import { describe, expect, it } from "vitest";

import { bn, en, getMessages } from "@/lib/messages";
import type { SpeechErrorCode } from "@/lib/stt";

function keyPaths(obj: unknown, prefix = ""): string[] {
  if (!obj || typeof obj !== "object") return [];
  const paths: string[] = [];

  if (Array.isArray(obj)) {
    obj.forEach((item, index) => {
      paths.push(...keyPaths(item, `${prefix}[${index}]`));
    });
    return paths;
  }

  for (const [key, value] of Object.entries(obj)) {
    const current = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object") {
      paths.push(...keyPaths(value, current));
    } else {
      paths.push(current);
    }
  }

  return paths.sort();
}

function collectStringValues(obj: unknown): string[] {
  if (typeof obj === "string") return [obj];
  if (Array.isArray(obj)) return obj.flatMap(collectStringValues);
  if (obj && typeof obj === "object") return Object.values(obj).flatMap(collectStringValues);
  return [];
}

describe("messages", () => {
  it("en and bn have exactly the same nested key set", () => {
    const enKeys = keyPaths(en);
    const bnKeys = keyPaths(bn);
    expect(bnKeys).toEqual(enKeys);
  });

  it("every Bangla value is a non-empty string", () => {
    const bnStrings = collectStringValues(bn);
    expect(bnStrings.length).toBeGreaterThan(0);
    for (const str of bnStrings) {
      expect(typeof str).toBe("string");
      expect(str.trim().length).toBeGreaterThan(0);
    }
  });

  it("getMessages('bn-BD') returns Bangla", () => {
    expect(getMessages("bn-BD")).toBe(bn);
  });

  it("getMessages returns English for null, en-US, and es-MX", () => {
    expect(getMessages(null)).toBe(en);
    expect(getMessages(undefined)).toBe(en);
    expect(getMessages("en-US")).toBe(en);
    expect(getMessages("es-MX")).toBe(en);
  });

  it("speech covers every SpeechErrorCode", () => {
    const expectedCodes: SpeechErrorCode[] = [
      "not-allowed",
      "service-not-allowed",
      "network",
      "audio-capture",
      "failed",
      "already-running",
    ];

    expect(Object.keys(en.speech).sort()).toEqual([...expectedCodes].sort());
    expect(Object.keys(bn.speech).sort()).toEqual([...expectedCodes].sort());

    for (const code of expectedCodes) {
      expect(en.speech[code]).toBeTruthy();
      expect(bn.speech[code]).toBeTruthy();
    }
  });
});
