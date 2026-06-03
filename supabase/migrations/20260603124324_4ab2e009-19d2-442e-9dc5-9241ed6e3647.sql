CREATE UNIQUE INDEX IF NOT EXISTS calendar_events_account_external_uniq
  ON public.calendar_events (account_id, external_id)
  WHERE account_id IS NOT NULL AND external_id IS NOT NULL;