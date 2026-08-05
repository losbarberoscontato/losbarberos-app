import type { TimeInterval } from "./types";

export function intervalsOverlap(left: TimeInterval, right: TimeInterval): boolean {
  return left.start < right.end && right.start < left.end;
}

export function buildAvailableSlots(input: {
  window: TimeInterval;
  occupiedDurationMinutes: number;
  busy: TimeInterval[];
  stepMinutes?: number;
}): Date[] {
  const stepMinutes = input.stepMinutes ?? 15;
  if (input.window.end <= input.window.start) throw new RangeError("Invalid availability window");
  if (!Number.isInteger(stepMinutes) || stepMinutes <= 0) throw new RangeError("Invalid step");
  if (!Number.isInteger(input.occupiedDurationMinutes) || input.occupiedDurationMinutes <= 0) {
    throw new RangeError("Invalid occupied duration");
  }

  const slots: Date[] = [];
  const durationMs = input.occupiedDurationMinutes * 60_000;
  const stepMs = stepMinutes * 60_000;

  for (
    let timestamp = input.window.start.getTime();
    timestamp + durationMs <= input.window.end.getTime();
    timestamp += stepMs
  ) {
    const interval = { start: new Date(timestamp), end: new Date(timestamp + durationMs) };
    if (!input.busy.some((busy) => intervalsOverlap(interval, busy))) {
      slots.push(interval.start);
    }
  }
  return slots;
}

