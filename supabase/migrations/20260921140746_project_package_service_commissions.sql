-- Vínculos de serviço e profissional com comissão específica para cada pacote de projeto.
-- Os valores ficam normalizados e em centavos inteiros; não criam contas a pagar.
create table public.project_package_service_assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_package_id uuid not null,
  service_id uuid not null,
  barber_id uuid not null,
  commission_cents bigint not null check (commission_cents >= 0),
  created_at timestamptz not null default now(),
  unique (project_package_id, service_id, barber_id),
  unique (id, organization_id),
  foreign key (project_package_id, organization_id)
    references public.project_packages(id, organization_id) on delete cascade,
  foreign key (service_id, organization_id)
    references public.services(id, organization_id) on delete restrict,
  foreign key (barber_id, organization_id)
    references public.barbers(id, organization_id) on delete restrict
);

create index project_package_service_assignments_lookup_idx
  on public.project_package_service_assignments (organization_id, project_package_id);

alter table public.project_package_service_assignments enable row level security;
alter table public.project_package_service_assignments force row level security;
create policy project_package_service_assignments_owner_select
  on public.project_package_service_assignments
  for select to authenticated
  using (public.is_organization_owner(organization_id));
revoke all on public.project_package_service_assignments from public, anon, authenticated;
grant select on public.project_package_service_assignments to authenticated;

-- Sobrecarga atômica: preço sugerido e associações do pacote são salvos na mesma transação.
create or replace function public.upsert_project_package(
  p_organization_id uuid,
  p_project_id uuid,
  p_package_id uuid,
  p_name text,
  p_description text,
  p_duration_minutes integer,
  p_sessions_count integer,
  p_fixed_cost_per_hour_cents bigint,
  p_extra_costs_cents bigint,
  p_extra_costs_description text,
  p_tax_rate_bps integer,
  p_card_rate_bps integer,
  p_profit_margin_bps integer,
  p_deposit_cents bigint,
  p_practiced_price_cents bigint,
  p_service_assignments jsonb
)
returns public.project_packages
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_package public.project_packages;
  v_commission_total numeric := 0;
  v_cost_total numeric;
  v_denominator numeric;
  v_suggested_price bigint;
