CREATE TABLE public.meeting_settings (
  user_id uuid PRIMARY KEY,
  work_start_time time NOT NULL DEFAULT '08:00',
  work_end_time time NOT NULL DEFAULT '19:00',
  work_days int[] NOT NULL DEFAULT ARRAY[1,2,3,4,5],
  min_lead_hours int NOT NULL DEFAULT 24,
  default_provider text NOT NULL DEFAULT 'meet',
  default_duration_min int NOT NULL DEFAULT 30,
  email_template_invite text NOT NULL DEFAULT 'Bonjour,

Vous êtes invité(e) à la réunion "{{title}}" le {{date}}.

Lien : {{link}}

Cordialement,
{{organizer}}',
  email_template_confirm text NOT NULL DEFAULT 'Bonjour,

La réunion "{{title}}" est confirmée le {{date}}.

Lien : {{link}}

Cordialement,
{{organizer}}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.meeting_settings TO authenticated;
GRANT ALL ON public.meeting_settings TO service_role;

ALTER TABLE public.meeting_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own meeting_settings all" ON public.meeting_settings
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER set_updated_at_meeting_settings
  BEFORE UPDATE ON public.meeting_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();