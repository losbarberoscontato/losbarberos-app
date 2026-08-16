const isoDatePattern = /^(\d{4})-(\d{2})-(\d{2})$/u;
const brazilianDatePattern = /^(\d{2})\/(\d{2})\/(\d{4})$/u;

function toIsoDate(year: string, month: string, day: string): string | null {
  const value = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (
    value.getUTCFullYear() !== Number(year)
    || value.getUTCMonth() !== Number(month) - 1
    || value.getUTCDate() !== Number(day)
  ) return null;
  return `${year}-${month}-${day}`;
}

export function formatBirthDateInput(value: string | null | undefined): string {
  if (!value) return "";
  const match = value.trim().match(isoDatePattern);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value;
}

export function normalizeBirthDateInput(value: string): string {
  const iso = value.trim().match(isoDatePattern);
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;

  const digits = value.replace(/\D/gu, "").slice(0, 8);
  return [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4, 8)]
    .filter(Boolean)
    .join("/");
}

export function parseBirthDateInput(value: string): string | null {
  const normalized = value.trim();
  const iso = normalized.match(isoDatePattern);
  if (iso) return toIsoDate(iso[1], iso[2], iso[3]);

  const brazilian = normalized.match(brazilianDatePattern);
  return brazilian ? toIsoDate(brazilian[3], brazilian[2], brazilian[1]) : null;
}
