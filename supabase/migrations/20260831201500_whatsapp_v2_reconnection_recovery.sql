-- QR reconnection begins a new Evolution delivery epoch. Pending work from an
-- earlier session must never be replayed through a newly connected WhatsApp.

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

  -- A fresh QR connection always resumes the V2 bot. This field is system
  -- lifecycle state, not a user setting; the visible pause remains separate.
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

  -- Never replay an outbound job, pending request, or inbound command from a
  -- prior QR session. Histories and provider receipts remain append-only.
  update public.whatsapp_automation_jobs
  set status = 'CANCELED',
      last_error_code = 'QR_CONNECTION_RESTARTED',
      last_error_detail = 'Canceled before the current QR connection epoch.',
      locked_at = null,
      locked_by = null,
      lock_expires_at = null,
      updated_at = now()
  where organization_id = v_connection.organization_id
    and status in ('PENDING', 'RETRY', 'PROCESSING');

  update public.whatsapp_confirmation_requests_v2
  set status = 'EXPIRED',
      updated_at = now()
  where organization_id = v_connection.organization_id
    and status = 'PENDING';

  update public.whatsapp_webhook_events_v2
  set processing_status = 'DEAD',
      processed_at = now(),
      last_error = 'QR_CONNECTION_RESTARTED',
      locked_at = null,
      locked_by = null,
      lock_expires_at = null
  where organization_id = v_connection.organization_id
    and processing_status in ('RECEIVED', 'FAILED', 'PROCESSING');

  update public.notification_outbox
  set status = case when status = 'SENDING' then 'SEND_UNKNOWN'::public.outbox_status else 'CANCELED'::public.outbox_status end,
      last_error = 'QR_CONNECTION_RESTARTED',
      updated_at = now()
  where organization_id = v_connection.organization_id
    and status in ('PENDING', 'FAILED', 'PROCESSING', 'SENDING');
end;
$$;

-- Existing V2 rows created by the manager-notification RPC inherited `OFF`.
-- There is no manager control for this mode, so a connected active QR is the
-- authoritative activation signal for this backfill.
update public.whatsapp_automation_settings_v2 s
set mode = 'ACTIVE',
    dispatch_paused = false,
    templates = case when s.templates = '{}'::jsonb then jsonb_build_object(
      'BOOKING_CREATED_CLIENT', '{cliente}, seu agendamento foi confirmado para {horario}.',
      'BOOKING_CREATED_STAFF', 'Novo agendamento: {cliente}, {horario}.',
      'REMINDER_MORNING_CLIENT', 'Lembrete: seu atendimento é {horario}.\n\nResponda somente com um número:\n1 — Confirmar\n2 — Cancelar\n3 — Falar com atendente',
      'REMINDER_T45_CLIENT', 'Lembrete: seu atendimento começa em 45 minutos ({horario}).\n\nResponda somente com um número:\n1 — Confirmar\n2 — Cancelar\n3 — Falar com atendente',
      'CONFIRMATION_ACK_CLIENT', 'Presença confirmada. Até {horario}.',
      'CANCELLATION_ACK_CLIENT', 'Cancelamento confirmado. Se precisar, fale com a barbearia para novo horário.',
      'APPOINTMENT_CONFIRMED_STAFF', '{cliente} confirmou presença pelo WhatsApp para {horario}.',
      'APPOINTMENT_CANCELED_STAFF', '{cliente} cancelou pelo WhatsApp.'
    ) else s.templates end,
    updated_at = now()
from public.whatsapp_business_connections c
where c.organization_id = s.organization_id
  and c.provider = 'QR_WEB'
  and c.is_active
  and c.status = 'CONNECTED';

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

  v_restarted := v_status = 'CONNECTED'
    and v_connection.is_active
    and (v_connection.status <> 'CONNECTED' or v_connection.connection_epoch_at is null);
  if v_restarted then v_epoch := now(); end if;

  update public.whatsapp_business_connections
  set status = v_status,
      is_active = case when v_status = 'DISCONNECTED' then false else is_active end,
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
      last_status_at = now(), updated_at = now()
  where id = v_connection.id;

  if v_restarted then
    perform public.restart_whatsapp_v2_after_qr_connection(v_connection.id, v_epoch);
  end if;
  return true;
