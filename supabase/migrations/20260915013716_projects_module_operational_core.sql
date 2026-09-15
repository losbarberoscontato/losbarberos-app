-- Projetos: núcleo operacional V1.
-- Um projeto é uma oferta comercial reutilizável; uma contratação é a
-- instância dessa oferta para um cliente. Valores são sempre centavos inteiros.

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 2 and 160),
  description text,
  status text not null default 'DRAFT' check (status in ('DRAFT', 'PUBLISHED', 'PAUSED', 'CLOSED')),
  starts_on date,
  sales_close_on date,
  ends_on date,
  goal_contracts integer check (goal_contracts is null or goal_contracts > 0),
  created_by uuid not null references auth.users(id),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  check (ends_on is null or starts_on is null or ends_on >= starts_on),
  check (sales_close_on is null or starts_on is null or sales_close_on >= starts_on)
);

create unique index projects_active_name_key
  on public.projects (organization_id, lower(btrim(name)))
  where status <> 'CLOSED';
create index projects_org_status_idx on public.projects (organization_id, status, starts_on, ends_on);

create table public.project_packages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null,
  name text not null check (char_length(btrim(name)) between 2 and 120),
  description text,
  price_cents bigint not null check (price_cents >= 0),
  sessions_count integer not null default 1 check (sessions_count between 1 and 100),
  sort_order integer not null default 0 check (sort_order >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (project_id, organization_id)
    references public.projects(id, organization_id) on delete cascade
);

create unique index project_packages_active_name_key
  on public.project_packages (project_id, lower(btrim(name))) where active;
create index project_packages_project_order_idx
  on public.project_packages (organization_id, project_id, active, sort_order, name);

create table public.project_steps (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null,
  name text not null check (char_length(btrim(name)) between 2 and 160),
  description text,
  position integer not null check (position > 0),
  kind text not null default 'INTERNAL' check (kind in ('INTERNAL', 'SERVICE')),
  service_id uuid,
  commission_rate_bps integer check (commission_rate_bps is null or commission_rate_bps between 0 and 10000),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  unique (project_id, position),
  foreign key (project_id, organization_id)
    references public.projects(id, organization_id) on delete cascade,
  foreign key (service_id, organization_id)
    references public.services(id, organization_id),
  check ((kind = 'SERVICE' and service_id is not null) or (kind = 'INTERNAL' and service_id is null))
);

create table public.project_engagements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null,
  customer_id uuid not null,
  package_id uuid not null,
  status text not null default 'PROPOSAL' check (status in ('PROPOSAL', 'ACTIVE', 'COMPLETED', 'CANCELED')),
  contracted_cents bigint not null check (contracted_cents >= 0),
  proposal_sent_at timestamptz,
  accepted_at timestamptz,
  acceptance_version text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (project_id, organization_id)
    references public.projects(id, organization_id) on delete cascade,
  foreign key (package_id, organization_id)
    references public.project_packages(id, organization_id),
  foreign key (customer_id, organization_id)
    references public.customers(id, organization_id),
  check ((status = 'PROPOSAL' and accepted_at is null) or status <> 'PROPOSAL')
);

create index project_engagements_project_status_idx
  on public.project_engagements (organization_id, project_id, status, created_at desc);
create index project_engagements_customer_idx
  on public.project_engagements (organization_id, customer_id, created_at desc);

create table public.project_engagement_steps (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  engagement_id uuid not null,
  project_step_id uuid not null,
  status text not null default 'PENDING' check (status in ('PENDING', 'IN_PROGRESS', 'READY', 'APPROVED', 'REOPENED')),
  assigned_barber_id uuid,
  appointment_id uuid,
  service_price_cents_snapshot bigint check (service_price_cents_snapshot is null or service_price_cents_snapshot >= 0),
  commission_cents bigint not null default 0 check (commission_cents >= 0),
  ready_at timestamptz,
  approved_at timestamptz,
  approved_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  unique (engagement_id, project_step_id),
  foreign key (engagement_id, organization_id)
    references public.project_engagements(id, organization_id) on delete cascade,
  foreign key (project_step_id, organization_id)
    references public.project_steps(id, organization_id) on delete cascade,
  foreign key (assigned_barber_id, organization_id)
    references public.barbers(id, organization_id),
  foreign key (appointment_id, organization_id)
    references public.appointments(id, organization_id)
);

create index project_engagement_steps_board_idx
  on public.project_engagement_steps (organization_id, status, updated_at desc);

create table public.project_installments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  engagement_id uuid not null,
  installment_number integer not null check (installment_number > 0),
  due_on date not null,
  amount_cents bigint not null check (amount_cents >= 0),
  status text not null default 'OPEN' check (status in ('OPEN', 'PAID', 'CANCELED')),
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  unique (engagement_id, installment_number),
  foreign key (engagement_id, organization_id)
    references public.project_engagements(id, organization_id) on delete cascade
);

create table public.project_contract_acceptances (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  engagement_id uuid not null,
  customer_id uuid not null,
  contract_version text not null,
  accepted_by uuid not null references auth.users(id),
  accepted_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  unique (engagement_id, contract_version),
  foreign key (engagement_id, organization_id)
    references public.project_engagements(id, organization_id) on delete cascade,
  foreign key (customer_id, organization_id)
    references public.customers(id, organization_id)
);

