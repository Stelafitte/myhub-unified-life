DROP INDEX IF EXISTS public.calendar_events_gcal_conn_event_uniq;

CREATE UNIQUE INDEX calendar_events_gcal_conn_event_uniq
  ON public.calendar_events (gcal_connection_id, google_event_id);
