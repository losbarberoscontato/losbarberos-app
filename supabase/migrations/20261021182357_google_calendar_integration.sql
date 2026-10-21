-- Google Calendar OAuth and reliable appointment synchronization.

create table public.google_calendar_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  target_type text not null check (target_type in ('ORGANIZATION', 'BARBER')),
  barber_id uuid,
  connected_by_user_id uuid not null references auth.users(id),
  google_account_email text not null,
  calendar_id text not null default 'primary',
  status text not null default 'CONNECTED' check (status in ('CONNECTED', 'REAUTH_REQUIRED', 'DISCONNECTED')),
  access_token_secret_id uuid,
  refresh_token_secret_id uuid,
  token_expires_at timestamptz,
  scopes text[] not null default '{}',
  connected_at timestamptz not null default now(),
  last_sync_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (barber_id, organization_id) references public.barbers(id, organization_id),
  check ((target_type = 'ORGANIZATION' and barber_id is null) or (target_type = 'BARBER' and barber_id is not null))
);
create unique index google_calendar_one_organization_connection on public.google_calendar_connections (organization_id) where target_type = 'ORGANIZATION';
create unique index google_calendar_one_connection_per_barber on public.google_calendar_connections (organization_id, barber_id) where target_type = 'BARBER';

create table public.google_calendar_oauth_states (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  target_type text not null check (target_type in ('ORGANIZATION', 'BARBER')), barber_id uuid,
  requested_by_user_id uuid not null references auth.users(id), state_hash text not null unique check (char_length(state_hash) = 64),
  return_path text not null check (return_path like '/%' and return_path not like '//%'), expires_at timestamptz not null,
  consumed_at timestamptz, created_at timestamptz not null default now(),
  foreign key (barber_id, organization_id) references public.barbers(id, organization_id),
  check ((target_type = 'ORGANIZATION' and barber_id is null) or (target_type = 'BARBER' and barber_id is not null)),
  check (expires_at > created_at)
);
create index google_calendar_oauth_states_live_idx on public.google_calendar_oauth_states (state_hash, expires_at) where consumed_at is null;

create table public.google_calendar_sync_jobs (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  appointment_id uuid not null, requested_version integer not null default 1 check (requested_version > 0),
  status text not null default 'PENDING' check (status in ('PENDING', 'PROCESSING', 'FAILED', 'DONE')),
  attempts integer not null default 0 check (attempts >= 0), next_attempt_at timestamptz not null default now(),
  claimed_by text, lease_expires_at timestamptz, resync_requested boolean not null default false,
  last_error text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (organization_id, appointment_id),
  foreign key (appointment_id, organization_id) references public.appointments(id, organization_id) on delete cascade
);
create index google_calendar_sync_jobs_claim_idx on public.google_calendar_sync_jobs (next_attempt_at, created_at) where status in ('PENDING', 'FAILED', 'PROCESSING');

create table public.google_calendar_event_links (
  organization_id uuid not null references public.organizations(id) on delete cascade, connection_id uuid not null,
  appointment_id uuid not null, calendar_id text not null, event_id text not null,
  synced_version integer not null default 1, updated_at timestamptz not null default now(),
  primary key (connection_id, appointment_id),
  foreign key (connection_id, organization_id) references public.google_calendar_connections(id, organization_id) on delete cascade,
  foreign key (appointment_id, organization_id) references public.appointments(id, organization_id) on delete cascade
);

alter table public.google_calendar_connections enable row level security;
alter table public.google_calendar_oauth_states enable row level security;
alter table public.google_calendar_sync_jobs enable row level security;
alter table public.google_calendar_event_links enable row level security;
create policy google_calendar_connections_read on public.google_calendar_connections for select to authenticated using (
  public.is_organization_owner(organization_id) or exists (
    select 1 from public.barbers b where b.id = google_calendar_connections.barber_id and b.organization_id = google_calendar_connections.organization_id
      and b.auth_user_id = (select auth.uid()) and b.active and b.app_access_enabled
  )
);
grant select (id, organization_id, target_type, barber_id, google_account_email, calendar_id, status, connected_at, last_sync_at, last_error) on public.google_calendar_connections to authenticated;
revoke insert, update, delete on public.google_calendar_connections from anon, authenticated;
revoke all on public.google_calendar_oauth_states, public.google_calendar_sync_jobs, public.google_calendar_event_links from anon, authenticated;

