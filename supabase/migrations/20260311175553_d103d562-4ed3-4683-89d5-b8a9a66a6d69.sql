
CREATE TABLE public.profile_parameters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.report_profiles(id) ON DELETE CASCADE,
  parameter_id uuid NOT NULL REFERENCES public.report_test_parameters(id) ON DELETE CASCADE,
  display_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (profile_id, parameter_id)
);

ALTER TABLE public.profile_parameters ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all on profile_parameters" ON public.profile_parameters FOR ALL TO public USING (true) WITH CHECK (true);
