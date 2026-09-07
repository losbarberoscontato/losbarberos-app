-- Preserve direct ledger fixtures/manual corrections. Automatic earned entries
-- use the earned:<appointment>:<item> idempotency contract.
create or replace function public.guard_unreceived_commission()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.kind = 'EARNED'
     and new.source_entry_id is null
     and new.idempotency_key like 'earned:%'
     and not public.appointment_is_fully_received(new.appointment_id) then
    return null;
  end if;
  return new;
end;
$$;

revoke all on function public.guard_unreceived_commission() from public, anon, authenticated, service_role;
