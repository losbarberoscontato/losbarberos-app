-- Keep the plan-notice producer on the Evolution QR transport. A connected
-- Meta Cloud connection is not a sender for whatsapp-v2-dispatcher.
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

  select * into v_settings from public.whatsapp_automation_settings_v2
  where organization_id = p_organization_id and mode = 'ACTIVE' and not dispatch_paused;
  if not found then return; end if;

  select * into v_connection from public.whatsapp_business_connections
  where organization_id = p_organization_id and provider = 'QR_WEB'
    and is_active and status = 'CONNECTED'
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

create or replace function public.whatsapp_v2_validate_plan_notice_dispatch(
  p_job_id uuid,
  p_worker_id text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job public.whatsapp_automation_jobs%rowtype;
  v_customer public.customers%rowtype;
  v_reason text;
begin
  perform public.require_service_role();
  select * into v_job from public.whatsapp_automation_jobs where id = p_job_id for update;
  if not found or v_job.status <> 'PROCESSING' or v_job.locked_by is distinct from p_worker_id
    or v_job.lock_expires_at <= now() then
    raise exception 'STALE_LEASE';
  end if;
  if v_job.job_type <> 'MANUAL_OUTBOUND_TEXT'
    or coalesce((v_job.payload ->> 'transactional_plan_notice')::boolean, false) is not true
    or v_job.payload ->> 'message_kind' not in ('PROJECT_CONTRACT_CREATED_CLIENT', 'SUBSCRIPTION_CREATED_CLIENT') then
    raise exception 'INVALID_PLAN_NOTICE_JOB';
  end if;

  if not exists (
    select 1
    from public.whatsapp_automation_settings_v2 s
    join public.whatsapp_business_connections w
      on w.id = v_job.connection_id and w.organization_id = s.organization_id
    where s.organization_id = v_job.organization_id
      and s.runtime_engine <> 'ACTIVE' and s.mode = 'ACTIVE' and not s.dispatch_paused
      and w.provider = 'QR_WEB' and w.is_active and w.status = 'CONNECTED'
  ) then
    v_reason := 'CONNECTION_OR_AUTOMATION_PAUSED';
  end if;

  select * into v_customer from public.customers
  where id = v_job.customer_id and organization_id = v_job.organization_id for share;
  if v_customer.id is null or not v_customer.active
    or not public.whatsapp_v2_consented(v_job.organization_id, v_job.customer_id) then
    v_reason := 'TRANSACTIONAL_REVOKED';
  elsif v_customer.phone_e164 is distinct from v_job.recipient_e164 then
    v_reason := 'RECIPIENT_CHANGED';
  end if;

  if v_reason is not null then
    update public.whatsapp_automation_jobs
    set status = 'SKIPPED', last_error_code = v_reason, locked_by = null,
        lock_expires_at = null, updated_at = now()
    where id = v_job.id;
    return false;
  end if;
  return true;
end;
$$;

revoke all on function public.whatsapp_v2_validate_plan_notice_dispatch(uuid, text)
  from public, anon, authenticated;
grant execute on function public.whatsapp_v2_validate_plan_notice_dispatch(uuid, text)
  to service_role;
