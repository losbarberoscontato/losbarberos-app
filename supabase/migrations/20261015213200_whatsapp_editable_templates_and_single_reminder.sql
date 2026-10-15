alter table public.whatsapp_automation_settings_v2
  add column if not exists reminder_t24_enabled boolean not null default false;

-- Keep the most precise existing reminder when older rows have multiple flags.
-- Previously the UI allowed the morning and T45 notices to be active together.
alter table public.whatsapp_automation_settings_v2
  alter column reminder_morning_enabled set default false;

update public.whatsapp_automation_settings_v2
set reminder_t180_enabled = reminder_t180_enabled and not reminder_t45_enabled,
    reminder_morning_enabled = reminder_morning_enabled and not reminder_t45_enabled and not reminder_t180_enabled,
    reminder_t24_enabled = reminder_t24_enabled and not reminder_t45_enabled and not reminder_t180_enabled and not reminder_morning_enabled;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.whatsapp_automation_settings_v2'::regclass
      and conname = 'whatsapp_automation_settings_v2_single_reminder_check'
  ) then
    alter table public.whatsapp_automation_settings_v2
      add constraint whatsapp_automation_settings_v2_single_reminder_check
      check (
        (case when reminder_t24_enabled then 1 else 0 end) +
        (case when reminder_morning_enabled then 1 else 0 end) +
        (case when reminder_t180_enabled then 1 else 0 end) +
        (case when reminder_t45_enabled then 1 else 0 end) <= 1
      );
  end if;
end;
$$;

create or replace function public.whatsapp_v2_default_message_templates()
returns jsonb
language sql
immutable
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'BOOKING_CREATED_CLIENT', '{cliente}, seu agendamento foi confirmado para {horario}.',
    'BOOKING_CREATED_STAFF', 'Novo agendamento: {cliente}, {horario}.',
    'REMINDER_T24_CLIENT', E'Lembrete: seu atendimento está marcado para {horario} (daqui a 24 horas).\n\nResponda somente com um número:\n1 — Confirmar\n2 — Cancelar\n3 — Falar com atendente',
    'REMINDER_MORNING_CLIENT', E'Lembrete: seu atendimento é {horario}.\n\nResponda somente com um número:\n1 — Confirmar\n2 — Cancelar\n3 — Falar com atendente',
    'REMINDER_T180_CLIENT', E'Lembrete: seu atendimento está marcado para {horario}.\n\nResponda somente com um número:\n1 — Confirmar\n2 — Cancelar\n3 — Falar com atendente',
    'REMINDER_T45_CLIENT', E'Lembrete: seu atendimento está marcado para {horario}.\n\nResponda somente com um número:\n1 — Confirmar\n2 — Cancelar\n3 — Falar com atendente',
    'CONFIRMATION_ACK_CLIENT', 'Presença confirmada. Até {horario}.',
    'CANCELLATION_ACK_CLIENT', 'Cancelamento confirmado. Se precisar, fale com o estabelecimento para novo horário.',
    'APPOINTMENT_CONFIRMED_STAFF', '{cliente} confirmou presença pelo WhatsApp para {horario}.',
    'APPOINTMENT_CANCELED_STAFF', '{cliente} cancelou pelo WhatsApp.',
    'INVALID_REPLY_PROMPT', E'Não entendi sua resposta.\n\nResponda somente com um número:\n1 — Confirmar\n2 — Cancelar\n3 — Falar com atendente',
    'ATTENDANT_REQUEST_MANAGER', E'Cliente deseja falar com atendente.\n\nCliente: {cliente}\nWhatsApp: {telefone}\nData e hora: {horario}\nProfissional: {barbeiro}\nServiço: {servico}',
    'MANUAL_CONFIRMATION_CLIENT', '{cliente}, seu agendamento foi confirmado pelo estabelecimento para {horario}.',
    'MANUAL_CONFIRMATION_STAFF', 'Agendamento confirmado manualmente: {cliente}, {horario}.',
    'RESERVATION_CHOICE', E'Encontrei mais de um agendamento. Responda com o número correspondente:\n\n{reservas}'
  );
$$;

revoke all on function public.whatsapp_v2_default_message_templates() from public, anon, authenticated;

