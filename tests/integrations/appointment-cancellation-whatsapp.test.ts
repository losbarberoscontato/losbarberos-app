import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20260913154046_appointment_cancellation_whatsapp_notifications.sql",
  "utf8",
);

describe("appointment cancellation WhatsApp migration contract", () => {
  it("enqueues client and barber notifications for every cancellation transition", () => {
    expect(migration).toContain("new.status <> 'CANCELED'");
    expect(migration).toContain("new.cancellation_source = 'WHATSAPP_CLIENT'");
    expect(migration).toContain("CANCELLATION_ACK_CLIENT");
    expect(migration).toContain("APPOINTMENT_CANCELED_STAFF");
    expect(migration).toContain("staff_notifications_enabled");
    expect(migration).toContain("whatsapp_v2_consented");
  });

  it("uses immediate, idempotent jobs independent of the cancellation deadline", () => {
    expect(migration).toContain("v_scheduled_for timestamptz := now()");
    expect(migration).toContain("v_valid_until timestamptz := now() + interval '24 hours'");
    expect(migration).toContain("on conflict (organization_id, dedupe_key) do nothing");
    expect(migration).toContain("The deadline only changes the session/refund outcome");
  });

  it("runs after the existing cancellation cleanup trigger", () => {
    expect(migration).toContain("zz_appointments_enqueue_cancellation_whatsapp");
    expect(migration).toContain("after update of status on public.appointments");
  });
});