begin
  if not public.is_organization_owner(p_organization_id) then
    raise exception using errcode = '42501', message = 'project package write denied';
  end if;
  if not public.organization_module_enabled(p_organization_id, 'projects') then
    raise exception using errcode = '42501', message = 'projects module disabled';
  end if;
  if p_name is null or char_length(btrim(p_name)) < 2 then
    raise exception using errcode = '22023', message = 'invalid project package name';
  end if;
  if p_duration_minutes < 5 or p_sessions_count < 1 or p_fixed_cost_per_hour_cents < 0
    or p_extra_costs_cents < 0 or p_tax_rate_bps < 0 or p_card_rate_bps < 0
    or p_profit_margin_bps < 0 or p_deposit_cents < 0 or p_practiced_price_cents < 0 then
    raise exception using errcode = '22023', message = 'invalid project package pricing';
  end if;
  if p_service_assignments is null or jsonb_typeof(p_service_assignments) <> 'array' then
    raise exception using errcode = '22023', message = 'invalid project package service assignments';
  end if;
  if exists (
    select 1
    from jsonb_to_recordset(p_service_assignments) as assignment(service_id uuid, barber_id uuid, commission_cents bigint)
    where assignment.service_id is null or assignment.barber_id is null or assignment.commission_cents is null or assignment.commission_cents < 0
  ) then
    raise exception using errcode = '22023', message = 'invalid project package service assignment';
  end if;
  if exists (
    select 1
    from jsonb_to_recordset(p_service_assignments) as assignment(service_id uuid, barber_id uuid, commission_cents bigint)
    group by assignment.service_id, assignment.barber_id
    having count(*) > 1
  ) then
    raise exception using errcode = '22023', message = 'duplicate project package service professional';
  end if;
  if exists (
    select 1
    from jsonb_to_recordset(p_service_assignments) as assignment(service_id uuid, barber_id uuid, commission_cents bigint)
    left join public.services s
      on s.id = assignment.service_id and s.organization_id = p_organization_id and s.active
    left join public.barbers b
      on b.id = assignment.barber_id and b.organization_id = p_organization_id and b.active
    left join public.barber_services bs
      on bs.service_id = assignment.service_id and bs.barber_id = assignment.barber_id
      and bs.organization_id = p_organization_id and bs.active
    where s.id is null or b.id is null or bs.barber_id is null
  ) then
    raise exception using errcode = '22023', message = 'invalid or unavailable project package service professional';
  end if;
  select coalesce(sum(assignment.commission_cents), 0)
    into v_commission_total
  from jsonb_to_recordset(p_service_assignments) as assignment(service_id uuid, barber_id uuid, commission_cents bigint);
  if v_commission_total > 9223372036854775807 then
    raise exception using errcode = '22003', message = 'project package commission total is too large';
  end if;

  v_denominator := 1 - ((p_profit_margin_bps + p_card_rate_bps + p_tax_rate_bps)::numeric / 10000);
  if v_denominator <= 0 then
    raise exception using errcode = '22023', message = 'pricing rates must be below 100%';
  end if;
  -- Custos fixos incidem por sessão; extras e comissões incidem uma vez por pacote.
  v_cost_total := (p_fixed_cost_per_hour_cents::numeric * p_sessions_count) + p_extra_costs_cents + v_commission_total;
  v_suggested_price := greatest(0, round(v_cost_total / v_denominator)::bigint);

  if p_package_id is null then
    insert into public.project_packages(
      organization_id, project_id, name, description, price_cents, sessions_count,
      duration_minutes, fixed_cost_per_hour_cents, extra_costs_cents,
      extra_costs_description, tax_rate_bps, card_rate_bps, profit_margin_bps,
      deposit_cents, suggested_price_cents, sort_order, active
    )
    select p_organization_id, p_project_id, btrim(p_name), nullif(btrim(p_description), ''),
      p_practiced_price_cents, p_sessions_count, p_duration_minutes,
      p_fixed_cost_per_hour_cents, p_extra_costs_cents,
      nullif(btrim(p_extra_costs_description), ''), p_tax_rate_bps, p_card_rate_bps,
      p_profit_margin_bps, p_deposit_cents, v_suggested_price,
      coalesce(max(sort_order) + 1, 1), true
    from public.project_packages
    where organization_id = p_organization_id and project_id = p_project_id
    returning * into v_package;
  else
    update public.project_packages
    set name = btrim(p_name),
        description = nullif(btrim(p_description), ''),
        price_cents = p_practiced_price_cents,
        sessions_count = p_sessions_count,
        duration_minutes = p_duration_minutes,
        fixed_cost_per_hour_cents = p_fixed_cost_per_hour_cents,
        extra_costs_cents = p_extra_costs_cents,
        extra_costs_description = nullif(btrim(p_extra_costs_description), ''),
        tax_rate_bps = p_tax_rate_bps,
        card_rate_bps = p_card_rate_bps,
        profit_margin_bps = p_profit_margin_bps,
        deposit_cents = p_deposit_cents,
        suggested_price_cents = v_suggested_price,
        updated_at = now()
    where id = p_package_id and organization_id = p_organization_id and project_id = p_project_id
    returning * into v_package;
    if v_package.id is null then
      raise exception using errcode = '22023', message = 'project package not found';
    end if;
  end if;

  delete from public.project_package_service_assignments
  where organization_id = p_organization_id and project_package_id = v_package.id;
  insert into public.project_package_service_assignments(
    organization_id, project_package_id, service_id, barber_id, commission_cents
  )
  select p_organization_id, v_package.id, assignment.service_id, assignment.barber_id, assignment.commission_cents
  from jsonb_to_recordset(p_service_assignments) as assignment(service_id uuid, barber_id uuid, commission_cents bigint);

  return v_package;
end;
$$;

revoke all on function public.upsert_project_package(uuid, uuid, uuid, text, text, integer, integer, bigint, bigint, text, integer, integer, integer, bigint, bigint, jsonb) from public, anon;
grant execute on function public.upsert_project_package(uuid, uuid, uuid, text, text, integer, integer, bigint, bigint, text, integer, integer, integer, bigint, bigint, jsonb) to authenticated;
