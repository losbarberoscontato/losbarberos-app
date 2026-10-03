-- Permit optional concurrent bookings by one professional only when every
-- appointment uses a distinct assigned environment. Defaults preserve current
-- single-appointment behavior for existing and new professionals.
alter table public.barbers
  add column if not exists allow_parallel_environment_appointments boolean not null default false;

alter table public.work_intervals
  drop constraint if exists work_intervals_no_overlap;
alter table public.appointments
  drop constraint if exists appointments_no_barber_overlap;

create index if not exists work_intervals_barber_weekday_active_idx
  on public.work_intervals (organization_id, barber_id, weekday)
  where active;
create index if not exists appointments_barber_active_period_idx
  on public.appointments using gist (organization_id, barber_id, service_period)
  where status in ('HELD', 'PENDING_PAYMENT', 'CONFIRMED', 'IN_SERVICE');

create or replace function public.guard_parallel_barber_environment_capacity()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_allow_parallel boolean := false;
  v_overlaps boolean := false;
  v_validate_appointment boolean := false;
begin
  if tg_table_name = 'work_intervals' then
    if tg_op = 'UPDATE' then
      if (old.organization_id, old.barber_id) is distinct from (new.organization_id, new.barber_id) then
        perform b.id from public.barbers b
        where (b.organization_id = old.organization_id and b.id = old.barber_id)
           or (b.organization_id = new.organization_id and b.id = new.barber_id)
        order by b.organization_id, b.id for update;
      else
        perform 1 from public.barbers b
        where b.id = new.barber_id and b.organization_id = new.organization_id
        for update;
      end if;
    else
      perform 1 from public.barbers b
      where b.id = new.barber_id and b.organization_id = new.organization_id
      for update;
    end if;

    select coalesce(b.allow_parallel_environment_appointments, false)
    into v_allow_parallel
    from public.barbers b
    where b.id = new.barber_id and b.organization_id = new.organization_id;

    if new.active then
      select exists (
        select 1 from public.work_intervals wi
        where wi.organization_id = new.organization_id
          and wi.barber_id = new.barber_id
          and wi.id is distinct from new.id
          and wi.active
          and wi.weekday = new.weekday
          and int4range((extract(epoch from wi.starts_at) / 60)::integer,
                        (extract(epoch from wi.ends_at) / 60)::integer, '[)')
              && int4range((extract(epoch from new.starts_at) / 60)::integer,
                           (extract(epoch from new.ends_at) / 60)::integer, '[)')
          and (not v_allow_parallel
            or new.environment_id is null
            or wi.environment_id is null
            or wi.environment_id = new.environment_id)
      ) into v_overlaps;
      if v_overlaps then
        raise exception using errcode = '23P01', message = 'barber already has a work interval in this period';
      end if;
    end if;
    return new;
  end if;

  if tg_table_name = 'appointments' then
    if tg_op = 'UPDATE' then
      if (old.organization_id, old.barber_id) is distinct from (new.organization_id, new.barber_id) then
        perform b.id from public.barbers b
        where (b.organization_id = old.organization_id and b.id = old.barber_id)
           or (b.organization_id = new.organization_id and b.id = new.barber_id)
        order by b.organization_id, b.id for update;
      else
        perform 1 from public.barbers b
        where b.id = new.barber_id and b.organization_id = new.organization_id
        for update;
      end if;
    else
      perform 1 from public.barbers b
      where b.id = new.barber_id and b.organization_id = new.organization_id
      for update;
    end if;

    if tg_op = 'INSERT' then
      v_validate_appointment := true;
    else
      v_validate_appointment := new.status in ('HELD', 'PENDING_PAYMENT', 'CONFIRMED', 'IN_SERVICE')
        and (old.status not in ('HELD', 'PENDING_PAYMENT', 'CONFIRMED', 'IN_SERVICE')
          or old.organization_id is distinct from new.organization_id
          or old.barber_id is distinct from new.barber_id
          or old.service_period is distinct from new.service_period
          or old.environment_id is distinct from new.environment_id);
    end if;

    if v_validate_appointment then
      select coalesce(b.allow_parallel_environment_appointments, false)
      into v_allow_parallel
      from public.barbers b
      where b.id = new.barber_id and b.organization_id = new.organization_id;

      select exists (
        select 1 from public.appointments a
        where a.organization_id = new.organization_id
          and a.barber_id = new.barber_id
          and a.id is distinct from new.id
          and a.status in ('HELD', 'PENDING_PAYMENT', 'CONFIRMED', 'IN_SERVICE')
          and a.service_period && new.service_period
          and (not v_allow_parallel
            or new.environment_id is null
            or a.environment_id is null
            or a.environment_id = new.environment_id)
      ) into v_overlaps;
      if v_overlaps then
        raise exception using errcode = '23P01', message = 'barber is already serving a client during this period';
      end if;
    end if;
    return new;
  end if;

  raise exception using errcode = '22023', message = 'unsupported parallel capacity trigger table';
