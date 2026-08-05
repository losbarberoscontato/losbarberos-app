-- Los Barberos: domain model and hard database invariants.
-- All money is stored in integer cents. All instants are timestamptz.

create extension if not exists pgcrypto with schema extensions;
create extension if not exists btree_gist with schema extensions;
create extension if not exists supabase_vault with schema vault;

create type public.organization_role as enum ('OWNER');
create type public.saas_subscription_status as enum (
  'PROVISIONING', 'TRIALING', 'ACTIVE', 'GRACE', 'BLOCKED',
  'CANCELED_RETENTION', 'CLOSED'
);
create type public.appointment_status as enum (
  'HELD', 'PENDING_PAYMENT', 'CONFIRMED', 'IN_SERVICE',
  'COMPLETED', 'CANCELED', 'NO_SHOW', 'EXPIRED'
);
create type public.booking_source as enum ('CUSTOMER', 'MANAGER', 'WHATSAPP', 'SYSTEM');
create type public.appointment_item_source as enum ('SERVICE', 'PACKAGE');
create type public.availability_exception_kind as enum ('UNAVAILABLE', 'AVAILABLE_OVERRIDE');
create type public.payment_mode as enum ('DEPOSIT', 'FULL', 'COUNTER');
-- Shared external-event discriminator. Stripe and WhatsApp are forbidden by
-- CHECK constraints from the appointment payment ledger.
create type public.payment_provider as enum ('MERCADO_PAGO', 'STRIPE', 'WHATSAPP', 'MANUAL');
create type public.merchant_account_status as enum ('PENDING', 'CONNECTED', 'REAUTH_REQUIRED', 'DISCONNECTED');
create type public.payment_order_kind as enum ('DEPOSIT', 'FULL', 'BALANCE', 'REFUND');
create type public.payment_order_status as enum (
  'CREATED', 'PENDING', 'PAID', 'FAILED', 'CANCELED',
  'REQUIRES_ACTION', 'REFUND_PENDING', 'REFUNDED'
);
create type public.payment_transaction_kind as enum ('CAPTURE', 'REFUND', 'REVERSAL', 'ADJUSTMENT');
create type public.financial_status as enum (
  'UNPAID', 'PARTIAL', 'PAID', 'REFUND_PENDING', 'PARTIALLY_REFUNDED', 'REFUNDED'
);
create type public.webhook_processing_status as enum ('RECEIVED', 'PROCESSING', 'COMPLETED', 'FAILED', 'DEAD');
create type public.commission_mode as enum ('PERCENT', 'FIXED');
create type public.commission_frequency as enum ('DAILY', 'WEEKLY', 'MONTHLY');
create type public.commission_entry_kind as enum ('EARNED', 'REVERSAL', 'ADJUSTMENT');
create type public.commission_payout_status as enum ('OPEN', 'PAID', 'CANCELED');
create type public.outbox_status as enum (
  'PENDING', 'PROCESSING', 'SENDING', 'SENT', 'SEND_UNKNOWN', 'FAILED', 'CANCELED'
);
create type public.message_attempt_status as enum (
  'ACCEPTED', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'DELETED', 'UNKNOWN'
);
create type public.consent_kind as enum ('WHATSAPP_TRANSACTIONAL', 'MARKETING', 'PRIVACY_POLICY');
create type public.consent_action as enum ('GRANTED', 'REVOKED');
create type public.privacy_request_kind as enum ('ACCESS', 'EXPORT', 'CORRECTION', 'ANONYMIZATION', 'DELETION');
create type public.privacy_request_status as enum ('OPEN', 'IN_PROGRESS', 'COMPLETED', 'REJECTED');
create type public.customer_action_kind as enum ('REQUEST_CANCEL', 'CONFIRM_CANCEL', 'RESCHEDULE');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  phone_e164 text check (phone_e164 is null or phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 2 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  timezone text not null default 'America/Sao_Paulo',
  currency char(3) not null default 'BRL' check (currency = upper(currency)),
  deposit_bps integer not null default 3000 check (deposit_bps between 0 and 10000),
  cancellation_lead_minutes integer not null default 1440 check (cancellation_lead_minutes >= 0),
  slot_interval_minutes smallint not null default 15 check (slot_interval_minutes in (5, 10, 15, 20, 30, 60)),
  hold_duration_minutes smallint not null default 10 check (hold_duration_minutes between 2 and 30),
  commission_frequency public.commission_frequency not null default 'MONTHLY',
  retention_days smallint not null default 30 check (retention_days between 1 and 365),
  whatsapp_phone_number_id text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, timezone),
  unique (id, currency)
);

