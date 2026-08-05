import { describe, expect, it } from "vitest";
import {
  calculateBookingQuote,
  calculateCancellationSettlement,
  calculateRescheduleDelta,
  canTransitionAppointment,
  priceRescheduledItems,
  roundOccupiedMinutes,
} from "@/lib/domain/booking";

describe("booking policies", () => {
  it("rounds occupied duration up to the 15-minute grid", () => {
    expect(roundOccupiedMinutes(35)).toBe(45);
    expect(roundOccupiedMinutes(45)).toBe(45);
  });

  it("quotes a package using sale price while preserving list total", () => {
    const quote = calculateBookingQuote({
      depositBps: 2_000,
      paymentMode: "DEPOSIT",
      items: [
        {
          id: "combo",
          name: "Corte + barba",
          quantity: 1,
          durationMinutes: 65,
          listPriceCents: 10_000,
          salePriceCents: 8_500,
        },
      ],
    });
    expect(quote).toMatchObject({
      serviceDurationMinutes: 65,
      occupiedDurationMinutes: 75,
      listTotalCents: 10_000,
      totalCents: 8_500,
      depositCents: 1_700,
      requiredNowCents: 1_700,
    });
  });

  it("does not require an online charge for a counter booking", () => {
    const quote = calculateBookingQuote({
      depositBps: 3_000,
      paymentMode: "COUNTER",
      items: [
        {
          id: "cut",
          name: "Corte",
          quantity: 1,
          durationMinutes: 35,
          listPriceCents: 6_000,
          salePriceCents: 6_000,
        },
      ],
    });

    expect(quote.requiredNowCents).toBe(0);
    expect(quote.totalCents).toBe(6_000);
  });

  it("retains the deposit after cutoff and refunds captured excess", () => {
    expect(
      calculateCancellationSettlement({
        capturedCents: 10_000,
        depositCents: 2_000,
        withinCutoff: false,
      }),
    ).toEqual({ retainedCents: 2_000, refundCents: 8_000, remainingDueCents: 0 });
  });

  it("retains only captured money on no-show and writes off future balance", () => {
    expect(
      calculateCancellationSettlement({
        capturedCents: 2_000,
        depositCents: 2_000,
        withinCutoff: false,
        noShow: true,
      }),
    ).toEqual({ retainedCents: 2_000, refundCents: 0, remainingDueCents: 0 });
  });

  it("takes reschedule differences to the counter or manual refund", () => {
    expect(calculateRescheduleDelta({ capturedCents: 5_000, newTotalCents: 7_500 })).toEqual({
      balanceAtShopCents: 2_500,
      manualRefundCents: 0,
    });
    expect(calculateRescheduleDelta({ capturedCents: 8_000, newTotalCents: 7_500 })).toEqual({
      balanceAtShopCents: 0,
      manualRefundCents: 500,
    });
  });

  it("preserves snapshots for retained items and prices additions from current catalog", () => {
    const items = priceRescheduledItems({
      originalItems: [
        {
          id: "cut",
          name: "Corte",
          quantity: 1,
          durationMinutes: 35,
          listPriceCents: 5_000,
          salePriceCents: 5_000,
        },
      ],
      requestedItems: [
        {
          id: "cut",
          name: "Corte novo",
          quantity: 2,
          durationMinutes: 40,
          listPriceCents: 6_000,
          salePriceCents: 6_000,
        },
        {
          id: "beard",
          name: "Barba",
          quantity: 1,
          durationMinutes: 25,
          listPriceCents: 4_000,
          salePriceCents: 4_000,
        },
      ],
    });

    expect(items).toEqual([
      expect.objectContaining({
        id: "cut",
        quantity: 1,
        salePriceCents: 5_000,
        pricingSource: "ORIGINAL_SNAPSHOT",
      }),
      expect.objectContaining({
        id: "cut",
        quantity: 1,
        salePriceCents: 6_000,
        pricingSource: "CURRENT_CATALOG",
      }),
      expect.objectContaining({
        id: "beard",
        quantity: 1,
        salePriceCents: 4_000,
        pricingSource: "CURRENT_CATALOG",
      }),
    ]);
  });

  it("allows only explicit appointment state transitions", () => {
    expect(canTransitionAppointment("HELD", "PENDING_PAYMENT")).toBe(true);
    expect(canTransitionAppointment("CONFIRMED", "COMPLETED")).toBe(false);
    expect(canTransitionAppointment("COMPLETED", "CANCELED")).toBe(false);
  });
});
