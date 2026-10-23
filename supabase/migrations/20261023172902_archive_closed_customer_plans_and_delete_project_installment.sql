create or replace function public.delete_open_project_installment(
  p_organization_id uuid,
  p_installment_id uuid
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_installment public.project_installments%rowtype;
  v_entry public.financial_entries%rowtype;
begin
  if not public.is_organization_owner(p_organization_id) then
    raise exception using errcode = '42501', message = 'project installment write denied';
  end if;

  -- Lock the receivable first, matching the settlement path and avoiding a
  -- settlement/deletion lock inversion.
  select * into v_entry
    from public.financial_entries
   where project_installment_id = p_installment_id
     and organization_id = p_organization_id
     and source = 'PROJECT'
     and canceled_at is null
   for update;

  select * into strict v_installment
    from public.project_installments
   where id = p_installment_id and organization_id = p_organization_id
   for update;

  if v_installment.status <> 'OPEN' then
    raise exception using errcode = '22023', message = 'paid installment cannot be deleted';
  end if;

  if v_entry.id is not null and exists (
    select 1 from public.financial_settlements
     where organization_id = p_organization_id and entry_id = v_entry.id
  ) then
    raise exception using errcode = '22023', message = 'settled installment requires reversal';
  end if;

  if v_entry.id is not null then
    perform public.cancel_financial_entry(v_entry.id, 'Parcela de projeto excluída pelo gestor');
  end if;

  update public.project_installments
     set status = 'CANCELED'
   where id = v_installment.id and organization_id = p_organization_id;
end;
$$;

revoke all on function public.delete_open_project_installment(uuid, uuid) from public, anon;
grant execute on function public.delete_open_project_installment(uuid, uuid) to authenticated;
