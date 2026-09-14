create or replace function public.reorder_agenda_environment(
  p_environment_id uuid,
  p_sort_order integer
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_environment public.agenda_environments%rowtype;
  v_target integer;
begin
  select * into strict v_environment
  from public.agenda_environments
  where id = p_environment_id
  for update;
  if not public.is_organization_owner(v_environment.organization_id) then
    raise exception using errcode = '42501', message = 'organization owner required';
  end if;
  v_target := greatest(1, p_sort_order);
  update public.agenda_environments
  set sort_order = sort_order + 10000, updated_at = now()
  where location_id = v_environment.location_id and active;
  with ordered as (
    select e.id,
      row_number() over (
        order by case when e.id = p_environment_id then v_target else e.sort_order end,
          e.sort_order, e.name, e.id
      )::integer as next_order
    from public.agenda_environments e
    where e.location_id = v_environment.location_id and e.active
  )
  update public.agenda_environments e
  set sort_order = ordered.next_order, updated_at = now()
  from ordered
  where e.id = ordered.id;
end;
$$;

revoke all on function public.reorder_agenda_environment(uuid, integer) from public, anon, authenticated;
grant execute on function public.reorder_agenda_environment(uuid, integer) to authenticated;
