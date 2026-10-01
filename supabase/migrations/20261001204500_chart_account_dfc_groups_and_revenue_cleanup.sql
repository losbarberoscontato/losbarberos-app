-- Replace the generic DFC activities with the requested management groups.
-- Legacy enum values remain available for historical facts and database compatibility.
alter type public.cash_flow_activity add value if not exists 'REVENUE_OPERATIONAL';
alter type public.cash_flow_activity add value if not exists 'REVENUE_NON_OPERATIONAL';
alter type public.cash_flow_activity add value if not exists 'REVENUE_DEDUCTIONS';
alter type public.cash_flow_activity add value if not exists 'OPERATIONAL_COSTS';
alter type public.cash_flow_activity add value if not exists 'ADMINISTRATIVE_EXPENSES';
alter type public.cash_flow_activity add value if not exists 'PERSONNEL_EXPENSES';
alter type public.cash_flow_activity add value if not exists 'COMMERCIAL_EXPENSES';
alter type public.cash_flow_activity add value if not exists 'FINANCIAL_EXPENSES';
alter type public.cash_flow_activity add value if not exists 'TAX_EXPENSES';
alter type public.cash_flow_activity add value if not exists 'NON_OPERATIONAL_EXPENSES';

-- Clear tenant-level classifications so every organization starts from the new groups.
update public.chart_of_accounts
set cash_flow_activity = null
where cash_flow_activity is not null;

-- Keep referenced account IDs for ledger/report history, but retire them from future use.
with recursive account_depth as (
  select id, organization_id, parent_id, kind, 1 as depth
  from public.chart_of_accounts
  where parent_id is null
  union all
  select child.id, child.organization_id, child.parent_id, child.kind, parent.depth + 1
  from public.chart_of_accounts child
  join account_depth parent
    on parent.id = child.parent_id
   and parent.organization_id = child.organization_id
)
update public.chart_of_accounts account
set active = false
from account_depth
where account.id = account_depth.id
  and account.organization_id = account_depth.organization_id
  and account.kind = 'REVENUE'
  and account_depth.depth = 3;

-- Do not seed third-level revenue accounts for new organizations or template resets.
delete from public.default_chart_account_templates
where kind = 'REVENUE'
  and array_length(string_to_array(code, '.'), 1) = 3;
