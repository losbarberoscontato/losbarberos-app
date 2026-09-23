-- Preserve the original profile and email-confirmation invariants while
-- keeping the optional CPF/CNPJ field.
create or replace function public.upsert_my_client_account(
  p_full_name text,
  p_phone_e164 text,
  p_birth_date date,
  p_terms_policy_version text,
  p_cpf_cnpj text default null
)
returns uuid
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_account_id uuid;
begin
  if v_user_id is null then
    raise exception using errcode = '28000', message = 'authentication required';
  end if;

  if not exists (
    select 1 from auth.users u
    where u.id = v_user_id and u.email_confirmed_at is not null
  ) then
    raise exception using errcode = '42501', message = 'email confirmation required';
  end if;

  if nullif(btrim(p_full_name), '') is null
     or nullif(btrim(p_terms_policy_version), '') is null
     or p_phone_e164 !~ '^[+][1-9][0-9]{7,14}$' then
    raise exception using errcode = '22023', message = 'invalid client account profile';
  end if;

  if p_cpf_cnpj is not null
     and p_cpf_cnpj !~ '^[0-9]{11}$'
     and p_cpf_cnpj !~ '^[0-9]{14}$' then
    raise exception using errcode = '22023', message = 'invalid cpf or cnpj';
  end if;

  insert into public.client_accounts (
    auth_user_id, full_name, phone_e164, birth_date, cpf_cnpj,
    terms_policy_version, terms_accepted_at
  ) values (
    v_user_id, btrim(p_full_name), p_phone_e164, p_birth_date,
    nullif(p_cpf_cnpj, ''), btrim(p_terms_policy_version), now()
  )
  on conflict (auth_user_id) do update set
    full_name = excluded.full_name,
    phone_e164 = excluded.phone_e164,
    birth_date = excluded.birth_date,
    cpf_cnpj = excluded.cpf_cnpj,
    terms_policy_version = excluded.terms_policy_version,
    terms_accepted_at = case
      when public.client_accounts.terms_policy_version
        is distinct from excluded.terms_policy_version then now()
      else public.client_accounts.terms_accepted_at
    end
  returning auth_user_id into v_account_id;

  return v_account_id;
end;
$$;
