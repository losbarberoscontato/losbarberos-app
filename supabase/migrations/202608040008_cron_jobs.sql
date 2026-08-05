-- Supabase Cron runs atomic database maintenance and wakes provider workers.
-- HTTP credentials are resolved inside this private wrapper from Vault; cron
-- command text, public schemas and logs never contain a credential.

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

create schema if not exists app_private;
revoke all on schema app_private from public, anon, authenticated;

create table if not exists app_private.edge_dispatch_audit (
  id bigint generated always as identity primary key,
  function_name text not null,
  status text not null check (status in ('QUEUED', 'SKIPPED_CONFIG', 'ERROR')),
  request_id bigint,
  error_code text,
  created_at timestamptz not null default now()
);

revoke all on app_private.edge_dispatch_audit from public, anon, authenticated;

create or replace function app_private.dispatch_edge_function(
  p_function_name text,
  p_body jsonb
)
returns bigint
language plpgsql
security definer
set search_path = app_private, vault, net, pg_temp
as $$
declare
  v_supabase_url text;
  v_service_role_key text;
  v_request_id bigint;
begin
  if p_function_name not in ('whatsapp-send-outbox', 'maintenance-jobs')
     or jsonb_typeof(p_body) <> 'object' then
    raise exception using errcode = '22023', message = 'unsupported edge worker dispatch';
  end if;
  select decrypted_secret into v_supabase_url
  from vault.decrypted_secrets
  where name = 'los_barberos_supabase_url'
  limit 1;
  select decrypted_secret into v_service_role_key
  from vault.decrypted_secrets
  where name = 'los_barberos_service_role_key'
  limit 1;
  if nullif(v_supabase_url, '') is null or nullif(v_service_role_key, '') is null then
    insert into app_private.edge_dispatch_audit (function_name, status, error_code)
    values (p_function_name, 'SKIPPED_CONFIG', 'VAULT_CONFIG_MISSING');
    return null;
  end if;
  select net.http_post(
    url := rtrim(v_supabase_url, '/') || '/functions/v1/' || p_function_name,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_service_role_key,
      'apikey', v_service_role_key
    ),
    body := p_body,
    timeout_milliseconds := 10000
  ) into v_request_id;
  insert into app_private.edge_dispatch_audit (function_name, status, request_id)
  values (p_function_name, 'QUEUED', v_request_id);
  delete from app_private.edge_dispatch_audit
  where created_at < now() - interval '30 days';
  return v_request_id;
exception
  when others then
    insert into app_private.edge_dispatch_audit (function_name, status, error_code)
    values (p_function_name, 'ERROR', sqlstate);
    return null;
end;
$$;

revoke all on function app_private.dispatch_edge_function(text, jsonb)
  from public, anon, authenticated;

select cron.schedule(
  'los_barberos_expire_holds',
  '* * * * *',
  $job$select public.expire_stale_appointment_holds(1000);$job$
);

select cron.schedule(
  'los_barberos_send_whatsapp_outbox',
  '* * * * *',
  $job$select app_private.dispatch_edge_function(
    'whatsapp-send-outbox', '{"limit": 50}'::jsonb
  );$job$
);

select cron.schedule(
  'los_barberos_process_mercado_pago_refunds',
  '* * * * *',
  $job$select app_private.dispatch_edge_function(
    'maintenance-jobs',
    '{"job": "process_mercado_pago_refunds", "limit": 10}'::jsonb
  );$job$
);

select cron.schedule(
  'los_barberos_expire_billing_grace',
  '*/10 * * * *',
  $job$select public.process_expired_billing_grace(1000);$job$
);

select cron.schedule(
  'los_barberos_enqueue_whatsapp_reminders',
  '*/5 * * * *',
  $job$select public.enqueue_due_whatsapp_reminders(1000);$job$
);

select cron.schedule(
  'los_barberos_mark_unknown_whatsapp_sends',
  '* * * * *',
  $job$select public.mark_expired_notification_sends_unknown(1000);$job$
);

select cron.schedule(
  'los_barberos_process_retention',
  '30 6 * * *',
  $job$select public.process_expired_organization_retention(200);$job$
);
