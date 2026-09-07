-- Additive runtime. Existing tenants stay on LEGACY until explicitly promoted.
-- Deployment requires migration first, Functions second, explicit tenant promotion last.
alter table public.whatsapp_automation_settings_v2
  add column runtime_engine text not null default 'LEGACY' check (runtime_engine in ('LEGACY','SHADOW','ACTIVE')),
  add column runtime_changed_at timestamptz not null default now();
alter table public.whatsapp_automation_jobs
  add column lease_token uuid,
  add column send_started_at timestamptz,
  add column customer_id uuid,
  add column custom_key text,
  add column priority integer not null default 0,
  add constraint whatsapp_jobs_customer_tenant foreign key (customer_id,organization_id) references public.customers(id,organization_id);
alter table public.whatsapp_webhook_events_v2 add column lease_token uuid,
  add column next_attempt_at timestamptz not null default now();
alter table public.whatsapp_custom_message_settings_v2 add column enabled_since timestamptz not null default now();

create table public.whatsapp_runtime_servers (
  id uuid primary key default gen_random_uuid(), name text not null unique,
  state text not null default 'DISABLED' check (state in ('ACTIVE','FENCED','DISABLED')),
  last_heartbeat_at timestamptz, created_at timestamptz not null default now()
);
alter table public.whatsapp_business_connections
  add column runtime_server_id uuid references public.whatsapp_runtime_servers(id),
  add column dispatch_after timestamptz not null default now(),
  add column last_dispatch_at timestamptz;

create table public.whatsapp_domain_events (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
  aggregate_id uuid not null, aggregate_version bigint not null, event_type text not null,
  schema_version integer not null default 1 check (schema_version=1),
  occurred_at timestamptz not null default clock_timestamp(),
  unique (organization_id,aggregate_id,aggregate_version,event_type)
);
create table public.whatsapp_runtime_audit (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
  event_type text not null, reference_id uuid, detail jsonb not null default '{}', created_at timestamptz not null default now()
);
create table public.whatsapp_delivery_receipts (
  organization_id uuid not null references public.organizations(id),
  connection_id uuid not null references public.whatsapp_business_connections(id),
  provider_message_id text not null, status text not null check (status in ('SUBMITTED','DELIVERED','READ','FAILED')),
  created_at timestamptz not null default now(), primary key(connection_id,provider_message_id,status)
);
create table public.whatsapp_campaigns (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
  message_key text not null check(message_key in ('SPECIAL_DATES','MARKETING_CAMPAIGNS')),
  body text not null check(length(btrim(body)) between 1 and 4096),
  scheduled_for timestamptz not null, customer_ids uuid[],
  status text not null default 'SCHEDULED' check(status in ('SCHEDULED','CANCELED','ENQUEUED')),
  created_at timestamptz not null default now(), unique(id,organization_id)
);
create table public.whatsapp_private_images (
  id uuid primary key, organization_id uuid not null references public.organizations(id),
  connection_id uuid not null references public.whatsapp_business_connections(id),
  event_id uuid not null unique references public.whatsapp_webhook_events_v2(id),
  object_path text not null unique, mime_type text not null check(mime_type in ('image/jpeg','image/png','image/webp')),
  byte_size integer not null check(byte_size between 12 and 10485760),
  expires_at timestamptz not null default now()+interval '7 days', deleted_at timestamptz
);
create index whatsapp_private_images_expiry on public.whatsapp_private_images(expires_at) where deleted_at is null;
create index whatsapp_custom_frequency on public.whatsapp_automation_jobs(organization_id,customer_id,send_started_at) where custom_key is not null;
create index whatsapp_runtime_connection_due on public.whatsapp_automation_jobs(connection_id,priority,next_attempt_at,id) where status in ('PENDING','RETRY');
create index whatsapp_runtime_connection_busy on public.whatsapp_automation_jobs(connection_id,lock_expires_at) where status='PROCESSING';
create index whatsapp_completed_event on public.appointment_status_events(organization_id,appointment_id,created_at desc) where to_status='COMPLETED';
create index whatsapp_completed_customer on public.appointments(organization_id,customer_id,upper(service_period) desc) where status='COMPLETED';

-- Every new table defaults to service-only. Public read surfaces are explicit.
do $$ declare n text; begin
  foreach n in array array['whatsapp_runtime_servers','whatsapp_domain_events','whatsapp_runtime_audit','whatsapp_delivery_receipts','whatsapp_campaigns','whatsapp_private_images'] loop
    execute format('alter table public.%I enable row level security',n);
    execute format('revoke all on public.%I from public,anon,authenticated',n);
    execute format('grant select,insert,update,delete on public.%I to service_role',n);
  end loop;
end $$;
revoke update,delete on public.whatsapp_domain_events,public.whatsapp_runtime_audit,public.whatsapp_delivery_receipts from service_role;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('whatsapp-private','whatsapp-private',false,10485760,array['image/jpeg','image/png','image/webp']) on conflict(id) do nothing;
create policy whatsapp_private_owner_read on storage.objects for select to authenticated
using(bucket_id='whatsapp-private' and exists(select 1 from public.whatsapp_private_images i where i.object_path=name and i.deleted_at is null and i.expires_at>now() and public.is_organization_owner(i.organization_id)));
grant select on public.whatsapp_private_images to authenticated;
create policy whatsapp_private_images_owner_read on public.whatsapp_private_images for select to authenticated
using(public.is_organization_owner(organization_id) and deleted_at is null and expires_at>now());

