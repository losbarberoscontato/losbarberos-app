-- Planos de Assinatura: módulo, catálogo, contratos, ciclos e sessões.
-- Escritas de negócio passam por RPCs atômicas; tabelas permanecem tenant-scoped.

create table public.platform_modules (
  key text primary key check (key ~ '^[a-z0-9_]+$'),
  name text not null,
  description text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.platform_module_price_versions (
  id uuid primary key default gen_random_uuid(),
  module_key text not null references public.platform_modules(key),
  monthly_price_cents bigint not null check (monthly_price_cents >= 0),
  effective_from date not null,
  effective_until date,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  check (effective_until is null or effective_until >= effective_from),
  unique (module_key, effective_from)
);

create unique index platform_module_price_versions_one_open
  on public.platform_module_price_versions(module_key)
  where effective_until is null;

create table public.organization_module_entitlements (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  module_key text not null references public.platform_modules(key),
  enabled boolean not null default false,
  changed_by uuid references auth.users(id),
  changed_at timestamptz not null default now(),
  primary key (organization_id, module_key)
);

create table public.organization_module_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  module_key text not null references public.platform_modules(key),
  from_enabled boolean,
  to_enabled boolean not null,
  reason text not null default 'MANAGER_TOGGLE',
  actor_user_id uuid references auth.users(id),
  created_at timestamptz not null default now()
);

insert into public.platform_modules(key, name, description)
values ('subscription_plans', 'Planos de Assinatura', 'Venda planos compostos por serviços com ciclos e sessões controladas.')
on conflict (key) do update set name = excluded.name, description = excluded.description, updated_at = now();

create table public.subscription_plans (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 2 and 120),
  description text,
  active boolean not null default true,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id)
);

create unique index subscription_plans_name_active
  on public.subscription_plans(organization_id, lower(name)) where active;

create type public.subscription_billing_period as enum ('BIWEEKLY', 'MONTHLY');
create type public.subscription_payment_method as enum ('ONLINE', 'CARD', 'PIX', 'BOLETO', 'CASH', 'UPFRONT');
create type public.subscription_enrollment_status as enum ('REQUESTED', 'PENDING_PAYMENT', 'ACTIVE', 'CANCELED', 'EXPIRED');
create type public.subscription_cycle_status as enum ('OPEN', 'PAID', 'OVERDUE', 'CANCELED');
create type public.subscription_session_status as enum ('AVAILABLE', 'SCHEDULED', 'COMPLETED', 'CONSUMED', 'CANCELED');

create table public.subscription_plan_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  plan_id uuid not null,
  version integer not null check (version > 0),
  price_cents bigint not null check (price_cents >= 0),
  billing_period public.subscription_billing_period not null,
  duration_months smallint not null check (duration_months between 1 and 120),
  sessions_per_cycle smallint not null check (sessions_per_cycle between 1 and 100),
  cancellation_policy text not null check (char_length(btrim(cancellation_policy)) between 2 and 4000),
  session_cancellation_policy text not null check (char_length(btrim(session_cancellation_policy)) between 2 and 4000),
  contract_version text not null check (char_length(btrim(contract_version)) between 1 and 80),
  payment_method public.subscription_payment_method not null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (id, organization_id),
  unique (plan_id, version),
  foreign key (plan_id, organization_id) references public.subscription_plans(id, organization_id) on delete cascade
);

create table public.subscription_plan_services (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  plan_version_id uuid not null,
  service_id uuid not null,
  position smallint not null default 0 check (position >= 0),
  service_name_snapshot text not null,
  list_price_cents_snapshot bigint not null check (list_price_cents_snapshot >= 0),
  duration_minutes_snapshot integer not null check (duration_minutes_snapshot between 5 and 720),
  commission_mode_snapshot public.commission_mode,
  commission_percentage_bps_snapshot integer,
  commission_fixed_cents_snapshot bigint,
  primary key (plan_version_id, service_id),
  foreign key (plan_version_id, organization_id) references public.subscription_plan_versions(id, organization_id) on delete cascade,
  foreign key (service_id, organization_id) references public.services(id, organization_id),
  check ((commission_mode_snapshot is null and commission_percentage_bps_snapshot is null and commission_fixed_cents_snapshot is null)
      or (commission_mode_snapshot = 'PERCENT' and commission_percentage_bps_snapshot between 0 and 10000 and commission_fixed_cents_snapshot is null)
      or (commission_mode_snapshot = 'FIXED' and commission_fixed_cents_snapshot >= 0 and commission_percentage_bps_snapshot is null))
);

