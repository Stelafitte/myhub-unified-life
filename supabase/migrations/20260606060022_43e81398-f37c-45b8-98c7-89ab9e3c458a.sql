
CREATE TABLE IF NOT EXISTS public.collab_space_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  space_id uuid NOT NULL REFERENCES public.collab_spaces(id) ON DELETE CASCADE,
  entity_type text NOT NULL CHECK (entity_type IN ('email','task','meeting','document','contact')),
  entity_id uuid NOT NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (space_id, entity_type, entity_id)
);

CREATE INDEX IF NOT EXISTS idx_collab_space_links_space ON public.collab_space_links(space_id, entity_type);
CREATE INDEX IF NOT EXISTS idx_collab_space_links_entity ON public.collab_space_links(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_collab_space_links_user ON public.collab_space_links(user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.collab_space_links TO authenticated;
GRANT ALL ON public.collab_space_links TO service_role;

ALTER TABLE public.collab_space_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own collab_space_links all"
  ON public.collab_space_links
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Realtime for chat
ALTER TABLE public.collab_messages REPLICA IDENTITY FULL;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'collab_messages'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.collab_messages';
  END IF;
END$$;
