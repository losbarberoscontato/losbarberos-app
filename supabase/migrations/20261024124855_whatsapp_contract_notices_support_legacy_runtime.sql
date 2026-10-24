-- The v2 dispatcher retains a compatibility claim path while an organization
-- is on the LEGACY/SHADOW runtime. Do not suppress transactional plan notices
-- for those organizations: the connection and automation mode gates below
-- still control whether the job is enqueued.
create or replace function public.whatsapp_enqueue_manager_plan_created_notice(
  p_organization_id uuid,
  p_customer_id uuid,
  p_reference_id uuid,
  p_message_kind text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_customer public.customers%rowtype;
  v_settings public.whatsapp_automation_settings_v2%rowtype;
  v_connection public.whatsapp_business_connections%rowtype;
  v_templates jsonb;
  v_masked_email text;
begin
  if p_message_kind not in ('PROJECT_CONTRACT_CREATED_CLIENT', 'SUBSCRIPTION_CREATED_CLIENT') then
    raise exception using errcode = '22023', message = 'invalid plan notice kind';
  end if;

  select * into v_customer from public.customers
  where id = p_customer_id and organization_id = p_organization_id and active;
  if not found or v_customer.phone_e164 is null
    or not public.whatsapp_v2_consented(p_organization_id, p_customer_id) then
    return;
  end if;

  -- runtime_engine is intentionally not restricted to ACTIVE. The deployed
  -- dispatcher uses claim_whatsapp_v2_jobs for LEGACY/SHADOW organizations.
  select * into v_settings from public.whatsapp_automation_settings_v2
  where organization_id = p_organization_id and mode = 'ACTIVE' and not dispatch_paused;
  if not found then return; end if;

  select * into v_connection from public.whatsapp_business_connections
  where organization_id = p_organization_id and is_active and status = 'CONNECTED'
  order by connected_at desc nulls last limit 1;
  if not found then return; end if;

  v_templates := public.whatsapp_v2_default_message_templates() || coalesce(v_settings.templates, '{}'::jsonb);
  v_masked_email := case
    when v_customer.email ~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$'
      then left(split_part(v_customer.email, '@', 1), 3) || '*****@' || split_part(v_customer.email, '@', 2)
    else 'não cadastrado'
  end;

  insert into public.whatsapp_automation_jobs (
    organization_id, connection_id, customer_id, priority, job_type, recipient_e164,
    payload, valid_until, dedupe_key
  ) values (
    p_organization_id, v_connection.id, p_customer_id, 20, 'MANUAL_OUTBOUND_TEXT', v_customer.phone_e164,
    jsonb_build_object(
      'schema_version', 1,
      'message_kind', p_message_kind,
      'transactional_plan_notice', true,
      'customer_name', v_customer.full_name,
      'customer_email_masked', v_masked_email,
      'customer_app_url', 'https://displaysh-app.vercel.app/cliente/assinaturas',
      'templates', v_templates
    ),
    now() + interval '30 days',
    'manager-plan-created:' || p_message_kind || ':' || p_reference_id::text
  ) on conflict (organization_id, dedupe_key) do nothing;
end;
$$;

revoke all on function public.whatsapp_enqueue_manager_plan_created_notice(uuid, uuid, uuid, text)
  from public, anon, authenticated, service_role;
