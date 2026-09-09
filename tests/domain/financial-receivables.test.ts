import { describe, expect, it } from "vitest";
import {
  addDateKey,
  appointmentServiceDateKey,
  isDateKeyAtOrBefore,
  isDateKeyBetween,
  isReceivableAppointmentStatus,
  localDateKey,
} from "@/lib/domain/financial-receivables";

describe("financial receivable projection", () => {
  it("uses the organization timezone for an appointment service date", () => {
    expect(appointmentServiceDateKey("[2026-09-05T02:15:00.000Z,2026-09-05T03:00:00.000Z)", "America/Sao_Paulo")).toBe("2026-09-04");
    expect(appointmentServiceDateKey("[\"2026-09-05 02:15:00+00\",\"2026-09-05 03:00:00+00\")", "America/Sao_Paulo")).toBe("2026-09-04");
  });

  it("accepts active appointment states and rejects provisional or inactive states", () => {
    expect(isReceivableAppointmentStatus("CONFIRMED")).toBe(true);
    expect(isReceivableAppointmentStatus("IN_SERVICE")).toBe(true);
    expect(isReceivableAppointmentStatus("COMPLETED")).toBe(true);
    expect(isReceivableAppointmentStatus("HELD")).toBe(false);
    expect(isReceivableAppointmentStatus("CANCELED")).toBe(false);
  });

  it("compares the receivable horizon with date keys, not browser timezone instants", () => {
    expect(localDateKey("2026-09-05T02:15:00.000Z", "America/Sao_Paulo")).toBe("2026-09-04");
    expect(addDateKey("2026-09-04", 30)).toBe("2026-10-04");
    expect(isDateKeyAtOrBefore("2026-09-04", "2026-10-04")).toBe(true);
    expect(isDateKeyBetween("2026-09-20", "2026-09-04", "2026-10-04")).toBe(true);
  });
});
