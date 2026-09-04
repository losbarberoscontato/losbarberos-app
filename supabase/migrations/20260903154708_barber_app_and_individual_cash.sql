-- App do Barbeiro: acesso separado, agenda com menor privilégio e caixa diário conciliado.
-- Esta migration é incremental; payment_transactions continua sendo a fonte de verdade.

create type public.barber_agenda_access_scope as enum ('OWN', 'FULL');
create type public.barber_cash_session_status as enum ('OPEN', 'RECONCILED');
create type public.barber_cash_receipt_status as enum ('PENDING_RECONCILIATION', 'RECONCILED', 'REVERSED');

alter table public.barbers
  add column login_email text,
  add column auth_user_id uuid references auth.users(id),
  add column app_access_enabled boolean not null default false,
  add column agenda_access_scope public.barber_agenda_access_scope not null default 'OWN',
  add column cash_access_enabled boolean not null default false;

create unique index barbers_login_email_per_organization_unique
  on public.barbers (organization_id, lower(login_email))
  where login_email is not null;
create unique index barbers_auth_user_per_organization_unique
  on public.barbers (organization_id, auth_user_id)
  where auth_user_id is not null;

create table public.barber_financial_account_permissions (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  barber_id uuid not null,
  financial_account_id uuid not null,
  active boolean not null default true,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (barber_id, financial_account_id),
  foreign key (barber_id, organization_id) references public.barbers(id, organization_id) on delete cascade,
  foreign key (financial_account_id, organization_id) references public.financial_accounts(id, organization_id)
);

create table public.barber_cash_sessions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  barber_id uuid not null,
  business_date date not null,
  status public.barber_cash_session_status not null default 'OPEN',
  expected_cents bigint not null default 0 check (expected_cents >= 0),
  reconciled_cents bigint check (reconciled_cents is null or reconciled_cents >= 0),
  variance_cents bigint,
  variance_reason text,
  opened_at timestamptz not null default now(),
  reconciled_at timestamptz,
  reconciled_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  unique (organization_id, barber_id, business_date),
  foreign key (barber_id, organization_id) references public.barbers(id, organization_id),
  check ((status = 'OPEN' and reconciled_at is null and reconciled_by is null and reconciled_cents is null and variance_cents is null and variance_reason is null)
      or (status = 'RECONCILED' and reconciled_at is not null and reconciled_by is not null and reconciled_cents is not null and variance_cents is not null
        and (variance_cents = 0 or nullif(btrim(variance_reason), '') is not null)))
);

create table public.barber_cash_receipts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  cash_session_id uuid not null,
  appointment_id uuid not null,
  received_by_barber_id uuid not null,
  payment_transaction_id uuid not null,
  financial_account_id uuid not null,
  payment_method public.financial_payment_method not null,
  amount_cents bigint not null check (amount_cents > 0),
  status public.barber_cash_receipt_status not null default 'PENDING_RECONCILIATION',
  source_receipt_id uuid,
  notes text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique (organization_id, payment_transaction_id),
  foreign key (cash_session_id, organization_id) references public.barber_cash_sessions(id, organization_id),
  foreign key (appointment_id, organization_id) references public.appointments(id, organization_id),
  foreign key (received_by_barber_id, organization_id) references public.barbers(id, organization_id),
  foreign key (financial_account_id, organization_id) references public.financial_accounts(id, organization_id),
  foreign key (payment_transaction_id, organization_id) references public.payment_transactions(id, organization_id),
  foreign key (source_receipt_id) references public.barber_cash_receipts(id)
);

create index barber_cash_receipts_session_idx on public.barber_cash_receipts (organization_id, cash_session_id, created_at);
create index barber_cash_receipts_barber_idx on public.barber_cash_receipts (organization_id, received_by_barber_id, created_at);

create or replace function public.is_organization_barber(
  p_organization_id uuid,
  p_user_id uuid default auth.uid()
)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.barbers b
    where b.organization_id = p_organization_id
      and b.auth_user_id = p_user_id
      and b.active and b.app_access_enabled
  );
$$;

create or replace function public.can_operate_barber_agenda(
  p_organization_id uuid,
  p_target_barber_id uuid,
  p_user_id uuid default auth.uid()
)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.barbers actor
    where actor.organization_id = p_organization_id
      and actor.auth_user_id = p_user_id
      and actor.active and actor.app_access_enabled
      and (actor.agenda_access_scope = 'FULL' or actor.id = p_target_barber_id)
  );
