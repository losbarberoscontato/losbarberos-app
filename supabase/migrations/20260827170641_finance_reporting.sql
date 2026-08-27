-- Los Barberos: additive management-finance reporting layer.
-- Existing payment_transactions, financial_entries, financial_settlements and
-- commission_ledger remain source-of-truth. Facts below are read-only unions.

create type public.financial_dre_group as enum (
  'GROSS_REVENUE', 'REVENUE_DEDUCTIONS', 'SERVICE_COST', 'OPERATING_EXPENSE',
  'FINANCIAL_RESULT', 'OTHER_RESULT', 'INCOME_TAX'
);
create type public.cash_flow_activity as enum ('OPERATING', 'INVESTING', 'FINANCING');
create type public.financial_series_kind as enum ('INSTALLMENT', 'RECURRING');
create type public.financial_recurrence_cadence as enum ('WEEKLY', 'MONTHLY', 'YEARLY');
create type public.budget_version_status as enum ('DRAFT', 'APPROVED', 'SUPERSEDED');

alter table public.chart_of_accounts
  add column dre_group public.financial_dre_group,
  add column cash_flow_activity public.cash_flow_activity;

alter table public.financial_entries
  add column competence_date date,
  add column location_id uuid,
  add column financial_series_id uuid,
  add column series_occurrence integer;

update public.financial_entries set competence_date = issue_date where competence_date is null;
alter table public.financial_entries alter column competence_date set not null;
alter table public.financial_entries
  add foreign key (location_id, organization_id) references public.locations(id, organization_id);

create table public.service_financial_defaults (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  service_id uuid not null,
  location_id uuid,
  revenue_chart_account_id uuid not null,
  cost_center_id uuid,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  unique nulls not distinct (organization_id, service_id, location_id),
  foreign key (service_id, organization_id) references public.services(id, organization_id) on delete cascade,
  foreign key (location_id, organization_id) references public.locations(id, organization_id),
  foreign key (revenue_chart_account_id, organization_id) references public.chart_of_accounts(id, organization_id),
  foreign key (cost_center_id, organization_id) references public.cost_centers(id, organization_id)
);

create table public.financial_series (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  kind public.financial_series_kind not null,
  cadence public.financial_recurrence_cadence not null,
  entry_kind public.financial_entry_kind not null,
  description text not null check (char_length(btrim(description)) between 2 and 500),
  start_date date not null,
  end_date date,
  occurrence_count integer check (occurrence_count is null or occurrence_count > 0),
  total_cents bigint check (total_cents is null or total_cents > 0),
  amount_cents bigint check (amount_cents is null or amount_cents > 0),
  chart_account_id uuid not null,
  cost_center_id uuid,
  location_id uuid,
  preferred_financial_account_id uuid,
  active boolean not null default true,
  canceled_at timestamptz,
  cancellation_reason text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (chart_account_id, organization_id) references public.chart_of_accounts(id, organization_id),
  foreign key (cost_center_id, organization_id) references public.cost_centers(id, organization_id),
  foreign key (location_id, organization_id) references public.locations(id, organization_id),
  foreign key (preferred_financial_account_id, organization_id) references public.financial_accounts(id, organization_id),
  check ((kind = 'INSTALLMENT' and total_cents is not null and occurrence_count is not null and amount_cents is null)
      or (kind = 'RECURRING' and amount_cents is not null and total_cents is null)),
  check (end_date is null or end_date >= start_date),
  check ((canceled_at is null and cancellation_reason is null) or (canceled_at is not null and nullif(btrim(cancellation_reason), '') is not null))
);
alter table public.financial_entries
  add foreign key (financial_series_id, organization_id) references public.financial_series(id, organization_id);
create unique index financial_entries_series_occurrence_unique on public.financial_entries (organization_id, financial_series_id, series_occurrence) where financial_series_id is not null;

create table public.appointment_receipt_classifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  payment_transaction_id uuid not null,
  financial_account_id uuid not null,
  chart_account_id uuid not null,
  cost_center_id uuid,
  payment_method public.financial_payment_method not null,
  document_number text,
  reference text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (id, organization_id),
  unique (organization_id, payment_transaction_id),
  foreign key (payment_transaction_id, organization_id) references public.payment_transactions(id, organization_id),
  foreign key (financial_account_id, organization_id) references public.financial_accounts(id, organization_id),
  foreign key (chart_account_id, organization_id) references public.chart_of_accounts(id, organization_id),
  foreign key (cost_center_id, organization_id) references public.cost_centers(id, organization_id)
);

