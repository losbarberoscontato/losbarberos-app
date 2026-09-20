-- Garante a data de competência exigida pelo ledger financeiro nos contratos de projetos.
-- O RPC de contratos foi criado antes de competence_date se tornar NOT NULL e ainda
-- pode receber chamadas de versões antigas do cliente; a regra fica protegida no banco.
create or replace function public.set_project_financial_entry_competence_date()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.source = 'PROJECT' and new.competence_date is null then
    new.competence_date := coalesce(new.issue_date, current_date);
  end if;
  return new;
end;
$$;

drop trigger if exists financial_entries_project_competence_date on public.financial_entries;
create trigger financial_entries_project_competence_date
before insert or update of source, issue_date, competence_date on public.financial_entries
for each row
execute function public.set_project_financial_entry_competence_date();
