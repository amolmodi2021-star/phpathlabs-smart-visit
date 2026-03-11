
-- Departments
CREATE TABLE public.report_departments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  department_name text NOT NULL UNIQUE,
  display_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE public.report_departments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on report_departments" ON public.report_departments FOR ALL TO public USING (true) WITH CHECK (true);

-- Profiles
CREATE TABLE public.report_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_name text NOT NULL,
  department_id uuid REFERENCES public.report_departments(id) ON DELETE CASCADE,
  analyzer text,
  method text,
  remarks text,
  display_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE public.report_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on report_profiles" ON public.report_profiles FOR ALL TO public USING (true) WITH CHECK (true);

-- Test Parameters
CREATE TABLE public.report_test_parameters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parameter_name text NOT NULL,
  test_name text,
  profile_id uuid REFERENCES public.report_profiles(id) ON DELETE SET NULL,
  department_id uuid REFERENCES public.report_departments(id) ON DELETE SET NULL,
  unit text,
  normal_range_low numeric,
  normal_range_high numeric,
  normal_range_text text,
  analyzer text,
  method text,
  store_for_analytics boolean DEFAULT false,
  display_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE public.report_test_parameters ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on report_test_parameters" ON public.report_test_parameters FOR ALL TO public USING (true) WITH CHECK (true);

-- Patient Master
CREATE TABLE public.patient_master (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  umr_id text UNIQUE NOT NULL,
  patient_name text NOT NULL,
  gender text,
  age text,
  date_of_birth date,
  mobile_number text,
  email text,
  ref_doctor text DEFAULT 'SELF',
  first_visit_date timestamptz DEFAULT now(),
  last_visit_date timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE public.patient_master ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on patient_master" ON public.patient_master FOR ALL TO public USING (true) WITH CHECK (true);
CREATE INDEX idx_patient_master_umr ON public.patient_master(umr_id);

-- Uploaded Reports
CREATE TABLE public.uploaded_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_path text NOT NULL,
  file_name text,
  upload_time timestamptz DEFAULT now(),
  status text DEFAULT 'Pending',
  umr_id text,
  patient_name text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE public.uploaded_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on uploaded_reports" ON public.uploaded_reports FOR ALL TO public USING (true) WITH CHECK (true);

-- Extracted Report Data
CREATE TABLE public.extracted_report_data (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid REFERENCES public.uploaded_reports(id) ON DELETE CASCADE,
  patient_name text,
  age text,
  gender text,
  umr_id text,
  ref_doctor text,
  collection_date text,
  report_date text,
  test_results jsonb DEFAULT '[]',
  pathologist_name text,
  verified boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE public.extracted_report_data ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on extracted_report_data" ON public.extracted_report_data FOR ALL TO public USING (true) WITH CHECK (true);

-- Test Result History
CREATE TABLE public.test_result_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  umr_id text NOT NULL,
  test_name text,
  parameter_name text NOT NULL,
  result_value numeric,
  result_text text,
  unit text,
  normal_range_low numeric,
  normal_range_high numeric,
  test_date timestamptz DEFAULT now(),
  department text,
  profile_name text,
  analyzer text,
  method text,
  report_id uuid REFERENCES public.uploaded_reports(id) ON DELETE SET NULL,
  flag text,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.test_result_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on test_result_history" ON public.test_result_history FOR ALL TO public USING (true) WITH CHECK (true);
CREATE INDEX idx_test_result_history_umr ON public.test_result_history(umr_id);
CREATE INDEX idx_test_result_history_param ON public.test_result_history(parameter_name);
CREATE INDEX idx_test_result_history_umr_param ON public.test_result_history(umr_id, parameter_name);

-- Raw Report Data
CREATE TABLE public.raw_report_data (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid REFERENCES public.uploaded_reports(id) ON DELETE CASCADE,
  umr_id text,
  raw_json jsonb,
  upload_date timestamptz DEFAULT now()
);
ALTER TABLE public.raw_report_data ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on raw_report_data" ON public.raw_report_data FOR ALL TO public USING (true) WITH CHECK (true);

-- Pathologist Signatures
CREATE TABLE public.pathologist_signatures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pathologist_name text NOT NULL,
  signature_image_path text,
  designation text,
  qualification text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE public.pathologist_signatures ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on pathologist_signatures" ON public.pathologist_signatures FOR ALL TO public USING (true) WITH CHECK (true);

-- Report Templates
CREATE TABLE public.report_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_name text NOT NULL,
  template_config jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE public.report_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on report_templates" ON public.report_templates FOR ALL TO public USING (true) WITH CHECK (true);

-- Generated Reports
CREATE TABLE public.generated_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid REFERENCES public.uploaded_reports(id) ON DELETE CASCADE,
  umr_id text,
  patient_name text,
  report_html text,
  generated_at timestamptz DEFAULT now(),
  pathologist_id uuid REFERENCES public.pathologist_signatures(id),
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.generated_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on generated_reports" ON public.generated_reports FOR ALL TO public USING (true) WITH CHECK (true);

-- Storage buckets for report uploads and signatures
INSERT INTO storage.buckets (id, name, public) VALUES ('report-uploads', 'report-uploads', true) ON CONFLICT (id) DO NOTHING;
INSERT INTO storage.buckets (id, name, public) VALUES ('signatures', 'signatures', true) ON CONFLICT (id) DO NOTHING;

-- Storage RLS policies
CREATE POLICY "Allow all uploads on report-uploads" ON storage.objects FOR ALL TO public USING (bucket_id = 'report-uploads') WITH CHECK (bucket_id = 'report-uploads');
CREATE POLICY "Allow all uploads on signatures" ON storage.objects FOR ALL TO public USING (bucket_id = 'signatures') WITH CHECK (bucket_id = 'signatures');

-- Update triggers
CREATE TRIGGER update_report_departments_updated_at BEFORE UPDATE ON public.report_departments FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_report_profiles_updated_at BEFORE UPDATE ON public.report_profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_report_test_parameters_updated_at BEFORE UPDATE ON public.report_test_parameters FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_patient_master_updated_at BEFORE UPDATE ON public.patient_master FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_uploaded_reports_updated_at BEFORE UPDATE ON public.uploaded_reports FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_extracted_report_data_updated_at BEFORE UPDATE ON public.extracted_report_data FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_pathologist_signatures_updated_at BEFORE UPDATE ON public.pathologist_signatures FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
