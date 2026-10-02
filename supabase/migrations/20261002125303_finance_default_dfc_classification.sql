-- Store DFC defaults with the shared chart template so every new organization inherits them.
alter table public.default_chart_account_templates
  add column cash_flow_activity public.cash_flow_activity;

update public.default_chart_account_templates
set cash_flow_activity = case code
  when '1' then 'REVENUE_OPERATIONAL'::public.cash_flow_activity
  when '1.1' then 'REVENUE_OPERATIONAL'::public.cash_flow_activity
  when '1.2' then 'REVENUE_OPERATIONAL'::public.cash_flow_activity
  when '1.3' then 'REVENUE_NON_OPERATIONAL'::public.cash_flow_activity
  when '2' then 'ADMINISTRATIVE_EXPENSES'::public.cash_flow_activity
  when '2.1' then 'PERSONNEL_EXPENSES'::public.cash_flow_activity
  when '2.1.1' then 'PERSONNEL_EXPENSES'::public.cash_flow_activity
  when '2.1.2' then 'REVENUE_DEDUCTIONS'::public.cash_flow_activity
  when '2.1.3' then 'TAX_EXPENSES'::public.cash_flow_activity
  when '2.2' then 'OPERATIONAL_COSTS'::public.cash_flow_activity
  when '2.2.1' then 'OPERATIONAL_COSTS'::public.cash_flow_activity
  when '2.2.2' then 'OPERATIONAL_COSTS'::public.cash_flow_activity
  when '2.2.3' then 'OPERATIONAL_COSTS'::public.cash_flow_activity
  when '2.2.4' then 'OPERATIONAL_COSTS'::public.cash_flow_activity
  when '2.3' then 'OPERATIONAL_COSTS'::public.cash_flow_activity
  when '2.3.1' then 'OPERATIONAL_COSTS'::public.cash_flow_activity
  when '2.3.2' then 'OPERATIONAL_COSTS'::public.cash_flow_activity
  when '2.4' then 'COMMERCIAL_EXPENSES'::public.cash_flow_activity
  when '2.4.1' then 'COMMERCIAL_EXPENSES'::public.cash_flow_activity
  when '2.4.2' then 'COMMERCIAL_EXPENSES'::public.cash_flow_activity
  when '2.5' then 'ADMINISTRATIVE_EXPENSES'::public.cash_flow_activity
  when '2.5.1' then 'ADMINISTRATIVE_EXPENSES'::public.cash_flow_activity
  when '2.5.2' then 'ADMINISTRATIVE_EXPENSES'::public.cash_flow_activity
  when '2.6' then 'TAX_EXPENSES'::public.cash_flow_activity
  when '2.6.1' then 'TAX_EXPENSES'::public.cash_flow_activity
  when '2.6.2' then 'ADMINISTRATIVE_EXPENSES'::public.cash_flow_activity
  when '2.6.3' then 'ADMINISTRATIVE_EXPENSES'::public.cash_flow_activity
  when '2.7' then 'REVENUE_DEDUCTIONS'::public.cash_flow_activity
  when '2.7.1' then 'REVENUE_DEDUCTIONS'::public.cash_flow_activity
  when '2.7.2' then 'REVENUE_DEDUCTIONS'::public.cash_flow_activity
  when '2.7.3' then 'FINANCIAL_EXPENSES'::public.cash_flow_activity
  when '2.8' then 'NON_OPERATIONAL_EXPENSES'::public.cash_flow_activity
  when '2.8.1' then 'ADMINISTRATIVE_EXPENSES'::public.cash_flow_activity
  when '2.8.2' then 'NON_OPERATIONAL_EXPENSES'::public.cash_flow_activity
  else null
end,
name = case when code = '2.1.2' then 'Comissões' else name end;

-- Apply the shared defaults to existing organizations without changing financial entries.
update public.chart_of_accounts account
set cash_flow_activity = template.cash_flow_activity,
    name = case when account.code = '2.1.2' then 'Comissões' else account.name end
from public.default_chart_account_templates template
where account.code = template.code
  and account.kind = template.kind
  and template.cash_flow_activity is not null;

create or replace function public.seed_default_chart_of_accounts(
  p_organization_id uuid,
  p_created_by uuid default null
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_inserted integer := 0;
begin
  if p_organization_id is null or not exists (
    select 1 from public.organizations where id = p_organization_id
  ) then
    raise exception using errcode = 'P0002', message = 'organization not found';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text, 202608090002));

  if exists (
    select 1 from public.chart_of_accounts where organization_id = p_organization_id
  ) then
    return 0;
  end if;

  insert into public.chart_of_accounts (
    organization_id, parent_id, code, name, kind, created_by, cash_flow_activity
  )
  select p_organization_id, null, template.code, template.name, template.kind, p_created_by, template.cash_flow_activity
  from public.default_chart_account_templates template
  order by string_to_array(template.code, '.')::integer[];

  get diagnostics v_inserted = row_count;

  update public.chart_of_accounts child
  set parent_id = parent.id
  from public.default_chart_account_templates template
  join public.chart_of_accounts parent
    on parent.organization_id = p_organization_id
   and parent.code = template.parent_code
   and parent.kind = template.kind
  where child.organization_id = p_organization_id
    and child.code = template.code
    and template.parent_code is not null;

  if exists (
    select 1
    from public.default_chart_account_templates template
    where template.parent_code is not null
      and not exists (
        select 1
        from public.chart_of_accounts child
        where child.organization_id = p_organization_id
          and child.code = template.code
          and child.parent_id is not null
      )
  ) then
    raise exception using errcode = '23503', message = 'default chart account parent resolution failed';
  end if;

  return v_inserted;
end;
$$;
