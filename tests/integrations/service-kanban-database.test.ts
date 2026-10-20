// @vitest-environment node
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const org = "20000000-0000-4000-8000-000000000001";
const manager = "30000000-0000-4000-8000-000000000001";
const barberUser = "30000000-0000-4000-8000-000000000002";
const barber = "40000000-0000-4000-8000-000000000001";
const secondBarber = "40000000-0000-4000-8000-000000000002";
const customer = "50000000-0000-4000-8000-000000000001";
const appointment = "60000000-0000-4000-8000-000000000001";
const projectAppointment = "60000000-0000-4000-8000-000000000002";
let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
    create table organizations(id uuid primary key);
    create table platform_modules(key text primary key,name text,description text,updated_at timestamptz default now());
    create table organization_module_entitlements(organization_id uuid references organizations(id),module_key text references platform_modules(key),enabled boolean,primary key(organization_id,module_key));
    create table barbers(id uuid primary key,organization_id uuid,auth_user_id uuid,active boolean,app_access_enabled boolean,display_name text,unique(id,organization_id));
    create table customers(id uuid primary key,organization_id uuid,full_name text,unique(id,organization_id));
    create table services(id uuid primary key,organization_id uuid,name text,unique(id,organization_id));
    create table appointments(id uuid primary key,organization_id uuid,customer_id uuid,barber_id uuid,status text,unique(id,organization_id));
    create table project_engagement_sessions(organization_id uuid,appointment_id uuid);
    create function public.is_organization_owner(p_organization_id uuid) returns boolean language sql stable security definer as $$
      select p_organization_id::text=current_setting('test.owner_org',true)
    $$;
    create function public.is_organization_barber(p_organization_id uuid) returns boolean language sql stable security definer as $$
      select exists(select 1 from barbers where organization_id=p_organization_id and auth_user_id=auth.uid() and active and app_access_enabled)
    $$;
    create function public.organization_module_enabled(p_organization_id uuid,p_module_key text) returns boolean language sql stable security definer as $$
      select exists(select 1 from organization_module_entitlements where organization_id=p_organization_id and module_key=p_module_key and enabled)
    $$;
    grant usage on schema auth to authenticated;
    grant select on barbers to authenticated;
    insert into auth.users values('${manager}'),('${barberUser}');
    insert into organizations values('${org}');
    insert into barbers values('${barber}','${org}','${barberUser}',true,true,'Primeiro'),('${secondBarber}','${org}',null,true,true,'Segundo');
    insert into customers values('${customer}','${org}','Cliente Exemplo');
    set test.actor='${manager}'; set test.owner_org='${org}';
  `);
  await db.exec(readFileSync("supabase/migrations/20261020121000_service_kanban.sql", "utf8"));
  await db.exec(`insert into organization_module_entitlements values('${org}','kanban',true)`);
}, 60_000);

afterAll(async () => { await db?.close(); });

describe("Kanban de atendimentos no PostgreSQL", () => {
  it("cria quadros iniciais e impede editar Aguardando", async () => {
    const boards = await db.query<{ name: string; position: number }>("select name,position from service_kanban_boards order by position");
    expect(boards.rows).toEqual([
      { name: "Aguardando", position: 0 }, { name: "À Fazer", position: 1 },
      { name: "Fazendo", position: 2 }, { name: "Feito", position: 3 },
    ]);
    const waiting = (await db.query<{ id: string }>("select id from service_kanban_boards where system_key='WAITING'")).rows[0].id;
    await expect(db.query("select save_service_kanban_board($1,$2,'Renomeado',null)", [org,waiting]))
      .rejects.toThrow("waiting board cannot be edited");
  });

  it("cria um card no início e ignora atendimento de Projetos", async () => {
    await db.exec(`insert into appointments values('${appointment}','${org}','${customer}','${barber}','CONFIRMED'),
      ('${projectAppointment}','${org}','${customer}','${barber}','CONFIRMED');
      insert into project_engagement_sessions values('${org}','${projectAppointment}');
      update appointments set status='IN_SERVICE' where id in ('${appointment}','${projectAppointment}');`);
    const cards = await db.query<{ appointment_id: string; responsible_barber_id: string }>("select appointment_id,responsible_barber_id from service_kanban_cards where appointment_id is not null");
    expect(cards.rows).toEqual([{ appointment_id: appointment, responsible_barber_id: barber }]);
    await db.exec(`update appointments set status='COMPLETED' where id='${appointment}';
      update appointments set status='IN_SERVICE' where id='${appointment}';`);
    expect((await db.query("select id from service_kanban_cards where appointment_id=$1", [appointment])).rows).toHaveLength(1);
  });

  it("move para responsável do quadro, retorna ao original e arquiva sem tocar na agenda", async () => {
    const card = (await db.query<{ id: string }>("select id from service_kanban_cards where appointment_id=$1", [appointment])).rows[0].id;
    const boards = (await db.query<{ id: string; position: number }>("select id,position from service_kanban_boards order by position")).rows;
    await expect(db.query("select mutate_service_kanban_card($1,$2,'MOVED',$3,null)", [org,card,boards[1].id]))
      .rejects.toThrow("destination board has no responsible professional");
    await db.query("select save_service_kanban_board($1,$2,'À Fazer',$3)", [org,boards[1].id,secondBarber]);
    await db.query("select mutate_service_kanban_card($1,$2,'MOVED',$3,null)", [org,card,boards[1].id]);
    expect((await db.query<{ responsible_barber_id: string }>("select responsible_barber_id from service_kanban_cards where id=$1", [card])).rows[0].responsible_barber_id).toBe(secondBarber);
    await db.query("select mutate_service_kanban_card($1,$2,'MOVED',$3,null)", [org,card,boards[0].id]);
    expect((await db.query<{ responsible_barber_id: string }>("select responsible_barber_id from service_kanban_cards where id=$1", [card])).rows[0].responsible_barber_id).toBe(barber);
    await db.query("select mutate_service_kanban_card($1,$2,'COMPLETED',null,null)", [org,card]);
    expect((await db.query<{ archived_at: string }>("select archived_at from service_kanban_cards where id=$1", [card])).rows[0].archived_at).toBeTruthy();
    expect((await db.query<{ status: string }>("select status from appointments where id=$1", [appointment])).rows[0].status).toBe("IN_SERVICE");
    await db.query("select mutate_service_kanban_card($1,$2,'REOPENED',null,null)", [org,card]);
    expect((await db.query<{ archived_at: string | null }>("select archived_at from service_kanban_cards where id=$1", [card])).rows[0].archived_at).toBeNull();
  });

  it("preserva cards na desativação e não cria card novo enquanto inativo", async () => {
    const before = (await db.query("select id from service_kanban_cards")).rows.length;
    const doneBoard = (await db.query<{ id: string }>("select id from service_kanban_boards where name='Feito'")).rows[0].id;
    await db.query("select delete_service_kanban_board($1,$2)", [org,doneBoard]);
    await db.exec(`update organization_module_entitlements set enabled=false where module_key='kanban';
      insert into appointments values(gen_random_uuid(),'${org}','${customer}','${barber}','CONFIRMED');
      update appointments set status='IN_SERVICE' where status='CONFIRMED';`);
    expect((await db.query("select id from service_kanban_cards")).rows).toHaveLength(before);
    await db.exec(`update organization_module_entitlements set enabled=true where module_key='kanban';`);
    expect((await db.query("select id from service_kanban_boards")).rows).toHaveLength(3);
    expect((await db.query("select id from service_kanban_cards")).rows).toHaveLength(before);
  });

  it("profissional consulta somente os próprios cards ativos", async () => {
    const otherCard = (await db.query<{ create_manual_service_kanban_card: string }>("select create_manual_service_kanban_card($1,'Card de outro profissional',$2,null,null)", [org,secondBarber])).rows[0].create_manual_service_kanban_card;
    await db.exec(`set test.actor='${barberUser}'; set test.owner_org=''; set role authenticated;`);
    const visible = await db.query<{ id: string; appointment_id: string | null }>("select id,appointment_id from service_kanban_cards");
    expect(visible.rows.map((item) => item.appointment_id)).toEqual([appointment]);
    await expect(db.query("select mutate_service_kanban_card($1,$2,'COMPLETED',null,null)", [org,otherCard]))
      .rejects.toThrow("kanban card access denied");
    await db.query("select mutate_service_kanban_card($1,$2,'COMPLETED',null,null)", [org,visible.rows[0].id]);
    expect((await db.query("select id from service_kanban_cards")).rows).toHaveLength(0);
    await db.exec(`reset role; set test.actor='${manager}'; set test.owner_org='${org}';`);
  });
});
