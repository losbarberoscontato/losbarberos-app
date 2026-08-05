-- Scheduled operations, privacy workflows and remaining manager interfaces.

create or replace function public.expire_stale_appointment_holds(p_limit integer default 200)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row record;
  v_count integer := 0;
begin
  perform public.require_service_role();
  for v_row in
    select id, organization_id, status
    from public.appointments
    where status in ('HELD', 'PENDING_PAYMENT') and hold_expires_at <= now()
    order by hold_expires_at
    for update skip locked
    limit greatest(1, least(p_limit, 1000))
  loop
    update public.appointments
      set status = 'EXPIRED', hold_expires_at = null, version = version + 1
      where id = v_row.id;
    insert into public.appointment_status_events (
      organization_id, appointment_id, from_status, to_status, reason
    ) values (
      v_row.organization_id, v_row.id, v_row.status, 'EXPIRED', 'hold_expired'
    );
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

create or replace function public.process_expired_billing_grace(p_limit integer default 200)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row record;
  v_count integer := 0;
begin
  perform public.require_service_role();
  for v_row in
    select id, organization_id
    from public.saas_subscriptions
    where status = 'GRACE' and grace_ends_at <= now()
    order by grace_ends_at
    for update skip locked
    limit greatest(1, least(p_limit, 1000))
  loop
    update public.saas_subscriptions
      set status = 'BLOCKED', grace_ends_at = null
      where id = v_row.id;
    insert into public.organization_access_events (
      organization_id, from_status, to_status, reason
    ) values (
      v_row.organization_id, 'GRACE', 'BLOCKED', 'billing_grace_expired'
    );
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

create or replace function public.process_expired_organization_retention(p_limit integer default 100)
returns integer
language plpgsql
security definer
set search_path = public, vault, pg_temp
as $$
declare
  v_row record;
  v_account record;
  v_count integer := 0;
begin
  perform public.require_service_role();
  for v_row in
    select id, organization_id
    from public.saas_subscriptions
    where status = 'CANCELED_RETENTION' and retention_ends_at <= now()
    order by retention_ends_at
    for update skip locked
    limit greatest(1, least(p_limit, 500))
  loop
    perform set_config('app.retention_redaction', 'on', true);
    update public.notification_outbox
      set status = 'CANCELED', recipient_e164 = '+5500000000000',
          payload = jsonb_build_object('redacted', true),
          claimed_by = null, claimed_at = null, lease_expires_at = null,
          last_error = null
      where organization_id = v_row.organization_id;
    update public.message_attempts ma
      set provider_message_id = null, response = '{}'::jsonb, error_message = null
      from public.notification_outbox n
      where n.id = ma.outbox_id and n.organization_id = v_row.organization_id;
    delete from public.customer_action_tokens
      where organization_id = v_row.organization_id;
    delete from public.merchant_oauth_states
      where organization_id = v_row.organization_id;
    delete from public.billing_sessions
      where organization_id = v_row.organization_id;
    delete from public.billing_checkout_attempts
      where organization_id = v_row.organization_id;
    delete from public.merchant_checkout_attempts
      where organization_id = v_row.organization_id;
    update public.appointments
      set notes = null, schedule_override_reason = null, created_by = null
      where organization_id = v_row.organization_id;
    update public.appointment_status_events
      set actor_user_id = null, reason = case when reason is null then null else 'redacted' end,
          metadata = '{}'::jsonb
      where organization_id = v_row.organization_id;
    update public.privacy_requests
      set resolution_notes = null, handled_by = null
      where organization_id = v_row.organization_id;
    update public.consent_events
      set proof = jsonb_build_object('redacted', true)
      where organization_id = v_row.organization_id;
    update public.payment_orders
      set external_checkout_url = null, metadata = '{}'::jsonb,
          failure_message = null
      where organization_id = v_row.organization_id;
    update public.webhook_events
      set payload = jsonb_build_object('redacted', true), last_error = null
      where organization_id = v_row.organization_id;
    update public.organization_access_events
      set actor_user_id = null, metadata = '{}'::jsonb
      where organization_id = v_row.organization_id;
    update public.audit_events
      set actor_user_id = null, entity_id = null, request_id = null,
          ip_hash = null, metadata = '{}'::jsonb
      where organization_id = v_row.organization_id;
    update public.customers
      set auth_user_id = null,
          full_name = 'Cliente anonimizado ' || left(id::text, 8),
          phone_e164 = null, email = null, birth_date = null, notes = null,
          active = false
      where organization_id = v_row.organization_id;
    update public.barbers
      set display_name = 'Barbeiro anonimizado ' || left(id::text, 8),
          bio = null, avatar_url = null, active = false
      where organization_id = v_row.organization_id;
    update public.locations
      set name = 'Unidade encerrada', address = '{}'::jsonb, active = false
      where organization_id = v_row.organization_id;
    for v_account in
      select id, access_token_secret_id, refresh_token_secret_id
      from public.merchant_accounts
      where organization_id = v_row.organization_id
      for update
    loop
      if v_account.access_token_secret_id is not null then
        perform vault.delete_secret(v_account.access_token_secret_id);
      end if;
      if v_account.refresh_token_secret_id is not null then
        perform vault.delete_secret(v_account.refresh_token_secret_id);
      end if;
      update public.merchant_accounts
        set status = 'DISCONNECTED', access_token_secret_id = null,
            refresh_token_secret_id = null, token_expires_at = null,
            external_account_id = null, scopes = '{}'
        where id = v_account.id;
    end loop;
    update public.organizations
      set name = 'Organização encerrada ' || left(id::text, 8),
          slug = 'closed-' || replace(id::text, '-', ''),
          whatsapp_phone_number_id = null, created_by = null
      where id = v_row.organization_id;
    delete from public.organization_memberships
      where organization_id = v_row.organization_id;
    update public.saas_subscriptions
      set status = 'CLOSED'
      where id = v_row.id;
    insert into public.organization_access_events (
      organization_id, from_status, to_status, reason
    ) values (
      v_row.organization_id, 'CANCELED_RETENTION', 'CLOSED', 'retention_period_expired'
    );
    perform set_config('app.retention_redaction', 'off', true);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

