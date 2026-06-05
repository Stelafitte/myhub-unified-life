-- 1) Add 'whatsapp' to task_source enum
ALTER TYPE public.task_source ADD VALUE IF NOT EXISTS 'whatsapp';

-- 2) Create collab_messages table
CREATE TABLE IF NOT EXISTS public.collab_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id uuid NOT NULL REFERENCES public.collab_spaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  content text NOT NULL DEFAULT '',
  type text NOT NULL DEFAULT 'text',
  sender_name text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  message_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS collab_messages_space_idx
  ON public.collab_messages (space_id, message_at DESC);

-- Dedup index: same space + same timestamp + same sender = same message
CREATE UNIQUE INDEX IF NOT EXISTS collab_messages_dedup_idx
  ON public.collab_messages (space_id, message_at, sender_name);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.collab_messages TO authenticated;
GRANT ALL ON public.collab_messages TO service_role;

ALTER TABLE public.collab_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own collab_messages all"
  ON public.collab_messages
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER set_collab_messages_updated_at
  BEFORE UPDATE ON public.collab_messages
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();