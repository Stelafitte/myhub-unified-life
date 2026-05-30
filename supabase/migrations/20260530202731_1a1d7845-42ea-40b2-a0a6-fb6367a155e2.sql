ALTER TABLE public.emails ADD COLUMN IF NOT EXISTS meeting_link TEXT;
CREATE INDEX IF NOT EXISTS idx_emails_meeting_link ON public.emails(user_id) WHERE meeting_link IS NOT NULL;