create table public.locations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 2 and 120),
  address jsonb not null default '{}'::jsonb check (jsonb_typeof(address) = 'object'),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id)
);

create unique index locations_one_active_per_organization
  on public.locations (organization_id) where active;

create table public.organization_memberships (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.organization_role not null default 'OWNER',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create unique index organization_memberships_one_active_owner
  on public.organization_memberships (organization_id) where active and role = 'OWNER';

-- MVP has no tenant switcher: one authenticated manager can own one active
-- barbershop. This also keeps auth-context resolution deterministic.
create unique index organization_memberships_one_active_owner_per_user
  on public.organization_memberships (user_id) where active and role = 'OWNER';

create table public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  granted_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table public.saas_subscriptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null unique references public.organizations(id) on delete cascade,
  provider public.payment_provider not null default 'STRIPE' check (provider = 'STRIPE'),
  stripe_customer_id text unique,
  stripe_subscription_id text unique,
  stripe_price_id text,
  status public.saas_subscription_status not null default 'PROVISIONING',
  trial_consumed_at timestamptz,
  trial_ends_at timestamptz,
  current_period_ends_at timestamptz,
  grace_ends_at timestamptz,
  canceled_at timestamptz,
  retention_ends_at timestamptz,
  last_provider_event_created_at timestamptz,
  last_provider_event_id text,
  last_provider_event_type text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  check (status <> 'GRACE' or grace_ends_at is not null),
  check (status <> 'CANCELED_RETENTION' or retention_ends_at is not null)
);

create table public.billing_checkout_attempts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  requested_by_user_id uuid not null references auth.users(id),
  idempotency_key text not null,
  stripe_price_id text not null,
  status text not null default 'RESERVED'
    check (status in ('RESERVED', 'SESSION_CREATED', 'COMPLETED', 'CANCELED', 'EXPIRED')),
  stripe_checkout_session_id text unique,
  reserved_until timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  unique (organization_id, idempotency_key)
);

create unique index billing_checkout_attempts_one_active_per_org
  on public.billing_checkout_attempts (organization_id)
  where status in ('RESERVED', 'SESSION_CREATED');

create table public.organization_access_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  from_status public.saas_subscription_status,
  to_status public.saas_subscription_status not null,
  reason text not null,
  provider_event_id text,
  actor_user_id uuid references auth.users(id),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now()
);

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  auth_user_id uuid references auth.users(id) on delete set null,
  full_name text not null check (char_length(btrim(full_name)) between 2 and 160),
  phone_e164 text check (phone_e164 is null or phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  email text,
  birth_date date,
  notes text,
  active boolean not null default true,
  merged_into_customer_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (merged_into_customer_id, organization_id)
    references public.customers(id, organization_id)
);

create unique index customers_one_identity_per_organization
  on public.customers (organization_id, auth_user_id) where auth_user_id is not null;
create unique index customers_phone_per_organization
  on public.customers (organization_id, phone_e164) where phone_e164 is not null and merged_into_customer_id is null;

create table public.barbers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  location_id uuid not null,
  display_name text not null check (char_length(btrim(display_name)) between 2 and 120),
  bio text,
  avatar_url text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (location_id, organization_id)
    references public.locations(id, organization_id)
);

create table public.services (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 2 and 120),
  description text,
  price_cents bigint not null check (price_cents >= 0),
  duration_minutes integer not null check (duration_minutes between 5 and 720),
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id)
);

