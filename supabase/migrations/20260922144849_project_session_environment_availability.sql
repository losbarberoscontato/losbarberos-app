-- Ambientes disponíveis para uma sessão de projeto no período escolhido.
-- A lista é limitada à escala/override do profissional e aos ambientes livres.
create or replace function public.get_project_session_environments(
  p_organization_id uuid,
  p_session_id uuid,
  p_barber_id uuid,
  p_service_id uuid,
  p_starts_at timestamptz
)
returns table (
  id uuid,
  name text,
  sort_order integer
)
language plpgsql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_org public.organizations%rowtype;
  v_session public.project_engagement_sessions%rowtype;
  v_engagement public.project_engagements%rowtype;
  v_package public.project_packages%rowtype;
  v_service public.services%rowtype;
  v_barber public.barbers%rowtype;
  v_assignment public.project_package_service_assignments%rowtype;
  v_period tstzrange;
  v_local_start timestamp;
  v_local_end timestamp;
  v_occupied integer;
begin
  if not public.is_organization_owner(p_organization_id) then
    raise exception using errcode = '42501', message = 'organization owner required';
  end if;

  select * into strict v_org
  from public.organizations
  where id = p_organization_id;
  select * into strict v_session
  from public.project_engagement_sessions
  where id = p_session_id and organization_id = p_organization_id;
  if v_session.status <> 'OPEN' or v_session.appointment_id is not null then
    return;
  end if;
  select * into strict v_engagement
  from public.project_engagements
  where id = v_session.engagement_id
    and organization_id = p_organization_id
    and status = 'ACTIVE';
  select * into strict v_package
  from public.project_packages
  where id = v_engagement.package_id
    and organization_id = p_organization_id
    and active;
  select * into strict v_assignment
  from public.project_package_service_assignments
  where organization_id = p_organization_id
    and project_package_id = v_package.id
    and service_id = p_service_id
    and barber_id = p_barber_id;
  select * into strict v_service
  from public.services
  where id = p_service_id
    and organization_id = p_organization_id
    and active;
  select * into strict v_barber
  from public.barbers
  where id = p_barber_id
    and organization_id = p_organization_id
    and active;

  if p_starts_at <= now() then
    return;
  end if;
  v_local_start := p_starts_at at time zone v_org.timezone;
  if extract(second from v_local_start) <> 0
     or mod(extract(minute from v_local_start)::integer, v_org.slot_interval_minutes) <> 0 then
    return;
  end if;
  v_occupied := ceil(v_service.duration_minutes::numeric / v_org.slot_interval_minutes)::integer * v_org.slot_interval_minutes;
  v_period := tstzrange(p_starts_at, p_starts_at + make_interval(mins => v_occupied), '[)');
  v_local_end := upper(v_period) at time zone v_org.timezone;
  if v_local_start::date <> v_local_end::date then
    return;
  end if;

  if exists (
    select 1 from public.availability_exceptions ae
    where ae.organization_id = p_organization_id
      and ae.barber_id = p_barber_id
      and ae.kind = 'UNAVAILABLE'
      and ae.service_period && v_period
  ) then
    return;
  end if;

  return query
  select e.id, e.name, e.sort_order
  from public.agenda_environments e
  where e.organization_id = p_organization_id
    and e.location_id = v_barber.location_id
    and e.active
    and (
      exists (
        select 1 from public.availability_exceptions ae
        where ae.organization_id = p_organization_id
          and ae.barber_id = p_barber_id
          and ae.kind = 'AVAILABLE_OVERRIDE'
          and ae.environment_id = e.id
          and ae.service_period @> v_period
      )
      or exists (
        select 1 from public.work_intervals wi
        where wi.organization_id = p_organization_id
          and wi.barber_id = p_barber_id
          and wi.environment_id = e.id
          and wi.active
          and wi.weekday = extract(dow from v_local_start)::smallint
          and wi.starts_at <= v_local_start::time
          and wi.ends_at >= v_local_end::time
      )
    )
    and not exists (
      select 1 from public.appointments a
      where a.organization_id = p_organization_id
        and a.environment_id = e.id
        and a.status in ('HELD', 'PENDING_PAYMENT', 'CONFIRMED', 'IN_SERVICE')
        and a.service_period && v_period
    )
    and not exists (
      select 1 from public.appointments a
      where a.organization_id = p_organization_id
        and a.barber_id = p_barber_id
        and a.status in ('HELD', 'PENDING_PAYMENT', 'CONFIRMED', 'IN_SERVICE')
        and a.service_period && v_period
    )
    and not exists (
      select 1 from public.walkin_queue_holds h
      where h.organization_id = p_organization_id
        and h.barber_id = p_barber_id
        and h.consumed_at is null
        and h.expires_at > now()
        and h.service_period && v_period
    )
  order by e.sort_order, e.id;
exception
  when no_data_found then
    return;
end;
$$;

revoke all on function public.get_project_session_environments(uuid, uuid, uuid, uuid, timestamptz) from public, anon;
grant execute on function public.get_project_session_environments(uuid, uuid, uuid, uuid, timestamptz) to authenticated;

-- Um ambiente explicitamente escolhido precisa estar na escala do profissional.
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
  v_requested uuid := coalesce(
    p_environment_id,
    nullif(current_setting('app.agenda_environment_id', true), '')::uuid
  );
begin
  if isempty(p_service_period) then return null; end if;
  select timezone into v_timezone from public.organizations where id = p_organization_id;
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
      where ae.organization_id = p_organization_id
        and ae.barber_id = p_barber_id
        and ae.kind = 'UNAVAILABLE'
        and ae.service_period && p_service_period
    ) then
      raise exception using errcode = '22023', message = 'barber is unavailable for requested period';
    end if;
    if not exists (
      select 1 from public.availability_exceptions ae
      where ae.organization_id = p_organization_id
        and ae.barber_id = p_barber_id
        and ae.kind = 'AVAILABLE_OVERRIDE'
        and ae.environment_id = v_requested
        and ae.service_period @> p_service_period
    ) and not exists (
      select 1 from public.work_intervals wi
      where wi.organization_id = p_organization_id
        and wi.barber_id = p_barber_id
        and wi.environment_id = v_requested
        and wi.active
        and wi.weekday = extract(dow from v_local_start)::smallint
        and wi.starts_at <= v_local_start::time
        and wi.ends_at >= v_local_end::time
    ) then
      raise exception using errcode = '22023', message = 'environment is not assigned to barber for requested period';
    end if;
    if exists (
      select 1 from public.appointments a
      where a.organization_id = p_organization_id
        and a.environment_id = v_requested
        and a.id is distinct from p_appointment_id
        and a.status in ('HELD', 'PENDING_PAYMENT', 'CONFIRMED', 'IN_SERVICE')
        and a.service_period && p_service_period
    ) then
      raise exception using errcode = '23P01', message = 'environment is no longer available';
    end if;
    if exists (
      select 1 from public.walkin_queue_holds h
      where h.organization_id = p_organization_id
        and h.barber_id = p_barber_id
        and h.consumed_at is null
        and h.expires_at > now()
        and h.service_period && p_service_period
    ) then
      raise exception using errcode = '23P01', message = 'requested slot is no longer available';
    end if;
    return v_requested;
  end if;

  if exists (
    select 1 from public.appointments a
    where a.organization_id = p_organization_id and a.barber_id = p_barber_id
      and a.environment_id is null
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
        and a.id is distinct from p_appointment_id
        and a.service_period && p_service_period
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

revoke all on function public.resolve_appointment_environment(uuid, uuid, uuid, tstzrange, uuid, uuid) from public, anon, authenticated;
