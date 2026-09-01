-- Keep enum additions in their own migration. PostgreSQL only permits using an
-- added enum value after this transaction has committed.
alter type public.whatsapp_v2_job_type add value if not exists 'REMINDER_T180_CLIENT';
alter type public.whatsapp_confirmation_phase add value if not exists 'T180';

notify pgrst, 'reload schema';
