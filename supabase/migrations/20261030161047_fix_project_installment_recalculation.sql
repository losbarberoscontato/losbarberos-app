create or replace view public.project_installment_finance
with (security_invoker = true) as
select i.id, i.organization_id, i.engagement_id, i.installment_number, i.due_on,
  i.amount_cents, i.status, i.paid_at, e.id as financial_entry_id,
  coalesce(s.settled_cents, 0)::bigint as settled_cents,
  greatest(i.amount_cents - coalesce(s.settled_cents, 0), 0)::bigint as remaining_cents,
  s.last_paid_at, s.payment_method, s.financial_account_id, a.name as financial_account_name,
  s.received_by, p.display_name as received_by_name
from public.project_installments i
left join public.financial_entries e
  on e.project_installment_id = i.id and e.organization_id = i.organization_id and e.canceled_at is null
left join lateral (
  select coalesce(sum(case when fs.kind = 'SETTLEMENT' then fs.amount_cents else -fs.amount_cents end), 0)::bigint settled_cents,
    max(fs.settled_on) filter (where fs.kind = 'SETTLEMENT') last_paid_at,
    (array_agg(fs.payment_method order by fs.settled_on desc, fs.created_at desc) filter (where fs.kind = 'SETTLEMENT'))[1] payment_method,
    (array_agg(fs.financial_account_id order by fs.settled_on desc, fs.created_at desc) filter (where fs.kind = 'SETTLEMENT'))[1] financial_account_id,
    (array_agg(fs.created_by order by fs.settled_on desc, fs.created_at desc) filter (where fs.kind = 'SETTLEMENT'))[1] received_by
  from public.financial_settlements fs where fs.entry_id = e.id and fs.organization_id = e.organization_id
) s on true
left join public.financial_accounts a on a.id = s.financial_account_id and a.organization_id = i.organization_id
left join public.profiles p on p.id = s.received_by;

grant select on public.project_installment_finance to authenticated;

create or replace function public.save_project_contract(
  p_organization_id uuid,
  p_engagement_id uuid,
  p_project_id uuid,
  p_customer_id uuid,
  p_package_id uuid,
  p_status text,
  p_contracted_cents bigint,
  p_entry_cents bigint,
  p_installments_count integer,
  p_first_due_on date
) returns uuid
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_id uuid := p_engagement_id;
  v_user uuid := auth.uid();
  v_chart uuid;
  v_installment uuid;
  v_amount bigint;
  v_balance bigint;
  v_due date;
  v_existing_status text;
  v_accepted_at timestamptz;
  v_paid_count integer := 0;
  v_partial_count integer := 0;
  v_last_locked_number integer := 0;
  v_paid_total bigint := 0;
  v_partial_remaining bigint := 0;
  v_open_count integer := 0;
  v_schedule_start date;
  v_item record;
