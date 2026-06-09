CREATE TABLE IF NOT EXISTS public.collab_space_url_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  space_id uuid NOT NULL REFERENCES public.collab_spaces(id) ON DELETE CASCADE,
  title text NOT NULL,
  url text NOT NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_collab_space_url_links_space ON public.collab_space_url_links(space_id);
CREATE INDEX IF NOT EXISTS idx_collab_space_url_links_user ON public.collab_space_url_links(user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.collab_space_url_links TO authenticated;
GRANT ALL ON public.collab_space_url_links TO service_role;

ALTER TABLE public.collab_space_url_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own collab_space_url_links all"
  ON public.collab_space_url_links
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);