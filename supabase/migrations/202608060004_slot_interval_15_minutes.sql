-- Agenda slots follow the business rule: quarter-hour boundaries only.
update public.organizations
set slot_interval_minutes = 15
where slot_interval_minutes <> 15;

alter table public.organizations
  drop constraint if exists organizations_slot_interval_minutes_check;

alter table public.organizations
  add constraint organizations_slot_interval_minutes_check
  check (slot_interval_minutes = 15);
