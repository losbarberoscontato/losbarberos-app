-- Links públicos permanentes e identidade pública da organização.
-- Migration incremental: não altera queue_public_id existente.

alter table public.organizations
  add column if not exists booking_public_id uuid default gen_random_uuid(),
  add column if not exists public_contact_phone_e164 text,
  add column if not exists logo_path text;

update public.organizations
set booking_public_id = gen_random_uuid()
where booking_public_id is null;

alter table public.organizations
  alter column booking_public_id set not null;

create unique index if not exists organizations_booking_public_id_key
  on public.organizations (booking_public_id);

alter table public.organizations
  drop constraint if exists organizations_public_contact_phone_e164_check;
alter table public.organizations
  add constraint organizations_public_contact_phone_e164_check
  check (public_contact_phone_e164 is null or public_contact_phone_e164 ~ '^\+[1-9][0-9]{7,14}$');

grant update (public_contact_phone_e164, logo_path) on public.organizations to authenticated;

create or replace function public.get_public_booking_organization(p_booking_public_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'id', o.id,
    'slug', o.slug,
    'name', o.name,
    'booking_public_id', o.booking_public_id,
    'queue_public_id', o.queue_public_id,
    'public_contact_phone_e164', o.public_contact_phone_e164,
    'logo_path', o.logo_path
  )
  from public.organizations o
  where o.booking_public_id = p_booking_public_id;
$$;

create or replace function public.list_my_client_organizations()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception using errcode = '28000', message = 'authentication required';
  end if;
  if not exists (select 1 from public.client_accounts ca where ca.auth_user_id = v_user_id) then
    raise exception using errcode = 'P0002', message = 'client account not found';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'organization_id', o.id,
      'organization_slug', o.slug,
      'organization_name', o.name,
      'customer_id', c.id,
      'booking_public_id', o.booking_public_id,
      'logo_path', o.logo_path,
      'public_contact_phone_e164', o.public_contact_phone_e164,
      'location', coalesce((
        select jsonb_build_object('name', l.name, 'address', l.address)
        from public.locations l
        where l.organization_id = o.id and l.active
        order by l.created_at, l.id
        limit 1
      ), jsonb_build_object('name', 'Unidade', 'address', '{}'::jsonb))
    ) order by o.name, o.id)
    from public.customers c
    join public.organizations o on o.id = c.organization_id
    where c.auth_user_id = v_user_id
      and c.active and c.merged_into_customer_id is null
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.get_public_booking_organization(uuid) from public;
grant execute on function public.get_public_booking_organization(uuid) to anon, authenticated;
revoke all on function public.list_my_client_organizations() from public, anon;
grant execute on function public.list_my_client_organizations() to authenticated;

create or replace function public.get_public_booking_context(p_organization_slug text)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
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
    'packages', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'description', p.description, 'price_cents', p.price_cents, 'audiences', p.audiences, 'items', coalesce((select jsonb_agg(jsonb_build_object('service_id', s.id, 'name', s.name, 'quantity', pi.quantity, 'duration_minutes', s.duration_minutes) order by pi.position, s.name) from public.package_items pi join public.services s on s.id = pi.service_id and s.organization_id = pi.organization_id where pi.package_id = p.id and pi.organization_id = p.organization_id and pi.active and s.active and cardinality(s.audiences) > 0), '[]'::jsonb)) order by p.sort_order, p.name) from public.packages p where p.organization_id = o.id and p.active and cardinality(p.audiences) > 0 and exists (select 1 from public.package_items pi join public.services s on s.id = pi.service_id and s.organization_id = pi.organization_id where pi.package_id = p.id and pi.organization_id = p.organization_id and pi.active and s.active and cardinality(s.audiences) > 0)), '[]'::jsonb),
    'barbers', coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'name', b.display_name, 'bio', b.bio, 'avatar_url', b.avatar_url, 'service_ids', coalesce((select jsonb_agg(bs.service_id order by bs.service_id) from public.barber_services bs join public.services s on s.id = bs.service_id and s.organization_id = bs.organization_id where bs.organization_id = b.organization_id and bs.barber_id = b.id and bs.active and s.active), '[]'::jsonb)) order by b.display_name) from public.barbers b where b.organization_id = o.id and b.active), '[]'::jsonb)
  ) from public.organizations o where o.slug = p_organization_slug;
$$;

revoke all on function public.get_public_booking_context(text) from public;
grant execute on function public.get_public_booking_context(text) to anon, authenticated;

insert into storage.buckets (id, name, public)
values ('organization-logos', 'organization-logos', true)
on conflict (id) do update set public = true;

create policy organization_logos_public_read
  on storage.objects for select to public
  using (bucket_id = 'organization-logos');

create policy organization_logos_owner_insert
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'organization-logos'
    and (storage.foldername(name))[1] = (select om.organization_id::text from public.organization_memberships om where om.organization_id::text = (storage.foldername(name))[1] and om.user_id = auth.uid() and om.role = 'OWNER' and om.active limit 1)
  );

create policy organization_logos_owner_update
  on storage.objects for update to authenticated
  using (bucket_id = 'organization-logos' and (storage.foldername(name))[1] ~* '^[0-9a-f-]{36}$' and public.is_organization_owner((storage.foldername(name))[1]::uuid))
  with check (bucket_id = 'organization-logos' and (storage.foldername(name))[1] ~* '^[0-9a-f-]{36}$' and public.is_organization_owner((storage.foldername(name))[1]::uuid));

create policy organization_logos_owner_delete
  on storage.objects for delete to authenticated
  using (bucket_id = 'organization-logos' and (storage.foldername(name))[1] ~* '^[0-9a-f-]{36}$' and public.is_organization_owner((storage.foldername(name))[1]::uuid));

comment on column public.organizations.booking_public_id is 'Identificador público permanente do link de agendamento.';
comment on column public.organizations.logo_path is 'Caminho público da logo no bucket organization-logos.';
comment on column public.organizations.public_contact_phone_e164 is 'WhatsApp público da barbearia, separado das credenciais de provedor.';
