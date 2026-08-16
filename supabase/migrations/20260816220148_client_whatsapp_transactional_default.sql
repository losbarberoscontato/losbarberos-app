-- Cliente autenticado recebe mensagens transacionais por padrão. Uma revogação
-- explícita sempre prevalece e nunca é reativada por este fluxo.
create or replace function public.grant_default_client_whatsapp_transactional_consent()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.auth_user_id is null
     or (tg_op = 'UPDATE' and old.auth_user_id is not null) then
    return new;
  end if;

  if not exists (
    select 1
    from public.consent_events ce
    where ce.organization_id = new.organization_id
      and ce.customer_id = new.id
      and ce.kind = 'WHATSAPP_TRANSACTIONAL'
  ) then
    insert into public.consent_events (
      organization_id, customer_id, kind, action, source, proof, policy_version
    ) values (
      new.organization_id,
      new.id,
      'WHATSAPP_TRANSACTIONAL',
      'GRANTED',
      'CLIENT_ACCOUNT_DEFAULT',
      jsonb_build_object(
        'default_enabled', true,
        'interface', 'connected-client',
        'locale', 'pt-BR'
      ),
      'client-access-2026-08'
    );
  end if;

  return new;
end;
$$;

drop trigger if exists customers_grant_default_client_whatsapp_transactional_consent on public.customers;
create trigger customers_grant_default_client_whatsapp_transactional_consent
  after insert or update of auth_user_id on public.customers
  for each row execute function public.grant_default_client_whatsapp_transactional_consent();

-- Alinha contas de cliente existentes apenas quando não há decisão anterior.
-- Clientes com GRANTED ou REVOKED permanecem inalterados.
insert into public.consent_events (
  organization_id, customer_id, kind, action, source, proof, policy_version
)
select
  c.organization_id,
  c.id,
  'WHATSAPP_TRANSACTIONAL',
  'GRANTED',
  'CLIENT_ACCOUNT_DEFAULT_BACKFILL',
  jsonb_build_object(
    'default_enabled', true,
    'migration', '20260816220148',
    'interface', 'connected-client',
    'locale', 'pt-BR'
  ),
  'client-access-2026-08'
from public.customers c
where c.auth_user_id is not null
  and not exists (
    select 1
    from public.consent_events ce
    where ce.organization_id = c.organization_id
      and ce.customer_id = c.id
      and ce.kind = 'WHATSAPP_TRANSACTIONAL'
  );

revoke all on function public.grant_default_client_whatsapp_transactional_consent() from public, anon, authenticated;