create or replace function public.create_google_calendar_oauth_state(
  p_organization_id uuid, p_target_type text, p_barber_id uuid,
  p_state_hash text, p_requested_by_user_id uuid, p_return_path text, p_expires_at timestamptz
)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  perform public.require_service_role();
  if p_target_type = 'ORGANIZATION' then
    if p_barber_id is not null or not public.is_organization_owner(p_organization_id, p_requested_by_user_id) then
      raise exception using errcode='42501', message='organization owner required';
    end if;
  elsif p_target_type = 'BARBER' then
    if p_barber_id is null or not exists (
      select 1 from public.barbers b where b.id=p_barber_id and b.organization_id=p_organization_id
        and b.auth_user_id=p_requested_by_user_id and b.active and b.app_access_enabled
    ) then raise exception using errcode='42501', message='active barber access required'; end if;
  else raise exception using errcode='22023', message='invalid calendar target'; end if;
  if char_length(p_state_hash) <> 64 or p_expires_at <= now() or p_expires_at > now()+interval '15 minutes'
    or p_return_path not like '/%' or p_return_path like '//%' then
    raise exception using errcode='22023', message='invalid OAuth state';
  end if;
  insert into public.google_calendar_oauth_states(organization_id,target_type,barber_id,requested_by_user_id,state_hash,return_path,expires_at)
  values(p_organization_id,p_target_type,p_barber_id,p_requested_by_user_id,p_state_hash,p_return_path,p_expires_at) returning id into v_id;
  return v_id;
end $$;

