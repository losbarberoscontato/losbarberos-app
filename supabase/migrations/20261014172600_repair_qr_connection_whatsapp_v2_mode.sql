-- Explain which WhatsApp prerequisite blocks manual presence confirmation.
-- Do not promote tenants or change delivery/runtime settings in this migration.
create or replace function public.confirm_appointment_manually_by_whatsapp(
  p_appointment_id uuid
)
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
  select * into v_appointment
  from public.appointments
  where id = p_appointment_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'appointment not found';
  end if;
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

  select * into v_customer
  from public.customers
  where id = v_appointment.customer_id and organization_id = v_appointment.organization_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'appointment customer not found';
  end if;
  select * into v_barber
  from public.barbers
  where id = v_appointment.barber_id and organization_id = v_appointment.organization_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'appointment barber not found';
  end if;
  if v_customer.phone_e164 is null then
    raise exception using errcode = '22023', message = 'customer WhatsApp is required';
  end if;
  if v_barber.whatsapp_e164 is null then
    raise exception using errcode = '22023', message = 'barber WhatsApp is required';
  end if;
  if not public.whatsapp_v2_consented(v_appointment.organization_id, v_customer.id) then
    raise exception using errcode = '42501', message = 'customer WhatsApp transactional consent is required';
  end if;

  select * into v_connection
  from public.whatsapp_business_connections
  where organization_id = v_appointment.organization_id
    and provider = 'QR_WEB' and is_active and status = 'CONNECTED'
  order by updated_at desc
  limit 1
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'active WhatsApp QR connection not found';
  end if;
  select * into v_settings
  from public.whatsapp_automation_settings_v2
  where organization_id = v_appointment.organization_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'WhatsApp automation settings not found';
  end if;
  if v_settings.runtime_engine <> 'ACTIVE' then
    raise exception using errcode = '55000', message = 'WhatsApp V2 runtime is not active for this establishment';
  end if;
  if v_settings.mode <> 'ACTIVE' then
    raise exception using errcode = '22023', message = 'WhatsApp automation is not active';
  end if;
  if v_settings.dispatch_paused then
    raise exception using errcode = '22023', message = 'WhatsApp dispatch is paused';
  end if;
  select timezone into strict v_timezone
  from public.organizations
  where id = v_appointment.organization_id;

  update public.whatsapp_confirmation_requests_v2
  set status = 'EXPIRED', updated_at = now()
  where appointment_id = v_appointment.id
    and organization_id = v_appointment.organization_id and status = 'PENDING';
  update public.whatsapp_automation_jobs
  set status = 'CANCELED', last_error_code = 'MANUAL_CONFIRMATION_SUPERSEDED_REMINDER', updated_at = now()
  where appointment_id = v_appointment.id and organization_id = v_appointment.organization_id
    and status in ('PENDING', 'RETRY') and job_type in ('REMINDER_MORNING_CLIENT', 'REMINDER_T45_CLIENT');
  update public.appointments
  set whatsapp_response_status = 'CONFIRMED_MANUALLY', updated_at = now()
  where id = v_appointment.id and organization_id = v_appointment.organization_id;
  insert into public.appointment_status_events
    (organization_id, appointment_id, from_status, to_status, reason, actor_user_id, metadata)
  values
    (v_appointment.organization_id, v_appointment.id, v_appointment.status, v_appointment.status,
     'manual_whatsapp_confirmation_requested', auth.uid(),
     jsonb_build_object('whatsapp_response_status', 'CONFIRMED_MANUALLY'));
  insert into public.whatsapp_automation_jobs
    (organization_id, connection_id, appointment_id, appointment_version, job_type, recipient_e164, payload, valid_until, dedupe_key)
  values
    (v_appointment.organization_id, v_connection.id, v_appointment.id, v_appointment.version,
     'MANUAL_OUTBOUND_TEXT', v_customer.phone_e164,
     jsonb_build_object('message_kind', 'MANUAL_CONFIRMATION_CLIENT', 'customer_name', v_customer.full_name,
       'barber_name', v_barber.display_name, 'starts_at', lower(v_appointment.service_period), 'timezone', v_timezone),
     lower(v_appointment.service_period),
     'v2:' || v_appointment.id || ':v' || v_appointment.version || ':manual-confirm:client')
  on conflict (organization_id, dedupe_key) do nothing;
  insert into public.whatsapp_automation_jobs
    (organization_id, connection_id, appointment_id, appointment_version, job_type, recipient_e164, payload, valid_until, dedupe_key)
  values
    (v_appointment.organization_id, v_connection.id, v_appointment.id, v_appointment.version,
     'MANUAL_OUTBOUND_TEXT', v_barber.whatsapp_e164,
     jsonb_build_object('message_kind', 'MANUAL_CONFIRMATION_STAFF', 'customer_name', v_customer.full_name,
       'barber_name', v_barber.display_name, 'starts_at', lower(v_appointment.service_period), 'timezone', v_timezone),
     lower(v_appointment.service_period),
     'v2:' || v_appointment.id || ':v' || v_appointment.version || ':manual-confirm:staff')
  on conflict (organization_id, dedupe_key) do nothing;
  return jsonb_build_object('appointment_id', v_appointment.id, 'whatsapp_response_status', 'CONFIRMED_MANUALLY');
end;
$$;

revoke all on function public.confirm_appointment_manually_by_whatsapp(uuid) from public, anon;
grant execute on function public.confirm_appointment_manually_by_whatsapp(uuid) to authenticated;
notify pgrst, 'reload schema';
