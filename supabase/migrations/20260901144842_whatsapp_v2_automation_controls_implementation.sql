-- User-owned controls for the Evolution V2 transactional flows. Existing
-- flows remain enabled; T180 is new and deliberately starts disabled.
alter table public.whatsapp_automation_settings_v2
  add column if not exists booking_client_enabled boolean not null default true,
  add column if not exists booking_staff_enabled boolean not null default true,
  add column if not exists reminder_morning_enabled boolean not null default true,
  add column if not exists reminder_t180_enabled boolean not null default false,
  add column if not exists reminder_t45_enabled boolean not null default true;

create table if not exists public.whatsapp_custom_message_settings_v2 (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  message_key text not null check (message_key in (
    'AFTER_SERVICE_14D', 'AFTER_SERVICE_28D', 'AFTER_SERVICE_40D',
    'BIRTHDAY', 'SPECIAL_DATES', 'MARKETING_CAMPAIGNS'
  )),
  enabled boolean not null default false,
  body text not null default '' check (char_length(body) <= 4096),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, message_key)
);

alter table public.whatsapp_custom_message_settings_v2 enable row level security;
create policy whatsapp_custom_message_settings_v2_owner_select on public.whatsapp_custom_message_settings_v2
  for select to authenticated using (public.is_organization_owner(organization_id));

create or replace function public.save_whatsapp_v2_automation_controls(
  p_organization_id uuid,
  p_rules jsonb,
  p_custom_messages jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_booking_client boolean;
  v_booking_staff boolean;
  v_morning boolean;
  v_t180 boolean;
  v_t45 boolean;
begin
  if not public.is_organization_owner(p_organization_id) then
    raise exception using errcode = '42501', message = 'not organization owner';
  end if;
  if jsonb_typeof(p_rules) <> 'object' then
    raise exception using errcode = '22023', message = 'invalid automation rules';
  end if;
  if jsonb_typeof(p_custom_messages) <> 'array' then
    raise exception using errcode = '22023', message = 'invalid custom messages';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_custom_messages) item
    where jsonb_typeof(item) <> 'object'
      or item ->> 'key' not in ('AFTER_SERVICE_14D', 'AFTER_SERVICE_28D', 'AFTER_SERVICE_40D', 'BIRTHDAY', 'SPECIAL_DATES', 'MARKETING_CAMPAIGNS')
      or jsonb_typeof(item -> 'enabled') <> 'boolean'
      or jsonb_typeof(item -> 'body') <> 'string'
      or char_length(item ->> 'body') > 4096
  ) then
    raise exception using errcode = '22023', message = 'invalid custom message definition';
  end if;
  if (select count(*) from jsonb_array_elements(p_custom_messages)) <> (
    select count(distinct item ->> 'key') from jsonb_array_elements(p_custom_messages) item
  ) then
    raise exception using errcode = '22023', message = 'duplicate custom message definition';
  end if;

  v_booking_client := coalesce((p_rules ->> 'booking_client_enabled')::boolean, true);
  v_booking_staff := coalesce((p_rules ->> 'booking_staff_enabled')::boolean, true);
  v_morning := coalesce((p_rules ->> 'reminder_morning_enabled')::boolean, true);
  v_t180 := coalesce((p_rules ->> 'reminder_t180_enabled')::boolean, false);
  v_t45 := coalesce((p_rules ->> 'reminder_t45_enabled')::boolean, true);

  insert into public.whatsapp_automation_settings_v2 (
    organization_id, booking_client_enabled, booking_staff_enabled,
    reminder_morning_enabled, reminder_t180_enabled, reminder_t45_enabled
  ) values (
    p_organization_id, v_booking_client, v_booking_staff, v_morning, v_t180, v_t45
  ) on conflict (organization_id) do update set
    booking_client_enabled = excluded.booking_client_enabled,
    booking_staff_enabled = excluded.booking_staff_enabled,
    reminder_morning_enabled = excluded.reminder_morning_enabled,
    reminder_t180_enabled = excluded.reminder_t180_enabled,
    reminder_t45_enabled = excluded.reminder_t45_enabled,
    updated_at = now();

  insert into public.whatsapp_custom_message_settings_v2 (organization_id, message_key, enabled, body)
  select p_organization_id, item ->> 'key', (item ->> 'enabled')::boolean, item ->> 'body'
  from jsonb_array_elements(p_custom_messages) item
  on conflict (organization_id, message_key) do update set
    enabled = excluded.enabled,
    body = excluded.body,
    updated_at = now();

  -- A disabled rule must not be picked up after saving. A job already leased
  -- to a dispatcher is intentionally not rewritten because delivery is then
  -- provider-uncertain.
  update public.whatsapp_automation_jobs
  set status = 'CANCELED',
      last_error_code = 'AUTOMATION_DISABLED',
      last_error_detail = 'Canceled because its automation was disabled before dispatch.',
      updated_at = now()
  where organization_id = p_organization_id
    and status in ('PENDING', 'RETRY')
    and (
      (job_type = 'BOOKING_CREATED_CLIENT' and not v_booking_client)
      or (job_type = 'BOOKING_CREATED_STAFF' and not v_booking_staff)
      or (job_type = 'REMINDER_MORNING_CLIENT' and not v_morning)
      or (job_type = 'REMINDER_T180_CLIENT' and not v_t180)
      or (job_type = 'REMINDER_T45_CLIENT' and not v_t45)
    );

  return jsonb_build_object(
    'rules', jsonb_build_object(
      'booking_client_enabled', v_booking_client,
      'booking_staff_enabled', v_booking_staff,
      'reminder_morning_enabled', v_morning,
      'reminder_t180_enabled', v_t180,
      'reminder_t45_enabled', v_t45
    ),
    'custom_messages', coalesce((
      select jsonb_agg(jsonb_build_object('key', message_key, 'enabled', enabled, 'body', body) order by message_key)
      from public.whatsapp_custom_message_settings_v2
      where organization_id = p_organization_id
    ), '[]'::jsonb)
  );
