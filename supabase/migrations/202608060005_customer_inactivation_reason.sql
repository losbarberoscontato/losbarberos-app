alter table public.customers
  add column if not exists inactivation_reason text,
  add column if not exists inactivated_at timestamptz;

comment on column public.customers.inactivation_reason is 'Motivo informado pelo gestor ao inativar o cliente.';
comment on column public.customers.inactivated_at is 'Momento em que o cliente foi inativado pela última vez.';
