-- Cria apenas a oferta do projeto. Pacotes são cadastrados separadamente.
create function public.create_project(
  p_organization_id uuid,
  p_name text,
  p_description text,
  p_starts_on date,
  p_sales_close_on date,
  p_ends_on date,
  p_goal_contracts integer
)
returns public.projects
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_project public.projects;
begin
  if not public.is_organization_owner(p_organization_id) then
    raise exception using errcode = '42501', message = 'project creation denied';
  end if;
  if not public.organization_module_enabled(p_organization_id, 'projects') then
    raise exception using errcode = '42501', message = 'projects module disabled';
  end if;
  if char_length(btrim(coalesce(p_name, ''))) < 2 or char_length(btrim(p_name)) > 160 then
    raise exception using errcode = '22023', message = 'project name must contain 2 to 160 characters';
  end if;
  if p_goal_contracts is not null and p_goal_contracts < 1 then
    raise exception using errcode = '22023', message = 'invalid project goal';
  end if;

  insert into public.projects(
    organization_id, name, description, status, starts_on, sales_close_on,
    ends_on, goal_contracts, created_by, published_at
  ) values (
    p_organization_id, btrim(p_name), nullif(btrim(coalesce(p_description, '')), ''), 'PUBLISHED',
    p_starts_on, p_sales_close_on, p_ends_on, p_goal_contracts, auth.uid(), now()
  ) returning * into v_project;

  insert into public.project_steps(organization_id, project_id, name, position, kind)
  values
    (p_organization_id, v_project.id, 'Agendar primeira sessão', 1, 'INTERNAL'),
    (p_organization_id, v_project.id, 'Executar planejamento', 2, 'INTERNAL'),
    (p_organization_id, v_project.id, 'Entrega e revisão', 3, 'INTERNAL');

  return v_project;
end;
$$;

revoke all on function public.create_project(uuid, text, text, date, date, date, integer) from public, anon;
grant execute on function public.create_project(uuid, text, text, date, date, date, integer) to authenticated;
