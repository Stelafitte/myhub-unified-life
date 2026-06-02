-- Phase 11: equipment, RSVP reminders config, equipment presets
ALTER TABLE public.meetings
  ADD COLUMN IF NOT EXISTS equipment text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS rsvp_reminder_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS rsvp_reminder_hours_before int NOT NULL DEFAULT 24;

ALTER TABLE public.meeting_settings
  ADD COLUMN IF NOT EXISTS rsvp_reminders_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS rsvp_reminder_hours_before int NOT NULL DEFAULT 24;

CREATE TABLE IF NOT EXISTS public.meeting_equipment_presets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  label text NOT NULL,
  icon text,
  position int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.meeting_equipment_presets TO authenticated;
GRANT ALL ON public.meeting_equipment_presets TO service_role;

ALTER TABLE public.meeting_equipment_presets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own meeting_equipment_presets all"
ON public.meeting_equipment_presets
FOR ALL
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_meeting_equipment_presets_user
  ON public.meeting_equipment_presets(user_id, position);

CREATE INDEX IF NOT EXISTS idx_meetings_rsvp_reminder_pending
  ON public.meetings(start_at)
  WHERE rsvp_reminder_sent_at IS NULL AND status != 'cancelled';