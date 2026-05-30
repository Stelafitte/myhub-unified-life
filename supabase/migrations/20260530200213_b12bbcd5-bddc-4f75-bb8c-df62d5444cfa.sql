
-- 1) Deactivate duplicate google_calendar_connections, keep the most recent per (user_id, google_email, calendar_id)
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY user_id, COALESCE(google_email,''), COALESCE(calendar_id,'primary')
           ORDER BY updated_at DESC NULLS LAST, created_at DESC
         ) AS rn
  FROM public.google_calendar_connections
  WHERE is_active = true
)
UPDATE public.google_calendar_connections c
SET is_active = false, updated_at = now()
FROM ranked r
WHERE c.id = r.id AND r.rn > 1;

-- 2) Re-point calendar_events from deactivated duplicate connections to the kept one, then dedupe events
WITH active_conn AS (
  SELECT user_id, COALESCE(google_email,'') AS ge, COALESCE(calendar_id,'primary') AS cid, id AS keep_id
  FROM public.google_calendar_connections
  WHERE is_active = true
),
old_to_new AS (
  SELECT c.id AS old_id, a.keep_id
  FROM public.google_calendar_connections c
  JOIN active_conn a
    ON a.user_id = c.user_id
   AND a.ge = COALESCE(c.google_email,'')
   AND a.cid = COALESCE(c.calendar_id,'primary')
  WHERE c.is_active = false
)
UPDATE public.calendar_events e
SET gcal_connection_id = m.keep_id
FROM old_to_new m
WHERE e.gcal_connection_id = m.old_id;

-- 3) Dedupe calendar_events on (gcal_connection_id, google_event_id), keep the most recently updated
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY gcal_connection_id, google_event_id
           ORDER BY updated_at DESC NULLS LAST, created_at DESC
         ) AS rn
  FROM public.calendar_events
  WHERE gcal_connection_id IS NOT NULL AND google_event_id IS NOT NULL
)
DELETE FROM public.calendar_events e
USING ranked r
WHERE e.id = r.id AND r.rn > 1;

-- 4) Prevent future duplicates
CREATE UNIQUE INDEX IF NOT EXISTS calendar_events_conn_gevent_uniq
  ON public.calendar_events (gcal_connection_id, google_event_id)
  WHERE gcal_connection_id IS NOT NULL AND google_event_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS gcal_connections_active_uniq
  ON public.google_calendar_connections (user_id, google_email, COALESCE(calendar_id, 'primary'))
  WHERE is_active = true;
