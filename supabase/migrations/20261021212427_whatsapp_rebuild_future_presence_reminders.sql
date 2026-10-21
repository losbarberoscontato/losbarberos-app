create or replace function public.whatsapp_v2_enqueue_presence_reminder(
  p_organization_id uuid,
  p_appointment_id uuid,
  p_connection_id uuid,
  p_templates jsonb,
  p_dedupe_suffix text default null
)
returns boolean
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_appointment public.appointments%rowtype;
  v_settings public.whatsapp_automation_settings_v2%rowtype;
  v_customer public.customers%rowtype;
  v_barber public.barbers%rowtype;
  v_org public.organizations%rowtype;
  v_reminder_type public.whatsapp_v2_job_type;
  v_reminder_name text;
  v_reminder_at timestamptz;
  v_start timestamptz;
  v_service_names text;
  v_payload jsonb;
  v_dedupe_key text;
begin
  select * into v_appointment
  from public.appointments
  where id = p_appointment_id and organization_id = p_organization_id;
  if not found or v_appointment.version is null
     or v_appointment.status in ('CANCELED', 'COMPLETED', 'EXPIRED', 'IN_SERVICE', 'NO_SHOW') then
    return false;
  end if;

  v_start := lower(v_appointment.service_period);
  if v_start <= now() then return false; end if;

  select * into v_settings
  from public.whatsapp_automation_settings_v2
  where organization_id = p_organization_id;
  if not found then return false; end if;
  select * into v_org from public.organizations where id = p_organization_id;
  if not found then return false; end if;

  if v_settings.reminder_t24_enabled then
    v_reminder_type := 'REMINDER_T24_CLIENT';
    v_reminder_name := 't24';
    v_reminder_at := v_start - interval '24 hours';
  elsif v_settings.reminder_morning_enabled then
    v_reminder_type := 'REMINDER_MORNING_CLIENT';
    v_reminder_name := 'morning';
    v_reminder_at := ((v_start at time zone v_org.timezone)::date + v_settings.morning_local_time) at time zone v_org.timezone;
  elsif v_settings.reminder_t180_enabled then
    v_reminder_type := 'REMINDER_T180_CLIENT';
    v_reminder_name := 't180';
    v_reminder_at := v_start - interval '180 minutes';
  elsif v_settings.reminder_t45_enabled then
    v_reminder_type := 'REMINDER_T45_CLIENT';
    v_reminder_name := 't45';
    v_reminder_at := v_start - make_interval(mins => v_settings.t45_offset_minutes);
  else
    return false;
  end if;
  -- A reminder whose configured time falls after the appointment cannot be sent.
  if v_reminder_at >= v_start then return false; end if;

  select * into v_customer from public.customers
  where id = v_appointment.customer_id and organization_id = p_organization_id;
  if not found or v_customer.phone_e164 is null
     or not public.whatsapp_v2_consented(p_organization_id, v_customer.id) then
    return false;
  end if;
  select * into v_barber from public.barbers
  where id = v_appointment.barber_id and organization_id = p_organization_id;
  if not found then return false; end if;
  -- Avoid a second presence confirmation for this appointment version. SEND_UNKNOWN
  -- and PROCESSING after send_started_at are treated as sent to prevent duplicates.
  if exists (
    select 1 from public.whatsapp_automation_jobs j
    where j.organization_id = p_organization_id
      and j.appointment_id = v_appointment.id
      and j.appointment_version = v_appointment.version
      and j.job_type in ('REMINDER_T24_CLIENT', 'REMINDER_MORNING_CLIENT', 'REMINDER_T180_CLIENT', 'REMINDER_T45_CLIENT')
      and (j.status in ('SUBMITTED', 'DELIVERED', 'READ', 'SEND_UNKNOWN')
        or (j.status = 'PROCESSING' and j.send_started_at is not null))
  ) then
    return false;
  end if;

  select coalesce(nullif(string_agg(ai.service_name_snapshot, ', ' order by ai.position), ''), 'Serviço não informado')
  into v_service_names
  from public.appointment_items ai
  where ai.organization_id = p_organization_id and ai.appointment_id = v_appointment.id;

  v_payload := jsonb_build_object(
    'customer_name', v_customer.full_name,
    'barber_name', v_barber.display_name,
    'service_names', v_service_names,
    'starts_at', v_start,
    'timezone', v_org.timezone,
    'currency', v_appointment.currency,
    'total_cents', v_appointment.total_cents_snapshot,
    'templates', public.whatsapp_v2_default_message_templates() || coalesce(p_templates, v_settings.templates)
  );
  v_dedupe_key := 'v2:' || v_appointment.id || ':v' || v_appointment.version || ':' || v_reminder_name || ':client'
    || coalesce(p_dedupe_suffix, '');

  insert into public.whatsapp_automation_jobs (
    organization_id, connection_id, appointment_id, appointment_version,
    job_type, recipient_e164, payload, scheduled_for, next_attempt_at,
    valid_until, status, dedupe_key
  ) values (
    p_organization_id, p_connection_id, v_appointment.id, v_appointment.version,
    v_reminder_type, v_customer.phone_e164, v_payload,
    greatest(v_reminder_at, now()), greatest(v_reminder_at, now()),
    v_start, 'PENDING', v_dedupe_key
  ) on conflict (organization_id, dedupe_key) do nothing;
  return found;
