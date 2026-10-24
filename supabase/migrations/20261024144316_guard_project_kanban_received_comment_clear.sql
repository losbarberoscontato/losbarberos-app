-- Clearing Kanban receipt metadata during cancellation must not produce a NULL
-- comment body; keep the audit trail with an explicit removal message.
create or replace function public.record_project_engagement_kanban_received_comment()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_author_name text;
  v_timezone text;
  v_body text;
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

  v_body := case
    when new.kanban_received_at is null then 'Data de recebimento removida do Kanban'
    else 'Data recebido alterada para ' || to_char((new.kanban_received_at at time zone coalesce(v_timezone, 'UTC')), 'DD/MM/YYYY HH24:MI')
  end;

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
    v_body,
    auth.uid(),
    coalesce(v_author_name, new.kanban_received_by_name, 'Usuário')
  );

  return new;
end;
$$;
