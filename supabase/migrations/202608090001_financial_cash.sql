-- Los Barberos: auditable tenant-safe cash control. Existing appointment and commission ledgers remain authoritative.

create type public.financial_account_kind as enum ('BANK', 'CASH');
create type public.financial_entry_kind as enum ('REVENUE', 'EXPENSE');
create type public.financial_entry_status as enum ('OPEN', 'PARTIAL', 'SETTLED', 'OVERDUE', 'CANCELED');
create type public.financial_counterparty_kind as enum ('CUSTOMER', 'SUPPLIER');
create type public.financial_settlement_kind as enum ('SETTLEMENT', 'REVERSAL');
create type public.financial_payment_method as enum ('PIX', 'CARD', 'CASH', 'BOLETO', 'TRANSFER', 'OTHER');
create type public.financial_source as enum ('MANUAL', 'APPOINTMENT');
create type public.supplier_person_kind as enum ('INDIVIDUAL', 'COMPANY');

create table public.financial_accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  kind public.financial_account_kind not null,
  name text not null check (char_length(btrim(name)) between 2 and 120),
  bank_code text,
  branch text,
  account_number text,
  opening_balance_cents bigint not null default 0,
  active boolean not null default true,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  unique nulls not distinct (organization_id, name, active)
);

create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  person_kind public.supplier_person_kind not null default 'COMPANY',
  name text not null check (char_length(btrim(name)) between 2 and 160),
  document text,
  phone_e164 text check (phone_e164 is null or phone_e164 ~ '^\\+[1-9][0-9]{7,14}$'),
  email text,
  address jsonb not null default '{}'::jsonb check (jsonb_typeof(address) = 'object'),
  notes text,
  active boolean not null default true,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id)
);
create unique index suppliers_document_active_unique
  on public.suppliers (organization_id, document) where document is not null and active;

create table public.chart_of_accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  parent_id uuid,
  code text,
  name text not null check (char_length(btrim(name)) between 2 and 120),
  kind public.financial_entry_kind not null,
  active boolean not null default true,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  unique nulls not distinct (organization_id, code),
  foreign key (parent_id, organization_id) references public.chart_of_accounts(id, organization_id),
  check (parent_id is null or parent_id <> id)
);

create table public.cost_centers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 2 and 120),
  active boolean not null default true,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  unique nulls not distinct (organization_id, name, active)
);

create table public.financial_tags (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 2 and 60),
  color text check (color is null or color ~ '^#[0-9A-Fa-f]{6}$'),
  active boolean not null default true,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  unique nulls not distinct (organization_id, name, active)
);

create table public.financial_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  kind public.financial_entry_kind not null,
  source public.financial_source not null default 'MANUAL',
  description text not null check (char_length(btrim(description)) between 2 and 500),
  issue_date date not null default current_date,
  due_date date not null,
  total_cents bigint not null check (total_cents > 0),
  currency char(3) not null default 'BRL' check (currency = upper(currency)),
  chart_account_id uuid not null,
  cost_center_id uuid,
  preferred_financial_account_id uuid,
  counterparty_kind public.financial_counterparty_kind,
  customer_id uuid,
  supplier_id uuid,
  document_number text,
  appointment_id uuid,
  canceled_at timestamptz,
  cancellation_reason text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (chart_account_id, organization_id) references public.chart_of_accounts(id, organization_id),
  foreign key (cost_center_id, organization_id) references public.cost_centers(id, organization_id),
  foreign key (preferred_financial_account_id, organization_id) references public.financial_accounts(id, organization_id),
  foreign key (customer_id, organization_id) references public.customers(id, organization_id),
  foreign key (supplier_id, organization_id) references public.suppliers(id, organization_id),
  foreign key (appointment_id, organization_id) references public.appointments(id, organization_id),
  check (due_date >= issue_date),
  check ((counterparty_kind = 'CUSTOMER' and customer_id is not null and supplier_id is null)
      or (counterparty_kind = 'SUPPLIER' and supplier_id is not null and customer_id is null)
      or (counterparty_kind is null and customer_id is null and supplier_id is null)),
  check ((source = 'APPOINTMENT' and appointment_id is not null) or (source = 'MANUAL' and appointment_id is null)),
  check ((canceled_at is null and cancellation_reason is null)
      or (canceled_at is not null and nullif(btrim(cancellation_reason), '') is not null))
);
create index financial_entries_list_idx on public.financial_entries (organization_id, due_date, kind) where canceled_at is null;
create index financial_entries_customer_idx on public.financial_entries (organization_id, customer_id) where customer_id is not null;
create index financial_entries_supplier_idx on public.financial_entries (organization_id, supplier_id) where supplier_id is not null;

create table public.financial_entry_tags (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  entry_id uuid not null,
  tag_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (entry_id, tag_id),
  foreign key (entry_id, organization_id) references public.financial_entries(id, organization_id) on delete cascade,
  foreign key (tag_id, organization_id) references public.financial_tags(id, organization_id)
);

