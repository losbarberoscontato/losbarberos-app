begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_temp;

select plan(122);

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

select has_table('public', 'default_chart_account_templates', 'global default chart template table exists');
select is((select count(*) from public.default_chart_account_templates), 42::bigint, 'PDF chart template has 42 accounts');
select is((select count(*) from public.chart_of_accounts where organization_id = '20000000-0000-4000-8000-000000000001'), 42::bigint, 'new first tenant receives complete default chart');
select has_column('public', 'financial_accounts', 'description', 'financial accounts expose description');
select is((select count(*) from public.financial_accounts where organization_id = '20000000-0000-4000-8000-000000000001' and name = 'Caixa Físico'), 1::bigint, 'new first tenant receives default physical cash account');
select is((select description from public.financial_accounts where organization_id = '20000000-0000-4000-8000-000000000001' and name = 'Caixa Físico'), 'Caixa físico para recebimento à vista em dinheiro físico.', 'default cash account keeps description');
select is((select count(*) from public.payment_account_mappings where organization_id = '20000000-0000-4000-8000-000000000001' and provider = 'MANUAL' and payment_mode = 'COUNTER'), 1::bigint, 'default cash account maps manual counter payments');
select is(public.seed_default_financial_accounts('20000000-0000-4000-8000-000000000001'), 0, 'default account seed is idempotent');
select ok(not has_function_privilege('authenticated', 'public.seed_default_financial_accounts(uuid)', 'EXECUTE'), 'browser cannot seed default financial accounts');
select is((select count(*) from public.chart_of_accounts where organization_id = '20000000-0000-4000-8000-000000000002'), 42::bigint, 'new second tenant receives complete default chart');
select is((select count(*) from public.chart_of_accounts where organization_id = '20000000-0000-4000-8000-000000000001' and kind = 'REVENUE'), 12::bigint, 'default chart keeps 12 revenue accounts');
select is((select count(*) from public.chart_of_accounts where organization_id = '20000000-0000-4000-8000-000000000001' and kind = 'EXPENSE'), 30::bigint, 'default chart keeps 30 expense accounts');
select is((select parent.code from public.chart_of_accounts child join public.chart_of_accounts parent on parent.id = child.parent_id where child.organization_id = '20000000-0000-4000-8000-000000000001' and child.code = '1.1'), '1', 'revenue category resolves tenant-scoped parent');
select is((select parent.code from public.chart_of_accounts child join public.chart_of_accounts parent on parent.id = child.parent_id where child.organization_id = '20000000-0000-4000-8000-000000000001' and child.code = '2.8.2'), '2.8', 'expense leaf resolves tenant-scoped parent');
select is(public.replace_chart_of_accounts_from_default('20000000-0000-4000-8000-000000000001'), 42, 'empty tenant chart can be replaced from default');
select ok(not has_function_privilege('authenticated', 'public.replace_chart_of_accounts_from_default(uuid)', 'EXECUTE'), 'browser cannot replace a tenant chart');
insert into public.financial_entries (organization_id, kind, description, issue_date, due_date, total_cents, chart_account_id)
values ('20000000-0000-4000-8000-000000000001', 'REVENUE', 'Receita de guarda', current_date, current_date, 100, (select id from public.chart_of_accounts where organization_id = '20000000-0000-4000-8000-000000000001' and code = '1.1.1'));
select throws_ok($$select public.replace_chart_of_accounts_from_default('20000000-0000-4000-8000-000000000001')$$, '22023', 'financial entries reference the current chart of accounts', 'chart replacement rejects tenant financial history');

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

