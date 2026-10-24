-- Shared, tenant-scoped contract numbers for subscriptions and project contracts.
create table if not exists public.organization_contract_sequences (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  last_number bigint not null default 0 check (last_number >= 0),
  updated_at timestamptz not null default now()
);
alter table public.organization_contract_sequences enable row level security;
alter table public.organization_contract_sequences force row level security;

alter table public.customer_subscriptions add column if not exists contract_number bigint;
alter table public.project_engagements add column if not exists contract_number bigint;

with contracts as (
  select organization_id, id, created_at, 'SUBSCRIPTION'::text as kind from public.customer_subscriptions
  union all
  select organization_id, id, created_at, 'PROJECT'::text as kind from public.project_engagements
), numbered as (
  select organization_id, id, kind,
         row_number() over (partition by organization_id order by created_at, kind, id) as contract_number
    from contracts
)
update public.customer_subscriptions subscription
   set contract_number = numbered.contract_number
  from numbered
 where numbered.kind = 'SUBSCRIPTION'
   and numbered.organization_id = subscription.organization_id
   and numbered.id = subscription.id
   and subscription.contract_number is null;

with contracts as (
  select organization_id, id, created_at, 'SUBSCRIPTION'::text as kind from public.customer_subscriptions
  union all
  select organization_id, id, created_at, 'PROJECT'::text as kind from public.project_engagements
), numbered as (
  select organization_id, id, kind,
         row_number() over (partition by organization_id order by created_at, kind, id) as contract_number
    from contracts
)
update public.project_engagements engagement
   set contract_number = numbered.contract_number
  from numbered
 where numbered.kind = 'PROJECT'
   and numbered.organization_id = engagement.organization_id
   and numbered.id = engagement.id
   and engagement.contract_number is null;

insert into public.organization_contract_sequences(organization_id, last_number)
select organization_id, max(contract_number)
  from (
    select organization_id, contract_number from public.customer_subscriptions
    union all
    select organization_id, contract_number from public.project_engagements
  ) contracts
 group by organization_id
on conflict (organization_id) do update
  set last_number = greatest(public.organization_contract_sequences.last_number, excluded.last_number),
      updated_at = now();

alter table public.customer_subscriptions alter column contract_number set not null;
alter table public.project_engagements alter column contract_number set not null;
create unique index if not exists customer_subscriptions_contract_number_unique
  on public.customer_subscriptions(organization_id, contract_number);
create unique index if not exists project_engagements_contract_number_unique
  on public.project_engagements(organization_id, contract_number);

create or replace function public.next_organization_contract_number(p_organization_id uuid)
returns bigint
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_number bigint;
begin
  insert into public.organization_contract_sequences(organization_id, last_number)
  values (p_organization_id, 1)
  on conflict (organization_id) do update
    set last_number = public.organization_contract_sequences.last_number + 1,
        updated_at = now()
  returning last_number into v_number;
  return v_number;
end;
$$;
revoke all on function public.next_organization_contract_number(uuid) from public, anon, authenticated;

create or replace function public.assign_organization_contract_number()
returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  new.contract_number := public.next_organization_contract_number(new.organization_id);
  return new;
end;
$$;
revoke all on function public.assign_organization_contract_number() from public, anon, authenticated;
drop trigger if exists customer_subscriptions_assign_contract_number on public.customer_subscriptions;
create trigger customer_subscriptions_assign_contract_number
  before insert on public.customer_subscriptions
  for each row execute function public.assign_organization_contract_number();
drop trigger if exists project_engagements_assign_contract_number on public.project_engagements;
create trigger project_engagements_assign_contract_number
  before insert on public.project_engagements
  for each row execute function public.assign_organization_contract_number();

-- Use one stable description format in both financial modules.
create or replace function public.apply_contract_number_to_financial_entry()
returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_contract_number bigint;
  v_item_number integer;
  v_item_count integer;
