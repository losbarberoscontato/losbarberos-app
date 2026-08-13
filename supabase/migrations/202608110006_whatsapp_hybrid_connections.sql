-- WhatsApp híbrido: conexão tenant-safe e automação transacional.
-- Tokens ficam exclusivamente no Vault; esta migration guarda apenas referências opacas.

create type public.whatsapp_provider as enum ('META_CLOUD', 'QR_WEB');
create type public.whatsapp_connection_status as enum (
  'PENDING', 'WAITING_FOR_QR', 'CONNECTED', 'REAUTH_REQUIRED', 'DISCONNECTED', 'ERROR'
);

create table public.whatsapp_business_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  provider public.whatsapp_provider not null,
  status public.whatsapp_connection_status not null default 'PENDING',
  is_active boolean not null default false,
  waba_id text,
  phone_number_id text,
  gateway_instance_id text,
  access_token_secret_id uuid,
  gateway_secret_id uuid,
  connected_at timestamptz,
  disconnected_at timestamptz,
  last_error_code text,
  last_status_at timestamptz,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, provider),
  unique (id, organization_id),
  unique (phone_number_id),
  check (phone_number_id is null or char_length(btrim(phone_number_id)) between 3 and 80),
  check (waba_id is null or char_length(btrim(waba_id)) between 3 and 80),
  check (gateway_instance_id is null or char_length(btrim(gateway_instance_id)) between 3 and 120),
  check ((provider = 'META_CLOUD' and gateway_instance_id is null)
      or (provider = 'QR_WEB' and waba_id is null and phone_number_id is null))
);

create unique index whatsapp_business_connections_one_active
  on public.whatsapp_business_connections (organization_id)
  where is_active;

create index whatsapp_business_connections_phone_idx
  on public.whatsapp_business_connections (phone_number_id)
  where phone_number_id is not null;

create table public.whatsapp_reminder_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  position smallint not null check (position between 1 and 2),
  enabled boolean not null default true,
  offset_minutes integer not null check (offset_minutes between 45 and 43200),
  template_key text not null check (template_key in ('appointment_reminder_6h', 'appointment_reminder_45m')),
  language_code text not null default 'pt_BR' check (language_code ~ '^[a-z]{2}_[A-Z]{2}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, position),
  unique (organization_id, offset_minutes),
  unique (id, organization_id)
);

create table public.whatsapp_automation_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  confirmation_enabled boolean not null default true,
  confirmation_template_key text not null default 'appointment_confirmation'
    check (confirmation_template_key = 'appointment_confirmation'),
  welcome_enabled boolean not null default true,
  welcome_message text not null default '*{barbearia}* agradece seu contato.\nPara agendar seu horário, acesse {link}.',
  updated_at timestamptz not null default now(),
  check (char_length(btrim(welcome_message)) between 1 and 1024),
  check (welcome_message not like '%{token}%')
);

create table public.whatsapp_connection_states (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  provider public.whatsapp_provider not null,
  state_hash text not null unique check (char_length(state_hash) >= 32),
  requested_by_user_id uuid not null references auth.users(id),
  return_path text not null check (return_path like '/%' and return_path not like '//%'),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  check (expires_at > created_at),
  check (consumed_at is null or consumed_at >= created_at)
);

create index whatsapp_connection_states_live_idx
  on public.whatsapp_connection_states (provider, state_hash, expires_at)
  where consumed_at is null;

create trigger whatsapp_business_connections_set_updated_at
  before update on public.whatsapp_business_connections
  for each row execute function public.set_updated_at();

create trigger whatsapp_reminder_rules_set_updated_at
  before update on public.whatsapp_reminder_rules
  for each row execute function public.set_updated_at();

create trigger whatsapp_automation_settings_set_updated_at
  before update on public.whatsapp_automation_settings
  for each row execute function public.set_updated_at();