end;
$$;

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
    'connections', coalesce((select jsonb_agg(jsonb_build_object(
      'id', c.id, 'provider', c.provider, 'status', c.status, 'is_active', c.is_active,
      'waba_id', c.waba_id, 'phone_number_id', c.phone_number_id, 'gateway_instance_id', c.gateway_instance_id,
      'connected_at', c.connected_at, 'disconnected_at', c.disconnected_at, 'last_error_code', c.last_error_code,
      'last_status_at', c.last_status_at, 'connection_epoch_at', c.connection_epoch_at, 'health_status', c.health_status,
      'health_checked_at', c.health_checked_at, 'health_error_code', c.health_error_code,
      'health_consecutive_failures', c.health_consecutive_failures,
      'qr_code', case when c.qr_expires_at > now() then c.qr_code else null end,
      'qr_expires_at', case when c.qr_expires_at > now() then c.qr_expires_at else null end
    ) order by c.provider) from public.whatsapp_business_connections c where c.organization_id = p_organization_id), '[]'::jsonb),
    'reminders', coalesce((select jsonb_agg(jsonb_build_object(
      'id', r.id, 'position', r.position, 'enabled', r.enabled, 'offset_minutes', r.offset_minutes,
      'template_key', r.template_key, 'language_code', r.language_code
    ) order by r.position) from public.whatsapp_reminder_rules r where r.organization_id = p_organization_id), '[]'::jsonb),
    'automation', coalesce((select jsonb_build_object(
      'booking_client_enabled', a.booking_client_enabled,
      'booking_staff_enabled', a.booking_staff_enabled,
      'reminder_morning_enabled', a.reminder_morning_enabled,
      'reminder_t180_enabled', a.reminder_t180_enabled,
      'reminder_t45_enabled', a.reminder_t45_enabled,
      'custom_messages', coalesce((select jsonb_agg(jsonb_build_object('key', m.message_key, 'enabled', m.enabled, 'body', m.body) order by m.message_key) from public.whatsapp_custom_message_settings_v2 m where m.organization_id = a.organization_id), '[]'::jsonb)
    ) from public.whatsapp_automation_settings_v2 a where a.organization_id = p_organization_id), jsonb_build_object(
      'booking_client_enabled', true, 'booking_staff_enabled', true,
      'reminder_morning_enabled', true, 'reminder_t180_enabled', false, 'reminder_t45_enabled', true,
      'custom_messages', '[]'::jsonb
    )),
    'manager_notification', coalesce((select jsonb_build_object(
      'phone_e164', s.manager_notification_phone_e164,
      'matches_qr_phone', s.manager_notification_phone_e164 is not null and exists (
        select 1 from public.whatsapp_business_connections c
        where c.organization_id = s.organization_id and c.provider = 'QR_WEB' and c.is_active
          and c.connected_phone_e164 is not null and public.whatsapp_v2_phone_matches(c.connected_phone_e164, s.manager_notification_phone_e164)
      )
    ) from public.whatsapp_automation_settings_v2 s where s.organization_id = p_organization_id), jsonb_build_object('phone_e164', null, 'matches_qr_phone', false))
  );
end;
$$;

