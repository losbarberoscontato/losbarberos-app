create table public.barber_schedule_change_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  barber_id uuid not null,
  actor_user_id uuid not null references auth.users(id),
  action text not null check (action in ('ADD_INTERVAL','UPDATE_INTERVAL','DELETE_INTERVAL','ADD_EXCEPTION','DELETE_EXCEPTION')),
  message text not null check (char_length(btrim(message)) between 10 and 500),
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  created_at timestamptz not null default now(),
  foreign key (barber_id, organization_id) references public.barbers(id, organization_id) on delete cascade
);

alter table public.barber_schedule_change_messages enable row level security;
alter table public.barber_schedule_change_messages force row level security;
create trigger barber_schedule_change_messages_append_only
  before update or delete on public.barber_schedule_change_messages
  for each row execute function public.reject_append_only_mutation();
revoke all on public.barber_schedule_change_messages from anon, authenticated;

create or replace function public.enforce_appointment_schedule_lock()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if new.status in ('HELD','PENDING_PAYMENT','CONFIRMED','IN_SERVICE') then
    perform 1 from public.barbers b where b.id = new.barber_id and b.organization_id = new.organization_id for key share;
    if not found then raise exception using errcode = 'P0002', message = 'appointment barber not found'; end if;
    if new.schedule_override_reason is null and not public.is_barber_available(new.organization_id, new.barber_id, new.service_period) then
      raise exception using errcode = '23514', message = 'appointment is outside the current barber schedule';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_appointment_schedule_lock() from public, anon, authenticated;
create trigger appointments_enforce_current_schedule
  before insert or update of organization_id, barber_id, service_period, status, schedule_override_reason
  on public.appointments for each row execute function public.enforce_appointment_schedule_lock();

create or replace function public.get_my_barber_schedule(p_organization_id uuid)
returns jsonb
language plpgsql security definer set search_path = public, auth, pg_temp as $$
declare v_barber public.barbers%rowtype; v_timezone text;
begin
  select b.* into v_barber from public.barbers b
  where b.organization_id = p_organization_id and b.auth_user_id = auth.uid() and b.active and b.app_access_enabled;
  if not found then raise exception using errcode = '42501', message = 'barber schedule access denied'; end if;
  select o.timezone into strict v_timezone from public.organizations o where o.id = p_organization_id;
  return jsonb_build_object(
    'barber_id', v_barber.id,
    'intervals', coalesce((select jsonb_agg(to_jsonb(wi) order by wi.weekday, wi.starts_at) from public.work_intervals wi where wi.organization_id = p_organization_id and wi.barber_id = v_barber.id and wi.active), '[]'::jsonb),
    'exceptions', coalesce((select jsonb_agg(to_jsonb(ae) order by lower(ae.service_period)) from public.availability_exceptions ae where ae.organization_id = p_organization_id and ae.barber_id = v_barber.id and upper(ae.service_period) > now() - interval '1 day'), '[]'::jsonb),
    'messages', coalesce((select jsonb_agg(to_jsonb(m) order by m.created_at desc) from (select * from public.barber_schedule_change_messages where organization_id = p_organization_id and barber_id = v_barber.id order by created_at desc limit 50) m), '[]'::jsonb),
    'timezone', v_timezone
  );
end;
$$;

create or replace function public.mutate_barber_schedule(
  p_organization_id uuid,
  p_barber_id uuid,
  p_action text,
  p_interval_id uuid default null,
  p_weekday smallint default null,
  p_starts_at time default null,
  p_ends_at time default null,
  p_environment_id uuid default null,
  p_exception_id uuid default null,
  p_exception_start timestamptz default null,
  p_exception_end timestamptz default null,
  p_reason text default null,
  p_exception_kind public.availability_exception_kind default 'UNAVAILABLE'
)
returns jsonb
language plpgsql security definer set search_path = public, auth, pg_temp as $$
declare
  v_barber public.barbers%rowtype;
  v_timezone text;
  v_actor text;
  v_actor_role text;
  v_message text;
  v_interval public.work_intervals%rowtype;
  v_previous_interval public.work_intervals%rowtype;
  v_exception public.availability_exceptions%rowtype;
  v_period tstzrange;
  v_environment_id uuid;
