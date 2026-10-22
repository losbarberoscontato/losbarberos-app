-- Qualify table columns in this RETURNS TABLE function so its output variables
-- (id, name, sort_order) cannot shadow columns in SQL statements.
create or replace function public.get_project_session_environments(
  p_organization_id uuid, p_session_id uuid, p_barber_id uuid, p_service_id uuid, p_starts_at timestamptz
)
returns table (id uuid, name text, sort_order integer)
language plpgsql stable security definer set search_path = public, extensions, pg_temp as $$
declare
  v_org public.organizations%rowtype; v_session public.project_engagement_sessions%rowtype;
  v_engagement public.project_engagements%rowtype; v_package public.project_packages%rowtype;
  v_service public.services%rowtype; v_barber public.barbers%rowtype;
  v_period tstzrange; v_local_start timestamp; v_local_end timestamp; v_occupied integer;
begin
  select organization.* into strict v_org from public.organizations organization where organization.id = p_organization_id;
  select session.* into strict v_session from public.project_engagement_sessions session
   where session.id = p_session_id and session.organization_id = p_organization_id;
  select engagement.* into strict v_engagement from public.project_engagements engagement
   where engagement.id = v_session.engagement_id and engagement.organization_id = p_organization_id;
  if not public.is_organization_owner(p_organization_id) and not public.is_organization_customer(p_organization_id, v_engagement.customer_id) then
    raise exception using errcode = '42501', message = 'project session availability denied';
  end if;
  if v_session.status <> 'OPEN' then return; end if;
  if v_engagement.status <> 'ACTIVE' and not exists (select 1 from public.customer_project_cancellation_requests request
    where request.organization_id = p_organization_id and request.engagement_id = v_engagement.id
      and request.status = 'CONFIRMED' and request.last_session_id = v_session.id) then return; end if;
  if exists (select 1 from public.customer_project_cancellation_requests request where request.organization_id = p_organization_id
    and request.engagement_id = v_engagement.id and request.status = 'PENDING'
    and (request.last_session_id is null or v_session.session_number >
      (select cutoff.session_number from public.project_engagement_sessions cutoff
        where cutoff.id = request.last_session_id and cutoff.organization_id = p_organization_id))) then return; end if;
  select pkg.* into strict v_package from public.project_packages pkg
   where pkg.id = v_engagement.package_id and pkg.organization_id = p_organization_id;
  perform 1 from public.project_package_service_assignments assignment where assignment.organization_id = p_organization_id
    and assignment.project_package_id = v_package.id and assignment.service_id = p_service_id and assignment.barber_id = p_barber_id;
  if not found then return; end if;
  select service.* into strict v_service from public.services service
   where service.id = p_service_id and service.organization_id = p_organization_id and service.active;
  select barber.* into strict v_barber from public.barbers barber
   where barber.id = p_barber_id and barber.organization_id = p_organization_id and barber.active;
  if p_starts_at <= now() then return; end if;
  v_local_start := p_starts_at at time zone v_org.timezone;
  if extract(second from v_local_start) <> 0 or mod(extract(minute from v_local_start)::integer, v_org.slot_interval_minutes) <> 0 then return; end if;
  v_occupied := ceil(v_service.duration_minutes::numeric / v_org.slot_interval_minutes)::integer * v_org.slot_interval_minutes;
  v_period := tstzrange(p_starts_at, p_starts_at + make_interval(mins => v_occupied), '[)');
  v_local_end := upper(v_period) at time zone v_org.timezone;
  if v_local_start::date <> v_local_end::date or exists (select 1 from public.availability_exceptions exception_row
    where exception_row.organization_id = p_organization_id and exception_row.barber_id = p_barber_id
      and exception_row.kind = 'UNAVAILABLE' and exception_row.service_period && v_period) then return; end if;
  return query select environment.id, environment.name, environment.sort_order from public.agenda_environments environment
   where environment.organization_id = p_organization_id and environment.location_id = v_barber.location_id and environment.active
     and (exists (select 1 from public.availability_exceptions exception_row where exception_row.organization_id = p_organization_id
       and exception_row.barber_id = p_barber_id and exception_row.kind = 'AVAILABLE_OVERRIDE'
       and exception_row.environment_id = environment.id and exception_row.service_period @> v_period)
       or exists (select 1 from public.work_intervals interval_row where interval_row.organization_id = p_organization_id
       and interval_row.barber_id = p_barber_id and interval_row.environment_id = environment.id and interval_row.active
       and interval_row.weekday = extract(dow from v_local_start)::smallint
       and interval_row.starts_at <= v_local_start::time and interval_row.ends_at >= v_local_end::time))
     and not exists (select 1 from public.appointments appointment where appointment.organization_id = p_organization_id
       and appointment.environment_id = environment.id and appointment.status in ('HELD', 'PENDING_PAYMENT', 'CONFIRMED', 'IN_SERVICE')
       and appointment.service_period && v_period)
     and not exists (select 1 from public.appointments appointment where appointment.organization_id = p_organization_id
       and appointment.barber_id = p_barber_id and appointment.status in ('HELD', 'PENDING_PAYMENT', 'CONFIRMED', 'IN_SERVICE')
       and appointment.service_period && v_period)
     and not exists (select 1 from public.walkin_queue_holds hold where hold.organization_id = p_organization_id
       and hold.barber_id = p_barber_id and hold.consumed_at is null and hold.expires_at > now() and hold.service_period && v_period)
   order by environment.sort_order, environment.id;
exception when no_data_found then return;
end $$;
revoke all on function public.get_project_session_environments(uuid, uuid, uuid, uuid, timestamptz) from public, anon;
grant execute on function public.get_project_session_environments(uuid, uuid, uuid, uuid, timestamptz) to authenticated;
