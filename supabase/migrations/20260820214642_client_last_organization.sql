alter table public.client_accounts
  add column if not exists last_organization_id uuid
  references public.organizations(id) on delete set null;

update public.client_accounts ca
set last_organization_id = (
  select c.organization_id
  from public.customers c
  where c.auth_user_id = ca.auth_user_id
    and c.active
    and c.merged_into_customer_id is null
  order by c.created_at desc, c.id desc
  limit 1
)
where ca.last_organization_id is null;

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
      'is_last', o.id = ca.last_organization_id,
      'location', coalesce((
        select jsonb_build_object('name', l.name, 'address', l.address)
        from public.locations l
        where l.organization_id = o.id and l.active
        order by l.created_at, l.id
        limit 1
      ), jsonb_build_object('name', 'Unidade', 'address', '{}'::jsonb))
    ) order by (o.id = ca.last_organization_id) desc, o.name, o.id)
    from public.customers c
    join public.organizations o on o.id = c.organization_id
    join public.client_accounts ca on ca.auth_user_id = v_user_id
    where c.auth_user_id = v_user_id
      and c.active
      and c.merged_into_customer_id is null
  ), '[]'::jsonb);
end;
$$;

create or replace function public.set_my_last_client_organization(
  p_organization_slug text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_organization public.organizations%rowtype;
begin
  if v_user_id is null then
    raise exception using errcode = '28000', message = 'authentication required';
  end if;

  select o.* into v_organization
  from public.customers c
  join public.organizations o on o.id = c.organization_id
  where c.auth_user_id = v_user_id
    and c.active
    and c.merged_into_customer_id is null
    and o.slug = lower(btrim(p_organization_slug))
  limit 1;

  if not found then
    raise exception using errcode = '42501', message = 'client organization not linked';
  end if;

  update public.client_accounts
  set last_organization_id = v_organization.id,
      updated_at = now()
  where auth_user_id = v_user_id;

  return jsonb_build_object(
    'organization_id', v_organization.id,
    'organization_slug', v_organization.slug
  );
end;
$$;

revoke all on function public.list_my_client_organizations() from public, anon;
grant execute on function public.list_my_client_organizations() to authenticated;
revoke all on function public.set_my_last_client_organization(text) from public, anon;
grant execute on function public.set_my_last_client_organization(text) to authenticated;
notify pgrst, 'reload schema';
