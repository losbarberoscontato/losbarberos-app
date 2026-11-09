// @vitest-environment node
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const organization = "10000000-0000-4000-8000-000000000001";
const otherOrganization = "10000000-0000-4000-8000-000000000002";
const actor = "20000000-0000-4000-8000-000000000001";
const otherActor = "20000000-0000-4000-8000-000000000002";
const customer = "30000000-0000-4000-8000-000000000001";
const plan = "40000000-0000-4000-8000-000000000001";
const version = "50000000-0000-4000-8000-000000000001";
const subscription = "60000000-0000-4000-8000-000000000001";
const session = "70000000-0000-4000-8000-000000000001";
const hiddenService = "80000000-0000-4000-8000-000000000001";
const secondService = "80000000-0000-4000-8000-000000000002";
const eligibleBarber = "90000000-0000-4000-8000-000000000001";
const partialBarber = "90000000-0000-4000-8000-000000000002";
const inactiveBarber = "90000000-0000-4000-8000-000000000003";
const unrelatedBarber = "90000000-0000-4000-8000-000000000004";
let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('test.actor', true), '')::uuid
    $$;
    create table public.customers (
      id uuid primary key,
      organization_id uuid not null,
      auth_user_id uuid not null,
      active boolean not null default true,
      merged_into_customer_id uuid
    );
    create function public.is_organization_customer(p_organization_id uuid, p_customer_id uuid, p_user_id uuid default auth.uid())
    returns boolean language sql stable security definer set search_path = public as $$
      select p_user_id is not null and exists (
        select 1 from public.customers
        where organization_id = p_organization_id and id = p_customer_id
          and auth_user_id = p_user_id and active and merged_into_customer_id is null
      )
    $$;
    create table public.customer_subscription_sessions (
      id uuid primary key, organization_id uuid not null, subscription_id uuid not null, status text not null
    );
    create table public.customer_subscriptions (
      id uuid primary key, organization_id uuid not null, customer_id uuid not null,
      plan_id uuid not null, plan_version_id uuid not null, status text not null
    );
    create table public.subscription_plan_services (
      organization_id uuid not null, plan_version_id uuid not null, service_id uuid not null,
      position integer not null, service_name_snapshot text not null,
      list_price_cents_snapshot bigint not null, duration_minutes_snapshot integer not null
    );
    create table public.services (
      id uuid primary key, organization_id uuid not null, name text not null,
      description text, active boolean not null, availability text not null
    );
    create table public.barbers (
      id uuid primary key, organization_id uuid not null, display_name text not null,
      bio text, avatar_url text, active boolean not null
    );
    create table public.barber_subscription_plans (
      organization_id uuid not null, barber_id uuid not null, plan_id uuid not null, active boolean not null
    );
    create table public.barber_services (
      organization_id uuid not null, barber_id uuid not null, service_id uuid not null, active boolean not null
    );
  `);
  await db.exec(readFileSync("supabase/migrations/20261109015712_get_customer_subscription_booking_context.sql", "utf8"));
}, 60_000);

afterAll(async () => db.close());

beforeEach(async () => {
  await db.exec(`
    truncate public.customer_subscription_sessions, public.customer_subscriptions,
      public.subscription_plan_services, public.services, public.barber_subscription_plans,
      public.barber_services, public.barbers, public.customers cascade;
    insert into public.customers values
      ('${customer}', '${organization}', '${actor}', true, null),
      ('30000000-0000-4000-8000-000000000002', '${otherOrganization}', '${otherActor}', true, null);
    insert into public.services values
      ('${hiddenService}', '${organization}', 'Acompanhamento mensal', null, true, 'HIDDEN'),
      ('${secondService}', '${organization}', 'Retrato', null, true, 'CLIENT');
    insert into public.subscription_plan_services values
      ('${organization}', '${version}', '${hiddenService}', 0, 'Acompanhamento mensal', 34900, 60),
      ('${organization}', '${version}', '${secondService}', 1, 'Retrato', 20000, 30);
    insert into public.customer_subscriptions values
      ('${subscription}', '${organization}', '${customer}', '${plan}', '${version}', 'ACTIVE');
    insert into public.customer_subscription_sessions values
      ('${session}', '${organization}', '${subscription}', 'AVAILABLE');
    insert into public.barbers values
      ('${eligibleBarber}', '${organization}', 'Mariana', null, null, true),
      ('${partialBarber}', '${organization}', 'Paula', null, null, true),
      ('${inactiveBarber}', '${organization}', 'Clara', null, null, false),
      ('${unrelatedBarber}', '${organization}', 'Bia', null, null, true);
    insert into public.barber_subscription_plans values
      ('${organization}', '${eligibleBarber}', '${plan}', true),
      ('${organization}', '${partialBarber}', '${plan}', true),
      ('${organization}', '${inactiveBarber}', '${plan}', true);
    insert into public.barber_services values
      ('${organization}', '${eligibleBarber}', '${hiddenService}', true),
      ('${organization}', '${eligibleBarber}', '${secondService}', true),
      ('${organization}', '${partialBarber}', '${hiddenService}', true),
      ('${organization}', '${inactiveBarber}', '${hiddenService}', true),
      ('${organization}', '${inactiveBarber}', '${secondService}', true),
      ('${organization}', '${unrelatedBarber}', '${hiddenService}', true),
      ('${organization}', '${unrelatedBarber}', '${secondService}', true);
    set test.actor='${actor}';
  `);
});

describe("customer subscription booking context", () => {
  it("limits execution to authenticated users", async () => {
    const result = await db.query<{ anon: boolean; authenticated: boolean }>(`
      select has_function_privilege('anon', 'public.get_customer_subscription_booking_context(uuid,uuid,uuid)', 'execute') as anon,
             has_function_privilege('authenticated', 'public.get_customer_subscription_booking_context(uuid,uuid,uuid)', 'execute') as authenticated
    `);

    expect(result.rows[0]).toEqual({ anon: false, authenticated: true });
  });

  it("returns hidden plan services and only active professionals enabled for all services and the plan", async () => {
    const result = await db.query<{ context: { plan_id: string; services: Array<{ id: string; name: string }>; barbers: Array<{ id: string; name: string; service_ids: string[] }> } }>(
      "select public.get_customer_subscription_booking_context($1, $2, $3) as context",
      [organization, customer, session],
    );

    expect(result.rows[0].context.plan_id).toBe(plan);
    expect(result.rows[0].context.services).toEqual([
      { id: hiddenService, name: "Acompanhamento mensal", description: null, price_cents: 34900, duration_minutes: 60 },
      { id: secondService, name: "Retrato", description: null, price_cents: 20000, duration_minutes: 30 },
    ]);
    expect(result.rows[0].context.barbers).toEqual([{
      id: eligibleBarber,
      name: "Mariana",
      bio: null,
      avatar_url: null,
      service_ids: [hiddenService, secondService],
      subscription_plan_ids: [plan],
    }]);
  });

  it("denies another customer and sessions from another organization", async () => {
    await expect(db.query(
      "select public.get_customer_subscription_booking_context($1, $2, $3)",
      [organization, "30000000-0000-4000-8000-000000000002", session],
    )).rejects.toThrow("customer booking denied");

    await expect(db.query(
      "select public.get_customer_subscription_booking_context($1, $2, $3)",
      [otherOrganization, customer, session],
    )).rejects.toThrow("customer booking denied");
  });
});
