-- Cancellation is an operational event, not a reminder.  The existing V2
-- appointment trigger cancels pending reminders when an appointment is
-- canceled, but it must also enqueue the cancellation notice for both sides.
-- This trigger runs after the scheduler trigger (the `zz_` prefix keeps the
-- ordering explicit) so the new notices are not canceled by that cleanup.
create or replace function public.enqueue_appointment_cancellation_whatsapp()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_connection public.whatsapp_business_connections%rowtype;
  v_settings public.whatsapp_automation_settings_v2%rowtype;
  v_customer public.customers%rowtype;
  v_barber public.barbers%rowtype;
  v_org public.organizations%rowtype;
  v_payload jsonb;
  v_scheduled_for timestamptz := now();
  v_valid_until timestamptz := now() + interval '24 hours';
begin
  if new.status <> 'CANCELED'
     or old.status is not distinct from new.status
     or new.cancellation_source = 'WHATSAPP_CLIENT' then
    return new;
  end if;

  select * into v_connection
    from public.whatsapp_business_connections
   where organization_id = new.organization_id
     and provider = 'QR_WEB'
     and is_active
     and status = 'CONNECTED'
   order by updated_at desc
   limit 1;
  if not found then return new; end if;

  select * into v_settings
    from public.whatsapp_automation_settings_v2
   where organization_id = new.organization_id;
  if not found or v_settings.mode <> 'ACTIVE' or v_settings.dispatch_paused then
    return new;
  end if;

  select * into v_customer
    from public.customers
   where id = new.customer_id and organization_id = new.organization_id;
  select * into v_barber
    from public.barbers
   where id = new.barber_id and organization_id = new.organization_id;
  select * into v_org
    from public.organizations
   where id = new.organization_id;
  if not found or v_customer.id is null or v_barber.id is null then
    return new;
  end if;

  v_payload := jsonb_build_object(
    'customer_name', v_customer.full_name,
    'barber_name', v_barber.display_name,
    'starts_at', lower(new.service_period),
    'timezone', v_org.timezone,
    'currency', new.currency,
    'total_cents', new.total_cents_snapshot,
    'cancellation_outcome', new.cancellation_outcome,
    'cancellation_actor_name', new.cancellation_actor_name,
    'cancelled_at', new.cancelled_at,
    'templates', v_settings.templates
  );

  -- The deadline only changes the session/refund outcome. It must not stop
  -- either cancellation notice from being queued.
  if v_customer.phone_e164 is not null
     and public.whatsapp_v2_consented(new.organization_id, new.customer_id) then
    insert into public.whatsapp_automation_jobs (
      organization_id, connection_id, appointment_id, appointment_version,
      customer_id, priority, job_type, recipient_e164, payload,
      scheduled_for, next_attempt_at, valid_until, status, dedupe_key
    ) values (
      new.organization_id, v_connection.id, new.id, new.version,
      new.customer_id, 0, 'CANCELLATION_ACK_CLIENT', v_customer.phone_e164,
      v_payload, v_scheduled_for, v_scheduled_for, v_valid_until, 'PENDING',
      'v2:' || new.id || ':v' || new.version || ':cancellation:client'
    ) on conflict (organization_id, dedupe_key) do nothing;
  end if;

  if v_settings.staff_notifications_enabled
     and v_barber.whatsapp_e164 is not null then
    insert into public.whatsapp_automation_jobs (
      organization_id, connection_id, appointment_id, appointment_version,
      customer_id, priority, job_type, recipient_e164, payload,
      scheduled_for, next_attempt_at, valid_until, status, dedupe_key
    ) values (
      new.organization_id, v_connection.id, new.id, new.version,
      new.customer_id, 0, 'APPOINTMENT_CANCELED_STAFF', v_barber.whatsapp_e164,
      v_payload, v_scheduled_for, v_scheduled_for, v_valid_until, 'PENDING',
      'v2:' || new.id || ':v' || new.version || ':cancellation:staff'
    ) on conflict (organization_id, dedupe_key) do nothing;
  end if;

  return new;
end;
$$;

drop trigger if exists zz_appointments_enqueue_cancellation_whatsapp on public.appointments;
create trigger zz_appointments_enqueue_cancellation_whatsapp
after update of status on public.appointments
for each row
execute function public.enqueue_appointment_cancellation_whatsapp();

revoke all on function public.enqueue_appointment_cancellation_whatsapp() from public, anon, authenticated;
