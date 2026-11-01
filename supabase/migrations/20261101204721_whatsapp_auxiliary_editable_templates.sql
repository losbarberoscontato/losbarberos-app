-- Add separately editable copy for auxiliary WhatsApp notifications.
-- Existing queue triggers, deduplication, retries, and exception isolation stay intact.

alter function public.whatsapp_v2_default_message_templates()
  rename to whatsapp_v2_default_message_templates_before_auxiliaries;
create function public.whatsapp_v2_default_message_templates()
returns jsonb language sql immutable set search_path = public, pg_temp as $$
  select public.whatsapp_v2_default_message_templates_before_auxiliaries() || jsonb_build_object(
    'BOOKING_CREATED_AUXILIARY', 'Você foi escalado como auxiliar no atendimento de {cliente} em {horario}.',
    'APPOINTMENT_CONFIRMED_AUXILIARY', '{cliente} confirmou presença no atendimento em {horario}. Você está escalado como auxiliar.',
    'APPOINTMENT_CANCELED_AUXILIARY', '{cliente} cancelou o atendimento.',
    'MANUAL_CONFIRMATION_AUXILIARY', 'O gestor confirmou manualmente o atendimento de {cliente} em {horario}. Você está escalado como auxiliar.'
  );
$$;
revoke all on function public.whatsapp_v2_default_message_templates_before_auxiliaries() from public, anon, authenticated;
grant execute on function public.whatsapp_v2_default_message_templates_before_auxiliaries() to service_role;
revoke all on function public.whatsapp_v2_default_message_templates() from public, anon, authenticated;
grant execute on function public.whatsapp_v2_default_message_templates() to service_role;

alter function public.whatsapp_v2_default_message_templates_for_product(text)
  rename to whatsapp_v2_default_message_templates_for_product_before_auxiliaries;
create function public.whatsapp_v2_default_message_templates_for_product(p_product_key text)
returns jsonb language plpgsql immutable set search_path = public, pg_temp as $$
declare
  v_templates jsonb := public.whatsapp_v2_default_message_templates_for_product_before_auxiliaries(p_product_key);
  v_auxiliary_label text := case p_product_key
    when 'los-barberos' then 'auxiliar no atendimento'
    when 'le-gras' then 'auxiliar na sessão'
    when 'pro-stetic' then 'auxiliar no atendimento'
    when 'music-pro' then 'auxiliar na aula'
    else null
  end;
  v_subject text := case p_product_key
    when 'los-barberos' then 'atendimento'
    when 'le-gras' then 'sessão'
    when 'pro-stetic' then 'atendimento'
    when 'music-pro' then 'aula'
    else null
  end;
begin
  if v_auxiliary_label is null then
    raise exception using errcode = '22023', message = 'unsupported Display product';
  end if;
  return v_templates || jsonb_build_object(
    'BOOKING_CREATED_AUXILIARY', 'Você foi escalado como ' || v_auxiliary_label || ' de {cliente} em {horario}.',
    'APPOINTMENT_CONFIRMED_AUXILIARY', '{cliente} confirmou presença no ' || v_subject || ' em {horario}. Você está escalado como auxiliar.',
    'APPOINTMENT_CANCELED_AUXILIARY', '{cliente} cancelou o ' || v_subject || '.',
    'MANUAL_CONFIRMATION_AUXILIARY', 'O gestor confirmou manualmente o ' || v_subject || ' de {cliente} em {horario}. Você está escalado como auxiliar.'
  );
end;
$$;
revoke all on function public.whatsapp_v2_default_message_templates_for_product_before_auxiliaries(text) from public, anon, authenticated;
grant execute on function public.whatsapp_v2_default_message_templates_for_product_before_auxiliaries(text) to service_role;
revoke all on function public.whatsapp_v2_default_message_templates_for_product(text) from public, anon, authenticated;
grant execute on function public.whatsapp_v2_default_message_templates_for_product(text) to service_role;

