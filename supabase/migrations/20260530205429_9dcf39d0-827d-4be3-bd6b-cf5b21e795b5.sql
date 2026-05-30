-- Deduplicate any existing rows before adding unique constraint
DELETE FROM public.calendar_events a
USING public.calendar_events b
WHERE a.ctid < b.ctid
  AND a.gcal_connection_id IS NOT NULL
  AND a.google_event_id IS NOT NULL
  AND a.gcal_connection_id = b.gcal_connection_id
  AND a.google_event_id = b.google_event_id;

CREATE UNIQUE INDEX IF NOT EXISTS calendar_events_gcal_conn_event_uniq
  ON public.calendar_events (gcal_connection_id, google_event_id)
  WHERE gcal_connection_id IS NOT NULL AND google_event_id IS NOT NULL;
