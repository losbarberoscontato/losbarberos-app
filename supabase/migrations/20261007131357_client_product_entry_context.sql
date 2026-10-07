-- Identidade pública mínima para a entrada do cliente. A associação ao produto
-- vem da organização, nunca de parâmetros fornecidos pelo navegador.
create or replace function public.get_public_client_entry_context(
  p_booking_public_id uuid default null,
  p_organization_slug text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_booking_organization_id uuid;
  v_slug_organization_id uuid;
  v_slug text := lower(btrim(p_organization_slug));
  v_organization_id uuid;
  v_result jsonb;
begin
  if p_booking_public_id is null and nullif(v_slug, '') is null then
    raise exception using errcode = '22023', message = 'client entry identifier required';
  end if;
  if p_organization_slug is not null
     and (v_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$') then
    raise exception using errcode = '22023', message = 'invalid organization slug';
  end if;

  if p_booking_public_id is not null then
    select o.id into v_booking_organization_id
    from public.organizations o
    where o.booking_public_id = p_booking_public_id;
  end if;
  if p_organization_slug is not null then
    select o.id into v_slug_organization_id
    from public.organizations o
    where o.slug = v_slug
       or exists (
         select 1 from public.organization_slug_aliases a
         where a.organization_id = o.id and a.slug = v_slug
       );
  end if;

  if p_booking_public_id is not null and p_organization_slug is not null
     and (v_booking_organization_id is null or v_slug_organization_id is null
          or v_booking_organization_id <> v_slug_organization_id) then
    raise exception using errcode = '22023', message = 'client entry identifiers conflict';
  end if;
  v_organization_id := coalesce(v_booking_organization_id, v_slug_organization_id);
  if v_organization_id is null then return null; end if;

  select jsonb_build_object(
    'organization_id', o.id,
    'organization_slug', o.slug,
    'organization_name', o.name,
    'logo_path', o.logo_path,
    'product_key', a.product_key
  ) into v_result
  from public.organizations o
  left join public.organization_product_assignments a on a.organization_id = o.id
  where o.id = v_organization_id;
  return v_result;
end;
$$;

revoke all on function public.get_public_client_entry_context(uuid, text) from public, anon, authenticated;
grant execute on function public.get_public_client_entry_context(uuid, text) to anon, authenticated;

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
      'product_key', a.product_key,
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
    left join public.organization_product_assignments a on a.organization_id = o.id
    where c.auth_user_id = v_user_id
      and c.active
      and c.merged_into_customer_id is null
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.list_my_client_organizations() from public, anon;
grant execute on function public.list_my_client_organizations() to authenticated;
notify pgrst, 'reload schema';
