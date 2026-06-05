
-- Tombstones to prevent re-sync from Google
INSERT INTO public.deleted_calendar_events (user_id, gcal_connection_id, google_event_id)
SELECT user_id, gcal_connection_id, google_event_id
FROM public.calendar_events
WHERE title ILIKE '%kine%'
  AND google_event_id IS NOT NULL
  AND gcal_connection_id IS NOT NULL
ON CONFLICT (gcal_connection_id, google_event_id) DO NOTHING;

-- Delete the events locally
DELETE FROM public.calendar_events WHERE title ILIKE '%kine%';
