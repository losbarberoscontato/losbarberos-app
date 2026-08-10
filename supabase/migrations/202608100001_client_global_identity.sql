-- Los Barberos: global client identity, explicit tenant links and safe claims.
-- Client accounts are global but operational customers remain tenant-scoped.

create table public.client_accounts (
  auth_user_id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null check (char_length(btrim(full_name)) between 2 and 160),
  phone_e164 text not null check (phone_e164 ~ '^\\+[1-9][0-9]{7,14}$'),
  phone_verified_at timestamptz,
  birth_date date,
  terms_policy_version text not null check (char_length(btrim(terms_policy_version)) between 1 and 120),
  terms_accepted_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Only a phone confirmed by Supabase Auth can be used as an identity candidate.
create unique index client_accounts_verified_phone_unique
  on public.client_accounts (phone_e164)
  where phone_verified_at is not null;

create table public.customer_link_reviews (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  candidate_customer_id uuid not null,
  requester_auth_user_id uuid not null references auth.users(id) on delete cascade,
  reason text not null check (char_length(btrim(reason)) between 1 and 500),
  status text not null default 'OPEN'
    check (status in ('OPEN', 'APPROVED', 'REJECTED')),
  resolved_by uuid references auth.users(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (candidate_customer_id, organization_id)
    references public.customers(id, organization_id) on delete cascade,
  check (
    (status = 'OPEN' and resolved_by is null and resolved_at is null)
    or (status in ('APPROVED', 'REJECTED') and resolved_at is not null)
  )
);

create unique index customer_link_reviews_one_open_candidate
  on public.customer_link_reviews (
    organization_id, candidate_customer_id, requester_auth_user_id
  ) where status = 'OPEN';

create or replace function public.set_client_account_phone_verification()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_phone text;
  v_phone_confirmed_at timestamptz;
begin
  select u.phone, u.phone_confirmed_at
    into v_phone, v_phone_confirmed_at
  from auth.users u
  where u.id = new.auth_user_id;

  if v_phone_confirmed_at is not null
     and nullif(btrim(v_phone), '') = new.phone_e164 then
    new.phone_verified_at := v_phone_confirmed_at;
  else
    new.phone_verified_at := null;
  end if;

  return new;
end;
$$;

create or replace function public.protect_linked_customer_canonical_fields()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_account public.client_accounts%rowtype;
  v_email text;
begin
  if old.auth_user_id is null
     or (
       new.auth_user_id is not distinct from old.auth_user_id
       and new.full_name is not distinct from old.full_name
       and new.phone_e164 is not distinct from old.phone_e164
       and new.email is not distinct from old.email
       and new.birth_date is not distinct from old.birth_date
     ) then
    return new;
  end if;

  if coalesce(auth.role(), '') = 'service_role' or public.is_platform_admin() then
    return new;
  end if;

  select * into strict v_account
  from public.client_accounts ca
  where ca.auth_user_id = old.auth_user_id;

  select nullif(btrim(u.email), '') into v_email
  from auth.users u
  where u.id = old.auth_user_id;

  if new.auth_user_id is distinct from old.auth_user_id
     or new.full_name is distinct from v_account.full_name
     or new.phone_e164 is distinct from v_account.phone_e164
     or new.email is distinct from v_email
     or new.birth_date is distinct from v_account.birth_date then
    raise exception using
      errcode = '42501',
      message = 'linked customer canonical fields are client-controlled';
  end if;

  return new;
end;
$$;

create or replace function public.sync_client_account_to_linked_customers()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_email text;
begin
  select nullif(btrim(u.email), '') into v_email
  from auth.users u
  where u.id = new.auth_user_id;

  update public.customers c
  set full_name = new.full_name,
      phone_e164 = new.phone_e164,
      email = v_email,
      birth_date = new.birth_date
  where c.auth_user_id = new.auth_user_id
    and (
      c.full_name is distinct from new.full_name
      or c.phone_e164 is distinct from new.phone_e164
      or c.email is distinct from v_email
      or c.birth_date is distinct from new.birth_date
    );

  return new;
end;
$$;

create trigger client_accounts_set_phone_verification
  before insert or update of auth_user_id, phone_e164 on public.client_accounts
  for each row execute function public.set_client_account_phone_verification();

create trigger client_accounts_sync_linked_customers
  after insert or update of full_name, phone_e164, birth_date on public.client_accounts
  for each row execute function public.sync_client_account_to_linked_customers();

create trigger client_accounts_set_updated_at
  before update on public.client_accounts
  for each row execute function public.set_updated_at();

create trigger customer_link_reviews_set_updated_at
  before update on public.customer_link_reviews
  for each row execute function public.set_updated_at();

create trigger customers_protect_linked_canonical_fields
  before update on public.customers
  for each row execute function public.protect_linked_customer_canonical_fields();

alter table public.client_accounts enable row level security;
alter table public.client_accounts force row level security;
alter table public.customer_link_reviews enable row level security;
alter table public.customer_link_reviews force row level security;

create policy client_accounts_self_select on public.client_accounts
  for select to authenticated
  using (auth_user_id = auth.uid());
create policy client_accounts_self_update on public.client_accounts
  for update to authenticated
  using (auth_user_id = auth.uid())
  with check (auth_user_id = auth.uid());

create or replace function public.upsert_my_client_account(
  p_full_name text,
  p_phone_e164 text,
  p_birth_date date,
  p_terms_policy_version text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_account_id uuid;
begin
  if v_user_id is null then
    raise exception using errcode = '28000', message = 'authentication required';
  end if;
  if nullif(btrim(p_full_name), '') is null
     or nullif(btrim(p_terms_policy_version), '') is null
     or p_phone_e164 !~ '^\\+[1-9][0-9]{7,14}$' then
    raise exception using errcode = '22023', message = 'invalid client account profile';
  end if;

  insert into public.client_accounts (
    auth_user_id, full_name, phone_e164, birth_date,
    terms_policy_version, terms_accepted_at
  ) values (
    v_user_id, btrim(p_full_name), p_phone_e164, p_birth_date,
    btrim(p_terms_policy_version), now()
  )
  on conflict (auth_user_id) do update
  set full_name = excluded.full_name,
      phone_e164 = excluded.phone_e164,
      birth_date = excluded.birth_date,
      terms_policy_version = excluded.terms_policy_version,
      terms_accepted_at = case
        when public.client_accounts.terms_policy_version
          is distinct from excluded.terms_policy_version then now()
        else public.client_accounts.terms_accepted_at
      end
  returning auth_user_id into v_account_id;

  return v_account_id;
end;
$$;

create or replace function public.link_my_client_to_organization(
  p_organization_slug text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_account public.client_accounts%rowtype;
  v_organization public.organizations%rowtype;
  v_existing_customer public.customers%rowtype;
  v_candidate_ids uuid[] := '{}'::uuid[];
  v_candidate_id uuid;
  v_candidate_count integer := 0;
  v_email text;
  v_email_confirmed_at timestamptz;
  v_phone text;
  v_phone_confirmed_at timestamptz;
  v_customer_id uuid;
begin
  if v_user_id is null then
    raise exception using errcode = '28000', message = 'authentication required';
  end if;
  if nullif(btrim(p_organization_slug), '') is null then
    raise exception using errcode = '22023', message = 'organization slug required';
  end if;

  select * into strict v_account
  from public.client_accounts ca
  where ca.auth_user_id = v_user_id
  for update;

  select * into strict v_organization
  from public.organizations o
  where o.slug = btrim(p_organization_slug)
  for key share;

  if not public.organization_accepts_new_bookings(v_organization.id) then
    raise exception using errcode = '42501', message = 'organization is not accepting customer onboarding';
  end if;

  select nullif(btrim(u.email), ''), u.email_confirmed_at,
         nullif(btrim(u.phone), ''), u.phone_confirmed_at
    into v_email, v_email_confirmed_at, v_phone, v_phone_confirmed_at
  from auth.users u
  where u.id = v_user_id;

  select * into v_existing_customer
  from public.customers c
  where c.organization_id = v_organization.id
    and c.auth_user_id = v_user_id
  for update;
  if found then
    return jsonb_build_object(
      'status', 'LINKED', 'organization_id', v_organization.id,
      'organization_slug', v_organization.slug, 'customer_id', v_existing_customer.id
    );
  end if;

  -- Lock every exact verified contact candidate. Names are never candidates.
  perform 1
  from public.customers c
  where c.organization_id = v_organization.id
    and c.active
    and c.merged_into_customer_id is null
    and (
      (v_email_confirmed_at is not null and lower(c.email) = lower(v_email))
      or (
        v_account.phone_verified_at is not null
        and v_phone_confirmed_at is not null
        and c.phone_e164 = v_account.phone_e164
        and v_account.phone_e164 = v_phone
      )
    )
  for update;

  select coalesce(array_agg(c.id order by c.id), '{}'::uuid[])
    into v_candidate_ids
  from public.customers c
  where c.organization_id = v_organization.id
    and c.active
    and c.merged_into_customer_id is null
    and (
      (v_email_confirmed_at is not null and lower(c.email) = lower(v_email))
      or (
        v_account.phone_verified_at is not null
        and v_phone_confirmed_at is not null
        and c.phone_e164 = v_account.phone_e164
        and v_account.phone_e164 = v_phone
      )
    );
  v_candidate_count := cardinality(v_candidate_ids);

  if v_candidate_count = 0 then
    insert into public.customers (
      organization_id, auth_user_id, full_name, phone_e164, email, birth_date
    ) values (
      v_organization.id, v_user_id, v_account.full_name, v_account.phone_e164,
      v_email, v_account.birth_date
    ) returning id into v_customer_id;

    return jsonb_build_object(
      'status', 'LINKED', 'organization_id', v_organization.id,
      'organization_slug', v_organization.slug, 'customer_id', v_customer_id
    );
  end if;

  if v_candidate_count = 1 then
    select * into strict v_existing_customer
    from public.customers c where c.id = v_candidate_ids[1];
    if v_existing_customer.auth_user_id is null then
      return jsonb_build_object(
        'status', 'CLAIM_REQUIRED', 'organization_id', v_organization.id,
        'organization_slug', v_organization.slug, 'customer_id', v_existing_customer.id
      );
    end if;
  end if;

  foreach v_candidate_id in array v_candidate_ids loop
    insert into public.customer_link_reviews (
      organization_id, candidate_customer_id, requester_auth_user_id, reason
    ) values (
      v_organization.id, v_candidate_id, v_user_id,
      case when v_candidate_count = 1 then 'verified contact already linked to another account'
        else 'multiple verified contact candidates require review' end
    )
    on conflict (organization_id, candidate_customer_id, requester_auth_user_id)
      where status = 'OPEN'
    do update set reason = excluded.reason, updated_at = now();
  end loop;

  return jsonb_build_object(
    'status', 'REVIEW_REQUIRED', 'organization_id', v_organization.id,
    'organization_slug', v_organization.slug
  );
end;
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
  if not exists (
    select 1 from public.client_accounts ca where ca.auth_user_id = v_user_id
  ) then
    raise exception using errcode = 'P0002', message = 'client account not found';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'organization_id', o.id, 'organization_slug', o.slug,
      'organization_name', o.name, 'customer_id', c.id
    ) order by o.name, o.id)
    from public.customers c
    join public.organizations o on o.id = c.organization_id
    where c.auth_user_id = v_user_id
      and c.active
      and c.merged_into_customer_id is null
  ), '[]'::jsonb);
