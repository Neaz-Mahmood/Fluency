import { describe, expect, it } from "vitest";

import { quotaDay, QUOTA_TIME_ZONE, VOICE_SECONDS_PER_DAY } from "@/lib/voice-quota";

describe("voice-quota constants", () => {
  it("exports 300 seconds per day and Asia/Dhaka time zone", () => {
    expect(VOICE_SECONDS_PER_DAY).toBe(300);
    expect(QUOTA_TIME_ZONE).toBe("Asia/Dhaka");
  });
});

describe("quotaDay", () => {
  it("returns 2026-10-22 for 2026-10-22T17:59:59Z", () => {
    expect(quotaDay(new Date("2026-10-22T17:59:59Z"))).toBe("2026-10-22");
  });

  it("returns 2026-10-23 for 2026-10-22T18:00:00Z (Dhaka is UTC+6)", () => {
    expect(quotaDay(new Date("2026-10-22T18:00:00Z"))).toBe("2026-10-23");
  });
});
