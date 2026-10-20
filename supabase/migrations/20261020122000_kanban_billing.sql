-- Product-specific published Kanban prices and immutable accepted terms.
create table public.platform_kanban_price_versions (
  id uuid primary key default gen_random_uuid(),
  product_key text not null check (product_key in ('los-barberos','le-gras','pro-stetic','music-pro')),
  monthly_price_cents bigint not null check (monthly_price_cents > 0),
  stripe_test_price_id text not null check (left(stripe_test_price_id,6)='price_'),
  stripe_live_price_id text not null check (left(stripe_live_price_id,6)='price_'),
  contract_version text not null check (char_length(btrim(contract_version)) between 1 and 80),
  contract_body text not null check (char_length(btrim(contract_body)) >= 20),
  published_at timestamptz not null default now(),
  retired_at timestamptz,
  created_by uuid not null references auth.users(id),
  unique (id, product_key)
);
create unique index platform_kanban_current_price on public.platform_kanban_price_versions(product_key) where retired_at is null;
alter table public.platform_kanban_price_versions enable row level security;
alter table public.platform_kanban_price_versions force row level security;
create policy platform_kanban_price_read on public.platform_kanban_price_versions for select to authenticated
using (public.is_platform_admin() or retired_at is null);
grant select on public.platform_kanban_price_versions to authenticated;

create function public.publish_platform_kanban_price(p_product_key text,p_monthly_price_cents bigint,p_stripe_test_price_id text,p_stripe_live_price_id text,p_contract_version text,p_contract_body text)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare v_id uuid;
begin
  if not public.is_platform_admin() then raise exception using errcode='42501',message='platform admin required'; end if;
  if p_product_key not in ('los-barberos','le-gras','pro-stetic','music-pro') or p_monthly_price_cents <= 0
     or left(coalesce(p_stripe_test_price_id,''),6)<>'price_' or left(coalesce(p_stripe_live_price_id,''),6)<>'price_'
     or char_length(btrim(coalesce(p_contract_body,''))) < 20 then
    raise exception using errcode='22023',message='complete Kanban price, Stripe IDs and addendum required'; end if;
  update public.platform_kanban_price_versions set retired_at=now() where product_key=p_product_key and retired_at is null;
  insert into public.platform_kanban_price_versions(product_key,monthly_price_cents,stripe_test_price_id,stripe_live_price_id,contract_version,contract_body,created_by)
  values(p_product_key,p_monthly_price_cents,btrim(p_stripe_test_price_id),btrim(p_stripe_live_price_id),btrim(p_contract_version),btrim(p_contract_body),auth.uid()) returning id into v_id;
  return v_id;
end $$;
revoke all on function public.publish_platform_kanban_price(text,bigint,text,text,text,text) from public,anon;
grant execute on function public.publish_platform_kanban_price(text,bigint,text,text,text,text) to authenticated;

create table public.organization_kanban_billing (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  price_version_id uuid not null references public.platform_kanban_price_versions(id),
  stripe_subscription_item_id text,
  accepted_by uuid not null references auth.users(id),
  accepted_at timestamptz not null,
  charge_starts_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.organization_kanban_billing enable row level security;
alter table public.organization_kanban_billing force row level security;
create policy organization_kanban_billing_owner_read on public.organization_kanban_billing for select to authenticated
using (public.is_organization_owner(organization_id) or public.is_platform_admin());
grant select on public.organization_kanban_billing to authenticated;
drop policy platform_kanban_price_read on public.platform_kanban_price_versions;
create policy platform_kanban_price_read on public.platform_kanban_price_versions for select to authenticated
using (public.is_platform_admin() or retired_at is null or exists (
  select 1 from public.organization_kanban_billing billing
  where billing.price_version_id=id and public.is_organization_owner(billing.organization_id)
));

create table public.kanban_billing_operations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  action text not null check (action in ('ENABLE','DISABLE')),
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 200),
  status text not null default 'PENDING' check (status in ('PENDING','COMPLETED')),
  price_version_id uuid references public.platform_kanban_price_versions(id),
  actor_user_id uuid not null references auth.users(id),
  stripe_subscription_item_id text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (organization_id,idempotency_key)
);
create unique index kanban_one_pending_operation on public.kanban_billing_operations(organization_id) where status='PENDING';
alter table public.kanban_billing_operations enable row level security;
alter table public.kanban_billing_operations force row level security;
create policy kanban_billing_operations_owner_read on public.kanban_billing_operations for select to authenticated
using (public.is_organization_owner(organization_id) or public.is_platform_admin());
grant select on public.kanban_billing_operations to authenticated;

-- Browser RPCs cannot activate or deactivate this paid module. The Edge function
-- changes entitlement only after Stripe confirms its subscription-item mutation.
create function public.guard_paid_kanban_entitlement() returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  if ((tg_op='DELETE' and old.module_key='kanban')
      or (tg_op<>'DELETE' and (new.module_key='kanban' or (tg_op='UPDATE' and old.module_key='kanban'))))
     and coalesce(auth.role(),'') <> 'service_role' then
    raise exception using errcode='42501',message='Kanban billing synchronization required'; end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
