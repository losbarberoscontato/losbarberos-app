begin;

alter table public.services
  add column if not exists audiences text[] not null default '{}'::text[];

alter table public.packages
  add column if not exists audiences text[] not null default '{}'::text[];

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'services_audiences_valid'
      and conrelid = 'public.services'::regclass
  ) then
    alter table public.services
      add constraint services_audiences_valid
      check (
        cardinality(audiences) <= 4
        and audiences <@ array['INFANTIL', 'FEMININO', 'MASCULINO', 'OUTROS_SERVICOS']::text[]
      );
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'packages_audiences_valid'
      and conrelid = 'public.packages'::regclass
  ) then
    alter table public.packages
      add constraint packages_audiences_valid
      check (
        cardinality(audiences) <= 4
        and audiences <@ array['INFANTIL', 'FEMININO', 'MASCULINO', 'OUTROS_SERVICOS']::text[]
      );
  end if;
end;
$$;

create or replace function public.require_catalog_audiences()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.audiences is null or cardinality(new.audiences) = 0 then
    raise exception using errcode = '22023', message = 'catalog item requires at least one audience';
  end if;
  return new;
end;
$$;

drop trigger if exists services_require_audiences on public.services;
create trigger services_require_audiences
before insert on public.services
for each row execute function public.require_catalog_audiences();

drop trigger if exists packages_require_audiences on public.packages;
create trigger packages_require_audiences
before insert on public.packages
for each row execute function public.require_catalog_audiences();

drop function if exists public.save_package_with_items(uuid, uuid, text, text, bigint, boolean, integer, jsonb);

create or replace function public.save_package_with_items(
  p_organization_id uuid,
  p_package_id uuid,
  p_name text,
  p_description text,
  p_price_cents bigint,
  p_active boolean,
  p_sort_order integer,
  p_audiences text[],
  p_items jsonb
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

  if p_package_id is null then
    insert into public.packages (
      organization_id, name, description, price_cents, active, sort_order, audiences
    ) values (
      p_organization_id, btrim(p_name), nullif(btrim(p_description), ''),
      p_price_cents, coalesce(p_active, true), coalesce(p_sort_order, 0), p_audiences
    ) returning id into v_package_id;
  else
    select id into strict v_package_id
    from public.packages
    where id = p_package_id and organization_id = p_organization_id
    for update;
    update public.packages
      set name = btrim(p_name), description = nullif(btrim(p_description), ''),
          price_cents = p_price_cents, active = coalesce(p_active, active),
          sort_order = coalesce(p_sort_order, sort_order), audiences = p_audiences
      where id = v_package_id and organization_id = p_organization_id;
    update public.package_items
      set active = false
      where package_id = v_package_id and organization_id = p_organization_id
        and active;
  end if;

  insert into public.package_items (
    organization_id, package_id, service_id, quantity, position
  )
  select
    p_organization_id, v_package_id, (item ->> 'service_id')::uuid,
    coalesce((item ->> 'quantity')::smallint, 1), (ordinality - 1)::smallint
  from jsonb_array_elements(p_items) with ordinality as entries(item, ordinality)
  order by ordinality;
  return v_package_id;
exception
  when no_data_found then
    raise exception using errcode = 'P0002', message = 'tenant package not found';
end;
$$;

revoke all on function public.save_package_with_items(uuid, uuid, text, text, bigint, boolean, integer, text[], jsonb) from public;
grant execute on function public.save_package_with_items(uuid, uuid, text, text, bigint, boolean, integer, text[], jsonb) to authenticated;

create or replace function public.get_public_booking_context(p_organization_slug text)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'organization', jsonb_build_object(
      'id', o.id,
      'name', o.name,
      'slug', o.slug,
      'timezone', o.timezone,
      'currency', o.currency,
      'deposit_bps', o.deposit_bps,
      'cancellation_lead_minutes', o.cancellation_lead_minutes,
      'accepting_bookings', public.organization_accepts_new_bookings(o.id)
    ),
    'location', (
      select jsonb_build_object('id', l.id, 'name', l.name, 'address', l.address)
      from public.locations l
      where l.organization_id = o.id and l.active
      limit 1
    ),
    'services', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', s.id, 'name', s.name, 'description', s.description,
          'price_cents', s.price_cents, 'duration_minutes', s.duration_minutes,
          'audiences', s.audiences
        ) order by s.sort_order, s.name
      )
      from public.services s
      where s.organization_id = o.id and s.active and cardinality(s.audiences) > 0
    ), '[]'::jsonb),
    'packages', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', p.id, 'name', p.name, 'description', p.description,
          'price_cents', p.price_cents, 'audiences', p.audiences,
          'items', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'service_id', s.id, 'name', s.name,
                'quantity', pi.quantity, 'duration_minutes', s.duration_minutes
              ) order by pi.position, s.name
            )
            from public.package_items pi
            join public.services s
              on s.id = pi.service_id and s.organization_id = pi.organization_id
            where pi.package_id = p.id and pi.organization_id = p.organization_id
              and pi.active and s.active and cardinality(s.audiences) > 0
          ), '[]'::jsonb)
        ) order by p.sort_order, p.name
      )
      from public.packages p
      where p.organization_id = o.id and p.active and cardinality(p.audiences) > 0
        and exists (
          select 1 from public.package_items pi
          join public.services s
            on s.id = pi.service_id and s.organization_id = pi.organization_id
          where pi.package_id = p.id and pi.organization_id = p.organization_id
            and pi.active and s.active and cardinality(s.audiences) > 0
        )
    ), '[]'::jsonb),
    'barbers', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', b.id,
          'name', b.display_name,
          'bio', b.bio,
          'avatar_url', b.avatar_url,
          'service_ids', coalesce((
            select jsonb_agg(bs.service_id order by bs.service_id)
            from public.barber_services bs
            join public.services s
              on s.id = bs.service_id and s.organization_id = bs.organization_id
            where bs.organization_id = b.organization_id
              and bs.barber_id = b.id and bs.active and s.active
          ), '[]'::jsonb)
        )
        order by b.display_name
      )
      from public.barbers b
      where b.organization_id = o.id and b.active
    ), '[]'::jsonb)
  )
  from public.organizations o
  where o.slug = p_organization_slug;
$$;

revoke all on function public.get_public_booking_context(text) from public;
grant execute on function public.get_public_booking_context(text) to anon, authenticated;

commit;
