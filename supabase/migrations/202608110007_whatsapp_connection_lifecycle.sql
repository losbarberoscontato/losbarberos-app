-- Lifecycle administrativo do canal WhatsApp. Mantém histórico e nunca remove
-- credenciais do Vault automaticamente.

create or replace function public.disconnect_whatsapp_connection(
  p_organization_id uuid,
  p_connection_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_connection public.whatsapp_business_connections%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended('whatsapp-provider:' || p_organization_id::text, 0));

  if not public.is_organization_owner(p_organization_id)
     or not public.organization_allows_management_mutations(p_organization_id) then
    raise exception using errcode = '42501', message = 'organization mutation not allowed';
  end if;

  select * into strict v_connection
  from public.whatsapp_business_connections
  where id = p_connection_id and organization_id = p_organization_id;

  update public.whatsapp_business_connections
  set status = 'DISCONNECTED',
      is_active = false,
      disconnected_at = now(),
      last_status_at = now(),
      last_error_code = null,
      updated_at = now()
  where id = v_connection.id and organization_id = p_organization_id;

  return public.get_whatsapp_connection_status(p_organization_id);
end;
$$;

revoke all on function public.disconnect_whatsapp_connection(uuid, uuid) from public, anon, authenticated;
grant execute on function public.disconnect_whatsapp_connection(uuid, uuid) to authenticated;

-- Serializa a troca de canal por organização. A constraint parcial continua
-- sendo a autoridade final, mas o lock reduz corridas entre Meta e QR Web.
create or replace function public.set_whatsapp_active_provider(
  p_organization_id uuid,
  p_connection_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_connection public.whatsapp_business_connections%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended('whatsapp-provider:' || p_organization_id::text, 0));

  if not public.is_organization_owner(p_organization_id)
     or not public.organization_allows_management_mutations(p_organization_id) then
    raise exception using errcode = '42501', message = 'organization mutation not allowed';
  end if;

  select * into strict v_connection
  from public.whatsapp_business_connections
  where id = p_connection_id and organization_id = p_organization_id;

  if v_connection.status <> 'CONNECTED' then
    raise exception using errcode = '55000', message = 'connection is not connected';
  end if;

  update public.whatsapp_business_connections
  set is_active = false, updated_at = now()
  where organization_id = p_organization_id and is_active;

  update public.whatsapp_business_connections
  set is_active = true, updated_at = now()
  where id = p_connection_id and organization_id = p_organization_id;

  return public.get_whatsapp_connection_status(p_organization_id);
end;
$$;

-- Uma sessão QR encerrada não pode continuar sendo usada como sender ativo.
create or replace function public.update_whatsapp_qr_status(
  p_gateway_instance_id text,
  p_status text,
  p_error_code text default null
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_status public.whatsapp_connection_status;
  v_organization_id uuid;
begin
  perform public.require_service_role();
  v_status := case lower(p_status)
    when 'open' then 'CONNECTED'::public.whatsapp_connection_status
    when 'connecting' then 'WAITING_FOR_QR'::public.whatsapp_connection_status
    when 'close' then 'DISCONNECTED'::public.whatsapp_connection_status
    else 'ERROR'::public.whatsapp_connection_status
  end;

  select organization_id into v_organization_id
  from public.whatsapp_business_connections
  where provider = 'QR_WEB' and gateway_instance_id = p_gateway_instance_id;
  if not found then return false; end if;

  perform pg_advisory_xact_lock(hashtextextended('whatsapp-provider:' || v_organization_id::text, 0));

  select organization_id into v_organization_id
  from public.whatsapp_business_connections
  where provider = 'QR_WEB' and gateway_instance_id = p_gateway_instance_id
  for update;
  if not found then return false; end if;
  update public.whatsapp_business_connections
  set status = v_status,
      is_active = case when v_status = 'DISCONNECTED' then false else is_active end,
      connected_at = case when v_status = 'CONNECTED' then coalesce(connected_at, now()) else connected_at end,
      disconnected_at = case when v_status = 'DISCONNECTED' then now() else disconnected_at end,
      last_error_code = left(nullif(btrim(p_error_code), ''), 255),
      last_status_at = now(), updated_at = now()
  where provider = 'QR_WEB' and gateway_instance_id = p_gateway_instance_id;
  return found;
end;
$$;
