import { describe, expect, it } from "vitest";
import { buildYearCalendar, dateBlockCoversDate, type OrganizationDateBlock } from "@/components/connected-manager/date-block-calendar";

describe("calendário anual de bloqueios", () => {
  it("calcula mês gregoriano completo, segunda-feira como início e ano bissexto", () => {
    const year = buildYearCalendar(2024);
    expect(year).toHaveLength(12);
    expect(year[1].days).toHaveLength(29);
    expect(year[0].leadingEmptyDays).toBe(0);
    expect(year[0].weekdayLabels).toEqual(["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"]);
  });

  it("projeta recessos inclusivos que cruzam a virada do ano", () => {
    const block: OrganizationDateBlock = {
      id: "winter", organization_id: "org", block_type: "RECESS", name: "Recesso",
      description: null, holiday_scope: null, recurrence: null,
      start_date: "2026-12-30", end_date: "2027-01-02", start_time: null, end_time: null,
    };
    expect(dateBlockCoversDate(block, "2026-12-30")).toBe(true);
    expect(dateBlockCoversDate(block, "2027-01-02")).toBe(true);
    expect(dateBlockCoversDate(block, "2027-01-03")).toBe(false);
  });

  it("repete feriado permanente por mês/dia e ignora 29 de fevereiro em ano comum", () => {
    const block: OrganizationDateBlock = {
      id: "holiday", organization_id: "org", block_type: "HOLIDAY", name: "Data anual",
      description: null, holiday_scope: "FEDERAL", recurrence: "ANNUAL",
      start_date: "2024-02-29", end_date: null, start_time: null, end_time: null,
    };
    expect(dateBlockCoversDate(block, "2028-02-29")).toBe(true);
    expect(dateBlockCoversDate(block, "2027-02-28")).toBe(false);
  });

  it("mantém feriado móvel restrito ao ano cadastrado", () => {
    const block: OrganizationDateBlock = {
      id: "mobile", organization_id: "org", block_type: "HOLIDAY", name: "Móvel",
      description: null, holiday_scope: "MUNICIPAL", recurrence: "YEAR", start_date: "2026-04-03",
      end_date: null, start_time: null, end_time: null,
    };
    expect(dateBlockCoversDate(block, "2026-04-03")).toBe(true);
    expect(dateBlockCoversDate(block, "2027-04-03")).toBe(false);
  });
});
