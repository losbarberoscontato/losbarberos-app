-- Torna reconexao QR observavel, recuperavel e temporalmente segura.
-- Nenhuma chamada externa ou credencial sai desta migration.

alter table public.whatsapp_business_connections
  add column if not exists connection_epoch_at timestamptz,
  add column if not exists qr_code text,
  add column if not exists qr_expires_at timestamptz,
  add column if not exists health_status text not null default 'UNKNOWN',
  add column if not exists health_checked_at timestamptz,
  add column if not exists health_error_code text,
  add column if not exists health_consecutive_failures integer not null default 0;

alter table public.whatsapp_business_connections
  drop constraint if exists whatsapp_connections_health_status_check;
alter table public.whatsapp_business_connections
  add constraint whatsapp_connections_health_status_check
  check (health_status in ('UNKNOWN', 'OK', 'WAITING_FOR_QR', 'DISCONNECTED', 'GATEWAY_UNREACHABLE', 'PROVIDER_ERROR'));

alter table public.whatsapp_business_connections
  drop constraint if exists whatsapp_connections_qr_code_size_check;
alter table public.whatsapp_business_connections
  add constraint whatsapp_connections_qr_code_size_check
  check (qr_code is null or char_length(qr_code) between 100 and 300000);

create index if not exists whatsapp_connections_health_idx
  on public.whatsapp_business_connections (provider, health_status, health_checked_at);

create or replace function public.get_whatsapp_connection_status(p_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_organization_owner(p_organization_id) then
    raise exception using errcode = '42501', message = 'not organization owner';
  end if;

  return jsonb_build_object(
    'connections', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id,
        'provider', c.provider,
        'status', c.status,
        'is_active', c.is_active,
        'waba_id', c.waba_id,
        'phone_number_id', c.phone_number_id,
        'gateway_instance_id', c.gateway_instance_id,
        'connected_at', c.connected_at,
        'disconnected_at', c.disconnected_at,
        'last_error_code', c.last_error_code,
        'last_status_at', c.last_status_at,
        'connection_epoch_at', c.connection_epoch_at,
        'health_status', c.health_status,
        'health_checked_at', c.health_checked_at,
        'health_error_code', c.health_error_code,
        'health_consecutive_failures', c.health_consecutive_failures,
        'qr_code', case when c.qr_expires_at > now() then c.qr_code else null end,
        'qr_expires_at', case when c.qr_expires_at > now() then c.qr_expires_at else null end
      ) order by c.provider)
      from public.whatsapp_business_connections c
      where c.organization_id = p_organization_id
    ), '[]'::jsonb),
    'reminders', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id,
        'position', r.position,
        'enabled', r.enabled,
        'offset_minutes', r.offset_minutes,
        'template_key', r.template_key,
        'language_code', r.language_code
      ) order by r.position)
      from public.whatsapp_reminder_rules r
      where r.organization_id = p_organization_id
    ), '[]'::jsonb),
    'automation', coalesce((
      select jsonb_build_object(
        'confirmation_enabled', a.confirmation_enabled,
        'confirmation_template_key', a.confirmation_template_key,
        'welcome_enabled', a.welcome_enabled,
        'welcome_message', a.welcome_message
      ) from public.whatsapp_automation_settings a
      where a.organization_id = p_organization_id
    ), jsonb_build_object(
      'confirmation_enabled', true,
      'confirmation_template_key', 'appointment_confirmation',
      'welcome_enabled', true,
      'welcome_message', ''
    ))
  );
end;
$$;

