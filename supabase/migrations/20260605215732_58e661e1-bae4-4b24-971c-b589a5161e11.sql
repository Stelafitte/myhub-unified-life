
CREATE TABLE IF NOT EXISTS public.wa_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  space_id uuid NOT NULL REFERENCES public.collab_spaces(id) ON DELETE CASCADE,
  wa_import_id uuid REFERENCES public.collab_wa_imports(id) ON DELETE SET NULL,
  message_id uuid,
  kind text NOT NULL CHECK (kind IN ('action','meeting','decision')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  title text NOT NULL,
  description text,
  priority text,
  due_at timestamptz,
  meeting_start_at timestamptz,
  meeting_end_at timestamptz,
  source_sender text,
  source_text text,
  source_message_at timestamptz,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_task_id uuid,
  created_event_id uuid,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.wa_suggestions TO authenticated;
GRANT ALL ON public.wa_suggestions TO service_role;

ALTER TABLE public.wa_suggestions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own wa_suggestions all" ON public.wa_suggestions
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS wa_suggestions_user_status_idx
  ON public.wa_suggestions (user_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS wa_suggestions_space_idx
  ON public.wa_suggestions (space_id, status);

CREATE TRIGGER wa_suggestions_set_updated_at
  BEFORE UPDATE ON public.wa_suggestions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
