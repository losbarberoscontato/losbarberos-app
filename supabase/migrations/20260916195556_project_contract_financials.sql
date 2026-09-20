-- Contratos de projetos: cronograma financeiro integrado ao ledger.
alter table public.project_installments
  drop constraint if exists project_installments_installment_number_check;
alter table public.project_installments
  add constraint project_installments_installment_number_check check (installment_number >= 0);
alter table public.project_installments
  add constraint project_installments_id_org_unique unique (id, organization_id);

alter table public.financial_entries
  add column if not exists project_installment_id uuid;

alter table public.financial_entries
  drop constraint if exists financial_entries_subscription_source_check;
alter table public.financial_entries
  drop constraint if exists financial_entries_check2;
alter table public.financial_entries
  drop constraint if exists financial_entries_source_check;
alter table public.financial_entries
  add constraint financial_entries_project_source_check check (
    (source = 'APPOINTMENT' and appointment_id is not null and subscription_cycle_id is null and project_installment_id is null)
    or (source = 'SUBSCRIPTION' and subscription_cycle_id is not null and appointment_id is null and project_installment_id is null)
    or (source = 'PROJECT' and project_installment_id is not null and appointment_id is null and subscription_cycle_id is null)
    or (source = 'MANUAL' and appointment_id is null and subscription_cycle_id is null and project_installment_id is null)
  );

alter table public.financial_entries
  add constraint financial_entries_project_installment_fk
  foreign key (project_installment_id, organization_id)
  references public.project_installments(id, organization_id);

create unique index if not exists financial_entries_project_installment_unique
  on public.financial_entries (organization_id, project_installment_id)
  where project_installment_id is not null and canceled_at is null;

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
  on e.project_installment_id = i.id and e.organization_id = i.organization_id
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

create or replace function public.sync_project_installment_payment()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_installment uuid; v_total bigint; v_settled bigint;
begin
  select project_installment_id, total_cents into v_installment, v_total from public.financial_entries where id = new.entry_id and organization_id = new.organization_id and source = 'PROJECT';
  if v_installment is null then return new; end if;
  select coalesce(sum(case when kind = 'SETTLEMENT' then amount_cents else -amount_cents end), 0)::bigint into v_settled from public.financial_settlements where entry_id = new.entry_id;
  update public.project_installments set status = case when v_settled >= v_total then 'PAID' else 'OPEN' end, paid_at = case when v_settled >= v_total then now() else null end where id = v_installment and organization_id = new.organization_id;
  return new;
end; $$;
drop trigger if exists financial_settlements_project_installment_sync on public.financial_settlements;
create trigger financial_settlements_project_installment_sync
after insert on public.financial_settlements
for each row execute function public.sync_project_installment_payment();

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
    delete from public.project_installments where engagement_id = v_id and organization_id = p_organization_id and status = 'OPEN';
  end if;

  v_balance := p_contracted_cents - p_entry_cents;
  insert into public.project_installments(organization_id, engagement_id, installment_number, due_on, amount_cents, status)
  values (p_organization_id, v_id, 0, current_date, p_entry_cents, 'OPEN')
  on conflict (engagement_id, installment_number) do update set due_on = excluded.due_on, amount_cents = excluded.amount_cents where public.project_installments.status = 'OPEN';
  select id into v_installment from public.project_installments where engagement_id = v_id and installment_number = 0;
  if p_entry_cents > 0 then
    insert into public.financial_entries(organization_id, kind, source, description, issue_date, due_date, total_cents, chart_account_id, counterparty_kind, customer_id, project_installment_id, created_by)
    values (p_organization_id, 'REVENUE', 'PROJECT', 'Entrada do contrato de projeto', current_date, current_date, p_entry_cents, v_chart, 'CUSTOMER', p_customer_id, v_installment, v_user)
    on conflict (organization_id, project_installment_id) where project_installment_id is not null and canceled_at is null do update set total_cents = excluded.total_cents, customer_id = excluded.customer_id where not exists (select 1 from public.financial_settlements fs where fs.entry_id = public.financial_entries.id);
  end if;

  for n in 1..p_installments_count loop
    v_amount := case when n = p_installments_count then v_balance - ((v_balance / p_installments_count) * (p_installments_count - 1)) else v_balance / p_installments_count end;
    v_due := (p_first_due_on + ((n - 1) * interval '1 month'))::date;
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

create or replace function public.update_project_installment(
  p_organization_id uuid, p_installment_id uuid, p_amount_cents bigint, p_due_on date
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_installment public.project_installments%rowtype; v_entry public.financial_entries%rowtype;
begin
  if not public.is_organization_owner(p_organization_id) then raise exception using errcode = '42501', message = 'project installment write denied'; end if;
  if p_amount_cents < 0 or p_due_on is null then raise exception using errcode = '22023', message = 'invalid project installment'; end if;
  select * into strict v_installment from public.project_installments where id = p_installment_id and organization_id = p_organization_id for update;
  if v_installment.status <> 'OPEN' then raise exception using errcode = '22023', message = 'paid installment cannot be edited'; end if;
  select * into v_entry from public.financial_entries where project_installment_id = p_installment_id and organization_id = p_organization_id and canceled_at is null for update;
  if found and exists (select 1 from public.financial_settlements where entry_id = v_entry.id) then raise exception using errcode = '22023', message = 'settled installment requires reversal'; end if;
  update public.project_installments set amount_cents = p_amount_cents, due_on = p_due_on where id = p_installment_id;
  if v_entry.id is not null then update public.financial_entries set total_cents = greatest(p_amount_cents, 1), due_date = p_due_on where id = v_entry.id; end if;
exception when no_data_found then raise exception using errcode = 'P0002', message = 'project installment not found'; end; $$;
revoke all on function public.update_project_installment(uuid, uuid, bigint, date) from public, anon;
grant execute on function public.update_project_installment(uuid, uuid, bigint, date) to authenticated;
