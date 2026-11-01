create or replace function public.get_manager_appointment_environment_slots(
  p_organization_id uuid,
  p_barber_id uuid,
  p_local_date date,
  p_selections jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_org public.organizations%rowtype;
  v_location_id uuid;
  v_availability jsonb;
  v_slot jsonb;
  v_environment record;
  v_period tstzrange;
  v_resolved_environment_id uuid;
  v_slots jsonb := '[]'::jsonb;
  v_today date;
begin
  if not public.is_organization_owner(p_organization_id) then
    raise exception using errcode = '42501', message = 'organization owner required';
  end if;

  select * into strict v_org
  from public.organizations
  where id = p_organization_id;
  select b.location_id into strict v_location_id
  from public.barbers b
  where b.id = p_barber_id
    and b.organization_id = p_organization_id
    and b.active;

  v_today := (now() at time zone v_org.timezone)::date;
  if p_local_date < v_today or p_local_date > v_today + 180 then
    raise exception using errcode = '22023', message = 'availability date outside allowed window';
  end if;
  if jsonb_typeof(p_selections) is distinct from 'array' then
    raise exception using errcode = '22023', message = 'selections must be a non-empty JSON array';
  end if;
  if jsonb_array_length(p_selections) = 0 then
    raise exception using errcode = '22023', message = 'selections must be a non-empty JSON array';
  end if;

  if p_local_date <= v_today + 15 then
    v_availability := public.get_available_slots(v_org.slug, p_barber_id, p_local_date, p_selections);
  else
    v_availability := public.get_available_slots_legacy_window(v_org.slug, p_barber_id, p_local_date, p_selections);
  end if;

  for v_slot in
    select value from jsonb_array_elements(coalesce(v_availability -> 'slots', '[]'::jsonb))
  loop
    v_period := tstzrange((v_slot ->> 'starts_at')::timestamptz, (v_slot ->> 'ends_at')::timestamptz, '[)');
    if public.organization_date_blocked(p_organization_id, v_period) then
      continue;
    end if;

    for v_environment in
      select e.id, e.name, e.sort_order
      from public.agenda_environments e
      where e.organization_id = p_organization_id
        and e.location_id = v_location_id
        and e.active
      order by e.sort_order, e.name, e.id
    loop
      begin
        v_resolved_environment_id := public.resolve_appointment_environment(
          p_organization_id,
          p_barber_id,
          v_location_id,
          v_period,
          v_environment.id,
          null
        );
      exception
        when sqlstate '22023' or sqlstate '23P01' then
          continue;
      end;

      if v_resolved_environment_id = v_environment.id then
        v_slots := v_slots || jsonb_build_array(jsonb_build_object(
          'starts_at', v_slot -> 'starts_at',
          'ends_at', v_slot -> 'ends_at',
          'environment_id', v_environment.id,
          'environment_name', v_environment.name
        ));
      end if;
    end loop;
  end loop;

  return jsonb_build_object('slots', v_slots);
exception
  when no_data_found then
    raise exception using errcode = 'P0002', message = 'organization or active barber not found';
end;
$$;

revoke all on function public.get_manager_appointment_environment_slots(uuid, uuid, date, jsonb) from public, anon;
grant execute on function public.get_manager_appointment_environment_slots(uuid, uuid, date, jsonb) to authenticated;
