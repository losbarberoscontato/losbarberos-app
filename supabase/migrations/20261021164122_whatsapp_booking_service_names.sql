create or replace function public.schedule_whatsapp_v2_for_appointment()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_connection public.whatsapp_business_connections%rowtype;
  v_settings public.whatsapp_automation_settings_v2%rowtype;
  v_customer public.customers%rowtype;
  v_barber public.barbers%rowtype;
  v_org public.organizations%rowtype;
  v_start timestamptz;
  v_t24 timestamptz;
  v_morning timestamptz;
  v_t180 timestamptz;
  v_t45 timestamptz;
  v_confirmed_transition boolean := new.status = 'CONFIRMED' and (tg_op = 'INSERT' or old.status is distinct from 'CONFIRMED');
  v_changed boolean := tg_op = 'UPDATE' and (old.service_period is distinct from new.service_period or old.barber_id is distinct from new.barber_id or old.customer_id is distinct from new.customer_id or old.version is distinct from new.version);
  v_client_consented boolean;
  v_service_names text;
  v_payload jsonb;
begin
  select * into v_connection from public.whatsapp_business_connections
  where organization_id = new.organization_id and provider = 'QR_WEB' and is_active order by updated_at desc limit 1;
  if not found then return new; end if;
  select * into v_settings from public.whatsapp_automation_settings_v2 where organization_id = new.organization_id;
  if not found or v_settings.mode <> 'ACTIVE' or v_settings.dispatch_paused then return new; end if;

  if new.status = 'CANCELED' and (tg_op = 'INSERT' or old.status is distinct from 'CANCELED') then
    update public.whatsapp_automation_jobs set status = 'CANCELED', updated_at = now(), last_error_code = 'APPOINTMENT_CANCELED'
    where appointment_id = new.id and status in ('PENDING', 'RETRY', 'PROCESSING');
    update public.whatsapp_confirmation_requests_v2 set status = 'EXPIRED', updated_at = now()
    where appointment_id = new.id and status = 'PENDING';
    return new;
  end if;
  if new.status <> 'CONFIRMED' or not (v_confirmed_transition or v_changed) then return new; end if;
  if v_changed then
    update public.whatsapp_automation_jobs set status = 'CANCELED', updated_at = now(), last_error_code = 'APPOINTMENT_VERSION_SUPERSEDED'
    where appointment_id = new.id and appointment_version <> new.version and status in ('PENDING', 'RETRY', 'PROCESSING');
    update public.whatsapp_confirmation_requests_v2 set status = 'SUPERSEDED', updated_at = now()
    where appointment_id = new.id and appointment_version <> new.version and status = 'PENDING';
  end if;

  select * into strict v_customer from public.customers where id = new.customer_id and organization_id = new.organization_id;
  select * into strict v_barber from public.barbers where id = new.barber_id and organization_id = new.organization_id;
  select * into strict v_org from public.organizations where id = new.organization_id;
  select coalesce(nullif(string_agg(ai.service_name_snapshot, ', ' order by ai.position), ''), 'Serviço não informado')
    into v_service_names
    from public.appointment_items ai
    where ai.organization_id = new.organization_id and ai.appointment_id = new.id;
  v_client_consented := public.whatsapp_v2_consented(new.organization_id, new.customer_id);
  v_start := lower(new.service_period);
  v_payload := jsonb_build_object(
    'customer_name', v_customer.full_name, 'barber_name', v_barber.display_name,
    'service_names', v_service_names,
    'starts_at', v_start, 'timezone', v_org.timezone, 'currency', new.currency,
    'total_cents', new.total_cents_snapshot,
    'templates', public.whatsapp_v2_default_message_templates() || v_settings.templates
  );

  if v_confirmed_transition and v_settings.booking_client_enabled and v_customer.phone_e164 is not null and v_client_consented then
    insert into public.whatsapp_automation_jobs (organization_id, connection_id, appointment_id, appointment_version, job_type, recipient_e164, payload, valid_until, dedupe_key)
    values (new.organization_id, v_connection.id, new.id, new.version, 'BOOKING_CREATED_CLIENT', v_customer.phone_e164, v_payload, v_start, 'v2:' || new.id || ':v' || new.version || ':booking:client') on conflict (organization_id, dedupe_key) do nothing;
  end if;
  if v_confirmed_transition and v_settings.booking_staff_enabled and v_settings.staff_notifications_enabled and v_barber.whatsapp_e164 is not null then
    insert into public.whatsapp_automation_jobs (organization_id, connection_id, appointment_id, appointment_version, job_type, recipient_e164, payload, valid_until, dedupe_key)
    values (new.organization_id, v_connection.id, new.id, new.version, 'BOOKING_CREATED_STAFF', v_barber.whatsapp_e164, v_payload, v_start, 'v2:' || new.id || ':v' || new.version || ':booking:staff') on conflict (organization_id, dedupe_key) do nothing;
  end if;
  if v_customer.phone_e164 is null or not v_client_consented then return new; end if;

  v_t24 := v_start - interval '24 hours';
  v_morning := ((v_start at time zone v_org.timezone)::date + v_settings.morning_local_time) at time zone v_org.timezone;
  v_t180 := v_start - interval '180 minutes';
  v_t45 := v_start - make_interval(mins => v_settings.t45_offset_minutes);
  if v_settings.reminder_t24_enabled then
    insert into public.whatsapp_automation_jobs (organization_id, connection_id, appointment_id, appointment_version, job_type, recipient_e164, payload, scheduled_for, next_attempt_at, valid_until, status, dedupe_key)
    values (new.organization_id, v_connection.id, new.id, new.version, 'REMINDER_T24_CLIENT', v_customer.phone_e164, v_payload, v_t24, v_t24, v_start, case when v_t24 <= now() then 'SKIPPED'::public.whatsapp_v2_job_status else 'PENDING'::public.whatsapp_v2_job_status end, 'v2:' || new.id || ':v' || new.version || ':t24:client') on conflict (organization_id, dedupe_key) do nothing;
  elsif v_settings.reminder_morning_enabled then
    insert into public.whatsapp_automation_jobs (organization_id, connection_id, appointment_id, appointment_version, job_type, recipient_e164, payload, scheduled_for, next_attempt_at, valid_until, status, dedupe_key)
    values (new.organization_id, v_connection.id, new.id, new.version, 'REMINDER_MORNING_CLIENT', v_customer.phone_e164, v_payload, v_morning, v_morning, v_start, case when v_morning <= now() or v_morning >= v_start then 'SKIPPED'::public.whatsapp_v2_job_status else 'PENDING'::public.whatsapp_v2_job_status end, 'v2:' || new.id || ':v' || new.version || ':morning:client') on conflict (organization_id, dedupe_key) do nothing;
  elsif v_settings.reminder_t180_enabled then
    insert into public.whatsapp_automation_jobs (organization_id, connection_id, appointment_id, appointment_version, job_type, recipient_e164, payload, scheduled_for, next_attempt_at, valid_until, status, dedupe_key)
    values (new.organization_id, v_connection.id, new.id, new.version, 'REMINDER_T180_CLIENT', v_customer.phone_e164, v_payload, v_t180, v_t180, v_start, case when v_t180 <= now() then 'SKIPPED'::public.whatsapp_v2_job_status else 'PENDING'::public.whatsapp_v2_job_status end, 'v2:' || new.id || ':v' || new.version || ':t180:client') on conflict (organization_id, dedupe_key) do nothing;
  elsif v_settings.reminder_t45_enabled then
    insert into public.whatsapp_automation_jobs (organization_id, connection_id, appointment_id, appointment_version, job_type, recipient_e164, payload, scheduled_for, next_attempt_at, valid_until, status, dedupe_key)
    values (new.organization_id, v_connection.id, new.id, new.version, 'REMINDER_T45_CLIENT', v_customer.phone_e164, v_payload, v_t45, v_t45, v_start, case when v_t45 <= now() then 'SKIPPED'::public.whatsapp_v2_job_status else 'PENDING'::public.whatsapp_v2_job_status end, 'v2:' || new.id || ':v' || new.version || ':t45:client') on conflict (organization_id, dedupe_key) do nothing;
  end if;
  return new;
end;
$$;
