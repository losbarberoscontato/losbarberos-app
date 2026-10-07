begin;

create table public.organization_audiences (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  audience_key text not null check (audience_key ~ '^[A-Z0-9_:-]{3,80}$'),
  name text not null check (char_length(btrim(name)) between 2 and 60),
  active boolean not null default true,
  sort_order integer not null default 0,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (organization_id, audience_key),
  check (not is_default or audience_key in ('INFANTIL', 'FEMININO', 'MASCULINO', 'OUTROS_SERVICOS'))
);

create unique index organization_audiences_name_per_organization
  on public.organization_audiences (organization_id, lower(name));

alter table public.organization_audiences enable row level security;
revoke all on public.organization_audiences from public, anon, authenticated;
grant select on public.organization_audiences to authenticated;

create policy organization_audiences_owner_read
  on public.organization_audiences
  for select to authenticated
  using (public.is_organization_owner(organization_id));

create or replace function public.seed_organization_catalog_audiences()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.organization_audiences (organization_id, audience_key, name, active, sort_order, is_default)
  values
    (new.id, 'INFANTIL', 'Infantil', true, 10, true),
    (new.id, 'FEMININO', 'Feminino', true, 20, true),
    (new.id, 'MASCULINO', 'Masculino', true, 30, true),
    (new.id, 'OUTROS_SERVICOS', 'Outros Serviços', true, 40, true)
  on conflict (organization_id, audience_key) do nothing;
  return new;
end;
$$;

revoke all on function public.seed_organization_catalog_audiences() from public, anon, authenticated;

insert into public.organization_audiences (organization_id, audience_key, name, active, sort_order, is_default)
select o.id, defaults.audience_key, defaults.name, true, defaults.sort_order, true
from public.organizations o
cross join (values
  ('INFANTIL', 'Infantil', 10),
  ('FEMININO', 'Feminino', 20),
  ('MASCULINO', 'Masculino', 30),
  ('OUTROS_SERVICOS', 'Outros Serviços', 40)
) as defaults(audience_key, name, sort_order)
on conflict (organization_id, audience_key) do nothing;

create trigger organizations_seed_catalog_audiences
after insert on public.organizations
for each row execute function public.seed_organization_catalog_audiences();

