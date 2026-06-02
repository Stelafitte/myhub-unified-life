
-- Phase 6: Notes history + shared files for meetings

ALTER TABLE public.meetings ADD COLUMN IF NOT EXISTS notes_updated_at timestamptz;

CREATE TABLE IF NOT EXISTS public.meeting_notes_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id uuid NOT NULL,
  user_id uuid NOT NULL,
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.meeting_notes_history TO authenticated;
GRANT ALL ON public.meeting_notes_history TO service_role;

ALTER TABLE public.meeting_notes_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own meeting_notes_history all"
ON public.meeting_notes_history
FOR ALL
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_meeting_notes_history_meeting ON public.meeting_notes_history(meeting_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.meeting_shared_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id uuid NOT NULL,
  document_id uuid NOT NULL,
  user_id uuid NOT NULL,
  share_with_externals boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (meeting_id, document_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.meeting_shared_files TO authenticated;
GRANT ALL ON public.meeting_shared_files TO service_role;
-- Anon read allowed so the public poll page can list shared docs by meeting_id (joined via poll public_token server-side; row only exposes ids + boolean).
GRANT SELECT ON public.meeting_shared_files TO anon;

ALTER TABLE public.meeting_shared_files ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own meeting_shared_files all"
ON public.meeting_shared_files
FOR ALL
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- Public can read only rows explicitly marked share_with_externals = true
CREATE POLICY "public read shared externals"
ON public.meeting_shared_files
FOR SELECT
TO anon
USING (share_with_externals = true);

CREATE INDEX IF NOT EXISTS idx_meeting_shared_files_meeting ON public.meeting_shared_files(meeting_id);
