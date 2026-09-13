-- Módulo de Planos de Assinatura: aceite do aditivo e cobrança recorrente
-- do módulo preparada para o próximo ciclo do Stripe.

create table if not exists public.platform_module_contract_versions (
  module_key text not null references public.platform_modules(key) on delete cascade,
  version text not null check (char_length(btrim(version)) between 1 and 80),
  body text not null check (char_length(btrim(body)) >= 20),
  active boolean not null default false,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  primary key (module_key, version)
);

insert into public.platform_module_contract_versions(module_key, version, body, active)
values (
  'subscription_plans',
  'v1',
  'As cobranças dos planos de assinatura são responsabilidade do gestor da barbearia. O sistema não transaciona valores nem realiza cobranças dos clientes. O módulo de pagamentos online ainda não está ativo e será disponibilizado em implementação futura.',
  true
)
on conflict (module_key, version) do update
  set body = excluded.body, active = excluded.active;

alter table public.organization_module_entitlements
  add column if not exists module_contract_version text,
  add column if not exists contract_accepted_at timestamptz,
  add column if not exists contract_accepted_by uuid references auth.users(id),
  add column if not exists billing_change_effective_at timestamptz,
  add column if not exists billing_change_action text
    check (billing_change_action is null or billing_change_action in ('ADD', 'REMOVE', 'NONE')),
  add column if not exists billing_sync_status text not null default 'NOT_CONFIGURED'
    check (billing_sync_status in ('NOT_CONFIGURED', 'PENDING', 'SYNCED', 'ERROR'));

create table if not exists public.organization_module_contract_acceptances (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  module_key text not null references public.platform_modules(key),
  contract_version text not null,
  accepted_by uuid not null references auth.users(id),
  accepted_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  unique (organization_id, module_key, contract_version),
  foreign key (module_key, contract_version)
    references public.platform_module_contract_versions(module_key, version)
);

alter table public.platform_module_contract_versions enable row level security;
alter table public.platform_module_contract_versions force row level security;
alter table public.organization_module_contract_acceptances enable row level security;
alter table public.organization_module_contract_acceptances force row level security;

drop policy if exists platform_module_contract_versions_authenticated_select on public.platform_module_contract_versions;
create policy platform_module_contract_versions_authenticated_select
  on public.platform_module_contract_versions
  for select to authenticated
  using (active or public.is_platform_admin());

drop policy if exists organization_module_contract_acceptances_owner_select on public.organization_module_contract_acceptances;
create policy organization_module_contract_acceptances_owner_select
  on public.organization_module_contract_acceptances
  for select to authenticated
  using (public.is_organization_owner(organization_id) or public.is_platform_admin());

grant select on public.platform_module_contract_versions,
  public.organization_module_contract_acceptances to authenticated;

alter table public.platform_module_price_versions
  add column if not exists stripe_test_price_id text,
  add column if not exists stripe_live_price_id text,
  add column if not exists currency text not null default 'brl'
    check (currency ~ '^[a-z]{3}$');

create or replace function public.set_platform_module_price_catalog(
  p_module_key text,
  p_monthly_price_cents bigint,
  p_stripe_test_price_id text default null,
  p_stripe_live_price_id text default null,
  p_currency text default 'brl',
  p_effective_from date default current_date
)
returns public.platform_module_price_versions
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_price public.platform_module_price_versions;
begin
  if not public.is_platform_admin() then
    raise exception using errcode = '42501', message = 'platform admin required';
  end if;
  if p_monthly_price_cents < 0 or p_currency !~ '^[a-z]{3}$' then
    raise exception using errcode = '22023', message = 'invalid module price catalog';
  end if;
  if not exists (select 1 from public.platform_modules where key = p_module_key and active) then
    raise exception using errcode = '22023', message = 'module not found';
  end if;
  update public.platform_module_price_versions
     set effective_until = p_effective_from - 1
   where module_key = p_module_key
     and effective_until is null
     and effective_from < p_effective_from;
  insert into public.platform_module_price_versions(
    module_key, monthly_price_cents, effective_from,
    stripe_test_price_id, stripe_live_price_id, currency, created_by
  ) values (
    p_module_key, p_monthly_price_cents, p_effective_from,
    nullif(btrim(p_stripe_test_price_id), ''),
    nullif(btrim(p_stripe_live_price_id), ''),
    lower(p_currency), auth.uid()
  ) returning * into v_price;
  return v_price;
