-- Appointment receipt tags are classification metadata; payment_transactions
-- remains the source of truth for the received amount.
alter table public.appointment_receipt_classifications
  add column tag_ids uuid[] not null default '{}'::uuid[];

drop function public.record_manual_appointment_receipt_v2(uuid,bigint,public.financial_payment_method,uuid,uuid,uuid,text,text,text);

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
  p_tag_ids uuid[] default '{}'::uuid[]
)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_appointment public.appointments%rowtype;
  v_transaction_id uuid;
  v_existing public.appointment_receipt_classifications%rowtype;
  v_tag_ids uuid[];
begin
  select * into strict v_appointment from public.appointments where id=p_appointment_id for update;
  perform public.require_financial_owner(v_appointment.organization_id, 'appointment receipt');
  v_tag_ids := coalesce((select array_agg(tag_id order by tag_id) from unnest(coalesce(p_tag_ids, '{}'::uuid[])) as tag_id), '{}'::uuid[]);
  if v_appointment.status <> 'COMPLETED' then raise exception using errcode='22023', message='only completed appointment can be received'; end if;
  if not exists (select 1 from public.financial_accounts where id=p_financial_account_id and organization_id=v_appointment.organization_id and active) then raise exception using errcode='22023', message='active financial account is required'; end if;
  if not exists (select 1 from public.chart_of_accounts where id=p_chart_account_id and organization_id=v_appointment.organization_id and kind='REVENUE' and active) then raise exception using errcode='22023', message='active revenue chart account is required'; end if;
  if p_cost_center_id is not null and not exists (select 1 from public.cost_centers where id=p_cost_center_id and organization_id=v_appointment.organization_id and active) then raise exception using errcode='22023', message='active cost center is required'; end if;
  if exists (select 1 from unnest(v_tag_ids) tag_id where not exists (select 1 from public.financial_tags where id=tag_id and organization_id=v_appointment.organization_id and active)) then raise exception using errcode='22023', message='all tags must be active and tenant scoped'; end if;
  v_transaction_id := public.record_manual_payment(p_appointment_id, p_amount_cents, p_reference, p_idempotency_key);
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

revoke all on function public.record_manual_appointment_receipt_v2(uuid,bigint,public.financial_payment_method,uuid,uuid,uuid,text,text,text,uuid[]) from public, anon, authenticated, service_role;
grant execute on function public.record_manual_appointment_receipt_v2(uuid,bigint,public.financial_payment_method,uuid,uuid,uuid,text,text,text,uuid[]) to authenticated;
