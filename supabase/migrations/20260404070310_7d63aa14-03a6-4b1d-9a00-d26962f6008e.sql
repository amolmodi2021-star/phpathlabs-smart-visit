
-- CRM Contacts
CREATE TABLE public.crm_contacts (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  primary_key text NOT NULL UNIQUE,
  location text,
  umr_number text,
  bill_number text,
  visit_date text,
  patient_name text,
  mobile_number text,
  visit_type text,
  doctor_name text,
  gross_amount numeric DEFAULT 0,
  discount_amount numeric DEFAULT 0,
  net_amount numeric DEFAULT 0,
  paid_amount numeric DEFAULT 0,
  due_amount numeric DEFAULT 0,
  payment_type text,
  remarks text,
  created_by text,
  record_tag text,
  default_discount_pct numeric DEFAULT 20,
  last_sent_type text,
  last_sent_date timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.crm_contacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on crm_contacts" ON public.crm_contacts FOR ALL USING (true) WITH CHECK (true);

CREATE TRIGGER update_crm_contacts_updated_at
  BEFORE UPDATE ON public.crm_contacts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- CRM Abnormal Tests
CREATE TABLE public.crm_abnormal_tests (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  contact_primary_key text NOT NULL,
  test_name text NOT NULL,
  test_date text,
  result_value text,
  normal_range text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.crm_abnormal_tests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on crm_abnormal_tests" ON public.crm_abnormal_tests FOR ALL USING (true) WITH CHECK (true);

-- CRM Blacklist
CREATE TABLE public.crm_blacklist (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  mobile_number text NOT NULL UNIQUE,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.crm_blacklist ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on crm_blacklist" ON public.crm_blacklist FOR ALL USING (true) WITH CHECK (true);

-- CRM Sequence Rules
CREATE TABLE public.crm_sequence_rules (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  step_order integer NOT NULL DEFAULT 0,
  action_type text NOT NULL DEFAULT 'promotion',
  delay_days integer NOT NULL DEFAULT 0,
  filter_location text NOT NULL DEFAULT 'ALL',
  template_id uuid REFERENCES public.marketing_templates(id) ON DELETE SET NULL,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.crm_sequence_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on crm_sequence_rules" ON public.crm_sequence_rules FOR ALL USING (true) WITH CHECK (true);

CREATE TRIGGER update_crm_sequence_rules_updated_at
  BEFORE UPDATE ON public.crm_sequence_rules
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Indexes
CREATE INDEX idx_crm_contacts_mobile ON public.crm_contacts(mobile_number);
CREATE INDEX idx_crm_contacts_location ON public.crm_contacts(location);
CREATE INDEX idx_crm_contacts_record_tag ON public.crm_contacts(record_tag);
CREATE INDEX idx_crm_abnormal_tests_pk ON public.crm_abnormal_tests(contact_primary_key);
