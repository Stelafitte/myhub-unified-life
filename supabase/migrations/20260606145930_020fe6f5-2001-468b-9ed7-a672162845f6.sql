
CREATE TABLE IF NOT EXISTS public.wa_business_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  phone_number_id text NOT NULL,
  wa_business_account_id text NOT NULL,
  access_token text NOT NULL,
  phone_number text NOT NULL,
  display_name text,
  webhook_verify_token text,
  is_active boolean NOT NULL DEFAULT true,
  last_sync_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.wa_business_connections TO authenticated;
GRANT ALL ON public.wa_business_connections TO service_role;
ALTER TABLE public.wa_business_connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner_access" ON public.wa_business_connections FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.wa_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  connection_id uuid NOT NULL REFERENCES public.wa_business_connections(id) ON DELETE CASCADE,
  space_id uuid REFERENCES public.collab_spaces(id) ON DELETE SET NULL,
  wa_group_id text NOT NULL,
  name text NOT NULL,
  description text,
  participant_count integer DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  last_message_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (connection_id, wa_group_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.wa_groups TO authenticated;
GRANT ALL ON public.wa_groups TO service_role;
ALTER TABLE public.wa_groups ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner_access" ON public.wa_groups FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.wa_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  connection_id uuid NOT NULL REFERENCES public.wa_business_connections(id) ON DELETE CASCADE,
  space_id uuid REFERENCES public.collab_spaces(id) ON DELETE SET NULL,
  wa_message_id text NOT NULL UNIQUE,
  from_number text,
  from_name text,
  group_id text,
  group_name text,
  content text,
  type text NOT NULL DEFAULT 'text'
    CHECK (type IN ('text','image','document','audio','video','location','reaction')),
  media_url text,
  media_mime_type text,
  "timestamp" timestamptz NOT NULL,
  is_from_me boolean NOT NULL DEFAULT false,
  status text DEFAULT 'received'
    CHECK (status IN ('received','read','delivered','sent','failed')),
  ai_processed boolean NOT NULL DEFAULT false,
  ai_category text,
  ai_action_suggested text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.wa_messages TO authenticated;
GRANT ALL ON public.wa_messages TO service_role;
ALTER TABLE public.wa_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner_access" ON public.wa_messages FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_wa_messages_space_id ON public.wa_messages(space_id);
CREATE INDEX IF NOT EXISTS idx_wa_messages_group_id ON public.wa_messages(group_id);
CREATE INDEX IF NOT EXISTS idx_wa_messages_timestamp ON public.wa_messages("timestamp" DESC);
CREATE INDEX IF NOT EXISTS idx_wa_groups_connection ON public.wa_groups(connection_id);
CREATE INDEX IF NOT EXISTS idx_wa_business_connections_user ON public.wa_business_connections(user_id);
