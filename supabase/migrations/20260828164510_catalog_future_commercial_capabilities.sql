-- Future-only commercial eligibility. These flags never create subscriptions or
-- payment orders; they only define whether an item may be eligible later.
alter table public.services
  add column accepts_subscription boolean not null default false,
  add column accepts_online_payment boolean not null default false;

alter table public.packages
  add column accepts_subscription boolean not null default false,
  add column accepts_online_payment boolean not null default false;

create or replace function public.prevent_service_capability_conflict()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if old.accepts_subscription and not new.accepts_subscription and exists (
    select 1
    from public.package_items pi
    join public.packages p on p.id = pi.package_id and p.organization_id = pi.organization_id
    where pi.organization_id = new.organization_id
      and pi.service_id = new.id
      and pi.active
      and p.accepts_subscription
  ) then
    raise exception using errcode = '22023', message = 'disable subscription on dependent packages before disabling this service';
  end if;
  if old.accepts_online_payment and not new.accepts_online_payment and exists (
    select 1
    from public.package_items pi
    join public.packages p on p.id = pi.package_id and p.organization_id = pi.organization_id
    where pi.organization_id = new.organization_id
      and pi.service_id = new.id
      and pi.active
      and p.accepts_online_payment
  ) then
    raise exception using errcode = '22023', message = 'disable online payment on dependent packages before disabling this service';
  end if;
  return new;
end;
$$;

create trigger services_prevent_capability_conflict
before update of accepts_subscription, accepts_online_payment on public.services
for each row execute function public.prevent_service_capability_conflict();

create or replace function public.save_package_with_items_v2(
  p_organization_id uuid,
  p_package_id uuid,
  p_name text,
  p_description text,
  p_price_cents bigint,
  p_active boolean,
  p_sort_order integer,
  p_audiences text[],
  p_items jsonb,
  p_accepts_subscription boolean,
  p_accepts_online_payment boolean
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_package_id uuid;
  v_item_count integer;
begin
  if not public.is_organization_owner(p_organization_id) then
    raise exception using errcode = '42501', message = 'organization owner required';
  end if;
  if not public.organization_allows_management_mutations(p_organization_id) then
    raise exception using errcode = '42501', message = 'organization access does not allow catalog changes';
  end if;
  if p_audiences is null or cardinality(p_audiences) = 0
     or cardinality(p_audiences) > 4
     or not (p_audiences <@ array['INFANTIL', 'FEMININO', 'MASCULINO', 'OUTROS_SERVICOS']::text[]) then
    raise exception using errcode = '22023', message = 'package requires at least one valid audience';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) not between 1 and 50 then
    raise exception using errcode = '22023', message = 'package requires between 1 and 50 items';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_items) as entries(item)
    where jsonb_typeof(item) <> 'object'
  ) then
    raise exception using errcode = '22023', message = 'invalid package item';
  end if;
  select count(*)::integer into v_item_count
  from jsonb_array_elements(p_items) as entries(item)
  join public.services s
    on s.id = (item ->> 'service_id')::uuid
      and s.organization_id = p_organization_id and s.active
  where coalesce((item ->> 'quantity')::integer, 1) between 1 and 20;
  if v_item_count <> jsonb_array_length(p_items)
     or (select count(distinct item ->> 'service_id')
          from jsonb_array_elements(p_items) as entries(item))
        <> jsonb_array_length(p_items) then
    raise exception using errcode = '22023', message = 'package items must reference distinct active tenant services';
  end if;
  if coalesce(p_accepts_subscription, false) and exists (
    select 1
    from jsonb_array_elements(p_items) as entries(item)
    join public.services s on s.id = (item ->> 'service_id')::uuid and s.organization_id = p_organization_id
    where not s.accepts_subscription
  ) then
    raise exception using errcode = '22023', message = 'package subscription requires every included service to accept subscription';
  end if;
  if coalesce(p_accepts_online_payment, false) and exists (
    select 1
    from jsonb_array_elements(p_items) as entries(item)
    join public.services s on s.id = (item ->> 'service_id')::uuid and s.organization_id = p_organization_id
    where not s.accepts_online_payment
  ) then
    raise exception using errcode = '22023', message = 'package online payment requires every included service to accept online payment';
  end if;

  if p_package_id is null then
    insert into public.packages (
      organization_id, name, description, price_cents, active, sort_order, audiences,
      accepts_subscription, accepts_online_payment
    ) values (
      p_organization_id, btrim(p_name), nullif(btrim(p_description), ''),
      p_price_cents, coalesce(p_active, true), coalesce(p_sort_order, 0), p_audiences,
      coalesce(p_accepts_subscription, false), coalesce(p_accepts_online_payment, false)
    ) returning id into v_package_id;
  else
    select id into strict v_package_id
    from public.packages
    where id = p_package_id and organization_id = p_organization_id
    for update;
    update public.packages
      set name = btrim(p_name), description = nullif(btrim(p_description), ''),
          price_cents = p_price_cents, active = coalesce(p_active, active),
          sort_order = coalesce(p_sort_order, sort_order), audiences = p_audiences,
          accepts_subscription = coalesce(p_accepts_subscription, false),
          accepts_online_payment = coalesce(p_accepts_online_payment, false)
      where id = v_package_id and organization_id = p_organization_id;
    update public.package_items
      set active = false
      where package_id = v_package_id and organization_id = p_organization_id and active;
  end if;

  insert into public.package_items (organization_id, package_id, service_id, quantity, position)
  select p_organization_id, v_package_id, (item ->> 'service_id')::uuid,
    coalesce((item ->> 'quantity')::smallint, 1), (ordinality - 1)::smallint
  from jsonb_array_elements(p_items) with ordinality as entries(item, ordinality)
  order by ordinality;
  return v_package_id;
exception
  when no_data_found then
    raise exception using errcode = 'P0002', message = 'tenant package not found';
end;
$$;

revoke all on function public.save_package_with_items_v2(uuid, uuid, text, text, bigint, boolean, integer, text[], jsonb, boolean, boolean) from public, anon, authenticated, service_role;
grant execute on function public.save_package_with_items_v2(uuid, uuid, text, text, bigint, boolean, integer, text[], jsonb, boolean, boolean) to authenticated;