$$;

create or replace function public.is_barber_financial_account_allowed(
  p_organization_id uuid,
  p_financial_account_id uuid,
  p_user_id uuid default auth.uid()
)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.barber_financial_account_permissions permission
    join public.barbers b on b.id = permission.barber_id and b.organization_id = permission.organization_id
    join public.financial_accounts account on account.id = permission.financial_account_id and account.organization_id = permission.organization_id
    where permission.organization_id = p_organization_id
      and permission.financial_account_id = p_financial_account_id
      and permission.active and account.active
      and b.auth_user_id = p_user_id and b.active and b.app_access_enabled and b.cash_access_enabled
  );
$$;

create or replace function public.get_my_barber_app_context(p_organization_slug text default null)
returns table (
  organization_id uuid, organization_name text, organization_slug text, organization_logo_path text,
  timezone text, barber_id uuid, barber_name text, barber_avatar_url text, barber_bio text,
  barber_whatsapp_e164 text, agenda_access_scope public.barber_agenda_access_scope, cash_access_enabled boolean
)
language plpgsql security definer set search_path = public, auth, pg_temp as $$
declare v_email text;
begin
  if auth.uid() is null then return; end if;
  select lower(email) into v_email from auth.users where id = auth.uid();
  if v_email is not null then
    update public.barbers b set auth_user_id = auth.uid(), updated_at = now()
    where b.auth_user_id is null
      and lower(b.login_email) = v_email
      and b.active and b.app_access_enabled
      and (p_organization_slug is null or exists (select 1 from public.organizations o where o.id = b.organization_id and o.slug = p_organization_slug));
  end if;
  return query
  select o.id, o.name, o.slug, o.logo_path, o.timezone, b.id, b.display_name, b.avatar_url, b.bio,
    b.whatsapp_e164, b.agenda_access_scope, b.cash_access_enabled
  from public.barbers b join public.organizations o on o.id = b.organization_id
  where b.auth_user_id = auth.uid() and b.active and b.app_access_enabled
    and (p_organization_slug is null or o.slug = p_organization_slug)
  order by o.name;
end;
$$;

create or replace function public.update_my_barber_profile(
  p_organization_id uuid, p_display_name text, p_whatsapp_e164 text, p_bio text, p_avatar_url text
)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if nullif(btrim(p_display_name), '') is null or char_length(btrim(p_display_name)) > 160 then
    raise exception using errcode = '22023', message = 'valid display name is required';
  end if;
  update public.barbers set display_name = btrim(p_display_name), whatsapp_e164 = nullif(btrim(p_whatsapp_e164), ''),
    bio = nullif(btrim(p_bio), ''), avatar_url = nullif(btrim(p_avatar_url), ''), updated_at = now()
  where organization_id = p_organization_id and auth_user_id = auth.uid() and active and app_access_enabled;
  if not found then raise exception using errcode = '42501', message = 'barber profile access denied'; end if;
end;
$$;

create or replace function public.set_barber_financial_accounts(p_barber_id uuid, p_financial_account_ids uuid[])
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_org uuid;
begin
  select organization_id into strict v_org from public.barbers where id = p_barber_id for update;
  if not public.is_organization_owner(v_org) then raise exception using errcode = '42501', message = 'organization owner required'; end if;
  if exists (select 1 from unnest(coalesce(p_financial_account_ids, '{}'::uuid[])) id where not exists (select 1 from public.financial_accounts a where a.id = id and a.organization_id = v_org and a.active)) then
    raise exception using errcode = '22023', message = 'financial account must be active and tenant scoped';
  end if;
  update public.barber_financial_account_permissions set active = false, updated_at = now() where barber_id = p_barber_id;
  insert into public.barber_financial_account_permissions (organization_id, barber_id, financial_account_id, active, created_by)
  select v_org, p_barber_id, id, true, auth.uid() from unnest(coalesce(p_financial_account_ids, '{}'::uuid[])) id
  on conflict (barber_id, financial_account_id) do update set active = true, updated_at = now();
end;
$$;

create or replace function public.barber_create_manual_appointment(
  p_organization_id uuid, p_customer_id uuid, p_barber_id uuid, p_starts_at timestamptz,
  p_selections jsonb, p_notes text default null
)
returns uuid language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v_org public.organizations%rowtype; v_barber public.barbers%rowtype; v_resolution jsonb;
  v_period tstzrange; v_occupied integer; v_appointment_id uuid; v_local_start timestamp;
