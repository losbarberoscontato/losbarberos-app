create or replace function public.seed_agenda_environments_for_location()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.agenda_environments (organization_id, location_id, name, sort_order)
  values
    (new.organization_id, new.id, 'Sala/Cadeira 1', 1),
    (new.organization_id, new.id, 'Sala/Cadeira 2', 2)
  on conflict (location_id, lower(btrim(name))) do nothing;
  return new;
end;
$$;

drop trigger if exists locations_seed_agenda_environments on public.locations;
create trigger locations_seed_agenda_environments
  after insert on public.locations
  for each row execute function public.seed_agenda_environments_for_location();

revoke all on function public.seed_agenda_environments_for_location() from public, anon, authenticated;