create or replace function public.enqueue_due_whatsapp_reminders(p_limit integer default 200)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row record;
  v_reminder_at timestamptz;
  v_count integer := 0;
begin
  perform public.require_service_role();
  for v_row in
    select a.*, c.phone_e164, o.timezone
    from public.appointments a
    join public.customers c
      on c.id = a.customer_id and c.organization_id = a.organization_id
    join public.organizations o on o.id = a.organization_id
    where a.status = 'CONFIRMED'
      and c.phone_e164 is not null
      and lower(a.service_period) > now()
      and lower(a.service_period) <= now() + interval '2 days'
    order by lower(a.service_period)
    limit greatest(1, least(p_limit, 1000))
  loop
    v_reminder_at := (
      ((lower(v_row.service_period) at time zone v_row.timezone)::date + time '07:00')
      at time zone v_row.timezone
    );
    if v_reminder_at <= now() then
      insert into public.notification_outbox (
        organization_id, appointment_id, template_key, recipient_e164,
        payload, idempotency_key, scheduled_at, next_attempt_at
      ) values (
        v_row.organization_id, v_row.id, 'appointment_reminder_0700',
        v_row.phone_e164,
        jsonb_build_object(
          'appointment_id', v_row.id,
          'starts_at', lower(v_row.service_period),
          'version', v_row.version
        ),
        'appointment:' || v_row.id || ':v' || v_row.version || ':reminder_0700',
        v_reminder_at, now()
      ) on conflict (organization_id, idempotency_key) do nothing;
      if found then
        v_count := v_count + 1;
      end if;
    end if;
  end loop;
  return v_count;
end;
$$;

create or replace function public.set_platform_organization_access_status(
  p_organization_id uuid,
  p_status public.saas_subscription_status,
  p_reason text
)
returns public.saas_subscriptions
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_subscription public.saas_subscriptions%rowtype;
  v_old_status public.saas_subscription_status;
begin
  if not public.is_platform_admin() then
    raise exception using errcode = '42501', message = 'platform admin required';
  end if;
  if p_status not in ('ACTIVE', 'BLOCKED') then
    raise exception using errcode = '22023', message = 'platform admin may set only ACTIVE or BLOCKED';
  end if;
  if nullif(btrim(p_reason), '') is null then
    raise exception using errcode = '22023', message = 'reason required';
  end if;
  select * into strict v_subscription from public.saas_subscriptions
  where organization_id = p_organization_id for update;
  v_old_status := v_subscription.status;
  update public.saas_subscriptions
    set status = p_status,
        grace_ends_at = case when p_status = 'BLOCKED' then null else grace_ends_at end
    where id = v_subscription.id
    returning * into v_subscription;
  insert into public.organization_access_events (
    organization_id, from_status, to_status, reason, actor_user_id,
    metadata
  ) values (
    p_organization_id, v_old_status, p_status, btrim(p_reason), auth.uid(),
    jsonb_build_object('source', 'platform_admin')
  );
  insert into public.audit_events (
    organization_id, actor_user_id, actor_kind, action, entity_type, entity_id,
    metadata
  ) values (
    p_organization_id, auth.uid(), 'USER', 'organization.access_status_changed',
    'saas_subscription', v_subscription.id::text,
    jsonb_build_object('from', v_old_status, 'to', p_status, 'reason', p_reason)
  );
  return v_subscription;
