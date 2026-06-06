-- 1) Table principale: collab_contact_groups
CREATE TABLE IF NOT EXISTS public.collab_contact_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL,
  description text,
  group_type text NOT NULL DEFAULT 'manual' CHECK (group_type IN ('manual','smart','space','whatsapp')),
  source text NOT NULL DEFAULT 'user' CHECK (source IN ('user','ai','whatsapp','space')),
  color text,
  icon text,
  space_id uuid REFERENCES public.collab_spaces(id) ON DELETE SET NULL,
  is_smart boolean NOT NULL DEFAULT false,
  smart_rules jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_synced_at timestamptz,
  member_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.collab_contact_groups TO authenticated;
GRANT ALL ON public.collab_contact_groups TO service_role;

ALTER TABLE public.collab_contact_groups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own collab_contact_groups all" ON public.collab_contact_groups;
CREATE POLICY "own collab_contact_groups all" ON public.collab_contact_groups
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_collab_contact_groups_user ON public.collab_contact_groups(user_id);
CREATE INDEX IF NOT EXISTS idx_collab_contact_groups_space ON public.collab_contact_groups(space_id);

DROP TRIGGER IF EXISTS trg_collab_contact_groups_updated_at ON public.collab_contact_groups;
CREATE TRIGGER trg_collab_contact_groups_updated_at
  BEFORE UPDATE ON public.collab_contact_groups
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 2) Table de liaison: contact_group_members
CREATE TABLE IF NOT EXISTS public.contact_group_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.collab_contact_groups(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES public.contacts(id) ON DELETE CASCADE,
  external_email text,
  external_name text,
  added_by text NOT NULL DEFAULT 'manual' CHECK (added_by IN ('manual','ai','space','whatsapp')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(group_id, contact_id),
  CHECK (contact_id IS NOT NULL OR external_email IS NOT NULL)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.contact_group_members TO authenticated;
GRANT ALL ON public.contact_group_members TO service_role;

ALTER TABLE public.contact_group_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "owner_access" ON public.contact_group_members;
CREATE POLICY "owner_access" ON public.contact_group_members
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.collab_contact_groups g
      WHERE g.id = contact_group_members.group_id AND g.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.collab_contact_groups g
      WHERE g.id = contact_group_members.group_id AND g.user_id = auth.uid()
    )
  );

CREATE INDEX IF NOT EXISTS idx_contact_group_members_group ON public.contact_group_members(group_id);
CREATE INDEX IF NOT EXISTS idx_contact_group_members_contact ON public.contact_group_members(contact_id);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_contact_group_members_external
  ON public.contact_group_members(group_id, lower(external_email))
  WHERE external_email IS NOT NULL AND contact_id IS NULL;