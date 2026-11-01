-- On the first QR connection, the settings row is provisioned by the recovery
-- function. Provision it before attempting the automatic runtime promotion.
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

  -- This creates whatsapp_automation_settings_v2 on a fresh tenant and safely
  -- recovers due queue work. Do it before reading the row in auto-activation.
  if v_restarted then
    perform public.restart_whatsapp_v2_after_qr_connection(v_connection.id, v_epoch);
  end if;

  if v_status = 'CONNECTED' and v_should_activate then
    perform public.auto_activate_whatsapp_runtime_on_qr(v_connection.organization_id);
  end if;

  return true;
end;
$$;

revoke all on function public.update_whatsapp_qr_status(text, text, text) from public, anon, authenticated;
grant execute on function public.update_whatsapp_qr_status(text, text, text) to service_role;

notify pgrst, 'reload schema';
