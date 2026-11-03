import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getTodayAgendaCount } from "@/lib/agenda-count";
import { appointmentServiceDateKey, localDateKey } from "@/lib/domain/financial-receivables";

type Row = { id: string; organization_id: string; status: string; service_period: string };
const period = (start: string, duration = 30 * 60_000) => `["${start}","${new Date(new Date(start).getTime() + duration).toISOString()}")`;

function clientFor(rows: Row[], cap = 1_000) {
  const calls: { columns: string; organization: string; excluded: string; window: string; order: string; range: number[]; bytes: number }[] = [];
  const client = {
    from: (table: string) => {
      expect(table).toBe("appointments");
      const call = { columns: "", organization: "", excluded: "", window: "", order: "", range: [] as number[], bytes: 0 };
      calls.push(call);
      const query = {
        select: (columns: string, options: unknown) => { call.columns = columns; expect(options).toEqual({ count: "exact" }); return query; },
        eq: (key: string, id: string) => { expect(key).toBe("organization_id"); call.organization = id; return query; },
        not: (key: string, operator: string, values: string) => { expect([key, operator]).toEqual(["status", "in"]); call.excluded = values; return query; },
        overlaps: (key: string, window: string) => { expect(key).toBe("service_period"); call.window = window; return query; },
        order: (column: string) => { call.order = column; return query; },
        range: async (from: number, to: number) => {
          call.range = [from, to];
          const [lower, upper] = call.window.slice(1, -1).split(",").map((value) => new Date(value).getTime());
          const filtered = rows.filter((row) => {
            const [start, end] = row.service_period.slice(1, -1).replaceAll('"', "").split(",").map((value) => new Date(value).getTime());
            return row.organization_id === call.organization && !call.excluded.includes(row.status) && start < upper && end > lower;
          }).sort((a, b) => a.id.localeCompare(b.id));
          const data = filtered.slice(from, Math.min(to + 1, from + cap)).map(({ service_period }) => ({ service_period }));
          call.bytes = new TextEncoder().encode(JSON.stringify(data)).byteLength;
          return { data, count: filtered.length, error: null };
        },
      };
      return query;
    },
  };
  return { client: client as unknown as SupabaseClient, calls };
}

describe("contador da agenda sem baixar o histórico", () => {
  it.each(["America/Sao_Paulo", "America/New_York", "Pacific/Kiritimati", "Pacific/Pago_Pago", "Asia/Tokyo", "UTC"])("preserva data local, limites e fuso %s", async (timezone) => {
    const now = new Date("2026-11-01T06:30:00Z"); // DST fold in New York.
    const rows: Row[] = Array.from({ length: 97 }, (_, i) => ({
      id: `${i}`.padStart(4, "0"), organization_id: "org", status: "CONFIRMED",
      service_period: period(new Date(now.getTime() + (i - 48) * 60 * 60_000).toISOString()),
    }));
    rows.push({ id: "canceled", organization_id: "org", status: "CANCELED", service_period: period(now.toISOString()) });
    rows.push({ id: "other", organization_id: "other", status: "CONFIRMED", service_period: period(now.toISOString()) });
    rows.push({ id: "long", organization_id: "org", status: "CONFIRMED", service_period: period("2026-10-20T00:00:00Z", 30 * 86_400_000) });
    const expected = rows.filter((row) => row.organization_id === "org" && row.status !== "CANCELED" && appointmentServiceDateKey(row.service_period, timezone) === localDateKey(now, timezone)).length;
    const f = clientFor(rows);
    expect(await getTodayAgendaCount(f.client, "org", timezone, now)).toBe(expected);
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0].columns).toBe("service_period");
    expect(f.calls[0].order).toBe("id");
  });

  it("não trunca totais quando há mais de 1000 registros ou a API impõe limite menor", async () => {
    const now = new Date("2026-11-03T15:00:00Z");
    const rows = Array.from({ length: 1_005 }, (_, i) => ({ id: `${i}`.padStart(5, "0"), organization_id: "org", status: "CONFIRMED", service_period: period(now.toISOString()) }));
    const f = clientFor(rows, 500);
    expect(await getTodayAgendaCount(f.client, "org", "America/Sao_Paulo", now)).toBe(1_005);
    expect(f.calls.map((call) => call.range)).toEqual([[0, 999], [500, 1499], [1000, 1999]]);
  });

  it("reduz bytes no mesmo histórico e conserva o resultado", async () => {
    const now = new Date("2026-11-03T15:00:00Z");
    const rows = Array.from({ length: 365 }, (_, i) => ({ id: `${i}`, organization_id: "org", status: "CONFIRMED", service_period: period(new Date(now.getTime() - i * 86_400_000).toISOString()) }));
    const beforeBytes = new TextEncoder().encode(JSON.stringify(rows.map(({ service_period, status }) => ({ service_period, status })))).byteLength;
    const f = clientFor(rows);
    expect(await getTodayAgendaCount(f.client, "org", "America/Sao_Paulo", now)).toBe(1);
    expect(f.calls.reduce((sum, call) => sum + call.bytes, 0)).toBeLessThan(beforeBytes / 50);
  });
});