create table public.subscription_contract_versions (
  version text primary key check (char_length(btrim(version)) between 1 and 80),
  body text not null check (char_length(btrim(body)) >= 20),
  active boolean not null default false,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

insert into public.subscription_contract_versions(version, body, active)
values ('v1', 'Contrato padrão de prestação de serviços para planos de assinatura. Revisão jurídica pendente antes da operação comercial.', true)
on conflict (version) do nothing;

create table public.customer_subscriptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  customer_id uuid not null,
  plan_id uuid not null,
  plan_version_id uuid not null,
  status public.subscription_enrollment_status not null default 'REQUESTED',
  start_date date,
  end_date date,
  first_due_date date,
  due_day smallint check (due_day between 1 and 31),
  payment_method public.subscription_payment_method not null,
  upfront_payment boolean not null default false,
  contract_version text not null references public.subscription_contract_versions(version),
  contract_accepted_at timestamptz,
  contract_accepted_by uuid references auth.users(id),
  cancellation_requested_at timestamptz,
  cancellation_effective_date date,
  cancellation_reason text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (customer_id, organization_id) references public.customers(id, organization_id),
  foreign key (plan_id, organization_id) references public.subscription_plans(id, organization_id),
  foreign key (plan_version_id, organization_id) references public.subscription_plan_versions(id, organization_id),
  check (end_date is null or start_date is not null and end_date >= start_date),
  check (status not in ('ACTIVE', 'PENDING_PAYMENT') or (start_date is not null and end_date is not null)),
  check ((contract_accepted_at is null and contract_accepted_by is null) or (contract_accepted_at is not null and contract_accepted_by is not null)),
  check (cancellation_effective_date is null or start_date is not null)
);

create unique index customer_subscriptions_one_same_active_plan
  on public.customer_subscriptions(organization_id, customer_id, plan_id)
  where status in ('REQUESTED', 'PENDING_PAYMENT', 'ACTIVE');

create index customer_subscriptions_customer_idx
  on public.customer_subscriptions(organization_id, customer_id, status);

create table public.subscription_contract_acceptances (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  subscription_id uuid not null,
  contract_version text not null references public.subscription_contract_versions(version),
  accepted_by uuid references auth.users(id),
  accepted_at timestamptz not null default now(),
  acceptance_source text not null check (acceptance_source in ('CLIENT', 'MANAGER', 'PRESENTIAL')),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  unique (subscription_id, contract_version),
  foreign key (subscription_id, organization_id) references public.customer_subscriptions(id, organization_id) on delete cascade
);

create table public.customer_subscription_cycles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  subscription_id uuid not null,
  cycle_number smallint not null check (cycle_number > 0),
  starts_on date not null,
  ends_on date not null,
  due_on date not null,
  amount_cents bigint not null check (amount_cents >= 0),
  status public.subscription_cycle_status not null default 'OPEN',
  financial_entry_id uuid,
  paid_at timestamptz,
  canceled_at timestamptz,
  created_at timestamptz not null default now(),
  unique (subscription_id, cycle_number),
  unique (id, organization_id),
  foreign key (subscription_id, organization_id) references public.customer_subscriptions(id, organization_id) on delete cascade,
  check (ends_on >= starts_on),
  check ((status = 'PAID' and paid_at is not null) or (status <> 'PAID'))
);

create table public.customer_subscription_sessions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  subscription_id uuid not null,
  cycle_id uuid not null,
  session_number smallint not null check (session_number > 0),
  status public.subscription_session_status not null default 'AVAILABLE',
  appointment_id uuid,
  available_until date not null,
  consumed_at timestamptz,
  canceled_at timestamptz,
  created_at timestamptz not null default now(),
  unique (cycle_id, session_number),
  unique (id, organization_id),
  foreign key (subscription_id, organization_id) references public.customer_subscriptions(id, organization_id) on delete cascade,
  foreign key (cycle_id, organization_id) references public.customer_subscription_cycles(id, organization_id) on delete cascade,
  foreign key (appointment_id, organization_id) references public.appointments(id, organization_id),
  check ((status = 'SCHEDULED' and appointment_id is not null) or status <> 'SCHEDULED'),
  check ((status in ('COMPLETED', 'CONSUMED') and consumed_at is not null) or status not in ('COMPLETED', 'CONSUMED'))
);

