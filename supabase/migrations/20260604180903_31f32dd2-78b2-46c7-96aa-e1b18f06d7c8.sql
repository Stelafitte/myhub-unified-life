UPDATE public.google_calendar_connections
SET category = 'perso', color = '#f97316', label = 'Agenda SL perso premier'
WHERE id = '7788972f-ab08-4856-8216-1339ec3bd1b9';

UPDATE public.calendar_events
SET category = 'perso', color = '#f97316'
WHERE gcal_connection_id = '7788972f-ab08-4856-8216-1339ec3bd1b9';