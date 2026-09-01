-- Appointment total snapshots remain immutable booking history. This table records
-- the manager's final service amount as an append-only, tenant-scoped adjustment.
create table public.appointment_amount_adjustments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  appointment_id uuid not null,
  previous_total_cents bigint not null check (previous_total_cents >= 0),
  final_total_cents bigint not null check (final_total_cents >= 0),
  reason text not null check (char_length(btrim(reason)) between 3 and 500),
  idempotency_key text not null check (nullif(btrim(idempotency_key), '') is not null),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (id, organization_id),
  unique (organization_id, idempotency_key),
  foreign key (appointment_id, organization_id)
    references public.appointments(id, organization_id) on delete cascade
);

alter table public.appointment_amount_adjustments enable row level security;
alter table public.appointment_amount_adjustments force row level security;
create policy appointment_amount_adjustments_tenant_select
  on public.appointment_amount_adjustments
  for select to authenticated
  using (public.can_access_organization(organization_id));
create trigger appointment_amount_adjustments_append_only
  before update or delete on public.appointment_amount_adjustments
  for each row execute function public.prevent_financial_ledger_mutation();
grant select on public.appointment_amount_adjustments to authenticated;
revoke insert, update, delete on public.appointment_amount_adjustments from authenticated;

create or replace function public.sync_appointment_commission_to_final_amount(
  p_appointment_id uuid,
  p_final_total_cents bigint,
  p_adjustment_key text,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_appointment public.appointments%rowtype;
  v_list_total bigint;
  v_desired bigint;
  v_current bigint;
  v_delta bigint;
  v_entry record;
begin
  select * into strict v_appointment
  from public.appointments
  where id = p_appointment_id
  for update;

  select coalesce(sum(i.list_price_cents_snapshot * i.quantity), 0)::bigint
    into v_list_total
  from public.appointment_items i
  where i.organization_id = v_appointment.organization_id
    and i.appointment_id = v_appointment.id;

  if v_list_total <= 0 then
    return;
  end if;

  for v_entry in
    select
      cl.id as source_entry_id,
      cl.amount_cents as earned_cents,
      i.list_price_cents_snapshot,
      i.quantity,
      i.commission_mode_snapshot,
      i.commission_percentage_bps_snapshot
    from public.commission_ledger cl
    join public.appointment_items i
      on i.organization_id = cl.organization_id
     and i.id = cl.appointment_item_id
    where cl.organization_id = v_appointment.organization_id
      and cl.appointment_id = v_appointment.id
      and cl.kind = 'EARNED'
      and cl.source_entry_id is null
    order by i.position, cl.id
  loop
    if v_entry.commission_mode_snapshot = 'PERCENT' then
      v_desired := round(
        p_final_total_cents::numeric
          * (v_entry.list_price_cents_snapshot * v_entry.quantity)::numeric
          / v_list_total
          * v_entry.commission_percentage_bps / 10000
      )::bigint;
    else
      v_desired := v_entry.earned_cents;
    end if;

    select v_entry.earned_cents + coalesce(sum(cl.amount_cents), 0)::bigint
      into v_current
    from public.commission_ledger cl
    where cl.source_entry_id = v_entry.source_entry_id;

    v_delta := v_desired - v_current;
    if v_delta <> 0 then
      perform public.adjust_commission_entry(
        v_entry.source_entry_id,
        'ADJUSTMENT',
        v_delta,
        p_reason,
        'appointment-final-amount:' || p_adjustment_key || ':' || v_entry.source_entry_id
      );
    end if;
  end loop;
end;
$$;

revoke all on function public.sync_appointment_commission_to_final_amount(uuid, bigint, text, text) from public, anon, authenticated, service_role;

create or replace function public.record_manual_payment(
  p_appointment_id uuid,
  p_amount_cents bigint,
  p_reference text,
  p_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_appointment public.appointments%rowtype;
  v_order_id uuid;
  v_transaction_id uuid;
  v_net_paid bigint;
  v_effective_total bigint;
  v_outstanding bigint;
  v_due_now bigint;
begin
  if p_amount_cents <= 0 then
    raise exception using errcode = '22023', message = 'payment amount must be positive';
  end if;
  if nullif(btrim(p_idempotency_key), '') is null then
    raise exception using errcode = '22023', message = 'idempotency key is required';
  end if;
  select * into strict v_appointment
  from public.appointments where id = p_appointment_id for update;
  if not public.is_organization_owner(v_appointment.organization_id) then
    raise exception using errcode = '42501', message = 'organization owner required';
  end if;
  if not public.organization_allows_existing_operations(v_appointment.organization_id) then
    raise exception using errcode = '42501', message = 'organization access does not allow appointment operations';
  end if;
  if v_appointment.status in ('CANCELED', 'NO_SHOW', 'EXPIRED') then
    raise exception using errcode = '22023', message = 'cannot pay inactive appointment';
  end if;

  select pt.id into v_transaction_id
  from public.payment_transactions pt
  where pt.organization_id = v_appointment.organization_id
    and pt.idempotency_key = p_idempotency_key;
  if v_transaction_id is not null then
    if exists (
      select 1 from public.payment_transactions pt
      where pt.id = v_transaction_id
        and (
          pt.appointment_id <> v_appointment.id or pt.amount_cents <> p_amount_cents
          or pt.provider <> 'MANUAL' or pt.kind <> 'CAPTURE'
        )
    ) then
      raise exception using errcode = '22023', message = 'idempotency key belongs to another manual payment';
    end if;
    return v_transaction_id;
  end if;

  select coalesce(sum(case
    when kind in ('CAPTURE', 'ADJUSTMENT') then amount_cents
    when kind in ('REFUND', 'REVERSAL') then -amount_cents
  end), 0)::bigint
  into v_net_paid
  from public.payment_transactions
  where organization_id = v_appointment.organization_id
    and appointment_id = v_appointment.id;
  v_net_paid := greatest(v_net_paid, 0);

  select greatest(
    coalesce((
      select adjustment.final_total_cents
      from public.appointment_amount_adjustments adjustment
      where adjustment.organization_id = v_appointment.organization_id
        and adjustment.appointment_id = v_appointment.id
      order by adjustment.created_at desc, adjustment.id desc
      limit 1
    ), v_appointment.total_cents_snapshot) - v_appointment.amount_waived_cents,
    0
  )::bigint into v_effective_total;
  v_outstanding := greatest(v_effective_total - v_net_paid, 0);
  if p_amount_cents > v_outstanding then
    raise exception using errcode = '22023', message = 'manual payment exceeds outstanding balance';
  end if;

  insert into public.payment_orders (
    organization_id, appointment_id, provider, kind, status, amount_cents,
    currency, idempotency_key, external_order_id, metadata
  ) values (
    v_appointment.organization_id, v_appointment.id, 'MANUAL', 'BALANCE', 'PAID',
    p_amount_cents, v_appointment.currency, p_idempotency_key || ':order',
    nullif(btrim(p_reference), ''), jsonb_build_object('reference', p_reference)
  ) returning id into v_order_id;

  insert into public.payment_transactions (
    organization_id, payment_order_id, appointment_id, provider, kind,
    amount_cents, currency, idempotency_key, metadata
  ) values (
    v_appointment.organization_id, v_order_id, v_appointment.id, 'MANUAL', 'CAPTURE',
    p_amount_cents, v_appointment.currency, p_idempotency_key,
    jsonb_build_object('reference', p_reference)
  ) returning id into v_transaction_id;

  v_net_paid := v_net_paid + p_amount_cents;
  v_due_now := case v_appointment.payment_mode
    when 'FULL' then v_appointment.total_cents_snapshot
    when 'DEPOSIT' then v_appointment.deposit_required_cents_snapshot
    else 0
  end;
  if v_appointment.status in ('HELD', 'PENDING_PAYMENT')
     and v_net_paid >= v_due_now then
    update public.appointments
      set status = 'CONFIRMED', hold_expires_at = null, version = version + 1
      where id = v_appointment.id;
    update public.payment_orders
      set status = 'CANCELED', failure_code = 'SETTLED_MANUALLY',
          failure_message = 'Online checkout canceled after manual settlement'
      where appointment_id = v_appointment.id
        and organization_id = v_appointment.organization_id
        and provider = 'MERCADO_PAGO' and kind in ('DEPOSIT', 'FULL')
        and status in ('CREATED', 'PENDING', 'REQUIRES_ACTION');
    insert into public.appointment_status_events (
      organization_id, appointment_id, from_status, to_status, reason, actor_user_id
    ) values (
      v_appointment.organization_id, v_appointment.id, v_appointment.status,
      'CONFIRMED', 'manual_payment_recorded', auth.uid()
    );
  end if;
  return v_transaction_id;
exception
  when no_data_found then
    raise exception using errcode = 'P0002', message = 'appointment not found';
end;
$$;

create or replace view public.appointment_financial_summary
with (security_invoker = true)
as
with transaction_totals as (
  select
    t.organization_id,
    t.appointment_id,
    coalesce(sum(t.amount_cents) filter (where t.kind in ('CAPTURE', 'ADJUSTMENT')), 0)::bigint as captured_cents,
    coalesce(sum(t.amount_cents) filter (where t.kind in ('REFUND', 'REVERSAL')), 0)::bigint as refunded_cents
  from public.payment_transactions t
  group by t.organization_id, t.appointment_id
), effective_totals as (
  select
    a.organization_id,
    a.id as appointment_id,
    greatest(
      coalesce((
        select adjustment.final_total_cents
        from public.appointment_amount_adjustments adjustment
        where adjustment.organization_id = a.organization_id
          and adjustment.appointment_id = a.id
        order by adjustment.created_at desc, adjustment.id desc
        limit 1
      ), a.total_cents_snapshot) - a.amount_waived_cents,
      0
    )::bigint as total_cents
  from public.appointments a
), pending_refunds as (
  select po.organization_id, po.appointment_id, true as has_pending_refund
  from public.payment_orders po
  where po.kind = 'REFUND'
    and po.status in ('CREATED', 'PENDING', 'REQUIRES_ACTION', 'REFUND_PENDING')
  group by po.organization_id, po.appointment_id
)
select
  a.organization_id,
  a.id as appointment_id,
  coalesce(tt.captured_cents, 0)::bigint as captured_cents,
  coalesce(tt.refunded_cents, 0)::bigint as refunded_cents,
  greatest(coalesce(tt.captured_cents, 0) - coalesce(tt.refunded_cents, 0), 0)::bigint as net_paid_cents,
  greatest(
    et.total_cents - greatest(coalesce(tt.captured_cents, 0) - coalesce(tt.refunded_cents, 0), 0),
    0
  )::bigint as outstanding_cents,
  case
    when coalesce(pr.has_pending_refund, false) then 'REFUND_PENDING'::public.financial_status
    when coalesce(tt.refunded_cents, 0) > 0
      and greatest(coalesce(tt.captured_cents, 0) - coalesce(tt.refunded_cents, 0), 0) = 0
      then 'REFUNDED'::public.financial_status
    when coalesce(tt.refunded_cents, 0) > 0 then 'PARTIALLY_REFUNDED'::public.financial_status
    when coalesce(tt.captured_cents, 0) = 0 then 'UNPAID'::public.financial_status
    when coalesce(tt.captured_cents, 0) >= et.total_cents
      then 'PAID'::public.financial_status
    else 'PARTIAL'::public.financial_status
  end as financial_status
from public.appointments a
join effective_totals et
  on et.organization_id = a.organization_id and et.appointment_id = a.id
left join transaction_totals tt
  on tt.organization_id = a.organization_id and tt.appointment_id = a.id
left join pending_refunds pr
  on pr.organization_id = a.organization_id and pr.appointment_id = a.id;

drop function public.record_manual_appointment_receipt_v2(uuid, bigint, public.financial_payment_method, uuid, uuid, uuid, text, text, text, uuid[]);

create or replace function public.record_manual_appointment_receipt_v2(
  p_appointment_id uuid,
  p_amount_cents bigint,
  p_payment_method public.financial_payment_method,
  p_financial_account_id uuid,
  p_chart_account_id uuid,
  p_cost_center_id uuid default null,
  p_reference text default null,
  p_document_number text default null,
  p_idempotency_key text default null,
  p_tag_ids uuid[] default '{}',
  p_adjustment_reason text default null
)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_appointment public.appointments%rowtype;
  v_transaction_id uuid;
  v_existing public.appointment_receipt_classifications%rowtype;
  v_tag_ids uuid[];
  v_net_paid bigint;
  v_current_total bigint;
  v_final_total bigint;
  v_adjustment_id uuid;
  v_reason text;
begin
  select * into strict v_appointment from public.appointments where id=p_appointment_id for update;
  perform public.require_financial_owner(v_appointment.organization_id, 'appointment receipt');
  v_tag_ids := coalesce((select array_agg(tag_id order by tag_id) from unnest(coalesce(p_tag_ids, '{}'::uuid[])) as tag_id), '{}'::uuid[]);
  if v_appointment.status <> 'COMPLETED' then raise exception using errcode='22023', message='only completed appointment can be received'; end if;
  if p_amount_cents <= 0 then raise exception using errcode='22023', message='payment amount must be positive'; end if;
  if not exists (select 1 from public.financial_accounts where id=p_financial_account_id and organization_id=v_appointment.organization_id and active) then raise exception using errcode='22023', message='active financial account is required'; end if;
  if not exists (select 1 from public.chart_of_accounts where id=p_chart_account_id and organization_id=v_appointment.organization_id and kind='REVENUE' and active) then raise exception using errcode='22023', message='active revenue chart account is required'; end if;
  if p_cost_center_id is not null and not exists (select 1 from public.cost_centers where id=p_cost_center_id and organization_id=v_appointment.organization_id and active) then raise exception using errcode='22023', message='active cost center is required'; end if;
  if exists (select 1 from unnest(v_tag_ids) tag_id where not exists (select 1 from public.financial_tags where id=tag_id and organization_id=v_appointment.organization_id and active)) then raise exception using errcode='22023', message='all tags must be active and tenant scoped'; end if;

  select pt.id into v_transaction_id
  from public.payment_transactions pt
  where pt.organization_id = v_appointment.organization_id
    and pt.idempotency_key = p_idempotency_key;

  if v_transaction_id is null then
    select coalesce(sum(case
      when kind in ('CAPTURE', 'ADJUSTMENT') then amount_cents
      when kind in ('REFUND', 'REVERSAL') then -amount_cents
    end), 0)::bigint
    into v_net_paid
    from public.payment_transactions
    where organization_id = v_appointment.organization_id and appointment_id = v_appointment.id;
    v_net_paid := greatest(v_net_paid, 0);

    select coalesce((
      select adjustment.final_total_cents
      from public.appointment_amount_adjustments adjustment
      where adjustment.organization_id = v_appointment.organization_id and adjustment.appointment_id = v_appointment.id
      order by adjustment.created_at desc, adjustment.id desc limit 1
    ), v_appointment.total_cents_snapshot)::bigint into v_current_total;
    v_final_total := v_net_paid + p_amount_cents + v_appointment.amount_waived_cents;
    if v_final_total <> v_current_total then
      v_reason := nullif(btrim(p_adjustment_reason), '');
      if v_reason is null then
        raise exception using errcode='22023', message='adjustment reason is required when final amount changes';
      end if;
      if v_final_total < v_appointment.amount_waived_cents then
        raise exception using errcode='22023', message='final amount cannot be below waived amount';
      end if;
      insert into public.appointment_amount_adjustments (
        organization_id, appointment_id, previous_total_cents, final_total_cents,
        reason, idempotency_key, created_by
      ) values (
        v_appointment.organization_id, v_appointment.id, v_current_total, v_final_total,
        v_reason, p_idempotency_key, auth.uid()
      ) returning id into v_adjustment_id;
    end if;
  else
    if exists (
      select 1 from public.payment_transactions pt
      where pt.id = v_transaction_id
        and (pt.appointment_id <> v_appointment.id or pt.amount_cents <> p_amount_cents or pt.provider <> 'MANUAL' or pt.kind <> 'CAPTURE')
    ) then
      raise exception using errcode='22023', message='idempotency key belongs to another manual payment';
    end if;
  end if;

  v_transaction_id := public.record_manual_payment(p_appointment_id, p_amount_cents, p_reference, p_idempotency_key);
  if v_adjustment_id is not null then
    perform public.sync_appointment_commission_to_final_amount(
      v_appointment.id,
      v_final_total - v_appointment.amount_waived_cents,
      v_adjustment_id::text,
      v_reason
    );
  end if;
  select * into v_existing from public.appointment_receipt_classifications where organization_id=v_appointment.organization_id and payment_transaction_id=v_transaction_id;
  if found then
    if v_existing.financial_account_id <> p_financial_account_id or v_existing.chart_account_id <> p_chart_account_id or v_existing.cost_center_id is distinct from p_cost_center_id or v_existing.payment_method <> p_payment_method or v_existing.tag_ids <> v_tag_ids then raise exception using errcode='22023', message='idempotency key belongs to another receipt classification'; end if;
    return v_transaction_id;
  end if;
  insert into public.appointment_receipt_classifications (organization_id,payment_transaction_id,financial_account_id,chart_account_id,cost_center_id,payment_method,document_number,reference,tag_ids,created_by)
  values (v_appointment.organization_id,v_transaction_id,p_financial_account_id,p_chart_account_id,p_cost_center_id,p_payment_method,nullif(btrim(p_document_number),''),nullif(btrim(p_reference),''),v_tag_ids,auth.uid())
  on conflict (organization_id,payment_transaction_id) do nothing;
  return v_transaction_id;
exception when no_data_found then raise exception using errcode='P0002', message='appointment not found'; end; $$;

revoke all on function public.record_manual_appointment_receipt_v2(uuid,bigint,public.financial_payment_method,uuid,uuid,uuid,text,text,text,uuid[],text) from public, anon, authenticated, service_role;
grant execute on function public.record_manual_appointment_receipt_v2(uuid,bigint,public.financial_payment_method,uuid,uuid,uuid,text,text,text,uuid[],text) to authenticated;