end;
$$;

revoke all on function public.set_platform_module_price_catalog(text,bigint,text,text,text,date) from public, anon;
grant execute on function public.set_platform_module_price_catalog(text,bigint,text,text,text,date) to authenticated;

create or replace function public.set_organization_module_enabled(
  p_organization_id uuid,
  p_module_key text,
  p_enabled boolean
)
returns public.organization_module_entitlements
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_old boolean;
  v_changed_at timestamptz;
  v_row public.organization_module_entitlements;
  v_period_end timestamptz;
  v_action text;
begin
  if not (public.is_organization_owner(p_organization_id) or public.is_platform_admin()) then
    raise exception using errcode = '42501', message = 'module entitlement denied';
  end if;
  if not exists (select 1 from public.platform_modules where key = p_module_key and active) then
    raise exception using errcode = '22023', message = 'unknown or inactive module';
  end if;
  select enabled, changed_at into v_old, v_changed_at
    from public.organization_module_entitlements
   where organization_id = p_organization_id and module_key = p_module_key
   for update;
  if p_enabled and v_old is distinct from true and not exists (
    select 1 from public.organization_module_contract_acceptances a
    join public.platform_module_contract_versions v
      on v.module_key = a.module_key and v.version = a.contract_version and v.active
   where a.organization_id = p_organization_id and a.module_key = p_module_key
     and a.accepted_at >= coalesce(v_changed_at, '-infinity'::timestamptz)
  ) then
    raise exception using errcode = '42501', message = 'module contract acceptance required';
  end if;
  select current_period_ends_at into v_period_end
    from public.saas_subscriptions
   where organization_id = p_organization_id;
  v_action := case
    when v_old is not distinct from p_enabled then 'NONE'
    when p_enabled then 'ADD'
    else 'REMOVE'
  end;
  insert into public.organization_module_entitlements(
    organization_id, module_key, enabled, changed_by,
    billing_change_effective_at, billing_change_action,
    billing_sync_status
  ) values (
    p_organization_id, p_module_key, p_enabled, auth.uid(),
    case when v_action = 'NONE' then null else v_period_end end,
    v_action,
    case when v_action = 'NONE' then 'NOT_CONFIGURED' else 'PENDING' end
  )
  on conflict (organization_id, module_key) do update set
    enabled = excluded.enabled,
    changed_by = excluded.changed_by,
    changed_at = now(),
    billing_change_effective_at = excluded.billing_change_effective_at,
    billing_change_action = excluded.billing_change_action,
    billing_sync_status = excluded.billing_sync_status
  returning * into v_row;
  if v_old is distinct from p_enabled then
    insert into public.organization_module_events(
      organization_id, module_key, from_enabled, to_enabled, actor_user_id, reason
    ) values (
      p_organization_id, p_module_key, v_old, p_enabled, auth.uid(),
      case when p_enabled then 'MANAGER_ENABLE_WITH_CONTRACT' else 'MANAGER_DISABLE' end
    );
  end if;
  return v_row;
end;
$$;

create or replace function public.accept_subscription_module_contract_and_enable(
  p_organization_id uuid,
  p_contract_version text,
  p_metadata jsonb default '{}'::jsonb
)
returns public.organization_module_entitlements
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_row public.organization_module_entitlements;
begin
  if not public.is_organization_owner(p_organization_id) then
    raise exception using errcode = '42501', message = 'module contract acceptance denied';
  end if;
  if not exists (
    select 1 from public.platform_module_contract_versions
     where module_key = 'subscription_plans' and version = p_contract_version and active
  ) then
    raise exception using errcode = '22023', message = 'module contract version unavailable';
  end if;
  insert into public.organization_module_contract_acceptances(
    organization_id, module_key, contract_version, accepted_by, metadata
  ) values (
    p_organization_id, 'subscription_plans', p_contract_version, auth.uid(),
    coalesce(p_metadata, '{}'::jsonb)
  ) on conflict (organization_id, module_key, contract_version) do update set
    accepted_by = excluded.accepted_by,
    accepted_at = now(),
    metadata = excluded.metadata;
  select public.set_organization_module_enabled(
    p_organization_id, 'subscription_plans', true
  ) into v_row;
  update public.organization_module_entitlements
     set module_contract_version = p_contract_version,
         contract_accepted_at = now(),
         contract_accepted_by = auth.uid()
   where organization_id = p_organization_id and module_key = 'subscription_plans'
   returning * into v_row;
  return v_row;