create or replace function public.schedule_whatsapp_v2_for_appointment()
returns trigger language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v_connection public.whatsapp_business_connections%rowtype;
  v_settings public.whatsapp_automation_settings_v2%rowtype;
  v_customer public.customers%rowtype;
  v_barber public.barbers%rowtype;
  v_org public.organizations%rowtype;
  v_start timestamptz; v_morning timestamptz; v_t180 timestamptz; v_t45 timestamptz;
  v_confirmed_transition boolean := new.status = 'CONFIRMED' and (tg_op = 'INSERT' or old.status is distinct from 'CONFIRMED');
  v_changed boolean := tg_op = 'UPDATE' and (old.service_period is distinct from new.service_period or old.barber_id is distinct from new.barber_id or old.customer_id is distinct from new.customer_id or old.version is distinct from new.version);
  v_client_consented boolean; v_payload jsonb;
begin
  select * into v_connection from public.whatsapp_business_connections where organization_id = new.organization_id and provider = 'QR_WEB' and is_active order by updated_at desc limit 1;
  if not found then return new; end if;
  select * into v_settings from public.whatsapp_automation_settings_v2 where organization_id = new.organization_id;
  if not found or v_settings.mode <> 'ACTIVE' or v_settings.dispatch_paused then return new; end if;
  if new.status = 'CANCELED' and (tg_op = 'INSERT' or old.status is distinct from 'CANCELED') then
    update public.whatsapp_automation_jobs set status = 'CANCELED', updated_at = now(), last_error_code = 'APPOINTMENT_CANCELED' where appointment_id = new.id and status in ('PENDING', 'RETRY', 'PROCESSING');
    update public.whatsapp_confirmation_requests_v2 set status = 'EXPIRED', updated_at = now() where appointment_id = new.id and status = 'PENDING';
    return new;
  end if;
  if new.status <> 'CONFIRMED' or not (v_confirmed_transition or v_changed) then return new; end if;
  if v_changed then
    update public.whatsapp_automation_jobs set status = 'CANCELED', updated_at = now(), last_error_code = 'APPOINTMENT_VERSION_SUPERSEDED' where appointment_id = new.id and appointment_version <> new.version and status in ('PENDING', 'RETRY', 'PROCESSING');
    update public.whatsapp_confirmation_requests_v2 set status = 'SUPERSEDED', updated_at = now() where appointment_id = new.id and appointment_version <> new.version and status = 'PENDING';
  end if;
  select * into strict v_customer from public.customers where id = new.customer_id and organization_id = new.organization_id;
  select * into strict v_barber from public.barbers where id = new.barber_id and organization_id = new.organization_id;
  select * into strict v_org from public.organizations where id = new.organization_id;
  v_client_consented := public.whatsapp_v2_consented(new.organization_id, new.customer_id);
  v_start := lower(new.service_period);
  v_payload := jsonb_build_object('customer_name', v_customer.full_name, 'barber_name', v_barber.display_name, 'starts_at', v_start, 'timezone', v_org.timezone, 'currency', new.currency, 'total_cents', new.total_cents_snapshot, 'templates', v_settings.templates);
  if v_confirmed_transition and v_settings.booking_client_enabled and v_customer.phone_e164 is not null and v_client_consented then
    insert into public.whatsapp_automation_jobs (organization_id, connection_id, appointment_id, appointment_version, job_type, recipient_e164, payload, valid_until, dedupe_key)
    values (new.organization_id, v_connection.id, new.id, new.version, 'BOOKING_CREATED_CLIENT', v_customer.phone_e164, v_payload, v_start, 'v2:' || new.id || ':v' || new.version || ':booking:client') on conflict (organization_id, dedupe_key) do nothing;
  end if;
  if v_confirmed_transition and v_settings.booking_staff_enabled and v_settings.staff_notifications_enabled and v_barber.whatsapp_e164 is not null then
    insert into public.whatsapp_automation_jobs (organization_id, connection_id, appointment_id, appointment_version, job_type, recipient_e164, payload, valid_until, dedupe_key)
    values (new.organization_id, v_connection.id, new.id, new.version, 'BOOKING_CREATED_STAFF', v_barber.whatsapp_e164, v_payload, v_start, 'v2:' || new.id || ':v' || new.version || ':booking:staff') on conflict (organization_id, dedupe_key) do nothing;
  end if;
  if v_customer.phone_e164 is null or not v_client_consented then return new; end if;
  v_morning := ((v_start at time zone v_org.timezone)::date + v_settings.morning_local_time) at time zone v_org.timezone;
  v_t180 := v_start - interval '180 minutes';
  v_t45 := v_start - make_interval(mins => v_settings.t45_offset_minutes);
  if v_settings.reminder_morning_enabled then
    insert into public.whatsapp_automation_jobs (organization_id, connection_id, appointment_id, appointment_version, job_type, recipient_e164, payload, scheduled_for, next_attempt_at, valid_until, status, dedupe_key)
    values (new.organization_id, v_connection.id, new.id, new.version, 'REMINDER_MORNING_CLIENT', v_customer.phone_e164, v_payload, v_morning, v_morning, v_start, case when v_morning <= now() or v_morning >= v_start then 'SKIPPED'::public.whatsapp_v2_job_status else 'PENDING'::public.whatsapp_v2_job_status end, 'v2:' || new.id || ':v' || new.version || ':morning:client') on conflict (organization_id, dedupe_key) do nothing;
  end if;
  if v_settings.reminder_t180_enabled then
    insert into public.whatsapp_automation_jobs (organization_id, connection_id, appointment_id, appointment_version, job_type, recipient_e164, payload, scheduled_for, next_attempt_at, valid_until, status, dedupe_key)
    values (new.organization_id, v_connection.id, new.id, new.version, 'REMINDER_T180_CLIENT', v_customer.phone_e164, v_payload, v_t180, v_t180, v_start, case when v_t180 <= now() then 'SKIPPED'::public.whatsapp_v2_job_status else 'PENDING'::public.whatsapp_v2_job_status end, 'v2:' || new.id || ':v' || new.version || ':t180:client') on conflict (organization_id, dedupe_key) do nothing;
  end if;
  if v_settings.reminder_t45_enabled then
    insert into public.whatsapp_automation_jobs (organization_id, connection_id, appointment_id, appointment_version, job_type, recipient_e164, payload, scheduled_for, next_attempt_at, valid_until, status, dedupe_key)
    values (new.organization_id, v_connection.id, new.id, new.version, 'REMINDER_T45_CLIENT', v_customer.phone_e164, v_payload, v_t45, v_t45, v_start, case when v_t45 <= now() then 'SKIPPED'::public.whatsapp_v2_job_status else 'PENDING'::public.whatsapp_v2_job_status end, 'v2:' || new.id || ':v' || new.version || ':t45:client') on conflict (organization_id, dedupe_key) do nothing;
  end if;
  return new;
