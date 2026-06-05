ALTER TABLE collab_spaces
  ADD COLUMN IF NOT EXISTS whatsapp_group_id text,
  ADD COLUMN IF NOT EXISTS whatsapp_phone_number text;

CREATE TABLE IF NOT EXISTS collab_wa_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id uuid NOT NULL REFERENCES collab_spaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  filename text NOT NULL,
  raw_content text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'done', 'failed')),
  total_messages integer DEFAULT 0,
  imported_messages integer DEFAULT 0,
  error_message text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON collab_wa_imports TO authenticated;
GRANT ALL ON collab_wa_imports TO service_role;

ALTER TABLE collab_wa_imports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner_access" ON collab_wa_imports FOR ALL USING (auth.uid() = user_id);

CREATE TRIGGER update_collab_wa_imports_updated_at
BEFORE UPDATE ON collab_wa_imports
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();