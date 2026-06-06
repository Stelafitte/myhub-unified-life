ALTER TABLE public.calendar_events
  ADD COLUMN IF NOT EXISTS outlook_event_id TEXT,
  ADD COLUMN IF NOT EXISTS outlook_connection_id UUID REFERENCES public.outlook_connections(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS calendar_events_outlook_conn_event_uniq
  ON public.calendar_events(outlook_connection_id, outlook_event_id)
  WHERE outlook_connection_id IS NOT NULL AND outlook_event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_calendar_events_outlook
  ON public.calendar_events(outlook_connection_id, outlook_event_id);