create table public.financial_settlements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  entry_id uuid not null,
  financial_account_id uuid not null,
  kind public.financial_settlement_kind not null default 'SETTLEMENT',
  source_settlement_id uuid,
  amount_cents bigint not null check (amount_cents > 0),
  settled_on date not null default current_date,
  payment_method public.financial_payment_method not null,
  reference text,
  idempotency_key text not null check (nullif(btrim(idempotency_key), '') is not null),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (id, organization_id),
  unique (organization_id, idempotency_key),
  foreign key (entry_id, organization_id) references public.financial_entries(id, organization_id),
  foreign key (financial_account_id, organization_id) references public.financial_accounts(id, organization_id),
  foreign key (source_settlement_id, organization_id) references public.financial_settlements(id, organization_id),
  check ((kind = 'SETTLEMENT' and source_settlement_id is null)
      or (kind = 'REVERSAL' and source_settlement_id is not null))
);
create index financial_settlements_entry_idx on public.financial_settlements (organization_id, entry_id, settled_on);
create index financial_settlements_account_idx on public.financial_settlements (organization_id, financial_account_id, settled_on);

create table public.financial_transfers (
  id uuid primary key default gen_random_uuid(),
  transfer_group_id uuid not null default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  source_financial_account_id uuid not null,
  destination_financial_account_id uuid not null,
  amount_cents bigint not null check (amount_cents > 0),
  transferred_on date not null default current_date,
  description text not null check (char_length(btrim(description)) between 2 and 500),
  reference text,
  idempotency_key text not null check (nullif(btrim(idempotency_key), '') is not null),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (id, organization_id),
  unique (organization_id, idempotency_key),
  foreign key (source_financial_account_id, organization_id) references public.financial_accounts(id, organization_id),
  foreign key (destination_financial_account_id, organization_id) references public.financial_accounts(id, organization_id),
  check (source_financial_account_id <> destination_financial_account_id)
);

create table public.payment_account_mappings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  provider public.payment_provider not null,
  payment_mode public.payment_mode not null,
  financial_account_id uuid not null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, provider, payment_mode),
  unique (id, organization_id),
  foreign key (financial_account_id, organization_id) references public.financial_accounts(id, organization_id),
  check (provider in ('MERCADO_PAGO', 'MANUAL'))
);

create or replace function public.prevent_financial_ledger_mutation()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  raise exception using errcode = '55000', message = 'financial ledger is append-only';
end;
$$;

create trigger financial_settlements_append_only before update or delete on public.financial_settlements
  for each row execute function public.prevent_financial_ledger_mutation();
create trigger financial_transfers_append_only before update or delete on public.financial_transfers
  for each row execute function public.prevent_financial_ledger_mutation();

do $$ declare table_name text; begin
  foreach table_name in array array['financial_accounts', 'suppliers', 'chart_of_accounts', 'cost_centers', 'financial_tags', 'financial_entries', 'financial_entry_tags', 'financial_settlements', 'financial_transfers', 'payment_account_mappings'] loop
    execute format('create trigger %I_prevent_tenant_reassignment before update on public.%I for each row execute function public.prevent_tenant_reassignment()', table_name, table_name);
  end loop;
  foreach table_name in array array['financial_accounts', 'suppliers', 'chart_of_accounts', 'cost_centers', 'financial_tags', 'financial_entries', 'payment_account_mappings'] loop
    execute format('create trigger %I_set_updated_at before update on public.%I for each row execute function public.set_updated_at()', table_name, table_name);
  end loop;
end $$;

alter table public.financial_accounts enable row level security;
alter table public.suppliers enable row level security;
alter table public.chart_of_accounts enable row level security;
alter table public.cost_centers enable row level security;
alter table public.financial_tags enable row level security;
alter table public.financial_entries enable row level security;
alter table public.financial_entry_tags enable row level security;
alter table public.financial_settlements enable row level security;
alter table public.financial_transfers enable row level security;
alter table public.payment_account_mappings enable row level security;

do $$ declare table_name text; begin
  foreach table_name in array array['financial_accounts', 'suppliers', 'chart_of_accounts', 'cost_centers', 'financial_tags', 'financial_entries', 'financial_entry_tags', 'financial_settlements', 'financial_transfers', 'payment_account_mappings'] loop
    execute format('create policy %I_owner_select on public.%I for select to authenticated using (public.is_organization_owner(organization_id))', table_name, table_name);
  end loop;
end $$;

grant select on public.financial_accounts, public.suppliers, public.chart_of_accounts,
  public.cost_centers, public.financial_tags, public.financial_entries,
  public.financial_entry_tags, public.financial_settlements, public.financial_transfers,
  public.payment_account_mappings to authenticated;