exception
  when no_data_found then
    raise exception using errcode = 'P0002', message = 'subscription not found';
end;
$$;

create or replace function public.merge_customers(
  p_organization_id uuid,
  p_source_customer_id uuid,
  p_target_customer_id uuid,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_source public.customers%rowtype;
  v_target public.customers%rowtype;
begin
  if not public.is_organization_owner(p_organization_id) then
    raise exception using errcode = '42501', message = 'organization owner required';
  end if;
  if not public.organization_accepts_new_bookings(p_organization_id) then
    raise exception using errcode = '42501', message = 'organization access does not allow customer merge';
  end if;
  if p_source_customer_id = p_target_customer_id then
    raise exception using errcode = '22023', message = 'source and target customers must differ';
  end if;
  -- Deterministic lock order avoids merge deadlocks.
  perform 1 from public.customers
  where organization_id = p_organization_id
    and id in (p_source_customer_id, p_target_customer_id)
  order by id for update;
  select * into strict v_source from public.customers
    where id = p_source_customer_id and organization_id = p_organization_id;
  select * into strict v_target from public.customers
    where id = p_target_customer_id and organization_id = p_organization_id;
  if v_source.merged_into_customer_id is not null
     or v_target.merged_into_customer_id is not null or not v_target.active then
    raise exception using errcode = '22023', message = 'source or target customer is already merged/inactive';
  end if;
  if v_source.auth_user_id is not null and v_target.auth_user_id is not null
     and v_source.auth_user_id <> v_target.auth_user_id then
    raise exception using errcode = '22023', message = 'cannot merge different authenticated identities';
  end if;

  update public.appointments set customer_id = v_target.id
    where organization_id = p_organization_id and customer_id = v_source.id;
  update public.customer_action_tokens set customer_id = v_target.id
    where organization_id = p_organization_id and customer_id = v_source.id;
  update public.privacy_requests set customer_id = v_target.id
    where organization_id = p_organization_id and customer_id = v_source.id;
  perform set_config('app.customer_merge', 'on', true);
  update public.consent_events set customer_id = v_target.id
    where organization_id = p_organization_id and customer_id = v_source.id;
  perform set_config('app.customer_merge', 'off', true);

  update public.customers
  set auth_user_id = null, active = false, merged_into_customer_id = v_target.id,
      notes = concat_ws(E'\n', notes, 'Mesclado: ' || btrim(p_reason))
  where id = v_source.id;
  update public.customers
  set auth_user_id = coalesce(v_target.auth_user_id, v_source.auth_user_id)
  where id = v_target.id;
  insert into public.audit_events (
    organization_id, actor_user_id, actor_kind, action, entity_type, entity_id,
    metadata
  ) values (
    p_organization_id, auth.uid(), 'USER', 'customer.merged', 'customer',
    v_target.id::text,
    jsonb_build_object('source_customer_id', v_source.id, 'reason', p_reason)
  );
  return v_target.id;
exception
  when no_data_found then
    raise exception using errcode = 'P0002', message = 'source or target customer not found in tenant';
end;
$$;

create or replace function public.record_manual_refund(
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
  v_net_paid bigint;
  v_order_id uuid;
  v_transaction_id uuid;
begin
  select * into strict v_appointment from public.appointments
  where id = p_appointment_id for update;
  if not public.is_organization_owner(v_appointment.organization_id) then
    raise exception using errcode = '42501', message = 'organization owner required';
  end if;
  if not public.organization_allows_existing_operations(v_appointment.organization_id) then
    raise exception using errcode = '42501', message = 'organization access does not allow refunds';
  end if;
  select coalesce(sum(case
    when kind in ('CAPTURE', 'ADJUSTMENT') then amount_cents
    when kind in ('REFUND', 'REVERSAL') then -amount_cents
  end), 0)::bigint into v_net_paid
  from public.payment_transactions
  where organization_id = v_appointment.organization_id
    and appointment_id = v_appointment.id;
  if p_amount_cents <= 0 or p_amount_cents > v_net_paid then
    raise exception using errcode = '22023', message = 'refund exceeds net paid amount';
  end if;
  select id into v_transaction_id from public.payment_transactions
  where organization_id = v_appointment.organization_id
    and idempotency_key = p_idempotency_key;
  if v_transaction_id is not null then return v_transaction_id; end if;
  insert into public.payment_orders (
    organization_id, appointment_id, provider, kind, status,
    amount_cents, currency, idempotency_key, external_order_id, metadata
  ) values (
    v_appointment.organization_id, v_appointment.id, 'MANUAL', 'REFUND',
    'REFUNDED', p_amount_cents, v_appointment.currency,
    p_idempotency_key || ':order', nullif(btrim(p_reference), ''),
    jsonb_build_object('reference', p_reference)
  ) returning id into v_order_id;
  insert into public.payment_transactions (
    organization_id, payment_order_id, appointment_id, provider, kind,
    amount_cents, currency, idempotency_key, metadata
  ) values (
    v_appointment.organization_id, v_order_id, v_appointment.id, 'MANUAL',
    'REFUND', p_amount_cents, v_appointment.currency, p_idempotency_key,
    jsonb_build_object('reference', p_reference)
  ) returning id into v_transaction_id;
  return v_transaction_id;
exception
  when no_data_found then
    raise exception using errcode = 'P0002', message = 'appointment not found';
end;
$$;

create or replace function public.record_consent_event(
  p_organization_id uuid,
  p_customer_id uuid,
  p_kind public.consent_kind,
  p_action public.consent_action,
  p_source text,
  p_proof jsonb default '{}'::jsonb,
  p_policy_version text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  if not (
    public.is_organization_owner(p_organization_id)
    or public.is_organization_customer(p_organization_id, p_customer_id)
  ) then
    raise exception using errcode = '42501', message = 'consent subject access denied';
  end if;
  if nullif(btrim(p_source), '') is null
     or jsonb_typeof(coalesce(p_proof, '{}'::jsonb)) <> 'object'
     or (p_action = 'GRANTED' and coalesce(p_proof, '{}'::jsonb) = '{}'::jsonb) then
    raise exception using errcode = '22023', message = 'consent grant requires an auditable source and proof';
  end if;
  insert into public.consent_events (
    organization_id, customer_id, kind, action, source, proof,
    policy_version
  ) values (
    p_organization_id, p_customer_id, p_kind, p_action, btrim(p_source),
    coalesce(p_proof, '{}'::jsonb), p_policy_version
  ) returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.submit_privacy_request(
  p_organization_id uuid,
  p_customer_id uuid,
  p_kind public.privacy_request_kind
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  if not public.is_organization_customer(p_organization_id, p_customer_id) then
    raise exception using errcode = '42501', message = 'privacy request subject access denied';
  end if;
  insert into public.privacy_requests (
    organization_id, customer_id, kind, due_at
  ) values (
    p_organization_id, p_customer_id, p_kind, now() + interval '15 days'
  ) returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.export_organization_data(p_organization_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_subscription public.saas_subscriptions%rowtype;
begin
  if not public.is_organization_owner(p_organization_id) then
    raise exception using errcode = '42501', message = 'organization owner required';
  end if;
  select * into strict v_subscription
  from public.saas_subscriptions where organization_id = p_organization_id;
  if v_subscription.status = 'CLOSED'
     or (v_subscription.status = 'CANCELED_RETENTION'
       and v_subscription.retention_ends_at <= now()) then
    raise exception using errcode = '42501', message = 'organization export window is closed';
  end if;

  return jsonb_build_object(
    'schema_version', 1,
    'exported_at', now(),
    'subscription_status', v_subscription.status,
    'export_available_until', v_subscription.retention_ends_at,
    'organization', (select to_jsonb(o) from public.organizations o where o.id = p_organization_id),
    'locations', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at)
      from public.locations x where x.organization_id = p_organization_id), '[]'::jsonb),
    'customers', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at)
      from public.customers x where x.organization_id = p_organization_id), '[]'::jsonb),
    'barbers', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at)
      from public.barbers x where x.organization_id = p_organization_id), '[]'::jsonb),
    'services', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at)
      from public.services x where x.organization_id = p_organization_id), '[]'::jsonb),
    'packages', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at)
      from public.packages x where x.organization_id = p_organization_id), '[]'::jsonb),
    'package_items', coalesce((select jsonb_agg(to_jsonb(x) order by x.package_id, x.position)
      from public.package_items x where x.organization_id = p_organization_id), '[]'::jsonb),
    'barber_services', coalesce((select jsonb_agg(to_jsonb(x) order by x.barber_id, x.service_id)
      from public.barber_services x where x.organization_id = p_organization_id), '[]'::jsonb),
    'work_intervals', coalesce((select jsonb_agg(to_jsonb(x) order by x.barber_id, x.weekday, x.starts_at)
      from public.work_intervals x where x.organization_id = p_organization_id), '[]'::jsonb),
    'availability_exceptions', coalesce((select jsonb_agg(to_jsonb(x) order by lower(x.service_period))
      from public.availability_exceptions x where x.organization_id = p_organization_id), '[]'::jsonb),
    'appointments', coalesce((select jsonb_agg(to_jsonb(x) order by lower(x.service_period))
      from public.appointments x where x.organization_id = p_organization_id), '[]'::jsonb),
    'appointment_items', coalesce((select jsonb_agg(to_jsonb(x) order by x.appointment_id, x.position)
      from public.appointment_items x where x.organization_id = p_organization_id), '[]'::jsonb),
    'appointment_status_events', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at)
      from public.appointment_status_events x where x.organization_id = p_organization_id), '[]'::jsonb),
    'payment_orders', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at)
      from public.payment_orders x where x.organization_id = p_organization_id), '[]'::jsonb),
    'payment_transactions', coalesce((select jsonb_agg(to_jsonb(x) order by x.occurred_at)
      from public.payment_transactions x where x.organization_id = p_organization_id), '[]'::jsonb),
    'commission_rules', coalesce((select jsonb_agg(to_jsonb(x) order by lower(x.effective_period))
      from public.commission_rules x where x.organization_id = p_organization_id), '[]'::jsonb),
    'commission_ledger', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at)
      from public.commission_ledger x where x.organization_id = p_organization_id), '[]'::jsonb),
    'commission_payouts', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at)
      from public.commission_payouts x where x.organization_id = p_organization_id), '[]'::jsonb),
    'consent_events', coalesce((select jsonb_agg(to_jsonb(x) order by x.occurred_at)
      from public.consent_events x where x.organization_id = p_organization_id), '[]'::jsonb),
    'privacy_requests', coalesce((select jsonb_agg(to_jsonb(x) order by x.requested_at)
      from public.privacy_requests x where x.organization_id = p_organization_id), '[]'::jsonb)
  );
