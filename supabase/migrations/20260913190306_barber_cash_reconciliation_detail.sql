-- Keep barber receipts as the payment source of truth. Reconciliation adds an
-- immutable control record and makes the existing appointment cash activity
-- visible in the manager Caixa with its original transaction date.
create table public.barber_cash_reconciliations (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  cash_session_id uuid not null,
  expected_cents bigint not null check (expected_cents >= 0),
  reconciled_cents bigint not null check (reconciled_cents >= 0),
  variance_cents bigint not null,
  variance_reason text,
  reconciled_on date not null,
  reconciled_at timestamptz not null default now(),
  reconciled_by uuid not null references auth.users(id),
  idempotency_key text not null check (nullif(btrim(idempotency_key), '') is not null),
  created_at timestamptz not null default now(),
  unique (id, organization_id),
  unique (organization_id, cash_session_id),
  unique (organization_id, idempotency_key),
  foreign key (cash_session_id, organization_id) references public.barber_cash_sessions(id, organization_id),
  check ((variance_cents = reconciled_cents - expected_cents)),
  check ((variance_cents = 0 and nullif(btrim(variance_reason), '') is null)
    or (variance_cents <> 0 and nullif(btrim(variance_reason), '') is not null))
);

create index barber_cash_reconciliations_org_date_idx
  on public.barber_cash_reconciliations (organization_id, reconciled_on desc);

create trigger barber_cash_reconciliations_append_only
  before update or delete on public.barber_cash_reconciliations
  for each row execute function public.prevent_financial_ledger_mutation();

alter table public.barber_cash_reconciliations enable row level security;
create policy barber_cash_reconciliation_owner_select
  on public.barber_cash_reconciliations for select to authenticated
  using (public.is_organization_owner(organization_id));

grant select on public.barber_cash_reconciliations to authenticated;

create or replace function public.reconcile_barber_cash_session(
  p_session_id uuid,
  p_reconciled_cents bigint,
  p_variance_reason text default null,
  p_account_breakdown jsonb default null,
  p_idempotency_key text default null
)
returns bigint language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_session public.barber_cash_sessions%rowtype;
  v_receipt public.barber_cash_receipts%rowtype;
  v_chart_id uuid;
  v_variance bigint;
  v_reconciled_cents bigint;
  v_expected_breakdown jsonb;
  v_breakdown jsonb;
  v_reconciliation_id bigint;
  v_existing public.barber_cash_reconciliations%rowtype;
  v_key text;
  v_invalid boolean;
