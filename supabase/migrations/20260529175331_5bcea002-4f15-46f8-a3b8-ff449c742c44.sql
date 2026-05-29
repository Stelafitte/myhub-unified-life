
CREATE TABLE public.ai_feedback (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  email_id UUID NOT NULL,
  from_address TEXT,
  subject TEXT,
  original_priority TEXT,
  corrected_priority TEXT,
  original_category TEXT,
  corrected_category TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_feedback TO authenticated;
GRANT ALL ON public.ai_feedback TO service_role;

ALTER TABLE public.ai_feedback ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own ai_feedback all"
ON public.ai_feedback
FOR ALL
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE INDEX ai_feedback_user_recent_idx
ON public.ai_feedback (user_id, created_at DESC);
