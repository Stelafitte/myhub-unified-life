CREATE TABLE IF NOT EXISTS public.outlook_connections (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  label TEXT NOT NULL DEFAULT 'Outlook',
  outlook_email TEXT,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  category TEXT NOT NULL DEFAULT 'pro',
  sync_direction TEXT NOT NULL DEFAULT 'bidirectional',
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_sync_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS outlook_connections_user_id_idx ON public.outlook_connections(user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.outlook_connections TO authenticated;
GRANT ALL ON public.outlook_connections TO service_role;

ALTER TABLE public.outlook_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own outlook connections"
ON public.outlook_connections
FOR ALL
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER update_outlook_connections_updated_at
BEFORE UPDATE ON public.outlook_connections
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();