create unique index services_name_per_organization
  on public.services (organization_id, lower(name)) where active;

create table public.packages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 2 and 120),
  description text,
  price_cents bigint not null check (price_cents >= 0),
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id)
);

create unique index packages_name_per_organization
  on public.packages (organization_id, lower(name)) where active;

create table public.package_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  package_id uuid not null,
  service_id uuid not null,
  quantity smallint not null default 1 check (quantity between 1 and 20),
  position smallint not null default 0 check (position >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (package_id, organization_id)
    references public.packages(id, organization_id) on delete cascade,
  foreign key (service_id, organization_id)
    references public.services(id, organization_id)
);

create unique index package_items_one_active_service
  on public.package_items (package_id, service_id) where active;

create table public.barber_services (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  barber_id uuid not null,
  service_id uuid not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (barber_id, service_id),
  foreign key (barber_id, organization_id)
    references public.barbers(id, organization_id) on delete cascade,
  foreign key (service_id, organization_id)
    references public.services(id, organization_id) on delete cascade
);

create table public.work_intervals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  barber_id uuid not null,
  weekday smallint not null check (weekday between 0 and 6),
  starts_at time not null,
  ends_at time not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (barber_id, organization_id)
    references public.barbers(id, organization_id) on delete cascade,
  check (starts_at < ends_at)
);

alter table public.work_intervals
  add constraint work_intervals_no_overlap
  exclude using gist (
    organization_id with =,
    barber_id with =,
    weekday with =,
    int4range(
      (extract(epoch from starts_at) / 60)::integer,
      (extract(epoch from ends_at) / 60)::integer,
      '[)'
    ) with &&
  ) where (active);

create table public.availability_exceptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  barber_id uuid not null,
  kind public.availability_exception_kind not null default 'UNAVAILABLE',
  service_period tstzrange not null,
  reason text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (barber_id, organization_id)
    references public.barbers(id, organization_id) on delete cascade,
  check (not isempty(service_period)),
  check (lower_inc(service_period) and not upper_inc(service_period)),
  check (not lower_inf(service_period) and not upper_inf(service_period))
);

create table public.commission_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  barber_id uuid,
  service_id uuid,
  mode public.commission_mode not null,
  percentage_bps integer,
  fixed_cents bigint,
  effective_period tstzrange not null default tstzrange(now(), null, '[)'),
  active boolean not null default true,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (barber_id, organization_id)
    references public.barbers(id, organization_id),
  foreign key (service_id, organization_id)
    references public.services(id, organization_id),
  check (not isempty(effective_period)),
  check (
    (mode = 'PERCENT' and percentage_bps between 0 and 10000 and fixed_cents is null)
    or
    (mode = 'FIXED' and fixed_cents >= 0 and percentage_bps is null)
  )
);

create unique index commission_rules_one_active_scope
  on public.commission_rules (
    organization_id,
    coalesce(barber_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(service_id, '00000000-0000-0000-0000-000000000000'::uuid)
  ) where active;

create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  location_id uuid not null,
  customer_id uuid not null,
  barber_id uuid not null,
  status public.appointment_status not null,
  source public.booking_source not null,
  service_period tstzrange not null,
  hold_expires_at timestamptz,
  payment_mode public.payment_mode not null,
  currency char(3) not null default 'BRL' check (currency = upper(currency)),
  total_cents_snapshot bigint not null check (total_cents_snapshot >= 0),
  list_total_cents_snapshot bigint not null check (list_total_cents_snapshot >= 0),
  deposit_bps_snapshot integer not null check (deposit_bps_snapshot between 0 and 10000),
  deposit_required_cents_snapshot bigint not null check (deposit_required_cents_snapshot >= 0),
  cancellation_lead_minutes_snapshot integer not null check (cancellation_lead_minutes_snapshot >= 0),
  amount_waived_cents bigint not null default 0 check (amount_waived_cents >= 0),
  schedule_override_reason text,
  notes text,
  version integer not null default 1 check (version > 0),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (location_id, organization_id)
    references public.locations(id, organization_id),
  foreign key (customer_id, organization_id)
    references public.customers(id, organization_id),
  foreign key (barber_id, organization_id)
    references public.barbers(id, organization_id),
  check (not isempty(service_period)),
  check (lower_inc(service_period) and not upper_inc(service_period)),
  check (not lower_inf(service_period) and not upper_inf(service_period)),
  check (status not in ('HELD', 'PENDING_PAYMENT') or hold_expires_at is not null),
  check (status in ('HELD', 'PENDING_PAYMENT') or hold_expires_at is null),
  check (amount_waived_cents <= total_cents_snapshot)
);