create table public.subscription_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  subscription_id uuid not null,
  event_type text not null,
  actor_user_id uuid references auth.users(id),
  idempotency_key text not null,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  unique (organization_id, idempotency_key),
  foreign key (subscription_id, organization_id) references public.customer_subscriptions(id, organization_id) on delete cascade
);

create table public.subscription_payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  subscription_id uuid not null,
  cycle_id uuid,
  amount_cents bigint not null check (amount_cents > 0),
  method public.subscription_payment_method not null,
  paid_at timestamptz not null default now(),
  external_reference text,
  idempotency_key text not null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (organization_id, idempotency_key),
  foreign key (subscription_id, organization_id) references public.customer_subscriptions(id, organization_id) on delete cascade,
  foreign key (cycle_id, organization_id) references public.customer_subscription_cycles(id, organization_id)
);

alter table public.appointments add column if not exists subscription_session_id uuid;
alter table public.financial_entries add column if not exists subscription_cycle_id uuid;
alter table public.financial_entries drop constraint if exists financial_entries_source_check;
alter table public.financial_entries add constraint financial_entries_subscription_source_check check (
  (source = 'APPOINTMENT' and appointment_id is not null and subscription_cycle_id is null)
  or (source = 'SUBSCRIPTION' and subscription_cycle_id is not null and appointment_id is null)
  or (source = 'MANUAL' and appointment_id is null and subscription_cycle_id is null)
);
alter table public.customer_subscription_cycles add constraint customer_subscription_cycles_financial_entry_fk
  foreign key (financial_entry_id, organization_id) references public.financial_entries(id, organization_id);
alter table public.appointments add constraint appointments_subscription_session_fk
  foreign key (subscription_session_id, organization_id) references public.customer_subscription_sessions(id, organization_id);

create index customer_subscription_sessions_customer_idx
  on public.customer_subscription_sessions(organization_id, subscription_id, status);
create unique index customer_subscription_sessions_one_appointment
  on public.customer_subscription_sessions(appointment_id)
  where appointment_id is not null;
create index subscription_cycles_due_idx
  on public.customer_subscription_cycles(organization_id, due_on, status);

do $$
declare t text;
begin
  foreach t in array array[
    'platform_modules','platform_module_price_versions','organization_module_entitlements','organization_module_events',
    'subscription_plans','subscription_plan_versions','subscription_plan_services','subscription_contract_versions',
    'customer_subscriptions','subscription_contract_acceptances','customer_subscription_cycles',
    'customer_subscription_sessions','subscription_events','subscription_payments'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
  end loop;
end $$;

create policy platform_modules_authenticated_select on public.platform_modules
  for select to authenticated using (active or public.is_platform_admin());
create policy platform_module_prices_admin on public.platform_module_price_versions
  for all to authenticated using (public.is_platform_admin()) with check (public.is_platform_admin());
create policy organization_module_entitlements_owner_select on public.organization_module_entitlements
  for select to authenticated using (public.is_organization_owner(organization_id) or public.is_platform_admin());
create policy organization_module_entitlements_owner_write on public.organization_module_entitlements
  for all to authenticated using (public.is_organization_owner(organization_id) or public.is_platform_admin()) with check (public.is_organization_owner(organization_id) or public.is_platform_admin());
create policy organization_module_events_owner_select on public.organization_module_events
  for select to authenticated using (public.is_organization_owner(organization_id) or public.is_platform_admin());

create policy subscription_plans_owner on public.subscription_plans
  for all to authenticated using (public.is_organization_owner(organization_id)) with check (public.is_organization_owner(organization_id));
create policy subscription_plan_versions_owner on public.subscription_plan_versions
  for all to authenticated using (public.is_organization_owner(organization_id)) with check (public.is_organization_owner(organization_id));
create policy subscription_plan_services_owner on public.subscription_plan_services
  for all to authenticated using (public.is_organization_owner(organization_id)) with check (public.is_organization_owner(organization_id));
create policy subscription_contract_versions_authenticated_select on public.subscription_contract_versions
  for select to authenticated using (active or public.is_platform_admin());
create policy customer_subscriptions_participant_select on public.customer_subscriptions
  for select to authenticated using (public.is_organization_owner(organization_id) or public.is_organization_customer(organization_id, customer_id));
create policy subscription_contract_acceptances_participant_select on public.subscription_contract_acceptances
  for select to authenticated using (public.is_organization_owner(public.subscription_contract_acceptances.organization_id) or exists (select 1 from public.customer_subscriptions s where s.id = public.subscription_contract_acceptances.subscription_id and s.organization_id = public.subscription_contract_acceptances.organization_id and public.is_organization_customer(s.organization_id, s.customer_id)));
create policy subscription_cycles_participant_select on public.customer_subscription_cycles
  for select to authenticated using (public.is_organization_owner(public.customer_subscription_cycles.organization_id) or exists (select 1 from public.customer_subscriptions s where s.id = public.customer_subscription_cycles.subscription_id and s.organization_id = public.customer_subscription_cycles.organization_id and public.is_organization_customer(s.organization_id, s.customer_id)));
create policy subscription_sessions_participant_select on public.customer_subscription_sessions
  for select to authenticated using (public.is_organization_owner(public.customer_subscription_sessions.organization_id) or exists (select 1 from public.customer_subscriptions s where s.id = public.customer_subscription_sessions.subscription_id and s.organization_id = public.customer_subscription_sessions.organization_id and public.is_organization_customer(s.organization_id, s.customer_id)));
create policy subscription_events_owner_select on public.subscription_events
  for select to authenticated using (public.is_organization_owner(organization_id));
create policy subscription_payments_participant_select on public.subscription_payments
  for select to authenticated using (public.is_organization_owner(public.subscription_payments.organization_id) or exists (select 1 from public.customer_subscriptions s where s.id = public.subscription_payments.subscription_id and s.organization_id = public.subscription_payments.organization_id and public.is_organization_customer(s.organization_id, s.customer_id)));

grant select on public.platform_modules, public.platform_module_price_versions,
  public.organization_module_entitlements, public.subscription_plans,
  public.subscription_plan_versions, public.subscription_plan_services,
  public.subscription_contract_versions, public.customer_subscriptions,
  public.subscription_contract_acceptances, public.customer_subscription_cycles,
  public.customer_subscription_sessions, public.subscription_events,
  public.subscription_payments to authenticated;

create or replace function public.organization_module_enabled(p_organization_id uuid, p_module_key text)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.organization_module_entitlements e where e.organization_id = p_organization_id and e.module_key = p_module_key and e.enabled)
$$;

