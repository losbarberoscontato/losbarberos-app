-- Recalcula o cronograma de um contrato sem alterar parcelas já recebidas.
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
  v_paid_count integer := 0;
  v_last_paid_number integer := 0;
  v_paid_total bigint := 0;
  v_open_count integer := 0;
  v_schedule_start date;
begin
  if not public.is_organization_owner(p_organization_id) then raise exception using errcode = '42501', message = 'project contract write denied'; end if;
  if p_contracted_cents < 0 or p_entry_cents < 0 or p_entry_cents > p_contracted_cents or p_installments_count < 1 or p_first_due_on is null then
    raise exception using errcode = '22023', message = 'invalid project contract terms';
  end if;
  if p_status not in ('PROPOSAL','ACTIVE','COMPLETED','CANCELED') then raise exception using errcode = '22023', message = 'invalid project contract status'; end if;
  if not exists (select 1 from public.projects where id = p_project_id and organization_id = p_organization_id) then raise exception using errcode = '22023', message = 'project not found'; end if;
  if not exists (select 1 from public.customers where id = p_customer_id and organization_id = p_organization_id and active) then raise exception using errcode = '22023', message = 'customer not found'; end if;
  if not exists (select 1 from public.project_packages where id = p_package_id and project_id = p_project_id and organization_id = p_organization_id and active) then raise exception using errcode = '22023', message = 'package not found'; end if;
  select id into v_chart from public.chart_of_accounts where organization_id = p_organization_id and kind = 'REVENUE' and active order by created_at limit 1;
  if v_chart is null then raise exception using errcode = '22023', message = 'active revenue chart account is required'; end if;

  if v_id is null then
    insert into public.project_engagements(organization_id, project_id, customer_id, package_id, status, contracted_cents, proposal_sent_at, created_by)
    values (p_organization_id, p_project_id, p_customer_id, p_package_id, p_status, p_contracted_cents, case when p_status = 'PROPOSAL' then now() else null end, v_user)
    returning id into v_id;
  else
    select status into v_existing_status from public.project_engagements where id = v_id and organization_id = p_organization_id and project_id = p_project_id for update;
    if v_existing_status is null then raise exception using errcode = 'P0002', message = 'project contract not found'; end if;
    update public.project_engagements set customer_id = p_customer_id, package_id = p_package_id, status = p_status, contracted_cents = p_contracted_cents, updated_at = now() where id = v_id and organization_id = p_organization_id;
    delete from public.financial_entries e where e.organization_id = p_organization_id and e.source = 'PROJECT' and e.project_installment_id in (select i.id from public.project_installments i where i.engagement_id = v_id and i.organization_id = p_organization_id and i.status = 'OPEN') and not exists (select 1 from public.financial_settlements fs where fs.entry_id = e.id);
    delete from public.project_installments i
     where i.engagement_id = v_id and i.organization_id = p_organization_id and i.status = 'OPEN'
       and not exists (
         select 1 from public.financial_entries e
         join public.financial_settlements fs on fs.entry_id = e.id and fs.organization_id = e.organization_id
         where e.project_installment_id = i.id and e.organization_id = i.organization_id
       );
  end if;

  insert into public.project_installments(organization_id, engagement_id, installment_number, due_on, amount_cents, status)
  values (p_organization_id, v_id, 0, current_date, p_entry_cents, 'OPEN')
  on conflict (engagement_id, installment_number) do update set due_on = excluded.due_on, amount_cents = excluded.amount_cents where public.project_installments.status = 'OPEN';
  select id into v_installment from public.project_installments where engagement_id = v_id and installment_number = 0;
  if p_entry_cents > 0 then
    insert into public.financial_entries(organization_id, kind, source, description, issue_date, due_date, total_cents, chart_account_id, counterparty_kind, customer_id, project_installment_id, created_by)
    values (p_organization_id, 'REVENUE', 'PROJECT', 'Entrada do contrato de projeto', current_date, current_date, p_entry_cents, v_chart, 'CUSTOMER', p_customer_id, v_installment, v_user)
    on conflict (organization_id, project_installment_id) where project_installment_id is not null and canceled_at is null do update set total_cents = excluded.total_cents, customer_id = excluded.customer_id where not exists (select 1 from public.financial_settlements fs where fs.entry_id = public.financial_entries.id);
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
    on conflict (engagement_id, installment_number) do update set due_on = excluded.due_on, amount_cents = excluded.amount_cents where public.project_installments.status = 'OPEN';
    select id into v_installment from public.project_installments where engagement_id = v_id and installment_number = n;
    if v_amount > 0 then
      insert into public.financial_entries(organization_id, kind, source, description, issue_date, due_date, total_cents, chart_account_id, counterparty_kind, customer_id, project_installment_id, created_by)
      values (p_organization_id, 'REVENUE', 'PROJECT', 'Parcela ' || n || '/' || p_installments_count || ' do contrato de projeto', current_date, v_due, v_amount, v_chart, 'CUSTOMER', p_customer_id, v_installment, v_user)
      on conflict (organization_id, project_installment_id) where project_installment_id is not null and canceled_at is null do update set total_cents = excluded.total_cents, due_date = excluded.due_date, customer_id = excluded.customer_id where not exists (select 1 from public.financial_settlements fs where fs.entry_id = public.financial_entries.id);
    end if;
  end loop;
  return v_id;
end; $$;

revoke all on function public.save_project_contract(uuid, uuid, uuid, uuid, uuid, text, bigint, bigint, integer, date) from public, anon;
grant execute on function public.save_project_contract(uuid, uuid, uuid, uuid, uuid, text, bigint, bigint, integer, date) to authenticated;
