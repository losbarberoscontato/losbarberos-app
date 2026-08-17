-- QR Web pode rejeitar botões interativos. Mantém o fluxo por texto sem abrir
-- ações entre clientes, tenants ou reservas diferentes.

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
    select a.id, a.organization_id, a.customer_id, a.version, a.service_period, a.created_at,
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
       and v_row.created_at <= v_reminder_at
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

create or replace function public.process_whatsapp_text_action(
  p_reply text,
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
  v_organization_id uuid;
  v_action text;
  v_token_hash text;
  v_token_id uuid;
  v_appointment_id uuid;
  v_candidates integer;
  v_registration jsonb;
  v_event_id uuid;
  v_reply text := upper(btrim(coalesce(p_reply, '')));
begin
  perform public.require_service_role();
  select c.organization_id into v_organization_id
  from public.whatsapp_business_connections c
  where c.provider = 'QR_WEB'
    and c.gateway_instance_id = p_phone_number_id
    and c.status in ('CONNECTED', 'REAUTH_REQUIRED')
  limit 1;
  if v_organization_id is null then
    return jsonb_build_object('processed', false, 'reason', 'UNKNOWN_CHANNEL');
  end if;

  if v_reply in ('CANCELAR', 'MANTER') then
    v_action := 'CONFIRM_CANCEL';
  elsif v_reply = '1' then
    v_action := 'CONFIRM_ATTENDANCE';
  elsif v_reply = '2' then
    v_action := 'REQUEST_CANCEL';
  elsif v_reply = '3' then
    v_action := 'RESCHEDULE';
  else
    return jsonb_build_object('processed', false, 'reason', 'UNSUPPORTED_REPLY');
  end if;

  with candidates as (
    select distinct on (t.appointment_id)
      t.id as token_id, t.token_hash, t.appointment_id, lower(a.service_period) as starts_at
    from public.customer_action_tokens t
    join public.customers c
      on c.id = t.customer_id and c.organization_id = t.organization_id
    join public.appointments a
      on a.id = t.appointment_id and a.organization_id = t.organization_id
    where t.organization_id = v_organization_id
      and c.phone_e164 = p_sender_e164
      and t.action::text = v_action
      and t.consumed_at is null
      and t.expires_at > now()
      and a.status = 'CONFIRMED'
      and lower(a.service_period) > now()
    order by t.appointment_id, t.created_at desc
  )
  select count(*),
         (array_agg(token_hash order by starts_at))[1],
         (array_agg(token_id order by starts_at))[1],
         (array_agg(appointment_id order by starts_at))[1]
    into v_candidates, v_token_hash, v_token_id, v_appointment_id
  from candidates;

  if v_candidates <> 1 then
    return jsonb_build_object('processed', false, 'reason', case when v_candidates = 0 then 'NO_ACTIVE_ACTION' else 'AMBIGUOUS_ACTION' end);
  end if;

  if v_reply = 'MANTER' then
    v_registration := public.register_webhook_event(
      'WHATSAPP', p_external_message_id, 'messages.text_action', true,
      jsonb_build_object('reply', v_reply, 'sender_e164', p_sender_e164, 'channel_id', p_phone_number_id),
      v_organization_id, null
    );
    v_event_id := (v_registration ->> 'webhook_event_id')::uuid;
    if not (v_registration ->> 'inserted')::boolean
       and exists (select 1 from public.webhook_events where id = v_event_id and status = 'COMPLETED') then
      return jsonb_build_object('processed', false, 'duplicate', true);
    end if;
    update public.customer_action_tokens
    set consumed_at = now()
    where id = v_token_id and consumed_at is null;
    insert into public.notification_outbox (
      organization_id, appointment_id, template_key, recipient_e164, payload, idempotency_key
    ) values (
      v_organization_id, v_appointment_id, 'appointment_keep_confirmed', p_sender_e164,
      jsonb_build_object('message_kind', 'TEXT', 'text_body', 'Seu horário foi mantido.'),
      'whatsapp-keep-appointment:' || v_token_id
    ) on conflict (organization_id, idempotency_key) do nothing;
    perform public.finish_webhook_event(v_event_id, true, null, null);
    return jsonb_build_object('processed', true, 'applied', true);
  end if;

  return public.process_whatsapp_action_token(
    v_token_hash, p_sender_e164, p_phone_number_id, p_external_message_id,
    p_next_token, p_next_token_expires_at
  );
end;
$$;

revoke all on function public.process_whatsapp_text_action(text, text, text, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.process_whatsapp_text_action(text, text, text, text, text, timestamptz)
  to service_role;
