-- Agenda por ambientes: capacidade física por unidade, sem expor o ambiente
-- ao cliente. A migração é aditiva e mantém escalas/agendamentos históricos.

create table public.agenda_environments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  location_id uuid not null,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  sort_order integer not null check (sort_order > 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (location_id, organization_id)
    references public.locations(id, organization_id) on delete cascade
);

create unique index agenda_environments_location_name_key
  on public.agenda_environments (location_id, lower(btrim(name)));
create unique index agenda_environments_location_order_key
  on public.agenda_environments (location_id, sort_order) where active;
create index agenda_environments_org_order_idx
  on public.agenda_environments (organization_id, location_id, active, sort_order, name);

create table public.agenda_environment_assignment_issues (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  location_id uuid not null,
  work_interval_id uuid,
  appointment_id uuid,
  reason text not null,
  details jsonb not null default '{}'::jsonb,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  unique (work_interval_id),
  unique (appointment_id),
  foreign key (location_id, organization_id)
    references public.locations(id, organization_id) on delete cascade,
  foreign key (work_interval_id, organization_id)
    references public.work_intervals(id, organization_id) on delete cascade,
  foreign key (appointment_id, organization_id)
    references public.appointments(id, organization_id) on delete cascade
);

alter table public.work_intervals
  add column if not exists environment_id uuid;
alter table public.availability_exceptions
  add column if not exists environment_id uuid;
alter table public.appointments
  add column if not exists environment_id uuid;

-- Seed determinístico para todas as unidades existentes. Novas unidades são
-- inicializadas pelo trigger da migration seguinte quando são criadas.
insert into public.agenda_environments (
  organization_id, location_id, name, sort_order
)
select l.organization_id, l.id, seed.name, seed.sort_order
from public.locations l
cross join (values ('Sala/Cadeira 1', 1), ('Sala/Cadeira 2', 2)) as seed(name, sort_order)
where l.active
on conflict (location_id, lower(btrim(name))) do nothing;

do $$
declare
  v_row record;
  v_environment uuid;
  v_location uuid;
begin
  for v_row in
    select wi.*,
      b.location_id as barber_location_id
    from public.work_intervals wi
    join public.barbers b on b.id = wi.barber_id
      and b.organization_id = wi.organization_id
    where wi.environment_id is null
    order by wi.organization_id, wi.weekday, wi.starts_at, wi.id
  loop
    v_location := v_row.barber_location_id;
    select e.id into v_environment
    from public.agenda_environments e
    where e.organization_id = v_row.organization_id
      and e.location_id = v_location
      and e.active
      and not exists (
        select 1
        from public.work_intervals other
        where other.organization_id = v_row.organization_id
          and other.environment_id = e.id
          and other.active
          and other.weekday = v_row.weekday
          and int4range(
            (extract(epoch from other.starts_at) / 60)::integer,
            (extract(epoch from other.ends_at) / 60)::integer, '[)'
          ) && int4range(
            (extract(epoch from v_row.starts_at) / 60)::integer,
            (extract(epoch from v_row.ends_at) / 60)::integer, '[)'
          )
      )
    order by e.sort_order, e.id
    limit 1;
    if v_environment is null then
      insert into public.agenda_environment_assignment_issues (
        organization_id, location_id, work_interval_id, reason, details
      ) values (
        v_row.organization_id, v_location, v_row.id,
        'NO_ENVIRONMENT_CAPACITY_FOR_LEGACY_INTERVAL',
        jsonb_build_object('barber_id', v_row.barber_id, 'weekday', v_row.weekday,
          'starts_at', v_row.starts_at, 'ends_at', v_row.ends_at)
      ) on conflict (work_interval_id) do nothing;
    else
      update public.work_intervals
      set environment_id = v_environment, updated_at = now()
      where id = v_row.id and organization_id = v_row.organization_id;
    end if;
  end loop;

  for v_row in
    select a.*, b.location_id as barber_location_id
    from public.appointments a
    join public.barbers b on b.id = a.barber_id
      and b.organization_id = a.organization_id
    where a.environment_id is null
    order by a.organization_id, lower(a.service_period), a.id
  loop
    v_location := v_row.barber_location_id;
    select e.id into v_environment
    from public.agenda_environments e
    where e.organization_id = v_row.organization_id
      and e.location_id = v_location
      and e.active
      and not exists (
        select 1 from public.appointments other
        where other.organization_id = v_row.organization_id
          and other.environment_id = e.id
          and other.id <> v_row.id
          and other.status in ('HELD', 'PENDING_PAYMENT', 'CONFIRMED', 'IN_SERVICE')
          and other.service_period && v_row.service_period
      )
    order by e.sort_order, e.id
    limit 1;
    if v_environment is null and v_row.status in ('HELD', 'PENDING_PAYMENT', 'CONFIRMED', 'IN_SERVICE') then
      insert into public.agenda_environment_assignment_issues (
        organization_id, location_id, appointment_id, reason, details
      ) values (
        v_row.organization_id, v_location, v_row.id,
        'NO_ENVIRONMENT_CAPACITY_FOR_LEGACY_APPOINTMENT',
        jsonb_build_object('barber_id', v_row.barber_id, 'service_period', v_row.service_period)
      ) on conflict (appointment_id) do nothing;
    elsif v_environment is not null then
      update public.appointments
      set environment_id = v_environment, updated_at = now()
      where id = v_row.id and organization_id = v_row.organization_id;
    end if;
  end loop;
