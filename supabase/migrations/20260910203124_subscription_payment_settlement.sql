-- Recebimentos de assinatura devem liquidar a receita no caixa escolhido.
drop function if exists public.record_subscription_payment(
  uuid, uuid, uuid, bigint, public.subscription_payment_method, text, uuid, uuid, text
);

create or replace function public.record_subscription_payment(
  p_organization_id uuid,
  p_subscription_id uuid,
  p_cycle_id uuid,
  p_amount_cents bigint,
  p_method public.subscription_payment_method,
  p_idempotency_key text,
  p_chart_account_id uuid,
  p_financial_account_id uuid default null,
  p_external_reference text default null,
  p_paid_on date default current_date
)
returns public.subscription_payments
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_sub public.customer_subscriptions%rowtype;
  v_cycle public.customer_subscription_cycles%rowtype;
  v_payment public.subscription_payments;
  v_entry uuid;
  v_required bigint;
  v_financial_method public.financial_payment_method;
begin
  if not public.is_organization_owner(p_organization_id) then
    raise exception using errcode = '42501', message = 'subscription payment denied';
  end if;
  if p_amount_cents <= 0 or nullif(btrim(p_idempotency_key), '') is null then
    raise exception using errcode = '22023', message = 'positive amount and idempotency key are required';
  end if;
  select * into strict v_sub
    from public.customer_subscriptions
   where id = p_subscription_id and organization_id = p_organization_id
   for update;
  select * into strict v_cycle
    from public.customer_subscription_cycles
   where id = p_cycle_id and subscription_id = v_sub.id and organization_id = p_organization_id
   for update;
  if v_cycle.status not in ('OPEN', 'OVERDUE') then
    raise exception using errcode = '22023', message = 'subscription cycle is not payable';
  end if;
  select coalesce(sum(amount_cents), 0)::bigint into v_required
    from public.customer_subscription_cycles
   where subscription_id = v_sub.id and organization_id = p_organization_id
     and status in ('OPEN', 'OVERDUE');
  if not v_sub.upfront_payment then
    v_required := v_cycle.amount_cents;
  end if;
  if p_amount_cents <> v_required then
    raise exception using errcode = '22023', message = 'subscription payment amount does not match payable balance';
  end if;
  if p_financial_account_id is null then
    raise exception using errcode = '22023', message = 'active financial account is required';
  end if;
  if exists (
    select 1 from public.subscription_payments
     where organization_id = p_organization_id and idempotency_key = p_idempotency_key
  ) then
    return (
      select payment from public.subscription_payments payment
       where payment.organization_id = p_organization_id
         and payment.idempotency_key = p_idempotency_key
    );
  end if;

  v_financial_method := case p_method
    when 'CARD' then 'CARD'::public.financial_payment_method
    when 'PIX' then 'PIX'::public.financial_payment_method
    when 'BOLETO' then 'BOLETO'::public.financial_payment_method
    when 'CASH' then 'CASH'::public.financial_payment_method
    else 'OTHER'::public.financial_payment_method
  end;

  insert into public.financial_entries(
    organization_id, kind, source, description, issue_date, competence_date, due_date,
    total_cents, currency, chart_account_id, preferred_financial_account_id,
    counterparty_kind, customer_id, subscription_cycle_id, created_by
  ) values (
    p_organization_id, 'REVENUE', 'SUBSCRIPTION',
    case when v_sub.upfront_payment then 'Plano de assinatura à vista · ' || v_sub.id
         else 'Parcela de assinatura · ' || v_sub.id end,
    least(coalesce(p_paid_on, current_date), v_cycle.due_on),
    least(coalesce(p_paid_on, current_date), v_cycle.due_on), v_cycle.due_on,
    p_amount_cents, 'BRL', p_chart_account_id, p_financial_account_id,
    'CUSTOMER', v_sub.customer_id, v_cycle.id, auth.uid()
  ) returning id into v_entry;

  perform public.settle_financial_entry(
    v_entry,
    p_financial_account_id,
    p_amount_cents,
    coalesce(p_paid_on, current_date),
    v_financial_method,
    p_external_reference,
    'subscription-payment-settlement:' || p_idempotency_key
  );

  insert into public.subscription_payments(
    organization_id, subscription_id, cycle_id, amount_cents, method,
    idempotency_key, external_reference, created_by
  ) values (
    p_organization_id, v_sub.id, v_cycle.id, p_amount_cents, p_method,
    p_idempotency_key, p_external_reference, auth.uid()
  ) returning * into v_payment;

  if v_sub.upfront_payment then
    update public.customer_subscription_cycles
       set status = 'PAID', paid_at = now(), financial_entry_id = v_entry
     where subscription_id = v_sub.id and organization_id = p_organization_id
       and status in ('OPEN', 'OVERDUE');
  else
    update public.customer_subscription_cycles
       set status = 'PAID', paid_at = now(), financial_entry_id = v_entry
     where id = v_cycle.id;
  end if;
  if v_sub.status = 'PENDING_PAYMENT' and v_cycle.cycle_number = 1 then
    update public.customer_subscriptions
       set status = 'ACTIVE', updated_at = now()
     where id = v_sub.id;
  end if;
  return v_payment;
exception
  when no_data_found then
    raise exception using errcode = 'P0002', message = 'subscription or cycle not found';
end;
$$;

revoke all on function public.record_subscription_payment(
  uuid, uuid, uuid, bigint, public.subscription_payment_method, text, uuid, uuid, text, date
) from public, anon;
grant execute on function public.record_subscription_payment(
  uuid, uuid, uuid, bigint, public.subscription_payment_method, text, uuid, uuid, text, date
) to authenticated;
