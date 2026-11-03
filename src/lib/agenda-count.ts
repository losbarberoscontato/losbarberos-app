import type { SupabaseClient } from "@supabase/supabase-js";
import { appointmentServiceDateKey, localDateKey } from "./domain/financial-receivables";

export async function getTodayAgendaCount(
  supabase: SupabaseClient,
  organizationId: string,
  timezone: string,
  now = new Date(),
): Promise<number> {
  const today = localDateKey(now, timezone);
  // A conservative UTC window contains today's local starts across IANA zones
  // and DST changes. The local-date predicate below remains authoritative.
  const margin = 48 * 60 * 60 * 1_000;
  const window = `[${new Date(now.getTime() - margin).toISOString()},${new Date(now.getTime() + margin).toISOString()})`;
  let total = 0;
  let offset = 0;
  const pageSize = 1_000;
  while (true) {
    const { data, error, count } = await supabase.from("appointments")
      .select("service_period", { count: "exact" })
      .eq("organization_id", organizationId)
      .not("status", "in", "(CANCELED,NO_SHOW,EXPIRED)")
      .overlaps("service_period", window)
      .order("id")
      .range(offset, offset + pageSize - 1);
    if (error) return 0;
    const rows = data ?? [];
    total += rows.filter((row) => appointmentServiceDateKey(row.service_period, timezone) === today).length;
    offset += rows.length;
    // Read until exhausted, including projects whose API row cap is below 1000.
    if (rows.length === 0 || (typeof count === "number" && offset >= count)) return total;
  }
}
