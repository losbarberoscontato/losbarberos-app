-- Los Barberos: tenant isolation, safe read models and least-privilege grants.

create or replace function public.is_platform_admin(p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p_user_id is not null
     and exists (
       select 1 from public.platform_admins pa where pa.user_id = p_user_id
     );
$$;

create or replace function public.is_organization_owner(
  p_organization_id uuid,
  p_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p_user_id is not null
     and exists (
       select 1
       from public.organization_memberships m
       where m.organization_id = p_organization_id
         and m.user_id = p_user_id
         and m.role = 'OWNER'
         and m.active
     );
$$;

create or replace function public.is_organization_customer(
  p_organization_id uuid,
  p_customer_id uuid,
  p_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p_user_id is not null
     and exists (
       select 1
       from public.customers c
       where c.organization_id = p_organization_id
         and c.id = p_customer_id
         and c.auth_user_id = p_user_id
         and c.active
         and c.merged_into_customer_id is null
     );
$$;

create or replace function public.can_access_organization(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.is_organization_owner(p_organization_id);
$$;

create or replace function public.organization_accepts_new_bookings(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.saas_subscriptions s
    where s.organization_id = p_organization_id
      and (
        s.status in ('TRIALING', 'ACTIVE')
        or (s.status = 'GRACE' and s.grace_ends_at > now())
      )
  );
$$;

create or replace function public.organization_allows_existing_operations(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.saas_subscriptions s
    where s.organization_id = p_organization_id
      and s.status in ('TRIALING', 'ACTIVE', 'GRACE', 'BLOCKED')
  );
$$;

create or replace function public.organization_allows_management_mutations(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.saas_subscriptions s
    where s.organization_id = p_organization_id
      and (
        s.status in ('TRIALING', 'ACTIVE')
        or (s.status = 'GRACE' and s.grace_ends_at > now())
      )
  );
$$;

create or replace function public.prevent_tenant_reassignment()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if old.organization_id is not null
     and new.organization_id is distinct from old.organization_id then
    raise exception using errcode = '42501', message = 'organization_id is immutable';
  end if;
  return new;
end;
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'locations', 'organization_memberships', 'saas_subscriptions',
    'billing_checkout_attempts', 'customers',
    'barbers', 'services', 'packages', 'package_items', 'barber_services',
    'work_intervals', 'availability_exceptions', 'commission_rules', 'appointments',
    'appointment_items', 'merchant_accounts', 'merchant_oauth_states',
    'billing_sessions', 'payment_orders', 'merchant_checkout_attempts',
    'refund_jobs', 'webhook_events',
    'commission_payouts', 'notification_outbox', 'privacy_requests'
  ]
  loop
    execute format(
      'create trigger %I_prevent_tenant_reassignment before update on public.%I for each row execute function public.prevent_tenant_reassignment()',
      table_name, table_name
    );
  end loop;
end;
$$;

create or replace function public.protect_customer_self_service_fields()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if coalesce(auth.role(), '') = 'service_role'
     or public.is_platform_admin()
     or public.is_organization_owner(old.organization_id) then
    return new;
  end if;

  if old.auth_user_id is distinct from auth.uid()
     or new.auth_user_id is distinct from old.auth_user_id
     or (to_jsonb(new) - array['full_name', 'phone_e164', 'email', 'birth_date', 'updated_at'])
        is distinct from
        (to_jsonb(old) - array['full_name', 'phone_e164', 'email', 'birth_date', 'updated_at']) then
    raise exception using errcode = '42501', message = 'customer may update only own contact fields';
  end if;
  return new;
end;
$$;

create trigger customers_protect_self_service_fields
  before update on public.customers
  for each row execute function public.protect_customer_self_service_fields();

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'profiles', 'organizations', 'locations', 'organization_memberships',
    'platform_admins', 'saas_subscriptions', 'billing_checkout_attempts',
    'organization_access_events',
    'customers', 'barbers', 'services', 'packages', 'package_items',
    'barber_services', 'work_intervals', 'availability_exceptions',
    'commission_rules', 'appointments', 'appointment_items',
    'appointment_status_events', 'merchant_accounts', 'merchant_oauth_states',
    'billing_sessions', 'payment_orders', 'merchant_checkout_attempts', 'refund_jobs',
    'payment_transactions', 'webhook_events', 'commission_ledger',
    'commission_payouts', 'commission_payout_items', 'notification_outbox',
    'message_attempts', 'customer_action_tokens', 'consent_events',
    'privacy_requests', 'audit_events'
  ]
  loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('alter table public.%I force row level security', table_name);
  end loop;
end;
$$;

create policy profiles_self_select on public.profiles
  for select to authenticated
  using (id = auth.uid());
create policy profiles_self_update on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

create policy organizations_tenant_select on public.organizations
  for select to authenticated using (public.can_access_organization(id) or public.is_platform_admin());
create policy organizations_owner_update on public.organizations
  for update to authenticated
  using (public.is_organization_owner(id) and public.organization_allows_management_mutations(id))
  with check (public.is_organization_owner(id) and public.organization_allows_management_mutations(id));

create policy memberships_tenant_select on public.organization_memberships
  for select to authenticated
  using (public.can_access_organization(organization_id) or user_id = auth.uid());
create policy platform_admins_self_select on public.platform_admins
  for select to authenticated using (user_id = auth.uid() or public.is_platform_admin());

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'locations', 'saas_subscriptions', 'billing_checkout_attempts',
    'organization_access_events',
    'barbers', 'services', 'packages', 'package_items', 'barber_services',
    'work_intervals', 'availability_exceptions', 'commission_rules',
    'merchant_accounts', 'merchant_oauth_states', 'billing_sessions',
    'merchant_checkout_attempts', 'refund_jobs',
    'webhook_events', 'commission_ledger',
    'commission_payouts', 'commission_payout_items', 'notification_outbox',
    'message_attempts', 'customer_action_tokens', 'audit_events'
  ]
  loop
    execute format(
      'create policy %I_tenant_select on public.%I for select to authenticated using (public.can_access_organization(organization_id))',
      table_name, table_name
    );
    if table_name not in ('packages', 'package_items', 'commission_rules') then
      execute format(
        'create policy %I_tenant_insert on public.%I for insert to authenticated with check (public.can_access_organization(organization_id) and public.organization_allows_management_mutations(organization_id))',
        table_name, table_name
      );
      execute format(
        'create policy %I_tenant_update on public.%I for update to authenticated using (public.can_access_organization(organization_id) and public.organization_allows_management_mutations(organization_id)) with check (public.can_access_organization(organization_id) and public.organization_allows_management_mutations(organization_id))',
        table_name, table_name
      );
      execute format(
        'create policy %I_tenant_delete on public.%I for delete to authenticated using (public.can_access_organization(organization_id) and public.organization_allows_management_mutations(organization_id))',
        table_name, table_name
      );
    end if;
  end loop;
end;
$$;

create policy subscriptions_platform_admin_select on public.saas_subscriptions
  for select to authenticated using (public.is_platform_admin());
create policy access_events_platform_admin_select on public.organization_access_events
  for select to authenticated using (public.is_platform_admin());

create policy customers_owner_select on public.customers
  for select to authenticated
  using (public.can_access_organization(organization_id));
create policy customers_owner_insert on public.customers
  for insert to authenticated
  with check (public.can_access_organization(organization_id)
    and public.organization_allows_management_mutations(organization_id));
create policy customers_owner_update on public.customers
  for update to authenticated
  using (public.can_access_organization(organization_id)
    and public.organization_allows_management_mutations(organization_id))
  with check (public.can_access_organization(organization_id)
    and public.organization_allows_management_mutations(organization_id));
create policy customers_owner_delete on public.customers
  for delete to authenticated
  using (public.can_access_organization(organization_id)
    and public.organization_allows_management_mutations(organization_id));
create policy customers_self_select on public.customers
  for select to authenticated
  using (auth_user_id = auth.uid() and active and merged_into_customer_id is null);
create policy customers_self_update on public.customers
  for update to authenticated
  using (auth_user_id = auth.uid() and active and merged_into_customer_id is null
    and public.organization_allows_management_mutations(organization_id))
  with check (auth_user_id = auth.uid() and active and merged_into_customer_id is null
    and public.organization_allows_management_mutations(organization_id));

create policy appointments_owner_select on public.appointments
  for select to authenticated using (public.can_access_organization(organization_id));
create policy appointments_customer_select on public.appointments
  for select to authenticated
  using (public.is_organization_customer(organization_id, customer_id));

create policy appointment_items_owner_select on public.appointment_items
  for select to authenticated using (public.can_access_organization(organization_id));
create policy appointment_items_customer_select on public.appointment_items
  for select to authenticated
  using (
    exists (
      select 1 from public.appointments a
      where a.id = appointment_items.appointment_id
        and a.organization_id = appointment_items.organization_id
        and public.is_organization_customer(a.organization_id, a.customer_id)
    )
  );

create policy appointment_events_owner_select on public.appointment_status_events
  for select to authenticated using (public.can_access_organization(organization_id));
create policy appointment_events_customer_select on public.appointment_status_events
  for select to authenticated
  using (
    exists (
      select 1 from public.appointments a
      where a.id = appointment_status_events.appointment_id
        and a.organization_id = appointment_status_events.organization_id
        and public.is_organization_customer(a.organization_id, a.customer_id)
    )
  );

create policy payment_orders_owner_select on public.payment_orders
  for select to authenticated using (public.can_access_organization(organization_id));
create policy payment_orders_customer_select on public.payment_orders
  for select to authenticated
  using (
    exists (
      select 1 from public.appointments a
      where a.id = payment_orders.appointment_id
        and a.organization_id = payment_orders.organization_id
        and public.is_organization_customer(a.organization_id, a.customer_id)
    )
  );

create policy payment_transactions_owner_select on public.payment_transactions
  for select to authenticated using (public.can_access_organization(organization_id));
create policy payment_transactions_customer_select on public.payment_transactions
  for select to authenticated
  using (
    exists (
      select 1 from public.appointments a
      where a.id = payment_transactions.appointment_id
        and a.organization_id = payment_transactions.organization_id
        and public.is_organization_customer(a.organization_id, a.customer_id)
    )
  );

create policy consent_events_owner_select on public.consent_events
  for select to authenticated using (public.can_access_organization(organization_id));
create policy consent_events_customer_select on public.consent_events
  for select to authenticated using (public.is_organization_customer(organization_id, customer_id));

create policy privacy_requests_owner_select on public.privacy_requests
  for select to authenticated using (public.can_access_organization(organization_id));
create policy privacy_requests_owner_insert on public.privacy_requests
  for insert to authenticated
  with check (public.can_access_organization(organization_id)
    and public.organization_allows_management_mutations(organization_id));
create policy privacy_requests_owner_update on public.privacy_requests
  for update to authenticated
  using (public.can_access_organization(organization_id)
    and public.organization_allows_management_mutations(organization_id))
  with check (public.can_access_organization(organization_id)
    and public.organization_allows_management_mutations(organization_id));
create policy privacy_requests_customer_select on public.privacy_requests
  for select to authenticated using (public.is_organization_customer(organization_id, customer_id));

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

grant usage on schema public to anon, authenticated;
grant select on public.profiles, public.organizations, public.locations,
  public.organization_memberships, public.platform_admins, public.saas_subscriptions,
  public.billing_checkout_attempts,
  public.organization_access_events, public.customers, public.barbers, public.services,
  public.packages, public.package_items, public.barber_services, public.work_intervals,
  public.availability_exceptions, public.commission_rules, public.appointments,
  public.appointment_items, public.appointment_status_events, public.merchant_accounts,
  public.merchant_oauth_states, public.billing_sessions,
  public.merchant_checkout_attempts, public.refund_jobs,
  public.payment_orders, public.payment_transactions, public.webhook_events,
  public.commission_ledger, public.commission_payouts, public.commission_payout_items,
  public.notification_outbox, public.message_attempts, public.customer_action_tokens,
  public.consent_events, public.privacy_requests, public.audit_events
to authenticated;

grant update (display_name, avatar_url, phone_e164) on public.profiles to authenticated;
grant update (
  name, slug, timezone, deposit_bps, cancellation_lead_minutes,
  slot_interval_minutes, hold_duration_minutes, commission_frequency,
  whatsapp_phone_number_id
) on public.organizations to authenticated;
grant insert, update, delete on public.locations, public.customers, public.barbers,
  public.services, public.barber_services,
  public.work_intervals, public.availability_exceptions
to authenticated;
grant insert, update on public.privacy_requests to authenticated;

create or replace view public.appointment_financial_summary
with (security_invoker = true)
as
with transaction_totals as (
  select
    t.organization_id,
    t.appointment_id,
    coalesce(sum(t.amount_cents) filter (where t.kind in ('CAPTURE', 'ADJUSTMENT')), 0)::bigint as captured_cents,
    coalesce(sum(t.amount_cents) filter (where t.kind in ('REFUND', 'REVERSAL')), 0)::bigint as refunded_cents
  from public.payment_transactions t
  group by t.organization_id, t.appointment_id
), pending_refunds as (
  select po.organization_id, po.appointment_id, true as has_pending_refund
  from public.payment_orders po
  where po.kind = 'REFUND'
    and po.status in ('CREATED', 'PENDING', 'REQUIRES_ACTION', 'REFUND_PENDING')
  group by po.organization_id, po.appointment_id
)
select
  a.organization_id,
  a.id as appointment_id,
  coalesce(tt.captured_cents, 0)::bigint as captured_cents,
  coalesce(tt.refunded_cents, 0)::bigint as refunded_cents,
  greatest(coalesce(tt.captured_cents, 0) - coalesce(tt.refunded_cents, 0), 0)::bigint as net_paid_cents,
  greatest(
    a.total_cents_snapshot - a.amount_waived_cents
      - greatest(coalesce(tt.captured_cents, 0) - coalesce(tt.refunded_cents, 0), 0),
    0
  )::bigint as outstanding_cents,
  case
    when coalesce(pr.has_pending_refund, false) then 'REFUND_PENDING'::public.financial_status
    when coalesce(tt.refunded_cents, 0) > 0
      and greatest(coalesce(tt.captured_cents, 0) - coalesce(tt.refunded_cents, 0), 0) = 0
      then 'REFUNDED'::public.financial_status
    when coalesce(tt.refunded_cents, 0) > 0 then 'PARTIALLY_REFUNDED'::public.financial_status
    when coalesce(tt.captured_cents, 0) = 0 then 'UNPAID'::public.financial_status
    when coalesce(tt.captured_cents, 0) >= a.total_cents_snapshot - a.amount_waived_cents
      then 'PAID'::public.financial_status
    else 'PARTIAL'::public.financial_status
  end as financial_status
from public.appointments a
left join transaction_totals tt
  on tt.organization_id = a.organization_id and tt.appointment_id = a.id
left join pending_refunds pr
  on pr.organization_id = a.organization_id and pr.appointment_id = a.id;

grant select on public.appointment_financial_summary to authenticated;

create or replace function public.get_public_booking_context(p_organization_slug text)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'organization', jsonb_build_object(
      'id', o.id,
      'name', o.name,
      'slug', o.slug,
      'timezone', o.timezone,
      'currency', o.currency,
      'deposit_bps', o.deposit_bps,
      'cancellation_lead_minutes', o.cancellation_lead_minutes,
      'accepting_bookings', public.organization_accepts_new_bookings(o.id)
    ),
    'location', (
      select jsonb_build_object('id', l.id, 'name', l.name, 'address', l.address)
      from public.locations l
      where l.organization_id = o.id and l.active
      limit 1
    ),
    'services', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', s.id, 'name', s.name, 'description', s.description,
          'price_cents', s.price_cents, 'duration_minutes', s.duration_minutes
        ) order by s.sort_order, s.name
      )
      from public.services s
      where s.organization_id = o.id and s.active
    ), '[]'::jsonb),
    'packages', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', p.id, 'name', p.name, 'description', p.description,
          'price_cents', p.price_cents,
          'items', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'service_id', s.id, 'name', s.name,
                'quantity', pi.quantity, 'duration_minutes', s.duration_minutes
              ) order by pi.position, s.name
            )
            from public.package_items pi
            join public.services s
              on s.id = pi.service_id and s.organization_id = pi.organization_id
            where pi.package_id = p.id and pi.organization_id = p.organization_id
              and pi.active and s.active
          ), '[]'::jsonb)
        ) order by p.sort_order, p.name
      )
      from public.packages p
      where p.organization_id = o.id and p.active
        and exists (
          select 1 from public.package_items pi
          where pi.package_id = p.id and pi.organization_id = p.organization_id and pi.active
        )
    ), '[]'::jsonb),
    'barbers', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', b.id,
          'name', b.display_name,
          'bio', b.bio,
          'avatar_url', b.avatar_url,
          'service_ids', coalesce((
            select jsonb_agg(bs.service_id order by bs.service_id)
            from public.barber_services bs
            join public.services s
              on s.id = bs.service_id and s.organization_id = bs.organization_id
            where bs.organization_id = b.organization_id
              and bs.barber_id = b.id and bs.active and s.active
          ), '[]'::jsonb)
        )
        order by b.display_name
      )
      from public.barbers b
      where b.organization_id = o.id and b.active
    ), '[]'::jsonb)
  )
  from public.organizations o
  where o.slug = p_organization_slug;
$$;

revoke all on function public.is_platform_admin(uuid) from public;
revoke all on function public.is_organization_owner(uuid, uuid) from public;
revoke all on function public.is_organization_customer(uuid, uuid, uuid) from public;
revoke all on function public.can_access_organization(uuid) from public;
revoke all on function public.organization_accepts_new_bookings(uuid) from public;
revoke all on function public.organization_allows_existing_operations(uuid) from public;
revoke all on function public.organization_allows_management_mutations(uuid) from public;
revoke all on function public.get_public_booking_context(text) from public;

grant execute on function public.is_platform_admin(uuid) to authenticated;
grant execute on function public.is_organization_owner(uuid, uuid) to authenticated;
grant execute on function public.is_organization_customer(uuid, uuid, uuid) to authenticated;
grant execute on function public.can_access_organization(uuid) to authenticated;
grant execute on function public.organization_accepts_new_bookings(uuid) to anon, authenticated;
grant execute on function public.organization_allows_existing_operations(uuid) to authenticated;
grant execute on function public.organization_allows_management_mutations(uuid) to authenticated;
grant execute on function public.get_public_booking_context(text) to anon, authenticated;

comment on function public.get_public_booking_context(text) is
  'Safe public projection. Base tenant tables remain isolated by RLS.';
