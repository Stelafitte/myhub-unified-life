-- Themes table: dynamic list of business themes per user
CREATE TABLE public.email_themes (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  name text NOT NULL,
  description text,
  keywords text[] NOT NULL DEFAULT '{}',
  source text NOT NULL DEFAULT 'ai', -- 'ai' | 'onedrive' | 'manual'
  icon text,
  archived_at timestamptz,
  email_count integer NOT NULL DEFAULT 0,
  last_email_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, name)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.email_themes TO authenticated;
GRANT ALL ON public.email_themes TO service_role;

ALTER TABLE public.email_themes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own email_themes all" ON public.email_themes
  FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER trg_email_themes_updated_at
  BEFORE UPDATE ON public.email_themes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Sender → theme memory (instant override, zero-AI)
CREATE TABLE public.sender_theme_map (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  from_address text NOT NULL,
  theme_id uuid NOT NULL REFERENCES public.email_themes(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, from_address)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.sender_theme_map TO authenticated;
GRANT ALL ON public.sender_theme_map TO service_role;

ALTER TABLE public.sender_theme_map ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own sender_theme_map all" ON public.sender_theme_map
  FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_sender_theme_map_user_from ON public.sender_theme_map(user_id, from_address);

-- Add theme reference on emails
ALTER TABLE public.emails
  ADD COLUMN ai_theme_id uuid REFERENCES public.email_themes(id) ON DELETE SET NULL,
  ADD COLUMN theme_processed_at timestamptz;

CREATE INDEX idx_emails_user_theme ON public.emails(user_id, ai_theme_id);
CREATE INDEX idx_emails_theme_pending ON public.emails(user_id, theme_processed_at) WHERE theme_processed_at IS NULL;