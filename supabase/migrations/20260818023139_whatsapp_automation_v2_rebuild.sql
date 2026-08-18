-- WhatsApp Automation v2: isolated persistent jobs, durable inbound events and
-- appointment-safe confirmations. Legacy notification_outbox remains available
-- for Meta and compatibility, but QR automation v2 never claims legacy jobs.

create type public.whatsapp_v2_mode as enum ('OFF', 'SHADOW', 'ACTIVE');
create type public.whatsapp_v2_job_status as enum (
  'PENDING', 'PROCESSING', 'RETRY', 'SUBMITTED', 'DELIVERED', 'READ',
  'FAILED', 'SKIPPED', 'CANCELED', 'DEAD_LETTER', 'SEND_UNKNOWN'
);
create type public.whatsapp_v2_job_type as enum (
  'BOOKING_CREATED_CLIENT', 'BOOKING_CREATED_STAFF',
  'REMINDER_MORNING_CLIENT', 'REMINDER_T45_CLIENT',
  'CONFIRMATION_ACK_CLIENT', 'CANCELLATION_ACK_CLIENT',
  'APPOINTMENT_CONFIRMED_STAFF', 'APPOINTMENT_CANCELED_STAFF',
  'MANUAL_OUTBOUND_TEXT'
);
create type public.whatsapp_confirmation_phase as enum ('MORNING', 'T45');
create type public.whatsapp_confirmation_status as enum ('PENDING', 'CONFIRMED', 'CANCELED', 'SUPERSEDED', 'EXPIRED');
create type public.whatsapp_presence_status as enum ('PENDING', 'CONFIRMED');
create type public.whatsapp_message_direction as enum ('INBOUND', 'OUTBOUND');
create type public.whatsapp_message_origin as enum ('AUTOMATION', 'MANUAL', 'PROVIDER');
create type public.whatsapp_message_status as enum ('QUEUED', 'SUBMITTED', 'DELIVERED', 'READ', 'FAILED', 'UNKNOWN');

alter table public.appointments
  add column if not exists whatsapp_presence_status public.whatsapp_presence_status not null default 'PENDING',
  add column if not exists whatsapp_presence_confirmed_at timestamptz,
  add column if not exists cancellation_source text,
  add column if not exists cancelled_at timestamptz;

alter table public.whatsapp_business_connections
  add column if not exists capabilities jsonb not null default '{"interactive_buttons_enabled": false}'::jsonb,
  add column if not exists last_event_at timestamptz,
  add column if not exists provider_version text;

