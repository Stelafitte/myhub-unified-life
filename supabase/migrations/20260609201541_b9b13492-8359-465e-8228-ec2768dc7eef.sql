CREATE TABLE public.user_ai_settings (
  user_id UUID NOT NULL PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'lovable' CHECK (provider IN ('lovable', 'openai', 'anthropic', 'google')),
  model TEXT NOT NULL DEFAULT 'google/gemini-3-flash-preview',
  use_own_key BOOLEAN NOT NULL DEFAULT FALSE,
  encrypted_api_key TEXT,
  key_iv TEXT,
  key_last4 TEXT,
  key_validated_at TIMESTAMPTZ,
  -- feature toggles
  feat_trash BOOLEAN NOT NULL DEFAULT TRUE,
  feat_classify BOOLEAN NOT NULL DEFAULT TRUE,
  feat_summary BOOLEAN NOT NULL DEFAULT TRUE,
  feat_suggestions BOOLEAN NOT NULL DEFAULT TRUE,
  feat_voice BOOLEAN NOT NULL DEFAULT TRUE,
  feat_assistant BOOLEAN NOT NULL DEFAULT TRUE,
  trash_threshold INT NOT NULL DEFAULT 70 CHECK (trash_threshold BETWEEN 50 AND 95),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_ai_settings TO authenticated;
GRANT ALL ON public.user_ai_settings TO service_role;

ALTER TABLE public.user_ai_settings ENABLE ROW LEVEL SECURITY;

-- L'utilisateur voit/modifie ses préférences SAUF les colonnes chiffrées (gérées côté serveur)
CREATE POLICY "users read own ai settings"
  ON public.user_ai_settings FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "users insert own ai settings"
  ON public.user_ai_settings FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "users update own ai settings"
  ON public.user_ai_settings FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "users delete own ai settings"
  ON public.user_ai_settings FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

CREATE TRIGGER set_user_ai_settings_updated_at
  BEFORE UPDATE ON public.user_ai_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Log des appels IA (pour debug + facturation utilisateur)
CREATE TABLE public.ai_call_log (
  id UUID NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  function TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  used_own_key BOOLEAN NOT NULL DEFAULT FALSE,
  prompt_tokens INT,
  completion_tokens INT,
  total_tokens INT,
  status INT,
  error TEXT,
  duration_ms INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_ai_call_log_user_date ON public.ai_call_log(user_id, created_at DESC);

GRANT SELECT ON public.ai_call_log TO authenticated;
GRANT ALL ON public.ai_call_log TO service_role;

ALTER TABLE public.ai_call_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users read own ai logs"
  ON public.ai_call_log FOR SELECT
  TO authenticated USING (auth.uid() = user_id);