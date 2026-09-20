alter table public.barbers
  add column professional_function_id uuid;

alter table public.barbers
  add constraint barbers_professional_function_same_organization_fkey
  foreign key (professional_function_id, organization_id)
  references public.professional_functions (id, organization_id);
