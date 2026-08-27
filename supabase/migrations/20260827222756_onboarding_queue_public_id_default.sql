-- Organizations created after the walk-in queue migration must receive a
-- stable public queue ID. Existing rows were backfilled by the original
-- migration; this default repairs the creation path used by onboarding.
alter table public.organizations
  alter column queue_public_id set default gen_random_uuid();
