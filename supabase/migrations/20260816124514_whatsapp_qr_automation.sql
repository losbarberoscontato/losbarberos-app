-- Completa a automacao QR Web que ficou apontando para os templates legados.
-- Nenhuma credencial ou chamada ao gateway ocorre nesta migration.

alter type public.customer_action_kind add value if not exists 'CONFIRM_ATTENDANCE';

create or replace function public.store_whatsapp_qr_connection(
  p_organization_id uuid,
  p_gateway_base_url text,
  p_gateway_instance_id text,
  p_gateway_api_key text,
  p_requested_by_user_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, vault, pg_temp
as $$
declare
  v_connection public.whatsapp_business_connections%rowtype;
  v_secret_id uuid;
  v_id uuid;
  v_active boolean;
begin
  perform public.require_service_role();
  perform pg_advisory_xact_lock(hashtextextended('whatsapp-provider:' || p_organization_id::text, 0));
  if not public.is_organization_owner(p_organization_id, p_requested_by_user_id)
     or p_gateway_base_url !~ '^https://'
     or nullif(btrim(p_gateway_instance_id), '') is null
     or nullif(p_gateway_api_key, '') is null then
    raise exception using errcode = '42501', message = 'invalid WhatsApp QR connection';
  end if;
  select * into v_connection from public.whatsapp_business_connections
  where organization_id = p_organization_id and provider = 'QR_WEB' for update;
  if v_connection.gateway_secret_id is null then
    select vault.create_secret(p_gateway_api_key, 'los-barberos-wa-qr-' || p_organization_id, 'WhatsApp QR gateway key for tenant') into v_secret_id;
  else
    v_secret_id := v_connection.gateway_secret_id;
    perform vault.update_secret(v_secret_id, p_gateway_api_key);
  end if;
  select coalesce(v_connection.is_active, false)
      or not exists (
        select 1 from public.whatsapp_business_connections
        where organization_id = p_organization_id
          and is_active
          and id is distinct from v_connection.id
      )
    into v_active;
  insert into public.whatsapp_business_connections (
    organization_id, provider, status, is_active, gateway_instance_id,
    gateway_secret_id, metadata, last_status_at
  ) values (
    p_organization_id, 'QR_WEB', 'WAITING_FOR_QR', v_active, btrim(p_gateway_instance_id),
    v_secret_id, jsonb_build_object('gateway_base_url', rtrim(p_gateway_base_url, '/')), now()
  ) on conflict (organization_id, provider) do update set
    status = 'WAITING_FOR_QR', is_active = excluded.is_active, gateway_instance_id = excluded.gateway_instance_id,
    gateway_secret_id = excluded.gateway_secret_id, metadata = excluded.metadata, last_status_at = now(), last_error_code = null
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.enqueue_appointment_notifications()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_phone text;
  v_template text;
  v_action_token text;
  v_confirmation_enabled boolean;
begin
  select c.phone_e164, coalesce(a.confirmation_enabled, true)
    into v_phone, v_confirmation_enabled
  from public.customers c
  left join public.whatsapp_automation_settings a
    on a.organization_id = c.organization_id
  where c.id = new.customer_id and c.organization_id = new.organization_id;

  if v_phone is null then
    return new;
  end if;

  if new.status = 'CONFIRMED'
     and (tg_op = 'INSERT' or old.status is distinct from 'CONFIRMED'
          or old.service_period is distinct from new.service_period) then
    update public.customer_action_tokens
      set consumed_at = now()
      where appointment_id = new.id and consumed_at is null;

    if v_confirmation_enabled then
      v_template := case
        when tg_op = 'UPDATE' and old.status = 'CONFIRMED'
          and old.service_period is distinct from new.service_period
        then 'appointment_rescheduled'
        else 'appointment_confirmation'
      end;
      v_action_token := rtrim(translate(encode(gen_random_bytes(32), 'base64'), '+/', '-_'), '=');
      insert into public.customer_action_tokens (
        organization_id, appointment_id, customer_id, action,
        token_hash, expires_at
      ) values (
        new.organization_id, new.id, new.customer_id, 'REQUEST_CANCEL',
        encode(digest(v_action_token, 'sha256'), 'hex'),
        greatest(lower(new.service_period), now() + interval '15 minutes')
      );
      insert into public.notification_outbox (
        organization_id, appointment_id, template_key, recipient_e164,
        payload, idempotency_key
      ) values (
        new.organization_id, new.id, v_template, v_phone,
        jsonb_build_object(
          'appointment_id', new.id,
          'starts_at', lower(new.service_period),
          'version', new.version,
          'action_token', v_action_token
        ),
        'appointment:' || new.id || ':v' || new.version || ':' || v_template
      ) on conflict (organization_id, idempotency_key) do nothing;
    end if;

    update public.notification_outbox
      set status = 'CANCELED'
      where appointment_id = new.id
        and template_key in ('appointment_reminder_0700', 'appointment_reminder_6h', 'appointment_reminder_45m')
        and status in ('PENDING', 'FAILED');
  elsif new.status = 'CANCELED' and (tg_op = 'INSERT' or old.status is distinct from 'CANCELED') then
    update public.notification_outbox
      set status = 'CANCELED'
      where appointment_id = new.id and status in ('PENDING', 'FAILED');
    insert into public.notification_outbox (
      organization_id, appointment_id, template_key, recipient_e164,
      payload, idempotency_key
    ) values (
      new.organization_id, new.id, 'appointment_canceled', v_phone,
      jsonb_build_object('appointment_id', new.id, 'version', new.version),
      'appointment:' || new.id || ':v' || new.version || ':canceled'
    ) on conflict (organization_id, idempotency_key) do nothing;
  end if;
  return new;
end;
$$;

create or replace function public.enqueue_due_whatsapp_reminders(p_limit integer default 200)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
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
    if v_reminder_at <= now() then
      if not exists (
        select 1 from public.notification_outbox n
        where n.organization_id = v_row.organization_id
          and n.idempotency_key = 'appointment:' || v_row.id || ':v' || v_row.version || ':reminder:' || v_row.rule_id
      ) then
        v_confirm_token := rtrim(translate(encode(gen_random_bytes(32), 'base64'), '+/', '-_'), '=');
        v_cancel_token := rtrim(translate(encode(gen_random_bytes(32), 'base64'), '+/', '-_'), '=');
        v_reschedule_token := rtrim(translate(encode(gen_random_bytes(32), 'base64'), '+/', '-_'), '=');
        insert into public.customer_action_tokens (
          organization_id, appointment_id, customer_id, action, token_hash, expires_at
        ) values
          (v_row.organization_id, v_row.id, v_row.customer_id, 'REQUEST_CANCEL', encode(digest(v_cancel_token, 'sha256'), 'hex'), lower(v_row.service_period)),
          (v_row.organization_id, v_row.id, v_row.customer_id, 'RESCHEDULE', encode(digest(v_reschedule_token, 'sha256'), 'hex'), lower(v_row.service_period));
        execute 'insert into public.customer_action_tokens (organization_id, appointment_id, customer_id, action, token_hash, expires_at) values ($1, $2, $3, $4::public.customer_action_kind, $5, $6)'
          using v_row.organization_id, v_row.id, v_row.customer_id, 'CONFIRM_ATTENDANCE', encode(digest(v_confirm_token, 'sha256'), 'hex'), lower(v_row.service_period);
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
    end if;
  end loop;
  return v_count;
end;
$$;

-- Corrige itens ainda pendentes criados pelo contrato legado, sem reenviar itens ja enviados.
update public.notification_outbox
set template_key = 'appointment_confirmation'
where template_key = 'appointment_confirmed'
  and status in ('PENDING', 'FAILED');

update public.notification_outbox
set status = 'CANCELED'
where template_key = 'appointment_reminder_0700'
  and status in ('PENDING', 'FAILED');

create or replace function public.claim_notification_outbox(
  p_provider text,
  p_limit integer,
  p_worker_id text,
  p_lease_seconds integer
)
returns table (
  id uuid,
  organization_id uuid,
  recipient_e164 text,
  message_kind text,
  template_name text,
  language_code text,
  template_components jsonb,
  action_token text,
  appointment_label text,
  text_body text,
  attempt_number integer
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
    where (
        n.status in ('PENDING', 'FAILED')
        or (n.status = 'PROCESSING' and n.lease_expires_at <= now())
      )
      and n.next_attempt_at <= now() and n.scheduled_at <= now()
      and (
        (
          n.payload ->> 'recipient_kind' = 'OPERATIONAL'
          and exists (
            select 1
            from public.organizations o
            where o.id = n.organization_id
              and o.public_contact_phone_e164 = n.recipient_e164
          )
        )
        or exists (
          select 1
          from public.appointments a
          join public.customers c
            on c.id = a.customer_id and c.organization_id = a.organization_id
          join lateral (
            select ce.action
            from public.consent_events ce
            where ce.organization_id = c.organization_id
              and ce.customer_id = c.id
              and ce.kind = 'WHATSAPP_TRANSACTIONAL'
            order by ce.occurred_at desc, ce.created_at desc, ce.id desc
            limit 1
          ) latest_consent on latest_consent.action = 'GRANTED'
          where a.id = n.appointment_id and a.organization_id = n.organization_id
            and c.phone_e164 = n.recipient_e164
        )
      )
    order by n.next_attempt_at, n.created_at
    for update skip locked
    limit greatest(1, least(p_limit, 50))
  ), claimed as (
    update public.notification_outbox n
    set status = 'PROCESSING', claimed_at = now(), claimed_by = p_worker_id,
        lease_expires_at = now() + make_interval(secs => greatest(30, least(p_lease_seconds, 600))),
        attempts = n.attempts + 1
    from candidates c
    where n.id = c.id
    returning n.*
  )
  select
    n.id,
    n.organization_id,
    n.recipient_e164,
    coalesce(n.payload ->> 'message_kind', 'TEMPLATE') as message_kind,
    case when coalesce(n.payload ->> 'message_kind', 'TEMPLATE') = 'TEMPLATE'
      then n.template_key else null end as template_name,
    n.locale as language_code,
    case
      when n.payload ? 'template_components' then n.payload -> 'template_components'
      when n.payload ? 'action_token' and coalesce(n.payload ->> 'message_kind', 'TEMPLATE') = 'TEMPLATE'
        then jsonb_build_array(jsonb_build_object(
          'type', 'button', 'sub_type', 'quick_reply', 'index', '0',
          'parameters', jsonb_build_array(jsonb_build_object(
            'type', 'payload', 'payload', n.payload ->> 'action_token'
          ))
        ))
      else null
    end as template_components,
    case when n.payload ->> 'message_kind' = 'EVOLUTION_REMINDER_BUTTONS'
      then jsonb_build_object('buttons', n.payload -> 'buttons')::text
      else n.payload ->> 'action_token'
    end as action_token,
    n.payload ->> 'appointment_label' as appointment_label,
    n.payload ->> 'text_body' as text_body,
    n.attempts as attempt_number
  from claimed n;
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
    if nullif(p_next_token, '') is null
       or p_next_token_expires_at <= now()
       or p_next_token_expires_at > now() + interval '20 minutes' then
      raise exception using errcode = '22023', message = 'invalid next action token';
    end if;
    v_next_hash := encode(digest(p_next_token, 'sha256'), 'hex');
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
    if v_appointment.status in ('HELD', 'PENDING_PAYMENT', 'CONFIRMED') then
      perform public.cancel_appointment(v_appointment.id, 'whatsapp_customer_confirmation', true);
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
    insert into public.notification_outbox (
      organization_id, appointment_id, template_key, recipient_e164, payload, idempotency_key
    ) values (
      v_token.organization_id, v_token.appointment_id, 'appointment_attendance_confirmed', p_sender_e164,
      jsonb_build_object('message_kind', 'TEXT', 'text_body', 'Presença confirmada para ' || v_label || '.'),
      'whatsapp-attendance-confirmed:' || v_token.id
    ) on conflict (organization_id, idempotency_key) do nothing;
  elsif v_token.action = 'RESCHEDULE' then
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
          'message_kind', 'TEXT',
          'recipient_kind', 'OPERATIONAL',
          'text_body', 'Pedido de reagendamento: ' || coalesce(v_customer_name, 'Cliente') || ' · ' || v_label || '.'
        ),
        'whatsapp-reschedule-operational:' || v_token.id
      ) on conflict (organization_id, idempotency_key) do nothing;
    end if;
  end if;

  perform public.finish_webhook_event(v_event_id, true, null, null);
  return jsonb_build_object('processed', true, 'applied', true);
end;
$$;
