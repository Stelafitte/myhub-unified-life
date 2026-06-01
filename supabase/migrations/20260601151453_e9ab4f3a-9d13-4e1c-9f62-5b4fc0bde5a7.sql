-- Add utility_level and scope to email_themes
ALTER TABLE public.email_themes
  ADD COLUMN IF NOT EXISTS utility_level text NOT NULL DEFAULT 'modere',
  ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'perso';

ALTER TABLE public.email_themes
  DROP CONSTRAINT IF EXISTS email_themes_utility_level_check;
ALTER TABLE public.email_themes
  ADD CONSTRAINT email_themes_utility_level_check
  CHECK (utility_level IN ('faible','modere','fort'));

ALTER TABLE public.email_themes
  DROP CONSTRAINT IF EXISTS email_themes_scope_check;
ALTER TABLE public.email_themes
  ADD CONSTRAINT email_themes_scope_check
  CHECK (scope IN ('pro','perso'));

CREATE INDEX IF NOT EXISTS email_themes_scope_idx ON public.email_themes(user_id, scope);
CREATE INDEX IF NOT EXISTS email_themes_utility_idx ON public.email_themes(user_id, utility_level);