-- Reconstitui a liquidação no caixa para pagamentos de assinatura gravados
-- antes da RPC passar a criar financial_settlements.
-- Idempotência: uma entrada já liquidada nunca é inserida novamente.
insert into public.financial_settlements(
  organization_id,
  entry_id,
  financial_account_id,
  amount_cents,
  settled_on,
  payment_method,
  reference,
  idempotency_key,
  created_by
)
select
  e.organization_id,
  e.id,
  coalesce(
    (
      select fa.id
      from public.financial_accounts fa
      where fa.organization_id = e.organization_id
        and fa.id = e.preferred_financial_account_id
        and fa.active
    ),
    (
      select mapping.financial_account_id
      from public.payment_account_mappings mapping
      join public.financial_accounts mapped_account
        on mapped_account.organization_id = mapping.organization_id
       and mapped_account.id = mapping.financial_account_id
       and mapped_account.active
      where mapping.organization_id = e.organization_id
        and mapping.provider = 'MANUAL'
        and mapping.payment_mode = 'SUBSCRIPTION'
      order by mapping.created_at
      limit 1
    ),
    (
      select fa.id
      from public.financial_accounts fa
      where fa.organization_id = e.organization_id
        and fa.active
        and fa.kind = 'BANK'
      order by fa.created_at
      limit 1
    ),
    (
      select fa.id
      from public.financial_accounts fa
      where fa.organization_id = e.organization_id
        and fa.active
      order by fa.created_at
      limit 1
    )
  ),
  e.total_cents,
  coalesce(payment.paid_on, e.issue_date),
  case payment.method
    when 'CARD' then 'CARD'::public.financial_payment_method
    when 'PIX' then 'PIX'::public.financial_payment_method
    when 'BOLETO' then 'BOLETO'::public.financial_payment_method
    when 'CASH' then 'CASH'::public.financial_payment_method
    else 'OTHER'::public.financial_payment_method
  end,
  'Reconciliação automática de liquidação de assinatura legada',
  'subscription-payment-settlement:repair:' || e.id::text,
  e.created_by
from public.financial_entries e
left join lateral (
  select
    sp.method,
    coalesce(sp.created_at::date, cycle.paid_at::date) as paid_on
  from public.customer_subscription_cycles cycle
  left join public.subscription_payments sp
    on sp.organization_id = cycle.organization_id
   and sp.cycle_id = cycle.id
  where cycle.organization_id = e.organization_id
    and cycle.financial_entry_id = e.id
    and cycle.status = 'PAID'
  order by sp.created_at nulls last, cycle.paid_at
  limit 1
) payment on true
where e.source = 'SUBSCRIPTION'
  and not exists (
    select 1
    from public.financial_settlements existing
    where existing.organization_id = e.organization_id
      and existing.entry_id = e.id
      and existing.kind = 'SETTLEMENT'
  )
  and exists (
    select 1
    from public.customer_subscription_cycles cycle
    where cycle.organization_id = e.organization_id
      and cycle.financial_entry_id = e.id
      and cycle.status = 'PAID'
  )
on conflict (organization_id, idempotency_key) do nothing;

do $$
begin
  if exists (
    select 1
    from public.financial_entries e
    where e.source = 'SUBSCRIPTION'
      and exists (
        select 1
        from public.customer_subscription_cycles cycle
        where cycle.organization_id = e.organization_id
          and cycle.financial_entry_id = e.id
          and cycle.status = 'PAID'
      )
      and not exists (
        select 1
        from public.financial_settlements settlement
        where settlement.organization_id = e.organization_id
          and settlement.entry_id = e.id
          and settlement.kind = 'SETTLEMENT'
      )
      and not exists (
        select 1
        from public.financial_accounts account
        where account.organization_id = e.organization_id
          and account.active
      )
  ) then
    raise exception using errcode = '22023', message = 'active financial account is required to repair subscription settlements';
  end if;
end;
$$;
