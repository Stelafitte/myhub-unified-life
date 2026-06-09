
CREATE TABLE public.expense_organizations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  legal_name TEXT,
  address TEXT,
  contact_email TEXT,
  template_path TEXT,
  template_filename TEXT,
  template_mime TEXT,
  template_file_type TEXT,
  ai_mapping JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.expense_organizations TO authenticated;
GRANT ALL ON public.expense_organizations TO service_role;

ALTER TABLE public.expense_organizations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own expense organizations"
  ON public.expense_organizations FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER set_expense_organizations_updated_at
  BEFORE UPDATE ON public.expense_organizations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX idx_expense_organizations_user ON public.expense_organizations(user_id);

ALTER TABLE public.expense_reports
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.expense_organizations(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_expense_reports_org ON public.expense_reports(organization_id);