create table public.commission_payout_settlements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  payout_id uuid not null,
  financial_account_id uuid not null,
  amount_cents bigint not null check (amount_cents > 0),
  paid_on date not null default current_date,
  payment_method public.financial_payment_method not null,
  reference text,
  idempotency_key text not null check (nullif(btrim(idempotency_key), '') is not null),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (id, organization_id),
  unique (organization_id, idempotency_key),
  unique (organization_id, payout_id),
  foreign key (payout_id, organization_id) references public.commission_payouts(id, organization_id),
  foreign key (financial_account_id, organization_id) references public.financial_accounts(id, organization_id)
);

create table public.financial_budgets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  fiscal_year integer not null check (fiscal_year between 2000 and 9999),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (id, organization_id),
  unique (organization_id, fiscal_year)
);

create table public.financial_budget_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  budget_id uuid not null,
  version_number integer not null check (version_number > 0),
  status public.budget_version_status not null default 'DRAFT',
  based_on_version_id uuid,
  approved_at timestamptz,
  approved_by uuid references auth.users(id),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (id, organization_id),
  unique (organization_id, budget_id, version_number),
  foreign key (budget_id, organization_id) references public.financial_budgets(id, organization_id) on delete cascade,
  foreign key (based_on_version_id, organization_id) references public.financial_budget_versions(id, organization_id),
  check ((status = 'APPROVED' and approved_at is not null and approved_by is not null) or (status <> 'APPROVED' and approved_at is null and approved_by is null))
);
create unique index financial_budget_one_approved_version on public.financial_budget_versions (organization_id, budget_id) where status = 'APPROVED';

create table public.financial_budget_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  budget_version_id uuid not null,
  month smallint not null check (month between 1 and 12),
  chart_account_id uuid not null,
  cost_center_id uuid,
  location_id uuid,
  amount_cents bigint not null,
  created_at timestamptz not null default now(),
  unique (id, organization_id),
  unique nulls not distinct (organization_id, budget_version_id, month, chart_account_id, cost_center_id, location_id),
  foreign key (budget_version_id, organization_id) references public.financial_budget_versions(id, organization_id) on delete cascade,
  foreign key (chart_account_id, organization_id) references public.chart_of_accounts(id, organization_id),
  foreign key (cost_center_id, organization_id) references public.cost_centers(id, organization_id),
  foreign key (location_id, organization_id) references public.locations(id, organization_id)
);

-- Immutable ledgers and tenant assignments.
create trigger appointment_receipt_classifications_append_only before update or delete on public.appointment_receipt_classifications for each row execute function public.prevent_financial_ledger_mutation();
create trigger commission_payout_settlements_append_only before update or delete on public.commission_payout_settlements for each row execute function public.prevent_financial_ledger_mutation();
do $$ declare table_name text; begin
  foreach table_name in array array['service_financial_defaults', 'financial_series', 'appointment_receipt_classifications', 'commission_payout_settlements', 'financial_budgets', 'financial_budget_versions', 'financial_budget_lines'] loop
    execute format('create trigger %I_prevent_tenant_reassignment before update on public.%I for each row execute function public.prevent_tenant_reassignment()', table_name, table_name);
  end loop;
  foreach table_name in array array['service_financial_defaults', 'financial_series'] loop
    execute format('create trigger %I_set_updated_at before update on public.%I for each row execute function public.set_updated_at()', table_name, table_name);
  end loop;
end $$;

