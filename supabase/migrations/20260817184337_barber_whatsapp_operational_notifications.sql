-- Direciona respostas numéricas do cliente ao profissional responsável e ao
-- WhatsApp conectado pelo gestor, mantendo isolamento por organização.

alter table public.barbers
  add column if not exists whatsapp_e164 text;

alter table public.barbers
  drop constraint if exists barbers_whatsapp_e164_check;
alter table public.barbers
  add constraint barbers_whatsapp_e164_check
  check (whatsapp_e164 is null or whatsapp_e164 ~ '^[+][1-9][0-9]{7,14}$');

alter table public.whatsapp_business_connections
  add column if not exists connected_phone_e164 text;

alter table public.whatsapp_business_connections
  drop constraint if exists whatsapp_connections_connected_phone_e164_check;
alter table public.whatsapp_business_connections
  add constraint whatsapp_connections_connected_phone_e164_check
  check (connected_phone_e164 is null or connected_phone_e164 ~ '^[+][1-9][0-9]{7,14}$');

comment on column public.barbers.whatsapp_e164 is
  'WhatsApp transacional do profissional, normalizado em E.164.';
comment on column public.whatsapp_business_connections.connected_phone_e164 is
  'Número da conta WhatsApp conectada por QR, sem credenciais ou tokens.';

create or replace function public.normalize_barber_whatsapp_e164()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_input text := nullif(btrim(new.whatsapp_e164), '');
  v_digits text;
begin
  if v_input is null then
    new.whatsapp_e164 := null;
    return new;
  end if;

  v_digits := regexp_replace(v_input, '[^0-9]', '', 'g');
  if v_input like '+%' then
    new.whatsapp_e164 := '+' || v_digits;
  elsif v_digits like '55%' and char_length(v_digits) >= 12 then
    new.whatsapp_e164 := '+' || v_digits;
  else
    new.whatsapp_e164 := '+55' || v_digits;
  end if;

  if new.whatsapp_e164 !~ '^[+][1-9][0-9]{7,14}$' then
    raise exception using errcode = '22023', message = 'invalid barber whatsapp';
  end if;
  return new;
end;
$$;

drop trigger if exists barbers_normalize_whatsapp_e164 on public.barbers;
create trigger barbers_normalize_whatsapp_e164
before insert or update of whatsapp_e164 on public.barbers
for each row execute function public.normalize_barber_whatsapp_e164();

revoke all on function public.normalize_barber_whatsapp_e164()
  from public, anon, authenticated;

