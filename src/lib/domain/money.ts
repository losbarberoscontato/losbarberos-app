import type { FinancialStatus } from "./types";

export function assertCents(value: number, field = "amount"): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${field} must be a non-negative integer in cents`);
  }
  return value;
}

export function basisPointsOf(cents: number, basisPoints: number): number {
  assertCents(cents, "cents");
  if (!Number.isInteger(basisPoints) || basisPoints < 0 || basisPoints > 10_000) {
    throw new RangeError("basisPoints must be an integer between 0 and 10000");
  }
  return Math.round((cents * basisPoints) / 10_000);
}

export function formatBRL(cents: number): string {
  assertCents(cents, "cents");
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(cents / 100);
}

export function deriveFinancialStatus(input: {
  totalCents: number;
  capturedCents: number;
  refundedCents: number;
  refundPendingCents?: number;
}): FinancialStatus {
  const total = assertCents(input.totalCents, "totalCents");
  const captured = assertCents(input.capturedCents, "capturedCents");
  const refunded = assertCents(input.refundedCents, "refundedCents");
  const refundPending = assertCents(input.refundPendingCents ?? 0, "refundPendingCents");

  if (refunded > captured) {
    throw new RangeError("refundedCents cannot exceed capturedCents");
  }
  if (refundPending > captured - refunded) {
    throw new RangeError("refundPendingCents cannot exceed the refundable balance");
  }

  if (refundPending > 0) return "REFUND_PENDING";
  if (captured > 0 && refunded >= captured) return "REFUNDED";
  if (refunded > 0) return "PARTIALLY_REFUNDED";
  if (captured === 0) return "UNPAID";
  if (captured >= total) return "PAID";
  return "PARTIAL";
}