create or replace view public.financial_entry_summary
with (security_invoker = true) as
with settlement_totals as (
  select organization_id, entry_id,
    coalesce(sum(case when kind = 'SETTLEMENT' then amount_cents else -amount_cents end), 0)::bigint as settled_cents
  from public.financial_settlements
  group by organization_id, entry_id
)
select e.*, coalesce(st.settled_cents, 0)::bigint as settled_cents,
  greatest(e.total_cents - coalesce(st.settled_cents, 0), 0)::bigint as remaining_cents,
  case
    when e.canceled_at is not null then 'CANCELED'::public.financial_entry_status
    when coalesce(st.settled_cents, 0) >= e.total_cents then 'SETTLED'::public.financial_entry_status
    when coalesce(st.settled_cents, 0) > 0 then 'PARTIAL'::public.financial_entry_status
    when e.due_date < current_date then 'OVERDUE'::public.financial_entry_status
    else 'OPEN'::public.financial_entry_status
  end as status
from public.financial_entries e
left join settlement_totals st on st.organization_id = e.organization_id and st.entry_id = e.id;

create or replace view public.appointment_cash_activity
with (security_invoker = true) as
select t.id as payment_transaction_id, t.organization_id, t.appointment_id,
  a.customer_id, a.payment_mode, t.provider, t.kind, t.amount_cents, t.currency,
  t.occurred_at, m.financial_account_id,
  (m.financial_account_id is null) as needs_reconciliation,
  case when t.kind in ('CAPTURE', 'ADJUSTMENT') then t.amount_cents else -t.amount_cents end::bigint as signed_cents
from public.payment_transactions t
join public.appointments a on a.id = t.appointment_id and a.organization_id = t.organization_id
left join public.payment_account_mappings m on m.organization_id = t.organization_id
  and m.provider = t.provider and m.payment_mode = a.payment_mode;

create or replace view public.financial_account_balances
with (security_invoker = true) as
with movements as (
  select s.organization_id, s.financial_account_id,
    case
      when e.kind = 'REVENUE' and s.kind = 'SETTLEMENT' then s.amount_cents
      when e.kind = 'REVENUE' and s.kind = 'REVERSAL' then -s.amount_cents
      when e.kind = 'EXPENSE' and s.kind = 'SETTLEMENT' then -s.amount_cents
      else s.amount_cents
    end::bigint as signed_cents
  from public.financial_settlements s
  join public.financial_entries e on e.id = s.entry_id and e.organization_id = s.organization_id
  union all
  select organization_id, financial_account_id, signed_cents
  from public.appointment_cash_activity where financial_account_id is not null
  union all
  select organization_id, source_financial_account_id, -amount_cents::bigint from public.financial_transfers
  union all
  select organization_id, destination_financial_account_id, amount_cents::bigint from public.financial_transfers
)
select a.organization_id, a.id as financial_account_id, a.opening_balance_cents,
  coalesce(sum(m.signed_cents), 0)::bigint as movement_cents,
  (a.opening_balance_cents + coalesce(sum(m.signed_cents), 0))::bigint as balance_cents
from public.financial_accounts a
left join movements m on m.organization_id = a.organization_id and m.financial_account_id = a.id
group by a.organization_id, a.id, a.opening_balance_cents;

grant select on public.financial_entry_summary, public.appointment_cash_activity,
  public.financial_account_balances to authenticated;