end;
$$;

revoke all on function public.whatsapp_v2_enqueue_presence_reminder(uuid, uuid, uuid, jsonb, text) from public, anon, authenticated, service_role;

create or replace function public.preview_whatsapp_v2_presence_reminder_change(
  p_organization_id uuid,
  p_rules jsonb
)
returns bigint
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_reminder_name text;
  v_count bigint;
begin
  if not public.is_organization_owner(p_organization_id) then
    raise exception using errcode = '42501', message = 'not organization owner';
  end if;
  if jsonb_typeof(p_rules) <> 'object' then
    raise exception using errcode = '22023', message = 'invalid automation rules';
  end if;

  v_reminder_name := case
    when coalesce((p_rules ->> 'reminder_t24_enabled')::boolean, false) then 't24'
    when coalesce((p_rules ->> 'reminder_morning_enabled')::boolean, false) then 'morning'
    when coalesce((p_rules ->> 'reminder_t180_enabled')::boolean, false) then 't180'
    when coalesce((p_rules ->> 'reminder_t45_enabled')::boolean, false) then 't45'
    else null end;

  select count(*) into v_count
  from public.appointments a
  join public.customers c on c.id = a.customer_id and c.organization_id = a.organization_id
  join public.organizations o on o.id = a.organization_id
  join public.whatsapp_automation_settings_v2 s on s.organization_id = a.organization_id
  where a.organization_id = p_organization_id
    and a.status not in ('CANCELED', 'COMPLETED', 'EXPIRED', 'IN_SERVICE', 'NO_SHOW')
    and lower(a.service_period) > now()
    and c.phone_e164 is not null
    and public.whatsapp_v2_consented(a.organization_id, c.id)
    and not exists (
      select 1 from public.whatsapp_automation_jobs j
      where j.organization_id = a.organization_id
        and j.appointment_id = a.id
        and j.appointment_version = a.version
        and j.job_type in ('REMINDER_T24_CLIENT', 'REMINDER_MORNING_CLIENT', 'REMINDER_T180_CLIENT', 'REMINDER_T45_CLIENT')
        and (j.status in ('SUBMITTED', 'DELIVERED', 'READ', 'SEND_UNKNOWN')
          or (j.status = 'PROCESSING' and j.send_started_at is not null))
    )
    and (v_reminder_name is null or
      case v_reminder_name
        when 't24' then lower(a.service_period) - interval '24 hours'
        when 'morning' then ((lower(a.service_period) at time zone o.timezone)::date + s.morning_local_time) at time zone o.timezone
        when 't180' then lower(a.service_period) - interval '180 minutes'
        else lower(a.service_period) - make_interval(mins => s.t45_offset_minutes)
      end < lower(a.service_period));

  return coalesce(v_count, 0);
end;
$$;

revoke all on function public.preview_whatsapp_v2_presence_reminder_change(uuid, jsonb) from public, anon, service_role;
grant execute on function public.preview_whatsapp_v2_presence_reminder_change(uuid, jsonb) to authenticated;

create or replace function public.rebuild_whatsapp_v2_presence_reminders_after_settings_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_reminder_name text;
  v_connection_id uuid;
  v_rebuild_id uuid := gen_random_uuid();
  v_appointment record;
