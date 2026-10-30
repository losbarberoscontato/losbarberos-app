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
    'environments', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'name', e.name, 'location_id', e.location_id) order by e.sort_order, e.name) from public.agenda_environments e where e.organization_id = p_organization_id and e.location_id = v_barber.location_id and e.active), '[]'::jsonb),
    'exceptions', coalesce((select jsonb_agg(to_jsonb(ae) order by lower(ae.service_period)) from public.availability_exceptions ae where ae.organization_id = p_organization_id and ae.barber_id = v_barber.id and upper(ae.service_period) > now() - interval '1 day'), '[]'::jsonb),
    'messages', coalesce((select jsonb_agg(to_jsonb(m) order by m.created_at desc) from (select * from public.barber_schedule_change_messages where organization_id = p_organization_id and barber_id = v_barber.id order by created_at desc limit 50) m), '[]'::jsonb),
    'timezone', v_timezone
  );
end;
$$;

revoke all on function public.get_my_barber_schedule(uuid) from public, anon;
grant execute on function public.get_my_barber_schedule(uuid) to authenticated;
