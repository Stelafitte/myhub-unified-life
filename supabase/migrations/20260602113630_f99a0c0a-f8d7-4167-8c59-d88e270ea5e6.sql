ALTER TABLE public.meetings 
  ADD COLUMN IF NOT EXISTS onenote_page_url text,
  ADD COLUMN IF NOT EXISTS onenote_synced_at timestamptz;

ALTER TABLE public.meeting_settings
  ADD COLUMN IF NOT EXISTS onenote_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS onenote_notebook_id text,
  ADD COLUMN IF NOT EXISTS onenote_section_id text,
  ADD COLUMN IF NOT EXISTS onenote_auto_sync boolean NOT NULL DEFAULT false;