create or replace function public.consume_google_calendar_oauth_state(p_state_hash text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_state public.google_calendar_oauth_states%rowtype;
begin
  perform public.require_service_role();
  select * into v_state from public.google_calendar_oauth_states
   where state_hash=p_state_hash and consumed_at is null and expires_at>now() for update;
  if not found then return null; end if;
  update public.google_calendar_oauth_states set consumed_at=now() where id=v_state.id;
  return jsonb_build_object('organization_id',v_state.organization_id,'target_type',v_state.target_type,
    'barber_id',v_state.barber_id,'requested_by_user_id',v_state.requested_by_user_id,'return_path',v_state.return_path);
end $$;

create or replace function public.store_google_calendar_credentials(
  p_organization_id uuid,p_target_type text,p_barber_id uuid,p_google_account_email text,
  p_access_token text,p_refresh_token text,p_expires_at timestamptz,p_scopes text[],p_connected_by_user_id uuid
)
returns uuid language plpgsql security definer set search_path = public, vault, pg_temp as $$
declare v_connection public.google_calendar_connections%rowtype; v_access_id uuid; v_refresh_id uuid; v_id uuid;
begin
  perform public.require_service_role();
  if nullif(btrim(p_google_account_email),'') is null or nullif(p_access_token,'') is null then
    raise exception using errcode='22023', message='invalid Google credentials'; end if;
  if p_target_type='ORGANIZATION' then
    if p_barber_id is not null or not public.is_organization_owner(p_organization_id,p_connected_by_user_id) then
      raise exception using errcode='42501', message='organization owner required'; end if;
  elsif p_target_type='BARBER' then
    if p_barber_id is null or not exists(select 1 from public.barbers b where b.id=p_barber_id
      and b.organization_id=p_organization_id and b.auth_user_id=p_connected_by_user_id and b.active and b.app_access_enabled) then
      raise exception using errcode='42501', message='active barber access required'; end if;
  else raise exception using errcode='22023', message='invalid calendar target'; end if;
  select * into v_connection from public.google_calendar_connections c
    where c.organization_id=p_organization_id and c.target_type=p_target_type
      and c.barber_id is not distinct from p_barber_id for update;
  if nullif(p_refresh_token,'') is null and v_connection.refresh_token_secret_id is null then
    raise exception using errcode='22023', message='Google offline refresh token is required';
  end if;
  if v_connection.access_token_secret_id is null then
    select vault.create_secret(p_access_token,'los-barberos-google-access-'||p_organization_id||'-'||coalesce(p_barber_id::text,'org'),'Google Calendar access token') into v_access_id;
  else v_access_id:=v_connection.access_token_secret_id; perform vault.update_secret(v_access_id,p_access_token); end if;
  if nullif(p_refresh_token,'') is not null then
    if v_connection.refresh_token_secret_id is null then
      select vault.create_secret(p_refresh_token,'los-barberos-google-refresh-'||p_organization_id||'-'||coalesce(p_barber_id::text,'org'),'Google Calendar refresh token') into v_refresh_id;
    else v_refresh_id:=v_connection.refresh_token_secret_id; perform vault.update_secret(v_refresh_id,p_refresh_token); end if;
  else v_refresh_id:=v_connection.refresh_token_secret_id; end if;
  insert into public.google_calendar_connections(organization_id,target_type,barber_id,connected_by_user_id,google_account_email,
    access_token_secret_id,refresh_token_secret_id,token_expires_at,scopes,status,connected_at,last_error)
  values(p_organization_id,p_target_type,p_barber_id,p_connected_by_user_id,lower(p_google_account_email),v_access_id,v_refresh_id,p_expires_at,coalesce(p_scopes,'{}'),'CONNECTED',now(),null)
  on conflict do nothing returning id into v_id;
  if v_id is null then
    update public.google_calendar_connections set connected_by_user_id=p_connected_by_user_id,google_account_email=lower(p_google_account_email),
      access_token_secret_id=v_access_id,refresh_token_secret_id=v_refresh_id,token_expires_at=p_expires_at,
      scopes=coalesce(p_scopes,'{}'),status='CONNECTED',connected_at=now(),last_error=null,updated_at=now()
      where organization_id=p_organization_id and target_type=p_target_type and barber_id is not distinct from p_barber_id returning id into v_id;
  end if;
  insert into public.google_calendar_sync_jobs(organization_id,appointment_id,requested_version,status,next_attempt_at)
  select a.organization_id,a.id,a.version,'PENDING',now() from public.appointments a
   where a.organization_id=p_organization_id
     and ((a.status in ('HELD','PENDING_PAYMENT','CONFIRMED','IN_SERVICE') and lower(a.service_period)>now())
       or exists(select 1 from public.google_calendar_event_links el where el.appointment_id=a.id and el.organization_id=a.organization_id
         and (p_target_type='ORGANIZATION' or el.connection_id=v_id)))
     and (p_target_type='ORGANIZATION' or a.barber_id=p_barber_id or exists(
       select 1 from public.google_calendar_event_links el where el.appointment_id=a.id and el.organization_id=a.organization_id and el.connection_id=v_id))
  on conflict(organization_id,appointment_id) do update set status=case when google_calendar_sync_jobs.status='PROCESSING' then 'PROCESSING' else 'PENDING' end,
    requested_version=excluded.requested_version,resync_requested=google_calendar_sync_jobs.status='PROCESSING' or google_calendar_sync_jobs.resync_requested,next_attempt_at=now(),updated_at=now();
  return v_id;
end $$;

create or replace function public.enqueue_google_calendar_sync_job(p_appointment_id uuid,p_organization_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.google_calendar_sync_jobs(organization_id,appointment_id,requested_version,status,next_attempt_at,resync_requested)
  select p_organization_id,p_appointment_id,a.version,'PENDING',now(),false from public.appointments a
   where a.id=p_appointment_id and a.organization_id=p_organization_id
  on conflict(organization_id,appointment_id) do update set
    requested_version=excluded.requested_version,
    status=case when google_calendar_sync_jobs.status='PROCESSING' then 'PROCESSING' else 'PENDING' end,
    resync_requested=google_calendar_sync_jobs.status='PROCESSING' or google_calendar_sync_jobs.resync_requested,
    next_attempt_at=now(),updated_at=now();
end $$;

create or replace function public.queue_google_calendar_sync_from_appointment()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.enqueue_google_calendar_sync_job(new.id,new.organization_id);
  return new;
end $$;
create trigger appointments_google_calendar_sync after insert or update of status,service_period,barber_id,location_id,environment_id,version
  on public.appointments for each row execute function public.queue_google_calendar_sync_from_appointment();
create or replace function public.queue_google_calendar_sync_from_item()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_appointment_id uuid; v_org uuid;
begin
  v_appointment_id:=coalesce(new.appointment_id,old.appointment_id); v_org:=coalesce(new.organization_id,old.organization_id);
  perform public.enqueue_google_calendar_sync_job(v_appointment_id,v_org);
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
create trigger appointment_items_google_calendar_sync after insert or update or delete on public.appointment_items
  for each row execute function public.queue_google_calendar_sync_from_item();

create or replace function public.get_google_calendar_sync_context(p_job_id uuid)
returns jsonb language plpgsql security definer set search_path = public, vault, pg_temp as $$
declare v_job public.google_calendar_sync_jobs%rowtype; v_a record; v_connections jsonb;
begin
  perform public.require_service_role();
  select * into v_job from public.google_calendar_sync_jobs where id=p_job_id;
  if not found then return null; end if;
  select a.id,a.organization_id,a.barber_id,a.status::text as status,lower(a.service_period) as starts_at,upper(a.service_period) as ends_at,
    o.timezone,c.full_name as customer_name,b.display_name as barber_name,coalesce(e.name,l.name,'Sem sala') as room_name,
    coalesce((select string_agg(ai.service_name_snapshot,' + ' order by ai.position) from public.appointment_items ai
      where ai.appointment_id=a.id and ai.organization_id=a.organization_id),'Atendimento') as service_names,
    coalesce((select jsonb_agg(jsonb_build_object('connectionId',i.connection_id,'calendarId',i.calendar_id,'eventId',i.event_id,'syncedVersion',i.synced_version))
      from public.google_calendar_event_links i where i.appointment_id=a.id and i.organization_id=a.organization_id),'[]'::jsonb) as event_links
  into v_a from public.appointments a join public.organizations o on o.id=a.organization_id
    join public.customers c on c.id=a.customer_id and c.organization_id=a.organization_id
    join public.barbers b on b.id=a.barber_id and b.organization_id=a.organization_id
    join public.locations l on l.id=a.location_id and l.organization_id=a.organization_id
    left join public.agenda_environments e on e.id=a.environment_id and e.organization_id=a.organization_id
  where a.id=v_job.appointment_id and a.organization_id=v_job.organization_id;
  if not found then return null; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',g.id,'targetType',g.target_type,'barberId',g.barber_id,
      'calendarId',g.calendar_id,'accessToken',sa.decrypted_secret,'refreshToken',sr.decrypted_secret,'expiresAt',g.token_expires_at)),'[]'::jsonb)
  into v_connections from public.google_calendar_connections g
  left join vault.decrypted_secrets sa on sa.id=g.access_token_secret_id
  left join vault.decrypted_secrets sr on sr.id=g.refresh_token_secret_id
  where g.organization_id=v_job.organization_id and g.status='CONNECTED'
   and (g.target_type='ORGANIZATION' or g.barber_id=v_a.barber_id);
  return jsonb_build_object('jobId',v_job.id,'organizationId',v_job.organization_id,'appointmentId',v_a.id,
    'status',v_a.status,'startsAt',v_a.starts_at,'endsAt',v_a.ends_at,'timeZone',v_a.timezone,'room',v_a.room_name,
    'customer',v_a.customer_name,'service',v_a.service_names,'professional',v_a.barber_name,
    'eventLinks',v_a.event_links,'connections',v_connections);
