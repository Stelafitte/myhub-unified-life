ALTER TABLE public.emails
  ADD COLUMN IF NOT EXISTS is_sensitive boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS sensitive_reason text,
  ADD COLUMN IF NOT EXISTS sensitive_score integer;

CREATE INDEX IF NOT EXISTS idx_emails_user_sensitive ON public.emails (user_id, is_sensitive);

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS hds_notice_accepted_at timestamptz;