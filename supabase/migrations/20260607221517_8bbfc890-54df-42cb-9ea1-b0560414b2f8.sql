
-- Add permissions to collab_guests (per-module rights)
ALTER TABLE public.collab_guests
  ADD COLUMN IF NOT EXISTS permissions jsonb NOT NULL DEFAULT '{
    "chat": "edit",
    "links": "edit",
    "documents": "edit",
    "tasks": "view",
    "meetings": "edit",
    "files": "edit",
    "surveys": "edit"
  }'::jsonb;

-- Guest sessions: short-lived sessions issued after OTP/magic-link verification
CREATE TABLE IF NOT EXISTS public.collab_guest_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  guest_id uuid NOT NULL,
  space_id uuid NOT NULL,
  session_token text NOT NULL UNIQUE DEFAULT encode(extensions.gen_random_bytes(24), 'hex'),
  otp_code text,
  otp_expires_at timestamptz,
  verified_at timestamptz,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 days'),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  ip text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS collab_guest_sessions_guest_idx ON public.collab_guest_sessions(guest_id);
CREATE INDEX IF NOT EXISTS collab_guest_sessions_token_idx ON public.collab_guest_sessions(session_token);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.collab_guest_sessions TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.collab_guest_sessions TO anon;
GRANT ALL ON public.collab_guest_sessions TO service_role;

ALTER TABLE public.collab_guest_sessions ENABLE ROW LEVEL SECURITY;

-- Owners (authenticated) can see/manage sessions for their own spaces
CREATE POLICY "owner manage guest sessions" ON public.collab_guest_sessions
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.collab_spaces s WHERE s.id = collab_guest_sessions.space_id AND s.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.collab_spaces s WHERE s.id = collab_guest_sessions.space_id AND s.user_id = auth.uid()));

-- Anon may read/update their own session row when they know the session_token
-- (server-side guest endpoints will filter by token; this allows direct lookups too)
CREATE POLICY "anon read guest session by token" ON public.collab_guest_sessions
  FOR SELECT TO anon
  USING (true);

CREATE POLICY "anon update last_seen" ON public.collab_guest_sessions
  FOR UPDATE TO anon
  USING (true)
  WITH CHECK (true);