create or replace function public.set_organization_module_enabled(p_organization_id uuid, p_module_key text, p_enabled boolean)
returns public.organization_module_entitlements
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_old boolean; v_row public.organization_module_entitlements;
begin
  if not (public.is_organization_owner(p_organization_id) or public.is_platform_admin()) then raise exception using errcode='42501', message='module entitlement denied'; end if;
  if not exists (select 1 from public.platform_modules where key = p_module_key and active) then raise exception using errcode='22023', message='unknown or inactive module'; end if;
  select enabled into v_old from public.organization_module_entitlements where organization_id=p_organization_id and module_key=p_module_key for update;
  insert into public.organization_module_entitlements(organization_id,module_key,enabled,changed_by)
  values(p_organization_id,p_module_key,p_enabled,auth.uid())
  on conflict (organization_id,module_key) do update set enabled=excluded.enabled, changed_by=excluded.changed_by, changed_at=now()
  returning * into v_row;
  if v_old is distinct from p_enabled then
    insert into public.organization_module_events(organization_id,module_key,from_enabled,to_enabled,actor_user_id)
    values(p_organization_id,p_module_key,v_old,p_enabled,auth.uid());
  end if;
  return v_row;
end $$;

revoke all on function public.organization_module_enabled(uuid,text) from public;
grant execute on function public.organization_module_enabled(uuid,text) to authenticated;
revoke all on function public.set_organization_module_enabled(uuid,text,boolean) from public;
grant execute on function public.set_organization_module_enabled(uuid,text,boolean) to authenticated;

create or replace function public.save_subscription_plan(
  p_organization_id uuid,
  p_plan_id uuid,
  p_name text,
  p_description text,
  p_price_cents bigint,
  p_billing_period public.subscription_billing_period,
  p_duration_months smallint,
  p_sessions_per_cycle smallint,
  p_payment_method public.subscription_payment_method,
  p_cancellation_policy text,
  p_session_cancellation_policy text,
  p_services jsonb
)
returns public.subscription_plans
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_plan public.subscription_plans;
  v_version public.subscription_plan_versions;
  v_service jsonb;
  v_version_number integer;
