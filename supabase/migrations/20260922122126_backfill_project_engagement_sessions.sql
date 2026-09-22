-- Backfill contratos ativos criados antes da migration de sessões.
insert into public.project_engagement_sessions (
  organization_id,
  engagement_id,
  session_number
)
select
  engagement.organization_id,
  engagement.id,
  generated.session_number
from public.project_engagements engagement
join public.project_packages package
  on package.id = engagement.package_id
 and package.organization_id = engagement.organization_id
cross join lateral generate_series(
  1,
  greatest(coalesce(package.sessions_count, 1), 1)
) generated(session_number)
where engagement.status = 'ACTIVE'
on conflict (engagement_id, session_number) do nothing;