end;
$$;

revoke all on function public.accept_subscription_module_contract_and_enable(uuid,text,jsonb) from public, anon;
grant execute on function public.accept_subscription_module_contract_and_enable(uuid,text,jsonb) to authenticated;

-- Um cliente só pode ter uma adesão em andamento por barbearia, mesmo que
-- tente escolher um segundo plano diferente.
create unique index if not exists customer_subscriptions_one_active_per_customer
  on public.customer_subscriptions(organization_id, customer_id)
  where status in ('REQUESTED', 'PENDING_PAYMENT', 'ACTIVE');

-- Desativar o módulo bloqueia novas adesões, mas não interrompe o uso das
-- sessões já ativas até o cancelamento ou término da assinatura.
create or replace function public.book_customer_subscription_session(
  p_organization_id uuid,
  p_customer_id uuid,
  p_subscription_session_id uuid,
  p_barber_id uuid,
  p_starts_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_session public.customer_subscription_sessions%rowtype;
  v_sub public.customer_subscriptions%rowtype;
  v_plan public.subscription_plan_versions%rowtype;
  v_result jsonb;
  v_items jsonb;
  v_appointment_id uuid;
  v_is_owner boolean;
begin
  v_is_owner := public.is_organization_owner(p_organization_id);
  if not v_is_owner and not public.is_organization_customer(p_organization_id, p_customer_id) then
    raise exception using errcode = '42501', message = 'customer booking denied';
  end if;
  select * into strict v_session
    from public.customer_subscription_sessions
   where id = p_subscription_session_id and organization_id = p_organization_id
   for update;
  select * into strict v_sub
    from public.customer_subscriptions
   where id = v_session.subscription_id and organization_id = p_organization_id
   for update;
  select * into strict v_plan
    from public.subscription_plan_versions
   where id = v_sub.plan_version_id and organization_id = p_organization_id;
  if v_sub.customer_id <> p_customer_id or v_sub.status <> 'ACTIVE' or v_session.status <> 'AVAILABLE' then
    raise exception using errcode = '22023', message = 'subscription session is not available';
  end if;
  if p_starts_at <= now() or p_starts_at > now() + interval '15 days' then
    raise exception using errcode = '22023', message = 'subscription booking outside allowed window';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('type', 'SERVICE', 'service_id', service_id, 'quantity', 1) order by position), '[]'::jsonb)
    into v_items
    from public.subscription_plan_services
   where organization_id = p_organization_id and plan_version_id = v_plan.id;
  if v_is_owner then
    v_appointment_id := public.create_manual_appointment(p_organization_id, p_customer_id, p_barber_id, p_starts_at, v_items, null, null);
    select jsonb_build_object('appointment_id', id, 'status', status::text, 'service_period', service_period)
      into v_result from public.appointments where id = v_appointment_id and organization_id = p_organization_id;
  else
    v_result := public.create_appointment_hold(p_organization_id, p_customer_id, p_barber_id, p_starts_at, v_items, 'COUNTER', null);
    v_appointment_id := (v_result ->> 'appointment_id')::uuid;
  end if;
  update public.appointments
     set payment_mode = 'SUBSCRIPTION', total_cents_snapshot = 0,
         list_total_cents_snapshot = 0, deposit_required_cents_snapshot = 0,
         amount_waived_cents = 0, hold_expires_at = null,
         notes = concat_ws(E'\n', notes, 'Sessão assinatura')
   where id = v_appointment_id and organization_id = p_organization_id;
  update public.customer_subscription_sessions
     set status = 'SCHEDULED', appointment_id = v_appointment_id
   where id = v_session.id and organization_id = p_organization_id and status = 'AVAILABLE';
  if not found then
    raise exception using errcode = '40001', message = 'subscription session changed while booking';
  end if;
  return coalesce(v_result, '{}'::jsonb) || jsonb_build_object('appointment_id', v_appointment_id, 'status', 'CONFIRMED', 'subscription_session_id', v_session.id, 'session_label', 'Sessão assinatura');
