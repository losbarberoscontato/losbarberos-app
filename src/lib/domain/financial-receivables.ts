export const DEFAULT_FINANCIAL_TIMEZONE = "America/Sao_Paulo";

export const RECEIVABLE_APPOINTMENT_STATUSES = ["CONFIRMED", "IN_SERVICE", "COMPLETED"] as const;

function instantDate(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.valueOf()) ? null : date;
}

export function localDateKey(value: Date | string, timezone = DEFAULT_FINANCIAL_TIMEZONE) {
  const date = instantDate(value);
  return date ? new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(date) : null;
}

export function appointmentServiceDateKey(servicePeriod: string, timezone = DEFAULT_FINANCIAL_TIMEZONE) {
  const match = /^[[(]([^,]+),/u.exec(servicePeriod);
  return match ? localDateKey(match[1].trim().replace(/^"|"$/gu, ""), timezone) : null;
}

export function addDateKey(dateKey: string, days: number) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(dateKey);
  if (!match || !Number.isInteger(days)) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (Number.isNaN(date.valueOf())) return null;
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function isReceivableAppointmentStatus(status: string) {
  return (RECEIVABLE_APPOINTMENT_STATUSES as readonly string[]).includes(status);
}

export function isDateKeyAtOrBefore(dateKey: string, endDateKey: string) {
  return dateKey <= endDateKey;
}

export function isDateKeyBetween(dateKey: string, startDateKey: string, endDateKey: string) {
  return dateKey >= startDateKey && dateKey <= endDateKey;
}
