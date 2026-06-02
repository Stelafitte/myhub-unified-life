ALTER TABLE public.meetings
  ADD COLUMN IF NOT EXISTS recurrence_parent_id uuid;

CREATE INDEX IF NOT EXISTS idx_meetings_recurrence_parent
  ON public.meetings(recurrence_parent_id);

CREATE INDEX IF NOT EXISTS idx_meetings_user_start
  ON public.meetings(user_id, start_at);