exception
  when no_data_found then
    raise exception using errcode = 'P0002', message = 'organization subscription not found';
end;
$$;

create or replace function public.save_package_with_items(
  p_organization_id uuid,
  p_package_id uuid,
  p_name text,
  p_description text,
  p_price_cents bigint,
  p_active boolean,
  p_sort_order integer,
  p_items jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_package_id uuid;
  v_item_count integer;
begin
  if not public.is_organization_owner(p_organization_id) then
    raise exception using errcode = '42501', message = 'organization owner required';
  end if;
  if not public.organization_allows_management_mutations(p_organization_id) then
    raise exception using errcode = '42501', message = 'organization access does not allow catalog changes';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) not between 1 and 50 then
    raise exception using errcode = '22023', message = 'package requires between 1 and 50 items';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_items) as entries(item)
    where jsonb_typeof(item) <> 'object'
  ) then
    raise exception using errcode = '22023', message = 'invalid package item';
  end if;
  select count(*)::integer into v_item_count
  from jsonb_array_elements(p_items) as entries(item)
  join public.services s
    on s.id = (item ->> 'service_id')::uuid
      and s.organization_id = p_organization_id and s.active
  where coalesce((item ->> 'quantity')::integer, 1) between 1 and 20;
  if v_item_count <> jsonb_array_length(p_items)
     or (select count(distinct item ->> 'service_id')
          from jsonb_array_elements(p_items) as entries(item))
        <> jsonb_array_length(p_items) then
    raise exception using errcode = '22023', message = 'package items must reference distinct active tenant services';
  end if;

  if p_package_id is null then
    insert into public.packages (
      organization_id, name, description, price_cents, active, sort_order
    ) values (
      p_organization_id, btrim(p_name), nullif(btrim(p_description), ''),
      p_price_cents, coalesce(p_active, true), coalesce(p_sort_order, 0)
    ) returning id into v_package_id;
  else
    select id into strict v_package_id
    from public.packages
    where id = p_package_id and organization_id = p_organization_id
    for update;
    update public.packages
      set name = btrim(p_name), description = nullif(btrim(p_description), ''),
          price_cents = p_price_cents, active = coalesce(p_active, active),
          sort_order = coalesce(p_sort_order, sort_order)
      where id = v_package_id and organization_id = p_organization_id;
    update public.package_items
      set active = false
      where package_id = v_package_id and organization_id = p_organization_id
        and active;
  end if;

  insert into public.package_items (
    organization_id, package_id, service_id, quantity, position
  )
  select
    p_organization_id, v_package_id, (item ->> 'service_id')::uuid,
    coalesce((item ->> 'quantity')::smallint, 1), (ordinality - 1)::smallint
  from jsonb_array_elements(p_items) with ordinality as entries(item, ordinality)
  order by ordinality;
  return v_package_id;
