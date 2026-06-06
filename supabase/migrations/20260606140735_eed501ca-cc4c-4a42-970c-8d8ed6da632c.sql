-- collab_contact_groups already has space_id, is_smart, smart_rules — ensure defaults are correct
ALTER TABLE public.collab_contact_groups
  ALTER COLUMN smart_rules SET DEFAULT '{}'::jsonb;

-- contact_group_members already exists — add missing constraints idempotently
DO $$
BEGIN
  -- UNIQUE(group_id, contact_id)
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'contact_group_members_group_contact_unique'
  ) THEN
    ALTER TABLE public.contact_group_members
      ADD CONSTRAINT contact_group_members_group_contact_unique
      UNIQUE (group_id, contact_id);
  END IF;

  -- CHECK contact_id IS NOT NULL OR external_email IS NOT NULL
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'contact_group_members_target_check'
  ) THEN
    ALTER TABLE public.contact_group_members
      ADD CONSTRAINT contact_group_members_target_check
      CHECK (contact_id IS NOT NULL OR external_email IS NOT NULL);
  END IF;

  -- CHECK added_by IN allowed set
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'contact_group_members_added_by_check'
  ) THEN
    ALTER TABLE public.contact_group_members
      ADD CONSTRAINT contact_group_members_added_by_check
      CHECK (added_by IN ('manual', 'ai', 'space', 'whatsapp'));
  END IF;
END $$;

-- Ensure grants for contact_group_members (RLS already enabled with owner_access policy)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.contact_group_members TO authenticated;
GRANT ALL ON public.contact_group_members TO service_role;