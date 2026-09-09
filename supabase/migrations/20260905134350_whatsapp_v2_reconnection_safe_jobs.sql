-- Keep the QR automation queue durable across provider reconnects.
-- Future jobs must not be canceled merely because the transport session changed.

create or replace function public.restart_whatsapp_v2_after_qr_connection(
  p_connection_id uuid,
  p_connection_epoch_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_connection public.whatsapp_business_connections%rowtype;
  v_default_templates jsonb := jsonb_build_object(
    'BOOKING_CREATED_CLIENT', '{cliente}, seu agendamento foi confirmado para {horario}.',
    'BOOKING_CREATED_STAFF', 'Novo agendamento: {cliente}, {horario}.',
    'REMINDER_MORNING_CLIENT', 'Lembrete: seu atendimento é {horario}.\n\nResponda somente com um número:\n1 — Confirmar\n2 — Cancelar\n3 — Falar com atendente',
    'REMINDER_T45_CLIENT', 'Lembrete: seu atendimento começa em 45 minutos ({horario}).\n\nResponda somente com um número:\n1 — Confirmar\n2 — Cancelar\n3 — Falar com atendente',
    'CONFIRMATION_ACK_CLIENT', 'Presença confirmada. Até {horario}.',
    'CANCELLATION_ACK_CLIENT', 'Cancelamento confirmado. Se precisar, fale com a barbearia para novo horário.',
    'APPOINTMENT_CONFIRMED_STAFF', '{cliente} confirmou presença pelo WhatsApp para {horario}.',
    'APPOINTMENT_CANCELED_STAFF', '{cliente} cancelou pelo WhatsApp.'
  );
begin
  perform public.require_service_role();

  select * into strict v_connection
  from public.whatsapp_business_connections
  where id = p_connection_id
    and provider = 'QR_WEB'
    and is_active
    and status = 'CONNECTED'
  for update;

  insert into public.whatsapp_automation_settings_v2 (
    organization_id, mode, dispatch_paused, templates
  ) values (
    v_connection.organization_id, 'ACTIVE', false, v_default_templates
  ) on conflict (organization_id) do update
    set mode = 'ACTIVE',
        dispatch_paused = false,
        templates = case
          when public.whatsapp_automation_settings_v2.templates = '{}'::jsonb
            then excluded.templates
          else public.whatsapp_automation_settings_v2.templates
        end,
        updated_at = now();

  -- Jobs with scheduled_for > now() remain PENDING. Jobs that became due
  -- while QR was unavailable are retried now, but only before appointment end.
  update public.whatsapp_automation_jobs
  set status = 'RETRY',
      next_attempt_at = now(),
      last_error_code = 'QR_CONNECTION_RECONNECTED',
      last_error_detail = 'Requeued after the QR connection was restored.',
      locked_at = null,
      locked_by = null,
      lock_expires_at = null,
      updated_at = now()
  where organization_id = v_connection.organization_id
    and status in ('PENDING', 'RETRY')
    and scheduled_for <= now()
    and (valid_until is null or valid_until > now());

  -- Repair only unsent rows canceled by the previous reconnect behavior.
  -- The appointment and its validity window prevent historical replay.
  update public.whatsapp_automation_jobs j
  set status = 'RETRY',
      next_attempt_at = greatest(now(), j.scheduled_for),
      last_error_code = 'QR_CONNECTION_RECONNECTED',
      last_error_detail = 'Recovered after a prior QR reconnect canceled the unsent job.',
      locked_at = null,
      locked_by = null,
      lock_expires_at = null,
      updated_at = now()
  from public.appointments a
  where j.organization_id = v_connection.organization_id
    and j.status = 'CANCELED'
    and j.last_error_code = 'QR_CONNECTION_RESTARTED'
    and j.valid_until > now()
    and j.appointment_id = a.id
    and a.organization_id = j.organization_id
    and a.status = 'CONFIRMED'
    and lower(a.service_period) > now();
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

  -- is_active identifies the selected provider, while status identifies
  -- transport health. Keep the selection across close/open events. A QR
  -- connection that is not selected may become active only when no other
  -- provider is currently selected.
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
  if v_restarted then v_epoch := coalesce(p_connection_epoch_at, now()); end if;

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

  if v_restarted then
    perform public.restart_whatsapp_v2_after_qr_connection(v_connection.id, v_epoch);
  end if;
  return true;
end;
$$;

revoke all on function public.restart_whatsapp_v2_after_qr_connection(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.restart_whatsapp_v2_after_qr_connection(uuid, timestamptz) to service_role;
revoke all on function public.update_whatsapp_qr_status(text, text, text) from public, anon, authenticated;
grant execute on function public.update_whatsapp_qr_status(text, text, text) to service_role;

notify pgrst, 'reload schema';