alter table public.appointments
  add constraint appointments_no_barber_overlap
  exclude using gist (
    organization_id with =,
    barber_id with =,
    service_period with &&
  ) where (status in ('HELD', 'PENDING_PAYMENT', 'CONFIRMED', 'IN_SERVICE'));

create index appointments_org_start_idx
  on public.appointments (organization_id, lower(service_period));
create index appointments_customer_start_idx
  on public.appointments (customer_id, lower(service_period));

create table public.appointment_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  appointment_id uuid not null,
  selection_key uuid not null,
  source public.appointment_item_source not null,
  service_id uuid,
  package_id uuid,
  package_item_id uuid,
  service_name_snapshot text not null,
  quantity smallint not null default 1 check (quantity between 1 and 20),
  charged_price_cents_snapshot bigint not null check (charged_price_cents_snapshot >= 0),
  list_price_cents_snapshot bigint not null check (list_price_cents_snapshot >= 0),
  duration_minutes_snapshot integer not null check (duration_minutes_snapshot between 5 and 14400),
  commission_mode_snapshot public.commission_mode,
  commission_percentage_bps_snapshot integer,
  commission_fixed_cents_snapshot bigint,
  position smallint not null check (position >= 0),
  created_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (appointment_id, organization_id)
    references public.appointments(id, organization_id) on delete cascade,
  foreign key (service_id, organization_id)
    references public.services(id, organization_id),
  foreign key (package_id, organization_id)
    references public.packages(id, organization_id),
  foreign key (package_item_id, organization_id)
    references public.package_items(id, organization_id),
  check (
    (source = 'SERVICE' and service_id is not null and package_id is null and package_item_id is null)
    or
    (source = 'PACKAGE' and service_id is not null and package_id is not null and package_item_id is not null)
  ),
  check (
    (commission_mode_snapshot is null and commission_percentage_bps_snapshot is null and commission_fixed_cents_snapshot is null)
    or (commission_mode_snapshot = 'PERCENT' and commission_percentage_bps_snapshot between 0 and 10000 and commission_fixed_cents_snapshot is null)
    or (commission_mode_snapshot = 'FIXED' and commission_fixed_cents_snapshot >= 0 and commission_percentage_bps_snapshot is null)
  )
);

create table public.appointment_status_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  appointment_id uuid not null,
  from_status public.appointment_status,
  to_status public.appointment_status not null,
  reason text,
  actor_user_id uuid references auth.users(id),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  foreign key (appointment_id, organization_id)
    references public.appointments(id, organization_id) on delete cascade
);

create table public.merchant_accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  provider public.payment_provider not null default 'MERCADO_PAGO' check (provider = 'MERCADO_PAGO'),
  status public.merchant_account_status not null default 'PENDING',
  external_account_id text,
  access_token_secret_id uuid,
  refresh_token_secret_id uuid,
  token_expires_at timestamptz,
  scopes text[] not null default '{}',
  connected_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, provider),
  unique (id, organization_id),
  unique (provider, external_account_id)
);

create table public.merchant_oauth_states (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  provider public.payment_provider not null check (provider = 'MERCADO_PAGO'),
  state_hash text not null unique check (char_length(state_hash) >= 32),
  requested_by_user_id uuid not null references auth.users(id),
  return_path text not null check (return_path like '/%' and return_path not like '//%'),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  check (expires_at > created_at),
  check (consumed_at is null or consumed_at >= created_at)
);

