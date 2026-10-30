-- Registra no sino do gestor cada alteração de escala feita pelo próprio profissional.
-- O trigger roda na mesma transação do evento append-only do histórico.
alter table public.manager_notifications
  drop constraint if exists manager_notifications_kind_check;

alter table public.manager_notifications
  add constraint manager_notifications_kind_check
  check (kind in (
    'SUBSCRIPTION_REQUEST',
    'SUBSCRIPTION_OFFER_ACCEPTED',
    'SUBSCRIPTION_OFFER_DECLINED',
    'PROJECT_OFFER_DECLINED',
    'SUBSCRIPTION_CANCELLATION_REQUEST',
    'PROJECT_CANCELLATION_REQUEST',
    'BARBER_SCHEDULE_CHANGED'
  ));

create or replace function public.notify_manager_professional_schedule_change()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_owner uuid;
begin
  -- Alterações feitas pelo gestor também entram no histórico, mas não geram
  -- uma notificação redundante para o próprio gestor.
  if new.details ->> 'actor_role' is distinct from 'PROFESSIONAL' then
    return new;
  end if;

  -- Confirma o vínculo profissional + organização antes de encaminhar o evento.
  if not exists (
    select 1
      from public.barbers b
     where b.id = new.barber_id
       and b.organization_id = new.organization_id
       and b.auth_user_id = new.actor_user_id
       and b.active
  ) then
    return new;
  end if;

  for v_owner in
    select m.user_id
      from public.organization_memberships m
     where m.organization_id = new.organization_id
       and m.active
       and m.role = 'OWNER'
  loop
    insert into public.manager_notifications (
      organization_id,
      recipient_user_id,
      kind,
      title,
      body,
      href
    ) values (
      new.organization_id,
      v_owner,
      'BARBER_SCHEDULE_CHANGED',
      'Alteração na escala da equipe',
      new.message,
      '/gestor/equipe'
    ) on conflict do nothing;
  end loop;

  return new;
end;
$$;

revoke all on function public.notify_manager_professional_schedule_change() from public, anon, authenticated;

drop trigger if exists barber_schedule_change_manager_notification on public.barber_schedule_change_messages;
create trigger barber_schedule_change_manager_notification
  after insert on public.barber_schedule_change_messages
  for each row execute function public.notify_manager_professional_schedule_change();
