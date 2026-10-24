-- Recover terms stored on legacy proposals so a later customer acceptance can create their schedule.
update public.project_engagements engagement
   set contract_entry_cents = coalesce((select installment.amount_cents from public.project_installments installment where installment.engagement_id = engagement.id and installment.organization_id = engagement.organization_id and installment.installment_number = 0), 0),
       contract_installments_count = greatest(coalesce((select max(installment.installment_number) from public.project_installments installment where installment.engagement_id = engagement.id and installment.organization_id = engagement.organization_id), 0), 1),
       contract_entry_due_on = (select installment.due_on from public.project_installments installment where installment.engagement_id = engagement.id and installment.organization_id = engagement.organization_id and installment.installment_number = 0),
       contract_first_due_on = (select min(installment.due_on) from public.project_installments installment where installment.engagement_id = engagement.id and installment.organization_id = engagement.organization_id and installment.installment_number > 0),
       contract_financial_terms_configured = true
 where not engagement.contract_financial_terms_configured
   and exists (select 1 from public.project_installments installment where installment.engagement_id = engagement.id and installment.organization_id = engagement.organization_id);
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
  v_last_paid_number integer := 0;
  v_paid_total bigint := 0;
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

  select count(*)::integer,
         coalesce(sum(case when coalesce(f.settled_cents, 0) > 0 then f.settled_cents else i.amount_cents end), 0)::bigint,
         coalesce(max(i.installment_number), 0)::integer
    into v_paid_count, v_paid_total, v_last_paid_number
    from public.project_installments i
    left join public.project_installment_finance f on f.id = i.id and f.organization_id = i.organization_id
   where i.engagement_id = v_id and i.organization_id = p_organization_id and i.installment_number > 0
     and (i.status = 'PAID' or coalesce(f.settled_cents, 0) > 0);
  v_balance := greatest(p_contracted_cents - p_entry_cents - v_paid_total, 0);
  v_open_count := greatest(p_installments_count - v_paid_count, 0);
  if v_last_paid_number > 0 then
    select due_on into v_schedule_start from public.project_installments where engagement_id = v_id and organization_id = p_organization_id and installment_number = v_last_paid_number;
  end if;
  v_schedule_start := coalesce(v_schedule_start, (p_first_due_on - interval '1 month')::date);

  for n in (v_last_paid_number + 1)..(v_last_paid_number + v_open_count) loop
    v_amount := case when v_open_count = 0 then 0 when n = v_last_paid_number + v_open_count then v_balance - ((v_balance / v_open_count) * (v_open_count - 1)) else v_balance / v_open_count end;
    v_due := (v_schedule_start + ((n - v_last_paid_number) * interval '1 month'))::date;
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
  return v_id;
end; $$;


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
  p_first_due_on date,
  p_entry_due_on date
) returns uuid
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  if not public.is_organization_owner(p_organization_id) then
    raise exception using errcode = '42501', message = 'project contract write denied';
  end if;
  if p_entry_due_on is null then
    raise exception using errcode = '22023', message = 'entry due date is required';
  end if;

  v_id := public.save_project_contract(
    p_organization_id, p_engagement_id, p_project_id, p_customer_id, p_package_id,
    p_status, p_contracted_cents, p_entry_cents, p_installments_count, p_first_due_on
  );

  update public.project_engagements
     set contract_entry_due_on = p_entry_due_on
   where id = v_id and organization_id = p_organization_id;

  update public.project_installments
     set due_on = p_entry_due_on
   where organization_id = p_organization_id and engagement_id = v_id
     and installment_number = 0 and status = 'OPEN';

  update public.financial_entries e
     set issue_date = least(e.issue_date, p_entry_due_on), due_date = p_entry_due_on
   where e.organization_id = p_organization_id and e.source = 'PROJECT'
     and e.project_installment_id in (
       select i.id from public.project_installments i
        where i.organization_id = p_organization_id and i.engagement_id = v_id
          and i.installment_number = 0 and i.status = 'OPEN'
     )
     and not exists (select 1 from public.financial_settlements fs where fs.entry_id = e.id and fs.organization_id = e.organization_id);

  return v_id;
end;
$$;

revoke all on function public.save_project_contract(uuid, uuid, uuid, uuid, uuid, text, bigint, bigint, integer, date) from public, anon;
grant execute on function public.save_project_contract(uuid, uuid, uuid, uuid, uuid, text, bigint, bigint, integer, date) to authenticated;
revoke all on function public.save_project_contract(uuid, uuid, uuid, uuid, uuid, text, bigint, bigint, integer, date, date) from public, anon;
grant execute on function public.save_project_contract(uuid, uuid, uuid, uuid, uuid, text, bigint, bigint, integer, date, date) to authenticated;


create or replace function public.require_accepted_project_for_installment()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.status <> 'CANCELED' then
    if tg_op = 'INSERT' and not exists (
      select 1 from public.project_engagements engagement
       where engagement.id = new.engagement_id and engagement.organization_id = new.organization_id
         and engagement.status = 'ACTIVE' and engagement.accepted_at is not null
    ) then
      raise exception using errcode = '22023', message = 'project contract must be accepted before installments are created';
    elsif tg_op = 'UPDATE' and not exists (
      select 1 from public.project_engagements engagement
       where engagement.id = new.engagement_id and engagement.organization_id = new.organization_id
         and engagement.accepted_at is not null
    ) then
      raise exception using errcode = '22023', message = 'project contract must be accepted before installments are created';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.require_accepted_project_for_installment() from public, anon, authenticated;
drop trigger if exists project_installment_requires_accepted_contract on public.project_installments;
create trigger project_installment_requires_accepted_contract
  before insert or update on public.project_installments
  for each row execute function public.require_accepted_project_for_installment();

create or replace function public.require_accepted_project_for_receivable()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.source = 'PROJECT' and new.canceled_at is null and not exists (
    select 1
      from public.project_installments installment
      join public.project_engagements engagement
        on engagement.id = installment.engagement_id and engagement.organization_id = installment.organization_id
     where installment.id = new.project_installment_id
       and installment.organization_id = new.organization_id
        and engagement.accepted_at is not null
  ) then
    raise exception using errcode = '22023', message = 'project contract must be accepted before receivables are created';
  end if;
  return new;
end;
$$;
revoke all on function public.require_accepted_project_for_receivable() from public, anon, authenticated;
drop trigger if exists project_receivable_requires_accepted_contract on public.financial_entries;
create trigger project_receivable_requires_accepted_contract
  before insert or update on public.financial_entries
  for each row execute function public.require_accepted_project_for_receivable();