begin
  if not public.is_organization_owner(p_organization_id) then raise exception using errcode='42501', message='subscription plan denied'; end if;
  if not public.organization_module_enabled(p_organization_id, 'subscription_plans') then raise exception using errcode='42501', message='subscription module disabled'; end if;
  if p_price_cents < 0 or p_duration_months < 1 or p_sessions_per_cycle < 1 or jsonb_array_length(coalesce(p_services,'[]'::jsonb)) = 0 then raise exception using errcode='22023', message='invalid subscription plan'; end if;
  if p_plan_id is null then
    insert into public.subscription_plans(organization_id,name,description,created_by)
    values(p_organization_id,btrim(p_name),nullif(btrim(p_description),''),auth.uid()) returning * into v_plan;
    v_version_number := 1;
  else
    select * into strict v_plan from public.subscription_plans where id=p_plan_id and organization_id=p_organization_id for update;
    update public.subscription_plans set name=btrim(p_name),description=nullif(btrim(p_description),''),updated_at=now() where id=v_plan.id;
    select coalesce(max(version),0)+1 into v_version_number from public.subscription_plan_versions where plan_id=v_plan.id;
  end if;
  insert into public.subscription_plan_versions(organization_id,plan_id,version,price_cents,billing_period,duration_months,sessions_per_cycle,cancellation_policy,session_cancellation_policy,contract_version,payment_method,created_by)
  values(p_organization_id,v_plan.id,v_version_number,p_price_cents,p_billing_period,p_duration_months,p_sessions_per_cycle,btrim(p_cancellation_policy),btrim(p_session_cancellation_policy),'v1',p_payment_method,auth.uid()) returning * into v_version;
  for v_service in select * from jsonb_array_elements(p_services) loop
    if not exists (select 1 from public.services s where s.id=(v_service->>'service_id')::uuid and s.organization_id=p_organization_id and s.active and s.accepts_subscription) then raise exception using errcode='22023', message='service is not eligible for subscription'; end if;
    insert into public.subscription_plan_services(organization_id,plan_version_id,service_id,position,service_name_snapshot,list_price_cents_snapshot,duration_minutes_snapshot,commission_mode_snapshot,commission_percentage_bps_snapshot,commission_fixed_cents_snapshot)
    select p_organization_id,v_version.id,s.id,coalesce((v_service->>'position')::smallint,0),s.name,s.price_cents,s.duration_minutes,r.mode,r.percentage_bps,r.fixed_cents
    from public.services s left join lateral (select cr.mode,cr.percentage_bps,cr.fixed_cents from public.commission_rules cr where cr.organization_id=s.organization_id and cr.service_id=s.id and cr.active order by cr.created_at desc limit 1) r on true
    where s.id=(v_service->>'service_id')::uuid and s.organization_id=p_organization_id;
  end loop;
  return v_plan;
end $$;

revoke all on function public.save_subscription_plan(uuid,uuid,text,text,bigint,public.subscription_billing_period,smallint,smallint,public.subscription_payment_method,text,text,jsonb) from public;
grant execute on function public.save_subscription_plan(uuid,uuid,text,text,bigint,public.subscription_billing_period,smallint,smallint,public.subscription_payment_method,text,text,jsonb) to authenticated;

create or replace function public.request_customer_subscription(
  p_organization_id uuid, p_customer_id uuid, p_plan_id uuid,
  p_acceptance_source text default 'CLIENT', p_accept_contract boolean default false
)
returns public.customer_subscriptions
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_plan public.subscription_plan_versions; v_sub public.customer_subscriptions;
begin
  if not public.organization_module_enabled(p_organization_id, 'subscription_plans') then raise exception using errcode='42501', message='subscription module disabled'; end if;
  if not (public.is_organization_owner(p_organization_id) or public.is_organization_customer(p_organization_id,p_customer_id)) then raise exception using errcode='42501', message='subscription request denied'; end if;
  select v.* into strict v_plan from public.subscription_plan_versions v where v.organization_id=p_organization_id and v.plan_id=p_plan_id order by v.version desc limit 1;
  if exists (select 1 from public.customer_subscriptions where organization_id=p_organization_id and customer_id=p_customer_id and plan_id=p_plan_id and status in ('REQUESTED','PENDING_PAYMENT','ACTIVE')) then raise exception using errcode='23505', message='customer already has this plan'; end if;
  insert into public.customer_subscriptions(organization_id,customer_id,plan_id,plan_version_id,status,payment_method,upfront_payment,contract_version,contract_accepted_at,contract_accepted_by,created_by)
  values(p_organization_id,p_customer_id,p_plan_id,v_plan.id,'REQUESTED',v_plan.payment_method,v_plan.payment_method='UPFRONT',v_plan.contract_version,case when p_accept_contract then now() end,case when p_accept_contract then auth.uid() end,auth.uid()) returning * into v_sub;
  insert into public.subscription_events(organization_id,subscription_id,event_type,actor_user_id,idempotency_key,metadata) values(p_organization_id,v_sub.id,'REQUESTED',auth.uid(),'requested:'||v_sub.id,jsonb_build_object('acceptance_source',p_acceptance_source));
  if p_accept_contract then insert into public.subscription_contract_acceptances(organization_id,subscription_id,contract_version,accepted_by,acceptance_source) values(p_organization_id,v_sub.id,v_plan.contract_version,auth.uid(),p_acceptance_source); end if;
  return v_sub;
