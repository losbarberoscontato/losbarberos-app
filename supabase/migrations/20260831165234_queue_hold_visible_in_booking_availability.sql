-- Keep the queue customer's active slot visible while the booking screen
-- calculates service-length availability. Other queue holds remain blockers.
create or replace function public.get_available_slots(
  p_organization_slug text,
  p_barber_id uuid,
  p_local_date date,
  p_selections jsonb,
  p_walkin_queue_hold_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_result jsonb;
  v_hold_start timestamptz;
  v_hold_end timestamptz;
  v_occupied integer;
  v_period tstzrange;
begin
  v_result := public.get_available_slots(
    p_organization_slug, p_barber_id, p_local_date, p_selections
  );
  if p_walkin_queue_hold_id is null or v_result is null then
    return v_result;
  end if;

  select lower(h.service_period), upper(h.service_period)
    into v_hold_start, v_hold_end
  from public.walkin_queue_holds h
  join public.organizations o on o.id = h.organization_id
  where h.id = p_walkin_queue_hold_id
    and o.slug = p_organization_slug
    and h.barber_id = p_barber_id
    and h.consumed_at is null
    and h.expires_at > now();
  if not found then
    return v_result;
  end if;

  v_occupied := (v_result ->> 'occupied_minutes')::integer;
  v_period := tstzrange(v_hold_start, v_hold_start + make_interval(mins => v_occupied), '[)');
  if v_hold_start <= now()
     or not public.is_barber_available((select id from public.organizations where slug = p_organization_slug), p_barber_id, v_period)
     or exists (
       select 1 from public.appointments a
       join public.organizations o on o.id = a.organization_id
       where o.slug = p_organization_slug and a.barber_id = p_barber_id
         and (a.status in ('CONFIRMED', 'IN_SERVICE')
           or (a.status in ('HELD', 'PENDING_PAYMENT') and a.hold_expires_at > now()))
         and a.service_period && v_period
     )
     or exists (
       select 1 from public.walkin_queue_holds h
       join public.organizations o on o.id = h.organization_id
       where o.slug = p_organization_slug and h.barber_id = p_barber_id
         and h.id <> p_walkin_queue_hold_id and h.consumed_at is null
         and h.expires_at > now() and h.service_period && v_period
     ) then
    return v_result;
  end if;

  return jsonb_set(
    v_result,
    '{slots}',
    (v_result -> 'slots') || jsonb_build_array(jsonb_build_object(
      'starts_at', v_hold_start,
      'ends_at', v_hold_start + make_interval(mins => v_occupied)
    ))
  );
end;
$$;

revoke all on function public.get_available_slots(text, uuid, date, jsonb, uuid) from public;
grant execute on function public.get_available_slots(text, uuid, date, jsonb, uuid) to authenticated;