begin
  if new.canceled_at is not null then return new; end if;

  if new.source = 'SUBSCRIPTION' and new.subscription_cycle_id is not null then
    select subscription.contract_number, cycle.cycle_number,
           (select count(*)::integer from public.customer_subscription_cycles all_cycles
             where all_cycles.subscription_id = cycle.subscription_id
               and all_cycles.organization_id = cycle.organization_id)
      into v_contract_number, v_item_number, v_item_count
      from public.customer_subscription_cycles cycle
      join public.customer_subscriptions subscription
        on subscription.id = cycle.subscription_id
       and subscription.organization_id = cycle.organization_id
     where cycle.id = new.subscription_cycle_id
       and cycle.organization_id = new.organization_id;
    if v_contract_number is not null then
      new.description := format('Assinatura contratada · Parcela %s/%s · Contrato nº %s', v_item_number, v_item_count, v_contract_number);
      new.document_number := format('Contrato nº %s', v_contract_number);
    end if;
  elsif new.source = 'PROJECT' and new.project_installment_id is not null then
    select engagement.contract_number, installment.installment_number,
           greatest((select max(all_installments.installment_number)
                       from public.project_installments all_installments
                      where all_installments.engagement_id = installment.engagement_id
                        and all_installments.organization_id = installment.organization_id), 1)::integer
      into v_contract_number, v_item_number, v_item_count
      from public.project_installments installment
      join public.project_engagements engagement
        on engagement.id = installment.engagement_id
       and engagement.organization_id = installment.organization_id
     where installment.id = new.project_installment_id
       and installment.organization_id = new.organization_id;
    if v_contract_number is not null then
      new.description := format('Contrato de projeto · Parcela %s/%s · Contrato nº %s', v_item_number, v_item_count, v_contract_number);
      new.document_number := format('Contrato nº %s', v_contract_number);
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.apply_contract_number_to_financial_entry() from public, anon, authenticated;
drop trigger if exists financial_entries_apply_contract_number on public.financial_entries;
create trigger financial_entries_apply_contract_number
  before insert or update of source, description, document_number, project_installment_id, subscription_cycle_id, organization_id, canceled_at
  on public.financial_entries
  for each row execute function public.apply_contract_number_to_financial_entry();

-- Create receivables atomically with accepted, non-upfront subscription cycles.
create unique index if not exists financial_entries_subscription_cycle_open_unique
  on public.financial_entries(organization_id, subscription_cycle_id)
  where source = 'SUBSCRIPTION' and subscription_cycle_id is not null and canceled_at is null;

create or replace function public.create_subscription_cycle_receivable()
returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_subscription public.customer_subscriptions%rowtype;
  v_chart_account_id uuid;
  v_financial_entry_id uuid;
begin
  if new.status not in ('OPEN', 'OVERDUE') or new.financial_entry_id is not null then return new; end if;

  select * into v_subscription
    from public.customer_subscriptions
   where id = new.subscription_id and organization_id = new.organization_id;
  if not found or v_subscription.status not in ('ACTIVE', 'PENDING_PAYMENT') or v_subscription.upfront_payment then
    return new;
  end if;

  select id into v_chart_account_id
    from public.chart_of_accounts
   where organization_id = new.organization_id and kind = 'REVENUE' and active
   order by created_at, id limit 1;
  if v_chart_account_id is null then
    raise exception using errcode = '22023', message = 'active revenue chart account is required to accept a subscription';
  end if;

  insert into public.financial_entries(
    organization_id, kind, source, description, issue_date, competence_date, due_date, total_cents,
    currency, chart_account_id, counterparty_kind, customer_id, subscription_cycle_id
  ) values (
    new.organization_id, 'REVENUE', 'SUBSCRIPTION',
    format('Assinatura contratada · Parcela %s · Contrato nº %s', new.cycle_number, v_subscription.contract_number),
    least(current_date, new.due_on), least(current_date, new.due_on), new.due_on, new.amount_cents,
    'BRL', v_chart_account_id, 'CUSTOMER', v_subscription.customer_id, new.id
  )
  on conflict (organization_id, subscription_cycle_id)
    where source = 'SUBSCRIPTION' and subscription_cycle_id is not null and canceled_at is null
  do nothing
  returning id into v_financial_entry_id;

  if v_financial_entry_id is null then
    select id into v_financial_entry_id from public.financial_entries
     where organization_id = new.organization_id and subscription_cycle_id = new.id
       and source = 'SUBSCRIPTION' and canceled_at is null
     order by created_at desc limit 1;
  end if;
  if v_financial_entry_id is not null then
    update public.customer_subscription_cycles
       set financial_entry_id = v_financial_entry_id
     where id = new.id and organization_id = new.organization_id
       and financial_entry_id is distinct from v_financial_entry_id;
  end if;
  return new;
end;
$$;
revoke all on function public.create_subscription_cycle_receivable() from public, anon, authenticated;
drop trigger if exists customer_subscription_cycle_create_receivable on public.customer_subscription_cycles;
create trigger customer_subscription_cycle_create_receivable
  after insert or update of status, financial_entry_id on public.customer_subscription_cycles
  for each row execute function public.create_subscription_cycle_receivable();

-- Backfill cycles accepted before this release; paid and upfront cycles are excluded.
do $$
declare
  v_cycle record;
  v_chart_account_id uuid;
  v_entry_id uuid;
