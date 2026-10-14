-- A connected QR resumes the V2 queue unless the explicit dispatch pause is set.
-- LEGACY remains a supported V2 dispatcher lane; do not require the newer runtime worker.
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
  where id = p_connection_id and provider = 'QR_WEB' and is_active and status = 'CONNECTED'
  for update;

  insert into public.whatsapp_automation_settings_v2 (organization_id, mode, dispatch_paused, templates)
  values (v_connection.organization_id, 'ACTIVE', false, v_default_templates)
  on conflict (organization_id) do update
    set mode = 'ACTIVE',
        dispatch_paused = public.whatsapp_automation_settings_v2.dispatch_paused,
        templates = case
          when public.whatsapp_automation_settings_v2.templates = '{}'::jsonb then excluded.templates
          else public.whatsapp_automation_settings_v2.templates
        end,
        updated_at = now();

  -- Keep future messages scheduled; retry due work only inside its validity window.
  update public.whatsapp_automation_jobs
  set status = 'RETRY', next_attempt_at = now(), last_error_code = 'QR_CONNECTION_RECONNECTED',
      last_error_detail = 'Requeued after the QR connection was restored.',
      locked_at = null, locked_by = null, lock_expires_at = null, updated_at = now()
  where organization_id = v_connection.organization_id
    and status in ('PENDING', 'RETRY') and scheduled_for <= now()
    and (valid_until is null or valid_until > now());

  update public.whatsapp_automation_jobs j
  set status = 'RETRY', next_attempt_at = greatest(now(), j.scheduled_for),
      last_error_code = 'QR_CONNECTION_RECONNECTED',
      last_error_detail = 'Recovered after a prior QR reconnect canceled the unsent job.',
      locked_at = null, locked_by = null, lock_expires_at = null, updated_at = now()
  from public.appointments a
  where j.organization_id = v_connection.organization_id
    and j.status = 'CANCELED' and j.last_error_code = 'QR_CONNECTION_RESTARTED'
    and j.valid_until > now() and j.appointment_id = a.id
    and a.organization_id = j.organization_id and a.status = 'CONFIRMED'
    and lower(a.service_period) > now();
end;
$$;