end;
$$;

create or replace function public.claim_my_existing_customer(
  p_organization_id uuid,
  p_customer_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_account public.client_accounts%rowtype;
  v_customer public.customers%rowtype;
  v_candidate_ids uuid[] := '{}'::uuid[];
  v_candidate_id uuid;
  v_email text;
  v_email_confirmed_at timestamptz;
  v_phone text;
  v_phone_confirmed_at timestamptz;
begin
  if v_user_id is null then
    raise exception using errcode = '28000', message = 'authentication required';
  end if;

  select * into strict v_account
  from public.client_accounts ca
  where ca.auth_user_id = v_user_id
  for update;

  if not public.organization_accepts_new_bookings(p_organization_id) then
    raise exception using errcode = '42501', message = 'organization is not accepting customer onboarding';
  end if;

  select * into strict v_customer
  from public.customers c
  where c.id = p_customer_id and c.organization_id = p_organization_id
    and c.active and c.merged_into_customer_id is null
  for update;

  if v_customer.auth_user_id = v_user_id then
    return jsonb_build_object(
      'status', 'LINKED', 'organization_id', p_organization_id,
      'customer_id', p_customer_id
    );
  end if;

  select nullif(btrim(u.email), ''), u.email_confirmed_at,
         nullif(btrim(u.phone), ''), u.phone_confirmed_at
    into v_email, v_email_confirmed_at, v_phone, v_phone_confirmed_at
  from auth.users u
  where u.id = v_user_id;

  perform 1
  from public.customers c
  where c.organization_id = p_organization_id
    and c.active
    and c.merged_into_customer_id is null
    and (
      (v_email_confirmed_at is not null and lower(c.email) = lower(v_email))
      or (
        v_account.phone_verified_at is not null
        and v_phone_confirmed_at is not null
        and c.phone_e164 = v_account.phone_e164
        and v_account.phone_e164 = v_phone
      )
    )
  for update;

  select coalesce(array_agg(c.id order by c.id), '{}'::uuid[])
    into v_candidate_ids
  from public.customers c
  where c.organization_id = p_organization_id
    and c.active
    and c.merged_into_customer_id is null
    and (
      (v_email_confirmed_at is not null and lower(c.email) = lower(v_email))
      or (
        v_account.phone_verified_at is not null
        and v_phone_confirmed_at is not null
        and c.phone_e164 = v_account.phone_e164
        and v_account.phone_e164 = v_phone
      )
    );

  if cardinality(v_candidate_ids) = 1
     and v_candidate_ids[1] = p_customer_id
     and v_customer.auth_user_id is null then
    update public.customers c
    set auth_user_id = v_user_id,
        full_name = v_account.full_name,
        phone_e164 = v_account.phone_e164,
        email = v_email,
        birth_date = v_account.birth_date
    where c.id = p_customer_id and c.organization_id = p_organization_id;

    return jsonb_build_object(
      'status', 'LINKED', 'organization_id', p_organization_id,
      'customer_id', p_customer_id
    );
  end if;

  if cardinality(v_candidate_ids) = 0 then
    v_candidate_ids := array[p_customer_id];
  end if;
  foreach v_candidate_id in array v_candidate_ids loop
    insert into public.customer_link_reviews (
      organization_id, candidate_customer_id, requester_auth_user_id, reason
    ) values (
      p_organization_id, v_candidate_id, v_user_id,
      case when v_customer.auth_user_id is not null then
        'customer is already linked to another account'
      when cardinality(v_candidate_ids) > 1 then
        'multiple verified contact candidates require review'
      else 'customer claim requires a verified contact match' end
    )
    on conflict (organization_id, candidate_customer_id, requester_auth_user_id)
      where status = 'OPEN'
    do update set reason = excluded.reason, updated_at = now();
  end loop;

  return jsonb_build_object(
    'status', 'REVIEW_REQUIRED', 'organization_id', p_organization_id,
    'customer_id', p_customer_id
  );
end;
$$;

revoke all on table public.client_accounts, public.customer_link_reviews
  from public, anon, authenticated;
grant select, update on table public.client_accounts to authenticated;

revoke all on function public.set_client_account_phone_verification()
  from public, anon, authenticated;
revoke all on function public.protect_linked_customer_canonical_fields()
  from public, anon, authenticated;
revoke all on function public.sync_client_account_to_linked_customers()
  from public, anon, authenticated;
revoke all on function public.upsert_my_client_account(text, text, date, text)
  from public, anon, authenticated;
revoke all on function public.link_my_client_to_organization(text)
  from public, anon, authenticated;
revoke all on function public.list_my_client_organizations()
  from public, anon, authenticated;
revoke all on function public.claim_my_existing_customer(uuid, uuid)
  from public, anon, authenticated;

grant execute on function public.upsert_my_client_account(text, text, date, text)
  to authenticated;
grant execute on function public.link_my_client_to_organization(text)
  to authenticated;
grant execute on function public.list_my_client_organizations()
  to authenticated;
grant execute on function public.claim_my_existing_customer(uuid, uuid)
  to authenticated;
