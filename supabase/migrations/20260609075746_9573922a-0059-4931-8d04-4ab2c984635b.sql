ALTER TABLE public.emails ADD COLUMN IF NOT EXISTS direction text NOT NULL DEFAULT 'inbound';
CREATE INDEX IF NOT EXISTS idx_emails_user_direction ON public.emails(user_id, direction);

CREATE TABLE IF NOT EXISTS public.trash_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email_id uuid REFERENCES public.emails(id) ON DELETE SET NULL,
  from_address text,
  subject text,
  decision text NOT NULL CHECK (decision IN ('trash','keep')),
  ai_suggested boolean NOT NULL DEFAULT false,
  ai_score integer,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.trash_feedback TO authenticated;
GRANT ALL ON public.trash_feedback TO service_role;
ALTER TABLE public.trash_feedback ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own trash feedback" ON public.trash_feedback FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS idx_trash_feedback_user_created ON public.trash_feedback(user_id, created_at DESC);