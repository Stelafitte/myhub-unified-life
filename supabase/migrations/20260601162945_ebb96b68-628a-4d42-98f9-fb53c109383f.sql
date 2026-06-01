
ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS onedrive_item_id text,
  ADD COLUMN IF NOT EXISTS onedrive_web_url text,
  ADD COLUMN IF NOT EXISTS onedrive_folder_path text,
  ADD COLUMN IF NOT EXISTS saved_at timestamptz;

CREATE INDEX IF NOT EXISTS documents_saved_at_idx ON public.documents (user_id, saved_at DESC NULLS LAST);
