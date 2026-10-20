-- Make the already-priced Kanban module available for per-organization activation.
-- This does not create or enable any organization entitlement.
begin;

do $$
begin
  if (
    select count(*) from public.platform_kanban_price_versions
    where retired_at is null and monthly_price_cents = 990
  ) <> 4 then
    raise exception 'Expected one current R$ 9.90 Kanban price for each of the four products';
  end if;
  if not exists (select 1 from public.platform_modules where key = 'kanban') then
    raise exception 'Kanban platform module is missing';
  end if;
end;
$$;

update public.platform_modules
set active = true, updated_at = now()
where key = 'kanban';

commit;
