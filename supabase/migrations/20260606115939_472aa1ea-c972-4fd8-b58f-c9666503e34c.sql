
ALTER TABLE public.collab_guests
  ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'viewer',
  ADD COLUMN IF NOT EXISTS access_token text NOT NULL DEFAULT encode(extensions.gen_random_bytes(16), 'hex');

ALTER TABLE public.collab_guests
  ADD CONSTRAINT collab_guests_role_check CHECK (role IN ('viewer', 'contributor'));

CREATE UNIQUE INDEX IF NOT EXISTS collab_guests_access_token_uidx ON public.collab_guests(access_token);
CREATE INDEX IF NOT EXISTS collab_guests_space_idx ON public.collab_guests(space_id);

GRANT SELECT ON public.collab_guests TO anon;

CREATE POLICY "public read collab_guests by access_token"
  ON public.collab_guests
  FOR SELECT
  TO anon
  USING (true);
