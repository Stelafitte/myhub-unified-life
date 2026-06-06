
CREATE TABLE public.icloud_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  label text NOT NULL DEFAULT 'iCloud',
  apple_id text NOT NULL,
  app_password_encrypted text NOT NULL,
  app_password_iv text NOT NULL,
  app_password_tag text NOT NULL,
  carddav_principal_url text,
  carddav_addressbook_url text,
  category text NOT NULL DEFAULT 'perso',
  sync_direction text NOT NULL DEFAULT 'bidirectional',
  is_active boolean NOT NULL DEFAULT true,
  last_sync_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX icloud_connections_user_id_idx ON public.icloud_connections(user_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.icloud_connections TO authenticated;
GRANT ALL ON public.icloud_connections TO service_role;
ALTER TABLE public.icloud_connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage their own icloud connections"
  ON public.icloud_connections FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER set_icloud_connections_updated_at
  BEFORE UPDATE ON public.icloud_connections
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
