ALTER TABLE public.collab_spaces
  ADD COLUMN IF NOT EXISTS lifecycle_status text NOT NULL DEFAULT 'active';

ALTER TABLE public.collab_spaces
  DROP CONSTRAINT IF EXISTS collab_spaces_lifecycle_status_check;

ALTER TABLE public.collab_spaces
  ADD CONSTRAINT collab_spaces_lifecycle_status_check
  CHECK (lifecycle_status IN ('construction','active','done','archived'));

UPDATE public.collab_spaces
  SET lifecycle_status = 'archived'
  WHERE archived_at IS NOT NULL AND lifecycle_status = 'active';