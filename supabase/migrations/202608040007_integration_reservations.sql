-- Concurrency reservations around external APIs and durable refund delivery.

create or replace function public.enqueue_refund_job_from_order()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_capture public.payment_transactions%rowtype;
begin
  if new.provider <> 'MERCADO_PAGO' or new.kind <> 'REFUND'
     or new.status not in ('CREATED', 'PENDING', 'REFUND_PENDING', 'REQUIRES_ACTION') then
    return new;
  end if;
  if new.metadata ? 'capture_transaction_id' then
    select * into v_capture from public.payment_transactions
    where id = (new.metadata ->> 'capture_transaction_id')::uuid
      and organization_id = new.organization_id and kind = 'CAPTURE';
  end if;
  if v_capture.id is null then
    select * into v_capture from public.payment_transactions
    where organization_id = new.organization_id
      and appointment_id = new.appointment_id
      and provider = 'MERCADO_PAGO' and kind = 'CAPTURE'
    order by occurred_at desc limit 1;
  end if;
  if v_capture.id is null or v_capture.external_transaction_id is null then
    return new;
  end if;
  insert into public.refund_jobs (
    organization_id, appointment_id, payment_order_id, capture_transaction_id,
    provider_payment_id, amount_cents, currency, reason, idempotency_key
  ) values (
    new.organization_id, new.appointment_id, new.id, v_capture.id,
    v_capture.external_transaction_id, new.amount_cents, new.currency,
    coalesce(new.metadata ->> 'reason', 'refund_requested'),
    coalesce(new.metadata ->> 'refund_job_idempotency_key', 'refund-job:' || new.id)
  ) on conflict (payment_order_id) do nothing;
  return new;
end;
$$;

create trigger payment_orders_enqueue_refund_job
  after insert or update of status on public.payment_orders
  for each row execute function public.enqueue_refund_job_from_order();

-- Backfill orders created by earlier statements in the same greenfield migration chain.
insert into public.refund_jobs (
  organization_id, appointment_id, payment_order_id, capture_transaction_id,
  provider_payment_id, amount_cents, currency, reason, idempotency_key
)
select
  po.organization_id, po.appointment_id, po.id, capture.id,
  capture.external_transaction_id, po.amount_cents, po.currency,
  coalesce(po.metadata ->> 'reason', 'refund_requested'),
  coalesce(po.metadata ->> 'refund_job_idempotency_key', 'refund-job:' || po.id)
from public.payment_orders po
join lateral (
  select pt.id, pt.external_transaction_id
  from public.payment_transactions pt
  where pt.organization_id = po.organization_id
    and pt.appointment_id = po.appointment_id
    and pt.provider = 'MERCADO_PAGO' and pt.kind = 'CAPTURE'
  order by pt.occurred_at desc limit 1
) capture on true
where po.provider = 'MERCADO_PAGO' and po.kind = 'REFUND'
  and po.status in ('CREATED', 'PENDING', 'REFUND_PENDING', 'REQUIRES_ACTION')
on conflict (payment_order_id) do nothing;

