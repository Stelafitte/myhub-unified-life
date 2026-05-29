
-- Table documents
CREATE TABLE public.documents (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  filename TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  file_size BIGINT NOT NULL DEFAULT 0,
  mime_type TEXT,
  storage_path TEXT,
  source_type TEXT NOT NULL DEFAULT 'manual',
  source_id UUID,
  account_id UUID,
  tags TEXT[] NOT NULL DEFAULT '{}',
  description TEXT,
  is_sensitive BOOLEAN NOT NULL DEFAULT false,
  sensitive_score INTEGER,
  sensitive_reason TEXT,
  local_only BOOLEAN NOT NULL DEFAULT false,
  checksum TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT documents_source_type_check CHECK (source_type IN ('email','task','meeting','manual'))
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.documents TO authenticated;
GRANT ALL ON public.documents TO service_role;

ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own documents all" ON public.documents
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_documents_user_source ON public.documents(user_id, source_type, source_id);
CREATE INDEX idx_documents_user_checksum ON public.documents(user_id, checksum);
CREATE INDEX idx_documents_user_created ON public.documents(user_id, created_at DESC);

CREATE TRIGGER trg_documents_updated_at
  BEFORE UPDATE ON public.documents
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Table document_retention_settings
CREATE TABLE public.document_retention_settings (
  user_id UUID NOT NULL PRIMARY KEY,
  email_retention_days INTEGER NOT NULL DEFAULT 365,
  task_retention_days INTEGER NOT NULL DEFAULT 730,
  meeting_retention_days INTEGER NOT NULL DEFAULT 730,
  manual_retention_days INTEGER NOT NULL DEFAULT 0,
  max_file_size_mb INTEGER NOT NULL DEFAULT 25,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.document_retention_settings TO authenticated;
GRANT ALL ON public.document_retention_settings TO service_role;

ALTER TABLE public.document_retention_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own retention all" ON public.document_retention_settings
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER trg_retention_updated_at
  BEFORE UPDATE ON public.document_retention_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Storage bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('documents', 'documents', false)
ON CONFLICT (id) DO NOTHING;

-- Storage RLS: chemin = {user_id}/...
CREATE POLICY "own documents storage select" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'documents' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "own documents storage insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'documents' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "own documents storage update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'documents' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "own documents storage delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'documents' AND auth.uid()::text = (storage.foldername(name))[1]);