end;
$$;

-- Apply the same clean start to a QR session that was already connected when
-- this repair is installed. Sent rows remain historical; only unsent work is
-- canceled or marked unknown.
do $$
declare
  v_connection record;
begin
  for v_connection in
    select id, connection_epoch_at
    from public.whatsapp_business_connections
    where provider = 'QR_WEB'
      and is_active
      and status = 'CONNECTED'
  loop
    perform public.restart_whatsapp_v2_after_qr_connection(
      v_connection.id,
      coalesce(v_connection.connection_epoch_at, now())
    );
  end loop;
end;
$$;

-- QR Web V2 is exclusive. Legacy outbox remains available to Meta only.
create or replace function public.enqueue_appointment_notifications()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_phone text;
  v_template text;
  v_action_token text;
  v_confirmation_enabled boolean;
begin
  if exists (
    select 1 from public.whatsapp_business_connections c
    where c.organization_id = new.organization_id
      and c.provider = 'QR_WEB'
      and c.is_active
  ) then
    return new;
  end if;

  select c.phone_e164, coalesce(a.confirmation_enabled, true)
    into v_phone, v_confirmation_enabled
  from public.customers c
  left join public.whatsapp_automation_settings a on a.organization_id = c.organization_id
  where c.id = new.customer_id and c.organization_id = new.organization_id;
  if v_phone is null then return new; end if;

  if new.status = 'CONFIRMED' and (tg_op = 'INSERT' or old.status is distinct from 'CONFIRMED' or old.service_period is distinct from new.service_period) then
    update public.customer_action_tokens set consumed_at = now() where appointment_id = new.id and consumed_at is null;
    if v_confirmation_enabled then
      v_template := case when tg_op = 'UPDATE' and old.status = 'CONFIRMED' and old.service_period is distinct from new.service_period then 'appointment_rescheduled' else 'appointment_confirmation' end;
      v_action_token := rtrim(translate(encode(gen_random_bytes(32), 'base64'), '+/', '-_'), '=');
      insert into public.customer_action_tokens (organization_id, appointment_id, customer_id, action, token_hash, expires_at)
      values (new.organization_id, new.id, new.customer_id, 'REQUEST_CANCEL', encode(digest(v_action_token, 'sha256'), 'hex'), greatest(lower(new.service_period), now() + interval '15 minutes'));
      insert into public.notification_outbox (organization_id, appointment_id, template_key, recipient_e164, payload, idempotency_key)
      values (new.organization_id, new.id, v_template, v_phone, jsonb_build_object('appointment_id', new.id, 'starts_at', lower(new.service_period), 'version', new.version, 'action_token', v_action_token), 'appointment:' || new.id || ':v' || new.version || ':' || v_template)
      on conflict (organization_id, idempotency_key) do nothing;
    end if;
    update public.notification_outbox set status = 'CANCELED'
    where appointment_id = new.id and template_key in ('appointment_reminder_0700', 'appointment_reminder_6h', 'appointment_reminder_45m') and status in ('PENDING', 'FAILED');
  elsif new.status = 'CANCELED' and (tg_op = 'INSERT' or old.status is distinct from 'CANCELED') then
    update public.notification_outbox set status = 'CANCELED' where appointment_id = new.id and status in ('PENDING', 'FAILED');
    insert into public.notification_outbox (organization_id, appointment_id, template_key, recipient_e164, payload, idempotency_key)
    values (new.organization_id, new.id, 'appointment_canceled', v_phone, jsonb_build_object('appointment_id', new.id, 'version', new.version), 'appointment:' || new.id || ':v' || new.version || ':canceled')
    on conflict (organization_id, idempotency_key) do nothing;
  end if;
  return new;
