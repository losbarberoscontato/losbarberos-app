create table public.organization_date_blocks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  block_type text not null check (block_type in ('HOLIDAY', 'RECESS', 'EVENT')),
  name text not null check (length(btrim(name)) between 1 and 160),
  description text,
  holiday_scope text check (holiday_scope in ('MUNICIPAL', 'STATE', 'FEDERAL')),
  recurrence text check (recurrence in ('ANNUAL', 'YEAR')),
  start_date date not null,
  end_date date,
  start_time time,
  end_time time,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  check (
    (block_type = 'HOLIDAY' and holiday_scope is not null and recurrence is not null
      and end_date is null and start_time is null and end_time is null)
    or (block_type = 'RECESS' and holiday_scope is null and recurrence is null
      and end_date is not null and end_date >= start_date and start_time is null and end_time is null)
    or (block_type = 'EVENT' and holiday_scope is null and recurrence is null
      and end_date is null and start_time is not null and end_time is not null and end_time > start_time)
  )
);

create index organization_date_blocks_org_start_idx
  on public.organization_date_blocks (organization_id, start_date);
alter table public.organization_date_blocks enable row level security;
create policy organization_date_blocks_owner_read
  on public.organization_date_blocks for select to authenticated
  using (public.is_organization_owner(organization_id));
revoke all on public.organization_date_blocks from anon, authenticated;
grant select on public.organization_date_blocks to authenticated;

create or replace function public.organization_date_blocked(p_organization_id uuid, p_period tstzrange)
returns boolean
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  v_timezone text;
  v_first_date date;
  v_last_date date;
begin
  select timezone into strict v_timezone from public.organizations where id = p_organization_id;
  v_first_date := lower(p_period) at time zone v_timezone;
  v_last_date := (upper(p_period) - interval '1 microsecond') at time zone v_timezone;
  return exists (
    select 1
    from public.organization_date_blocks b
    where b.organization_id = p_organization_id
      and (
        (b.block_type = 'RECESS' and b.start_date <= v_last_date and b.end_date >= v_first_date)
        or (b.block_type = 'HOLIDAY' and (
          (b.recurrence = 'YEAR' and b.start_date between v_first_date and v_last_date)
          or (b.recurrence = 'ANNUAL' and exists (
            select 1 from generate_series(v_first_date, v_last_date, interval '1 day') d
            where d::date >= b.start_date
              and extract(month from d) = extract(month from b.start_date)
              and extract(day from d) = extract(day from b.start_date)
          ))
        ))
        or (b.block_type = 'EVENT' and tstzrange(
            (b.start_date + b.start_time) at time zone v_timezone,
            (b.start_date + b.end_time) at time zone v_timezone, '[)'
          ) && p_period))
  );
exception when no_data_found then return false;
end;
$$;

create or replace function public.enforce_organization_date_blocks()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then return old; end if;
  if new.status in ('CONFIRMED', 'IN_SERVICE')
     or (new.status in ('HELD', 'PENDING_PAYMENT') and new.hold_expires_at > now()) then
    perform 1 from public.organizations where id = new.organization_id for update;
    if public.organization_date_blocked(new.organization_id, new.service_period) then
      raise exception using errcode = '22023', message = 'requested date is blocked';
    end if;
  end if;
  return new;
end;
$$;
create trigger appointments_enforce_organization_date_blocks
  before insert or update of status, service_period on public.appointments
  for each row execute function public.enforce_organization_date_blocks();

create or replace function public.enforce_organization_date_blocks_on_queue_hold()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then return old; end if;
  perform 1 from public.organizations where id = new.organization_id for update;
  if public.organization_date_blocked(new.organization_id, new.service_period) then
    raise exception using errcode = '22023', message = 'requested date is blocked';
  end if;
  return new;
end;
$$;
create trigger walkin_queue_holds_enforce_organization_date_blocks
  before insert or update of service_period, consumed_at on public.walkin_queue_holds
  for each row execute function public.enforce_organization_date_blocks_on_queue_hold();

create or replace function public.save_organization_date_block(
  p_organization_id uuid, p_id uuid, p_block_type text, p_name text, p_description text,
  p_holiday_scope text, p_recurrence text, p_start_date date, p_end_date date,
  p_start_time time, p_end_time time
) returns uuid language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid := coalesce(p_id, gen_random_uuid());
  v_timezone text;
  v_from date := p_start_date;
  v_to date := coalesce(p_end_date, p_start_date);
  v_conflict boolean;
