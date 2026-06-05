
-- Comments table
CREATE TABLE public.collab_document_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES public.collab_documents(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  parent_id uuid REFERENCES public.collab_document_comments(id) ON DELETE CASCADE,
  anchor_text text,
  anchor_from integer,
  anchor_to integer,
  body text NOT NULL CHECK (length(body) BETWEEN 1 AND 5000),
  resolved boolean NOT NULL DEFAULT false,
  resolved_at timestamptz,
  resolved_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_collab_doc_comments_doc ON public.collab_document_comments(document_id, resolved, created_at DESC);
CREATE INDEX idx_collab_doc_comments_parent ON public.collab_document_comments(parent_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.collab_document_comments TO authenticated;
GRANT ALL ON public.collab_document_comments TO service_role;

ALTER TABLE public.collab_document_comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own collab_document_comments all"
  ON public.collab_document_comments
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER trg_collab_doc_comments_updated
  BEFORE UPDATE ON public.collab_document_comments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Enable Realtime on document, versions, comments
ALTER TABLE public.collab_documents REPLICA IDENTITY FULL;
ALTER TABLE public.collab_document_versions REPLICA IDENTITY FULL;
ALTER TABLE public.collab_document_comments REPLICA IDENTITY FULL;

ALTER PUBLICATION supabase_realtime ADD TABLE public.collab_documents;
ALTER PUBLICATION supabase_realtime ADD TABLE public.collab_document_versions;
ALTER PUBLICATION supabase_realtime ADD TABLE public.collab_document_comments;
