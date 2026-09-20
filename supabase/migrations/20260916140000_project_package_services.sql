-- Serviços selecionados em pacotes do módulo Projetos.
-- A associação é tenant-scoped e mantém a ordem escolhida pelo gestor.
create table if not exists public.project_package_services (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_package_id uuid not null,
  service_id uuid not null,
  position integer not null default 1 check (position > 0),
  created_at timestamptz not null default now(),
  unique (project_package_id, service_id),
  unique (id, organization_id),
  foreign key (project_package_id, organization_id)
    references public.project_packages(id, organization_id) on delete cascade,
  foreign key (service_id, organization_id)
    references public.services(id, organization_id) on delete restrict
);

create index if not exists project_package_services_lookup_idx
  on public.project_package_services (organization_id, project_package_id, position);

alter table public.project_package_services enable row level security;
alter table public.project_package_services force row level security;
drop policy if exists project_package_services_owner_all on public.project_package_services;
create policy project_package_services_owner_all on public.project_package_services
  for all to authenticated using (public.is_organization_owner(organization_id))
  with check (public.is_organization_owner(organization_id));

grant select, insert, update, delete on public.project_package_services to authenticated;
