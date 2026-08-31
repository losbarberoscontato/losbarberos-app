-- Unify authenticated booking protection around appointments. Anonymous QR
-- holds remain provisional and are atomically promoted to the full service
-- period after the customer, service and barber are known.

alter table public.organizations
  alter column hold_duration_minutes set default 3;

update public.organizations
set hold_duration_minutes = 3
where hold_duration_minutes is distinct from 3;

alter table public.appointments
  add column if not exists booking_hold_idempotency_key uuid,
  add column if not exists booking_hold_fingerprint text;

create unique index if not exists appointments_booking_hold_idempotency_key
  on public.appointments (organization_id, created_by, booking_hold_idempotency_key)
  where booking_hold_idempotency_key is not null;

comment on column public.appointments.booking_hold_idempotency_key is
  'Client-generated retry key for an authenticated booking hold.';
comment on column public.appointments.booking_hold_fingerprint is
  'Canonical request fingerprint used to reject idempotency-key reuse with different booking data.';

create or replace function public.expire_conflicting_appointment_holds(
  p_organization_id uuid,
  p_barber_id uuid,
  p_service_period tstzrange
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row record;
  v_count integer := 0;
begin
  for v_row in
    select a.id, a.organization_id, a.status
    from public.appointments a
    where a.organization_id = p_organization_id
      and a.barber_id = p_barber_id
      and a.status in ('HELD', 'PENDING_PAYMENT')
      and a.hold_expires_at <= now()
      and a.service_period && p_service_period
    for update
  loop
    update public.appointments
    set status = 'EXPIRED', hold_expires_at = null, version = version + 1
    where id = v_row.id;
    insert into public.appointment_status_events (
      organization_id, appointment_id, from_status, to_status, reason
    ) values (
      v_row.organization_id, v_row.id, v_row.status, 'EXPIRED', 'hold_expired'
    );
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.expire_conflicting_appointment_holds(
  uuid, uuid, tstzrange
) from public, anon, authenticated;

-- Both legacy overloads confirm immediately and bypass the new lifecycle.
drop function if exists public.create_appointment_hold(
  uuid, uuid, uuid, timestamptz, jsonb, public.payment_mode
);
drop function if exists public.create_appointment_hold(
  uuid, uuid, uuid, timestamptz, jsonb, public.payment_mode, uuid
);

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
  select * into strict v_org from public.organizations
  where slug = p_organization_slug;
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
      select
        timezone(v_org.timezone, greatest(
          lower(ae.service_period), p_local_date::timestamp at time zone v_org.timezone
        )) as local_start,
        timezone(v_org.timezone, least(
          upper(ae.service_period), (p_local_date + 1)::timestamp at time zone v_org.timezone
        )) as local_limit
      from public.availability_exceptions ae
      where ae.organization_id = v_org.id and ae.barber_id = p_barber_id
        and ae.kind = 'AVAILABLE_OVERRIDE'
        and ae.service_period && tstzrange(
          p_local_date::timestamp at time zone v_org.timezone,
          (p_local_date + 1)::timestamp at time zone v_org.timezone,
          '[)'
        )
    ) sources
    where sources.local_start < sources.local_limit
    order by sources.local_start, sources.local_limit
  loop
    v_local_start := date_trunc('day', v_source.local_start)
      + make_interval(mins => (
        ceil(extract(epoch from (
          v_source.local_start - date_trunc('day', v_source.local_start)
        )) / 60 / v_org.slot_interval_minutes)::integer * v_org.slot_interval_minutes
      ));
    v_local_limit := v_source.local_limit;

    while v_local_start + make_interval(mins => v_occupied) <= v_local_limit loop
      v_start := v_local_start at time zone v_org.timezone;
      v_period := tstzrange(v_start, v_start + make_interval(mins => v_occupied), '[)');
      if v_start > now()
         and not (v_start = any(v_seen_starts))
         and public.is_barber_available(v_org.id, p_barber_id, v_period)
         and not exists (
           select 1 from public.appointments a
           where a.organization_id = v_org.id and a.barber_id = p_barber_id
             and (
               a.status in ('CONFIRMED', 'IN_SERVICE')
               or (a.status in ('HELD', 'PENDING_PAYMENT') and a.hold_expires_at > now())
             )
             and a.service_period && v_period
         )
         and not exists (
           select 1 from public.walkin_queue_holds h
           where h.organization_id = v_org.id and h.barber_id = p_barber_id
             and h.consumed_at is null and h.expires_at > now()
             and h.service_period && v_period
         ) then
        v_slots := v_slots || jsonb_build_array(jsonb_build_object(
          'starts_at', v_start,
          'ends_at', upper(v_period)
        ));
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
exception when no_data_found then
  return null;
