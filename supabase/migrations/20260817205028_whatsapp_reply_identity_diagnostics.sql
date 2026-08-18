-- Registra rejeicoes de respostas do WhatsApp QR sem persistir telefone ou texto recebido.
-- A funcao e exclusiva do service_role usado pela Edge Function autenticada pelo segredo Evolution.
create or replace function public.record_whatsapp_reply_rejection(
  p_gateway_instance_id text,
  p_external_message_id text,
  p_reason text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_organization_id uuid;
  v_reason text := upper(btrim(coalesce(p_reason, '')));
  v_registration jsonb;
  v_event_id uuid;
  v_inserted boolean;
begin
  perform public.require_service_role();

  if v_reason not in (
    'SENDER_PHONE_UNRESOLVED',
    'UNKNOWN_CHANNEL',
    'NO_ACTIVE_ACTION',
    'AMBIGUOUS_ACTION',
    'UNSUPPORTED_REPLY',
    'ACTION_NOT_APPLIED',
    'CONNECTED_MANAGER_PHONE_UNAVAILABLE'
  ) then
    raise exception using errcode = '22023', message = 'invalid WhatsApp reply rejection reason';
  end if;
  if nullif(btrim(coalesce(p_gateway_instance_id, '')), '') is null
     or nullif(btrim(coalesce(p_external_message_id, '')), '') is null then
    raise exception using errcode = '22023', message = 'invalid WhatsApp reply rejection identity';
  end if;

  select c.organization_id into v_organization_id
  from public.whatsapp_business_connections c
  where c.provider = 'QR_WEB'
    and c.gateway_instance_id = p_gateway_instance_id
    and c.is_active
  limit 1;

  if v_organization_id is null then
    return false;
  end if;

  v_registration := public.register_webhook_event(
    'WHATSAPP',
    p_external_message_id || ':rejected',
    'messages.reply_rejected',
    true,
    jsonb_build_object(
      'channel_id', p_gateway_instance_id,
      'reason', v_reason
    ),
    v_organization_id,
    null
  );
  v_event_id := (v_registration ->> 'webhook_event_id')::uuid;
  v_inserted := (v_registration ->> 'inserted')::boolean;

  if v_inserted then
    perform public.finish_webhook_event(v_event_id, true, null, null);
  end if;
  return v_inserted;
end;
$$;

revoke all on function public.record_whatsapp_reply_rejection(text, text, text)
  from public, anon, authenticated;
grant execute on function public.record_whatsapp_reply_rejection(text, text, text)
  to service_role;
