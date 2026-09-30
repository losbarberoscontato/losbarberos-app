-- ProStetic onboarding must be an allowed product in the shared atomic RPC.
-- Also switch published and draft branding to the transparent ProStetic logo.
create or replace function public.onboard_organization(
  p_name text,
  p_slug text,
  p_location_name text,
  p_timezone text default 'America/Sao_Paulo',
  p_product_key text default 'los-barberos'
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_organization_id uuid;
  v_location_id uuid;
begin
  if v_user_id is null then
    raise exception using errcode = '28000', message = 'authentication required';
  end if;
  if p_product_key not in ('los-barberos', 'le-gras', 'pro-stetic', 'music-pro') then
    raise exception using errcode = '22023', message = 'unsupported product';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text, 0));
  if exists (
    select 1
    from public.organization_memberships m
    join public.organization_product_assignments a using (organization_id)
    where m.user_id = v_user_id
      and m.active
      and m.role = 'OWNER'
      and a.product_key = p_product_key
  ) then
    raise exception using errcode = '23514',
      message = 'user already owns an active organization for this product';
  end if;
  if not exists (select 1 from pg_timezone_names where name = p_timezone) then
    raise exception using errcode = '22023', message = 'invalid IANA timezone';
  end if;

  insert into public.profiles (id) values (v_user_id) on conflict (id) do nothing;
  insert into public.organizations (name, slug, timezone, created_by)
  values (btrim(p_name), lower(btrim(p_slug)), p_timezone, v_user_id)
  returning id into v_organization_id;
  insert into public.locations (organization_id, name)
  values (v_organization_id, btrim(p_location_name))
  returning id into v_location_id;
  insert into public.organization_memberships (organization_id, user_id, role)
  values (v_organization_id, v_user_id, 'OWNER');
  insert into public.saas_subscriptions (organization_id, status)
  values (v_organization_id, 'PROVISIONING');
  insert into public.organization_product_assignments (organization_id, product_key)
  values (v_organization_id, p_product_key);
  insert into public.organization_access_events (
    organization_id, to_status, reason, actor_user_id
  ) values (
    v_organization_id, 'PROVISIONING', 'organization_onboarded', v_user_id
  );
  insert into public.audit_events (
    organization_id, actor_user_id, actor_kind, action, entity_type, entity_id
  ) values (
    v_organization_id, v_user_id, 'USER', 'organization.onboarded',
    'organization', v_organization_id::text
  );

  return jsonb_build_object(
    'organization_id', v_organization_id,
    'location_id', v_location_id,
    'subscription_status', 'PROVISIONING',
    'product_key', p_product_key
  );
exception
  when unique_violation then
    raise exception using errcode = '23505', message = 'organization slug already exists';
end;
$$;

revoke all on function public.onboard_organization(text, text, text, text, text) from public, anon, service_role;
grant execute on function public.onboard_organization(text, text, text, text, text) to authenticated;

update public.platform_product_identities
set config = jsonb_set(config, '{brand,logoUrl}', to_jsonb('/display-sh/pro-stetic-transparent.png'::text), true),
    revision = revision + 1,
    published_at = now()
where product_key = 'pro-stetic';

update public.platform_product_identity_drafts
set config = jsonb_set(config, '{brand,logoUrl}', to_jsonb('/display-sh/pro-stetic-transparent.png'::text), true),
    updated_at = now()
where product_key = 'pro-stetic';
