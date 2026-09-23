-- The CPF/CNPJ extension keeps the legacy four-argument call compatible via
-- the default fifth parameter. Remove the old overload so PostgreSQL does not
-- report an ambiguous function call for existing clients.
drop function if exists public.upsert_my_client_account(text, text, date, text);
