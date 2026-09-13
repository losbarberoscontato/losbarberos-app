-- A trigger runs as a security definer and is already restricted to the
-- owner-membership event. Do not require auth.uid() inside this internal path:
-- authenticated test/setup sessions may carry a different JWT subject while
-- creating tenant fixtures. Direct execution remains revoked.
create or replace function public.ensure_owner_barber_profile(
  p_organization_id uuid,
  p_user_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_location_id uuid;
  v_email text;
  v_display_name text;
  v_avatar_url text;
  v_barber_id uuid;
begin
  if p_organization_id is null or p_user_id is null then
    return null;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text || ':' || p_user_id::text, 0));

  select l.id into v_location_id
  from public.locations l
  where l.organization_id = p_organization_id and l.active
  order by l.created_at
  limit 1;

  if v_location_id is null then
    return null;
  end if;

  select lower(u.email), p.display_name, p.avatar_url
    into v_email, v_display_name, v_avatar_url
  from auth.users u
  left join public.profiles p on p.id = u.id
  where u.id = p_user_id;

  v_display_name := coalesce(
    nullif(btrim(v_display_name), ''),
    nullif(btrim(split_part(coalesce(v_email, ''), '@', 1)), ''),
    'Administrador'
  );

  select b.id into v_barber_id
  from public.barbers b
  where b.organization_id = p_organization_id
    and (b.auth_user_id = p_user_id or (v_email is not null and lower(b.login_email) = v_email))
  order by (b.auth_user_id = p_user_id) desc, b.created_at
  limit 1;

  if v_barber_id is not null then
    update public.barbers
    set auth_user_id = p_user_id,
        login_email = coalesce(v_email, login_email),
        is_manager = true,
        active = true,
        app_access_enabled = true,
        agenda_access_scope = 'FULL',
        cash_access_enabled = true,
        updated_at = now()
    where id = v_barber_id and organization_id = p_organization_id;

    insert into public.barber_financial_account_permissions (
      organization_id, barber_id, financial_account_id, active, created_by
    )
    select p_organization_id, v_barber_id, account.id, true, p_user_id
    from public.financial_accounts account
    where account.organization_id = p_organization_id and account.active
    on conflict (barber_id, financial_account_id)
    do update set active = true, updated_at = now();

    insert into public.barber_services (organization_id, barber_id, service_id, active)
    select p_organization_id, v_barber_id, service.id, true
    from public.services service
    where service.organization_id = p_organization_id and service.active
    on conflict (barber_id, service_id)
    do update set active = true;
    return v_barber_id;
  end if;

  insert into public.barbers (
    organization_id, location_id, display_name, avatar_url, active,
    login_email, auth_user_id, app_access_enabled, agenda_access_scope,
    cash_access_enabled, is_manager
  ) values (
    p_organization_id, v_location_id, v_display_name, v_avatar_url, true,
    v_email, p_user_id, true, 'FULL', true, true
  )
  returning id into v_barber_id;

  insert into public.barber_financial_account_permissions (
    organization_id, barber_id, financial_account_id, active, created_by
  )
  select p_organization_id, v_barber_id, account.id, true, p_user_id
  from public.financial_accounts account
  where account.organization_id = p_organization_id and account.active
  on conflict (barber_id, financial_account_id)
  do update set active = true, updated_at = now();

  insert into public.barber_services (organization_id, barber_id, service_id, active)
  select p_organization_id, v_barber_id, service.id, true
  from public.services service
  where service.organization_id = p_organization_id and service.active
  on conflict (barber_id, service_id)
  do update set active = true;

  return v_barber_id;
end;
$$;

revoke all on function public.ensure_owner_barber_profile(uuid, uuid) from public, anon, authenticated;
