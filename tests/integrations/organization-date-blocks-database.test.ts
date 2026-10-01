// @vitest-environment node
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";

let db: PGlite;
const org = "20000000-0000-4000-8000-000000000001";
const otherOrg = "20000000-0000-4000-8000-000000000002";
const user = "30000000-0000-4000-8000-000000000001";
const queueId = "40000000-0000-4000-8000-000000000001";

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth;
    create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.actor_id', true),'')::uuid$$;
    create table public.organizations(id uuid primary key, timezone text not null, slug text, queue_public_id uuid);
    create function public.is_organization_owner(p_organization_id uuid, p_user_id uuid default auth.uid()) returns boolean
      language sql stable as $$select p_user_id is not null and p_organization_id::text = current_setting('test.owner_org', true)$$;
    create table public.appointments(id uuid primary key default gen_random_uuid(), organization_id uuid not null references organizations(id), status text not null, hold_expires_at timestamptz, service_period tstzrange not null);
    create table public.walkin_queue_holds(id uuid primary key default gen_random_uuid(), organization_id uuid not null references organizations(id), service_period tstzrange not null, expires_at timestamptz not null, consumed_at timestamptz);
    create function public.get_available_slots(p_organization_slug text, p_barber_id uuid, p_local_date date, p_selections jsonb) returns jsonb
      language sql as $$select jsonb_build_object('slots', jsonb_build_array(jsonb_build_object(
        'starts_at', (p_local_date + time '10:00') at time zone 'UTC', 'ends_at', (p_local_date + time '10:30') at time zone 'UTC')))$$;
    create function public.get_walkin_queue_availability(p_queue_public_id uuid) returns jsonb
      language sql as $$select jsonb_build_object('slots', jsonb_build_array(jsonb_build_object(
        'starts_at', '2030-01-01 10:00:00+00', 'ends_at', '2030-01-01 10:30:00+00')))$$;
    insert into organizations values('${org}','UTC','org','${queueId}'),('${otherOrg}','UTC','other',null);
    set test.actor_id='${user}'; set test.owner_org='${org}';
  `);
  const directory = join(process.cwd(), "supabase/migrations");
  const file = readdirSync(directory).find((name) => name.endsWith("_organization_date_blocks.sql"));
  if (!file) throw new Error("Migration de bloqueios por data não encontrada.");
  await db.exec(readFileSync(join(directory, file), "utf8"));
}, 60_000);

afterAll(async () => { await db?.close(); });

async function save(input: {
  org?: string; id?: string | null; type: string; name?: string; date: string; endDate?: string | null;
  scope?: string | null; recurrence?: string | null; startTime?: string | null; endTime?: string | null;
}) {
  return db.query<{ save_organization_date_block: string }>("select public.save_organization_date_block($1,$2,$3,$4,null,$5,$6,$7,$8,$9,$10)", [
    input.org ?? org, input.id ?? null, input.type, input.name ?? "Fechado", input.scope ?? null,
    input.recurrence ?? null, input.date, input.endDate ?? null, input.startTime ?? null, input.endTime ?? null,
  ]);
}

describe("bloqueio de datas no PostgreSQL", () => {
  it("isola por tenant e repete feriado anual somente na data/mês existente", async () => {
    await save({ type: "HOLIDAY", date: "2028-02-29", scope: "FEDERAL", recurrence: "ANNUAL" });
    await expect(save({ org: otherOrg, type: "HOLIDAY", date: "2028-02-29", scope: "FEDERAL", recurrence: "YEAR" }))
      .rejects.toThrow("organization owner required");
    await expect(save({ type: "EVENT", date: "2028-02-29", startTime: "10:00", endTime: "11:00" }))
      .rejects.toThrow("date block overlaps an existing date block");
    expect((await db.query<{ blocked: boolean }>("select public.organization_date_blocked($1,tstzrange('2028-02-29 09:00+00','2028-02-29 10:00+00','[)')) blocked", [org])).rows[0].blocked).toBe(true);
    expect((await db.query<{ blocked: boolean }>("select public.organization_date_blocked($1,tstzrange('2027-02-28 09:00+00','2027-02-28 10:00+00','[)')) blocked", [org])).rows[0].blocked).toBe(false);
    expect((await db.query<{ blocked: boolean }>("select public.organization_date_blocked($1,tstzrange('2028-02-29 09:00+00','2028-02-29 10:00+00','[)')) blocked", [otherOrg])).rows[0].blocked).toBe(false);
  });

  it("bloqueia reservas dentro do horário do evento e permite horário adjacente", async () => {
    await save({ type: "EVENT", date: "2030-01-01", startTime: "10:00", endTime: "11:00" });
    await expect(db.query("insert into appointments(organization_id,status,service_period) values($1,'CONFIRMED',tstzrange('2030-01-01 10:30+00','2030-01-01 11:30+00','[)'))", [org]))
      .rejects.toThrow("requested date is blocked");
    await db.query("insert into appointments(organization_id,status,service_period) values($1,'CONFIRMED',tstzrange('2030-01-01 11:00+00','2030-01-01 11:30+00','[)'))", [org]);
    expect((await db.query<{ slots: unknown[] }>("select public.get_available_slots('org',gen_random_uuid(),'2030-01-01','{}')->'slots' slots")).rows[0].slots).toEqual([]);
    expect((await db.query<{ slots: unknown[] }>("select public.get_walkin_queue_availability($1)->'slots' slots", [queueId])).rows[0].slots).toEqual([]);
    await expect(db.query("insert into walkin_queue_holds(organization_id,service_period,expires_at) values($1,tstzrange('2030-01-01 10:00+00','2030-01-01 10:30+00','[)'),now()+interval '1 minute')", [org]))
      .rejects.toThrow("requested date is blocked");
  });

  it("recusa sobreposição com reservas ativas e permite reservas encerradas", async () => {
    await db.query("insert into appointments(organization_id,status,service_period) values($1,'CONFIRMED',tstzrange('2031-05-04 12:00+00','2031-05-04 12:30+00','[)'))", [org]);
    await expect(save({ type: "RECESS", date: "2031-05-04", endDate: "2031-05-05" })).rejects.toThrow("organization_date_block_conflict");
    await db.query("update appointments set status='COMPLETED'");
    await save({ type: "RECESS", date: "2031-05-04", endDate: "2031-05-05" });
    await expect(db.query("insert into appointments(organization_id,status,hold_expires_at,service_period) values($1,'HELD',now()+interval '3 minutes',tstzrange('2031-05-05 12:00+00','2031-05-05 12:30+00','[)'))", [org]))
      .rejects.toThrow("requested date is blocked");
  });

  it("ignora hold expirado ao criar bloqueio de período", async () => {
    await db.query("insert into appointments(organization_id,status,hold_expires_at,service_period) values($1,'HELD',now()-interval '1 minute',tstzrange('2032-03-08 12:00+00','2032-03-08 12:30+00','[)'))", [org]);
    await save({ type: "RECESS", date: "2032-03-08", endDate: "2032-03-08" });
  });

  it("exclui bloqueio somente dentro da organização autorizada", async () => {
    const saved = await save({ type: "EVENT", date: "2040-06-12", startTime: "10:00", endTime: "11:00" });
    const id = saved.rows[0].save_organization_date_block;
    await db.query("select public.delete_organization_date_block($1,$2)", [org, id]);
    expect((await db.query<{ blocked: boolean }>("select public.organization_date_blocked($1,tstzrange('2040-06-12 10:15+00','2040-06-12 10:30+00','[)')) blocked", [org])).rows[0].blocked).toBe(false);
  });

  it("recusa feriado anual se já houver reserva ativa em ocorrência futura", async () => {
    const year = new Date().getFullYear();
    const firstOccurrence = `${year + 5}-07-04`;
    const bookedOccurrence = `${year + 10}-07-04`;
    await db.query("insert into appointments(organization_id,status,service_period) values($1,'CONFIRMED',tstzrange(($2::date+time '12:00') at time zone 'UTC', ($2::date+time '12:30') at time zone 'UTC','[)'))", [org, bookedOccurrence]);
    await expect(save({ type: "HOLIDAY", date: firstOccurrence, scope: "STATE", recurrence: "ANNUAL" }))
      .rejects.toThrow("organization_date_block_conflict");
  });
});
