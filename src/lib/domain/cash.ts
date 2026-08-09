export type CashEntryStatus = "OPEN" | "PARTIAL" | "SETTLED" | "OVERDUE" | "CANCELED";

export function remainingCashEntryCents(amountCents: number, settledCents: number): number {
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) throw new Error("entry amount must be positive integer cents");
  if (!Number.isSafeInteger(settledCents) || settledCents < 0 || settledCents > amountCents) {
    throw new Error("settled amount must stay within entry amount");
  }
  return amountCents - settledCents;
}

export function validateSettlementCents({ amountCents, settledCents, settlementCents }: { amountCents: number; settledCents: number; settlementCents: number }): number {
  const remaining = remainingCashEntryCents(amountCents, settledCents);
  if (!Number.isSafeInteger(settlementCents) || settlementCents <= 0 || settlementCents > remaining) {
    throw new Error("settlement exceeds remaining balance");
  }
  return remaining - settlementCents;
}

export function deriveCashEntryStatus({ amountCents, settledCents, dueDate, today, canceled = false }: { amountCents: number; settledCents: number; dueDate: string; today: string; canceled?: boolean }): CashEntryStatus {
  if (canceled) return "CANCELED";
  const remaining = remainingCashEntryCents(amountCents, settledCents);
  if (remaining === 0) return "SETTLED";
  if (settledCents > 0) return "PARTIAL";
  return dueDate < today ? "OVERDUE" : "OPEN";
}
