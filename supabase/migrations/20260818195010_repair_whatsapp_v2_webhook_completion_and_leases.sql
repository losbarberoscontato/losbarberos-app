-- One PostgREST RPC signature, explicit event leases, and low-latency dispatch.
-- Previous event rows without a lease were created by the ambiguous completion RPC.
alter table public.whatsapp_webhook_events_v2
  add column if not exists locked_at timestamptz,
  add column if not exists locked_by text,
  add column if not exists lock_expires_at timestamptz;

create index if not exists whatsapp_webhook_events_v2_claim_idx
  on public.whatsapp_webhook_events_v2 (processing_status, lock_expires_at, received_at, id);

-- Do not replay historical test traffic. New workers always record a lease.
update public.whatsapp_webhook_events_v2
set processing_status = 'DEAD',
    processed_at = now(),
    last_error = 'STALE_PROCESSING_PRE_LEASE_MIGRATION'
where processing_status = 'PROCESSING'
  and lock_expires_at is null;

drop function if exists public.complete_whatsapp_v2_webhook_event(uuid, boolean, text);
drop function if exists public.complete_whatsapp_v2_webhook_event(uuid, boolean, text, boolean);

create function public.complete_whatsapp_v2_webhook_event(
  p_event_id uuid,
  p_success boolean,
  p_error text,
  p_terminal boolean
)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.whatsapp_webhook_events_v2
  set processing_status = case
        when p_success then 'COMPLETED'
        when p_terminal or attempt_count >= 5 then 'DEAD'
        else 'FAILED'
      end,
      processed_at = case when p_success or p_terminal then now() else processed_at end,
      last_error = case when p_success then null else left(p_error, 500) end,
      locked_at = null,
      locked_by = null,
      lock_expires_at = null
  where id = p_event_id
$$;

revoke all on function public.complete_whatsapp_v2_webhook_event(uuid, boolean, text, boolean)
  from public, anon, authenticated;
grant execute on function public.complete_whatsapp_v2_webhook_event(uuid, boolean, text, boolean)
  to service_role;

create or replace function public.claim_whatsapp_v2_webhook_events(
  p_limit integer,
  p_worker_id text,
  p_lease_seconds integer default 90
)
returns setof public.whatsapp_webhook_events_v2
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.require_service_role();
  return query
  with due as (
    select id
    from public.whatsapp_webhook_events_v2
    where processing_status in ('RECEIVED', 'FAILED')
       or (processing_status = 'PROCESSING' and lock_expires_at < now())
    order by received_at, id
    limit greatest(1, least(p_limit, 50))
    for update skip locked
  )
  update public.whatsapp_webhook_events_v2 e
  set processing_status = 'PROCESSING',
      attempt_count = attempt_count + 1,
      locked_at = now(),
      locked_by = p_worker_id,
      lock_expires_at = now() + make_interval(secs => greatest(30, least(p_lease_seconds, 300)))
  from due
  where e.id = due.id
  returning e.*;
end;
$$;

revoke all on function public.claim_whatsapp_v2_webhook_events(integer, text, integer)
  from public, anon, authenticated;
grant execute on function public.claim_whatsapp_v2_webhook_events(integer, text, integer)
  to service_role;

-- Refresh the PostgREST schema cache before Functions call the new signature.
notify pgrst, 'reload schema';