begin
  if old.reminder_t24_enabled is not distinct from new.reminder_t24_enabled
     and old.reminder_morning_enabled is not distinct from new.reminder_morning_enabled
     and old.reminder_t180_enabled is not distinct from new.reminder_t180_enabled
     and old.reminder_t45_enabled is not distinct from new.reminder_t45_enabled then
    return new;
  end if;

  v_reminder_name := case
    when new.reminder_t24_enabled then 't24'
    when new.reminder_morning_enabled then 'morning'
    when new.reminder_t180_enabled then 't180'
    when new.reminder_t45_enabled then 't45'
    else null end;

  update public.whatsapp_automation_jobs j
  set status = 'CANCELED', last_error_code = 'REMINDER_SCHEDULE_CHANGED',
      last_error_detail = 'Canceled because the organization changed its presence reminder schedule.', updated_at = now(),
      locked_by = null, lease_token = null, lock_expires_at = null
  from public.appointments a
  where j.organization_id = new.organization_id and j.appointment_id = a.id
    and a.organization_id = j.organization_id and lower(a.service_period) > now()
    and a.status not in ('CANCELED', 'COMPLETED', 'EXPIRED', 'IN_SERVICE', 'NO_SHOW')
    and j.job_type in ('REMINDER_T24_CLIENT', 'REMINDER_MORNING_CLIENT', 'REMINDER_T180_CLIENT', 'REMINDER_T45_CLIENT')
    and (j.status in ('PENDING', 'RETRY') or (j.status = 'PROCESSING' and j.send_started_at is null));

  if v_reminder_name is null then return new; end if;

  select c.id into v_connection_id
  from public.whatsapp_business_connections c
  where c.organization_id = new.organization_id and c.provider = 'QR_WEB' and c.is_active
  order by c.updated_at desc limit 1;
  if v_connection_id is null or new.mode <> 'ACTIVE' or new.dispatch_paused then return new; end if;

  for v_appointment in
    select a.id
    from public.appointments a
    where a.organization_id = new.organization_id
      and a.status not in ('CANCELED', 'COMPLETED', 'EXPIRED', 'IN_SERVICE', 'NO_SHOW')
      and lower(a.service_period) > now()
  loop
    perform public.whatsapp_v2_enqueue_presence_reminder(
      new.organization_id, v_appointment.id, v_connection_id,
      public.whatsapp_v2_default_message_templates() || new.templates,
      ':reconfig:' || v_rebuild_id::text
    );
  end loop;
  return new;
end;
$$;

revoke all on function public.rebuild_whatsapp_v2_presence_reminders_after_settings_change() from public, anon, authenticated, service_role;
drop trigger if exists whatsapp_v2_rebuild_presence_reminders_after_settings_change on public.whatsapp_automation_settings_v2;
create trigger whatsapp_v2_rebuild_presence_reminders_after_settings_change
after update of reminder_t24_enabled, reminder_morning_enabled, reminder_t180_enabled, reminder_t45_enabled
on public.whatsapp_automation_settings_v2
for each row execute function public.rebuild_whatsapp_v2_presence_reminders_after_settings_change();

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
  v_confirmed_transition boolean := new.status = 'CONFIRMED' and (tg_op = 'INSERT' or old.status is distinct from 'CONFIRMED');
  v_changed boolean := tg_op = 'UPDATE' and (old.service_period is distinct from new.service_period or old.barber_id is distinct from new.barber_id or old.customer_id is distinct from new.customer_id or old.version is distinct from new.version);
  v_client_consented boolean;
  v_service_names text;
  v_payload jsonb;
