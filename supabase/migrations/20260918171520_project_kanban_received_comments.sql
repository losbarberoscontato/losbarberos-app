-- Registra no histórico do evento cada nova data de recebimento em um quadro.
create or replace function public.record_project_engagement_kanban_received_comment()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_author_name text;
  v_timezone text;
begin
  if new.kanban_received_at is not distinct from old.kanban_received_at
     or auth.uid() is null then
    return new;
  end if;

  select coalesce(nullif(btrim(p.display_name), ''), nullif(btrim(auth.jwt() ->> 'email'), ''), 'Usuário')
    into v_author_name
    from public.profiles p
   where p.id = auth.uid();

  select o.timezone
    into v_timezone
    from public.organizations o
   where o.id = new.organization_id;

  insert into public.project_engagement_comments(
    organization_id,
    project_id,
    engagement_id,
    body,
    created_by,
    author_name
  ) values (
    new.organization_id,
    new.project_id,
    new.id,
    'Data recebido alterada para ' || to_char((new.kanban_received_at at time zone coalesce(v_timezone, 'UTC')), 'DD/MM/YYYY HH24:MI'),
    auth.uid(),
    coalesce(v_author_name, new.kanban_received_by_name, 'Usuário')
  );

  return new;
end;
$$;

drop trigger if exists project_engagement_kanban_received_comment on public.project_engagements;
create trigger project_engagement_kanban_received_comment
  after update of kanban_received_at on public.project_engagements
  for each row
  when (old.kanban_received_at is distinct from new.kanban_received_at)
  execute function public.record_project_engagement_kanban_received_comment();

-- Backfill the current received date once, preserving the historical timestamp.
insert into public.project_engagement_comments(
  organization_id,
  project_id,
  engagement_id,
  body,
  created_by,
  author_name,
  created_at,
  updated_at
)
select
  e.organization_id,
  e.project_id,
  e.id,
  'Data recebido alterada para ' || to_char((e.kanban_received_at at time zone coalesce(o.timezone, 'UTC')), 'DD/MM/YYYY HH24:MI'),
  coalesce(e.kanban_received_by, e.created_by),
  coalesce(nullif(btrim(e.kanban_received_by_name), ''), 'Usuário'),
  e.kanban_received_at,
  e.kanban_received_at
from public.project_engagements e
join public.organizations o on o.id = e.organization_id
where e.kanban_received_at is not null
  and not exists (
    select 1
    from public.project_engagement_comments c
    where c.organization_id = e.organization_id
      and c.engagement_id = e.id
      and c.created_at = e.kanban_received_at
      and c.body like 'Data recebido alterada para %'
  );