begin
  if not public.can_operate_barber_agenda(p_organization_id, p_barber_id) then raise exception using errcode = '42501', message = 'barber agenda access denied'; end if;
  if not public.organization_accepts_new_bookings(p_organization_id) then raise exception using errcode = '42501', message = 'organization does not allow new bookings'; end if;
  if p_starts_at <= now() then raise exception using errcode = '22023', message = 'appointment start must be in the future'; end if;
  select * into strict v_org from public.organizations where id = p_organization_id;
  select * into strict v_barber from public.barbers where id = p_barber_id and organization_id = p_organization_id and active;
  if not exists (select 1 from public.customers c where c.id = p_customer_id and c.organization_id = p_organization_id and c.active) then raise exception using errcode = 'P0002', message = 'active customer not found'; end if;
  v_local_start := p_starts_at at time zone v_org.timezone;
  if extract(second from v_local_start) <> 0 or mod(extract(minute from v_local_start)::integer, v_org.slot_interval_minutes) <> 0 then raise exception using errcode = '22023', message = 'start time is not aligned to slot interval'; end if;
  v_resolution := public.resolve_booking_selection(p_organization_id, p_barber_id, p_selections, null);
  v_occupied := ceil((v_resolution ->> 'duration_minutes')::integer::numeric / v_org.slot_interval_minutes)::integer * v_org.slot_interval_minutes;
  v_period := tstzrange(p_starts_at, p_starts_at + make_interval(mins => v_occupied), '[)');
  if not public.is_barber_available(p_organization_id, p_barber_id, v_period) then raise exception using errcode = '22023', message = 'barber unavailable'; end if;
  insert into public.appointments (organization_id, location_id, customer_id, barber_id, status, source, service_period, payment_mode, currency, total_cents_snapshot, list_total_cents_snapshot, deposit_bps_snapshot, deposit_required_cents_snapshot, cancellation_lead_minutes_snapshot, notes, created_by)
  values (p_organization_id, v_barber.location_id, p_customer_id, p_barber_id, 'CONFIRMED', 'MANAGER', v_period, 'COUNTER', v_org.currency, (v_resolution ->> 'total_cents')::bigint, (v_resolution ->> 'list_total_cents')::bigint, v_org.deposit_bps, round((v_resolution ->> 'total_cents')::numeric * v_org.deposit_bps / 10000)::bigint, v_org.cancellation_lead_minutes, nullif(btrim(p_notes), ''), auth.uid()) returning id into v_appointment_id;
  perform public.insert_resolved_appointment_items(v_appointment_id, p_organization_id, v_resolution);
  insert into public.appointment_status_events (organization_id, appointment_id, to_status, reason, actor_user_id) values (p_organization_id, v_appointment_id, 'CONFIRMED', 'barber_booking_created', auth.uid());
  return v_appointment_id;
exception when exclusion_violation then raise exception using errcode = '23P01', message = 'requested slot is no longer available'; when no_data_found then raise exception using errcode = 'P0002', message = 'organization or barber not found'; end;
$$;