-- Report facts obey source-table RLS through security_invoker.
create or replace view public.financial_reporting_facts
with (security_invoker = true) as
with appointment_items as (
  select a.organization_id, a.id appointment_id, a.location_id, a.customer_id, a.barber_id, a.status, a.service_period,
    i.id appointment_item_id, i.service_id, i.service_name_snapshot, i.position, i.charged_price_cents_snapshot,
    coalesce(local_default.revenue_chart_account_id, org_default.revenue_chart_account_id) chart_account_id,
    coalesce(local_default.cost_center_id, org_default.cost_center_id) cost_center_id
  from public.appointments a
  join public.appointment_items i on i.organization_id = a.organization_id and i.appointment_id = a.id
  left join public.service_financial_defaults local_default on local_default.organization_id = a.organization_id and local_default.service_id = i.service_id and local_default.location_id = a.location_id
  left join public.service_financial_defaults org_default on org_default.organization_id = a.organization_id and org_default.service_id = i.service_id and org_default.location_id is null
), payment_totals as (
  select appointment_id, organization_id, coalesce(sum(charged_price_cents_snapshot), 0)::bigint total_cents from appointment_items group by appointment_id, organization_id
), payment_service_facts as (
  select pt.organization_id, 'CASH'::text basis, 'APPOINTMENT_PAYMENT'::text source_type, pt.id source_id,
    (pt.occurred_at at time zone 'America/Sao_Paulo')::date fact_date, null::date competence_date, null::date due_date, (pt.occurred_at at time zone 'America/Sao_Paulo')::date settlement_date,
    ai.location_id, ai.customer_id, ai.barber_id, ai.service_id, ai.service_name_snapshot, coalesce(rc.chart_account_id, ai.chart_account_id) chart_account_id,
    coalesce(rc.cost_center_id, ai.cost_center_id) cost_center_id, coalesce(rc.financial_account_id, map.financial_account_id) financial_account_id,
    coalesce(ca.dre_group, 'GROSS_REVENUE'::public.financial_dre_group) dre_group, coalesce(ca.cash_flow_activity, 'OPERATING'::public.cash_flow_activity) cash_flow_activity,
    case when pt.kind in ('CAPTURE','ADJUSTMENT') then 1 else -1 end *
      (floor(pt.amount_cents::numeric * ai.charged_price_cents_snapshot / nullif(t.total_cents, 0))::bigint + case when row_number() over (partition by pt.id order by ai.position desc) = 1 then pt.amount_cents - coalesce(sum(floor(pt.amount_cents::numeric * ai.charged_price_cents_snapshot / nullif(t.total_cents, 0))::bigint) over (partition by pt.id), 0) else 0 end) signed_cents,
    pt.kind::text status
  from public.payment_transactions pt
  join appointment_items ai on ai.organization_id = pt.organization_id and ai.appointment_id = pt.appointment_id
  join payment_totals t on t.organization_id = pt.organization_id and t.appointment_id = pt.appointment_id and t.total_cents > 0
  left join public.appointment_receipt_classifications rc on rc.organization_id = pt.organization_id and rc.payment_transaction_id = pt.id
  left join public.payment_account_mappings map on map.organization_id = pt.organization_id and map.provider = pt.provider and map.payment_mode = (select a.payment_mode from public.appointments a where a.id = pt.appointment_id and a.organization_id = pt.organization_id)
  left join public.chart_of_accounts ca on ca.organization_id = pt.organization_id and ca.id = coalesce(rc.chart_account_id, ai.chart_account_id)
), facts as (
  select ai.organization_id, 'FORECAST'::text basis, 'APPOINTMENT'::text source_type, ai.appointment_item_id source_id,
    lower(ai.service_period)::date fact_date, null::date competence_date, lower(ai.service_period)::date due_date, null::date settlement_date,
    ai.location_id, ai.customer_id, ai.barber_id, ai.service_id, ai.service_name_snapshot, ai.chart_account_id, ai.cost_center_id, null::uuid financial_account_id,
    ca.dre_group, ca.cash_flow_activity, ai.charged_price_cents_snapshot::bigint signed_cents, ai.status::text status
  from appointment_items ai left join public.chart_of_accounts ca on ca.organization_id = ai.organization_id and ca.id = ai.chart_account_id
  where ai.status in ('CONFIRMED','IN_SERVICE')
  union all
  select ai.organization_id, 'ACCRUAL', 'APPOINTMENT_SERVICE', ai.appointment_item_id, coalesce((select min((e.created_at at time zone 'America/Sao_Paulo')::date) from public.appointment_status_events e where e.organization_id = ai.organization_id and e.appointment_id = ai.appointment_id and e.to_status = 'COMPLETED'), lower(ai.service_period)::date),
    coalesce((select min((e.created_at at time zone 'America/Sao_Paulo')::date) from public.appointment_status_events e where e.organization_id = ai.organization_id and e.appointment_id = ai.appointment_id and e.to_status = 'COMPLETED'), lower(ai.service_period)::date), null, null,
    ai.location_id, ai.customer_id, ai.barber_id, ai.service_id, ai.service_name_snapshot, ai.chart_account_id, ai.cost_center_id, null, ca.dre_group, ca.cash_flow_activity, ai.charged_price_cents_snapshot::bigint, ai.status::text
  from appointment_items ai left join public.chart_of_accounts ca on ca.organization_id = ai.organization_id and ca.id = ai.chart_account_id where ai.status = 'COMPLETED'
  union all
  select e.organization_id, 'ACCRUAL', 'FINANCIAL_ENTRY', e.id, e.competence_date, e.competence_date, e.due_date, null, e.location_id, e.customer_id, null, null, e.description, e.chart_account_id, e.cost_center_id, null, ca.dre_group, ca.cash_flow_activity,
    case when e.kind = 'REVENUE' then e.total_cents else -e.total_cents end, s.status::text from public.financial_entries e join public.financial_entry_summary s on s.organization_id=e.organization_id and s.id=e.id left join public.chart_of_accounts ca on ca.organization_id=e.organization_id and ca.id=e.chart_account_id where e.canceled_at is null
  union all
  select s.organization_id, 'CASH', 'FINANCIAL_SETTLEMENT', s.id, s.settled_on, null, e.due_date, s.settled_on, e.location_id, e.customer_id, null, null, e.description, e.chart_account_id, e.cost_center_id, s.financial_account_id, ca.dre_group, ca.cash_flow_activity,
    case when e.kind='REVENUE' and s.kind='SETTLEMENT' then s.amount_cents when e.kind='REVENUE' then -s.amount_cents when s.kind='SETTLEMENT' then -s.amount_cents else s.amount_cents end, s.kind::text from public.financial_settlements s join public.financial_entries e on e.organization_id=s.organization_id and e.id=s.entry_id left join public.chart_of_accounts ca on ca.organization_id=e.organization_id and ca.id=e.chart_account_id
  union all
  select cl.organization_id, 'ACCRUAL', 'COMMISSION', cl.id, (cl.earned_at at time zone 'America/Sao_Paulo')::date, (cl.earned_at at time zone 'America/Sao_Paulo')::date, null, null, a.location_id, a.customer_id, cl.barber_id, ai.service_id, 'Comissão', null, null, null, 'SERVICE_COST'::public.financial_dre_group, 'OPERATING'::public.cash_flow_activity, -cl.amount_cents, cl.kind::text from public.commission_ledger cl join public.appointments a on a.organization_id=cl.organization_id and a.id=cl.appointment_id left join public.appointment_items ai on ai.organization_id=cl.organization_id and ai.id=cl.appointment_item_id
  union all
  select cps.organization_id, 'CASH', 'COMMISSION_PAYOUT', cps.id, cps.paid_on, null, null, cps.paid_on, null, null, cp.barber_id, null, 'Pagamento de comissão', null, null, cps.financial_account_id, 'SERVICE_COST'::public.financial_dre_group, 'OPERATING'::public.cash_flow_activity, -cps.amount_cents, 'PAID' from public.commission_payout_settlements cps join public.commission_payouts cp on cp.organization_id=cps.organization_id and cp.id=cps.payout_id
  union all select * from payment_service_facts
)
select * from facts;
grant select on public.financial_reporting_facts to authenticated;

