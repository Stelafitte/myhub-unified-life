DELETE FROM public.calendar_events a
USING public.calendar_events b
WHERE a.google_event_id IS NOT NULL
  AND a.google_event_id = b.google_event_id
  AND a.user_id = b.user_id
  AND a.ctid > b.ctid;

CREATE UNIQUE INDEX IF NOT EXISTS calendar_events_user_gevent_uniq
  ON public.calendar_events (user_id, google_event_id)
  WHERE google_event_id IS NOT NULL;