end;
$$;

create or replace function public.create_whatsapp_v2_confirmation_request(p_job_id uuid, p_worker_id text)
returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v_job public.whatsapp_automation_jobs%rowtype; v_phase public.whatsapp_confirmation_phase;
  v_code text; v_token text; v_id uuid;
begin
  perform public.require_service_role();
  select * into v_job from public.whatsapp_automation_jobs where id = p_job_id for update;
  if not found or v_job.status <> 'PROCESSING' or v_job.locked_by <> p_worker_id then raise exception using errcode = '22023', message = 'job not claimed'; end if;
  if v_job.confirmation_request_id is not null and nullif(v_job.payload ->> 'short_code', '') is not null then
    return jsonb_build_object('request_id', v_job.confirmation_request_id, 'short_code', v_job.payload ->> 'short_code', 'phase', case v_job.job_type when 'REMINDER_MORNING_CLIENT' then 'MORNING' when 'REMINDER_T180_CLIENT' then 'T180' else 'T45' end);
  end if;
  v_phase := case v_job.job_type when 'REMINDER_MORNING_CLIENT' then 'MORNING' when 'REMINDER_T180_CLIENT' then 'T180' else 'T45' end;
  if v_phase in ('T180', 'T45') then
    update public.whatsapp_confirmation_requests_v2 set status = 'SUPERSEDED', updated_at = now()
    where appointment_id = v_job.appointment_id and appointment_version = v_job.appointment_version and status = 'PENDING';
  end if;
  v_code := upper(substr(encode(gen_random_bytes(8), 'hex'), 1, 6));
  v_token := rtrim(translate(encode(gen_random_bytes(32), 'base64'), '+/', '-_'), '=');
  insert into public.whatsapp_confirmation_requests_v2 (organization_id, connection_id, appointment_id, appointment_version, job_id, phase, opaque_token_hash, short_code_hash, expires_at)
  values (v_job.organization_id, v_job.connection_id, v_job.appointment_id, v_job.appointment_version, v_job.id, v_phase, encode(digest(v_token, 'sha256'), 'hex'), encode(digest(v_code, 'sha256'), 'hex'), v_job.valid_until) returning id into v_id;
  update public.whatsapp_automation_jobs set confirmation_request_id = v_id, payload = payload || jsonb_build_object('short_code', v_code, 'opaque_token', v_token), updated_at = now() where id = v_job.id;
  return jsonb_build_object('request_id', v_id, 'short_code', v_code, 'opaque_token', v_token, 'phase', v_phase);
end;
$$;

revoke all on function public.save_whatsapp_v2_automation_controls(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.save_whatsapp_v2_automation_controls(uuid, jsonb, jsonb), public.get_whatsapp_connection_status(uuid) to authenticated;
revoke all on function public.save_whatsapp_v2_automation_controls(uuid, jsonb, jsonb) from public, anon, service_role;
grant execute on function public.create_whatsapp_v2_confirmation_request(uuid, text) to service_role;
revoke all on function public.create_whatsapp_v2_confirmation_request(uuid, text) from public, anon, authenticated;
notify pgrst, 'reload schema';