create or replace function public.barber_transition_appointment(
  p_appointment_id uuid, p_expected_status public.appointment_status, p_new_status public.appointment_status
)
returns public.appointments language plpgsql security definer set search_path = public, pg_temp as $$
declare v_appointment public.appointments%rowtype; v_item public.appointment_items%rowtype; v_commission bigint; v_actor_barber_id uuid; v_business_date date;
begin
  select * into strict v_appointment from public.appointments where id = p_appointment_id for update;
  if not public.can_operate_barber_agenda(v_appointment.organization_id, v_appointment.barber_id) then raise exception using errcode = '42501', message = 'barber agenda access denied'; end if;
  if not public.organization_allows_existing_operations(v_appointment.organization_id) then raise exception using errcode = '42501', message = 'organization access does not allow appointment operations'; end if;
  if v_appointment.status <> p_expected_status then raise exception using errcode = '40001', message = 'appointment status changed concurrently'; end if;
  if not ((p_expected_status = 'CONFIRMED' and p_new_status in ('IN_SERVICE', 'NO_SHOW')) or (p_expected_status = 'IN_SERVICE' and p_new_status = 'COMPLETED')) then raise exception using errcode = '22023', message = 'invalid appointment transition'; end if;
  update public.appointments set status = p_new_status, amount_waived_cents = case when p_new_status = 'NO_SHOW' then total_cents_snapshot else amount_waived_cents end, version = version + 1 where id = p_appointment_id returning * into v_appointment;
  insert into public.appointment_status_events (organization_id, appointment_id, from_status, to_status, reason, actor_user_id) values (v_appointment.organization_id, v_appointment.id, p_expected_status, p_new_status, 'barber_' || lower(p_new_status::text), auth.uid());
  if p_new_status = 'IN_SERVICE' then
    select id into v_actor_barber_id from public.barbers where organization_id = v_appointment.organization_id and auth_user_id = auth.uid() and active and app_access_enabled and cash_access_enabled;
    if v_actor_barber_id is not null then
      select (now() at time zone timezone)::date into v_business_date from public.organizations where id = v_appointment.organization_id;
      insert into public.barber_cash_sessions (organization_id, barber_id, business_date) values (v_appointment.organization_id, v_actor_barber_id, v_business_date) on conflict (organization_id, barber_id, business_date) do nothing;
    end if;
  end if;
  if p_new_status = 'COMPLETED' then
    for v_item in select * from public.appointment_items where appointment_id = v_appointment.id and organization_id = v_appointment.organization_id order by position loop
      v_commission := case v_item.commission_mode_snapshot when 'PERCENT' then round(v_item.list_price_cents_snapshot::numeric * v_item.commission_percentage_bps_snapshot / 10000)::bigint when 'FIXED' then v_item.commission_fixed_cents_snapshot * v_item.quantity else 0 end;
      if v_commission > 0 then insert into public.commission_ledger (organization_id, barber_id, appointment_id, appointment_item_id, kind, amount_cents, idempotency_key, earned_at, created_by) values (v_appointment.organization_id, v_appointment.barber_id, v_appointment.id, v_item.id, 'EARNED', v_commission, 'earned:' || v_appointment.id || ':' || v_item.id, now(), auth.uid()) on conflict (organization_id, idempotency_key) do nothing; end if;
    end loop;
  end if;
  return v_appointment;
exception when no_data_found then raise exception using errcode = 'P0002', message = 'appointment not found'; end;
$$;