end;
$$;

create or replace function public.claim_whatsapp_v2_jobs(
  p_limit integer,
  p_worker_id text,
  p_lease_seconds integer default 120
)
returns setof public.whatsapp_automation_jobs
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.require_service_role();
  update public.whatsapp_automation_jobs j
  set status = 'CANCELED', last_error_code = 'STAFF_NOTIFICATIONS_DISABLED', updated_at = now()
  from public.whatsapp_automation_settings_v2 s
  where s.organization_id = j.organization_id
    and not s.staff_notifications_enabled
    and j.job_type in ('BOOKING_CREATED_STAFF', 'APPOINTMENT_CONFIRMED_STAFF', 'APPOINTMENT_CANCELED_STAFF')
    and j.status in ('PENDING', 'RETRY');

  return query
  with due as (
    select j.id
    from public.whatsapp_automation_jobs j
    join public.whatsapp_automation_settings_v2 s on s.organization_id = j.organization_id
    join public.whatsapp_business_connections c on c.id = j.connection_id
    where j.status in ('PENDING', 'RETRY')
      and j.next_attempt_at <= now()
      and (j.valid_until is null or j.valid_until > now())
      and s.mode = 'ACTIVE'
      and not s.dispatch_paused
      and c.is_active
      and c.status = 'CONNECTED'
    order by j.next_attempt_at, j.id
    limit greatest(1, least(p_limit, 25))
    for update skip locked
  )
  update public.whatsapp_automation_jobs j
  set status = 'PROCESSING', locked_at = now(), locked_by = p_worker_id,
      lock_expires_at = now() + make_interval(secs => greatest(30, least(p_lease_seconds, 300))), updated_at = now()
  from due where j.id = due.id returning j.*;
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
  v_start timestamptz;
  v_morning timestamptz;
  v_t45 timestamptz;
  v_confirmed_transition boolean := new.status = 'CONFIRMED' and (tg_op = 'INSERT' or old.status is distinct from 'CONFIRMED');
  v_changed boolean := tg_op = 'UPDATE' and (old.service_period is distinct from new.service_period or old.barber_id is distinct from new.barber_id or old.customer_id is distinct from new.customer_id or old.version is distinct from new.version);
  v_client_consented boolean;
  v_payload jsonb;
