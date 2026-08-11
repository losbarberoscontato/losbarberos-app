-- Client phone is contact data, not tenant identity. Multiple customers may share it.
drop index if exists public.customers_phone_per_organization;
