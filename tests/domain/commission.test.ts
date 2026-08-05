import { describe, expect, it } from "vitest";
import { calculateCommission } from "@/lib/domain/commission";

describe("commission calculation", () => {
  it("uses frozen list price for percentage commission, including discounted packages", () => {
    expect(
      calculateCommission({
        listPriceCents: 10_000,
        rule: { type: "PERCENTAGE", rateBps: 4_000 },
      }),
    ).toBe(4_000);
  });

  it("calculates a fixed commission for each completed service item", () => {
    expect(
      calculateCommission({
        listPriceCents: 10_000,
        quantity: 2,
        rule: { type: "FIXED_PER_ITEM", fixedCents: 1_500 },
      }),
    ).toBe(3_000);
  });
});

