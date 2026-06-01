
ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS ai_category text,
  ADD COLUMN IF NOT EXISTS ai_summary text,
  ADD COLUMN IF NOT EXISTS ai_priority text,
  ADD COLUMN IF NOT EXISTS ai_processed_at timestamptz,
  ADD COLUMN IF NOT EXISTS ai_skipped_reason text;

ALTER TABLE public.document_retention_settings
  ADD COLUMN IF NOT EXISTS ai_min_size_kb integer NOT NULL DEFAULT 30;

CREATE INDEX IF NOT EXISTS idx_documents_ai_processed ON public.documents(user_id, ai_processed_at);