do $$
declare t text;
begin
  foreach t in array array[
    'projects', 'project_packages', 'project_steps', 'project_engagements',
    'project_engagement_steps', 'project_installments', 'project_contract_acceptances'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
  end loop;
end $$;

create policy projects_owner_all on public.projects
  for all to authenticated using (public.is_organization_owner(organization_id))
  with check (public.is_organization_owner(organization_id));
create policy project_packages_owner_all on public.project_packages
  for all to authenticated using (public.is_organization_owner(organization_id))
  with check (public.is_organization_owner(organization_id));
create policy project_steps_owner_all on public.project_steps
  for all to authenticated using (public.is_organization_owner(organization_id))
  with check (public.is_organization_owner(organization_id));
create policy project_engagements_owner_all on public.project_engagements
  for all to authenticated using (public.is_organization_owner(organization_id))
  with check (public.is_organization_owner(organization_id));
create policy project_engagements_customer_select on public.project_engagements
  for select to authenticated using (public.is_organization_customer(organization_id, customer_id));
create policy project_engagement_steps_owner_all on public.project_engagement_steps
  for all to authenticated using (public.is_organization_owner(organization_id))
  with check (public.is_organization_owner(organization_id));
create policy project_engagement_steps_customer_select on public.project_engagement_steps
  for select to authenticated using (exists (
    select 1 from public.project_engagements e
    where e.id = project_engagement_steps.engagement_id
      and e.organization_id = project_engagement_steps.organization_id
      and public.is_organization_customer(e.organization_id, e.customer_id)
  ));
create policy project_installments_owner_all on public.project_installments
  for all to authenticated using (public.is_organization_owner(organization_id))
  with check (public.is_organization_owner(organization_id));
create policy project_installments_customer_select on public.project_installments
  for select to authenticated using (exists (
    select 1 from public.project_engagements e
    where e.id = project_installments.engagement_id
      and e.organization_id = project_installments.organization_id
      and public.is_organization_customer(e.organization_id, e.customer_id)
  ));
create policy project_contract_acceptances_owner_all on public.project_contract_acceptances
  for all to authenticated using (public.is_organization_owner(organization_id))
  with check (public.is_organization_owner(organization_id));
create policy project_contract_acceptances_customer_select on public.project_contract_acceptances
  for select to authenticated using (public.is_organization_customer(organization_id, customer_id));

grant select, insert, update, delete on public.projects, public.project_packages,
  public.project_steps, public.project_engagements, public.project_engagement_steps,
  public.project_installments, public.project_contract_acceptances to authenticated;

create or replace function public.create_project_with_initial_package(
  p_organization_id uuid,
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
declare v_project public.projects;
begin
  if not public.is_organization_owner(p_organization_id) then
    raise exception using errcode = '42501', message = 'project creation denied';
  end if;
  if not public.organization_module_enabled(p_organization_id, 'projects') then
    raise exception using errcode = '42501', message = 'projects module disabled';
  end if;
  if p_package_price_cents < 0 or p_package_sessions_count < 1 then
    raise exception using errcode = '22023', message = 'invalid project package';
  end if;
  insert into public.projects(
    organization_id, name, description, status, starts_on, sales_close_on,
    ends_on, goal_contracts, created_by, published_at
  ) values (
    p_organization_id, btrim(p_name), nullif(btrim(p_description), ''), 'PUBLISHED',
    p_starts_on, p_sales_close_on, p_ends_on, p_goal_contracts, auth.uid(), now()
  ) returning * into v_project;
  insert into public.project_packages(
    organization_id, project_id, name, description, price_cents, sessions_count, sort_order
  ) values (
    p_organization_id, v_project.id, btrim(p_package_name),
    nullif(btrim(p_package_description), ''), p_package_price_cents,
    p_package_sessions_count, 1
  );
  insert into public.project_steps(organization_id, project_id, name, position, kind)
  values
    (p_organization_id, v_project.id, 'Agendar primeira sessão', 1, 'INTERNAL'),
    (p_organization_id, v_project.id, 'Executar planejamento', 2, 'INTERNAL'),
    (p_organization_id, v_project.id, 'Entrega e revisão', 3, 'INTERNAL');
  return v_project;
end;
$$;

revoke all on function public.create_project_with_initial_package(uuid, text, text, date, date, date, integer, text, text, bigint, integer) from public, anon;
grant execute on function public.create_project_with_initial_package(uuid, text, text, date, date, date, integer, text, text, bigint, integer) to authenticated;

-- A janela de retenção remove apenas dados operacionais do módulo. Contratos,
-- aceites, caixa e comissões existentes em tabelas próprias não são tocados.
create or replace function public.process_expired_project_module_retention(p_limit integer default 100)
returns integer
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_row record; v_count integer := 0;
begin
  perform public.require_service_role();
  for v_row in
    select organization_id
      from public.organization_module_entitlements
     where module_key = 'projects' and enabled = false
       and data_retention_status = 'PENDING_DELETION'
       and data_retention_until <= now()
     order by data_retention_until
     limit greatest(1, least(p_limit, 500))
     for update skip locked
  loop
    delete from public.projects where organization_id = v_row.organization_id;
    update public.organization_module_entitlements
       set data_retention_status = 'DELETED', data_retention_until = null, changed_at = now()
     where organization_id = v_row.organization_id and module_key = 'projects';
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.process_expired_project_module_retention(integer) from public, anon, authenticated;
grant execute on function public.process_expired_project_module_retention(integer) to service_role;
