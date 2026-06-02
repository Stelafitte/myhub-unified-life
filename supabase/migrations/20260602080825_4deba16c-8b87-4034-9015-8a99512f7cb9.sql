ALTER TABLE public.meetings
  ADD COLUMN IF NOT EXISTS onenote_page_id text,
  ADD COLUMN IF NOT EXISTS recurrence_rule text,
  ADD COLUMN IF NOT EXISTS quorum_minimum integer,
  ADD COLUMN IF NOT EXISTS room text,
  ADD COLUMN IF NOT EXISTS session_number integer;