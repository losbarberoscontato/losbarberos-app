import { describe, expect, it } from "vitest";
import { calculateTenantPurgeAfter, latestConsent } from "@/lib/domain/privacy";

describe("privacy policies", () => {
  it("honors the latest specific consent event", () => {
    expect(
      latestConsent(
        [
          {
            purpose: "WHATSAPP_TRANSACTIONAL",
            granted: true,
            occurredAt: new Date("2026-08-01T10:00:00Z"),
            noticeVersion: "1",
            source: "ONBOARDING",
          },
          {
            purpose: "WHATSAPP_TRANSACTIONAL",
            granted: false,
            occurredAt: new Date("2026-08-02T10:00:00Z"),
            noticeVersion: "1",
            source: "WHATSAPP",
          },
        ],
        "WHATSAPP_TRANSACTIONAL",
      ),
    ).toBe(false);
  });

  it("opens a 30-day tenant export window", () => {
    expect(calculateTenantPurgeAfter(new Date("2026-08-04T12:00:00Z")).toISOString()).toBe(
      "2026-09-03T12:00:00.000Z",
    );
  });
});
