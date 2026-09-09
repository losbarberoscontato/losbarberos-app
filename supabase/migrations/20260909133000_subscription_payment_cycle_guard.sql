-- Impede dupla liquidação do mesmo ciclo.
create or replace function public.record_subscription_payment(
  p_organization_id uuid,
  p_subscription_id uuid,
  p_cycle_id uuid,
  p_amount_cents bigint,
  p_method public.subscription_payment_method,
  p_idempotency_key text,
  p_chart_account_id uuid,
  p_financial_account_id uuid default null,
  p_external_reference text default null
)
returns public.subscription_payments
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_sub public.customer_subscriptions%rowtype;
  v_cycle public.customer_subscription_cycles%rowtype;
  v_payment public.subscription_payments;
  v_entry uuid;
begin
  if not public.is_organization_owner(p_organization_id) then raise exception using errcode='42501', message='subscription payment denied'; end if;
  select * into strict v_sub from public.customer_subscriptions where id=p_subscription_id and organization_id=p_organization_id for update;
  select * into strict v_cycle from public.customer_subscription_cycles where id=p_cycle_id and subscription_id=v_sub.id and organization_id=p_organization_id for update;
  if v_cycle.status not in ('OPEN', 'OVERDUE') then raise exception using errcode='22023', message='subscription cycle is not payable'; end if;
  if p_amount_cents <> v_cycle.amount_cents then raise exception using errcode='22023', message='subscription cycle requires full payment'; end if;
  if exists (select 1 from public.subscription_payments where organization_id=p_organization_id and idempotency_key=p_idempotency_key) then return (select p from public.subscription_payments p where p.organization_id=p_organization_id and p.idempotency_key=p_idempotency_key); end if;
  insert into public.financial_entries(organization_id,kind,source,description,issue_date,competence_date,due_date,total_cents,currency,chart_account_id,preferred_financial_account_id,counterparty_kind,customer_id,subscription_cycle_id,created_by)
  values(p_organization_id,'REVENUE','SUBSCRIPTION','Parcela de assinatura · '||v_sub.id,current_date,current_date,v_cycle.due_on,p_amount_cents,'BRL',p_chart_account_id,p_financial_account_id,'CUSTOMER',v_sub.customer_id,v_cycle.id,auth.uid()) returning id into v_entry;
  insert into public.subscription_payments(organization_id,subscription_id,cycle_id,amount_cents,method,idempotency_key,external_reference,created_by) values(p_organization_id,v_sub.id,v_cycle.id,p_amount_cents,p_method,p_idempotency_key,p_external_reference,auth.uid()) returning * into v_payment;
  update public.customer_subscription_cycles set status='PAID',paid_at=now(),financial_entry_id=v_entry where id=v_cycle.id;
  if v_sub.status='PENDING_PAYMENT' and v_cycle.cycle_number=1 then update public.customer_subscriptions set status='ACTIVE',updated_at=now() where id=v_sub.id; end if;
  return v_payment;
end;
$$;

revoke all on function public.record_subscription_payment(uuid,uuid,uuid,bigint,public.subscription_payment_method,text,uuid,uuid,text) from public, anon;
grant execute on function public.record_subscription_payment(uuid,uuid,uuid,bigint,public.subscription_payment_method,text,uuid,uuid,text) to authenticated;
