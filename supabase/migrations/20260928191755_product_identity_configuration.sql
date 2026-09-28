-- Configuração visual isolada por produto. Não altera tabelas ou fluxos comerciais.
create table public.platform_product_identity_drafts (
  product_key text primary key check (product_key in ('los-barberos', 'le-gras', 'pro-stetic', 'music-pro')),
  config jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  constraint platform_product_identity_drafts_object check (jsonb_typeof(config) = 'object')
);

create table public.platform_product_identities (
  product_key text primary key check (product_key in ('los-barberos', 'le-gras', 'pro-stetic', 'music-pro')),
  config jsonb not null,
  revision integer not null default 1 check (revision > 0),
  published_at timestamptz not null default now(),
  published_by uuid references auth.users(id) on delete set null,
  constraint platform_product_identities_object check (jsonb_typeof(config) = 'object')
);

alter table public.platform_product_identity_drafts enable row level security;
alter table public.platform_product_identities enable row level security;

create policy product_identity_drafts_admin_select on public.platform_product_identity_drafts
  for select to authenticated using (public.is_platform_admin());
create policy product_identity_drafts_admin_insert on public.platform_product_identity_drafts
  for insert to authenticated with check (public.is_platform_admin());
create policy product_identity_drafts_admin_update on public.platform_product_identity_drafts
  for update to authenticated using (public.is_platform_admin()) with check (public.is_platform_admin());
create policy product_identity_drafts_admin_delete on public.platform_product_identity_drafts
  for delete to authenticated using (public.is_platform_admin());

create policy product_identities_public_select on public.platform_product_identities
  for select to anon, authenticated using (true);
create policy product_identities_admin_insert on public.platform_product_identities
  for insert to authenticated with check (public.is_platform_admin());
create policy product_identities_admin_update on public.platform_product_identities
  for update to authenticated using (public.is_platform_admin()) with check (public.is_platform_admin());
create policy product_identities_admin_delete on public.platform_product_identities
  for delete to authenticated using (public.is_platform_admin());

grant select, insert, update, delete on public.platform_product_identity_drafts to authenticated;
grant select on public.platform_product_identities to anon, authenticated;
grant insert, update, delete on public.platform_product_identities to authenticated;

create or replace function public.publish_product_identity(p_product_key text)
returns integer
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_config jsonb;
  v_revision integer;
begin
  if not public.is_platform_admin() then
    raise exception 'platform admin required' using errcode = '42501';
  end if;
  select config into v_config from public.platform_product_identity_drafts
    where product_key = p_product_key for update;
  if v_config is null then
    raise exception 'identity draft not found' using errcode = 'P0002';
  end if;
  insert into public.platform_product_identities (product_key, config, revision, published_at, published_by)
  values (p_product_key, v_config, 1, now(), auth.uid())
  on conflict (product_key) do update set
    config = excluded.config,
    revision = public.platform_product_identities.revision + 1,
    published_at = excluded.published_at,
    published_by = excluded.published_by
  returning revision into v_revision;
  return v_revision;
end;
$$;
revoke all on function public.publish_product_identity(text) from public;
grant execute on function public.publish_product_identity(text) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-brand-assets', 'product-brand-assets', true, 2097152, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update set public = true, file_size_limit = 2097152,
  allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp'];
create policy product_brand_assets_public_read on storage.objects
  for select to public using (bucket_id = 'product-brand-assets');
create policy product_brand_assets_admin_insert on storage.objects
  for insert to authenticated with check (bucket_id = 'product-brand-assets' and public.is_platform_admin());
create policy product_brand_assets_admin_update on storage.objects
  for update to authenticated using (bucket_id = 'product-brand-assets' and public.is_platform_admin())
  with check (bucket_id = 'product-brand-assets' and public.is_platform_admin());
create policy product_brand_assets_admin_delete on storage.objects
  for delete to authenticated using (bucket_id = 'product-brand-assets' and public.is_platform_admin());