begin
  if not public.is_organization_owner(p_organization_id) then
    raise exception using errcode = '42501', message = 'organization owner required';
  end if;
  perform 1 from public.organizations where id = p_organization_id for update;
  select timezone into strict v_timezone from public.organizations where id = p_organization_id;
  if p_block_type not in ('HOLIDAY', 'RECESS', 'EVENT') or length(btrim(coalesce(p_name, ''))) not between 1 and 160 then
    raise exception using errcode = '22023', message = 'invalid date block';
  end if;
  if (p_block_type = 'HOLIDAY' and (p_holiday_scope not in ('MUNICIPAL', 'STATE', 'FEDERAL') or p_recurrence not in ('ANNUAL', 'YEAR') or p_end_date is not null or p_start_time is not null or p_end_time is not null))
    or (p_block_type = 'RECESS' and (p_end_date is null or p_end_date < p_start_date or p_holiday_scope is not null or p_recurrence is not null or p_start_time is not null or p_end_time is not null))
    or (p_block_type = 'EVENT' and (p_holiday_scope is not null or p_recurrence is not null or p_end_date is not null or p_start_time is null or p_end_time is null or p_end_time <= p_start_time)) then
    raise exception using errcode = '22023', message = 'invalid date block';
  end if;
  if p_recurrence = 'ANNUAL' then v_from := (now() at time zone v_timezone)::date; end if;
  select exists (
    select 1 from public.appointments a
    where a.organization_id = p_organization_id
      and (a.status in ('CONFIRMED', 'IN_SERVICE') or (a.status in ('HELD', 'PENDING_PAYMENT') and a.hold_expires_at > now()))
      and (p_id is null or a.id is distinct from p_id)
      and ((p_recurrence = 'ANNUAL' and exists (
             select 1 from generate_series((lower(a.service_period) at time zone v_timezone)::date,
               ((upper(a.service_period) - interval '1 microsecond') at time zone v_timezone)::date, interval '1 day') d
             where d::date >= greatest((now() at time zone v_timezone)::date, p_start_date)
               and extract(month from d) = extract(month from p_start_date) and extract(day from d) = extract(day from p_start_date)))
        or (p_block_type = 'EVENT' and tstzrange((p_start_date + p_start_time) at time zone v_timezone, (p_start_date + p_end_time) at time zone v_timezone, '[)') && a.service_period)
        or (p_recurrence is distinct from 'ANNUAL' and p_block_type <> 'EVENT'
             and (lower(a.service_period) at time zone v_timezone)::date <= v_to
             and ((upper(a.service_period) - interval '1 microsecond') at time zone v_timezone)::date >= v_from))
  ) or exists (
    select 1 from public.walkin_queue_holds h
    where h.organization_id = p_organization_id and h.consumed_at is null and h.expires_at > now()
      and ((p_recurrence = 'ANNUAL' and exists (
             select 1 from generate_series((lower(h.service_period) at time zone v_timezone)::date,
               ((upper(h.service_period) - interval '1 microsecond') at time zone v_timezone)::date, interval '1 day') d
             where d::date >= greatest((now() at time zone v_timezone)::date, p_start_date)
               and extract(month from d) = extract(month from p_start_date) and extract(day from d) = extract(day from p_start_date)))
        or (p_block_type = 'EVENT' and tstzrange((p_start_date + p_start_time) at time zone v_timezone, (p_start_date + p_end_time) at time zone v_timezone, '[)') && h.service_period)
        or (p_recurrence is distinct from 'ANNUAL' and p_block_type <> 'EVENT'
             and (lower(h.service_period) at time zone v_timezone)::date <= v_to
             and ((upper(h.service_period) - interval '1 microsecond') at time zone v_timezone)::date >= v_from))
  ) into v_conflict;
  if v_conflict then raise exception using errcode = '23P01', message = 'organization_date_block_conflict: reschedule or cancel affected bookings'; end if;
  if exists (
    select 1 from public.organization_date_blocks b
    where b.organization_id = p_organization_id and b.id is distinct from p_id
      and ((p_recurrence = 'ANNUAL' and (
          (b.recurrence = 'ANNUAL' and extract(month from b.start_date) = extract(month from p_start_date) and extract(day from b.start_date) = extract(day from p_start_date))
          or (b.block_type <> 'EVENT' and exists (
            select 1 from generate_series(greatest((now() at time zone v_timezone)::date, b.start_date, p_start_date), coalesce(b.end_date,b.start_date), interval '1 day') d
            where extract(month from d) = extract(month from p_start_date) and extract(day from d) = extract(day from p_start_date)))
          or (b.block_type = 'EVENT' and b.start_date >= (now() at time zone v_timezone)::date
            and extract(month from b.start_date) = extract(month from p_start_date) and extract(day from b.start_date) = extract(day from p_start_date))))
        or (p_recurrence is distinct from 'ANNUAL' and b.recurrence = 'ANNUAL' and exists (
          select 1 from generate_series(v_from, v_to, interval '1 day') d
          where d::date >= b.start_date and extract(month from d) = extract(month from b.start_date) and extract(day from d) = extract(day from b.start_date)))
        or (p_recurrence is distinct from 'ANNUAL' and b.recurrence is distinct from 'ANNUAL' and b.start_date <= v_to and coalesce(b.end_date,b.start_date) >= v_from))
  ) then raise exception using errcode = '23P01', message = 'date block overlaps an existing date block'; end if;
  insert into public.organization_date_blocks (id, organization_id, block_type, name, description, holiday_scope, recurrence, start_date, end_date, start_time, end_time, updated_at)
  values (v_id, p_organization_id, p_block_type, btrim(p_name), nullif(btrim(coalesce(p_description,'')),''), p_holiday_scope, p_recurrence, p_start_date, p_end_date, p_start_time, p_end_time, now())
  on conflict (id) do update set block_type = excluded.block_type, name = excluded.name, description = excluded.description,
    holiday_scope = excluded.holiday_scope, recurrence = excluded.recurrence, start_date = excluded.start_date,
    end_date = excluded.end_date, start_time = excluded.start_time, end_time = excluded.end_time, updated_at = now()
  where organization_date_blocks.organization_id = p_organization_id;
  return v_id;