revoke all on function public.restart_whatsapp_v2_after_qr_connection(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.restart_whatsapp_v2_after_qr_connection(uuid, timestamptz) to service_role;

-- Repair connected QR tenants left OFF by the prior reconnect function.
-- Preserve explicit dispatch pause and all user-configured automation controls.
update public.whatsapp_automation_settings_v2 s
set mode = 'ACTIVE', updated_at = now()
where s.mode = 'OFF'
  and exists (
    select 1 from public.whatsapp_business_connections c
    where c.organization_id = s.organization_id
      and c.provider = 'QR_WEB' and c.is_active and c.status = 'CONNECTED'
  );

create or replace function public.confirm_appointment_manually_by_whatsapp(p_appointment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_appointment public.appointments%rowtype;
  v_connection public.whatsapp_business_connections%rowtype;
  v_settings public.whatsapp_automation_settings_v2%rowtype;
  v_customer public.customers%rowtype;
  v_barber public.barbers%rowtype;
  v_timezone text;
begin
  select * into v_appointment from public.appointments where id = p_appointment_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'appointment not found'; end if;
  if not public.is_organization_owner(v_appointment.organization_id) then
    raise exception using errcode = '42501', message = 'organization owner required';
  end if;
  if not public.organization_allows_existing_operations(v_appointment.organization_id) then
    raise exception using errcode = '42501', message = 'organization access does not allow appointment operations';
  end if;
  if v_appointment.status <> 'CONFIRMED' then
    raise exception using errcode = '22023', message = 'appointment must be operationally confirmed';
  end if;
  if v_appointment.whatsapp_response_status in ('CONFIRMED_BY_WHATSAPP', 'CONFIRMED_MANUALLY') then
    raise exception using errcode = '22023', message = 'appointment is already confirmed';
  end if;

  select * into v_customer from public.customers
  where id = v_appointment.customer_id and organization_id = v_appointment.organization_id;
  if not found then raise exception using errcode = 'P0002', message = 'appointment customer not found'; end if;
  select * into v_barber from public.barbers
  where id = v_appointment.barber_id and organization_id = v_appointment.organization_id;
  if not found then raise exception using errcode = 'P0002', message = 'appointment barber not found'; end if;
  if v_customer.phone_e164 is null then
    raise exception using errcode = '22023', message = 'customer WhatsApp is required';
  end if;
  if v_barber.whatsapp_e164 is null then
    raise exception using errcode = '22023', message = 'barber WhatsApp is required';
  end if;
  if not public.whatsapp_v2_consented(v_appointment.organization_id, v_customer.id) then
    raise exception using errcode = '42501', message = 'customer WhatsApp transactional consent is required';
  end if;

  select * into v_connection from public.whatsapp_business_connections
  where organization_id = v_appointment.organization_id and provider = 'QR_WEB'
    and is_active and status = 'CONNECTED'
  order by updated_at desc limit 1 for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'active WhatsApp QR connection not found';
  end if;
  select * into v_settings from public.whatsapp_automation_settings_v2
  where organization_id = v_appointment.organization_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'WhatsApp automation settings not found';
  end if;
  if v_settings.mode <> 'ACTIVE' then
    raise exception using errcode = '22023', message = 'WhatsApp automation is not active';
  end if;
  if v_settings.dispatch_paused then
    raise exception using errcode = '22023', message = 'WhatsApp dispatch is paused';
  end if;
  select timezone into strict v_timezone from public.organizations where id = v_appointment.organization_id;

  update public.whatsapp_confirmation_requests_v2
  set status = 'EXPIRED', updated_at = now()
  where appointment_id = v_appointment.id and organization_id = v_appointment.organization_id and status = 'PENDING';
  update public.whatsapp_automation_jobs
  set status = 'CANCELED', last_error_code = 'MANUAL_CONFIRMATION_SUPERSEDED_REMINDER', updated_at = now()
  where appointment_id = v_appointment.id and organization_id = v_appointment.organization_id
    and status in ('PENDING', 'RETRY') and job_type in ('REMINDER_MORNING_CLIENT', 'REMINDER_T45_CLIENT');
  update public.appointments
  set whatsapp_response_status = 'CONFIRMED_MANUALLY', updated_at = now()
  where id = v_appointment.id and organization_id = v_appointment.organization_id;
  insert into public.appointment_status_events
    (organization_id, appointment_id, from_status, to_status, reason, actor_user_id, metadata)
  values (v_appointment.organization_id, v_appointment.id, v_appointment.status, v_appointment.status,
    'manual_whatsapp_confirmation_requested', auth.uid(),
    jsonb_build_object('whatsapp_response_status', 'CONFIRMED_MANUALLY'));
  insert into public.whatsapp_automation_jobs
    (organization_id, connection_id, appointment_id, appointment_version, job_type, recipient_e164, payload, valid_until, dedupe_key)
  values (v_appointment.organization_id, v_connection.id, v_appointment.id, v_appointment.version,
    'MANUAL_OUTBOUND_TEXT', v_customer.phone_e164,
    jsonb_build_object('message_kind', 'MANUAL_CONFIRMATION_CLIENT', 'customer_name', v_customer.full_name,
      'barber_name', v_barber.display_name, 'starts_at', lower(v_appointment.service_period), 'timezone', v_timezone),
    lower(v_appointment.service_period), 'v2:' || v_appointment.id || ':v' || v_appointment.version || ':manual-confirm:client')
  on conflict (organization_id, dedupe_key) do nothing;
  insert into public.whatsapp_automation_jobs
    (organization_id, connection_id, appointment_id, appointment_version, job_type, recipient_e164, payload, valid_until, dedupe_key)
  values (v_appointment.organization_id, v_connection.id, v_appointment.id, v_appointment.version,
    'MANUAL_OUTBOUND_TEXT', v_barber.whatsapp_e164,
    jsonb_build_object('message_kind', 'MANUAL_CONFIRMATION_STAFF', 'customer_name', v_customer.full_name,
      'barber_name', v_barber.display_name, 'starts_at', lower(v_appointment.service_period), 'timezone', v_timezone),
    lower(v_appointment.service_period), 'v2:' || v_appointment.id || ':v' || v_appointment.version || ':manual-confirm:staff')
  on conflict (organization_id, dedupe_key) do nothing;
  return jsonb_build_object('appointment_id', v_appointment.id, 'whatsapp_response_status', 'CONFIRMED_MANUALLY');
end;
$$;

revoke all on function public.confirm_appointment_manually_by_whatsapp(uuid) from public, anon;
grant execute on function public.confirm_appointment_manually_by_whatsapp(uuid) to authenticated;
notify pgrst, 'reload schema';