create index merchant_oauth_states_live_idx
  on public.merchant_oauth_states (provider, state_hash, expires_at)
  where consumed_at is null;

create table public.billing_sessions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  kind text not null check (kind in ('CHECKOUT', 'PORTAL')),
  external_session_id text not null,
  idempotency_key text not null,
  requested_by_user_id uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique (kind, external_session_id),
  unique (organization_id, kind, idempotency_key)
);

create table public.payment_orders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  appointment_id uuid not null,
  provider public.payment_provider not null,
  kind public.payment_order_kind not null,
  status public.payment_order_status not null default 'CREATED',
  amount_cents bigint not null check (amount_cents > 0),
  currency char(3) not null default 'BRL' check (currency = upper(currency)),
  idempotency_key text not null,
  external_order_id text,
  external_checkout_url text,
  expires_at timestamptz,
  failure_code text,
  failure_message text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, idempotency_key),
  unique (provider, external_order_id),
  unique (id, organization_id),
  foreign key (appointment_id, organization_id)
    references public.appointments(id, organization_id),
  check (provider in ('MERCADO_PAGO', 'MANUAL'))
);

-- An appointment can expose only one live online charge. The appointment row
-- lock used by the checkout RPC serializes friendly retries; this index is the
-- final database guard for every other writer.
create unique index payment_orders_one_active_online_charge
  on public.payment_orders (appointment_id)
  where provider = 'MERCADO_PAGO'
    and kind in ('DEPOSIT', 'FULL')
    and status in ('CREATED', 'PENDING', 'PAID');

create table public.payment_transactions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  payment_order_id uuid not null,
  appointment_id uuid not null,
  provider public.payment_provider not null,
  kind public.payment_transaction_kind not null,
  amount_cents bigint not null check (amount_cents > 0),
  currency char(3) not null default 'BRL' check (currency = upper(currency)),
  external_transaction_id text,
  idempotency_key text not null,
  occurred_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  unique (organization_id, idempotency_key),
  unique (id, organization_id),
  unique (provider, external_transaction_id),
  foreign key (payment_order_id, organization_id)
    references public.payment_orders(id, organization_id),
  foreign key (appointment_id, organization_id)
    references public.appointments(id, organization_id),
  check (provider in ('MERCADO_PAGO', 'MANUAL'))
);

create table public.merchant_checkout_attempts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  payment_order_id uuid not null,
  requested_by_user_id uuid not null references auth.users(id),
  idempotency_key text not null,
  request_fingerprint text not null,
  status text not null default 'RESERVED'
    check (status in ('RESERVED', 'PREFERENCE_CREATED', 'COMPLETED', 'CANCELED', 'EXPIRED')),
  external_preference_id text unique,
  checkout_url text,
  reserved_until timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  unique (organization_id, idempotency_key),
  foreign key (payment_order_id, organization_id)
    references public.payment_orders(id, organization_id)
);

create unique index merchant_checkout_attempts_one_active_per_order
  on public.merchant_checkout_attempts (payment_order_id)
  where status in ('RESERVED', 'PREFERENCE_CREATED');

create table public.refund_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  appointment_id uuid not null,
  payment_order_id uuid not null,
  capture_transaction_id uuid not null,
  provider_payment_id text not null,
  amount_cents bigint not null check (amount_cents > 0),
  currency char(3) not null default 'BRL' check (currency = upper(currency)),
  reason text not null,
  status text not null default 'PENDING'
    check (status in ('PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'SEND_UNKNOWN', 'CANCELED')),
  idempotency_key text not null,
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  claimed_by text,
  claimed_at timestamptz,
  lease_expires_at timestamptz,
  external_refund_id text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  unique (payment_order_id),
  unique (organization_id, idempotency_key),
  unique (external_refund_id),
  foreign key (appointment_id, organization_id)
    references public.appointments(id, organization_id),
  foreign key (payment_order_id, organization_id)
    references public.payment_orders(id, organization_id),
  foreign key (capture_transaction_id, organization_id)
    references public.payment_transactions(id, organization_id)
);

create index refund_jobs_dispatch_idx
  on public.refund_jobs (next_attempt_at, created_at)
  where status in ('PENDING', 'FAILED');

create index payment_transactions_appointment_idx
  on public.payment_transactions (organization_id, appointment_id, occurred_at);

create table public.webhook_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  provider public.payment_provider not null,
  external_event_id text not null,
  event_type text not null,
  status public.webhook_processing_status not null default 'RECEIVED',
  signature_valid boolean not null,
  provider_created_at timestamptz,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz,
  processing_started_at timestamptz,
  processed_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, external_event_id)
);

