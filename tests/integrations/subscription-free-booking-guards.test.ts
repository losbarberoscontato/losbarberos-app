// @vitest-environment node
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const org = "20000000-0000-4000-8000-000000000001";
const otherOrg = "20000000-0000-4000-8000-000000000002";
const actor = "30000000-0000-4000-8000-000000000001";
const customer = "40000000-0000-4000-8000-000000000001";
const barber = "50000000-0000-4000-8000-000000000001";
const plan = "60000000-0000-4000-8000-000000000001";
const version = "70000000-0000-4000-8000-000000000001";
const subscription = "80000000-0000-4000-8000-000000000001";
const cycle = "90000000-0000-4000-8000-000000000001";
const first = "a0000000-0000-4000-8000-000000000001";
const second = "a0000000-0000-4000-8000-000000000002";
let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth; create schema extensions;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
    create table public.organizations(id uuid primary key,timezone text not null);
    create table public.customers(id uuid primary key,organization_id uuid,unique(id,organization_id));
    create table public.barbers(id uuid primary key,organization_id uuid,unique(id,organization_id));
    create table public.subscription_plans(id uuid primary key,organization_id uuid,scheduling_mode text,unique(id,organization_id));
    create table public.subscription_plan_versions(id uuid primary key,organization_id uuid,plan_id uuid,unique(id,organization_id));
    create table public.customer_subscriptions(id uuid primary key,organization_id uuid,customer_id uuid,plan_id uuid,plan_version_id uuid,status text,unique(id,organization_id));
    create table public.customer_subscription_cycles(id uuid primary key,organization_id uuid,subscription_id uuid,cycle_number integer,due_on date,status text);
    create type public.subscription_session_status as enum('AVAILABLE','SCHEDULED','COMPLETED','CONSUMED','CANCELED');
    create table public.customer_subscription_sessions(id uuid primary key,organization_id uuid,subscription_id uuid,cycle_id uuid,session_number integer,status public.subscription_session_status,unique(id,organization_id));
    create table public.barber_subscription_plans(organization_id uuid,barber_id uuid,plan_id uuid,active boolean);
    create function public.is_organization_owner(p_organization_id uuid) returns boolean language sql stable as $$select p_organization_id::text=current_setting('test.owner_org',true)$$;
    create function public.book_customer_subscription_session_before_catalog_commissions(uuid,uuid,uuid,uuid,timestamptz)
    returns jsonb language plpgsql as $$begin
      update public.customer_subscription_sessions set status='SCHEDULED' where id=$3 and status='AVAILABLE';
      if not found then raise exception 'session unavailable'; end if;
      return jsonb_build_object('session_id',$3);
    end$$;
  `);
  await db.exec(readFileSync("supabase/migrations/20261020120000_subscription_free_booking_guards.sql", "utf8"));
}, 60_000);

beforeEach(async () => {
  await db.exec(`
    truncate public.subscription_overdue_booking_overrides,public.customer_subscription_sessions,
      public.customer_subscription_cycles,public.customer_subscriptions,public.subscription_plan_versions,
      public.subscription_plans,public.barber_subscription_plans,public.barbers,public.customers,
      public.organizations,auth.users cascade;
    insert into auth.users values('${actor}');
    insert into organizations values('${org}','UTC'),('${otherOrg}','UTC');
    insert into customers values('${customer}','${org}');
    insert into barbers values('${barber}','${org}');
    insert into subscription_plans values('${plan}','${org}','FREE');
    insert into subscription_plan_versions values('${version}','${org}','${plan}');
    insert into customer_subscriptions values('${subscription}','${org}','${customer}','${plan}','${version}','ACTIVE');
    insert into customer_subscription_cycles values('${cycle}','${org}','${subscription}',1,current_date+1,'OPEN');
    insert into customer_subscription_sessions values('${first}','${org}','${subscription}','${cycle}',1,'AVAILABLE'),
      ('${second}','${org}','${subscription}','${cycle}',2,'AVAILABLE');
    insert into barber_subscription_plans values('${org}','${barber}','${plan}',true);
    set test.actor='${actor}'; set test.owner_org='${org}';
  `);
});

afterAll(async () => { await db?.close(); });

async function book(sessionId: string, reason?: string, tenant = org) {
  return db.query("select public." + (reason ? "book_customer_subscription_session_with_overdue_override" : "book_customer_subscription_session") +
    (reason ? "($1,$2,$3,$4,now()+interval '1 day',$5)" : "($1,$2,$3,$4,now()+interval '1 day')"),
  reason ? [tenant,customer,sessionId,barber,reason] : [tenant,customer,sessionId,barber]);
}

describe("agendamento livre de assinatura no PostgreSQL", () => {
  it("bloqueia qualquer parcela vencida e registra exceção somente após agendar", async () => {
    await db.exec(`update customer_subscription_cycles set due_on=current_date-1`);
    await expect(book(first)).rejects.toThrow("subscription_overdue_installment");
    expect((await db.query("select id from subscription_overdue_booking_overrides")).rows).toHaveLength(0);
    await book(first, "Cliente acertará a parcela no balcão");
    const audit = await db.query<{ reason: string; actor_user_id: string }>("select reason,actor_user_id from subscription_overdue_booking_overrides");
    expect(audit.rows).toEqual([{ reason: "Cliente acertará a parcela no balcão", actor_user_id: actor }]);
  });

  it("não libera a sessão seguinte até concluir ou consumir a anterior", async () => {
    await expect(book(second)).rejects.toThrow("previous_subscription_session_not_finished");
    await book(first);
    await expect(book(second)).rejects.toThrow("previous_subscription_session_not_finished");
    await db.exec(`update customer_subscription_sessions set status='COMPLETED' where id='${first}'`);
    await book(second);
  });

  it("mantém pendente a sessão cancelada no prazo e preserva agenda fixa", async () => {
    await db.exec(`update customer_subscription_sessions set status='AVAILABLE' where id='${first}'`);
    await expect(book(second)).rejects.toThrow("previous_subscription_session_not_finished");
    await db.exec(`update subscription_plans set scheduling_mode='FIXED'`);
    await book(second);
  });

  it("impede exceção por outro tenant ou por quem não é gestor", async () => {
    await db.exec(`update customer_subscription_cycles set due_on=current_date-1; set test.owner_org='${otherOrg}';`);
    await expect(book(first, "Motivo válido de exceção")).rejects.toThrow("manager overdue override required");
    await db.exec(`set test.owner_org='${otherOrg}'`);
    await expect(book(first, "Motivo válido de exceção", otherOrg)).rejects.toThrow("subscription session not found");
  });
});
