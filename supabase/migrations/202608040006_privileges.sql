-- Final function ACL pass. New PostgreSQL functions default to EXECUTE for PUBLIC;
-- this migration replaces that default with an explicit application contract.

do $$
declare
  r record;
begin
  for r in
    select n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
  loop
    execute format(
      'revoke all on function %I.%I(%s) from public, anon, authenticated, service_role',
      r.nspname, r.proname, r.args
    );
  end loop;
end;
$$;

do $$
declare
  r record;
begin
  for r in
    select n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = any (array[
        'is_platform_admin', 'is_organization_owner', 'is_organization_customer',
        'can_access_organization', 'organization_accepts_new_bookings',
        'organization_allows_existing_operations',
        'organization_allows_management_mutations', 'onboard_organization',
        'upsert_my_customer', 'create_appointment_hold',
        'create_manual_appointment', 'create_payment_checkout_order',
        'confirm_appointment_without_payment',
        'record_manual_payment', 'record_manual_refund', 'transition_appointment',
        'cancel_appointment', 'reschedule_appointment',
        'set_platform_organization_access_status', 'merge_customers',
        'record_consent_event', 'submit_privacy_request',
        'export_organization_data',
        'save_package_with_items', 'replace_commission_rule',
        'adjust_commission_entry', 'create_commission_payout',
        'mark_commission_payout_paid'
      ])
  loop
    execute format(
      'grant execute on function %I.%I(%s) to authenticated',
      r.nspname, r.proname, r.args
    );
  end loop;
end;
$$;

do $$
declare
  r record;
begin
  for r in
    select n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = any (array[
        'get_public_booking_context', 'get_available_slots',
        'organization_accepts_new_bookings'
      ])
  loop
    execute format(
      'grant execute on function %I.%I(%s) to anon, authenticated',
      r.nspname, r.proname, r.args
    );
  end loop;
end;
$$;

do $$
declare
  r record;
begin
  for r in
    select n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = any (array[
        'authorize_organization_owner', 'get_stripe_checkout_context',
        'record_stripe_checkout_session', 'record_billing_portal_session',
        'process_stripe_billing_webhook',
        'complete_unexpected_stripe_subscription_cancellation',
        'create_merchant_oauth_state',
        'consume_merchant_oauth_state', 'store_merchant_oauth_credentials',
        'get_merchant_token_refresh_context',
        'store_refreshed_merchant_oauth_credentials',
        'mark_merchant_reauth_required',
        'get_payment_checkout_context', 'record_mercado_pago_preference',
        'resolve_mercado_pago_webhook_account', 'record_provider_webhook',
        'process_mercado_pago_payment_webhook', 'get_payment_refund_context',
        'record_mercado_pago_refund', 'mark_mercado_pago_refund_pending',
        'record_whatsapp_opt_out', 'process_whatsapp_action_token',
        'claim_notification_outbox', 'complete_notification_attempt',
        'process_whatsapp_delivery_status', 'register_webhook_event',
        'claim_webhook_events', 'finish_webhook_event',
        'register_provider_payment', 'register_provider_refund',
        'expire_stale_appointment_holds', 'process_expired_billing_grace',
        'process_expired_organization_retention', 'enqueue_due_whatsapp_reminders'
      ])
  loop
    execute format(
      'grant execute on function %I.%I(%s) to service_role',
      r.nspname, r.proname, r.args
    );
  end loop;
end;
$$;

grant usage on type public.organization_role, public.saas_subscription_status,
  public.appointment_status, public.booking_source, public.appointment_item_source,
  public.availability_exception_kind, public.payment_mode, public.payment_provider,
  public.merchant_account_status, public.payment_order_kind,
  public.payment_order_status, public.payment_transaction_kind,
  public.financial_status, public.webhook_processing_status,
  public.commission_mode, public.commission_frequency,
  public.commission_entry_kind, public.commission_payout_status,
  public.outbox_status, public.message_attempt_status, public.consent_kind,
  public.consent_action, public.privacy_request_kind,
  public.privacy_request_status, public.customer_action_kind
to authenticated, service_role;

comment on function public.authorize_organization_owner(uuid, uuid) is
  'Edge-only explicit-user authorization; it does not trust a user id supplied by a browser.';
