
ALTER TABLE public.collab_spaces
  ADD COLUMN IF NOT EXISTS join_token text UNIQUE DEFAULT encode(extensions.gen_random_bytes(16), 'hex'),
  ADD COLUMN IF NOT EXISTS join_enabled boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.collab_join_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id uuid NOT NULL REFERENCES public.collab_spaces(id) ON DELETE CASCADE,
  first_name text NOT NULL,
  last_name text NOT NULL,
  email text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  guest_id uuid REFERENCES public.collab_guests(id) ON DELETE SET NULL,
  note text
);

CREATE INDEX IF NOT EXISTS collab_join_requests_space_idx
  ON public.collab_join_requests(space_id, status, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.collab_join_requests TO authenticated;
GRANT ALL ON public.collab_join_requests TO service_role;

ALTER TABLE public.collab_join_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner manages own join requests"
  ON public.collab_join_requests
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.collab_spaces s
      WHERE s.id = collab_join_requests.space_id
        AND s.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.collab_spaces s
      WHERE s.id = collab_join_requests.space_id
        AND s.user_id = auth.uid()
    )
  );

CREATE TRIGGER trg_collab_join_requests_updated
  BEFORE UPDATE ON public.collab_join_requests
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
