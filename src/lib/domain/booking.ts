import { basisPointsOf, assertCents } from "./money";
import type {
  AppointmentStatus,
  BookingItemInput,
  BookingQuote,
  PaymentMode,
  RescheduledBookingItem,
} from "./types";

const transitionMap: Record<AppointmentStatus, readonly AppointmentStatus[]> = {
  HELD: ["PENDING_PAYMENT", "CONFIRMED", "EXPIRED", "CANCELED"],
  PENDING_PAYMENT: ["CONFIRMED", "EXPIRED", "CANCELED"],
  CONFIRMED: ["IN_SERVICE", "CANCELED", "NO_SHOW"],
  IN_SERVICE: ["COMPLETED", "CANCELED"],
  COMPLETED: [],
  CANCELED: [],
  NO_SHOW: [],
  EXPIRED: [],
};

export function roundOccupiedMinutes(durationMinutes: number, gridMinutes = 15): number {
  if (!Number.isInteger(durationMinutes) || durationMinutes <= 0) {
    throw new RangeError("durationMinutes must be a positive integer");
  }
  if (!Number.isInteger(gridMinutes) || gridMinutes <= 0) {
    throw new RangeError("gridMinutes must be a positive integer");
  }
  return Math.ceil(durationMinutes / gridMinutes) * gridMinutes;
}

export function calculateBookingQuote(input: {
  items: BookingItemInput[];
  depositBps: number;
  paymentMode: PaymentMode;
}): BookingQuote {
  if (input.items.length === 0) throw new Error("At least one booking item is required");

  const totals = input.items.reduce(
    (acc, item) => {
      if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
        throw new RangeError("Item quantity must be a positive integer");
      }
      if (!Number.isInteger(item.durationMinutes) || item.durationMinutes <= 0) {
        throw new RangeError("Item duration must be a positive integer");
      }
      assertCents(item.listPriceCents, "listPriceCents");
      assertCents(item.salePriceCents, "salePriceCents");
      acc.itemCount += item.quantity;
      acc.duration += item.durationMinutes * item.quantity;
      acc.listTotal += item.listPriceCents * item.quantity;
      acc.saleTotal += item.salePriceCents * item.quantity;
      return acc;
    },
    { itemCount: 0, duration: 0, listTotal: 0, saleTotal: 0 },
  );

  const depositCents = basisPointsOf(totals.saleTotal, input.depositBps);
  const requiredNowCents =
    input.paymentMode === "FULL"
      ? totals.saleTotal
      : input.paymentMode === "DEPOSIT"
        ? depositCents
        : 0;

  return {
    itemCount: totals.itemCount,
    serviceDurationMinutes: totals.duration,
    occupiedDurationMinutes: roundOccupiedMinutes(totals.duration),
    listTotalCents: totals.listTotal,
    totalCents: totals.saleTotal,
    depositCents,
    requiredNowCents,
    paymentMode: input.paymentMode,
  };
}

export function canTransitionAppointment(
  from: AppointmentStatus,
  to: AppointmentStatus,
): boolean {
  return transitionMap[from].includes(to);
}

export function calculateCancellationSettlement(input: {
  capturedCents: number;
  depositCents: number;
  withinCutoff: boolean;
  noShow?: boolean;
}): { retainedCents: number; refundCents: number; remainingDueCents: 0 } {
  const captured = assertCents(input.capturedCents, "capturedCents");
  const deposit = assertCents(input.depositCents, "depositCents");

  if (input.noShow) {
    return { retainedCents: captured, refundCents: 0, remainingDueCents: 0 };
  }
  if (input.withinCutoff) {
    return { retainedCents: 0, refundCents: captured, remainingDueCents: 0 };
  }
  const retainedCents = Math.min(captured, deposit);
  return {
    retainedCents,
    refundCents: captured - retainedCents,
    remainingDueCents: 0,
  };
}

export function calculateRescheduleDelta(input: {
  capturedCents: number;
  newTotalCents: number;
}): { balanceAtShopCents: number; manualRefundCents: number } {
  const captured = assertCents(input.capturedCents, "capturedCents");
  const newTotal = assertCents(input.newTotalCents, "newTotalCents");
  return {
    balanceAtShopCents: Math.max(newTotal - captured, 0),
    manualRefundCents: Math.max(captured - newTotal, 0),
  };
}

export function priceRescheduledItems(input: {
  originalItems: BookingItemInput[];
  requestedItems: BookingItemInput[];
}): RescheduledBookingItem[] {
  const originalById = new Map<string, BookingItemInput>();
  for (const item of input.originalItems) {
    if (originalById.has(item.id)) throw new Error(`Duplicate original item: ${item.id}`);
    originalById.set(item.id, item);
  }

  const requestedIds = new Set<string>();
  const result: RescheduledBookingItem[] = [];
  for (const requested of input.requestedItems) {
    if (requestedIds.has(requested.id)) throw new Error(`Duplicate requested item: ${requested.id}`);
    requestedIds.add(requested.id);

    if (!Number.isInteger(requested.quantity) || requested.quantity <= 0) {
      throw new RangeError("Item quantity must be a positive integer");
    }

    const original = originalById.get(requested.id);
    const preservedQuantity = original ? Math.min(original.quantity, requested.quantity) : 0;
    if (original && preservedQuantity > 0) {
      result.push({
        ...original,
        quantity: preservedQuantity,
        pricingSource: "ORIGINAL_SNAPSHOT",
      });
    }

    const currentQuantity = requested.quantity - preservedQuantity;
    if (currentQuantity > 0) {
      result.push({
        ...requested,
        quantity: currentQuantity,
        pricingSource: "CURRENT_CATALOG",
      });
    }
  }

  if (result.length === 0) throw new Error("At least one requested item is required");
  return result;
}
