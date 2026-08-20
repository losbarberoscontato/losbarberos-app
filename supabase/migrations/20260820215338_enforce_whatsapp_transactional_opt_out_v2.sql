-- WhatsApp transacional inicia ativo para cliente autenticado, mas uma revogação
-- precisa valer para a fila V2 já persistida e para novas mensagens.

create or replace function public.sync_whatsapp_v2_transactional_preference()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.kind <> 'WHATSAPP_TRANSACTIONAL' then
    return new;
  end if;

  insert into public.whatsapp_contact_preferences_v2 (
    organization_id, customer_id, transactional_enabled, updated_at
  ) values (
    new.organization_id, new.customer_id, new.action = 'GRANTED', now()
  )
  on conflict (organization_id, customer_id) do update
    set transactional_enabled = excluded.transactional_enabled,
        updated_at = excluded.updated_at;

  if new.action = 'REVOKED' then
    update public.whatsapp_automation_jobs j
      set status = 'CANCELED',
          last_error_code = 'WHATSAPP_TRANSACTIONAL_OPTED_OUT',
          updated_at = now()
    from public.appointments a
    where a.id = j.appointment_id
      and a.organization_id = j.organization_id
      and a.customer_id = new.customer_id
      and j.organization_id = new.organization_id
      and j.status in ('PENDING', 'RETRY')
      and j.job_type in (
        'BOOKING_CREATED_CLIENT',
        'REMINDER_MORNING_CLIENT',
        'REMINDER_T45_CLIENT',
        'CONFIRMATION_ACK_CLIENT',
        'CANCELLATION_ACK_CLIENT'
      );

    update public.whatsapp_confirmation_requests_v2 r
      set status = 'EXPIRED', updated_at = now()
    from public.appointments a
    where a.id = r.appointment_id
      and a.organization_id = r.organization_id
      and a.customer_id = new.customer_id
      and r.organization_id = new.organization_id
      and r.status = 'PENDING';
  end if;

  return new;
end;
$$;

drop trigger if exists consent_events_sync_whatsapp_v2_transactional_preference on public.consent_events;
create trigger consent_events_sync_whatsapp_v2_transactional_preference
  after insert on public.consent_events
  for each row execute function public.sync_whatsapp_v2_transactional_preference();

-- Corrige a projeção criada antes deste gatilho sem sobrescrever a decisão
-- mais recente auditada em consent_events.
insert into public.whatsapp_contact_preferences_v2 (
  organization_id, customer_id, transactional_enabled, updated_at
)
select
  c.organization_id,
  c.id,
  coalesce(latest.action = 'GRANTED', true),
  now()
from public.customers c
left join lateral (
  select ce.action
  from public.consent_events ce
  where ce.organization_id = c.organization_id
    and ce.customer_id = c.id
    and ce.kind = 'WHATSAPP_TRANSACTIONAL'
  order by ce.occurred_at desc, ce.created_at desc, ce.id desc
  limit 1
) latest on true
on conflict (organization_id, customer_id) do update
  set transactional_enabled = excluded.transactional_enabled,
      updated_at = excluded.updated_at;