begin
  select * into v_connection from public.whatsapp_business_connections where organization_id=new.organization_id and provider='QR_WEB' and is_active order by updated_at desc limit 1;
  if not found then return new; end if;
  select * into v_settings from public.whatsapp_automation_settings_v2 where organization_id=new.organization_id;
  if not found or v_settings.mode <> 'ACTIVE' or v_settings.dispatch_paused then return new; end if;
  if new.status='CANCELED' and (tg_op='INSERT' or old.status is distinct from 'CANCELED') then
    update public.whatsapp_automation_jobs set status='CANCELED',updated_at=now(),last_error_code='APPOINTMENT_CANCELED' where appointment_id=new.id and status in ('PENDING','RETRY','PROCESSING');
    update public.whatsapp_confirmation_requests_v2 set status='EXPIRED',updated_at=now() where appointment_id=new.id and status='PENDING';
    return new;
  end if;
  if new.status <> 'CONFIRMED' or not (v_confirmed_transition or v_changed) then return new; end if;
  if v_changed then
    update public.whatsapp_automation_jobs set status='CANCELED',updated_at=now(),last_error_code='APPOINTMENT_VERSION_SUPERSEDED' where appointment_id=new.id and appointment_version <> new.version and status in ('PENDING','RETRY','PROCESSING');
    update public.whatsapp_confirmation_requests_v2 set status='SUPERSEDED',updated_at=now() where appointment_id=new.id and appointment_version <> new.version and status='PENDING';
  end if;
  select * into strict v_customer from public.customers where id=new.customer_id and organization_id=new.organization_id;
  select * into strict v_barber from public.barbers where id=new.barber_id and organization_id=new.organization_id;
  select * into strict v_org from public.organizations where id=new.organization_id;
  v_client_consented := public.whatsapp_v2_consented(new.organization_id, new.customer_id);
  v_start:=lower(new.service_period);
  v_payload:=jsonb_build_object('customer_name',v_customer.full_name,'barber_name',v_barber.display_name,'starts_at',v_start,'timezone',v_org.timezone,'currency',new.currency,'total_cents',new.total_cents_snapshot,'templates',v_settings.templates);
  if v_confirmed_transition and v_customer.phone_e164 is not null and v_client_consented then
    insert into public.whatsapp_automation_jobs (organization_id,connection_id,appointment_id,appointment_version,job_type,recipient_e164,payload,valid_until,dedupe_key)
    values (new.organization_id,v_connection.id,new.id,new.version,'BOOKING_CREATED_CLIENT',v_customer.phone_e164,v_payload,v_start,'v2:' || new.id || ':v' || new.version || ':booking:client') on conflict (organization_id,dedupe_key) do nothing;
  end if;
  if v_confirmed_transition and v_settings.staff_notifications_enabled and v_barber.whatsapp_e164 is not null then
    insert into public.whatsapp_automation_jobs (organization_id,connection_id,appointment_id,appointment_version,job_type,recipient_e164,payload,valid_until,dedupe_key)
    values (new.organization_id,v_connection.id,new.id,new.version,'BOOKING_CREATED_STAFF',v_barber.whatsapp_e164,v_payload,v_start,'v2:' || new.id || ':v' || new.version || ':booking:staff') on conflict (organization_id,dedupe_key) do nothing;
  end if;
  if v_customer.phone_e164 is null or not v_client_consented then return new; end if;
  v_morning:=((v_start at time zone v_org.timezone)::date + v_settings.morning_local_time) at time zone v_org.timezone;
  v_t45:=v_start-make_interval(mins=>v_settings.t45_offset_minutes);
  if v_settings.reminder_mode in ('BOTH','MORNING_ONLY') then
    insert into public.whatsapp_automation_jobs (organization_id,connection_id,appointment_id,appointment_version,job_type,recipient_e164,payload,scheduled_for,next_attempt_at,valid_until,status,dedupe_key)
    values (new.organization_id,v_connection.id,new.id,new.version,'REMINDER_MORNING_CLIENT',v_customer.phone_e164,v_payload,v_morning,v_morning,v_start,case when v_morning<=now() or v_t45<=v_morning then 'SKIPPED'::public.whatsapp_v2_job_status else 'PENDING'::public.whatsapp_v2_job_status end,'v2:' || new.id || ':v' || new.version || ':morning:client') on conflict (organization_id,dedupe_key) do nothing;
  end if;
  if v_settings.reminder_mode in ('BOTH','T45_ONLY') then
    insert into public.whatsapp_automation_jobs (organization_id,connection_id,appointment_id,appointment_version,job_type,recipient_e164,payload,scheduled_for,next_attempt_at,valid_until,status,dedupe_key)
    values (new.organization_id,v_connection.id,new.id,new.version,'REMINDER_T45_CLIENT',v_customer.phone_e164,v_payload,v_t45,v_t45,v_start,case when v_t45<=now() then 'SKIPPED'::public.whatsapp_v2_job_status else 'PENDING'::public.whatsapp_v2_job_status end,'v2:' || new.id || ':v' || new.version || ':t45:client') on conflict (organization_id,dedupe_key) do nothing;
  end if;
  return new;
end;
$$;

revoke all on function public.restart_whatsapp_v2_after_qr_connection(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.restart_whatsapp_v2_after_qr_connection(uuid, timestamptz), public.update_whatsapp_qr_status(text, text, text), public.claim_whatsapp_v2_jobs(integer, text, integer) to service_role;
revoke all on function public.schedule_whatsapp_v2_for_appointment() from public, anon, authenticated;
notify pgrst, 'reload schema';
