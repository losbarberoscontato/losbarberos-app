-- Archive stale unread customer alerts for project offers that are no longer
-- awaiting acceptance, including contracts canceled before this migration.
update public.customer_in_app_notifications notification
   set read_at = coalesce(notification.read_at, now())
  from public.project_engagements engagement
 where notification.organization_id = engagement.organization_id
   and notification.engagement_id = engagement.id
   and notification.kind = 'PROJECT_OFFER'
   and notification.read_at is null
   and engagement.status <> 'PROPOSAL';

create or replace function public.archive_project_offer_notification()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.status = 'PROPOSAL' and new.status <> 'PROPOSAL' then
    update public.customer_in_app_notifications
       set read_at = coalesce(read_at, now())
     where organization_id = new.organization_id
       and engagement_id = new.id
       and kind = 'PROJECT_OFFER'
       and read_at is null;
  end if;
  return new;
end;
$$;

revoke all on function public.archive_project_offer_notification()
  from public, anon, authenticated, service_role;

drop trigger if exists project_offer_notification_archive on public.project_engagements;
create trigger project_offer_notification_archive
  after update of status on public.project_engagements
  for each row
  when (old.status = 'PROPOSAL' and new.status <> 'PROPOSAL')
  execute function public.archive_project_offer_notification();