create or replace function public.manage_organization_audience(
  p_organization_id uuid,
  p_name text default null,
  p_active boolean default true,
  p_audience_key text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text;
  v_active_count integer;
begin
  if (select auth.uid()) is null or not public.is_organization_owner(p_organization_id) then
    raise exception using errcode = '42501', message = 'organization owner required';
  end if;
  perform 1 from public.organizations where id = p_organization_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'organization not found';
  end if;
  if not public.organization_allows_management_mutations(p_organization_id) then
    raise exception using errcode = '42501', message = 'organization access does not allow settings changes';
  end if;

  if p_audience_key is null then
    if p_name is null or char_length(btrim(p_name)) not between 2 and 60 then
      raise exception using errcode = '22023', message = 'audience name must contain between 2 and 60 characters';
    end if;
    v_key := 'CUSTOM_' || replace(gen_random_uuid()::text, '-', '');
    insert into public.organization_audiences (organization_id, audience_key, name, active, sort_order, is_default)
    values (
      p_organization_id,
      v_key,
      btrim(p_name),
      true,
      coalesce((select max(sort_order) + 10 from public.organization_audiences where organization_id = p_organization_id), 10),
      false
    );
    return v_key;
  end if;

  perform 1 from public.organization_audiences
  where organization_id = p_organization_id and audience_key = p_audience_key
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'organization audience not found';
  end if;
  if coalesce(p_active, true) = false then
    select count(*) into v_active_count from public.organization_audiences
    where organization_id = p_organization_id and active;
    if v_active_count <= 1 then
      raise exception using errcode = '22023', message = 'at least one active audience is required';
    end if;
  end if;
  update public.organization_audiences
  set active = coalesce(p_active, true)
  where organization_id = p_organization_id and audience_key = p_audience_key;
  return p_audience_key;
end;
$$;

revoke all on function public.manage_organization_audience(uuid, text, boolean, text) from public, anon, authenticated;
grant execute on function public.manage_organization_audience(uuid, text, boolean, text) to authenticated;

alter table public.services drop constraint if exists services_audiences_valid;
alter table public.packages drop constraint if exists packages_audiences_valid;

create or replace function public.validate_organization_catalog_audiences()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_table_name = 'services'
     and coalesce(to_jsonb(new)->>'availability', 'CLIENT') = 'INTERNAL'
     and coalesce(cardinality(new.audiences), 0) = 0 then
    return new;
  end if;
  if new.audiences is null or cardinality(new.audiences) = 0 then
    raise exception using errcode = '22023', message = 'catalog item requires at least one active audience';
  end if;
  if cardinality(new.audiences) <> (select count(distinct audience_key) from unnest(new.audiences) as requested(audience_key)) then
    raise exception using errcode = '22023', message = 'catalog item audiences cannot contain duplicates';
  end if;
  if exists (
    select 1 from unnest(new.audiences) as requested(audience_key)
    where not exists (
      select 1 from public.organization_audiences a
      where a.organization_id = new.organization_id
        and a.audience_key = requested.audience_key
        and a.active
    )
  ) then
    raise exception using errcode = '22023', message = 'catalog item audiences must be active in its organization';
  end if;
  return new;
end;
$$;

drop trigger if exists services_validate_organization_audiences on public.services;
create trigger services_validate_organization_audiences
before insert or update of audiences on public.services
for each row execute function public.validate_organization_catalog_audiences();

drop trigger if exists packages_validate_organization_audiences on public.packages;
create trigger packages_validate_organization_audiences
before insert or update of audiences on public.packages
for each row execute function public.validate_organization_catalog_audiences();

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
set search_path = ''
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
     or cardinality(p_audiences) <> (select count(distinct audience_key) from unnest(p_audiences) as requested(audience_key))
     or exists (
       select 1 from unnest(p_audiences) as requested(audience_key)
       where not exists (select 1 from public.organization_audiences a where a.organization_id = p_organization_id and a.audience_key = requested.audience_key and a.active)
     ) then
    raise exception using errcode = '22023', message = 'package requires at least one active audience from its organization';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 1 and 50 then
    raise exception using errcode = '22023', message = 'package requires between 1 and 50 items';
  end if;
  if exists (select 1 from jsonb_array_elements(p_items) as entries(item) where jsonb_typeof(item) <> 'object') then
    raise exception using errcode = '22023', message = 'invalid package item';
  end if;
  select count(*)::integer into v_item_count
  from jsonb_array_elements(p_items) as entries(item)
  join public.services s on s.id = (item ->> 'service_id')::uuid and s.organization_id = p_organization_id and s.active
  where coalesce((item ->> 'quantity')::integer, 1) between 1 and 20;
  if v_item_count <> jsonb_array_length(p_items)
     or (select count(distinct item ->> 'service_id') from jsonb_array_elements(p_items) as entries(item)) <> jsonb_array_length(p_items) then
    raise exception using errcode = '22023', message = 'package items must reference distinct active tenant services';
  end if;
  if coalesce(p_accepts_subscription, false) and exists (
    select 1 from jsonb_array_elements(p_items) as entries(item)
    join public.services s on s.id = (item ->> 'service_id')::uuid and s.organization_id = p_organization_id
    where not s.accepts_subscription
  ) then
    raise exception using errcode = '22023', message = 'package subscription requires every included service to accept subscription';
  end if;
  if coalesce(p_accepts_online_payment, false) and exists (
    select 1 from jsonb_array_elements(p_items) as entries(item)
    join public.services s on s.id = (item ->> 'service_id')::uuid and s.organization_id = p_organization_id
    where not s.accepts_online_payment
  ) then
    raise exception using errcode = '22023', message = 'package online payment requires every included service to accept online payment';
  end if;
  if p_package_id is null then
    insert into public.packages (organization_id, name, description, price_cents, active, sort_order, audiences, accepts_subscription, accepts_online_payment)
    values (p_organization_id, btrim(p_name), nullif(btrim(p_description), ''), p_price_cents, coalesce(p_active, true), coalesce(p_sort_order, 0), p_audiences, coalesce(p_accepts_subscription, false), coalesce(p_accepts_online_payment, false))
    returning id into v_package_id;
  else
    select id into strict v_package_id from public.packages
    where id = p_package_id and organization_id = p_organization_id for update;
    update public.packages set name = btrim(p_name), description = nullif(btrim(p_description), ''), price_cents = p_price_cents,
      active = coalesce(p_active, active), sort_order = coalesce(p_sort_order, sort_order), audiences = p_audiences,
      accepts_subscription = coalesce(p_accepts_subscription, false), accepts_online_payment = coalesce(p_accepts_online_payment, false)
    where id = v_package_id and organization_id = p_organization_id;
    update public.package_items set active = false where package_id = v_package_id and organization_id = p_organization_id and active;
  end if;
  insert into public.package_items (organization_id, package_id, service_id, quantity, position)
  select p_organization_id, v_package_id, (item ->> 'service_id')::uuid, coalesce((item ->> 'quantity')::smallint, 1), (ordinality - 1)::smallint
  from jsonb_array_elements(p_items) with ordinality as entries(item, ordinality)
  order by ordinality;
  return v_package_id;
exception when no_data_found then
  raise exception using errcode = 'P0002', message = 'tenant package not found';
end;
$$;

revoke all on function public.save_package_with_items_v2(uuid, uuid, text, text, bigint, boolean, integer, text[], jsonb, boolean, boolean) from public, anon, authenticated, service_role;
grant execute on function public.save_package_with_items_v2(uuid, uuid, text, text, bigint, boolean, integer, text[], jsonb, boolean, boolean) to authenticated;

create or replace function public.get_public_booking_context(p_organization_slug text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with requested_slug as (select lower(btrim(p_organization_slug)) as slug)
  select jsonb_build_object(
    'organization', jsonb_build_object(
      'id', o.id, 'name', o.name, 'slug', o.slug, 'timezone', o.timezone,
      'currency', o.currency, 'deposit_bps', o.deposit_bps,
      'cancellation_lead_minutes', o.cancellation_lead_minutes,
      'accepting_bookings', public.organization_accepts_new_bookings(o.id),
      'booking_public_id', o.booking_public_id, 'logo_path', o.logo_path,
      'public_contact_phone_e164', o.public_contact_phone_e164
    ),
    'location', (select jsonb_build_object('id', l.id, 'name', l.name, 'address', l.address) from public.locations l where l.organization_id = o.id and l.active limit 1),
    'audiences', coalesce((select jsonb_agg(jsonb_build_object('audience_key', a.audience_key, 'name', a.name, 'active', a.active, 'sort_order', a.sort_order, 'is_default', a.is_default) order by a.sort_order, a.name) from public.organization_audiences a where a.organization_id = o.id and a.active), '[]'::jsonb),
    'services', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'description', s.description, 'price_cents', s.price_cents, 'duration_minutes', s.duration_minutes,
      'audiences', array(select selected.audience_key from unnest(s.audiences) as selected(audience_key) join public.organization_audiences a on a.organization_id = s.organization_id and a.audience_key = selected.audience_key and a.active order by a.sort_order, a.name)) order by s.sort_order, s.name)
      from public.services s where s.organization_id = o.id and s.active and s.availability = 'CLIENT' and exists (select 1 from unnest(s.audiences) selected(audience_key) join public.organization_audiences a on a.organization_id = s.organization_id and a.audience_key = selected.audience_key and a.active)), '[]'::jsonb),
    'packages', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'description', p.description, 'price_cents', p.price_cents, 'duration_minutes', p.duration_minutes,
      'audiences', array(select selected.audience_key from unnest(p.audiences) as selected(audience_key) join public.organization_audiences a on a.organization_id = p.organization_id and a.audience_key = selected.audience_key and a.active order by a.sort_order, a.name),
      'items', coalesce((select jsonb_agg(jsonb_build_object('service_id', s.id, 'name', s.name, 'quantity', pi.quantity, 'duration_minutes', s.duration_minutes) order by pi.position, s.name)
        from public.package_items pi join public.services s on s.id = pi.service_id and s.organization_id = pi.organization_id
        where pi.package_id = p.id and pi.organization_id = p.organization_id and pi.active and s.active and s.availability = 'CLIENT'
          and exists (select 1 from unnest(s.audiences) selected(audience_key) join public.organization_audiences a on a.organization_id = s.organization_id and a.audience_key = selected.audience_key and a.active)), '[]'::jsonb)) order by p.sort_order, p.name)
      from public.packages p where p.organization_id = o.id and p.active
        and exists (select 1 from unnest(p.audiences) selected(audience_key) join public.organization_audiences a on a.organization_id = p.organization_id and a.audience_key = selected.audience_key and a.active)
        and exists (select 1 from public.package_items pi join public.services s on s.id = pi.service_id and s.organization_id = pi.organization_id
          where pi.package_id = p.id and pi.organization_id = p.organization_id and pi.active and s.active and s.availability = 'CLIENT'
            and exists (select 1 from unnest(s.audiences) selected(audience_key) join public.organization_audiences a on a.organization_id = s.organization_id and a.audience_key = selected.audience_key and a.active))), '[]'::jsonb),
    'barbers', coalesce((select jsonb_agg(jsonb_build_object(
      'id', b.id, 'name', b.display_name, 'bio', b.bio, 'avatar_url', b.avatar_url,
      'service_ids', coalesce((select jsonb_agg(bs.service_id order by bs.service_id) from public.barber_services bs join public.services s on s.id = bs.service_id and s.organization_id = bs.organization_id
        where bs.organization_id = b.organization_id and bs.barber_id = b.id and bs.active and s.active and s.availability = 'CLIENT'), '[]'::jsonb),
      'package_ids', coalesce((select jsonb_agg(bp.package_id order by bp.package_id) from public.barber_packages bp where bp.organization_id = b.organization_id and bp.barber_id = b.id and bp.active), '[]'::jsonb),
      'subscription_plan_ids', coalesce((select jsonb_agg(bsp.plan_id order by bsp.plan_id) from public.barber_subscription_plans bsp where bsp.organization_id = b.organization_id and bsp.barber_id = b.id and bsp.active), '[]'::jsonb)
    ) order by b.display_name) from public.barbers b where b.organization_id = o.id and b.active), '[]'::jsonb)
  ) from public.organizations o cross join requested_slug r
  left join public.organization_slug_aliases a on a.organization_id = o.id and a.slug = r.slug
  where o.slug = r.slug or a.slug is not null;
$$;

revoke all on function public.get_public_booking_context(text) from public;
grant execute on function public.get_public_booking_context(text) to anon, authenticated;

commit;