create trigger guard_paid_kanban_entitlement before insert or update or delete on public.organization_module_entitlements
for each row execute function public.guard_paid_kanban_entitlement();

create function public.begin_kanban_billing_change(p_organization_id uuid,p_action text,p_idempotency_key text,p_actor_user_id uuid,p_livemode boolean,p_contract_version text default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_sub public.saas_subscriptions; v_enabled boolean; v_op public.kanban_billing_operations; v_price public.platform_kanban_price_versions; v_price_id uuid; v_product text; v_item text;
begin
  perform public.require_service_role();
  if not public.is_organization_owner(p_organization_id,p_actor_user_id) then raise exception using errcode='42501',message='manager required'; end if;
  if p_action not in ('ENABLE','DISABLE') or char_length(coalesce(p_idempotency_key,'')) not between 8 and 200 then
    raise exception using errcode='22023',message='invalid Kanban billing request'; end if;
  select * into strict v_sub from public.saas_subscriptions where organization_id=p_organization_id for update;
  if v_sub.stripe_subscription_id is null or v_sub.status not in ('TRIALING','ACTIVE') then
    raise exception using errcode='22023',message='active Stripe subscription required'; end if;
  if v_sub.current_period_ends_at is null then
    raise exception using errcode='22023',message='next Stripe billing date unavailable'; end if;
  select enabled into v_enabled from public.organization_module_entitlements where organization_id=p_organization_id and module_key='kanban';
  if (p_action='ENABLE' and coalesce(v_enabled,false)) or (p_action='DISABLE' and not coalesce(v_enabled,false)) then
    return jsonb_build_object('already_done',true,'enabled',coalesce(v_enabled,false)); end if;
  select * into v_op from public.kanban_billing_operations where organization_id=p_organization_id and status='PENDING' for update;
  if v_op.id is not null and v_op.action <> p_action then raise exception using errcode='40001',message='another Kanban billing change is pending'; end if;
  if v_op.id is null then
    if p_action='ENABLE' then
      select a.product_key into strict v_product from public.organization_product_assignments a where a.organization_id=p_organization_id;
      select * into strict v_price from public.platform_kanban_price_versions where product_key=v_product and retired_at is null;
      if p_contract_version is distinct from v_price.contract_version then
        raise exception using errcode='22023',message='current Kanban addendum acceptance required'; end if;
    else
      select b.price_version_id,b.stripe_subscription_item_id into v_price_id,v_item
      from public.organization_kanban_billing b where b.organization_id=p_organization_id;
      if v_price_id is null then raise exception using errcode='P0002',message='Kanban billing record missing'; end if;
      select * into v_price from public.platform_kanban_price_versions where id=v_price_id;
    end if;
    insert into public.kanban_billing_operations(organization_id,action,idempotency_key,price_version_id,actor_user_id)
    values(p_organization_id,p_action,p_idempotency_key,v_price.id,p_actor_user_id) returning * into v_op;
  else
    select * into v_price from public.platform_kanban_price_versions where id=v_op.price_version_id;
    select stripe_subscription_item_id into v_item from public.organization_kanban_billing where organization_id=p_organization_id;
  end if;
  return jsonb_build_object('operation_id',v_op.id,'action',v_op.action,'idempotency_key',v_op.idempotency_key,
    'subscription_id',v_sub.stripe_subscription_id,'base_price_id',v_sub.stripe_price_id,
    'price_id',case when p_livemode then v_price.stripe_live_price_id else v_price.stripe_test_price_id end,
    'existing_item_id',v_item,'charge_starts_at',v_sub.current_period_ends_at,
    'monthly_price_cents',v_price.monthly_price_cents,'contract_version',v_price.contract_version);
end $$;

create function public.finish_kanban_billing_change(p_operation_id uuid,p_stripe_subscription_item_id text)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare v_op public.kanban_billing_operations; v_old boolean; v_period_end timestamptz;
begin
  perform public.require_service_role();
  select * into strict v_op from public.kanban_billing_operations where id=p_operation_id for update;
  if v_op.status='COMPLETED' then return true; end if;
  if v_op.action='ENABLE' and nullif(p_stripe_subscription_item_id,'') is null then
    raise exception using errcode='22023',message='Stripe subscription item required'; end if;
  select enabled into v_old from public.organization_module_entitlements where organization_id=v_op.organization_id and module_key='kanban' for update;
  select current_period_ends_at into v_period_end from public.saas_subscriptions where organization_id=v_op.organization_id;
  if v_op.action='ENABLE' then
    insert into public.organization_kanban_billing(organization_id,price_version_id,stripe_subscription_item_id,accepted_by,accepted_at,charge_starts_at)
    values(v_op.organization_id,v_op.price_version_id,p_stripe_subscription_item_id,v_op.actor_user_id,now(),v_period_end)
    on conflict (organization_id) do update set price_version_id=excluded.price_version_id,
      stripe_subscription_item_id=excluded.stripe_subscription_item_id,accepted_by=excluded.accepted_by,
      accepted_at=excluded.accepted_at,charge_starts_at=excluded.charge_starts_at,updated_at=now();
  else
    update public.organization_kanban_billing set stripe_subscription_item_id=null,updated_at=now()
    where organization_id=v_op.organization_id;
  end if;
  insert into public.organization_module_entitlements(organization_id,module_key,enabled,changed_by,changed_at,billing_change_action,billing_change_effective_at,billing_sync_status)
  values(v_op.organization_id,'kanban',v_op.action='ENABLE',v_op.actor_user_id,now(),
    case when v_op.action='ENABLE' then 'ADD' else 'REMOVE' end,v_period_end,'SYNCED')
  on conflict (organization_id,module_key) do update set enabled=excluded.enabled,changed_by=excluded.changed_by,
    changed_at=excluded.changed_at,billing_change_action=excluded.billing_change_action,
    billing_change_effective_at=excluded.billing_change_effective_at,billing_sync_status='SYNCED';
  insert into public.organization_module_events(organization_id,module_key,from_enabled,to_enabled,reason,actor_user_id)
  values(v_op.organization_id,'kanban',v_old,v_op.action='ENABLE','STRIPE_ITEM_SYNCED',v_op.actor_user_id);
  update public.kanban_billing_operations set status='COMPLETED',stripe_subscription_item_id=p_stripe_subscription_item_id,completed_at=now() where id=v_op.id;
  return true;
end $$;
revoke all on function public.begin_kanban_billing_change(uuid,text,text,uuid,boolean,text),public.finish_kanban_billing_change(uuid,text) from public,anon,authenticated;
grant execute on function public.begin_kanban_billing_change(uuid,text,text,uuid,boolean,text),public.finish_kanban_billing_change(uuid,text) to service_role;

-- The legacy webhook handler expects the base price at item zero. Normalize
-- subscription payloads before calling it, then record the matching module item.
alter function public.process_stripe_billing_webhook(text,text,timestamptz,boolean,text,timestamptz,jsonb)
rename to process_stripe_billing_webhook_before_kanban;
revoke all on function public.process_stripe_billing_webhook_before_kanban(text,text,timestamptz,boolean,text,timestamptz,jsonb)
from public,anon,authenticated;
create function public.process_stripe_billing_webhook(p_event_id text,p_event_type text,p_event_created_at timestamptz,p_livemode boolean,p_mapped_status text,p_grace_until timestamptz,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_payload jsonb:=p_payload; v_result jsonb; v_org uuid; v_base text; v_items jsonb; v_module_item text;
begin
  perform public.require_service_role();
  if p_event_type like 'customer.subscription.%' then
    select organization_id,stripe_price_id into v_org,v_base from public.saas_subscriptions
    where stripe_subscription_id=p_payload->>'id';
    if v_org is null and (p_payload #>> '{metadata,organization_id}') ~* '^[0-9a-f-]{36}$' then
      v_org:=(p_payload #>> '{metadata,organization_id}')::uuid;
      select stripe_price_id into v_base from public.saas_subscriptions where organization_id=v_org;
    end if;
    if v_base is not null and jsonb_typeof(p_payload #> '{items,data}')='array' then
      select coalesce(jsonb_agg(item order by case when item #>> '{price,id}'=v_base then 0 else 1 end), '[]'::jsonb)
      into v_items from jsonb_array_elements(p_payload #> '{items,data}') item;
      v_payload:=jsonb_set(p_payload,'{items,data}',v_items);
    end if;
  end if;
  v_result:=public.process_stripe_billing_webhook_before_kanban(
    p_event_id,p_event_type,p_event_created_at,p_livemode,p_mapped_status,p_grace_until,v_payload);
  if v_result->>'applied'='true' and v_org is not null and p_event_type like 'customer.subscription.%' then
    select item->>'id' into v_module_item
    from public.organization_kanban_billing billing
    join public.platform_kanban_price_versions price on price.id=billing.price_version_id
    cross join lateral jsonb_array_elements(coalesce(p_payload #> '{items,data}','[]'::jsonb)) item
    where billing.organization_id=v_org
      and item #>> '{price,id}'=case when p_livemode then price.stripe_live_price_id else price.stripe_test_price_id end
      and item #>> '{metadata,module_key}'='kanban'
      and item #>> '{metadata,organization_id}'=v_org::text
    limit 1;
    if v_module_item is not null then
      update public.organization_kanban_billing set stripe_subscription_item_id=v_module_item,updated_at=now()
      where organization_id=v_org and stripe_subscription_item_id is distinct from v_module_item;
    end if;
  end if;
  return v_result;
end $$;
revoke all on function public.process_stripe_billing_webhook(text,text,timestamptz,boolean,text,timestamptz,jsonb) from public,anon,authenticated;
grant execute on function public.process_stripe_billing_webhook(text,text,timestamptz,boolean,text,timestamptz,jsonb) to service_role;
