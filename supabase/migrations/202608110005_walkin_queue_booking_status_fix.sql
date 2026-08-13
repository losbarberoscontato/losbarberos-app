-- The organizations table does not expose an accepting_bookings column.
-- Reuse the canonical billing-aware predicate used by public booking RPCs.

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
  where queue_public_id = p_queue_public_id;
  if not public.organization_accepts_new_bookings(v_org.id) then return null; end if;

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
  where queue_public_id = p_queue_public_id;
  if not public.organization_accepts_new_bookings(v_org.id) then return null; end if;

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
