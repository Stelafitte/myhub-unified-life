-- Themes
CREATE TABLE public.op_plan_themes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.op_plan_themes TO authenticated;
GRANT ALL ON public.op_plan_themes TO service_role;

ALTER TABLE public.op_plan_themes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own op_plan_themes all"
ON public.op_plan_themes
FOR ALL
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER op_plan_themes_set_updated_at
BEFORE UPDATE ON public.op_plan_themes
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Subthemes
CREATE TABLE public.op_plan_subthemes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  theme_id uuid NOT NULL REFERENCES public.op_plan_themes(id) ON DELETE CASCADE,
  name text NOT NULL,
  position integer NOT NULL DEFAULT 0,
  items text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.op_plan_subthemes TO authenticated;
GRANT ALL ON public.op_plan_subthemes TO service_role;

ALTER TABLE public.op_plan_subthemes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own op_plan_subthemes all"
ON public.op_plan_subthemes
FOR ALL
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER op_plan_subthemes_set_updated_at
BEFORE UPDATE ON public.op_plan_subthemes
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX idx_op_plan_subthemes_theme ON public.op_plan_subthemes(theme_id);
CREATE INDEX idx_op_plan_themes_user ON public.op_plan_themes(user_id);
CREATE INDEX idx_op_plan_subthemes_user ON public.op_plan_subthemes(user_id);