-- Default physical-cash account. Tenant account rows remain organization-scoped.

alter table public.financial_accounts
  add column description text check (description is null or char_length(btrim(description)) between 2 and 500);

create table public.default_financial_account_templates (
  code text primary key,
  kind public.financial_account_kind not null,
  name text not null,
  opening_balance_cents bigint not null default 0,
  bank_code text,
  branch text,
  account_number text,
  description text not null
);

alter table public.default_financial_account_templates enable row level security;
revoke all on table public.default_financial_account_templates from public, anon, authenticated;

insert into public.default_financial_account_templates (code, kind, name, opening_balance_cents, bank_code, branch, account_number, description)
values ('CASH_PHYSICAL', 'CASH', 'Caixa Físico', 0, '0', '1', '0', 'Caixa físico para recebimento à vista em dinheiro físico.')
on conflict (code) do update set kind = excluded.kind, name = excluded.name, opening_balance_cents = excluded.opening_balance_cents, bank_code = excluded.bank_code, branch = excluded.branch, account_number = excluded.account_number, description = excluded.description;

create or replace function public.seed_default_financial_accounts(p_organization_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_inserted integer := 0;
  v_cash_account_id uuid;
begin
  if p_organization_id is null or not exists (select 1 from public.organizations where id = p_organization_id) then
    raise exception using errcode = 'P0002', message = 'organization not found';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text, 202608090003));

  insert into public.financial_accounts (organization_id, kind, name, opening_balance_cents, bank_code, branch, account_number, description)
  select p_organization_id, template.kind, template.name, template.opening_balance_cents, template.bank_code, template.branch, template.account_number, template.description
  from public.default_financial_account_templates template
  where template.code = 'CASH_PHYSICAL'
    and not exists (
      select 1 from public.financial_accounts account
      where account.organization_id = p_organization_id and account.name = template.name
    );
  get diagnostics v_inserted = row_count;

  select id into v_cash_account_id
  from public.financial_accounts
  where organization_id = p_organization_id and name = 'Caixa Físico' and active
  order by created_at
  limit 1;

  if v_cash_account_id is not null then
    insert into public.payment_account_mappings (organization_id, provider, payment_mode, financial_account_id)
    values (p_organization_id, 'MANUAL', 'COUNTER', v_cash_account_id)
    on conflict (organization_id, provider, payment_mode) do nothing;
  end if;

  return v_inserted;
end;
$$;

create or replace function public.seed_default_financial_accounts_on_organization_insert()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.seed_default_financial_accounts(new.id);
  return new;
end;
$$;

create trigger organizations_seed_default_financial_accounts
after insert on public.organizations
for each row execute function public.seed_default_financial_accounts_on_organization_insert();

do $$
declare v_organization_id uuid;
begin
  for v_organization_id in select id from public.organizations loop
    perform public.seed_default_financial_accounts(v_organization_id);
  end loop;
end;
$$;

drop function public.save_financial_account(uuid, uuid, public.financial_account_kind, text, bigint, text, text, text);

create function public.save_financial_account(
  p_organization_id uuid, p_id uuid, p_kind public.financial_account_kind, p_name text, p_opening_balance_cents bigint,
  p_bank_code text default null, p_branch text default null, p_account_number text default null, p_description text default null
) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_org uuid; v_id uuid;
begin
  if p_id is null then
    v_org := p_organization_id;
    if v_org is null then raise exception using errcode = '22023', message = 'organization id is required'; end if;
    perform public.require_financial_owner(v_org, 'financial account mutations');
    insert into public.financial_accounts (organization_id, kind, name, opening_balance_cents, bank_code, branch, account_number, description, created_by)
    values (v_org, p_kind, btrim(p_name), p_opening_balance_cents, nullif(btrim(p_bank_code), ''), nullif(btrim(p_branch), ''), nullif(btrim(p_account_number), ''), nullif(btrim(p_description), ''), auth.uid()) returning id into v_id;
  else
    select organization_id into strict v_org from public.financial_accounts where id = p_id for update;
    if v_org <> p_organization_id then raise exception using errcode = '42501', message = 'organization access denied'; end if;
    perform public.require_financial_owner(v_org, 'financial account mutations');
    if exists (select 1 from public.financial_settlements where financial_account_id = p_id)
       or exists (select 1 from public.financial_transfers where source_financial_account_id = p_id or destination_financial_account_id = p_id)
       or exists (select 1 from public.payment_account_mappings where financial_account_id = p_id) then
      if p_opening_balance_cents <> (select opening_balance_cents from public.financial_accounts where id = p_id) then
        raise exception using errcode = '22023', message = 'opening balance is immutable after movements exist';
      end if;
    end if;
    update public.financial_accounts set kind = p_kind, name = btrim(p_name), bank_code = nullif(btrim(p_bank_code), ''), branch = nullif(btrim(p_branch), ''), account_number = nullif(btrim(p_account_number), ''), description = nullif(btrim(p_description), '') where id = p_id;
    v_id := p_id;
  end if;
  return v_id;
exception when no_data_found then raise exception using errcode = 'P0002', message = 'financial account not found'; end;
$$;

grant execute on function public.save_financial_account(uuid, uuid, public.financial_account_kind, text, bigint, text, text, text, text) to authenticated;
revoke all on function public.seed_default_financial_accounts(uuid) from public, anon, authenticated;
revoke all on function public.seed_default_financial_accounts_on_organization_insert() from public, anon, authenticated;
