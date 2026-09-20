-- Títulos de projetos são únicos por organização, independentemente do status.
drop index if exists public.projects_active_name_key;
create unique index projects_active_name_key
  on public.projects (organization_id, lower(btrim(name)));
