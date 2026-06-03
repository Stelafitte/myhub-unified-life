ALTER TABLE public.google_calendar_connections
  ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'pro',
  ADD COLUMN IF NOT EXISTS color text;

UPDATE public.google_calendar_connections
  SET category = 'pro', color = COALESCE(color, '#6366f1')
  WHERE category IS NULL OR category = 'pro';