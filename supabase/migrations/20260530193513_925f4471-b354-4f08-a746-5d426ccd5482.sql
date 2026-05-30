ALTER TABLE public.emails
  ADD COLUMN IF NOT EXISTS spam_label text,
  ADD COLUMN IF NOT EXISTS spam_score integer,
  ADD COLUMN IF NOT EXISTS spam_reason text;

CREATE INDEX IF NOT EXISTS idx_emails_spam_label ON public.emails(user_id, spam_label) WHERE spam_label IS NOT NULL;