update public.whatsapp_automation_settings_v2 s
set templates = jsonb_set(
  jsonb_set(
    public.whatsapp_v2_default_message_templates() || coalesce(s.templates, '{}'::jsonb),
    '{REMINDER_T180_CLIENT}',
    case when coalesce(s.templates ->> 'REMINDER_T180_CLIENT', '') like '%começa em 3 horas%'
      then public.whatsapp_v2_default_message_templates() -> 'REMINDER_T180_CLIENT'
      else coalesce(s.templates -> 'REMINDER_T180_CLIENT', public.whatsapp_v2_default_message_templates() -> 'REMINDER_T180_CLIENT') end,
    true
  ),
  '{REMINDER_T45_CLIENT}',
  case when coalesce(s.templates ->> 'REMINDER_T45_CLIENT', '') like '%começa em 45 minutos%'
    then public.whatsapp_v2_default_message_templates() -> 'REMINDER_T45_CLIENT'
    else coalesce(s.templates -> 'REMINDER_T45_CLIENT', public.whatsapp_v2_default_message_templates() -> 'REMINDER_T45_CLIENT') end,
  true
);

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
  v_t24 boolean;
  v_morning boolean;
  v_t180 boolean;
  v_t45 boolean;
  v_existing_templates jsonb;
  v_input_templates jsonb;
  v_templates jsonb;
  v_reminder_count integer;
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
    select 1 from jsonb_array_elements(p_custom_messages) item
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

  v_input_templates := coalesce(p_rules -> 'message_templates', '{}'::jsonb);
  if jsonb_typeof(v_input_templates) <> 'object' then
    raise exception using errcode = '22023', message = 'invalid message templates';
  end if;
  if exists (
    select 1 from jsonb_each(v_input_templates) entry
    where entry.key not in (
      'BOOKING_CREATED_CLIENT', 'BOOKING_CREATED_STAFF', 'REMINDER_T24_CLIENT',
      'REMINDER_MORNING_CLIENT', 'REMINDER_T180_CLIENT', 'REMINDER_T45_CLIENT',
      'CONFIRMATION_ACK_CLIENT', 'CANCELLATION_ACK_CLIENT',
      'APPOINTMENT_CONFIRMED_STAFF', 'APPOINTMENT_CANCELED_STAFF',
      'INVALID_REPLY_PROMPT', 'ATTENDANT_REQUEST_MANAGER',
      'MANUAL_CONFIRMATION_CLIENT', 'MANUAL_CONFIRMATION_STAFF', 'RESERVATION_CHOICE'
    ) or jsonb_typeof(entry.value) <> 'string'
      or char_length(btrim(entry.value #>> '{}')) = 0
      or char_length(entry.value #>> '{}') > 4096
  ) then
    raise exception using errcode = '22023', message = 'invalid message templates';
  end if;

  v_booking_client := coalesce((p_rules ->> 'booking_client_enabled')::boolean, true);
  v_booking_staff := coalesce((p_rules ->> 'booking_staff_enabled')::boolean, true);
  v_t24 := coalesce((p_rules ->> 'reminder_t24_enabled')::boolean, false);
  v_morning := coalesce((p_rules ->> 'reminder_morning_enabled')::boolean, false);
  v_t180 := coalesce((p_rules ->> 'reminder_t180_enabled')::boolean, false);
  v_t45 := coalesce((p_rules ->> 'reminder_t45_enabled')::boolean, true);
  v_reminder_count :=
    (case when v_t24 then 1 else 0 end) +
    (case when v_morning then 1 else 0 end) +
    (case when v_t180 then 1 else 0 end) +
    (case when v_t45 then 1 else 0 end);
  if v_reminder_count > 1 then
    raise exception using errcode = '22023', message = 'only one presence reminder may be active';
  end if;

  select templates into v_existing_templates
  from public.whatsapp_automation_settings_v2
  where organization_id = p_organization_id
  for update;
  v_templates := public.whatsapp_v2_default_message_templates()
    || coalesce(v_existing_templates, '{}'::jsonb)
    || v_input_templates;

  insert into public.whatsapp_automation_settings_v2 (
    organization_id, booking_client_enabled, booking_staff_enabled,
    reminder_t24_enabled, reminder_morning_enabled, reminder_t180_enabled,
    reminder_t45_enabled, templates
  ) values (
    p_organization_id, v_booking_client, v_booking_staff,
    v_t24, v_morning, v_t180, v_t45, v_templates
  ) on conflict (organization_id) do update set
    booking_client_enabled = excluded.booking_client_enabled,
    booking_staff_enabled = excluded.booking_staff_enabled,
    reminder_t24_enabled = excluded.reminder_t24_enabled,
    reminder_morning_enabled = excluded.reminder_morning_enabled,
    reminder_t180_enabled = excluded.reminder_t180_enabled,
    reminder_t45_enabled = excluded.reminder_t45_enabled,
    templates = excluded.templates,
    updated_at = now();

  insert into public.whatsapp_custom_message_settings_v2 (organization_id, message_key, enabled, body)
  select p_organization_id, item ->> 'key', (item ->> 'enabled')::boolean, item ->> 'body'
  from jsonb_array_elements(p_custom_messages) item
  on conflict (organization_id, message_key) do update set
    enabled = excluded.enabled, body = excluded.body, updated_at = now();

  update public.whatsapp_automation_jobs
  set status = 'CANCELED', last_error_code = 'AUTOMATION_DISABLED',
      last_error_detail = 'Canceled because its automation was disabled before dispatch.', updated_at = now()
  where organization_id = p_organization_id and status in ('PENDING', 'RETRY') and (
    (job_type = 'BOOKING_CREATED_CLIENT' and not v_booking_client)
    or (job_type = 'BOOKING_CREATED_STAFF' and not v_booking_staff)
    or (job_type = 'REMINDER_T24_CLIENT' and not v_t24)
    or (job_type = 'REMINDER_MORNING_CLIENT' and not v_morning)
    or (job_type = 'REMINDER_T180_CLIENT' and not v_t180)
    or (job_type = 'REMINDER_T45_CLIENT' and not v_t45)
  );

  update public.whatsapp_automation_jobs
  set payload = coalesce(payload, '{}'::jsonb) || jsonb_build_object('templates', v_templates), updated_at = now()
  where organization_id = p_organization_id and status in ('PENDING', 'RETRY');

  return jsonb_build_object(
    'rules', jsonb_build_object(
      'booking_client_enabled', v_booking_client, 'booking_staff_enabled', v_booking_staff,
      'reminder_t24_enabled', v_t24, 'reminder_morning_enabled', v_morning,
      'reminder_t180_enabled', v_t180, 'reminder_t45_enabled', v_t45,
      'message_templates', v_templates
    ),
    'custom_messages', coalesce((
      select jsonb_agg(jsonb_build_object('key', message_key, 'enabled', enabled, 'body', body) order by message_key)
      from public.whatsapp_custom_message_settings_v2 where organization_id = p_organization_id
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.save_whatsapp_v2_automation_controls(uuid, jsonb, jsonb) from public, anon, service_role;
grant execute on function public.save_whatsapp_v2_automation_controls(uuid, jsonb, jsonb) to authenticated;

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
      'reminder_t24_enabled', a.reminder_t24_enabled,
      'reminder_morning_enabled', a.reminder_morning_enabled,
      'reminder_t180_enabled', a.reminder_t180_enabled,
      'reminder_t45_enabled', a.reminder_t45_enabled,
      'message_templates', public.whatsapp_v2_default_message_templates() || a.templates,
      'custom_messages', coalesce((select jsonb_agg(jsonb_build_object('key', m.message_key, 'enabled', m.enabled, 'body', m.body) order by m.message_key) from public.whatsapp_custom_message_settings_v2 m where m.organization_id = a.organization_id), '[]'::jsonb)
    ) from public.whatsapp_automation_settings_v2 a where a.organization_id = p_organization_id), jsonb_build_object(
      'booking_client_enabled', true, 'booking_staff_enabled', true,
      'reminder_t24_enabled', false, 'reminder_morning_enabled', false,
      'reminder_t180_enabled', false, 'reminder_t45_enabled', true,
      'message_templates', public.whatsapp_v2_default_message_templates(),
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
  v_client_consented := public.whatsapp_v2_consented(new.organization_id, new.customer_id);
  v_start := lower(new.service_period);
  v_payload := jsonb_build_object(
    'customer_name', v_customer.full_name, 'barber_name', v_barber.display_name,
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
    if j.job_type::text like 'REMINDER_%' or j.job_type::text like 'BOOKING_CREATED_%' then
      if a.id is null or a.version is distinct from j.appointment_version or a.status <> 'CONFIRMED' or lower(a.service_period) <= now() then
        reason := 'APPOINTMENT_CHANGED';
      end if;
    end if;
    if j.job_type::text like '%_CLIENT' or j.payload ->> 'message_kind' = 'MANUAL_CONFIRMATION_CLIENT' then
      if not public.whatsapp_v2_consented(j.organization_id, a.customer_id) then reason := 'TRANSACTIONAL_REVOKED'; end if;
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

create or replace function public.create_whatsapp_v2_confirmation_request(p_job_id uuid, p_worker_id text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_job public.whatsapp_automation_jobs%rowtype;
  v_phase public.whatsapp_confirmation_phase;
  v_code text;
  v_token text;
  v_id uuid;
begin
  perform public.require_service_role();
  select * into v_job from public.whatsapp_automation_jobs where id = p_job_id for update;
  if not found or v_job.status <> 'PROCESSING' or v_job.locked_by <> p_worker_id then
    raise exception using errcode = '22023', message = 'job not claimed';
  end if;
  if v_job.confirmation_request_id is not null and nullif(v_job.payload ->> 'short_code', '') is not null then
    return jsonb_build_object(
      'request_id', v_job.confirmation_request_id, 'short_code', v_job.payload ->> 'short_code',
      'phase', case v_job.job_type when 'REMINDER_T24_CLIENT' then 'T24' when 'REMINDER_MORNING_CLIENT' then 'MORNING' when 'REMINDER_T180_CLIENT' then 'T180' else 'T45' end
    );
  end if;
  v_phase := case v_job.job_type when 'REMINDER_T24_CLIENT' then 'T24' when 'REMINDER_MORNING_CLIENT' then 'MORNING' when 'REMINDER_T180_CLIENT' then 'T180' else 'T45' end;
  if v_phase <> 'MORNING' then
    update public.whatsapp_confirmation_requests_v2 set status = 'SUPERSEDED', updated_at = now()
    where appointment_id = v_job.appointment_id and appointment_version = v_job.appointment_version and status = 'PENDING';
  end if;
  v_code := upper(substr(encode(gen_random_bytes(8), 'hex'), 1, 6));
  v_token := rtrim(translate(encode(gen_random_bytes(32), 'base64'), '+/', '-_'), '=');
  insert into public.whatsapp_confirmation_requests_v2 (
    organization_id, connection_id, appointment_id, appointment_version, job_id, phase,
    opaque_token_hash, short_code_hash, expires_at
  ) values (
    v_job.organization_id, v_job.connection_id, v_job.appointment_id, v_job.appointment_version,
    v_job.id, v_phase, encode(digest(v_token, 'sha256'), 'hex'), encode(digest(v_code, 'sha256'), 'hex'), v_job.valid_until
  ) returning id into v_id;
  update public.whatsapp_automation_jobs set confirmation_request_id = v_id,
    payload = payload || jsonb_build_object('short_code', v_code, 'opaque_token', v_token), updated_at = now()
  where id = v_job.id;
  return jsonb_build_object('request_id', v_id, 'short_code', v_code, 'opaque_token', v_token, 'phase', v_phase);
end;
$$;

create or replace function public.whatsapp_runtime_apply_request(
  p_gateway_instance_id text,
  p_sender_e164 text,
  p_external_message_id text,
  p_action text,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_connection public.whatsapp_business_connections%rowtype;
  v_request public.whatsapp_confirmation_requests_v2%rowtype;
  v_appointment public.appointments%rowtype;
  v_invalid_count smallint;
  v_action text := upper(btrim(p_action));
  v_service_names text;
  v_manager_phone text;
  v_templates jsonb;
  v_customer_name text;
  v_barber_name text;
  v_timezone text;
begin
  perform public.require_service_role();
  select * into v_connection from public.whatsapp_business_connections
  where provider = 'QR_WEB' and gateway_instance_id = p_gateway_instance_id and is_active and status = 'CONNECTED'
  for update;
  if not found then return jsonb_build_object('processed', false, 'reason', 'UNKNOWN_CONNECTION'); end if;

  select r.* into v_request from public.whatsapp_confirmation_requests_v2 r
  join public.appointments a on a.id = r.appointment_id and a.organization_id = r.organization_id
  join public.customers c on c.id = a.customer_id and c.organization_id = a.organization_id
  where r.id = p_request_id and r.connection_id = v_connection.id and r.status = 'PENDING' and r.expires_at > now()
    and a.version = r.appointment_version and a.status = 'CONFIRMED' and lower(a.service_period) > now()
    and public.whatsapp_v2_consented(a.organization_id, c.id)
    and public.whatsapp_v2_phone_matches(c.phone_e164, p_sender_e164)
  for update of r;
  if v_request.id is null then return jsonb_build_object('processed', false, 'reason', 'NO_ACTIVE_REQUEST'); end if;
  select * into v_appointment from public.appointments
  where id = v_request.appointment_id and organization_id = v_request.organization_id for update;

  select coalesce(s.templates, public.whatsapp_v2_default_message_templates()), s.manager_notification_phone_e164
  into v_templates, v_manager_phone from public.whatsapp_automation_settings_v2 s
  where s.organization_id = v_appointment.organization_id;
  v_templates := coalesce(v_templates, public.whatsapp_v2_default_message_templates());
  select full_name into v_customer_name from public.customers
  where id = v_appointment.customer_id and organization_id = v_appointment.organization_id;
  select display_name into v_barber_name from public.barbers
  where id = v_appointment.barber_id and organization_id = v_appointment.organization_id;
  select timezone into v_timezone from public.organizations where id = v_appointment.organization_id;

  if v_action = 'INVALID' then
    update public.whatsapp_confirmation_requests_v2 set invalid_reply_count = invalid_reply_count + 1, updated_at = now()
    where id = v_request.id returning invalid_reply_count into v_invalid_count;
    if v_invalid_count <= 2 then
      insert into public.whatsapp_automation_jobs (
        organization_id, connection_id, appointment_id, appointment_version, confirmation_request_id,
        job_type, recipient_e164, payload, valid_until, dedupe_key
      ) values (
        v_appointment.organization_id, v_connection.id, v_appointment.id, v_appointment.version, v_request.id,
        'MANUAL_OUTBOUND_TEXT', p_sender_e164,
        jsonb_build_object('message_kind', 'INVALID_REPLY_PROMPT', 'customer_name', v_customer_name,
          'barber_name', v_barber_name, 'starts_at', lower(v_appointment.service_period),
          'timezone', v_timezone, 'templates', v_templates),
        lower(v_appointment.service_period), 'v2:' || v_request.id || ':invalid:' || v_invalid_count
      ) on conflict (organization_id, dedupe_key) do nothing;
      return jsonb_build_object('processed', true, 'action', 'INVALID_PROMPT', 'attempt', v_invalid_count);
    end if;
    v_action := 'ATTENDANT';
  end if;

  if v_action = 'ATTENDANT' then
    if v_manager_phone is null then return jsonb_build_object('processed', false, 'reason', 'MANAGER_NOTIFICATION_PHONE_UNAVAILABLE'); end if;
    select coalesce(string_agg(ai.service_name_snapshot, ', ' order by ai.position), 'Serviço não informado')
    into v_service_names from public.appointment_items ai
    where ai.appointment_id = v_appointment.id and ai.organization_id = v_appointment.organization_id;
    update public.whatsapp_confirmation_requests_v2
    set status = 'EXPIRED', responded_at = now(), response_message_id = p_external_message_id,
      response_action = 'ATTENDANT', updated_at = now()
    where id = v_request.id;
    update public.appointments set whatsapp_response_status = 'CONTACT_REQUESTED_BY_WHATSAPP', updated_at = now()
    where id = v_appointment.id and organization_id = v_appointment.organization_id;
    insert into public.appointment_status_events (organization_id, appointment_id, from_status, to_status, reason, metadata)
    values (v_appointment.organization_id, v_appointment.id, v_appointment.status, v_appointment.status,
      'whatsapp_contact_requested', jsonb_build_object('confirmation_request_id', v_request.id, 'phase', v_request.phase));
    insert into public.whatsapp_automation_jobs (
      organization_id, connection_id, appointment_id, appointment_version, confirmation_request_id,
      job_type, recipient_e164, payload, valid_until, dedupe_key
    ) values (
      v_appointment.organization_id, v_connection.id, v_appointment.id, v_appointment.version, v_request.id,
      'MANUAL_OUTBOUND_TEXT', v_manager_phone,
      jsonb_build_object('message_kind', 'ATTENDANT_REQUEST_MANAGER', 'customer_name', v_customer_name,
        'customer_phone', p_sender_e164, 'barber_name', v_barber_name, 'service_names', v_service_names,
        'starts_at', lower(v_appointment.service_period), 'timezone', v_timezone, 'templates', v_templates),
      lower(v_appointment.service_period), 'v2:' || v_request.id || ':attendant'
    ) on conflict (organization_id, dedupe_key) do nothing;
    return jsonb_build_object('processed', true, 'action', 'ATTENDANT', 'request_id', v_request.id);
  end if;

  if v_action not in ('CONFIRM', 'CANCEL') then return jsonb_build_object('processed', false, 'reason', 'UNSUPPORTED_ACTION'); end if;
  update public.whatsapp_confirmation_requests_v2
  set status = case when v_action = 'CONFIRM' then 'CONFIRMED'::public.whatsapp_confirmation_status else 'CANCELED'::public.whatsapp_confirmation_status end,
    responded_at = now(), response_message_id = p_external_message_id, response_action = v_action, updated_at = now()
  where id = v_request.id;
  if v_action = 'CONFIRM' then
    update public.appointments set whatsapp_presence_status = 'CONFIRMED',
      whatsapp_presence_confirmed_at = coalesce(whatsapp_presence_confirmed_at, now()),
      whatsapp_response_status = 'CONFIRMED_BY_WHATSAPP', updated_at = now()
    where id = v_appointment.id and organization_id = v_appointment.organization_id;
    insert into public.appointment_status_events (organization_id, appointment_id, from_status, to_status, reason, metadata)
    values (v_appointment.organization_id, v_appointment.id, 'CONFIRMED', 'CONFIRMED', 'whatsapp_presence_confirmed',
      jsonb_build_object('confirmation_request_id', v_request.id, 'phase', v_request.phase, 'whatsapp_response_status', 'CONFIRMED_BY_WHATSAPP'));
    insert into public.whatsapp_automation_jobs (
      organization_id, connection_id, appointment_id, appointment_version, job_type, recipient_e164, payload, valid_until, dedupe_key
    ) values (
      v_appointment.organization_id, v_connection.id, v_appointment.id, v_appointment.version,
      'CONFIRMATION_ACK_CLIENT', p_sender_e164,
      jsonb_build_object('customer_name', v_customer_name, 'barber_name', v_barber_name,
        'starts_at', lower(v_appointment.service_period), 'timezone', v_timezone, 'templates', v_templates),
      lower(v_appointment.service_period), 'v2:' || v_request.id || ':confirm:ack'
    ) on conflict (organization_id, dedupe_key) do nothing;
    insert into public.whatsapp_automation_jobs (
      organization_id, connection_id, appointment_id, appointment_version, job_type, recipient_e164, payload, valid_until, dedupe_key
    )
    select v_appointment.organization_id, v_connection.id, v_appointment.id, v_appointment.version,
      'APPOINTMENT_CONFIRMED_STAFF', b.whatsapp_e164,
      jsonb_build_object('customer_name', v_customer_name, 'barber_name', v_barber_name,
        'starts_at', lower(v_appointment.service_period), 'timezone', v_timezone, 'templates', v_templates),
      lower(v_appointment.service_period), 'v2:' || v_request.id || ':confirm:staff'
    from public.barbers b where b.id = v_appointment.barber_id and b.organization_id = v_appointment.organization_id
      and b.whatsapp_e164 is not null
    on conflict (organization_id, dedupe_key) do nothing;
  else
    perform public.cancel_appointment(v_appointment.id, 'Cancelado pelo cliente via WhatsApp', true);
    update public.appointments set cancellation_source = 'WHATSAPP_CLIENT', cancelled_at = now(),
      whatsapp_response_status = 'CANCELED_BY_WHATSAPP'
    where id = v_appointment.id and organization_id = v_appointment.organization_id;
    insert into public.appointment_status_events (organization_id, appointment_id, from_status, to_status, reason, metadata)
    values (v_appointment.organization_id, v_appointment.id, 'CANCELED', 'CANCELED', 'whatsapp_canceled',
      jsonb_build_object('confirmation_request_id', v_request.id, 'phase', v_request.phase, 'whatsapp_response_status', 'CANCELED_BY_WHATSAPP'));
    insert into public.whatsapp_automation_jobs (
      organization_id, connection_id, appointment_id, appointment_version, job_type, recipient_e164, payload, dedupe_key
    ) values (
      v_appointment.organization_id, v_connection.id, v_appointment.id, v_appointment.version,
      'CANCELLATION_ACK_CLIENT', p_sender_e164,
      jsonb_build_object('customer_name', v_customer_name, 'barber_name', v_barber_name,
        'starts_at', lower(v_appointment.service_period), 'timezone', v_timezone, 'templates', v_templates),
      'v2:' || v_request.id || ':cancel:ack'
    ) on conflict (organization_id, dedupe_key) do nothing;
    insert into public.whatsapp_automation_jobs (
      organization_id, connection_id, appointment_id, appointment_version, job_type, recipient_e164, payload, dedupe_key
    )
    select v_appointment.organization_id, v_connection.id, v_appointment.id, v_appointment.version,
      'APPOINTMENT_CANCELED_STAFF', b.whatsapp_e164,
      jsonb_build_object('customer_name', v_customer_name, 'barber_name', v_barber_name,
        'starts_at', lower(v_appointment.service_period), 'timezone', v_timezone, 'templates', v_templates),
      'v2:' || v_request.id || ':cancel:staff'
    from public.barbers b where b.id = v_appointment.barber_id and b.organization_id = v_appointment.organization_id
      and b.whatsapp_e164 is not null
    on conflict (organization_id, dedupe_key) do nothing;
  end if;
  return jsonb_build_object('processed', true, 'appointment_id', v_appointment.id, 'action', v_action, 'request_id', v_request.id);
end;
$$;

create or replace function public.whatsapp_runtime_process_event(p_event_id uuid, p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  e public.whatsapp_webhook_events_v2%rowtype;
  ids uuid[];
  selected uuid;
  action text;
  input text;
  sender text;
  prompt text;
  v_templates jsonb;
  choice public.whatsapp_reply_choices%rowtype;
  result jsonb;
begin
  perform public.require_service_role();
  select * into e from public.whatsapp_webhook_events_v2 where id = p_event_id for update;
  if e.id is null or e.processing_status <> 'PROCESSING' or e.lease_token is distinct from p_token or e.lock_expires_at <= now() then
    raise exception 'STALE_LEASE';
  end if;
  perform 1 from public.whatsapp_business_connections where id = e.connection_id for update;
  if e.payload ->> 'receipt' is not null then
    perform public.whatsapp_runtime_receipt(e.connection_id, e.provider_event_id, e.payload ->> 'receipt');
  elsif e.payload ->> 'text' is not null and e.payload ->> 'sender_e164' is not null and not coalesce((e.payload ->> 'from_me')::boolean, false) then
    sender := e.payload ->> 'sender_e164';
    input := btrim(e.payload ->> 'text');
    perform public.record_whatsapp_v2_inbound_message(e.connection_id, sender, e.provider_event_id, input);
    select array_agg(r.id order by lower(a.service_period), r.id) into ids
    from public.whatsapp_confirmation_requests_v2 r
    join public.appointments a on a.id = r.appointment_id and a.organization_id = r.organization_id
    join public.customers c on c.id = a.customer_id and c.organization_id = a.organization_id
    where r.connection_id = e.connection_id and r.organization_id = e.organization_id and r.status = 'PENDING' and r.expires_at > now()
      and a.status = 'CONFIRMED' and a.version = r.appointment_version and lower(a.service_period) > now()
      and public.whatsapp_v2_phone_matches(c.phone_e164, sender) and public.whatsapp_v2_consented(a.organization_id, c.id);
    action := case input when '1' then 'CONFIRM' when '2' then 'CANCEL' when '3' then 'ATTENDANT' else 'INVALID' end;
    if e.payload ->> 'quoted_id' is not null then
      select id into selected from public.whatsapp_confirmation_requests_v2 where id = any(ids) and provider_message_id = e.payload ->> 'quoted_id';
    elsif input ~* '^RESERVA [0-9]{1,2}$' then
      select * into choice from public.whatsapp_reply_choices where connection_id = e.connection_id and phone_e164 = sender and expires_at > now() for update;
      selected := choice.request_ids[split_part(input, ' ', 2)::integer];
      action := choice.action;
      if selected is not null and not selected = any(ids) then selected := null; end if;
    elsif cardinality(ids) = 1 then selected := ids[1]; end if;
    if selected is not null then
      result := public.whatsapp_runtime_apply_request(e.payload ->> 'gateway_instance_id', sender, e.provider_event_id, action, selected);
      delete from public.whatsapp_reply_choices where connection_id = e.connection_id and phone_e164 = sender;
    elsif cardinality(ids) > 1 and action in ('CONFIRM', 'CANCEL', 'ATTENDANT') then
      ids := ids[1:20];
      insert into public.whatsapp_reply_choices (organization_id, connection_id, phone_e164, request_ids, action, expires_at)
      values (e.organization_id, e.connection_id, sender, ids, action, now() + interval '5 minutes')
      on conflict (connection_id, phone_e164) do update set request_ids = excluded.request_ids, action = excluded.action, expires_at = excluded.expires_at;
      select 'Qual reserva? Responda RESERVA e o número abaixo.' || chr(10) ||
        string_agg(u.ordinality || ' — ' || to_char(lower(a.service_period) at time zone o.timezone, 'DD/MM HH24:MI'), chr(10) order by u.ordinality)
      into prompt from unnest(ids) with ordinality u(id, ordinality)
      join public.whatsapp_confirmation_requests_v2 r on r.id = u.id
      join public.appointments a on a.id = r.appointment_id and a.organization_id = r.organization_id
      join public.organizations o on o.id = a.organization_id;
      select coalesce(s.templates, public.whatsapp_v2_default_message_templates()) into v_templates
      from public.whatsapp_automation_settings_v2 s where s.organization_id = e.organization_id;
      v_templates := coalesce(v_templates, public.whatsapp_v2_default_message_templates());
      insert into public.whatsapp_automation_jobs (organization_id, connection_id, job_type, recipient_e164, payload, valid_until, dedupe_key)
      values (e.organization_id, e.connection_id, 'MANUAL_OUTBOUND_TEXT', sender,
        jsonb_build_object('message_kind', 'RESERVATION_CHOICE', 'body', prompt, 'templates', v_templates),
        now() + interval '5 minutes', 'choice:' || e.id)
      on conflict do nothing;
      result := jsonb_build_object('processed', true, 'action', 'CHOICE_REQUIRED');
    else result := jsonb_build_object('processed', false, 'reason', 'NO_UNAMBIGUOUS_REQUEST'); end if;
  end if;
  perform public.whatsapp_runtime_event_finish(e.id, p_token, null);
  return coalesce(result, jsonb_build_object('processed', true));
end;
$$;

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
  v_templates jsonb;
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
  if v_customer.phone_e164 is null then raise exception using errcode = '22023', message = 'customer WhatsApp is required'; end if;
  if v_barber.whatsapp_e164 is null then raise exception using errcode = '22023', message = 'barber WhatsApp is required'; end if;
  if not public.whatsapp_v2_consented(v_appointment.organization_id, v_customer.id) then
    raise exception using errcode = '42501', message = 'customer WhatsApp transactional consent is required';
  end if;

  select * into v_connection from public.whatsapp_business_connections
  where organization_id = v_appointment.organization_id and provider = 'QR_WEB' and is_active and status = 'CONNECTED'
  order by updated_at desc limit 1 for update;
  if not found then raise exception using errcode = 'P0002', message = 'active WhatsApp QR connection not found'; end if;
  select * into v_settings from public.whatsapp_automation_settings_v2
  where organization_id = v_appointment.organization_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'WhatsApp automation settings not found'; end if;
  if v_settings.mode <> 'ACTIVE' then raise exception using errcode = '22023', message = 'WhatsApp automation is not active'; end if;
  if v_settings.dispatch_paused then raise exception using errcode = '22023', message = 'WhatsApp dispatch is paused'; end if;
  select timezone into strict v_timezone from public.organizations where id = v_appointment.organization_id;
  v_templates := public.whatsapp_v2_default_message_templates() || v_settings.templates;

  update public.whatsapp_confirmation_requests_v2
  set status = 'EXPIRED', updated_at = now()
  where appointment_id = v_appointment.id and organization_id = v_appointment.organization_id and status = 'PENDING';
  update public.whatsapp_automation_jobs
  set status = 'CANCELED', last_error_code = 'MANUAL_CONFIRMATION_SUPERSEDED_REMINDER', updated_at = now()
  where appointment_id = v_appointment.id and organization_id = v_appointment.organization_id
    and status in ('PENDING', 'RETRY')
    and job_type in ('REMINDER_T24_CLIENT', 'REMINDER_MORNING_CLIENT', 'REMINDER_T180_CLIENT', 'REMINDER_T45_CLIENT');
  update public.appointments set whatsapp_response_status = 'CONFIRMED_MANUALLY', updated_at = now()
  where id = v_appointment.id and organization_id = v_appointment.organization_id;
  insert into public.appointment_status_events
    (organization_id, appointment_id, from_status, to_status, reason, actor_user_id, metadata)
  values (v_appointment.organization_id, v_appointment.id, v_appointment.status, v_appointment.status,
    'manual_whatsapp_confirmation_requested', auth.uid(), jsonb_build_object('whatsapp_response_status', 'CONFIRMED_MANUALLY'));
  insert into public.whatsapp_automation_jobs
    (organization_id, connection_id, appointment_id, appointment_version, job_type, recipient_e164, payload, valid_until, dedupe_key)
  values (v_appointment.organization_id, v_connection.id, v_appointment.id, v_appointment.version,
    'MANUAL_OUTBOUND_TEXT', v_customer.phone_e164,
    jsonb_build_object('message_kind', 'MANUAL_CONFIRMATION_CLIENT', 'customer_name', v_customer.full_name,
      'barber_name', v_barber.display_name, 'starts_at', lower(v_appointment.service_period),
      'timezone', v_timezone, 'templates', v_templates),
    lower(v_appointment.service_period), 'v2:' || v_appointment.id || ':v' || v_appointment.version || ':manual-confirm:client')
  on conflict (organization_id, dedupe_key) do nothing;
  insert into public.whatsapp_automation_jobs
    (organization_id, connection_id, appointment_id, appointment_version, job_type, recipient_e164, payload, valid_until, dedupe_key)
  values (v_appointment.organization_id, v_connection.id, v_appointment.id, v_appointment.version,
    'MANUAL_OUTBOUND_TEXT', v_barber.whatsapp_e164,
    jsonb_build_object('message_kind', 'MANUAL_CONFIRMATION_STAFF', 'customer_name', v_customer.full_name,
      'barber_name', v_barber.display_name, 'starts_at', lower(v_appointment.service_period),
      'timezone', v_timezone, 'templates', v_templates),
    lower(v_appointment.service_period), 'v2:' || v_appointment.id || ':v' || v_appointment.version || ':manual-confirm:staff')
  on conflict (organization_id, dedupe_key) do nothing;
  return jsonb_build_object('appointment_id', v_appointment.id, 'whatsapp_response_status', 'CONFIRMED_MANUALLY');
end;
$$;

revoke all on function public.whatsapp_runtime_prepare(uuid, uuid) from public, anon, authenticated;
grant execute on function public.whatsapp_runtime_prepare(uuid, uuid) to service_role;
revoke all on function public.create_whatsapp_v2_confirmation_request(uuid, text) from public, anon, authenticated;
grant execute on function public.create_whatsapp_v2_confirmation_request(uuid, text) to service_role;
revoke all on function public.whatsapp_runtime_apply_request(text, text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.whatsapp_runtime_apply_request(text, text, text, text, uuid) to service_role;
revoke all on function public.whatsapp_runtime_process_event(uuid, uuid) from public, anon, authenticated;
grant execute on function public.whatsapp_runtime_process_event(uuid, uuid) to service_role;
revoke all on function public.confirm_appointment_manually_by_whatsapp(uuid) from public, anon;
grant execute on function public.confirm_appointment_manually_by_whatsapp(uuid) to authenticated;

notify pgrst, 'reload schema';
