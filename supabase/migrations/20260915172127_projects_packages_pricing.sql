-- Projetos: pacotes e precificação V1.
-- Campos são aditivos; price_cents continua sendo o preço praticado usado
-- pelas contratações existentes. O preço sugerido é calculado e persistido à parte.
-- fixed_cost_per_hour_cents preserva o nome legado, mas armazena o rateio por sessão.

alter table public.project_packages
  add column duration_minutes integer not null default 60
    check (duration_minutes between 5 and 14400),
  add column fixed_cost_per_hour_cents bigint not null default 0
    check (fixed_cost_per_hour_cents >= 0),
  add column extra_costs_cents bigint not null default 0
    check (extra_costs_cents >= 0),
  add column extra_costs_description text,
  add column tax_rate_bps integer not null default 0
    check (tax_rate_bps between 0 and 10000),
  add column card_rate_bps integer not null default 0
    check (card_rate_bps between 0 and 10000),
  add column profit_margin_bps integer not null default 5000
    check (profit_margin_bps between 0 and 10000),
  add column deposit_cents bigint not null default 0
    check (deposit_cents >= 0),
  add column suggested_price_cents bigint not null default 0
    check (suggested_price_cents >= 0);

update public.project_packages
set suggested_price_cents = price_cents
where suggested_price_cents = 0 and price_cents > 0;

create table public.project_package_barbers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_package_id uuid not null,
  barber_id uuid not null,
  created_at timestamptz not null default now(),
  unique (project_package_id, barber_id),
  unique (id, organization_id),
  foreign key (project_package_id, organization_id)
    references public.project_packages(id, organization_id) on delete cascade,
  foreign key (barber_id, organization_id)
    references public.barbers(id, organization_id) on delete restrict
);

create index project_package_barbers_lookup_idx
  on public.project_package_barbers (organization_id, project_package_id, barber_id);

alter table public.project_package_barbers enable row level security;
alter table public.project_package_barbers force row level security;
create policy project_package_barbers_owner_all on public.project_package_barbers
  for all to authenticated using (public.is_organization_owner(organization_id))
  with check (public.is_organization_owner(organization_id));
grant select, insert, update, delete on public.project_package_barbers to authenticated;

create or replace function public.enforce_project_package_limit()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare v_active_count integer;
begin
  if new.active then
    select count(*) into v_active_count
    from public.project_packages p
    where p.organization_id = new.organization_id
      and p.project_id = new.project_id
      and p.active
      and p.id <> new.id;
    if v_active_count >= 4 then
      raise exception using errcode = '22023', message = 'project package limit reached';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists project_packages_limit_trigger on public.project_packages;
create trigger project_packages_limit_trigger
before insert or update of project_id, active on public.project_packages
for each row execute function public.enforce_project_package_limit();

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
  p_professional_ids uuid[]
)
returns public.project_packages
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_package public.project_packages;
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
  v_denominator := 1 - ((p_profit_margin_bps + p_card_rate_bps + p_tax_rate_bps)::numeric / 10000);
  if v_denominator <= 0 then
    raise exception using errcode = '22023', message = 'pricing rates must be below 100%';
  end if;
  -- O custo fixo representa o rateio de uma sessão; extras incidem uma vez no contrato.
  v_cost_total := (p_fixed_cost_per_hour_cents * p_sessions_count) + p_extra_costs_cents;
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

  delete from public.project_package_barbers
  where organization_id = p_organization_id and project_package_id = v_package.id;
  if coalesce(array_length(p_professional_ids, 1), 0) > 0 then
    if exists (
      select 1 from unnest(p_professional_ids) selected(id)
      where not exists (
        select 1 from public.barbers b
        where b.id = selected.id and b.organization_id = p_organization_id and b.active
      )
    ) then
      raise exception using errcode = '22023', message = 'invalid project package professional';
    end if;
    insert into public.project_package_barbers(organization_id, project_package_id, barber_id)
    select p_organization_id, v_package.id, selected.id
    from (select distinct id from unnest(p_professional_ids) selected(id)) selected;
  end if;
  return v_package;
end;
$$;

revoke all on function public.upsert_project_package(uuid, uuid, uuid, text, text, integer, integer, bigint, bigint, text, integer, integer, integer, bigint, bigint, uuid[]) from public, anon;
grant execute on function public.upsert_project_package(uuid, uuid, uuid, text, text, integer, integer, bigint, bigint, text, integer, integer, integer, bigint, bigint, uuid[]) to authenticated;
