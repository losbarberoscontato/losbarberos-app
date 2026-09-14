-- Correções de alocação: reservas normais usam a escala; gestores escolhem
-- explicitamente o ambiente apenas quando necessário fora da escala.
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
  perform set_config('app.agenda_environment_id', coalesce(p_environment_id::text, ''), true);
  v_result := public.create_manual_appointment(
    p_organization_id, p_customer_id, p_barber_id, p_starts_at,
    p_selections, p_override_reason, p_notes
  );
  return v_result;
end;
$$;

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
  v_count integer;
begin
  select * into strict v_environment
  from public.agenda_environments
  where id = p_environment_id
  for update;
  if not public.is_organization_owner(v_environment.organization_id) then
    raise exception using errcode = '42501', message = 'organization owner required';
  end if;

  select count(*)::integer into v_count
  from public.agenda_environments
  where location_id = v_environment.location_id and active;
  v_target := least(greatest(1, p_sort_order), greatest(v_count, 1));

  update public.agenda_environments
  set sort_order = sort_order + 10000, updated_at = now()
  where location_id = v_environment.location_id and active;

  with ordered as (
    select e.id,
      row_number() over (
        order by case
          when e.id = p_environment_id then v_target
          when e.sort_order - 10000 >= v_target then e.sort_order - 10000 + 1
          else e.sort_order - 10000
        end,
        e.name, e.id
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

revoke all on function public.create_manual_appointment(uuid, uuid, uuid, timestamptz, jsonb, text, text, uuid) from public, anon;
grant execute on function public.create_manual_appointment(uuid, uuid, uuid, timestamptz, jsonb, text, text, uuid) to authenticated;
revoke all on function public.reorder_agenda_environment(uuid, integer) from public, anon;
grant execute on function public.reorder_agenda_environment(uuid, integer) to authenticated;