begin
  for v_cycle in
    select cycle.*,
           subscription.customer_id,
           subscription.contract_number
      from public.customer_subscription_cycles cycle
      join public.customer_subscriptions subscription
        on subscription.id = cycle.subscription_id and subscription.organization_id = cycle.organization_id
     where subscription.status in ('ACTIVE', 'PENDING_PAYMENT')
       and not subscription.upfront_payment
       and cycle.status in ('OPEN', 'OVERDUE')
       and cycle.financial_entry_id is null
       and not exists (
         select 1 from public.financial_entries entry
          where entry.organization_id = cycle.organization_id
            and entry.subscription_cycle_id = cycle.id
            and entry.source = 'SUBSCRIPTION' and entry.canceled_at is null
       )
  loop
    select id into v_chart_account_id
      from public.chart_of_accounts
     where organization_id = v_cycle.organization_id and kind = 'REVENUE' and active
     order by created_at, id limit 1;
    if v_chart_account_id is null then
      raise exception using errcode = '22023', message = 'active revenue chart account is required to backfill subscription receivables';
    end if;
    insert into public.financial_entries(
      organization_id, kind, source, description, issue_date, competence_date, due_date, total_cents,
      currency, chart_account_id, counterparty_kind, customer_id, subscription_cycle_id
    ) values (
      v_cycle.organization_id, 'REVENUE', 'SUBSCRIPTION',
      format('Assinatura contratada · Parcela %s · Contrato nº %s', v_cycle.cycle_number, v_cycle.contract_number),
      least(current_date, v_cycle.due_on), least(current_date, v_cycle.due_on), v_cycle.due_on, v_cycle.amount_cents,
      'BRL', v_chart_account_id, 'CUSTOMER', v_cycle.customer_id, v_cycle.id
    ) returning id into v_entry_id;
    update public.customer_subscription_cycles
       set financial_entry_id = v_entry_id
     where id = v_cycle.id and organization_id = v_cycle.organization_id;
  end loop;
end;
$$;

-- Reuse the receivable created at acceptance when the manager records payment.
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
language plpgsql security definer set search_path = public, pg_temp as $$
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
  select * into strict v_sub from public.customer_subscriptions
   where id = p_subscription_id and organization_id = p_organization_id for update;
  select * into strict v_cycle from public.customer_subscription_cycles
   where id = p_cycle_id and subscription_id = v_sub.id and organization_id = p_organization_id for update;
  if v_cycle.status not in ('OPEN', 'OVERDUE') then
    raise exception using errcode = '22023', message = 'subscription cycle is not payable';
  end if;
  select coalesce(sum(amount_cents), 0)::bigint into v_required
    from public.customer_subscription_cycles
   where subscription_id = v_sub.id and organization_id = p_organization_id
     and status in ('OPEN', 'OVERDUE');
  if not v_sub.upfront_payment then v_required := v_cycle.amount_cents; end if;
  if p_amount_cents <> v_required then
    raise exception using errcode = '22023', message = 'subscription payment amount does not match payable balance';
  end if;
  if p_financial_account_id is null then
    raise exception using errcode = '22023', message = 'active financial account is required';
  end if;
  if exists (select 1 from public.subscription_payments
    where organization_id = p_organization_id and idempotency_key = p_idempotency_key) then
    return (select payment from public.subscription_payments payment
      where payment.organization_id = p_organization_id and payment.idempotency_key = p_idempotency_key);
  end if;
  v_financial_method := case p_method
    when 'CARD' then 'CARD'::public.financial_payment_method
    when 'PIX' then 'PIX'::public.financial_payment_method
    when 'BOLETO' then 'BOLETO'::public.financial_payment_method
    when 'CASH' then 'CASH'::public.financial_payment_method
    else 'OTHER'::public.financial_payment_method
  end;
  select id into v_entry from public.financial_entries
   where organization_id = p_organization_id and subscription_cycle_id = v_cycle.id
     and source = 'SUBSCRIPTION' and canceled_at is null
   order by created_at desc limit 1 for update;
  if v_entry is null then
    insert into public.financial_entries(
      organization_id, kind, source, description, issue_date, competence_date, due_date,
      total_cents, currency, chart_account_id, preferred_financial_account_id,
      counterparty_kind, customer_id, subscription_cycle_id, created_by
    ) values (
      p_organization_id, 'REVENUE', 'SUBSCRIPTION',
      public.subscription_financial_entry_description(v_cycle.id),
      least(coalesce(p_paid_on, current_date), v_cycle.due_on),
      least(coalesce(p_paid_on, current_date), v_cycle.due_on), v_cycle.due_on,
      p_amount_cents, 'BRL', p_chart_account_id, p_financial_account_id,
      'CUSTOMER', v_sub.customer_id, v_cycle.id, auth.uid()
    ) returning id into v_entry;
  else
    update public.financial_entries
       set preferred_financial_account_id = p_financial_account_id,
           chart_account_id = p_chart_account_id
     where id = v_entry and organization_id = p_organization_id;
  end if;
  perform public.settle_financial_entry(
    v_entry, p_financial_account_id, p_amount_cents,
    coalesce(p_paid_on, current_date), v_financial_method, p_external_reference,
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
    update public.customer_subscriptions set status = 'ACTIVE', updated_at = now()
     where id = v_sub.id and organization_id = p_organization_id;
  end if;
  perform public.schedule_fixed_subscription_sessions(p_organization_id, v_sub.id);
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
