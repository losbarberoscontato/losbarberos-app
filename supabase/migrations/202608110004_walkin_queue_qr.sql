-- Printed QR is stable even when the public slug changes. Holds are transient
-- and contain no customer identity; appointment exclusion remains final authority.

alter table public.organizations
  add column if not exists queue_public_id uuid;
update public.organizations
set queue_public_id = gen_random_uuid()
where queue_public_id is null;
alter table public.organizations
  alter column queue_public_id set not null;
create unique index if not exists organizations_queue_public_id_key
  on public.organizations (queue_public_id);
create table if not exists public.walkin_queue_holds (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  barber_id uuid not null,
  service_period tstzrange not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (barber_id, organization_id) references public.barbers(id, organization_id) on delete cascade,
  check (not isempty(service_period)),
  check (lower_inc(service_period) and not upper_inc(service_period)),
  check (expires_at > created_at)
);
alter table public.walkin_queue_holds
  add constraint walkin_queue_holds_no_overlap
  exclude using gist (
    organization_id with =,
    barber_id with =,
    service_period with &&
  ) where (consumed_at is null);
create index if not exists walkin_queue_holds_active_idx
  on public.walkin_queue_holds (organization_id, barber_id, expires_at)
  where consumed_at is null;
alter table public.walkin_queue_holds enable row level security;
revoke all on public.walkin_queue_holds from anon, authenticated;
create or replace function public.get_walkin_queue_availability(
  p_queue_public_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org public.organizations%rowtype;
  v_local_now timestamp;
  v_local_end timestamp;
  v_slots jsonb;
begin
  select * into strict v_org from public.organizations
  where queue_public_id = p_queue_public_id and accepting_bookings;

  v_local_now := now() at time zone v_org.timezone;
  v_local_now := date_trunc('minute', v_local_now)
    + make_interval(mins => (v_org.slot_interval_minutes - mod(extract(minute from v_local_now)::integer, v_org.slot_interval_minutes)) % v_org.slot_interval_minutes);
  v_local_end := (v_local_now::date + 1)::timestamp;

  select coalesce(jsonb_agg(jsonb_build_object(
        'barber_id', candidate.barber_id,
        'barber_name', candidate.barber_name,
        'starts_at', candidate.starts_at,
        'ends_at', candidate.ends_at
      ) order by candidate.starts_at, candidate.barber_name), '[]'::jsonb)
    into v_slots
    from (
        select b.id as barber_id, b.display_name as barber_name,
          series.slot_start as starts_at,
          series.slot_start + make_interval(mins => v_org.slot_interval_minutes) as ends_at
        from public.barbers b
        cross join lateral generate_series(
          v_local_now at time zone v_org.timezone,
          v_local_end at time zone v_org.timezone - make_interval(mins => v_org.slot_interval_minutes),
          make_interval(mins => v_org.slot_interval_minutes)
        ) as series(slot_start)
        where b.organization_id = v_org.id and b.active
          and public.is_barber_available(v_org.id, b.id, tstzrange(
            series.slot_start, series.slot_start + make_interval(mins => v_org.slot_interval_minutes), '[)'
          ))
          and not exists (
            select 1 from public.appointments a
            where a.organization_id = v_org.id and a.barber_id = b.id
              and a.status in ('HELD', 'PENDING_PAYMENT', 'CONFIRMED', 'IN_SERVICE')
              and a.service_period && tstzrange(series.slot_start, series.slot_start + make_interval(mins => v_org.slot_interval_minutes), '[)')
          )
          and not exists (
            select 1 from public.walkin_queue_holds h
            where h.organization_id = v_org.id and h.barber_id = b.id
              and h.consumed_at is null and h.expires_at > now()
              and h.service_period && tstzrange(series.slot_start, series.slot_start + make_interval(mins => v_org.slot_interval_minutes), '[)')
          )
    ) candidate;
  return jsonb_build_object(
    'organization', jsonb_build_object('name', v_org.name, 'slug', v_org.slug, 'timezone', v_org.timezone),
    'slots', v_slots
  );
exception when no_data_found then return null;
end;
$$;
create or replace function public.create_walkin_queue_hold(
  p_queue_public_id uuid,
  p_barber_id uuid,
  p_starts_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org public.organizations%rowtype;
  v_period tstzrange;
  v_hold_id uuid;
begin
  select * into strict v_org from public.organizations
  where queue_public_id = p_queue_public_id and accepting_bookings;
  v_period := tstzrange(p_starts_at, p_starts_at + make_interval(mins => v_org.slot_interval_minutes), '[)');
  if p_starts_at <= now()
     or extract(second from p_starts_at at time zone v_org.timezone) <> 0
     or mod(extract(minute from p_starts_at at time zone v_org.timezone)::integer, v_org.slot_interval_minutes) <> 0
     or not public.is_barber_available(v_org.id, p_barber_id, v_period) then
    raise exception using errcode = '22023', message = 'requested slot is no longer available';
  end if;
  delete from public.walkin_queue_holds
  where organization_id = v_org.id and expires_at <= now() and consumed_at is null;
  if exists (
    select 1 from public.appointments a where a.organization_id = v_org.id and a.barber_id = p_barber_id
      and a.status in ('HELD', 'PENDING_PAYMENT', 'CONFIRMED', 'IN_SERVICE') and a.service_period && v_period
  ) then raise exception using errcode = '23P01', message = 'requested slot is no longer available'; end if;
  insert into public.walkin_queue_holds (organization_id, barber_id, service_period, expires_at)
  values (v_org.id, p_barber_id, v_period, now() + interval '10 minutes')
  returning id into v_hold_id;
  return jsonb_build_object('hold_id', v_hold_id, 'expires_at', now() + interval '10 minutes');
exception when exclusion_violation then
  raise exception using errcode = '23P01', message = 'requested slot is no longer available';
when no_data_found then return null;
end;
$$;
revoke all on function public.get_walkin_queue_availability(uuid) from public;
revoke all on function public.create_walkin_queue_hold(uuid, uuid, timestamptz) from public;
grant execute on function public.get_walkin_queue_availability(uuid) to anon, authenticated;
grant execute on function public.create_walkin_queue_hold(uuid, uuid, timestamptz) to anon, authenticated;
create or replace function public.create_appointment_hold(
  p_organization_id uuid,
  p_customer_id uuid,
  p_barber_id uuid,
  p_starts_at timestamptz,
  p_selections jsonb,
  p_payment_mode public.payment_mode default 'COUNTER',
  p_walkin_queue_hold_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_org public.organizations%rowtype;
  v_barber public.barbers%rowtype;
  v_resolution jsonb;
  v_duration integer;
  v_occupied_minutes integer;
  v_period tstzrange;
  v_appointment_id uuid;
  v_total bigint;
  v_local_start timestamp;
begin
  if not public.is_organization_customer(p_organization_id, p_customer_id) then
    raise exception using errcode = '42501', message = 'customer identity does not match caller';
  end if;
  if not public.organization_accepts_new_bookings(p_organization_id) then
    raise exception using errcode = '42501', message = 'organization is not accepting new bookings';
  end if;
  if p_payment_mode <> 'COUNTER' then
    raise exception using errcode = '22023', message = 'customer booking supports only COUNTER payment mode';
  end if;
  if p_starts_at <= now() then
    raise exception using errcode = '22023', message = 'appointment start must be in the future';
  end if;
  select * into strict v_org from public.organizations where id = p_organization_id;
  select * into strict v_barber from public.barbers
    where id = p_barber_id and organization_id = p_organization_id and active;
  v_local_start := p_starts_at at time zone v_org.timezone;
  if extract(second from v_local_start) <> 0
     or mod(extract(minute from v_local_start)::integer, v_org.slot_interval_minutes) <> 0 then
    raise exception using errcode = '22023', message = 'start time is not aligned to slot interval';
  end if;
  v_resolution := public.resolve_booking_selection(p_organization_id, p_barber_id, p_selections, null);
  v_duration := (v_resolution ->> 'duration_minutes')::integer;
  v_occupied_minutes := ceil(v_duration::numeric / v_org.slot_interval_minutes)::integer * v_org.slot_interval_minutes;
  v_period := tstzrange(p_starts_at, p_starts_at + make_interval(mins => v_occupied_minutes), '[)');
  if p_walkin_queue_hold_id is not null then
    perform 1 from public.walkin_queue_holds h
    where h.id = p_walkin_queue_hold_id and h.organization_id = p_organization_id
      and h.barber_id = p_barber_id and h.consumed_at is null and h.expires_at > now()
      and lower(h.service_period) = p_starts_at
    for update;
    if not found then raise exception using errcode = '23P01', message = 'requested slot is no longer available'; end if;
  end if;
  if exists (
    select 1 from public.walkin_queue_holds h
    where h.organization_id = p_organization_id and h.barber_id = p_barber_id
      and h.consumed_at is null and h.expires_at > now() and h.service_period && v_period
      and h.id is distinct from p_walkin_queue_hold_id
  ) or not public.is_barber_available(p_organization_id, p_barber_id, v_period) then
    raise exception using errcode = '23P01', message = 'requested slot is no longer available';
  end if;
  v_total := (v_resolution ->> 'total_cents')::bigint;
  insert into public.appointments (
    organization_id, location_id, customer_id, barber_id, status, source,
    service_period, hold_expires_at, payment_mode, currency,
    total_cents_snapshot, list_total_cents_snapshot, deposit_bps_snapshot,
    deposit_required_cents_snapshot, cancellation_lead_minutes_snapshot, created_by
  ) values (
    p_organization_id, v_barber.location_id, p_customer_id, p_barber_id,
    'CONFIRMED', 'CUSTOMER', v_period, null, 'COUNTER', v_org.currency,
    v_total, (v_resolution ->> 'list_total_cents')::bigint, 0, 0,
    v_org.cancellation_lead_minutes, auth.uid()
  ) returning id into v_appointment_id;
  perform public.insert_resolved_appointment_items(v_appointment_id, p_organization_id, v_resolution);
  if p_walkin_queue_hold_id is not null then
    update public.walkin_queue_holds set consumed_at = now() where id = p_walkin_queue_hold_id;
  end if;
  insert into public.appointment_status_events (organization_id, appointment_id, to_status, reason, actor_user_id)
  values (p_organization_id, v_appointment_id, 'CONFIRMED', 'customer_counter_booking_created', auth.uid());
  return jsonb_build_object('appointment_id', v_appointment_id, 'status', 'CONFIRMED', 'expires_at', null,
    'total_cents', v_total, 'amount_due_now_cents', 0, 'service_period', v_period);
exception when exclusion_violation then
  raise exception using errcode = '23P01', message = 'requested slot is no longer available';
when no_data_found then
  raise exception using errcode = 'P0002', message = 'organization or barber not found';
end;
$$;
revoke all on function public.create_appointment_hold(uuid, uuid, uuid, timestamptz, jsonb, public.payment_mode, uuid) from public;
grant execute on function public.create_appointment_hold(uuid, uuid, uuid, timestamptz, jsonb, public.payment_mode, uuid) to authenticated;