-- Recurrence, receipt and commission mutations remain owner-only and idempotent.
create or replace function public.record_manual_appointment_receipt_v2(p_appointment_id uuid, p_amount_cents bigint, p_payment_method public.financial_payment_method, p_financial_account_id uuid, p_chart_account_id uuid, p_cost_center_id uuid default null, p_reference text default null, p_document_number text default null, p_idempotency_key text default null)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_appointment public.appointments%rowtype; v_transaction_id uuid; v_existing public.appointment_receipt_classifications%rowtype;
begin
  select * into strict v_appointment from public.appointments where id=p_appointment_id for update;
  perform public.require_financial_owner(v_appointment.organization_id, 'appointment receipt');
  if v_appointment.status <> 'COMPLETED' then raise exception using errcode='22023', message='only completed appointment can be received'; end if;
  if not exists (select 1 from public.financial_accounts where id=p_financial_account_id and organization_id=v_appointment.organization_id and active) then raise exception using errcode='22023', message='active financial account is required'; end if;
  if not exists (select 1 from public.chart_of_accounts where id=p_chart_account_id and organization_id=v_appointment.organization_id and kind='REVENUE' and active) then raise exception using errcode='22023', message='active revenue chart account is required'; end if;
  if p_cost_center_id is not null and not exists (select 1 from public.cost_centers where id=p_cost_center_id and organization_id=v_appointment.organization_id and active) then raise exception using errcode='22023', message='active cost center is required'; end if;
  v_transaction_id := public.record_manual_payment(p_appointment_id, p_amount_cents, p_reference, p_idempotency_key);
  select * into v_existing from public.appointment_receipt_classifications where organization_id=v_appointment.organization_id and payment_transaction_id=v_transaction_id;
  if found then
    if v_existing.financial_account_id <> p_financial_account_id or v_existing.chart_account_id <> p_chart_account_id or v_existing.cost_center_id is distinct from p_cost_center_id or v_existing.payment_method <> p_payment_method then raise exception using errcode='22023', message='idempotency key belongs to another receipt classification'; end if;
    return v_transaction_id;
  end if;
  insert into public.appointment_receipt_classifications (organization_id,payment_transaction_id,financial_account_id,chart_account_id,cost_center_id,payment_method,document_number,reference,created_by)
  values (v_appointment.organization_id,v_transaction_id,p_financial_account_id,p_chart_account_id,p_cost_center_id,p_payment_method,nullif(btrim(p_document_number),''),nullif(btrim(p_reference),''),auth.uid())
  on conflict (organization_id,payment_transaction_id) do nothing;
  return v_transaction_id;
