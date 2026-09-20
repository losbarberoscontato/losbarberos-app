-- Mantém vencimento da entrada separado do primeiro vencimento das parcelas.
create or replace function public.save_project_contract(
  p_organization_id uuid,
  p_engagement_id uuid,
  p_project_id uuid,
  p_customer_id uuid,
  p_package_id uuid,
  p_status text,
  p_contracted_cents bigint,
  p_entry_cents bigint,
  p_installments_count integer,
  p_first_due_on date,
  p_entry_due_on date
) returns uuid
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  if not public.is_organization_owner(p_organization_id) then
    raise exception using errcode = '42501', message = 'project contract write denied';
  end if;
  if p_entry_due_on is null then
    raise exception using errcode = '22023', message = 'entry due date is required';
  end if;

  -- O RPC anterior continua responsável por toda a reconciliação idempotente
  -- e preserva parcelas já recebidas. Ajustamos somente a parcela 0 aberta.
  v_id := public.save_project_contract(
    p_organization_id,
    p_engagement_id,
    p_project_id,
    p_customer_id,
    p_package_id,
    p_status,
    p_contracted_cents,
    p_entry_cents,
    p_installments_count,
    p_first_due_on
  );

  update public.project_installments
     set due_on = p_entry_due_on
   where organization_id = p_organization_id
     and engagement_id = v_id
     and installment_number = 0
     and status = 'OPEN';

  update public.financial_entries e
     set due_date = p_entry_due_on
   where e.organization_id = p_organization_id
     and e.source = 'PROJECT'
     and e.project_installment_id in (
       select i.id
         from public.project_installments i
        where i.organization_id = p_organization_id
          and i.engagement_id = v_id
          and i.installment_number = 0
          and i.status = 'OPEN'
     )
     and not exists (
       select 1
         from public.financial_settlements fs
        where fs.entry_id = e.id
     );

  return v_id;
end;
$$;

revoke all on function public.save_project_contract(uuid, uuid, uuid, uuid, uuid, text, bigint, bigint, integer, date, date) from public, anon;
grant execute on function public.save_project_contract(uuid, uuid, uuid, uuid, uuid, text, bigint, bigint, integer, date, date) to authenticated;
