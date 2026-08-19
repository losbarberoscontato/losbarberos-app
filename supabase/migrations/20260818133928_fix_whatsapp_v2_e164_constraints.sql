-- The v2 initial migration escaped the leading plus twice. PostgreSQL then
-- expected a literal backslash before every E.164 phone and rejected valid rows.
alter table public.whatsapp_automation_jobs
  drop constraint if exists whatsapp_automation_jobs_recipient_e164_check,
  add constraint whatsapp_automation_jobs_recipient_e164_check
    check (recipient_e164 ~ '^\+[1-9][0-9]{7,14}$');

alter table public.whatsapp_contacts_v2
  drop constraint if exists whatsapp_contacts_v2_phone_e164_check,
  add constraint whatsapp_contacts_v2_phone_e164_check
    check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$');
