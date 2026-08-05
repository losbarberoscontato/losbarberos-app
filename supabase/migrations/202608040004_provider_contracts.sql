-- Stable database contract consumed by Supabase Edge Functions.

create or replace function public.authorize_organization_owner(
  p_organization_id uuid,
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.is_organization_owner(p_organization_id, p_user_id);
$$;

create or replace function public.get_stripe_checkout_context(p_organization_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'stripe_customer_id', s.stripe_customer_id,
    'stripe_subscription_id', s.stripe_subscription_id,
    'status', s.status,
    'trial_consumed_at', s.trial_consumed_at
  )
  from public.saas_subscriptions s
  where s.organization_id = p_organization_id;
$$;

create or replace function public.record_stripe_checkout_session(
  p_organization_id uuid,
  p_checkout_session_id text,
  p_idempotency_key text,
  p_requested_by_user_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  perform public.require_service_role();
  if not public.is_organization_owner(p_organization_id, p_requested_by_user_id) then
    raise exception using errcode = '42501', message = 'organization owner required';
  end if;
  insert into public.billing_sessions (
    organization_id, kind, external_session_id, idempotency_key, requested_by_user_id
  ) values (
    p_organization_id, 'CHECKOUT', p_checkout_session_id,
    p_idempotency_key, p_requested_by_user_id
  )
  on conflict (organization_id, kind, idempotency_key)
  do update set external_session_id = excluded.external_session_id
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.record_billing_portal_session(
  p_organization_id uuid,
  p_portal_session_id text,
  p_requested_by_user_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  perform public.require_service_role();
  if not public.is_organization_owner(p_organization_id, p_requested_by_user_id) then
    raise exception using errcode = '42501', message = 'organization owner required';
  end if;
  insert into public.billing_sessions (
    organization_id, kind, external_session_id, idempotency_key, requested_by_user_id
  ) values (
    p_organization_id, 'PORTAL', p_portal_session_id,
    p_portal_session_id, p_requested_by_user_id
  )
  on conflict (kind, external_session_id)
  do update set external_session_id = excluded.external_session_id
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.process_stripe_billing_webhook(
  p_event_id text,
  p_event_type text,
  p_event_created_at timestamptz,
  p_livemode boolean,
  p_mapped_status text,
  p_grace_until timestamptz,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event public.webhook_events%rowtype;
  v_subscription public.saas_subscriptions%rowtype;
  v_organization_id uuid;
  v_candidate text;
  v_customer_id text;
  v_subscription_id text;
  v_price_id text;
  v_expected_price_id text;
  v_new_status public.saas_subscription_status;
  v_trial_end timestamptz;
  v_period_end timestamptz;
  v_retention_end timestamptz;
  v_current_rank integer;
  v_new_rank integer;
  v_checkout_attempt_found boolean := false;
  v_bound_organization_id uuid;
begin
  perform public.require_service_role();
  select * into v_event from public.webhook_events
  where provider = 'STRIPE' and external_event_id = p_event_id for update;
  if found and v_event.status = 'COMPLETED' then
    return jsonb_build_object('duplicate', true, 'applied', false);
  elsif not found then
    insert into public.webhook_events (
      provider, external_event_id, event_type, signature_valid,
      provider_created_at, payload, status
    ) values (
      'STRIPE', p_event_id, p_event_type, true,
      p_event_created_at, p_payload, 'PROCESSING'
    ) returning * into v_event;
  else
    update public.webhook_events
      set status = 'PROCESSING', attempts = attempts + 1,
          processing_started_at = now(), last_error = null
      where id = v_event.id;
  end if;

  if p_event_type not in (
    'checkout.session.completed',
    'customer.subscription.created',
    'customer.subscription.updated',
    'customer.subscription.deleted',
    'invoice.paid',
    'invoice.payment_failed'
  ) then
    update public.webhook_events
      set status = 'COMPLETED', processed_at = now(), next_attempt_at = null,
          last_error = null
      where id = v_event.id;
    return jsonb_build_object(
      'duplicate', false, 'applied', false, 'reason', 'UNSUPPORTED_EVENT'
    );
  end if;

  v_candidate := coalesce(
    p_payload #>> '{metadata,organization_id}',
    p_payload ->> 'client_reference_id'
  );
  if v_candidate ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    v_organization_id := v_candidate::uuid;
  end if;
  v_customer_id := case
    when jsonb_typeof(p_payload -> 'customer') = 'string' then p_payload ->> 'customer'
    else p_payload #>> '{customer,id}'
  end;
  v_subscription_id := case
    when p_event_type = 'checkout.session.completed' then
      case when jsonb_typeof(p_payload -> 'subscription') = 'string'
        then p_payload ->> 'subscription' else p_payload #>> '{subscription,id}' end
    when p_event_type like 'customer.subscription.%' then p_payload ->> 'id'
    else coalesce(
      case when jsonb_typeof(p_payload -> 'subscription') = 'string'
        then p_payload ->> 'subscription' else p_payload #>> '{subscription,id}' end,
      p_payload #>> '{parent,subscription_details,subscription}'
    )
  end;
  v_price_id := coalesce(
    p_payload #>> '{items,data,0,price,id}',
    p_payload #>> '{lines,data,0,price,id}'
  );
  if v_organization_id is null then
    select s.organization_id into v_organization_id
    from public.saas_subscriptions s
    where (v_subscription_id is not null and s.stripe_subscription_id = v_subscription_id)
       or (v_customer_id is not null and s.stripe_customer_id = v_customer_id)
    limit 1;
  end if;
  if v_organization_id is null then
    update public.webhook_events
      set status = 'FAILED', next_attempt_at = now() + interval '1 minute',
          last_error = 'organization_unresolved'
      where id = v_event.id;
    return jsonb_build_object('duplicate', false, 'applied', false, 'reason', 'ORGANIZATION_UNRESOLVED');
  end if;

  select * into strict v_subscription
  from public.saas_subscriptions where organization_id = v_organization_id for update;

  select other.organization_id into v_bound_organization_id
  from public.saas_subscriptions other
    where other.organization_id <> v_organization_id
      and (
        (v_customer_id is not null and other.stripe_customer_id = v_customer_id)
        or (v_subscription_id is not null and other.stripe_subscription_id = v_subscription_id)
      )
  limit 1;
  if v_bound_organization_id is not null then
    update public.webhook_events
      set organization_id = v_bound_organization_id,
          status = 'COMPLETED', processed_at = now(), next_attempt_at = null,
          last_error = 'cross_organization_stripe_binding'
      where id = v_event.id;
    return jsonb_build_object(
      'duplicate', false, 'applied', false,
      'reason', 'CROSS_ORGANIZATION_BINDING'
    );
  end if;

  if p_event_type = 'checkout.session.completed' then
    select bca.stripe_price_id, true
      into v_expected_price_id, v_checkout_attempt_found
    from public.billing_checkout_attempts bca
    where bca.organization_id = v_organization_id
      and bca.stripe_checkout_session_id = p_payload ->> 'id'
      and bca.status in ('SESSION_CREATED', 'COMPLETED')
    limit 1;
    if not coalesce(v_checkout_attempt_found, false) then
      update public.webhook_events
        set organization_id = v_organization_id, status = 'FAILED',
            next_attempt_at = now() + interval '1 minute',
            last_error = 'checkout_attempt_unresolved'
        where id = v_event.id;
      return jsonb_build_object(
        'duplicate', false, 'applied', false, 'retryable', true,
        'reason', 'CHECKOUT_ATTEMPT_UNRESOLVED'
      );
    end if;
  else
    v_expected_price_id := v_subscription.stripe_price_id;
    if v_expected_price_id is null then
      select bca.stripe_price_id into v_expected_price_id
      from public.billing_checkout_attempts bca
      where bca.organization_id = v_organization_id
        and bca.status in ('SESSION_CREATED', 'COMPLETED')
      order by bca.updated_at desc, bca.created_at desc
      limit 1;
    end if;
  end if;

  if v_subscription.stripe_customer_id is not null
     and v_customer_id is not null
     and v_subscription.stripe_customer_id <> v_customer_id then
    update public.webhook_events
      set organization_id = v_organization_id,
          status = case when v_subscription_id is null
              or v_subscription_id = v_subscription.stripe_subscription_id
            then 'COMPLETED'::public.webhook_processing_status
            else 'FAILED'::public.webhook_processing_status end,
          processed_at = case when v_subscription_id is null
              or v_subscription_id = v_subscription.stripe_subscription_id
            then now() else null end,
          next_attempt_at = case when v_subscription_id is null
              or v_subscription_id = v_subscription.stripe_subscription_id
            then null else now() + interval '1 minute' end,
          last_error = 'stripe_customer_mismatch'
      where id = v_event.id;
    return jsonb_build_object(
      'duplicate', false, 'applied', false, 'reason', 'CUSTOMER_MISMATCH',
      'cancel_unexpected_subscription_id', case
        when v_subscription_id is distinct from v_subscription.stripe_subscription_id
          then v_subscription_id else null end
    );
  end if;
  if v_subscription.stripe_subscription_id is not null
     and v_subscription_id is not null
     and v_subscription.stripe_subscription_id <> v_subscription_id
     and v_subscription.status in ('TRIALING', 'ACTIVE', 'GRACE', 'BLOCKED') then
    if p_event_type = 'customer.subscription.deleted' then
      update public.webhook_events
        set organization_id = v_organization_id, status = 'COMPLETED',
            processed_at = now(), next_attempt_at = null,
            last_error = 'unexpected_subscription_already_deleted'
        where id = v_event.id;
      return jsonb_build_object(
        'duplicate', false, 'applied', false,
        'reason', 'UNEXPECTED_SUBSCRIPTION_ALREADY_DELETED'
      );
    end if;
    update public.webhook_events
      set organization_id = v_organization_id, status = 'FAILED',
          processed_at = null, next_attempt_at = now() + interval '1 minute',
          last_error = 'unexpected_second_subscription'
      where id = v_event.id;
    return jsonb_build_object(
      'duplicate', false,
      'applied', false,
      'cancel_unexpected_subscription_id', v_subscription_id
    );
  end if;
  if v_price_id is not null and v_expected_price_id is not null
     and v_price_id <> v_expected_price_id then
    update public.webhook_events
      set organization_id = v_organization_id,
          status = case when v_subscription_id is null
              or v_subscription_id = v_subscription.stripe_subscription_id
            then 'COMPLETED'::public.webhook_processing_status
            else 'FAILED'::public.webhook_processing_status end,
          processed_at = case when v_subscription_id is null
              or v_subscription_id = v_subscription.stripe_subscription_id
            then now() else null end,
          next_attempt_at = case when v_subscription_id is null
              or v_subscription_id = v_subscription.stripe_subscription_id
            then null else now() + interval '1 minute' end,
          last_error = 'stripe_price_mismatch'
      where id = v_event.id;
    return jsonb_build_object(
      'duplicate', false, 'applied', false, 'reason', 'PRICE_MISMATCH',
      'cancel_unexpected_subscription_id', case
        when v_subscription_id is distinct from v_subscription.stripe_subscription_id
          then v_subscription_id else null end
    );
  end if;

  if p_mapped_status is not null then
    begin
      v_new_status := p_mapped_status::public.saas_subscription_status;
    exception when invalid_text_representation then
      raise exception using errcode = '22023', message = 'invalid mapped subscription status';
    end;
  else
    v_new_status := v_subscription.status;
  end if;
  if v_subscription.status in ('CANCELED_RETENTION', 'CLOSED')
     and v_subscription_id = v_subscription.stripe_subscription_id
     and v_new_status not in ('CANCELED_RETENTION', 'CLOSED') then
    update public.webhook_events
      set organization_id = v_organization_id, status = 'COMPLETED',
          processed_at = now(), next_attempt_at = null,
          last_error = 'terminal_subscription_event_ignored'
      where id = v_event.id;
    return jsonb_build_object(
      'duplicate', false, 'applied', false, 'reason', 'TERMINAL_SUBSCRIPTION_EVENT'
    );
  end if;
  v_current_rank := case v_subscription.status
    when 'PROVISIONING' then 0 when 'TRIALING' then 10 when 'ACTIVE' then 20
    when 'GRACE' then 30 when 'BLOCKED' then 40
    when 'CANCELED_RETENTION' then 50 when 'CLOSED' then 60 end;
  v_new_rank := case v_new_status
    when 'PROVISIONING' then 0 when 'TRIALING' then 10 when 'ACTIVE' then 20
    when 'GRACE' then 30 when 'BLOCKED' then 40
    when 'CANCELED_RETENTION' then 50 when 'CLOSED' then 60 end;
  if p_event_type <> 'checkout.session.completed'
     and v_subscription.last_provider_event_created_at is not null
     and (
       p_event_created_at < v_subscription.last_provider_event_created_at
       or (
         p_event_created_at = v_subscription.last_provider_event_created_at
         and (
           v_new_rank < v_current_rank
           or (
             v_new_rank = v_current_rank
             and coalesce(v_subscription.last_provider_event_id, '') >= p_event_id
           )
         )
       )
     ) then
    update public.webhook_events
      set organization_id = v_organization_id, status = 'COMPLETED', processed_at = now()
      where id = v_event.id;
    return jsonb_build_object('duplicate', false, 'applied', false, 'reason', 'STALE_EVENT');
  end if;
  v_trial_end := case when (p_payload ->> 'trial_end') ~ '^[0-9]+$'
    then to_timestamp((p_payload ->> 'trial_end')::double precision) else null end;
  v_period_end := case when (p_payload ->> 'current_period_end') ~ '^[0-9]+$'
    then to_timestamp((p_payload ->> 'current_period_end')::double precision) else null end;
  v_retention_end := case when v_new_status = 'CANCELED_RETENTION'
    then now() + make_interval(days => (
      select retention_days from public.organizations where id = v_organization_id
    )) else null end;

  update public.saas_subscriptions
  set stripe_customer_id = coalesce(v_customer_id, stripe_customer_id),
      stripe_subscription_id = coalesce(v_subscription_id, stripe_subscription_id),
      stripe_price_id = coalesce(v_price_id, stripe_price_id),
      status = v_new_status,
      trial_consumed_at = case
        when v_subscription_id is not null then coalesce(trial_consumed_at, now())
        else trial_consumed_at end,
      trial_ends_at = coalesce(v_trial_end, trial_ends_at),
      current_period_ends_at = coalesce(v_period_end, current_period_ends_at),
      grace_ends_at = case
        when v_new_status = 'GRACE' and v_subscription.status = 'GRACE'
          then v_subscription.grace_ends_at
        when v_new_status = 'GRACE'
          then coalesce(p_grace_until, now() + interval '7 days')
        else null end,
      canceled_at = case when v_new_status = 'CANCELED_RETENTION'
        then coalesce(canceled_at, now()) else null end,
      retention_ends_at = case when v_new_status = 'CANCELED_RETENTION'
        then coalesce(retention_ends_at, v_retention_end) else null end,
      last_provider_event_created_at = case
        when p_event_type = 'checkout.session.completed' then last_provider_event_created_at
        else greatest(coalesce(last_provider_event_created_at, p_event_created_at), p_event_created_at)
      end,
      last_provider_event_id = case
        when p_event_type = 'checkout.session.completed' then last_provider_event_id
        else p_event_id end,
      last_provider_event_type = case
        when p_event_type = 'checkout.session.completed' then last_provider_event_type
        else p_event_type end
  where organization_id = v_organization_id;

  if v_new_status is distinct from v_subscription.status then
    insert into public.organization_access_events (
      organization_id, from_status, to_status, reason, provider_event_id,
      metadata
    ) values (
      v_organization_id, v_subscription.status, v_new_status,
      'stripe:' || p_event_type, p_event_id,
      jsonb_build_object('livemode', p_livemode)
    );
  end if;
  update public.webhook_events
    set organization_id = v_organization_id, status = 'COMPLETED',
        processed_at = now(), next_attempt_at = null, last_error = null
    where id = v_event.id;
  if p_event_type = 'checkout.session.completed' then
    update public.billing_checkout_attempts
      set status = 'COMPLETED', reserved_until = now()
      where organization_id = v_organization_id
        and stripe_checkout_session_id = p_payload ->> 'id'
        and status in ('RESERVED', 'SESSION_CREATED');
  end if;
  return jsonb_build_object('duplicate', false, 'applied', true);
end;
$$;

create or replace function public.complete_unexpected_stripe_subscription_cancellation(
  p_event_id text,
  p_subscription_id text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event public.webhook_events%rowtype;
  v_expected_subscription_id text;
begin
  perform public.require_service_role();
  select * into strict v_event
  from public.webhook_events
  where provider = 'STRIPE' and external_event_id = p_event_id
  for update;
  v_expected_subscription_id := case
    when v_event.event_type = 'checkout.session.completed' then
      case when jsonb_typeof(v_event.payload -> 'subscription') = 'string'
        then v_event.payload ->> 'subscription'
        else v_event.payload #>> '{subscription,id}' end
    when v_event.event_type like 'customer.subscription.%' then v_event.payload ->> 'id'
    else coalesce(
      case when jsonb_typeof(v_event.payload -> 'subscription') = 'string'
        then v_event.payload ->> 'subscription'
        else v_event.payload #>> '{subscription,id}' end,
      v_event.payload #>> '{parent,subscription_details,subscription}'
    )
  end;
  if v_event.status = 'COMPLETED' then
    if v_event.last_error = 'unexpected_subscription_canceled'
       and v_expected_subscription_id is not distinct from p_subscription_id then
      return true;
    end if;
    raise exception using errcode = '22023', message = 'event does not await this subscription cancellation';
  end if;
  if v_event.status <> 'FAILED'
     or v_event.last_error not in (
       'unexpected_second_subscription', 'stripe_customer_mismatch',
       'stripe_price_mismatch', 'cross_organization_stripe_binding'
     )
     or v_expected_subscription_id is distinct from p_subscription_id then
    raise exception using errcode = '22023', message = 'event does not await this subscription cancellation';
  end if;
  update public.webhook_events
    set status = 'COMPLETED', processed_at = now(), next_attempt_at = null,
        last_error = 'unexpected_subscription_canceled'
    where id = v_event.id;
  return true;
exception
  when no_data_found then
    raise exception using errcode = 'P0002', message = 'Stripe webhook event not found';
end;
$$;

create or replace function public.create_merchant_oauth_state(
  p_organization_id uuid,
  p_provider public.payment_provider,
  p_state_hash text,
  p_requested_by_user_id uuid,
  p_return_path text,
  p_expires_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  perform public.require_service_role();
  if p_provider <> 'MERCADO_PAGO' then
    raise exception using errcode = '22023', message = 'unsupported merchant provider';
  end if;
  if not public.is_organization_owner(p_organization_id, p_requested_by_user_id) then
    raise exception using errcode = '42501', message = 'organization owner required';
  end if;
  if p_expires_at <= now() or p_expires_at > now() + interval '15 minutes' then
    raise exception using errcode = '22023', message = 'invalid OAuth state expiry';
  end if;
  insert into public.merchant_oauth_states (
    organization_id, provider, state_hash, requested_by_user_id,
    return_path, expires_at
  ) values (
    p_organization_id, p_provider, p_state_hash, p_requested_by_user_id,
    p_return_path, p_expires_at
  ) returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.consume_merchant_oauth_state(
  p_provider public.payment_provider,
  p_state_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_state public.merchant_oauth_states%rowtype;
begin
  perform public.require_service_role();
  select * into v_state
  from public.merchant_oauth_states
  where provider = p_provider and state_hash = p_state_hash
    and consumed_at is null and expires_at > now()
  for update;
  if not found then
    return null;
  end if;
  update public.merchant_oauth_states set consumed_at = now() where id = v_state.id;
  return jsonb_build_object(
    'organization_id', v_state.organization_id,
    'requested_by_user_id', v_state.requested_by_user_id,
    'return_path', v_state.return_path
  );
end;
$$;

create or replace function public.store_merchant_oauth_credentials(
  p_organization_id uuid,
  p_provider public.payment_provider,
  p_external_account_id text,
  p_access_token text,
  p_refresh_token text,
  p_token_type text,
  p_scope text,
  p_expires_at timestamptz,
  p_connected_by_user_id uuid,
  p_live_mode boolean
)
returns uuid
language plpgsql
security definer
set search_path = public, vault, pg_temp
as $$
declare
  v_account public.merchant_accounts%rowtype;
  v_access_secret_id uuid;
  v_refresh_secret_id uuid;
begin
  perform public.require_service_role();
  if p_provider <> 'MERCADO_PAGO' or nullif(p_access_token, '') is null then
    raise exception using errcode = '22023', message = 'invalid merchant credentials';
  end if;
  if not public.is_organization_owner(p_organization_id, p_connected_by_user_id) then
    raise exception using errcode = '42501', message = 'organization owner required';
  end if;
  select * into v_account from public.merchant_accounts
  where organization_id = p_organization_id and provider = p_provider for update;

  if v_account.access_token_secret_id is null then
    select vault.create_secret(
      p_access_token,
      'los-barberos-mp-access-' || p_organization_id,
      'Mercado Pago access token for tenant'
    ) into v_access_secret_id;
  else
    v_access_secret_id := v_account.access_token_secret_id;
    perform vault.update_secret(v_access_secret_id, p_access_token);
  end if;
  if nullif(p_refresh_token, '') is not null then
    if v_account.refresh_token_secret_id is null then
      select vault.create_secret(
        p_refresh_token,
        'los-barberos-mp-refresh-' || p_organization_id,
        'Mercado Pago refresh token for tenant'
      ) into v_refresh_secret_id;
    else
      v_refresh_secret_id := v_account.refresh_token_secret_id;
      perform vault.update_secret(v_refresh_secret_id, p_refresh_token);
    end if;
  else
    v_refresh_secret_id := v_account.refresh_token_secret_id;
  end if;

  insert into public.merchant_accounts (
    organization_id, provider, status, external_account_id,
    access_token_secret_id, refresh_token_secret_id, token_expires_at,
    scopes, connected_at
  ) values (
    p_organization_id, p_provider, 'CONNECTED', p_external_account_id,
    v_access_secret_id, v_refresh_secret_id, p_expires_at,
    case when nullif(btrim(p_scope), '') is null then '{}'::text[]
         else regexp_split_to_array(btrim(p_scope), '\s+') end,
    now()
  )
  on conflict (organization_id, provider) do update set
    status = 'CONNECTED', external_account_id = excluded.external_account_id,
    access_token_secret_id = excluded.access_token_secret_id,
    refresh_token_secret_id = excluded.refresh_token_secret_id,
    token_expires_at = excluded.token_expires_at,
    scopes = excluded.scopes, connected_at = now()
  returning id into v_access_secret_id;

  insert into public.audit_events (
    organization_id, actor_user_id, actor_kind, action, entity_type, entity_id,
    metadata
  ) values (
    p_organization_id, p_connected_by_user_id, 'USER', 'merchant.connected',
    'merchant_account', v_access_secret_id::text,
    jsonb_build_object('provider', p_provider, 'token_type', p_token_type, 'live_mode', p_live_mode)
  );
  return v_access_secret_id;
end;
$$;

create or replace function public.get_merchant_token_refresh_context(
  p_organization_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, vault, pg_temp
as $$
declare
  v_context jsonb;
begin
  perform public.require_service_role();
  select jsonb_build_object(
    'organization_id', ma.organization_id,
    'external_account_id', ma.external_account_id,
    'access_token', access_secret.decrypted_secret,
    'refresh_token', refresh_secret.decrypted_secret,
    'token_expires_at', ma.token_expires_at
  ) into v_context
  from public.merchant_accounts ma
  join vault.decrypted_secrets access_secret
    on access_secret.id = ma.access_token_secret_id
  join vault.decrypted_secrets refresh_secret
    on refresh_secret.id = ma.refresh_token_secret_id
  where ma.organization_id = p_organization_id
    and ma.provider = 'MERCADO_PAGO'
    and ma.status = 'CONNECTED';
  return v_context;
end;
$$;

create or replace function public.store_refreshed_merchant_oauth_credentials(
  p_organization_id uuid,
  p_expected_refresh_token text,
  p_access_token text,
  p_refresh_token text,
  p_expires_at timestamptz,
  p_scope text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, vault, pg_temp
as $$
declare
  v_account public.merchant_accounts%rowtype;
  v_current_access_token text;
  v_current_refresh_token text;
begin
  perform public.require_service_role();
  if nullif(p_expected_refresh_token, '') is null
     or nullif(p_access_token, '') is null
     or nullif(p_refresh_token, '') is null
     or p_expires_at <= now() then
    raise exception using errcode = '22023', message = 'invalid refreshed merchant credentials';
  end if;
  select * into strict v_account
  from public.merchant_accounts
  where organization_id = p_organization_id and provider = 'MERCADO_PAGO'
  for update;
  select decrypted_secret into strict v_current_access_token
  from vault.decrypted_secrets where id = v_account.access_token_secret_id;
  select decrypted_secret into strict v_current_refresh_token
  from vault.decrypted_secrets where id = v_account.refresh_token_secret_id;

  if v_current_refresh_token <> p_expected_refresh_token then
    return jsonb_build_object(
      'updated', false,
      'access_token', v_current_access_token,
      'token_expires_at', v_account.token_expires_at,
      'external_account_id', v_account.external_account_id
    );
  end if;

  perform vault.update_secret(v_account.access_token_secret_id, p_access_token);
  perform vault.update_secret(v_account.refresh_token_secret_id, p_refresh_token);
  update public.merchant_accounts
    set status = 'CONNECTED', token_expires_at = p_expires_at,
        scopes = case when p_scope is null then scopes
          when nullif(btrim(p_scope), '') is null then '{}'::text[]
          else regexp_split_to_array(btrim(p_scope), '\s+') end
    where id = v_account.id;
  insert into public.audit_events (
    organization_id, actor_kind, action, entity_type, entity_id, metadata
  ) values (
    p_organization_id, 'SYSTEM', 'merchant.oauth_refreshed',
    'merchant_account', v_account.id::text,
    jsonb_build_object('provider', 'MERCADO_PAGO', 'expires_at', p_expires_at)
  );
  return jsonb_build_object(
    'updated', true,
    'access_token', p_access_token,
    'token_expires_at', p_expires_at,
    'external_account_id', v_account.external_account_id
  );
exception
  when no_data_found then
    raise exception using errcode = 'P0002', message = 'refreshable Mercado Pago account not found';
end;
$$;

create or replace function public.mark_merchant_reauth_required(
  p_organization_id uuid,
  p_reason text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_account_id uuid;
begin
  perform public.require_service_role();
  if nullif(btrim(p_reason), '') is null then
    raise exception using errcode = '22023', message = 'reauthorization reason is required';
  end if;
  update public.merchant_accounts
    set status = 'REAUTH_REQUIRED'
    where organization_id = p_organization_id and provider = 'MERCADO_PAGO'
    returning id into v_account_id;
  if v_account_id is null then
    return false;
  end if;
  insert into public.audit_events (
    organization_id, actor_kind, action, entity_type, entity_id, metadata
  ) values (
    p_organization_id, 'SYSTEM', 'merchant.reauth_required',
    'merchant_account', v_account_id::text,
    jsonb_build_object('provider', 'MERCADO_PAGO', 'reason', left(btrim(p_reason), 500))
  );
  return true;
end;
$$;

create or replace function public.get_payment_checkout_context(
  p_payment_order_id uuid,
  p_user_id uuid,
  p_provider public.payment_provider
)
returns jsonb
language sql
stable
security definer
set search_path = public, vault, pg_temp
as $$
  select jsonb_build_object(
    'organization_id', po.organization_id,
    'payment_order_id', po.id,
    'appointment_id', po.appointment_id,
    'amount_cents', po.amount_cents,
    'currency', po.currency,
    'description', coalesce((
      select string_agg(ai.service_name_snapshot, ', ' order by ai.position)
      from public.appointment_items ai
      where ai.appointment_id = po.appointment_id and ai.organization_id = po.organization_id
    ), 'Agendamento Los Barberos'),
    'payer_email', c.email,
    'external_reference', po.id::text,
    'access_token', ds.decrypted_secret
  )
  from public.payment_orders po
  join public.appointments a
    on a.id = po.appointment_id and a.organization_id = po.organization_id
  join public.customers c
    on c.id = a.customer_id and c.organization_id = a.organization_id
  join public.merchant_accounts ma
    on ma.organization_id = po.organization_id and ma.provider = p_provider
      and ma.status = 'CONNECTED'
  join vault.decrypted_secrets ds on ds.id = ma.access_token_secret_id
  where po.id = p_payment_order_id
    and po.provider = p_provider
    and po.status in ('CREATED', 'PENDING')
    and (po.expires_at is null or po.expires_at > now())
    and (
      public.is_organization_owner(po.organization_id, p_user_id)
      or public.is_organization_customer(po.organization_id, a.customer_id, p_user_id)
    );
$$;

create or replace function public.record_mercado_pago_preference(
  p_payment_order_id uuid,
  p_preference_id text,
  p_idempotency_key text,
  p_requested_by_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order public.payment_orders%rowtype;
  v_customer_id uuid;
begin
  perform public.require_service_role();
  select po, a.customer_id into v_order, v_customer_id
  from public.payment_orders po
  join public.appointments a on a.id = po.appointment_id and a.organization_id = po.organization_id
  where po.id = p_payment_order_id for update of po;
  if not found then
    raise exception using errcode = 'P0002', message = 'payment order not found';
  end if;
  if not (
    public.is_organization_owner(v_order.organization_id, p_requested_by_user_id)
    or public.is_organization_customer(v_order.organization_id, v_customer_id, p_requested_by_user_id)
  ) then
    raise exception using errcode = '42501', message = 'payment order access denied';
  end if;
  update public.payment_orders
  set external_order_id = p_preference_id, status = 'PENDING',
      metadata = metadata || jsonb_build_object('checkout_idempotency_key', p_idempotency_key)
  where id = p_payment_order_id;
end;
$$;

create or replace function public.resolve_mercado_pago_webhook_account(
  p_external_account_id text
)
returns jsonb
language sql
stable
security definer
set search_path = public, vault, pg_temp
as $$
  select jsonb_build_object(
    'organization_id', ma.organization_id,
    'external_account_id', ma.external_account_id,
    'access_token', ds.decrypted_secret
  )
  from public.merchant_accounts ma
  join vault.decrypted_secrets ds on ds.id = ma.access_token_secret_id
  where ma.provider = 'MERCADO_PAGO'
    and ma.status = 'CONNECTED'
    and ma.external_account_id = p_external_account_id;
$$;

create or replace function public.record_provider_webhook(
  p_provider public.payment_provider,
  p_event_id text,
  p_event_type text,
  p_organization_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.require_service_role();
  return public.register_webhook_event(
    p_provider, p_event_id, p_event_type, true,
    coalesce(p_payload, '{}'::jsonb), p_organization_id, null
  );
end;
$$;

create or replace function public.process_mercado_pago_payment_webhook(
  p_event_id text,
  p_event_type text,
  p_organization_id uuid,
  p_payment_id text,
  p_external_reference text,
  p_status text,
  p_status_detail text,
  p_amount_cents bigint,
  p_currency text,
  p_approved_at timestamptz,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_registration jsonb;
  v_event_id uuid;
  v_event_status public.webhook_processing_status;
  v_order public.payment_orders%rowtype;
  v_result jsonb;
  v_refund_required boolean := false;
  v_refund_amount bigint;
  v_refund_order_id uuid;
  v_capture_id uuid;
begin
  perform public.require_service_role();
  v_registration := public.register_webhook_event(
    'MERCADO_PAGO', p_event_id, p_event_type, true,
    jsonb_build_object(
      'payment_id', p_payment_id, 'external_reference', p_external_reference,
      'status', p_status, 'status_detail', p_status_detail, 'payload', p_payload
    ), p_organization_id, p_approved_at
  );
  v_event_id := (v_registration ->> 'webhook_event_id')::uuid;
  select status into v_event_status from public.webhook_events where id = v_event_id;
  if not (v_registration ->> 'inserted')::boolean and v_event_status = 'COMPLETED' then
    return jsonb_build_object('duplicate', true, 'applied', false);
  end if;
  update public.webhook_events
    set status = 'PROCESSING', attempts = attempts + 1, processing_started_at = now()
    where id = v_event_id;

  if p_currency <> 'BRL' or p_amount_cents <= 0 then
    perform public.finish_webhook_event(v_event_id, false, 'invalid payment amount or currency', null);
    raise exception using errcode = '22023', message = 'invalid payment amount or currency';
  end if;
  if coalesce(p_external_reference, '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    select * into v_order from public.payment_orders
    where id = p_external_reference::uuid and organization_id = p_organization_id;
  end if;
  if not found then
    select * into v_order from public.payment_orders
    where provider = 'MERCADO_PAGO'
      and external_order_id = p_external_reference
      and organization_id = p_organization_id;
  end if;
  if v_order.id is null then
    perform public.finish_webhook_event(v_event_id, true, null, null);
    return jsonb_build_object('duplicate', false, 'applied', false, 'reason', 'ORDER_NOT_FOUND');
  end if;

  case upper(p_status)
    when 'CAPTURED' then
      v_result := public.register_provider_payment(
        v_order.id, p_payment_id, p_amount_cents,
        'mp-payment:' || p_payment_id,
        coalesce(p_approved_at, now()),
        coalesce(p_payload, '{}'::jsonb) || jsonb_build_object('status_detail', p_status_detail)
      );
      v_refund_required := coalesce(v_result ->> 'disposition', '') like 'REFUND_PENDING%';
      if v_refund_required then
        select amount_cents into v_refund_amount
        from public.payment_orders
        where id = (v_result ->> 'refund_order_id')::uuid;
      end if;
    when 'PENDING' then
      update public.payment_orders set status = 'PENDING' where id = v_order.id;
    when 'FAILED' then
      update public.payment_orders
        set status = 'FAILED', failure_code = p_status_detail,
            failure_message = 'Mercado Pago payment failed'
        where id = v_order.id and status <> 'PAID';
    when 'CANCELED' then
      update public.payment_orders set status = 'CANCELED'
      where id = v_order.id and status <> 'PAID';
    when 'REFUNDED', 'CHARGEBACK' then
      select id into v_capture_id from public.payment_transactions
      where organization_id = p_organization_id
        and provider = 'MERCADO_PAGO'
        and external_transaction_id = p_payment_id
        and kind = 'CAPTURE';
      if v_capture_id is not null and not exists (
        select 1 from public.payment_transactions
        where organization_id = p_organization_id
          and idempotency_key = 'mp-provider-reversal:' || p_payment_id || ':' || upper(p_status)
      ) then
        insert into public.payment_orders (
          organization_id, appointment_id, provider, kind, status,
          amount_cents, currency, idempotency_key, metadata
        ) values (
          p_organization_id, v_order.appointment_id, 'MERCADO_PAGO', 'REFUND',
          'REFUND_PENDING', p_amount_cents, v_order.currency,
          'mp-provider-reversal-order:' || p_payment_id || ':' || upper(p_status),
          jsonb_build_object('provider_status', p_status, 'capture_transaction_id', v_capture_id)
        ) returning id into v_refund_order_id;
        perform public.register_provider_refund(
          v_refund_order_id, p_payment_id || ':' || upper(p_status), p_amount_cents,
          'mp-provider-reversal:' || p_payment_id || ':' || upper(p_status),
          now(), p_payload
        );
      end if;
    else
      perform public.finish_webhook_event(v_event_id, true, null, null);
      return jsonb_build_object('duplicate', false, 'applied', false, 'reason', 'IGNORED_STATUS');
  end case;

  perform public.finish_webhook_event(v_event_id, true, null, null);
  return jsonb_build_object(
    'duplicate', false,
    'applied', true,
    'refund_required', v_refund_required,
    'refund_amount_cents', v_refund_amount
  );
exception
  when others then
    if v_event_id is not null then
      begin
        perform public.finish_webhook_event(v_event_id, false, sqlerrm, null);
      exception when others then null;
      end;
    end if;
    raise;
end;
$$;

create or replace function public.get_payment_refund_context(
  p_organization_id uuid,
  p_payment_order_id uuid,
  p_provider public.payment_provider
)
returns jsonb
language sql
stable
security definer
set search_path = public, vault, pg_temp
as $$
  with target as (
    select po.organization_id, po.appointment_id
    from public.payment_orders po
    where po.id = p_payment_order_id
      and po.organization_id = p_organization_id
  ), totals as (
    select
      t.organization_id, t.appointment_id,
      (array_agg(t.external_transaction_id order by t.occurred_at desc)
        filter (where t.kind = 'CAPTURE' and t.provider = p_provider))[1] as provider_payment_id,
      coalesce(sum(t.amount_cents) filter (where t.kind = 'CAPTURE' and t.provider = p_provider), 0)::bigint
        - coalesce(sum(t.amount_cents) filter (where t.kind in ('REFUND', 'REVERSAL') and t.provider = p_provider), 0)::bigint
        as refundable_amount_cents
    from public.payment_transactions t
    join target x on x.organization_id = t.organization_id and x.appointment_id = t.appointment_id
    group by t.organization_id, t.appointment_id
  )
  select jsonb_build_object(
    'organization_id', totals.organization_id,
    'provider_payment_id', totals.provider_payment_id,
    'refundable_amount_cents', greatest(totals.refundable_amount_cents, 0),
    'access_token', ds.decrypted_secret
  )
  from totals
  join public.merchant_accounts ma
    on ma.organization_id = totals.organization_id and ma.provider = p_provider
      and ma.status = 'CONNECTED'
  join vault.decrypted_secrets ds on ds.id = ma.access_token_secret_id
  where totals.provider_payment_id is not null and totals.refundable_amount_cents > 0;
$$;

create or replace function public.record_mercado_pago_refund(
  p_organization_id uuid,
  p_payment_id text,
  p_refund_id text,
  p_amount_cents bigint,
  p_status text,
  p_reason text,
  p_payment_order_id uuid default null,
  p_requested_by_user_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_capture public.payment_transactions%rowtype;
  v_target_order public.payment_orders%rowtype;
  v_refund_order_id uuid;
begin
  perform public.require_service_role();
  if p_amount_cents <= 0 then
    raise exception using errcode = '22023', message = 'refund amount must be positive';
  end if;
  select * into strict v_capture from public.payment_transactions
  where organization_id = p_organization_id
    and provider = 'MERCADO_PAGO' and external_transaction_id = p_payment_id
    and kind = 'CAPTURE';
  if p_requested_by_user_id is not null
     and not public.is_organization_owner(p_organization_id, p_requested_by_user_id) then
    raise exception using errcode = '42501', message = 'organization owner required';
  end if;

  if p_payment_order_id is not null then
    select * into v_target_order from public.payment_orders
    where id = p_payment_order_id and organization_id = p_organization_id;
  end if;
  if v_target_order.kind = 'REFUND' then
    v_refund_order_id := v_target_order.id;
  else
    select id into v_refund_order_id from public.payment_orders
    where organization_id = p_organization_id
      and appointment_id = v_capture.appointment_id
      and kind = 'REFUND'
      and status in ('CREATED', 'PENDING', 'REFUND_PENDING', 'REQUIRES_ACTION')
    order by created_at limit 1 for update;
  end if;
  if v_refund_order_id is null then
    insert into public.payment_orders (
      organization_id, appointment_id, provider, kind, status,
      amount_cents, currency, idempotency_key, metadata
    ) values (
      p_organization_id, v_capture.appointment_id, 'MERCADO_PAGO', 'REFUND',
      'REFUND_PENDING', p_amount_cents, v_capture.currency,
      'mp-refund-order:' || p_refund_id,
      jsonb_build_object('payment_id', p_payment_id, 'reason', p_reason)
    ) returning id into v_refund_order_id;
  end if;
  return public.register_provider_refund(
    v_refund_order_id, p_refund_id, p_amount_cents,
    'mp-refund:' || p_refund_id, now(),
    jsonb_build_object('payment_id', p_payment_id, 'status', p_status, 'reason', p_reason)
  );
exception
  when no_data_found then
    raise exception using errcode = 'P0002', message = 'Mercado Pago capture not found';
end;
$$;

create or replace function public.mark_mercado_pago_refund_pending(
  p_organization_id uuid,
  p_payment_id text,
  p_amount_cents bigint,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_capture public.payment_transactions%rowtype;
  v_order_id uuid;
begin
  perform public.require_service_role();
  select * into strict v_capture from public.payment_transactions
  where organization_id = p_organization_id
    and provider = 'MERCADO_PAGO' and external_transaction_id = p_payment_id
    and kind = 'CAPTURE';
  select id into v_order_id from public.payment_orders
  where organization_id = p_organization_id
    and appointment_id = v_capture.appointment_id and kind = 'REFUND'
    and status in ('CREATED', 'PENDING', 'REFUND_PENDING', 'REQUIRES_ACTION')
  order by created_at limit 1 for update;
  if v_order_id is null then
    insert into public.payment_orders (
      organization_id, appointment_id, provider, kind, status,
      amount_cents, currency, idempotency_key, failure_message, metadata
    ) values (
      p_organization_id, v_capture.appointment_id, 'MERCADO_PAGO', 'REFUND',
      'REFUND_PENDING', p_amount_cents, v_capture.currency,
      'mp-refund-pending:' || p_payment_id, left(p_reason, 1000),
      jsonb_build_object('payment_id', p_payment_id)
    ) returning id into v_order_id;
  else
    update public.payment_orders
      set status = 'REFUND_PENDING', failure_message = left(p_reason, 1000)
      where id = v_order_id;
  end if;
  return v_order_id;
exception
  when no_data_found then
    raise exception using errcode = 'P0002', message = 'Mercado Pago capture not found';
end;
$$;

create or replace function public.record_whatsapp_opt_out(
  p_external_message_id text,
  p_sender_e164 text,
  p_phone_number_id text,
  p_occurred_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_organization_id uuid;
  v_customer_id uuid;
begin
  perform public.require_service_role();
  select o.id, c.id into v_organization_id, v_customer_id
  from public.organizations o
  join public.customers c on c.organization_id = o.id
  where o.whatsapp_phone_number_id = p_phone_number_id
    and c.phone_e164 = p_sender_e164
    and c.active and c.merged_into_customer_id is null
  limit 1;
  if v_customer_id is null then
    return false;
  end if;
  insert into public.consent_events (
    organization_id, customer_id, kind, action, source,
    external_event_id, proof, occurred_at
  ) values (
    v_organization_id, v_customer_id, 'WHATSAPP_TRANSACTIONAL', 'REVOKED',
    'WHATSAPP_INBOUND', p_external_message_id,
    jsonb_build_object('sender_e164', p_sender_e164, 'phone_number_id', p_phone_number_id),
    p_occurred_at
  ) on conflict (organization_id, external_event_id) do nothing;
  update public.notification_outbox
    set status = 'CANCELED'
    where organization_id = v_organization_id and recipient_e164 = p_sender_e164
      and status in ('PENDING', 'FAILED', 'PROCESSING');
  return true;
end;
$$;

create or replace function public.process_whatsapp_action_token(
  p_token_hash text,
  p_sender_e164 text,
  p_phone_number_id text,
  p_external_message_id text,
  p_next_token text,
  p_next_token_expires_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_token public.customer_action_tokens%rowtype;
  v_appointment public.appointments%rowtype;
  v_registration jsonb;
  v_event_id uuid;
  v_next_hash text;
  v_label text;
begin
  perform public.require_service_role();
  v_registration := public.register_webhook_event(
    'WHATSAPP', p_external_message_id, 'messages.action', true,
    jsonb_build_object(
      'token_hash', p_token_hash, 'sender_e164', p_sender_e164,
      'phone_number_id', p_phone_number_id
    ), null, null
  );
  v_event_id := (v_registration ->> 'webhook_event_id')::uuid;
  if not (v_registration ->> 'inserted')::boolean
     and exists (select 1 from public.webhook_events where id = v_event_id and status = 'COMPLETED') then
    return jsonb_build_object('processed', false, 'duplicate', true);
  end if;

  select t.* into v_token
  from public.customer_action_tokens t
  join public.customers c
    on c.id = t.customer_id and c.organization_id = t.organization_id
  join public.organizations o on o.id = t.organization_id
  where t.token_hash = p_token_hash
    and t.consumed_at is null and t.expires_at > now()
    and c.phone_e164 = p_sender_e164
    and o.whatsapp_phone_number_id = p_phone_number_id
  for update of t;
  if not found then
    perform public.finish_webhook_event(v_event_id, true, null, null);
    return null;
  end if;
  update public.customer_action_tokens set consumed_at = now() where id = v_token.id;
  update public.webhook_events set organization_id = v_token.organization_id where id = v_event_id;

  select * into strict v_appointment from public.appointments
  where id = v_token.appointment_id and organization_id = v_token.organization_id
  for update;
  v_label := to_char(
    lower(v_appointment.service_period) at time zone (
      select timezone from public.organizations where id = v_token.organization_id
    ),
    'DD/MM/YYYY HH24:MI'
  );

  if v_token.action = 'REQUEST_CANCEL' then
    if nullif(p_next_token, '') is null
       or p_next_token_expires_at <= now()
       or p_next_token_expires_at > now() + interval '20 minutes' then
      raise exception using errcode = '22023', message = 'invalid next action token';
    end if;
    v_next_hash := encode(digest(p_next_token, 'sha256'), 'hex');
    insert into public.customer_action_tokens (
      organization_id, appointment_id, customer_id, action,
      token_hash, expires_at
    ) values (
      v_token.organization_id, v_token.appointment_id, v_token.customer_id,
      'CONFIRM_CANCEL', v_next_hash, p_next_token_expires_at
    );
    insert into public.notification_outbox (
      organization_id, appointment_id, template_key, recipient_e164,
      payload, idempotency_key
    ) values (
      v_token.organization_id, v_token.appointment_id, 'whatsapp_cancel_prompt',
      p_sender_e164,
      jsonb_build_object(
        'message_kind', 'CANCEL_CONFIRM_PROMPT',
        'action_token', p_next_token,
        'appointment_label', v_label
      ),
      'whatsapp-cancel-prompt:' || v_token.id
    ) on conflict (organization_id, idempotency_key) do nothing;
  elsif v_token.action = 'CONFIRM_CANCEL' then
    if v_appointment.status in ('HELD', 'PENDING_PAYMENT', 'CONFIRMED') then
      perform public.cancel_appointment(
        v_appointment.id, 'whatsapp_customer_confirmation', true
      );
    elsif v_appointment.status <> 'CANCELED' then
      perform public.finish_webhook_event(v_event_id, true, null, null);
      return jsonb_build_object('processed', true, 'applied', false);
    end if;
    insert into public.notification_outbox (
      organization_id, appointment_id, template_key, recipient_e164,
      payload, idempotency_key
    ) values (
      v_token.organization_id, v_token.appointment_id,
      'appointment_cancellation_confirmed', p_sender_e164,
      jsonb_build_object('message_kind', 'TEMPLATE', 'appointment_id', v_appointment.id),
      'whatsapp-cancel-confirmed:' || v_token.id
    ) on conflict (organization_id, idempotency_key) do nothing;
  end if;
  perform public.finish_webhook_event(v_event_id, true, null, null);
  return jsonb_build_object('processed', true, 'applied', true);
end;
$$;

create or replace function public.claim_notification_outbox(
  p_provider text,
  p_limit integer,
  p_worker_id text,
  p_lease_seconds integer
)
returns table (
  id uuid,
  organization_id uuid,
  recipient_e164 text,
  message_kind text,
  template_name text,
  language_code text,
  template_components jsonb,
  action_token text,
  appointment_label text,
  text_body text,
  attempt_number integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.require_service_role();
  if upper(p_provider) <> 'WHATSAPP' then
    raise exception using errcode = '22023', message = 'unsupported outbox provider';
  end if;
  return query
  with candidates as (
    select n.id
    from public.notification_outbox n
    where (
        n.status in ('PENDING', 'FAILED')
        or (n.status = 'PROCESSING' and n.lease_expires_at <= now())
      )
      and n.next_attempt_at <= now() and n.scheduled_at <= now()
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
        where a.id = n.appointment_id and a.organization_id = n.organization_id
          and c.phone_e164 = n.recipient_e164
      )
    order by n.next_attempt_at, n.created_at
    for update skip locked
    limit greatest(1, least(p_limit, 50))
  ), claimed as (
    update public.notification_outbox n
    set status = 'PROCESSING', claimed_at = now(), claimed_by = p_worker_id,
        lease_expires_at = now() + make_interval(secs => greatest(30, least(p_lease_seconds, 600))),
        attempts = n.attempts + 1
    from candidates c
    where n.id = c.id
    returning n.*
  )
  select
    n.id,
    n.organization_id,
    n.recipient_e164,
    coalesce(n.payload ->> 'message_kind', 'TEMPLATE') as message_kind,
    case when coalesce(n.payload ->> 'message_kind', 'TEMPLATE') = 'TEMPLATE'
      then n.template_key else null end as template_name,
    n.locale as language_code,
    case
      when n.payload ? 'template_components' then n.payload -> 'template_components'
      when n.payload ? 'action_token' and coalesce(n.payload ->> 'message_kind', 'TEMPLATE') = 'TEMPLATE'
        then jsonb_build_array(jsonb_build_object(
          'type', 'button', 'sub_type', 'quick_reply', 'index', '0',
          'parameters', jsonb_build_array(jsonb_build_object(
            'type', 'payload', 'payload', n.payload ->> 'action_token'
          ))
        ))
      else null
    end as template_components,
    n.payload ->> 'action_token' as action_token,
    n.payload ->> 'appointment_label' as appointment_label,
    n.payload ->> 'text_body' as text_body,
    n.attempts as attempt_number
  from claimed n;
end;
$$;

create or replace function public.complete_notification_attempt(
  p_outbox_id uuid,
  p_worker_id text,
  p_succeeded boolean,
  p_external_message_id text,
  p_error_code text,
  p_retryable boolean
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_outbox public.notification_outbox%rowtype;
begin
  perform public.require_service_role();
  select * into strict v_outbox from public.notification_outbox
  where id = p_outbox_id for update;
  if v_outbox.status <> 'SENDING' or v_outbox.claimed_by <> p_worker_id
     or v_outbox.lease_expires_at < now() then
    raise exception using errcode = '40001', message = 'outbox lease is not owned by worker';
  end if;

  insert into public.message_attempts (
    organization_id, outbox_id, attempt_number, status,
    provider_message_id, response, error_message
  ) values (
    v_outbox.organization_id, v_outbox.id, v_outbox.attempts,
    case when p_succeeded then 'ACCEPTED'::public.message_attempt_status
         else 'FAILED'::public.message_attempt_status end,
    p_external_message_id,
    jsonb_build_object('error_code', p_error_code, 'retryable', p_retryable),
    p_error_code
  ) on conflict (outbox_id, attempt_number, status) do nothing;

  update public.notification_outbox
  set status = case
        when p_succeeded then 'SENT'::public.outbox_status
        when p_retryable and attempts < 5 then 'FAILED'::public.outbox_status
        else 'CANCELED'::public.outbox_status
      end,
      sent_at = case when p_succeeded then now() else null end,
      next_attempt_at = case when not p_succeeded and p_retryable and attempts < 5
        then now() + make_interval(secs => least(3600, (30 * (2 ^ least(attempts, 6)))::integer))
        else next_attempt_at end,
      last_error = case when p_succeeded then null else left(coalesce(p_error_code, 'SEND_FAILED'), 1000) end,
      claimed_by = null, claimed_at = null, lease_expires_at = null
  where id = v_outbox.id;
end;
$$;

create or replace function public.process_whatsapp_delivery_status(
  p_event_id text,
  p_external_message_id text,
  p_status text,
  p_occurred_at timestamptz,
  p_recipient_id text,
  p_errors jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_attempt public.message_attempts%rowtype;
  v_status public.message_attempt_status;
  v_registration jsonb;
begin
  perform public.require_service_role();
  v_registration := public.register_webhook_event(
    'WHATSAPP', p_event_id, 'messages.status', true,
    jsonb_build_object(
      'external_message_id', p_external_message_id, 'status', p_status,
      'recipient_id', p_recipient_id, 'errors', coalesce(p_errors, '[]'::jsonb)
    ), null, p_occurred_at
  );
  if not (v_registration ->> 'inserted')::boolean then
    return false;
  end if;
  begin
    v_status := upper(p_status)::public.message_attempt_status;
  exception when invalid_text_representation then
    v_status := 'UNKNOWN';
  end;
  select * into v_attempt from public.message_attempts
  where provider_message_id = p_external_message_id
  order by created_at desc limit 1;
  if not found then
    perform public.finish_webhook_event(
      (v_registration ->> 'webhook_event_id')::uuid, true, null, null
    );
    return false;
  end if;
  insert into public.message_attempts (
    organization_id, outbox_id, attempt_number, status,
    provider_message_id, response, error_message, occurred_at
  ) values (
    v_attempt.organization_id, v_attempt.outbox_id, v_attempt.attempt_number,
    v_status, p_external_message_id,
    jsonb_build_object('recipient_id', p_recipient_id, 'errors', coalesce(p_errors, '[]'::jsonb)),
    case when v_status = 'FAILED' then left(coalesce(p_errors::text, 'delivery failed'), 1000) end,
    p_occurred_at
  ) on conflict (provider_message_id, status) do nothing;
  update public.webhook_events
    set organization_id = v_attempt.organization_id
    where id = (v_registration ->> 'webhook_event_id')::uuid;
  perform public.finish_webhook_event(
    (v_registration ->> 'webhook_event_id')::uuid, true, null, null
  );
  return true;
end;
$$;
