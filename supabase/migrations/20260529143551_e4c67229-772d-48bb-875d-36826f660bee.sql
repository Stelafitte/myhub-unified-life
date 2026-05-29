ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS comments text,
  ADD COLUMN IF NOT EXISTS attachments jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS calendar_event_id uuid;