create or replace function public.store_whatsapp_qr_connected_phone(
  p_gateway_instance_id text,
  p_connected_phone_e164 text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_phone text := nullif(btrim(p_connected_phone_e164), '');
begin
  perform public.require_service_role();
  if v_phone is null or v_phone !~ '^[+][1-9][0-9]{7,14}$' then
    raise exception using errcode = '22023', message = 'invalid connected whatsapp phone';
  end if;

  update public.whatsapp_business_connections
  set connected_phone_e164 = v_phone, updated_at = now()
  where provider = 'QR_WEB'
    and gateway_instance_id = p_gateway_instance_id;
  return found;
end;
$$;

revoke all on function public.store_whatsapp_qr_connected_phone(text, text)
  from public, anon, authenticated;
grant execute on function public.store_whatsapp_qr_connected_phone(text, text)
  to service_role;

create or replace function public.forward_unrecognized_whatsapp_message(
  p_sender_e164 text,
  p_phone_number_id text,
  p_external_message_id text,
  p_text text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_organization_id uuid;
  v_manager_phone text;
  v_customer_id uuid;
  v_customer_name text;
  v_appointment_id uuid;
  v_registration jsonb;
  v_event_id uuid;
begin
  perform public.require_service_role();

  select q.organization_id, q.connected_phone_e164
    into v_organization_id, v_manager_phone
  from public.whatsapp_business_connections q
  where q.provider = 'QR_WEB'
    and q.gateway_instance_id = p_phone_number_id
    and q.is_active
    and q.status = 'CONNECTED'
  limit 1;

  if v_organization_id is null or v_manager_phone is null then
    return jsonb_build_object(
      'processed', false,
      'reason', 'CONNECTED_MANAGER_PHONE_UNAVAILABLE'
    );
  end if;

  v_registration := public.register_webhook_event(
    'WHATSAPP', p_external_message_id, 'messages.manual_follow_up', true,
    jsonb_build_object(
      'sender_e164', p_sender_e164,
      'channel_id', p_phone_number_id
    ),
    v_organization_id, null
  );
  v_event_id := (v_registration ->> 'webhook_event_id')::uuid;
  if not (v_registration ->> 'inserted')::boolean
     and exists (
       select 1 from public.webhook_events
       where id = v_event_id and status = 'COMPLETED'
     ) then
    return jsonb_build_object('processed', false, 'duplicate', true);
  end if;

  select c.id, c.full_name
    into v_customer_id, v_customer_name
  from public.customers c
  where c.organization_id = v_organization_id
    and c.phone_e164 = p_sender_e164
  order by c.active desc, c.created_at desc
  limit 1;

  if v_customer_id is not null then
    select a.id into v_appointment_id
    from public.appointments a
    where a.organization_id = v_organization_id
      and a.customer_id = v_customer_id
      and a.status = 'CONFIRMED'
      and lower(a.service_period) > now()
    order by lower(a.service_period)
    limit 1;
  end if;

  insert into public.notification_outbox (
    organization_id, appointment_id, template_key, recipient_e164,
    payload, idempotency_key
  ) values (
    v_organization_id, v_appointment_id, 'whatsapp_manual_follow_up', v_manager_phone,
    jsonb_build_object(
      'message_kind', 'TEXT',
      'recipient_kind', 'CONNECTED_MANAGER',
      'text_body', 'Mensagem não reconhecida recebida no WhatsApp da barbearia.'
        || E'\nCliente: ' || coalesce(v_customer_name, 'Não identificado')
        || E'\nWhatsApp: ' || p_sender_e164
        || E'\nMensagem: ' || left(coalesce(p_text, ''), 1000)
        || E'\nA automação aceita somente 1, 2 ou 3. Retorne manualmente se necessário.'
    ),
    'whatsapp-manual-follow-up:' || p_external_message_id
  ) on conflict (organization_id, idempotency_key) do nothing;

  perform public.finish_webhook_event(v_event_id, true, null, null);
  return jsonb_build_object('processed', true, 'forwarded', true);
end;
$$;

revoke all on function public.forward_unrecognized_whatsapp_message(text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.forward_unrecognized_whatsapp_message(text, text, text, text)
  to service_role;

create or replace function public.claim_notification_outbox(
  p_provider text,
  p_limit integer,
  p_worker_id text,
  p_lease_seconds integer
)
returns table (
  id uuid, organization_id uuid, recipient_e164 text, message_kind text,
  template_name text, language_code text, template_components jsonb,
  action_token text, appointment_label text, text_body text, attempt_number integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.require_service_role();
  if upper(p_provider) <> 'WHATSAPP' then
    raise exception using errcode = '22023', message = 'unsupported outbox provider';
  end if;
  return query
  with candidates as (
    select n.id
    from public.notification_outbox n
    where (n.status in ('PENDING', 'FAILED') or (n.status = 'PROCESSING' and n.lease_expires_at <= now()))
      and n.next_attempt_at <= now() and n.scheduled_at <= now()
      and not exists (
        select 1
        from public.whatsapp_business_connections q
        join public.appointments a2 on a2.id = n.appointment_id and a2.organization_id = n.organization_id
        where q.organization_id = n.organization_id and q.provider = 'QR_WEB'
          and q.is_active and q.status = 'CONNECTED'
          and q.connection_epoch_at is not null and lower(a2.service_period) < q.connection_epoch_at
      )
      and (
        (n.payload ->> 'recipient_kind' = 'OPERATIONAL' and exists (
          select 1 from public.organizations o
          where o.id = n.organization_id and o.public_contact_phone_e164 = n.recipient_e164
        ))
        or (n.payload ->> 'recipient_kind' = 'BARBER' and exists (
          select 1
          from public.appointments a
          join public.barbers b
            on b.id = a.barber_id and b.organization_id = a.organization_id
          where a.id = n.appointment_id
            and a.organization_id = n.organization_id
            and b.whatsapp_e164 = n.recipient_e164
        ))
        or (n.payload ->> 'recipient_kind' = 'CONNECTED_MANAGER' and exists (
          select 1
          from public.whatsapp_business_connections q
          where q.organization_id = n.organization_id
            and q.provider = 'QR_WEB'
            and q.is_active
            and q.status = 'CONNECTED'
            and q.connected_phone_e164 = n.recipient_e164
        ))
        or (coalesce(n.payload ->> 'recipient_kind', 'CUSTOMER') = 'CUSTOMER' and exists (
          select 1
          from public.appointments a
          join public.customers c on c.id = a.customer_id and c.organization_id = a.organization_id
          join lateral (
            select ce.action from public.consent_events ce
            where ce.organization_id = c.organization_id and ce.customer_id = c.id
              and ce.kind = 'WHATSAPP_TRANSACTIONAL'
            order by ce.occurred_at desc, ce.created_at desc, ce.id desc limit 1
          ) latest_consent on latest_consent.action = 'GRANTED'
          where a.id = n.appointment_id and a.organization_id = n.organization_id
            and c.phone_e164 = n.recipient_e164
        ))
      )
    order by n.next_attempt_at, n.created_at
    for update skip locked limit greatest(1, least(p_limit, 50))
  ), claimed as (
    update public.notification_outbox n
    set status = 'PROCESSING', claimed_at = now(), claimed_by = p_worker_id,
        lease_expires_at = now() + make_interval(secs => greatest(30, least(p_lease_seconds, 600))),
        attempts = n.attempts + 1
    from candidates c where n.id = c.id returning n.*
  )
  select n.id, n.organization_id, n.recipient_e164,
    coalesce(n.payload ->> 'message_kind', 'TEMPLATE'),
    case when coalesce(n.payload ->> 'message_kind', 'TEMPLATE') = 'TEMPLATE' then n.template_key else null end,
    n.locale,
    case
      when n.payload ? 'template_components' then n.payload -> 'template_components'
      when n.payload ? 'action_token' and coalesce(n.payload ->> 'message_kind', 'TEMPLATE') = 'TEMPLATE'
        then jsonb_build_array(jsonb_build_object('type', 'button', 'sub_type', 'quick_reply', 'index', '0',
          'parameters', jsonb_build_array(jsonb_build_object('type', 'payload', 'payload', n.payload ->> 'action_token'))))
      else null
    end,
    case when n.payload ->> 'message_kind' = 'EVOLUTION_REMINDER_BUTTONS'
      then jsonb_build_object('buttons', n.payload -> 'buttons')::text else n.payload ->> 'action_token' end,
    n.payload ->> 'appointment_label', n.payload ->> 'text_body', n.attempts
  from claimed n;
end;
$$;

revoke all on function public.claim_notification_outbox(text, integer, text, integer)
  from public, anon, authenticated;
grant execute on function public.claim_notification_outbox(text, integer, text, integer)
  to service_role;

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
  v_customer_phone text;
  v_barber_name text;
  v_barber_phone text;
  v_manager_phone text;
  v_service_names text;
  v_details text;
  v_operational_recipient text;
  v_recipient_kind text;
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

  select c.full_name, c.phone_e164, b.display_name, b.whatsapp_e164
    into v_customer_name, v_customer_phone, v_barber_name, v_barber_phone
  from public.customers c
  join public.barbers b
    on b.id = v_appointment.barber_id and b.organization_id = v_appointment.organization_id
  where c.id = v_appointment.customer_id and c.organization_id = v_token.organization_id;

  select q.connected_phone_e164 into v_manager_phone
  from public.whatsapp_business_connections q
  where q.organization_id = v_token.organization_id
    and q.provider = 'QR_WEB'
    and q.is_active
    and q.status = 'CONNECTED'
    and q.connected_phone_e164 is not null
  order by q.connected_at desc nulls last
  limit 1;

  select coalesce(string_agg(ai.service_name_snapshot, ', ' order by ai.position), 'Serviço não informado')
    into v_service_names
  from public.appointment_items ai
  where ai.appointment_id = v_appointment.id
    and ai.organization_id = v_appointment.organization_id;

  v_label := to_char(lower(v_appointment.service_period) at time zone (
    select timezone from public.organizations where id = v_token.organization_id
  ), 'DD/MM/YYYY HH24:MI');
  v_details := 'Cliente: ' || coalesce(v_customer_name, 'Cliente')
    || E'\nWhatsApp: ' || coalesce(v_customer_phone, 'Não informado')
    || E'\nData/hora: ' || v_label
    || E'\nServiço: ' || v_service_names
    || E'\nProfissional: ' || coalesce(v_barber_name, 'Não informado');

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

    v_operational_recipient := coalesce(v_barber_phone, v_manager_phone);
    v_recipient_kind := case when v_barber_phone is not null then 'BARBER' else 'CONNECTED_MANAGER' end;
    if v_operational_recipient is not null then
      insert into public.notification_outbox (
        organization_id, appointment_id, template_key, recipient_e164, payload, idempotency_key
      ) values (
        v_token.organization_id, v_token.appointment_id, 'barber_appointment_canceled', v_operational_recipient,
        jsonb_build_object(
          'message_kind', 'TEXT', 'recipient_kind', v_recipient_kind,
          'text_body', case when v_barber_phone is null
            then 'Agendamento cancelado pelo cliente no WhatsApp. Atenção: WhatsApp do profissional não cadastrado.' || E'\n' || v_details
            else 'Agendamento cancelado pelo cliente no WhatsApp.' || E'\n' || v_details
          end
        ), 'whatsapp-cancel-barber:' || v_token.id
      ) on conflict (organization_id, idempotency_key) do nothing;
    end if;
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

    v_operational_recipient := coalesce(v_barber_phone, v_manager_phone);
    v_recipient_kind := case when v_barber_phone is not null then 'BARBER' else 'CONNECTED_MANAGER' end;
    if v_operational_recipient is not null then
      insert into public.notification_outbox (
        organization_id, appointment_id, template_key, recipient_e164, payload, idempotency_key
      ) values (
        v_token.organization_id, v_token.appointment_id, 'barber_appointment_attendance_confirmed', v_operational_recipient,
        jsonb_build_object(
          'message_kind', 'TEXT', 'recipient_kind', v_recipient_kind,
          'text_body', case when v_barber_phone is null
            then 'Cliente confirmou presença pelo WhatsApp. Atenção: WhatsApp do profissional não cadastrado.' || E'\n' || v_details
            else 'Cliente confirmou presença pelo WhatsApp.' || E'\n' || v_details
          end
        ), 'whatsapp-attendance-barber:' || v_token.id
      ) on conflict (organization_id, idempotency_key) do nothing;
    end if;
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
    if v_manager_phone is not null then
      insert into public.notification_outbox (
        organization_id, appointment_id, template_key, recipient_e164, payload, idempotency_key
      ) values (
        v_token.organization_id, v_token.appointment_id, 'whatsapp_reschedule_request', v_manager_phone,
        jsonb_build_object(
          'message_kind', 'TEXT', 'recipient_kind', 'CONNECTED_MANAGER',
          'text_body', 'Cliente solicitou reagendamento pelo WhatsApp.' || E'\n' || v_details
        ), 'whatsapp-reschedule-manager:' || v_token.id
      ) on conflict (organization_id, idempotency_key) do nothing;
    end if;
  end if;

  perform public.finish_webhook_event(v_event_id, true, null, null);
  return jsonb_build_object('processed', true, 'applied', true);
end;
$$;

revoke all on function public.process_whatsapp_action_token(text, text, text, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.process_whatsapp_action_token(text, text, text, text, text, timestamptz)
  to service_role;
