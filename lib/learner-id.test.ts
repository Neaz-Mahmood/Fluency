import { describe, expect, it } from "vitest";

import { isLearnerId, learnerCookieOptions, newLearnerId } from "@/lib/learner-id";

describe("isLearnerId", () => {
  it("accepts UUIDs, including the ones newLearnerId makes", () => {
    expect(isLearnerId(newLearnerId())).toBe(true);
    expect(isLearnerId("F6536803-6692-4A9B-A8BF-64EB56F56C61")).toBe(true);
  });

  it.each([undefined, "", "abc", "f6536803-6692-4a9b-a8bf-64eb56f56c6", "' OR 1=1 --"])(
    "rejects %j",
    (value) => {
      expect(isLearnerId(value)).toBe(false);
    },
  );
});

describe("learnerCookieOptions", () => {
  it("is httpOnly, lax and site-wide", () => {
    expect(learnerCookieOptions(false)).toMatchObject({
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: false,
    });
  });

  it("is secure in production", () => {
    expect(learnerCookieOptions(true).secure).toBe(true);
  });
});