create or replace function public.require_financial_owner(p_organization_id uuid, p_operation text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.is_organization_owner(p_organization_id) then
    raise exception using errcode = '42501', message = 'organization owner required';
  end if;
  if not public.organization_allows_existing_operations(p_organization_id) then
    raise exception using errcode = '42501', message = 'organization access does not allow ' || p_operation;
  end if;
end;
$$;

create or replace function public.save_financial_account(
  p_organization_id uuid, p_id uuid, p_kind public.financial_account_kind, p_name text, p_opening_balance_cents bigint,
  p_bank_code text default null, p_branch text default null, p_account_number text default null
) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_org uuid; v_id uuid;
begin
  if nullif(btrim(p_name), '') is null or p_opening_balance_cents is null then
    raise exception using errcode = '22023', message = 'financial account name and opening balance are required';
  end if;
  if p_id is null then
    v_org := p_organization_id;
    if v_org is null then raise exception using errcode = '22023', message = 'organization id is required'; end if;
    perform public.require_financial_owner(v_org, 'financial account mutations');
    insert into public.financial_accounts (organization_id, kind, name, opening_balance_cents, bank_code, branch, account_number, created_by)
    values (v_org, p_kind, btrim(p_name), p_opening_balance_cents, nullif(btrim(p_bank_code), ''), nullif(btrim(p_branch), ''), nullif(btrim(p_account_number), ''), auth.uid()) returning id into v_id;
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
    update public.financial_accounts set kind = p_kind, name = btrim(p_name), bank_code = nullif(btrim(p_bank_code), ''), branch = nullif(btrim(p_branch), ''), account_number = nullif(btrim(p_account_number), '') where id = p_id;
    v_id := p_id;
  end if;
  return v_id;
end; $$;

create or replace function public.save_supplier(
  p_organization_id uuid, p_id uuid, p_person_kind public.supplier_person_kind, p_name text, p_document text default null,
  p_phone_e164 text default null, p_email text default null, p_address jsonb default '{}'::jsonb, p_notes text default null
) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_org uuid; v_id uuid;
begin
  if nullif(btrim(p_name), '') is null or jsonb_typeof(coalesce(p_address, '{}'::jsonb)) <> 'object' then raise exception using errcode = '22023', message = 'valid supplier name and address are required'; end if;
  if p_id is null then
    v_org := p_organization_id;
    if v_org is null then raise exception using errcode = '22023', message = 'organization id is required'; end if;
    perform public.require_financial_owner(v_org, 'supplier mutations');
    insert into public.suppliers (organization_id, person_kind, name, document, phone_e164, email, address, notes, created_by)
    values (v_org, p_person_kind, btrim(p_name), nullif(btrim(p_document), ''), nullif(btrim(p_phone_e164), ''), nullif(btrim(p_email), ''), coalesce(p_address, '{}'::jsonb), nullif(btrim(p_notes), ''), auth.uid()) returning id into v_id;
  else
    select organization_id into strict v_org from public.suppliers where id = p_id for update; if v_org <> p_organization_id then raise exception using errcode = '42501', message = 'organization access denied'; end if; perform public.require_financial_owner(v_org, 'supplier mutations');
    update public.suppliers set person_kind = p_person_kind, name = btrim(p_name), document = nullif(btrim(p_document), ''), phone_e164 = nullif(btrim(p_phone_e164), ''), email = nullif(btrim(p_email), ''), address = coalesce(p_address, '{}'::jsonb), notes = nullif(btrim(p_notes), '') where id = p_id; v_id := p_id;
  end if;
  return v_id;
end; $$;

create or replace function public.save_chart_of_account(p_organization_id uuid, p_id uuid, p_parent_id uuid, p_code text, p_name text, p_kind public.financial_entry_kind)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_org uuid; v_id uuid;
begin
  if nullif(btrim(p_name), '') is null then raise exception using errcode = '22023', message = 'chart account name is required'; end if;
  if p_id is null then v_org := p_organization_id; else select organization_id into strict v_org from public.chart_of_accounts where id = p_id for update; if v_org <> p_organization_id then raise exception using errcode = '42501', message = 'organization access denied'; end if; end if;
  if v_org is null then raise exception using errcode = '42501', message = 'organization owner required'; end if; perform public.require_financial_owner(v_org, 'chart account mutations');
  if p_parent_id is not null and not exists (select 1 from public.chart_of_accounts where id = p_parent_id and organization_id = v_org and kind = p_kind) then raise exception using errcode = '22023', message = 'parent chart account must belong to this organization and kind'; end if;
  if p_id is null then insert into public.chart_of_accounts (organization_id, parent_id, code, name, kind, created_by) values (v_org, p_parent_id, nullif(btrim(p_code), ''), btrim(p_name), p_kind, auth.uid()) returning id into v_id;
  else update public.chart_of_accounts set parent_id = p_parent_id, code = nullif(btrim(p_code), ''), name = btrim(p_name), kind = p_kind where id = p_id; v_id := p_id; end if;
  return v_id;
end; $$;

create or replace function public.save_cost_center(p_organization_id uuid, p_id uuid, p_name text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_org uuid; v_id uuid;
begin
  if nullif(btrim(p_name), '') is null then raise exception using errcode = '22023', message = 'cost center name is required'; end if;
  if p_id is null then v_org := p_organization_id; else select organization_id into strict v_org from public.cost_centers where id = p_id for update; if v_org <> p_organization_id then raise exception using errcode = '42501', message = 'organization access denied'; end if; end if;
  if v_org is null then raise exception using errcode = '42501', message = 'organization owner required'; end if; perform public.require_financial_owner(v_org, 'cost center mutations');
  if p_id is null then insert into public.cost_centers (organization_id, name, created_by) values (v_org, btrim(p_name), auth.uid()) returning id into v_id; else update public.cost_centers set name = btrim(p_name) where id = p_id; v_id := p_id; end if;
  return v_id;
end; $$;

create or replace function public.save_financial_tag(p_organization_id uuid, p_id uuid, p_name text, p_color text default null)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_org uuid; v_id uuid;
begin
  if nullif(btrim(p_name), '') is null then raise exception using errcode = '22023', message = 'tag name is required'; end if;
  if p_id is null then v_org := p_organization_id; else select organization_id into strict v_org from public.financial_tags where id = p_id for update; if v_org <> p_organization_id then raise exception using errcode = '42501', message = 'organization access denied'; end if; end if;
  if v_org is null then raise exception using errcode = '42501', message = 'organization owner required'; end if; perform public.require_financial_owner(v_org, 'tag mutations');
  if p_id is null then insert into public.financial_tags (organization_id, name, color, created_by) values (v_org, btrim(p_name), nullif(btrim(p_color), ''), auth.uid()) returning id into v_id; else update public.financial_tags set name = btrim(p_name), color = nullif(btrim(p_color), '') where id = p_id; v_id := p_id; end if;
  return v_id;
end; $$;

create or replace function public.set_financial_catalog_active(p_catalog text, p_id uuid, p_active boolean)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_org uuid; v_used boolean := false;
begin
  if p_catalog = 'ACCOUNT' then select organization_id into strict v_org from public.financial_accounts where id = p_id for update;
  elsif p_catalog = 'SUPPLIER' then select organization_id into strict v_org from public.suppliers where id = p_id for update;
  elsif p_catalog = 'CHART_ACCOUNT' then select organization_id into strict v_org from public.chart_of_accounts where id = p_id for update;
  elsif p_catalog = 'COST_CENTER' then select organization_id into strict v_org from public.cost_centers where id = p_id for update;
  elsif p_catalog = 'TAG' then select organization_id into strict v_org from public.financial_tags where id = p_id for update;
  else raise exception using errcode = '22023', message = 'invalid financial catalog'; end if;
  perform public.require_financial_owner(v_org, 'financial catalog mutations');
  if p_active then
    if p_catalog = 'ACCOUNT' then update public.financial_accounts set active = true where id = p_id;
    elsif p_catalog = 'SUPPLIER' then update public.suppliers set active = true where id = p_id;
    elsif p_catalog = 'CHART_ACCOUNT' then update public.chart_of_accounts set active = true where id = p_id;
    elsif p_catalog = 'COST_CENTER' then update public.cost_centers set active = true where id = p_id;
    else update public.financial_tags set active = true where id = p_id; end if;
  else
    select exists (select 1 from public.financial_entries e where e.organization_id = v_org and (e.chart_account_id = p_id or e.cost_center_id = p_id or e.preferred_financial_account_id = p_id or e.supplier_id = p_id)) into v_used;
    if p_catalog = 'TAG' then select v_used or exists (select 1 from public.financial_entry_tags where organization_id = v_org and tag_id = p_id) into v_used; end if;
    if p_catalog = 'ACCOUNT' then select v_used or exists (select 1 from public.financial_settlements where organization_id = v_org and financial_account_id = p_id) or exists (select 1 from public.financial_transfers where organization_id = v_org and (source_financial_account_id = p_id or destination_financial_account_id = p_id)) into v_used; end if;
    if p_catalog = 'ACCOUNT' then update public.financial_accounts set active = false where id = p_id;
    elsif p_catalog = 'SUPPLIER' then update public.suppliers set active = false where id = p_id;
    elsif p_catalog = 'CHART_ACCOUNT' then update public.chart_of_accounts set active = false where id = p_id;
    elsif p_catalog = 'COST_CENTER' then update public.cost_centers set active = false where id = p_id;
    else update public.financial_tags set active = false where id = p_id; end if;
  end if;
exception when no_data_found then raise exception using errcode = 'P0002', message = 'financial catalog item not found'; end; $$;

create or replace function public.create_financial_entry(
  p_organization_id uuid, p_kind public.financial_entry_kind, p_description text, p_issue_date date, p_due_date date, p_total_cents bigint,
  p_chart_account_id uuid, p_cost_center_id uuid default null, p_preferred_financial_account_id uuid default null,
  p_counterparty_kind public.financial_counterparty_kind default null, p_customer_id uuid default null, p_supplier_id uuid default null,
  p_document_number text default null, p_tag_ids uuid[] default '{}'::uuid[]
) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_org uuid; v_id uuid;
begin
  v_org := p_organization_id;
  if v_org is null then raise exception using errcode = '22023', message = 'organization id is required'; end if; perform public.require_financial_owner(v_org, 'financial entry mutations');
  if nullif(btrim(p_description), '') is null or p_total_cents <= 0 or p_due_date < p_issue_date then raise exception using errcode = '22023', message = 'valid financial entry fields are required'; end if;
  if not exists (select 1 from public.chart_of_accounts where id = p_chart_account_id and organization_id = v_org and kind = p_kind and active) then raise exception using errcode = '22023', message = 'active chart account of matching kind is required'; end if;
  if p_cost_center_id is not null and not exists (select 1 from public.cost_centers where id = p_cost_center_id and organization_id = v_org and active) then raise exception using errcode = '22023', message = 'active cost center is required'; end if;
  if p_preferred_financial_account_id is not null and not exists (select 1 from public.financial_accounts where id = p_preferred_financial_account_id and organization_id = v_org and active) then raise exception using errcode = '22023', message = 'active financial account is required'; end if;
  if p_counterparty_kind = 'CUSTOMER' and not exists (select 1 from public.customers where id = p_customer_id and organization_id = v_org) then raise exception using errcode = '22023', message = 'customer must belong to this organization'; end if;
  if p_counterparty_kind = 'SUPPLIER' and not exists (select 1 from public.suppliers where id = p_supplier_id and organization_id = v_org and active) then raise exception using errcode = '22023', message = 'active supplier is required'; end if;
  if (p_counterparty_kind = 'CUSTOMER' and p_supplier_id is not null) or (p_counterparty_kind = 'SUPPLIER' and p_customer_id is not null) or (p_counterparty_kind is null and (p_customer_id is not null or p_supplier_id is not null)) then raise exception using errcode = '22023', message = 'counterparty kind and record must match'; end if;
  if exists (select 1 from unnest(coalesce(p_tag_ids, '{}'::uuid[])) t where not exists (select 1 from public.financial_tags ft where ft.id = t and ft.organization_id = v_org and ft.active)) then raise exception using errcode = '22023', message = 'all tags must be active and tenant scoped'; end if;
  insert into public.financial_entries (organization_id, kind, description, issue_date, due_date, total_cents, chart_account_id, cost_center_id, preferred_financial_account_id, counterparty_kind, customer_id, supplier_id, document_number, created_by)
  values (v_org, p_kind, btrim(p_description), p_issue_date, p_due_date, p_total_cents, p_chart_account_id, p_cost_center_id, p_preferred_financial_account_id, p_counterparty_kind, p_customer_id, p_supplier_id, nullif(btrim(p_document_number), ''), auth.uid()) returning id into v_id;
  insert into public.financial_entry_tags (organization_id, entry_id, tag_id) select v_org, v_id, tag_id from unnest(coalesce(p_tag_ids, '{}'::uuid[])) as tag_id;
  return v_id;
end; $$;

create or replace function public.update_financial_entry(
  p_entry_id uuid, p_description text, p_issue_date date, p_due_date date, p_total_cents bigint,
  p_chart_account_id uuid, p_cost_center_id uuid default null, p_preferred_financial_account_id uuid default null,
  p_counterparty_kind public.financial_counterparty_kind default null, p_customer_id uuid default null, p_supplier_id uuid default null,
  p_document_number text default null, p_tag_ids uuid[] default '{}'::uuid[]
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_entry public.financial_entries%rowtype;
begin
  select * into strict v_entry from public.financial_entries where id = p_entry_id for update; perform public.require_financial_owner(v_entry.organization_id, 'financial entry mutations');
  if v_entry.canceled_at is not null or exists (select 1 from public.financial_settlements where entry_id = v_entry.id) then raise exception using errcode = '22023', message = 'only open financial entries can be edited'; end if;
  if nullif(btrim(p_description), '') is null or p_total_cents <= 0 or p_due_date < p_issue_date then raise exception using errcode = '22023', message = 'valid financial entry fields are required'; end if;
  if not exists (select 1 from public.chart_of_accounts where id = p_chart_account_id and organization_id = v_entry.organization_id and kind = v_entry.kind and active) then raise exception using errcode = '22023', message = 'active chart account of matching kind is required'; end if;
  update public.financial_entries set description = btrim(p_description), issue_date = p_issue_date, due_date = p_due_date, total_cents = p_total_cents, chart_account_id = p_chart_account_id, cost_center_id = p_cost_center_id, preferred_financial_account_id = p_preferred_financial_account_id, counterparty_kind = p_counterparty_kind, customer_id = p_customer_id, supplier_id = p_supplier_id, document_number = nullif(btrim(p_document_number), '') where id = v_entry.id;
  delete from public.financial_entry_tags where entry_id = v_entry.id;
  insert into public.financial_entry_tags (organization_id, entry_id, tag_id) select v_entry.organization_id, v_entry.id, tag_id from unnest(coalesce(p_tag_ids, '{}'::uuid[])) as tag_id;
end; $$;

create or replace function public.cancel_financial_entry(p_entry_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_entry public.financial_entries%rowtype;
begin
  select * into strict v_entry from public.financial_entries where id = p_entry_id for update; perform public.require_financial_owner(v_entry.organization_id, 'financial entry cancellation');
  if nullif(btrim(p_reason), '') is null then raise exception using errcode = '22023', message = 'cancellation reason is required'; end if;
  if v_entry.canceled_at is not null then return; end if;
  if exists (select 1 from public.financial_settlements where entry_id = v_entry.id) then raise exception using errcode = '22023', message = 'settled financial entry requires reversal'; end if;
  update public.financial_entries set canceled_at = now(), cancellation_reason = left(btrim(p_reason), 500) where id = v_entry.id;
exception when no_data_found then raise exception using errcode = 'P0002', message = 'financial entry not found'; end; $$;

create or replace function public.settle_financial_entry(
  p_entry_id uuid, p_financial_account_id uuid, p_amount_cents bigint, p_settled_on date,
  p_payment_method public.financial_payment_method, p_reference text, p_idempotency_key text
) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_entry public.financial_entries%rowtype; v_existing public.financial_settlements%rowtype; v_settled bigint; v_id uuid;
begin
  if p_amount_cents <= 0 or nullif(btrim(p_idempotency_key), '') is null then raise exception using errcode = '22023', message = 'positive amount and idempotency key is required'; end if;
  select * into strict v_entry from public.financial_entries where id = p_entry_id for update; perform public.require_financial_owner(v_entry.organization_id, 'financial settlement');
  if v_entry.canceled_at is not null then raise exception using errcode = '22023', message = 'canceled financial entry cannot be settled'; end if;
  select * into v_existing from public.financial_settlements where organization_id = v_entry.organization_id and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.entry_id <> v_entry.id or v_existing.financial_account_id <> p_financial_account_id or v_existing.amount_cents <> p_amount_cents or v_existing.kind <> 'SETTLEMENT' then raise exception using errcode = '22023', message = 'idempotency key belongs to another settlement'; end if;
    return v_existing.id;
  end if;
  if not exists (select 1 from public.financial_accounts where id = p_financial_account_id and organization_id = v_entry.organization_id and active) then raise exception using errcode = '22023', message = 'active financial account is required'; end if;
  select coalesce(sum(case when kind = 'SETTLEMENT' then amount_cents else -amount_cents end), 0)::bigint into v_settled from public.financial_settlements where entry_id = v_entry.id;
  if p_amount_cents > v_entry.total_cents - v_settled then raise exception using errcode = '22023', message = 'settlement exceeds remaining balance'; end if;
  insert into public.financial_settlements (organization_id, entry_id, financial_account_id, amount_cents, settled_on, payment_method, reference, idempotency_key, created_by)
  values (v_entry.organization_id, v_entry.id, p_financial_account_id, p_amount_cents, p_settled_on, p_payment_method, nullif(btrim(p_reference), ''), p_idempotency_key, auth.uid()) returning id into v_id;
  return v_id;
exception when no_data_found then raise exception using errcode = 'P0002', message = 'financial entry not found'; end; $$;

create or replace function public.reverse_financial_settlement(p_settlement_id uuid, p_amount_cents bigint, p_reason text, p_idempotency_key text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_source public.financial_settlements%rowtype; v_reversed bigint; v_existing public.financial_settlements%rowtype; v_id uuid;
begin
  if p_amount_cents <= 0 or nullif(btrim(p_reason), '') is null or nullif(btrim(p_idempotency_key), '') is null then raise exception using errcode = '22023', message = 'positive amount, reason and idempotency key is required'; end if;
  select * into strict v_source from public.financial_settlements where id = p_settlement_id for update; perform public.require_financial_owner(v_source.organization_id, 'financial settlement reversal');
  if v_source.kind <> 'SETTLEMENT' then raise exception using errcode = '22023', message = 'only settlement can be reversed'; end if;
  select * into v_existing from public.financial_settlements where organization_id = v_source.organization_id and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.source_settlement_id <> v_source.id or v_existing.amount_cents <> p_amount_cents or v_existing.kind <> 'REVERSAL' then raise exception using errcode = '22023', message = 'idempotency key belongs to another reversal'; end if;
    return v_existing.id;
  end if;
  select coalesce(sum(amount_cents), 0)::bigint into v_reversed from public.financial_settlements where source_settlement_id = v_source.id and kind = 'REVERSAL';
  if p_amount_cents > v_source.amount_cents - v_reversed then raise exception using errcode = '22023', message = 'reversal exceeds settled amount'; end if;
  insert into public.financial_settlements (organization_id, entry_id, financial_account_id, kind, source_settlement_id, amount_cents, settled_on, payment_method, reference, idempotency_key, created_by)
  values (v_source.organization_id, v_source.entry_id, v_source.financial_account_id, 'REVERSAL', v_source.id, p_amount_cents, current_date, v_source.payment_method, left(btrim(p_reason), 500), p_idempotency_key, auth.uid()) returning id into v_id;
  return v_id;
exception when no_data_found then raise exception using errcode = 'P0002', message = 'financial settlement not found'; end; $$;

create or replace function public.create_financial_transfer(
  p_source_financial_account_id uuid, p_destination_financial_account_id uuid, p_amount_cents bigint,
  p_transferred_on date, p_description text, p_reference text, p_idempotency_key text
) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_org uuid; v_existing public.financial_transfers%rowtype; v_id uuid;
begin
  if p_source_financial_account_id = p_destination_financial_account_id or p_amount_cents <= 0 or nullif(btrim(p_description), '') is null or nullif(btrim(p_idempotency_key), '') is null then raise exception using errcode = '22023', message = 'valid transfer fields and idempotency key are required'; end if;
  select organization_id into strict v_org from public.financial_accounts where id = p_source_financial_account_id and active for update;
  perform public.require_financial_owner(v_org, 'financial transfer');
  if not exists (select 1 from public.financial_accounts where id = p_destination_financial_account_id and organization_id = v_org and active) then raise exception using errcode = '22023', message = 'destination account must be active and tenant scoped'; end if;
  select * into v_existing from public.financial_transfers where organization_id = v_org and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.source_financial_account_id <> p_source_financial_account_id or v_existing.destination_financial_account_id <> p_destination_financial_account_id or v_existing.amount_cents <> p_amount_cents then raise exception using errcode = '22023', message = 'idempotency key belongs to another transfer'; end if;
    return v_existing.id;
  end if;
  insert into public.financial_transfers (organization_id, source_financial_account_id, destination_financial_account_id, amount_cents, transferred_on, description, reference, idempotency_key, created_by)
  values (v_org, p_source_financial_account_id, p_destination_financial_account_id, p_amount_cents, p_transferred_on, btrim(p_description), nullif(btrim(p_reference), ''), p_idempotency_key, auth.uid()) returning id into v_id;
  return v_id;
exception when no_data_found then raise exception using errcode = 'P0002', message = 'source financial account not found'; end; $$;

create or replace function public.configure_payment_account_mapping(p_provider public.payment_provider, p_payment_mode public.payment_mode, p_financial_account_id uuid)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_org uuid; v_id uuid;
begin
  if p_provider not in ('MERCADO_PAGO', 'MANUAL') then raise exception using errcode = '22023', message = 'unsupported payment provider mapping'; end if;
  select organization_id into strict v_org from public.financial_accounts where id = p_financial_account_id and active; perform public.require_financial_owner(v_org, 'payment account mapping');
  insert into public.payment_account_mappings (organization_id, provider, payment_mode, financial_account_id, created_by)
  values (v_org, p_provider, p_payment_mode, p_financial_account_id, auth.uid())
  on conflict (organization_id, provider, payment_mode) do update set financial_account_id = excluded.financial_account_id, created_by = excluded.created_by
  returning id into v_id;
  return v_id;
exception when no_data_found then raise exception using errcode = 'P0002', message = 'active financial account not found'; end; $$;

create or replace function public.reverse_appointment_cash_receipt(p_payment_transaction_id uuid, p_reference text, p_idempotency_key text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_transaction public.payment_transactions%rowtype;
begin
  select * into strict v_transaction from public.payment_transactions where id = p_payment_transaction_id for update;
  perform public.require_financial_owner(v_transaction.organization_id, 'appointment receipt reversal');
  if v_transaction.kind not in ('CAPTURE', 'ADJUSTMENT') then raise exception using errcode = '22023', message = 'only captured appointment receipt can be reversed'; end if;
  if v_transaction.provider <> 'MANUAL' then raise exception using errcode = '22023', message = 'online payment refund must be initiated in provider flow'; end if;
  return public.record_manual_refund(v_transaction.appointment_id, v_transaction.amount_cents, p_reference, p_idempotency_key);
exception when no_data_found then raise exception using errcode = 'P0002', message = 'appointment payment transaction not found'; end; $$;

grant execute on function public.save_financial_account(uuid, uuid, public.financial_account_kind, text, bigint, text, text, text),
  public.save_supplier(uuid, uuid, public.supplier_person_kind, text, text, text, text, jsonb, text),
  public.save_chart_of_account(uuid, uuid, uuid, text, text, public.financial_entry_kind),
  public.save_cost_center(uuid, uuid, text), public.save_financial_tag(uuid, uuid, text, text),
  public.set_financial_catalog_active(text, uuid, boolean),
  public.create_financial_entry(uuid, public.financial_entry_kind, text, date, date, bigint, uuid, uuid, uuid, public.financial_counterparty_kind, uuid, uuid, text, uuid[]),
  public.update_financial_entry(uuid, text, date, date, bigint, uuid, uuid, uuid, public.financial_counterparty_kind, uuid, uuid, text, uuid[]),
  public.cancel_financial_entry(uuid, text),
  public.settle_financial_entry(uuid, uuid, bigint, date, public.financial_payment_method, text, text),
  public.reverse_financial_settlement(uuid, bigint, text, text),
  public.create_financial_transfer(uuid, uuid, bigint, date, text, text, text),
  public.configure_payment_account_mapping(public.payment_provider, public.payment_mode, uuid),
  public.reverse_appointment_cash_receipt(uuid, text, text)
to authenticated;
