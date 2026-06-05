
-- ============================================================
-- COLLAB DOCUMENTS
-- ============================================================
CREATE TABLE public.collab_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  space_id uuid NOT NULL,
  title text NOT NULL DEFAULT 'Document sans titre',
  doc_type text NOT NULL DEFAULT 'native' CHECK (doc_type IN ('native','office')),
  content jsonb NOT NULL DEFAULT '{"type":"doc","content":[{"type":"paragraph"}]}'::jsonb,
  collab_mode text NOT NULL DEFAULT 'async' CHECK (collab_mode IN ('async','realtime')),
  is_template boolean NOT NULL DEFAULT false,
  template_scope text NOT NULL DEFAULT 'personal' CHECK (template_scope IN ('personal','space')),
  template_source_id uuid,
  -- Office 365
  office_provider text CHECK (office_provider IN ('word','excel','powerpoint')),
  office_item_id text,
  office_url text,
  office_thumbnail_url text,
  office_synced_at timestamptz,
  -- Stats
  version_count integer NOT NULL DEFAULT 0,
  unresolved_comments integer NOT NULL DEFAULT 0,
  last_edited_by uuid,
  last_edited_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.collab_documents TO authenticated;
GRANT ALL ON public.collab_documents TO service_role;

ALTER TABLE public.collab_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own collab_documents all"
  ON public.collab_documents
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_collab_documents_space ON public.collab_documents(space_id, archived_at);
CREATE INDEX idx_collab_documents_user ON public.collab_documents(user_id);
CREATE INDEX idx_collab_documents_template ON public.collab_documents(is_template) WHERE is_template = true;

CREATE TRIGGER trg_collab_documents_updated
  BEFORE UPDATE ON public.collab_documents
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- COLLAB DOCUMENT VERSIONS
-- ============================================================
CREATE TABLE public.collab_document_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES public.collab_documents(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  version_number integer NOT NULL,
  title text NOT NULL,
  content jsonb NOT NULL,
  change_summary text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.collab_document_versions TO authenticated;
GRANT ALL ON public.collab_document_versions TO service_role;

ALTER TABLE public.collab_document_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own collab_document_versions all"
  ON public.collab_document_versions
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_collab_doc_versions_doc ON public.collab_document_versions(document_id, version_number DESC);