end;
$$;

alter table public.work_intervals
  add constraint work_intervals_environment_fk
  foreign key (environment_id, organization_id)
  references public.agenda_environments(id, organization_id);
alter table public.availability_exceptions
  add constraint availability_exceptions_environment_fk
  foreign key (environment_id, organization_id)
  references public.agenda_environments(id, organization_id);
alter table public.appointments
  add constraint appointments_environment_fk
  foreign key (environment_id, organization_id)
  references public.agenda_environments(id, organization_id);

alter table public.work_intervals
  add constraint work_intervals_environment_no_overlap
  exclude using gist (
    organization_id with =,
    environment_id with =,
    weekday with =,
    int4range(
      (extract(epoch from starts_at) / 60)::integer,
      (extract(epoch from ends_at) / 60)::integer, '[)'
    ) with &&
  ) where (active and environment_id is not null);

alter table public.appointments
  add constraint appointments_no_environment_overlap
  exclude using gist (
    organization_id with =,
    environment_id with =,
    service_period with &&
  ) where (environment_id is not null and status in ('HELD', 'PENDING_PAYMENT', 'CONFIRMED', 'IN_SERVICE'));

create index appointments_environment_period_idx
  on public.appointments (organization_id, environment_id, lower(service_period));
create index work_intervals_environment_idx
  on public.work_intervals (organization_id, environment_id, weekday, starts_at);

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
      select 1 from public.appointments a
      where a.organization_id = p_organization_id
        and a.environment_id = v_requested and a.id is distinct from p_appointment_id
        and a.status in ('HELD', 'PENDING_PAYMENT', 'CONFIRMED', 'IN_SERVICE')
        and a.service_period && p_service_period
    ) then
      raise exception using errcode = '23P01', message = 'environment is no longer available';
    end if;
    return v_requested;
  end if;

  -- A legacy active appointment without capacity assignment blocks the whole
  -- barber until the manager resolves the pending item.
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

create or replace function public.is_barber_available(
  p_organization_id uuid,
  p_barber_id uuid,
  p_service_period tstzrange
)
returns boolean
language plpgsql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_location uuid;
begin
  select location_id into v_location from public.barbers
  where id = p_barber_id and organization_id = p_organization_id and active;
  if v_location is null then return false; end if;
  if exists (
    select 1 from public.availability_exceptions ae
    where ae.organization_id = p_organization_id and ae.barber_id = p_barber_id
      and ae.kind = 'UNAVAILABLE' and ae.service_period && p_service_period
  ) then return false; end if;
  return public.resolve_appointment_environment(
    p_organization_id, p_barber_id, v_location, p_service_period
  ) is not null;
end;
$$;

create or replace function public.assign_appointment_environment()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_location uuid;
  v_environment uuid;
begin
  if new.status in ('HELD', 'PENDING_PAYMENT', 'CONFIRMED', 'IN_SERVICE')
     and (tg_op = 'INSERT' or new.barber_id is distinct from old.barber_id
       or new.location_id is distinct from old.location_id
       or new.service_period is distinct from old.service_period
       or new.environment_id is distinct from old.environment_id) then
    select location_id into v_location from public.barbers
    where id = new.barber_id and organization_id = new.organization_id and active;
    if v_location is null then
      raise exception using errcode = 'P0002', message = 'active barber not found';
    end if;
    v_environment := public.resolve_appointment_environment(
      new.organization_id, new.barber_id, v_location, new.service_period,
      new.environment_id, case when tg_op = 'UPDATE' then old.id else null end
    );
    if v_environment is null then
      raise exception using errcode = '23P01', message = 'no active environment available for requested period';
    end if;
    new.environment_id := v_environment;
  end if;
  return new;
end;
$$;

