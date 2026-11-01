import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20261101152207_appointment_auxiliaries.sql",
  "utf8",
);
const auxiliaryMessagesMigration = readFileSync(
  "supabase/migrations/20261101204721_whatsapp_auxiliary_editable_templates.sql",
  "utf8",
);

describe("appointment auxiliaries migration contract", () => {
  it("keeps assignments tenant-scoped and manager-only, with a maximum of three", () => {
    expect(migration).toContain("unique (organization_id, appointment_id, assistant_barber_id)");
    expect(migration).toContain("foreign key (appointment_id, organization_id)");
    expect(migration).toContain("foreign key (assistant_barber_id, organization_id)");
    expect(migration).toContain("public.is_organization_owner(p_organization_id)");
    expect(migration).toContain("jsonb_array_length(p_auxiliaries) > 3");
    expect(migration).toContain("appointment primary professional cannot be an auxiliary");
  });

  it("records separate, idempotent auxiliary commissions from service list snapshots", () => {
    expect(migration).toContain("item.list_price_cents_snapshot");
    expect(migration).toContain("v_rule.fixed_cents * v_rule.quantity");
    expect(migration).toContain("v_rule.list_price_cents_snapshot::numeric * v_rule.quantity");
    expect(migration).toContain("assistant-earned:' || v_rule.auxiliary_id");
    expect(migration).not.toContain("charged_price_cents_snapshot::numeric * v_rule.quantity");
  });

  it("keeps WhatsApp enqueue failures isolated from the primary flow", () => {
    expect(migration).toContain("Auxiliary booking notice could not be queued");
    expect(migration).toContain("Auxiliary cancellation notice could not be queued");
    expect(migration).toContain("Auxiliary WhatsApp job copy skipped");
    expect(migration).toContain("on conflict (organization_id, dedupe_key) do nothing");
  });

  it("adds separate editable templates for all auxiliary notice paths without recursive cloning", () => {
    expect(auxiliaryMessagesMigration).toContain("BOOKING_CREATED_AUXILIARY");
    expect(auxiliaryMessagesMigration).toContain("APPOINTMENT_CONFIRMED_AUXILIARY");
    expect(auxiliaryMessagesMigration).toContain("APPOINTMENT_CANCELED_AUXILIARY");
    expect(auxiliaryMessagesMigration).toContain("MANUAL_CONFIRMATION_AUXILIARY");
    expect(auxiliaryMessagesMigration).toContain("'message_audience', 'AUXILIARY'");
    expect(auxiliaryMessagesMigration).toContain("new.payload ->> 'message_audience' = 'AUXILIARY'");
    expect(auxiliaryMessagesMigration).toContain("on conflict (organization_id, dedupe_key) do nothing");
  });

  it("activates the free module without creating a billable module change", () => {
    expect(migration).toContain("set_appointment_assistants_module_enabled");
    expect(migration).toContain("billing_change_action = 'NONE'");
    expect(migration).toContain("billing_sync_status = 'SYNCED'");
  });
});