end $$;

create or replace function public.activate_customer_subscription(
  p_organization_id uuid, p_subscription_id uuid, p_start_date date, p_first_due_date date, p_idempotency_key text
)
returns public.customer_subscriptions
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_sub public.customer_subscriptions; v_plan public.subscription_plan_versions; v_cycles integer; i integer; j integer; v_start date; v_end date; v_due date; v_cycle public.customer_subscription_cycles;
begin
  if not public.is_organization_owner(p_organization_id) then raise exception using errcode='42501', message='subscription approval denied'; end if;
  select * into strict v_sub from public.customer_subscriptions where id=p_subscription_id and organization_id=p_organization_id for update;
  if v_sub.status='ACTIVE' then return v_sub; end if;
  if v_sub.status <> 'REQUESTED' or v_sub.contract_accepted_at is null then raise exception using errcode='22023', message='contract must be accepted before activation'; end if;
  select * into strict v_plan from public.subscription_plan_versions where id=v_sub.plan_version_id and organization_id=p_organization_id;
  v_cycles := case when v_plan.billing_period='BIWEEKLY' then v_plan.duration_months*2 else v_plan.duration_months end;
  update public.customer_subscriptions set status='ACTIVE',start_date=p_start_date,end_date=case when v_plan.billing_period='BIWEEKLY' then p_start_date + (v_cycles*15-1) else (p_start_date + (v_plan.duration_months||' months')::interval - interval '1 day')::date end,first_due_date=p_first_due_date,due_day=extract(day from p_first_due_date)::smallint,updated_at=now() where id=v_sub.id returning * into v_sub;
  for i in 1..v_cycles loop
    v_start := case when v_plan.billing_period='BIWEEKLY' then p_start_date + ((i-1)*15) else (p_start_date + ((i-1)||' months')::interval)::date end;
    v_end := case when v_plan.billing_period='BIWEEKLY' then v_start + 14 else (v_start + interval '1 month' - interval '1 day')::date end;
    v_due := case when i=1 then p_first_due_date when v_plan.billing_period='BIWEEKLY' then p_first_due_date + ((i-1)*15) else make_date(extract(year from v_start)::int, extract(month from v_start)::int, least(v_sub.due_day, extract(day from (date_trunc('month', v_start) + interval '1 month - 1 day'))::int)) end;
    insert into public.customer_subscription_cycles(organization_id,subscription_id,cycle_number,starts_on,ends_on,due_on,amount_cents,status) values(p_organization_id,v_sub.id,i,v_start,v_end,v_due,v_plan.price_cents,case when v_sub.upfront_payment then 'PAID' else 'OPEN' end) returning * into v_cycle;
    if v_sub.upfront_payment then update public.customer_subscription_cycles set paid_at=now() where id=v_cycle.id; end if;
    for j in 1..v_plan.sessions_per_cycle loop insert into public.customer_subscription_sessions(organization_id,subscription_id,cycle_id,session_number,available_until) values(p_organization_id,v_sub.id,v_cycle.id,j,v_end); end loop;
  end loop;
  insert into public.subscription_events(organization_id,subscription_id,event_type,actor_user_id,idempotency_key) values(p_organization_id,v_sub.id,'ACTIVATED',auth.uid(),p_idempotency_key) on conflict do nothing;
  return v_sub;
end $$;

revoke all on function public.request_customer_subscription(uuid,uuid,uuid,text,boolean), public.activate_customer_subscription(uuid,uuid,date,date,text) from public;
grant execute on function public.request_customer_subscription(uuid,uuid,uuid,text,boolean), public.activate_customer_subscription(uuid,uuid,date,date,text) to authenticated;
