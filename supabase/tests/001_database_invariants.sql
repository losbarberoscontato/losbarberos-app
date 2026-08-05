begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_temp;

select plan(80);

insert into auth.users (
  id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('10000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'owner1@example.test', '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('10000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'owner2@example.test', '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('10000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'platform@example.test', '{}'::jsonb, '{}'::jsonb, now(), now());

insert into public.organizations (id, name, slug, timezone, created_by) values
  ('20000000-0000-4000-8000-000000000001', 'Barbearia Um', 'barbearia-um', 'America/Sao_Paulo', '10000000-0000-4000-8000-000000000001'),
  ('20000000-0000-4000-8000-000000000002', 'Barbearia Dois', 'barbearia-dois', 'America/Sao_Paulo', '10000000-0000-4000-8000-000000000002');

insert into public.organization_memberships (organization_id, user_id, role) values
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'OWNER'),
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'OWNER');

insert into public.platform_admins (user_id)
values ('10000000-0000-4000-8000-000000000003');

insert into public.saas_subscriptions (organization_id, status) values
  ('20000000-0000-4000-8000-000000000001', 'ACTIVE'),
  ('20000000-0000-4000-8000-000000000002', 'ACTIVE');

insert into public.locations (id, organization_id, name) values
  ('30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'Unidade Um'),
  ('30000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', 'Unidade Dois');

insert into public.customers (
  id, organization_id, auth_user_id, full_name, phone_e164, email
) values
  ('40000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'Cliente Um', '+5511999990001', 'cliente1@example.test'),
  ('40000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'Cliente Dois', '+5511999990002', 'cliente2@example.test');

insert into public.barbers (id, organization_id, location_id, display_name) values
  ('50000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'Barbeiro Um'),
  ('50000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000002', 'Barbeiro Dois'),
  ('50000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'Barbeiro Override');

insert into public.services (
  id, organization_id, name, price_cents, duration_minutes, audiences
) values
  ('60000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'Corte', 5000, 30, array['MASCULINO']::text[]),
  ('60000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', 'Barba', 4000, 30, array['MASCULINO']::text[]);

insert into public.barber_services (organization_id, barber_id, service_id) values
  ('20000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000001'),
  ('20000000-0000-4000-8000-000000000002', '50000000-0000-4000-8000-000000000002', '60000000-0000-4000-8000-000000000002'),
  ('20000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000003', '60000000-0000-4000-8000-000000000001');

create temporary table test_context (v_start timestamptz not null);
insert into test_context values (
  ((current_date + 7) + time '10:00') at time zone 'America/Sao_Paulo'
);
grant select on test_context to authenticated;

insert into public.work_intervals (
  organization_id, barber_id, weekday, starts_at, ends_at
) values (
  '20000000-0000-4000-8000-000000000001',
  '50000000-0000-4000-8000-000000000001',
  extract(dow from (current_date + 7))::smallint,
  '08:00', '20:00'
);

insert into public.availability_exceptions (
  organization_id, barber_id, kind, service_period, reason
) values
  (
    '20000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000003', 'AVAILABLE_OVERRIDE',
    tstzrange(
      ((current_date + 8) + time '09:00') at time zone 'America/Sao_Paulo',
      ((current_date + 8) + time '10:00') at time zone 'America/Sao_Paulo', '[)'
    ), 'horario extra'
  ),
  (
    '20000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000003', 'UNAVAILABLE',
    tstzrange(
      ((current_date + 8) + time '09:15') at time zone 'America/Sao_Paulo',
      ((current_date + 8) + time '09:30') at time zone 'America/Sao_Paulo', '[)'
    ), 'bloqueio prioritario'
  );

insert into public.appointments (
  id, organization_id, location_id, customer_id, barber_id, status, source,
  service_period, hold_expires_at, payment_mode,
  total_cents_snapshot, list_total_cents_snapshot,
  deposit_bps_snapshot, deposit_required_cents_snapshot,
  cancellation_lead_minutes_snapshot
) values
  (
    '70000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000001',
    'CONFIRMED', 'MANAGER',
    tstzrange((select v_start from test_context), (select v_start from test_context) + interval '30 minutes', '[)'),
    null,
    'COUNTER', 5000, 5000, 3000, 1500, 1440
  ),
  (
    '70000000-0000-4000-8000-000000000002',
    '20000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000001',
    'CONFIRMED', 'MANAGER',
    tstzrange((select v_start from test_context) + interval '1 hour', (select v_start from test_context) + interval '90 minutes', '[)'),
    null,
    'COUNTER', 5000, 5000, 3000, 1500, 1440
  ),
  (
    '70000000-0000-4000-8000-000000000003',
    '20000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000001',
    'PENDING_PAYMENT', 'CUSTOMER',
    tstzrange((select v_start from test_context) + interval '2 hours', (select v_start from test_context) + interval '150 minutes', '[)'),
    now() + interval '10 minutes',
    'DEPOSIT', 10000, 10000, 3000, 3000, 1440
  ),
  (
    '70000000-0000-4000-8000-000000000004',
    '20000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000001',
    'PENDING_PAYMENT', 'MANAGER',
    tstzrange((select v_start from test_context) + interval '3 hours', (select v_start from test_context) + interval '210 minutes', '[)'),
    now() + interval '10 minutes',
    'COUNTER', 5000, 5000, 3000, 1500, 1440
  );

insert into public.appointment_items (
  id, organization_id, appointment_id, selection_key, source, service_id,
  service_name_snapshot, charged_price_cents_snapshot,
  list_price_cents_snapshot, duration_minutes_snapshot, position
) values
  ('71000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000001', '72000000-0000-4000-8000-000000000001', 'SERVICE', '60000000-0000-4000-8000-000000000001', 'Corte', 5000, 5000, 30, 1),
  ('71000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000002', '72000000-0000-4000-8000-000000000002', 'SERVICE', '60000000-0000-4000-8000-000000000001', 'Corte', 5000, 5000, 30, 1);

insert into public.payment_orders (
  id, organization_id, appointment_id, provider, kind, status,
  amount_cents, idempotency_key
) values
  ('80000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000001', 'MANUAL', 'BALANCE', 'PAID', 1000, 'manual-ledger-order'),
  ('80000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000003', 'MERCADO_PAGO', 'DEPOSIT', 'PENDING', 3000, 'mp-deposit-order');

insert into public.payment_transactions (
  id, organization_id, payment_order_id, appointment_id, provider, kind,
  amount_cents, idempotency_key
) values (
  '81000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  '80000000-0000-4000-8000-000000000001',
  '70000000-0000-4000-8000-000000000001',
  'MANUAL', 'CAPTURE', 1000, 'manual-ledger-capture'
);

select has_table('public', 'organizations', 'organizations table exists');
select has_table('public', 'appointments', 'appointments table exists');
select has_table('public', 'refund_jobs', 'durable refund job table exists');
select has_function('public', 'create_appointment_hold', 'hold RPC exists');
select ok(
  not has_table_privilege('authenticated', 'public.packages', 'INSERT')
    and not has_table_privilege('authenticated', 'public.package_items', 'UPDATE'),
  'browser cannot bypass atomic package RPC with direct DML'
);
select ok(
  not has_table_privilege('authenticated', 'public.commission_rules', 'INSERT')
    and not has_table_privilege('authenticated', 'public.commission_rules', 'UPDATE'),
  'browser cannot bypass versioned commission-rule RPC with direct DML'
);

select throws_ok(
  $$insert into public.organization_memberships (organization_id, user_id, role)
    values ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', 'OWNER')$$,
  '23505', null, 'one active owner per organization'
);

select throws_ok(
  $$with new_organization as (
      insert into public.organizations (id, name, slug, timezone, created_by)
      values (
        '20000000-0000-4000-8000-000000000003', 'Barbearia Tres',
        'barbearia-tres', 'America/Sao_Paulo',
        '10000000-0000-4000-8000-000000000001'
      ) returning id
    )
    insert into public.organization_memberships (organization_id, user_id, role)
    select id, '10000000-0000-4000-8000-000000000001', 'OWNER'
    from new_organization$$,
  '23505', null, 'MVP allows one active owned tenant per user'
);

select throws_ok(
  $$insert into public.locations (organization_id, name)
    values ('20000000-0000-4000-8000-000000000001', 'Outra unidade')$$,
  '23505', null, 'one active location per organization'
);

select throws_ok(
  $$insert into public.barbers (organization_id, location_id, display_name)
    values ('20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000002', 'Cross tenant')$$,
  '23503', null, 'composite FK blocks cross-tenant reference'
);

select throws_ok(
  $$insert into public.appointments (
      organization_id, location_id, customer_id, barber_id, status, source,
      service_period, payment_mode, total_cents_snapshot, list_total_cents_snapshot,
      deposit_bps_snapshot, deposit_required_cents_snapshot,
      cancellation_lead_minutes_snapshot
    ) values (
      '20000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000001',
      '40000000-0000-4000-8000-000000000001',
      '50000000-0000-4000-8000-000000000001', 'CONFIRMED', 'MANAGER',
      tstzrange((select v_start from test_context) + interval '15 minutes', (select v_start from test_context) + interval '45 minutes', '[)'),
      'COUNTER', 5000, 5000, 3000, 1500, 1440
    )$$,
  '23P01', null, 'GiST rejects overlapping active appointment'
);

select lives_ok(
  $$insert into public.appointments (
      organization_id, location_id, customer_id, barber_id, status, source,
      service_period, payment_mode, total_cents_snapshot, list_total_cents_snapshot,
      deposit_bps_snapshot, deposit_required_cents_snapshot,
      cancellation_lead_minutes_snapshot
    ) values (
      '20000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000001',
      '40000000-0000-4000-8000-000000000001',
      '50000000-0000-4000-8000-000000000001', 'CONFIRMED', 'MANAGER',
      tstzrange((select v_start from test_context) + interval '30 minutes', (select v_start from test_context) + interval '1 hour', '[)'),
      'COUNTER', 5000, 5000, 3000, 1500, 1440
    )$$,
  'adjacent half-open periods are accepted'
);

select throws_ok(
  $$update public.payment_transactions set metadata = '{"tampered":true}' where id = '81000000-0000-4000-8000-000000000001'$$,
  '55000', null, 'financial ledger is append-only'
);

select throws_ok(
  $$insert into public.payment_orders (
      organization_id, appointment_id, provider, kind, amount_cents, idempotency_key
    ) values (
      '20000000-0000-4000-8000-000000000001',
      '70000000-0000-4000-8000-000000000001', 'STRIPE', 'FULL', 5000, 'stripe-is-forbidden'
    )$$,
  '23514', null, 'Stripe is forbidden from appointment payment ledger'
);
select is(
  (
    select jsonb_array_length(barber -> 'service_ids')
    from jsonb_array_elements(
      public.get_public_booking_context('barbearia-um') -> 'barbers'
    ) barber
    where barber ->> 'id' = '50000000-0000-4000-8000-000000000001'
  ),
  1, 'public booking context exposes only active barber competencies'
);

select throws_ok(
  $$insert into public.payment_orders (
      organization_id, appointment_id, provider, kind, status,
      amount_cents, idempotency_key
    ) values (
      '20000000-0000-4000-8000-000000000001',
      '70000000-0000-4000-8000-000000000003', 'MERCADO_PAGO',
      'DEPOSIT', 'CREATED', 3000, 'second-live-online-order'
    )$$,
  '23505', null, 'one appointment cannot expose two live online payment orders'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select is((select count(*) from public.organizations), 1::bigint, 'owner sees only own organization');
select is((select count(*) from public.customers), 1::bigint, 'owner sees only own customers');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select is((select count(*) from public.organizations), 2::bigint, 'platform admin sees control-plane organizations');
select is((select count(*) from public.customers), 0::bigint, 'platform admin cannot read tenant customer PII');
select is((select count(*) from public.organization_memberships), 0::bigint, 'platform admin cannot read tenant user UUID memberships');
reset role;

select is(
  public.record_provider_webhook(
    'MERCADO_PAGO', 'evt-duplicate-1', 'payment.updated',
    '20000000-0000-4000-8000-000000000001', '{}'::jsonb
  ) ->> 'inserted',
  'true', 'first webhook event is accepted'
);
select is(
  public.record_provider_webhook(
    'MERCADO_PAGO', 'evt-duplicate-1', 'payment.updated',
    '20000000-0000-4000-8000-000000000001', '{}'::jsonb
  ) ->> 'inserted',
  'false', 'duplicate webhook event is idempotent'
);
select is(
  (select count(*) from public.webhook_events where provider = 'MERCADO_PAGO' and external_event_id = 'evt-duplicate-1'),
  1::bigint, 'duplicate webhook produces one inbox row'
);

select is(
  public.reserve_stripe_checkout_attempt(
    '20000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001', 'stripe-attempt-a', 'price_test'
  ) ->> 'created',
  'true', 'first Stripe checkout attempt reserves organization'
);
select is(
  public.reserve_stripe_checkout_attempt(
    '20000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001', 'stripe-attempt-b', 'price_test'
  ) ->> 'status',
  'CHECKOUT_IN_PROGRESS', 'different idempotency key cannot create second Stripe checkout'
);
select is(
  (select count(*) from public.billing_checkout_attempts where organization_id = '20000000-0000-4000-8000-000000000001'),
  1::bigint, 'only one active Stripe checkout row exists'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select throws_ok(
  $$select public.reschedule_appointment(
      '70000000-0000-4000-8000-000000000002',
      '50000000-0000-4000-8000-000000000001',
      (select v_start from test_context), null, null
    )$$,
  '23P01', null, 'failed reschedule reports slot conflict'
);
select is(
  (select service_period from public.appointments where id = '70000000-0000-4000-8000-000000000002'),
  tstzrange((select v_start from test_context) + interval '1 hour', (select v_start from test_context) + interval '90 minutes', '[)'),
  'failed reschedule preserves original period atomically'
);
select throws_ok(
  $$select public.record_manual_payment(
      '70000000-0000-4000-8000-000000000001', 5000,
      'overpayment', 'manual-overpayment-test'
    )$$,
  '22023', 'manual payment exceeds outstanding balance',
  'manual payment cannot exceed outstanding balance'
);
select lives_ok(
  $$select public.confirm_appointment_without_payment(
      '70000000-0000-4000-8000-000000000004',
      'gestor confirmou saldo no balcao'
    )$$,
  'manager explicitly confirms without payment'
);
select is(
  (select status::text from public.appointments where id = '70000000-0000-4000-8000-000000000004'),
  'CONFIRMED', 'explicit no-payment confirmation leaves operational appointment confirmed'
);

select lives_ok(
  $$select public.save_package_with_items(
      '20000000-0000-4000-8000-000000000001', null,
      'Combo Completo', 'teste atomico', 4500, true, 1, array['MASCULINO']::text[],
      '[{"service_id":"60000000-0000-4000-8000-000000000001","quantity":1}]'::jsonb
    )$$,
  'package and items save atomically'
);
select is(
  (select count(*) from public.package_items pi
    join public.packages p on p.id = pi.package_id
    where p.organization_id = '20000000-0000-4000-8000-000000000001'
      and p.name = 'Combo Completo'),
  1::bigint, 'atomic package save persists complete item set'
);
select lives_ok(
  $$select public.save_package_with_items(
      '20000000-0000-4000-8000-000000000001',
      (select id from public.packages
        where organization_id = '20000000-0000-4000-8000-000000000001'
          and name = 'Combo Completo'),
      'Combo Completo', 'segunda versao', 8000, true, 1, array['MASCULINO']::text[],
      '[{"service_id":"60000000-0000-4000-8000-000000000001","quantity":2}]'::jsonb
    )$$,
  'used package composition can be versioned without deleting history'
);
select is(
  (select count(*) from public.package_items pi
    join public.packages p on p.id = pi.package_id
    where p.organization_id = '20000000-0000-4000-8000-000000000001'
      and p.name = 'Combo Completo' and pi.active),
  1::bigint, 'package replacement exposes one active composition version'
);

select lives_ok(
  $$select public.replace_commission_rule(
      '20000000-0000-4000-8000-000000000001', null, null,
      'PERCENT', 3000, null, now() - interval '2 minutes', null
    )$$,
  'first commission rule version is created'
);
select lives_ok(
  $$select public.replace_commission_rule(
      '20000000-0000-4000-8000-000000000001', null, null,
      'PERCENT', 3500, null, now() - interval '1 minute', null
    )$$,
  'commission rule replacement is atomic'
);
select is(
  (select count(*) from public.commission_rules
    where organization_id = '20000000-0000-4000-8000-000000000001' and active),
  1::bigint, 'one active commission rule remains per scope'
);
select is(
  (select count(*) from public.commission_rules
    where organization_id = '20000000-0000-4000-8000-000000000001'),
  2::bigint, 'commission rule history is versioned'
);
reset role;

insert into public.commission_ledger (
  id, organization_id, barber_id, appointment_id, appointment_item_id,
  kind, amount_cents, idempotency_key, earned_at
) values (
  '82000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  '50000000-0000-4000-8000-000000000001',
  '70000000-0000-4000-8000-000000000001',
  '71000000-0000-4000-8000-000000000001',
  'EARNED', 1000, 'commission-earned-test', now()
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select lives_ok(
  $$select public.adjust_commission_entry(
      '82000000-0000-4000-8000-000000000001', 'ADJUSTMENT', -200,
      'correcao parcial', 'commission-adjust-test'
    )$$,
  'commission correction appends adjustment'
);
select is(
  (select sum(amount_cents) from public.commission_ledger
    where id = '82000000-0000-4000-8000-000000000001'
       or source_entry_id = '82000000-0000-4000-8000-000000000001'),
  800::numeric, 'commission adjustment preserves nonnegative remainder'
);
select lives_ok(
  $$select public.adjust_commission_entry(
      '82000000-0000-4000-8000-000000000001', 'REVERSAL', -800,
      'estorno integral restante', 'commission-reversal-test'
    )$$,
  'commission remainder can be fully reversed once'
);
select is(
  (select sum(amount_cents) from public.commission_ledger
    where id = '82000000-0000-4000-8000-000000000001'
       or source_entry_id = '82000000-0000-4000-8000-000000000001'),
  0::numeric, 'append-only reversal zeros commission without editing history'
);
select throws_ok(
  $$select public.adjust_commission_entry(
      '82000000-0000-4000-8000-000000000001', 'ADJUSTMENT', 100,
      'ajuste indevido', 'commission-after-reversal-test'
    )$$,
  '22023', 'commission entry is already fully reversed',
  'fully reversed commission rejects later mutation'
);
reset role;

select is(
  jsonb_array_length(
    public.get_available_slots(
      'barbearia-um', '50000000-0000-4000-8000-000000000003', current_date + 8,
      '[{"type":"SERVICE","service_id":"60000000-0000-4000-8000-000000000001"}]'::jsonb
    ) -> 'slots'
  ),
  1, 'AVAILABLE_OVERRIDE generates candidates and UNAVAILABLE remains authoritative'
);

select is(
  public.register_provider_payment(
    '80000000-0000-4000-8000-000000000002', 'mp-payment-first', 3000, 'mp-capture-first'
  ) ->> 'disposition',
  'CONFIRMED', 'exact first capture confirms appointment'
);
select is(
  public.register_provider_payment(
    '80000000-0000-4000-8000-000000000002', 'mp-payment-second', 3000, 'mp-capture-second'
  ) ->> 'disposition',
  'REFUND_PENDING_DUPLICATE_CAPTURE', 'second capture becomes durable duplicate refund'
);
select is(
  (select sum(amount_cents) from public.refund_jobs where appointment_id = '70000000-0000-4000-8000-000000000003'),
  3000::numeric, 'excess capture refund job reserves exact excess amount'
);

insert into public.notification_outbox (
  id, organization_id, appointment_id, template_key, recipient_e164,
  idempotency_key, status, claimed_by, claimed_at, lease_expires_at, attempts
) values (
  '90000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  '70000000-0000-4000-8000-000000000001',
  'test_send_unknown', '+5511999990001', 'send-unknown-test',
  'PROCESSING', 'worker-test', now(), now() + interval '1 minute', 1
);
select ok(
  not public.begin_notification_send('90000000-0000-4000-8000-000000000001', 'worker-test'),
  'WhatsApp outbox cannot send without explicit transactional consent grant'
);
insert into public.consent_events (
  organization_id, customer_id, kind, action, source, proof
) values (
  '20000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000001',
  'WHATSAPP_TRANSACTIONAL', 'GRANTED', 'PGTAP', '{"proof":"explicit"}'::jsonb
);
select ok(
  public.begin_notification_send('90000000-0000-4000-8000-000000000001', 'worker-test'),
  'worker marks outbox SENDING immediately before provider call'
);
update public.notification_outbox set lease_expires_at = now() - interval '1 second'
where id = '90000000-0000-4000-8000-000000000001';
select is(public.mark_expired_notification_sends_unknown(10), 1, 'expired SENDING lease is reconciled once');
select is(
  (select status::text from public.notification_outbox where id = '90000000-0000-4000-8000-000000000001'),
  'SEND_UNKNOWN', 'ambiguous WhatsApp send is never automatically requeued'
);

select public.complete_stripe_checkout_attempt(
  (select id from public.billing_checkout_attempts
    where organization_id = '20000000-0000-4000-8000-000000000001'),
  'cs_test_los_barberos', '10000000-0000-4000-8000-000000000001'
);
select is(
  public.process_stripe_billing_webhook(
    'evt-stripe-checkout', 'checkout.session.completed', now(), false, null, null,
    jsonb_build_object(
      'id', 'cs_test_los_barberos',
      'client_reference_id', '20000000-0000-4000-8000-000000000001',
      'customer', 'cus_los_barberos', 'subscription', 'sub_los_barberos',
      'metadata', jsonb_build_object('organization_id', '20000000-0000-4000-8000-000000000001')
    )
  ) ->> 'applied',
  'true', 'reserved Stripe checkout binds tenant customer and subscription'
);

create temporary table stripe_test_context (
  event_at timestamptz not null,
  first_grace_until timestamptz not null
);
insert into stripe_test_context values (now() + interval '1 minute', now() + interval '7 days');
select is(
  public.process_stripe_billing_webhook(
    'evt-stripe-failed-1', 'invoice.payment_failed',
    (select event_at from stripe_test_context), false, 'GRACE',
    (select first_grace_until from stripe_test_context),
    '{"customer":"cus_los_barberos","subscription":"sub_los_barberos"}'::jsonb
  ) ->> 'applied',
  'true', 'first Stripe renewal failure opens grace'
);
select is(
  public.process_stripe_billing_webhook(
    'evt-stripe-failed-2', 'invoice.payment_failed',
    (select event_at + interval '1 second' from stripe_test_context), false, 'GRACE',
    (select first_grace_until + interval '7 days' from stripe_test_context),
    '{"customer":"cus_los_barberos","subscription":"sub_los_barberos"}'::jsonb
  ) ->> 'applied',
  'true', 'later Stripe retry is processed idempotently'
);
select is(
  (select grace_ends_at from public.saas_subscriptions
    where organization_id = '20000000-0000-4000-8000-000000000001'),
  (select first_grace_until from stripe_test_context),
  'renewal retries never extend the original seven-day grace deadline'
);
select is(
  public.process_stripe_billing_webhook(
    'evt-stripe-old-paid', 'invoice.paid',
    (select event_at - interval '1 second' from stripe_test_context), false, 'ACTIVE', null,
    '{"customer":"cus_los_barberos","subscription":"sub_los_barberos"}'::jsonb
  ) ->> 'reason',
  'STALE_EVENT', 'older Stripe event cannot reopen billing state'
);
select is(
  public.process_stripe_billing_webhook(
    'evt-stripe-equal-paid', 'invoice.paid',
    (select event_at + interval '1 second' from stripe_test_context), false, 'ACTIVE', null,
    '{"customer":"cus_los_barberos","subscription":"sub_los_barberos"}'::jsonb
  ) ->> 'reason',
  'STALE_EVENT', 'equal-second lower-precedence Stripe event cannot reopen state'
);
select is(
  public.process_stripe_billing_webhook(
    'evt-stripe-unexpected-sub', 'customer.subscription.updated',
    (select event_at + interval '2 seconds' from stripe_test_context), false, 'ACTIVE', null,
    jsonb_build_object(
      'id', 'sub_unexpected', 'customer', 'cus_los_barberos',
      'items', jsonb_build_object('data', jsonb_build_array(
        jsonb_build_object('price', jsonb_build_object('id', 'price_test'))
      )),
      'metadata', jsonb_build_object('organization_id', '20000000-0000-4000-8000-000000000001')
    )
  ) ->> 'cancel_unexpected_subscription_id',
  'sub_unexpected', 'unexpected unbound Stripe subscription requires cancellation proof'
);
select is(
  (select status::text from public.webhook_events
    where provider = 'STRIPE' and external_event_id = 'evt-stripe-unexpected-sub'),
  'FAILED', 'unexpected subscription webhook remains retryable until cancellation'
);
select ok(
  public.complete_unexpected_stripe_subscription_cancellation(
    'evt-stripe-unexpected-sub', 'sub_unexpected'
  ), 'cancellation completion contract accepts matching proof'
);
select is(
  (select status::text from public.webhook_events
    where provider = 'STRIPE' and external_event_id = 'evt-stripe-unexpected-sub'),
  'COMPLETED', 'unexpected subscription webhook completes only after cancellation proof'
);

update public.saas_subscriptions
set stripe_customer_id = 'cus_bound_org2',
    stripe_subscription_id = 'sub_bound_org2', stripe_price_id = 'price_test'
where organization_id = '20000000-0000-4000-8000-000000000002';
create temporary table stripe_cross_org_result (payload jsonb not null);
insert into stripe_cross_org_result
select public.process_stripe_billing_webhook(
  'evt-stripe-cross-org', 'customer.subscription.updated',
  now() + interval '2 minutes', false, 'ACTIVE', null,
  jsonb_build_object(
    'id', 'sub_bound_org2', 'customer', 'cus_bound_org2',
    'items', jsonb_build_object('data', jsonb_build_array(
      jsonb_build_object('price', jsonb_build_object('id', 'price_test'))
    )),
    'metadata', jsonb_build_object(
      'organization_id', '20000000-0000-4000-8000-000000000001'
    )
  )
);
select is(
  (select payload ->> 'reason' from stripe_cross_org_result),
  'CROSS_ORGANIZATION_BINDING', 'cross-org Stripe metadata is rejected and audited'
);
select ok(
  not (select payload ? 'cancel_unexpected_subscription_id' from stripe_cross_org_result),
  'cross-org rejection never requests cancellation of another tenant subscription'
);
select is(
  (select stripe_subscription_id from public.saas_subscriptions
    where organization_id = '20000000-0000-4000-8000-000000000002'),
  'sub_bound_org2', 'legitimate cross-tenant Stripe binding remains untouched'
);

select has_function(
  'public', 'get_merchant_token_refresh_context',
  'Mercado Pago refresh context RPC exists'
);
select has_function(
  'public', 'store_refreshed_merchant_oauth_credentials',
  'Mercado Pago rotating-token CAS RPC exists'
);
select has_function(
  'public', 'mark_merchant_reauth_required',
  'Mercado Pago reauthorization RPC exists'
);
select ok(
  has_function_privilege(
    'service_role', 'public.get_merchant_token_refresh_context(uuid)', 'EXECUTE'
  ), 'service role can read Vault-backed refresh context'
);
select ok(
  not has_function_privilege(
    'authenticated', 'public.get_merchant_token_refresh_context(uuid)', 'EXECUTE'
  ), 'authenticated browser cannot read merchant refresh tokens'
);

create temporary table merchant_token_test_context (
  access_secret_id uuid not null,
  refresh_secret_id uuid not null
);
insert into merchant_token_test_context
select
  vault.create_secret('test-access-old', 'pgtap-mp-access', 'test only'),
  vault.create_secret('test-refresh-old', 'pgtap-mp-refresh', 'test only');
insert into public.merchant_accounts (
  organization_id, provider, status, external_account_id,
  access_token_secret_id, refresh_token_secret_id, token_expires_at
)
select
  '20000000-0000-4000-8000-000000000001', 'MERCADO_PAGO', 'CONNECTED',
  'mp-account-test', access_secret_id, refresh_secret_id, now() + interval '1 hour'
from merchant_token_test_context;
select is(
  public.get_merchant_token_refresh_context(
    '20000000-0000-4000-8000-000000000001'
  ) ->> 'refresh_token',
  'test-refresh-old', 'refresh context reads current rotating token from Vault'
);
select is(
  public.store_refreshed_merchant_oauth_credentials(
    '20000000-0000-4000-8000-000000000001',
    'test-refresh-old', 'test-access-new', 'test-refresh-new',
    now() + interval '2 hours', 'read write'
  ) ->> 'updated',
  'true', 'matching refresh token atomically persists both rotated tokens'
);
select is(
  public.store_refreshed_merchant_oauth_credentials(
    '20000000-0000-4000-8000-000000000001',
    'test-refresh-old', 'test-access-racing', 'test-refresh-racing',
    now() + interval '3 hours', 'read write'
  ) ->> 'access_token',
  'test-access-new', 'stale refresh CAS returns winner access token without overwrite'
);
select ok(
  public.mark_merchant_reauth_required(
    '20000000-0000-4000-8000-000000000001', 'invalid_grant'
  ), 'terminal refresh failure marks merchant for reauthorization'
);
select is(
  (select status::text from public.merchant_accounts
    where organization_id = '20000000-0000-4000-8000-000000000001'),
  'REAUTH_REQUIRED', 'merchant reauthorization state is persisted'
);

update public.saas_subscriptions
set status = 'CANCELED_RETENTION', canceled_at = now(),
    retention_ends_at = now() + interval '30 days'
where organization_id = '20000000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select ok(
  public.export_organization_data('20000000-0000-4000-8000-000000000001')
    #>> '{organization,id}' = '20000000-0000-4000-8000-000000000001',
  'owner can export tenant data during cancellation retention window'
);
select throws_ok(
  $$insert into public.services (organization_id, name, price_cents, duration_minutes, audiences)
    values ('20000000-0000-4000-8000-000000000001', 'Mutacao Retencao', 1, 5, array['MASCULINO']::text[])$$,
  '42501', null, 'retention window is export-only for manager CRUD'
);
select lives_ok(
  $$select public.submit_privacy_request(
      '20000000-0000-4000-8000-000000000001',
      '40000000-0000-4000-8000-000000000001', 'ACCESS'
    )$$,
  'data subject can still exercise privacy rights during retention'
);
reset role;
update public.saas_subscriptions set status = 'CLOSED'
where organization_id = '20000000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select throws_ok(
  $$select public.export_organization_data('20000000-0000-4000-8000-000000000001')$$,
  '42501', 'organization export window is closed',
  'CLOSED tenant cannot export after retention window'
);
reset role;

select * from finish();
rollback;
