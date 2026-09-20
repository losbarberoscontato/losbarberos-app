-- Arquivamento reversível de projetos: preserva todo o histórico operacional.

alter table public.projects drop constraint if exists projects_status_check;
alter table public.projects
  add constraint projects_status_check
  check (status in ('DRAFT', 'PUBLISHED', 'PAUSED', 'CLOSED', 'ARCHIVED'));

drop index if exists public.projects_active_name_key;
create unique index projects_active_name_key
  on public.projects (organization_id, lower(btrim(name)))
  where status not in ('CLOSED', 'ARCHIVED');

create function public.set_project_archive_status(
  p_organization_id uuid,
  p_project_id uuid,
  p_archived boolean
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
    raise exception using errcode = '42501', message = 'project archive denied';
  end if;
  if not public.organization_module_enabled(p_organization_id, 'projects') then
    raise exception using errcode = '42501', message = 'projects module disabled';
  end if;

  select * into v_project
    from public.projects
   where id = p_project_id
     and organization_id = p_organization_id
   for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'project not found';
  end if;

  if p_archived and v_project.status = 'CLOSED' then
    raise exception using errcode = '22023', message = 'closed project cannot be archived';
  end if;

  update public.projects
     set status = case when p_archived then 'ARCHIVED' else 'PUBLISHED' end,
         published_at = case when p_archived then published_at else coalesce(published_at, now()) end,
         updated_at = now()
   where id = p_project_id
     and organization_id = p_organization_id
   returning * into v_project;

  return v_project;
end;
$$;

revoke all on function public.set_project_archive_status(uuid, uuid, boolean) from public, anon;
grant execute on function public.set_project_archive_status(uuid, uuid, boolean) to authenticated;
