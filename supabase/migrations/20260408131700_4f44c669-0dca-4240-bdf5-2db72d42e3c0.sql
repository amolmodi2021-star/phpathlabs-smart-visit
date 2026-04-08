
CREATE TABLE public.patient_results (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  registration_id UUID NOT NULL,
  test_id UUID NOT NULL,
  parameter_id UUID NOT NULL,
  param_code TEXT,
  parameter_name TEXT,
  result_value TEXT,
  unit TEXT,
  reference_range TEXT,
  normal_range_low NUMERIC,
  normal_range_high NUMERIC,
  flag TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  entered_by TEXT,
  is_from_interface BOOLEAN NOT NULL DEFAULT false,
  is_calculated BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.patient_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all on patient_results"
ON public.patient_results
FOR ALL
USING (true)
WITH CHECK (true);

CREATE INDEX idx_patient_results_registration ON public.patient_results(registration_id);
CREATE INDEX idx_patient_results_status ON public.patient_results(status);
CREATE INDEX idx_patient_results_param ON public.patient_results(parameter_id);
