-- 1) Dédupliquer par google_event_id (toutes connexions confondues)
DELETE FROM public.calendar_events a
USING public.calendar_events b
WHERE a.google_event_id IS NOT NULL
  AND a.google_event_id = b.google_event_id
  AND a.user_id = b.user_id
  AND a.created_at > b.created_at;

-- 2) Dédupliquer le reste par (user_id, title, start_at, end_at)
DELETE FROM public.calendar_events a
USING public.calendar_events b
WHERE a.user_id = b.user_id
  AND a.title = b.title
  AND a.start_at = b.start_at
  AND a.end_at = b.end_at
  AND a.created_at > b.created_at;
