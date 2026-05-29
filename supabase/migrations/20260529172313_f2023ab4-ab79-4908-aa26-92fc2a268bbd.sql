ALTER TABLE public.emails
  ADD COLUMN IF NOT EXISTS ai_priority text,
  ADD COLUMN IF NOT EXISTS ai_category text,
  ADD COLUMN IF NOT EXISTS ai_summary text,
  ADD COLUMN IF NOT EXISTS ai_processed_at timestamptz;

CREATE INDEX IF NOT EXISTS emails_ai_pending_idx
  ON public.emails (user_id, received_at DESC)
  WHERE ai_processed_at IS NULL;