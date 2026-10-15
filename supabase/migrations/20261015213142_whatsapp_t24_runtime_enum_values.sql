-- Keep enum additions in a separate migration so later functions can safely
-- reference the new values after this migration commits.
alter type public.whatsapp_v2_job_type
  add value if not exists 'REMINDER_T24_CLIENT';

alter type public.whatsapp_confirmation_phase
  add value if not exists 'T24';
