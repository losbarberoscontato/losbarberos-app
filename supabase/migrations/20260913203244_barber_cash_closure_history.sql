-- Preserve the administrative actor as a display snapshot so barber closure
-- history remains readable even if the profile changes later.
alter table public.barber_cash_sessions
  add column if not exists reconciled_by_name text;

create or replace function public.set_barber_cash_reconciled_by_name()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
begin
  if new.status = 'RECONCILED' then
    select coalesce(
      nullif(btrim(profile.display_name), ''),
      nullif(btrim(auth_user.email), ''),
      'Administrador'
    )
    into new.reconciled_by_name
    from auth.users auth_user
    left join public.profiles profile on profile.id = auth_user.id
    where auth_user.id = new.reconciled_by;

    new.reconciled_by_name := coalesce(new.reconciled_by_name, 'Administrador');
  else
    new.reconciled_by_name := null;
  end if;
  return new;
end;
$$;

drop trigger if exists barber_cash_session_reconciled_by_name on public.barber_cash_sessions;
create trigger barber_cash_session_reconciled_by_name
  before insert or update of status, reconciled_by on public.barber_cash_sessions
  for each row execute function public.set_barber_cash_reconciled_by_name();

update public.barber_cash_sessions session
set reconciled_by_name = coalesce(
  nullif(btrim(profile.display_name), ''),
  nullif(btrim(auth_user.email), ''),
  'Administrador'
)
from auth.users auth_user
left join public.profiles profile on profile.id = auth_user.id
where session.status = 'RECONCILED'
  and session.reconciled_by_name is null
  and auth_user.id = session.reconciled_by;

create policy barber_cash_reconciliation_barber_select
  on public.barber_cash_reconciliations for select to authenticated
  using (
    public.is_organization_barber(organization_id)
    and exists (
      select 1
      from public.barber_cash_sessions session
      join public.barbers barber
        on barber.id = session.barber_id
       and barber.organization_id = session.organization_id
      where session.id = barber_cash_reconciliations.cash_session_id
        and session.organization_id = barber_cash_reconciliations.organization_id
        and barber.auth_user_id = auth.uid()
        and barber.active
        and barber.app_access_enabled
        and barber.cash_access_enabled
    )
  );

grant select on public.barber_cash_reconciliations to authenticated;