create function public.whatsapp_marketing_allowed(p_org uuid,p_customer uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select coalesce((select action='GRANTED' from public.consent_events
    where organization_id=p_org and customer_id=p_customer and kind='MARKETING'
    order by occurred_at desc,id desc limit 1),false)
$$;

create function public.whatsapp_default_marketing() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if new.auth_user_id is not null and (tg_op='INSERT' or old.auth_user_id is null)
    and not exists(select 1 from public.consent_events where organization_id=new.organization_id and customer_id=new.id and kind='MARKETING') then
    insert into public.consent_events(organization_id,customer_id,kind,action,source,proof,policy_version)
    values(new.organization_id,new.id,'MARKETING','GRANTED','CLIENT_ACCOUNT_DEFAULT',jsonb_build_object('default_enabled',true,'separate_preference',true),'client-access-2026-09');
  end if;
  return new;
end $$;
create trigger customers_whatsapp_default_marketing after insert or update of auth_user_id on public.customers
for each row execute function public.whatsapp_default_marketing();
-- No backfill: prior accounts and prior refusals are preserved.

create function public.whatsapp_capture_domain_event() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare kind text; version bigint;
begin
  if tg_table_name='appointments' then
    if tg_op='UPDATE' and new.status=old.status and new.version=old.version then return new; end if;
    kind:=case new.status when 'CONFIRMED' then 'appointment.confirmed' when 'CANCELED' then 'appointment.canceled' when 'COMPLETED' then 'appointment.completed' else 'appointment.updated' end;
    version:=new.version;
  elsif tg_table_name='customers' then kind:='customer.updated'; version:=(extract(epoch from clock_timestamp())*1000000)::bigint;
  else kind:='consent.updated'; version:=(extract(epoch from clock_timestamp())*1000000)::bigint; end if;
  insert into public.whatsapp_domain_events(organization_id,aggregate_id,aggregate_version,event_type)
  values(new.organization_id,new.id,version,kind) on conflict do nothing;
  if tg_table_name='consent_events' then
   if new.kind='MARKETING' and new.action='REVOKED' then
    update public.whatsapp_automation_jobs set status='CANCELED',last_error_code='MARKETING_REVOKED',updated_at=now()
    where organization_id=new.organization_id and customer_id=new.customer_id and custom_key is not null and status in ('PENDING','RETRY');
   end if;
  end if;
  return new;
end $$;
create trigger whatsapp_domain_appointment after insert or update on public.appointments for each row execute function public.whatsapp_capture_domain_event();
create trigger whatsapp_domain_customer after insert or update of full_name,phone_e164,birth_date on public.customers for each row execute function public.whatsapp_capture_domain_event();
create trigger whatsapp_domain_consent after insert on public.consent_events for each row execute function public.whatsapp_capture_domain_event();

create function public.whatsapp_custom_changed() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if new.enabled and not old.enabled then new.enabled_since:=now(); end if;
  if not new.enabled then
    update public.whatsapp_automation_jobs set status='CANCELED',last_error_code='AUTOMATION_DISABLED',updated_at=now()
    where organization_id=new.organization_id and custom_key=new.message_key and status in ('PENDING','RETRY');
    update public.whatsapp_campaigns set status='CANCELED' where organization_id=new.organization_id and message_key=new.message_key and status='SCHEDULED';
  end if;
  return new;
end $$;
create trigger whatsapp_custom_changed before update on public.whatsapp_custom_message_settings_v2 for each row execute function public.whatsapp_custom_changed();

-- Internal promotion only, after shadow review. No in-flight work can change engines.
create function public.set_whatsapp_runtime_engine(p_organization_id uuid,p_engine text) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  perform public.require_service_role();
  if p_engine not in ('LEGACY','SHADOW','ACTIVE') then raise exception 'INVALID_ENGINE'; end if;
  perform 1 from public.whatsapp_business_connections where organization_id=p_organization_id for update;
  if exists(select 1 from public.whatsapp_automation_jobs where organization_id=p_organization_id and status in ('PROCESSING','SEND_UNKNOWN'))
    or exists(select 1 from public.whatsapp_webhook_events_v2 where organization_id=p_organization_id and processing_status='PROCESSING') then raise exception 'RUNTIME_BUSY'; end if;
  if p_engine<>'ACTIVE' and exists(select 1 from public.whatsapp_automation_jobs where organization_id=p_organization_id and custom_key is not null and status in ('PENDING','RETRY')) then raise exception 'CUSTOM_JOBS_REQUIRE_RECONCILIATION'; end if;
  update public.whatsapp_automation_settings_v2 set runtime_engine=p_engine,runtime_changed_at=now() where organization_id=p_organization_id;
  insert into public.whatsapp_runtime_audit(organization_id,event_type,detail) values(p_organization_id,'ENGINE_CHANGED',jsonb_build_object('engine',p_engine));
end $$;

create function public.whatsapp_runtime_claim(p_worker text,p_limit integer default 10)
returns setof public.whatsapp_automation_jobs language plpgsql security definer set search_path=public,pg_temp as $$
declare conn record; job public.whatsapp_automation_jobs%rowtype;
begin
  perform public.require_service_role();
  -- Once transport started, an expired lease is uncertain, never automatically retried.
  update public.whatsapp_automation_jobs j set status=case when send_started_at is null then 'RETRY'::public.whatsapp_v2_job_status else 'SEND_UNKNOWN'::public.whatsapp_v2_job_status end,
    last_error_code='WORKER_LEASE_EXPIRED',locked_by=null,lease_token=null,lock_expires_at=null,updated_at=now()
  from public.whatsapp_automation_settings_v2 s where s.organization_id=j.organization_id and s.runtime_engine='ACTIVE' and j.status='PROCESSING' and j.lock_expires_at<now();
  update public.whatsapp_automation_jobs j set status='SKIPPED',last_error_code='DELIVERY_WINDOW_EXPIRED',updated_at=now()
  from public.whatsapp_automation_settings_v2 s where s.organization_id=j.organization_id and s.runtime_engine='ACTIVE' and j.status in ('PENDING','RETRY')
    and (j.valid_until<=now() or (j.job_type::text like 'REMINDER_%' and j.scheduled_for+interval '5 minutes'<=now()));
  for conn in select c.id from public.whatsapp_business_connections c join public.whatsapp_automation_settings_v2 s on s.organization_id=c.organization_id
    where c.provider='QR_WEB' and c.is_active and c.status='CONNECTED' and c.dispatch_after<=now() and s.runtime_engine='ACTIVE' and s.mode='ACTIVE' and not s.dispatch_paused
      and (c.runtime_server_id is null or exists(select 1 from public.whatsapp_runtime_servers rs where rs.id=c.runtime_server_id and rs.state='ACTIVE'))
      and not exists(select 1 from public.whatsapp_automation_jobs j where j.connection_id=c.id and j.status='PROCESSING')
      and exists(select 1 from public.whatsapp_automation_jobs j where j.connection_id=c.id and j.status in ('PENDING','RETRY') and j.next_attempt_at<=now() and j.scheduled_for<=now())
    order by case when exists(select 1 from public.whatsapp_automation_jobs urgent where urgent.connection_id=c.id and urgent.priority=0 and urgent.status in ('PENDING','RETRY') and urgent.next_attempt_at<=now() and urgent.scheduled_for<=now()) then 0 else 1 end,
      c.last_dispatch_at nulls first,c.id limit greatest(1,least(p_limit,25)) for update of c skip locked
  loop
    select * into job from public.whatsapp_automation_jobs j where j.connection_id=conn.id and j.status in ('PENDING','RETRY') and j.next_attempt_at<=now() and j.scheduled_for<=now()
    order by j.priority,j.next_attempt_at,j.id limit 1 for update skip locked;
    if found then
      update public.whatsapp_automation_jobs set status='PROCESSING',locked_by=p_worker,lease_token=gen_random_uuid(),locked_at=now(),lock_expires_at=now()+interval '90 seconds',send_started_at=null,updated_at=now()
      where id=job.id returning * into job;
      update public.whatsapp_business_connections set last_dispatch_at=now(),dispatch_after=now()+interval '5 seconds' where id=conn.id;
      return next job;
    end if;
  end loop;
end $$;

create function public.whatsapp_runtime_prepare(p_job_id uuid,p_token uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare j public.whatsapp_automation_jobs%rowtype; a public.appointments%rowtype; c public.customers%rowtype; tz text; reason text; setting public.whatsapp_custom_message_settings_v2%rowtype;
begin
  perform public.require_service_role();
  select * into j from public.whatsapp_automation_jobs where id=p_job_id for update;
  if j.id is null or j.status<>'PROCESSING' or j.lease_token is distinct from p_token or j.lock_expires_at<=now() then raise exception 'STALE_LEASE'; end if;
  if j.valid_until<=now() or (j.job_type::text like 'REMINDER_%' and j.scheduled_for+interval '5 minutes'<=now()) then reason:='DELIVERY_WINDOW_EXPIRED'; end if;
  if not exists(select 1 from public.whatsapp_automation_settings_v2 s join public.whatsapp_business_connections w on w.organization_id=s.organization_id
    where s.organization_id=j.organization_id and s.runtime_engine='ACTIVE' and s.mode='ACTIVE' and not s.dispatch_paused and w.id=j.connection_id and w.is_active and w.status='CONNECTED') then reason:='CONNECTION_OR_AUTOMATION_PAUSED'; end if;
  if exists(select 1 from public.whatsapp_automation_settings_v2 s where s.organization_id=j.organization_id and not case j.job_type::text
    when 'BOOKING_CREATED_CLIENT' then s.booking_client_enabled
    when 'BOOKING_CREATED_STAFF' then s.booking_staff_enabled and s.staff_notifications_enabled
    when 'REMINDER_MORNING_CLIENT' then s.reminder_morning_enabled
    when 'REMINDER_T180_CLIENT' then s.reminder_t180_enabled
    when 'REMINDER_T45_CLIENT' then s.reminder_t45_enabled
    when 'APPOINTMENT_CONFIRMED_STAFF' then s.staff_notifications_enabled
    when 'APPOINTMENT_CANCELED_STAFF' then s.staff_notifications_enabled
    else true end) then reason:='AUTOMATION_DISABLED'; end if;
  if j.appointment_id is not null then
    select * into a from public.appointments where id=j.appointment_id and organization_id=j.organization_id;
    if j.job_type::text like 'REMINDER_%' or j.job_type::text like 'BOOKING_CREATED_%' then
      if a.id is null or a.version is distinct from j.appointment_version or a.status<>'CONFIRMED' or lower(a.service_period)<=now() then reason:='APPOINTMENT_CHANGED'; end if;
    end if;
    if j.job_type::text like '%_CLIENT' or j.payload->>'message_kind'='MANUAL_CONFIRMATION_CLIENT' then
      if not public.whatsapp_v2_consented(j.organization_id,a.customer_id) then reason:='TRANSACTIONAL_REVOKED'; end if;
      select * into c from public.customers where id=a.customer_id and organization_id=j.organization_id;
      if c.phone_e164 is distinct from j.recipient_e164 then reason:='RECIPIENT_CHANGED'; end if;
    end if;
  end if;
  if j.dedupe_key like 'campaign:%' and exists(select 1 from public.whatsapp_campaigns ca where ca.id::text=split_part(j.dedupe_key,':',2) and ca.organization_id=j.organization_id and ca.status='CANCELED') then reason:='CAMPAIGN_CANCELED'; end if;
  if j.custom_key is not null then
    -- Serialize quotas across concurrent jobs for this customer.
    select * into c from public.customers where id=j.customer_id and organization_id=j.organization_id for update;
    select timezone into tz from public.organizations where id=j.organization_id;
    select * into setting from public.whatsapp_custom_message_settings_v2 where organization_id=j.organization_id and message_key=j.custom_key;
    if not coalesce(setting.enabled,false) then reason:='AUTOMATION_DISABLED'; end if;
    if not public.whatsapp_marketing_allowed(j.organization_id,j.customer_id) then reason:='MARKETING_REVOKED'; end if;
    if c.id is null or not c.active or c.phone_e164 is distinct from j.recipient_e164 then reason:='RECIPIENT_CHANGED'; end if;
    if exists(select 1 from public.whatsapp_automation_jobs x where x.organization_id=j.organization_id and x.customer_id=j.customer_id and x.id<>j.id and x.custom_key is not null and x.send_started_at is not null and x.status in ('PROCESSING','SUBMITTED','DELIVERED','READ','SEND_UNKNOWN') and (x.send_started_at at time zone tz)::date=(now() at time zone tz)::date)
      or (select count(*) from public.whatsapp_automation_jobs x where x.organization_id=j.organization_id and x.customer_id=j.customer_id and x.id<>j.id and x.custom_key is not null and x.send_started_at is not null and x.status in ('PROCESSING','SUBMITTED','DELIVERED','READ','SEND_UNKNOWN') and x.send_started_at>=date_trunc('week',now() at time zone tz) at time zone tz)>=2 then reason:='FREQUENCY_LIMIT'; end if;
    if j.custom_key like 'AFTER_SERVICE_%' and (exists(select 1 from public.appointments x where x.organization_id=j.organization_id and x.customer_id=j.customer_id and ((x.status='CONFIRMED' and lower(x.service_period)>now()) or (x.status='COMPLETED' and coalesce((select max(se.created_at) from public.appointment_status_events se where se.organization_id=x.organization_id and se.appointment_id=x.id and se.to_status='COMPLETED'),upper(x.service_period))>(j.payload->>'completed_at')::timestamptz)))) then reason:='CUSTOMER_RETURNED_OR_BOOKED'; end if;
  end if;
  if reason is not null then
    update public.whatsapp_automation_jobs set status='SKIPPED',last_error_code=reason,locked_by=null,lease_token=null,lock_expires_at=null,updated_at=now() where id=j.id;
    return jsonb_build_object('ready',false,'reason',reason);
  end if;
  if j.job_type::text like 'REMINDER_%' then perform public.create_whatsapp_v2_confirmation_request(j.id,j.locked_by); end if;
  return jsonb_build_object('ready',true);
end $$;

create function public.whatsapp_runtime_start_send(p_job_id uuid,p_token uuid) returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
begin
  perform public.require_service_role();
  if not coalesce((public.whatsapp_runtime_prepare(p_job_id,p_token)->>'ready')::boolean,false) then return false; end if;
  update public.whatsapp_automation_jobs set send_started_at=now(),attempt_count=attempt_count+1,lock_expires_at=now()+interval '90 seconds'
  where id=p_job_id and lease_token=p_token and status='PROCESSING' and lock_expires_at>now();
  return found;
end $$;

create function public.whatsapp_runtime_finish(p_job_id uuid,p_token uuid,p_outcome text,p_body text,p_provider_id text default null,p_error text default null)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare j public.whatsapp_automation_jobs%rowtype; state public.whatsapp_v2_job_status;
begin
  perform public.require_service_role();
  select * into j from public.whatsapp_automation_jobs where id=p_job_id for update;
  if j.id is null or j.status<>'PROCESSING' or j.lease_token is distinct from p_token or j.lock_expires_at<=now() then return false; end if;
  if p_outcome not in ('SUBMITTED','RETRY','FAILED','SEND_UNKNOWN') then raise exception 'INVALID_OUTCOME'; end if;
  if p_outcome='SUBMITTED' and nullif(p_provider_id,'') is null then raise exception 'PROVIDER_ID_REQUIRED'; end if;
  state:=p_outcome::public.whatsapp_v2_job_status;
  if state='RETRY' and j.attempt_count>=j.max_attempts then state:='DEAD_LETTER'; end if;
  if state='SUBMITTED' then
    if exists(select 1 from public.whatsapp_messages_v2 where connection_id=j.connection_id and provider_message_id=p_provider_id and job_id is distinct from j.id) then raise exception 'PROVIDER_ID_ALREADY_ASSIGNED'; end if;
    perform public.record_whatsapp_v2_outbound_message(j.id,p_provider_id,p_body);
    update public.whatsapp_confirmation_requests_v2 set provider_message_id=p_provider_id where id=j.confirmation_request_id;
    if exists(select 1 from public.whatsapp_delivery_receipts where connection_id=j.connection_id and provider_message_id=p_provider_id and status='READ') then state:='READ';
    elsif exists(select 1 from public.whatsapp_delivery_receipts where connection_id=j.connection_id and provider_message_id=p_provider_id and status='DELIVERED') then state:='DELIVERED';
    elsif exists(select 1 from public.whatsapp_delivery_receipts where connection_id=j.connection_id and provider_message_id=p_provider_id and status='FAILED') then state:='FAILED'; end if;
    update public.whatsapp_messages_v2 set status=state::text::public.whatsapp_message_status where job_id=j.id;
  end if;
  update public.whatsapp_automation_jobs set status=state,provider_message_id=coalesce(p_provider_id,provider_message_id),
    submitted_at=case when p_outcome='SUBMITTED' then now() else submitted_at end,
    next_attempt_at=now()+make_interval(secs=>least(300,(power(2,j.attempt_count)*5)::integer)+floor(random()*5)::integer),
    last_error_code=p_error,locked_by=null,lease_token=null,lock_expires_at=null,updated_at=now() where id=j.id;
  return true;
end $$;

create function public.whatsapp_runtime_receipt(p_connection_id uuid,p_provider_id text,p_status text) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare org uuid;
begin
  perform public.require_service_role();
  select organization_id into strict org from public.whatsapp_business_connections where id=p_connection_id;
  insert into public.whatsapp_delivery_receipts(organization_id,connection_id,provider_message_id,status) values(org,p_connection_id,p_provider_id,p_status) on conflict do nothing;
  update public.whatsapp_automation_jobs set status=p_status::public.whatsapp_v2_job_status,
    delivered_at=case when p_status in ('DELIVERED','READ') then coalesce(delivered_at,now()) else delivered_at end,
    read_at=case when p_status='READ' then coalesce(read_at,now()) else read_at end,updated_at=now()
  where connection_id=p_connection_id and provider_message_id=p_provider_id
    and (case status::text when 'READ' then 4 when 'DELIVERED' then 3 when 'FAILED' then 2 when 'SUBMITTED' then 1 else 0 end)<(case p_status when 'READ' then 4 when 'DELIVERED' then 3 when 'SUBMITTED' then 1 else 2 end);
  update public.whatsapp_messages_v2 set status=p_status::public.whatsapp_message_status,updated_at=now()
  where connection_id=p_connection_id and provider_message_id=p_provider_id
    and (case status::text when 'READ' then 4 when 'DELIVERED' then 3 when 'FAILED' then 2 when 'SUBMITTED' then 1 else 0 end)<(case p_status when 'READ' then 4 when 'DELIVERED' then 3 when 'SUBMITTED' then 1 else 2 end);
end $$;

-- Compatibility adapters.
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
      and s.mode = 'ACTIVE' and s.runtime_engine <> 'ACTIVE'
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

create or replace function public.claim_whatsapp_v2_webhook_events(
  p_limit integer,
  p_worker_id text,
  p_lease_seconds integer
)
returns setof public.whatsapp_webhook_events_v2
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.require_service_role();
  return query
  with due as (
    select id
    from public.whatsapp_webhook_events_v2
    where (processing_status in ('RECEIVED', 'FAILED') or (processing_status = 'PROCESSING' and lock_expires_at < now()))
      and not exists(select 1 from public.whatsapp_automation_settings_v2 s where s.organization_id=whatsapp_webhook_events_v2.organization_id and s.runtime_engine='ACTIVE')
    order by received_at, id
    limit greatest(1, least(p_limit, 50))
    for update skip locked
  )
  update public.whatsapp_webhook_events_v2 e
  set processing_status = 'PROCESSING',
      attempt_count = attempt_count + 1,
      locked_at = now(),
      locked_by = p_worker_id,
      lock_expires_at = now() + make_interval(secs => greatest(30, least(p_lease_seconds, 300)))
  from due
  where e.id = due.id
  returning e.*;
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

  if v_restarted then
    perform public.restart_whatsapp_v2_after_qr_connection(v_connection.id, v_epoch);
  end if;
  return true;
end;
$$;

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
    set mode = public.whatsapp_automation_settings_v2.mode,
        dispatch_paused = public.whatsapp_automation_settings_v2.dispatch_paused,
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

create function public.whatsapp_runtime_claim_events(p_worker text,p_limit integer default 10)
returns setof public.whatsapp_webhook_events_v2 language plpgsql security definer set search_path=public,pg_temp as $$
begin
 perform public.require_service_role();
 update public.whatsapp_webhook_events_v2 set processing_status='DEAD',last_error='EVENT_ATTEMPTS_EXHAUSTED',processed_at=now() where attempt_count>=5 and processing_status='PROCESSING' and lock_expires_at<now();
 return query with due as (
  select e.id from public.whatsapp_webhook_events_v2 e join public.whatsapp_automation_settings_v2 s using(organization_id)
  where s.runtime_engine='ACTIVE' and e.attempt_count<5 and e.next_attempt_at<=now()
   and (e.processing_status in ('RECEIVED','FAILED') or (e.processing_status='PROCESSING' and e.lock_expires_at<now()))
  order by e.received_at,e.id limit greatest(1,least(p_limit,25)) for update of e skip locked
 ) update public.whatsapp_webhook_events_v2 e set processing_status='PROCESSING',attempt_count=attempt_count+1,
   lease_token=gen_random_uuid(),locked_by=p_worker,locked_at=now(),lock_expires_at=now()+interval '90 seconds'
 from due where e.id=due.id returning e.*;
end $$;

create function public.whatsapp_runtime_event_finish(p_event_id uuid,p_token uuid,p_error text default null) returns boolean
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 perform public.require_service_role();
 update public.whatsapp_webhook_events_v2 set processing_status=case when p_error is null then 'COMPLETED' when attempt_count>=5 then 'DEAD' else 'FAILED' end,
  last_error=p_error,processed_at=now(),locked_by=null,lease_token=null,lock_expires_at=null,
  next_attempt_at=now()+make_interval(secs=>least(300,attempt_count*attempt_count*10))
 where id=p_event_id and lease_token=p_token and processing_status='PROCESSING' and lock_expires_at>now();
 return found;
end $$;

create function public.schedule_whatsapp_campaign(p_organization_id uuid,p_id uuid,p_message_key text,p_body text,p_scheduled_for timestamptz,p_customer_ids uuid[] default null)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare tz text; local_time time;
begin
 if not public.is_organization_owner(p_organization_id) then raise exception using errcode='42501',message='OWNER_REQUIRED'; end if;
 if not exists(select 1 from public.whatsapp_automation_settings_v2 where organization_id=p_organization_id and runtime_engine='ACTIVE') then raise exception 'RUNTIME_NOT_READY'; end if;
 select timezone into strict tz from public.organizations where id=p_organization_id;
 local_time:=(p_scheduled_for at time zone tz)::time;
 if p_id is null or p_scheduled_for is null or p_scheduled_for<=now() or local_time<time '09:00' or local_time>=time '18:00' then raise exception 'CAMPAIGN_WINDOW_INVALID'; end if;
 if p_message_key not in ('SPECIAL_DATES','MARKETING_CAMPAIGNS') or length(btrim(p_body)) not between 1 and 4096 then raise exception 'CAMPAIGN_INVALID'; end if;
 if not exists(select 1 from public.whatsapp_custom_message_settings_v2 where organization_id=p_organization_id and message_key=p_message_key and enabled) then raise exception 'AUTOMATION_DISABLED'; end if;
 if p_customer_ids is not null and (cardinality(p_customer_ids)=0 or exists(select 1 from unnest(p_customer_ids) cid where not exists(select 1 from public.customers where id=cid and organization_id=p_organization_id))) then raise exception 'INVALID_CAMPAIGN_AUDIENCE'; end if;
 insert into public.whatsapp_campaigns(id,organization_id,message_key,body,scheduled_for,customer_ids) values(p_id,p_organization_id,p_message_key,p_body,p_scheduled_for,p_customer_ids)
 on conflict(id) do nothing;
 if not exists(select 1 from public.whatsapp_campaigns where id=p_id and organization_id=p_organization_id and body=p_body and scheduled_for=p_scheduled_for and customer_ids is not distinct from p_customer_ids and message_key=p_message_key) then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
 return p_id;
end $$;

create function public.whatsapp_runtime_schedule(p_limit integer default 500) returns integer
language plpgsql security definer set search_path=public,pg_temp as $$
declare amount integer;
begin
 perform public.require_service_role();
 -- One bounded scheduler; scans use customer/appointment indexes and dedupe keys.
 if not pg_try_advisory_xact_lock(hashtextextended('whatsapp-runtime-scheduler',0)) then return 0; end if;
 insert into public.whatsapp_runtime_health(id) values(true) on conflict do nothing;
 update public.whatsapp_runtime_health set last_schedule_at=now()
 where id=true and (last_schedule_at is null or last_schedule_at<=now()-interval '30 seconds');
 if not found then return 0; end if;
 with active as (
  select s.organization_id,w.id connection_id,o.timezone,(now() at time zone o.timezone)::date today
  from public.whatsapp_automation_settings_v2 s join public.organizations o on o.id=s.organization_id
  join public.whatsapp_business_connections w on w.organization_id=s.organization_id and w.provider='QR_WEB' and w.is_active
  where s.runtime_engine='ACTIVE' and s.mode='ACTIVE' and not s.dispatch_paused
 ), candidates as (
  select ac.*,c.id customer_id,c.full_name,c.phone_e164,m.message_key,m.body,
   (ac.today+time '09:00') at time zone ac.timezone scheduled,
   case when m.message_key='BIRTHDAY' then 10 else 20 end priority,
   last_service.completed_at,
   'custom:'||c.id||':'||m.message_key||':'||ac.today dedupe
  from active ac join public.customers c on c.organization_id=ac.organization_id
  join public.whatsapp_custom_message_settings_v2 m on m.organization_id=ac.organization_id and m.enabled
  left join lateral (select coalesce((select max(se.created_at) from public.appointment_status_events se where se.organization_id=a.organization_id and se.appointment_id=a.id and se.to_status='COMPLETED'),upper(a.service_period)) completed_at from public.appointments a where a.organization_id=c.organization_id and a.customer_id=c.id and a.status='COMPLETED' order by completed_at desc limit 1) last_service on true
  where c.active and c.phone_e164 is not null and public.whatsapp_marketing_allowed(c.organization_id,c.id)
    and (ac.today+time '09:00') at time zone ac.timezone>=m.enabled_since
    and ((m.message_key='BIRTHDAY' and to_char(c.birth_date,'MM-DD')=to_char(ac.today,'MM-DD'))
      or (m.message_key in ('AFTER_SERVICE_14D','AFTER_SERVICE_28D','AFTER_SERVICE_40D') and ac.today-(last_service.completed_at at time zone ac.timezone)::date=case m.message_key when 'AFTER_SERVICE_14D' then 14 when 'AFTER_SERVICE_28D' then 28 else 40 end))
  union all
  select ac.*,c.id,c.full_name,c.phone_e164,ca.message_key,ca.body,ca.scheduled_for,30,null::timestamptz,'campaign:'||ca.id||':'||c.id
  from active ac join public.whatsapp_campaigns ca on ca.organization_id=ac.organization_id and ca.status='SCHEDULED'
  join public.customers c on c.organization_id=ac.organization_id and (ca.customer_ids is null or c.id=any(ca.customer_ids))
  join public.whatsapp_custom_message_settings_v2 m on m.organization_id=ac.organization_id and m.message_key=ca.message_key and m.enabled
  where c.active and c.phone_e164 is not null and public.whatsapp_marketing_allowed(c.organization_id,c.id)
 ), due as (
  select * from candidates x where x.scheduled<=now() and now()<((x.scheduled at time zone x.timezone)::date+time '18:00') at time zone x.timezone
   and not exists(select 1 from public.whatsapp_automation_jobs j where j.organization_id=x.organization_id and j.dedupe_key=x.dedupe)
  order by priority,scheduled,customer_id limit greatest(1,least(p_limit,1000))
 ) insert into public.whatsapp_automation_jobs(organization_id,connection_id,customer_id,custom_key,priority,job_type,recipient_e164,payload,scheduled_for,next_attempt_at,valid_until,dedupe_key)
 select organization_id,connection_id,customer_id,message_key,priority,'MANUAL_OUTBOUND_TEXT',phone_e164,
  jsonb_build_object('schema_version',1,'custom_key',message_key,'body',body,'customer_name',full_name,'completed_at',completed_at,'timezone',timezone),
  scheduled,scheduled,((scheduled at time zone timezone)::date+time '18:00') at time zone timezone,dedupe from due on conflict do nothing;
 get diagnostics amount=row_count;
 return amount;
end $$;

create function public.get_whatsapp_runtime_status(p_organization_id uuid) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 if not public.is_organization_owner(p_organization_id) then raise exception using errcode='42501',message='OWNER_REQUIRED'; end if;
 return jsonb_build_object('ready',coalesce((select runtime_engine='ACTIVE' from public.whatsapp_automation_settings_v2 where organization_id=p_organization_id),false),
 'pending',(select count(*) from public.whatsapp_automation_jobs where organization_id=p_organization_id and status in ('PENDING','RETRY','PROCESSING')),
 'failed',(select count(*) from public.whatsapp_automation_jobs where organization_id=p_organization_id and status in ('SEND_UNKNOWN','DEAD_LETTER','FAILED')),
 'campaigns',coalesce((select jsonb_agg(jsonb_build_object('id',id,'message_key',message_key,'scheduled_for',scheduled_for,'status',status)) from (select * from public.whatsapp_campaigns where organization_id=p_organization_id order by created_at desc limit 20) x),'[]'::jsonb));
end $$;

create function public.whatsapp_runtime_store_image(p_event_id uuid,p_token uuid,p_mime text,p_size integer) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare e public.whatsapp_webhook_events_v2%rowtype;
begin
 perform public.require_service_role();
 select * into e from public.whatsapp_webhook_events_v2 where id=p_event_id for update;
 if e.id is null or e.processing_status<>'PROCESSING' or e.lease_token is distinct from p_token or e.lock_expires_at<=now() then raise exception 'STALE_LEASE'; end if;
 if e.received_at+interval '7 days'<=now() then raise exception 'MEDIA_EXPIRED'; end if;
 insert into public.whatsapp_private_images(id,organization_id,connection_id,event_id,object_path,mime_type,byte_size,expires_at)
 values(e.id,e.organization_id,e.connection_id,e.id,e.organization_id||'/'||e.id,p_mime,p_size,e.received_at+interval '7 days') on conflict(event_id) do nothing;
 return e.id;
end $$;

create or replace function public.whatsapp_runtime_apply_request(
  p_gateway_instance_id text,
  p_sender_e164 text,
  p_external_message_id text,
  p_action text,
  p_request_id uuid
)
returns jsonb language plpgsql security definer
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
begin
  perform public.require_service_role();
  select * into v_connection from public.whatsapp_business_connections
  where provider='QR_WEB' and gateway_instance_id=p_gateway_instance_id and is_active and status='CONNECTED'
  for update;
  if not found then return jsonb_build_object('processed',false,'reason','UNKNOWN_CONNECTION'); end if;

  select r.* into v_request from public.whatsapp_confirmation_requests_v2 r
    join public.appointments a on a.id=r.appointment_id and a.organization_id=r.organization_id
    join public.customers c on c.id=a.customer_id and c.organization_id=a.organization_id
    where r.id=p_request_id and r.connection_id=v_connection.id and r.status='PENDING' and r.expires_at>now()
      and a.version=r.appointment_version and a.status='CONFIRMED' and lower(a.service_period)>now()
      and public.whatsapp_v2_consented(a.organization_id,c.id)
      and public.whatsapp_v2_phone_matches(c.phone_e164,p_sender_e164) for update of r;
  if v_request.id is null then return jsonb_build_object('processed',false,'reason','NO_ACTIVE_REQUEST'); end if;
  select * into v_appointment from public.appointments
  where id=v_request.appointment_id and organization_id=v_request.organization_id for update;

  if v_action='INVALID' then
    update public.whatsapp_confirmation_requests_v2
    set invalid_reply_count=invalid_reply_count+1,updated_at=now()
    where id=v_request.id returning invalid_reply_count into v_invalid_count;
    if v_invalid_count<=2 then
      insert into public.whatsapp_automation_jobs (organization_id,connection_id,appointment_id,appointment_version,confirmation_request_id,job_type,recipient_e164,payload,valid_until,dedupe_key)
      values (v_appointment.organization_id,v_connection.id,v_appointment.id,v_appointment.version,v_request.id,'MANUAL_OUTBOUND_TEXT',p_sender_e164,jsonb_build_object('message_kind','INVALID_REPLY_PROMPT'),lower(v_appointment.service_period),'v2:'||v_request.id||':invalid:'||v_invalid_count)
      on conflict (organization_id,dedupe_key) do nothing;
      return jsonb_build_object('processed',true,'action','INVALID_PROMPT','attempt',v_invalid_count);
    end if;
    v_action:='ATTENDANT';
  end if;

  if v_action='ATTENDANT' then
    select manager_notification_phone_e164 into v_manager_phone
    from public.whatsapp_automation_settings_v2
    where organization_id=v_appointment.organization_id;
    if v_manager_phone is null then return jsonb_build_object('processed',false,'reason','MANAGER_NOTIFICATION_PHONE_UNAVAILABLE'); end if;
    select coalesce(string_agg(ai.service_name_snapshot,', ' order by ai.position),'Serviço não informado') into v_service_names
    from public.appointment_items ai where ai.appointment_id=v_appointment.id and ai.organization_id=v_appointment.organization_id;
    update public.whatsapp_confirmation_requests_v2
    set status='EXPIRED',responded_at=now(),response_message_id=p_external_message_id,response_action='ATTENDANT',updated_at=now()
    where id=v_request.id;
    update public.appointments
    set whatsapp_response_status='CONTACT_REQUESTED_BY_WHATSAPP',updated_at=now()
    where id=v_appointment.id and organization_id=v_appointment.organization_id;
    insert into public.appointment_status_events (organization_id,appointment_id,from_status,to_status,reason,metadata)
    values (v_appointment.organization_id,v_appointment.id,v_appointment.status,v_appointment.status,'whatsapp_contact_requested',jsonb_build_object('confirmation_request_id',v_request.id,'phase',v_request.phase));
    insert into public.whatsapp_automation_jobs (organization_id,connection_id,appointment_id,appointment_version,confirmation_request_id,job_type,recipient_e164,payload,valid_until,dedupe_key)
    values (v_appointment.organization_id,v_connection.id,v_appointment.id,v_appointment.version,v_request.id,'MANUAL_OUTBOUND_TEXT',v_manager_phone,
      jsonb_build_object('message_kind','ATTENDANT_REQUEST_MANAGER','customer_name',(select full_name from public.customers where id=v_appointment.customer_id),'customer_phone',p_sender_e164,'barber_name',(select display_name from public.barbers where id=v_appointment.barber_id and organization_id=v_appointment.organization_id),'service_names',v_service_names,'starts_at',lower(v_appointment.service_period),'timezone',(select timezone from public.organizations where id=v_appointment.organization_id)),
      lower(v_appointment.service_period),'v2:'||v_request.id||':attendant') on conflict (organization_id,dedupe_key) do nothing;
    return jsonb_build_object('processed',true,'action','ATTENDANT','request_id',v_request.id);
  end if;

  if v_action not in ('CONFIRM','CANCEL') then return jsonb_build_object('processed',false,'reason','UNSUPPORTED_ACTION'); end if;
  update public.whatsapp_confirmation_requests_v2
  set status=case when v_action='CONFIRM' then 'CONFIRMED'::public.whatsapp_confirmation_status else 'CANCELED'::public.whatsapp_confirmation_status end,
      responded_at=now(),response_message_id=p_external_message_id,response_action=v_action,updated_at=now()
  where id=v_request.id;
  if v_action='CONFIRM' then
    update public.appointments
    set whatsapp_presence_status='CONFIRMED',whatsapp_presence_confirmed_at=coalesce(whatsapp_presence_confirmed_at,now()),whatsapp_response_status='CONFIRMED_BY_WHATSAPP',updated_at=now()
    where id=v_appointment.id and organization_id=v_appointment.organization_id;
    insert into public.appointment_status_events (organization_id,appointment_id,from_status,to_status,reason,metadata)
    values (v_appointment.organization_id,v_appointment.id,'CONFIRMED','CONFIRMED','whatsapp_presence_confirmed',jsonb_build_object('confirmation_request_id',v_request.id,'phase',v_request.phase,'whatsapp_response_status','CONFIRMED_BY_WHATSAPP'));
    insert into public.whatsapp_automation_jobs (organization_id,connection_id,appointment_id,appointment_version,job_type,recipient_e164,payload,valid_until,dedupe_key)
    values (v_appointment.organization_id,v_connection.id,v_appointment.id,v_appointment.version,'CONFIRMATION_ACK_CLIENT',p_sender_e164,jsonb_build_object('customer_name',(select full_name from public.customers where id=v_appointment.customer_id),'starts_at',lower(v_appointment.service_period),'timezone',(select timezone from public.organizations where id=v_appointment.organization_id)),lower(v_appointment.service_period),'v2:'||v_request.id||':confirm:ack') on conflict (organization_id,dedupe_key) do nothing;
    insert into public.whatsapp_automation_jobs (organization_id,connection_id,appointment_id,appointment_version,job_type,recipient_e164,payload,valid_until,dedupe_key)
    select v_appointment.organization_id,v_connection.id,v_appointment.id,v_appointment.version,'APPOINTMENT_CONFIRMED_STAFF',b.whatsapp_e164,jsonb_build_object('customer_name',(select full_name from public.customers where id=v_appointment.customer_id),'starts_at',lower(v_appointment.service_period),'timezone',(select timezone from public.organizations where id=v_appointment.organization_id)),lower(v_appointment.service_period),'v2:'||v_request.id||':confirm:staff' from public.barbers b where b.id=v_appointment.barber_id and b.organization_id=v_appointment.organization_id and b.whatsapp_e164 is not null on conflict (organization_id,dedupe_key) do nothing;
  else
    perform public.cancel_appointment(v_appointment.id,'Cancelado pelo cliente via WhatsApp',true);
    update public.appointments
    set cancellation_source='WHATSAPP_CLIENT',cancelled_at=now(),whatsapp_response_status='CANCELED_BY_WHATSAPP'
    where id=v_appointment.id and organization_id=v_appointment.organization_id;
    insert into public.appointment_status_events (organization_id,appointment_id,from_status,to_status,reason,metadata)
    values (v_appointment.organization_id,v_appointment.id,'CANCELED','CANCELED','whatsapp_canceled',jsonb_build_object('confirmation_request_id',v_request.id,'phase',v_request.phase,'whatsapp_response_status','CANCELED_BY_WHATSAPP'));
    insert into public.whatsapp_automation_jobs (organization_id,connection_id,appointment_id,appointment_version,job_type,recipient_e164,payload,dedupe_key)
    values (v_appointment.organization_id,v_connection.id,v_appointment.id,v_appointment.version,'CANCELLATION_ACK_CLIENT',p_sender_e164,jsonb_build_object('customer_name',(select full_name from public.customers where id=v_appointment.customer_id)),'v2:'||v_request.id||':cancel:ack') on conflict (organization_id,dedupe_key) do nothing;
    insert into public.whatsapp_automation_jobs (organization_id,connection_id,appointment_id,appointment_version,job_type,recipient_e164,payload,dedupe_key)
    select v_appointment.organization_id,v_connection.id,v_appointment.id,v_appointment.version,'APPOINTMENT_CANCELED_STAFF',b.whatsapp_e164,jsonb_build_object('customer_name',(select full_name from public.customers where id=v_appointment.customer_id)),'v2:'||v_request.id||':cancel:staff' from public.barbers b where b.id=v_appointment.barber_id and b.organization_id=v_appointment.organization_id and b.whatsapp_e164 is not null on conflict (organization_id,dedupe_key) do nothing;
  end if;
  return jsonb_build_object('processed',true,'appointment_id',v_appointment.id,'action',v_action,'request_id',v_request.id);
end;
$$;

create table public.whatsapp_reply_choices (
 organization_id uuid not null references public.organizations(id), connection_id uuid not null references public.whatsapp_business_connections(id),
 phone_e164 text not null, request_ids uuid[] not null, action text not null, expires_at timestamptz not null,
 primary key(connection_id,phone_e164)
);
alter table public.whatsapp_reply_choices enable row level security;
revoke all on public.whatsapp_reply_choices from public,anon,authenticated;
grant select,insert,update,delete on public.whatsapp_reply_choices to service_role;

create function public.whatsapp_runtime_process_event(p_event_id uuid,p_token uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare e public.whatsapp_webhook_events_v2%rowtype; ids uuid[]; selected uuid; action text; input text; sender text; prompt text; choice public.whatsapp_reply_choices%rowtype; result jsonb;
begin
 perform public.require_service_role();
 select * into e from public.whatsapp_webhook_events_v2 where id=p_event_id for update;
 if e.id is null or e.processing_status<>'PROCESSING' or e.lease_token is distinct from p_token or e.lock_expires_at<=now() then raise exception 'STALE_LEASE'; end if;
 perform 1 from public.whatsapp_business_connections where id=e.connection_id for update;
 if e.payload->>'receipt' is not null then
   perform public.whatsapp_runtime_receipt(e.connection_id,e.provider_event_id,e.payload->>'receipt');
 elsif e.payload->>'text' is not null and e.payload->>'sender_e164' is not null and not coalesce((e.payload->>'from_me')::boolean,false) then
   sender:=e.payload->>'sender_e164'; input:=btrim(e.payload->>'text');
   perform public.record_whatsapp_v2_inbound_message(e.connection_id,sender,e.provider_event_id,input);
   select array_agg(r.id order by lower(a.service_period),r.id) into ids
   from public.whatsapp_confirmation_requests_v2 r
   join public.appointments a on a.id=r.appointment_id and a.organization_id=r.organization_id
   join public.customers c on c.id=a.customer_id and c.organization_id=a.organization_id
   where r.connection_id=e.connection_id and r.organization_id=e.organization_id and r.status='PENDING' and r.expires_at>now()
     and a.status='CONFIRMED' and a.version=r.appointment_version and lower(a.service_period)>now()
     and public.whatsapp_v2_phone_matches(c.phone_e164,sender) and public.whatsapp_v2_consented(a.organization_id,c.id);
   action:=case input when '1' then 'CONFIRM' when '2' then 'CANCEL' when '3' then 'ATTENDANT' else 'INVALID' end;
   if e.payload->>'quoted_id' is not null then
     select id into selected from public.whatsapp_confirmation_requests_v2 where id=any(ids) and provider_message_id=e.payload->>'quoted_id';
   elsif input ~* '^RESERVA [0-9]{1,2}$' then
     select * into choice from public.whatsapp_reply_choices where connection_id=e.connection_id and phone_e164=sender and expires_at>now() for update;
     selected:=choice.request_ids[split_part(input,' ',2)::integer]; action:=choice.action;
     if selected is not null and not selected=any(ids) then selected:=null; end if;
   elsif cardinality(ids)=1 then selected:=ids[1]; end if;
   if selected is not null then
     result:=public.whatsapp_runtime_apply_request(e.payload->>'gateway_instance_id',sender,e.provider_event_id,action,selected);
     delete from public.whatsapp_reply_choices where connection_id=e.connection_id and phone_e164=sender;
   elsif cardinality(ids)>1 and action in ('CONFIRM','CANCEL','ATTENDANT') then
     ids:=ids[1:20];
     insert into public.whatsapp_reply_choices(organization_id,connection_id,phone_e164,request_ids,action,expires_at)
     values(e.organization_id,e.connection_id,sender,ids,action,now()+interval '5 minutes')
     on conflict(connection_id,phone_e164) do update set request_ids=excluded.request_ids,action=excluded.action,expires_at=excluded.expires_at;
     select 'Qual reserva? Responda RESERVA e o número abaixo.'||chr(10)||string_agg(u.ordinality||' — '||to_char(lower(a.service_period) at time zone o.timezone,'DD/MM HH24:MI'),chr(10) order by u.ordinality)
     into prompt from unnest(ids) with ordinality u(id,ordinality) join public.whatsapp_confirmation_requests_v2 r on r.id=u.id join public.appointments a on a.id=r.appointment_id and a.organization_id=r.organization_id join public.organizations o on o.id=a.organization_id;
     insert into public.whatsapp_automation_jobs(organization_id,connection_id,job_type,recipient_e164,payload,valid_until,dedupe_key)
     values(e.organization_id,e.connection_id,'MANUAL_OUTBOUND_TEXT',sender,jsonb_build_object('message_kind','RESERVATION_CHOICE','body',prompt),now()+interval '5 minutes','choice:'||e.id) on conflict do nothing;
     result:=jsonb_build_object('processed',true,'action','CHOICE_REQUIRED');
   else result:=jsonb_build_object('processed',false,'reason','NO_UNAMBIGUOUS_REQUEST'); end if;
 end if;
 perform public.whatsapp_runtime_event_finish(e.id,p_token,null);
 return coalesce(result,jsonb_build_object('processed',true));
end $$;

-- Explicit grants on every newly introduced SECURITY DEFINER function.
do $$ declare f record; begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and (p.proname like 'whatsapp_runtime_%' or p.proname in ('whatsapp_marketing_allowed','whatsapp_default_marketing','whatsapp_capture_domain_event','whatsapp_custom_changed','set_whatsapp_runtime_engine','schedule_whatsapp_campaign','get_whatsapp_runtime_status'))
 loop
  execute format('revoke all on function %s from public,anon,authenticated',f.signature);
  execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $$;
grant execute on function public.schedule_whatsapp_campaign(uuid,uuid,text,text,timestamptz,uuid[]) to authenticated;
grant execute on function public.get_whatsapp_runtime_status(uuid) to authenticated;
notify pgrst,'reload schema';

create table public.whatsapp_runtime_health(id boolean primary key default true check(id),last_tick_at timestamptz,last_schedule_at timestamptz,last_worker text);
alter table public.whatsapp_runtime_health enable row level security;
revoke all on public.whatsapp_runtime_health from public,anon,authenticated;
grant all on public.whatsapp_runtime_health to service_role;
create function public.whatsapp_runtime_heartbeat(p_worker text) returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin perform public.require_service_role(); insert into public.whatsapp_runtime_health(id,last_tick_at,last_worker) values(true,now(),p_worker) on conflict(id) do update set last_tick_at=excluded.last_tick_at,last_worker=excluded.last_worker; end $$;
create function public.whatsapp_runtime_expired_images() returns setof public.whatsapp_private_images language plpgsql security definer set search_path=public,pg_temp as $$
begin perform public.require_service_role(); return query select * from public.whatsapp_private_images where expires_at<=now() and deleted_at is null order by expires_at limit 50; end $$;
create function public.whatsapp_runtime_image_deleted(p_id uuid) returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin perform public.require_service_role(); update public.whatsapp_private_images set deleted_at=now() where id=p_id and expires_at<=now(); end $$;

do $$ declare f record; begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'whatsapp_runtime_%'
 loop execute format('revoke all on function %s from public,anon,authenticated',f.signature); execute format('grant execute on function %s to service_role',f.signature); end loop;
end $$;
notify pgrst,'reload schema';

create function public.get_whatsapp_campaign_audience(p_organization_id uuid,p_search text default '') returns table(id uuid,full_name text)
language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 if not public.is_organization_owner(p_organization_id) then raise exception using errcode='42501',message='OWNER_REQUIRED'; end if;
 return query select c.id,c.full_name from public.customers c where c.organization_id=p_organization_id and c.active and c.phone_e164 is not null
 and c.full_name ilike '%'||left(p_search,80)||'%' and public.whatsapp_marketing_allowed(c.organization_id,c.id) order by c.full_name,c.id limit 50;
end $$;
create function public.schedule_whatsapp_campaign_local(p_organization_id uuid,p_id uuid,p_message_key text,p_body text,p_local_date date,p_local_time time,p_customer_ids uuid[] default null)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare tz text;
begin
 if not public.is_organization_owner(p_organization_id) then raise exception using errcode='42501',message='OWNER_REQUIRED'; end if;
 select timezone into strict tz from public.organizations where id=p_organization_id;
 return public.schedule_whatsapp_campaign(p_organization_id,p_id,p_message_key,p_body,(p_local_date+p_local_time) at time zone tz,p_customer_ids);
end $$;
revoke all on function public.get_whatsapp_campaign_audience(uuid,text),public.schedule_whatsapp_campaign_local(uuid,uuid,text,text,date,time,uuid[]) from public,anon;
grant execute on function public.get_whatsapp_campaign_audience(uuid,text),public.schedule_whatsapp_campaign_local(uuid,uuid,text,text,date,time,uuid[]) to authenticated;
notify pgrst,'reload schema';

-- Tenant consistency is enforced even for privileged writers.
alter table public.whatsapp_automation_jobs add constraint whatsapp_runtime_job_connection_tenant foreign key(connection_id,organization_id) references public.whatsapp_business_connections(id,organization_id);
alter table public.whatsapp_webhook_events_v2 add constraint whatsapp_runtime_event_connection_tenant foreign key(connection_id,organization_id) references public.whatsapp_business_connections(id,organization_id), add constraint whatsapp_runtime_event_tenant_unique unique(id,organization_id);
alter table public.whatsapp_delivery_receipts add constraint whatsapp_receipt_connection_tenant foreign key(connection_id,organization_id) references public.whatsapp_business_connections(id,organization_id);
alter table public.whatsapp_private_images add constraint whatsapp_image_connection_tenant foreign key(connection_id,organization_id) references public.whatsapp_business_connections(id,organization_id),add constraint whatsapp_image_event_tenant foreign key(event_id,organization_id) references public.whatsapp_webhook_events_v2(id,organization_id);
alter table public.whatsapp_reply_choices add constraint whatsapp_choices_connection_tenant foreign key(connection_id,organization_id) references public.whatsapp_business_connections(id,organization_id);

create function public.whatsapp_runtime_shadow_report(p_organization_id uuid) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 perform public.require_service_role();
 return jsonb_build_object('engine',(select runtime_engine from whatsapp_automation_settings_v2 where organization_id=p_organization_id),
 'pending',(select count(*) from whatsapp_automation_jobs where organization_id=p_organization_id and status in ('PENDING','RETRY')),
 'would_expire',(select count(*) from whatsapp_automation_jobs where organization_id=p_organization_id and status in ('PENDING','RETRY') and (valid_until<=now() or (job_type::text like 'REMINDER_%' and scheduled_for+interval '5 minutes'<=now()))),
 'uncertain',(select count(*) from whatsapp_automation_jobs where organization_id=p_organization_id and status='SEND_UNKNOWN'),
 'events',(select count(*) from whatsapp_webhook_events_v2 where organization_id=p_organization_id and processing_status in ('RECEIVED','FAILED')));
end $$;
create function public.whatsapp_runtime_reconcile(p_job_id uuid,p_provider_id text,p_evidence text) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare j public.whatsapp_automation_jobs%rowtype; state text;
begin
 perform public.require_service_role();
 select * into j from whatsapp_automation_jobs where id=p_job_id for update;
 if j.id is null or j.status<>'SEND_UNKNOWN' or nullif(btrim(p_provider_id),'') is null or length(btrim(p_evidence))<10 then raise exception 'RECONCILIATION_EVIDENCE_REQUIRED'; end if;
 if exists(select 1 from whatsapp_automation_jobs where connection_id=j.connection_id and provider_message_id=p_provider_id and id<>j.id) then raise exception 'PROVIDER_ID_ALREADY_ASSIGNED'; end if;
 select status into state from whatsapp_delivery_receipts where connection_id=j.connection_id and provider_message_id=p_provider_id order by case status when 'READ' then 4 when 'DELIVERED' then 3 when 'FAILED' then 2 else 1 end desc limit 1;
 if state is null then raise exception 'PROVIDER_RECEIPT_REQUIRED'; end if;
 perform record_whatsapp_v2_outbound_message(j.id,p_provider_id,null);
 update whatsapp_automation_jobs set provider_message_id=p_provider_id,status=state::public.whatsapp_v2_job_status,last_error_code=null,updated_at=now() where id=j.id;
 update whatsapp_messages_v2 set status=state::public.whatsapp_message_status where job_id=j.id;
 update whatsapp_confirmation_requests_v2 set provider_message_id=p_provider_id where id=j.confirmation_request_id;
 insert into whatsapp_runtime_audit(organization_id,event_type,reference_id,detail) values(j.organization_id,'DELIVERY_RECONCILED',j.id,jsonb_build_object('evidence',left(p_evidence,200),'provider_message_id',p_provider_id,'status',state));
end $$;
create function public.cancel_whatsapp_campaign(p_organization_id uuid,p_id uuid) returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if not public.is_organization_owner(p_organization_id) then raise exception using errcode='42501',message='OWNER_REQUIRED'; end if;
 update whatsapp_campaigns set status='CANCELED' where id=p_id and organization_id=p_organization_id;
 update whatsapp_automation_jobs set status='CANCELED',last_error_code='CAMPAIGN_CANCELED',updated_at=now() where organization_id=p_organization_id and dedupe_key like 'campaign:'||p_id||':%' and status in ('PENDING','RETRY');
 insert into whatsapp_runtime_audit(organization_id,event_type,reference_id) values(p_organization_id,'CAMPAIGN_CANCELED',p_id);
end $$;
revoke all on function public.whatsapp_runtime_shadow_report(uuid),public.whatsapp_runtime_reconcile(uuid,text,text) from public,anon,authenticated;
grant execute on function public.whatsapp_runtime_shadow_report(uuid),public.whatsapp_runtime_reconcile(uuid,text,text) to service_role;
revoke all on function public.cancel_whatsapp_campaign(uuid,uuid) from public,anon;
grant execute on function public.cancel_whatsapp_campaign(uuid,uuid) to authenticated;
notify pgrst,'reload schema';
