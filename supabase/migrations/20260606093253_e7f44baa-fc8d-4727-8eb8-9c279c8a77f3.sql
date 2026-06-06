
-- 1) Add public token / flag to collab_spaces
ALTER TABLE public.collab_spaces
  ADD COLUMN IF NOT EXISTS public_token TEXT UNIQUE DEFAULT encode(extensions.gen_random_bytes(16), 'hex'),
  ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS public_description TEXT;

-- Allow anon to read public spaces by token
DROP POLICY IF EXISTS "public read collab_spaces by token" ON public.collab_spaces;
CREATE POLICY "public read collab_spaces by token"
  ON public.collab_spaces FOR SELECT TO anon
  USING (is_public = true);
GRANT SELECT ON public.collab_spaces TO anon;

-- 2) collab_guests
CREATE TABLE IF NOT EXISTS public.collab_guests (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  space_id UUID NOT NULL REFERENCES public.collab_spaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  status TEXT NOT NULL DEFAULT 'invited',
  last_active_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.collab_guests TO authenticated;
GRANT ALL ON public.collab_guests TO service_role;
ALTER TABLE public.collab_guests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own collab_guests all" ON public.collab_guests
  FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS collab_guests_space_idx ON public.collab_guests(space_id);

-- 3) collab_surveys
CREATE TABLE IF NOT EXISTS public.collab_surveys (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  space_id UUID NOT NULL REFERENCES public.collab_spaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  public_token TEXT NOT NULL UNIQUE DEFAULT encode(extensions.gen_random_bytes(16), 'hex'),
  status TEXT NOT NULL DEFAULT 'open',
  deadline TIMESTAMPTZ,
  allow_anonymous BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.collab_surveys TO authenticated;
GRANT ALL ON public.collab_surveys TO service_role;
GRANT SELECT ON public.collab_surveys TO anon;
ALTER TABLE public.collab_surveys ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own collab_surveys all" ON public.collab_surveys
  FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "public read collab_surveys by token" ON public.collab_surveys
  FOR SELECT TO anon USING (true);
CREATE INDEX IF NOT EXISTS collab_surveys_space_idx ON public.collab_surveys(space_id);

-- 4) collab_survey_questions
CREATE TABLE IF NOT EXISTS public.collab_survey_questions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  survey_id UUID NOT NULL REFERENCES public.collab_surveys(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'text',
  options JSONB NOT NULL DEFAULT '[]'::jsonb,
  required BOOLEAN NOT NULL DEFAULT false,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.collab_survey_questions TO authenticated;
GRANT ALL ON public.collab_survey_questions TO service_role;
GRANT SELECT ON public.collab_survey_questions TO anon;
ALTER TABLE public.collab_survey_questions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own collab_survey_questions all" ON public.collab_survey_questions
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.collab_surveys s WHERE s.id = survey_id AND s.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.collab_surveys s WHERE s.id = survey_id AND s.user_id = auth.uid()));
CREATE POLICY "public read collab_survey_questions" ON public.collab_survey_questions
  FOR SELECT TO anon USING (true);
CREATE INDEX IF NOT EXISTS collab_survey_questions_survey_idx ON public.collab_survey_questions(survey_id);

-- 5) collab_survey_responses
CREATE TABLE IF NOT EXISTS public.collab_survey_responses (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  survey_id UUID NOT NULL REFERENCES public.collab_surveys(id) ON DELETE CASCADE,
  guest_id UUID REFERENCES public.collab_guests(id) ON DELETE SET NULL,
  respondent_name TEXT,
  respondent_email TEXT,
  answers JSONB NOT NULL DEFAULT '{}'::jsonb,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.collab_survey_responses TO authenticated;
GRANT ALL ON public.collab_survey_responses TO service_role;
GRANT INSERT ON public.collab_survey_responses TO anon;
ALTER TABLE public.collab_survey_responses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner read collab_survey_responses" ON public.collab_survey_responses
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.collab_surveys s WHERE s.id = survey_id AND s.user_id = auth.uid()));
CREATE POLICY "owner manage collab_survey_responses" ON public.collab_survey_responses
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.collab_surveys s WHERE s.id = survey_id AND s.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.collab_surveys s WHERE s.id = survey_id AND s.user_id = auth.uid()));
CREATE POLICY "public insert collab_survey_responses" ON public.collab_survey_responses
  FOR INSERT TO anon WITH CHECK (true);
CREATE INDEX IF NOT EXISTS collab_survey_responses_survey_idx ON public.collab_survey_responses(survey_id);

-- updated_at triggers
CREATE TRIGGER trg_collab_guests_updated
  BEFORE UPDATE ON public.collab_guests
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_collab_surveys_updated
  BEFORE UPDATE ON public.collab_surveys
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Backfill public_token for existing spaces
UPDATE public.collab_spaces SET public_token = encode(extensions.gen_random_bytes(16), 'hex')
  WHERE public_token IS NULL;