update public.whatsapp_automation_settings_v2 s
set templates = public.whatsapp_v2_localize_message_templates_for_product(a.product_key, s.templates)
from public.organization_product_assignments a
where a.organization_id = s.organization_id
  and a.product_key in ('los-barberos', 'le-gras', 'pro-stetic', 'music-pro')
  and s.templates is distinct from public.whatsapp_v2_localize_message_templates_for_product(a.product_key, s.templates);

create or replace function public.enqueue_appointment_auxiliary_staff_message(
  p_organization_id uuid,
  p_appointment_id uuid,
  p_kind text,
  p_auxiliary_id uuid default null,
  p_is_new_assignment boolean default false
)
returns void language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v_appointment public.appointments%rowtype;
  v_connection public.whatsapp_business_connections%rowtype;
  v_settings public.whatsapp_automation_settings_v2%rowtype;
  v_customer public.customers%rowtype;
  v_primary public.barbers%rowtype;
  v_org public.organizations%rowtype;
  v_auxiliary record;
  v_payload jsonb;
  v_service_names text;
  v_when timestamptz;
  v_key text;
begin
  if p_kind not in ('BOOKING', 'CANCEL') then
    raise exception using errcode = '22023', message = 'unsupported auxiliary notification kind';
  end if;
  select * into v_appointment from public.appointments
  where id = p_appointment_id and organization_id = p_organization_id;
  if not found then return; end if;
  select * into v_connection from public.whatsapp_business_connections
  where organization_id = p_organization_id and provider = 'QR_WEB' and is_active and status = 'CONNECTED'
  order by updated_at desc limit 1;
  if not found then return; end if;
  select * into v_settings from public.whatsapp_automation_settings_v2 where organization_id = p_organization_id;
  if not found or v_settings.mode <> 'ACTIVE' or v_settings.dispatch_paused
     or not v_settings.staff_notifications_enabled
     or (p_kind = 'BOOKING' and not v_settings.booking_staff_enabled) then return; end if;
  select * into v_customer from public.customers where id = v_appointment.customer_id and organization_id = p_organization_id;
  select * into v_primary from public.barbers where id = v_appointment.barber_id and organization_id = p_organization_id;
  select * into v_org from public.organizations where id = p_organization_id;
  if v_customer.id is null or v_primary.id is null or v_org.id is null then return; end if;
  select coalesce(nullif(string_agg(item.service_name_snapshot, ', ' order by item.position), ''), 'Serviço não informado')
  into v_service_names from public.appointment_items item
  where item.organization_id = p_organization_id and item.appointment_id = p_appointment_id;
  v_when := lower(v_appointment.service_period);
  v_payload := jsonb_build_object(
    'customer_name', v_customer.full_name, 'barber_name', v_primary.display_name,
    'primary_barber_name', v_primary.display_name,
    'service_names', v_service_names, 'starts_at', v_when, 'timezone', v_org.timezone,
    'currency', v_appointment.currency, 'total_cents', v_appointment.total_cents_snapshot,
    'templates', public.whatsapp_v2_default_message_templates() || v_settings.templates
  );
  for v_auxiliary in
    select assignment.id, assignment.assistant_barber_id, barber.whatsapp_e164, barber.display_name
    from public.appointment_auxiliaries assignment
    join public.barbers barber on barber.id = assignment.assistant_barber_id
      and barber.organization_id = assignment.organization_id
    where assignment.organization_id = p_organization_id and assignment.appointment_id = p_appointment_id
      and (p_auxiliary_id is null or assignment.id = p_auxiliary_id)
      and barber.whatsapp_e164 is not null
  loop
    if p_kind = 'BOOKING' then
      v_key := 'v2:' || p_appointment_id || ':assistant:' || v_auxiliary.id || ':'
        || case when p_is_new_assignment then 'assigned' else 'v' || v_appointment.version end;
      insert into public.whatsapp_automation_jobs (
        organization_id, connection_id, appointment_id, appointment_version, job_type,
        recipient_e164, payload, valid_until, dedupe_key
      ) values (
        p_organization_id, v_connection.id, p_appointment_id, v_appointment.version,
        'BOOKING_CREATED_STAFF', v_auxiliary.whatsapp_e164,
        v_payload || jsonb_build_object('message_audience', 'AUXILIARY', 'barber_name', v_auxiliary.display_name),
        v_when, v_key
      ) on conflict (organization_id, dedupe_key) do nothing;
    else
      v_key := 'v2:' || p_appointment_id || ':v' || v_appointment.version || ':cancellation:assistant:' || v_auxiliary.id;
      insert into public.whatsapp_automation_jobs (
        organization_id, connection_id, appointment_id, appointment_version,
        customer_id, priority, job_type, recipient_e164, payload, scheduled_for,
        next_attempt_at, valid_until, status, dedupe_key
      ) values (
        p_organization_id, v_connection.id, p_appointment_id, v_appointment.version,
        v_appointment.customer_id, 0, 'APPOINTMENT_CANCELED_STAFF', v_auxiliary.whatsapp_e164,
        v_payload || jsonb_build_object('message_audience', 'AUXILIARY', 'barber_name', v_auxiliary.display_name),
        now(), now(), now() + interval '24 hours', 'PENDING', v_key
      ) on conflict (organization_id, dedupe_key) do nothing;
    end if;
  end loop;
