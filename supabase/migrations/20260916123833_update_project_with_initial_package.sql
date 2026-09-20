create function public.update_project_with_initial_package(
  p_organization_id uuid,
  p_project_id uuid,
  p_name text,
  p_description text,
  p_starts_on date,
  p_sales_close_on date,
  p_ends_on date,
  p_goal_contracts integer,
  p_package_name text,
  p_package_description text,
  p_package_price_cents bigint,
  p_package_sessions_count integer
)
returns public.projects
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_project public.projects;
  v_package_id uuid;
begin
  if not public.is_organization_owner(p_organization_id) then
    raise exception using errcode = '42501', message = 'project update denied';
  end if;
  if not public.organization_module_enabled(p_organization_id, 'projects') then
    raise exception using errcode = '42501', message = 'projects module disabled';
  end if;
  if char_length(btrim(coalesce(p_name, ''))) < 2 or char_length(btrim(p_name)) > 160 then
    raise exception using errcode = '22023', message = 'project name must contain 2 to 160 characters';
  end if;
  if char_length(btrim(coalesce(p_package_name, ''))) < 2 or char_length(btrim(p_package_name)) > 120 then
    raise exception using errcode = '22023', message = 'project package name must contain 2 to 120 characters';
  end if;
  if p_package_price_cents is null or p_package_price_cents < 0 or p_package_sessions_count is null or p_package_sessions_count < 1 or p_package_sessions_count > 100 then
    raise exception using errcode = '22023', message = 'invalid project package';
  end if;
  if p_goal_contracts is not null and p_goal_contracts < 1 then
    raise exception using errcode = '22023', message = 'invalid project goal';
  end if;
  update public.projects
     set name = btrim(p_name),
         description = nullif(btrim(coalesce(p_description, '')), ''),
         starts_on = p_starts_on,
         sales_close_on = p_sales_close_on,
         ends_on = p_ends_on,
         goal_contracts = p_goal_contracts,
         updated_at = now()
   where id = p_project_id and organization_id = p_organization_id
   returning * into v_project;
  if not found then
    raise exception using errcode = 'P0002', message = 'project not found';
  end if;
  select id into v_package_id
    from public.project_packages
   where project_id = p_project_id and organization_id = p_organization_id and active
   order by sort_order, created_at, id
   limit 1
   for update;
  if v_package_id is null then
    insert into public.project_packages (organization_id, project_id, name, description, price_cents, sessions_count, sort_order)
    values (p_organization_id, p_project_id, btrim(p_package_name), nullif(btrim(coalesce(p_package_description, '')), ''), p_package_price_cents, p_package_sessions_count, 1);
  else
    update public.project_packages
       set name = btrim(p_package_name),
           description = nullif(btrim(coalesce(p_package_description, '')), ''),
           price_cents = p_package_price_cents,
           sessions_count = p_package_sessions_count,
           updated_at = now()
     where id = v_package_id and organization_id = p_organization_id;
  end if;
  return v_project;
end;
$$;

revoke all on function public.update_project_with_initial_package(uuid, uuid, text, text, date, date, date, integer, text, text, bigint, integer) from public, anon;
grant execute on function public.update_project_with_initial_package(uuid, uuid, text, text, date, date, date, integer, text, text, bigint, integer) to authenticated;
