-- Vincula o gestor da barbearia ao App do Barbeiro e à equipe.
-- A linha do gestor permanece tenant-scoped e recebe acesso integral.

alter table public.barbers
  add column if not exists is_manager boolean not null default false;

create index if not exists barbers_manager_per_organization_idx
  on public.barbers (organization_id, is_manager)
  where is_manager;

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

  if auth.uid() is not null and not exists (
    select 1
    from public.organization_memberships membership
    where membership.organization_id = p_organization_id
      and membership.user_id = auth.uid()
      and membership.role = 'OWNER'
      and membership.active
  ) then
    raise exception using errcode = '42501', message = 'organization owner required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text || ':' || p_user_id::text, 0));

  select l.id
    into v_location_id
  from public.locations l
  where l.organization_id = p_organization_id
    and l.active
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

  select b.id
    into v_barber_id
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

create or replace function public.ensure_owner_barber_on_barber_membership()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.role = 'OWNER' and new.active then
    perform public.ensure_owner_barber_profile(new.organization_id, new.user_id);
  end if;
  return new;
end;
$$;

revoke all on function public.ensure_owner_barber_on_barber_membership() from public, anon, authenticated;

drop trigger if exists organization_membership_owner_barber on public.organization_memberships;
create trigger organization_membership_owner_barber
after insert on public.organization_memberships
for each row execute function public.ensure_owner_barber_on_barber_membership();

do $$
declare
  membership record;
begin
  for membership in
    select organization_id, user_id
    from public.organization_memberships
    where role = 'OWNER' and active
  loop
    perform public.ensure_owner_barber_profile(membership.organization_id, membership.user_id);
  end loop;
end;
$$;

comment on column public.barbers.is_manager is
  'Gestor titular da organização; recebe acesso integral ao App do Barbeiro e não pode perder o vínculo de login.';

create or replace function public.grant_owner_barber_financial_account()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.active then
    insert into public.barber_financial_account_permissions (
      organization_id, barber_id, financial_account_id, active
    )
    select new.organization_id, b.id, new.id, true
    from public.barbers b
    where b.organization_id = new.organization_id
      and b.is_manager
      and b.active
    on conflict (barber_id, financial_account_id)
    do update set active = true, updated_at = now();
  end if;
  return new;
end;
$$;

revoke all on function public.grant_owner_barber_financial_account() from public, anon, authenticated;

drop trigger if exists financial_account_owner_barber_access on public.financial_accounts;
create trigger financial_account_owner_barber_access
after insert or update of active on public.financial_accounts
for each row execute function public.grant_owner_barber_financial_account();