create index webhook_events_dispatch_idx
  on public.webhook_events (status, next_attempt_at, created_at)
  where status in ('RECEIVED', 'FAILED');

create table public.commission_ledger (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  barber_id uuid not null,
  appointment_id uuid not null,
  appointment_item_id uuid,
  kind public.commission_entry_kind not null,
  amount_cents bigint not null check (amount_cents <> 0),
  idempotency_key text not null,
  source_entry_id uuid,
  reason text,
  earned_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (id, organization_id),
  unique (organization_id, idempotency_key),
  foreign key (barber_id, organization_id)
    references public.barbers(id, organization_id),
  foreign key (appointment_id, organization_id)
    references public.appointments(id, organization_id),
  foreign key (appointment_item_id, organization_id)
    references public.appointment_items(id, organization_id),
  foreign key (source_entry_id, organization_id)
    references public.commission_ledger(id, organization_id),
  check ((kind = 'EARNED' and amount_cents > 0 and source_entry_id is null)
      or (kind = 'REVERSAL' and amount_cents < 0 and source_entry_id is not null)
      or (kind = 'ADJUSTMENT' and reason is not null))
);

create unique index commission_ledger_one_reversal_per_entry
  on public.commission_ledger (source_entry_id)
  where kind = 'REVERSAL';

create table public.commission_payouts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  barber_id uuid not null,
  period_start date not null,
  period_end date not null,
  amount_cents bigint not null check (amount_cents >= 0),
  status public.commission_payout_status not null default 'OPEN',
  paid_at timestamptz,
  marked_paid_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (barber_id, organization_id)
    references public.barbers(id, organization_id),
  check (period_start <= period_end),
  check ((status = 'PAID' and paid_at is not null) or (status <> 'PAID' and paid_at is null))
);

create table public.commission_payout_items (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  payout_id uuid not null,
  ledger_entry_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (payout_id, ledger_entry_id),
  unique (organization_id, ledger_entry_id),
  foreign key (payout_id, organization_id)
    references public.commission_payouts(id, organization_id) on delete cascade,
  foreign key (ledger_entry_id, organization_id)
    references public.commission_ledger(id, organization_id)
);

create table public.notification_outbox (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  appointment_id uuid,
  channel text not null default 'WHATSAPP' check (channel = 'WHATSAPP'),
  template_key text not null,
  recipient_e164 text not null check (recipient_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  locale text not null default 'pt_BR',
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  idempotency_key text not null,
  status public.outbox_status not null default 'PENDING',
  scheduled_at timestamptz not null default now(),
  next_attempt_at timestamptz not null default now(),
  claimed_at timestamptz,
  claimed_by text,
  lease_expires_at timestamptz,
  attempts integer not null default 0 check (attempts >= 0),
  last_error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, idempotency_key),
  unique (id, organization_id),
  foreign key (appointment_id, organization_id)
    references public.appointments(id, organization_id)
);

create index notification_outbox_dispatch_idx
  on public.notification_outbox (next_attempt_at, created_at)
  where status in ('PENDING', 'FAILED');

create table public.message_attempts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  outbox_id uuid not null,
  attempt_number integer not null check (attempt_number > 0),
  status public.message_attempt_status not null,
  provider_message_id text,
  response jsonb not null default '{}'::jsonb check (jsonb_typeof(response) = 'object'),
  error_message text,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (outbox_id, attempt_number, status),
  unique (provider_message_id, status),
  foreign key (outbox_id, organization_id)
    references public.notification_outbox(id, organization_id)
);