alter table public.whatsapp_business_connections enable row level security;
alter table public.whatsapp_reminder_rules enable row level security;
alter table public.whatsapp_automation_settings enable row level security;
alter table public.whatsapp_connection_states enable row level security;

create policy whatsapp_connections_owner_select on public.whatsapp_business_connections
  for select to authenticated using (public.is_organization_owner(organization_id));
create policy whatsapp_connections_owner_update on public.whatsapp_business_connections
  for update to authenticated
  using (public.is_organization_owner(organization_id)
    and public.organization_allows_management_mutations(organization_id))
  with check (public.is_organization_owner(organization_id)
    and public.organization_allows_management_mutations(organization_id));

create policy whatsapp_reminders_owner_select on public.whatsapp_reminder_rules
  for select to authenticated using (public.is_organization_owner(organization_id));
create policy whatsapp_automation_owner_select on public.whatsapp_automation_settings
  for select to authenticated using (public.is_organization_owner(organization_id));
create policy whatsapp_automation_owner_update on public.whatsapp_automation_settings
  for update to authenticated
  using (public.is_organization_owner(organization_id)
    and public.organization_allows_management_mutations(organization_id))
  with check (public.is_organization_owner(organization_id)
    and public.organization_allows_management_mutations(organization_id));

insert into public.whatsapp_automation_settings (organization_id)
select o.id from public.organizations o
on conflict (organization_id) do nothing;

insert into public.whatsapp_reminder_rules (
  organization_id, position, enabled, offset_minutes, template_key, language_code
)
select o.id, 1, true, 360, 'appointment_reminder_6h', 'pt_BR'
from public.organizations o
on conflict (organization_id, position) do nothing;

insert into public.whatsapp_reminder_rules (
  organization_id, position, enabled, offset_minutes, template_key, language_code
)
select o.id, 2, true, 45, 'appointment_reminder_45m', 'pt_BR'
from public.organizations o
on conflict (organization_id, position) do nothing;

create or replace function public.get_whatsapp_connection_status(p_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
begin
  if not public.is_organization_owner(p_organization_id) then
    raise exception using errcode = '42501', message = 'not organization owner';
  end if;

  select jsonb_build_object(
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
        'last_status_at', c.last_status_at
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
      'welcome_enabled', true,
      'welcome_message', ''
    ))
  ) into v_result;

  return v_result;
end;
$$;

