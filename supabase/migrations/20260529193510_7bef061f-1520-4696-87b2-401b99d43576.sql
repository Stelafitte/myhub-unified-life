-- Meetings tables
CREATE TABLE public.meetings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ NOT NULL,
  location TEXT,
  is_online BOOLEAN NOT NULL DEFAULT false,
  online_link TEXT,
  online_provider TEXT,
  zoom_meeting_id TEXT,
  zoom_password TEXT,
  organizer_email TEXT,
  organizer_name TEXT,
  status TEXT NOT NULL DEFAULT 'scheduled',
  calendar_event_id UUID,
  source_email_id UUID,
  notes TEXT,
  decisions TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.meetings TO authenticated;
GRANT ALL ON public.meetings TO service_role;

ALTER TABLE public.meetings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own meetings all" ON public.meetings
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_meetings_user_start ON public.meetings(user_id, start_at DESC);
CREATE INDEX idx_meetings_status ON public.meetings(user_id, status);

CREATE TRIGGER update_meetings_updated_at
  BEFORE UPDATE ON public.meetings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Participants
CREATE TABLE public.meeting_participants (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  meeting_id UUID NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  contact_id UUID,
  email TEXT NOT NULL,
  name TEXT,
  role TEXT NOT NULL DEFAULT 'required',
  rsvp_status TEXT NOT NULL DEFAULT 'pending',
  responded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.meeting_participants TO authenticated;
GRANT ALL ON public.meeting_participants TO service_role;

ALTER TABLE public.meeting_participants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own meeting_participants all" ON public.meeting_participants
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_mp_meeting ON public.meeting_participants(meeting_id);

-- Meeting <-> tasks link
CREATE TABLE public.meeting_tasks (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  meeting_id UUID NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
  task_id UUID NOT NULL,
  user_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(meeting_id, task_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.meeting_tasks TO authenticated;
GRANT ALL ON public.meeting_tasks TO service_role;

ALTER TABLE public.meeting_tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own meeting_tasks all" ON public.meeting_tasks
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_mt_meeting ON public.meeting_tasks(meeting_id);
CREATE INDEX idx_mt_task ON public.meeting_tasks(task_id);