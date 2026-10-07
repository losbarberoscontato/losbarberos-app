begin;

alter table public.organization_audiences
  drop constraint organization_audiences_audience_key_check;

alter table public.organization_audiences
  add constraint organization_audiences_audience_key_check
  check (audience_key ~ '^[A-Za-z0-9_:-]{3,80}$');

commit;
