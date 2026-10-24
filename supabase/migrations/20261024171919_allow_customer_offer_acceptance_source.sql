-- Offers created by the manager record the distinct CLIENT_OFFER acceptance
-- source. The RPC already writes this value; include it in the allowed set.
alter table public.subscription_contract_acceptances
  drop constraint if exists subscription_contract_acceptances_acceptance_source_check;

alter table public.subscription_contract_acceptances
  add constraint subscription_contract_acceptances_acceptance_source_check
  check (acceptance_source in ('CLIENT', 'CLIENT_OFFER', 'MANAGER', 'PRESENTIAL'));