exception when no_data_found then raise exception using errcode='P0002', message='appointment not found'; end; $$;

create or replace function public.record_commission_payout(p_payout_id uuid, p_financial_account_id uuid, p_paid_on date, p_payment_method public.financial_payment_method, p_reference text, p_idempotency_key text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_payout public.commission_payouts%rowtype; v_id uuid;
begin
  select * into strict v_payout from public.commission_payouts where id=p_payout_id for update;
  perform public.require_financial_owner(v_payout.organization_id, 'commission payout');
  if not exists (select 1 from public.financial_accounts where id=p_financial_account_id and organization_id=v_payout.organization_id and active) then raise exception using errcode='22023', message='active financial account is required'; end if;
  select id into v_id from public.commission_payout_settlements where organization_id=v_payout.organization_id and idempotency_key=p_idempotency_key;
  if v_id is not null then
    if not exists (select 1 from public.commission_payout_settlements where id=v_id and payout_id=p_payout_id and financial_account_id=p_financial_account_id and amount_cents=v_payout.amount_cents) then raise exception using errcode='22023', message='idempotency key belongs to another commission payout'; end if;
    return v_id;
  end if;
  if v_payout.status <> 'OPEN' then raise exception using errcode='22023', message='payout is not open'; end if;
  insert into public.commission_payout_settlements (organization_id,payout_id,financial_account_id,amount_cents,paid_on,payment_method,reference,idempotency_key,created_by)
  values (v_payout.organization_id,p_payout_id,p_financial_account_id,v_payout.amount_cents,coalesce(p_paid_on,current_date),p_payment_method,nullif(btrim(p_reference),''),p_idempotency_key,auth.uid()) returning id into v_id;
  update public.commission_payouts set status='PAID', paid_at=now(), marked_paid_by=auth.uid() where id=v_payout.id;
  return v_id;
exception when no_data_found then raise exception using errcode='P0002', message='payout not found'; end; $$;

create or replace function public.extend_due_financial_recurrences(p_organization_id uuid default null)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.financial_series%rowtype; v_count integer:=0; v_limit date; v_i integer; v_date date; v_amount bigint;
begin
  if p_organization_id is null then raise exception using errcode='22023', message='organization id is required'; end if;
  perform public.require_financial_owner(p_organization_id, 'financial recurrence extension');
  for r in select * from public.financial_series where active and canceled_at is null and (p_organization_id is null or organization_id=p_organization_id) for update loop
    v_limit := least(coalesce(r.end_date, current_date + interval '12 months')::date, (current_date + interval '12 months')::date);
    v_i := 1;
    loop
      exit when r.occurrence_count is not null and v_i > r.occurrence_count;
      v_date := case r.cadence when 'WEEKLY' then r.start_date + ((v_i-1)*7) when 'MONTHLY' then (r.start_date + make_interval(months => v_i-1))::date else (r.start_date + make_interval(years => v_i-1))::date end;
      exit when v_date > v_limit;
      v_amount := case when r.kind='INSTALLMENT' then r.total_cents / r.occurrence_count + case when v_i=r.occurrence_count then r.total_cents % r.occurrence_count else 0 end else r.amount_cents end;
      insert into public.financial_entries (organization_id,kind,description,issue_date,competence_date,due_date,total_cents,chart_account_id,cost_center_id,location_id,preferred_financial_account_id,financial_series_id,series_occurrence,created_by)
      values (r.organization_id,r.entry_kind,r.description,v_date,v_date,v_date,v_amount,r.chart_account_id,r.cost_center_id,r.location_id,r.preferred_financial_account_id,r.id,v_i,r.created_by)
      on conflict (organization_id,financial_series_id,series_occurrence) where financial_series_id is not null do nothing;
      v_count := v_count + 1; v_i := v_i + 1;
    end loop;
  end loop;
  return v_count;
end; $$;

do $$ declare table_name text; begin
  foreach table_name in array array['service_financial_defaults','financial_series','appointment_receipt_classifications','commission_payout_settlements','financial_budgets','financial_budget_versions','financial_budget_lines'] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('create policy %I_owner_select on public.%I for select to authenticated using (public.is_organization_owner(organization_id))', table_name, table_name);
    execute format('grant select on public.%I to authenticated', table_name);
  end loop;
end $$;

revoke all on function public.record_manual_appointment_receipt_v2(uuid,bigint,public.financial_payment_method,uuid,uuid,uuid,text,text,text) from public, anon, authenticated, service_role;
revoke all on function public.record_commission_payout(uuid,uuid,date,public.financial_payment_method,text,text) from public, anon, authenticated, service_role;
revoke all on function public.extend_due_financial_recurrences(uuid) from public, anon, authenticated, service_role;
grant execute on function public.record_manual_appointment_receipt_v2(uuid,bigint,public.financial_payment_method,uuid,uuid,uuid,text,text,text), public.record_commission_payout(uuid,uuid,date,public.financial_payment_method,text,text), public.extend_due_financial_recurrences(uuid) to authenticated;

create index financial_reporting_entries_competence_idx on public.financial_entries (organization_id, competence_date, kind) where canceled_at is null;
create index financial_series_active_idx on public.financial_series (organization_id, active, start_date) where canceled_at is null;
create index appointment_receipt_classifications_transaction_idx on public.appointment_receipt_classifications (organization_id, payment_transaction_id);
create index commission_payout_settlements_date_idx on public.commission_payout_settlements (organization_id, paid_on);

-- Only standard-template codes receive defaults; tenant custom accounts stay unclassified.
update public.chart_of_accounts c set
  dre_group = case
    when c.kind = 'REVENUE' then 'GROSS_REVENUE'::public.financial_dre_group
    when c.code in ('2.1.2','2.3.1','2.3.2') then 'SERVICE_COST'::public.financial_dre_group
    when c.code like '2.7%' then 'FINANCIAL_RESULT'::public.financial_dre_group
    when c.code = '2.6.1' then 'INCOME_TAX'::public.financial_dre_group
    else 'OPERATING_EXPENSE'::public.financial_dre_group end,
  cash_flow_activity = case when c.code = '2.5.2' then 'INVESTING'::public.cash_flow_activity else 'OPERATING'::public.cash_flow_activity end
where exists (select 1 from public.default_chart_account_templates t where t.code=c.code and t.name=c.name and t.kind=c.kind);

create or replace function public.create_financial_series(
  p_organization_id uuid, p_kind public.financial_series_kind, p_cadence public.financial_recurrence_cadence,
  p_entry_kind public.financial_entry_kind, p_description text, p_start_date date, p_chart_account_id uuid,
  p_occurrence_count integer default null, p_end_date date default null, p_total_cents bigint default null,
  p_amount_cents bigint default null, p_cost_center_id uuid default null, p_location_id uuid default null,
  p_preferred_financial_account_id uuid default null
) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  perform public.require_financial_owner(p_organization_id, 'financial series');
  if not exists (select 1 from public.chart_of_accounts where id=p_chart_account_id and organization_id=p_organization_id and kind=p_entry_kind and active) then raise exception using errcode='22023', message='active chart account of matching kind is required'; end if;
  if p_cost_center_id is not null and not exists (select 1 from public.cost_centers where id=p_cost_center_id and organization_id=p_organization_id and active) then raise exception using errcode='22023', message='active cost center is required'; end if;
  if p_location_id is not null and not exists (select 1 from public.locations where id=p_location_id and organization_id=p_organization_id and active) then raise exception using errcode='22023', message='active location is required'; end if;
  if p_preferred_financial_account_id is not null and not exists (select 1 from public.financial_accounts where id=p_preferred_financial_account_id and organization_id=p_organization_id and active) then raise exception using errcode='22023', message='active financial account is required'; end if;
  insert into public.financial_series (organization_id,kind,cadence,entry_kind,description,start_date,end_date,occurrence_count,total_cents,amount_cents,chart_account_id,cost_center_id,location_id,preferred_financial_account_id,created_by)
  values (p_organization_id,p_kind,p_cadence,p_entry_kind,btrim(p_description),p_start_date,p_end_date,p_occurrence_count,p_total_cents,p_amount_cents,p_chart_account_id,p_cost_center_id,p_location_id,p_preferred_financial_account_id,auth.uid()) returning id into v_id;
  perform public.extend_due_financial_recurrences(p_organization_id);
  return v_id;
end; $$;

create or replace function public.cancel_future_financial_series(p_series_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_series public.financial_series%rowtype;
begin
  select * into strict v_series from public.financial_series where id=p_series_id for update;
  perform public.require_financial_owner(v_series.organization_id, 'financial series cancellation');
  if nullif(btrim(p_reason),'') is null then raise exception using errcode='22023', message='cancellation reason is required'; end if;
  update public.financial_series set active=false,canceled_at=now(),cancellation_reason=left(btrim(p_reason),500) where id=v_series.id;
  update public.financial_entries set canceled_at=now(),cancellation_reason=left(btrim(p_reason),500) where organization_id=v_series.organization_id and financial_series_id=v_series.id and due_date>=current_date and canceled_at is null and not exists (select 1 from public.financial_settlements s where s.organization_id=financial_entries.organization_id and s.entry_id=financial_entries.id);
exception when no_data_found then raise exception using errcode='P0002',message='financial series not found'; end; $$;

create or replace function public.update_future_financial_series(p_series_id uuid, p_description text, p_chart_account_id uuid, p_cost_center_id uuid default null, p_location_id uuid default null, p_preferred_financial_account_id uuid default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_series public.financial_series%rowtype;
begin
  select * into strict v_series from public.financial_series where id=p_series_id for update;
  perform public.require_financial_owner(v_series.organization_id, 'financial series update');
  if not v_series.active or v_series.canceled_at is not null or nullif(btrim(p_description),'') is null then raise exception using errcode='22023',message='active series and description are required'; end if;
  if not exists (select 1 from public.chart_of_accounts where id=p_chart_account_id and organization_id=v_series.organization_id and kind=v_series.entry_kind and active) then raise exception using errcode='22023',message='active chart account of matching kind is required'; end if;
  update public.financial_series set description=btrim(p_description),chart_account_id=p_chart_account_id,cost_center_id=p_cost_center_id,location_id=p_location_id,preferred_financial_account_id=p_preferred_financial_account_id where id=v_series.id;
  update public.financial_entries set description=btrim(p_description),chart_account_id=p_chart_account_id,cost_center_id=p_cost_center_id,location_id=p_location_id,preferred_financial_account_id=p_preferred_financial_account_id where organization_id=v_series.organization_id and financial_series_id=v_series.id and due_date>=current_date and canceled_at is null and not exists (select 1 from public.financial_settlements s where s.organization_id=financial_entries.organization_id and s.entry_id=financial_entries.id);
exception when no_data_found then raise exception using errcode='P0002',message='financial series not found'; end; $$;

create or replace function public.save_budget_draft_lines(p_budget_version_id uuid, p_lines jsonb)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_version public.financial_budget_versions%rowtype; v_line jsonb;
begin
  select * into strict v_version from public.financial_budget_versions where id=p_budget_version_id for update;
  perform public.require_financial_owner(v_version.organization_id, 'budget draft');
  if v_version.status <> 'DRAFT' then raise exception using errcode='22023',message='only draft budget can be edited'; end if;
  if jsonb_typeof(p_lines) <> 'array' then raise exception using errcode='22023',message='budget lines must be an array'; end if;
  delete from public.financial_budget_lines where organization_id=v_version.organization_id and budget_version_id=v_version.id;
  for v_line in select * from jsonb_array_elements(p_lines) loop
    insert into public.financial_budget_lines (organization_id,budget_version_id,month,chart_account_id,cost_center_id,location_id,amount_cents)
    select v_version.organization_id,v_version.id,(v_line->>'month')::smallint,(v_line->>'chart_account_id')::uuid,nullif(v_line->>'cost_center_id','')::uuid,nullif(v_line->>'location_id','')::uuid,(v_line->>'amount_cents')::bigint
    where exists (select 1 from public.chart_of_accounts c where c.id=(v_line->>'chart_account_id')::uuid and c.organization_id=v_version.organization_id);
    if not found then raise exception using errcode='22023',message='budget chart account must belong to organization'; end if;
  end loop;
exception when no_data_found then raise exception using errcode='P0002',message='budget version not found'; end; $$;

create or replace function public.approve_budget_version(p_budget_version_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_version public.financial_budget_versions%rowtype;
begin
  select * into strict v_version from public.financial_budget_versions where id=p_budget_version_id for update;
  perform public.require_financial_owner(v_version.organization_id, 'budget approval');
  if v_version.status <> 'DRAFT' then raise exception using errcode='22023',message='only draft budget can be approved'; end if;
  update public.financial_budget_versions set status='SUPERSEDED' where organization_id=v_version.organization_id and budget_id=v_version.budget_id and status='APPROVED';
  update public.financial_budget_versions set status='APPROVED',approved_at=now(),approved_by=auth.uid() where id=v_version.id;
exception when no_data_found then raise exception using errcode='P0002',message='budget version not found'; end; $$;

create or replace function public.create_budget_draft(p_organization_id uuid, p_fiscal_year integer)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_budget_id uuid; v_version_id uuid;
begin
  perform public.require_financial_owner(p_organization_id, 'budget draft');
  insert into public.financial_budgets (organization_id,fiscal_year,created_by) values (p_organization_id,p_fiscal_year,auth.uid())
  on conflict (organization_id,fiscal_year) do update set fiscal_year=excluded.fiscal_year returning id into v_budget_id;
  select id into v_version_id from public.financial_budget_versions where organization_id=p_organization_id and budget_id=v_budget_id and status='DRAFT' order by version_number desc limit 1;
  if v_version_id is not null then return v_version_id; end if;
  insert into public.financial_budget_versions (organization_id,budget_id,version_number,status,created_by)
  values (p_organization_id,v_budget_id,coalesce((select max(version_number)+1 from public.financial_budget_versions where organization_id=p_organization_id and budget_id=v_budget_id),1),'DRAFT',auth.uid()) returning id into v_version_id;
  return v_version_id;
end; $$;

create or replace function public.revise_budget_version(p_budget_version_id uuid)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_source public.financial_budget_versions%rowtype; v_new_id uuid;
begin
  select * into strict v_source from public.financial_budget_versions where id=p_budget_version_id for update;
  perform public.require_financial_owner(v_source.organization_id, 'budget revision');
  if v_source.status <> 'APPROVED' then raise exception using errcode='22023',message='only approved budget can be revised'; end if;
  insert into public.financial_budget_versions (organization_id,budget_id,version_number,status,based_on_version_id,created_by)
  values (v_source.organization_id,v_source.budget_id,(select max(version_number)+1 from public.financial_budget_versions where organization_id=v_source.organization_id and budget_id=v_source.budget_id),'DRAFT',v_source.id,auth.uid()) returning id into v_new_id;
  insert into public.financial_budget_lines (organization_id,budget_version_id,month,chart_account_id,cost_center_id,location_id,amount_cents)
  select organization_id,v_new_id,month,chart_account_id,cost_center_id,location_id,amount_cents from public.financial_budget_lines where organization_id=v_source.organization_id and budget_version_id=v_source.id;
  return v_new_id;
exception when no_data_found then raise exception using errcode='P0002',message='budget version not found'; end; $$;

create or replace function public.set_chart_account_reporting_classification(p_chart_account_id uuid, p_dre_group public.financial_dre_group default null, p_cash_flow_activity public.cash_flow_activity default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_account public.chart_of_accounts%rowtype;
begin
  select * into strict v_account from public.chart_of_accounts where id=p_chart_account_id for update;
  perform public.require_financial_owner(v_account.organization_id, 'chart account reporting classification');
  update public.chart_of_accounts set dre_group=p_dre_group,cash_flow_activity=p_cash_flow_activity where id=v_account.id;
exception when no_data_found then raise exception using errcode='P0002',message='chart account not found'; end; $$;

revoke all on function public.create_financial_series(uuid,public.financial_series_kind,public.financial_recurrence_cadence,public.financial_entry_kind,text,date,uuid,integer,date,bigint,bigint,uuid,uuid,uuid), public.cancel_future_financial_series(uuid,text), public.update_future_financial_series(uuid,text,uuid,uuid,uuid,uuid), public.save_budget_draft_lines(uuid,jsonb), public.approve_budget_version(uuid), public.create_budget_draft(uuid,integer), public.revise_budget_version(uuid), public.set_chart_account_reporting_classification(uuid,public.financial_dre_group,public.cash_flow_activity) from public, anon, authenticated, service_role;
grant execute on function public.create_financial_series(uuid,public.financial_series_kind,public.financial_recurrence_cadence,public.financial_entry_kind,text,date,uuid,integer,date,bigint,bigint,uuid,uuid,uuid), public.cancel_future_financial_series(uuid,text), public.update_future_financial_series(uuid,text,uuid,uuid,uuid,uuid), public.save_budget_draft_lines(uuid,jsonb), public.approve_budget_version(uuid), public.create_budget_draft(uuid,integer), public.revise_budget_version(uuid), public.set_chart_account_reporting_classification(uuid,public.financial_dre_group,public.cash_flow_activity) to authenticated;
