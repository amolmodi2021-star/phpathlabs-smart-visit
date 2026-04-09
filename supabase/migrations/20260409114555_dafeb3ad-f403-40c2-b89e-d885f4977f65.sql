
CREATE TABLE public.approved_reports (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  registration_id uuid NOT NULL,
  invoice_number text,
  umr_number text,
  patient_name text,
  title text,
  gender text,
  dob date,
  mobile_number text,
  email text,
  address text,
  doctor_name text,
  visit_type text,
  is_stat boolean DEFAULT false,
  report_language text,
  approved_by text,
  registration_date timestamptz,
  sample_collection_date timestamptz,
  test_date timestamptz,
  approval_date timestamptz DEFAULT now(),
  print_date timestamptz,
  test_results jsonb DEFAULT '[]'::jsonb,
  outsourced_snip_urls jsonb DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_approved_reports_registration_id ON public.approved_reports(registration_id);
CREATE INDEX idx_approved_reports_invoice_number ON public.approved_reports(invoice_number);
CREATE INDEX idx_approved_reports_umr_number ON public.approved_reports(umr_number);

ALTER TABLE public.approved_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all on approved_reports"
  ON public.approved_reports
  FOR ALL
  USING (true)
  WITH CHECK (true);