create or replace function public.barber_cancel_appointment(p_appointment_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_appointment public.appointments%rowtype; v_paid bigint;
begin
  select * into strict v_appointment from public.appointments where id = p_appointment_id for update;
  if not public.can_operate_barber_agenda(v_appointment.organization_id, v_appointment.barber_id) then raise exception using errcode = '42501', message = 'barber agenda access denied'; end if;
  if v_appointment.status not in ('CONFIRMED', 'IN_SERVICE') then raise exception using errcode = '22023', message = 'appointment cannot be canceled'; end if;
  select coalesce(sum(case when kind in ('CAPTURE','ADJUSTMENT') then amount_cents when kind in ('REFUND','REVERSAL') then -amount_cents end),0) into v_paid from public.payment_transactions where organization_id = v_appointment.organization_id and appointment_id = v_appointment.id;
  if v_paid > 0 then raise exception using errcode = '22023', message = 'paid appointment requires manager cancellation and refund handling'; end if;
  update public.appointments set status = 'CANCELED', version = version + 1 where id = v_appointment.id;
  insert into public.appointment_status_events (organization_id, appointment_id, from_status, to_status, reason, actor_user_id) values (v_appointment.organization_id, v_appointment.id, v_appointment.status, 'CANCELED', nullif(btrim(p_reason), ''), auth.uid());
exception when no_data_found then raise exception using errcode = 'P0002', message = 'appointment not found'; end;
$$;

create or replace function public.record_barber_appointment_receipt(
  p_appointment_id uuid, p_amount_cents bigint, p_payment_method public.financial_payment_method,
  p_financial_account_id uuid, p_reference text, p_idempotency_key text
)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_appointment public.appointments%rowtype; v_barber public.barbers%rowtype; v_order_id uuid; v_transaction_id uuid; v_session_id uuid; v_receipt_id uuid; v_paid bigint; v_outstanding bigint; v_business_date date;
begin
  if p_amount_cents <= 0 or nullif(btrim(p_idempotency_key), '') is null then raise exception using errcode = '22023', message = 'positive payment amount and idempotency key are required'; end if;
  select * into strict v_appointment from public.appointments where id = p_appointment_id for update;
  select * into strict v_barber from public.barbers where organization_id = v_appointment.organization_id and auth_user_id = auth.uid() and active and app_access_enabled and cash_access_enabled;
  if not public.can_operate_barber_agenda(v_appointment.organization_id, v_appointment.barber_id) then raise exception using errcode = '42501', message = 'barber cannot receive this appointment'; end if;
  if v_appointment.status <> 'COMPLETED' then raise exception using errcode = '22023', message = 'only completed appointment can be received'; end if;
  if not public.is_barber_financial_account_allowed(v_appointment.organization_id, p_financial_account_id) then raise exception using errcode = '42501', message = 'financial account is not allowed'; end if;
  select coalesce(sum(case when kind in ('CAPTURE','ADJUSTMENT') then amount_cents when kind in ('REFUND','REVERSAL') then -amount_cents end), 0) into v_paid from public.payment_transactions where organization_id = v_appointment.organization_id and appointment_id = v_appointment.id;
  v_outstanding := greatest(v_appointment.total_cents_snapshot - v_appointment.amount_waived_cents - v_paid, 0);
  if p_amount_cents > v_outstanding then raise exception using errcode = '22023', message = 'payment exceeds outstanding balance'; end if;
  select id into v_transaction_id from public.payment_transactions where organization_id = v_appointment.organization_id and idempotency_key = p_idempotency_key;
  if v_transaction_id is not null then return v_transaction_id; end if;
  select (now() at time zone o.timezone)::date into v_business_date from public.organizations o where o.id = v_appointment.organization_id;
  insert into public.barber_cash_sessions (organization_id, barber_id, business_date) values (v_appointment.organization_id, v_barber.id, v_business_date) on conflict (organization_id, barber_id, business_date) do update set updated_at = now() returning id into v_session_id;
  if not exists (select 1 from public.barber_cash_sessions where id = v_session_id and status = 'OPEN') then raise exception using errcode = '22023', message = 'daily cashier session is reconciled'; end if;
  insert into public.payment_orders (organization_id, appointment_id, provider, kind, status, amount_cents, currency, idempotency_key, metadata) values (v_appointment.organization_id, v_appointment.id, 'MANUAL', 'BALANCE', 'PAID', p_amount_cents, v_appointment.currency, p_idempotency_key || ':order', jsonb_build_object('reference', p_reference, 'received_by_barber_id', v_barber.id)) returning id into v_order_id;
  insert into public.payment_transactions (organization_id, payment_order_id, appointment_id, provider, kind, amount_cents, currency, idempotency_key, metadata) values (v_appointment.organization_id, v_order_id, v_appointment.id, 'MANUAL', 'CAPTURE', p_amount_cents, v_appointment.currency, p_idempotency_key, jsonb_build_object('reference', p_reference, 'received_by_barber_id', v_barber.id)) returning id into v_transaction_id;
  insert into public.barber_cash_receipts (organization_id, cash_session_id, appointment_id, received_by_barber_id, payment_transaction_id, financial_account_id, payment_method, amount_cents, notes, created_by) values (v_appointment.organization_id, v_session_id, v_appointment.id, v_barber.id, v_transaction_id, p_financial_account_id, p_payment_method, p_amount_cents, nullif(btrim(p_reference), ''), auth.uid()) returning id into v_receipt_id;
  update public.barber_cash_sessions set expected_cents = expected_cents + p_amount_cents, updated_at = now() where id = v_session_id;
  return v_receipt_id;
exception when no_data_found then raise exception using errcode = '42501', message = 'barber cash access denied'; end;
$$;

create or replace function public.reconcile_barber_cash_session(p_session_id uuid, p_reconciled_cents bigint, p_variance_reason text default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_session public.barber_cash_sessions%rowtype; v_receipt public.barber_cash_receipts%rowtype; v_chart_id uuid; v_variance bigint;
begin
  select * into strict v_session from public.barber_cash_sessions where id = p_session_id for update;
  if not public.is_organization_owner(v_session.organization_id) then raise exception using errcode = '42501', message = 'organization owner required'; end if;
  if v_session.status <> 'OPEN' or p_reconciled_cents < 0 then raise exception using errcode = '22023', message = 'open session and non-negative count required'; end if;
  v_variance := p_reconciled_cents - v_session.expected_cents;
  if v_variance <> 0 and nullif(btrim(p_variance_reason), '') is null then raise exception using errcode = '22023', message = 'variance reason is required'; end if;
  select id into v_chart_id from public.chart_of_accounts where organization_id = v_session.organization_id and kind = 'REVENUE' and active order by code nulls last, created_at limit 1;
  if v_chart_id is null then raise exception using errcode = '22023', message = 'active revenue chart account is required'; end if;
  for v_receipt in select * from public.barber_cash_receipts where cash_session_id = v_session.id and status = 'PENDING_RECONCILIATION' loop
    insert into public.appointment_receipt_classifications (organization_id, payment_transaction_id, financial_account_id, chart_account_id, payment_method, reference, created_by)
    values (v_session.organization_id, v_receipt.payment_transaction_id, v_receipt.financial_account_id, v_chart_id, v_receipt.payment_method, v_receipt.notes, auth.uid()) on conflict (organization_id, payment_transaction_id) do nothing;
    update public.barber_cash_receipts set status = 'RECONCILED' where id = v_receipt.id;
  end loop;
  update public.barber_cash_sessions set status = 'RECONCILED', reconciled_cents = p_reconciled_cents, variance_cents = v_variance, variance_reason = nullif(btrim(p_variance_reason), ''), reconciled_at = now(), reconciled_by = auth.uid(), updated_at = now() where id = v_session.id;
exception when no_data_found then raise exception using errcode = 'P0002', message = 'cash session not found'; end;
$$;

create or replace function public.adjust_barber_cash_receipt(
  p_receipt_id uuid, p_new_amount_cents bigint, p_reason text, p_idempotency_key text
)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_receipt public.barber_cash_receipts%rowtype; v_session public.barber_cash_sessions%rowtype;
  v_appointment public.appointments%rowtype; v_order_id uuid; v_reverse_order_id uuid; v_reverse_transaction_id uuid;
  v_transaction_id uuid; v_paid_without_original bigint; v_outstanding bigint; v_new_receipt_id uuid;
begin
  if p_new_amount_cents <= 0 or nullif(btrim(p_reason), '') is null or nullif(btrim(p_idempotency_key), '') is null then raise exception using errcode = '22023', message = 'positive amount, reason and idempotency key are required'; end if;
  select * into strict v_receipt from public.barber_cash_receipts where id = p_receipt_id for update;
  select * into strict v_session from public.barber_cash_sessions where id = v_receipt.cash_session_id for update;
  if v_receipt.status <> 'PENDING_RECONCILIATION' or v_session.status <> 'OPEN' then raise exception using errcode = '22023', message = 'only pending receipt in open session can be adjusted'; end if;
  if not exists (select 1 from public.barbers b where b.id = v_receipt.received_by_barber_id and b.auth_user_id = auth.uid() and b.active and b.app_access_enabled and b.cash_access_enabled) then raise exception using errcode = '42501', message = 'barber cash access denied'; end if;
  select * into strict v_appointment from public.appointments where id = v_receipt.appointment_id for update;
  select coalesce(sum(case when kind in ('CAPTURE','ADJUSTMENT') then amount_cents when kind in ('REFUND','REVERSAL') then -amount_cents end), 0) - v_receipt.amount_cents into v_paid_without_original from public.payment_transactions where organization_id = v_appointment.organization_id and appointment_id = v_appointment.id;
  v_outstanding := greatest(v_appointment.total_cents_snapshot - v_appointment.amount_waived_cents - v_paid_without_original, 0);
  if p_new_amount_cents > v_outstanding then raise exception using errcode = '22023', message = 'adjusted payment exceeds outstanding balance'; end if;
  insert into public.payment_orders (organization_id, appointment_id, provider, kind, status, amount_cents, currency, idempotency_key, metadata) values (v_appointment.organization_id, v_appointment.id, 'MANUAL', 'REFUND', 'PAID', v_receipt.amount_cents, v_appointment.currency, p_idempotency_key || ':reverse-order', jsonb_build_object('reason', p_reason, 'adjusts_receipt_id', v_receipt.id)) returning id into v_reverse_order_id;
  insert into public.payment_transactions (organization_id, payment_order_id, appointment_id, provider, kind, amount_cents, currency, idempotency_key, metadata) values (v_appointment.organization_id, v_reverse_order_id, v_appointment.id, 'MANUAL', 'REVERSAL', v_receipt.amount_cents, v_appointment.currency, p_idempotency_key || ':reverse', jsonb_build_object('reason', p_reason, 'adjusts_receipt_id', v_receipt.id)) returning id into v_reverse_transaction_id;
  insert into public.payment_orders (organization_id, appointment_id, provider, kind, status, amount_cents, currency, idempotency_key, metadata) values (v_appointment.organization_id, v_appointment.id, 'MANUAL', 'BALANCE', 'PAID', p_new_amount_cents, v_appointment.currency, p_idempotency_key || ':order', jsonb_build_object('reason', p_reason, 'adjusts_receipt_id', v_receipt.id)) returning id into v_order_id;
  insert into public.payment_transactions (organization_id, payment_order_id, appointment_id, provider, kind, amount_cents, currency, idempotency_key, metadata) values (v_appointment.organization_id, v_order_id, v_appointment.id, 'MANUAL', 'ADJUSTMENT', p_new_amount_cents, v_appointment.currency, p_idempotency_key, jsonb_build_object('reason', p_reason, 'adjusts_receipt_id', v_receipt.id)) returning id into v_transaction_id;
  update public.barber_cash_receipts set status = 'REVERSED' where id = v_receipt.id;
  insert into public.barber_cash_receipts (organization_id, cash_session_id, appointment_id, received_by_barber_id, payment_transaction_id, financial_account_id, payment_method, amount_cents, source_receipt_id, notes, created_by) values (v_receipt.organization_id, v_receipt.cash_session_id, v_receipt.appointment_id, v_receipt.received_by_barber_id, v_transaction_id, v_receipt.financial_account_id, v_receipt.payment_method, p_new_amount_cents, v_receipt.id, p_reason, auth.uid()) returning id into v_new_receipt_id;
  update public.barber_cash_sessions set expected_cents = expected_cents - v_receipt.amount_cents + p_new_amount_cents, updated_at = now() where id = v_session.id;
  return v_new_receipt_id;
exception when no_data_found then raise exception using errcode = 'P0002', message = 'cash receipt not found'; end;
$$;

create or replace view public.barber_cash_receipt_view with (security_invoker = true) as
select r.id, r.organization_id, r.received_by_barber_id, r.appointment_id, c.full_name as customer_name,
  r.amount_cents, r.payment_method::text as payment_method, a.name as financial_account_name,
  r.status::text as status, r.created_at
from public.barber_cash_receipts r
join public.appointments appointment on appointment.id = r.appointment_id and appointment.organization_id = r.organization_id
join public.customers c on c.id = appointment.customer_id and c.organization_id = r.organization_id
join public.financial_accounts a on a.id = r.financial_account_id and a.organization_id = r.organization_id;

alter table public.barber_financial_account_permissions enable row level security;
alter table public.barber_cash_sessions enable row level security;
alter table public.barber_cash_receipts enable row level security;

create policy barber_account_permission_owner_all on public.barber_financial_account_permissions for all to authenticated using (public.is_organization_owner(organization_id)) with check (public.is_organization_owner(organization_id));
create policy barber_account_permission_self_select on public.barber_financial_account_permissions for select to authenticated using (public.is_organization_barber(organization_id) and public.is_barber_financial_account_allowed(organization_id, financial_account_id));
create policy barber_session_owner_all on public.barber_cash_sessions for all to authenticated using (public.is_organization_owner(organization_id)) with check (public.is_organization_owner(organization_id));
create policy barber_session_self_select on public.barber_cash_sessions for select to authenticated using (public.is_organization_barber(organization_id) and exists (select 1 from public.barbers b where b.id = barber_cash_sessions.barber_id and b.auth_user_id = auth.uid()));
create policy barber_receipt_owner_all on public.barber_cash_receipts for all to authenticated using (public.is_organization_owner(organization_id)) with check (public.is_organization_owner(organization_id));
create policy barber_receipt_self_select on public.barber_cash_receipts for select to authenticated using (public.is_organization_barber(organization_id) and exists (select 1 from public.barbers b where b.id = barber_cash_receipts.received_by_barber_id and b.auth_user_id = auth.uid()));

create policy organizations_barber_select on public.organizations for select to authenticated using (public.is_organization_barber(id));
create policy barbers_barber_select on public.barbers for select to authenticated using (public.is_organization_barber(organization_id));
create policy appointments_barber_select on public.appointments for select to authenticated using (public.can_operate_barber_agenda(organization_id, barber_id));
create policy appointment_items_barber_select on public.appointment_items for select to authenticated using (exists (select 1 from public.appointments a where a.id = appointment_items.appointment_id and a.organization_id = appointment_items.organization_id and public.can_operate_barber_agenda(a.organization_id, a.barber_id)));
create policy appointment_events_barber_select on public.appointment_status_events for select to authenticated using (exists (select 1 from public.appointments a where a.id = appointment_status_events.appointment_id and a.organization_id = appointment_status_events.organization_id and public.can_operate_barber_agenda(a.organization_id, a.barber_id)));
create policy customers_barber_select on public.customers for select to authenticated using (public.is_organization_barber(organization_id));
create policy services_barber_select on public.services for select to authenticated using (public.is_organization_barber(organization_id));
create policy barber_services_barber_select on public.barber_services for select to authenticated using (public.is_organization_barber(organization_id));
create policy financial_accounts_barber_select on public.financial_accounts for select to authenticated using (public.is_barber_financial_account_allowed(organization_id, id));
create policy payment_transactions_barber_select on public.payment_transactions for select to authenticated using (exists (select 1 from public.appointments a where a.id = payment_transactions.appointment_id and a.organization_id = payment_transactions.organization_id and public.can_operate_barber_agenda(a.organization_id, a.barber_id)));
grant select on public.appointment_financial_summary to authenticated;

drop policy if exists barber_avatar_barber_insert on storage.objects;
drop policy if exists barber_avatar_barber_update on storage.objects;
create policy barber_avatar_barber_insert on storage.objects for insert to authenticated with check (
  bucket_id = 'barber-avatars' and exists (select 1 from public.barbers b where b.organization_id::text = (storage.foldername(name))[1] and b.id::text = (storage.foldername(name))[2] and b.auth_user_id = auth.uid() and b.active and b.app_access_enabled)
);
create policy barber_avatar_barber_update on storage.objects for update to authenticated using (
  bucket_id = 'barber-avatars' and exists (select 1 from public.barbers b where b.organization_id::text = (storage.foldername(name))[1] and b.id::text = (storage.foldername(name))[2] and b.auth_user_id = auth.uid() and b.active and b.app_access_enabled)
) with check (
  bucket_id = 'barber-avatars' and exists (select 1 from public.barbers b where b.organization_id::text = (storage.foldername(name))[1] and b.id::text = (storage.foldername(name))[2] and b.auth_user_id = auth.uid() and b.active and b.app_access_enabled)
);

revoke all on function public.is_organization_barber(uuid, uuid), public.can_operate_barber_agenda(uuid, uuid, uuid), public.is_barber_financial_account_allowed(uuid, uuid, uuid) from public;
revoke all on function public.get_my_barber_app_context(text), public.update_my_barber_profile(uuid, text, text, text, text), public.set_barber_financial_accounts(uuid, uuid[]), public.barber_create_manual_appointment(uuid, uuid, uuid, timestamptz, jsonb, text), public.barber_transition_appointment(uuid, public.appointment_status, public.appointment_status), public.barber_cancel_appointment(uuid, text), public.record_barber_appointment_receipt(uuid, bigint, public.financial_payment_method, uuid, text, text), public.adjust_barber_cash_receipt(uuid, bigint, text, text), public.reconcile_barber_cash_session(uuid, bigint, text) from public, anon;
grant execute on function public.is_organization_barber(uuid, uuid), public.can_operate_barber_agenda(uuid, uuid, uuid), public.is_barber_financial_account_allowed(uuid, uuid, uuid) to authenticated;
grant execute on function public.get_my_barber_app_context(text), public.update_my_barber_profile(uuid, text, text, text, text), public.barber_create_manual_appointment(uuid, uuid, uuid, timestamptz, jsonb, text), public.barber_transition_appointment(uuid, public.appointment_status, public.appointment_status), public.barber_cancel_appointment(uuid, text), public.record_barber_appointment_receipt(uuid, bigint, public.financial_payment_method, uuid, text, text), public.adjust_barber_cash_receipt(uuid, bigint, text, text) to authenticated;
grant execute on function public.set_barber_financial_accounts(uuid, uuid[]), public.reconcile_barber_cash_session(uuid, bigint, text) to authenticated;
grant select on public.barber_cash_receipt_view to authenticated;
