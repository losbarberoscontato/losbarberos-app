-- Estados explícitos para arquivar propostas recusadas sem confundi-las com cancelamentos.
alter type public.subscription_enrollment_status add value if not exists 'DECLINED';

alter table public.customer_subscriptions
  add column if not exists declined_at timestamptz,
  add column if not exists declined_by uuid references auth.users(id);

alter table public.customer_subscriptions
  add constraint customer_subscriptions_declined_metadata_check
  check ((status::text = 'DECLINED' and declined_at is not null and declined_by is not null)
      or (status::text <> 'DECLINED' and declined_at is null and declined_by is null));

alter table public.project_engagements
  drop constraint if exists project_engagements_status_check;

alter table public.project_engagements
  add constraint project_engagements_status_check
  check (status in ('PROPOSAL', 'ACTIVE', 'COMPLETED', 'CANCELED', 'DECLINED'));

alter table public.project_engagements
  add column if not exists declined_at timestamptz,
  add column if not exists declined_by uuid references auth.users(id);

alter table public.project_engagements
  add constraint project_engagements_declined_metadata_check
  check ((status = 'DECLINED' and declined_at is not null and declined_by is not null)
      or (status <> 'DECLINED' and declined_at is null and declined_by is null));

alter table public.manager_notifications
  add column if not exists engagement_id uuid;

alter table public.manager_notifications
  drop constraint if exists manager_notifications_engagement_id_fkey;

alter table public.manager_notifications
  add constraint manager_notifications_engagement_tenant_fk
  foreign key (engagement_id, organization_id)
  references public.project_engagements(id, organization_id) on delete cascade;

alter table public.manager_notifications
  drop constraint if exists manager_notifications_kind_check,
  drop constraint if exists manager_notifications_organization_id_recipient_user_id_kind_subscription_id_key;

alter table public.manager_notifications
  add constraint manager_notifications_kind_check
  check (kind in ('SUBSCRIPTION_REQUEST', 'SUBSCRIPTION_OFFER_DECLINED', 'PROJECT_OFFER_DECLINED'));

create unique index if not exists manager_notifications_subscription_unique
  on public.manager_notifications (organization_id, recipient_user_id, kind, subscription_id)
  where subscription_id is not null;

create unique index if not exists manager_notifications_engagement_unique
  on public.manager_notifications (organization_id, recipient_user_id, kind, engagement_id)
  where engagement_id is not null;

grant select on public.manager_notifications to authenticated;
