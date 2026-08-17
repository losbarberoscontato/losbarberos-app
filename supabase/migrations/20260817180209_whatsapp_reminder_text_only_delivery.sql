-- Lembretes QR usam texto simples. Evolution/Baileys pode aceitar sendButtons
-- sem entregar a mensagem no WhatsApp. O banco mantém tokens e idempotência;
-- o cliente responde somente com números.

create or replace function public.prepare_whatsapp_reminder_text_outbox()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_provider public.whatsapp_provider;
  v_status public.whatsapp_connection_status;
  v_connection_epoch_at timestamptz;
  v_text text;
begin
  if new.template_key not in ('appointment_reminder_6h', 'appointment_reminder_45m') then
    return new;
  end if;

  select c.provider, c.status, c.connection_epoch_at
    into v_provider, v_status, v_connection_epoch_at
  from public.whatsapp_business_connections c
  where c.organization_id = new.organization_id
    and c.is_active
  order by c.updated_at desc
  limit 1;

  v_text := nullif(btrim(new.payload ->> 'text_body'), '');
  if v_text is null then
    v_text := case new.template_key
      when 'appointment_reminder_6h' then 'Lembrete: seu atendimento será em breve.'
      else 'Lembrete: seu atendimento começa em breve.'
    end;
  end if;

  new.payload := (new.payload - 'buttons' - 'action_token') || jsonb_build_object(
    'message_kind', 'TEXT',
    'text_body', v_text || E'\n\nResponda apenas com um número:\n1 - Confirmar\n2 - Cancelar\n3 - Reagendar'
  );

  -- Não cria backlog durante desconexão. Após novo QR, lembretes cujo horário
  -- já passou antes da conexão ficam cancelados e não serão enviados depois.
  -- A linha cancelada preserva a chave idempotente criada junto dos tokens.
  if not found or v_status <> 'CONNECTED' then
    new.status := 'CANCELED';
    new.last_error := 'WHATSAPP_DISCONNECTED_AT_REMINDER_TIME';
    return new;
  end if;
  if v_provider = 'QR_WEB'
     and (v_connection_epoch_at is null or new.scheduled_at < v_connection_epoch_at) then
    new.status := 'CANCELED';
    new.last_error := 'REMINDER_PREDATES_CONNECTION_EPOCH';
    return new;
  end if;

  return new;
end;
$$;

drop trigger if exists notification_outbox_reminder_text_only
  on public.notification_outbox;
create trigger notification_outbox_reminder_text_only
before insert on public.notification_outbox
for each row
execute function public.prepare_whatsapp_reminder_text_outbox();

revoke all on function public.prepare_whatsapp_reminder_text_outbox()
  from public, anon, authenticated;

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
  v_reply text := btrim(coalesce(p_reply, ''));
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

  -- Uma confirmação de cancelamento aberta tem precedência sobre o menu 1/2/3.
  -- Evita interpretar "1" como presença confirmada depois de o cliente pedir
  -- cancelamento na mensagem anterior.
  with candidates as (
    select distinct on (t.appointment_id)
      t.id as token_id, t.token_hash, t.appointment_id,
      lower(a.service_period) as starts_at
    from public.customer_action_tokens t
    join public.customers c
      on c.id = t.customer_id and c.organization_id = t.organization_id
    join public.appointments a
      on a.id = t.appointment_id and a.organization_id = t.organization_id
    where t.organization_id = v_organization_id
      and c.phone_e164 = p_sender_e164
      and t.action::text = 'CONFIRM_CANCEL'
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

  if v_candidates > 1 then
    return jsonb_build_object('processed', false, 'reason', 'AMBIGUOUS_CANCEL_CONFIRMATION');
  end if;
  if v_candidates = 1 then
    if v_reply = '1' then
      return public.process_whatsapp_action_token(
        v_token_hash, p_sender_e164, p_phone_number_id, p_external_message_id,
        p_next_token, p_next_token_expires_at
      );
    end if;
    if v_reply <> '2' then
      return jsonb_build_object('processed', false, 'reason', 'CANCEL_CONFIRMATION_EXPECTED');
    end if;

    v_registration := public.register_webhook_event(
      'WHATSAPP', p_external_message_id, 'messages.text_action', true,
      jsonb_build_object(
        'reply', v_reply,
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

    update public.customer_action_tokens
    set consumed_at = now()
    where id = v_token_id and consumed_at is null;

    insert into public.notification_outbox (
      organization_id, appointment_id, template_key, recipient_e164,
      payload, idempotency_key
    ) values (
      v_organization_id, v_appointment_id, 'appointment_keep_confirmed', p_sender_e164,
      jsonb_build_object('message_kind', 'TEXT', 'text_body', 'Seu horário foi mantido.'),
      'whatsapp-keep-appointment:' || v_token_id
    ) on conflict (organization_id, idempotency_key) do nothing;

    perform public.finish_webhook_event(v_event_id, true, null, null);
    return jsonb_build_object('processed', true, 'applied', true);
  end if;

  if v_reply = '1' then
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
      t.id as token_id, t.token_hash, t.appointment_id,
      lower(a.service_period) as starts_at
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
    return jsonb_build_object(
      'processed', false,
      'reason', case
        when v_candidates = 0 then 'NO_ACTIVE_ACTION'
        else 'AMBIGUOUS_ACTION'
      end
    );
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