drop trigger if exists appointments_assign_environment on public.appointments;
create trigger appointments_assign_environment
  before insert or update of barber_id, location_id, service_period, environment_id, status
  on public.appointments for each row execute function public.assign_appointment_environment();

create or replace function public.validate_agenda_environment_row()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_location uuid;
begin
  if tg_table_name = 'work_intervals' then
    if new.active and new.environment_id is null then
      raise exception using errcode = '22023', message = 'active work interval requires an environment';
    end if;
    if new.environment_id is not null then
      select location_id into v_location from public.barbers
      where id = new.barber_id and organization_id = new.organization_id;
      if v_location is distinct from (select location_id from public.agenda_environments where id = new.environment_id and organization_id = new.organization_id) then
        raise exception using errcode = '22023', message = 'environment does not belong to barber unit';
      end if;
      if not exists (select 1 from public.agenda_environments where id = new.environment_id and organization_id = new.organization_id and active) then
        raise exception using errcode = '22023', message = 'environment is inactive';
      end if;
    end if;
  elsif tg_table_name = 'availability_exceptions' then
    if new.kind = 'AVAILABLE_OVERRIDE' and new.environment_id is null then
      raise exception using errcode = '22023', message = 'available exception requires an environment';
    end if;
    if new.kind = 'UNAVAILABLE' then new.environment_id := null; end if;
    if new.environment_id is not null and not exists (
      select 1 from public.agenda_environments where id = new.environment_id
        and organization_id = new.organization_id and active
    ) then
      raise exception using errcode = '22023', message = 'environment is inactive';
    end if;
  elsif tg_table_name = 'agenda_environments' and not new.active and old.active then
    if exists (select 1 from public.work_intervals where environment_id = old.id and active)
       or exists (select 1 from public.appointments where environment_id = old.id and status in ('HELD','PENDING_PAYMENT','CONFIRMED','IN_SERVICE')) then
      raise exception using errcode = '23514', message = 'environment has active schedule or reservations';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists work_intervals_validate_environment on public.work_intervals;
create trigger work_intervals_validate_environment
  before insert or update on public.work_intervals
  for each row execute function public.validate_agenda_environment_row();
drop trigger if exists availability_exceptions_validate_environment on public.availability_exceptions;
create trigger availability_exceptions_validate_environment
  before insert or update on public.availability_exceptions
  for each row execute function public.validate_agenda_environment_row();
drop trigger if exists agenda_environments_validate_state on public.agenda_environments;
create trigger agenda_environments_validate_state
  before update on public.agenda_environments
  for each row execute function public.validate_agenda_environment_row();

-- Explicit manager choice for bookings outside the weekly scale. The existing
-- seven-argument function remains compatible with subscription and legacy SQL.
create or replace function public.create_manual_appointment(
  p_organization_id uuid,
  p_customer_id uuid,
  p_barber_id uuid,
  p_starts_at timestamptz,
  p_selections jsonb,
  p_override_reason text,
  p_notes text,
  p_environment_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_result uuid;
begin
  if p_environment_id is null and nullif(btrim(p_override_reason), '') is null then
    raise exception using errcode = '22023', message = 'environment is required for manager booking';
  end if;
  perform set_config('app.agenda_environment_id', coalesce(p_environment_id::text, ''), true);
  v_result := public.create_manual_appointment(
    p_organization_id, p_customer_id, p_barber_id, p_starts_at,
    p_selections, p_override_reason, p_notes
  );
  return v_result;
end;
$$;

revoke all on function public.resolve_appointment_environment(uuid, uuid, uuid, tstzrange, uuid, uuid) from public, anon, authenticated;
revoke all on function public.assign_appointment_environment() from public, anon, authenticated;
revoke all on function public.validate_agenda_environment_row() from public, anon, authenticated;
grant execute on function public.is_barber_available(uuid, uuid, tstzrange) to anon, authenticated;
grant execute on function public.create_manual_appointment(uuid, uuid, uuid, timestamptz, jsonb, text, text, uuid) to authenticated;

alter table public.agenda_environments enable row level security;
alter table public.agenda_environment_assignment_issues enable row level security;
create policy agenda_environments_owner_all on public.agenda_environments
  for all to authenticated using (public.is_organization_owner(organization_id))
  with check (public.is_organization_owner(organization_id));
create policy agenda_environment_issues_owner_all on public.agenda_environment_assignment_issues
  for all to authenticated using (public.is_organization_owner(organization_id))
  with check (public.is_organization_owner(organization_id));

comment on table public.agenda_environments is
  'Physical rooms/chairs used by the manager agenda; never exposed to clients.';
comment on column public.appointments.environment_id is
  'Resolved physical environment snapshot for this appointment.';
