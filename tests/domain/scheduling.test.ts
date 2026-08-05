import { describe, expect, it } from "vitest";
import { buildAvailableSlots, intervalsOverlap } from "@/lib/domain/scheduling";

const at = (hour: number, minute = 0) => new Date(2026, 7, 10, hour, minute);

describe("availability", () => {
  it("treats adjacent ranges as non-overlapping", () => {
    expect(
      intervalsOverlap(
        { start: at(10), end: at(11) },
        { start: at(11), end: at(12) },
      ),
    ).toBe(false);
  });

  it("builds 15-minute starts and removes busy ranges", () => {
    const slots = buildAvailableSlots({
      window: { start: at(9), end: at(11) },
      occupiedDurationMinutes: 45,
      busy: [{ start: at(9, 30), end: at(10, 15) }],
    });
    expect(slots.map((slot) => `${slot.getHours()}:${String(slot.getMinutes()).padStart(2, "0")}`)).toEqual([
      "10:15",
    ]);
  });
});
