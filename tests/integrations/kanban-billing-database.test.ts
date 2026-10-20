// @vitest-environment node
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const org = "20000000-0000-4000-8000-000000000001";
const actor = "30000000-0000-4000-8000-000000000001";
let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
    create function auth.role() returns text language sql as $$select current_setting('request.jwt.claim.role',true)$$;
    create function public.is_platform_admin() returns boolean language sql stable as $$select current_setting('test.platform_admin',true)='true'$$;
    create function public.is_organization_owner(p_org uuid,p_user uuid default auth.uid()) returns boolean language sql stable as $$select p_org::text=current_setting('test.owner_org',true) and p_user=auth.uid()$$;
    create function public.require_service_role() returns void language plpgsql as $$begin
      if auth.role()<>'service_role' then raise exception 'service role required'; end if; end$$;
    create table organizations(id uuid primary key);
    create table organization_product_assignments(organization_id uuid primary key,product_key text);
    create table saas_subscriptions(organization_id uuid primary key,stripe_subscription_id text,stripe_price_id text,status text,current_period_ends_at timestamptz);
    create table organization_module_entitlements(organization_id uuid,module_key text,enabled boolean,changed_by uuid,changed_at timestamptz,
      billing_change_action text,billing_change_effective_at timestamptz,billing_sync_status text,primary key(organization_id,module_key));
    create table organization_module_events(organization_id uuid,module_key text,from_enabled boolean,to_enabled boolean,reason text,actor_user_id uuid);
    create table webhook_events(provider text,event_type text,payload jsonb,provider_created_at timestamptz,created_at timestamptz default now());
    create function public.process_stripe_billing_webhook(text,text,timestamptz,boolean,text,timestamptz,jsonb)
    returns jsonb language plpgsql as $$begin
      if ($7->>'current_period_end') ~ '^[0-9]+$' then
        update saas_subscriptions set current_period_ends_at=to_timestamp(($7->>'current_period_end')::double precision)
        where stripe_subscription_id=$7->>'id';
      end if;
      return jsonb_build_object('applied',$1<>'evt_stale','base_price',$7 #>> '{items,data,0,price,id}','period_end',$7->>'current_period_end');
    end$$;
    insert into auth.users values('${actor}');
    insert into organizations values('${org}');
    insert into organization_product_assignments values('${org}','los-barberos');
    insert into saas_subscriptions values('${org}','sub_test','price_base','ACTIVE',null);
    insert into webhook_events(provider,event_type,payload,provider_created_at) values(
      'STRIPE','customer.subscription.updated',
      '{"id":"sub_test","items":{"data":[{"id":"si_base","price":{"id":"price_base"},"current_period_end":1794588157}]}}'::jsonb,
      now()
    );
    set test.actor='${actor}'; set test.owner_org='${org}'; set test.platform_admin='true';
    set request.jwt.claim.role='authenticated';
  `);
  await db.exec(readFileSync("supabase/migrations/20261020122000_kanban_billing.sql", "utf8"));
  await db.exec(readFileSync("supabase/migrations/20261020222527_fix_stripe_item_period_end.sql", "utf8"));
}, 60_000);

afterAll(async () => { await db?.close(); });

describe("faturamento Kanban no PostgreSQL", () => {
  it("recupera o ciclo dos eventos salvos e normaliza webhooks de item Stripe", async () => {
    const backfilled = await db.query<{ period_end: string }>(
      "select extract(epoch from current_period_ends_at)::bigint::text as period_end from saas_subscriptions where organization_id=$1",
      [org],
    );
    expect(backfilled.rows[0].period_end).toBe("1794588157");

    await db.query("update saas_subscriptions set current_period_ends_at=null where organization_id=$1", [org]);
    await db.exec("set request.jwt.claim.role='service_role'");
    const payload = {
      id: "sub_test",
      items: { data: [
        { id: "si_module", price: { id: "price_module" }, current_period_end: 1800000000 },
        { id: "si_base", price: { id: "price_base" }, current_period_end: 1795000000 },
      ] },
    };
    const result = await db.query<{ process_stripe_billing_webhook: { base_price: string; period_end: string } }>(
      "select process_stripe_billing_webhook('evt_item_period','customer.subscription.updated',now(),false,'ACTIVE',null,$1::jsonb)",
      [JSON.stringify(payload)],
    );
    expect(result.rows[0].process_stripe_billing_webhook.base_price).toBe("price_base");
    expect(result.rows[0].process_stripe_billing_webhook.period_end).toBe("1795000000");
    const persisted = await db.query<{ period_end: string }>(
      "select extract(epoch from current_period_ends_at)::bigint::text as period_end from saas_subscriptions where organization_id=$1",
      [org],
    );
    expect(persisted.rows[0].period_end).toBe("1795000000");
    await db.exec("set request.jwt.claim.role='authenticated'");
  });

  it("exige catálogo completo e bloqueia ativação direta", async () => {
    await expect(db.query("select publish_platform_kanban_price('los-barberos',1000,'','price_live','v1','Texto completo do aditivo publicado')"))
      .rejects.toThrow("complete Kanban price");
    await db.query("select publish_platform_kanban_price('los-barberos',1900,'price_test','price_live','v1','Aditivo mensal do Kanban para este produto.')");
    await expect(db.query("insert into organization_module_entitlements values($1,'kanban',true,null,now(),null,null,null)", [org]))
      .rejects.toThrow("Kanban billing synchronization required");
    await db.query("insert into organization_module_entitlements values($1,'projects',true,null,now(),null,null,null)", [org]);
    await expect(db.query("update organization_module_entitlements set module_key='kanban' where module_key='projects'"))
      .rejects.toThrow("Kanban billing synchronization required");
  });

  it("só ativa após operação concluída e conserva preço contratado", async () => {
    await db.exec("set request.jwt.claim.role='service_role'");
    const started = await db.query<{ begin_kanban_billing_change: { operation_id: string; price_id: string } }>(
      "select begin_kanban_billing_change($1,'ENABLE','enable-request-1',$2,false,'v1')", [org,actor]);
    const context = started.rows[0].begin_kanban_billing_change;
    expect(context.price_id).toBe("price_test");
    const retry = await db.query<{ begin_kanban_billing_change: { operation_id: string } }>(
      "select begin_kanban_billing_change($1,'ENABLE','different-retry-key',$2,false,'v1')", [org,actor]);
    expect(retry.rows[0].begin_kanban_billing_change.operation_id).toBe(context.operation_id);
    expect((await db.query("select enabled from organization_module_entitlements where module_key='kanban'")).rows).toHaveLength(0);
    await db.query("select finish_kanban_billing_change($1,'si_test')", [context.operation_id]);
    expect((await db.query<{ enabled: boolean }>("select enabled from organization_module_entitlements where module_key='kanban'")).rows[0].enabled).toBe(true);
    await db.exec("set request.jwt.claim.role='authenticated'");
    await db.query("select publish_platform_kanban_price('los-barberos',2900,'price_test_new','price_live_new','v2','Novo aditivo mensal do Kanban para este produto.')");
    const price = await db.query<{ monthly_price_cents: number }>("select price.monthly_price_cents from organization_kanban_billing billing join platform_kanban_price_versions price on price.id=billing.price_version_id where billing.organization_id=$1", [org]);
    expect(price.rows[0].monthly_price_cents).toBe(1900);
  });

  it("encontra o preço base fora da primeira posição no webhook", async () => {
    await db.exec("set request.jwt.claim.role='service_role'");
    const payload = {
      id: "sub_test", items: { data: [
        { id: "si_test", price: { id: "price_test" } },
        { id: "si_base", price: { id: "price_base" } },
      ] },
    };
    const result = await db.query<{ process_stripe_billing_webhook: { base_price: string } }>(
      "select process_stripe_billing_webhook('evt_1','customer.subscription.updated',now(),false,'ACTIVE',null,$1::jsonb)", [JSON.stringify(payload)]);
    expect(result.rows[0].process_stripe_billing_webhook.base_price).toBe("price_base");
    const stalePayload = { ...payload, items: { data: [
      { id: "si_other", price: { id: "price_test" } },
      { id: "si_base", price: { id: "price_base" } },
    ] } };
    await db.query("select process_stripe_billing_webhook('evt_stale','customer.subscription.updated',now(),false,'ACTIVE',null,$1::jsonb)", [JSON.stringify(stalePayload)]);
    expect((await db.query<{ stripe_subscription_item_id: string }>("select stripe_subscription_item_id from organization_kanban_billing where organization_id=$1", [org])).rows[0].stripe_subscription_item_id).toBe("si_test");
  });

  it("desativa sem apagar o registro contratado", async () => {
    await db.exec("set request.jwt.claim.role='service_role'");
    const started = await db.query<{ begin_kanban_billing_change: { operation_id: string; price_id: string } }>(
      "select begin_kanban_billing_change($1,'DISABLE','disable-request-1',$2,false,null)", [org,actor]);
    expect(started.rows[0].begin_kanban_billing_change.price_id).toBe("price_test");
    expect((await db.query<{ enabled: boolean }>("select enabled from organization_module_entitlements where module_key='kanban'")).rows[0].enabled).toBe(true);
    await db.query("select finish_kanban_billing_change($1,null)", [started.rows[0].begin_kanban_billing_change.operation_id]);
    expect((await db.query<{ enabled: boolean }>("select enabled from organization_module_entitlements where module_key='kanban'")).rows[0].enabled).toBe(false);
    expect((await db.query("select price_version_id from organization_kanban_billing where organization_id=$1", [org])).rows).toHaveLength(1);
  });

  it("em trial, prepara nova ativação pelo preço atual e mantém a data do primeiro ciclo", async () => {
    await db.exec("update saas_subscriptions set status='TRIALING' where organization_id='" + org + "'; set request.jwt.claim.role='service_role'");
    const started = await db.query<{ begin_kanban_billing_change: { operation_id: string; price_id: string; charge_starts_at: string } }>(
      "select begin_kanban_billing_change($1,'ENABLE','trial-enable-request',$2,false,'v2')", [org,actor]);
    expect(started.rows[0].begin_kanban_billing_change.price_id).toBe("price_test_new");
    expect(started.rows[0].begin_kanban_billing_change.charge_starts_at).toBeTruthy();
    await db.query("select finish_kanban_billing_change($1,'si_trial')", [started.rows[0].begin_kanban_billing_change.operation_id]);
    expect((await db.query<{ enabled: boolean }>("select enabled from organization_module_entitlements where module_key='kanban'")).rows[0].enabled).toBe(true);
  });
});