-- Global client identity: self-owned account, explicit tenant links and review-only ambiguity.
insert into auth.users (
  id, aud, role, email, email_confirmed_at, phone, phone_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('10000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated',
    'client-a@example.test', now(), '+5511999991004', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('10000000-0000-4000-8000-000000000005', 'authenticated', 'authenticated',
    'client-b@example.test', now(), '+5511999991005', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('10000000-0000-4000-8000-000000000006', 'authenticated', 'authenticated',
    'manager-client-test@example.test', now(), '+5511999991006', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('10000000-0000-4000-8000-000000000007', 'authenticated', 'authenticated',
    'client-c@example.test', now(), '+5511999991007', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('10000000-0000-4000-8000-000000000008', 'authenticated', 'authenticated',
    'client-unconfirmed@example.test', null, null, null, '{}'::jsonb, '{}'::jsonb, now(), now());

insert into public.organizations (id, name, slug, timezone, created_by) values
  ('20000000-0000-4000-8000-000000000003', 'Barbearia Tres', 'barbearia-tres', 'America/Sao_Paulo', '10000000-0000-4000-8000-000000000006'),
  ('20000000-0000-4000-8000-000000000004', 'Barbearia Quatro', 'barbearia-quatro', 'America/Sao_Paulo', '10000000-0000-4000-8000-000000000006');
insert into public.organization_memberships (organization_id, user_id, role) values
  ('20000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000006', 'OWNER');
insert into public.saas_subscriptions (organization_id, status) values
  ('20000000-0000-4000-8000-000000000003', 'ACTIVE'),
  ('20000000-0000-4000-8000-000000000004', 'ACTIVE');

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000004', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select lives_ok(
  $$select public.upsert_my_client_account('Cliente A', '+5511999991004', '1990-01-02', 'v1')$$,
  'valid E.164 plus prefix creates global account through RPC'
);
select throws_ok(
  $$select public.upsert_my_client_account('Cliente A', '5511999991004', '1990-01-02', 'v1')$$,
  '22023', 'invalid client account profile',
  'phone without E.164 plus prefix is rejected'
);
select is(
  (select full_name from public.client_accounts), 'Cliente A',
  'client A can read own account'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000008', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select throws_ok(
  $$select public.upsert_my_client_account('Cliente Sem Confirmacao', '+5511999991008', '1993-04-05', 'v1')$$,
  '42501', 'email confirmation required',
  'unconfirmed auth email cannot upsert global client account'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000005', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select is(
  (select count(*) from public.client_accounts), 0::bigint,
  'client B cannot read client A account'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000004', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select throws_ok(
  $$update public.client_accounts set phone_verified_at = now()
    where auth_user_id = '10000000-0000-4000-8000-000000000004'$$,
  '42501', null, 'client cannot spoof verified phone evidence directly'
);
select throws_ok(
  $$update public.client_accounts set terms_accepted_at = now() + interval '1 day'
    where auth_user_id = '10000000-0000-4000-8000-000000000004'$$,
  '42501', null, 'client cannot spoof terms acceptance evidence directly'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000004', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
create temporary table client_link_context (first_link jsonb not null);
select throws_ok(
  $$select public.link_my_client_to_organization(
    'barbearia-tres', '20000000-0000-4000-8000-000000000004'
  )$$,
  '22023', 'organization identity changed',
  'stale slug and organization identity cannot create a link in another tenant'
);
select is(
  (select count(*) from public.customers
    where auth_user_id = '10000000-0000-4000-8000-000000000004'),
  0::bigint,
  'stale tenant identity rejection writes no customer relation'
);
insert into client_link_context
select public.link_my_client_to_organization(
  'barbearia-tres', '20000000-0000-4000-8000-000000000003'
);
select is(
  (select first_link ->> 'status' from client_link_context), 'LINKED',
  'explicit link creates a tenant customer when no verified candidate exists'
);
select is(
  public.link_my_client_to_organization(
    'barbearia-tres', '20000000-0000-4000-8000-000000000003'
  ) ->> 'customer_id',
  (select first_link ->> 'customer_id' from client_link_context),
  'explicit link retry returns same tenant customer'
);
select is(
  public.link_my_client_to_organization(
    'barbearia-quatro', '20000000-0000-4000-8000-000000000004'
  ) ->> 'status', 'LINKED',
  'same global client can explicitly link a second organization'
);
select is(
  jsonb_array_length(public.list_my_client_organizations()), 2,
  'client organization list exposes only own two tenant links'
);
select lives_ok(
  $$select public.upsert_my_client_account(
      'Cliente A Sincronizado', '+5511999991004', '1990-01-03', 'v1'
    )$$,
  'linked client can update global profile through trusted RPC'
);
select is(
  (select concat_ws('|', full_name, phone_e164, email, birth_date::text)
    from public.customers
    where id = (select (first_link ->> 'customer_id')::uuid from client_link_context)),
  'Cliente A Sincronizado|+5511999991004|client-a@example.test|1990-01-03',
  'linked customer follows global profile update'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000006', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select throws_ok(
  $$update public.customers set full_name = 'Nome do gestor'
    where id = (select (first_link ->> 'customer_id')::uuid from client_link_context)$$,
  '42501', 'linked customer canonical fields are client-controlled',
  'manager cannot overwrite linked canonical customer fields'
);
reset role;

insert into public.customers (
  id, organization_id, full_name, phone_e164, email
) values (
  '40000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000003',
  'Cliente Local', '+5511999991007', 'local-only@example.test'
);
select is(
  (select auth_user_id from public.customers where id = '40000000-0000-4000-8000-000000000003'),
  null::uuid, 'tenant-only customer remains valid without a global account link'
);

insert into public.customers (
  id, organization_id, full_name, phone_e164, email, birth_date
) values (
  '40000000-0000-4000-8000-000000000006', '20000000-0000-4000-8000-000000000004',
  'Cadastro Antigo C', '+5511999991007', 'client-c@example.test', '1980-01-01'
);
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000007', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select lives_ok(
  $$select public.upsert_my_client_account('Cliente C', '+5511999991007', '1992-03-04', 'v1')$$,
  'client C can create global account for exact verified claim'
);
create temporary table client_exact_claim_context (link_result jsonb not null);
insert into client_exact_claim_context
select public.link_my_client_to_organization(
  'barbearia-quatro', '20000000-0000-4000-8000-000000000004'
);
select is(
  (select link_result ->> 'status' from client_exact_claim_context),
  'CLAIM_REQUIRED', 'exact one verified candidate requires explicit claim'
);
select is(
  public.claim_my_existing_customer(
    '20000000-0000-4000-8000-000000000004',
    '40000000-0000-4000-8000-000000000006'
  ) ->> 'status',
  'LINKED', 'exact verified candidate claim links canonical identity'
);
select is(
  (select concat_ws('|', auth_user_id::text, full_name, phone_e164, email, birth_date::text)
    from public.customers where id = '40000000-0000-4000-8000-000000000006'),
  '10000000-0000-4000-8000-000000000007|Cliente C|+5511999991007|client-c@example.test|1992-03-04',
  'successful claim stores global canonical fields without merging rows'
);
reset role;

insert into public.customers (
  id, organization_id, full_name, phone_e164, email
) values
  ('40000000-0000-4000-8000-000000000004', '20000000-0000-4000-8000-000000000003',
    'Candidata B Um', '+5511999991011', 'client-b@example.test'),
  ('40000000-0000-4000-8000-000000000005', '20000000-0000-4000-8000-000000000003',
    'Candidata B Dois', '+5511999991012', 'client-b@example.test');
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000005', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select lives_ok(
  $$select public.upsert_my_client_account('Cliente B', '+5511999991005', '1991-02-03', 'v1')$$,
  'client B can create own global account'
);
select is(
  public.claim_my_existing_customer(
    '20000000-0000-4000-8000-000000000003',
    '40000000-0000-4000-8000-000000000004'
  ) ->> 'status',
  'REVIEW_REQUIRED', 'ambiguous verified claim requires review instead of merge'
);
reset role;
select is(
  (select count(*) from public.customer_link_reviews
    where organization_id = '20000000-0000-4000-8000-000000000003'
      and requester_auth_user_id = '10000000-0000-4000-8000-000000000005'
      and status = 'OPEN'),
  2::bigint, 'ambiguous claim creates private review rows for every candidate'
);
select is(
  (select count(*) from public.customers
    where id in ('40000000-0000-4000-8000-000000000004', '40000000-0000-4000-8000-000000000005')
      and auth_user_id is null),
  2::bigint, 'ambiguous claim preserves both tenant customer rows'
);

select * from finish();
rollback;
