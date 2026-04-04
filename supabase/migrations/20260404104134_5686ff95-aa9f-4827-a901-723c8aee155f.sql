
CREATE TABLE public.crm_import_staging (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  batch_id uuid NOT NULL DEFAULT gen_random_uuid(),
  primary_key text NOT NULL,
  patient_name text,
  mobile_number text,
  umr_number text,
  location text,
  bill_number text,
  visit_date text,
  visit_type text,
  gross_amount numeric DEFAULT 0,
  discount_amount numeric DEFAULT 0,
  net_amount numeric DEFAULT 0,
  paid_amount numeric DEFAULT 0,
  due_amount numeric DEFAULT 0,
  payment_type text,
  remarks text,
  created_by text,
  doctor_name text,
  default_discount_pct numeric DEFAULT 20,
  record_tag text DEFAULT 'DAILY',
  is_blacklisted boolean DEFAULT false,
  is_update boolean DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.crm_import_staging ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all on crm_import_staging"
  ON public.crm_import_staging
  FOR ALL
  USING (true)
  WITH CHECK (true);