begin
  select * into strict v_session
  from public.barber_cash_sessions
  where id = p_session_id
  for update;

  perform public.require_financial_owner(v_session.organization_id, 'barber cash reconciliation');

  select * into v_existing
  from public.barber_cash_reconciliations
  where organization_id = v_session.organization_id
    and cash_session_id = v_session.id;
  if found then
    return v_existing.id;
  end if;

  if v_session.status <> 'OPEN' or p_reconciled_cents < 0 then
    raise exception using errcode = '22023', message = 'open session and non-negative count required';
  end if;

  v_key := coalesce(nullif(btrim(p_idempotency_key), ''), 'barber-cash-session:' || v_session.id::text);
  select * into v_existing
  from public.barber_cash_reconciliations
  where organization_id = v_session.organization_id
    and idempotency_key = v_key;
  if found then
    if v_existing.cash_session_id <> v_session.id then
      raise exception using errcode = '22023', message = 'idempotency key belongs to another reconciliation';
    end if;
    return v_existing.id;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'financial_account_id', grouped.financial_account_id,
    'expected_cents', grouped.expected_cents,
    'reconciled_cents', grouped.expected_cents
  ) order by grouped.financial_account_id), '[]'::jsonb)
  into v_expected_breakdown
  from (
    select financial_account_id, sum(amount_cents)::bigint as expected_cents
    from public.barber_cash_receipts
    where cash_session_id = v_session.id and status = 'PENDING_RECONCILIATION'
    group by financial_account_id
  ) grouped;

  v_breakdown := case
    when p_account_breakdown is null then v_expected_breakdown
    when jsonb_typeof(p_account_breakdown) <> 'array' then null
    else p_account_breakdown
  end;
  if v_breakdown is null then
    raise exception using errcode = '22023', message = 'account breakdown must be an array';
  end if;

  with input_rows as (
    select financial_account_id, expected_cents, reconciled_cents
    from jsonb_to_recordset(v_breakdown) as input(financial_account_id uuid, expected_cents bigint, reconciled_cents bigint)
  ), expected_rows as (
    select financial_account_id, sum(amount_cents)::bigint as expected_cents
    from public.barber_cash_receipts
    where cash_session_id = v_session.id and status = 'PENDING_RECONCILIATION'
    group by financial_account_id
  ), compared as (
    select coalesce(expected_rows.financial_account_id, input_rows.financial_account_id) as financial_account_id,
      expected_rows.financial_account_id is not null as has_expected_row,
      input_rows.financial_account_id is not null as has_input_row,
      coalesce(expected_rows.expected_cents, 0)::bigint as expected_cents,
      coalesce(input_rows.expected_cents, 0)::bigint as input_expected_cents,
      coalesce(input_rows.reconciled_cents, 0)::bigint as input_reconciled_cents
    from expected_rows
    full join input_rows using (financial_account_id)
  )
  select exists (
    select 1 from compared
    where not has_expected_row
      or not has_input_row
      or expected_cents <> input_expected_cents
      or input_expected_cents < 0
      or input_reconciled_cents < 0
  ) into v_invalid;
  if v_invalid then
    raise exception using errcode = '22023', message = 'account breakdown does not match pending receipts';
  end if;

  select coalesce(sum(input.reconciled_cents), 0)::bigint
  into v_reconciled_cents
  from jsonb_to_recordset(v_breakdown) as input(financial_account_id uuid, expected_cents bigint, reconciled_cents bigint);
  if v_reconciled_cents <> p_reconciled_cents then
    raise exception using errcode = '22023', message = 'reconciled total does not match account breakdown';
  end if;

  v_variance := p_reconciled_cents - v_session.expected_cents;
  if v_variance <> 0 and nullif(btrim(p_variance_reason), '') is null then
    raise exception using errcode = '22023', message = 'variance reason is required';
  end if;

  insert into public.barber_cash_reconciliations (
    organization_id, cash_session_id, expected_cents, reconciled_cents,
    variance_cents, variance_reason, reconciled_on, reconciled_by, idempotency_key
  )
  select v_session.organization_id, v_session.id, v_session.expected_cents,
    p_reconciled_cents, v_variance, nullif(btrim(p_variance_reason), ''),
    (now() at time zone org.timezone)::date, auth.uid(), v_key
  from public.organizations org
  where org.id = v_session.organization_id
  returning id into v_reconciliation_id;

  select id into v_chart_id
  from public.chart_of_accounts
  where organization_id = v_session.organization_id and kind = 'REVENUE' and active
  order by code nulls last, created_at
  limit 1;
  if v_chart_id is null then
    raise exception using errcode = '22023', message = 'active revenue chart account is required';
  end if;

  for v_receipt in
    select * from public.barber_cash_receipts
    where cash_session_id = v_session.id and status = 'PENDING_RECONCILIATION'
    for update
  loop
    insert into public.appointment_receipt_classifications (
      organization_id, payment_transaction_id, financial_account_id,
      chart_account_id, payment_method, reference, created_by
    )
    values (
      v_session.organization_id, v_receipt.payment_transaction_id,
      v_receipt.financial_account_id, v_chart_id, v_receipt.payment_method,
      v_receipt.notes, auth.uid()
    )
    on conflict (organization_id, payment_transaction_id) do nothing;
    update public.barber_cash_receipts
    set status = 'RECONCILED'
    where id = v_receipt.id;
  end loop;

  update public.barber_cash_sessions
  set status = 'RECONCILED', reconciled_cents = p_reconciled_cents,
    variance_cents = v_variance,
    variance_reason = nullif(btrim(p_variance_reason), ''),
    reconciled_at = now(), reconciled_by = auth.uid(), updated_at = now()
  where id = v_session.id;
  return v_reconciliation_id;
exception when no_data_found then
  raise exception using errcode = 'P0002', message = 'cash session not found';
end;
$$;

create or replace function public.reconcile_barber_cash_session(
  p_session_id uuid, p_reconciled_cents bigint, p_variance_reason text default null
)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.reconcile_barber_cash_session(
    p_session_id, p_reconciled_cents, p_variance_reason, null::jsonb, null::text
  );
end;
$$;

grant execute on function public.reconcile_barber_cash_session(uuid, bigint, text, jsonb, text) to authenticated;

create or replace view public.appointment_cash_activity
with (security_invoker = true) as
select t.id as payment_transaction_id, t.organization_id, t.appointment_id,
  a.customer_id, a.payment_mode, t.provider, t.kind, t.amount_cents, t.currency,
  t.occurred_at, coalesce(rc.financial_account_id, m.financial_account_id) as financial_account_id,
  (coalesce(rc.financial_account_id, m.financial_account_id) is null) as needs_reconciliation,
  case when t.kind in ('CAPTURE', 'ADJUSTMENT') then t.amount_cents else -t.amount_cents end::bigint as signed_cents,
  case when reconciliation.id is not null then reconciliation.reconciled_at else t.occurred_at end as conciliation_at,
  reconciliation.id as reconciliation_id,
  case when reconciliation.id is not null then 'Conciliado | Barbeiro ' || barber.display_name || ' | ID ' || reconciliation.id::text else null end as reconciliation_label
from public.payment_transactions t
join public.appointments a on a.id = t.appointment_id and a.organization_id = t.organization_id
left join public.appointment_receipt_classifications rc
  on rc.organization_id = t.organization_id and rc.payment_transaction_id = t.id
left join public.payment_account_mappings m
  on m.organization_id = t.organization_id and m.provider = t.provider and m.payment_mode = a.payment_mode
left join public.barber_cash_receipts barber_receipt
  on barber_receipt.organization_id = t.organization_id and barber_receipt.payment_transaction_id = t.id
left join public.barber_cash_reconciliations reconciliation
  on reconciliation.organization_id = barber_receipt.organization_id and reconciliation.cash_session_id = barber_receipt.cash_session_id
left join public.barbers barber
  on barber.organization_id = barber_receipt.organization_id and barber.id = barber_receipt.received_by_barber_id;

grant select on public.appointment_cash_activity to authenticated;