begin
  if new.status in ('CANCELED', 'COMPLETED', 'EXPIRED', 'IN_SERVICE', 'NO_SHOW') then
    update public.whatsapp_automation_jobs set status = 'CANCELED', updated_at = now(), last_error_code = case when new.status = 'CANCELED' then 'APPOINTMENT_CANCELED' else 'APPOINTMENT_COMPLETED' end
    where appointment_id = new.id and organization_id = new.organization_id and job_type in ('REMINDER_T24_CLIENT', 'REMINDER_MORNING_CLIENT', 'REMINDER_T180_CLIENT', 'REMINDER_T45_CLIENT')
      and (status in ('PENDING', 'RETRY') or (status = 'PROCESSING' and send_started_at is null));
    if new.status = 'CANCELED' then
      update public.whatsapp_confirmation_requests_v2 set status = 'EXPIRED', updated_at = now()
      where appointment_id = new.id and status = 'PENDING';
    end if;
    return new;
  end if;

  if not (tg_op = 'INSERT' or v_confirmed_transition or v_changed) then return new; end if;
  select * into v_connection from public.whatsapp_business_connections
  where organization_id = new.organization_id and provider = 'QR_WEB' and is_active order by updated_at desc limit 1;
  if not found then return new; end if;
  select * into v_settings from public.whatsapp_automation_settings_v2 where organization_id = new.organization_id;
  if not found or v_settings.mode <> 'ACTIVE' or v_settings.dispatch_paused then return new; end if;

  if v_changed then
    update public.whatsapp_automation_jobs set status = 'CANCELED', updated_at = now(), last_error_code = 'APPOINTMENT_VERSION_SUPERSEDED'
    where appointment_id = new.id and organization_id = new.organization_id and appointment_version <> new.version
      and (status in ('PENDING', 'RETRY') or (status = 'PROCESSING' and send_started_at is null));
    update public.whatsapp_confirmation_requests_v2 set status = 'SUPERSEDED', updated_at = now()
    where appointment_id = new.id and organization_id = new.organization_id and appointment_version <> new.version and status = 'PENDING';
  end if;

  select * into strict v_customer from public.customers where id = new.customer_id and organization_id = new.organization_id;
  select * into strict v_barber from public.barbers where id = new.barber_id and organization_id = new.organization_id;
  select * into strict v_org from public.organizations where id = new.organization_id;
  select coalesce(nullif(string_agg(ai.service_name_snapshot, ', ' order by ai.position), ''), 'Serviço não informado')
  into v_service_names from public.appointment_items ai
  where ai.organization_id = new.organization_id and ai.appointment_id = new.id;
  v_client_consented := public.whatsapp_v2_consented(new.organization_id, new.customer_id);
  v_start := lower(new.service_period);
  v_payload := jsonb_build_object(
    'customer_name', v_customer.full_name, 'barber_name', v_barber.display_name,
    'service_names', v_service_names, 'starts_at', v_start, 'timezone', v_org.timezone,
    'currency', new.currency, 'total_cents', new.total_cents_snapshot,
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

  if v_start > now() then
    perform public.whatsapp_v2_enqueue_presence_reminder(new.organization_id, new.id, v_connection.id, v_settings.templates);
  end if;
  return new;
end;
$$;

revoke all on function public.schedule_whatsapp_v2_for_appointment() from public, anon, authenticated;

create or replace function public.whatsapp_runtime_prepare(p_job_id uuid, p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  j public.whatsapp_automation_jobs%rowtype;
  a public.appointments%rowtype;
  c public.customers%rowtype;
  tz text;
  reason text;
  setting public.whatsapp_custom_message_settings_v2%rowtype;
begin
  perform public.require_service_role();
  select * into j from public.whatsapp_automation_jobs where id = p_job_id for update;
  if j.id is null or j.status <> 'PROCESSING' or j.lease_token is distinct from p_token or j.lock_expires_at <= now() then
    raise exception 'STALE_LEASE';
  end if;
  if j.valid_until <= now() or (j.job_type::text like 'REMINDER_%' and j.scheduled_for + interval '5 minutes' <= now()) then
    reason := 'DELIVERY_WINDOW_EXPIRED';
  end if;
  if not exists (
    select 1 from public.whatsapp_automation_settings_v2 s
    join public.whatsapp_business_connections w on w.organization_id = s.organization_id
    where s.organization_id = j.organization_id and s.runtime_engine = 'ACTIVE' and s.mode = 'ACTIVE'
      and not s.dispatch_paused and w.id = j.connection_id and w.is_active and w.status = 'CONNECTED'
  ) then reason := 'CONNECTION_OR_AUTOMATION_PAUSED'; end if;
  if exists (
    select 1 from public.whatsapp_automation_settings_v2 s
    where s.organization_id = j.organization_id and not case j.job_type::text
      when 'BOOKING_CREATED_CLIENT' then s.booking_client_enabled
      when 'BOOKING_CREATED_STAFF' then s.booking_staff_enabled and s.staff_notifications_enabled
      when 'REMINDER_T24_CLIENT' then s.reminder_t24_enabled
      when 'REMINDER_MORNING_CLIENT' then s.reminder_morning_enabled
      when 'REMINDER_T180_CLIENT' then s.reminder_t180_enabled
      when 'REMINDER_T45_CLIENT' then s.reminder_t45_enabled
      when 'APPOINTMENT_CONFIRMED_STAFF' then s.staff_notifications_enabled
      when 'APPOINTMENT_CANCELED_STAFF' then s.staff_notifications_enabled
      else true end
  ) then reason := 'AUTOMATION_DISABLED'; end if;
  if j.appointment_id is not null then
    select * into a from public.appointments where id = j.appointment_id and organization_id = j.organization_id;
    if j.job_type::text like 'REMINDER_%' then
      if a.id is null or a.version is distinct from j.appointment_version or a.status in ('CANCELED', 'COMPLETED', 'EXPIRED', 'IN_SERVICE', 'NO_SHOW') or lower(a.service_period) <= now() then
        reason := 'APPOINTMENT_CHANGED';
      end if;
    elsif j.job_type::text like 'BOOKING_CREATED_%' then
      if a.id is null or a.version is distinct from j.appointment_version or a.status <> 'CONFIRMED' or lower(a.service_period) <= now() then
        reason := 'APPOINTMENT_CHANGED';
      end if;
    end if;
    if j.job_type::text like '%_CLIENT' or j.payload ->> 'message_kind' = 'MANUAL_CONFIRMATION_CLIENT' then
      if a.id is null or not public.whatsapp_v2_consented(j.organization_id, a.customer_id) then reason := 'TRANSACTIONAL_REVOKED'; end if;
      select * into c from public.customers where id = a.customer_id and organization_id = j.organization_id;
      if c.phone_e164 is distinct from j.recipient_e164 then reason := 'RECIPIENT_CHANGED'; end if;
    end if;
  end if;
  if j.dedupe_key like 'campaign:%' and exists (
    select 1 from public.whatsapp_campaigns ca where ca.id::text = split_part(j.dedupe_key, ':', 2)
      and ca.organization_id = j.organization_id and ca.status = 'CANCELED'
  ) then reason := 'CAMPAIGN_CANCELED'; end if;
  if j.custom_key is not null then
    select * into c from public.customers where id = j.customer_id and organization_id = j.organization_id for update;
    select timezone into tz from public.organizations where id = j.organization_id;
    select * into setting from public.whatsapp_custom_message_settings_v2 where organization_id = j.organization_id and message_key = j.custom_key;
    if not coalesce(setting.enabled, false) then reason := 'AUTOMATION_DISABLED'; end if;
    if not public.whatsapp_marketing_allowed(j.organization_id, j.customer_id) then reason := 'MARKETING_REVOKED'; end if;
    if c.id is null or not c.active or c.phone_e164 is distinct from j.recipient_e164 then reason := 'RECIPIENT_CHANGED'; end if;
    if exists (
      select 1 from public.whatsapp_automation_jobs x
      where x.organization_id = j.organization_id and x.customer_id = j.customer_id and x.id <> j.id
        and x.custom_key is not null and x.send_started_at is not null
        and x.status in ('PROCESSING', 'SUBMITTED', 'DELIVERED', 'READ', 'SEND_UNKNOWN')
        and (x.send_started_at at time zone tz)::date = (now() at time zone tz)::date
    ) or (
      select count(*) from public.whatsapp_automation_jobs x
      where x.organization_id = j.organization_id and x.customer_id = j.customer_id and x.id <> j.id
        and x.custom_key is not null and x.send_started_at is not null
        and x.status in ('PROCESSING', 'SUBMITTED', 'DELIVERED', 'READ', 'SEND_UNKNOWN')
        and x.send_started_at >= date_trunc('week', now() at time zone tz) at time zone tz
    ) >= 2 then reason := 'FREQUENCY_LIMIT'; end if;
    if j.custom_key like 'AFTER_SERVICE_%' and exists (
      select 1 from public.appointments x where x.organization_id = j.organization_id and x.customer_id = j.customer_id
        and ((x.status = 'CONFIRMED' and lower(x.service_period) > now()) or
          (x.status = 'COMPLETED' and coalesce((select max(se.created_at) from public.appointment_status_events se
            where se.organization_id = x.organization_id and se.appointment_id = x.id and se.to_status = 'COMPLETED'), upper(x.service_period)) > (j.payload ->> 'completed_at')::timestamptz))
    ) then reason := 'CUSTOMER_RETURNED_OR_BOOKED'; end if;
  end if;
  if reason is not null then
    update public.whatsapp_automation_jobs set status = 'SKIPPED', last_error_code = reason,
      locked_by = null, lease_token = null, lock_expires_at = null, updated_at = now() where id = j.id;
    return jsonb_build_object('ready', false, 'reason', reason);
  end if;
  if j.job_type::text like 'REMINDER_%' then perform public.create_whatsapp_v2_confirmation_request(j.id, j.locked_by); end if;
  return jsonb_build_object('ready', true);
end;
$$;
