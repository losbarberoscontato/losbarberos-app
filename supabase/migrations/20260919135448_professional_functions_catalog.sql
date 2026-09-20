create table public.professional_functions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 2 and 80),
  created_at timestamptz not null default now(),
  unique (id, organization_id)
);

create unique index professional_functions_name_per_organization
  on public.professional_functions (organization_id, lower(btrim(name)));

alter table public.professional_functions enable row level security;

create policy professional_functions_owner_select
  on public.professional_functions for select to authenticated
  using (public.is_organization_owner(organization_id));

create policy professional_functions_owner_insert
  on public.professional_functions for insert to authenticated
  with check (public.is_organization_owner(organization_id));

grant select, insert on public.professional_functions to authenticated;