create table public.customer_action_tokens (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  appointment_id uuid not null,
  customer_id uuid not null,
  action public.customer_action_kind not null,
  token_hash text not null unique check (char_length(token_hash) >= 32),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (appointment_id, organization_id)
    references public.appointments(id, organization_id) on delete cascade,
  foreign key (customer_id, organization_id)
    references public.customers(id, organization_id) on delete cascade,
  check (expires_at > created_at),
  check (consumed_at is null or consumed_at >= created_at)
);

create index customer_action_tokens_live_idx
  on public.customer_action_tokens (token_hash, expires_at) where consumed_at is null;

create table public.consent_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  customer_id uuid not null,
  kind public.consent_kind not null,
  action public.consent_action not null,
  source text not null,
  external_event_id text,
  proof jsonb not null default '{}'::jsonb check (jsonb_typeof(proof) = 'object'),
  policy_version text,
  occurred_at timestamptz not null default clock_timestamp(),
  created_at timestamptz not null default clock_timestamp(),
  unique (organization_id, external_event_id),
  foreign key (customer_id, organization_id)
    references public.customers(id, organization_id) on delete cascade
);

create table public.privacy_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  customer_id uuid not null,
  kind public.privacy_request_kind not null,
  status public.privacy_request_status not null default 'OPEN',
  requested_at timestamptz not null default now(),
  due_at timestamptz,
  completed_at timestamptz,
  resolution_notes text,
  handled_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (customer_id, organization_id)
    references public.customers(id, organization_id),
  check ((status = 'COMPLETED' and completed_at is not null) or status <> 'COMPLETED')
);

create table public.audit_events (
  id bigint generated always as identity primary key,
  organization_id uuid references public.organizations(id) on delete cascade,
  actor_user_id uuid references auth.users(id),
  actor_kind text not null check (actor_kind in ('USER', 'SYSTEM', 'PROVIDER')),
  action text not null,
  entity_type text not null,
  entity_id text,
  request_id text,
  ip_hash text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'profiles', 'organizations', 'locations', 'organization_memberships',
    'saas_subscriptions', 'billing_checkout_attempts', 'customers', 'barbers', 'services', 'packages',
    'work_intervals', 'appointments', 'merchant_accounts', 'payment_orders',
    'webhook_events', 'merchant_checkout_attempts', 'refund_jobs',
    'commission_payouts', 'notification_outbox', 'privacy_requests'
  ]
  loop
    execute format(
      'create trigger %I_set_updated_at before update on public.%I for each row execute function public.set_updated_at()',
      table_name, table_name
    );
  end loop;
end;
$$;

create or replace function public.reject_append_only_mutation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if (tg_table_name = 'consent_events'
      and current_setting('app.customer_merge', true) = 'on')
     or (tg_table_name in (
          'organization_access_events', 'appointment_status_events',
          'message_attempts', 'consent_events', 'audit_events'
        ) and current_setting('app.retention_redaction', true) = 'on') then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;
  raise exception using
    errcode = '55000',
    message = format('%I is append-only', tg_table_name);
end;
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'organization_access_events', 'appointment_status_events',
    'payment_transactions', 'commission_ledger', 'message_attempts',
    'consent_events', 'audit_events'
  ]
  loop
    execute format(
      'create trigger %I_append_only before update or delete on public.%I for each row execute function public.reject_append_only_mutation()',
      table_name, table_name
    );
  end loop;
end;
$$;

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

comment on table public.payment_transactions is
  'Append-only financial ledger. Refunds and reversals are compensating rows.';
comment on column public.merchant_accounts.access_token_secret_id is
  'Opaque Vault secret identifier. Never store provider tokens in public tables.';
comment on column public.appointment_items.list_price_cents_snapshot is
  'Frozen line total, already multiplied by quantity; percentage commission uses this amount directly.';
comment on constraint appointments_no_barber_overlap on public.appointments is
  'Final concurrency authority: active appointments for one barber never overlap.';
