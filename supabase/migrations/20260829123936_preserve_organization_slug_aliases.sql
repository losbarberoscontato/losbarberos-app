begin;

create table public.organization_slug_aliases (
  slug text primary key check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  organization_id uuid references public.organizations(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.organization_slug_aliases enable row level security;
alter table public.organization_slug_aliases force row level security;
revoke all on table public.organization_slug_aliases from public, anon, authenticated;

create or replace function public.preserve_organization_slug_alias()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if exists (
    select 1
    from public.organization_slug_aliases a
    where a.slug = new.slug
      and a.organization_id is distinct from new.id
  ) then
    raise exception using errcode = '23505', message = 'organization slug is permanently reserved';
  end if;

  if tg_op = 'UPDATE' and old.slug is distinct from new.slug then
    insert into public.organization_slug_aliases (slug, organization_id)
    values (old.slug, old.id)
    on conflict (slug) do nothing;
  end if;

  return new;
end;
$$;

drop trigger if exists organizations_preserve_slug_alias on public.organizations;
create trigger organizations_preserve_slug_alias
before insert or update of slug on public.organizations
for each row execute function public.preserve_organization_slug_alias();

-- Historical rename confirmed before this migration: barbershop -> cutclub.
insert into public.organization_slug_aliases (slug, organization_id)
select 'barbershop', o.id
from public.organizations o
where o.slug = 'cutclub'
on conflict (slug) do nothing;

create or replace function public.get_public_booking_context(p_organization_slug text)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with requested_slug as (
    select lower(btrim(p_organization_slug)) as slug
  )
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
    'services', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'description', s.description, 'price_cents', s.price_cents, 'duration_minutes', s.duration_minutes, 'audiences', s.audiences) order by s.sort_order, s.name) from public.services s where s.organization_id = o.id and s.active and cardinality(s.audiences) > 0), '[]'::jsonb),
    'packages', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'description', p.description, 'price_cents', p.price_cents, 'duration_minutes', p.duration_minutes, 'audiences', p.audiences, 'items', coalesce((select jsonb_agg(jsonb_build_object('service_id', s.id, 'name', s.name, 'quantity', pi.quantity, 'duration_minutes', s.duration_minutes) order by pi.position, s.name) from public.package_items pi join public.services s on s.id = pi.service_id and s.organization_id = pi.organization_id where pi.package_id = p.id and pi.organization_id = p.organization_id and pi.active and s.active and cardinality(s.audiences) > 0), '[]'::jsonb)) order by p.sort_order, p.name) from public.packages p where p.organization_id = o.id and p.active and cardinality(p.audiences) > 0 and exists (select 1 from public.package_items pi join public.services s on s.id = pi.service_id and s.organization_id = pi.organization_id where pi.package_id = p.id and pi.organization_id = p.organization_id and pi.active and s.active and cardinality(s.audiences) > 0)), '[]'::jsonb),
    'barbers', coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'name', b.display_name, 'bio', b.bio, 'avatar_url', b.avatar_url, 'service_ids', coalesce((select jsonb_agg(bs.service_id order by bs.service_id) from public.barber_services bs join public.services s on s.id = bs.service_id and s.organization_id = bs.organization_id where bs.organization_id = b.organization_id and bs.barber_id = b.id and bs.active and s.active), '[]'::jsonb)) order by b.display_name) from public.barbers b where b.organization_id = o.id and b.active), '[]'::jsonb)
  )
  from public.organizations o
  cross join requested_slug r
  left join public.organization_slug_aliases a on a.organization_id = o.id and a.slug = r.slug
  where o.slug = r.slug or a.slug is not null;
$$;

revoke all on function public.get_public_booking_context(text) from public;
grant execute on function public.get_public_booking_context(text) to anon, authenticated;

commit;