end;
$$;

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
    + make_interval(mins => (
      v_org.slot_interval_minutes
      - mod(extract(minute from v_local_now)::integer, v_org.slot_interval_minutes)
    ) % v_org.slot_interval_minutes);
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
        series.slot_start,
        series.slot_start + make_interval(mins => v_org.slot_interval_minutes),
        '[)'
      ))
      and not exists (
        select 1 from public.appointments a
        where a.organization_id = v_org.id and a.barber_id = b.id
          and (
            a.status in ('CONFIRMED', 'IN_SERVICE')
            or (a.status in ('HELD', 'PENDING_PAYMENT') and a.hold_expires_at > now())
          )
          and a.service_period && tstzrange(
            series.slot_start,
            series.slot_start + make_interval(mins => v_org.slot_interval_minutes),
            '[)'
          )
      )
      and not exists (
        select 1 from public.walkin_queue_holds h
        where h.organization_id = v_org.id and h.barber_id = b.id
          and h.consumed_at is null and h.expires_at > now()
          and h.service_period && tstzrange(
            series.slot_start,
            series.slot_start + make_interval(mins => v_org.slot_interval_minutes),
            '[)'
          )
      )
  ) candidate;

  return jsonb_build_object(
    'organization', jsonb_build_object(
      'name', v_org.name,
      'slug', v_org.slug,
      'timezone', v_org.timezone
    ),
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
  v_expires_at timestamptz;
begin
  select * into strict v_org from public.organizations
  where queue_public_id = p_queue_public_id;
  if not public.organization_accepts_new_bookings(v_org.id) then return null; end if;

  -- Cross-table exclusion cannot protect appointments from queue holds. This
  -- short transaction lock makes both writers recheck conflicts in sequence.
  perform 1 from public.barbers b
  where b.id = p_barber_id and b.organization_id = v_org.id and b.active
  for update;
  if not found then return null; end if;

  v_period := tstzrange(
    p_starts_at,
    p_starts_at + make_interval(mins => v_org.slot_interval_minutes),
    '[)'
  );
  if p_starts_at <= now()
     or (p_starts_at at time zone v_org.timezone)::date
       <> (now() at time zone v_org.timezone)::date
     or extract(second from p_starts_at at time zone v_org.timezone) <> 0
     or mod(extract(minute from p_starts_at at time zone v_org.timezone)::integer, v_org.slot_interval_minutes) <> 0
     or not public.is_barber_available(v_org.id, p_barber_id, v_period) then
    raise exception using errcode = '22023', message = 'requested slot is no longer available';
  end if;

  delete from public.walkin_queue_holds
  where organization_id = v_org.id and barber_id = p_barber_id
    and expires_at <= now() and consumed_at is null;
  perform public.expire_conflicting_appointment_holds(
    v_org.id, p_barber_id, v_period
  );

  if exists (
    select 1 from public.appointments a
    where a.organization_id = v_org.id and a.barber_id = p_barber_id
      and (
        a.status in ('CONFIRMED', 'IN_SERVICE')
        or (a.status in ('HELD', 'PENDING_PAYMENT') and a.hold_expires_at > now())
      )
      and a.service_period && v_period
  ) then
    raise exception using errcode = '23P01', message = 'requested slot is no longer available';
  end if;

  v_expires_at := now() + make_interval(mins => v_org.hold_duration_minutes);
  insert into public.walkin_queue_holds (
    organization_id, barber_id, service_period, expires_at
  ) values (
    v_org.id, p_barber_id, v_period, v_expires_at
  ) returning id into v_hold_id;

  return jsonb_build_object('hold_id', v_hold_id, 'expires_at', v_expires_at);
exception
  when exclusion_violation then
    raise exception using errcode = '23P01', message = 'requested slot is no longer available';
  when no_data_found then return null;
end;
$$;

create or replace function public.create_customer_booking_hold(
  p_organization_id uuid,
  p_customer_id uuid,
  p_barber_id uuid,
  p_starts_at timestamptz,
  p_selections jsonb,
  p_idempotency_key uuid,
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
  v_existing public.appointments%rowtype;
  v_previous public.appointments%rowtype;
  v_resolution jsonb;
  v_duration integer;
  v_occupied_minutes integer;
  v_period tstzrange;
  v_appointment_id uuid;
  v_total bigint;
  v_local_start timestamp;
  v_expires_at timestamptz;
  v_fingerprint text;
begin
  if p_idempotency_key is null then
    raise exception using errcode = '22023', message = 'idempotency key is required';
  end if;
  if not public.is_organization_customer(p_organization_id, p_customer_id) then
    raise exception using errcode = '42501', message = 'customer identity does not match caller';
  end if;
  -- Serializes multiple tabs for one customer without taking a broad tenant lock.
  perform 1 from public.customers
  where id = p_customer_id and organization_id = p_organization_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'customer not found';
  end if;

  v_fingerprint := md5(jsonb_build_object(
    'customer_id', p_customer_id,
    'barber_id', p_barber_id,
    'starts_at', p_starts_at,
    'selections', p_selections,
    'payment_mode', 'COUNTER'
  )::text);

  -- A retry must reproduce the committed result even if availability, catalog
  -- or organization settings changed after the first response was lost.
  select * into v_existing
  from public.appointments a
  where a.organization_id = p_organization_id
    and a.created_by = auth.uid()
    and a.booking_hold_idempotency_key = p_idempotency_key
  for update;
  if found then
    if v_existing.booking_hold_fingerprint is distinct from v_fingerprint then
      raise exception using errcode = '22023', message = 'idempotency key belongs to another booking request';
    end if;
    if v_existing.status = 'HELD' and v_existing.hold_expires_at > now() then
      return jsonb_build_object(
        'appointment_id', v_existing.id,
        'status', v_existing.status,
        'expires_at', v_existing.hold_expires_at,
        'total_cents', v_existing.total_cents_snapshot,
        'amount_due_now_cents', 0,
        'service_period', v_existing.service_period
      );
    end if;
    if v_existing.status = 'CONFIRMED' then
      return jsonb_build_object(
        'appointment_id', v_existing.id,
        'status', v_existing.status,
        'expires_at', null,
        'total_cents', v_existing.total_cents_snapshot,
        'amount_due_now_cents', 0,
        'service_period', v_existing.service_period
      );
    end if;
    raise exception using errcode = '22023', message = 'appointment hold expired';
  end if;

  if not public.organization_accepts_new_bookings(p_organization_id) then
    raise exception using errcode = '42501', message = 'organization is not accepting new bookings';
  end if;
  if p_starts_at <= now() then
    raise exception using errcode = '22023', message = 'appointment start must be in the future';
  end if;

  select * into strict v_org from public.organizations where id = p_organization_id;
  -- Uses the same lock as create_walkin_queue_hold so an appointment and a QR
  -- hold cannot pass their cross-table checks concurrently.
  select * into strict v_barber from public.barbers
  where id = p_barber_id and organization_id = p_organization_id and active
  for update;

  v_local_start := p_starts_at at time zone v_org.timezone;
  if v_local_start::date > (now() at time zone v_org.timezone)::date + 15 then
    raise exception using errcode = '22023', message = 'appointment date outside allowed window';
  end if;
  if extract(second from v_local_start) <> 0
     or mod(extract(minute from v_local_start)::integer, v_org.slot_interval_minutes) <> 0 then
    raise exception using errcode = '22023', message = 'start time is not aligned to slot interval';
  end if;

  v_resolution := public.resolve_booking_selection(
    p_organization_id, p_barber_id, p_selections, null
  );
  v_duration := (v_resolution ->> 'duration_minutes')::integer;
  v_occupied_minutes := ceil(v_duration::numeric / v_org.slot_interval_minutes)::integer
    * v_org.slot_interval_minutes;
  v_period := tstzrange(
    p_starts_at,
    p_starts_at + make_interval(mins => v_occupied_minutes),
    '[)'
  );
  perform public.expire_conflicting_appointment_holds(
    p_organization_id, p_barber_id, v_period
  );
  select * into v_previous
  from public.appointments a
  where a.organization_id = p_organization_id
    and a.customer_id = p_customer_id
    and a.created_by = auth.uid()
    and a.status = 'HELD'
    and a.hold_expires_at > now()
  order by a.hold_expires_at desc
  limit 1
  for update;
  if found then
    if v_previous.booking_hold_fingerprint = v_fingerprint then
      return jsonb_build_object(
        'appointment_id', v_previous.id,
        'status', v_previous.status,
        'expires_at', v_previous.hold_expires_at,
        'total_cents', v_previous.total_cents_snapshot,
        'amount_due_now_cents', 0,
        'service_period', v_previous.service_period
      );
    end if;
    raise exception using errcode = '55000', message = 'customer already has an active booking hold';
  end if;

  if p_walkin_queue_hold_id is not null then
    perform 1 from public.walkin_queue_holds h
    where h.id = p_walkin_queue_hold_id
      and h.organization_id = p_organization_id
      and h.barber_id = p_barber_id
      and h.consumed_at is null
      and h.expires_at > now()
      and lower(h.service_period) = p_starts_at
    for update;
    if not found then
      raise exception using errcode = '22023', message = 'appointment hold expired';
    end if;
  end if;

  if exists (
    select 1 from public.walkin_queue_holds h
    where h.organization_id = p_organization_id
      and h.barber_id = p_barber_id
      and h.consumed_at is null
      and h.expires_at > now()
      and h.service_period && v_period
      and h.id is distinct from p_walkin_queue_hold_id
  ) or not public.is_barber_available(p_organization_id, p_barber_id, v_period) then
    raise exception using errcode = '23P01', message = 'requested slot is no longer available';
  end if;

  v_total := (v_resolution ->> 'total_cents')::bigint;
  v_expires_at := now() + make_interval(mins => v_org.hold_duration_minutes);
  insert into public.appointments (
    organization_id, location_id, customer_id, barber_id, status, source,
    service_period, hold_expires_at, payment_mode, currency,
    total_cents_snapshot, list_total_cents_snapshot, deposit_bps_snapshot,
    deposit_required_cents_snapshot, cancellation_lead_minutes_snapshot,
    created_by, booking_hold_idempotency_key, booking_hold_fingerprint
  ) values (
    p_organization_id, v_barber.location_id, p_customer_id, p_barber_id,
    'HELD', 'CUSTOMER', v_period, v_expires_at, 'COUNTER', v_org.currency,
    v_total, (v_resolution ->> 'list_total_cents')::bigint, 0, 0,
    v_org.cancellation_lead_minutes, auth.uid(), p_idempotency_key, v_fingerprint
  ) returning id into v_appointment_id;

  perform public.insert_resolved_appointment_items(
    v_appointment_id, p_organization_id, v_resolution
  );
  if p_walkin_queue_hold_id is not null then
    update public.walkin_queue_holds
    set consumed_at = now()
    where id = p_walkin_queue_hold_id;
  end if;
  insert into public.appointment_status_events (
    organization_id, appointment_id, to_status, reason, actor_user_id
  ) values (
    p_organization_id, v_appointment_id, 'HELD',
    'customer_booking_hold_created', auth.uid()
  );

  return jsonb_build_object(
    'appointment_id', v_appointment_id,
    'status', 'HELD',
    'expires_at', v_expires_at,
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

create or replace function public.confirm_customer_booking_hold(
  p_appointment_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_appointment public.appointments%rowtype;
begin
  select * into strict v_appointment
  from public.appointments a
  where a.id = p_appointment_id
  for update;

  if not public.is_organization_customer(
    v_appointment.organization_id, v_appointment.customer_id
  ) or v_appointment.created_by is distinct from auth.uid() then
    raise exception using errcode = '42501', message = 'appointment access denied';
  end if;
  if v_appointment.status = 'CONFIRMED' then
    if v_appointment.booking_hold_idempotency_key is null
       or v_appointment.source <> 'CUSTOMER'
       or v_appointment.payment_mode <> 'COUNTER'
       or v_appointment.deposit_required_cents_snapshot <> 0 then
      raise exception using errcode = '42501', message = 'appointment is not a customer counter booking hold';
    end if;
    return jsonb_build_object(
      'appointment_id', v_appointment.id,
      'status', 'CONFIRMED',
      'service_period', v_appointment.service_period
    );
  end if;
  if v_appointment.status <> 'HELD' then
    raise exception using errcode = '22023', message = 'appointment hold is not active';
  end if;
  if v_appointment.booking_hold_idempotency_key is null
     or v_appointment.source <> 'CUSTOMER'
     or v_appointment.payment_mode <> 'COUNTER'
     or v_appointment.deposit_required_cents_snapshot <> 0 then
    raise exception using errcode = '42501', message = 'appointment is not a customer counter booking hold';
  end if;
  if v_appointment.hold_expires_at <= now() then
    update public.appointments
    set status = 'EXPIRED', hold_expires_at = null, version = version + 1
    where id = v_appointment.id;
    insert into public.appointment_status_events (
      organization_id, appointment_id, from_status, to_status, reason, actor_user_id
    ) values (
      v_appointment.organization_id, v_appointment.id, 'HELD', 'EXPIRED',
      'customer_booking_hold_expired_on_confirm', auth.uid()
    );
    return jsonb_build_object(
      'appointment_id', v_appointment.id,
      'status', 'EXPIRED'
    );
  end if;

  update public.appointments
  set status = 'CONFIRMED', hold_expires_at = null, version = version + 1
  where id = v_appointment.id;
  insert into public.appointment_status_events (
    organization_id, appointment_id, from_status, to_status, reason, actor_user_id
  ) values (
    v_appointment.organization_id, v_appointment.id, 'HELD', 'CONFIRMED',
    'customer_booking_hold_confirmed', auth.uid()
  );
  return jsonb_build_object(
    'appointment_id', v_appointment.id,
    'status', 'CONFIRMED',
    'service_period', v_appointment.service_period
  );
exception when no_data_found then
  raise exception using errcode = 'P0002', message = 'appointment not found';
end;
$$;

create or replace function public.release_customer_booking_hold(
  p_appointment_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_appointment public.appointments%rowtype;
begin
  select * into strict v_appointment
  from public.appointments a
  where a.id = p_appointment_id
  for update;

  if not public.is_organization_customer(
    v_appointment.organization_id, v_appointment.customer_id
  ) or v_appointment.created_by is distinct from auth.uid() then
    raise exception using errcode = '42501', message = 'appointment access denied';
  end if;
  if v_appointment.booking_hold_idempotency_key is null
     or v_appointment.source <> 'CUSTOMER'
     or v_appointment.payment_mode <> 'COUNTER'
     or v_appointment.deposit_required_cents_snapshot <> 0 then
    raise exception using errcode = '42501', message = 'appointment is not a customer counter booking hold';
  end if;
  if v_appointment.status = 'EXPIRED' then
    return jsonb_build_object('appointment_id', v_appointment.id, 'status', 'EXPIRED');
  end if;
  if v_appointment.status <> 'HELD' then
    raise exception using errcode = '22023', message = 'confirmed appointment cannot be released';
  end if;

  update public.appointments
  set status = 'EXPIRED', hold_expires_at = null, version = version + 1
  where id = v_appointment.id;
  insert into public.appointment_status_events (
    organization_id, appointment_id, from_status, to_status, reason, actor_user_id
  ) values (
    v_appointment.organization_id, v_appointment.id, 'HELD', 'EXPIRED',
    'customer_booking_hold_released', auth.uid()
  );
  return jsonb_build_object('appointment_id', v_appointment.id, 'status', 'EXPIRED');
exception when no_data_found then
  raise exception using errcode = 'P0002', message = 'appointment not found';
end;
$$;

revoke all on function public.create_customer_booking_hold(
  uuid, uuid, uuid, timestamptz, jsonb, uuid, uuid
) from public, anon, authenticated;
revoke all on function public.confirm_customer_booking_hold(uuid)
  from public, anon, authenticated;
revoke all on function public.release_customer_booking_hold(uuid)
  from public, anon, authenticated;
grant execute on function public.create_customer_booking_hold(
  uuid, uuid, uuid, timestamptz, jsonb, uuid, uuid
) to authenticated;
grant execute on function public.confirm_customer_booking_hold(uuid) to authenticated;
grant execute on function public.release_customer_booking_hold(uuid) to authenticated;

-- Mixed-version rollout compatibility. Older clients confirm only on their
-- final click, so this wrapper acquires the same locks and immediately confirms
-- without reopening the cross-table race fixed above.
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
  v_hold jsonb;
  v_confirmed jsonb;
begin
  if p_payment_mode <> 'COUNTER' then
    raise exception using errcode = '22023', message = 'customer booking supports only COUNTER payment mode';
  end if;
  v_hold := public.create_customer_booking_hold(
    p_organization_id,
    p_customer_id,
    p_barber_id,
    p_starts_at,
    p_selections,
    gen_random_uuid(),
    p_walkin_queue_hold_id
  );
  v_confirmed := public.confirm_customer_booking_hold(
    (v_hold ->> 'appointment_id')::uuid
  );
  return jsonb_build_object(
    'appointment_id', v_confirmed -> 'appointment_id',
    'status', v_confirmed -> 'status',
    'expires_at', null,
    'total_cents', v_hold -> 'total_cents',
    'amount_due_now_cents', 0,
    'service_period', v_confirmed -> 'service_period'
  );
end;
$$;

revoke all on function public.create_appointment_hold(
  uuid, uuid, uuid, timestamptz, jsonb, public.payment_mode, uuid
) from public, anon, authenticated;
grant execute on function public.create_appointment_hold(
  uuid, uuid, uuid, timestamptz, jsonb, public.payment_mode, uuid
) to authenticated;

revoke all on function public.create_walkin_queue_hold(uuid, uuid, timestamptz)
  from public;
grant execute on function public.create_walkin_queue_hold(uuid, uuid, timestamptz)
  to anon, authenticated;
