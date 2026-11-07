-- Defer booking notifications until the appointment transaction has inserted its
-- service items. Enrich every appointment-bound message with the same tenant-scoped
-- context so edited templates receive the variables shown in manager settings.

create or replace function public.whatsapp_v2_enrich_appointment_job_context()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_customer_name text;
  v_customer_phone text;
  v_barber_name text;
  v_timezone text;
  v_service_names text;
  v_starts_at timestamptz;
  v_templates jsonb;
begin
  if new.appointment_id is null then
    return new;
  end if;

  select c.full_name, c.phone_e164, b.display_name, o.timezone, lower(a.service_period), s.templates
  into v_customer_name, v_customer_phone, v_barber_name, v_timezone, v_starts_at, v_templates
  from public.appointments a
  join public.customers c
    on c.id = a.customer_id and c.organization_id = a.organization_id
  join public.barbers b
    on b.id = a.barber_id and b.organization_id = a.organization_id
  join public.organizations o on o.id = a.organization_id
  left join public.whatsapp_automation_settings_v2 s on s.organization_id = a.organization_id
  where a.id = new.appointment_id and a.organization_id = new.organization_id;

  if not found then
    return new;
  end if;

  select coalesce(
    nullif(string_agg(nullif(btrim(item.service_name_snapshot), ''), ', ' order by item.position), ''),
    'Serviço não informado'
  )
  into v_service_names
  from public.appointment_items item
  where item.organization_id = new.organization_id
    and item.appointment_id = new.appointment_id;

  new.payload := coalesce(new.payload, '{}'::jsonb) || jsonb_build_object(
    'customer_name', coalesce(nullif(new.payload ->> 'customer_name', ''), v_customer_name),
    'barber_name', coalesce(nullif(new.payload ->> 'barber_name', ''), v_barber_name),
    'primary_barber_name', coalesce(nullif(new.payload ->> 'primary_barber_name', ''), v_barber_name),
    'service_names', case
      when nullif(new.payload ->> 'service_names', '') is null
        or (new.payload ->> 'service_names') = 'Serviço não informado'
      then v_service_names
      else new.payload ->> 'service_names'
    end,
    'customer_phone', coalesce(v_customer_phone, nullif(new.payload ->> 'customer_phone', '')),
    'starts_at', coalesce(nullif(new.payload ->> 'starts_at', '')::timestamptz, v_starts_at),
    'timezone', coalesce(nullif(new.payload ->> 'timezone', ''), v_timezone),
    'templates', case
      when jsonb_typeof(new.payload -> 'templates') = 'object' then new.payload -> 'templates'
      else coalesce(v_templates, '{}'::jsonb)
    end
  );

  -- Inbound replies may use WhatsApp's alternate Brazilian mobile JID format.
  -- Once the reply matched the active confirmation request, send the acknowledgement
  -- to the canonical phone saved on the customer record so runtime validation agrees.
  if new.job_type in ('CONFIRMATION_ACK_CLIENT', 'CANCELLATION_ACK_CLIENT')
     and v_customer_phone is not null
     and public.whatsapp_v2_phone_matches(v_customer_phone, new.recipient_e164) then
    new.recipient_e164 := v_customer_phone;
  end if;

  return new;
end;
$$;

revoke all on function public.whatsapp_v2_enrich_appointment_job_context() from public, anon, authenticated;

drop trigger if exists whatsapp_jobs_enrich_appointment_context on public.whatsapp_automation_jobs;
create trigger whatsapp_jobs_enrich_appointment_context
before insert on public.whatsapp_automation_jobs
for each row execute function public.whatsapp_v2_enrich_appointment_job_context();

-- These triggers used to read appointment_items immediately after inserting the
-- appointment, before create_manual_appointment inserts those rows.
drop trigger if exists appointments_schedule_whatsapp_v2 on public.appointments;
create constraint trigger appointments_schedule_whatsapp_v2
after insert or update on public.appointments
deferrable initially deferred
for each row execute function public.schedule_whatsapp_v2_for_appointment();

-- New auxiliary assignments are queued by save_appointment_auxiliaries after
-- appointment items exist. Keep this trigger for later appointment changes only.
drop trigger if exists appointments_enqueue_auxiliary_booking_whatsapp on public.appointments;
create constraint trigger appointments_enqueue_auxiliary_booking_whatsapp
after update of status, service_period, version on public.appointments
deferrable initially deferred
for each row execute function public.enqueue_appointment_auxiliary_booking_trigger();
