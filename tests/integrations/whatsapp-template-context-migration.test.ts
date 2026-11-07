// @vitest-environment node

import { readFileSync } from "node:fs";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { whatsappDatabase } from "../helpers/whatsapp-database";

const migration = readFileSync(
  "supabase/migrations/20261107194733_whatsapp_template_context_and_delivery_repairs.sql",
  "utf8",
);
const serviceNamesFunction = readFileSync(
  "supabase/migrations/20261021164122_whatsapp_booking_service_names.sql",
  "utf8",
);

const org = "71000000-0000-4000-8000-000000000001";
const connection = "72000000-0000-4000-8000-000000000001";
const customer = "73000000-0000-4000-8000-000000000001";
const barber = "74000000-0000-4000-8000-000000000001";
const appointment = "75000000-0000-4000-8000-000000000001";

let db: PGlite;

beforeAll(async () => {
  db = await whatsappDatabase();
  await db.exec(`create function public.enqueue_appointment_auxiliary_booking_trigger()
    returns trigger language plpgsql as $$ begin return new; end $$;`);
  await db.exec(serviceNamesFunction);
  await db.exec(migration);
}, 60_000);

afterAll(async () => { await db?.close(); });

beforeEach(async () => {
  await db.exec(`begin;
    insert into public.organizations(id, timezone) values ('${org}', 'America/Sao_Paulo');
    insert into public.customers(id, organization_id, full_name, phone_e164)
      values ('${customer}', '${org}', 'adriana andrade', '+5547991349093');
    insert into public.barbers(id, organization_id, display_name, whatsapp_e164)
      values ('${barber}', '${org}', 'Julio Heiden', '+5547991445056');
    insert into public.whatsapp_business_connections(id, organization_id, provider, status, is_active, gateway_instance_id)
      values ('${connection}', '${org}', 'QR_WEB', 'CONNECTED', true, 'le-gras-test');
    insert into public.whatsapp_automation_settings_v2(organization_id, mode, runtime_engine, booking_client_enabled, booking_staff_enabled, templates)
      values ('${org}', 'ACTIVE', 'ACTIVE', true, true, jsonb_build_object(
        'BOOKING_CREATED_CLIENT', 'Oi {cliente}; {servico}; {horario}; {profissional}',
        'CONFIRMATION_ACK_CLIENT', 'Presença na sessão confirmada. Até {horario}.'
      ));
    insert into public.consent_events(organization_id, customer_id, kind, action)
      values ('${org}', '${customer}', 'WHATSAPP_TRANSACTIONAL', 'GRANTED');
    insert into public.appointments(id, organization_id, customer_id, barber_id, status, service_period)
      values ('${appointment}', '${org}', '${customer}', '${barber}', 'CONFIRMED', tstzrange('2027-11-07 22:15:00+00', '2027-11-07 22:45:00+00'));
    insert into public.appointment_items(organization_id, appointment_id, service_name_snapshot, position)
      values ('${org}', '${appointment}', 'Foto Estúdio — Oferta 1', 1);
    set constraints all immediate;`);
});

afterEach(async () => { await db?.exec("rollback"); });

describe("contexto e roteamento dos templates WhatsApp", () => {
  it("espera os itens da sessão e preenche serviço, profissional, telefone e template da organização", async () => {
    const job = await db.query<{
      payload: Record<string, unknown>;
    }>(`select payload from public.whatsapp_automation_jobs
      where appointment_id = '${appointment}' and job_type = 'BOOKING_CREATED_CLIENT'`);

    expect(job.rows).toHaveLength(1);
    expect(job.rows[0].payload).toMatchObject({
      customer_name: "adriana andrade",
      barber_name: "Julio Heiden",
      primary_barber_name: "Julio Heiden",
      service_names: "Foto Estúdio — Oferta 1",
      customer_phone: "+5547991349093",
      timezone: "America/Sao_Paulo",
      templates: { BOOKING_CREATED_CLIENT: "Oi {cliente}; {servico}; {horario}; {profissional}" },
    });
    expect(new Date(String(job.rows[0].payload.starts_at)).toISOString()).toBe("2027-11-07T22:15:00.000Z");
  });

  it("normaliza a resposta do cliente para o telefone cadastrado e inclui o texto configurado", async () => {
    await db.query(`insert into public.whatsapp_automation_jobs(
      organization_id, connection_id, appointment_id, appointment_version, job_type,
      recipient_e164, payload, dedupe_key
    ) values (
      '${org}', '${connection}', '${appointment}', 1, 'CONFIRMATION_ACK_CLIENT',
      '+554791349093', '{}'::jsonb, 'ack-test'
    )`);

    const job = await db.query<{ recipient_e164: string; payload: Record<string, unknown> }>(
      `select recipient_e164, payload from public.whatsapp_automation_jobs where dedupe_key = 'ack-test'`,
    );
    expect(job.rows[0].recipient_e164).toBe("+5547991349093");
    expect(job.rows[0].payload).toMatchObject({
      customer_name: "adriana andrade",
      service_names: "Foto Estúdio — Oferta 1",
      barber_name: "Julio Heiden",
      templates: { CONFIRMATION_ACK_CLIENT: "Presença na sessão confirmada. Até {horario}." },
    });
  });

  it("mantém hidratação e resposta limitadas à mesma organização", () => {
    expect(migration).toContain("c.id = a.customer_id and c.organization_id = a.organization_id");
    expect(migration).toContain("b.id = a.barber_id and b.organization_id = a.organization_id");
    expect(migration).toContain("where a.id = new.appointment_id and a.organization_id = new.organization_id");
    expect(migration).toContain("public.whatsapp_v2_phone_matches(v_customer_phone, new.recipient_e164)");
    expect(migration).toContain("deferrable initially deferred");
  });
});