exception
  when no_data_found then
    raise exception using errcode = 'P0002', message = 'tenant package not found';
end;
$$;

create or replace function public.replace_commission_rule(
  p_organization_id uuid,
  p_barber_id uuid,
  p_service_id uuid,
  p_mode public.commission_mode,
  p_percentage_bps integer,
  p_fixed_cents bigint,
  p_effective_at timestamptz default now(),
  p_current_rule_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_current public.commission_rules%rowtype;
  v_new_id uuid;
begin
  if not public.is_organization_owner(p_organization_id) then
    raise exception using errcode = '42501', message = 'organization owner required';
  end if;
  if not public.organization_allows_management_mutations(p_organization_id) then
    raise exception using errcode = '42501', message = 'organization access does not allow commission changes';
  end if;
  if p_effective_at > now() + interval '1 minute' then
    raise exception using errcode = '22023', message = 'future commission activation is not supported in MVP';
  end if;
  if p_barber_id is not null and not exists (
    select 1 from public.barbers b
    where b.id = p_barber_id and b.organization_id = p_organization_id
  ) then
    raise exception using errcode = 'P0002', message = 'tenant barber not found';
  end if;
  if p_service_id is not null and not exists (
    select 1 from public.services s
    where s.id = p_service_id and s.organization_id = p_organization_id
  ) then
    raise exception using errcode = 'P0002', message = 'tenant service not found';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    p_organization_id::text || ':' || coalesce(p_barber_id::text, '*')
      || ':' || coalesce(p_service_id::text, '*'), 0
  ));

  if p_current_rule_id is not null then
    select * into strict v_current
    from public.commission_rules
    where id = p_current_rule_id and organization_id = p_organization_id
      and active
    for update;
    if v_current.barber_id is distinct from p_barber_id
       or v_current.service_id is distinct from p_service_id then
      raise exception using errcode = '22023', message = 'commission rule scope cannot be reassigned';
    end if;
  else
    select * into v_current
    from public.commission_rules
    where organization_id = p_organization_id and active
      and barber_id is not distinct from p_barber_id
      and service_id is not distinct from p_service_id
    for update;
  end if;
  if v_current.id is not null then
    if p_effective_at <= lower(v_current.effective_period) then
      raise exception using errcode = '22023', message = 'replacement must start after current commission rule';
    end if;
    update public.commission_rules
      set active = false,
          effective_period = tstzrange(lower(v_current.effective_period), p_effective_at, '[)')
      where id = v_current.id;
  end if;
  insert into public.commission_rules (
    organization_id, barber_id, service_id, mode, percentage_bps,
    fixed_cents, effective_period, active, created_by
  ) values (
    p_organization_id, p_barber_id, p_service_id, p_mode,
    p_percentage_bps, p_fixed_cents, tstzrange(p_effective_at, null, '[)'),
    true, auth.uid()
  ) returning id into v_new_id;
  return v_new_id;
