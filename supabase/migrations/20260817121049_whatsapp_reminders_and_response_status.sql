-- Separa resposta do cliente pelo WhatsApp do estado operacional da agenda.
-- O estado operacional continua protegendo pagamento, ocupação de horário e fluxo do atendimento.

do $$
begin
  create type public.appointment_whatsapp_response_status as enum (
    'PENDING',
    'CONFIRMED_BY_WHATSAPP',
    'CANCELED_BY_WHATSAPP',
    'RESCHEDULE_REQUESTED_BY_WHATSAPP'
  );
exception
  when duplicate_object then null;
end;
$$;

alter table public.appointments
  add column if not exists whatsapp_response_status public.appointment_whatsapp_response_status;

update public.appointments
set whatsapp_response_status = 'PENDING'
where whatsapp_response_status is null;

alter table public.appointments
  alter column whatsapp_response_status set default 'PENDING',
  alter column whatsapp_response_status set not null;

grant usage on type public.appointment_whatsapp_response_status to authenticated, service_role;

create or replace function public.enqueue_due_whatsapp_reminders(p_limit integer default 200)
returns integer
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_row record;
  v_reminder_at timestamptz;
  v_count integer := 0;
  v_confirm_token text;
  v_cancel_token text;
  v_reschedule_token text;
