-- Mantém o perfil pessoal do Barbeiro acessível sem conceder acesso operacional a uma organização.
alter table public.profiles
  add column if not exists bio text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('profile-avatars', 'profile-avatars', true, 2097152, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists profiles_self_insert on public.profiles;
create policy profiles_self_insert on public.profiles
  for insert to authenticated
  with check (id = (select auth.uid()));

grant update (bio) on public.profiles to authenticated;

drop policy if exists profile_avatars_public_read on storage.objects;
drop policy if exists profile_avatars_self_insert on storage.objects;
drop policy if exists profile_avatars_self_update on storage.objects;
drop policy if exists profile_avatars_self_delete on storage.objects;

create policy profile_avatars_public_read on storage.objects
  for select to public
  using (bucket_id = 'profile-avatars');

create policy profile_avatars_self_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'profile-avatars'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );

create policy profile_avatars_self_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'profile-avatars'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  )
  with check (
    bucket_id = 'profile-avatars'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );

create policy profile_avatars_self_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'profile-avatars'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );
