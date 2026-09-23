-- Cliente: CPF/CNPJ, dependentes e pessoa efetivamente atendida.
-- Mantém customer_id como titular operacional e canal de WhatsApp.

alter table public.customers
  add column if not exists cpf_cnpj text;

alter table public.client_accounts
  add column if not exists cpf_cnpj text;

alter table public.customers
  drop constraint if exists customers_cpf_cnpj_digits_check;
alter table public.customers
  add constraint customers_cpf_cnpj_digits_check
  check (cpf_cnpj is null or cpf_cnpj ~ '^[0-9]{11}$' or cpf_cnpj ~ '^[0-9]{14}$');

alter table public.client_accounts
  drop constraint if exists client_accounts_cpf_cnpj_digits_check;
alter table public.client_accounts
  add constraint client_accounts_cpf_cnpj_digits_check
  check (cpf_cnpj is null or cpf_cnpj ~ '^[0-9]{11}$' or cpf_cnpj ~ '^[0-9]{14}$');

create table if not exists public.customer_dependents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  customer_id uuid not null,
  full_name text not null check (char_length(btrim(full_name)) between 2 and 160),
  birth_date date not null,
  relationship text not null check (relationship in ('CHILD', 'SPOUSE', 'EMPLOYEE', 'PARENT', 'OTHER')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (customer_id, organization_id) references public.customers(id, organization_id) on delete cascade
);

create index if not exists customer_dependents_customer_idx
  on public.customer_dependents (organization_id, customer_id, active, full_name);

alter table public.customer_dependents enable row level security;
alter table public.customer_dependents force row level security;

create or replace function public.can_access_customer_dependents(p_organization_id uuid, p_customer_id uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select public.is_organization_owner(p_organization_id)
    or exists (
      select 1 from public.customers c
      where c.id = p_customer_id
        and c.organization_id = p_organization_id
        and c.auth_user_id = auth.uid()
    );
$$;

revoke all on function public.can_access_customer_dependents(uuid, uuid) from public, anon, authenticated;

create policy customer_dependents_select on public.customer_dependents
  for select to authenticated
  using (public.can_access_customer_dependents(organization_id, customer_id));

create policy customer_dependents_insert on public.customer_dependents
  for insert to authenticated
  with check (public.can_access_customer_dependents(organization_id, customer_id));

create policy customer_dependents_update on public.customer_dependents
  for update to authenticated
  using (public.can_access_customer_dependents(organization_id, customer_id))
  with check (public.can_access_customer_dependents(organization_id, customer_id));

create policy customer_dependents_delete on public.customer_dependents
  for delete to authenticated
  using (public.can_access_customer_dependents(organization_id, customer_id));

create or replace function public.validate_customer_dependents_limit()
returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_count integer;
begin
  if new.active then
    perform pg_advisory_xact_lock(hashtextextended('customer_dependents:' || new.organization_id::text || ':' || new.customer_id::text, 20260922215511));
    select count(*) into v_count
    from public.customer_dependents
    where organization_id = new.organization_id
      and customer_id = new.customer_id
      and active
      and id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid);
    if v_count >= 8 then
      raise exception using errcode = '22023', message = 'customer can have at most 8 dependents';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists customer_dependents_limit on public.customer_dependents;
create trigger customer_dependents_limit
  before insert or update of customer_id, organization_id, active on public.customer_dependents
  for each row execute function public.validate_customer_dependents_limit();

drop trigger if exists customer_dependents_set_updated_at on public.customer_dependents;
create trigger customer_dependents_set_updated_at
  before update on public.customer_dependents
  for each row execute function public.set_updated_at();

alter table public.appointments
  add column if not exists attendee_dependent_id uuid,
  add column if not exists attendee_name_snapshot text,
  add column if not exists attendee_relationship_snapshot text;

alter table public.appointments
  drop constraint if exists appointments_attendee_dependent_fk;
alter table public.appointments
  add constraint appointments_attendee_dependent_fk
  foreign key (attendee_dependent_id, organization_id)
  references public.customer_dependents(id, organization_id) on delete set null;

create or replace function public.resolve_customer_attendee(
  p_organization_id uuid,
  p_customer_id uuid,
  p_attendee_dependent_id uuid
)
returns table(attendee_dependent_id uuid, attendee_name text, attendee_relationship text)
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_dependent public.customer_dependents%rowtype;
begin
  if p_attendee_dependent_id is null then
    return query select null::uuid, null::text, null::text;
    return;
  end if;
  select * into strict v_dependent
  from public.customer_dependents
  where id = p_attendee_dependent_id
    and organization_id = p_organization_id
    and customer_id = p_customer_id
    and active;
  return query select v_dependent.id, v_dependent.full_name, v_dependent.relationship;
exception when no_data_found then
  raise exception using errcode = '22023', message = 'attendee dependent does not belong to customer';
end;
$$;

create or replace function public.sync_client_account_to_linked_customers()
returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_email text;
begin
  select nullif(btrim(u.email), '') into v_email from auth.users u where u.id = new.auth_user_id;
  insert into app_private.client_identity_write_context (backend_pid, transaction_id, auth_user_id, purpose)
  values (pg_backend_pid(), txid_current(), new.auth_user_id, 'SYNC')
  on conflict (backend_pid, transaction_id, auth_user_id) do update set purpose = excluded.purpose, created_at = clock_timestamp();
  update public.customers c set full_name = new.full_name, phone_e164 = new.phone_e164, email = v_email, birth_date = new.birth_date, cpf_cnpj = new.cpf_cnpj
  where c.auth_user_id = new.auth_user_id;
  delete from app_private.client_identity_write_context ctx where ctx.backend_pid = pg_backend_pid() and ctx.transaction_id = txid_current() and ctx.auth_user_id = new.auth_user_id;
  return new;
