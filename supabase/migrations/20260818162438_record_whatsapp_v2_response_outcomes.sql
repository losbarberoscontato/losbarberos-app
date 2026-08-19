-- A business rejection must never look like a successful webhook delivery.
-- Retry only provider/transient outcomes; preserve terminal reasons for ops.
create function public.complete_whatsapp_v2_webhook_event(
  p_event_id uuid,
  p_success boolean,
  p_error text default null,
  p_terminal boolean default false
)
returns void language sql security definer set search_path = public, pg_temp as $$
  update public.whatsapp_webhook_events_v2
  set processing_status = case
        when p_success then 'COMPLETED'
        when p_terminal or attempt_count >= 5 then 'DEAD'
        else 'FAILED'
      end,
      processed_at = case when p_success or p_terminal then now() else processed_at end,
      last_error = case when p_success then null else left(p_error, 500) end
  where id = p_event_id
$$;

revoke all on function public.complete_whatsapp_v2_webhook_event(uuid, boolean, text, boolean)
  from public, anon, authenticated;
grant execute on function public.complete_whatsapp_v2_webhook_event(uuid, boolean, text, boolean)
  to service_role;