exception
  when exclusion_violation then
    raise exception using errcode = '23P01', message = 'requested slot is no longer available';
  when no_data_found then
    raise exception using errcode = 'P0002', message = 'organization, subscription or barber not found';
end;
$$;

revoke all on function public.book_customer_subscription_session(uuid,uuid,uuid,uuid,timestamptz) from public, anon;
grant execute on function public.book_customer_subscription_session(uuid,uuid,uuid,uuid,timestamptz) to authenticated;

-- Clientes com assinatura ativa continuam vendo o plano mesmo quando novas
-- adesões estão bloqueadas pelo módulo desativado.
drop policy if exists subscription_plans_customer_select on public.subscription_plans;
create policy subscription_plans_customer_select on public.subscription_plans
  for select to authenticated
  using (
    active
    and exists (
      select 1 from public.customers c
       where c.organization_id = public.subscription_plans.organization_id
         and c.auth_user_id = (select auth.uid())
         and c.active and c.merged_into_customer_id is null
    )
    and (
      public.organization_module_enabled(organization_id, 'subscription_plans')
      or exists (
        select 1
          from public.customer_subscriptions s
         where s.organization_id = public.subscription_plans.organization_id
           and s.plan_id = public.subscription_plans.id
           and s.status = 'ACTIVE'
           and exists (
             select 1 from public.customers c2
              where c2.id = s.customer_id
                and c2.auth_user_id = (select auth.uid())
           )
      )
    )
  );

drop policy if exists subscription_plan_versions_customer_select on public.subscription_plan_versions;
create policy subscription_plan_versions_customer_select on public.subscription_plan_versions
  for select to authenticated
  using (
    exists (
      select 1 from public.subscription_plans p
       where p.id = public.subscription_plan_versions.plan_id
         and p.organization_id = public.subscription_plan_versions.organization_id
         and p.active
    )
    and exists (
      select 1 from public.customers c
       where c.organization_id = public.subscription_plan_versions.organization_id
         and c.auth_user_id = (select auth.uid())
         and c.active and c.merged_into_customer_id is null
    )
    and (
      public.organization_module_enabled(organization_id, 'subscription_plans')
      or exists (
        select 1
          from public.customer_subscriptions s
         where s.organization_id = public.subscription_plan_versions.organization_id
           and s.plan_version_id = public.subscription_plan_versions.id
           and s.status = 'ACTIVE'
           and exists (
             select 1 from public.customers c2
              where c2.id = s.customer_id
                and c2.auth_user_id = (select auth.uid())
           )
      )
    )
  );

drop policy if exists subscription_plan_services_customer_select on public.subscription_plan_services;
create policy subscription_plan_services_customer_select on public.subscription_plan_services
  for select to authenticated
  using (
    exists (
      select 1
        from public.subscription_plan_versions v
        join public.subscription_plans p
          on p.id = v.plan_id and p.organization_id = v.organization_id
       where v.id = public.subscription_plan_services.plan_version_id
         and v.organization_id = public.subscription_plan_services.organization_id
         and p.active
    )
    and exists (
      select 1 from public.customers c
       where c.organization_id = public.subscription_plan_services.organization_id
         and c.auth_user_id = (select auth.uid())
         and c.active and c.merged_into_customer_id is null
    )
    and (
      public.organization_module_enabled(organization_id, 'subscription_plans')
      or exists (
        select 1
          from public.customer_subscriptions s
          join public.customers c2 on c2.id = s.customer_id and c2.organization_id = s.organization_id
         where s.organization_id = public.subscription_plan_services.organization_id
           and s.plan_version_id = public.subscription_plan_services.plan_version_id
           and s.status = 'ACTIVE'
           and c2.auth_user_id = (select auth.uid())
      )
    )
  );
