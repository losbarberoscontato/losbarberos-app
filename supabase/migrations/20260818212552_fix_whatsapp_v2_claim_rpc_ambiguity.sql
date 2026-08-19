-- PostgREST cannot choose between an old two-argument RPC and a new
-- three-argument RPC with a default. Keep exactly one explicit contract.
drop function if exists public.claim_whatsapp_v2_webhook_events(integer, text);
drop function if exists public.claim_whatsapp_v2_webhook_events(integer, text, integer);

create function public.claim_whatsapp_v2_webhook_events(
  p_limit integer,
  p_worker_id text,
  p_lease_seconds integer
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

notify pgrst, 'reload schema';