end;
$$;

revoke all on function public.guard_parallel_barber_environment_capacity() from public, anon, authenticated;

drop trigger if exists work_intervals_guard_parallel_capacity on public.work_intervals;
create trigger work_intervals_guard_parallel_capacity
  before insert or update on public.work_intervals
  for each row execute function public.guard_parallel_barber_environment_capacity();

drop trigger if exists appointments_guard_parallel_capacity on public.appointments;
create trigger appointments_guard_parallel_capacity
  before insert or update of organization_id, barber_id, service_period, environment_id, status
  on public.appointments
  for each row execute function public.guard_parallel_barber_environment_capacity();

create or replace function public.resolve_appointment_environment(
  p_organization_id uuid,
  p_barber_id uuid,
  p_location_id uuid,
  p_service_period tstzrange,
  p_environment_id uuid default null,
  p_appointment_id uuid default null
)
returns uuid
language plpgsql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_timezone text;
  v_local_start timestamp;
  v_local_end timestamp;
  v_environment uuid;
  v_allow_parallel boolean := false;
  v_requested uuid := coalesce(
    p_environment_id,
    nullif(current_setting('app.agenda_environment_id', true), '')::uuid
  );
begin
  if isempty(p_service_period) then return null; end if;
  select o.timezone, coalesce(b.allow_parallel_environment_appointments, false)
  into v_timezone, v_allow_parallel
  from public.organizations o
  join public.barbers b on b.organization_id = o.id and b.id = p_barber_id
  where o.id = p_organization_id;
  if v_timezone is null then return null; end if;
  v_local_start := lower(p_service_period) at time zone v_timezone;
  v_local_end := upper(p_service_period) at time zone v_timezone;
  if v_local_start::date <> v_local_end::date then return null; end if;

  if v_requested is not null then
    if not exists (
      select 1 from public.agenda_environments e
      where e.id = v_requested and e.organization_id = p_organization_id
        and e.location_id = p_location_id and e.active
    ) then
      raise exception using errcode = '22023', message = 'environment is not active for this unit';
    end if;
    if exists (
      select 1 from public.availability_exceptions ae
      where ae.organization_id = p_organization_id and ae.barber_id = p_barber_id
        and ae.kind = 'UNAVAILABLE' and ae.service_period && p_service_period
    ) then
      raise exception using errcode = '22023', message = 'barber is unavailable for requested period';
    end if;
    if not exists (
      select 1 from public.availability_exceptions ae
      where ae.organization_id = p_organization_id and ae.barber_id = p_barber_id
        and ae.kind = 'AVAILABLE_OVERRIDE' and ae.environment_id = v_requested
        and ae.service_period @> p_service_period
    ) and not exists (
      select 1 from public.work_intervals wi
      where wi.organization_id = p_organization_id and wi.barber_id = p_barber_id
        and wi.environment_id = v_requested and wi.active
        and wi.weekday = extract(dow from v_local_start)::smallint
        and wi.starts_at <= v_local_start::time and wi.ends_at >= v_local_end::time
    ) then
      raise exception using errcode = '22023', message = 'environment is not assigned to barber for requested period';
    end if;
    if not v_allow_parallel and exists (
      select 1 from public.appointments a
      where a.organization_id = p_organization_id and a.barber_id = p_barber_id
        and a.id is distinct from p_appointment_id
        and a.status in ('HELD', 'PENDING_PAYMENT', 'CONFIRMED', 'IN_SERVICE')
        and a.service_period && p_service_period
    ) then
      raise exception using errcode = '23P01', message = 'barber is already serving a client during this period';
    end if;
    if exists (
      select 1 from public.appointments a
      where a.organization_id = p_organization_id and a.environment_id = v_requested
        and a.id is distinct from p_appointment_id
        and a.status in ('HELD', 'PENDING_PAYMENT', 'CONFIRMED', 'IN_SERVICE')
        and a.service_period && p_service_period
    ) then
      raise exception using errcode = '23P01', message = 'environment is no longer available';
    end if;
    if exists (
      select 1 from public.walkin_queue_holds h
      where h.organization_id = p_organization_id and h.barber_id = p_barber_id
        and h.consumed_at is null and h.expires_at > now()
        and h.service_period && p_service_period
    ) then
      raise exception using errcode = '23P01', message = 'requested slot is no longer available';
    end if;
    return v_requested;
  end if;

  -- Unassigned legacy reservations remain a full-professional hold.
  if exists (
    select 1 from public.appointments a
    where a.organization_id = p_organization_id and a.barber_id = p_barber_id
      and a.environment_id is null and a.id is distinct from p_appointment_id
      and a.status in ('HELD', 'PENDING_PAYMENT', 'CONFIRMED', 'IN_SERVICE')
      and a.service_period && p_service_period
  ) then
    return null;
  end if;
  if not v_allow_parallel and exists (
    select 1 from public.appointments a
    where a.organization_id = p_organization_id and a.barber_id = p_barber_id
      and a.id is distinct from p_appointment_id
      and a.status in ('HELD', 'PENDING_PAYMENT', 'CONFIRMED', 'IN_SERVICE')
      and a.service_period && p_service_period
  ) then
    return null;
  end if;

  select e.id into v_environment
  from public.agenda_environments e
  where e.organization_id = p_organization_id
    and e.location_id = p_location_id and e.active
    and (
      exists (
        select 1 from public.availability_exceptions ae
        where ae.organization_id = p_organization_id and ae.barber_id = p_barber_id
          and ae.kind = 'AVAILABLE_OVERRIDE' and ae.environment_id = e.id
          and ae.service_period @> p_service_period
      )
      or exists (
        select 1 from public.work_intervals wi
        where wi.organization_id = p_organization_id and wi.barber_id = p_barber_id
          and wi.environment_id = e.id and wi.active
          and wi.weekday = extract(dow from v_local_start)::smallint
          and wi.starts_at <= v_local_start::time and wi.ends_at >= v_local_end::time
      )
    )
    and not exists (
      select 1 from public.appointments a
      where a.organization_id = p_organization_id and a.environment_id = e.id
        and a.status in ('HELD', 'PENDING_PAYMENT', 'CONFIRMED', 'IN_SERVICE')
        and a.id is distinct from p_appointment_id and a.service_period && p_service_period
    )
    and not exists (
      select 1 from public.walkin_queue_holds h
      where h.organization_id = p_organization_id and h.barber_id = p_barber_id
        and h.consumed_at is null and h.expires_at > now()
        and h.service_period && p_service_period
    )
  order by e.sort_order, e.id
  limit 1;
  return v_environment;