create table public.whatsapp_automation_settings_v2 (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  mode public.whatsapp_v2_mode not null default 'OFF',
  reminder_mode text not null default 'BOTH' check (reminder_mode in ('BOTH', 'MORNING_ONLY', 'T45_ONLY')),
  morning_local_time time not null default time '08:00',
  t45_offset_minutes integer not null default 45 check (t45_offset_minutes between 5 and 240),
  send_t45_after_confirm boolean not null default true,
  client_ack_enabled boolean not null default true,
  staff_notifications_enabled boolean not null default true,
  manual_cancellation_message_enabled boolean not null default false,
  dispatch_paused boolean not null default false,
  templates jsonb not null default '{}'::jsonb check (jsonb_typeof(templates) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.whatsapp_contact_preferences_v2 (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  customer_id uuid not null,
  transactional_enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (organization_id, customer_id),
  foreign key (customer_id, organization_id) references public.customers(id, organization_id) on delete cascade
);

create table public.whatsapp_contacts_v2 (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  connection_id uuid not null references public.whatsapp_business_connections(id) on delete cascade,
  customer_id uuid,
  barber_id uuid,
  phone_e164 text not null check (phone_e164 ~ '^\\+[1-9][0-9]{7,14}$'),
  provider_jid text,
  display_name text,
  opt_out_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (connection_id, phone_e164),
  foreign key (customer_id, organization_id) references public.customers(id, organization_id) on delete set null,
  foreign key (barber_id, organization_id) references public.barbers(id, organization_id) on delete set null
);
create index whatsapp_contacts_v2_customer_idx on public.whatsapp_contacts_v2 (organization_id, customer_id) where customer_id is not null;

create table public.whatsapp_conversations_v2 (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  connection_id uuid not null references public.whatsapp_business_connections(id) on delete cascade,
  contact_id uuid not null references public.whatsapp_contacts_v2(id) on delete cascade,
  last_message_at timestamptz,
  last_message_preview text,
  unread_count integer not null default 0 check (unread_count >= 0),
  status text not null default 'OPEN' check (status in ('OPEN', 'CLOSED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (connection_id, contact_id)
);
create index whatsapp_conversations_v2_list_idx on public.whatsapp_conversations_v2 (organization_id, last_message_at desc nulls last, id desc);

create table public.whatsapp_automation_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  connection_id uuid not null references public.whatsapp_business_connections(id) on delete restrict,
  appointment_id uuid references public.appointments(id) on delete cascade,
  appointment_version integer,
  confirmation_request_id uuid,
  job_type public.whatsapp_v2_job_type not null,
  recipient_e164 text not null check (recipient_e164 ~ '^\\+[1-9][0-9]{7,14}$'),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  scheduled_for timestamptz not null default now(),
  next_attempt_at timestamptz not null default now(),
  valid_until timestamptz,
  status public.whatsapp_v2_job_status not null default 'PENDING',
  attempt_count integer not null default 0 check (attempt_count >= 0),
  max_attempts integer not null default 5 check (max_attempts between 1 and 20),
  locked_at timestamptz,
  locked_by text,
  lock_expires_at timestamptz,
  dedupe_key text not null,
  provider_message_id text,
  last_error_code text,
  last_error_detail text,
  submitted_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, dedupe_key),
  foreign key (appointment_id, organization_id) references public.appointments(id, organization_id) on delete cascade
);
create index whatsapp_automation_jobs_v2_claim_idx
  on public.whatsapp_automation_jobs (next_attempt_at, scheduled_for, id)
  where status in ('PENDING', 'RETRY');
create index whatsapp_automation_jobs_v2_appointment_idx
  on public.whatsapp_automation_jobs (organization_id, appointment_id, appointment_version, job_type);
create index whatsapp_automation_jobs_v2_operations_idx
  on public.whatsapp_automation_jobs (organization_id, updated_at desc, id desc)
  where status in ('FAILED', 'DEAD_LETTER', 'SEND_UNKNOWN');

create table public.whatsapp_confirmation_requests_v2 (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  connection_id uuid not null references public.whatsapp_business_connections(id) on delete restrict,
  appointment_id uuid not null,
  appointment_version integer not null,
  job_id uuid references public.whatsapp_automation_jobs(id) on delete set null,
  phase public.whatsapp_confirmation_phase not null,
  opaque_token_hash text not null unique,
  short_code_hash text not null,
  status public.whatsapp_confirmation_status not null default 'PENDING',
  provider_message_id text,
  expires_at timestamptz not null,
  responded_at timestamptz,
  response_message_id text,
  response_action text check (response_action in ('CONFIRM', 'CANCEL')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (appointment_id, organization_id) references public.appointments(id, organization_id) on delete cascade
);
create unique index whatsapp_confirmation_requests_v2_active_idx
  on public.whatsapp_confirmation_requests_v2 (appointment_id, appointment_version, phase)
  where status = 'PENDING';
create index whatsapp_confirmation_requests_v2_lookup_idx
  on public.whatsapp_confirmation_requests_v2 (connection_id, short_code_hash, status, expires_at);

alter table public.whatsapp_automation_jobs
  add constraint whatsapp_automation_jobs_v2_confirmation_fkey
  foreign key (confirmation_request_id) references public.whatsapp_confirmation_requests_v2(id) on delete set null;

create table public.whatsapp_messages_v2 (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  connection_id uuid not null references public.whatsapp_business_connections(id) on delete restrict,
  conversation_id uuid references public.whatsapp_conversations_v2(id) on delete set null,
  contact_id uuid references public.whatsapp_contacts_v2(id) on delete set null,
  job_id uuid references public.whatsapp_automation_jobs(id) on delete set null,
  appointment_id uuid references public.appointments(id) on delete set null,
  confirmation_request_id uuid references public.whatsapp_confirmation_requests_v2(id) on delete set null,
  direction public.whatsapp_message_direction not null,
  origin public.whatsapp_message_origin not null,
  message_type text not null default 'TEXT' check (message_type in ('TEXT', 'INTERACTIVE', 'SYSTEM')),
  body text,
  provider_message_id text,
  provider_status_raw text,
  status public.whatsapp_message_status not null default 'QUEUED',
  error_code text,
  queued_at timestamptz,
  submitted_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  failed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (connection_id, provider_message_id)
);
create index whatsapp_messages_v2_conversation_idx on public.whatsapp_messages_v2 (conversation_id, created_at desc, id desc);
create index whatsapp_messages_v2_appointment_idx on public.whatsapp_messages_v2 (organization_id, appointment_id, created_at desc);

create table public.whatsapp_webhook_events_v2 (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  connection_id uuid not null references public.whatsapp_business_connections(id) on delete cascade,
  event_name_raw text not null,
  event_name_normalized text not null,
  provider_event_id text,
  fingerprint text not null,
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  processing_status text not null default 'RECEIVED' check (processing_status in ('RECEIVED', 'PROCESSING', 'COMPLETED', 'FAILED', 'DEAD')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  last_error text,
  unique (connection_id, fingerprint)
);
create index whatsapp_webhook_events_v2_claim_idx on public.whatsapp_webhook_events_v2 (received_at, id)
  where processing_status in ('RECEIVED', 'FAILED');

-- Current preference is projected for reliable claims. consent_events remains append-only audit.
insert into public.whatsapp_contact_preferences_v2 (organization_id, customer_id, transactional_enabled)
select c.organization_id, c.id,
  coalesce((
    select ce.action = 'GRANTED'
    from public.consent_events ce
    where ce.organization_id = c.organization_id
      and ce.customer_id = c.id
      and ce.kind = 'WHATSAPP_TRANSACTIONAL'
    order by ce.occurred_at desc, ce.created_at desc
    limit 1
  ), true)
from public.customers c
on conflict (organization_id, customer_id) do nothing;

insert into public.whatsapp_automation_settings_v2 (organization_id, mode)
select c.organization_id, case when c.status = 'CONNECTED' and c.is_active then 'ACTIVE'::public.whatsapp_v2_mode else 'OFF'::public.whatsapp_v2_mode end
from public.whatsapp_business_connections c
where c.provider = 'QR_WEB'
on conflict (organization_id) do nothing;

-- Stop legacy QR jobs while preserving Meta and the immutable migration history.
update public.whatsapp_automation_settings set confirmation_enabled = false
where organization_id in (
  select organization_id from public.whatsapp_business_connections where provider = 'QR_WEB' and is_active
);
update public.whatsapp_reminder_rules set enabled = false
where organization_id in (
  select organization_id from public.whatsapp_business_connections where provider = 'QR_WEB' and is_active
);
update public.notification_outbox n
set status = 'CANCELED', last_error = 'LEGACY_QR_AUTOMATION_QUARANTINED', updated_at = now()
where n.status in ('PENDING', 'FAILED')
  and n.template_key in ('appointment_reminder_0700', 'appointment_reminder_6h', 'appointment_reminder_45m', 'appointment_canceled', 'appointment_cancellation_confirmed', 'appointment_rescheduled')
  and exists (
    select 1 from public.whatsapp_business_connections c
    where c.organization_id = n.organization_id and c.provider = 'QR_WEB' and c.is_active
  );

create or replace function public.whatsapp_v2_consented(p_organization_id uuid, p_customer_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((
    select transactional_enabled from public.whatsapp_contact_preferences_v2
    where organization_id = p_organization_id and customer_id = p_customer_id
  ), true)
$$;
revoke all on function public.whatsapp_v2_consented(uuid, uuid) from public, anon, authenticated;
grant execute on function public.whatsapp_v2_consented(uuid, uuid) to service_role;

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
  v_initial boolean := tg_op = 'INSERT';
  v_confirmed_transition boolean := new.status = 'CONFIRMED' and (
    tg_op = 'INSERT' or old.status is distinct from 'CONFIRMED'
  );
  v_changed boolean := tg_op = 'UPDATE' and (
    old.service_period is distinct from new.service_period or old.barber_id is distinct from new.barber_id
    or old.customer_id is distinct from new.customer_id or old.version is distinct from new.version
  );
  v_payload jsonb;
begin
  select * into v_connection from public.whatsapp_business_connections
    where organization_id = new.organization_id and provider = 'QR_WEB' and is_active
    order by updated_at desc limit 1;
  if not found then return new; end if;
  select * into v_settings from public.whatsapp_automation_settings_v2 where organization_id = new.organization_id;
  if not found or v_settings.mode = 'OFF' then return new; end if;

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
  v_start := lower(new.service_period);
  v_payload := jsonb_build_object(
    'customer_name', v_customer.full_name, 'barber_name', v_barber.display_name,
    'starts_at', v_start, 'timezone', v_org.timezone, 'currency', new.currency,
    'total_cents', new.total_cents_snapshot
  );

  if v_confirmed_transition and v_customer.phone_e164 is not null then
    insert into public.whatsapp_automation_jobs (organization_id, connection_id, appointment_id, appointment_version, job_type, recipient_e164, payload, valid_until, dedupe_key)
    values (new.organization_id, v_connection.id, new.id, new.version, 'BOOKING_CREATED_CLIENT', v_customer.phone_e164, v_payload, v_start, 'v2:' || new.id || ':v' || new.version || ':booking:client')
    on conflict (organization_id, dedupe_key) do nothing;
    if v_barber.whatsapp_e164 is not null then
      insert into public.whatsapp_automation_jobs (organization_id, connection_id, appointment_id, appointment_version, job_type, recipient_e164, payload, valid_until, dedupe_key)
      values (new.organization_id, v_connection.id, new.id, new.version, 'BOOKING_CREATED_STAFF', v_barber.whatsapp_e164, v_payload, v_start, 'v2:' || new.id || ':v' || new.version || ':booking:staff')
      on conflict (organization_id, dedupe_key) do nothing;
    end if;
  end if;

  if v_customer.phone_e164 is null or not public.whatsapp_v2_consented(new.organization_id, new.customer_id) then return new; end if;
  v_morning := ((v_start at time zone v_org.timezone)::date + v_settings.morning_local_time) at time zone v_org.timezone;
  v_t45 := v_start - make_interval(mins => v_settings.t45_offset_minutes);
  if v_settings.reminder_mode in ('BOTH', 'MORNING_ONLY') then
    insert into public.whatsapp_automation_jobs (organization_id, connection_id, appointment_id, appointment_version, job_type, recipient_e164, payload, scheduled_for, next_attempt_at, valid_until, status, dedupe_key)
    values (new.organization_id, v_connection.id, new.id, new.version, 'REMINDER_MORNING_CLIENT', v_customer.phone_e164, v_payload,
      v_morning, v_morning, v_start,
      case when v_morning <= now() or v_t45 <= v_morning then 'SKIPPED' else 'PENDING' end,
      'v2:' || new.id || ':v' || new.version || ':morning:client')
    on conflict (organization_id, dedupe_key) do nothing;
  end if;
  if v_settings.reminder_mode in ('BOTH', 'T45_ONLY') then
    insert into public.whatsapp_automation_jobs (organization_id, connection_id, appointment_id, appointment_version, job_type, recipient_e164, payload, scheduled_for, next_attempt_at, valid_until, status, dedupe_key)
    values (new.organization_id, v_connection.id, new.id, new.version, 'REMINDER_T45_CLIENT', v_customer.phone_e164, v_payload,
      v_t45, v_t45, v_start, case when v_t45 <= now() then 'SKIPPED' else 'PENDING' end,
      'v2:' || new.id || ':v' || new.version || ':t45:client')
    on conflict (organization_id, dedupe_key) do nothing;
  end if;
  return new;
end;
$$;
drop trigger if exists appointments_schedule_whatsapp_v2 on public.appointments;
create trigger appointments_schedule_whatsapp_v2 after insert or update on public.appointments
for each row execute function public.schedule_whatsapp_v2_for_appointment();
revoke all on function public.schedule_whatsapp_v2_for_appointment() from public, anon, authenticated;

create or replace function public.claim_whatsapp_v2_jobs(p_limit integer, p_worker_id text, p_lease_seconds integer default 120)
returns setof public.whatsapp_automation_jobs
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.require_service_role();
  return query
  with due as (
    select j.id from public.whatsapp_automation_jobs j
    join public.whatsapp_automation_settings_v2 s on s.organization_id = j.organization_id
    join public.whatsapp_business_connections c on c.id = j.connection_id
    where j.status in ('PENDING', 'RETRY') and j.next_attempt_at <= now()
      and (j.valid_until is null or j.valid_until > now()) and s.mode = 'ACTIVE' and not s.dispatch_paused
      and c.status = 'CONNECTED'
    order by j.next_attempt_at, j.id limit greatest(1, least(p_limit, 25)) for update skip locked
  ) update public.whatsapp_automation_jobs j set status = 'PROCESSING', locked_at = now(), locked_by = p_worker_id,
      lock_expires_at = now() + make_interval(secs => greatest(30, least(p_lease_seconds, 300))), updated_at = now()
    from due where j.id = due.id returning j.*;
end;
$$;
revoke all on function public.claim_whatsapp_v2_jobs(integer, text, integer) from public, anon, authenticated;
grant execute on function public.claim_whatsapp_v2_jobs(integer, text, integer) to service_role;

create or replace function public.complete_whatsapp_v2_job(
  p_job_id uuid, p_worker_id text, p_success boolean, p_provider_message_id text default null,
  p_error_code text default null, p_retryable boolean default false
) returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare v_job public.whatsapp_automation_jobs%rowtype; v_delay integer;
begin
  perform public.require_service_role();
  select * into v_job from public.whatsapp_automation_jobs where id = p_job_id for update;
  if not found or v_job.status <> 'PROCESSING' or v_job.locked_by <> p_worker_id then return false; end if;
  if p_success then
    update public.whatsapp_automation_jobs set status='SUBMITTED', provider_message_id=p_provider_message_id, submitted_at=now(), locked_at=null, locked_by=null, lock_expires_at=null, updated_at=now() where id=p_job_id;
  elsif p_retryable and v_job.attempt_count + 1 < v_job.max_attempts and (v_job.valid_until is null or v_job.valid_until > now()) then
    v_delay := (array[60,300,900,1800])[least(v_job.attempt_count + 1, 4)];
    update public.whatsapp_automation_jobs set status='RETRY', attempt_count=attempt_count+1, next_attempt_at=now()+make_interval(secs=>v_delay+(floor(random()*20))::integer), last_error_code=p_error_code, locked_at=null, locked_by=null, lock_expires_at=null, updated_at=now() where id=p_job_id;
  else
    update public.whatsapp_automation_jobs set status='DEAD_LETTER', attempt_count=attempt_count+1, last_error_code=p_error_code, locked_at=null, locked_by=null, lock_expires_at=null, updated_at=now() where id=p_job_id;
  end if;
  return true;
end;
$$;
revoke all on function public.complete_whatsapp_v2_job(uuid, text, boolean, text, text, boolean) from public, anon, authenticated;
grant execute on function public.complete_whatsapp_v2_job(uuid, text, boolean, text, text, boolean) to service_role;

create or replace function public.create_whatsapp_v2_confirmation_request(p_job_id uuid, p_worker_id text)
returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v_job public.whatsapp_automation_jobs%rowtype; v_phase public.whatsapp_confirmation_phase; v_code text; v_token text; v_id uuid;
begin
  perform public.require_service_role();
  select * into v_job from public.whatsapp_automation_jobs where id=p_job_id for update;
  if not found or v_job.status <> 'PROCESSING' or v_job.locked_by <> p_worker_id then raise exception using errcode='22023', message='job not claimed'; end if;
  if v_job.confirmation_request_id is not null and nullif(v_job.payload ->> 'short_code','') is not null then
    return jsonb_build_object('request_id',v_job.confirmation_request_id,'short_code',v_job.payload ->> 'short_code','phase',case when v_job.job_type='REMINDER_MORNING_CLIENT' then 'MORNING' else 'T45' end);
  end if;
  v_phase := case when v_job.job_type='REMINDER_MORNING_CLIENT' then 'MORNING' else 'T45' end;
  if v_phase='T45' then update public.whatsapp_confirmation_requests_v2 set status='SUPERSEDED', updated_at=now() where appointment_id=v_job.appointment_id and appointment_version=v_job.appointment_version and status='PENDING'; end if;
  v_code := upper(substr(encode(gen_random_bytes(8), 'hex'), 1, 6));
  v_token := rtrim(translate(encode(gen_random_bytes(32), 'base64'), '+/', '-_'), '=');
  insert into public.whatsapp_confirmation_requests_v2 (organization_id, connection_id, appointment_id, appointment_version, job_id, phase, opaque_token_hash, short_code_hash, expires_at)
  values (v_job.organization_id, v_job.connection_id, v_job.appointment_id, v_job.appointment_version, v_job.id, v_phase, encode(digest(v_token,'sha256'),'hex'), encode(digest(v_code,'sha256'),'hex'), v_job.valid_until)
  returning id into v_id;
  update public.whatsapp_automation_jobs set confirmation_request_id=v_id, payload=payload || jsonb_build_object('short_code',v_code,'opaque_token',v_token), updated_at=now() where id=v_job.id;
  return jsonb_build_object('request_id',v_id,'short_code',v_code,'opaque_token',v_token,'phase',v_phase);
end;
$$;
revoke all on function public.create_whatsapp_v2_confirmation_request(uuid, text) from public, anon, authenticated;
grant execute on function public.create_whatsapp_v2_confirmation_request(uuid, text) to service_role;

create or replace function public.process_whatsapp_v2_text_response(
  p_gateway_instance_id text, p_sender_e164 text, p_external_message_id text, p_action text, p_short_code text
) returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v_connection public.whatsapp_business_connections%rowtype; v_request public.whatsapp_confirmation_requests_v2%rowtype; v_appointment public.appointments%rowtype; v_customer_id uuid; v_action text:=upper(btrim(p_action));
begin
  perform public.require_service_role();
  select * into v_connection from public.whatsapp_business_connections where provider='QR_WEB' and gateway_instance_id=p_gateway_instance_id and is_active and status='CONNECTED' for update;
  if not found then return jsonb_build_object('processed',false,'reason','UNKNOWN_CONNECTION'); end if;
  select * into v_request from public.whatsapp_confirmation_requests_v2 where connection_id=v_connection.id and short_code_hash=encode(digest(upper(btrim(p_short_code)),'sha256'),'hex') and status='PENDING' and expires_at>now() for update;
  if not found then return jsonb_build_object('processed',false,'reason','NO_ACTIVE_REQUEST'); end if;
  select * into v_appointment from public.appointments where id=v_request.appointment_id and organization_id=v_request.organization_id for update;
  select id into v_customer_id from public.customers where id=v_appointment.customer_id and organization_id=v_appointment.organization_id and phone_e164=p_sender_e164;
  if v_customer_id is null then return jsonb_build_object('processed',false,'reason','SENDER_MISMATCH'); end if;
  if v_appointment.version <> v_request.appointment_version or v_appointment.status not in ('CONFIRMED') then return jsonb_build_object('processed',false,'reason','APPOINTMENT_NOT_ACTIVE'); end if;
  if v_action not in ('CONFIRM','CANCEL') then return jsonb_build_object('processed',false,'reason','UNSUPPORTED_ACTION'); end if;
  update public.whatsapp_confirmation_requests_v2 set status=case when v_action='CONFIRM' then 'CONFIRMED'::public.whatsapp_confirmation_status else 'CANCELED'::public.whatsapp_confirmation_status end, responded_at=now(), response_message_id=p_external_message_id, response_action=v_action, updated_at=now() where id=v_request.id;
  if v_action='CONFIRM' then
    update public.appointments set whatsapp_presence_status='CONFIRMED', whatsapp_presence_confirmed_at=coalesce(whatsapp_presence_confirmed_at,now()), updated_at=now() where id=v_appointment.id;
    insert into public.appointment_status_events (organization_id,appointment_id,from_status,to_status,reason,metadata) values (v_appointment.organization_id,v_appointment.id,'CONFIRMED','CONFIRMED','whatsapp_presence_confirmed',jsonb_build_object('confirmation_request_id',v_request.id,'phase',v_request.phase));
    insert into public.whatsapp_automation_jobs (organization_id,connection_id,appointment_id,appointment_version,job_type,recipient_e164,payload,valid_until,dedupe_key)
    values (v_appointment.organization_id,v_connection.id,v_appointment.id,v_appointment.version,'CONFIRMATION_ACK_CLIENT',p_sender_e164,jsonb_build_object('customer_name',(select full_name from public.customers where id=v_appointment.customer_id),'starts_at',lower(v_appointment.service_period),'timezone',(select timezone from public.organizations where id=v_appointment.organization_id)),lower(v_appointment.service_period),'v2:' || v_request.id || ':confirm:ack') on conflict (organization_id,dedupe_key) do nothing;
    insert into public.whatsapp_automation_jobs (organization_id,connection_id,appointment_id,appointment_version,job_type,recipient_e164,payload,valid_until,dedupe_key)
    select v_appointment.organization_id,v_connection.id,v_appointment.id,v_appointment.version,'APPOINTMENT_CONFIRMED_STAFF',b.whatsapp_e164,jsonb_build_object('customer_name',(select full_name from public.customers where id=v_appointment.customer_id),'starts_at',lower(v_appointment.service_period),'timezone',(select timezone from public.organizations where id=v_appointment.organization_id)),lower(v_appointment.service_period),'v2:' || v_request.id || ':confirm:staff'
    from public.barbers b where b.id=v_appointment.barber_id and b.organization_id=v_appointment.organization_id and b.whatsapp_e164 is not null
    on conflict (organization_id,dedupe_key) do nothing;
  else
    perform public.cancel_appointment(v_appointment.id,'Cancelado pelo cliente via WhatsApp',true);
    update public.appointments set cancellation_source='WHATSAPP_CLIENT', cancelled_at=now() where id=v_appointment.id;
    insert into public.whatsapp_automation_jobs (organization_id,connection_id,appointment_id,appointment_version,job_type,recipient_e164,payload,dedupe_key)
    values (v_appointment.organization_id,v_connection.id,v_appointment.id,v_appointment.version,'CANCELLATION_ACK_CLIENT',p_sender_e164,jsonb_build_object('customer_name',(select full_name from public.customers where id=v_appointment.customer_id)),'v2:' || v_request.id || ':cancel:ack') on conflict (organization_id,dedupe_key) do nothing;
    insert into public.whatsapp_automation_jobs (organization_id,connection_id,appointment_id,appointment_version,job_type,recipient_e164,payload,dedupe_key)
    select v_appointment.organization_id,v_connection.id,v_appointment.id,v_appointment.version,'APPOINTMENT_CANCELED_STAFF',b.whatsapp_e164,jsonb_build_object('customer_name',(select full_name from public.customers where id=v_appointment.customer_id)),'v2:' || v_request.id || ':cancel:staff'
    from public.barbers b where b.id=v_appointment.barber_id and b.organization_id=v_appointment.organization_id and b.whatsapp_e164 is not null
    on conflict (organization_id,dedupe_key) do nothing;
  end if;
  return jsonb_build_object('processed',true,'appointment_id',v_appointment.id,'action',v_action,'request_id',v_request.id);
end;
$$;
revoke all on function public.process_whatsapp_v2_text_response(text,text,text,text,text) from public, anon, authenticated;
grant execute on function public.process_whatsapp_v2_text_response(text,text,text,text,text) to service_role;

alter table public.whatsapp_automation_settings_v2 enable row level security;
alter table public.whatsapp_contact_preferences_v2 enable row level security;
alter table public.whatsapp_contacts_v2 enable row level security;
alter table public.whatsapp_conversations_v2 enable row level security;
alter table public.whatsapp_messages_v2 enable row level security;
alter table public.whatsapp_automation_jobs enable row level security;
alter table public.whatsapp_confirmation_requests_v2 enable row level security;
alter table public.whatsapp_webhook_events_v2 enable row level security;

create policy whatsapp_v2_settings_owner_select on public.whatsapp_automation_settings_v2 for select to authenticated using (public.is_organization_owner(organization_id));
create policy whatsapp_v2_settings_owner_update on public.whatsapp_automation_settings_v2 for update to authenticated using (public.is_organization_owner(organization_id)) with check (public.is_organization_owner(organization_id));
create policy whatsapp_v2_contacts_owner_select on public.whatsapp_contacts_v2 for select to authenticated using (public.is_organization_owner(organization_id));
create policy whatsapp_v2_conversations_owner_select on public.whatsapp_conversations_v2 for select to authenticated using (public.is_organization_owner(organization_id));
create policy whatsapp_v2_messages_owner_select on public.whatsapp_messages_v2 for select to authenticated using (public.is_organization_owner(organization_id));
create policy whatsapp_v2_jobs_owner_select on public.whatsapp_automation_jobs for select to authenticated using (public.is_organization_owner(organization_id));
create policy whatsapp_v2_requests_owner_select on public.whatsapp_confirmation_requests_v2 for select to authenticated using (public.is_organization_owner(organization_id));
create policy whatsapp_v2_webhooks_owner_select on public.whatsapp_webhook_events_v2 for select to authenticated using (public.is_organization_owner(organization_id));

grant select, update on public.whatsapp_automation_settings_v2 to authenticated;
grant select on public.whatsapp_contacts_v2, public.whatsapp_conversations_v2, public.whatsapp_messages_v2, public.whatsapp_automation_jobs, public.whatsapp_confirmation_requests_v2, public.whatsapp_webhook_events_v2 to authenticated;

-- Provider-only helpers. They keep Evolution credentials in Vault and make the
-- dispatcher connection-bound, never provider-selection-bound.
create or replace function public.get_whatsapp_v2_qr_sender_context(p_connection_id uuid)
returns jsonb language sql stable security definer set search_path = public, vault, pg_temp as $$
  select jsonb_build_object(
    'gateway_base_url', c.metadata ->> 'gateway_base_url',
    'gateway_instance_id', c.gateway_instance_id,
    'gateway_api_key', s.decrypted_secret
  )
  from public.whatsapp_business_connections c
  join vault.decrypted_secrets s on s.id = c.gateway_secret_id
  where c.id = p_connection_id and c.provider = 'QR_WEB' and c.is_active
  limit 1
$$;
revoke all on function public.get_whatsapp_v2_qr_sender_context(uuid) from public, anon, authenticated;
grant execute on function public.get_whatsapp_v2_qr_sender_context(uuid) to service_role;

create or replace function public.record_whatsapp_v2_outbound_message(
  p_job_id uuid, p_provider_message_id text, p_body text
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_job public.whatsapp_automation_jobs%rowtype;
begin
  perform public.require_service_role();
  select * into v_job from public.whatsapp_automation_jobs where id = p_job_id;
  if not found then return; end if;
  insert into public.whatsapp_messages_v2 (
    organization_id, connection_id, job_id, appointment_id, confirmation_request_id,
    direction, origin, body, provider_message_id, status, queued_at, submitted_at
  ) values (
    v_job.organization_id, v_job.connection_id, v_job.id, v_job.appointment_id, v_job.confirmation_request_id,
    'OUTBOUND', 'AUTOMATION', p_body, nullif(p_provider_message_id, ''), 'SUBMITTED', now(), now()
  ) on conflict (connection_id, provider_message_id) do update
    set status = 'SUBMITTED', submitted_at = excluded.submitted_at, updated_at = now();
end;
$$;

create or replace function public.record_whatsapp_v2_webhook_event(
  p_gateway_instance_id text, p_event_name text, p_provider_event_id text, p_fingerprint text, p_payload jsonb
) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_connection_id uuid; v_organization_id uuid; v_id uuid;
begin
  perform public.require_service_role();
  select id, organization_id into v_connection_id, v_organization_id
  from public.whatsapp_business_connections
  where provider = 'QR_WEB' and gateway_instance_id = p_gateway_instance_id and is_active
  order by updated_at desc limit 1;
  if v_connection_id is null then return null; end if;
  update public.whatsapp_business_connections set last_event_at=now(), updated_at=updated_at where id=v_connection_id;
  insert into public.whatsapp_webhook_events_v2 (organization_id, connection_id, event_name_raw, event_name_normalized, provider_event_id, fingerprint, payload)
  values (v_organization_id, v_connection_id, left(p_event_name,255), upper(p_event_name), nullif(p_provider_event_id,''), p_fingerprint, coalesce(p_payload,'{}'::jsonb))
  on conflict (connection_id, fingerprint) do update set received_at=now()
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.claim_whatsapp_v2_webhook_events(p_limit integer, p_worker_id text)
returns setof public.whatsapp_webhook_events_v2 language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.require_service_role();
  return query with due as (
    select id from public.whatsapp_webhook_events_v2
    where processing_status in ('RECEIVED','FAILED')
    order by received_at, id limit greatest(1, least(p_limit, 50)) for update skip locked
  ) update public.whatsapp_webhook_events_v2 e set processing_status='PROCESSING', attempt_count=attempt_count+1
    from due where e.id=due.id returning e.*;
end;
$$;

create or replace function public.complete_whatsapp_v2_webhook_event(p_event_id uuid, p_success boolean, p_error text default null)
returns void language sql security definer set search_path = public, pg_temp as $$
  update public.whatsapp_webhook_events_v2
  set processing_status = case when p_success then 'COMPLETED' else case when attempt_count >= 5 then 'DEAD' else 'FAILED' end end,
      processed_at = case when p_success then now() else processed_at end,
      last_error = case when p_success then null else left(p_error, 500) end
  where id=p_event_id
$$;

create or replace function public.record_whatsapp_v2_inbound_message(
  p_connection_id uuid, p_sender_e164 text, p_provider_message_id text, p_body text
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_org uuid; v_contact uuid; v_conversation uuid;
begin
  perform public.require_service_role();
  select organization_id into v_org from public.whatsapp_business_connections where id=p_connection_id;
  if v_org is null or p_sender_e164 !~ '^\\+[1-9][0-9]{7,14}$' then return; end if;
  insert into public.whatsapp_contacts_v2 (organization_id,connection_id,customer_id,phone_e164)
  values (v_org,p_connection_id,(select id from public.customers where organization_id=v_org and phone_e164=p_sender_e164 limit 1),p_sender_e164)
  on conflict (connection_id,phone_e164) do update set updated_at=now() returning id into v_contact;
  insert into public.whatsapp_conversations_v2 (organization_id,connection_id,contact_id,last_message_at,last_message_preview,unread_count)
  values (v_org,p_connection_id,v_contact,now(),left(coalesce(p_body,''),500),1)
  on conflict (connection_id,contact_id) do update set last_message_at=excluded.last_message_at,last_message_preview=excluded.last_message_preview,unread_count=whatsapp_conversations_v2.unread_count+1,updated_at=now()
  returning id into v_conversation;
  insert into public.whatsapp_messages_v2 (organization_id,connection_id,conversation_id,contact_id,direction,origin,body,provider_message_id,status,submitted_at)
  values (v_org,p_connection_id,v_conversation,v_contact,'INBOUND','PROVIDER',p_body,nullif(p_provider_message_id,''),'DELIVERED',now())
  on conflict (connection_id,provider_message_id) do nothing;
end;
$$;

revoke all on function public.record_whatsapp_v2_outbound_message(uuid,text,text), public.record_whatsapp_v2_webhook_event(text,text,text,text,jsonb), public.claim_whatsapp_v2_webhook_events(integer,text), public.complete_whatsapp_v2_webhook_event(uuid,boolean,text), public.record_whatsapp_v2_inbound_message(uuid,text,text,text) from public, anon, authenticated;
grant execute on function public.record_whatsapp_v2_outbound_message(uuid,text,text), public.record_whatsapp_v2_webhook_event(text,text,text,text,jsonb), public.claim_whatsapp_v2_webhook_events(integer,text), public.complete_whatsapp_v2_webhook_event(uuid,boolean,text), public.record_whatsapp_v2_inbound_message(uuid,text,text,text) to service_role;

-- Existing cron dispatcher is allow-listed. Extend it only for this isolated worker.
create or replace function app_private.dispatch_edge_function(p_function_name text, p_body jsonb)
returns bigint language plpgsql security definer set search_path = app_private, vault, net, pg_temp as $$
declare v_supabase_url text; v_service_role_key text; v_request_id bigint;
begin
  if p_function_name not in ('whatsapp-send-outbox','maintenance-jobs','whatsapp-qr-health','whatsapp-v2-dispatcher') or jsonb_typeof(p_body) <> 'object' then
    raise exception using errcode='22023', message='unsupported edge worker dispatch';
  end if;
  select decrypted_secret into v_supabase_url from vault.decrypted_secrets where name='los_barberos_supabase_url' limit 1;
  select decrypted_secret into v_service_role_key from vault.decrypted_secrets where name='los_barberos_service_role_key' limit 1;
  if nullif(v_supabase_url,'') is null or nullif(v_service_role_key,'') is null then
    insert into app_private.edge_dispatch_audit(function_name,status,error_code) values(p_function_name,'SKIPPED_CONFIG','VAULT_CONFIG_MISSING'); return null;
  end if;
  select net.http_post(url:=rtrim(v_supabase_url,'/') || '/functions/v1/' || p_function_name,headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || v_service_role_key,'apikey',v_service_role_key),body:=p_body,timeout_milliseconds:=10000) into v_request_id;
  insert into app_private.edge_dispatch_audit(function_name,status,request_id) values(p_function_name,'QUEUED',v_request_id);
  delete from app_private.edge_dispatch_audit where created_at < now()-interval '30 days'; return v_request_id;
exception when others then
  insert into app_private.edge_dispatch_audit(function_name,status,error_code) values(p_function_name,'ERROR',sqlstate); return null;
end;
$$;

-- Isolated scheduler. Existing legacy cron remains for Meta/compatibility.
select cron.schedule('los_barberos_whatsapp_v2_dispatcher', '* * * * *', $job$
  select app_private.dispatch_edge_function('whatsapp-v2-dispatcher', '{"limit":25}'::jsonb)
$job$);