create table public.organization_product_assignments (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  product_key text not null check (product_key in ('los-barberos', 'le-gras', 'pro-stetic', 'music-pro')),
  assigned_at timestamptz not null default now(),
  assigned_by uuid references auth.users(id) on delete set null
);
alter table public.organization_product_assignments enable row level security;
create policy organization_product_assignments_admin_all on public.organization_product_assignments
  for all to authenticated using (public.is_platform_admin()) with check (public.is_platform_admin());
create policy organization_product_assignments_owner_select on public.organization_product_assignments
  for select to authenticated using (public.is_organization_owner(organization_id));
grant select, insert, update, delete on public.organization_product_assignments to authenticated;

insert into public.organization_product_assignments (organization_id, product_key)
select id, 'los-barberos' from public.organizations
on conflict (organization_id) do nothing;

insert into public.platform_product_identities (product_key, config) values
('los-barberos', '{"brand":{"name":"Los Barberos","tagline":"Gestão para barbearias","mark":"LB","logoUrl":"/display-sh/los-barberos.png"},"colors":{"primary":"#12352e","secondary":"#2f6b5d","accent":"#d49a55","background":"#f7f3eb","surface":"#fffefa","text":"#16211e","muted":"#697570","border":"#e4ded2","success":"#31705d","danger":"#a84545"},"fonts":{"interface":"Inter","display":"Baskerville"},"vocabulary":{"organization":"barbearia","organizationPlural":"barbearias","professional":"barbeiro","professionalPlural":"barbeiros","teamApp":"App do Barbeiro","organizationPicker":"Minhas barbearias"}}'::jsonb),
('le-gras', '{"brand":{"name":"Le Gras","tagline":"Fotografia que conta histórias","mark":"LG","logoUrl":"/display-sh/le-gras.png"},"colors":{"primary":"#29143d","secondary":"#59366f","accent":"#c8a45d","background":"#f5f0f7","surface":"#fffaff","text":"#251b2b","muted":"#756b7c","border":"#e5dce9","success":"#31705d","danger":"#a84545"},"fonts":{"interface":"Inter","display":"Baskerville"},"vocabulary":{"organization":"estúdio","organizationPlural":"estúdios","professional":"fotógrafo","professionalPlural":"fotógrafos","teamApp":"App da Equipe","organizationPicker":"Meus estúdios"}}'::jsonb),
('pro-stetic', '{"brand":{"name":"ProStetic","tagline":"Estética e beleza","mark":"PS","logoUrl":"/display-sh/pro-stetic.png"},"colors":{"primary":"#4d245f","secondary":"#805793","accent":"#c19a58","background":"#f8f2fa","surface":"#fffaff","text":"#281d2d","muted":"#766b7c","border":"#e8ddea","success":"#31705d","danger":"#a84545"},"fonts":{"interface":"Inter","display":"Baskerville"},"vocabulary":{"organization":"clínica","organizationPlural":"clínicas","professional":"profissional","professionalPlural":"profissionais","teamApp":"App da Equipe","organizationPicker":"Minhas clínicas"}}'::jsonb),
('music-pro', '{"brand":{"name":"MusicPro","tagline":"Escolas de música","mark":"MP","logoUrl":"/display-sh/music-pro.png"},"colors":{"primary":"#12352e","secondary":"#2f6b5d","accent":"#d49a55","background":"#f7f3eb","surface":"#fffefa","text":"#16211e","muted":"#697570","border":"#e4ded2","success":"#31705d","danger":"#a84545"},"fonts":{"interface":"Inter","display":"Baskerville"},"vocabulary":{"organization":"escola","organizationPlural":"escolas","professional":"professor","professionalPlural":"professores","teamApp":"App do Professor","organizationPicker":"Minhas escolas"}}'::jsonb)
on conflict (product_key) do nothing;

insert into public.platform_product_identity_drafts (product_key, config)
select product_key, config from public.platform_product_identities
on conflict (product_key) do nothing;
