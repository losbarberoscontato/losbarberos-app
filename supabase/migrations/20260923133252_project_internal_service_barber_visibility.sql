-- Profissionais visualizam somente os serviços internos atribuídos ao seu próprio cadastro.
drop policy if exists project_internal_services_member_select on public.project_engagement_internal_services;

create policy project_internal_services_member_select
  on public.project_engagement_internal_services
  for select to authenticated
  using (
    public.is_barber_project_member(organization_id, project_id)
    and barber_id = (
      select b.id
      from public.barbers b
      where b.organization_id = project_engagement_internal_services.organization_id
        and b.auth_user_id = auth.uid()
        and b.active
      limit 1
    )
  );
