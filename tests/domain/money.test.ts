import { describe, expect, it } from "vitest";
import { basisPointsOf, deriveFinancialStatus, formatBRL } from "@/lib/domain/money";

describe("money", () => {
  it("calculates basis points using integer cents", () => {
    expect(basisPointsOf(8_500, 2_000)).toBe(1_700);
  });

  it("derives status from immutable ledger totals", () => {
    expect(deriveFinancialStatus({ totalCents: 10_000, capturedCents: 0, refundedCents: 0 })).toBe(
      "UNPAID",
    );
    expect(deriveFinancialStatus({ totalCents: 10_000, capturedCents: 2_000, refundedCents: 0 })).toBe(
      "PARTIAL",
    );
    expect(deriveFinancialStatus({ totalCents: 10_000, capturedCents: 10_000, refundedCents: 0 })).toBe(
      "PAID",
    );
    expect(
      deriveFinancialStatus({
        totalCents: 10_000,
        capturedCents: 10_000,
        refundedCents: 0,
        refundPendingCents: 8_000,
      }),
    ).toBe("REFUND_PENDING");
  });

  it("formats BRL without floating-point business logic", () => {
    expect(formatBRL(12_345)).toContain("123,45");
  });

  it("rejects refunds above the captured balance", () => {
    expect(() =>
      deriveFinancialStatus({ totalCents: 10_000, capturedCents: 2_000, refundedCents: 2_001 }),
    ).toThrow(/cannot exceed/);
    expect(() =>
      deriveFinancialStatus({
        totalCents: 10_000,
        capturedCents: 2_000,
        refundedCents: 1_000,
        refundPendingCents: 1_001,
      }),
    ).toThrow(/refundable balance/);
  });
});
