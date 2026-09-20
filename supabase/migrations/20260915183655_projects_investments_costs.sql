-- Projetos: custos fixos, variáveis e investimentos iniciais.
-- Valores são centavos inteiros; o significado do valor é definido pela categoria:
-- FIXED e INVESTMENT são totais rateáveis; VARIABLE é um custo por pacote.

create table public.project_cost_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null,
  kind text not null check (kind in ('FIXED', 'VARIABLE', 'INVESTMENT')),
  name text not null check (char_length(btrim(name)) between 2 and 160),
  description text,
  amount_cents bigint not null check (amount_cents >= 0),
  active boolean not null default true,
  sort_order integer not null default 0 check (sort_order >= 0),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (project_id, organization_id)
    references public.projects(id, organization_id) on delete cascade
);

create index project_cost_items_lookup_idx
  on public.project_cost_items (organization_id, project_id, kind, active, sort_order, created_at);

alter table public.project_cost_items enable row level security;
alter table public.project_cost_items force row level security;
create policy project_cost_items_owner_all on public.project_cost_items
  for all to authenticated using (public.is_organization_owner(organization_id))
  with check (public.is_organization_owner(organization_id));
grant select, insert, update, delete on public.project_cost_items to authenticated;

create or replace function public.upsert_project_cost_item(
  p_organization_id uuid,
  p_project_id uuid,
  p_id uuid,
  p_kind text,
  p_name text,
  p_description text,
  p_amount_cents bigint
)
returns public.project_cost_items
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_item public.project_cost_items;
begin
  if not public.is_organization_owner(p_organization_id) then
    raise exception using errcode = '42501', message = 'project cost write denied';
  end if;
  if not public.organization_module_enabled(p_organization_id, 'projects') then
    raise exception using errcode = '42501', message = 'projects module disabled';
  end if;
  if p_kind not in ('FIXED', 'VARIABLE', 'INVESTMENT') then
    raise exception using errcode = '22023', message = 'invalid project cost category';
  end if;
  if p_name is null or char_length(btrim(p_name)) < 2 or p_amount_cents < 0 then
    raise exception using errcode = '22023', message = 'invalid project cost item';
  end if;

  if p_id is null then
    insert into public.project_cost_items(
      organization_id, project_id, kind, name, description, amount_cents, sort_order, created_by
    )
    select p_organization_id, p_project_id, p_kind, btrim(p_name), nullif(btrim(p_description), ''),
      p_amount_cents, coalesce(max(sort_order) + 1, 1), auth.uid()
    from public.project_cost_items
    where organization_id = p_organization_id and project_id = p_project_id and kind = p_kind
    returning * into v_item;
  else
    update public.project_cost_items
       set kind = p_kind,
           name = btrim(p_name),
           description = nullif(btrim(p_description), ''),
           amount_cents = p_amount_cents,
           updated_at = now()
     where id = p_id and organization_id = p_organization_id and project_id = p_project_id
     returning * into v_item;
    if v_item.id is null then
      raise exception using errcode = '22023', message = 'project cost item not found';
    end if;
  end if;
  return v_item;
end;
$$;

create or replace function public.delete_project_cost_item(
  p_organization_id uuid,
  p_project_id uuid,
  p_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_organization_owner(p_organization_id) then
    raise exception using errcode = '42501', message = 'project cost delete denied';
  end if;
  if not public.organization_module_enabled(p_organization_id, 'projects') then
    raise exception using errcode = '42501', message = 'projects module disabled';
  end if;
  delete from public.project_cost_items
   where id = p_id and organization_id = p_organization_id and project_id = p_project_id;
  if not found then
    raise exception using errcode = '22023', message = 'project cost item not found';
  end if;
end;
$$;

revoke all on function public.upsert_project_cost_item(uuid, uuid, uuid, text, text, text, bigint), public.delete_project_cost_item(uuid, uuid, uuid) from public, anon;
grant execute on function public.upsert_project_cost_item(uuid, uuid, uuid, text, text, text, bigint), public.delete_project_cost_item(uuid, uuid, uuid) to authenticated;