end;
$$;

create or replace function public.clone_appointment_staff_whatsapp_to_auxiliaries()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.appointment_id is null or new.payload ->> 'message_audience' = 'AUXILIARY' or not (
    new.job_type in ('APPOINTMENT_CONFIRMED_STAFF', 'APPOINTMENT_CANCELED_STAFF')
    or (new.job_type = 'MANUAL_OUTBOUND_TEXT' and new.payload ->> 'message_kind' = 'MANUAL_CONFIRMATION_STAFF')
  ) then return new; end if;
  begin
    insert into public.whatsapp_automation_jobs (
      organization_id, connection_id, appointment_id, appointment_version,
      confirmation_request_id, job_type, recipient_e164, payload, scheduled_for,
      next_attempt_at, valid_until, status, priority, dedupe_key
    )
    select new.organization_id, new.connection_id, new.appointment_id, new.appointment_version,
      new.confirmation_request_id, new.job_type, barber.whatsapp_e164,
      new.payload || jsonb_build_object(
        'message_audience', 'AUXILIARY',
        'primary_barber_name', coalesce(new.payload ->> 'primary_barber_name', new.payload ->> 'barber_name'),
        'barber_name', barber.display_name
      ),
      new.scheduled_for, new.next_attempt_at, new.valid_until, 'PENDING', new.priority,
      new.dedupe_key || ':assistant:' || assignment.id
    from public.appointment_auxiliaries assignment
    join public.barbers barber on barber.id = assignment.assistant_barber_id
      and barber.organization_id = assignment.organization_id
    where assignment.organization_id = new.organization_id and assignment.appointment_id = new.appointment_id
      and barber.whatsapp_e164 is not null and barber.whatsapp_e164 ~ '^\+[1-9][0-9]{7,14}$'
      and barber.whatsapp_e164 <> new.recipient_e164
    on conflict (organization_id, dedupe_key) do nothing;
  exception when others then
    raise warning 'Auxiliary WhatsApp job copy skipped (SQLSTATE %)', sqlstate;
  end;
  return new;
end;
$$;

revoke all on function public.enqueue_appointment_auxiliary_staff_message(uuid, uuid, text, uuid, boolean) from public, anon, authenticated;
grant execute on function public.enqueue_appointment_auxiliary_staff_message(uuid, uuid, text, uuid, boolean) to service_role;
revoke all on function public.clone_appointment_staff_whatsapp_to_auxiliaries() from public, anon, authenticated;
