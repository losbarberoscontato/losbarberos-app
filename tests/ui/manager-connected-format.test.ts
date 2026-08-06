import { describe, expect, it } from "vitest";
import { BUSINESS_SLOT_INTERVAL_MINUTES, centsFromInput, formatCents, humanizeError, isAlignedToSlot, localDateTimeToIso, parsePostgresRange, toPostgresRange } from "@/components/connected-manager/format";

describe("connected manager formatting contracts", () => {
  it("reads the tstzrange returned by PostgreSQL", () => {
    const parsed = parsePostgresRange('["2026-08-04 12:00:00+00","2026-08-04 12:45:00+00")');
    expect(parsed?.start.toISOString()).toBe("2026-08-04T12:00:00.000Z");
    expect(parsed?.end.toISOString()).toBe("2026-08-04T12:45:00.000Z");
  });

  it("keeps money in integer cents", () => {
    expect(centsFromInput("1.234,56")).toBe(123456);
    expect(formatCents(123456)).toContain("1.234,56");
  });

  it("rejects invalid periods and translates a concurrent booking conflict", () => {
    expect(() => toPostgresRange("2026-08-04T14:00", "2026-08-04T13:00")).toThrow("Período inválido");
    expect(humanizeError(new Error("requested slot is no longer available"))).toBe("Esse horário acabou de ser ocupado.");
  });

  it("interprets datetime-local in the tenant IANA timezone", () => {
    expect(localDateTimeToIso("2026-08-04T14:00", "America/Sao_Paulo")).toBe("2026-08-04T17:00:00.000Z");
    expect(localDateTimeToIso("2026-08-04T14:00", "America/Manaus")).toBe("2026-08-04T18:00:00.000Z");
  });

  it("uses 15-minute appointment slots", () => {
    expect(BUSINESS_SLOT_INTERVAL_MINUTES).toBe(15);
    expect(isAlignedToSlot("2026-08-07T11:15", BUSINESS_SLOT_INTERVAL_MINUTES)).toBe(true);
    expect(isAlignedToSlot("2026-08-07T11:20", BUSINESS_SLOT_INTERVAL_MINUTES)).toBe(false);
  });

  it("translates slot interval validation errors", () => {
    expect(humanizeError(new Error("start time is not aligned to slot interval"))).toBe("Escolha um horário alinhado ao intervalo de slots da agenda.");
  });
});
