import { assertCents, basisPointsOf } from "./money";
import type { CommissionRule } from "./types";

export function calculateCommission(input: {
  listPriceCents: number;
  quantity?: number;
  rule: CommissionRule;
}): number {
  const listPrice = assertCents(input.listPriceCents, "listPriceCents");
  const quantity = input.quantity ?? 1;
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new RangeError("quantity must be a positive integer");
  }

  if (input.rule.type === "FIXED_PER_ITEM") {
    return assertCents(input.rule.fixedCents ?? 0, "fixedCents") * quantity;
  }
  return basisPointsOf(listPrice * quantity, input.rule.rateBps ?? 0);
}

