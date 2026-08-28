-- Restore manual-entry creation after competence_date became mandatory and add
-- the 15-day recurrence used by the manager finance form.
alter type public.financial_recurrence_cadence add value if not exists 'BIWEEKLY';

create or replace function public.create_financial_entry(
  p_organization_id uuid, p_kind public.financial_entry_kind, p_description text, p_issue_date date, p_due_date date, p_total_cents bigint,
  p_chart_account_id uuid, p_cost_center_id uuid default null, p_preferred_financial_account_id uuid default null,
  p_counterparty_kind public.financial_counterparty_kind default null, p_customer_id uuid default null, p_supplier_id uuid default null,
  p_document_number text default null, p_tag_ids uuid[] default '{}'::uuid[]
) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  if p_organization_id is null then raise exception using errcode = '22023', message = 'organization id is required'; end if;
  perform public.require_financial_owner(p_organization_id, 'financial entry mutations');
  if nullif(btrim(p_description), '') is null or p_total_cents <= 0 or p_due_date < p_issue_date then raise exception using errcode = '22023', message = 'valid financial entry fields are required'; end if;
  if not exists (select 1 from public.chart_of_accounts where id = p_chart_account_id and organization_id = p_organization_id and kind = p_kind and active) then raise exception using errcode = '22023', message = 'active chart account of matching kind is required'; end if;
  if p_cost_center_id is not null and not exists (select 1 from public.cost_centers where id = p_cost_center_id and organization_id = p_organization_id and active) then raise exception using errcode = '22023', message = 'active cost center is required'; end if;
  if p_preferred_financial_account_id is not null and not exists (select 1 from public.financial_accounts where id = p_preferred_financial_account_id and organization_id = p_organization_id and active) then raise exception using errcode = '22023', message = 'active financial account is required'; end if;
  if p_counterparty_kind = 'CUSTOMER' and not exists (select 1 from public.customers where id = p_customer_id and organization_id = p_organization_id) then raise exception using errcode = '22023', message = 'customer must belong to this organization'; end if;
  if p_counterparty_kind = 'SUPPLIER' and not exists (select 1 from public.suppliers where id = p_supplier_id and organization_id = p_organization_id and active) then raise exception using errcode = '22023', message = 'active supplier is required'; end if;
  if (p_counterparty_kind = 'CUSTOMER' and p_supplier_id is not null) or (p_counterparty_kind = 'SUPPLIER' and p_customer_id is not null) or (p_counterparty_kind is null and (p_customer_id is not null or p_supplier_id is not null)) then raise exception using errcode = '22023', message = 'counterparty kind and record must match'; end if;
  if exists (select 1 from unnest(coalesce(p_tag_ids, '{}'::uuid[])) t where not exists (select 1 from public.financial_tags ft where ft.id = t and ft.organization_id = p_organization_id and ft.active)) then raise exception using errcode = '22023', message = 'all tags must be active and tenant scoped'; end if;
  insert into public.financial_entries (organization_id, kind, description, issue_date, competence_date, due_date, total_cents, chart_account_id, cost_center_id, preferred_financial_account_id, counterparty_kind, customer_id, supplier_id, document_number, created_by)
  values (p_organization_id, p_kind, btrim(p_description), p_issue_date, p_issue_date, p_due_date, p_total_cents, p_chart_account_id, p_cost_center_id, p_preferred_financial_account_id, p_counterparty_kind, p_customer_id, p_supplier_id, nullif(btrim(p_document_number), ''), auth.uid())
  returning id into v_id;
  insert into public.financial_entry_tags (organization_id, entry_id, tag_id) select p_organization_id, v_id, tag_id from unnest(coalesce(p_tag_ids, '{}'::uuid[])) as tag_id;
  return v_id;
end;
$$;

create or replace function public.extend_due_financial_recurrences(p_organization_id uuid default null)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.financial_series%rowtype; v_count integer:=0; v_limit date; v_i integer; v_date date; v_amount bigint;
begin
  if p_organization_id is null then raise exception using errcode='22023', message='organization id is required'; end if;
  perform public.require_financial_owner(p_organization_id, 'financial recurrence extension');
  for r in select * from public.financial_series where active and canceled_at is null and organization_id=p_organization_id for update loop
    v_limit := least(coalesce(r.end_date, current_date + interval '12 months')::date, (current_date + interval '12 months')::date);
    v_i := 1;
    loop
      exit when r.occurrence_count is not null and v_i > r.occurrence_count;
      v_date := case r.cadence::text
        when 'WEEKLY' then r.start_date + ((v_i - 1) * 7)
        when 'BIWEEKLY' then r.start_date + ((v_i - 1) * 15)
        when 'MONTHLY' then (r.start_date + make_interval(months => v_i - 1))::date
        else (r.start_date + make_interval(years => v_i - 1))::date
      end;
      exit when v_date > v_limit;
      v_amount := case when r.kind='INSTALLMENT' then r.total_cents / r.occurrence_count + case when v_i=r.occurrence_count then r.total_cents % r.occurrence_count else 0 end else r.amount_cents end;
      insert into public.financial_entries (organization_id,kind,description,issue_date,competence_date,due_date,total_cents,chart_account_id,cost_center_id,location_id,preferred_financial_account_id,financial_series_id,series_occurrence,created_by)
      values (r.organization_id,r.entry_kind,r.description,v_date,v_date,v_date,v_amount,r.chart_account_id,r.cost_center_id,r.location_id,r.preferred_financial_account_id,r.id,v_i,r.created_by)
      on conflict (organization_id,financial_series_id,series_occurrence) where financial_series_id is not null do nothing;
      v_count := v_count + 1; v_i := v_i + 1;
    end loop;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.create_financial_entry(uuid, public.financial_entry_kind, text, date, date, bigint, uuid, uuid, uuid, public.financial_counterparty_kind, uuid, uuid, text, uuid[]), public.extend_due_financial_recurrences(uuid) from public, anon, authenticated, service_role;
grant execute on function public.create_financial_entry(uuid, public.financial_entry_kind, text, date, date, bigint, uuid, uuid, uuid, public.financial_counterparty_kind, uuid, uuid, text, uuid[]), public.extend_due_financial_recurrences(uuid) to authenticated;