end $$;

create or replace function public.claim_google_calendar_sync_jobs(p_limit integer,p_worker text)
returns setof public.google_calendar_sync_jobs language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.require_service_role();
  return query with candidates as (
    select id from public.google_calendar_sync_jobs where (status in ('PENDING','FAILED') and next_attempt_at<=now())
      or (status='PROCESSING' and lease_expires_at<now()) order by next_attempt_at,created_at for update skip locked limit greatest(1,least(p_limit,50))
  ) update public.google_calendar_sync_jobs j set status='PROCESSING',claimed_by=p_worker,lease_expires_at=now()+interval '2 minutes',
    attempts=j.attempts+1,updated_at=now() from candidates c where j.id=c.id returning j.*;
end $$;

create or replace function public.complete_google_calendar_sync_job(p_job_id uuid,p_worker text,p_error text default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.require_service_role();
  update public.google_calendar_sync_jobs set
    status=case when p_error is not null then 'FAILED' when resync_requested then 'PENDING' else 'DONE' end,claimed_by=null,lease_expires_at=null,
    last_error=left(p_error,500),next_attempt_at=case when p_error is null then now() else now()+make_interval(secs=>least(21600,30*power(2,least(attempts,10))::integer)) end,
    resync_requested=false,updated_at=now()
  where id=p_job_id and status='PROCESSING' and claimed_by=p_worker;
end $$;

create or replace function public.save_google_calendar_event_link(p_organization_id uuid,p_connection_id uuid,p_appointment_id uuid,p_calendar_id text,p_event_id text,p_version integer)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.require_service_role();
  insert into public.google_calendar_event_links(organization_id,connection_id,appointment_id,calendar_id,event_id,synced_version)
  values(p_organization_id,p_connection_id,p_appointment_id,p_calendar_id,p_event_id,p_version)
  on conflict(connection_id,appointment_id) do update set calendar_id=excluded.calendar_id,event_id=excluded.event_id,synced_version=excluded.synced_version,updated_at=now();
end $$;

create or replace function public.delete_google_calendar_event_link(p_connection_id uuid,p_appointment_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin perform public.require_service_role(); delete from public.google_calendar_event_links where connection_id=p_connection_id and appointment_id=p_appointment_id; end $$;

create or replace function public.refresh_google_calendar_access_token(p_connection_id uuid,p_access_token text,p_expires_at timestamptz)
returns void language plpgsql security definer set search_path = public, vault, pg_temp as $$
declare v_secret_id uuid;
begin
  perform public.require_service_role();
  select access_token_secret_id into v_secret_id from public.google_calendar_connections where id=p_connection_id for update;
  if v_secret_id is null then raise exception using errcode='P0002',message='calendar connection missing'; end if;
  perform vault.update_secret(v_secret_id,p_access_token);
  update public.google_calendar_connections set token_expires_at=p_expires_at,status='CONNECTED',last_error=null,updated_at=now() where id=p_connection_id;
end $$;

create or replace function public.mark_google_calendar_reauth_required(p_connection_id uuid,p_error text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin perform public.require_service_role(); update public.google_calendar_connections set status='REAUTH_REQUIRED',last_error=left(p_error,200),updated_at=now() where id=p_connection_id; end $$;

create or replace function public.record_google_calendar_sync_result(p_connection_id uuid,p_error text default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.require_service_role();
  update public.google_calendar_connections set
    last_sync_at=case when p_error is null then now() else last_sync_at end,
    last_error=case when p_error is null then null else left(p_error,200) end,
    updated_at=now() where id=p_connection_id and status<>'REAUTH_REQUIRED';
end $$;

revoke all on function public.create_google_calendar_oauth_state(uuid,text,uuid,text,uuid,text,timestamptz),public.consume_google_calendar_oauth_state(text),
 public.store_google_calendar_credentials(uuid,text,uuid,text,text,text,timestamptz,text[],uuid),public.enqueue_google_calendar_sync_job(uuid,uuid),
 public.queue_google_calendar_sync_from_appointment(),public.queue_google_calendar_sync_from_item(),public.get_google_calendar_sync_context(uuid),
 public.claim_google_calendar_sync_jobs(integer,text),public.complete_google_calendar_sync_job(uuid,text,text),
 public.save_google_calendar_event_link(uuid,uuid,uuid,text,text,integer),public.delete_google_calendar_event_link(uuid,uuid),
 public.refresh_google_calendar_access_token(uuid,text,timestamptz),public.mark_google_calendar_reauth_required(uuid,text),public.record_google_calendar_sync_result(uuid,text) from public,anon,authenticated;
grant execute on function public.create_google_calendar_oauth_state(uuid,text,uuid,text,uuid,text,timestamptz),public.consume_google_calendar_oauth_state(text),
 public.store_google_calendar_credentials(uuid,text,uuid,text,text,text,timestamptz,text[],uuid),public.enqueue_google_calendar_sync_job(uuid,uuid),
 public.get_google_calendar_sync_context(uuid),public.claim_google_calendar_sync_jobs(integer,text),public.complete_google_calendar_sync_job(uuid,text,text),
 public.save_google_calendar_event_link(uuid,uuid,uuid,text,text,integer),public.delete_google_calendar_event_link(uuid,uuid),
 public.refresh_google_calendar_access_token(uuid,text,timestamptz),public.mark_google_calendar_reauth_required(uuid,text),public.record_google_calendar_sync_result(uuid,text) to service_role;

-- Reuse the established allow-list dispatcher; cron dispatches the durable worker once per minute.
create or replace function app_private.dispatch_edge_function(p_function_name text,p_body jsonb)
returns bigint language plpgsql security definer set search_path = app_private,vault,net,pg_temp as $$
declare v_supabase_url text; v_service_role_key text; v_request_id bigint;
begin
  if p_function_name not in ('whatsapp-send-outbox','maintenance-jobs','whatsapp-qr-health','whatsapp-v2-dispatcher','google-calendar-sync') or jsonb_typeof(p_body)<>'object' then
    raise exception using errcode='22023',message='unsupported edge worker dispatch'; end if;
  select decrypted_secret into v_supabase_url from vault.decrypted_secrets where name='los_barberos_supabase_url' limit 1;
  select decrypted_secret into v_service_role_key from vault.decrypted_secrets where name='los_barberos_service_role_key' limit 1;
  if nullif(v_supabase_url,'') is null or nullif(v_service_role_key,'') is null then
    insert into app_private.edge_dispatch_audit(function_name,status,error_code) values(p_function_name,'SKIPPED_CONFIG','VAULT_CONFIG_MISSING'); return null; end if;
  select net.http_post(url:=rtrim(v_supabase_url,'/')||'/functions/v1/'||p_function_name,headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||v_service_role_key,'apikey',v_service_role_key),body:=p_body,timeout_milliseconds:=10000) into v_request_id;
  insert into app_private.edge_dispatch_audit(function_name,status,request_id) values(p_function_name,'QUEUED',v_request_id);
  delete from app_private.edge_dispatch_audit where created_at<now()-interval '30 days';
  return v_request_id;
exception when others then insert into app_private.edge_dispatch_audit(function_name,status,error_code) values(p_function_name,'ERROR',sqlstate); return null;
end $$;
select cron.schedule('los_barberos_google_calendar_sync','* * * * *',$job$select app_private.dispatch_edge_function('google-calendar-sync','{"limit":25}'::jsonb)$job$);