begin
  if not public.is_organization_owner(p_organization_id) then raise exception using errcode = '42501', message = 'project contract write denied'; end if;
  if p_contracted_cents < 0 or p_entry_cents < 0 or p_entry_cents > p_contracted_cents or p_installments_count < 1 or p_first_due_on is null then
    raise exception using errcode = '22023', message = 'invalid project contract terms';
  end if;
  if p_status not in ('PROPOSAL','ACTIVE','COMPLETED','CANCELED') then raise exception using errcode = '22023', message = 'invalid project contract status'; end if;
  if not exists (select 1 from public.projects where id = p_project_id and organization_id = p_organization_id) then raise exception using errcode = '22023', message = 'project not found'; end if;
  if not exists (select 1 from public.customers where id = p_customer_id and organization_id = p_organization_id and active) then raise exception using errcode = '22023', message = 'customer not found'; end if;
  if not exists (select 1 from public.project_packages where id = p_package_id and project_id = p_project_id and organization_id = p_organization_id and active) then raise exception using errcode = '22023', message = 'package not found'; end if;

  if v_id is null then
    insert into public.project_engagements(
      organization_id, project_id, customer_id, package_id, status, contracted_cents,
      proposal_sent_at, created_by, contract_entry_cents, contract_installments_count,
      contract_entry_due_on, contract_first_due_on, contract_financial_terms_configured
    ) values (
      p_organization_id, p_project_id, p_customer_id, p_package_id, p_status, p_contracted_cents,
      case when p_status = 'PROPOSAL' then now() else null end, v_user, p_entry_cents,
      p_installments_count, current_date, p_first_due_on, true
    ) returning id into v_id;
  else
    select status, accepted_at into v_existing_status, v_accepted_at
      from public.project_engagements
     where id = v_id and organization_id = p_organization_id and project_id = p_project_id
     for update;
    if v_existing_status is null then raise exception using errcode = 'P0002', message = 'project contract not found'; end if;
    update public.project_engagements
       set customer_id = p_customer_id, package_id = p_package_id, status = p_status,
           contracted_cents = p_contracted_cents, contract_entry_cents = p_entry_cents,
           contract_installments_count = p_installments_count,
           contract_first_due_on = p_first_due_on,
           contract_financial_terms_configured = true,
           updated_at = now()
     where id = v_id and organization_id = p_organization_id;

    if v_accepted_at is not null and p_status in ('ACTIVE', 'COMPLETED') then
      for v_item in
        select entry.id as financial_entry_id
          from public.project_installments installment
          join public.financial_entries entry
            on entry.project_installment_id = installment.id
           and entry.organization_id = installment.organization_id
           and entry.source = 'PROJECT'
         where installment.engagement_id = v_id and installment.organization_id = p_organization_id
           and installment.status = 'OPEN' and entry.canceled_at is null
           and not exists (select 1 from public.financial_settlements settlement
             where settlement.entry_id = entry.id and settlement.organization_id = entry.organization_id)
         for update of installment, entry
      loop
        perform public.cancel_financial_entry(v_item.financial_entry_id, 'Recalculo do contrato de projeto');
      end loop;
      update public.project_installments installment set status = 'CANCELED'
       where installment.engagement_id = v_id and installment.organization_id = p_organization_id
         and installment.status = 'OPEN'
         and not exists (select 1 from public.financial_entries entry
           join public.financial_settlements settlement
             on settlement.entry_id = entry.id and settlement.organization_id = entry.organization_id
          where entry.project_installment_id = installment.id
            and entry.organization_id = installment.organization_id);
    end if;
  end if;

  select accepted_at into v_accepted_at
    from public.project_engagements
   where id = v_id and organization_id = p_organization_id;
  if p_status = 'PROPOSAL' or v_accepted_at is null or p_status not in ('ACTIVE', 'COMPLETED') then
    return v_id;
  end if;

  select id into v_chart from public.chart_of_accounts where organization_id = p_organization_id and kind = 'REVENUE' and active order by created_at limit 1;
  if v_chart is null then raise exception using errcode = '22023', message = 'active revenue chart account is required'; end if;

  insert into public.project_installments(organization_id, engagement_id, installment_number, due_on, amount_cents, status)
  values (p_organization_id, v_id, 0, current_date, p_entry_cents, 'OPEN')
  on conflict (engagement_id, installment_number) do update
    set due_on = excluded.due_on, amount_cents = excluded.amount_cents, status = 'OPEN', paid_at = null
    where public.project_installments.status = 'OPEN'
       or (public.project_installments.status = 'CANCELED' and not exists (
         select 1 from public.financial_entries entry
         join public.financial_settlements settlement
           on settlement.entry_id = entry.id and settlement.organization_id = entry.organization_id
         where entry.project_installment_id = public.project_installments.id
           and entry.organization_id = public.project_installments.organization_id
       ));
  select id into v_installment from public.project_installments where engagement_id = v_id and organization_id = p_organization_id and installment_number = 0;
  if p_entry_cents > 0 then
    insert into public.financial_entries(organization_id, kind, source, description, issue_date, due_date, total_cents, chart_account_id, counterparty_kind, customer_id, project_installment_id, created_by)
    values (p_organization_id, 'REVENUE', 'PROJECT', 'Entrada do contrato de projeto', current_date, current_date, p_entry_cents, v_chart, 'CUSTOMER', p_customer_id, v_installment, v_user)
    on conflict (organization_id, project_installment_id) where project_installment_id is not null and canceled_at is null
    do update set total_cents = excluded.total_cents, customer_id = excluded.customer_id
    where not exists (select 1 from public.financial_settlements fs where fs.entry_id = public.financial_entries.id and fs.organization_id = public.financial_entries.organization_id);
  end if;

  select count(*) filter (where i.status = 'PAID' or (coalesce(f.settled_cents, 0) >= i.amount_cents and coalesce(f.settled_cents, 0) > 0))::integer,
         count(*) filter (where coalesce(f.settled_cents, 0) > 0 and coalesce(f.settled_cents, 0) < i.amount_cents)::integer,
         coalesce(sum(case when coalesce(f.settled_cents, 0) > 0 then f.settled_cents else case when i.status = 'PAID' then i.amount_cents else 0 end end), 0)::bigint,
         coalesce(sum(case when coalesce(f.settled_cents, 0) > 0 and coalesce(f.settled_cents, 0) < i.amount_cents then f.remaining_cents else 0 end), 0)::bigint,
         coalesce(max(i.installment_number) filter (where i.status = 'PAID' or coalesce(f.settled_cents, 0) > 0), 0)::integer
    into v_paid_count, v_partial_count, v_paid_total, v_partial_remaining, v_last_locked_number
    from public.project_installments i
    left join public.project_installment_finance f on f.id = i.id and f.organization_id = i.organization_id
   where i.engagement_id = v_id and i.organization_id = p_organization_id and i.installment_number > 0;

  if p_contracted_cents < p_entry_cents + v_paid_total + v_partial_remaining then
    raise exception using errcode = '22023', message = 'contract value cannot be lower than the amounts already received or due on partially settled installments';
  end if;
  v_balance := greatest(p_contracted_cents - p_entry_cents - v_paid_total - v_partial_remaining, 0);
  v_open_count := greatest(p_installments_count - v_paid_count - v_partial_count, 0);
  if v_last_locked_number > 0 then
    select due_on into v_schedule_start from public.project_installments where engagement_id = v_id and organization_id = p_organization_id and installment_number = v_last_locked_number;
  end if;
  v_schedule_start := coalesce(v_schedule_start, (p_first_due_on - interval '1 month')::date);

  if v_open_count > 0 then
    for n in (v_last_locked_number + 1)..(v_last_locked_number + v_open_count) loop
      v_amount := case when n = v_last_locked_number + v_open_count then v_balance - ((v_balance / v_open_count) * (v_open_count - 1)) else v_balance / v_open_count end;
      v_due := (v_schedule_start + ((n - v_last_locked_number) * interval '1 month'))::date;
      insert into public.project_installments(organization_id, engagement_id, installment_number, due_on, amount_cents, status)
      values (p_organization_id, v_id, n, v_due, v_amount, 'OPEN')
      on conflict (engagement_id, installment_number) do update
        set due_on = excluded.due_on, amount_cents = excluded.amount_cents, status = 'OPEN', paid_at = null
        where public.project_installments.status = 'OPEN'
           or (public.project_installments.status = 'CANCELED' and not exists (
             select 1 from public.financial_entries entry
             join public.financial_settlements settlement
               on settlement.entry_id = entry.id and settlement.organization_id = entry.organization_id
             where entry.project_installment_id = public.project_installments.id
               and entry.organization_id = public.project_installments.organization_id
           ));
      select id into v_installment from public.project_installments where engagement_id = v_id and organization_id = p_organization_id and installment_number = n;
      if v_amount > 0 then
        insert into public.financial_entries(organization_id, kind, source, description, issue_date, due_date, total_cents, chart_account_id, counterparty_kind, customer_id, project_installment_id, created_by)
        values (p_organization_id, 'REVENUE', 'PROJECT', 'Parcela ' || n || '/' || p_installments_count || ' do contrato de projeto', least(current_date, v_due), v_due, v_amount, v_chart, 'CUSTOMER', p_customer_id, v_installment, v_user)
        on conflict (organization_id, project_installment_id) where project_installment_id is not null and canceled_at is null
        do update set total_cents = excluded.total_cents, due_date = excluded.due_date, customer_id = excluded.customer_id
        where not exists (select 1 from public.financial_settlements fs where fs.entry_id = public.financial_entries.id and fs.organization_id = public.financial_entries.organization_id);
      end if;
    end loop;
  end if;
  return v_id;
end;
$$;

revoke all on function public.save_project_contract(uuid, uuid, uuid, uuid, uuid, text, bigint, bigint, integer, date) from public, anon;
grant execute on function public.save_project_contract(uuid, uuid, uuid, uuid, uuid, text, bigint, bigint, integer, date) to authenticated;
