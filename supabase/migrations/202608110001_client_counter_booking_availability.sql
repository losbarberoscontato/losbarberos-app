-- Client booking temporarily uses only pay-at-counter. Online payment, wallet
-- and deposit behavior remain deferred; existing historical appointments stay intact.

alter function public.get_available_slots(text, uuid, date, jsonb)
  rename to get_available_slots_legacy_window;

revoke all on function public.get_available_slots_legacy_window(text, uuid, date, jsonb)
  from public, anon, authenticated;

create or replace function public.get_available_slots(
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
  v_timezone text;
begin
  select o.timezone into strict v_timezone
  from public.organizations o
  where o.slug = p_organization_slug;

  if p_local_date < (now() at time zone v_timezone)::date
     or p_local_date > (now() at time zone v_timezone)::date + 15 then
    raise exception using errcode = '22023', message = 'availability date outside allowed window';
  end if;

  return public.get_available_slots_legacy_window(
    p_organization_slug, p_barber_id, p_local_date, p_selections
  );
exception
  when no_data_found then return null;
end;
$$;

create or replace function public.get_available_slots_for_date(
  p_organization_slug text,
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
  v_barber record;
  v_availability jsonb;
  v_option jsonb;
  v_options jsonb := '[]'::jsonb;
  v_duration integer := null;
  v_total bigint := null;
begin
  select * into strict v_org from public.organizations where slug = p_organization_slug;
  if p_local_date < (now() at time zone v_org.timezone)::date
     or p_local_date > (now() at time zone v_org.timezone)::date + 15 then
    raise exception using errcode = '22023', message = 'availability date outside allowed window';
  end if;

  for v_barber in
    select b.id, b.display_name
    from public.barbers b
    where b.organization_id = v_org.id and b.active
    order by b.display_name, b.id
  loop
    begin
      v_availability := public.get_available_slots(
        p_organization_slug, v_barber.id, p_local_date, p_selections
      );
    exception when sqlstate '22023' then
      continue;
    end;
    if v_availability is null or coalesce(jsonb_array_length(v_availability -> 'slots'), 0) = 0 then
      continue;
    end if;
    v_duration := coalesce(v_duration, (v_availability ->> 'duration_minutes')::integer);
    v_total := coalesce(v_total, (v_availability ->> 'total_cents')::bigint);
    for v_option in select value from jsonb_array_elements(v_availability -> 'slots')
    loop
      v_options := v_options || jsonb_build_array(jsonb_build_object(
        'barber_id', v_barber.id,
        'barber_name', v_barber.display_name,
        'starts_at', v_option -> 'starts_at',
        'ends_at', v_option -> 'ends_at'
      ));
    end loop;
  end loop;

  return jsonb_build_object(
    'duration_minutes', v_duration,
    'total_cents', v_total,
    'options', coalesce((
      select jsonb_agg(option order by option ->> 'starts_at', option ->> 'barber_name')
      from jsonb_array_elements(v_options) option
    ), '[]'::jsonb)
  );
exception
  when no_data_found then return null;
end;
$$;

create or replace function public.create_appointment_hold(
  p_organization_id uuid,
  p_customer_id uuid,
  p_barber_id uuid,
  p_starts_at timestamptz,
  p_selections jsonb,
  p_payment_mode public.payment_mode default 'COUNTER'
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
  v_local_start := p_starts_at at time zone v_org.timezone;
  if v_local_start::date > (now() at time zone v_org.timezone)::date + 15 then
    raise exception using errcode = '22023', message = 'appointment date outside allowed window';
  end if;
  select * into strict v_barber from public.barbers
    where id = p_barber_id and organization_id = p_organization_id and active;
  if extract(second from v_local_start) <> 0
     or mod(extract(minute from v_local_start)::integer, v_org.slot_interval_minutes) <> 0 then
    raise exception using errcode = '22023', message = 'start time is not aligned to slot interval';
  end if;

  v_resolution := public.resolve_booking_selection(p_organization_id, p_barber_id, p_selections, null);
  v_duration := (v_resolution ->> 'duration_minutes')::integer;
  v_occupied_minutes := ceil(v_duration::numeric / v_org.slot_interval_minutes)::integer * v_org.slot_interval_minutes;
  v_period := tstzrange(p_starts_at, p_starts_at + make_interval(mins => v_occupied_minutes), '[)');
  if not public.is_barber_available(p_organization_id, p_barber_id, v_period) then
    raise exception using errcode = '22023', message = 'barber is unavailable for requested period';
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
  insert into public.appointment_status_events (
    organization_id, appointment_id, to_status, reason, actor_user_id
  ) values (
    p_organization_id, v_appointment_id, 'CONFIRMED', 'customer_counter_booking_created', auth.uid()
  );

  return jsonb_build_object(
    'appointment_id', v_appointment_id,
    'status', 'CONFIRMED',
    'expires_at', null,
    'total_cents', v_total,
    'amount_due_now_cents', 0,
    'service_period', v_period
  );
exception
  when exclusion_violation then
    raise exception using errcode = '23P01', message = 'requested slot is no longer available';
  when no_data_found then
    raise exception using errcode = 'P0002', message = 'organization or barber not found';
end;
$$;

revoke all on function public.get_available_slots(text, uuid, date, jsonb) from public;
revoke all on function public.get_available_slots_for_date(text, date, jsonb) from public;
grant execute on function public.get_available_slots(text, uuid, date, jsonb) to anon, authenticated;
grant execute on function public.get_available_slots_for_date(text, date, jsonb) to anon, authenticated;