end;
$$;

create or replace function public.delete_organization_date_block(p_organization_id uuid, p_id uuid)
returns void language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_organization_owner(p_organization_id) then
    raise exception using errcode = '42501', message = 'organization owner required';
  end if;
  perform 1 from public.organizations where id = p_organization_id for update;
  delete from public.organization_date_blocks where id = p_id and organization_id = p_organization_id;
end;
$$;

revoke all on function public.organization_date_blocked(uuid, tstzrange) from public;
revoke all on function public.enforce_organization_date_blocks() from public;
revoke all on function public.enforce_organization_date_blocks_on_queue_hold() from public;
revoke all on function public.save_organization_date_block(uuid, uuid, text, text, text, text, text, date, date, time, time) from public, anon;
revoke all on function public.delete_organization_date_block(uuid, uuid) from public, anon;
grant execute on function public.save_organization_date_block(uuid, uuid, text, text, text, text, text, date, date, time, time) to authenticated;
grant execute on function public.delete_organization_date_block(uuid, uuid) to authenticated;

alter function public.get_available_slots(text, uuid, date, jsonb) rename to get_available_slots_unblocked;
create or replace function public.get_available_slots(p_organization_slug text, p_barber_id uuid, p_local_date date, p_selections jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_result jsonb; v_org_id uuid;
begin
  select id into v_org_id from public.organizations where slug = p_organization_slug;
  v_result := public.get_available_slots_unblocked(p_organization_slug, p_barber_id, p_local_date, p_selections);
  if v_result is null then return null; end if;
  return jsonb_set(v_result, '{slots}', coalesce((select jsonb_agg(slot order by slot->>'starts_at') from jsonb_array_elements(v_result->'slots') slot
    where not public.organization_date_blocked(v_org_id, tstzrange((slot->>'starts_at')::timestamptz, (slot->>'ends_at')::timestamptz, '[)'))), '[]'::jsonb));
end $$;

alter function public.get_walkin_queue_availability(uuid) rename to get_walkin_queue_availability_unblocked;
create or replace function public.get_walkin_queue_availability(p_queue_public_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_result jsonb; v_org_id uuid;
begin
  select id into v_org_id from public.organizations where queue_public_id = p_queue_public_id;
  v_result := public.get_walkin_queue_availability_unblocked(p_queue_public_id);
  if v_result is null then return null; end if;
  return jsonb_set(v_result, '{slots}', coalesce((select jsonb_agg(slot order by slot->>'starts_at') from jsonb_array_elements(v_result->'slots') slot
    where not public.organization_date_blocked(v_org_id, tstzrange((slot->>'starts_at')::timestamptz, (slot->>'ends_at')::timestamptz, '[)'))), '[]'::jsonb));
end $$;

revoke all on function public.get_available_slots_unblocked(text, uuid, date, jsonb) from public, anon, authenticated;
revoke all on function public.get_walkin_queue_availability_unblocked(uuid) from public, anon, authenticated;
revoke all on function public.get_available_slots(text, uuid, date, jsonb) from public;
grant execute on function public.get_available_slots(text, uuid, date, jsonb) to anon, authenticated;
revoke all on function public.get_walkin_queue_availability(uuid) from public;
grant execute on function public.get_walkin_queue_availability(uuid) to anon, authenticated;