begin
  perform public.require_service_role();
  for v_row in
    select a.id, a.organization_id, a.customer_id, a.version, a.service_period,
           c.phone_e164, o.timezone, r.id as rule_id, r.template_key,
           r.offset_minutes, r.language_code
    from public.appointments a
    join public.customers c
      on c.id = a.customer_id and c.organization_id = a.organization_id
    join public.organizations o on o.id = a.organization_id
    join public.whatsapp_reminder_rules r
      on r.organization_id = a.organization_id and r.enabled
    where a.status = 'CONFIRMED'
      and c.phone_e164 is not null
      and lower(a.service_period) > now()
      and lower(a.service_period) <= now() + interval '2 days'
    order by lower(a.service_period), r.position
    limit greatest(1, least(p_limit, 1000))
  loop
    v_reminder_at := lower(v_row.service_period) - make_interval(mins => v_row.offset_minutes);
    if v_reminder_at <= now()
       and not exists (
         select 1
         from public.whatsapp_business_connections q
         where q.organization_id = v_row.organization_id
           and q.provider = 'QR_WEB'
           and q.is_active
           and q.status = 'CONNECTED'
           and q.connection_epoch_at is not null
           and v_reminder_at < q.connection_epoch_at
       )
       and not exists (
         select 1 from public.notification_outbox n
         where n.organization_id = v_row.organization_id
           and n.idempotency_key = 'appointment:' || v_row.id || ':v' || v_row.version || ':reminder:' || v_row.rule_id
       ) then
      v_confirm_token := rtrim(translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'), '=');
      v_cancel_token := rtrim(translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'), '=');
      v_reschedule_token := rtrim(translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'), '=');
      insert into public.customer_action_tokens (
        organization_id, appointment_id, customer_id, action, token_hash, expires_at
      ) values
        (v_row.organization_id, v_row.id, v_row.customer_id, 'REQUEST_CANCEL', encode(extensions.digest(v_cancel_token, 'sha256'), 'hex'), lower(v_row.service_period)),
        (v_row.organization_id, v_row.id, v_row.customer_id, 'RESCHEDULE', encode(extensions.digest(v_reschedule_token, 'sha256'), 'hex'), lower(v_row.service_period));
      execute 'insert into public.customer_action_tokens (organization_id, appointment_id, customer_id, action, token_hash, expires_at) values ($1, $2, $3, $4::public.customer_action_kind, $5, $6)'
        using v_row.organization_id, v_row.id, v_row.customer_id, 'CONFIRM_ATTENDANCE', encode(extensions.digest(v_confirm_token, 'sha256'), 'hex'), lower(v_row.service_period);
      insert into public.notification_outbox (
        organization_id, appointment_id, template_key, recipient_e164,
        locale, payload, idempotency_key, scheduled_at, next_attempt_at
      ) values (
        v_row.organization_id, v_row.id, v_row.template_key, v_row.phone_e164,
        v_row.language_code,
        jsonb_build_object(
          'message_kind', 'EVOLUTION_REMINDER_BUTTONS',
          'appointment_id', v_row.id,
          'starts_at', lower(v_row.service_period),
          'version', v_row.version,
          'appointment_label', to_char(lower(v_row.service_period) at time zone v_row.timezone, 'DD/MM/YYYY HH24:MI'),
          'text_body', case v_row.template_key
            when 'appointment_reminder_6h' then 'Lembrete: seu atendimento será em ' || to_char(lower(v_row.service_period) at time zone v_row.timezone, 'DD/MM/YYYY HH24:MI') || '.'
            else 'Lembrete: seu atendimento começa em ' || to_char(lower(v_row.service_period) at time zone v_row.timezone, 'DD/MM/YYYY HH24:MI') || '.'
          end,
          'buttons', jsonb_build_array(
            jsonb_build_object('id', v_confirm_token, 'label', 'Confirmar', 'action', 'CONFIRM_ATTENDANCE'),
            jsonb_build_object('id', v_cancel_token, 'label', 'Cancelar', 'action', 'REQUEST_CANCEL'),
            jsonb_build_object('id', v_reschedule_token, 'label', 'Reagendar', 'action', 'RESCHEDULE')
          )
        ),
        'appointment:' || v_row.id || ':v' || v_row.version || ':reminder:' || v_row.rule_id,
        v_reminder_at, now()
      ) on conflict (organization_id, idempotency_key) do nothing;
      if found then
        v_count := v_count + 1;
      end if;
    end if;
  end loop;
  return v_count;
end;
$$;

create or replace function public.record_appointment_whatsapp_response(
  p_appointment_id uuid,
  p_organization_id uuid,
  p_response_status public.appointment_whatsapp_response_status,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_appointment public.appointments%rowtype;
begin
  perform public.require_service_role();
  update public.appointments
  set whatsapp_response_status = p_response_status
  where id = p_appointment_id and organization_id = p_organization_id
  returning * into v_appointment;
  if not found then
    raise exception using errcode = 'P0002', message = 'appointment not found';
  end if;
  insert into public.appointment_status_events (
    organization_id, appointment_id, from_status, to_status, reason, metadata
  ) values (
    v_appointment.organization_id, v_appointment.id, v_appointment.status,
    v_appointment.status, p_reason,
    jsonb_build_object('whatsapp_response_status', p_response_status)
  );
end;
$$;

create or replace function public.process_whatsapp_action_token(
  p_token_hash text,
  p_sender_e164 text,
  p_phone_number_id text,
  p_external_message_id text,
  p_next_token text,
  p_next_token_expires_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_token public.customer_action_tokens%rowtype;
  v_appointment public.appointments%rowtype;
  v_registration jsonb;
  v_event_id uuid;
  v_next_hash text;
  v_label text;
  v_organization_id uuid;
  v_customer_name text;
  v_operational_phone text;
begin
  perform public.require_service_role();
  v_registration := public.register_webhook_event(
    'WHATSAPP', p_external_message_id, 'messages.action', true,
    jsonb_build_object('token_hash', p_token_hash, 'sender_e164', p_sender_e164, 'channel_id', p_phone_number_id),
    null, null
  );
  v_event_id := (v_registration ->> 'webhook_event_id')::uuid;
  if not (v_registration ->> 'inserted')::boolean
     and exists (select 1 from public.webhook_events where id = v_event_id and status = 'COMPLETED') then
    return jsonb_build_object('processed', false, 'duplicate', true);
  end if;

  select c.organization_id into v_organization_id
  from public.whatsapp_business_connections c
  where c.provider = 'QR_WEB' and c.gateway_instance_id = p_phone_number_id
    and c.status in ('CONNECTED', 'REAUTH_REQUIRED')
  limit 1;
  if v_organization_id is null then
    select c.organization_id into v_organization_id
    from public.whatsapp_business_connections c
    where c.provider = 'META_CLOUD' and c.phone_number_id = p_phone_number_id
      and c.status in ('CONNECTED', 'REAUTH_REQUIRED')
    limit 1;
  end if;

  select t.* into v_token
  from public.customer_action_tokens t
  join public.customers c on c.id = t.customer_id and c.organization_id = t.organization_id
  where t.token_hash = p_token_hash
    and t.consumed_at is null and t.expires_at > now()
    and c.phone_e164 = p_sender_e164
    and t.organization_id = v_organization_id
  for update of t;
  if not found then
    perform public.finish_webhook_event(v_event_id, true, null, null);
    return null;
  end if;

  update public.customer_action_tokens set consumed_at = now() where id = v_token.id;
  update public.webhook_events set organization_id = v_token.organization_id where id = v_event_id;
  select * into strict v_appointment from public.appointments
  where id = v_token.appointment_id and organization_id = v_token.organization_id for update;
  select c.full_name, o.public_contact_phone_e164
    into v_customer_name, v_operational_phone
  from public.customers c
  join public.organizations o on o.id = c.organization_id
  where c.id = v_appointment.customer_id and c.organization_id = v_token.organization_id;
  v_label := to_char(lower(v_appointment.service_period) at time zone (
    select timezone from public.organizations where id = v_token.organization_id
  ), 'DD/MM/YYYY HH24:MI');

  if v_token.action = 'REQUEST_CANCEL' then
    if v_appointment.status <> 'CONFIRMED' then
      perform public.finish_webhook_event(v_event_id, true, null, null);
      return jsonb_build_object('processed', true, 'applied', false);
    end if;
    if nullif(p_next_token, '') is null
       or p_next_token_expires_at <= now()
       or p_next_token_expires_at > now() + interval '20 minutes' then
      raise exception using errcode = '22023', message = 'invalid next action token';
    end if;
    v_next_hash := encode(extensions.digest(p_next_token, 'sha256'), 'hex');
    insert into public.customer_action_tokens (
      organization_id, appointment_id, customer_id, action, token_hash, expires_at
    ) values (
      v_token.organization_id, v_token.appointment_id, v_token.customer_id,
      'CONFIRM_CANCEL', v_next_hash, p_next_token_expires_at
    );
    insert into public.notification_outbox (
      organization_id, appointment_id, template_key, recipient_e164, payload, idempotency_key
    ) values (
      v_token.organization_id, v_token.appointment_id, 'whatsapp_cancel_prompt', p_sender_e164,
      jsonb_build_object(
        'message_kind', 'CANCEL_CONFIRM_PROMPT', 'action_token', p_next_token,
        'appointment_label', v_label, 'text_body', 'Confirma o cancelamento de ' || v_label || '?'
      ), 'whatsapp-cancel-prompt:' || v_token.id
    ) on conflict (organization_id, idempotency_key) do nothing;
  elsif v_token.action = 'CONFIRM_CANCEL' then
    if v_appointment.status = 'CONFIRMED' then
      perform public.cancel_appointment(v_appointment.id, 'whatsapp_customer_confirmation', true);
      perform public.record_appointment_whatsapp_response(
        v_appointment.id, v_token.organization_id, 'CANCELED_BY_WHATSAPP', 'whatsapp_cancellation_confirmed'
      );
      update public.customer_action_tokens
      set consumed_at = now()
      where appointment_id = v_appointment.id and consumed_at is null;
    elsif v_appointment.status <> 'CANCELED' then
      perform public.finish_webhook_event(v_event_id, true, null, null);
      return jsonb_build_object('processed', true, 'applied', false);
    end if;
    insert into public.notification_outbox (
      organization_id, appointment_id, template_key, recipient_e164, payload, idempotency_key
    ) values (
      v_token.organization_id, v_token.appointment_id, 'appointment_cancellation_confirmed', p_sender_e164,
      jsonb_build_object('message_kind', 'TEMPLATE', 'appointment_id', v_appointment.id),
      'whatsapp-cancel-confirmed:' || v_token.id
    ) on conflict (organization_id, idempotency_key) do nothing;
  elsif v_token.action::text = 'CONFIRM_ATTENDANCE' then
    if v_appointment.status <> 'CONFIRMED' then
      perform public.finish_webhook_event(v_event_id, true, null, null);
      return jsonb_build_object('processed', true, 'applied', false);
    end if;
    perform public.record_appointment_whatsapp_response(
      v_appointment.id, v_token.organization_id, 'CONFIRMED_BY_WHATSAPP', 'whatsapp_attendance_confirmed'
    );
    insert into public.notification_outbox (
      organization_id, appointment_id, template_key, recipient_e164, payload, idempotency_key
    ) values (
      v_token.organization_id, v_token.appointment_id, 'appointment_attendance_confirmed', p_sender_e164,
      jsonb_build_object('message_kind', 'TEXT', 'text_body', 'Presença confirmada para ' || v_label || '.'),
      'whatsapp-attendance-confirmed:' || v_token.id
    ) on conflict (organization_id, idempotency_key) do nothing;
  elsif v_token.action = 'RESCHEDULE' then
    if v_appointment.status <> 'CONFIRMED' then
      perform public.finish_webhook_event(v_event_id, true, null, null);
      return jsonb_build_object('processed', true, 'applied', false);
    end if;
    perform public.record_appointment_whatsapp_response(
      v_appointment.id, v_token.organization_id, 'RESCHEDULE_REQUESTED_BY_WHATSAPP', 'whatsapp_reschedule_requested'
    );
    insert into public.notification_outbox (
      organization_id, appointment_id, template_key, recipient_e164, payload, idempotency_key
    ) values (
      v_token.organization_id, v_token.appointment_id, 'appointment_reschedule_requested', p_sender_e164,
      jsonb_build_object('message_kind', 'TEXT', 'text_body', 'Recebemos seu pedido de reagendamento. A barbearia entrará em contato.'),
      'whatsapp-reschedule-requested:' || v_token.id
    ) on conflict (organization_id, idempotency_key) do nothing;
    if v_operational_phone is not null then
      insert into public.notification_outbox (
        organization_id, appointment_id, template_key, recipient_e164, payload, idempotency_key
      ) values (
        v_token.organization_id, v_token.appointment_id, 'whatsapp_reschedule_request', v_operational_phone,
        jsonb_build_object(
          'message_kind', 'TEXT', 'recipient_kind', 'OPERATIONAL',
          'text_body', 'Pedido de reagendamento: ' || coalesce(v_customer_name, 'Cliente') || ' · ' || v_label || '.'
        ), 'whatsapp-reschedule-operational:' || v_token.id
      ) on conflict (organization_id, idempotency_key) do nothing;
    end if;
  end if;

  perform public.finish_webhook_event(v_event_id, true, null, null);
  return jsonb_build_object('processed', true, 'applied', true);
end;
$$;

revoke all on function public.record_appointment_whatsapp_response(uuid, uuid, public.appointment_whatsapp_response_status, text)
  from public, anon, authenticated;
grant execute on function public.record_appointment_whatsapp_response(uuid, uuid, public.appointment_whatsapp_response_status, text)
  to service_role;
