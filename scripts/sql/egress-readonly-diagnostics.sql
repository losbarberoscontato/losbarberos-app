-- Administrative read-only inspection. No payloads, phones, tokens, cron
-- commands or full rows leave the database. Run against the confirmed project.
-- CLI 3: supabase db query --remote=bwdjkhqshmppescunwer --read-only --file <this-file>
-- Do not treat lower activity during an outage as Egress savings.

select jobname, schedule, active from cron.job order by jobname;
select last_tick_at, last_schedule_at from public.whatsapp_runtime_health;
select runtime_engine, count(*) as organizations
from public.whatsapp_automation_settings_v2 group by runtime_engine;

select (select stats_reset from extensions.pg_stat_statements_info) as stats_since,
  case
    when query like '%whatsapp_runtime_claim_events%' then 'claim_events'
    when query like '%whatsapp_runtime_claim%' then 'claim_jobs'
    when query like '%whatsapp_runtime_schedule%' then 'schedule'
    when query like '%whatsapp_runtime_heartbeat%' then 'heartbeat'
    else 'other_runtime'
  end as operation,
  sum(calls) as calls, sum(rows) as statement_rows,
  round(sum(total_exec_time)::numeric, 1) as execution_ms
from extensions.pg_stat_statements
where query like '%whatsapp_runtime_%' and query not like '%pg_stat_statements%'
group by 1, 2 order by calls desc limit 8;

-- statement_rows may count the PostgREST envelope, NOT claimed jobs/events.
-- SQL JSON formatting differs from PostgREST wire serialization.
select 'jobs_sample' as sample, count(*) as rows,
  coalesce(sum(octet_length(to_jsonb(x)::text)), 0) as full_json_bytes,
  coalesce(sum(octet_length(jsonb_build_object(
    'id',x.id,'organization_id',x.organization_id,'connection_id',x.connection_id,
    'appointment_id',x.appointment_id,'job_type',x.job_type,
    'recipient_e164',x.recipient_e164,'payload',x.payload,
    'lease_token',x.lease_token,'scheduled_for',x.scheduled_for
  )::text)), 0) as projected_json_bytes
from (select * from public.whatsapp_automation_jobs order by created_at desc limit 100) x
union all
select 'events_sample', count(*),
  coalesce(sum(octet_length(to_jsonb(x)::text)), 0),
  coalesce(sum(octet_length(jsonb_build_object(
    'id',x.id,'organization_id',x.organization_id,'connection_id',x.connection_id,
    'lease_token',x.lease_token,'payload',x.payload
  )::text)), 0)
from (select * from public.whatsapp_webhook_events_v2 order by received_at desc limit 100) x;
