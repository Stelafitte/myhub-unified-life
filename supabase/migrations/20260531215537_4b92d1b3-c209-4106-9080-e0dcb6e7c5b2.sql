CREATE TABLE public.folder_routing_history (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  provider TEXT NOT NULL DEFAULT 'onedrive',
  folder_id TEXT,
  folder_path TEXT NOT NULL,
  filename TEXT,
  mime_type TEXT,
  from_address TEXT,
  subject TEXT,
  theme_id UUID,
  theme_name TEXT,
  ai_suggested BOOLEAN NOT NULL DEFAULT false,
  ai_score INTEGER,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_frh_user_path ON public.folder_routing_history(user_id, folder_path);
CREATE INDEX idx_frh_user_theme ON public.folder_routing_history(user_id, theme_id);
CREATE INDEX idx_frh_user_from ON public.folder_routing_history(user_id, from_address);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.folder_routing_history TO authenticated;
GRANT ALL ON public.folder_routing_history TO service_role;

ALTER TABLE public.folder_routing_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own folder_routing_history all"
ON public.folder_routing_history
FOR ALL
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);
