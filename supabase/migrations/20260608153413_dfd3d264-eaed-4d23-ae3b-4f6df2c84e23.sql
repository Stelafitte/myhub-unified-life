
-- Expense reports module
CREATE TABLE IF NOT EXISTS public.expense_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  title text NOT NULL,
  mission_object text,
  mission_context text CHECK (mission_context IN ('congres','formation','reunion','enseignement','recherche','autre')),
  organization text,
  mission_number text,
  identification jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','approved','rejected','paid')),
  total_amount numeric(10,2) NOT NULL DEFAULT 0,
  advance_amount numeric(10,2) NOT NULL DEFAULT 0,
  amount_to_reimburse numeric(10,2) NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'EUR',
  payment_method text CHECK (payment_method IN ('virement','cheque')),
  iban text,
  signature_location text NOT NULL DEFAULT 'Bordeaux',
  signature_date date,
  notes text,
  source_email_id uuid REFERENCES public.emails(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.expense_reports TO authenticated;
GRANT ALL ON public.expense_reports TO service_role;
ALTER TABLE public.expense_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "expense_reports_owner" ON public.expense_reports FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER trg_expense_reports_updated_at BEFORE UPDATE ON public.expense_reports FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE INDEX idx_expense_reports_user_created ON public.expense_reports(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.expense_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL REFERENCES public.expense_reports(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  date date NOT NULL,
  category text NOT NULL CHECK (category IN ('transport_commun','vehicule_perso','hebergement','repas','inscription','documentation','reprographie','materiel','telephone','visa','autre')),
  description text NOT NULL,
  vendor text,
  amount_ttc numeric(10,2) NOT NULL DEFAULT 0,
  tva_rate numeric(5,2) DEFAULT 0,
  amount_ht numeric(10,2),
  km_distance integer,
  km_rate numeric(5,3),
  has_receipt boolean NOT NULL DEFAULT false,
  receipt_path text,
  receipt_document_id uuid REFERENCES public.documents(id) ON DELETE SET NULL,
  source_email_id uuid REFERENCES public.emails(id) ON DELETE SET NULL,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.expense_items TO authenticated;
GRANT ALL ON public.expense_items TO service_role;
ALTER TABLE public.expense_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "expense_items_owner" ON public.expense_items FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX idx_expense_items_report ON public.expense_items(report_id, position);

CREATE TABLE IF NOT EXISTS public.expense_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL,
  organization text NOT NULL,
  file_path text,
  file_type text CHECK (file_type IN ('excel','pdf','word')),
  mime_type text,
  ai_mapping jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.expense_templates TO authenticated;
GRANT ALL ON public.expense_templates TO service_role;
ALTER TABLE public.expense_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "expense_templates_owner" ON public.expense_templates FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Allow 'expense' source_type on documents
ALTER TABLE public.documents DROP CONSTRAINT IF EXISTS documents_source_type_check;
ALTER TABLE public.documents ADD CONSTRAINT documents_source_type_check CHECK (source_type = ANY (ARRAY['email','task','meeting','manual','expense']));
