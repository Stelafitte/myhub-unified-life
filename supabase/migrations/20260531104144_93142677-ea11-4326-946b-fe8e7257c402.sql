ALTER TABLE public.emails ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_emails_user_deleted ON public.emails(user_id, deleted_at) WHERE deleted_at IS NOT NULL;