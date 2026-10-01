export type DateBlockType = "HOLIDAY" | "RECESS" | "EVENT";
export type OrganizationDateBlock = {
  id: string;
  organization_id: string;
  block_type: DateBlockType;
  name: string;
  description: string | null;
  holiday_scope: "MUNICIPAL" | "STATE" | "FEDERAL" | null;
  recurrence: "ANNUAL" | "YEAR" | null;
  start_date: string;
  end_date: string | null;
  start_time: string | null;
  end_time: string | null;
};

export type MonthCalendar = {
  month: number;
  label: string;
  leadingEmptyDays: number;
  days: number[];
  weekdayLabels: string[];
};

const MONTHS = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const WEEKDAYS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];

export function buildYearCalendar(year: number): MonthCalendar[] {
  if (!Number.isInteger(year) || year < 1 || year > 9999) throw new RangeError("Ano fora do calendário gregoriano suportado.");
  return MONTHS.map((label, index) => {
    const firstWeekday = new Date(Date.UTC(year, index, 1)).getUTCDay();
    return {
      month: index + 1,
      label,
      leadingEmptyDays: (firstWeekday + 6) % 7,
      days: Array.from({ length: new Date(Date.UTC(year, index + 1, 0)).getUTCDate() }, (_, day) => day + 1),
      weekdayLabels: WEEKDAYS,
    };
  });
}

export function dateBlockCoversDate(block: OrganizationDateBlock, dateKey: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(dateKey)) return false;
  const year = Number(dateKey.slice(0, 4));
  const monthDay = dateKey.slice(5);
  if (block.block_type === "HOLIDAY") {
    return block.recurrence === "ANNUAL"
      ? year >= Number(block.start_date.slice(0, 4)) && monthDay === block.start_date.slice(5)
      : dateKey === block.start_date;
  }
  if (block.block_type === "EVENT") return dateKey === block.start_date;
  return Boolean(block.end_date && dateKey >= block.start_date && dateKey <= block.end_date);
}

export function dateKey(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
