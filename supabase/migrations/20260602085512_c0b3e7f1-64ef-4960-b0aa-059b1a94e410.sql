ALTER TABLE public.meetings
  ADD COLUMN IF NOT EXISTS confirmed_slot_id uuid,
  ADD COLUMN IF NOT EXISTS confirmed_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS online_provider_default text;