end;
$$;

revoke all on function public.resolve_appointment_environment(uuid,uuid,uuid,tstzrange,uuid,uuid) from public, anon, authenticated;

-- The legacy slot generator used to reject every overlapping appointment for
-- the professional. Delegate that decision to is_barber_available(), which
-- now checks the opt-in flag and chooses a free assigned environment.
create or replace function public.get_available_slots_legacy_window(
  p_organization_slug text,
  p_barber_id uuid,
  p_local_date date,
  p_selections jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org public.organizations%rowtype;
  v_resolution jsonb;
  v_source record;
  v_duration integer;
  v_occupied integer;
  v_local_start timestamp;
  v_local_limit timestamp;
  v_start timestamptz;
  v_period tstzrange;
  v_slots jsonb := '[]'::jsonb;
  v_seen_starts timestamptz[] := array[]::timestamptz[];
begin
  select * into strict v_org from public.organizations where slug = p_organization_slug;
  if not public.organization_accepts_new_bookings(v_org.id) then
    return jsonb_build_object('duration_minutes', null, 'total_cents', null, 'slots', v_slots);
  end if;
  if p_local_date < (now() at time zone v_org.timezone)::date
     or p_local_date > (now() at time zone v_org.timezone)::date + 180 then
    raise exception using errcode = '22023', message = 'availability date outside allowed window';
  end if;
  v_resolution := public.resolve_booking_selection(v_org.id, p_barber_id, p_selections, null);
  v_duration := (v_resolution ->> 'duration_minutes')::integer;
  v_occupied := ceil(v_duration::numeric / v_org.slot_interval_minutes)::integer
    * v_org.slot_interval_minutes;

  for v_source in
    select sources.local_start, sources.local_limit
    from (
      select p_local_date + wi.starts_at as local_start,
        p_local_date + wi.ends_at as local_limit
      from public.work_intervals wi
      where wi.organization_id = v_org.id and wi.barber_id = p_barber_id
        and wi.active and wi.weekday = extract(dow from p_local_date)::smallint
      union all
      select timezone(v_org.timezone, greatest(lower(ae.service_period), p_local_date::timestamp at time zone v_org.timezone)) as local_start,
        timezone(v_org.timezone, least(upper(ae.service_period), (p_local_date + 1)::timestamp at time zone v_org.timezone)) as local_limit
      from public.availability_exceptions ae
      where ae.organization_id = v_org.id and ae.barber_id = p_barber_id
        and ae.kind = 'AVAILABLE_OVERRIDE'
        and ae.service_period && tstzrange(
          p_local_date::timestamp at time zone v_org.timezone,
          (p_local_date + 1)::timestamp at time zone v_org.timezone, '[)'
        )
    ) sources
    where sources.local_start < sources.local_limit
    order by sources.local_start, sources.local_limit
  loop
    v_local_start := date_trunc('day', v_source.local_start)
      + make_interval(mins => ceil(extract(epoch from (v_source.local_start - date_trunc('day', v_source.local_start)))
        / 60 / v_org.slot_interval_minutes)::integer * v_org.slot_interval_minutes);
    v_local_limit := v_source.local_limit;
    while v_local_start + make_interval(mins => v_occupied) <= v_local_limit loop
      v_start := v_local_start at time zone v_org.timezone;
      v_period := tstzrange(v_start, v_start + make_interval(mins => v_occupied), '[)');
      if v_start > now()
         and not (v_start = any(v_seen_starts))
         and public.is_barber_available(v_org.id, p_barber_id, v_period) then
        v_slots := v_slots || jsonb_build_array(jsonb_build_object('starts_at', v_start, 'ends_at', upper(v_period)));
        v_seen_starts := array_append(v_seen_starts, v_start);
      end if;
      v_local_start := v_local_start + make_interval(mins => v_org.slot_interval_minutes);
    end loop;
  end loop;
  return jsonb_build_object(
    'duration_minutes', v_duration,
    'occupied_minutes', v_occupied,
    'total_cents', (v_resolution ->> 'total_cents')::bigint,
    'slots', v_slots
  );
exception when no_data_found then return null;
end;
$$;

revoke all on function public.get_available_slots_legacy_window(text,uuid,date,jsonb) from public, anon, authenticated;
