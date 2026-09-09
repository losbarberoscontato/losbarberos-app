create or replace function public.activate_customer_subscription(
  p_organization_id uuid, p_subscription_id uuid, p_start_date date, p_first_due_date date, p_idempotency_key text
)
returns public.customer_subscriptions
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_sub public.customer_subscriptions%rowtype; v_plan public.subscription_plan_versions%rowtype; v_cycles integer; i integer; j integer; v_start date; v_end date; v_due date; v_cycle public.customer_subscription_cycles%rowtype;
begin
  if not public.is_organization_owner(p_organization_id) then raise exception using errcode='42501', message='subscription approval denied'; end if;
  select * into strict v_sub from public.customer_subscriptions where id=p_subscription_id and organization_id=p_organization_id for update;
  if v_sub.status in ('ACTIVE','PENDING_PAYMENT') then return v_sub; end if;
  if v_sub.status <> 'REQUESTED' or v_sub.contract_accepted_at is null then raise exception using errcode='22023', message='contract must be accepted before approval'; end if;
  select * into strict v_plan from public.subscription_plan_versions where id=v_sub.plan_version_id and organization_id=p_organization_id;
  v_cycles := case when v_plan.billing_period='BIWEEKLY' then v_plan.duration_months*2 else v_plan.duration_months end;
  update public.customer_subscriptions set status='PENDING_PAYMENT',start_date=p_start_date,end_date=case when v_plan.billing_period='BIWEEKLY' then p_start_date + (v_cycles*15-1) else (p_start_date + (v_plan.duration_months||' months')::interval - interval '1 day')::date end,first_due_date=p_first_due_date,due_day=extract(day from p_first_due_date)::smallint,updated_at=now() where id=v_sub.id returning * into v_sub;
  for i in 1..v_cycles loop
    v_start := case when v_plan.billing_period='BIWEEKLY' then p_start_date + ((i-1)*15) else (p_start_date + ((i-1)||' months')::interval)::date end;
    v_end := case when v_plan.billing_period='BIWEEKLY' then v_start + 14 else (v_start + interval '1 month' - interval '1 day')::date end;
    v_due := case when i=1 then p_first_due_date when v_plan.billing_period='BIWEEKLY' then p_first_due_date + ((i-1)*15) else make_date(extract(year from v_start)::int, extract(month from v_start)::int, least(v_sub.due_day, extract(day from (date_trunc('month', v_start) + interval '1 month - 1 day'))::int)) end;
    insert into public.customer_subscription_cycles(organization_id,subscription_id,cycle_number,starts_on,ends_on,due_on,amount_cents,status) values(p_organization_id,v_sub.id,i,v_start,v_end,v_due,v_plan.price_cents,'OPEN') returning * into v_cycle;
    for j in 1..v_plan.sessions_per_cycle loop insert into public.customer_subscription_sessions(organization_id,subscription_id,cycle_id,session_number,available_until) values(p_organization_id,v_sub.id,v_cycle.id,j,v_end); end loop;
  end loop;
  insert into public.subscription_events(organization_id,subscription_id,event_type,actor_user_id,idempotency_key) values(p_organization_id,v_sub.id,'APPROVED_PENDING_PAYMENT',auth.uid(),p_idempotency_key) on conflict do nothing;
  return v_sub;
end $$;

create or replace function public.record_subscription_payment(
  p_organization_id uuid, p_subscription_id uuid, p_cycle_id uuid, p_amount_cents bigint, p_method public.subscription_payment_method, p_idempotency_key text, p_chart_account_id uuid, p_financial_account_id uuid default null, p_external_reference text default null
)
returns public.subscription_payments
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_sub public.customer_subscriptions%rowtype; v_cycle public.customer_subscription_cycles%rowtype; v_payment public.subscription_payments; v_entry uuid;
begin
  if not public.is_organization_owner(p_organization_id) then raise exception using errcode='42501', message='subscription payment denied'; end if;
  select * into strict v_sub from public.customer_subscriptions where id=p_subscription_id and organization_id=p_organization_id for update;
  select * into strict v_cycle from public.customer_subscription_cycles where id=p_cycle_id and subscription_id=v_sub.id and organization_id=p_organization_id for update;
  if p_amount_cents <> v_cycle.amount_cents then raise exception using errcode='22023', message='subscription cycle requires full payment'; end if;
  if exists (select 1 from public.subscription_payments where organization_id=p_organization_id and idempotency_key=p_idempotency_key) then return (select p from public.subscription_payments p where p.organization_id=p_organization_id and p.idempotency_key=p_idempotency_key); end if;
  insert into public.financial_entries(organization_id,kind,source,description,issue_date,competence_date,due_date,total_cents,currency,chart_account_id,preferred_financial_account_id,counterparty_kind,customer_id,subscription_cycle_id,created_by)
  values(p_organization_id,'REVENUE','SUBSCRIPTION','Parcela de assinatura · '||v_sub.id,current_date,current_date,v_cycle.due_on,p_amount_cents,'BRL',p_chart_account_id,p_financial_account_id,'CUSTOMER',v_sub.customer_id,v_cycle.id,auth.uid()) returning id into v_entry;
  insert into public.subscription_payments(organization_id,subscription_id,cycle_id,amount_cents,method,idempotency_key,external_reference,created_by) values(p_organization_id,v_sub.id,v_cycle.id,p_amount_cents,p_method,p_idempotency_key,p_external_reference,auth.uid()) returning * into v_payment;
  update public.customer_subscription_cycles set status='PAID',paid_at=now(),financial_entry_id=v_entry where id=v_cycle.id;
  if v_sub.status='PENDING_PAYMENT' and v_cycle.cycle_number=1 then update public.customer_subscriptions set status='ACTIVE',updated_at=now() where id=v_sub.id; end if;
  return v_payment;
end $$;
