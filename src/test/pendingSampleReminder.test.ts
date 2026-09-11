import { describe, expect, it } from "vitest";
import {
  getPendingSampleReminderEligibility,
  isRegisteredToday,
} from "@/lib/pendingSampleReminder";

describe("pending sample reminder eligibility", () => {
  const noon = new Date(2026, 8, 11, 12, 0, 0); // 11 Sep 2026 local

  it("isRegisteredToday matches local calendar day", () => {
    expect(isRegisteredToday(new Date(2026, 8, 11, 0, 5, 0), noon)).toBe(true);
    expect(isRegisteredToday(new Date(2026, 8, 11, 23, 59, 0), noon)).toBe(true);
    expect(isRegisteredToday(new Date(2026, 8, 10, 23, 59, 0), noon)).toBe(false);
  });

  it("excludes patients registered today", () => {
    const elig = getPendingSampleReminderEligibility(
      {
        created_at: new Date(2026, 8, 11, 9, 0, 0).toISOString(),
        sample_collection_reminder_sent_count: 0,
        sample_collection_reminder_last_sent_at: null,
      },
      noon,
    );
    expect(elig.eligible).toBe(false);
    expect(elig.reason).toMatch(/Registered today/i);
  });

  it("allows yesterday registration when other rules pass", () => {
    const elig = getPendingSampleReminderEligibility(
      {
        created_at: new Date(2026, 8, 10, 18, 0, 0).toISOString(),
        sample_collection_reminder_sent_count: 0,
        sample_collection_reminder_last_sent_at: null,
      },
      noon,
    );
    expect(elig.eligible).toBe(true);
  });
});