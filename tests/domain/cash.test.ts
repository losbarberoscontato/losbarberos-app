import { describe, expect, it } from "vitest";
import {
  deriveCashEntryStatus,
  remainingCashEntryCents,
  validateSettlementCents,
} from "@/lib/domain/cash";

describe("cash entry lifecycle", () => {
  it("marks an unpaid entry past its due date as overdue", () => {
    expect(deriveCashEntryStatus({ amountCents: 10_000, settledCents: 0, dueDate: "2026-08-08", today: "2026-08-09" })).toBe("OVERDUE");
  });

  it("keeps partial payments open until the full amount is settled", () => {
    expect(deriveCashEntryStatus({ amountCents: 10_000, settledCents: 3_000, dueDate: "2026-08-10", today: "2026-08-09" })).toBe("PARTIAL");
    expect(remainingCashEntryCents(10_000, 3_000)).toBe(7_000);
  });

  it("rejects a settlement larger than the remaining balance", () => {
    expect(() => validateSettlementCents({ amountCents: 10_000, settledCents: 8_000, settlementCents: 2_001 })).toThrow(/remaining balance/i);
  });

  it("keeps canceled entries out of open or overdue states", () => {
    expect(deriveCashEntryStatus({ amountCents: 10_000, settledCents: 0, dueDate: "2026-08-01", today: "2026-08-09", canceled: true })).toBe("CANCELED");
  });
});
