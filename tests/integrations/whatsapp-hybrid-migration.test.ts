import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = join(
  process.cwd(),
  "supabase",
  "migrations",
  "202608110006_whatsapp_hybrid_connections.sql",
);
const lifecycleMigrationPath = join(
  process.cwd(),
  "supabase",
  "migrations",
  "202608110007_whatsapp_connection_lifecycle.sql",
);

describe("WhatsApp híbrido por barbearia", () => {
  it("define conexões tenant-safe para Meta e QR Web sem credenciais públicas", () => {
    const sql = readFileSync(migrationPath, "utf8");

    expect(sql).toContain("create type public.whatsapp_provider");
    expect(sql).toContain("create table public.whatsapp_business_connections");
    expect(sql).toContain("provider public.whatsapp_provider not null");
    expect(sql).toContain("access_token_secret_id uuid");
    expect(sql).toContain("gateway_secret_id uuid");
    expect(sql).toContain("organization_id uuid not null");
    expect(sql).toContain("unique (organization_id, provider)");
    expect(sql).toContain("alter table public.whatsapp_connection_states enable row level security");
    expect(sql).not.toMatch(/\n\s+access_token\s+text\b/u);
    expect(sql).not.toMatch(/\n\s+gateway_secret\s+text\b/u);
  });

  it("define no máximo duas regras transacionais e RPCs sem segredo", () => {
    const sql = readFileSync(migrationPath, "utf8");

    expect(sql).toContain("create table public.whatsapp_reminder_rules");
    expect(sql).toContain("position between 1 and 2");
    expect(sql).toContain("save_whatsapp_reminder_rules");
    expect(sql).toContain("whatsapp_automation_owner_update");
    expect(sql).toContain("grant update on public.whatsapp_automation_settings to authenticated");
    expect(sql).toContain("pg_advisory_xact_lock");
    expect(sql).toContain("get_whatsapp_connection_status");
    expect(sql).toContain("appointment_confirmation");
    expect(sql).toContain("appointment_reminder_6h");
    expect(sql).toContain("appointment_reminder_45m");
    expect(sql).toContain("set_whatsapp_active_provider");
    const lifecycle = readFileSync(lifecycleMigrationPath, "utf8");
    expect(lifecycle).toContain("create or replace function public.disconnect_whatsapp_connection(");
    expect(lifecycle).toContain("pg_advisory_xact_lock");
    expect(lifecycle).toContain("status = 'DISCONNECTED'");
    expect(lifecycle).toContain("is_active = case when v_status = 'DISCONNECTED' then false else is_active end");
    expect(lifecycle).toContain("is_organization_owner(p_organization_id)");
  });
});
