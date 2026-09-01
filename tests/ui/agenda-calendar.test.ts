import { describe, expect, it } from "vitest";
import {
  appointmentGeometry,
  currentTimeGeometry,
  dateKeyInTimezone,
  monthCells,
  shiftDateKey,
  weekDateKeys,
} from "@/components/connected-manager/agenda-calendar";

describe("connected agenda calendar projections", () => {
  it("keeps date navigation stable without UTC day drift", () => {
    expect(shiftDateKey("2026-08-07", -1)).toBe("2026-08-06");
    expect(shiftDateKey("2026-08-07", 1)).toBe("2026-08-08");
    expect(dateKeyInTimezone(new Date("2026-08-08T01:30:00.000Z"), "America/Sao_Paulo")).toBe("2026-08-07");
  });

  it("builds the Monday-to-Saturday week containing the selected date", () => {
    expect(weekDateKeys("2026-08-07")).toEqual([
      "2026-08-03",
      "2026-08-04",
      "2026-08-05",
      "2026-08-06",
      "2026-08-07",
      "2026-08-08",
    ]);
  });

  it("builds a complete month grid and marks outside days", () => {
    const cells = monthCells("2026-08-07");
    expect(cells).toHaveLength(42);
    expect(cells[0]).toEqual({ dateKey: "2026-07-27", day: 27, outside: true });
    expect(cells[41]).toEqual({ dateKey: "2026-09-06", day: 6, outside: true });
    expect(cells.find((cell) => cell.dateKey === "2026-08-07")).toEqual({ dateKey: "2026-08-07", day: 7, outside: false });
  });

  it("positions an appointment using tenant-local time and real duration", () => {
    expect(appointmentGeometry(
      '["2026-08-07 14:00:00+00","2026-08-07 15:30:00+00")',
      "America/Sao_Paulo",
    )).toEqual({ top: 234, height: 110, startLabel: "11:00", endLabel: "12:30" });
  });

  it("encaixa horário fracionado na linha exata e atualiza marcador atual a cada cinco minutos", () => {
    expect(appointmentGeometry(
      '["2026-08-07 12:45:00+00","2026-08-07 13:00:00+00")',
      "America/Sao_Paulo",
    )?.top).toBe(136.5);
    expect(currentTimeGeometry(
      "2026-08-07",
      new Date("2026-08-07T12:47:00.000Z"),
      "America/Sao_Paulo",
    )).toEqual({ top: 136.5, label: "09:45" });
    expect(currentTimeGeometry(
      "2026-08-08",
      new Date("2026-08-07T12:47:00.000Z"),
      "America/Sao_Paulo",
    )).toBeNull();
  });

  it("mantém agendamentos consecutivos dentro da duração real", () => {
    const first = appointmentGeometry(
      '["2026-08-07 12:00:00+00","2026-08-07 12:30:00+00")',
      "America/Sao_Paulo",
    );
    const second = appointmentGeometry(
      '["2026-08-07 12:30:00+00","2026-08-07 13:00:00+00")',
      "America/Sao_Paulo",
    );

    expect(first?.top).toBe(78);
    expect(first?.height).toBe(32);
    expect(second?.top).toBe(117);
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    if (!first || !second) throw new Error("Expected consecutive appointments to have geometry");
    expect(first.top + first.height).toBeLessThanOrEqual(second.top);
  });
});
