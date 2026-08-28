-- Profile photos stay public only for client booking cards. Every write is restricted
-- to the owning organization and the target barber belongs to that organization.
alter table public.barbers
  add column commission_payment_frequency text not null default 'PER_SERVICE'
    check (commission_payment_frequency in ('PER_SERVICE', 'WEEKLY', 'BIWEEKLY', 'MONTHLY')),
  add column commission_payment_weekday smallint,
  add column commission_payment_first_day smallint,
  add column commission_payment_second_day smallint;

alter table public.barbers
  add constraint barbers_commission_payment_schedule_valid check (
    (commission_payment_frequency = 'PER_SERVICE'
      and commission_payment_weekday is null
      and commission_payment_first_day is null
      and commission_payment_second_day is null)
    or (commission_payment_frequency = 'WEEKLY'
      and commission_payment_weekday between 1 and 7
      and commission_payment_first_day is null
      and commission_payment_second_day is null)
    or (commission_payment_frequency = 'BIWEEKLY'
      and commission_payment_weekday is null
      and commission_payment_first_day between 1 and 31
      and commission_payment_second_day between 1 and 31
      and commission_payment_first_day <> commission_payment_second_day)
    or (commission_payment_frequency = 'MONTHLY'
      and commission_payment_weekday is null
      and commission_payment_first_day between 1 and 31
      and commission_payment_second_day is null)
  );

comment on column public.barbers.avatar_url is 'URL pública da foto de perfil 320x320 do profissional no bucket barber-avatars.';
comment on column public.barbers.commission_payment_frequency is 'Frequência informativa de pagamento da comissão do profissional; não liquida ledger automaticamente.';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('barber-avatars', 'barber-avatars', true, 2097152, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy barber_avatars_public_read
  on storage.objects for select to public
  using (bucket_id = 'barber-avatars');

create policy barber_avatars_owner_insert
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'barber-avatars'
    and (storage.foldername(name))[1] ~* '^[0-9a-f-]{36}$'
    and (storage.foldername(name))[2] ~* '^[0-9a-f-]{36}$'
    and public.is_organization_owner((storage.foldername(name))[1]::uuid)
    and exists (
      select 1
      from public.barbers b
      where b.organization_id = (storage.foldername(name))[1]::uuid
        and b.id = (storage.foldername(name))[2]::uuid
    )
  );

create policy barber_avatars_owner_delete
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'barber-avatars'
    and (storage.foldername(name))[1] ~* '^[0-9a-f-]{36}$'
    and public.is_organization_owner((storage.foldername(name))[1]::uuid)
  );