create or replace function public.store_whatsapp_qr_connection(
  p_organization_id uuid,
  p_gateway_base_url text,
  p_gateway_instance_id text,
  p_gateway_api_key text,
  p_requested_by_user_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, vault, pg_temp
as $$
declare
  v_connection public.whatsapp_business_connections%rowtype;
  v_secret_id uuid;
  v_id uuid;
  v_active boolean;
begin
  perform public.require_service_role();
  perform pg_advisory_xact_lock(hashtextextended('whatsapp-provider:' || p_organization_id::text, 0));
  if not public.is_organization_owner(p_organization_id, p_requested_by_user_id)
     or p_gateway_base_url !~ '^https://'
     or nullif(btrim(p_gateway_instance_id), '') is null
     or nullif(p_gateway_api_key, '') is null then
    raise exception using errcode = '42501', message = 'invalid WhatsApp QR connection';
  end if;
  select * into v_connection from public.whatsapp_business_connections
  where organization_id = p_organization_id and provider = 'QR_WEB' for update;
  if v_connection.gateway_secret_id is null then
    select vault.create_secret(p_gateway_api_key, 'los-barberos-wa-qr-' || p_organization_id, 'WhatsApp QR gateway key for tenant') into v_secret_id;
  else
    v_secret_id := v_connection.gateway_secret_id;
    perform vault.update_secret(v_secret_id, p_gateway_api_key);
  end if;
  select coalesce(v_connection.is_active, false)
      or not exists (
        select 1 from public.whatsapp_business_connections
        where organization_id = p_organization_id
          and is_active
          and id is distinct from v_connection.id
      ) into v_active;
  insert into public.whatsapp_business_connections (
    organization_id, provider, status, is_active, gateway_instance_id,
    gateway_secret_id, metadata, last_status_at, health_status,
    health_checked_at, health_error_code, health_consecutive_failures,
    qr_code, qr_expires_at
  ) values (
    p_organization_id, 'QR_WEB', 'WAITING_FOR_QR', v_active, btrim(p_gateway_instance_id),
    v_secret_id, jsonb_build_object('gateway_base_url', rtrim(p_gateway_base_url, '/')), now(),
    'WAITING_FOR_QR', now(), null, 0, null, null
  ) on conflict (organization_id, provider) do update set
    status = 'WAITING_FOR_QR', is_active = excluded.is_active,
    gateway_instance_id = excluded.gateway_instance_id,
    gateway_secret_id = excluded.gateway_secret_id, metadata = excluded.metadata,
    last_status_at = now(), last_error_code = null, health_status = 'WAITING_FOR_QR',
    health_checked_at = now(), health_error_code = null, health_consecutive_failures = 0,
    qr_code = null, qr_expires_at = null;
  select id into v_id from public.whatsapp_business_connections
  where organization_id = p_organization_id and provider = 'QR_WEB';
  return v_id;
end;
$$;

create or replace function public.store_whatsapp_qr_code(
  p_gateway_instance_id text,
  p_qr_code text,
  p_expires_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.require_service_role();
  if nullif(btrim(p_gateway_instance_id), '') is null
     or p_qr_code is null or char_length(p_qr_code) not between 100 and 300000
     or p_expires_at <= now() or p_expires_at > now() + interval '10 minutes' then
    raise exception using errcode = '22023', message = 'invalid WhatsApp QR payload';
  end if;
  update public.whatsapp_business_connections
  set qr_code = p_qr_code, qr_expires_at = p_expires_at,
      status = case when status = 'CONNECTED' then status else 'WAITING_FOR_QR' end,
      health_status = case when status = 'CONNECTED' then health_status else 'WAITING_FOR_QR' end,
      last_status_at = now(), updated_at = now()
  where provider = 'QR_WEB' and gateway_instance_id = btrim(p_gateway_instance_id);
  return found;
end;
$$;

create or replace function public.update_whatsapp_qr_status(
  p_gateway_instance_id text,
  p_status text,
  p_error_code text default null
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_connection public.whatsapp_business_connections%rowtype;
  v_status public.whatsapp_connection_status;
  v_health_status text;
  v_epoch timestamptz;
begin
  perform public.require_service_role();
  v_status := case lower(p_status)
    when 'open' then 'CONNECTED'::public.whatsapp_connection_status
    when 'connecting' then 'WAITING_FOR_QR'::public.whatsapp_connection_status
    when 'close' then 'DISCONNECTED'::public.whatsapp_connection_status
    else 'ERROR'::public.whatsapp_connection_status
  end;
  v_health_status := case v_status
    when 'CONNECTED' then 'OK'
    when 'WAITING_FOR_QR' then 'WAITING_FOR_QR'
    when 'DISCONNECTED' then 'DISCONNECTED'
    else 'PROVIDER_ERROR'
  end;
  select * into v_connection
  from public.whatsapp_business_connections
  where provider = 'QR_WEB' and gateway_instance_id = p_gateway_instance_id
  for update;
  if not found then return false; end if;

  if v_status = 'CONNECTED'
     and (v_connection.status <> 'CONNECTED' or v_connection.connection_epoch_at is null) then
    v_epoch := now();
    update public.notification_outbox n
    set status = 'CANCELED', last_error = 'STALE_BEFORE_QR_CONNECTION', updated_at = now()
    from public.appointments a
    where n.organization_id = v_connection.organization_id
      and n.appointment_id = a.id and a.organization_id = n.organization_id
      and lower(a.service_period) < v_epoch
      and v_connection.is_active
      and n.status in ('PENDING', 'FAILED');
  end if;

  update public.whatsapp_business_connections
  set status = v_status,
      is_active = case when v_status = 'DISCONNECTED' then false else is_active end,
      connected_at = case when v_status = 'CONNECTED' then coalesce(connected_at, now()) else connected_at end,
      disconnected_at = case when v_status = 'DISCONNECTED' then now() else disconnected_at end,
      connection_epoch_at = coalesce(v_epoch, connection_epoch_at),
      qr_code = case when v_status = 'CONNECTED' then null else qr_code end,
      qr_expires_at = case when v_status = 'CONNECTED' then null else qr_expires_at end,
      health_status = v_health_status,
      health_checked_at = now(), health_error_code = left(nullif(btrim(p_error_code), ''), 255),
      health_consecutive_failures = case when v_status = 'CONNECTED' then 0 else health_consecutive_failures end,
      last_error_code = left(nullif(btrim(p_error_code), ''), 255),
      last_status_at = now(), updated_at = now()
  where id = v_connection.id;
  return true;
end;
$$;

create or replace function public.get_whatsapp_qr_health_targets()
returns table (
  organization_id uuid,
  gateway_instance_id text,
  gateway_base_url text,
  gateway_api_key text
)
language plpgsql
security definer
set search_path = public, vault, pg_temp
as $$
begin
  perform public.require_service_role();
  return query
  select c.organization_id, c.gateway_instance_id,
         nullif(c.metadata ->> 'gateway_base_url', ''),
         s.decrypted_secret
  from public.whatsapp_business_connections c
  join vault.decrypted_secrets s on s.id = c.gateway_secret_id
  where c.provider = 'QR_WEB'
    and c.gateway_instance_id is not null
    and nullif(c.metadata ->> 'gateway_base_url', '') is not null;
end;
$$;

create or replace function public.record_whatsapp_qr_health(
  p_gateway_instance_id text,
  p_provider_state text default null,
  p_error_code text default null
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_updated boolean;
  v_health_status text;
begin
  perform public.require_service_role();
  if nullif(btrim(p_provider_state), '') is not null then
    v_updated := public.update_whatsapp_qr_status(p_gateway_instance_id, p_provider_state, p_error_code);
    v_health_status := case lower(p_provider_state)
      when 'open' then 'OK'
      when 'connecting' then 'WAITING_FOR_QR'
      when 'close' then 'DISCONNECTED'
      else 'PROVIDER_ERROR'
    end;
    update public.whatsapp_business_connections
    set health_status = v_health_status, health_checked_at = now(),
        health_error_code = left(nullif(btrim(p_error_code), ''), 255),
        health_consecutive_failures = case when v_health_status = 'OK' then 0 else health_consecutive_failures + 1 end,
        updated_at = now()
    where provider = 'QR_WEB' and gateway_instance_id = p_gateway_instance_id;
    return v_updated;
  end if;

  update public.whatsapp_business_connections
  set health_status = 'GATEWAY_UNREACHABLE', health_checked_at = now(),
      health_error_code = left(coalesce(nullif(btrim(p_error_code), ''), 'GATEWAY_UNREACHABLE'), 255),
      health_consecutive_failures = health_consecutive_failures + 1,
      updated_at = now()
  where provider = 'QR_WEB' and gateway_instance_id = p_gateway_instance_id;
  return found;
end;
$$;

create or replace function public.claim_notification_outbox(
  p_provider text,
  p_limit integer,
  p_worker_id text,
  p_lease_seconds integer
)
returns table (
  id uuid, organization_id uuid, recipient_e164 text, message_kind text,
  template_name text, language_code text, template_components jsonb,
  action_token text, appointment_label text, text_body text, attempt_number integer
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
    where (n.status in ('PENDING', 'FAILED') or (n.status = 'PROCESSING' and n.lease_expires_at <= now()))
      and n.next_attempt_at <= now() and n.scheduled_at <= now()
      and not exists (
        select 1
        from public.whatsapp_business_connections q
        join public.appointments a2 on a2.id = n.appointment_id and a2.organization_id = n.organization_id
        where q.organization_id = n.organization_id and q.provider = 'QR_WEB'
          and q.is_active and q.status = 'CONNECTED'
          and q.connection_epoch_at is not null and lower(a2.service_period) < q.connection_epoch_at
      )
      and (
        (n.payload ->> 'recipient_kind' = 'OPERATIONAL' and exists (
          select 1 from public.organizations o
          where o.id = n.organization_id and o.public_contact_phone_e164 = n.recipient_e164
        ))
        or exists (
          select 1 from public.appointments a
          join public.customers c on c.id = a.customer_id and c.organization_id = a.organization_id
          join lateral (
            select ce.action from public.consent_events ce
            where ce.organization_id = c.organization_id and ce.customer_id = c.id
              and ce.kind = 'WHATSAPP_TRANSACTIONAL'
            order by ce.occurred_at desc, ce.created_at desc, ce.id desc limit 1
          ) latest_consent on latest_consent.action = 'GRANTED'
          where a.id = n.appointment_id and a.organization_id = n.organization_id
            and c.phone_e164 = n.recipient_e164
        )
      )
    order by n.next_attempt_at, n.created_at
    for update skip locked limit greatest(1, least(p_limit, 50))
  ), claimed as (
    update public.notification_outbox n
    set status = 'PROCESSING', claimed_at = now(), claimed_by = p_worker_id,
        lease_expires_at = now() + make_interval(secs => greatest(30, least(p_lease_seconds, 600))),
        attempts = n.attempts + 1
    from candidates c where n.id = c.id returning n.*
  )
  select n.id, n.organization_id, n.recipient_e164,
    coalesce(n.payload ->> 'message_kind', 'TEMPLATE'),
    case when coalesce(n.payload ->> 'message_kind', 'TEMPLATE') = 'TEMPLATE' then n.template_key else null end,
    n.locale,
    case
      when n.payload ? 'template_components' then n.payload -> 'template_components'
      when n.payload ? 'action_token' and coalesce(n.payload ->> 'message_kind', 'TEMPLATE') = 'TEMPLATE'
        then jsonb_build_array(jsonb_build_object('type', 'button', 'sub_type', 'quick_reply', 'index', '0',
          'parameters', jsonb_build_array(jsonb_build_object('type', 'payload', 'payload', n.payload ->> 'action_token'))))
      else null
    end,
    case when n.payload ->> 'message_kind' = 'EVOLUTION_REMINDER_BUTTONS'
      then jsonb_build_object('buttons', n.payload -> 'buttons')::text else n.payload ->> 'action_token' end,
    n.payload ->> 'appointment_label', n.payload ->> 'text_body', n.attempts
  from claimed n;
end;
$$;

create or replace function app_private.dispatch_edge_function(
  p_function_name text,
  p_body jsonb
)
returns bigint
language plpgsql
security definer
set search_path = app_private, vault, net, pg_temp
as $$
declare
  v_supabase_url text;
  v_service_role_key text;
  v_request_id bigint;
begin
  if p_function_name not in ('whatsapp-send-outbox', 'maintenance-jobs', 'whatsapp-qr-health')
     or jsonb_typeof(p_body) <> 'object' then
    raise exception using errcode = '22023', message = 'unsupported edge worker dispatch';
  end if;
  select decrypted_secret into v_supabase_url from vault.decrypted_secrets where name = 'los_barberos_supabase_url' limit 1;
  select decrypted_secret into v_service_role_key from vault.decrypted_secrets where name = 'los_barberos_service_role_key' limit 1;
  if nullif(v_supabase_url, '') is null or nullif(v_service_role_key, '') is null then
    insert into app_private.edge_dispatch_audit (function_name, status, error_code)
    values (p_function_name, 'SKIPPED_CONFIG', 'VAULT_CONFIG_MISSING');
    return null;
  end if;
  select net.http_post(
    url := rtrim(v_supabase_url, '/') || '/functions/v1/' || p_function_name,
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_service_role_key, 'apikey', v_service_role_key),
    body := p_body, timeout_milliseconds := 10000
  ) into v_request_id;
  insert into app_private.edge_dispatch_audit (function_name, status, request_id)
  values (p_function_name, 'QUEUED', v_request_id);
  delete from app_private.edge_dispatch_audit where created_at < now() - interval '30 days';
  return v_request_id;
exception when others then
  insert into app_private.edge_dispatch_audit (function_name, status, error_code)
  values (p_function_name, 'ERROR', sqlstate);
  return null;
end;
$$;

revoke all on function public.store_whatsapp_qr_code(text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.get_whatsapp_qr_health_targets() from public, anon, authenticated;
revoke all on function public.record_whatsapp_qr_health(text, text, text) from public, anon, authenticated;
grant execute on function public.store_whatsapp_qr_code(text, text, timestamptz), public.get_whatsapp_qr_health_targets(), public.record_whatsapp_qr_health(text, text, text) to service_role;

select cron.schedule(
  'los_barberos_health_whatsapp_qr',
  '*/15 * * * *',
  $job$select app_private.dispatch_edge_function('whatsapp-qr-health', '{}'::jsonb);$job$
);