create or replace function public.reserve_stripe_checkout_attempt(
  p_organization_id uuid,
  p_requested_by_user_id uuid,
  p_idempotency_key text,
  p_price_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_subscription public.saas_subscriptions%rowtype;
  v_attempt public.billing_checkout_attempts%rowtype;
begin
  perform public.require_service_role();
  if not public.is_organization_owner(p_organization_id, p_requested_by_user_id) then
    raise exception using errcode = '42501', message = 'organization owner required';
  end if;
  select * into strict v_subscription from public.saas_subscriptions
  where organization_id = p_organization_id for update;
  update public.billing_checkout_attempts
    set status = 'EXPIRED'
    where organization_id = p_organization_id and status in ('RESERVED', 'SESSION_CREATED')
      and reserved_until <= now();

  select * into v_attempt from public.billing_checkout_attempts
  where organization_id = p_organization_id and idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object(
      'attempt_id', v_attempt.id, 'created', false, 'status', v_attempt.status,
      'existing_session_id', v_attempt.stripe_checkout_session_id,
      'stripe_customer_id', v_subscription.stripe_customer_id,
      'stripe_subscription_id', v_subscription.stripe_subscription_id,
      'subscription_status', v_subscription.status,
      'trial_consumed_at', v_subscription.trial_consumed_at
    );
  end if;
  if v_subscription.stripe_subscription_id is not null
     and v_subscription.status in ('TRIALING', 'ACTIVE', 'GRACE', 'BLOCKED') then
    return jsonb_build_object(
      'created', false, 'status', 'SUBSCRIPTION_EXISTS',
      'stripe_customer_id', v_subscription.stripe_customer_id,
      'stripe_subscription_id', v_subscription.stripe_subscription_id,
      'subscription_status', v_subscription.status,
      'trial_consumed_at', v_subscription.trial_consumed_at
    );
  end if;
  select * into v_attempt from public.billing_checkout_attempts
  where organization_id = p_organization_id
    and status in ('RESERVED', 'SESSION_CREATED')
  order by created_at desc limit 1 for update;
  if found then
    return jsonb_build_object(
      'attempt_id', v_attempt.id, 'created', false, 'status', 'CHECKOUT_IN_PROGRESS',
      'existing_session_id', v_attempt.stripe_checkout_session_id,
      'stripe_customer_id', v_subscription.stripe_customer_id,
      'stripe_subscription_id', v_subscription.stripe_subscription_id,
      'subscription_status', v_subscription.status,
      'trial_consumed_at', v_subscription.trial_consumed_at
    );
  end if;
  insert into public.billing_checkout_attempts (
    organization_id, requested_by_user_id, idempotency_key,
    stripe_price_id, reserved_until
  ) values (
    p_organization_id, p_requested_by_user_id, p_idempotency_key,
    p_price_id, now() + interval '10 minutes'
  ) returning * into v_attempt;
  return jsonb_build_object(
    'attempt_id', v_attempt.id, 'created', true, 'status', v_attempt.status,
    'existing_session_id', null,
    'stripe_customer_id', v_subscription.stripe_customer_id,
    'stripe_subscription_id', v_subscription.stripe_subscription_id,
    'subscription_status', v_subscription.status,
    'trial_consumed_at', v_subscription.trial_consumed_at
  );
exception
  when no_data_found then
    raise exception using errcode = 'P0002', message = 'subscription not found';
end;
$$;

create or replace function public.complete_stripe_checkout_attempt(
  p_attempt_id uuid,
  p_checkout_session_id text,
  p_requested_by_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_attempt public.billing_checkout_attempts%rowtype;
begin
  perform public.require_service_role();
  select * into strict v_attempt from public.billing_checkout_attempts
  where id = p_attempt_id for update;
  if v_attempt.requested_by_user_id <> p_requested_by_user_id
     or not public.is_organization_owner(v_attempt.organization_id, p_requested_by_user_id) then
    raise exception using errcode = '42501', message = 'checkout attempt owner mismatch';
  end if;
  if v_attempt.status = 'SESSION_CREATED'
     and v_attempt.stripe_checkout_session_id = p_checkout_session_id then
    return;
  end if;
  if v_attempt.status <> 'RESERVED' or v_attempt.reserved_until <= now() then
    raise exception using errcode = '40001', message = 'checkout reservation is not active';
  end if;
  update public.billing_checkout_attempts
    set status = 'SESSION_CREATED', stripe_checkout_session_id = p_checkout_session_id,
        reserved_until = now() + interval '24 hours'
    where id = v_attempt.id;
  insert into public.billing_sessions (
    organization_id, kind, external_session_id, idempotency_key, requested_by_user_id
  ) values (
    v_attempt.organization_id, 'CHECKOUT', p_checkout_session_id,
    v_attempt.idempotency_key, p_requested_by_user_id
  ) on conflict (kind, external_session_id) do nothing;
end;
$$;

create or replace function public.begin_mercado_pago_checkout(
  p_payment_order_id uuid,
  p_user_id uuid,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_order public.payment_orders%rowtype;
  v_appointment public.appointments%rowtype;
  v_attempt public.merchant_checkout_attempts%rowtype;
  v_context jsonb;
  v_fingerprint text;
  v_created boolean := false;
begin
  perform public.require_service_role();
  select * into strict v_order from public.payment_orders
  where id = p_payment_order_id for update;
  select * into strict v_appointment from public.appointments
  where id = v_order.appointment_id for update;
  if not (
    public.is_organization_owner(v_order.organization_id, p_user_id)
    or public.is_organization_customer(v_order.organization_id, v_appointment.customer_id, p_user_id)
  ) then
    raise exception using errcode = '42501', message = 'payment order access denied';
  end if;
  update public.merchant_checkout_attempts
    set status = 'EXPIRED'
    where payment_order_id = v_order.id and status in ('RESERVED', 'PREFERENCE_CREATED')
      and reserved_until <= now();
  select * into v_attempt from public.merchant_checkout_attempts
  where organization_id = v_order.organization_id and idempotency_key = p_idempotency_key;
  if not found then
    select * into v_attempt from public.merchant_checkout_attempts
    where payment_order_id = v_order.id and status in ('RESERVED', 'PREFERENCE_CREATED')
    order by created_at desc limit 1 for update;
    if found then
      return jsonb_build_object(
        'attempt_id', v_attempt.id, 'created', false,
        'status', 'CHECKOUT_IN_PROGRESS',
        'existing_preference_id', v_attempt.external_preference_id,
        'fingerprint', v_attempt.request_fingerprint
      );
    end if;
    if v_order.provider <> 'MERCADO_PAGO' or v_order.kind = 'REFUND'
       or v_order.status not in ('CREATED', 'PENDING')
       or (v_order.expires_at is not null and v_order.expires_at <= now()) then
      raise exception using errcode = '22023', message = 'payment order is not payable';
    end if;
    v_fingerprint := encode(digest(concat_ws('|',
      v_order.organization_id::text, v_order.id::text, v_order.amount_cents::text,
      v_order.currency::text, coalesce(v_order.expires_at::text, '')
    ), 'sha256'), 'hex');
    insert into public.merchant_checkout_attempts (
      organization_id, payment_order_id, requested_by_user_id,
      idempotency_key, request_fingerprint, reserved_until
    ) values (
      v_order.organization_id, v_order.id, p_user_id,
      p_idempotency_key, v_fingerprint, now() + interval '10 minutes'
    ) returning * into v_attempt;
    v_created := true;
  end if;
  v_context := public.get_payment_checkout_context(
    v_order.id, p_user_id, 'MERCADO_PAGO'
  );
  if v_context is null then
    raise exception using errcode = '55000', message = 'payment checkout context unavailable';
  end if;
  return v_context || jsonb_build_object(
    'attempt_id', v_attempt.id,
    'created', v_created,
    'status', v_attempt.status,
    'existing_preference_id', v_attempt.external_preference_id,
    'fingerprint', v_attempt.request_fingerprint
  );
exception
  when no_data_found then
    raise exception using errcode = 'P0002', message = 'payment order or appointment not found';
end;
$$;

create or replace function public.complete_mercado_pago_checkout(
  p_attempt_id uuid,
  p_preference_id text,
  p_checkout_url text,
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_attempt public.merchant_checkout_attempts%rowtype;
begin
  perform public.require_service_role();
  select * into strict v_attempt from public.merchant_checkout_attempts
  where id = p_attempt_id for update;
  if v_attempt.requested_by_user_id <> p_user_id
     or not public.is_organization_owner(v_attempt.organization_id, p_user_id)
        and not exists (
          select 1 from public.payment_orders po
          join public.appointments a on a.id = po.appointment_id and a.organization_id = po.organization_id
          where po.id = v_attempt.payment_order_id
            and public.is_organization_customer(po.organization_id, a.customer_id, p_user_id)
        ) then
    raise exception using errcode = '42501', message = 'checkout attempt owner mismatch';
  end if;
  if v_attempt.status = 'PREFERENCE_CREATED'
     and v_attempt.external_preference_id = p_preference_id then
    return;
  end if;
  if v_attempt.status <> 'RESERVED' or v_attempt.reserved_until <= now() then
    raise exception using errcode = '40001', message = 'checkout reservation is not active';
  end if;
  update public.merchant_checkout_attempts
    set status = 'PREFERENCE_CREATED', external_preference_id = p_preference_id,
        checkout_url = p_checkout_url, reserved_until = now() + interval '24 hours'
    where id = v_attempt.id;
  update public.payment_orders
    set external_order_id = p_preference_id, external_checkout_url = p_checkout_url,
        status = 'PENDING',
        metadata = metadata || jsonb_build_object(
          'checkout_attempt_id', v_attempt.id,
          'request_fingerprint', v_attempt.request_fingerprint
        )
    where id = v_attempt.payment_order_id;
end;
$$;

create or replace function public.begin_mercado_pago_refund(
  p_organization_id uuid,
  p_payment_order_id uuid,
  p_amount_cents bigint,
  p_reason text,
  p_user_id uuid,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public, vault, pg_temp
as $$
declare
  v_original_order public.payment_orders%rowtype;
  v_appointment public.appointments%rowtype;
  v_capture public.payment_transactions%rowtype;
  v_job public.refund_jobs%rowtype;
  v_refund_order_id uuid;
  v_reserved bigint;
  v_available bigint;
  v_amount bigint;
  v_access_token text;
begin
  perform public.require_service_role();
  select * into strict v_original_order from public.payment_orders
  where id = p_payment_order_id and organization_id = p_organization_id for update;
  select * into strict v_appointment from public.appointments
  where id = v_original_order.appointment_id for update;
  if not public.is_organization_owner(p_organization_id, p_user_id) then
    raise exception using errcode = '42501', message = 'organization owner required';
  end if;
  if not public.organization_allows_existing_operations(p_organization_id) then
    raise exception using errcode = '42501', message = 'organization access does not allow refunds';
  end if;
  select * into v_job from public.refund_jobs
  where organization_id = p_organization_id and idempotency_key = p_idempotency_key;
  if found then
    if v_job.status = 'SUCCEEDED' then
      return jsonb_build_object(
        'refund_job_id', v_job.id, 'created', false, 'status', v_job.status,
        'external_refund_id', v_job.external_refund_id,
        'provider_payment_id', v_job.provider_payment_id,
        'amount_cents', v_job.amount_cents, 'access_token', null,
        'idempotency_key', v_job.idempotency_key
      );
    end if;
    if v_job.status = 'PROCESSING' and v_job.lease_expires_at <= now() then
      update public.refund_jobs
        set status = 'FAILED', claimed_by = null, claimed_at = null,
            lease_expires_at = null, next_attempt_at = now(),
            last_error = coalesce(last_error, 'inline lease expired')
        where id = v_job.id
        returning * into v_job;
    end if;
    if v_job.status in ('PENDING', 'FAILED') then
      update public.refund_jobs
        set status = 'PROCESSING', claimed_by = 'inline:' || p_user_id,
            claimed_at = now(), lease_expires_at = now() + interval '2 minutes',
            attempts = attempts + 1, last_error = null
        where id = v_job.id
        returning * into v_job;
    end if;
    if v_job.status = 'PROCESSING'
       and v_job.claimed_by = 'inline:' || p_user_id
       and v_job.lease_expires_at > now() then
      select ds.decrypted_secret into strict v_access_token
      from public.merchant_accounts ma
      join vault.decrypted_secrets ds on ds.id = ma.access_token_secret_id
      where ma.organization_id = p_organization_id
        and ma.provider = 'MERCADO_PAGO' and ma.status = 'CONNECTED';
    end if;
    return jsonb_build_object(
      'refund_job_id', v_job.id, 'created', false, 'status', v_job.status,
      'external_refund_id', v_job.external_refund_id,
      'provider_payment_id', v_job.provider_payment_id,
      'amount_cents', v_job.amount_cents, 'access_token', v_access_token,
      'idempotency_key', v_job.idempotency_key
    );
  end if;
  -- Mercado Pago refunds target one provider payment. Pick a capture that still
  -- has capacity and reserve only against that capture, never against the
  -- appointment-wide total.
  v_available := 0;
  for v_capture in
    select * from public.payment_transactions
    where organization_id = p_organization_id
      and appointment_id = v_appointment.id
      and provider = 'MERCADO_PAGO' and kind = 'CAPTURE'
    order by occurred_at desc, created_at desc
  loop
    select coalesce(sum(amount_cents), 0)::bigint into v_reserved
    from public.refund_jobs
    where organization_id = p_organization_id
      and capture_transaction_id = v_capture.id
      and status <> 'CANCELED';
    v_available := greatest(v_capture.amount_cents - v_reserved, 0);
    exit when v_available > 0;
  end loop;
  v_amount := coalesce(p_amount_cents, v_available);
  if v_capture.id is null or v_amount <= 0 or v_amount > v_available then
    raise exception using errcode = '22023', message = 'refund exceeds atomically reserved refundable amount';
  end if;
  insert into public.payment_orders (
    organization_id, appointment_id, provider, kind, status,
    amount_cents, currency, idempotency_key, metadata
  ) values (
    p_organization_id, v_appointment.id, 'MERCADO_PAGO', 'REFUND',
    'REFUND_PENDING', v_amount, v_appointment.currency,
    'manual-refund-order:' || p_idempotency_key,
    jsonb_build_object(
      'capture_transaction_id', v_capture.id,
      'reason', left(coalesce(p_reason, 'MANUAL_REFUND'), 500),
      'refund_job_idempotency_key', p_idempotency_key,
      'requested_by_user_id', p_user_id
    )
  ) returning id into v_refund_order_id;
  select * into strict v_job from public.refund_jobs
  where payment_order_id = v_refund_order_id;
  update public.refund_jobs
    set status = 'PROCESSING', claimed_by = 'inline:' || p_user_id,
        claimed_at = now(), lease_expires_at = now() + interval '2 minutes',
        attempts = attempts + 1
    where id = v_job.id
    returning * into v_job;
  select ds.decrypted_secret into strict v_access_token
  from public.merchant_accounts ma
  join vault.decrypted_secrets ds on ds.id = ma.access_token_secret_id
  where ma.organization_id = p_organization_id
    and ma.provider = 'MERCADO_PAGO' and ma.status = 'CONNECTED';
  return jsonb_build_object(
    'refund_job_id', v_job.id, 'created', true, 'status', v_job.status,
    'external_refund_id', null,
    'provider_payment_id', v_job.provider_payment_id,
    'amount_cents', v_job.amount_cents, 'access_token', v_access_token,
    'idempotency_key', v_job.idempotency_key
  );
exception
  when no_data_found then
    raise exception using errcode = 'P0002', message = 'payment, capture, merchant or refund job not found';
end;
$$;

create or replace function public.claim_mercado_pago_refund_jobs(
  p_limit integer,
  p_worker_id text,
  p_lease_seconds integer
)
returns table (
  refund_job_id uuid,
  organization_id uuid,
  payment_order_id uuid,
  appointment_id uuid,
  provider_payment_id text,
  amount_cents bigint,
  currency text,
  idempotency_key text,
  reason text,
  attempt_number integer,
  access_token text
)
language plpgsql
security definer
set search_path = public, vault, pg_temp
as $$
begin
  perform public.require_service_role();
  update public.refund_jobs
    set status = 'FAILED', claimed_by = null, claimed_at = null,
        lease_expires_at = null, next_attempt_at = now(),
        last_error = coalesce(last_error, 'worker lease expired')
    where status = 'PROCESSING' and lease_expires_at <= now();
  return query
  with candidates as (
    select r.id from public.refund_jobs r
    where r.status in ('PENDING', 'FAILED') and r.next_attempt_at <= now()
      and exists (
        select 1
        from public.merchant_accounts ma
        join vault.decrypted_secrets ds on ds.id = ma.access_token_secret_id
        where ma.organization_id = r.organization_id
          and ma.provider = 'MERCADO_PAGO' and ma.status = 'CONNECTED'
      )
    order by r.next_attempt_at, r.created_at
    for update of r skip locked
    limit greatest(1, least(p_limit, 50))
  ), claimed as (
    update public.refund_jobs r
    set status = 'PROCESSING', claimed_by = p_worker_id, claimed_at = now(),
        lease_expires_at = now() + make_interval(secs => greatest(30, least(p_lease_seconds, 600))),
        attempts = r.attempts + 1, last_error = null
    from candidates c where r.id = c.id
    returning r.*
  )
  select
    r.id, r.organization_id, r.payment_order_id, r.appointment_id,
    r.provider_payment_id, r.amount_cents, r.currency::text,
    r.idempotency_key, r.reason, r.attempts, ds.decrypted_secret
  from claimed r
  join public.merchant_accounts ma
    on ma.organization_id = r.organization_id
      and ma.provider = 'MERCADO_PAGO' and ma.status = 'CONNECTED'
  join vault.decrypted_secrets ds on ds.id = ma.access_token_secret_id;
end;
$$;

create or replace function public.complete_mercado_pago_refund_job(
  p_refund_job_id uuid,
  p_worker_id text,
  p_external_refund_id text,
  p_amount_cents bigint,
  p_status text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job public.refund_jobs%rowtype;
  v_transaction_id uuid;
begin
  perform public.require_service_role();
  select * into strict v_job from public.refund_jobs
  where id = p_refund_job_id for update;
  if v_job.status = 'SUCCEEDED' then
    select id into v_transaction_id from public.payment_transactions
    where payment_order_id = v_job.payment_order_id and kind = 'REFUND'
    order by occurred_at desc limit 1;
    return v_transaction_id;
  end if;
  if p_worker_id is not null and (
    v_job.status <> 'PROCESSING' or v_job.claimed_by <> p_worker_id
    or v_job.lease_expires_at <= now()
  ) then
    raise exception using errcode = '40001', message = 'refund job lease is not owned by worker';
  end if;
  if p_worker_id is null and not (
    v_job.status = 'PROCESSING' and v_job.claimed_by like 'inline:%'
      and v_job.lease_expires_at > now()
  ) then
    raise exception using errcode = '40001', message = 'refund job is not reserved inline';
  end if;
  if p_amount_cents <> v_job.amount_cents then
    raise exception using errcode = '22023', message = 'provider refund amount differs from reservation';
  end if;
  v_transaction_id := public.register_provider_refund(
    v_job.payment_order_id, p_external_refund_id, p_amount_cents,
    'refund-job:' || v_job.id, now(),
    jsonb_build_object('provider_status', p_status, 'refund_job_id', v_job.id)
  );
  update public.refund_jobs
    set status = 'SUCCEEDED', external_refund_id = p_external_refund_id,
        claimed_by = null, claimed_at = null, lease_expires_at = null,
        last_error = null
    where id = v_job.id;
  return v_transaction_id;
exception
  when no_data_found then
    raise exception using errcode = 'P0002', message = 'refund job not found';
end;
$$;

create or replace function public.fail_mercado_pago_refund_job(
  p_refund_job_id uuid,
  p_worker_id text,
  p_error_code text,
  p_retryable boolean
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job public.refund_jobs%rowtype;
begin
  perform public.require_service_role();
  select * into strict v_job from public.refund_jobs
  where id = p_refund_job_id for update;
  if v_job.status = 'SUCCEEDED' then
    return;
  end if;
  if p_worker_id is not null and v_job.claimed_by is distinct from p_worker_id then
    raise exception using errcode = '40001', message = 'refund job lease is not owned by worker';
  end if;
  if p_worker_id is null and not (
    v_job.status = 'PROCESSING' and v_job.claimed_by like 'inline:%'
      and v_job.lease_expires_at > now()
  ) then
    raise exception using errcode = '40001', message = 'refund job is not reserved inline';
  end if;
  update public.refund_jobs
  set status = case
      when p_retryable and attempts < 10 then 'FAILED'
      when p_retryable then 'SEND_UNKNOWN'
      else 'CANCELED'
    end,
    next_attempt_at = case when p_retryable and attempts < 10
      then now() + make_interval(secs => least(3600, (30 * (2 ^ least(attempts, 7)))::integer))
      else next_attempt_at end,
    last_error = left(coalesce(p_error_code, 'REFUND_FAILED'), 1000),
    claimed_by = null, claimed_at = null, lease_expires_at = null
  where id = v_job.id;
end;
$$;

create or replace function public.begin_notification_send(
  p_outbox_id uuid,
  p_worker_id text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.require_service_role();
  update public.notification_outbox n
  set status = 'SENDING'
  where n.id = p_outbox_id and n.status = 'PROCESSING'
    and n.claimed_by = p_worker_id and n.lease_expires_at > now()
    and exists (
      select 1
      from public.appointments a
      join public.customers c
        on c.id = a.customer_id and c.organization_id = a.organization_id
      join lateral (
        select ce.action
        from public.consent_events ce
        where ce.organization_id = c.organization_id
          and ce.customer_id = c.id
          and ce.kind = 'WHATSAPP_TRANSACTIONAL'
          order by ce.occurred_at desc, ce.created_at desc, ce.id desc
        limit 1
      ) latest_consent on latest_consent.action = 'GRANTED'
      where a.id = n.appointment_id
        and a.organization_id = n.organization_id
        and c.phone_e164 = n.recipient_e164
    );
  return found;
end;
$$;

create or replace function public.mark_expired_notification_sends_unknown(p_limit integer default 200)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  perform public.require_service_role();
  with candidates as (
    select id from public.notification_outbox
    where status = 'SENDING' and lease_expires_at <= now()
    order by lease_expires_at for update skip locked
    limit greatest(1, least(p_limit, 1000))
  )
  update public.notification_outbox n
    set status = 'SEND_UNKNOWN', claimed_by = null,
        claimed_at = null, lease_expires_at = null,
        last_error = 'provider acceptance may have succeeded; manual reconciliation required'
  from candidates c where n.id = c.id;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Old post-provider recorders are intentionally no longer callable over PostgREST.
revoke all on function public.reserve_stripe_checkout_attempt(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.complete_stripe_checkout_attempt(uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.begin_mercado_pago_checkout(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.complete_mercado_pago_checkout(uuid, text, text, uuid) from public, anon, authenticated;
revoke all on function public.begin_mercado_pago_refund(uuid, uuid, bigint, text, uuid, text) from public, anon, authenticated;
revoke all on function public.claim_mercado_pago_refund_jobs(integer, text, integer) from public, anon, authenticated;
revoke all on function public.complete_mercado_pago_refund_job(uuid, text, text, bigint, text) from public, anon, authenticated;
revoke all on function public.fail_mercado_pago_refund_job(uuid, text, text, boolean) from public, anon, authenticated;
revoke all on function public.begin_notification_send(uuid, text) from public, anon, authenticated;
revoke all on function public.mark_expired_notification_sends_unknown(integer) from public, anon, authenticated;

revoke execute on function public.record_stripe_checkout_session(uuid, text, text, uuid) from service_role;
revoke execute on function public.record_mercado_pago_preference(uuid, text, text, uuid) from service_role;
revoke execute on function public.record_mercado_pago_refund(uuid, text, text, bigint, text, text, uuid, uuid) from service_role;
revoke execute on function public.mark_mercado_pago_refund_pending(uuid, text, bigint, text) from service_role;
revoke execute on function public.register_provider_payment(uuid, text, bigint, text, timestamptz, jsonb) from service_role;
revoke execute on function public.register_provider_refund(uuid, text, bigint, text, timestamptz, jsonb) from service_role;

grant execute on function public.reserve_stripe_checkout_attempt(uuid, uuid, text, text) to service_role;
grant execute on function public.complete_stripe_checkout_attempt(uuid, text, uuid) to service_role;
grant execute on function public.begin_mercado_pago_checkout(uuid, uuid, text) to service_role;
grant execute on function public.complete_mercado_pago_checkout(uuid, text, text, uuid) to service_role;
grant execute on function public.begin_mercado_pago_refund(uuid, uuid, bigint, text, uuid, text) to service_role;
grant execute on function public.claim_mercado_pago_refund_jobs(integer, text, integer) to service_role;
grant execute on function public.complete_mercado_pago_refund_job(uuid, text, text, bigint, text) to service_role;
grant execute on function public.fail_mercado_pago_refund_job(uuid, text, text, boolean) to service_role;
grant execute on function public.begin_notification_send(uuid, text) to service_role;
grant execute on function public.mark_expired_notification_sends_unknown(integer) to service_role;

revoke all on public.billing_checkout_attempts, public.merchant_checkout_attempts,
  public.refund_jobs from anon, authenticated;
grant select on public.billing_checkout_attempts, public.merchant_checkout_attempts,
  public.refund_jobs to authenticated;
