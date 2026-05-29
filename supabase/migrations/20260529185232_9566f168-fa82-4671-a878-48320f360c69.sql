CREATE TABLE IF NOT EXISTS public.security_settings (
  user_id uuid PRIMARY KEY,
  sensitivity_level text NOT NULL DEFAULT 'normal',
  sensitive_action text NOT NULL DEFAULT 'C',
  whitelist text[] NOT NULL DEFAULT '{}',
  blacklist text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT security_settings_level_chk CHECK (sensitivity_level IN ('strict','normal','permissive')),
  CONSTRAINT security_settings_action_chk CHECK (sensitive_action IN ('A','B','C'))
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.security_settings TO authenticated;
GRANT ALL ON public.security_settings TO service_role;

ALTER TABLE public.security_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own security_settings all"
  ON public.security_settings
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER trg_security_settings_updated_at
  BEFORE UPDATE ON public.security_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();