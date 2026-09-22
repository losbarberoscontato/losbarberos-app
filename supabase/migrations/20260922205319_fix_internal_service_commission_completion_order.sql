-- Deferred constraint triggers receive the row snapshot from each update.
-- Completion updates the service before inserting/linking its earned commission,
-- so validate the final persisted row instead of that intermediate snapshot.
create or replace function public.assert_project_internal_service_commission()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_service public.project_engagement_internal_services%rowtype;
begin
  select * into v_service
  from public.project_engagement_internal_services
  where organization_id = new.organization_id and id = new.id;

  if not found then return null; end if;

  if v_service.status = 'COMPLETED' and v_service.commission_cents > 0 and not exists (
    select 1 from public.commission_ledger ledger
    where ledger.organization_id = v_service.organization_id
      and ledger.id = v_service.commission_ledger_entry_id
      and ledger.project_internal_service_id = v_service.id
      and ledger.barber_id = v_service.barber_id
      and ledger.kind = 'EARNED'
      and ledger.amount_cents = v_service.commission_cents
  ) then
    raise exception using errcode = '23514', message = 'completed internal service requires its matching earned commission';
  end if;
  return null;
end;
$$;
revoke all on function public.assert_project_internal_service_commission() from public, anon, authenticated, service_role;