create or replace function public.claim_whatsapp_v2_jobs(
  p_limit integer,
  p_worker_id text,
  p_lease_seconds integer default 120
)
returns setof public.whatsapp_automation_jobs
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.require_service_role();

  -- A preference can change after scheduling and before dispatch. Do not claim
  -- client-facing transactional jobs once the client opted out.
  update public.whatsapp_automation_jobs j
    set status = 'CANCELED',
        last_error_code = 'WHATSAPP_TRANSACTIONAL_OPTED_OUT',
        updated_at = now()
  from public.appointments a
  where a.id = j.appointment_id
    and a.organization_id = j.organization_id
    and j.status in ('PENDING', 'RETRY')
    and j.job_type in (
      'BOOKING_CREATED_CLIENT',
      'REMINDER_MORNING_CLIENT',
      'REMINDER_T45_CLIENT',
      'CONFIRMATION_ACK_CLIENT',
      'CANCELLATION_ACK_CLIENT'
    )
    and not public.whatsapp_v2_consented(j.organization_id, a.customer_id);

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
      and c.status = 'CONNECTED'
    order by j.next_attempt_at, j.id
    limit greatest(1, least(p_limit, 25))
    for update skip locked
  )
  update public.whatsapp_automation_jobs j
    set status = 'PROCESSING',
        locked_at = now(),
        locked_by = p_worker_id,
        lock_expires_at = now() + make_interval(secs => greatest(30, least(p_lease_seconds, 300))),
        updated_at = now()
  from due
  where j.id = due.id
  returning j.*;
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
  if not found or v_settings.mode='OFF' then return new; end if;
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
  v_payload:=jsonb_build_object('customer_name',v_customer.full_name,'barber_name',v_barber.display_name,'starts_at',v_start,'timezone',v_org.timezone,'currency',new.currency,'total_cents',new.total_cents_snapshot);
  if v_confirmed_transition and v_customer.phone_e164 is not null and v_client_consented then
    insert into public.whatsapp_automation_jobs (organization_id,connection_id,appointment_id,appointment_version,job_type,recipient_e164,payload,valid_until,dedupe_key)
    values (new.organization_id,v_connection.id,new.id,new.version,'BOOKING_CREATED_CLIENT',v_customer.phone_e164,v_payload,v_start,'v2:' || new.id || ':v' || new.version || ':booking:client') on conflict (organization_id,dedupe_key) do nothing;
  end if;
  if v_confirmed_transition and v_barber.whatsapp_e164 is not null then
    insert into public.whatsapp_automation_jobs (organization_id,connection_id,appointment_id,appointment_version,job_type,recipient_e164,payload,valid_until,dedupe_key)
    values (new.organization_id,v_connection.id,new.id,new.version,'BOOKING_CREATED_STAFF',v_barber.whatsapp_e164,v_payload,v_start,'v2:' || new.id || ':v' || new.version || ':booking:staff') on conflict (organization_id,dedupe_key) do nothing;
  end if;
  if v_customer.phone_e164 is null or not v_client_consented then return new; end if;
  v_morning:=((v_start at time zone v_org.timezone)::date + v_settings.morning_local_time) at time zone v_org.timezone;
  v_t45:=v_start-make_interval(mins=>v_settings.t45_offset_minutes);
  if v_settings.reminder_mode in ('BOTH','MORNING_ONLY') then
    insert into public.whatsapp_automation_jobs (organization_id,connection_id,appointment_id,appointment_version,job_type,recipient_e164,payload,scheduled_for,next_attempt_at,valid_until,status,dedupe_key)
    values (new.organization_id,v_connection.id,new.id,new.version,'REMINDER_MORNING_CLIENT',v_customer.phone_e164,v_payload,v_morning,v_morning,v_start,
      case when v_morning<=now() or v_t45<=v_morning then 'SKIPPED'::public.whatsapp_v2_job_status else 'PENDING'::public.whatsapp_v2_job_status end,
      'v2:' || new.id || ':v' || new.version || ':morning:client') on conflict (organization_id,dedupe_key) do nothing;
  end if;
  if v_settings.reminder_mode in ('BOTH','T45_ONLY') then
    insert into public.whatsapp_automation_jobs (organization_id,connection_id,appointment_id,appointment_version,job_type,recipient_e164,payload,scheduled_for,next_attempt_at,valid_until,status,dedupe_key)
    values (new.organization_id,v_connection.id,new.id,new.version,'REMINDER_T45_CLIENT',v_customer.phone_e164,v_payload,v_t45,v_t45,v_start,
      case when v_t45<=now() then 'SKIPPED'::public.whatsapp_v2_job_status else 'PENDING'::public.whatsapp_v2_job_status end,
      'v2:' || new.id || ':v' || new.version || ':t45:client') on conflict (organization_id,dedupe_key) do nothing;
  end if;
  return new;
end;
$$;

revoke all on function public.sync_whatsapp_v2_transactional_preference() from public, anon, authenticated;
revoke all on function public.claim_whatsapp_v2_jobs(integer, text, integer) from public, anon, authenticated;
grant execute on function public.claim_whatsapp_v2_jobs(integer, text, integer) to service_role;
revoke all on function public.schedule_whatsapp_v2_for_appointment() from public, anon, authenticated;

notify pgrst, 'reload schema';
