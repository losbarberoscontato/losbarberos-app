-- Compatibilidade para propostas pendentes anteriores à habilitação do app do cliente.
insert into public.customer_in_app_notifications(organization_id,customer_id,kind,subscription_id)
select s.organization_id,s.customer_id,'SUBSCRIPTION_OFFER',s.id
from public.customer_subscriptions s
where s.status='REQUESTED' and s.contract_accepted_at is null
  and exists (select 1 from public.organization_memberships m where m.organization_id=s.organization_id and m.user_id=s.created_by and m.active and m.role='OWNER')
on conflict do nothing;

insert into public.customer_in_app_notifications(organization_id,customer_id,kind,engagement_id)
select e.organization_id,e.customer_id,'PROJECT_OFFER',e.id
from public.project_engagements e
where e.status='PROPOSAL'
  and exists (select 1 from public.organization_memberships m where m.organization_id=e.organization_id and m.user_id=e.created_by and m.active and m.role='OWNER')
on conflict do nothing;

update public.manager_notifications n set
  body = split_part(n.body, ' Plano: ', 1) || ' Plano: ' || p.name || '.',
  href = '/gestor/clientes?cliente=' || n.customer_id::text || '&assinatura=' || n.subscription_id::text
from public.customer_subscriptions s
join public.subscription_plans p on p.id=s.plan_id and p.organization_id=s.organization_id
where n.subscription_id=s.id and n.organization_id=s.organization_id
  and n.kind='SUBSCRIPTION_REQUEST' and n.customer_id is not null;
