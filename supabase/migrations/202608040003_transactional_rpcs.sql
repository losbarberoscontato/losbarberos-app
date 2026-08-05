-- Los Barberos: privileged atomic interfaces.
-- Browser roles can read their scoped data, but all state transitions happen here.

create or replace function public.require_service_role()
returns void
language plpgsql
stable
set search_path = public, pg_temp
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and session_user not in ('postgres', 'supabase_admin') then
    raise exception using errcode = '42501', message = 'service_role required';
  end if;
end;
$$;

create or replace function public.create_payment_checkout_order(
  p_appointment_id uuid,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_appointment public.appointments%rowtype;
  v_order public.payment_orders%rowtype;
  v_due bigint;
  v_old_status public.appointment_status;
begin
  if nullif(btrim(p_idempotency_key), '') is null then
    raise exception using errcode = '22023', message = 'idempotency key is required';
  end if;
  select * into strict v_appointment
  from public.appointments where id = p_appointment_id
  for update;
  if not (
    coalesce(auth.role(), '') = 'service_role'
    or public.is_organization_owner(v_appointment.organization_id)
    or public.is_organization_customer(v_appointment.organization_id, v_appointment.customer_id)
  ) then
    raise exception using errcode = '42501', message = 'appointment access denied';
  end if;
  if v_appointment.status not in ('HELD', 'PENDING_PAYMENT') then
    raise exception using errcode = '22023', message = 'appointment cannot start checkout';
  end if;
  if v_appointment.hold_expires_at <= now() then
    raise exception using errcode = '22023', message = 'appointment hold expired';
  end if;
  if not exists (
    select 1 from public.merchant_accounts ma
    where ma.organization_id = v_appointment.organization_id
      and ma.provider = 'MERCADO_PAGO' and ma.status = 'CONNECTED'
  ) then
    raise exception using errcode = '55000', message = 'Mercado Pago account is not connected';
  end if;

  v_due := case v_appointment.payment_mode
    when 'FULL' then v_appointment.total_cents_snapshot
    when 'DEPOSIT' then v_appointment.deposit_required_cents_snapshot
    else 0
  end;
  if v_due <= 0 then
    v_old_status := v_appointment.status;
    update public.appointments
      set status = 'CONFIRMED', hold_expires_at = null, version = version + 1
      where id = v_appointment.id;
    insert into public.appointment_status_events (
      organization_id, appointment_id, from_status, to_status, reason, actor_user_id
    ) values (
      v_appointment.organization_id, v_appointment.id, v_old_status, 'CONFIRMED',
      'zero_amount_checkout', auth.uid()
    );
    return jsonb_build_object(
      'appointment_id', v_appointment.id, 'status', 'CONFIRMED', 'amount_cents', 0
    );
  end if;

  -- A retry with a fresh HTTP idempotency key reuses the still-live business
  -- order. This prevents two valid checkout URLs for one appointment.
  select * into v_order
  from public.payment_orders
  where appointment_id = v_appointment.id
    and organization_id = v_appointment.organization_id
    and provider = 'MERCADO_PAGO'
    and kind in ('DEPOSIT', 'FULL')
    and status in ('CREATED', 'PENDING', 'PAID')
  order by created_at
  limit 1
  for update;
  if not found then
    insert into public.payment_orders (
      organization_id, appointment_id, provider, kind, status,
      amount_cents, currency, idempotency_key, expires_at
    ) values (
      v_appointment.organization_id, v_appointment.id, 'MERCADO_PAGO',
      case v_appointment.payment_mode when 'FULL' then 'FULL' else 'DEPOSIT' end,
      'CREATED', v_due, v_appointment.currency, p_idempotency_key,
      v_appointment.hold_expires_at
    )
    on conflict (organization_id, idempotency_key)
    do update set updated_at = public.payment_orders.updated_at
    returning * into v_order;
  end if;
  if v_order.appointment_id <> v_appointment.id
     or v_order.amount_cents <> v_due
     or v_order.provider <> 'MERCADO_PAGO'
     or v_order.kind <> (case v_appointment.payment_mode
       when 'FULL' then 'FULL'::public.payment_order_kind
       else 'DEPOSIT'::public.payment_order_kind end) then
    raise exception using errcode = '22023', message = 'idempotency key belongs to another checkout request';
  end if;

  if v_appointment.status = 'HELD' then
    update public.appointments
      set status = 'PENDING_PAYMENT', version = version + 1
      where id = v_appointment.id;
    insert into public.appointment_status_events (
      organization_id, appointment_id, from_status, to_status, reason, actor_user_id,
      metadata
    ) values (
      v_appointment.organization_id, v_appointment.id, 'HELD', 'PENDING_PAYMENT',
      'checkout_started', auth.uid(), jsonb_build_object('payment_order_id', v_order.id)
    );
  end if;

  return jsonb_build_object(
    'appointment_id', v_appointment.id,
    'payment_order_id', v_order.id,
    'status', 'PENDING_PAYMENT',
    'amount_cents', v_order.amount_cents,
    'currency', v_order.currency,
    'expires_at', v_order.expires_at
  );
exception
  when no_data_found then
    raise exception using errcode = 'P0002', message = 'appointment not found';
end;
$$;

create or replace function public.record_manual_payment(
  p_appointment_id uuid,
  p_amount_cents bigint,
  p_reference text,
  p_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_appointment public.appointments%rowtype;
  v_order_id uuid;
  v_transaction_id uuid;
  v_net_paid bigint;
  v_outstanding bigint;
  v_due_now bigint;
begin
  if p_amount_cents <= 0 then
    raise exception using errcode = '22023', message = 'payment amount must be positive';
  end if;
  if nullif(btrim(p_idempotency_key), '') is null then
    raise exception using errcode = '22023', message = 'idempotency key is required';
  end if;
  select * into strict v_appointment
  from public.appointments where id = p_appointment_id for update;
  if not public.is_organization_owner(v_appointment.organization_id) then
    raise exception using errcode = '42501', message = 'organization owner required';
  end if;
  if not public.organization_allows_existing_operations(v_appointment.organization_id) then
    raise exception using errcode = '42501', message = 'organization access does not allow appointment operations';
  end if;
  if v_appointment.status in ('CANCELED', 'NO_SHOW', 'EXPIRED') then
    raise exception using errcode = '22023', message = 'cannot pay inactive appointment';
  end if;

  select pt.id into v_transaction_id
  from public.payment_transactions pt
  where pt.organization_id = v_appointment.organization_id
    and pt.idempotency_key = p_idempotency_key;
  if v_transaction_id is not null then
    if exists (
      select 1 from public.payment_transactions pt
      where pt.id = v_transaction_id
        and (
          pt.appointment_id <> v_appointment.id or pt.amount_cents <> p_amount_cents
          or pt.provider <> 'MANUAL' or pt.kind <> 'CAPTURE'
        )
    ) then
      raise exception using errcode = '22023', message = 'idempotency key belongs to another manual payment';
    end if;
    return v_transaction_id;
  end if;

  select coalesce(sum(case
    when kind in ('CAPTURE', 'ADJUSTMENT') then amount_cents
    when kind in ('REFUND', 'REVERSAL') then -amount_cents
  end), 0)::bigint
  into v_net_paid
  from public.payment_transactions
  where organization_id = v_appointment.organization_id
    and appointment_id = v_appointment.id;
  v_net_paid := greatest(v_net_paid, 0);
  v_outstanding := greatest(
    v_appointment.total_cents_snapshot
      - v_appointment.amount_waived_cents - v_net_paid,
    0
  );
  if p_amount_cents > v_outstanding then
    raise exception using errcode = '22023', message = 'manual payment exceeds outstanding balance';
  end if;

  insert into public.payment_orders (
    organization_id, appointment_id, provider, kind, status, amount_cents,
    currency, idempotency_key, external_order_id, metadata
  ) values (
    v_appointment.organization_id, v_appointment.id, 'MANUAL', 'BALANCE', 'PAID',
    p_amount_cents, v_appointment.currency, p_idempotency_key || ':order',
    nullif(btrim(p_reference), ''), jsonb_build_object('reference', p_reference)
  ) returning id into v_order_id;

  insert into public.payment_transactions (
    organization_id, payment_order_id, appointment_id, provider, kind,
    amount_cents, currency, idempotency_key, metadata
  ) values (
    v_appointment.organization_id, v_order_id, v_appointment.id, 'MANUAL', 'CAPTURE',
    p_amount_cents, v_appointment.currency, p_idempotency_key,
    jsonb_build_object('reference', p_reference)
  ) returning id into v_transaction_id;

  v_net_paid := v_net_paid + p_amount_cents;
  v_due_now := case v_appointment.payment_mode
    when 'FULL' then v_appointment.total_cents_snapshot
    when 'DEPOSIT' then v_appointment.deposit_required_cents_snapshot
    else 0
  end;
  if v_appointment.status in ('HELD', 'PENDING_PAYMENT')
     and v_net_paid >= v_due_now then
    update public.appointments
      set status = 'CONFIRMED', hold_expires_at = null, version = version + 1
      where id = v_appointment.id;
    update public.payment_orders
      set status = 'CANCELED', failure_code = 'SETTLED_MANUALLY',
          failure_message = 'Online checkout canceled after manual settlement'
      where appointment_id = v_appointment.id
        and organization_id = v_appointment.organization_id
        and provider = 'MERCADO_PAGO' and kind in ('DEPOSIT', 'FULL')
        and status in ('CREATED', 'PENDING', 'REQUIRES_ACTION');
    insert into public.appointment_status_events (
      organization_id, appointment_id, from_status, to_status, reason, actor_user_id
    ) values (
      v_appointment.organization_id, v_appointment.id, v_appointment.status,
      'CONFIRMED', 'manual_payment_recorded', auth.uid()
    );
  end if;
  return v_transaction_id;
exception
  when no_data_found then
    raise exception using errcode = 'P0002', message = 'appointment not found';
end;
$$;

create or replace function public.confirm_appointment_without_payment(
  p_appointment_id uuid,
  p_reason text
)
returns public.appointments
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_appointment public.appointments%rowtype;
  v_previous_status public.appointment_status;
begin
  if nullif(btrim(p_reason), '') is null then
    raise exception using errcode = '22023', message = 'confirmation reason is required';
  end if;
  select * into strict v_appointment
  from public.appointments where id = p_appointment_id for update;
  if not public.is_organization_owner(v_appointment.organization_id) then
    raise exception using errcode = '42501', message = 'organization owner required';
  end if;
  if not public.organization_allows_existing_operations(v_appointment.organization_id) then
    raise exception using errcode = '42501', message = 'organization access does not allow appointment operations';
  end if;
  if v_appointment.status not in ('HELD', 'PENDING_PAYMENT') then
    raise exception using errcode = '22023', message = 'appointment cannot be confirmed without payment';
  end if;
  v_previous_status := v_appointment.status;
  update public.appointments
    set status = 'CONFIRMED', hold_expires_at = null, version = version + 1
    where id = v_appointment.id
    returning * into v_appointment;
  update public.payment_orders
    set status = 'CANCELED', failure_code = 'MANAGER_WAIVER',
        failure_message = 'Online checkout canceled by explicit manager confirmation'
    where appointment_id = v_appointment.id
      and organization_id = v_appointment.organization_id
      and provider = 'MERCADO_PAGO' and kind in ('DEPOSIT', 'FULL')
      and status in ('CREATED', 'PENDING', 'REQUIRES_ACTION');
  insert into public.appointment_status_events (
    organization_id, appointment_id, from_status, to_status,
    reason, actor_user_id, metadata
  ) values (
    v_appointment.organization_id, v_appointment.id, v_previous_status,
    'CONFIRMED', left(btrim(p_reason), 500), auth.uid(),
    jsonb_build_object('payment_waived', false, 'balance_remains_due', true)
  );
  return v_appointment;
exception
  when no_data_found then
    raise exception using errcode = 'P0002', message = 'appointment not found';
end;
$$;

create or replace function public.register_provider_payment(
  p_payment_order_id uuid,
  p_external_transaction_id text,
  p_amount_cents bigint,
  p_idempotency_key text,
  p_occurred_at timestamptz default now(),
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order public.payment_orders%rowtype;
  v_appointment public.appointments%rowtype;
  v_transaction_id uuid;
  v_refund_order_id uuid;
  v_disposition text := 'RECORDED';
  v_existing_capture_count integer;
  v_existing_transaction public.payment_transactions%rowtype;
begin
  perform public.require_service_role();
  if p_amount_cents <= 0
     or nullif(btrim(p_external_transaction_id), '') is null
     or nullif(btrim(p_idempotency_key), '') is null then
    raise exception using errcode = '22023', message = 'payment amount must be positive';
  end if;
  select * into strict v_order
  from public.payment_orders where id = p_payment_order_id for update;
  if v_order.provider <> 'MERCADO_PAGO'
     or v_order.kind not in ('DEPOSIT', 'FULL') then
    raise exception using errcode = '22023', message = 'order cannot receive Mercado Pago capture';
  end if;

  select * into v_existing_transaction
  from public.payment_transactions
  where (provider = 'MERCADO_PAGO' and external_transaction_id = p_external_transaction_id)
     or (organization_id = v_order.organization_id and idempotency_key = p_idempotency_key)
  limit 1;
  if v_existing_transaction.id is not null then
    if v_existing_transaction.payment_order_id <> v_order.id
       or v_existing_transaction.appointment_id <> v_order.appointment_id
       or v_existing_transaction.amount_cents <> p_amount_cents
       or v_existing_transaction.provider <> 'MERCADO_PAGO'
       or v_existing_transaction.kind <> 'CAPTURE' then
      raise exception using errcode = '22023', message = 'provider payment idempotency collision';
    end if;
    return jsonb_build_object(
      'transaction_id', v_existing_transaction.id, 'disposition', 'DUPLICATE'
    );
  end if;

  -- The appointment lock serializes captures even when provider retries point
  -- at different order ids.
  select * into strict v_appointment
  from public.appointments where id = v_order.appointment_id for update;
  select count(*)::integer into v_existing_capture_count
  from public.payment_transactions pt
  join public.payment_orders po
    on po.id = pt.payment_order_id and po.organization_id = pt.organization_id
  where pt.organization_id = v_order.organization_id
    and pt.appointment_id = v_order.appointment_id
    and pt.provider = 'MERCADO_PAGO' and pt.kind = 'CAPTURE'
    and po.provider = 'MERCADO_PAGO' and po.kind in ('DEPOSIT', 'FULL');

  insert into public.payment_transactions (
    organization_id, payment_order_id, appointment_id, provider, kind,
    amount_cents, currency, external_transaction_id, idempotency_key,
    occurred_at, metadata
  ) values (
    v_order.organization_id, v_order.id, v_order.appointment_id,
    'MERCADO_PAGO', 'CAPTURE', p_amount_cents, v_order.currency,
    p_external_transaction_id, p_idempotency_key, p_occurred_at, p_metadata
  ) returning id into v_transaction_id;

  if v_existing_capture_count > 0 then
    insert into public.payment_orders (
      organization_id, appointment_id, provider, kind, status,
      amount_cents, currency, idempotency_key, metadata
    ) values (
      v_appointment.organization_id, v_appointment.id, 'MERCADO_PAGO', 'REFUND',
      'REFUND_PENDING', p_amount_cents, v_appointment.currency,
      'duplicate-capture-refund:' || v_transaction_id,
      jsonb_build_object('capture_transaction_id', v_transaction_id, 'reason', 'duplicate_online_capture')
    ) returning id into v_refund_order_id;
    v_disposition := 'REFUND_PENDING_DUPLICATE_CAPTURE';
  elsif v_order.status in ('FAILED', 'CANCELED') then
    insert into public.payment_orders (
      organization_id, appointment_id, provider, kind, status,
      amount_cents, currency, idempotency_key, metadata
    ) values (
      v_appointment.organization_id, v_appointment.id, 'MERCADO_PAGO', 'REFUND',
      'REFUND_PENDING', p_amount_cents, v_appointment.currency,
      'inactive-order-refund:' || v_transaction_id,
      jsonb_build_object('capture_transaction_id', v_transaction_id, 'reason', 'inactive_payment_order')
    ) returning id into v_refund_order_id;
    v_disposition := 'REFUND_PENDING_INACTIVE_ORDER';
  elsif p_amount_cents <> v_order.amount_cents then
    update public.payment_orders
      set status = 'FAILED', failure_code = 'AMOUNT_MISMATCH',
          failure_message = 'Provider capture amount differs from the frozen payment order'
      where id = v_order.id;
    insert into public.payment_orders (
      organization_id, appointment_id, provider, kind, status,
      amount_cents, currency, idempotency_key, metadata
    ) values (
      v_appointment.organization_id, v_appointment.id, 'MERCADO_PAGO', 'REFUND',
      'REFUND_PENDING', p_amount_cents, v_appointment.currency,
      'mismatched-capture-refund:' || v_transaction_id,
      jsonb_build_object(
        'capture_transaction_id', v_transaction_id,
        'reason', 'capture_amount_mismatch',
        'payment_order_amount_cents', v_order.amount_cents
      )
    ) returning id into v_refund_order_id;
    v_disposition := 'REFUND_PENDING_AMOUNT_MISMATCH';
  else
    update public.payment_orders
      set status = 'PAID',
          external_order_id = coalesce(external_order_id, p_external_transaction_id),
          failure_code = null, failure_message = null
      where id = v_order.id;
  end if;

  if v_disposition = 'RECORDED'
     and v_appointment.status in ('HELD', 'PENDING_PAYMENT', 'EXPIRED') then
    begin
      update public.appointments
        set status = 'CONFIRMED', hold_expires_at = null, version = version + 1
        where id = v_appointment.id;
      insert into public.appointment_status_events (
        organization_id, appointment_id, from_status, to_status, reason, metadata
      ) values (
        v_appointment.organization_id, v_appointment.id, v_appointment.status,
        'CONFIRMED',
        case when v_appointment.status = 'EXPIRED' then 'late_payment_slot_reacquired'
             else 'provider_payment_confirmed' end,
        jsonb_build_object('payment_transaction_id', v_transaction_id)
      );
      v_disposition := case when v_appointment.status = 'EXPIRED'
        then 'LATE_PAYMENT_CONFIRMED' else 'CONFIRMED' end;
    exception
      when exclusion_violation then
        insert into public.payment_orders (
          organization_id, appointment_id, provider, kind, status,
          amount_cents, currency, idempotency_key, metadata
        ) values (
          v_appointment.organization_id, v_appointment.id, 'MERCADO_PAGO', 'REFUND',
          'REFUND_PENDING', p_amount_cents, v_appointment.currency,
          'late-payment-refund:' || v_transaction_id,
          jsonb_build_object('capture_transaction_id', v_transaction_id, 'reason', 'slot_taken')
        ) returning id into v_refund_order_id;
        v_disposition := 'REFUND_PENDING_SLOT_TAKEN';
    end;
  elsif v_disposition = 'RECORDED'
     and v_appointment.status in ('CANCELED', 'NO_SHOW') then
    insert into public.payment_orders (
      organization_id, appointment_id, provider, kind, status,
      amount_cents, currency, idempotency_key, metadata
    ) values (
      v_appointment.organization_id, v_appointment.id, 'MERCADO_PAGO', 'REFUND',
      'REFUND_PENDING', p_amount_cents, v_appointment.currency,
      'inactive-appointment-refund:' || v_transaction_id,
      jsonb_build_object('capture_transaction_id', v_transaction_id, 'reason', 'inactive_appointment')
    ) returning id into v_refund_order_id;
    v_disposition := 'REFUND_PENDING_INACTIVE';
  end if;

  return jsonb_build_object(
    'transaction_id', v_transaction_id,
    'appointment_id', v_appointment.id,
    'disposition', v_disposition,
    'refund_order_id', v_refund_order_id
  );
exception
  when no_data_found then
    raise exception using errcode = 'P0002', message = 'payment order or appointment not found';
end;
$$;

create or replace function public.register_provider_refund(
  p_refund_order_id uuid,
  p_external_transaction_id text,
  p_amount_cents bigint,
  p_idempotency_key text,
  p_occurred_at timestamptz default now(),
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order public.payment_orders%rowtype;
  v_transaction_id uuid;
begin
  perform public.require_service_role();
  if p_amount_cents <= 0 then
    raise exception using errcode = '22023', message = 'refund amount must be positive';
  end if;
  select * into strict v_order
  from public.payment_orders where id = p_refund_order_id for update;
  if v_order.kind <> 'REFUND' then
    raise exception using errcode = '22023', message = 'order is not a refund';
  end if;
  select id into v_transaction_id
  from public.payment_transactions
  where (provider = v_order.provider and external_transaction_id = p_external_transaction_id)
     or (organization_id = v_order.organization_id and idempotency_key = p_idempotency_key)
  limit 1;
  if v_transaction_id is not null then
    return v_transaction_id;
  end if;
  insert into public.payment_transactions (
    organization_id, payment_order_id, appointment_id, provider, kind,
    amount_cents, currency, external_transaction_id, idempotency_key,
    occurred_at, metadata
  ) values (
    v_order.organization_id, v_order.id, v_order.appointment_id, v_order.provider,
    'REFUND', p_amount_cents, v_order.currency, p_external_transaction_id,
    p_idempotency_key, p_occurred_at, p_metadata
  ) returning id into v_transaction_id;
  update public.payment_orders set status = 'REFUNDED', failure_code = null, failure_message = null
  where id = v_order.id;
  return v_transaction_id;
exception
  when no_data_found then
    raise exception using errcode = 'P0002', message = 'refund order not found';
end;
$$;

create or replace function public.register_webhook_event(
  p_provider public.payment_provider,
  p_external_event_id text,
  p_event_type text,
  p_signature_valid boolean,
  p_payload jsonb,
  p_organization_id uuid default null,
  p_provider_created_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event_id uuid;
  v_inserted boolean;
begin
  perform public.require_service_role();
  insert into public.webhook_events (
    organization_id, provider, external_event_id, event_type,
    signature_valid, provider_created_at, payload
  ) values (
    p_organization_id, p_provider, p_external_event_id, p_event_type,
    p_signature_valid, p_provider_created_at, p_payload
  )
  on conflict (provider, external_event_id) do nothing
  returning id into v_event_id;
  v_inserted := v_event_id is not null;
  if not v_inserted then
    select id into v_event_id from public.webhook_events
    where provider = p_provider and external_event_id = p_external_event_id;
  end if;
  return jsonb_build_object('webhook_event_id', v_event_id, 'inserted', v_inserted);
end;
$$;

create or replace function public.claim_webhook_events(p_limit integer default 25)
returns setof public.webhook_events
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.require_service_role();
  return query
  with candidates as (
    select id from public.webhook_events
    where signature_valid
      and status in ('RECEIVED', 'FAILED')
      and coalesce(next_attempt_at, created_at) <= now()
    order by coalesce(next_attempt_at, created_at), created_at
    for update skip locked
    limit greatest(1, least(p_limit, 100))
  )
  update public.webhook_events w
    set status = 'PROCESSING', attempts = w.attempts + 1,
        processing_started_at = now(), last_error = null
  from candidates c
  where w.id = c.id
  returning w.*;
end;
$$;

create or replace function public.finish_webhook_event(
  p_webhook_event_id uuid,
  p_success boolean,
  p_error text default null,
  p_retry_at timestamptz default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.require_service_role();
  update public.webhook_events
  set status = case
        when p_success then 'COMPLETED'::public.webhook_processing_status
        when attempts >= 10 then 'DEAD'::public.webhook_processing_status
        else 'FAILED'::public.webhook_processing_status
      end,
      processed_at = case when p_success then now() else null end,
      next_attempt_at = case when p_success or attempts >= 10 then null
        else coalesce(p_retry_at, now() + make_interval(secs => least(3600, (2 ^ least(attempts, 10))::integer))) end,
      last_error = case when p_success then null else left(coalesce(p_error, 'unknown error'), 4000) end
  where id = p_webhook_event_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'webhook event not found';
  end if;
end;
$$;

create or replace function public.onboard_organization(
  p_name text,
  p_slug text,
  p_location_name text,
  p_timezone text default 'America/Sao_Paulo'
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_organization_id uuid;
  v_location_id uuid;
begin
  if v_user_id is null then
    raise exception using errcode = '28000', message = 'authentication required';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text, 0));
  if exists (
    select 1 from public.organization_memberships m
    where m.user_id = v_user_id and m.active and m.role = 'OWNER'
  ) then
    raise exception using errcode = '23514', message = 'user already owns an active organization in MVP';
  end if;
  if not exists (select 1 from pg_timezone_names where name = p_timezone) then
    raise exception using errcode = '22023', message = 'invalid IANA timezone';
  end if;

  insert into public.profiles (id)
  values (v_user_id)
  on conflict (id) do nothing;

  insert into public.organizations (name, slug, timezone, created_by)
  values (btrim(p_name), lower(btrim(p_slug)), p_timezone, v_user_id)
  returning id into v_organization_id;

  insert into public.locations (organization_id, name)
  values (v_organization_id, btrim(p_location_name))
  returning id into v_location_id;

  insert into public.organization_memberships (organization_id, user_id, role)
  values (v_organization_id, v_user_id, 'OWNER');

  insert into public.saas_subscriptions (organization_id, status)
  values (v_organization_id, 'PROVISIONING');

  insert into public.organization_access_events (
    organization_id, to_status, reason, actor_user_id
  ) values (
    v_organization_id, 'PROVISIONING', 'organization_onboarded', v_user_id
  );

  insert into public.audit_events (
    organization_id, actor_user_id, actor_kind, action, entity_type, entity_id
  ) values (
    v_organization_id, v_user_id, 'USER', 'organization.onboarded',
    'organization', v_organization_id::text
  );

  return jsonb_build_object(
    'organization_id', v_organization_id,
    'location_id', v_location_id,
    'subscription_status', 'PROVISIONING'
  );
exception
  when unique_violation then
    raise exception using errcode = '23505', message = 'organization slug already exists';
end;
$$;

create or replace function public.upsert_my_customer(
  p_organization_id uuid,
  p_full_name text,
  p_phone_e164 text,
  p_email text default null,
  p_birth_date date default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_customer_id uuid;
begin
  if v_user_id is null then
    raise exception using errcode = '28000', message = 'authentication required';
  end if;
  if not exists (select 1 from public.organizations where id = p_organization_id) then
    raise exception using errcode = 'P0002', message = 'organization not found';
  end if;
  if not public.organization_accepts_new_bookings(p_organization_id) then
    raise exception using errcode = '42501', message = 'organization is not accepting customer onboarding';
  end if;

  insert into public.profiles (id)
  values (v_user_id)
  on conflict (id) do nothing;

  insert into public.customers (
    organization_id, auth_user_id, full_name, phone_e164, email, birth_date
  ) values (
    p_organization_id, v_user_id, btrim(p_full_name), p_phone_e164,
    nullif(btrim(p_email), ''), p_birth_date
  )
  on conflict (organization_id, auth_user_id) where auth_user_id is not null
  do update set
    full_name = excluded.full_name,
    phone_e164 = excluded.phone_e164,
    email = excluded.email,
    birth_date = excluded.birth_date,
    active = true,
    merged_into_customer_id = null
  returning id into v_customer_id;

  return v_customer_id;
end;
$$;

create or replace function public.commission_snapshot_for(
  p_organization_id uuid,
  p_barber_id uuid,
  p_service_id uuid,
  p_at timestamptz default now()
)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((
    select jsonb_build_object(
      'mode', r.mode,
      'percentage_bps', r.percentage_bps,
      'fixed_cents', r.fixed_cents
    )
    from public.commission_rules r
    where r.organization_id = p_organization_id
      and r.active
      and r.effective_period @> p_at
      and (r.barber_id is null or r.barber_id = p_barber_id)
      and (r.service_id is null or r.service_id = p_service_id)
    order by
      ((r.barber_id is not null)::integer + (r.service_id is not null)::integer) desc,
      (r.service_id is not null) desc,
      lower(r.effective_period) desc,
      r.created_at desc
    limit 1
  ), jsonb_build_object('mode', null, 'percentage_bps', null, 'fixed_cents', null));
$$;

create or replace function public.resolve_booking_selection(
  p_organization_id uuid,
  p_barber_id uuid,
  p_selections jsonb,
  p_appointment_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_selection jsonb;
  v_service public.services%rowtype;
  v_package public.packages%rowtype;
  v_item record;
  v_existing public.appointment_items%rowtype;
  v_commission jsonb;
  v_items jsonb := '[]'::jsonb;
  v_selection_key uuid;
  v_service_id uuid;
  v_package_id uuid;
  v_preserved_key uuid;
  v_quantity integer;
  v_total bigint := 0;
  v_list_total bigint := 0;
  v_duration integer := 0;
  v_position integer := 0;
  v_package_allocated bigint;
  v_line_list bigint;
  v_line_charge bigint;
  v_found integer;
begin
  if jsonb_typeof(p_selections) <> 'array' or jsonb_array_length(p_selections) = 0 then
    raise exception using errcode = '22023', message = 'selections must be a non-empty JSON array';
  end if;
  if not exists (
    select 1 from public.barbers b
    where b.id = p_barber_id and b.organization_id = p_organization_id and b.active
  ) then
    raise exception using errcode = 'P0002', message = 'active barber not found';
  end if;

  for v_selection in select value from jsonb_array_elements(p_selections)
  loop
    if v_selection ? 'preserved_selection_key' then
      if p_appointment_id is null then
        raise exception using errcode = '22023', message = 'preserved selection requires appointment';
      end if;
      v_preserved_key := (v_selection ->> 'preserved_selection_key')::uuid;
      v_found := 0;
      for v_existing in
        select * from public.appointment_items ai
        where ai.organization_id = p_organization_id
          and ai.appointment_id = p_appointment_id
          and ai.selection_key = v_preserved_key
        order by ai.position
      loop
        if not exists (
          select 1 from public.barber_services bs
          where bs.organization_id = p_organization_id
            and bs.barber_id = p_barber_id
            and bs.service_id = v_existing.service_id
            and bs.active
        ) then
          raise exception using errcode = '22023', message = 'barber cannot perform preserved service';
        end if;
        v_position := v_position + 1;
        v_found := v_found + 1;
        v_items := v_items || jsonb_build_array(jsonb_build_object(
          'id', v_existing.id,
          'selection_key', v_existing.selection_key,
          'source', v_existing.source,
          'service_id', v_existing.service_id,
          'package_id', v_existing.package_id,
          'package_item_id', v_existing.package_item_id,
          'service_name', v_existing.service_name_snapshot,
          'quantity', v_existing.quantity,
          'charged_price_cents', v_existing.charged_price_cents_snapshot,
          'list_price_cents', v_existing.list_price_cents_snapshot,
          'duration_minutes', v_existing.duration_minutes_snapshot,
          'commission_mode', v_existing.commission_mode_snapshot,
          'commission_percentage_bps', v_existing.commission_percentage_bps_snapshot,
          'commission_fixed_cents', v_existing.commission_fixed_cents_snapshot,
          'position', v_position
        ));
        v_total := v_total + v_existing.charged_price_cents_snapshot;
        v_list_total := v_list_total + v_existing.list_price_cents_snapshot;
        v_duration := v_duration + v_existing.duration_minutes_snapshot;
      end loop;
      if v_found = 0 then
        raise exception using errcode = 'P0002', message = 'preserved selection not found';
      end if;

    elsif upper(coalesce(v_selection ->> 'type', '')) = 'SERVICE' then
      v_service_id := coalesce(v_selection ->> 'service_id', v_selection ->> 'id')::uuid;
      v_quantity := coalesce((v_selection ->> 'quantity')::integer, 1);
      if v_quantity not between 1 and 20 then
        raise exception using errcode = '22023', message = 'service quantity must be between 1 and 20';
      end if;
      select * into strict v_service
      from public.services s
      where s.id = v_service_id and s.organization_id = p_organization_id and s.active;
      if not exists (
        select 1 from public.barber_services bs
        where bs.organization_id = p_organization_id
          and bs.barber_id = p_barber_id and bs.service_id = v_service.id and bs.active
      ) then
        raise exception using errcode = '22023', message = 'barber cannot perform selected service';
      end if;
      v_selection_key := gen_random_uuid();
      v_commission := public.commission_snapshot_for(p_organization_id, p_barber_id, v_service.id);
      v_position := v_position + 1;
      v_line_list := v_service.price_cents * v_quantity;
      v_items := v_items || jsonb_build_array(jsonb_build_object(
        'id', gen_random_uuid(), 'selection_key', v_selection_key, 'source', 'SERVICE',
        'service_id', v_service.id, 'package_id', null, 'package_item_id', null,
        'service_name', v_service.name, 'quantity', v_quantity,
        'charged_price_cents', v_line_list, 'list_price_cents', v_line_list,
        'duration_minutes', v_service.duration_minutes * v_quantity,
        'commission_mode', v_commission ->> 'mode',
        'commission_percentage_bps', v_commission -> 'percentage_bps',
        'commission_fixed_cents', v_commission -> 'fixed_cents',
        'position', v_position
      ));
      v_total := v_total + v_line_list;
      v_list_total := v_list_total + v_line_list;
      v_duration := v_duration + (v_service.duration_minutes * v_quantity);

    elsif upper(coalesce(v_selection ->> 'type', '')) = 'PACKAGE' then
      v_package_id := coalesce(v_selection ->> 'package_id', v_selection ->> 'id')::uuid;
      select * into strict v_package
      from public.packages p
      where p.id = v_package_id and p.organization_id = p_organization_id and p.active;
      v_selection_key := gen_random_uuid();
      v_package_allocated := 0;
      v_found := 0;
      for v_item in
        select
          pi.id as package_item_id, pi.quantity, pi.position as item_position,
          s.id as service_id, s.name as service_name, s.price_cents, s.duration_minutes,
          row_number() over (order by pi.position, pi.id) as line_number,
          count(*) over () as line_count,
          sum(s.price_cents * pi.quantity) over ()::bigint as package_list_total
        from public.package_items pi
        join public.services s
          on s.id = pi.service_id and s.organization_id = pi.organization_id
        where pi.package_id = v_package.id
          and pi.organization_id = p_organization_id
          and pi.active and s.active
        order by pi.position, pi.id
      loop
        v_found := v_found + 1;
        if not exists (
          select 1 from public.barber_services bs
          where bs.organization_id = p_organization_id
            and bs.barber_id = p_barber_id and bs.service_id = v_item.service_id and bs.active
        ) then
          raise exception using errcode = '22023', message = 'barber cannot perform package service';
        end if;
        v_line_list := v_item.price_cents * v_item.quantity;
        if v_item.package_list_total = 0 then
          v_line_charge := case when v_item.line_number = v_item.line_count
            then v_package.price_cents - v_package_allocated else 0 end;
        elsif v_item.line_number = v_item.line_count then
          v_line_charge := v_package.price_cents - v_package_allocated;
        else
          v_line_charge := floor(
            v_package.price_cents::numeric * v_line_list::numeric / v_item.package_list_total::numeric
          )::bigint;
        end if;
        v_package_allocated := v_package_allocated + v_line_charge;
        v_commission := public.commission_snapshot_for(
          p_organization_id, p_barber_id, v_item.service_id
        );
        v_position := v_position + 1;
        v_items := v_items || jsonb_build_array(jsonb_build_object(
          'id', gen_random_uuid(), 'selection_key', v_selection_key, 'source', 'PACKAGE',
          'service_id', v_item.service_id, 'package_id', v_package.id,
          'package_item_id', v_item.package_item_id, 'service_name', v_item.service_name,
          'quantity', v_item.quantity, 'charged_price_cents', v_line_charge,
          'list_price_cents', v_line_list,
          'duration_minutes', v_item.duration_minutes * v_item.quantity,
          'commission_mode', v_commission ->> 'mode',
          'commission_percentage_bps', v_commission -> 'percentage_bps',
          'commission_fixed_cents', v_commission -> 'fixed_cents',
          'position', v_position
        ));
        v_list_total := v_list_total + v_line_list;
        v_duration := v_duration + (v_item.duration_minutes * v_item.quantity);
      end loop;
      if v_found = 0 then
        raise exception using errcode = '22023', message = 'package has no active items';
      end if;
      v_total := v_total + v_package.price_cents;
    else
      raise exception using errcode = '22023', message = 'selection type must be SERVICE or PACKAGE';
    end if;
  end loop;

  return jsonb_build_object(
    'items', v_items,
    'total_cents', v_total,
    'list_total_cents', v_list_total,
    'duration_minutes', v_duration
  );
exception
  when no_data_found then
    raise exception using errcode = 'P0002', message = 'selected service or package not found';
end;
$$;

create or replace function public.insert_resolved_appointment_items(
  p_appointment_id uuid,
  p_organization_id uuid,
  p_resolution jsonb
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_item jsonb;
begin
  for v_item in select value from jsonb_array_elements(p_resolution -> 'items')
  loop
    insert into public.appointment_items (
      id, organization_id, appointment_id, selection_key, source,
      service_id, package_id, package_item_id, service_name_snapshot, quantity,
      charged_price_cents_snapshot, list_price_cents_snapshot,
      duration_minutes_snapshot, commission_mode_snapshot,
      commission_percentage_bps_snapshot, commission_fixed_cents_snapshot, position
    ) values (
      (v_item ->> 'id')::uuid, p_organization_id, p_appointment_id,
      (v_item ->> 'selection_key')::uuid, (v_item ->> 'source')::public.appointment_item_source,
      (v_item ->> 'service_id')::uuid, (v_item ->> 'package_id')::uuid,
      (v_item ->> 'package_item_id')::uuid, v_item ->> 'service_name',
      (v_item ->> 'quantity')::smallint, (v_item ->> 'charged_price_cents')::bigint,
      (v_item ->> 'list_price_cents')::bigint, (v_item ->> 'duration_minutes')::integer,
      nullif(v_item ->> 'commission_mode', '')::public.commission_mode,
      (v_item ->> 'commission_percentage_bps')::integer,
      (v_item ->> 'commission_fixed_cents')::bigint,
      (v_item ->> 'position')::smallint
    );
  end loop;
end;
$$;

create or replace function public.is_barber_available(
  p_organization_id uuid,
  p_barber_id uuid,
  p_service_period tstzrange
)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_timezone text;
  v_local_start timestamp;
  v_local_end timestamp;
begin
  select timezone into v_timezone
  from public.organizations where id = p_organization_id;
  if v_timezone is null or isempty(p_service_period) then
    return false;
  end if;
  if exists (
    select 1 from public.availability_exceptions ae
    where ae.organization_id = p_organization_id
      and ae.barber_id = p_barber_id
      and ae.kind = 'UNAVAILABLE'
      and ae.service_period && p_service_period
  ) then
    return false;
  end if;
  if exists (
    select 1 from public.availability_exceptions ae
    where ae.organization_id = p_organization_id
      and ae.barber_id = p_barber_id
      and ae.kind = 'AVAILABLE_OVERRIDE'
      and ae.service_period @> p_service_period
  ) then
    return true;
  end if;

  v_local_start := lower(p_service_period) at time zone v_timezone;
  v_local_end := upper(p_service_period) at time zone v_timezone;
  if v_local_start::date <> v_local_end::date then
    return false;
  end if;
  return exists (
    select 1 from public.work_intervals wi
    where wi.organization_id = p_organization_id
      and wi.barber_id = p_barber_id
      and wi.active
      and wi.weekday = extract(dow from v_local_start)::smallint
      and wi.starts_at <= v_local_start::time
      and wi.ends_at >= v_local_end::time
  );
end;
$$;

create or replace function public.create_appointment_hold(
  p_organization_id uuid,
  p_customer_id uuid,
  p_barber_id uuid,
  p_starts_at timestamptz,
  p_selections jsonb,
  p_payment_mode public.payment_mode default 'DEPOSIT'
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_org public.organizations%rowtype;
  v_barber public.barbers%rowtype;
  v_resolution jsonb;
  v_duration integer;
  v_occupied_minutes integer;
  v_period tstzrange;
  v_appointment_id uuid;
  v_total bigint;
  v_due bigint;
  v_expires_at timestamptz;
  v_local_start timestamp;
begin
  if not public.is_organization_customer(p_organization_id, p_customer_id) then
    raise exception using errcode = '42501', message = 'customer identity does not match caller';
  end if;
  if not public.organization_accepts_new_bookings(p_organization_id) then
    raise exception using errcode = '42501', message = 'organization is not accepting new bookings';
  end if;
  if p_payment_mode = 'COUNTER' then
    raise exception using errcode = '22023', message = 'customer booking requires DEPOSIT or FULL payment mode';
  end if;
  if p_starts_at <= now() then
    raise exception using errcode = '22023', message = 'appointment start must be in the future';
  end if;

  select * into strict v_org from public.organizations where id = p_organization_id;
  select * into strict v_barber from public.barbers
    where id = p_barber_id and organization_id = p_organization_id and active;
  v_local_start := p_starts_at at time zone v_org.timezone;
  if extract(second from v_local_start) <> 0
     or mod(extract(minute from v_local_start)::integer, v_org.slot_interval_minutes) <> 0 then
    raise exception using errcode = '22023', message = 'start time is not aligned to slot interval';
  end if;

  v_resolution := public.resolve_booking_selection(
    p_organization_id, p_barber_id, p_selections, null
  );
  v_duration := (v_resolution ->> 'duration_minutes')::integer;
  v_occupied_minutes := ceil(v_duration::numeric / v_org.slot_interval_minutes)::integer
    * v_org.slot_interval_minutes;
  v_period := tstzrange(
    p_starts_at, p_starts_at + make_interval(mins => v_occupied_minutes), '[)'
  );
  if not public.is_barber_available(p_organization_id, p_barber_id, v_period) then
    raise exception using errcode = '22023', message = 'barber is unavailable for requested period';
  end if;

  v_total := (v_resolution ->> 'total_cents')::bigint;
  v_due := case p_payment_mode
    when 'FULL' then v_total
    else round(v_total::numeric * v_org.deposit_bps / 10000)::bigint
  end;
  v_expires_at := now() + make_interval(mins => v_org.hold_duration_minutes);

  insert into public.appointments (
    organization_id, location_id, customer_id, barber_id, status, source,
    service_period, hold_expires_at, payment_mode, currency,
    total_cents_snapshot, list_total_cents_snapshot, deposit_bps_snapshot,
    deposit_required_cents_snapshot, cancellation_lead_minutes_snapshot, created_by
  ) values (
    p_organization_id, v_barber.location_id, p_customer_id, p_barber_id,
    'HELD', 'CUSTOMER', v_period, v_expires_at, p_payment_mode, v_org.currency,
    v_total, (v_resolution ->> 'list_total_cents')::bigint, v_org.deposit_bps,
    round(v_total::numeric * v_org.deposit_bps / 10000)::bigint,
    v_org.cancellation_lead_minutes, auth.uid()
  ) returning id into v_appointment_id;

  perform public.insert_resolved_appointment_items(v_appointment_id, p_organization_id, v_resolution);
  insert into public.appointment_status_events (
    organization_id, appointment_id, to_status, reason, actor_user_id
  ) values (
    p_organization_id, v_appointment_id, 'HELD', 'customer_hold_created', auth.uid()
  );

  return jsonb_build_object(
    'appointment_id', v_appointment_id,
    'status', 'HELD',
    'expires_at', v_expires_at,
    'total_cents', v_total,
    'amount_due_now_cents', v_due,
    'service_period', v_period
  );
exception
  when exclusion_violation then
    raise exception using errcode = '23P01', message = 'requested slot is no longer available';
  when no_data_found then
    raise exception using errcode = 'P0002', message = 'organization or barber not found';
end;
$$;

create or replace function public.enqueue_appointment_notifications()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_phone text;
  v_timezone text;
  v_reminder_at timestamptz;
  v_template text;
  v_action_token text;
begin
  select c.phone_e164, o.timezone into v_phone, v_timezone
  from public.customers c
  join public.organizations o on o.id = c.organization_id
  where c.id = new.customer_id and c.organization_id = new.organization_id;
  if v_phone is null then
    return new;
  end if;

  if new.status = 'CONFIRMED'
     and (tg_op = 'INSERT' or old.status is distinct from 'CONFIRMED'
          or old.service_period is distinct from new.service_period) then
    v_template := case
      when tg_op = 'UPDATE' and old.status = 'CONFIRMED'
        and old.service_period is distinct from new.service_period
      then 'appointment_rescheduled'
      else 'appointment_confirmed'
    end;
    update public.customer_action_tokens
      set consumed_at = now()
      where appointment_id = new.id and consumed_at is null;
    v_action_token := rtrim(translate(encode(gen_random_bytes(32), 'base64'), '+/', '-_'), '=');
    insert into public.customer_action_tokens (
      organization_id, appointment_id, customer_id, action,
      token_hash, expires_at
    ) values (
      new.organization_id, new.id, new.customer_id, 'REQUEST_CANCEL',
      encode(digest(v_action_token, 'sha256'), 'hex'),
      greatest(lower(new.service_period), now() + interval '15 minutes')
    );
    insert into public.notification_outbox (
      organization_id, appointment_id, template_key, recipient_e164,
      payload, idempotency_key
    ) values (
      new.organization_id, new.id, v_template, v_phone,
      jsonb_build_object(
        'appointment_id', new.id,
        'starts_at', lower(new.service_period),
        'version', new.version,
        'action_token', v_action_token
      ),
      'appointment:' || new.id || ':v' || new.version || ':' || v_template
    ) on conflict (organization_id, idempotency_key) do nothing;

    update public.notification_outbox
      set status = 'CANCELED'
      where appointment_id = new.id
        and template_key = 'appointment_reminder_0700'
        and status in ('PENDING', 'FAILED');
    v_reminder_at := (
      ((lower(new.service_period) at time zone v_timezone)::date + time '07:00')
      at time zone v_timezone
    );
    if v_reminder_at > now() then
      insert into public.notification_outbox (
        organization_id, appointment_id, template_key, recipient_e164,
        payload, idempotency_key, scheduled_at, next_attempt_at
      ) values (
        new.organization_id, new.id, 'appointment_reminder_0700', v_phone,
        jsonb_build_object(
          'appointment_id', new.id,
          'starts_at', lower(new.service_period),
          'version', new.version
        ),
        'appointment:' || new.id || ':v' || new.version || ':reminder_0700',
        v_reminder_at, v_reminder_at
      ) on conflict (organization_id, idempotency_key) do nothing;
    end if;
  elsif new.status = 'CANCELED' and (tg_op = 'INSERT' or old.status is distinct from 'CANCELED') then
    update public.notification_outbox
      set status = 'CANCELED'
      where appointment_id = new.id and status in ('PENDING', 'FAILED');
    insert into public.notification_outbox (
      organization_id, appointment_id, template_key, recipient_e164,
      payload, idempotency_key
    ) values (
      new.organization_id, new.id, 'appointment_canceled', v_phone,
      jsonb_build_object('appointment_id', new.id, 'version', new.version),
      'appointment:' || new.id || ':v' || new.version || ':canceled'
    ) on conflict (organization_id, idempotency_key) do nothing;
  end if;
  return new;
end;
$$;

create trigger appointments_enqueue_notifications
  after insert or update of status, service_period on public.appointments
  for each row execute function public.enqueue_appointment_notifications();

create or replace function public.transition_appointment(
  p_appointment_id uuid,
  p_expected_status public.appointment_status,
  p_new_status public.appointment_status,
  p_reason text default null
)
returns public.appointments
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_appointment public.appointments%rowtype;
  v_item public.appointment_items%rowtype;
  v_commission bigint;
begin
  select * into strict v_appointment
  from public.appointments where id = p_appointment_id for update;
  if not public.is_organization_owner(v_appointment.organization_id) then
    raise exception using errcode = '42501', message = 'organization owner required';
  end if;
  if not public.organization_allows_existing_operations(v_appointment.organization_id) then
    raise exception using errcode = '42501', message = 'organization access does not allow appointment operations';
  end if;
  if v_appointment.status <> p_expected_status then
    raise exception using errcode = '40001', message = 'appointment status changed concurrently';
  end if;
  if not (
    (p_expected_status = 'CONFIRMED' and p_new_status in ('IN_SERVICE', 'NO_SHOW'))
    or (p_expected_status = 'IN_SERVICE' and p_new_status = 'COMPLETED')
  ) then
    raise exception using errcode = '22023', message = 'invalid appointment transition';
  end if;

  update public.appointments
  set status = p_new_status,
      amount_waived_cents = case when p_new_status = 'NO_SHOW'
        then total_cents_snapshot else amount_waived_cents end,
      version = version + 1
  where id = p_appointment_id
  returning * into v_appointment;

  insert into public.appointment_status_events (
    organization_id, appointment_id, from_status, to_status,
    reason, actor_user_id
  ) values (
    v_appointment.organization_id, v_appointment.id, p_expected_status,
    p_new_status, p_reason, auth.uid()
  );

  if p_new_status = 'NO_SHOW' then
    update public.payment_orders
      set status = 'CANCELED', failure_code = 'NO_SHOW',
          failure_message = 'Uncaptured balance canceled after no-show'
      where appointment_id = v_appointment.id
        and organization_id = v_appointment.organization_id
        and kind in ('DEPOSIT', 'FULL', 'BALANCE')
        and status in ('CREATED', 'PENDING', 'REQUIRES_ACTION');
  end if;

  if p_new_status = 'COMPLETED' then
    for v_item in
      select * from public.appointment_items
      where appointment_id = v_appointment.id
        and organization_id = v_appointment.organization_id
      order by position
    loop
      v_commission := case v_item.commission_mode_snapshot
        when 'PERCENT' then round(
          v_item.list_price_cents_snapshot::numeric
            * v_item.commission_percentage_bps_snapshot / 10000
        )::bigint
        when 'FIXED' then v_item.commission_fixed_cents_snapshot * v_item.quantity
        else 0
      end;
      if v_commission > 0 then
        insert into public.commission_ledger (
          organization_id, barber_id, appointment_id, appointment_item_id,
          kind, amount_cents, idempotency_key, earned_at, created_by
        ) values (
          v_appointment.organization_id, v_appointment.barber_id,
          v_appointment.id, v_item.id, 'EARNED', v_commission,
          'earned:' || v_appointment.id || ':' || v_item.id,
          now(), auth.uid()
        ) on conflict (organization_id, idempotency_key) do nothing;
      end if;
    end loop;
  end if;
  return v_appointment;
exception
  when no_data_found then
    raise exception using errcode = 'P0002', message = 'appointment not found';
end;
$$;

create or replace function public.cancel_appointment(
  p_appointment_id uuid,
  p_reason text,
  p_requested_by_customer boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_appointment public.appointments%rowtype;
  v_net_paid bigint;
  v_refund_amount bigint;
  v_refund_order_id uuid;
  v_provider public.payment_provider;
  v_before_deadline boolean;
begin
  select * into strict v_appointment
  from public.appointments where id = p_appointment_id for update;
  if not (
    coalesce(auth.role(), '') = 'service_role'
    or public.is_organization_owner(v_appointment.organization_id)
    or (p_requested_by_customer and public.is_organization_customer(
      v_appointment.organization_id, v_appointment.customer_id
    ))
  ) then
    raise exception using errcode = '42501', message = 'appointment cancellation denied';
  end if;
  if coalesce(auth.role(), '') <> 'service_role'
     and not public.organization_allows_existing_operations(v_appointment.organization_id) then
    raise exception using errcode = '42501', message = 'organization access does not allow appointment operations';
  end if;
  if v_appointment.status not in ('HELD', 'PENDING_PAYMENT', 'CONFIRMED') then
    raise exception using errcode = '22023', message = 'appointment cannot be canceled';
  end if;

  select coalesce(sum(case
    when kind in ('CAPTURE', 'ADJUSTMENT') then amount_cents
    when kind in ('REFUND', 'REVERSAL') then -amount_cents
  end), 0)::bigint
  into v_net_paid
  from public.payment_transactions
  where appointment_id = v_appointment.id
    and organization_id = v_appointment.organization_id;
  v_net_paid := greatest(v_net_paid, 0);
  v_before_deadline := now() <= lower(v_appointment.service_period)
    - make_interval(mins => v_appointment.cancellation_lead_minutes_snapshot);
  v_refund_amount := case
    when v_before_deadline then v_net_paid
    else greatest(v_net_paid - v_appointment.deposit_required_cents_snapshot, 0)
  end;

  update public.appointments
    set status = 'CANCELED', hold_expires_at = null,
        amount_waived_cents = total_cents_snapshot, version = version + 1
    where id = v_appointment.id;
  insert into public.appointment_status_events (
    organization_id, appointment_id, from_status, to_status, reason,
    actor_user_id, metadata
  ) values (
    v_appointment.organization_id, v_appointment.id, v_appointment.status,
    'CANCELED', p_reason, auth.uid(),
    jsonb_build_object(
      'before_deadline', v_before_deadline,
      'net_paid_cents', v_net_paid,
      'refund_amount_cents', v_refund_amount
    )
  );

  update public.payment_orders
    set status = 'CANCELED', failure_code = 'APPOINTMENT_CANCELED',
        failure_message = 'Uncaptured payment canceled with appointment'
    where appointment_id = v_appointment.id
      and organization_id = v_appointment.organization_id
      and kind in ('DEPOSIT', 'FULL', 'BALANCE')
      and status in ('CREATED', 'PENDING', 'REQUIRES_ACTION');

  if v_refund_amount > 0 then
    select provider into v_provider
    from public.payment_transactions
    where appointment_id = v_appointment.id
      and organization_id = v_appointment.organization_id
      and kind = 'CAPTURE'
    order by occurred_at desc limit 1;
    v_provider := coalesce(v_provider, 'MANUAL');
    insert into public.payment_orders (
      organization_id, appointment_id, provider, kind, status,
      amount_cents, currency, idempotency_key, metadata
    ) values (
      v_appointment.organization_id, v_appointment.id, v_provider, 'REFUND',
      case when v_provider = 'MERCADO_PAGO' then 'CREATED'::public.payment_order_status
           else 'REQUIRES_ACTION'::public.payment_order_status end,
      v_refund_amount, v_appointment.currency,
      'cancellation-refund:' || v_appointment.id || ':v' || (v_appointment.version + 1),
      jsonb_build_object('reason', p_reason, 'before_deadline', v_before_deadline)
    ) returning id into v_refund_order_id;
  end if;

  return jsonb_build_object(
    'appointment_id', v_appointment.id,
    'status', 'CANCELED',
    'refund_amount_cents', v_refund_amount,
    'refund_order_id', v_refund_order_id,
    'before_deadline', v_before_deadline
  );
exception
  when no_data_found then
    raise exception using errcode = 'P0002', message = 'appointment not found';
end;
$$;

create or replace function public.reschedule_appointment(
  p_appointment_id uuid,
  p_new_barber_id uuid,
  p_new_starts_at timestamptz,
  p_selections jsonb default null,
  p_override_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_appointment public.appointments%rowtype;
  v_org public.organizations%rowtype;
  v_barber public.barbers%rowtype;
  v_resolution jsonb;
  v_effective_selections jsonb;
  v_period tstzrange;
  v_old_period tstzrange;
  v_duration integer;
  v_occupied integer;
  v_old_total bigint;
  v_new_total bigint;
  v_net_paid bigint;
  v_refund_amount bigint := 0;
  v_balance_amount bigint := 0;
  v_refund_order_id uuid;
  v_is_owner boolean;
  v_is_customer boolean;
  v_local_start timestamp;
begin
  select * into strict v_appointment
  from public.appointments where id = p_appointment_id for update;
  v_is_owner := public.is_organization_owner(v_appointment.organization_id);
  v_is_customer := public.is_organization_customer(
    v_appointment.organization_id, v_appointment.customer_id
  );
  if not (v_is_owner or v_is_customer) then
    raise exception using errcode = '42501', message = 'appointment reschedule denied';
  end if;
  if not public.organization_accepts_new_bookings(v_appointment.organization_id) then
    raise exception using errcode = '42501', message = 'organization is not accepting reschedules';
  end if;
  if v_appointment.status <> 'CONFIRMED' then
    raise exception using errcode = '22023', message = 'only confirmed appointments can be rescheduled';
  end if;
  if p_new_starts_at <= now() then
    raise exception using errcode = '22023', message = 'appointment start must be in the future';
  end if;
  if v_is_customer and now() > lower(v_appointment.service_period)
      - make_interval(mins => v_appointment.cancellation_lead_minutes_snapshot) then
    raise exception using errcode = '22023', message = 'customer reschedule deadline passed';
  end if;

  select * into strict v_org from public.organizations
    where id = v_appointment.organization_id;
  select * into strict v_barber from public.barbers
    where id = p_new_barber_id
      and organization_id = v_appointment.organization_id and active;
  v_local_start := p_new_starts_at at time zone v_org.timezone;
  if extract(second from v_local_start) <> 0
     or mod(extract(minute from v_local_start)::integer, v_org.slot_interval_minutes) <> 0 then
    raise exception using errcode = '22023', message = 'start time is not aligned to slot interval';
  end if;
  if p_selections is null then
    select jsonb_agg(jsonb_build_object('preserved_selection_key', keys.selection_key))
      into v_effective_selections
    from (
      select distinct ai.selection_key
      from public.appointment_items ai
      where ai.appointment_id = v_appointment.id
        and ai.organization_id = v_appointment.organization_id
    ) keys;
  else
    v_effective_selections := p_selections;
  end if;
  v_resolution := public.resolve_booking_selection(
    v_appointment.organization_id, p_new_barber_id,
    v_effective_selections, v_appointment.id
  );
  v_duration := (v_resolution ->> 'duration_minutes')::integer;
  v_occupied := ceil(v_duration::numeric / v_org.slot_interval_minutes)::integer
    * v_org.slot_interval_minutes;
  v_period := tstzrange(
    p_new_starts_at, p_new_starts_at + make_interval(mins => v_occupied), '[)'
  );
  if not public.is_barber_available(
    v_appointment.organization_id, p_new_barber_id, v_period
  ) and (not v_is_owner or nullif(btrim(p_override_reason), '') is null) then
    raise exception using errcode = '22023', message = 'barber unavailable or override reason missing';
  end if;

  v_old_period := v_appointment.service_period;
  v_old_total := v_appointment.total_cents_snapshot;
  v_new_total := (v_resolution ->> 'total_cents')::bigint;

  -- This single update acquires the new slot. If GiST rejects it, the old row remains untouched.
  update public.appointments
    set barber_id = p_new_barber_id,
        location_id = v_barber.location_id,
        service_period = v_period,
        total_cents_snapshot = v_new_total,
        list_total_cents_snapshot = (v_resolution ->> 'list_total_cents')::bigint,
        schedule_override_reason = case when v_is_owner
          then nullif(btrim(p_override_reason), '') else null end,
        version = version + 1
    where id = v_appointment.id;

  delete from public.appointment_items
  where appointment_id = v_appointment.id
    and organization_id = v_appointment.organization_id;
  perform public.insert_resolved_appointment_items(
    v_appointment.id, v_appointment.organization_id, v_resolution
  );

  select coalesce(sum(case
    when kind in ('CAPTURE', 'ADJUSTMENT') then amount_cents
    when kind in ('REFUND', 'REVERSAL') then -amount_cents
  end), 0)::bigint
  into v_net_paid
  from public.payment_transactions
  where appointment_id = v_appointment.id
    and organization_id = v_appointment.organization_id;
  v_net_paid := greatest(v_net_paid, 0);
  v_refund_amount := greatest(v_net_paid - v_new_total, 0);
  v_balance_amount := greatest(v_new_total - v_net_paid, 0);
  if v_refund_amount > 0 then
    insert into public.payment_orders (
      organization_id, appointment_id, provider, kind, status,
      amount_cents, currency, idempotency_key, metadata
    ) values (
      v_appointment.organization_id, v_appointment.id, 'MANUAL', 'REFUND',
      'REQUIRES_ACTION', v_refund_amount, v_appointment.currency,
      'reschedule-refund:' || v_appointment.id || ':v' || (v_appointment.version + 1),
      jsonb_build_object(
        'old_total_cents', v_old_total,
        'new_total_cents', v_new_total,
        'net_paid_cents', v_net_paid,
        'manual_action_required', true
      )
    ) returning id into v_refund_order_id;
  end if;

  insert into public.appointment_status_events (
    organization_id, appointment_id, from_status, to_status,
    reason, actor_user_id, metadata
  ) values (
    v_appointment.organization_id, v_appointment.id, 'CONFIRMED', 'CONFIRMED',
    'appointment_rescheduled', auth.uid(),
    jsonb_build_object(
      'old_period', v_old_period,
      'new_period', v_period,
      'old_total_cents', v_old_total,
      'new_total_cents', v_new_total,
      'net_paid_cents', v_net_paid,
      'balance_cents', v_balance_amount,
      'manual_refund_cents', v_refund_amount,
      'refund_order_id', v_refund_order_id
    )
  );

  return jsonb_build_object(
    'appointment_id', v_appointment.id,
    'service_period', v_period,
    'total_cents', v_new_total,
    'balance_cents', v_balance_amount,
    'refund_amount_cents', v_refund_amount,
    'refund_order_id', v_refund_order_id
  );
exception
  when exclusion_violation then
    raise exception using errcode = '23P01', message = 'new slot is no longer available; original appointment preserved';
  when no_data_found then
    raise exception using errcode = 'P0002', message = 'appointment, organization or barber not found';
end;
$$;

create or replace function public.create_manual_appointment(
  p_organization_id uuid,
  p_customer_id uuid,
  p_barber_id uuid,
  p_starts_at timestamptz,
  p_selections jsonb,
  p_override_reason text default null,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_org public.organizations%rowtype;
  v_barber public.barbers%rowtype;
  v_resolution jsonb;
  v_period tstzrange;
  v_duration integer;
  v_occupied integer;
  v_appointment_id uuid;
  v_local_start timestamp;
begin
  if not public.is_organization_owner(p_organization_id) then
    raise exception using errcode = '42501', message = 'organization owner required';
  end if;
  if not public.organization_accepts_new_bookings(p_organization_id) then
    raise exception using errcode = '42501', message = 'organization is not accepting new bookings';
  end if;
  if p_starts_at <= now() then
    raise exception using errcode = '22023', message = 'appointment start must be in the future';
  end if;
  select * into strict v_org from public.organizations where id = p_organization_id;
  select * into strict v_barber from public.barbers
    where id = p_barber_id and organization_id = p_organization_id and active;
  v_local_start := p_starts_at at time zone v_org.timezone;
  if extract(second from v_local_start) <> 0
     or mod(extract(minute from v_local_start)::integer, v_org.slot_interval_minutes) <> 0 then
    raise exception using errcode = '22023', message = 'start time is not aligned to slot interval';
  end if;
  if not exists (
    select 1 from public.customers c
    where c.id = p_customer_id and c.organization_id = p_organization_id and c.active
  ) then
    raise exception using errcode = 'P0002', message = 'active customer not found';
  end if;
  v_resolution := public.resolve_booking_selection(p_organization_id, p_barber_id, p_selections, null);
  v_duration := (v_resolution ->> 'duration_minutes')::integer;
  v_occupied := ceil(v_duration::numeric / v_org.slot_interval_minutes)::integer
    * v_org.slot_interval_minutes;
  v_period := tstzrange(p_starts_at, p_starts_at + make_interval(mins => v_occupied), '[)');
  if not public.is_barber_available(p_organization_id, p_barber_id, v_period)
     and nullif(btrim(p_override_reason), '') is null then
    raise exception using errcode = '22023', message = 'override reason required outside barber schedule';
  end if;

  insert into public.appointments (
    organization_id, location_id, customer_id, barber_id, status, source,
    service_period, payment_mode, currency, total_cents_snapshot,
    list_total_cents_snapshot, deposit_bps_snapshot,
    deposit_required_cents_snapshot, cancellation_lead_minutes_snapshot,
    schedule_override_reason, notes, created_by
  ) values (
    p_organization_id, v_barber.location_id, p_customer_id, p_barber_id,
    'CONFIRMED', 'MANAGER', v_period, 'COUNTER', v_org.currency,
    (v_resolution ->> 'total_cents')::bigint,
    (v_resolution ->> 'list_total_cents')::bigint,
    v_org.deposit_bps,
    round((v_resolution ->> 'total_cents')::numeric * v_org.deposit_bps / 10000)::bigint,
    v_org.cancellation_lead_minutes, nullif(btrim(p_override_reason), ''), p_notes, auth.uid()
  ) returning id into v_appointment_id;
  perform public.insert_resolved_appointment_items(v_appointment_id, p_organization_id, v_resolution);
  insert into public.appointment_status_events (
    organization_id, appointment_id, to_status, reason, actor_user_id,
    metadata
  ) values (
    p_organization_id, v_appointment_id, 'CONFIRMED', 'manager_booking_created', auth.uid(),
    jsonb_build_object('schedule_override_reason', nullif(btrim(p_override_reason), ''))
  );
  return v_appointment_id;
exception
  when exclusion_violation then
    raise exception using errcode = '23P01', message = 'requested slot is no longer available';
  when no_data_found then
    raise exception using errcode = 'P0002', message = 'organization or barber not found';
end;
$$;
