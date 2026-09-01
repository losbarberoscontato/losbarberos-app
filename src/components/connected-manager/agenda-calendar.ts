import { parsePostgresRange } from "./format";

const DAY_MS = 86_400_000;

function utcDate(dateKey: string) {
  return new Date(`${dateKey}T12:00:00.000Z`);
}

function isoDateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function zonedDateTimeParts(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

export function dateKeyInTimezone(date: Date, timezone: string) {
  const parts = zonedDateTimeParts(date, timezone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function shiftDateKey(dateKey: string, amount: number) {
  return isoDateKey(new Date(utcDate(dateKey).getTime() + amount * DAY_MS));
}

export function weekDateKeys(dateKey: string) {
  const date = utcDate(dateKey);
  const weekday = date.getUTCDay();
  const mondayOffset = weekday === 0 ? -6 : 1 - weekday;
  const monday = new Date(date.getTime() + mondayOffset * DAY_MS);
  return Array.from({ length: 6 }, (_, index) => isoDateKey(new Date(monday.getTime() + index * DAY_MS)));
}

export function monthCells(dateKey: string) {
  const selected = utcDate(dateKey);
  const first = new Date(Date.UTC(selected.getUTCFullYear(), selected.getUTCMonth(), 1, 12));
  const weekday = first.getUTCDay();
  const mondayOffset = weekday === 0 ? -6 : 1 - weekday;
  const gridStart = new Date(first.getTime() + mondayOffset * DAY_MS);
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart.getTime() + index * DAY_MS);
    return {
      dateKey: isoDateKey(date),
      day: date.getUTCDate(),
      outside: date.getUTCMonth() !== selected.getUTCMonth(),
    };
  });
}

export function appointmentGeometry(range: string, timezone: string, startHour = 8, rowHeight = 78) {
  const period = parsePostgresRange(range);
  if (!period) return null;
  const start = zonedDateTimeParts(period.start, timezone);
  const end = zonedDateTimeParts(period.end, timezone);
  const startMinutes = Number(start.hour) * 60 + Number(start.minute);
  const endMinutes = Number(end.hour) * 60 + Number(end.minute);
  const durationMinutes = Math.max(15, endMinutes - startMinutes);
  return {
    top: (startMinutes - startHour * 60) * (rowHeight / 60),
    // Keep visual height inside its real time slot so back-to-back appointments
    // share a boundary instead of overlapping one another.
    height: Math.max(18, Math.round(durationMinutes * (rowHeight / 60) - 7)),
    startLabel: `${start.hour}:${start.minute}`,
    endLabel: `${end.hour}:${end.minute}`,
  };
}

export function currentTimeGeometry(
  dateKey: string,
  now: Date,
  timezone: string,
  startHour = 8,
  rowHeight = 78,
  updateIntervalMinutes = 5,
) {
  const current = zonedDateTimeParts(now, timezone);
  const currentDateKey = `${current.year}-${current.month}-${current.day}`;
  if (currentDateKey !== dateKey) return null;

  const hour = Number(current.hour);
  const minute = Math.floor(Number(current.minute) / updateIntervalMinutes) * updateIntervalMinutes;
  const currentMinutes = hour * 60 + minute;
  const startMinutes = startHour * 60;
  const endMinutes = startMinutes + 12 * 60;
  if (currentMinutes < startMinutes || currentMinutes > endMinutes) return null;

  return {
    top: (currentMinutes - startMinutes) * (rowHeight / 60),
    label: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
  };
}