create or replace function public.create_whatsapp_connection_state(
  p_organization_id uuid,
  p_provider public.whatsapp_provider,
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
  if not public.is_organization_owner(p_organization_id, p_requested_by_user_id)
     or p_expires_at <= now()
     or p_expires_at > now() + interval '15 minutes'
     or p_return_path like '//%' then
    raise exception using errcode = '42501', message = 'invalid WhatsApp connection state';
  end if;
  insert into public.whatsapp_connection_states (
    organization_id, provider, state_hash, requested_by_user_id, return_path, expires_at
  ) values (
    p_organization_id, p_provider, p_state_hash, p_requested_by_user_id, p_return_path, p_expires_at
  ) returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.consume_whatsapp_connection_state(
  p_provider public.whatsapp_provider,
  p_state_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_state public.whatsapp_connection_states%rowtype;
begin
  perform public.require_service_role();
  select * into v_state from public.whatsapp_connection_states
  where provider = p_provider and state_hash = p_state_hash
    and consumed_at is null and expires_at > now()
  for update;
  if not found then return null; end if;
  update public.whatsapp_connection_states set consumed_at = now() where id = v_state.id;
  return jsonb_build_object(
    'organization_id', v_state.organization_id,
    'requested_by_user_id', v_state.requested_by_user_id,
    'return_path', v_state.return_path
  );
end;
$$;

create or replace function public.store_whatsapp_meta_connection(
  p_organization_id uuid,
  p_waba_id text,
  p_phone_number_id text,
  p_access_token text,
  p_connected_by_user_id uuid
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
  if not public.is_organization_owner(p_organization_id, p_connected_by_user_id)
     or nullif(btrim(p_waba_id), '') is null
     or nullif(btrim(p_phone_number_id), '') is null
     or nullif(p_access_token, '') is null then
    raise exception using errcode = '42501', message = 'invalid WhatsApp Meta connection';
  end if;
  select * into v_connection from public.whatsapp_business_connections
  where organization_id = p_organization_id and provider = 'META_CLOUD' for update;
  if v_connection.access_token_secret_id is null then
    select vault.create_secret(p_access_token, 'los-barberos-wa-meta-' || p_organization_id, 'WhatsApp Meta token for tenant') into v_secret_id;
  else
    v_secret_id := v_connection.access_token_secret_id;
    perform vault.update_secret(v_secret_id, p_access_token);
  end if;
  select not exists (select 1 from public.whatsapp_business_connections where organization_id = p_organization_id and is_active) into v_active;
  insert into public.whatsapp_business_connections (
    organization_id, provider, status, is_active, waba_id, phone_number_id,
    access_token_secret_id, connected_at, last_status_at
  ) values (
    p_organization_id, 'META_CLOUD', 'CONNECTED', v_active, btrim(p_waba_id), btrim(p_phone_number_id),
    v_secret_id, now(), now()
  ) on conflict (organization_id, provider) do update set
    status = 'CONNECTED', is_active = excluded.is_active, waba_id = excluded.waba_id,
    phone_number_id = excluded.phone_number_id, access_token_secret_id = excluded.access_token_secret_id,
    connected_at = now(), disconnected_at = null, last_status_at = now(), last_error_code = null
  returning id into v_id;
  return v_id;
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
  select not exists (select 1 from public.whatsapp_business_connections where organization_id = p_organization_id and is_active) into v_active;
  insert into public.whatsapp_business_connections (
    organization_id, provider, status, is_active, gateway_instance_id,
    gateway_secret_id, metadata, last_status_at
  ) values (
    p_organization_id, 'QR_WEB', 'WAITING_FOR_QR', v_active, btrim(p_gateway_instance_id),
    v_secret_id, jsonb_build_object('gateway_base_url', rtrim(p_gateway_base_url, '/')), now()
  ) on conflict (organization_id, provider) do update set
    status = 'WAITING_FOR_QR', is_active = excluded.is_active, gateway_instance_id = excluded.gateway_instance_id,
    gateway_secret_id = excluded.gateway_secret_id, metadata = excluded.metadata, last_status_at = now(), last_error_code = null
  returning id into v_id;
  return v_id;
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
  v_status public.whatsapp_connection_status;
begin
  perform public.require_service_role();
  v_status := case lower(p_status)
    when 'open' then 'CONNECTED'::public.whatsapp_connection_status
    when 'connecting' then 'WAITING_FOR_QR'::public.whatsapp_connection_status
    when 'close' then 'DISCONNECTED'::public.whatsapp_connection_status
    else 'ERROR'::public.whatsapp_connection_status
  end;
  update public.whatsapp_business_connections
  set status = v_status,
      connected_at = case when v_status = 'CONNECTED' then coalesce(connected_at, now()) else connected_at end,
      disconnected_at = case when v_status = 'DISCONNECTED' then now() else disconnected_at end,
      last_error_code = left(nullif(btrim(p_error_code), ''), 255),
      last_status_at = now(), updated_at = now()
  where provider = 'QR_WEB' and gateway_instance_id = p_gateway_instance_id;
  return found;
end;
$$;

create or replace function public.save_whatsapp_reminder_rules(
  p_organization_id uuid,
  p_rules jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rule jsonb;
  v_count integer;
  v_position smallint;
  v_offset integer;
  v_template text;
  v_enabled boolean;
  v_language text;
begin
  if not public.is_organization_owner(p_organization_id)
     or not public.organization_allows_management_mutations(p_organization_id) then
    raise exception using errcode = '42501', message = 'organization mutation not allowed';
  end if;
  if jsonb_typeof(p_rules) <> 'array' then
    raise exception using errcode = '22023', message = 'rules must be an array';
  end if;

  v_count := jsonb_array_length(p_rules);
  if v_count > 2 then
    raise exception using errcode = '22023', message = 'at most two reminder rules are allowed';
  end if;

  delete from public.whatsapp_reminder_rules where organization_id = p_organization_id;

  for v_rule in select value from jsonb_array_elements(p_rules)
  loop
    v_position := (v_rule ->> 'position')::smallint;
    v_offset := (v_rule ->> 'offset_minutes')::integer;
    v_template := btrim(v_rule ->> 'template_key');
    v_enabled := coalesce((v_rule ->> 'enabled')::boolean, true);
    v_language := coalesce(nullif(btrim(v_rule ->> 'language_code'), ''), 'pt_BR');

    if v_position not between 1 and 2
       or v_offset not between 45 and 43200
       or v_template not in ('appointment_reminder_6h', 'appointment_reminder_45m')
       or v_language !~ '^[a-z]{2}_[A-Z]{2}$' then
      raise exception using errcode = '22023', message = 'invalid WhatsApp reminder rule';
    end if;

    insert into public.whatsapp_reminder_rules (
      organization_id, position, enabled, offset_minutes, template_key, language_code
    ) values (
      p_organization_id, v_position, v_enabled, v_offset, v_template, v_language
    );
  end loop;

  return public.get_whatsapp_connection_status(p_organization_id);
end;
$$;

create or replace function public.set_whatsapp_active_provider(
  p_organization_id uuid,
  p_connection_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_connection public.whatsapp_business_connections%rowtype;
begin
  if not public.is_organization_owner(p_organization_id)
     or not public.organization_allows_management_mutations(p_organization_id) then
    raise exception using errcode = '42501', message = 'organization mutation not allowed';
  end if;

  select * into strict v_connection
  from public.whatsapp_business_connections
  where id = p_connection_id and organization_id = p_organization_id;

  if v_connection.status <> 'CONNECTED' then
    raise exception using errcode = '55000', message = 'connection is not connected';
  end if;

  update public.whatsapp_business_connections
  set is_active = false, updated_at = now()
  where organization_id = p_organization_id and is_active;

  update public.whatsapp_business_connections
  set is_active = true, updated_at = now()
  where id = p_connection_id and organization_id = p_organization_id;

  return public.get_whatsapp_connection_status(p_organization_id);
end;
$$;

create or replace function public.get_whatsapp_sender_context(p_organization_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, vault, pg_temp
as $$
  select jsonb_build_object(
    'organization_id', c.organization_id,
    'provider', c.provider,
    'phone_number_id', c.phone_number_id,
    'gateway_base_url', nullif(c.metadata ->> 'gateway_base_url', ''),
    'gateway_instance_id', c.gateway_instance_id,
    'access_token', access_secret.decrypted_secret,
    'gateway_api_key', gateway_secret.decrypted_secret
  )
  from public.whatsapp_business_connections c
  left join vault.decrypted_secrets access_secret
    on access_secret.id = c.access_token_secret_id
  left join vault.decrypted_secrets gateway_secret
    on gateway_secret.id = c.gateway_secret_id
  where c.organization_id = p_organization_id
    and c.is_active
    and c.status = 'CONNECTED'
  limit 1;
$$;

-- Overload tenant-routes Meta delivery callbacks by the receiving phone.
-- The legacy six-argument function remains intact for compatibility.
create or replace function public.process_whatsapp_delivery_status(
  p_event_id text,
  p_external_message_id text,
  p_status text,
  p_occurred_at timestamptz,
  p_recipient_id text,
  p_phone_number_id text,
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
  v_organization_id uuid;
begin
  perform public.require_service_role();
  select organization_id into v_organization_id
  from public.whatsapp_business_connections
  where provider = 'META_CLOUD'
    and phone_number_id = p_phone_number_id
    and status in ('CONNECTED', 'REAUTH_REQUIRED');
  if v_organization_id is null then
    return false;
  end if;

  v_registration := public.register_webhook_event(
    'WHATSAPP', p_event_id, 'messages.status', true,
    jsonb_build_object(
      'external_message_id', p_external_message_id,
      'status', p_status,
      'recipient_id', p_recipient_id,
      'phone_number_id', p_phone_number_id,
      'errors', coalesce(p_errors, '[]'::jsonb)
    ), v_organization_id, p_occurred_at
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
  where organization_id = v_organization_id
    and provider_message_id = p_external_message_id
  order by created_at desc limit 1;
  if not found then
    perform public.finish_webhook_event((v_registration ->> 'webhook_event_id')::uuid, true, null, null);
    return false;
  end if;

  insert into public.message_attempts (
    organization_id, outbox_id, attempt_number, status,
    provider_message_id, response, error_message, occurred_at
  ) values (
    v_attempt.organization_id, v_attempt.outbox_id, v_attempt.attempt_number,
    v_status, p_external_message_id,
    jsonb_build_object('recipient_id', p_recipient_id, 'phone_number_id', p_phone_number_id, 'errors', coalesce(p_errors, '[]'::jsonb)),
    case when v_status = 'FAILED' then left(coalesce(p_errors::text, 'delivery failed'), 1000) end,
    p_occurred_at
  ) on conflict (provider_message_id, status) do nothing;

  perform public.finish_webhook_event((v_registration ->> 'webhook_event_id')::uuid, true, null, null);
  return true;
end;
$$;

revoke all on table public.whatsapp_business_connections from anon, authenticated;
revoke all on table public.whatsapp_reminder_rules from anon, authenticated;
revoke all on table public.whatsapp_automation_settings from anon, authenticated;
revoke all on table public.whatsapp_connection_states from anon, authenticated;
grant select on public.whatsapp_reminder_rules, public.whatsapp_automation_settings to authenticated;
grant update on public.whatsapp_automation_settings to authenticated;

revoke all on function public.get_whatsapp_connection_status(uuid) from public, anon, authenticated;
revoke all on function public.save_whatsapp_reminder_rules(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.set_whatsapp_active_provider(uuid, uuid) from public, anon, authenticated;
revoke all on function public.get_whatsapp_sender_context(uuid) from public, anon, authenticated;
revoke all on function public.create_whatsapp_connection_state(uuid, public.whatsapp_provider, text, uuid, text, timestamptz) from public, anon, authenticated;
revoke all on function public.consume_whatsapp_connection_state(public.whatsapp_provider, text) from public, anon, authenticated;
revoke all on function public.store_whatsapp_meta_connection(uuid, text, text, text, uuid) from public, anon, authenticated;
revoke all on function public.store_whatsapp_qr_connection(uuid, text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.get_whatsapp_connection_status(uuid), public.save_whatsapp_reminder_rules(uuid, jsonb), public.set_whatsapp_active_provider(uuid, uuid) to authenticated;
grant execute on function public.get_whatsapp_connection_status(uuid), public.get_whatsapp_sender_context(uuid) to service_role;
grant execute on function public.create_whatsapp_connection_state(uuid, public.whatsapp_provider, text, uuid, text, timestamptz), public.consume_whatsapp_connection_state(public.whatsapp_provider, text), public.store_whatsapp_meta_connection(uuid, text, text, text, uuid), public.store_whatsapp_qr_connection(uuid, text, text, text, uuid) to service_role;
grant execute on function public.update_whatsapp_qr_status(text, text, text) to service_role;
grant execute on function public.process_whatsapp_delivery_status(text, text, text, timestamptz, text, text, jsonb) to service_role;

grant usage on type public.whatsapp_provider, public.whatsapp_connection_status to authenticated, service_role;