begin
  if auth.uid() is null then raise exception using errcode = '28000', message = 'authentication required'; end if;
  select b.* into v_barber from public.barbers b where b.id = p_barber_id and b.organization_id = p_organization_id and b.active;
  if not found then raise exception using errcode = 'P0002', message = 'active barber not found'; end if;
  if v_barber.auth_user_id = auth.uid() and v_barber.app_access_enabled then
    v_actor_role := 'PROFESSIONAL';
    v_actor := v_barber.display_name;
  elsif public.is_organization_owner(p_organization_id) then
    v_actor_role := 'ADMINISTRATOR';
    select coalesce(nullif(btrim(p.display_name), ''), nullif(btrim(u.email), ''), 'Administrador') into v_actor
    from auth.users u left join public.profiles p on p.id = u.id where u.id = auth.uid();
  else
    raise exception using errcode = '42501', message = 'barber schedule management denied';
  end if;
  select b.* into strict v_barber from public.barbers b where b.id = p_barber_id and b.organization_id = p_organization_id and b.active for update;
  if not ((v_actor_role = 'PROFESSIONAL' and v_barber.auth_user_id = auth.uid() and v_barber.app_access_enabled)
      or (v_actor_role = 'ADMINISTRATOR' and public.is_organization_owner(p_organization_id))) then
    raise exception using errcode = '42501', message = 'barber schedule management denied';
  end if;
  if not public.organization_allows_management_mutations(p_organization_id) then
    raise exception using errcode = '42501', message = 'organization does not allow management mutations';
  end if;
  select timezone into strict v_timezone from public.organizations where id = p_organization_id;

  if p_action in ('ADD_INTERVAL','UPDATE_INTERVAL','DELETE_INTERVAL') then
    if p_action = 'ADD_INTERVAL' or p_action = 'UPDATE_INTERVAL' then
      if p_weekday is null or p_weekday not between 0 and 6 or p_starts_at is null or p_ends_at is null or p_starts_at >= p_ends_at then
        raise exception using errcode = '22023', message = 'valid weekday and time interval required';
      end if;
    end if;
    if p_action in ('UPDATE_INTERVAL','DELETE_INTERVAL') then
      select * into v_interval from public.work_intervals where id = p_interval_id and organization_id = p_organization_id and barber_id = p_barber_id and active for update;
      if not found then raise exception using errcode = 'P0002', message = 'work interval not found'; end if;
      v_previous_interval := v_interval;
    end if;
    if exists (
      select 1 from public.appointments a
      where a.organization_id = p_organization_id and a.barber_id = p_barber_id
        and a.status in ('HELD','PENDING_PAYMENT','CONFIRMED','IN_SERVICE')
        and upper(a.service_period) > now()
        and (lower(a.service_period) at time zone v_timezone)::date >= (now() at time zone v_timezone)::date
        and (
          (p_action in ('UPDATE_INTERVAL','DELETE_INTERVAL')
            and extract(dow from lower(a.service_period) at time zone v_timezone)::smallint = v_previous_interval.weekday
            and (lower(a.service_period) at time zone v_timezone)::time < v_previous_interval.ends_at
            and (upper(a.service_period) at time zone v_timezone)::time > v_previous_interval.starts_at)
          or (p_action in ('ADD_INTERVAL','UPDATE_INTERVAL')
            and extract(dow from lower(a.service_period) at time zone v_timezone)::smallint = p_weekday
            and (lower(a.service_period) at time zone v_timezone)::time < p_ends_at
            and (upper(a.service_period) at time zone v_timezone)::time > p_starts_at)
        )
    ) then raise exception using errcode = '23514', message = 'schedule interval has future appointments and cannot be changed'; end if;
    if p_action = 'ADD_INTERVAL' then
      v_environment_id := p_environment_id;
      if v_environment_id is null then
        select e.id into v_environment_id from public.agenda_environments e
        where e.organization_id = p_organization_id and e.location_id = v_barber.location_id and e.active
          and not exists (select 1 from public.work_intervals wi where wi.organization_id = p_organization_id and wi.environment_id = e.id and wi.active and wi.weekday = p_weekday and wi.starts_at < p_ends_at and wi.ends_at > p_starts_at)
        order by e.sort_order, e.id limit 1;
      end if;
      if v_environment_id is null or not exists (select 1 from public.agenda_environments e where e.id = v_environment_id and e.organization_id = p_organization_id and e.location_id = v_barber.location_id and e.active) then
        raise exception using errcode = '22023', message = 'no active agenda environment is available for this time';
      end if;
      insert into public.work_intervals (organization_id, barber_id, weekday, starts_at, ends_at, environment_id, active)
      values (p_organization_id, p_barber_id, p_weekday, p_starts_at, p_ends_at, v_environment_id, true) returning * into v_interval;
      v_message := format('Escala de %s: %s adicionou horário %s, das %s às %s.', v_barber.display_name, v_actor, case p_weekday when 0 then 'domingo' when 1 then 'segunda-feira' when 2 then 'terça-feira' when 3 then 'quarta-feira' when 4 then 'quinta-feira' when 5 then 'sexta-feira' else 'sábado' end, p_starts_at, p_ends_at);
    elsif p_action = 'UPDATE_INTERVAL' then
      v_environment_id := coalesce(p_environment_id, v_previous_interval.environment_id);
      if v_environment_id is null or not exists (select 1 from public.agenda_environments e where e.id = v_environment_id and e.organization_id = p_organization_id and e.location_id = v_barber.location_id and e.active) then
        raise exception using errcode = '22023', message = 'select an active agenda environment';
      end if;
      update public.work_intervals set weekday = p_weekday, starts_at = p_starts_at, ends_at = p_ends_at, environment_id = v_environment_id, updated_at = now()
      where id = p_interval_id and organization_id = p_organization_id and barber_id = p_barber_id returning * into v_interval;
      v_message := format('Escala de %s: %s alterou %s, %s–%s, para %s, %s–%s.', v_barber.display_name, v_actor, case v_previous_interval.weekday when 0 then 'domingo' when 1 then 'segunda-feira' when 2 then 'terça-feira' when 3 then 'quarta-feira' when 4 then 'quinta-feira' when 5 then 'sexta-feira' else 'sábado' end, v_previous_interval.starts_at, v_previous_interval.ends_at, case p_weekday when 0 then 'domingo' when 1 then 'segunda-feira' when 2 then 'terça-feira' when 3 then 'quarta-feira' when 4 then 'quinta-feira' when 5 then 'sexta-feira' else 'sábado' end, p_starts_at, p_ends_at);
    else
      delete from public.work_intervals where id = p_interval_id and organization_id = p_organization_id and barber_id = p_barber_id;
      v_message := format('Escala de %s: %s removeu horário de %s, das %s às %s.', v_barber.display_name, v_actor, case v_interval.weekday when 0 then 'domingo' when 1 then 'segunda-feira' when 2 then 'terça-feira' when 3 then 'quarta-feira' when 4 then 'quinta-feira' when 5 then 'sexta-feira' else 'sábado' end, v_interval.starts_at, v_interval.ends_at);
    end if;
  elsif p_action in ('ADD_EXCEPTION','DELETE_EXCEPTION') then
    if p_action = 'ADD_EXCEPTION' then
      if p_exception_start is null or p_exception_end is null or p_exception_start >= p_exception_end then raise exception using errcode = '22023', message = 'valid exception period required'; end if;
      v_period := tstzrange(p_exception_start, p_exception_end, '[)');
      if exists (select 1 from public.appointments a where a.organization_id = p_organization_id and a.barber_id = p_barber_id and a.status in ('HELD','PENDING_PAYMENT','CONFIRMED','IN_SERVICE') and upper(a.service_period) > now() and a.service_period && v_period) then
        raise exception using errcode = '23514', message = 'exception period has future appointments and cannot be blocked';
      end if;
      insert into public.availability_exceptions (organization_id, barber_id, kind, service_period, reason, created_by, environment_id)
      values (p_organization_id, p_barber_id, p_exception_kind, v_period, nullif(btrim(p_reason), ''), auth.uid(), p_environment_id) returning * into v_exception;
      v_message := format('Escala de %s: %s adicionou %s de %s a %s%s.', v_barber.display_name, v_actor, case p_exception_kind when 'UNAVAILABLE' then 'folga/indisponibilidade' else 'horário extra disponível' end, to_char(p_exception_start at time zone v_timezone, 'DD/MM/YYYY HH24:MI'), to_char(p_exception_end at time zone v_timezone, 'DD/MM/YYYY HH24:MI'), case when nullif(btrim(p_reason), '') is null then '' else format(' (%s)', btrim(p_reason)) end);
    else
      select * into v_exception from public.availability_exceptions where id = p_exception_id and organization_id = p_organization_id and barber_id = p_barber_id for update;
      if not found then raise exception using errcode = 'P0002', message = 'availability exception not found'; end if;
      if exists (select 1 from public.appointments a where a.organization_id = p_organization_id and a.barber_id = p_barber_id and a.status in ('HELD','PENDING_PAYMENT','CONFIRMED','IN_SERVICE') and upper(a.service_period) > now() and a.service_period && v_exception.service_period) then
        raise exception using errcode = '23514', message = 'exception period has future appointments and cannot be changed';
      end if;
      delete from public.availability_exceptions where id = p_exception_id and organization_id = p_organization_id and barber_id = p_barber_id;
      v_message := format('Escala de %s: %s removeu %s de %s a %s.', v_barber.display_name, v_actor, case v_exception.kind when 'UNAVAILABLE' then 'folga/indisponibilidade' else 'horário extra disponível' end, to_char(lower(v_exception.service_period) at time zone v_timezone, 'DD/MM/YYYY HH24:MI'), to_char(upper(v_exception.service_period) at time zone v_timezone, 'DD/MM/YYYY HH24:MI'));
    end if;
  else
    raise exception using errcode = '22023', message = 'unsupported barber schedule action';
  end if;

  insert into public.barber_schedule_change_messages (organization_id, barber_id, actor_user_id, action, message, details)
  values (p_organization_id, p_barber_id, auth.uid(), p_action, v_message, jsonb_build_object('actor_role', v_actor_role, 'interval_id', v_interval.id, 'exception_id', v_exception.id));
  return jsonb_build_object('message', v_message);
end;
$$;

revoke all on function public.get_my_barber_schedule(uuid) from public, anon;
revoke all on function public.mutate_barber_schedule(uuid, uuid, text, uuid, smallint, time, time, uuid, uuid, timestamptz, timestamptz, text, public.availability_exception_kind) from public, anon;
grant execute on function public.get_my_barber_schedule(uuid), public.mutate_barber_schedule(uuid, uuid, text, uuid, smallint, time, time, uuid, uuid, timestamptz, timestamptz, text, public.availability_exception_kind) to authenticated;
