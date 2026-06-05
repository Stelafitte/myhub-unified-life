
CREATE TABLE public.collab_spaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL,
  description text,
  type text NOT NULL DEFAULT 'project',
  icon text,
  color text,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.collab_spaces TO authenticated;
GRANT ALL ON public.collab_spaces TO service_role;

ALTER TABLE public.collab_spaces ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own collab_spaces all"
  ON public.collab_spaces
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER set_collab_spaces_updated_at
  BEFORE UPDATE ON public.collab_spaces
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX idx_collab_spaces_user ON public.collab_spaces(user_id, created_at DESC);