exception
  when no_data_found then
    raise exception using errcode = 'P0002', message = 'active tenant commission rule not found';
end;
$$;

create or replace function public.adjust_commission_entry(
  p_source_entry_id uuid,
  p_kind public.commission_entry_kind,
  p_delta_cents bigint,
  p_reason text,
  p_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_source public.commission_ledger%rowtype;
  v_existing public.commission_ledger%rowtype;
  v_current_amount bigint;
  v_id uuid;
begin
  select * into strict v_source
  from public.commission_ledger where id = p_source_entry_id for update;
  if not public.is_organization_owner(v_source.organization_id) then
    raise exception using errcode = '42501', message = 'organization owner required';
  end if;
  if not public.organization_allows_existing_operations(v_source.organization_id) then
    raise exception using errcode = '42501', message = 'organization access does not allow commission corrections';
  end if;
  if v_source.kind <> 'EARNED' then
    raise exception using errcode = '22023', message = 'commission correction must reference an earned entry';
  end if;
  if p_kind not in ('ADJUSTMENT', 'REVERSAL')
     or p_delta_cents = 0 or nullif(btrim(p_reason), '') is null then
    raise exception using errcode = '22023', message = 'invalid commission correction';
  end if;
  select * into v_existing
  from public.commission_ledger
  where organization_id = v_source.organization_id
    and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.source_entry_id <> v_source.id
       or v_existing.kind <> p_kind or v_existing.amount_cents <> p_delta_cents then
      raise exception using errcode = '22023', message = 'idempotency key belongs to another commission correction';
    end if;
    return v_existing.id;
  end if;
  if exists (
    select 1 from public.commission_ledger cl
    where cl.source_entry_id = v_source.id and cl.kind = 'REVERSAL'
  ) then
    raise exception using errcode = '22023', message = 'commission entry is already fully reversed';
  end if;
  select v_source.amount_cents + coalesce(sum(cl.amount_cents), 0)::bigint
    into v_current_amount
  from public.commission_ledger cl
  where cl.source_entry_id = v_source.id;
  if p_kind = 'REVERSAL' and p_delta_cents <> -v_current_amount then
    raise exception using errcode = '22023', message = 'full reversal must negate the remaining commission amount';
  elsif p_kind = 'ADJUSTMENT' and v_current_amount + p_delta_cents < 0 then
    raise exception using errcode = '22023', message = 'commission adjustment exceeds remaining amount';
  end if;
  insert into public.commission_ledger (
    organization_id, barber_id, appointment_id, appointment_item_id,
    kind, amount_cents, idempotency_key, source_entry_id, reason,
    earned_at, created_by
  ) values (
    v_source.organization_id, v_source.barber_id, v_source.appointment_id,
    v_source.appointment_item_id, p_kind, p_delta_cents, p_idempotency_key,
    v_source.id, left(btrim(p_reason), 500), now(), auth.uid()
  ) returning id into v_id;
  return v_id;
exception
  when no_data_found then
    raise exception using errcode = 'P0002', message = 'commission entry not found';
end;
$$;

create or replace function public.get_available_slots(
  p_organization_slug text,
  p_barber_id uuid,
  p_local_date date,
  p_selections jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org public.organizations%rowtype;
  v_resolution jsonb;
  v_source record;
  v_duration integer;
  v_occupied integer;
  v_local_start timestamp;
  v_local_limit timestamp;
  v_start timestamptz;
  v_period tstzrange;
  v_slots jsonb := '[]'::jsonb;
  v_seen_starts timestamptz[] := array[]::timestamptz[];
begin
  select * into strict v_org from public.organizations
  where slug = p_organization_slug;
  if not public.organization_accepts_new_bookings(v_org.id) then
    return jsonb_build_object('duration_minutes', null, 'total_cents', null, 'slots', v_slots);
  end if;
  if p_local_date < (now() at time zone v_org.timezone)::date
     or p_local_date > (now() at time zone v_org.timezone)::date + 180 then
    raise exception using errcode = '22023', message = 'availability date outside allowed window';
  end if;
  v_resolution := public.resolve_booking_selection(v_org.id, p_barber_id, p_selections, null);
  v_duration := (v_resolution ->> 'duration_minutes')::integer;
  v_occupied := ceil(v_duration::numeric / v_org.slot_interval_minutes)::integer
    * v_org.slot_interval_minutes;

  for v_source in
    select sources.local_start, sources.local_limit
    from (
      select
        p_local_date + wi.starts_at as local_start,
        p_local_date + wi.ends_at as local_limit
      from public.work_intervals wi
      where wi.organization_id = v_org.id and wi.barber_id = p_barber_id
        and wi.active and wi.weekday = extract(dow from p_local_date)::smallint
      union all
      select
        timezone(
          v_org.timezone,
          greatest(
            lower(ae.service_period),
            p_local_date::timestamp at time zone v_org.timezone
          )
        ) as local_start,
        timezone(
          v_org.timezone,
          least(
            upper(ae.service_period),
            (p_local_date + 1)::timestamp at time zone v_org.timezone
          )
        ) as local_limit
      from public.availability_exceptions ae
      where ae.organization_id = v_org.id and ae.barber_id = p_barber_id
        and ae.kind = 'AVAILABLE_OVERRIDE'
        and ae.service_period && tstzrange(
          p_local_date::timestamp at time zone v_org.timezone,
          (p_local_date + 1)::timestamp at time zone v_org.timezone,
          '[)'
        )
    ) sources
    where sources.local_start < sources.local_limit
    order by sources.local_start, sources.local_limit
  loop
    v_local_start := date_trunc('day', v_source.local_start)
      + make_interval(mins => (
        ceil(
          extract(epoch from (v_source.local_start - date_trunc('day', v_source.local_start)))
            / 60 / v_org.slot_interval_minutes
        )::integer * v_org.slot_interval_minutes
      ));
    v_local_limit := v_source.local_limit;
    while v_local_start + make_interval(mins => v_occupied) <= v_local_limit loop
      v_start := v_local_start at time zone v_org.timezone;
      v_period := tstzrange(v_start, v_start + make_interval(mins => v_occupied), '[)');
      if v_start > now()
         and not (v_start = any(v_seen_starts))
         and public.is_barber_available(v_org.id, p_barber_id, v_period)
         and not exists (
           select 1 from public.appointments a
           where a.organization_id = v_org.id and a.barber_id = p_barber_id
             and a.status in ('HELD', 'PENDING_PAYMENT', 'CONFIRMED', 'IN_SERVICE')
             and a.service_period && v_period
         ) then
        v_slots := v_slots || jsonb_build_array(jsonb_build_object(
          'starts_at', v_start,
          'ends_at', upper(v_period)
        ));
        v_seen_starts := array_append(v_seen_starts, v_start);
      end if;
      v_local_start := v_local_start + make_interval(mins => v_org.slot_interval_minutes);
    end loop;
  end loop;
  return jsonb_build_object(
    'duration_minutes', v_duration,
    'occupied_minutes', v_occupied,
    'total_cents', (v_resolution ->> 'total_cents')::bigint,
    'slots', v_slots
  );
exception
  when no_data_found then
    return null;
end;
$$;

create or replace function public.create_commission_payout(
  p_organization_id uuid,
  p_barber_id uuid,
  p_period_start date,
  p_period_end date
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_payout_id uuid;
  v_amount bigint;
begin
  if not public.is_organization_owner(p_organization_id) then
    raise exception using errcode = '42501', message = 'organization owner required';
  end if;
  if p_period_start > p_period_end then
    raise exception using errcode = '22023', message = 'invalid payout period';
  end if;
  perform 1 from public.barbers
  where id = p_barber_id and organization_id = p_organization_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'barber not found';
  end if;
  select coalesce(sum(cl.amount_cents), 0)::bigint into v_amount
  from public.commission_ledger cl
  where cl.organization_id = p_organization_id and cl.barber_id = p_barber_id
    and (cl.earned_at at time zone (
      select timezone from public.organizations where id = p_organization_id
    ))::date between p_period_start and p_period_end
    and not exists (
      select 1 from public.commission_payout_items cpi
      where cpi.organization_id = cl.organization_id and cpi.ledger_entry_id = cl.id
    );
  if v_amount <= 0 then
    raise exception using errcode = '22023', message = 'no positive unpaid commission in period';
  end if;
  insert into public.commission_payouts (
    organization_id, barber_id, period_start, period_end, amount_cents
  ) values (
    p_organization_id, p_barber_id, p_period_start, p_period_end, v_amount
  ) returning id into v_payout_id;
  insert into public.commission_payout_items (
    organization_id, payout_id, ledger_entry_id
  )
  select cl.organization_id, v_payout_id, cl.id
  from public.commission_ledger cl
  where cl.organization_id = p_organization_id and cl.barber_id = p_barber_id
    and (cl.earned_at at time zone (
      select timezone from public.organizations where id = p_organization_id
    ))::date between p_period_start and p_period_end
    and not exists (
      select 1 from public.commission_payout_items cpi
      where cpi.organization_id = cl.organization_id and cpi.ledger_entry_id = cl.id
    );
  return v_payout_id;
end;
$$;

create or replace function public.mark_commission_payout_paid(p_payout_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_payout public.commission_payouts%rowtype;
begin
  select * into strict v_payout from public.commission_payouts
  where id = p_payout_id for update;
  if not public.is_organization_owner(v_payout.organization_id) then
    raise exception using errcode = '42501', message = 'organization owner required';
  end if;
  if v_payout.status <> 'OPEN' then
    raise exception using errcode = '22023', message = 'payout is not open';
  end if;
  update public.commission_payouts
    set status = 'PAID', paid_at = now(), marked_paid_by = auth.uid()
    where id = p_payout_id;
exception
  when no_data_found then
    raise exception using errcode = 'P0002', message = 'payout not found';
end;
$$;
