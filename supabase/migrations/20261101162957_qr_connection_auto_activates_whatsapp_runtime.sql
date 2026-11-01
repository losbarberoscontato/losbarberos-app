-- Automatically promote the WhatsApp v2 runtime after a QR connection is
-- confirmed, while preserving an explicit operator choice to keep it paused.
alter table public.whatsapp_automation_settings_v2
  add column runtime_auto_activate_on_connect boolean not null default true;

create or replace function public.set_whatsapp_runtime_engine(
  p_organization_id uuid,
  p_engine text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_auto_activate boolean;
begin
  perform public.require_service_role();
  if p_engine not in ('LEGACY', 'SHADOW', 'ACTIVE') then
    raise exception 'INVALID_ENGINE';
  end if;

  perform 1
  from public.whatsapp_business_connections
  where organization_id = p_organization_id
  for update;

  if exists (
    select 1 from public.whatsapp_automation_jobs
    where organization_id = p_organization_id
      and status in ('PROCESSING', 'SEND_UNKNOWN')
  ) or exists (
    select 1 from public.whatsapp_webhook_events_v2
    where organization_id = p_organization_id
      and processing_status = 'PROCESSING'
  ) then
    raise exception 'RUNTIME_BUSY';
  end if;

  if p_engine <> 'ACTIVE' and exists (
    select 1 from public.whatsapp_automation_jobs
    where organization_id = p_organization_id
      and custom_key is not null
      and status in ('PENDING', 'RETRY')
  ) then
    raise exception 'CUSTOM_JOBS_REQUIRE_RECONCILIATION';
  end if;

  update public.whatsapp_automation_settings_v2
  set runtime_engine = p_engine,
      runtime_changed_at = now(),
      runtime_auto_activate_on_connect = case
        when p_engine in ('LEGACY', 'SHADOW') then false
        else runtime_auto_activate_on_connect
      end
  where organization_id = p_organization_id
  returning runtime_auto_activate_on_connect into v_auto_activate;

  insert into public.whatsapp_runtime_audit(organization_id, event_type, detail)
  values (
    p_organization_id,
    'ENGINE_CHANGED',
    jsonb_build_object('engine', p_engine, 'auto_activate_on_connect', v_auto_activate)
  );
end;
$$;

create or replace function public.auto_activate_whatsapp_runtime_on_qr(
  p_organization_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_settings public.whatsapp_automation_settings_v2%rowtype;
begin
  perform public.require_service_role();

  select * into v_settings
  from public.whatsapp_automation_settings_v2
  where organization_id = p_organization_id
  for update;
  if not found
     or v_settings.runtime_engine = 'ACTIVE'
     or not v_settings.runtime_auto_activate_on_connect then
    return false;
  end if;

  if not exists (
    select 1 from public.whatsapp_business_connections
    where organization_id = p_organization_id
      and provider = 'QR_WEB'
      and is_active
      and status = 'CONNECTED'
  ) then
    return false;
  end if;

  -- Leave the connection healthy if work is in flight; a later QR open event
  -- retries activation without switching engines during an uncertain send.
  if exists (
    select 1 from public.whatsapp_automation_jobs
    where organization_id = p_organization_id
      and status in ('PROCESSING', 'SEND_UNKNOWN')
  ) or exists (
    select 1 from public.whatsapp_webhook_events_v2
    where organization_id = p_organization_id
      and processing_status = 'PROCESSING'
  ) then
    return false;
  end if;

  update public.whatsapp_automation_settings_v2
  set runtime_engine = 'ACTIVE', runtime_changed_at = now()
  where organization_id = p_organization_id
    and runtime_engine <> 'ACTIVE'
    and runtime_auto_activate_on_connect;
  if not found then
    return false;
  end if;

  insert into public.whatsapp_runtime_audit(organization_id, event_type, detail)
  values (
    p_organization_id,
    'AUTO_ACTIVATED_ON_QR',
    jsonb_build_object('engine', 'ACTIVE', 'provider', 'QR_WEB')
  );
  return true;
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
  v_restarted boolean := false;
  v_should_activate boolean;
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

  -- Keep provider selection across close/open events. A QR connection that is
  -- not selected becomes active only when no other provider is selected.
  v_should_activate := v_connection.is_active;
  if v_status = 'CONNECTED' and not v_should_activate then
    select not exists (
      select 1
      from public.whatsapp_business_connections other_connection
      where other_connection.organization_id = v_connection.organization_id
        and other_connection.id <> v_connection.id
        and other_connection.is_active
    ) into v_should_activate;
  end if;

  v_restarted := v_status = 'CONNECTED'
    and v_should_activate
    and (v_connection.status <> 'CONNECTED' or v_connection.connection_epoch_at is null);
  if v_restarted then v_epoch := now(); end if;

  update public.whatsapp_business_connections
  set status = v_status,
      is_active = case when v_status = 'CONNECTED' then v_should_activate else is_active end,
      connected_at = case when v_status = 'CONNECTED' then coalesce(connected_at, now()) else connected_at end,
      disconnected_at = case when v_status = 'DISCONNECTED' then now() else disconnected_at end,
      connection_epoch_at = coalesce(v_epoch, connection_epoch_at),
      qr_code = case when v_status = 'CONNECTED' then null else qr_code end,
      qr_expires_at = case when v_status = 'CONNECTED' then null else qr_expires_at end,
      health_status = v_health_status,
      health_checked_at = now(),
      health_error_code = left(nullif(btrim(p_error_code), ''), 255),
      health_consecutive_failures = case when v_status = 'CONNECTED' then 0 else health_consecutive_failures end,
      last_error_code = left(nullif(btrim(p_error_code), ''), 255),
      last_status_at = now(),
      updated_at = now()
  where id = v_connection.id;

  if v_status = 'CONNECTED' and v_should_activate then
    perform public.auto_activate_whatsapp_runtime_on_qr(v_connection.organization_id);
  end if;

  if v_restarted then
    perform public.restart_whatsapp_v2_after_qr_connection(v_connection.id, v_epoch);
  end if;
  return true;
end;
$$;

revoke all on function public.set_whatsapp_runtime_engine(uuid, text) from public, anon, authenticated;
grant execute on function public.set_whatsapp_runtime_engine(uuid, text) to service_role;
revoke all on function public.auto_activate_whatsapp_runtime_on_qr(uuid) from public, anon, authenticated;
grant execute on function public.auto_activate_whatsapp_runtime_on_qr(uuid) to service_role;
revoke all on function public.update_whatsapp_qr_status(text, text, text) from public, anon, authenticated;
grant execute on function public.update_whatsapp_qr_status(text, text, text) to service_role;

notify pgrst, 'reload schema';
