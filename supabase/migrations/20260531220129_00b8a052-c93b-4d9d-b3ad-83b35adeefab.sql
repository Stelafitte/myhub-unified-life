CREATE TABLE public.deleted_calendar_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  gcal_connection_id UUID NOT NULL,
  google_event_id TEXT NOT NULL,
  deleted_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE (gcal_connection_id, google_event_id)
);

CREATE INDEX idx_dce_user ON public.deleted_calendar_events(user_id);
CREATE INDEX idx_dce_conn ON public.deleted_calendar_events(gcal_connection_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.deleted_calendar_events TO authenticated;
GRANT ALL ON public.deleted_calendar_events TO service_role;

ALTER TABLE public.deleted_calendar_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own deleted_calendar_events all"
ON public.deleted_calendar_events
FOR ALL
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);