end;
$$;

drop trigger if exists client_accounts_sync_linked_customers on public.client_accounts;
create trigger client_accounts_sync_linked_customers
  after insert or update of full_name, phone_e164, birth_date, cpf_cnpj on public.client_accounts
  for each row execute function public.sync_client_account_to_linked_customers();

revoke all on function public.resolve_customer_attendee(uuid, uuid, uuid) from public, anon, authenticated;

create or replace function public.upsert_my_client_account(
  p_full_name text,
  p_phone_e164 text,
  p_birth_date date,
  p_terms_policy_version text,
  p_cpf_cnpj text default null
)
returns uuid
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_user_id uuid := auth.uid(); v_account_id uuid;
begin
  if v_user_id is null then raise exception using errcode = '42501', message = 'authentication required'; end if;
  if p_cpf_cnpj is not null and p_cpf_cnpj !~ '^[0-9]{11}$' and p_cpf_cnpj !~ '^[0-9]{14}$' then
    raise exception using errcode = '22023', message = 'invalid cpf or cnpj';
  end if;
  insert into public.client_accounts (auth_user_id, full_name, phone_e164, birth_date, cpf_cnpj, terms_policy_version, terms_accepted_at)
  values (v_user_id, btrim(p_full_name), p_phone_e164, p_birth_date, nullif(p_cpf_cnpj, ''), btrim(p_terms_policy_version), now())
  on conflict (auth_user_id) do update set
    full_name = excluded.full_name, phone_e164 = excluded.phone_e164, birth_date = excluded.birth_date,
    cpf_cnpj = excluded.cpf_cnpj, terms_policy_version = excluded.terms_policy_version,
    terms_accepted_at = case when client_accounts.terms_policy_version is distinct from excluded.terms_policy_version then now() else client_accounts.terms_accepted_at end
  returning auth_user_id into v_account_id;
  return v_account_id;
end;
$$;

revoke all on function public.upsert_my_client_account(text, text, date, text, text) from public, anon, authenticated;
grant execute on function public.upsert_my_client_account(text, text, date, text, text) to authenticated;

create or replace function public.create_customer_dependent(
  p_organization_id uuid, p_customer_id uuid, p_full_name text, p_birth_date date, p_relationship text
)
returns public.customer_dependents
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_row public.customer_dependents%rowtype;
begin
  if not public.can_access_customer_dependents(p_organization_id, p_customer_id) then raise exception using errcode = '42501', message = 'customer dependent access denied'; end if;
  insert into public.customer_dependents (organization_id, customer_id, full_name, birth_date, relationship)
  values (p_organization_id, p_customer_id, btrim(p_full_name), p_birth_date, p_relationship)
  returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.update_customer_dependent(
  p_organization_id uuid, p_dependent_id uuid, p_full_name text, p_birth_date date, p_relationship text
)
returns public.customer_dependents
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_row public.customer_dependents%rowtype;
begin
  update public.customer_dependents d set full_name = btrim(p_full_name), birth_date = p_birth_date, relationship = p_relationship, updated_at = now()
  where d.id = p_dependent_id and d.organization_id = p_organization_id
    and public.can_access_customer_dependents(d.organization_id, d.customer_id)
  returning d.* into v_row;
  if not found then raise exception using errcode = 'P0002', message = 'customer dependent not found'; end if;
  return v_row;
end;
$$;

create or replace function public.delete_customer_dependent(p_organization_id uuid, p_dependent_id uuid)
returns boolean
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  update public.customer_dependents d set active = false, updated_at = now()
  where d.id = p_dependent_id and d.organization_id = p_organization_id
    and public.can_access_customer_dependents(d.organization_id, d.customer_id);
  return found;
end;
$$;

revoke all on function public.create_customer_dependent(uuid, uuid, text, date, text), public.update_customer_dependent(uuid, uuid, text, date, text), public.delete_customer_dependent(uuid, uuid) from public, anon;
grant execute on function public.create_customer_dependent(uuid, uuid, text, date, text), public.update_customer_dependent(uuid, uuid, text, date, text), public.delete_customer_dependent(uuid, uuid) to authenticated;

create or replace function public.set_appointment_attendee(p_appointment_id uuid, p_attendee_dependent_id uuid default null)
returns boolean
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_appointment public.appointments%rowtype; v_attendee record;
begin
  select * into strict v_appointment from public.appointments where id = p_appointment_id for update;
  if not public.is_organization_owner(v_appointment.organization_id)
     and not exists (select 1 from public.customers c where c.id = v_appointment.customer_id and c.organization_id = v_appointment.organization_id and c.auth_user_id = auth.uid()) then
    raise exception using errcode = '42501', message = 'appointment attendee access denied';
  end if;
  select * into v_attendee from public.resolve_customer_attendee(v_appointment.organization_id, v_appointment.customer_id, p_attendee_dependent_id);
  update public.appointments set attendee_dependent_id = v_attendee.attendee_dependent_id, attendee_name_snapshot = v_attendee.attendee_name, attendee_relationship_snapshot = v_attendee.attendee_relationship where id = p_appointment_id;
  return true;
exception when no_data_found then
  raise exception using errcode = 'P0002', message = 'appointment not found';
end;
$$;

revoke all on function public.set_appointment_attendee(uuid, uuid) from public, anon;
grant execute on function public.set_appointment_attendee(uuid, uuid) to authenticated;
